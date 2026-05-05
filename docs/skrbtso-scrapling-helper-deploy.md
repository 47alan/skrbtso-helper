# SkrBTSo Helper 服务器部署

这个文档对应仓库：

```text
https://github.com/47alan/skrbtso-helper
```

目标是在现有媒体栈里增加一个 `skrbtso-helper` 服务，并通过已有 Nginx 容器反代成 HTTPS 接口，供油猴脚本的“服务器服务”模式调用。

## 一键安装

在服务器执行：

```bash
curl -fsSL https://raw.githubusercontent.com/47alan/skrbtso-helper/main/tools/skrbtso-helper/install-server.sh \
  -o /tmp/install-skrbtso-helper.sh
sudo bash /tmp/install-skrbtso-helper.sh
```

如果已经克隆仓库：

```bash
cd /data/media-stack/skrbtso-helper-repo
sudo bash tools/skrbtso-helper/install-server.sh
```

脚本会询问：

- helper 域名，输入已经解析到服务器的域名；也可以粘贴 `https://<helper-domain>`，脚本会自动提取纯域名
- 媒体栈 Compose 路径，默认 `/data/media-stack/docker-compose.yml`
- Nginx 配置路径，默认 `/data/media-stack/nginx/conf.d/mediawarp.conf`
- Nginx 在 Compose 里的服务名，自动检测，常见为 `nginx` 或 `media-https-proxy`
- Nginx 容器内证书路径。脚本会优先从现有 `mediawarp.conf` 自动读取，读不到才需要手动输入。

GitHub 仓库地址和分支默认使用：

```text
https://github.com/47alan/skrbtso-helper.git
main
```

证书路径不会写死在仓库里，也不会提交到 GitHub。

## 脚本会修改什么

安装脚本会备份主 Compose，然后把 helper 服务插入到主文件的 `services:` 下：

```text
/data/media-stack/docker-compose.yml.bak.<时间戳>
/data/media-stack/docker-compose.yml
```

插入块带有标记，重复执行脚本时会先移除旧块再写入新块：

```yaml
# BEGIN SKRBTSO HELPER SERVICE
skrbtso-helper:
  ...
# END SKRBTSO HELPER SERVICE
```

脚本还会写入：

```text
/data/media-stack/skrbtso-helper.env
/data/media-stack/skrbtso-helper.install-info
```

`mediawarp.conf` 也会先备份，再追加反代配置：

```text
/data/media-stack/nginx/conf.d/mediawarp.conf.bak.<时间戳>
/data/media-stack/nginx/conf.d/mediawarp.conf
```

helper 容器默认只把端口绑定到服务器本机：

```text
127.0.0.1:8787:8787
```

如果 Nginx/HTTPS 反代服务使用自定义 Docker 网络，安装脚本会自动检测该网络，并把 `skrbtso-helper` 加入同一个网络，避免 Nginx 报 `host not found in upstream "skrbtso-helper"`。

公网访问走 Nginx HTTPS：

```text
https://<helper-domain>/skrbtso/search
```

## 默认抓取参数

当前默认参数按本地验证过的快速路径设置：优先复用 Scrapling 浏览器会话，先用结果页内的浏览器 `fetch` 抓详情，只有缺 magnet 时才打开详情弹窗兜底。

```text
SKRBTSO_HELPER_SEARCH_ORIGIN=https://skrbtso.top
SKRBTSO_HELPER_ALLOWED_SEARCH_HOSTS=skrbtso.top
SKRBTSO_HELPER_FORM_RESULT_WAIT=45
SKRBTSO_HELPER_DETAIL_WAIT=8
SKRBTSO_HELPER_KEEP_SESSION=1
SKRBTSO_HELPER_MAX_CONCURRENT=1
SKRBTSO_HELPER_DEFAULT_MAX_RESULTS=10
SKRBTSO_HELPER_MAX_RESULTS_LIMIT=20
SKRBTSO_HELPER_EXTRA_POPUP_CANDIDATES=2
SKRBTSO_HELPER_CACHE_TTL=21600
SKRBTSO_HELPER_RESULT_POLL_MS=500
```

`KEEP_SESSION=1` 时 helper 使用单线程持久浏览器会话，避免多个请求同时操作同一个浏览器上下文。重复查询会走内存缓存，默认缓存 6 小时。

