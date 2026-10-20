# AI图图 工作台（网页版）

一个人用的网页工作台：**竞品分析报告** + **详情页（一键全自动 / 手动 7 步）**。
服务器放在局域网里（家里、公司各放一台，互不相干），浏览器打开网页操作，浏览器插件当“工人”：

| 插件 | 干什么 |
| --- | --- |
| AI图图（0.8.0 起） | 用 Gemini / Copilot 网页版：写文字、看图、画图（画背景、抠图） |
| ai-web | 用 DeepSeek / 智谱 / Kimi / 通义 / 豆包：只写文字 |
| 淘宝采集（0.7.0 起） | 按链接自动采集商品、评价、问大家 |

插件在“设置 → 连接工作台”里填：工作台的 IP、端口（默认 8766）、插件口令（工作台“AI 连接”页面上能看到）。
一个插件同时只连一个工作台。

## 部署（OpenWrt 上的 Docker：ubuntu 22.04）

实际部署过的环境：OpenWrt（x86_64）上的 docker 容器 `ubuntu22`（bridge 网络，容器 IP 172.17.0.2，只映射了 3000 端口），
容器里用普通用户 `claudeuser`，已经装好 Node 22、pm2、git、build-essential、python3（同一个容器里还跑着 ai-dkqg、claude-webui）。

### 1. 拉代码（容器里，claudeuser）

```bash
cd ~ && git clone --depth 1 https://github.com/userfucker/ai-tutu.git
```

GitHub 拉不下来：在电脑上下载仓库 zip，传进容器解压成 `~/ai-tutu`。

### 2. 装依赖（容器里）

```bash
cd ~/ai-tutu/web
npm config set registry https://registry.npmmirror.com
npm_config_better_sqlite3_binary_host=https://registry.npmmirror.com/-/binary/better-sqlite3 npm install
```

最后没有红色 `ERR!` 就是装好了（黄色 `WARN` 不要紧）。字体在仓库里（`web/fonts`），不用另外装。

### 3. 启动并保存（容器里）

```bash
cd ~/ai-tutu/web
pm2 start server/index.js --name aitutu-web
pm2 save
pm2 logs aitutu-web --lines 20      # 看到“插件口令 xxxxxxxx”就是启动好了，Ctrl+C 退出
curl -s http://127.0.0.1:8766/api/auth/state    # 返回一行 JSON 就正常
```

数据在 `~/ai-tutu/web/data`（数据库、图片、导出的 zip）。端口默认 8766。

### 4. 端口转发（OpenWrt 上，root）

```bash
IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ubuntu22); echo $IP
socat TCP-LISTEN:8766,fork,reuseaddr TCP:$IP:8766 &
curl -s http://127.0.0.1:8766/api/auth/state    # 返回 {"setup":false,...} 就通了
```

### 5. 开机自动启动（OpenWrt 上）

`/etc/rc.local` 的内容（8765 是 ai-dkqg 用的转发，一起写进来）：

```sh
#!/bin/sh
# Put your custom commands here that should be executed once
# the system init finished.
ntfs-3g /dev/sdb5 /mnt/sdb5 &

# AI图图 工作台：等 docker 起来 → 启动工作台 → 转发 8766 端口
(
  sleep 30
  docker start ubuntu22
  sleep 5
  docker exec -d -u claudeuser ubuntu22 bash -lic "pm2 resurrect"
  IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ubuntu22)
  socat TCP-LISTEN:8766,fork,reuseaddr TCP:$IP:8766 &
  socat TCP-LISTEN:8765,fork,reuseaddr TCP:$IP:8765 &
) &

exit 0
```

`pm2 resurrect` 恢复的是最近一次 `pm2 save` 时的列表，所以 pm2 里加了、删了服务以后都要再 `pm2 save` 一次。

检查（重启路由器 1 分钟后，在 OpenWrt 上）：

```bash
docker exec -u claudeuser ubuntu22 bash -lic "pm2 ls"    # ai-dkqg、aitutu-web、claude-webui 都是 online
ps | grep socat                                          # 8765、8766 都在
```

（`bash: cannot set terminal process group`、`no job control in this shell` 这两行提示不影响。）

### 6. 打开网页、连插件

1. 电脑浏览器打开 `http://<路由器 IP>:8766`，第一次进去设置管理员密码。
2. 左边“AI 连接”里看插件口令。
3. AI图图（0.8.0 起）、淘宝采集（0.7.0 起）、ai-web 在各自的选项里填：**路由器 IP**、端口 `8766`、口令。
   ai-web 一次只能连一个服务器：连工作台时 ai-dkqg 会议用不了，开会时改回去。

### 7. 更新（容器里）

```bash
cd ~/ai-tutu && git pull && cd web && npm install && pm2 restart aitutu-web
```

正在做的竞品分析、详情页全自动，重启后会接着做。

### 出问题时

| 现象 | 看什么 |
| --- | --- |
| 网页打不开 | OpenWrt 上 `ps \| grep socat` 有没有 8766；容器里 `pm2 ls` 里 aitutu-web 是不是 online |
| aitutu-web 不是 online | 容器里 `pm2 logs aitutu-web --lines 50`，把报错发出来 |
| 重启后容器 IP 变了 | rc.local 每次开机都重新查 IP，不用管；手动转发时用 `echo $IP` 看一下 |

## 详情页怎么用

- **一键全自动**：详情页 → “⚡ 一键全自动新建”，把淘宝采集插件导出的 zip（或者装产品图的文件夹）拖进去，可以一次拖多个。
  服务器依次做：识别素材 → 抠图 → 卖点 → 参考图分析 → 提纲和文案 → 背景 → AI 检查背景 → 翻译 → 检查违禁词并改写 → 导出 zip。
  关掉浏览器也不停。做完显示“等你审核”：打开逐屏看、手动改，点“审核通过”按改过的内容重新导出，下载 zip。
- **手动**：和以前插件里的 7 步一样（新建 → 素材 → 产品信息 → 参考详情图 → 提纲 → 生成和编辑 → 检查和导出），AI 任务也交给工作台排队。
- 所有 AI 任务都能在“任务中心”里看到、取消、重试。

## 开发

```bash
cd web
npm start              # 本机启动，http://127.0.0.1:8766
npm test               # 服务器测试（假插件）：竞品分析、详情页全自动
node ../tests/workbench/e2e-detail.mjs    # 浏览器测试：详情页网页
node ../tests/workbench/e2e-aitutu.mjs    # 浏览器测试：AI图图 插件连工作台
```

代码结构：`server/`（Hono + SQLite + WebSocket；`analysis/` 竞品分析，`detail/` 详情页：存储、全自动、zip 导入、服务器上运行排版代码），
`public/`（工作台网页），`public/detail/`（详情页网页；`core/` 排版核心，网页和服务器共用）。
