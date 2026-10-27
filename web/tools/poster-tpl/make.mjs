// 生成文字版主图模板的缩略图（示例文字）和线框图（格子名，发给出图 AI 看版式）：node tools/poster-tpl/make.mjs
// 输出 public/main/tpl/<id>.png、<id>-wire.png（720×720）
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ctx = { ST: { P: {} } };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "public/detail/core/postertpl.js"), "utf8"), ctx);
const TPLS = ctx.ST.POSTER_TPLS;

const EX = {
  A: { shop: "多份多旗舰店", list: "显卡 声卡 网络 打印机", small: "任何驱动处理", title: "驱动安装", promise: "不成功支持退款", bar: "一对一快速处理" },
  B: { tag: "纯净原版 不带捆绑插件", title1: "远程安装系统", title2: "纯净原版下载", sub: "多版本系统可选 7/10/11", pill1: "纯净原版", pill2: "U启制作", pill3: "硬盘分区", bar: "诚信安装 不成功不收费" },
  C: { title1: "远程安装", product: "MySQL", title2: "数据库远程安装", point1: "5.x~8.x 版本任意选", point2: "同步学校课本软件版本", point3: "赠送可视化工具", point4: "支持 Linux / Win / Mac", bar: "一对一服务 不成功 全额退款" },
  D: { title: "只做高端", keyword: "详情页设计", banner: "可接急单 啥图都能做", item1: "活动大海报", item2: "大爆款主图", item3: "高转化详情", item4: "产品图拍摄", item5: "3D 建模", item6: "美工包月", badge: "原创设计", promise1: "免费试做 运营指导", promise2: "初稿不满意可退款" },
  E: { tag1: "升级", tag2: "优化", tag3: "重装", tag4: "双系统", shop: "电脑专家", title: "电脑维修", sub: "电脑各种问题解决", box1: "系统安装", box2: "故障修复", box3: "网络问题", box4: "软件问题", foot1: "匠心服务", foot2: "售后无忧" },
  F1: { title: "MySQL环境安装服务", pill: "一键安装 | 环境配置 | 远程协助 | 退款保障", f1: "快速安装", f1d: "专业团队 高效快速", f2: "安全稳定", f2d: "稳定运行 安全可靠", f3: "远程协助", f3d: "一对一服务", f4: "多版本", f4d: "5.x~8.x 都支持", b1: "Windows 全系列", b2: "Linux 主流发行版", b3: "售后无忧", slogan: "专业团队 · 品质保障 · 满意为止" },
  F2: { tag: "专业服务 · 高效解决 · 快速响应", title: "远程安装调试", pill: "环境搭建 · 问题解决 · 配置优化", card: "一对一服务 快速解决问题", g1: "MySQL", g2: "JDK", g3: "Node", g4: "IDEA", g5: "Redis", g6: "Nginx", g7: "Navicat", g8: "Tomcat", a1: "专业团队", a2: "快速响应", a3: "质量保障", a4: "售后无忧" },
  G: { title: "远程安装 MySQL", sub: "4 步搞定 · 一对一远程", s1: "在线沟通", s2: "确认版本", s3: "远程安装", s4: "调试交付", bar: "专业服务 · 不成功退款" },
  H: { tag: "远程数据库服务", title: "MySQL 安装配置", big: "1对1", sub: "版本选择 · 参数配置 · 运行检查", bar: "远程协助 按需部署" },
};