安装脚本会在媒体栈目录创建持久浏览器资料目录，并挂载到容器内：

```text
/data/media-stack/skrbtso-browser
/data/.skrbtso-browser
```

需要调整时，可以改 `/data/media-stack/skrbtso-helper.env` 后重新执行：

```bash
cd /data/media-stack
docker compose up -d --build skrbtso-helper
```

## 通用部署覆盖项

一键安装脚本支持用环境变量覆盖默认值，适合不同服务器目录、服务名或端口：

```bash
APP_NAME=skrbtso-helper-prod \
HELPER_SERVICE=skrbtso-helper \
HELPER_IMAGE=local/skrbtso-scrapling-helper:latest \
HELPER_BIND_HOST=127.0.0.1 \
HELPER_PORT=8787 \
MEDIA_STACK_COMPOSE=/data/media-stack/docker-compose.yml \
MEDIAWARP_NGINX_CONF=/data/media-stack/nginx/conf.d/mediawarp.conf \
sudo -E bash tools/skrbtso-helper/install-server.sh
```

常用覆盖项：

```text
APP_NAME                         容器名，默认 skrbtso-scrapling-helper
HELPER_SERVICE                   Compose 服务名，默认 skrbtso-helper
HELPER_IMAGE                     镜像名，默认 local/skrbtso-scrapling-helper:latest
HELPER_BIND_HOST                 服务器本机绑定地址，默认 127.0.0.1
HELPER_PORT                      helper 端口，默认 8787
SKRBTSO_HELPER_SEARCH_ORIGIN     搜索源，默认 https://skrbtso.top
SKRBTSO_HELPER_ALLOWED_SEARCH_HOSTS 允许油猴传入的搜索 URL host，默认 skrbtso.top
SKRBTSO_HELPER_CORS_ORIGIN       CORS 允许来源，默认 *
```

## 浏览器脚本设置

更新并安装：

```text
userscripts/001-005-javdb-local-skrbtso-helper-test.user.js
```

不需要为服务器重新生成一份新脚本。打开任意支持页面，在面板里点 `抓取设置`，填：

```text
取消勾选“使用本机服务”
服务器服务地址：https://<helper-domain>/skrbtso/search
服务器 Bearer token：查看 /data/media-stack/skrbtso-helper.install-info 里的 token=
```

脚本会把 token 放在请求头里：

```text
Authorization: Bearer <token>
```

`115离线`、自动重命名、自动删除小文件全部仍在油猴脚本侧执行，使用当前浏览器的 115 登录态。服务器 helper 不保存 115 Cookie，不接收 115 账号密码，不处理扫码登录。

## 检查命令

服务器本机检查：

```bash
curl http://127.0.0.1:8787/health
TOKEN="$(awk -F= '/^token=/{print $2}' /data/media-stack/skrbtso-helper.install-info)"
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8787/skrbtso/search?q=JUR-070%20UC&max=3"
```

公网检查：

```bash
curl https://<helper-domain>/health
curl -H "Authorization: Bearer $TOKEN" \
  "https://<helper-domain>/skrbtso/search?q=JUR-070%20UC&max=3"
```

Compose 检查：

```bash
cd /data/media-stack
docker compose config
docker compose ps skrbtso-helper
docker logs --tail=100 skrbtso-scrapling-helper
```

## 回滚

安装信息保存在：

```text
/data/media-stack/skrbtso-helper.install-info
```

里面会记录：

```text
media_stack_compose_backup=...
nginx_backup=...
```

如果需要回滚，把对应备份复制回原路径，再重载服务：

```bash
cd /data/media-stack
cp /data/media-stack/docker-compose.yml.bak.<时间戳> /data/media-stack/docker-compose.yml
cp /data/media-stack/nginx/conf.d/mediawarp.conf.bak.<时间戳> /data/media-stack/nginx/conf.d/mediawarp.conf
docker compose up -d
docker compose exec -T nginx nginx -t
docker compose exec -T nginx nginx -s reload
```

如果你的 Nginx 服务名不是 `nginx`，把上面命令里的 `nginx` 换成实际服务名。

## 本地校验

改动后本地至少执行：

```powershell
node --check userscripts\001-005-javdb-local-skrbtso-helper-test.user.js
python -m py_compile tools\skrbtso_scrapling_helper.py
```
