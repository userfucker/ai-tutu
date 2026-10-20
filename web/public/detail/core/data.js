/**
 * 详情页工作室 · 固定数据（平台、语言、风格、图片标签、违禁词）
 *
 * core/ 下的文件都是普通网页脚本，不用任何插件接口，以后做网页版可以直接搬过去。
 * 所有东西挂在全局 ST 上。
 */
var ST = globalThis.ST || (globalThis.ST = {});
ST.VERSION = "0.7.0";

// ---------------------------------------------------------------- 平台
// w = 出图宽度（像素）；h = 固定高度（亚马逊 A+ 这类固定尺寸模块），没有就是长图
// sliceH = 切片时每张最高多少像素；maxKB = 每张图最大多少 KB（超了自动降 JPG 质量）
// verify = 尺寸是常用值、还没对照官方后台核对过（界面上会提示，可以在“平台设置”里改）
// rules = 检查时用哪些违禁词表
ST.PLATFORMS = [
  { id: "taobao-m", name: "淘宝/天猫 手机", group: "国内", w: 750, sliceH: 1500, maxKB: 2048, rules: ["cn-ad", "cn-medical"], lang: "zh-CN" },
  { id: "taobao-pc", name: "淘宝/天猫 电脑", group: "国内", w: 790, sliceH: 1500, maxKB: 2048, rules: ["cn-ad", "cn-medical"], lang: "zh-CN" },
  { id: "1688", name: "1688", group: "国内", w: 790, sliceH: 1500, maxKB: 2048, rules: ["cn-ad", "cn-medical"], lang: "zh-CN" },
  { id: "jd", name: "京东", group: "国内", w: 750, sliceH: 1500, maxKB: 2048, rules: ["cn-ad", "cn-medical"], verify: true, lang: "zh-CN" },
  { id: "pdd", name: "拼多多", group: "国内", w: 750, sliceH: 1500, maxKB: 2048, rules: ["cn-ad", "cn-medical"], verify: true, lang: "zh-CN" },
  { id: "douyin", name: "抖店", group: "国内", w: 750, sliceH: 1500, maxKB: 2048, rules: ["cn-ad", "cn-medical"], verify: true, lang: "zh-CN" },
  { id: "amazon-a", name: "亚马逊 A+ 标准", group: "跨境", w: 970, h: 600, maxKB: 2048, rules: ["amazon", "global-medical"], lang: "en" },
  { id: "amazon-p", name: "亚马逊 A+ 高级", group: "跨境", w: 1464, h: 600, maxKB: 2048, rules: ["amazon", "global-medical"], lang: "en" },
  { id: "aliexpress", name: "速卖通", group: "跨境", w: 750, sliceH: 1500, maxKB: 2048, rules: ["global", "global-medical"], verify: true, lang: "en" },
  { id: "shopee", name: "Shopee", group: "跨境", w: 800, sliceH: 1600, maxKB: 2048, rules: ["global", "global-medical"], verify: true, lang: "en" },
  { id: "lazada", name: "Lazada", group: "跨境", w: 750, sliceH: 1500, maxKB: 2048, rules: ["global", "global-medical"], verify: true, lang: "en" },
  { id: "tiktok", name: "TikTok Shop", group: "跨境", w: 750, sliceH: 1500, maxKB: 2048, rules: ["global", "global-medical"], verify: true, lang: "en" },
  { id: "temu", name: "Temu", group: "跨境", w: 800, sliceH: 1600, maxKB: 2048, rules: ["global", "global-medical"], verify: true, lang: "en" },
  { id: "ozon", name: "Ozon", group: "跨境", w: 1000, sliceH: 2000, maxKB: 2048, rules: ["global", "global-medical"], verify: true, lang: "ru" },
  { id: "ebay", name: "eBay", group: "跨境", w: 800, sliceH: 1600, maxKB: 2048, rules: ["global", "global-medical"], verify: true, lang: "en" },
  { id: "shopify", name: "独立站", group: "跨境", w: 1200, sliceH: 2400, maxKB: 3072, rules: ["global-medical"], verify: true, lang: "en" },
  { id: "custom", name: "自定义", group: "其他", w: 750, sliceH: 1500, maxKB: 2048, rules: [], lang: "zh-CN" },
];

