# 本地 Suno Controller / API Recorder

Node.js 单进程 + 原生浏览器页面 + 一个依赖 ws，无数据库或前端框架。已通过真实 controller 重播、读回和官方页面确认默认空工程创建及工程元数据读取，见 `docs/STUDIO_API_MAP.md`。`StudioClient.create_project()` 当前只支持 Untitled Project、major_version=2；`get_project_metadata(id)` 只返回工程信息。完整 timeline、素材、clip、保存与导出仍未识别，相关操作均抛 `NotImplementedError`，完整素材→timeline→保存 MVP 尚未完成。

## 架构与安装

`SunoBridge.call → localhost HTTP → WebSocket → Browser page → CustomEvent → Tampermonkey GM request → Suno → 原路返回`

官方页面 recorder 独立观察 fetch/XHR，在浏览器先脱敏，以 GM 请求发送给 capture ingress；后端再脱敏。记录来源不经过 auth 传输的业务实现。详见 [CURRENT_ARCHITECTURE.md](CURRENT_ARCHITECTURE.md)。

要求 Node.js 22+，浏览器已安装 Tampermonkey，Suno 官方账号已登录。

```powershell
cd G:\Suno
npm ci --ignore-scripts
npm run build:userscript
npm run build:reference-recorder
npm start
```

1. 打开启动终端给出的 `http://127.0.0.1:3000/#<临时配对码>`。fragment 读取后从地址栏移除。该配对码是本地 controller capability，不是 Suno JWT。只保存在进程内存、浏览器 sessionStorage 和 Tampermonkey 的本地 recorder config；重启后自动失效，不提交或分享终端启动 URL。
2. 在本地页点击“安装本地 transport + recorder”。这是保留原文件后生成的本地适配版本。暂时禁用旧同步助手，避免重复 hook/旧工作台认证上传；安装后刷新 Suno 和本地页。若 Tampermonkey 要求浏览器允许 userscript，请在扩展官方说明指导下由用户开启。
3. 本地页显示 Browser bridge 在线、Suno auth ready。auth ready 表示 Tampermonkey 持有尚有效且由原逻辑验证过的缓存，实际 API 的 401 会使其失效；heartbeat 在线不等于 auth ready。未 ready 时保持已登录 Suno 页打开，点“刷新 Suno 登录状态”。本地 URL 必须使用 127.0.0.1，localhost Host 会被拒绝。
4. 点“只读 round-trip 验证”，仅请求原脚本已有的 `/api/session/`。响应只显示状态和 requestId，不保存 session body。

`SUNO_PORT` 可设 3001/3002（生成脚本 match 的范围）；别用公开网络地址绑定。HTTP/WS 在本机 loopback。仅同源 bridge 可连接 WebSocket，需临时 key；一个 controller 同时只接受一个 browser bridge。未完成写请求断线/超时/取消时远端结果可能未知，不自动重试。

## 开始 capture 与逐个识别

1. 官方页面只保留一个 Studio 标签页，打开 `https://suno.com/studio`，从工程列表状态开始。不要点创建按钮。DevTools 无需打开。
2. 在本地页输入标记（第一轮 `create-empty-project`），点“开始新 capture”，等待官方 recorder active，未完成请求=0、队列=0、丢失=0。官方页 recorder 只在 `/studio` 或其子路径观察 `studio-api-prod.suno.com`。
3. **只创建一个空工程**。完成后告知已创建以及可见的工程名称，先不要添加素材或编辑。
4. 等未完成请求和队列归零后停止 capture。检查 `captures/<session>/001-request.json`、`001-response.json` 与 `summary.md`。序号按完成响应的接收顺序，timestamp 是请求开始时刻，配对 eventId 相同；durationMs 是 fetch headers 到达或 XHR loadend 的时间，bodyObservationMs 单列观察耗时。
5. 比较请求时间、body、响应 ID 和前后状态，记录候选到 `docs/STUDIO_API_MAP.md`；必要时重复一个动作。重播写 API 前明确实际会发生的动作及对象。未成功复现和读回验证前不能标 VERIFIED，也不能填入 `VERIFIED_ENDPOINTS`。

