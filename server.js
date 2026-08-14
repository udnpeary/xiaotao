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

const client = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com/v1',
});

const resultStore = {};

// ===================================================
// ===== 純 JavaScript 八字排盤（無需任何外部 API） =====
// ===================================================

const TIAN_GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const DI_ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const WUXING_GAN = ['木', '木', '火', '火', '土', '土', '金', '金', '水', '水'];
const WUXING_ZHI = ['水', '土', '木', '木', '土', '火', '火', '土', '金', '金', '土', '水'];

const SHI_CHEN_MAP = {
  '子時': 0, '丑時': 1, '寅時': 2, '卯時': 3,
  '辰時': 4, '巳時': 5, '午時': 6, '未時': 7,
  '申時': 8, '酉時': 9, '戌時': 10, '亥時': 11
};

const YEAR_BASE = 1900;
const YEAR_GAN_INDEX = 6;
const YEAR_ZHI_INDEX = 0;
const DAY_BASE = new Date(1900, 0, 1);
const DAY_GAN_INDEX = 0;
const DAY_ZHI_INDEX = 0;

function getTimeIndex(birthTime) {
  for (const [key, value] of Object.entries(SHI_CHEN_MAP)) {
    if (birthTime.includes(key)) {
      return value;
    }
  }
  return 4;
}

function calculateBazi(birthDate, birthTime) {
  const [year, month, day] = birthDate.split('-').map(Number);
  const timeIndex = getTimeIndex(birthTime);

  // 年柱
  const yearOffset = year - YEAR_BASE;
  const yearGanIdx = (YEAR_GAN_INDEX + yearOffset) % 10;
  const yearZhiIdx = (YEAR_ZHI_INDEX + yearOffset) % 12;
  const yearPillar = TIAN_GAN[yearGanIdx] + DI_ZHI[yearZhiIdx];

  // 月柱
  let monthZhiIdx = (2 + (month - 1)) % 12;
  const yearGan = TIAN_GAN[yearGanIdx];
  let monthGanOffset = 0;
  if (yearGan === '甲' || yearGan === '己') monthGanOffset = 2;
  else if (yearGan === '乙' || yearGan === '庚') monthGanOffset = 4;
  else if (yearGan === '丙' || yearGan === '辛') monthGanOffset = 6;
  else if (yearGan === '丁' || yearGan === '壬') monthGanOffset = 8;
  else if (yearGan === '戊' || yearGan === '癸') monthGanOffset = 0;
  const monthGanIdx = (monthGanOffset + (month - 1)) % 10;
  const monthPillar = TIAN_GAN[monthGanIdx] + DI_ZHI[monthZhiIdx];

  // 日柱
  const targetDate = new Date(year, month - 1, day);
  const diffDays = Math.floor((targetDate - DAY_BASE) / (1000 * 60 * 60 * 24));
  const dayGanIdx = (DAY_GAN_INDEX + diffDays) % 10;
  const dayZhiIdx = (DAY_ZHI_INDEX + diffDays) % 12;
  const dayPillar = TIAN_GAN[dayGanIdx] + DI_ZHI[dayZhiIdx];
  const dayMaster = TIAN_GAN[dayGanIdx] + WUXING_GAN[dayGanIdx];
  const dayMasterWuxing = WUXING_GAN[dayGanIdx];

  // 時柱
  const hourZhiIdx = timeIndex;
  const dayGan = TIAN_GAN[dayGanIdx];
  let hourGanOffset = 0;
  if (dayGan === '甲' || dayGan === '己') hourGanOffset = 0;
  else if (dayGan === '乙' || dayGan === '庚') hourGanOffset = 2;
  else if (dayGan === '丙' || dayGan === '辛') hourGanOffset = 4;
  else if (dayGan === '丁' || dayGan === '壬') hourGanOffset = 6;
  else if (dayGan === '戊' || dayGan === '癸') hourGanOffset = 8;
  const hourGanIdx = (hourGanOffset + timeIndex) % 10;
  const hourPillar = TIAN_GAN[hourGanIdx] + DI_ZHI[hourZhiIdx];

  // 計算五行統計（簡易版）
  const allChars = (yearPillar + monthPillar + dayPillar + hourPillar).split('');
  const wuxingCount = { '木': 0, '火': 0, '土': 0, '金': 0, '水': 0 };
  const ganMap = { '甲': '木', '乙': '木', '丙': '火', '丁': '火', '戊': '土', '己': '土', '庚': '金', '辛': '金', '壬': '水', '癸': '水' };
  const zhiMap = { '子': '水', '丑': '土', '寅': '木', '卯': '木', '辰': '土', '巳': '火', '午': '火', '未': '土', '申': '金', '酉': '金', '戌': '土', '亥': '水' };

  for (const char of allChars) {
    if (ganMap[char]) wuxingCount[ganMap[char]]++;
    else if (zhiMap[char]) wuxingCount[zhiMap[char]]++;
  }

  // 找出缺什麼五行
  const missingWuxing = [];
  for (const [key, value] of Object.entries(wuxingCount)) {
    if (value === 0) missingWuxing.push(key);
  }

  // 幸運色對照
  const luckyColorMap = {
    '木': '綠色系（翠綠、草綠）',
    '火': '紅色系（朱紅、橘紅）',
    '土': '黃色系（米黃、大地色）',
    '金': '白色系（銀白、米白）',
    '水': '藍色系（深藍、藏青）'
  };
  const luckyColor = luckyColorMap[dayMasterWuxing] || '粉色系';

  return {
    yearPillar,
    monthPillar,
    dayPillar,
    hourPillar,
    dayMaster,
    dayMasterWuxing,
    wuxingCount,
    missingWuxing,
    luckyColor,
    fullBazi: `${yearPillar} ${monthPillar} ${dayPillar} ${hourPillar}`
  };
}

