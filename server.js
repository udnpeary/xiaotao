require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const { execFileSync } = require('child_process');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

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

// ===== 設定 fortune-skill 的路徑 =====
const FORTUNE_SKILL_PATH = path.join(__dirname, '../fortune-skill');

// ===== 1. 呼叫 fortune-skill 排盤 =====
function getBaziChart(birthDate, birthTime, gender = 'male', birthplace = '台灣') {
  const [year, month, day] = birthDate.split('-').map(Number);
  const hourMatch = birthTime.match(/(\d{2}):/);
  const hour = hourMatch ? parseInt(hourMatch[1]) : 8;
  const minuteMatch = birthTime.match(/:(\d{2})/);
  const minute = minuteMatch ? parseInt(minuteMatch[1]) : 0;

  console.log(`⏳ 正在使用 fortune-skill 排盤: ${birthDate} ${birthTime}`);

  try {
    const scriptPath = path.join(FORTUNE_SKILL_PATH, 'scripts/bazi-chart.mjs');

    // 構建參數：--solar YYYY-MM-DD --hour H --minute M --gender male/female --birthplace "城市名"
    const args = [
      '--solar', `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      '--hour', String(hour),
      '--minute', String(minute),
      '--gender', gender,
      '--birthplace', birthplace
    ];

    console.log(`🔧 執行: node ${scriptPath} ${args.join(' ')}`);

    // 使用 execFileSync 直接執行 node，不經 shell
    const output = execFileSync('node', [scriptPath, ...args], {
      encoding: 'utf-8',
      timeout: 15000,
      env: { ...process.env }
    });

    // 解析結果（假設輸出為 JSON）
    const result = JSON.parse(output);

    // 從 result 中提取八字數據
    // 根據 fortune-skill 的輸出格式，它可能返回 { bazi: { year: '甲子', month: '丙寅', day: '戊辰', hour: '庚午' } }
    // 或者直接返回四柱
    const bazi = result.bazi || result;

    return {
      yearPillar: bazi.year || bazi.yearPillar || '',
      monthPillar: bazi.month || bazi.monthPillar || '',
      dayPillar: bazi.day || bazi.dayPillar || '',
      hourPillar: bazi.hour || bazi.hourPillar || '',
      fullBazi: `${bazi.year || ''} ${bazi.month || ''} ${bazi.day || ''} ${bazi.hour || ''}`.trim(),
      raw: result
    };

  } catch (error) {
    console.error('fortune-skill 排盤失敗：', error.message);
    if (error.stderr) console.error('stderr:', error.stderr.toString());
    return null;
  }
}

// ===== 2. 算命 API =====
app.post('/api/fortune', async (req, res) => {
  const { birthDate, birthTime, gender, calendar, birthplace } = req.body;
  if (!birthDate || !birthTime) {
    return res.status(400).json({ error: '請填寫完整的出生日期和時間' });
  }

  try {
    // 注意：fortune-skill 預設為公曆，若用戶選農曆需另行處理，但目前我們只支援公曆
    const baziData = getBaziChart(birthDate, birthTime, gender, birthplace || '台灣');
    if (!baziData) {
      return res.json(getFallbackResult(birthDate));
    }

    console.log('✅ 排盤成功，準備讓 DeepSeek 分析');

    const systemPrompt = `
你是一個幽默風趣的算命老師，代號「小桃魔女」。說話像一個老朋友，帶著一點搞笑和溫暖。

以下是使用者**真實八字命盤**：

年柱：${baziData.yearPillar}
月柱：${baziData.monthPillar}
日柱：${baziData.dayPillar}
時柱：${baziData.hourPillar}
日主：${baziData.dayPillar ? baziData.dayPillar.charAt(0) : '未知'}

請根據這份命盤，**用說故事的方式**描述這個人的命格，像是幫他寫一段「人生角色設定」。
要幽默、有趣、有畫面感，讓人覺得「哇，好準！」但不要太嚴肅或過度玄學。

然後推薦一種最適合他的五行水晶，並說明原因。

回傳 **純 JSON**，格式如下：
{
  "title": "一個有趣的江湖稱號（例如：春風裡的一把火）",
  "lifeStory": "用 100~150 字描述這個人的命格與人生故事，要幽默風趣、像在講一個角色的設定",
  "crystal": "推薦一種水晶，說明為什麼適合他（例如：紫水晶，幫你冷靜一下你那衝動的靈魂）"
}
`;

    const completion = await client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `性別：${gender === 'male' ? '男' : '女'}，出生：${birthDate} ${birthTime}，請幫我寫一段幽默的人生故事。` }
      ],
      temperature: 0.8,
    });

    let content = completion.choices[0].message.content;
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(content);

    const finalResult = {
      ...result,
      bazi: {
        year: baziData.yearPillar,
        month: baziData.monthPillar,
        day: baziData.dayPillar,
        hour: baziData.hourPillar,
        full: baziData.fullBazi
      },
      dayMaster: baziData.dayPillar ? baziData.dayPillar.charAt(0) : '未知'
    };

    res.json(finalResult);
  } catch (error) {
    console.error('解盤失敗：', error);
    res.json(getFallbackResult(birthDate));
  }
});

// ===== 備用方案（與之前相同） =====
function getFallbackResult(birthDate) {
  const [year, month, day] = birthDate.split('-').map(Number);
  const total = year + month + day;
  const index = total % 5;
  const titleMap = ['春風裡的青龍', '夏日的鳳凰', '大地的麒麟', '秋天的白虎', '冬夜的玄武'];
  const storyMap = [
    '你像一棵春天剛發芽的樹，充滿了好奇心和生命力。喜歡到處探索，但有時候會不小心走太遠，需要有人拉你一把。',
    '你是那種走到哪裡都自帶光芒的人，像夏天的煙火，熱情又耀眼。但有時候太熱情了，旁邊的人需要戴墨鏡。',
    '你像一座穩穩的大山，給人滿滿的安全感。但有時候太穩了，會忘記自己其實也可以飛一下。',
    '你像秋天的風，帶著一股清爽的銳利感，做事果斷乾脆。但有時候太銳利了，會不小心傷到旁邊的樹葉。',
    '你像冬天的一條河，表面平靜，底下卻藏著很多故事。你有著深邃的智慧，但有時候想太多了，會忘記行動。'
  ];
  const crystalMap = ['綠松石', '紅瑪瑙', '黃水晶', '白水晶', '黑曜石'];

  return {
    title: titleMap[index],
    lifeStory: storyMap[index],
    crystal: crystalMap[index] + '，能幫你平衡能量，發揮你的天賦',
    bazi: { year: '甲子', month: '丙寅', day: '戊辰', hour: '庚午', full: '甲子 丙寅 戊辰 庚午' },
    dayMaster: '甲'
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
  console.log(`📁 fortune-skill 路徑: ${FORTUNE_SKILL_PATH}`);
});
