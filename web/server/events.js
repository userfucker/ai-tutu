// 实时推送（SSE）：插件状态、任务变化、分析进度、项目变化
const clients = new Set();

export function addClient(send) {
  clients.add(send);
  return () => clients.delete(send);
}
export function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const send of clients) {
    try { send(msg); } catch { clients.delete(send); }
  }
}