// ---------------------------------------------------------------- 语言
// font = 用哪套字体（见 ST.FONTS）；rtl = 从右往左写；units = 默认单位显示
ST.LANGS = [
  { code: "zh-CN", name: "简体中文", native: "简体中文", font: "sc", units: "metric", ai: "简体中文" },
  { code: "en", name: "英语", native: "English", font: "latin", units: "both", ai: "English" },
  { code: "ru", name: "俄语", native: "Русский", font: "latin", units: "metric", ai: "Russian" },
  { code: "fr", name: "法语", native: "Français", font: "latin", units: "metric", ai: "French" },
  { code: "de", name: "德语", native: "Deutsch", font: "latin", units: "metric", ai: "German" },
  { code: "es", name: "西班牙语", native: "Español", font: "latin", units: "metric", ai: "Spanish" },
  { code: "zh-TW", name: "繁体中文", native: "繁體中文", font: "tc", units: "metric", ai: "Traditional Chinese (Taiwan)" },
  { code: "pt", name: "葡萄牙语", native: "Português", font: "latin", units: "metric", ai: "Portuguese (Brazil)" },
  { code: "it", name: "意大利语", native: "Italiano", font: "latin", units: "metric", ai: "Italian" },
  { code: "ja", name: "日语", native: "日本語", font: "jp", units: "metric", ai: "Japanese" },
  { code: "ko", name: "韩语", native: "한국어", font: "kr", units: "metric", ai: "Korean" },
  { code: "vi", name: "越南语", native: "Tiếng Việt", font: "latin", units: "metric", ai: "Vietnamese" },
  { code: "id", name: "印尼语", native: "Bahasa Indonesia", font: "latin", units: "metric", ai: "Indonesian" },
  { code: "ms", name: "马来语", native: "Bahasa Melayu", font: "latin", units: "metric", ai: "Malay" },
  { code: "th", name: "泰语", native: "ไทย", font: "th", units: "metric", ai: "Thai" },
  { code: "tr", name: "土耳其语", native: "Türkçe", font: "latin", units: "metric", ai: "Turkish" },
  { code: "pl", name: "波兰语", native: "Polski", font: "latin", units: "metric", ai: "Polish" },
  { code: "nl", name: "荷兰语", native: "Nederlands", font: "latin", units: "metric", ai: "Dutch" },
  { code: "ar", name: "阿拉伯语", native: "العربية", font: "ar", rtl: true, units: "metric", ai: "Arabic" },
];
ST.lang = (code) => ST.LANGS.find((l) => l.code === code) || ST.LANGS[0];

// 字体：sans = 正文和一般标题；serif = “高端”风格的标题（没有衬线体的语言用 sans）
ST.FONTS = {
  sc: { sans: '"Noto Sans SC", "Noto Sans", sans-serif', serif: '"Noto Serif SC", "Noto Sans SC", serif' },
  tc: { sans: '"Noto Sans TC", "Noto Sans", sans-serif', serif: '"Noto Serif SC", "Noto Sans TC", serif' },
  jp: { sans: '"Noto Sans JP", "Noto Sans", sans-serif', serif: '"Noto Sans JP", sans-serif' },
  kr: { sans: '"Noto Sans KR", "Noto Sans", sans-serif', serif: '"Noto Sans KR", sans-serif' },
  ar: { sans: '"Noto Sans Arabic", "Noto Sans", sans-serif', serif: '"Noto Sans Arabic", sans-serif' },
  th: { sans: '"Noto Sans Thai", "Noto Sans", sans-serif', serif: '"Noto Sans Thai", sans-serif' },
  latin: { sans: '"Noto Sans", "Noto Sans SC", sans-serif', serif: '"Noto Serif", "Noto Sans", serif' },
};