晚到响应保留请求开始时的 session，停止后接收宽限 120 秒。若 pending/queue/dropped 非零、有 ingress 错误或 body omitted，不能声称 capture 完整。新会话不会清除旧日志；不提供破坏性清空操作。文件夹与记录 timestamp 使用 UTC，报告人类日期使用 Asia/Shanghai。

**实测限制：** Studio 首次加载密集请求可填满 100 项队列，本轮加载 baseline 丢失 8 项，不能作为完整操作证据。先在 capture 关闭时让页面加载完成，再开始单动作记录；丢失计数属于当前官方文档生命周期，重新进入/刷新官方页才能重置。不能仅开一个新 session 就把已有 dropped 当作零。当前账号官方 UI 显示 `Preview / Upgrade to edit`；首次创建若被阻止，需由用户确认账号权限，不绕过限制或自动购买。

Recorder 记录 JavaScript 可见 headers，浏览器自动附加的 cookie/禁止读取的 set-cookie 不保证可见；可见时一律掩码。未覆盖 Worker、iframe、WebSocket、SSE 业务数据、sendBeacon、二进制 body。非 JSON body 只保留省略原因/长度；大于 1 MiB 或读取超过 10 秒的 body 省略，不截断保存潜在 credential。队列最大 100，最多重试 10 次，失败计入丢失；单 session 最大 10000。避免多个 Studio 标签页共同操作造成归因污染。

## Raw call 与程序调用

设置当前终端的临时本地 key（从启动 URL 的 fragment 复制），用后即删除环境变量；不是 Suno 认证：

```powershell
$env:SUNO_CONTROLLER_KEY = '<当前本地配对码>'
node suno/cli.mjs probe
node suno/cli.mjs capture-start --label create-empty-project
node suno/cli.mjs capture-stop
# 只有实际捕获过 endpoint 后才使用 raw-call；此处不填猜测路径。
node suno/cli.mjs raw-call --method POST --path '<真实捕获的相对路径>' --body request.json --id operation-1 --timeout 30000
node suno/cli.mjs cancel --id operation-1
Remove-Item Env:SUNO_CONTROLLER_KEY
```

```js
import { SunoBridge } from './suno/bridge/client.mjs';
const bridge = new SunoBridge();
const signal = new AbortController();
const result = await bridge.call({ path: observedPath, method: 'PATCH', body: observedBody, timeoutMs: 30000 }, { signal: signal.signal });
// result = { requestId, ok, result, status, durationMs }
```

支持 GET/POST/PUT/PATCH/DELETE；body 为 JSON；不允许自带认证头。错误区分 auth_error / permission_error / validation_error / rate_limit / network_error / suno_api_error / unknown_error，以及本地 timeout/cancelled/controller_error。不保存 raw-call 请求/响应到磁盘；浏览器回传结果先脱敏，所以 token/signed query 不能作为后端可重播值使用。

已验证 StudioClient 用法（以下调用会在真实账号新增一个默认空工程）：

```js
import { SunoBridge } from './suno/bridge/client.mjs';
import { StudioClient } from './suno/studio/operations.mjs';
const studio = new StudioClient(new SunoBridge());
const created = await studio.create_project(); // body 省略；不自动重试
const metadata = await studio.get_project_metadata(created.id);
```

timeoutMs/requestId/signal 可传给这两个方法；metadata 只包含已观察的工程信息，不能当成完整 timeline。自定义 title、其他 major_version 尚未复现，当前会抛 NotImplementedError。GM transport 重播不会被官方 fetch/XHR recorder 捕获；本轮审计保存了明确标注来源的脱敏重播回执，并与官方 GET 和 UI 证据比对，未把回执伪装为被动 capture。

若将来真实 Studio 操作需要未支持的媒体上传、特殊 header 或签名 URL，应先审计捕获并扩展 **浏览器侧**能力，不把凭据写入 controller。已有 Cover/audio 能力保留源逻辑，本轮未调用；它们不属于 VERIFIED Studio 功能。

## 测试

