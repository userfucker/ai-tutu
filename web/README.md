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

下面的命令在 **ubuntu 容器里** 执行（`docker exec -it <容器名> bash`）。

### 1. 装 Node.js 22 和 pm2

```bash
apt update && apt install -y curl git ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g pm2
node -v   # v22.x
```

### 2. 拉代码、装依赖

```bash
cd /opt
git clone https://github.com/userfucker/ai-tutu.git
cd ai-tutu/web
npm install            # 会下载 better-sqlite3、@napi-rs/canvas 的预编译文件（x86_64 Linux 有现成的）
```

字体（`web/fonts`，约 29 MB）已经在仓库里，不用另外装。

### 3. 启动（开机自动启动）

```bash
cd /opt/ai-tutu/web
pm2 start server/index.js --name aitutu-web
pm2 save
pm2 startup            # 按它打印的提示执行一行命令
pm2 logs aitutu-web    # 看日志：会打印网页地址和“插件口令”
```

数据放在 `web/data`（数据库、图片、导出的 zip）。想放别处：`DATA_DIR=/data/aitutu pm2 start server/index.js --name aitutu-web`。
端口默认 8766，改端口用环境变量 `PORT`。

### 4. 让局域网能访问（端口转发）

容器是 bridge 网络、只映射了 3000 端口时，和 ai-dkqg 一样在 **OpenWrt 上** 用 socat 转发：

```bash
# 查容器 IP
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' <容器名>
# 转发（把 172.17.0.2 换成上面查到的 IP）
opkg update && opkg install socat
socat TCP-LISTEN:8766,fork,reuseaddr TCP:172.17.0.2:8766 &
```

开机自动转发：把上面那行 socat 加到 OpenWrt 的 `/etc/rc.local`（`exit 0` 之前）。
如果防火墙拦了，在 OpenWrt 防火墙里放行 LAN → 8766。

然后在电脑浏览器打开 `http://<OpenWrt 的 IP>:8766`，第一次进去设置管理员密码。

### 5. 更新

```bash
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
