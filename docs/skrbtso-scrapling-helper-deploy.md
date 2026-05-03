# SkrBTSo Helper 服务器部署

这个文档对应仓库：

```text
https://github.com/47alan/skrbtso-helper
```

目标是在你现有的媒体栈里增加一个 `skrbtso-helper` 服务，并通过已有 Nginx 容器反代成 HTTPS 接口。

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

- helper 域名，输入你已经解析到服务器的域名
- 安装目录，默认 `/data/media-stack/skrbtso-helper-repo`
- 媒体栈 Compose 路径，默认 `/data/media-stack/docker-compose.yml`
- Nginx 配置路径，默认 `/data/media-stack/nginx/conf.d/mediawarp.conf`
- Nginx 在 Compose 里的服务名，自动检测，默认 `nginx`
- Nginx 容器内证书路径

GitHub 仓库地址和分支不会询问，默认直接使用：

```text
https://github.com/47alan/skrbtso-helper.git
main
```

默认使用你的证书路径：

```nginx
ssl_certificate     /etc/nginx/certs/binanceforest.com.crt;
ssl_certificate_key /etc/nginx/certs/binanceforest.com.key;
```

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

Nginx 追加块标记：

```nginx
# BEGIN SKRBTSO HELPER
...
# END SKRBTSO HELPER
```

helper 容器只把端口绑定到服务器本机：

```text
127.0.0.1:8787:8787
```

公网访问走 Nginx HTTPS：

```text
https://<helper-domain>/skrbtso/search
```

## 默认抓取等待

详情弹窗等待时间默认是 12 秒：

```text
SKRBTSO_HELPER_DETAIL_WAIT=12
```

需要调整时，可以改 `/data/media-stack/skrbtso-helper.env` 后重新执行：

```bash
cd /data/media-stack
docker compose up -d --build skrbtso-helper
```

## 浏览器脚本设置

更新并安装：

```text
userscripts/001-005-javdb-local-skrbtso-helper-test.user.js
```

不需要为服务器重新生成一份新脚本。打开任意支持页面，在面板里点 `抓取设置`，填：

```text
抓取服务地址：https://<helper-domain>/skrbtso/search
Bearer token：查看 /data/media-stack/skrbtso-helper.install-info 里的 token=
```

脚本会把 token 放在请求头里：

```text
Authorization: Bearer <token>
```

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
