require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const { execSync } = require('child_process');
const path = require('path');

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

// ===== 設定 bazi-analysis-skill 的路徑 =====
const BAZI_SKILL_PATH = path.join(__dirname, '../bazi-analysis-skill/bazi-analysis');

// ===== 1. 呼叫 Python 排盤腳本 =====
function getBaziChart(birthDate, birthTime, gender = 'male', calendar = 'solar') {
  const [year, month, day] = birthDate.split('-').map(Number);
  const hourMatch = birthTime.match(/(\d{2}):/);
  const hour = hourMatch ? parseInt(hourMatch[1]) : 8;
  const minute = 0;

  console.log(`⏳ 正在使用 bazi-analysis-skill 排盤: ${birthDate} ${birthTime}`);

  try {
    const scriptsDir = path.join(BAZI_SKILL_PATH, 'scripts');
    const cmd = `python3 chart_cli.py --calendar ${calendar} --year ${year} --month ${month} --day ${day} --hour ${hour} --minute ${minute} --gender ${gender} --json`;
    
    console.log(`🔧 執行: ${cmd}`);
    
    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 15000,
      cwd: scriptsDir,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });
    
    const result = JSON.parse(output);
    const chart = result.chart || result;
    
    return {
      yearPillar: chart.yearPillar || chart.year || '',
      monthPillar: chart.monthPillar || chart.month || '',
      dayPillar: chart.dayPillar || chart.day || '',
      hourPillar: chart.hourPillar || chart.hour || '',
      dayMaster: chart.dayMaster || chart.day_master || '',
      dayMasterWuxing: chart.dayMasterWuxing || chart.day_master_wuxing || '',
      fullBazi: `${chart.yearPillar || ''} ${chart.monthPillar || ''} ${chart.dayPillar || ''} ${chart.hourPillar || ''}`.trim(),
      raw: result
    };
    
  } catch (error) {
    console.error('排盤腳本執行失敗：', error.message);
    return null;
  }
}

// ===== 2. 算命 API =====
app.post('/api/fortune', async (req, res) => {
  const { birthDate, birthTime, gender, calendar } = req.body;

  if (!birthDate || !birthTime) {
    return res.status(400).json({ error: '請填寫完整的出生日期和時間' });
  }

  try {
    // --- 第一步：排盤 ---
    const baziData = getBaziChart(birthDate, birthTime, gender, calendar);

    if (!baziData) {
      const fallbackResult = getFallbackResult(birthDate);
      return res.json(fallbackResult);
    }

    console.log('✅ 排盤成功，準備讓 DeepSeek 分析');

    // --- 第二步：DeepSeek 幽默解盤 ---
    const systemPrompt = `
你是一個幽默風趣的算命老師，代號「小桃魔女」。說話像一個老朋友，帶著一點搞笑和溫暖。

以下是使用者**真實八字命盤**：

年柱：${baziData.yearPillar}
月柱：${baziData.monthPillar}
日柱：${baziData.dayPillar}
時柱：${baziData.hourPillar}
日主：${baziData.dayMaster}

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

    // 合併排盤數據
    const finalResult = {
      ...result,
      bazi: {
        year: baziData.yearPillar,
        month: baziData.monthPillar,
        day: baziData.dayPillar,
        hour: baziData.hourPillar,
        full: baziData.fullBazi
      },
      dayMaster: baziData.dayMaster
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
    dayMaster: '甲木'
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
  console.log(`📁 bazi-analysis-skill 路徑: ${BAZI_SKILL_PATH}`);
});
