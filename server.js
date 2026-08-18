require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

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

// ===== 自動尋找 fortune-skill 路徑 =====
function findFortuneSkillPath() {
  const possiblePaths = [
    path.join(__dirname, '../fortune-skill'),           // 本地開發：與 xiaotao 同層
    path.join(__dirname, 'fortune-skill'),              // Render 部署：在專案根目錄
    path.join('/opt/render/project', 'fortune-skill'),  // Render 備用路徑
  ];

  for (const p of possiblePaths) {
    const scriptPath = path.join(p, 'scripts/bazi-chart.mjs');
    if (fs.existsSync(scriptPath)) {
      console.log(`✅ 找到 fortune-skill: ${p}`);
      return p;
    }
  }
  console.warn('⚠️ 找不到 fortune-skill，將使用 lunar-javascript 備用排盤');
  return null;
}

const FORTUNE_SKILL_PATH = findFortuneSkillPath();

// ===== 1. 排盤函數（優先使用 fortune-skill，備用 lunar-javascript） =====
function getBaziChart(birthDate, birthTime, gender = 'male', birthplace = '台灣') {
  const [year, month, day] = birthDate.split('-').map(Number);
  const hourMatch = birthTime.match(/(\d{2}):/);
  const hour = hourMatch ? parseInt(hourMatch[1]) : 8;
  const minuteMatch = birthTime.match(/:(\d{2})/);
  const minute = minuteMatch ? parseInt(minuteMatch[1]) : 0;

  // ---- 方案 A：使用 fortune-skill（含真太陽時） ----
  if (FORTUNE_SKILL_PATH) {
    try {
      console.log(`⏳ 正在使用 fortune-skill 排盤: ${birthDate} ${birthTime}`);
      const scriptPath = path.join(FORTUNE_SKILL_PATH, 'scripts/bazi-chart.mjs');
      const args = [
        '--solar', `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        '--hour', String(hour),
        '--minute', String(minute),
        '--gender', gender,
        '--birthplace', birthplace
      ];

      console.log(`🔧 執行: node ${scriptPath} ${args.join(' ')}`);

      const output = execFileSync('node', [scriptPath, ...args], {
        encoding: 'utf-8',
        timeout: 15000,
        env: { ...process.env }
      });

      const result = JSON.parse(output);
      const bazi = result.bazi || result;

      return {
        yearPillar: bazi.year || bazi.yearPillar || '',
        monthPillar: bazi.month || bazi.monthPillar || '',
        dayPillar: bazi.day || bazi.dayPillar || '',
        hourPillar: bazi.hour || bazi.hourPillar || '',
        fullBazi: `${bazi.year || ''} ${bazi.month || ''} ${bazi.day || ''} ${bazi.hour || ''}`.trim(),
        raw: result,
        source: 'fortune-skill'
      };

    } catch (error) {
      console.error('fortune-skill 排盤失敗，改用備用方案:', error.message);
      // 繼續執行備用方案
    }
  }

  // ---- 方案 B：備用 lunar-javascript ----
  try {
    console.log(`⏳ 使用 lunar-javascript 備用排盤: ${birthDate} ${birthTime}`);
    const { Lunar, Solar } = require('lunar-javascript');
    const solar = Solar.fromYmdHms(year, month, day, hour, minute, 0);
    const lunar = solar.getLunar();

    const yearPillar = lunar.getYearInGanZhi();
    const monthPillar = lunar.getMonthInGanZhi();
    const dayPillar = lunar.getDayInGanZhi();
    const hourPillar = lunar.getTimeInGanZhi();

    return {
      yearPillar,
      monthPillar,
      dayPillar,
      hourPillar,
      fullBazi: `${yearPillar} ${monthPillar} ${dayPillar} ${hourPillar}`,
      source: 'lunar-javascript'
    };

  } catch (error) {
    console.error('所有排盤方案都失敗:', error.message);
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
    const baziData = getBaziChart(birthDate, birthTime, gender, birthplace || '台灣');
    if (!baziData) {
      return res.json(getFallbackResult(birthDate));
    }

    console.log(`✅ 排盤成功 (來源: ${baziData.source})`);

    const systemPrompt = `
你是一個幽默風趣的算命老師，代號「小桃魔女」。說話像一個老朋友，帶著一點搞笑和溫暖。

以下是使用者**真實八字命盤**：

年柱：${baziData.yearPillar}
月柱：${baziData.monthPillar}
日柱：${baziData.dayPillar}
時柱：${baziData.hourPillar}

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
      }
    };

    res.json(finalResult);
  } catch (error) {
    console.error('解盤失敗：', error);
    res.json(getFallbackResult(birthDate));
  }
});

// ===== 備用方案 =====
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
    bazi: { year: '甲子', month: '丙寅', day: '戊辰', hour: '庚午', full: '甲子 丙寅 戊辰 庚午' }
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
  console.log(`📁 fortune-skill 狀態: ${FORTUNE_SKILL_PATH ? '✅ 已找到' : '❌ 未找到（使用備用排盤）'}`);
});
