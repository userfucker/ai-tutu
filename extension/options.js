// AI图图 选项：连接工作台
const $ = (id) => document.getElementById(id);
function show(st) {
  const map = { on: ["已连接", "on"], connecting: ["正在连接…", ""], off: ["没连接", ""], error: ["连接失败", "bad"] };
  const [t, c] = map[st && st.state] || ["没连接", ""];
  $("state").textContent = t + (st && st.error ? "：" + st.error : "");
  $("state").className = c;
}
chrome.storage.local.get(["aitutu_wb", "aitutu_wb_state"], (v) => {
  const c = v.aitutu_wb || {};
  $("on").checked = !!c.enabled;
  $("host").value = c.host || "";
  $("port").value = c.port || 8766;
  $("token").value = c.token || "";
  $("name").value = c.name || "";
  show(v.aitutu_wb_state);
});
chrome.storage.onChanged.addListener((ch) => { if (ch.aitutu_wb_state) show(ch.aitutu_wb_state.newValue); });
const read = () => ({ enabled: $("on").checked, host: $("host").value.trim(), port: +$("port").value || 8766, token: $("token").value.trim(), name: $("name").value.trim() });
$("save").addEventListener("click", () => { const c = read(); c.enabled = c.enabled || !!(c.host && c.token); $("on").checked = c.enabled; chrome.storage.local.set({ aitutu_wb: c }); });
$("on").addEventListener("change", () => chrome.storage.local.set({ aitutu_wb: read() }));
$("test").addEventListener("click", () => {
  $("state").textContent = "测试中…";
  chrome.runtime.sendMessage({ type: "aitutu-wb-test", ...read() }, (r) => {
    $("state").textContent = r && r.ok ? `能连上（${r.server}）` : (r && r.error) || "没有回复";
    $("state").className = r && r.ok ? "on" : "bad";
  });
});
