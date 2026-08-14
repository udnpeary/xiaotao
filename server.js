require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ===================================================
// 请确认你的 .env 文件中有 DEEPSEEK_API_KEY
// ===================================================
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
if (!DEEPSEEK_API_KEY) {
  console.error('❌ 错误：找不到 DEEPSEEK_API_KEY，请检查 .env 文件');
  process.exit(1);
}

const client = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com/v1',
});

const resultStore = {};

// ===== 时辰转换辅助函数 =====
function getTimeIndex(birthTime) {
  const timeMap = {
    '子时': 0, '丑时': 1, '寅时': 2, '卯时': 3,
    '辰时': 4, '巳时': 5, '午时': 6, '未时': 7,
    '申时': 8, '酉时': 9, '戌时': 10, '亥时': 11
  };
  for (const [key, value] of Object.entries(timeMap)) {
    if (birthTime.includes(key)) {
      return value;
    }
  }
  return 4; // 预设辰时
}

// ===== 1. 调用 Brhiza/mingyu 公开 API 进行排盘 =====
async function getBaziChart(birthDate, birthTime, birthPlace) {
  const [year, month, day] = birthDate.split('-').map(Number);
  const timeIndex = getTimeIndex(birthTime);

  // 1.1 调用 /bazi/prompt 接口，获取排盘数据和提示词
  const url = 'https://aov.cc/api/v1/bazi/prompt'; // 注意这里是 /prompt 接口[reference:2][reference:3]
  const requestBody = {
    year: year,
    month: month,
    day: day,
    timeIndex: timeIndex,
    dateType: 'solar',
    gender: 'male', // 可根据需要调整
    city: birthPlace || '台湾省'
  };

  console.log(`⏳ 正在调用 Brhiza/mingyu API 进行排盘...`);
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
    throw new Error(`Brhiza/mingyu API 请求失败 (${response.status}): ${errorText}`);
  }

  const result = await response.json();

  // 1.2 检查 API 返回结果
  if (result.ok !== true || !result.data) {
    throw new Error(`Brhiza/mingyu API 返回异常: ${JSON.stringify(result)}`);
  }

  // 1.3 关键步骤：从返回结果中提取排盘数据 (data.result) 和 AI 提示词 (data.prompt)[reference:4][reference:5]
  const chartData = result.data.result;
  const promptForAI = result.data.prompt;

  console.log('✅ Brhiza/mingyu 排盘成功');
  return { chartData, promptForAI };
}

// ===== 2. 算命 API =====
app.post('/api/fortune', async (req, res) => {
  const { birthDate, birthTime, birthPlace } = req.body;

  if (!birthDate) {
    return res.status(400).json({ error: '请选择出生日期' });
  }

  try {
    // --- 第一步：调用 Brhiza/mingyu API 排盘并获取提示词 ---
    const { chartData, promptForAI } = await getBaziChart(birthDate, birthTime, birthPlace);

    // --- 第二步：将获取到的提示词直接发给 DeepSeek 进行解读 ---
    const completion = await client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `你是一个专业的八字命理分析师，请根据以下信息进行分析。`
        },
        {
          role: 'user',
          content: promptForAI // 直接将 API 返回的 prompt 作为用户消息发送[reference:6][reference:7]
        }
      ],
      temperature: 0.7,
    });

    let aiResponse = completion.choices[0].message.content;

    // 尝试解析 AI 返回的 JSON，如果失败则原样返回
    let finalResult = {};
    try {
      // 移除可能的 markdown 代码块标记
      const jsonStr = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
      finalResult = JSON.parse(jsonStr);
    } catch (e) {
      // 如果 AI 没返回 JSON，就把整个回答作为 personality 字段返回
      finalResult = {
        dayMaster: "未知",
        favorable: "未知",
        personality: aiResponse,
        title: "命理探索者",
        crystal: "建议咨询专业人士"
      };
    }

    // 附加上原始的排盘数据（可选）
    finalResult._bazi = chartData;

    res.json(finalResult);

  } catch (error) {
    console.error('排盘或解读失败：', error);
    // 备选方案
    const fallbackResult = getFallbackResult(birthDate);
    res.json(fallbackResult);
  }
});

// ===== 备选方案 =====
function getFallbackResult(birthDate) {
  // ... (此部分保持不变，作为 API 完全失效时的最后保障)
  const [year, month, day] = birthDate.split('-').map(Number);
  const total = year + month + day;
  const wuxingList = ['木', '火', '土', '金', '水'];
  const index = total % 5;
  const nextIndex = (index + 1) % 5;
  const nextIndex2 = (index + 2) % 5;

  const dayMasterMap = ['甲木', '丙火', '戊土', '庚金', '壬水'];
  const titleMap = ['青龙战神', '朱雀凤凰', '麒麟尊者', '白虎将军', '玄武智者'];
  const crystalMap = [
    '绿松石，属木，能增强你的决断力',
    '红玛瑙，属火，能激发你的热情',
    '黄水晶，属土，能稳定你的情绪',
    '白水晶，属金，能提升你的洞察力',
    '黑曜石，属水，能保护你的能量'
  ];
  const personalityMap = [
    '充满活力与创造力，喜欢挑战新事物，像春天的树木一样蓬勃生长',
    '热情奔放，充满感染力，像夏日的阳光一样温暖他人',
    '稳重踏实，值得信赖，像大地一样承载万物',
    '果断锐利，正直不阿，像秋天的金属一样坚韧',
    '智慧深邃，柔韧如水，像冬天的流水一样通达'
  ];

  return {
    dayMaster: dayMasterMap[index],
    favorable: `喜${wuxingList[nextIndex]}、${wuxingList[nextIndex2]}`,
    personality: personalityMap[index],
    title: titleMap[index],
    crystal: crystalMap[index]
  };
}

// ===== 3. 存储结果 =====
app.post('/api/save-result', (req, res) => {
  // ... (此部分保持不变)
  const data = req.body;
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  resultStore[id] = data;
  res.json({ id });
});

// ===== 4. 取得结果 =====
app.get('/api/result/:id', (req, res) => {
  // ... (此部分保持不变)
  const data = resultStore[req.params.id];
  if (data) {
    res.json(data);
  } else {
    res.status(404).json({ error: '找不到结果' });
  }
});

// ===== 5. 启动 =====
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ 小桃魔女启动，运行在端口 ${port}`);
});