```powershell
npm run build:userscript
npm test
npm run test:live # 默认 SKIP
# 显式真实只读测试，需要当前 bridge/auth ready 和临时本地 key
$env:RUN_SUNO_INTEGRATION_TESTS = '1'
$env:SUNO_CONTROLLER_KEY = '<当前本地配对码>'
npm run test:live
Remove-Item Env:RUN_SUNO_INTEGRATION_TESTS
Remove-Item Env:SUNO_CONTROLLER_KEY
```

普通测试使用通用 transport fixtures 和真实本地 WebSocket，不伪造任何 Studio 工程 endpoint，也不接触真实账号。`test:live` 仅 GET session；另有下述显式素材库只读测试。将来变更账户的测试需要单独明确加入。

## 如何确认认证没有保存到后端磁盘

- 原 `vendor/suno-original.user.js` 原样保留；生成脚本将工作台 `/api/auth` 上传和账号 fetch 分支禁用、自动更新检查禁用。`tests/userscript.test.mjs` 实际执行适配源码，断言无后端 auth 请求，并覆盖 401 和取消。
- 原脚本认证仍存在 **用户浏览器 Tampermonkey 的 AUTH_KEY 持久存储**。本项目不声称整个浏览器从未保存 JWT；保证 controller 不默认保存它，也不把 auth 同步给 controller。
- 所有 header 除少量安全展示字段外掩码；JSON credential/device/token/cookie 字段递归掩码，JWT/Bearer 文本替换，userinfo/hash 移除，非 JSON/超限 body 省略。自 v1.3.15 起，普通 `https://studio-api-prod.suno.com` URL query 精确保留 `title`、`major_version`、`project_id`、`clip_id`、`offset`、`duration`、`position`（区分大小写），其余 query 值仍掩码。这些业务字段在 JSON body 中原本就保留，不因此放行 header。值中可识别的 JWT/Bearer/credential 文本仍替换；含签名/token/credential 参数的 URL 以及外部 URL 的所有 query 值仍掩码。重复 query 键和顺序保留，浏览器/后端使用同一策略。该白名单只改变记录策略，不证明同名字段属于任何 Studio API。
- `npm test` 使用固定合成敏感标记，扫描落盘捕获确认没有标记且保留业务 ID。可在本机检查实际 capture：`node scripts/check-captures.mjs`；该工具只输出文件数和疑似泄露文件路径，不显示匹配值。扫描是补充检查，不能证明任意未知命名的 opaque secret 都可被识别；共享前仍需复核。
- captures、generated userscript、node_modules、交付包均被 Git 忽略。生成日志只包含测试输出/脱敏状态，证据包不包含认证、raw session 响应或启动配对 URL。controller 无数据库、无 session cookie 文件、无 credential cache。

回滚：Ctrl+C 正常关闭 controller，在 Tampermonkey 禁用本地版本、恢复旧版并刷新页面。生成文件可从保留源重建，不修改 Downloads 的原文件。

