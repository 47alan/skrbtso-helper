# SkrBTSo Helper

本仓库包含：

- `tools/skrbtso_scrapling_helper.py`：本机/服务器端 SkrBTSo 抓取 helper。
- `tools/skrbtso-helper/install-server.sh`：服务器一键安装脚本。
- `userscripts/001-005-javdb-local-skrbtso-helper-test.user.js`：Tampermonkey 磁力检索面板。

## 一键安装到服务器

服务器已安装 Docker，并且已有媒体栈反代时，直接执行：

```bash
curl -fsSL https://raw.githubusercontent.com/47alan/skrbtso-helper/main/tools/skrbtso-helper/install-server.sh \
  -o /tmp/install-skrbtso-helper.sh
sudo bash /tmp/install-skrbtso-helper.sh
```

脚本默认适配：

```text
/data/media-stack/skrbtso-helper-repo
/data/media-stack/docker-compose.yml
/data/media-stack/nginx/conf.d/mediawarp.conf
```

证书路径不会写死在仓库里。安装脚本会先从服务器现有 `mediawarp.conf` 自动读取 `ssl_certificate` 和 `ssl_certificate_key`；如果读不到，会在安装时提示你输入。

安装脚本会备份主 `docker-compose.yml`，然后把 `skrbtso-helper` 服务插入到主 Compose 的 `services:` 里；同时备份并追加 `mediawarp.conf` 的 HTTPS 反代块。

GitHub 仓库地址和分支默认直接使用本仓库的 `main`，安装时不会再要求确认。

安装时输入 helper 域名可以直接粘贴 `https://<你的 helper 域名>`，脚本会自动提取纯域名。

## 浏览器脚本设置

安装完成后查看：

```bash
cat /data/media-stack/skrbtso-helper.install-info
```

在 Tampermonkey 面板点 `抓取设置`，填入：

```text
抓取服务地址：https://<你的 helper 域名>/skrbtso/search
Bearer token：install-info 里的 token=
```

详情弹窗等待默认是 `12` 秒。完整部署说明见 [docs/skrbtso-scrapling-helper-deploy.md](docs/skrbtso-scrapling-helper-deploy.md)。
