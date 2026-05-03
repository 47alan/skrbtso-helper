# SkrBTSo 搜索与 Magnet 提取流程记录

本文记录当前已验证可用的 `skrbtso.top` 检索流程，避免后续在油猴脚本或 helper 改造时回到错误路径。

## 目标

输入类似：

```text
JUR-070 UC
```

最终拿到搜索结果前几条对应详情页里的完整 `magnet:?xt=urn:btih...`，并保留结果标题与原始番号的对比信息，防止混入不相关番号。

## 已验证的正确流程

1. 打开 `https://skrbtso.top/` 首页。
2. 在首页搜索框输入原始查询词，例如 `JUR-070 UC`。
3. 提交搜索表单。
4. 搜索结果页会出现二次 Cloudflare/安全校验。
5. 不要立刻解析页面，等待约 `10-20 秒`。
6. 直到页面出现真实搜索结果，例如包含：

```text
找到约 ... 条结果
```

7. 搜索结果页上看到的“磁力链接”不是最终 magnet，而是详情页入口。
8. 详情入口通常形如：

```text
/detail/xxxxx/yyyyyyyyyyyyyyyyyyyyyyyy
```

9. 不要直接后台请求详情 URL。直接请求经常会跳回首页，导致解析不到 magnet。
10. 必须在同一个浏览器会话里点击搜索结果里的详情链接。
11. 详情链接通常带 `target="_blank"`，点击后会弹出新页面。
12. 在弹出的详情页中，正文里才会出现完整 magnet。
13. 对搜索页前几条结果重复点击详情页，分别提取 magnet。

## 为什么不能直接抓详情 URL

当前验证结果：

- 普通 HTTP 请求搜索页会遇到 `403` 或空正文。
- `StealthyFetcher` 可以进入首页。
- 直接请求 `/search?...` 或 `/detail/...` 不稳定，可能被重定向到首页或安全校验页。
- 搜索页提交后等待二次校验可以进入真实结果页。
- 详情页必须通过搜索页中的链接点击打开 popup，才能稳定看到 magnet。

因此，关键不是“拼 URL 请求详情页”，而是“浏览器会话内点击详情链接”。

## 需要保留的对比信息

搜索结果可能混入其他番号。例如查询 `JUR-070 UC` 时，页面可能出现：

```text
JUR-070
JUR-380-UC
JUR-049-UC
```

所以每条 magnet 不能只保存链接，还要保存：

```text
原始搜索：JUR-070 UC
原始番号：JUR-070
搜索结果标题：JUR-070
结果番号：JUR-070
是否匹配：匹配
magnet:...
```

如果结果标题是 `JUR-380-UC`，则应输出：

```text
原始搜索：JUR-070 UC
原始番号：JUR-070
搜索结果标题：JUR-380-UC
结果番号：JUR-380
是否匹配：不匹配
magnet:...
```

后续可以根据这个状态决定是否跳过不匹配结果，或在 UI 中高亮提示。

## 当前本地验证样例

查询：

```text
JUR-070 UC
```

本地已生成过两类输出：

```text
outputs/skrbtso_JUR-070_UC_magnets_only_20260503_182502.txt
outputs/skrbtso_JUR-070_UC_magnet_compare_20260503_183009.txt
```

其中 `magnet_compare` 版本更适合作为后续格式参考，因为它包含：

- 原始搜索词
- 原始番号
- 搜索结果标题
- 结果番号
- 匹配状态
- 完整 magnet

## 油猴脚本中的处理方式

油猴脚本不应直接完成完整抓取流程。

推荐架构：

1. 油猴脚本提取 JavDB 页面番号。
2. 油猴脚本拼出查询词，例如 `JUR-070 UC`。
3. 油猴脚本调用本地或远程 helper：

```text
http://127.0.0.1:8787/skrbtso/search?q=JUR-070%20UC&max=3
```

4. helper 使用 Scrapling/浏览器环境执行：

```text
打开首页 -> 填搜索框 -> 等二次校验 -> 点击前几条详情 popup -> 解析 magnet -> 计算匹配状态
```

5. helper 返回 JSON 给油猴脚本。
6. 油猴脚本只负责展示、复制、导出、提交 115。

## 本机测试落地方式

当前本机测试分两部分：

```text
tools/skrbtso_scrapling_helper.py
userscripts/001-005-javdb-local-skrbtso-helper-test.user.js
```

先在本机启动 helper：

```powershell
python tools\skrbtso_scrapling_helper.py
```

默认接口：

```text
http://127.0.0.1:8787/skrbtso/search?q=JUR-070%20UC&max=3
```

油猴脚本安装 `userscripts/001-005-javdb-local-skrbtso-helper-test.user.js` 后，在 JavDB 页面点击“本机检索”。脚本会：

1. 从 JavDB 页面提取番号。
2. 拼出 `番号 + UC`，例如 `JUR-070 UC`。
3. 调用本机 helper。
4. 显示前 3 条 magnet。
5. 同时显示“原始番号 / 结果番号 / 匹配状态”。
6. 支持复制纯 magnet、复制对比结果、导出对比 TXT。

### 二次 Cloudflare 处理

当前 helper 已按这个方式处理二次验证：

1. 首页打开时先不强制认为一定有 Cloudflare challenge。
2. 提交搜索表单后，检查结果页是否进入 `Performing security verification`。
3. 如果进入验证页，就在同一个浏览器会话里再次触发 Scrapling 的 Cloudflare solver。
4. 验证通过后再等待真实结果页。
5. 真实结果页出现后才点击前几条详情 popup。

如果本机 headless 模式后续再次不稳定，可以临时用可见浏览器启动：

```powershell
$env:SKRBTSO_HELPER_HEADLESS='0'
python tools\skrbtso_scrapling_helper.py
```

也可以指定持久浏览器目录，复用 Cloudflare 通过后的状态：

```powershell
$env:SKRBTSO_HELPER_USER_DATA_DIR='D:\PY_program\115emby\.skrbtso-browser'
python tools\skrbtso_scrapling_helper.py
```

### 当前验证结果

2026-05-03 本机接口验证：

```text
http://127.0.0.1:8787/skrbtso/search?q=JUR-070%20UC&max=3
```

返回 3 条结果，标题均为 `JUR-070`，`queryCode/resultCode/titleMatched` 均可用，3 条均包含完整 magnet。

## Helper 返回结果建议字段

每条结果建议包含：

```json
{
  "title": "JUR-070",
  "query": "JUR-070 UC",
  "queryCode": "JUR-070",
  "resultCode": "JUR-070",
  "titleMatched": true,
  "detailUrl": "https://skrbtso.top/detail/...",
  "source": "https://skrbtso.top/detail/...",
  "magnet": "magnet:?xt=urn:btih:..."
}
```

如果混入结果：

```json
{
  "title": "JUR-380-UC",
  "query": "JUR-070 UC",
  "queryCode": "JUR-070",
  "resultCode": "JUR-380",
  "titleMatched": false,
  "magnet": "magnet:?xt=urn:btih:..."
}
```

## 后续改造注意事项

- 不要把搜索页 HTML 当作最终结果，搜索页通常没有完整 magnet。
- 不要直接请求详情页 URL 作为主要路径。
- 必须等待搜索页二次校验完成。
- 必须通过搜索结果页点击详情链接，并处理 popup。
- 输出或 UI 中必须显示匹配状态。
- 如果只需要高可信结果，可以只保留 `titleMatched === true` 的结果。
- 如果需要人工复核，可以保留不匹配结果，但必须标注清楚。
