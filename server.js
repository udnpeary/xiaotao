require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ===================================================
// ⚠️ 請確認你的 .env 檔案中有 DEEPSEEK_API_KEY
// ===================================================
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
if (!DEEPSEEK_API_KEY) {
  console.error('❌ 錯誤：找不到 DEEPSEEK_API_KEY，請檢查 .env 檔案');
  process.exit(1);
}
// ===================================================

const client = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com/v1',
});

const resultStore = {};

// ===== 時辰轉換表 =====
function getTimeIndex(birthTime) {
  const timeMap = {
    '子時': 0, '丑時': 1, '寅時': 2, '卯時': 3,
    '辰時': 4, '巳時': 5, '午時': 6, '未時': 7,
    '申時': 8, '酉時': 9, '戌時': 10, '亥時': 11
  };
  for (const [key, value] of Object.entries(timeMap)) {
    if (birthTime.includes(key)) {
      return value;
    }
  }
  return 4; // 預設辰時
}

// ===== 1. 呼叫公開排盤 API =====
async function getBaziChart(birthDate, birthTime, birthPlace) {
  const [year, month, day] = birthDate.split('-').map(Number);
  const timeIndex = getTimeIndex(birthTime);

  const url = `https://aov.cc/api/v1/bazi/calculate`;

  const requestBody = {
    year: year,
    month: month,
    day: day,
    timeIndex: timeIndex,
    dateType: 'solar',
    gender: 'male',
    city: birthPlace || '台灣省'
  };

  console.log(`⏳ 正在呼叫排盤 API: ${url}`);
  console.log(`📤 請求參數:`, JSON.stringify(requestBody));

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`排盤 API 請求失敗 (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  if (data.ok === true && data.data) {
    return data.data;
  }

  if (data.year && data.month && data.day) {
    return data;
  }

  throw new Error(`排盤 API 回傳異常: ${JSON.stringify(data)}`);
}

// ===== 2. 算命 API =====
app.post('/api/fortune', async (req, res) => {
  const { birthDate, birthTime, birthPlace } = req.body;

  if (!birthDate) {
    return res.status(400).json({ error: '請選擇出生日期' });
  }

  try {
    console.log(`⏳ 正在為 ${birthDate} ${birthTime} 排盤...`);
    const baziData = await getBaziChart(birthDate, birthTime, birthPlace);
    console.log('✅ 排盤成功，準備讓 AI 解盤');

    const completion = await client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `
你是一位精通八字命理的老師，代號「小桃魔女」。
以下是使用者的完整八字命盤數據（JSON 格式）：
${JSON.stringify(baziData, null, 2)}

請根據這份**真實的命盤數據**來解盤，不要自己憑空編造。
回傳 **純 JSON**，格式如下：
{
  "dayMaster": "日主五行（例如：甲木）",
  "favorable": "喜用神（例如：喜金、水）",
  "personality": "根據日主和命盤，給出 20~30 字的個性描述，活潑有趣",
  "title": "根據命盤給一個江湖稱號（例如：烈火戰神）",
  "crystal": "根據喜用神推薦一種水晶，並說明原因"
}
`
        },
        {
          role: 'user',
          content: `請根據上面提供的八字命盤數據，為這位使用者解盤。`
        }
      ],
      temperature: 0.7,
    });

    let content = completion.choices[0].message.content;
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(content);
    res.json(result);

  } catch (error) {
    console.error('排盤或解盤失敗：', error);

    // 備用方案
    const fallbackResult = getFallbackResult(birthDate);
    res.json(fallbackResult);
  }
});

// ===== 備用方案 =====
function getFallbackResult(birthDate) {
  const [year, month, day] = birthDate.split('-').map(Number);
  const total = year + month + day;
  const wuxingList = ['木', '火', '土', '金', '水'];
  const index = total % 5;
  const nextIndex = (index + 1) % 5;
  const nextIndex2 = (index + 2) % 5;

  const dayMasterMap = ['甲木', '丙火', '戊土', '庚金', '壬水'];
  const titleMap = ['青龍戰神', '朱雀鳳凰', '麒麟尊者', '白虎將軍', '玄武智者'];
  const crystalMap = [
    '綠松石，屬木，能增強你的決斷力',
    '紅瑪瑙，屬火，能激發你的熱情',
    '黃水晶，屬土，能穩定你的情緒',
    '白水晶，屬金，能提升你的洞察力',
    '黑曜石，屬水，能保護你的能量'
  ];
  const personalityMap = [
    '充滿活力與創造力，喜歡挑戰新事物，像春天的樹木一樣蓬勃生長',
    '熱情奔放，充滿感染力，像夏日的陽光一樣溫暖他人',
    '穩重踏實，值得信賴，像大地一樣承載萬物',
    '果斷銳利，正直不阿，像秋天的金屬一樣堅韌',
    '智慧深邃，柔韌如水，像冬天的流水一樣通達'
  ];

  return {
    dayMaster: dayMasterMap[index],
    favorable: `喜${wuxingList[nextIndex]}、${wuxingList[nextIndex2]}`,
    personality: personalityMap[index],
    title: titleMap[index],
    crystal: crystalMap[index]
  };
}

// ===== 3. 儲存結果 =====
app.post('/api/save-result', (req, res) => {
  const data = req.body;
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  resultStore[id] = data;
  res.json({ id });
});

// ===== 4. 取得結果 =====
app.get('/api/result/:id', (req, res) => {
  const data = resultStore[req.params.id];
  if (data) {
    res.json(data);
  } else {
    res.status(404).json({ error: '找不到結果' });
  }
});

// ===== 5. 啟動 =====
app.listen(3000, () => {
  console.log('✅ 小桃魔女啟動 → http://localhost:3000');
});