const pill = "border-radius:99px;font-weight:700;display:flex;align-items:center;justify-content:center";
const ico = (label, st = "") => `<div class="a ico" style="${st}">${label}</div>`;
const H = {
  A: (v) => `<div class="b" style="background:#fff"><div class="a" style="inset:0;border:7px solid #e01e2b;border-radius:6px"></div>
 <div class="a c t" style="left:0;top:0;width:360px;height:40px;background:#e01e2b;color:#fff;font-size:18px">${v.shop}</div>
 <div class="a t" style="left:0;width:360px;top:52px;text-align:center;font-size:30px;color:#111">${v.list}</div>
 <div class="a" style="left:0;width:360px;top:92px;text-align:center;font-size:15px;color:#333;letter-spacing:6px">${v.small}</div>
 <div class="a t" style="left:0;width:360px;top:118px;text-align:center;font-size:84px;color:#e01e2b">${v.title}</div>
 <div class="a" style="left:40px;top:222px;width:280px;height:3px;background:#e01e2b"></div>
 <div class="a t" style="left:0;width:360px;top:238px;text-align:center;font-size:24px;color:#e01e2b">${v.promise}</div>
 <div class="a" style="left:0;top:292px;width:360px;height:68px;background:#e01e2b;border-radius:50% 50% 0 0/24px 24px 0 0"></div>
 <div class="a t" style="left:0;width:360px;top:312px;text-align:center;color:#fff;font-size:28px;letter-spacing:3px">${v.bar}</div></div>`,
  B: (v) => `<div class="b" style="background:linear-gradient(#f6f6f4,#e6e6e2)">
 <div class="a" style="left:48px;top:20px;width:264px;height:34px;border:2px dashed #555;color:#333;font-size:15px;${pill}">${v.tag}</div>
 <div class="a t" style="left:0;width:360px;top:72px;text-align:center;font-size:52px;color:#2b5bff">${v.title1}</div>
 <div class="a t" style="left:0;width:360px;top:132px;text-align:center;font-size:52px;color:#333">${v.title2}</div>
 <div class="a" style="left:0;width:360px;top:202px;text-align:center;font-size:20px;font-weight:700;color:#444">${v.sub}</div>
 <div class="a" style="left:18px;top:244px;width:324px;display:flex;gap:10px">${[v.pill1, v.pill2, v.pill3].map((x) => `<div style="flex:1;height:34px;background:#fff;color:#333;font-size:15px;${pill}">${x}</div>`).join("")}</div>
 <div class="a" style="left:0;top:296px;width:360px;height:64px;background:#1d3fa8"></div>
 <div class="a t" style="left:0;width:360px;top:314px;text-align:center;color:#fff;font-size:24px">${v.bar}</div></div>`,
  C: (v, w) => `<div class="b" style="background:#fff">
 <div class="a t" style="left:14px;top:14px;font-size:54px;color:#0d4f73;text-shadow:3px 3px 0 #f2a20c,-3px -3px 0 #f2a20c,3px -3px 0 #f2a20c,-3px 3px 0 #f2a20c">${v.title1}</div>
 ${ico(w ? "logo" : "软件 logo", "left:250px;top:10px;width:96px;height:90px")}
 <div class="a t" style="left:14px;top:84px;font-size:46px;color:#0d6c9a">${v.product}</div>
 <div class="a t" style="left:14px;top:138px;font-size:28px;color:#0d4f73;text-shadow:2px 2px 0 #f2a20c,-2px -2px 0 #f2a20c,2px -2px 0 #f2a20c,-2px 2px 0 #f2a20c">${v.title2}</div>
 <div class="a" style="left:14px;top:184px;width:332px;height:116px;background:#0d5c84;border-radius:16px;color:#fff;font-size:15px;font-weight:700;line-height:1.75;padding:8px 14px;box-sizing:border-box">${[v.point1, v.point2, v.point3, v.point4].map((x) => `<span style="color:#f2a20c">●</span> ${x}`).join("<br>")}</div>
 <div class="a" style="left:0;top:310px;width:360px;height:50px;background:#f2a20c"></div>
 <div class="a t" style="left:0;width:360px;top:322px;text-align:center;font-size:22px;color:#111">${v.bar}</div></div>`,
  D: (v) => `<div class="b" style="background:linear-gradient(#ffe7df,#fff)"><div class="a" style="inset:0;border:8px solid #ff5a1f;border-radius:6px"></div>
 <div class="a t" style="left:0;width:360px;top:20px;text-align:center;font-size:56px;color:#111">${v.title}</div>
 <div class="a c t" style="left:16px;top:92px;width:328px;height:76px;background:#ff5a1f;color:#fff;font-size:44px;border-radius:8px">${v.keyword}</div>
 <div class="a c t" style="left:30px;top:172px;width:300px;height:36px;background:#111;color:#fff;font-size:22px">${v.banner}</div>
 <div class="a" style="left:16px;top:220px;width:328px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">${[1, 2, 3, 4, 5, 6].map((i) => `<div style="height:28px;background:#ff5a1f;color:#fff;font-size:13px;${pill}">${v["item" + i]}</div>`).join("")}</div>
 <div class="a c t" style="left:8px;top:290px;width:110px;height:62px;background:#ff5a1f;color:#fff;font-size:22px;border-radius:0 30px 0 0;text-align:center">${v.badge}</div>
 <div class="a" style="left:126px;top:296px;font-size:14px;color:#e8471a;font-weight:700">${v.promise1}</div>
 <div class="a t" style="left:126px;top:318px;font-size:20px;color:#e8471a">${v.promise2}</div></div>`,
  E: (v) => `<div class="b" style="background:radial-gradient(circle at 50% 30%,#2a1a12,#050505)">
 <div class="a" style="left:12px;top:12px;display:flex;gap:6px">${[v.tag1, v.tag2, v.tag3, v.tag4].map((x) => `<div style="background:#e01e2b;height:28px;padding:0 10px;font-size:15px;color:#ffe14d;${pill}">${x}</div>`).join("")}</div>
 <div class="a t" style="right:12px;top:16px;font-size:17px;color:#ffe14d">${v.shop}</div>
 <div class="a t" style="left:0;width:360px;top:52px;text-align:center;font-size:88px;color:#fff;text-shadow:4px 4px 0 #e01e2b">${v.title}</div>
 <div class="a t" style="left:0;width:360px;top:150px;text-align:center;font-size:28px;color:#ffe14d">${v.sub}</div>
 <div class="a" style="left:12px;top:192px;width:336px;display:grid;grid-template-columns:1fr 1fr;gap:6px">${[v.box1, v.box2, v.box3, v.box4].map((x) => `<div class="c t" style="height:46px;background:#e01e2b;color:#ffe14d;font-size:28px;border-radius:4px">${x}</div>`).join("")}</div>
 <div class="a t" style="left:0;width:360px;top:300px;display:flex;justify-content:space-around;color:#fff;font-size:34px"><span>${v.foot1}</span><span>${v.foot2}</span></div></div>`,
  F1: (v, w) => `<div class="b" style="background:linear-gradient(160deg,#eef4ff,#d9e7ff)">
 ${ico(w ? "logo" : "软件 logo", "left:90px;top:8px;width:180px;height:44px")}
 <div class="a t" style="left:0;width:360px;top:60px;text-align:center;font-size:32px;color:#0b1f5c">${v.title}</div>
 <div class="a c" style="left:16px;top:104px;width:328px;height:30px;background:#1d4fd8;border-radius:99px;color:#fff;font-size:13px;font-weight:700">${v.pill}</div>
 <div class="a" style="left:16px;top:142px;width:180px;font-size:12px;color:#0b1f5c;line-height:1.25">${[1, 2, 3, 4].map((i) => `<div style="display:flex;gap:6px;margin-bottom:6px;border-bottom:1px dashed #b7c6e8;padding-bottom:4px"><div style="width:24px;height:24px;background:#1d4fd8;color:#fff;font-size:11px;flex:none;${pill}">●</div><div><b style="font-size:14px">${v["f" + i]}</b><br><span style="color:#556">${v["f" + i + "d"]}</span></div></div>`).join("")}</div>
 ${ico(w ? "3D 主体" : "3D 主体图<br>（数据库 / 电脑）", "left:204px;top:146px;width:142px;height:126px")}
 <div class="a" style="left:12px;top:288px;width:336px;height:40px;background:#1d4fd8;border-radius:10px 10px 0 0;display:flex;justify-content:space-around;align-items:center;color:#fff;font-size:12px;font-weight:700"><span>${v.b1}</span><span>${v.b2}</span><span>${v.b3}</span></div>
 <div class="a c t" style="left:12px;top:328px;width:336px;height:30px;background:#fde9a8;color:#0b1f5c;font-size:15px">${v.slogan}</div></div>`,
  F2: (v, w) => `<div class="b" style="background:radial-gradient(circle at 70% 10%,#2747c9,#08134a 70%)">
 <div class="a c" style="left:12px;top:12px;width:220px;height:26px;background:rgba(60,100,255,.6);border-radius:99px;color:#fff;font-size:12px;font-weight:700">${v.tag}</div>
 <div class="a t" style="left:12px;top:46px;width:228px;font-size:48px;color:#fff;text-shadow:0 0 12px rgba(120,170,255,.7)">${v.title}</div>
 ${ico(w ? "插画" : "笔记本 + 客服", "left:248px;top:12px;width:100px;height:84px;color:#cfe;border-color:#9bf")}
 <div class="a c" style="left:12px;top:108px;width:220px;height:26px;background:rgba(60,100,255,.6);border-radius:99px;color:#fff;font-size:12px;font-weight:700">${v.pill}</div>
 <div class="a c" style="left:240px;top:102px;width:108px;height:38px;background:#3f5ff0;border-radius:8px;color:#fff;font-size:12px;font-weight:700;text-align:center">${v.card}</div>
 <div class="a" style="left:12px;top:148px;width:336px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px">${[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<div style="background:#fff;border-radius:8px;height:62px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#111"><div class="ico" style="width:28px;height:22px;font-size:9px">图</div>${v["g" + i]}</div>`).join("")}</div>
 <div class="a" style="left:12px;top:292px;width:336px;height:56px;border:1px solid rgba(120,160,255,.6);border-radius:10px;display:flex;justify-content:space-around;align-items:center;color:#fff;font-size:12px;font-weight:700">${[1, 2, 3, 4].map((i) => `<span>● ${v["a" + i]}</span>`).join("")}</div></div>`,
  G: (v) => `<div class="b" style="background:linear-gradient(#eaf3ff,#fff)">
 <div class="a t" style="left:0;width:360px;top:18px;text-align:center;font-size:40px;color:#0b3d91">${v.title}</div>
 <div class="a" style="left:0;width:360px;top:70px;text-align:center;font-size:17px;font-weight:700;color:#444">${v.sub}</div>
 <div class="a" style="left:20px;top:106px;width:320px;display:grid;grid-template-columns:1fr 1fr;gap:12px">${[1, 2, 3, 4].map((i) => `<div style="background:#fff;border-radius:12px;height:76px;box-shadow:0 2px 6px rgba(0,0,0,.12);display:flex;align-items:center;gap:8px;padding:0 10px"><div style="width:34px;height:34px;background:#ff8a00;color:#fff;font-size:18px;flex:none;${pill}">${i}</div><b style="font-size:17px">${v["s" + i]}</b></div>`).join("")}</div>
 <div class="a" style="left:0;top:300px;width:360px;height:60px;background:#0b3d91"></div>
 <div class="a t" style="left:0;width:360px;top:316px;text-align:center;color:#fff;font-size:22px">${v.bar}</div></div>`,
  H: (v) => `<div class="b" style="background:radial-gradient(circle at 50% 45%,#2a2f6b,#0c0f2e)">
 <div class="a c" style="left:90px;top:18px;width:180px;height:28px;border:2px solid #39d0ff;border-radius:99px;color:#39d0ff;font-size:14px;font-weight:700">${v.tag}</div>
 <div class="a t" style="left:0;width:360px;top:60px;text-align:center;font-size:30px;color:#fff">${v.title}</div>
 <div class="a t" style="left:0;width:360px;top:104px;text-align:center;font-size:110px;color:#39d0ff;text-shadow:0 0 18px rgba(57,208,255,.6)">${v.big}</div>
 <div class="a" style="left:0;width:360px;top:236px;text-align:center;font-size:15px;font-weight:700;color:#cfe6ff">${v.sub}</div>
 <div class="a" style="left:0;top:296px;width:360px;height:64px;background:#ff8a00"></div>
 <div class="a t" style="left:0;width:360px;top:313px;text-align:center;color:#111;font-size:24px">${v.bar}</div></div>`,
};
const CSS = `body{margin:0;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif}.b{width:360px;height:360px;position:relative;overflow:hidden;white-space:nowrap}
.a{position:absolute}.c{display:flex;align-items:center;justify-content:center}.t{font-weight:900;line-height:1.05}
.ico{border:2px dashed #9aa4b2;border-radius:10px;color:#7b8594;font-size:12px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.45);text-align:center;white-space:normal}`;

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 360, height: 360 }, deviceScaleFactor: 2 });
const out = path.join(ROOT, "public/main/tpl");
fs.mkdirSync(out, { recursive: true });
for (const t of TPLS) {
  // 线框图里的字 = 格子名（去掉空格、括号），不比示例文字长，免得撑破版式
  const wire = Object.fromEntries(t.slots.map(([k, n]) => [k, [...n.replace(/（.*）/, "").replace(/\s+/g, "")].slice(0, Math.max(2, [...EX[t.id][k]].length)).join("")]));
  for (const [suffix, v, w] of [["", EX[t.id], false], ["-wire", wire, true]]) {
    // 线框图做成灰色：只看得出位置和大小，没有配色和设计感，出图 AI 就不会照着它的样子画（Lee 2026-10-27：成品和线框图一模一样，很平）
    const gray = w ? ".b{filter:grayscale(1) contrast(.75) brightness(1.08)}" : "";
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}${gray}</style></head><body>${H[t.id](v, w)}</body></html>`);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(out, `${t.id}${suffix}.png`), clip: { x: 0, y: 0, width: 360, height: 360 } });
  }
  console.log("ok", t.id);
}
await b.close();
