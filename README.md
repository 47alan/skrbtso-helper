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

安装脚本会备份主 `docker-compose.yml` 和 `mediawarp.conf`，把 `skrbtso-helper` 服务插入到主 Compose，并追加 HTTPS 反代块。证书路径会优先从现有 `mediawarp.conf` 读取，读不到才提示输入。

如果反代服务使用自定义 Docker 网络，安装脚本会把 `skrbtso-helper` 加入同一个网络，避免 Nginx 无法解析 upstream。安装时输入 helper 域名可以直接粘贴 `https://<你的 helper 域名>`，脚本会自动提取纯域名。

## 浏览器脚本设置

安装完成后查看：

```bash
cat /data/media-stack/skrbtso-helper.install-info
```

在 Tampermonkey 面板点 `抓取设置`：

```text
取消勾选“使用本机服务”
服务器服务地址：https://<你的 helper 域名>/skrbtso/search
服务器 Bearer token：install-info 里的 token=
```

服务器只负责磁力抓取。`115离线`、自动重命名、自动清理小文件仍由油猴脚本使用当前浏览器的 115 登录态执行；服务器不保存 115 Cookie，也不处理 115 扫码登录。

当前默认启用持久 Scrapling 浏览器会话，搜索结果等待 `45` 秒、详情兜底弹窗等待 `8` 秒、并发 `1`，并会把浏览器资料目录挂载到 `/data/.skrbtso-browser` 复用验证状态。完整部署说明见 [docs/skrbtso-scrapling-helper-deploy.md](docs/skrbtso-scrapling-helper-deploy.md)。