实现参考：[ws 官方文档](https://github.com/websockets/ws)；响应 clone 的限制与分支缓冲行为见 [MDN Response.clone](https://developer.mozilla.org/en-US/docs/Web/API/Response/clone)，本 recorder 限制读取并取消观察分支。

## 参考网站 recorder 与静态分析

当前分析不依赖付费任务执行。静态资源来源、函数/参数模板及未付费正常导航证据见 [REFERENCE_CLIENT_ANALYSIS.md](docs/REFERENCE_CLIENT_ANALYSIS.md)。Acorn 只是开发工具，解析已收到的代码，不执行它。`npm ci --ignore-scripts` 同时安装 dev dependency。

参考 recorder 与本地 transport v1.3.15 独立，**不替代网站原有 bridge、不获取或同步 Suno auth、不执行业务请求**。若以后需要连续观察：本地页点击“安装独立参考 recorder”，在 Tampermonkey 安装独立脚本，然后刷新本地页与参考页。它的 GM 权限只允许 POST 到 127.0.0.1；配置使用独立 namespace。无需重新安装本地 transport。只保留一个参考标签页，刷新后旧 heartbeat 最多残留10秒。

本地页 Reference recorder 显示在线后，输入 capture 名称并开始。参考页左下角观察面板填写当前单个动作、点“动作开始”；正常完成该动作，等待待响应/队列归零，再点“动作完成”。当前未付费观察可用“打开项目列表”，不提交付费合并/导出。结束本地 capture 后查看 `captures/reference/<session>/events/000001.json`、`timeline.jsonl`、`summary.md`。

console_request/response/cancel、网站 backend_request/response、实际页面 Suno fetch/XHR 和 marker 分别保存。requestId 在 pageId 内关联；重复请求、重复/孤立响应不丢弃，recordId 只去掉入库重试副本。late response 使用请求开始的 marker，另存 observedMarker；按 timestamp/sequence 分析，文件入库顺序不是请求顺序。成功事件没 status 时为 null，绝不填200。

认证/账户/计费相关网站 body 强制省略，headers 默认掩码，bodyJson 中嵌套 JSON 的 headers 也脱敏。保留其余 JSON 结构；1 MiB body、10秒读取、深度/节点/数组上限导致省略时明确记录原因，不能作为完整重播输入。queue200/retry10仅适用于本地日志投递，绝不重试网站/Suno业务请求。未覆盖 Worker、iframe、WebSocket/sendBeacon、第三方签名媒体上传；UI snapshot 只读非敏感表单值/文件metadata，不读隐藏状态或账号中心全文。

```powershell
# 用当前临时 localhost key；勿保存或分享配对 URL
node suno/cli.mjs reference-start --label unpaid-navigation
node suno/cli.mjs reference-stop
# 下列先生成计划，不发网络请求；不需要 key
node suno/cli.mjs reference-replay --session '<实际 session id>' --record '<实际六位 console_request 序号>'
# 仅实际成功观察、确认业务后显式单次执行。缺少/脱敏 body、歧义、取消、权限字段均拒绝。
node suno/cli.mjs reference-replay --session '<实际 session id>' --record '<实际六位序号>' --execute
```

replay 只接受成功匹配的 console_request，不接受网站 `/api/...`、AST模板或 marker。使用新的 requestId，经现有 SunoBridge.call 执行一次；回执另存 replays/，不会自动升为 VERIFIED。涉及新 ID 的后续请求必须重新核对实际参数和读取状态，尚无自动 ID 替换。当前静态分析没有产生可重播的新 Studio 请求，本轮未执行任何新模板。

停止 capture 或禁用独立 recorder 后刷新参考页即可回滚观察；localhost backend 不改第三方网站。独立脚本未经此次真实浏览器安装验证，当前运行时证据来自临时 CDP观察，而非宣称该脚本已在线。

## 官方已下发 Studio 源码分析

补充证据见 [OFFICIAL_STUDIO_STATIC_REPORT.md](docs/OFFICIAL_STUDIO_STATIC_REPORT.md)。只分析页面资产清单中实际出现且已经取得的公共 JS；不要枚举隐藏资源或为了补 schema 调用付费端点。

```powershell
node scripts/analyze-studio.mjs captures/official-static/20261005/manifest.json captures/official-static/20261005/analysis.json
```

manifest 的 rows 包含已观察的同源 immutable chunk 的 name/url/sha256；工具验证文件身份后进行 AST 解析，输出原 path/method/body/params 表达式、函数/export 和 offset。它不下载、不执行代码、不重播 API。结果是 STATIC_CLIENT；保存/render、track/arrangement 构造模板不自动进入 StudioClient 或 VERIFIED 状态，Preview 限制不因此改变。

## 已验证的自有素材库读取

官方 Library 操作实际发出 `POST /api/feed/v3`；原请求重播、薄客户端和显式真实测试均返回与官方 capture 一致的 4 个资源。范围仅限已观察的当前用户、cursor=null、limit=20、非 stem、非 Studio 来源的第一页。详细证据及限制见 [LIBRARY_VERIFICATION_REPORT.md](docs/LIBRARY_VERIFICATION_REPORT.md)。

```js
import { SunoBridge } from './suno/bridge/client.mjs';
import { LibraryClient } from './suno/library/client.mjs';
const library = new LibraryClient(new SunoBridge());
// ownerId 必须取自当前账号实际 own-library 请求的 filters.user.userId。
// 本地 client 不发现登录身份，也不认证此 ID；Suno 服务端仍负责访问控制。
const page = await library.get_own_library_page(observedCurrentOwnerId, {
  timeoutMs: 30000, requestId: 'library-read-1', signal: abortController.signal
});
```

返回原 JSON，保留未知资源字段；`clips` 中实际 `entity_type` 为 `song_schema`，不是 Studio timeline clip。校验资源归属与响应结构，错误不重试，不自动分页；`has_more=true` 时不能声称已读取全部素材。不新增 Studio track、clip、保存或 export 方法。body 的 `"True"` / `"False"` 是已观察的字符串，不能改成 Boolean。

真实素材库测试默认关闭，必须同时显式启用并指定本机真实 capture；capture 文件只读取一次作为对比基线，不承担通信：

```powershell
node --test tests/library.integration.mjs # 默认 SKIP
$env:RUN_SUNO_INTEGRATION_TESTS = '1'
$env:SUNO_CONTROLLER_KEY = '<当前临时本地配对码>'
$env:SUNO_LIBRARY_CAPTURE = '<当前账号真实 own-library capture 目录>'
try { node --test tests/library.integration.mjs }
finally {
  Remove-Item Env:RUN_SUNO_INTEGRATION_TESTS,Env:SUNO_CONTROLLER_KEY,Env:SUNO_LIBRARY_CAPTURE -ErrorAction SilentlyContinue
}
```

测试固定读取该目录的 001 request/response，要求原请求恰为上述已验证查询，比较资源 ID 与 has_more。历史素材库变动会导致对比失败，应重新进行单动作观察，不能将差异忽略。交付证据额外掩码 account userId/user_id 并省略歌名、lyrics、媒体 URL；本机原 capture 保留非凭据的业务 ID，因此不要直接分享整个原 capture。

## 完整 Studio GET 与写接口静态恢复

真实用户导出的 HTTP 200 GET body 已形成 [脱敏 fixture](fixtures/studio_project_get.json) 和 [provenance](fixtures/studio_project_get.provenance.json)。Downloads 原文件和 ignored `captures/studio_project_3ebbb451-08a7-4599-9885-788f0b8f5def.json` 字节副本保持不变；共享 fixture 只替换 title/name 标签，完整 state、20 个 clip、markersRegistry 和 version 引用保留。

`StudioClient.get_project(id, {timeoutMs, requestId, signal})` 现在执行已经确认的 GET，返回完整原 JSON，不构造默认 state，不修改 warp/transposition 或删除未知字段。`models.d.ts` 提供五个开放类型。历史 get_project_metadata 校验限旧默认创建 metadata；完整工程请使用 get_project。本轮 getter 以真实 fixture 做结构/无损测试，未通过当前离线 bridge 再次发起 live GET，不把测试响应当新的网络证据。

```js
const project = await studio.get_project(observedOwnedProjectId);
// project.state 原值；project.latest_version_id 是真实服务端版本关联。
```

写 API 的 endpoint/method/body、response 局部消费、bundle/hash/offset 与调用链见 [STUDIO_WRITE_API.md](docs/STUDIO_WRITE_API.md)。save_project/save_version/export_project/export_multitrack 仍抛 NotImplementedError；对应静态元数据集中在 STATIC_WRITE_CANDIDATES，不属于 VERIFIED dispatch registry。既有默认 create_project 实现保留，不因此放行其他版本/参数。

```powershell
node scripts/analyze-studio-write.mjs captures/official-write/20261005/manifest.json captures/official-write/20261005/write-analysis.json
npm test
```

工具只解析已经取得的公共代码，验证 SHA-256 后输出语法引用/有限 import 调用图，不下载、不求值、不调用 API。sourceMappingURL 检查的 5 个关键 URL 均 404；源码枚举仅限当前实际下发范围。静态结果不能证明写权限或保存/导出成功。本阶段完成后停在证据报告，不自动重播未知写接口。
