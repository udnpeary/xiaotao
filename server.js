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

// ===== 1. 模擬排盤（當外部 API 不可用時） =====
async function getBaziChart(birthDate, birthTime, birthPlace) {
  console.log('⚠️ 排盤 API 目前不可用，將由 DeepSeek 直接推算八字');
  return {
    _source: 'deepseek-generated',
    birthDate: birthDate,
    birthTime: birthTime,
    birthPlace: birthPlace
  };
}

// ===== 2. 算命 API =====
app.post('/api/fortune', async (req, res) => {
  const { birthDate, birthTime, birthPlace } = req.body;

  if (!birthDate) {
    return res.status(400).json({ error: '請選擇出生日期' });
  }

  try {
    console.log(`⏳ 正在為 ${birthDate} ${birthTime} 推演命盤...`);
    const baziData = await getBaziChart(birthDate, birthTime, birthPlace);
    console.log('✅ 模擬命盤完成，準備讓 AI 解盤');

    const completion = await client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `
你是一位精通八字命理的老師，代號「小桃魔女」。

請根據使用者的出生日期、時辰、地點，**按照以下步驟嚴格推算八字**，不要跳步或憑空編造。

---

### 第一步：換算農曆（年柱、月柱、日柱）
1. 將公曆生日換算成農曆（請用你內建的曆法知識）。
2. **年柱**：以「立春」為分界。若生日在立春前，則年柱為前一年；若在立春後，則為該年。
3. **月柱**：以「節氣」為分界（每月以「節」為準，非「氣」）：
   - 寅月：立春 ~ 驚蟄
   - 卯月：驚蟄 ~ 清明
   - 辰月：清明 ~ 立夏
   - 巳月：立夏 ~ 芒種
   - 午月：芒種 ~ 小暑
   - 未月：小暑 ~ 立秋
   - 申月：立秋 ~ 白露
   - 酉月：白露 ~ 寒露
   - 戌月：寒露 ~ 立冬
   - 亥月：立冬 ~ 大雪
   - 子月：大雪 ~ 小寒
   - 丑月：小寒 ~ 立春
4. **日柱**：根據農曆日期，查找對應的干支（可用你內建的知識推算）。
5. **時柱**：根據時辰對照表：
   - 子時 (23:00-00:59) → 子
   - 丑時 (01:00-02:59) → 丑
   - 寅時 (03:00-04:59) → 寅
   - 卯時 (05:00-06:59) → 卯
   - 辰時 (07:00-08:59) → 辰
   - 巳時 (09:00-10:59) → 巳
   - 午時 (11:00-12:59) → 午
   - 未時 (13:00-14:59) → 未
   - 申時 (15:00-16:59) → 申
   - 酉時 (17:00-18:59) → 酉
   - 戌時 (19:00-20:59) → 戌
   - 亥時 (21:00-22:59) → 亥

---

### 第二步：排出四柱八字
完整寫出年柱、月柱、日柱、時柱的**天干地支**（例如：甲子、丙寅、戊辰、庚午）。

---

### 第三步：定日主
- 日柱的**天干**即為「日主」（命主本人）。
- 請寫出日主對應的五行（甲、乙 → 木；丙、丁 → 火；戊、己 → 土；庚、辛 → 金；壬、癸 → 水）。

---

### 第四步：分析五行生剋
1. 列出八字中所有天干地支的五行（包含藏干，如地支中的餘氣）。
2. 計算五行強弱（月令對日主的影響最大）。
3. 根據「扶抑、通關、調候」原則，判斷日主的身強或身弱，並決定**喜用神**（對命主最有利的五行）。

---

### 第五步：輸出結果
請回傳 **純 JSON**，格式如下：
{
  "dayMaster": "日主五行（例如：甲木）",
  "favorable": "喜用神（例如：喜金、水）",
  "personality": "根據日主和命盤，給出 20~30 字的個性描述，活潑有趣",
  "title": "根據命盤給一個江湖稱號（例如：烈火戰神）",
  "crystal": "根據喜用神推薦一種水晶，並說明原因"
}

---

### 重要提醒
- 務必依照上述步驟推算，確保結果有邏輯依據。
- 不要編造，不要使用模糊語言。
- 如果資訊不足，請合理推斷並註明。
`
        },
        {
          role: 'user',
          content: `出生日期：${birthDate}，時辰：${birthTime}，地點：${birthPlace}。請按照上述步驟推算八字並解盤。`
        }
      ],
      temperature: 0.5, // 降低溫度，讓 AI 更嚴謹
    });

    let content = completion.choices[0].message.content;
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(content);
    res.json(result);

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

// ===== 5. 啟動（支援 Render 動態端口） =====
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ 小桃魔女啟動，運行在端口 ${port}`);
});