// ===== 1. 本地排盤 =====
function getBaziChart(birthDate, birthTime) {
  console.log(`⏳ 正在本地排盤: ${birthDate} ${birthTime}`);
  try {
    const result = calculateBazi(birthDate, birthTime);
    console.log(`✅ 本地排盤成功: ${result.fullBazi}`);
    return result;
  } catch (error) {
    console.error('本地排盤失敗：', error);
    return null;
  }
}

// ===== 2. 算命 API =====
app.post('/api/fortune', async (req, res) => {
  const { birthDate, birthTime, birthPlace } = req.body;

  if (!birthDate) {
    return res.status(400).json({ error: '請選擇出生日期' });
  }

  try {
    // --- 第一步：本地排盤 ---
    const baziData = getBaziChart(birthDate, birthTime);

    if (!baziData) {
      const fallbackResult = getFallbackResult(birthDate);
      return res.json(fallbackResult);
    }

    // --- 第二步：DeepSeek 解盤（人生檔案風格） ---
    const completion = await client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `
你是一位精通八字命理的老師，代號「小桃魔女」。

以下是使用者**真實排盤**的八字命盤數據：

年柱：${baziData.yearPillar}
月柱：${baziData.monthPillar}
日柱：${baziData.dayPillar}
時柱：${baziData.hourPillar}
日主：${baziData.dayMaster}
日主五行：${baziData.dayMasterWuxing}
五行統計：${JSON.stringify(baziData.wuxingCount)}
缺什麼五行：${baziData.missingWuxing.join('、') || '無'}

請根據這份**真實的命盤**來解盤，寫成一份「人生檔案」風格的報告。
回傳 **純 JSON**，格式如下：
{
  "dayMaster": "日主五行（例如：甲木）",
  "lifeProfile": "人生檔案描述（50~80字，描述這個人的天性、潛能、人生方向，要溫暖有趣）",
  "title": "專屬稱號（例如：烈火戰神）",
  "strength": "天賦優勢（20字內）",
  "weakness": "需要注意的地方（20字內）"
}
`
        },
        {
          role: 'user',
          content: `請根據上面提供的真實八字命盤數據，為這位使用者撰寫人生檔案。`
        }
      ],
      temperature: 0.7,
    });

    let content = completion.choices[0].message.content;
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(content);

    // 合併排盤數據 + AI 解讀
    const finalResult = {
      ...result,
      bazi: {
        year: baziData.yearPillar,
        month: baziData.monthPillar,
        day: baziData.dayPillar,
        hour: baziData.hourPillar,
        full: baziData.fullBazi
      },
      wuxing: baziData.dayMasterWuxing,
      wuxingCount: baziData.wuxingCount,
      missingWuxing: baziData.missingWuxing,
      luckyColor: baziData.luckyColor
    };

    res.json(finalResult);

  } catch (error) {
    console.error('解盤失敗：', error);
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
  const personalityMap = [
    '充滿活力與創造力，喜歡挑戰新事物，像春天的樹木一樣蓬勃生長',
    '熱情奔放，充滿感染力，像夏日的陽光一樣溫暖他人',
    '穩重踏實，值得信賴，像大地一樣承載萬物',
    '果斷銳利，正直不阿，像秋天的金屬一樣堅韌',
    '智慧深邃，柔韌如水，像冬天的流水一樣通達'
  ];

  return {
    dayMaster: dayMasterMap[index],
    lifeProfile: personalityMap[index],
    title: titleMap[index],
    strength: '適應力強',
    weakness: '偶爾缺乏耐心',
    wuxing: wuxingList[index],
    wuxingCount: { '木': 1, '火': 2, '土': 1, '金': 0, '水': 0 },
    missingWuxing: ['金'],
    luckyColor: '粉色系',
    bazi: { full: '甲子 丙寅 戊辰 庚午' }
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
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ 小桃魔女啟動，運行在端口 ${port}`);
});