// ---------------------------------------------------------------- 风格语气
// 颜色是默认配色；选了品牌就用品牌色替换 primary / accent
ST.TONES = {
  minimal: { name: "简约", head: "sans", primary: "#1f2329", accent: "#3b6fd8", text: "#1f2329", sub: "#5f6670", light: "#f4f5f7", card: "#ffffff",
    zh: "简约干净，留白多，语气平实", en: "minimal, clean, lots of white space, calm soft daylight, neutral light grey and white tones" },
  luxury: { name: "高端", head: "serif", primary: "#1c1a17", accent: "#b08a52", text: "#1c1a17", sub: "#6b6358", light: "#f2ede6", card: "#fbf8f3",
    zh: "高端大气，用词克制有质感", en: "premium luxury, elegant, warm beige and champagne tones, soft directional studio light, refined materials like marble or linen" },
  friendly: { name: "亲民", head: "sans", primary: "#e85d1a", accent: "#ff8a3d", text: "#2b2118", sub: "#6e5b4d", light: "#fff4ec", card: "#ffffff",
    zh: "亲切实在，像朋友推荐，突出实惠和好用", en: "warm, friendly, cozy everyday home setting, warm sunlight, soft orange and cream tones" },
  lively: { name: "活泼", head: "sans", primary: "#ef3f78", accent: "#18b9a8", text: "#1f1d2b", sub: "#5c5870", light: "#fdf0f5", card: "#ffffff",
    zh: "活泼年轻，有节奏感，可以俏皮", en: "playful, vibrant, youthful, bright pastel colors, cheerful lighting, fun geometric props" },
  pro: { name: "专业", head: "sans", primary: "#0d3b8c", accent: "#1f8ef1", text: "#14213d", sub: "#4f5d75", light: "#eef3fa", card: "#ffffff",
    zh: "专业可信，讲参数和原理，用词准确", en: "professional, technical, clean modern studio, cool blue-grey tones, precise lighting, high-tech feel" },
};

// ---------------------------------------------------------------- 图片标签
ST.TAGS = [
  { id: "white", name: "白底主图" },
  { id: "angle", name: "角度图" },
  { id: "detail", name: "细节图" },
  { id: "spec", name: "规格图" },
  { id: "package", name: "包装图" },
  { id: "scene", name: "场景图" },
  { id: "size", name: "尺寸图" },
  { id: "other", name: "未打标签" },
];
ST.tagName = (id) => (ST.TAGS.find((t) => t.id === id) || ST.TAGS[ST.TAGS.length - 1]).name;

