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

## 部署（OpenWrt 上的 Docker：ubuntu 22.04，x86_64）

分两边做：**ubuntu 容器里**装和运行工作台；**OpenWrt 上**做端口转发和开机启动。

### 1. 进容器（在 OpenWrt 上）

```bash
docker ps                          # 找到 ubuntu22 那个容器的名字，下面用 <容器名> 代替
docker exec -it <容器名> bash
```

### 2. 装 Node.js 22、编译工具、pm2（在容器里）

```bash
apt update && apt install -y curl git ca-certificates xz-utils build-essential python3
# Node 22（用国内镜像下载）
cd /opt && curl -fLO https://registry.npmmirror.com/-/binary/node/v22.11.0/node-v22.11.0-linux-x64.tar.xz
tar -xJf node-v22.11.0-linux-x64.tar.xz && ln -sf /opt/node-v22.11.0-linux-x64/bin/* /usr/local/bin/
node -v                            # 显示 v22.11.0 就对了
npm config set registry https://registry.npmmirror.com
npm install -g pm2 && ln -sf /opt/node-v22.11.0-linux-x64/bin/pm2 /usr/local/bin/pm2
```

### 3. 拉代码、装依赖（在容器里）

```bash
cd /opt && git clone --depth 1 https://github.com/userfucker/ai-tutu.git
cd /opt/ai-tutu/web
npm_config_better_sqlite3_binary_host=https://registry.npmmirror.com/-/binary/better-sqlite3 npm install
```

GitHub 拉不下来：在电脑上从 GitHub 下载仓库 zip，传到容器里解压到 `/opt/ai-tutu`。
`npm install` 下载 better-sqlite3 预编译文件失败时会自己编译（上面装了 build-essential、python3，多等几分钟）。
字体（`web/fonts`，约 29 MB）在仓库里，不用另外装。

### 4. 启动（在容器里）

```bash
cd /opt/ai-tutu/web
pm2 start server/index.js --name aitutu-web
pm2 save                           # 记住，容器重启后用 pm2 resurrect 恢复
pm2 logs aitutu-web --lines 20     # 看到“插件口令 xxxxxxxx”就是启动好了，Ctrl+C 退出看日志
```

数据在 `web/data`（数据库、图片、导出的 zip）。端口默认 8766（环境变量 `PORT` 可以改）。

### 5. 端口转发 + 开机启动（在 OpenWrt 上）

容器是 bridge 网络、只映射了 3000 端口，所以和 ai-dkqg 一样在 OpenWrt 上用 socat 转发 8766：

```bash
opkg update && opkg install socat
```

编辑 `/etc/rc.local`，在 `exit 0` 前面加（把 `<容器名>` 换成你的）：

```sh
(
  sleep 30
  docker exec -d <容器名> pm2 resurrect
  IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' <容器名>)
  socat TCP-LISTEN:8766,fork,reuseaddr TCP:$IP:8766 &
) &
```

第一次不用重启路由器，直接执行一遍：

```bash
IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' <容器名>); echo $IP
socat TCP-LISTEN:8766,fork,reuseaddr TCP:$IP:8766 &
```

电脑浏览器打开 `http://<路由器 IP>:8766`，第一次进去设置管理员密码。打不开就在 OpenWrt 防火墙里放行 LAN 访问 8766。

### 6. 连插件

工作台左边“AI 连接”里有 IP、端口、口令。IP 填 **路由器的 IP**，端口 8766。
AI图图、淘宝采集、ai-web 三个插件在各自的选项里填上，连上后“AI 连接”页面会显示出来。

### 7. 更新

```bash
docker exec -it <容器名> bash
cd /opt/ai-tutu && git pull && cd web && npm install && pm2 restart aitutu-web
```

正在做的竞品分析、详情页全自动，重启后会接着做。

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
