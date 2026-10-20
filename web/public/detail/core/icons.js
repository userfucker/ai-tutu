/**
 * 详情页工作室 · 图标（用画布直接画，不依赖图片文件）。
 * 每个图标画在 0～1 的正方形里，调用时按大小缩放。
 */
var ST = globalThis.ST || (globalThis.ST = {});

ST.ICONS = {
  check: "对勾", shield: "盾牌/保障", truck: "货车/发货", refresh: "退换", headset: "客服", star: "星星/好评",
  box: "包装盒", clock: "时间", heart: "爱心", leaf: "环保/天然", drop: "防水", bolt: "快充/动力",
  gift: "礼物", ruler: "尺寸", sparkle: "亮点", lock: "安全", battery: "电池/续航", sun: "阳光/户外", thumb: "点赞",
};

ST.drawIcon = (g, name, x, y, s, color) => {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 0.08;
  g.lineCap = "round";
  g.lineJoin = "round";
  const P = (pts, close) => { g.beginPath(); pts.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b))); if (close) g.closePath(); };
  switch (name) {
    case "check": P([[0.2, 0.52], [0.42, 0.72], [0.8, 0.3]]); g.stroke(); break;
    case "cross": P([[0.25, 0.25], [0.75, 0.75]]); g.stroke(); P([[0.75, 0.25], [0.25, 0.75]]); g.stroke(); break;
    case "shield":
      P([[0.5, 0.1], [0.82, 0.22], [0.8, 0.52], [0.5, 0.9], [0.2, 0.52], [0.18, 0.22]], true); g.stroke();
      P([[0.36, 0.5], [0.47, 0.61], [0.66, 0.4]]); g.stroke(); break;
    case "truck":
      g.strokeRect(0.08, 0.3, 0.5, 0.36); P([[0.58, 0.4], [0.76, 0.4], [0.9, 0.54], [0.9, 0.66], [0.58, 0.66]], true); g.stroke();
      g.beginPath(); g.arc(0.25, 0.72, 0.08, 0, 7); g.fill(); g.beginPath(); g.arc(0.74, 0.72, 0.08, 0, 7); g.fill(); break;
    case "refresh":
      g.beginPath(); g.arc(0.5, 0.5, 0.3, -0.3, Math.PI * 1.5); g.stroke();
      P([[0.5, 0.08], [0.62, 0.2], [0.5, 0.32]]); g.stroke(); break;
    case "headset":
      g.beginPath(); g.arc(0.5, 0.52, 0.32, Math.PI, 0); g.stroke();
      g.fillRect(0.14, 0.5, 0.14, 0.24); g.fillRect(0.72, 0.5, 0.14, 0.24);
      P([[0.79, 0.74], [0.79, 0.84], [0.58, 0.86]]); g.stroke(); break;
    case "star": {
      g.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.18 : 0.42, a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(0.5 + r * Math.cos(a), 0.53 + r * Math.sin(a)); }
      g.closePath(); g.fill(); break;
    }
    case "box":
      P([[0.5, 0.12], [0.86, 0.3], [0.86, 0.72], [0.5, 0.9], [0.14, 0.72], [0.14, 0.3]], true); g.stroke();
      P([[0.14, 0.3], [0.5, 0.48], [0.86, 0.3]]); g.stroke(); P([[0.5, 0.48], [0.5, 0.9]]); g.stroke(); break;
    case "clock":
      g.beginPath(); g.arc(0.5, 0.5, 0.36, 0, 7); g.stroke(); P([[0.5, 0.28], [0.5, 0.5], [0.66, 0.6]]); g.stroke(); break;
    case "heart":
      g.beginPath(); g.moveTo(0.5, 0.84);
      g.bezierCurveTo(0.1, 0.56, 0.12, 0.2, 0.32, 0.2); g.bezierCurveTo(0.42, 0.2, 0.48, 0.28, 0.5, 0.34);
      g.bezierCurveTo(0.52, 0.28, 0.58, 0.2, 0.68, 0.2); g.bezierCurveTo(0.88, 0.2, 0.9, 0.56, 0.5, 0.84); g.fill(); break;
    case "leaf":
      g.beginPath(); g.moveTo(0.18, 0.82); g.quadraticCurveTo(0.12, 0.2, 0.84, 0.16); g.quadraticCurveTo(0.84, 0.82, 0.18, 0.82); g.stroke();
      P([[0.2, 0.8], [0.62, 0.38]]); g.stroke(); break;
    case "drop":
      g.beginPath(); g.moveTo(0.5, 0.1); g.bezierCurveTo(0.5, 0.1, 0.2, 0.46, 0.2, 0.62); g.arc(0.5, 0.62, 0.3, Math.PI, 0, true);
      g.bezierCurveTo(0.8, 0.46, 0.5, 0.1, 0.5, 0.1); g.fill(); break;
    case "bolt": P([[0.58, 0.08], [0.24, 0.56], [0.48, 0.56], [0.4, 0.92], [0.76, 0.42], [0.52, 0.42]], true); g.fill(); break;
    case "gift":
      g.strokeRect(0.16, 0.42, 0.68, 0.44); g.strokeRect(0.1, 0.3, 0.8, 0.14); P([[0.5, 0.3], [0.5, 0.86]]); g.stroke();
      g.beginPath(); g.ellipse(0.38, 0.22, 0.12, 0.08, 0, 0, 7); g.stroke(); g.beginPath(); g.ellipse(0.62, 0.22, 0.12, 0.08, 0, 0, 7); g.stroke(); break;
    case "ruler":
      g.save(); g.translate(0.5, 0.5); g.rotate(-Math.PI / 4); g.strokeRect(-0.42, -0.14, 0.84, 0.28);
      for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(i * 0.11, -0.14); g.lineTo(i * 0.11, i % 2 ? -0.02 : 0.04); g.stroke(); }
      g.restore(); break;
    case "sparkle": {
      const sp = (cx, cy, r) => { g.beginPath(); g.moveTo(cx, cy - r); g.quadraticCurveTo(cx, cy, cx + r, cy); g.quadraticCurveTo(cx, cy, cx, cy + r); g.quadraticCurveTo(cx, cy, cx - r, cy); g.quadraticCurveTo(cx, cy, cx, cy - r); g.fill(); };
      sp(0.42, 0.55, 0.32); sp(0.76, 0.24, 0.14); break;
    }
    case "lock":
      g.strokeRect(0.2, 0.44, 0.6, 0.44); g.beginPath(); g.arc(0.5, 0.44, 0.2, Math.PI, 0); g.stroke();
      g.beginPath(); g.arc(0.5, 0.64, 0.06, 0, 7); g.fill(); break;
    case "battery":
      g.strokeRect(0.1, 0.3, 0.72, 0.4); g.fillRect(0.82, 0.42, 0.08, 0.16); g.fillRect(0.17, 0.37, 0.4, 0.26); break;
    case "sun":
      g.beginPath(); g.arc(0.5, 0.5, 0.18, 0, 7); g.fill();
      for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; P([[0.5 + 0.28 * Math.cos(a), 0.5 + 0.28 * Math.sin(a)], [0.5 + 0.4 * Math.cos(a), 0.5 + 0.4 * Math.sin(a)]]); g.stroke(); }
      break;
    case "thumb":
      g.fillRect(0.12, 0.46, 0.16, 0.4);
      P([[0.34, 0.46], [0.5, 0.14], [0.6, 0.18], [0.56, 0.42], [0.84, 0.42], [0.86, 0.52], [0.76, 0.86], [0.34, 0.86]], true); g.fill(); break;
    default: g.beginPath(); g.arc(0.5, 0.5, 0.2, 0, 7); g.fill();
  }
  g.restore();
};