// ---------------------------------------------------------------- 违禁词
// 每条：w = 词（字符串按原样找，/.../ 按正则找），tip = 为什么不行 / 怎么改
ST.BANNED = {
  "cn-ad": {
    name: "广告法极限词",
    langs: ["zh-CN", "zh-TW"],
    words: [
      [/最(?![近后初终])/, "广告法禁止“最”字类用语（最好、最佳、最低价……），换成具体说法"],
      ["第一", "广告法禁止“第一”类用语"], ["唯一", "广告法禁止“唯一”"], ["顶级", "广告法禁止“顶级”"],
      ["国家级", "广告法禁止“国家级”"], ["世界级", "广告法禁止“世界级”"], ["极致", "广告法禁止“极致”"],
      ["首个", "广告法禁止“首个”"], ["首选", "广告法禁止“首选”"], ["全网", "“全网第一/全网最低”属于绝对化用语"],
      ["独一无二", "绝对化用语"], ["绝对", "绝对化用语"], ["100%", "绝对化用语，除非有检测报告"], ["百分百", "绝对化用语"],
      ["万能", "绝对化用语"], ["永久", "绝对化用语"], ["无敌", "绝对化用语"], ["史无前例", "绝对化用语"],
      ["王牌", "绝对化用语"], ["冠军", "需要有依据，否则属于虚假宣传"], ["遥遥领先", "绝对化用语"], ["销量冠军", "需要有依据"],
      ["特供", "禁止使用“特供、专供”"], ["专供", "禁止使用“特供、专供”"], ["领导人", "禁止使用国家机关和工作人员名义"],
      ["驰名商标", "禁止在广告中使用“驰名商标”"], ["零风险", "绝对化承诺"], ["无副作用", "绝对化承诺"],
    ],
  },
  "cn-medical": {
    name: "医疗 / 功效夸大",
    langs: ["zh-CN", "zh-TW"],
    words: [
      ["治疗", "普通商品不能宣传治疗作用"], ["治愈", "普通商品不能宣传治疗作用"], ["疗效", "普通商品不能宣传疗效"],
      ["药用", "普通商品不能宣传药用"], ["消炎", "普通商品不能宣传医疗功效"], ["抗癌", "普通商品不能宣传医疗功效"],
      ["根治", "医疗用语"], ["包治", "医疗用语"], ["降血压", "医疗用语"], ["降血糖", "医疗用语"], ["防癌", "医疗用语"],
      ["减肥", "需要相应资质，普通商品慎用"], ["祛斑", "化妆品特殊功效需要备案"], ["生发", "化妆品特殊功效需要备案"],
      ["杀菌", "需要检测报告，写清楚检测机构和条件"], ["除菌", "需要检测报告"], ["抗菌", "需要检测报告"],
    ],
  },
  amazon: {
    name: "亚马逊图片规定",
    langs: ["*"],
    words: [
      [/\bfree shipping\b/i, "A+ 内容不能写运费、配送信息"], [/\bbest[- ]?sell(er|ing)\b/i, "不能写“畅销”类说法"],
      [/#\s?1\b|\bno\.?\s?1\b|\bnumber one\b/i, "不能写“第一”类说法"], [/\bsale\b|\bdiscount\b|% off\b|\bdeal\b/i, "不能写促销、打折"],
      [/\bcheap(est)?\b|\blowest price\b/i, "不能写价格比较"], [/[$€£¥]\s?\d/, "不能写价格"],
      [/\bguarantee[sd]?\b|\bwarrant(y|ies)\b/i, "不能写保证 / 质保承诺"], [/\blimited time\b|\bbuy now\b|\border now\b/i, "不能写催促购买的话"],
      [/\btop[- ]rated\b|\bbest\b/i, "不能写“最好”类主观最高级说法"], [/www\.|https?:\/\/|@\w+\.\w+/i, "不能写网址、邮箱等联系方式"],
      [/包邮|促销|打折|折扣|最畅销/, "A+ 内容不能写运费、促销、畅销等"],
    ],
  },
  global: {
    name: "通用夸大用语",
    langs: ["*"],
    words: [
      [/\b100%\b/i, "绝对化说法，除非有检测报告"], [/\bbest in the world\b|\bworld'?s best\b/i, "绝对化说法"],
      [/\bguaranteed\b/i, "保证类承诺"], [/\bno\.?\s?1\b|#\s?1\b/i, "“第一”类说法要有依据"],
    ],
  },
  "global-medical": {
    name: "医疗 / 功效夸大（外语）",
    langs: ["*"],
    words: [
      [/\bcures?\b|\bheals?\b|\btreats?\b|\btreatment\b/i, "普通商品不能宣传治疗作用"],
      [/\bfda[- ]approved\b|\bclinically proven\b/i, "需要有对应资质 / 证明"],
      [/\banti[- ]?(bacterial|microbial|viral|cancer)\b|\bkills? (germs|bacteria|viruses)\b/i, "抗菌、杀菌类说法需要检测报告，部分平台禁止"],
      [/\bweight loss\b|\blose weight\b/i, "减肥类说法需要资质"],
    ],
  },
};
