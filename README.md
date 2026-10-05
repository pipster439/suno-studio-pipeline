# 本地 Suno Controller / API Recorder

Node.js 单进程 + 原生浏览器页面 + 一个依赖 ws，无数据库或前端框架。完整 project GET 已由真实 fixture 确认；version GET 与 versions GET 已通过浏览器/Tampermonkey 实际返回 HTTP 200 并确认工程/版本关联。当前所有 StudioClient 写入口（包括历史默认 create）均抛 `NotVerifiedError`，纯 request builder 只生成预览。读取成功不表示账号具有写权限；完整素材→timeline→保存 MVP 尚未完成。证据见 `docs/STUDIO_API_MAP.md`、`reports/STUDIO_READ_BOUNDARIES_REPORT.md`。

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

已验证 StudioClient 只读用法：

```js
import { SunoBridge } from './suno/bridge/client.mjs';
import { StudioClient } from './suno/studio/operations.mjs';
const studio = new StudioClient(new SunoBridge());
const project = await studio.get_project('3ebbb451-08a7-4599-9885-788f0b8f5def');
const version = await studio.get_project_version(project.id, 'e491cbde-9266-4884-997c-3a9789877a56');
const versions = await studio.get_project_versions(project.id);
```

timeoutMs/requestId/signal 可传给只读方法；metadata 不能当成完整 timeline。GM transport 重播不会被官方 fetch/XHR recorder 捕获，动态证据明确标注 explicit replay。`create_project/save_project/render_project/render_multitrack` 和 save/export 别名默认拒绝，即使传入 allowWrite/integration 等参数也不能解锁；目前没有 StudioClient 写 gate。generic raw-call 仍是人工显式调试 transport，不属于此客户端的写入口，本轮禁止调用 Studio POST。

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

写 API 的 endpoint/method/body、response 局部消费、bundle/hash/offset 与调用链见 [STUDIO_WRITE_API.md](docs/STUDIO_WRITE_API.md)。全部写入口抛 NotVerifiedError；历史默认 create 证据移入 HISTORICAL_VERIFICATIONS，写候选集中在 STATIC_WRITE_CANDIDATES，不属于 VERIFIED dispatch registry。

## State 边界与版本只读实验

`rawWireState → deserializeEditorState(显式 adapter) → editor-memory → serializeProjectState(显式 adapter) → save-serialized → buildSaveProjectRequest`。render 使用独立 `prepareRenderTransformedState(editor, transform, serializeRender)` 和 render-transformed handle。GET state 不会自动经过 serializer。输入和输出以隔离快照保存，完整未知字段由 adapter 保留。新增 audio clip pipeline 提供静态重建的显式 project adapters；它们经过本地往返测试，仍未获得服务器写入 VERIFIED，render adapter 未移植。

**隐私修复 v1.3.16：** shared/privacy.cjs 对精确 JSON key `timeSignatureChanges` 递归保留内容，header/query/signed URL 规则不放行该名称，相似字段名也不放行；内部 token 等仍掩码。v1.3.15 的误掩码是历史限制，不修改旧日志。升级时须更新 Tampermonkey、本地页（刷新）和 controller（正常重启或新进程），避免旧过滤器仍在执行。所有带掩码/omitted 的 state 仍被拒绝进入 save/render 准备；完整 source fixture 不变。修复与严格无损读回证据见 [STUDIO_METER_PRIVACY_REPORT.md](reports/STUDIO_METER_PRIVACY_REPORT.md)，读取成功不放行写方法。

仅显式执行只读实验；下面脚本分别各发一次 GET，不自动重试，不调用 revision 或写接口：

```powershell
$env:RUN_SUNO_INTEGRATION_TESTS = '1'
$env:SUNO_CONTROLLER_KEY = '<当前临时本地配对码>'
$env:SUNO_CONTROLLER_BASE = 'http://127.0.0.1:3000'
node scripts/verify-studio-version.mjs
node scripts/verify-studio-versions.mjs
Remove-Item Env:RUN_SUNO_INTEGRATION_TESTS, Env:SUNO_CONTROLLER_KEY, Env:SUNO_CONTROLLER_BASE
```

默认 `node --test tests/studio-read.integration.mjs` 跳过真实网络；只有 RUN_SUNO_INTEGRATION_TESTS=1 才执行已知 version 的只读测试。报告/实验日志不含认证 header/token 或完整响应值，只含 schema、业务 IDs、状态和比较摘要。

controller 没有热重载；更新源码后须正常重启，才能启用 hub 对 dispatchAllowed=false preview 的拒绝。StudioClient 与 SunoBridge 在调用进程内同样提前拒绝 preview。现有 controller 进程不会被本轮自动停止/替换。

严格无损读验证还需显式设置 `SUNO_PROJECT_RAW_BASELINE` 为真实原 JSON 路径、`SUNO_REQUIRE_LOSSLESS_STATE=1` 和 `SUNO_REQUIRE_USERSCRIPT_VERSION=1.3.16`（可加 `SUNO_REQUIRE_USERSCRIPT_BUILD_ID`）。脚本先检查 auth/version/build；不符合时零 Suno dispatch。strict 模式包括所有 state 展示标签和未知字段，并要求与原 JSON 精确比较成功、无掩码；日志只保存 schema、业务 ID 与摘要，原始响应/原始 JSON 内容不另行落盘。原文件只读且哈希复核。

2026-10-05 已完成 v1.3.16 的最后一次显式 version GET：HTTP 200，响应 id/project_id 正确，全 state（包括展示标签和未知字段）与原真实 JSON 的规范化 SHA-256 相同，timeSignatureChanges 相等、无掩码，1 track/20 clips。原 fixture 不变。详见 [STUDIO_METER_LIVE_VERIFICATION_REPORT.md](reports/STUDIO_METER_LIVE_VERIFICATION_REPORT.md)；这是当前真实工程/版本的无损读取验证，不推导写权限或 serializer 正确性，写入口继续拒绝。

```powershell
node scripts/analyze-studio-write.mjs captures/official-write/20261005/manifest.json captures/official-write/20261005/write-analysis.json
npm test
```

工具只解析已经取得的公共代码，验证 SHA-256 后输出语法引用/有限 import 调用图，不下载、不求值、不调用 API。sourceMappingURL 检查的 5 个关键 URL 均 404；源码枚举仅限当前实际下发范围。静态结果不能证明写权限或保存/导出成功。本阶段完成后停在证据报告，不自动重播未知写接口。

## Clip builder 与本地拼接预览

[STUDIO_CLIP_PIPELINE.md](docs/STUDIO_CLIP_PIPELINE.md) 记录官方 source → arrangement → 本地 store → save 的链路、时间单位、warp、pitch/gain/fade 证据和未来 A–H 单动作验证计划。`suno/studio/clip-pipeline.mjs` 是纯本地模块，没有 bridge/HTTP 调用：

```js
const source = sourceClipMetadata(observedSourceMetadata);
const draft = buildAnalyzedAudioClipDraft(source, {
  fallbackBPS: 1.95, markers: observedResolvedMarkers, name: '素材'
});
const processed = postprocessClip(draft, { transposition: -8 }); // 显式值，非自动 pitch restoration
const placed = placeClip(processed, observedTimelineEndBeats);
const editor = deserializeEditorState(rawWireState(project.state), deserializeAudioProjectState);
const next = appendClipToEditor(editor, observedAudioTrackId, placed);
const saveState = serializeProjectState(next, serializeAudioProjectState);
const preview = buildSaveProjectRequest({ project_id: project.id, state: saveState, title: project.title });
// preview.dispatchAllowed === false；StudioClient save/render 入口仍拒绝。
```

这不是已完成的真实账户合并 MVP。普通 draft 尚待 analysis；resolved draft 要求已确认 source duration 和 markers。时间 helper 只处理 manual 无 automation；特殊 source 内容窗口、重叠替换、自动 inverse pitch、响度修复、完整 track factory 与 render transform 尚未移植。不要把 wire state 的 markersHash 与 editor 的 inline markers 混用。当前官方 save hash 为 MD5，真实历史 fixture hash 拼法不同；原 fixture 不改，新保存输出的服务器兼容性待验证。

```powershell
node scripts/collect-studio-clip-evidence.mjs captures/official-write/20261005/manifest.json fixtures/studio_project_get.json captures/reference-static/20261005/code-manifest.json captures/clip-pipeline/20261005/evidence.json
node --test tests/studio-clips.test.mjs
```

收集器只验证已有快照哈希并按固定 seeds 提取片段。所有当前写候选仍 FOUND_STATICALLY，Add Clip 恢复为 CLIENT_STATE_MUTATION，不增加虚构 API。

## Studio Dry-Run SDK

无需浏览器、账号认证或网络连接，可运行真实 fixture 衍生的 20 段合并示例：

```powershell
npm run dry-run:studio
# 可指定本地输出目录
node examples/studio-20-clip-dry-run.mjs captures/my-local-preview
```

默认输出在 `captures/dry-run-sdk/20261005/`：project_draft、request_previews、validation_report、dry_run_summary、dry_run_provenance、historical_project_diff JSON。示例使用已有 fixture，不下载媒体；source duration 标记为已观察 marker extent，source range 与 warped timeline duration 分别报告。generated IDs 是本地 UUID/明确 placeholders，不能直接充当未来 create/save 的服务器 ID。

`buildMergeDryRun()` 接受 SourceClip[]、manual timing、完整结构 template、processing profiles、显式 request bindings/render 参数。使用 `buildStudioClipDraft()` / `buildSequentialTimeline()` / `modifyExistingProject()` 可分别构造 arrangement、顺序 placement 和保留未知字段的已有工程 overlay。typed 接口见 `suno/studio/dry-run-sdk.d.mts`，可运行输入见 `fixtures/studio_20_clip_dry_run.json`。

explicit pitch/amplitude/read/fade 与明确 markers 可执行；自动 uploader inverse pitch 必须严格 opt-in、始终 CORRELATED；自动响度修复和完整 trim 拒绝。修改已有工程默认 PRESERVE_EXISTING，新 draft 的 CURRENT_STATIC_ALGORITHM 仅 FOUND_STATICALLY。render 独立 state domain 现已移植 audible-track filter、两段 normalization、manual timing/metronome、downbeats 和 referenced-only marker serializer；`renderTransformComplete=true` 仅指 manual constant-BPS audio MVP 的静态 state port。非空歌词 alignment/range、tempo automation/take lanes、真实 bindings 和服务器写验证仍未完成，preview 不可提交。

本轮所有 Studio 写请求在 shared transport boundary 强制拒绝，覆盖 raw-call、SunoBridge 和 BridgeHub；去掉 preview 标记或启用 integration 环境变量都不能放行。Studio Dry-Run SDK 自身没有网络 transport，dispatch() 也抛 NotVerifiedError。运行中的旧 controller 没有热重载，需正常重启加载这个 guard；本轮没有替换旧进程或改 userscript。

```powershell
npm test
$env:RUN_SUNO_INTEGRATION_TESTS = '0'
node --test tests/live.integration.mjs tests/studio-read.integration.mjs
Remove-Item Env:RUN_SUNO_INTEGRATION_TESTS
```

未来正常具备 Studio 写权限后，按 [STUDIO_WRITE_VALIDATION_PLAN.md](docs/STUDIO_WRITE_VALIDATION_PLAN.md) 逐动作 capture，再验证静态候选。读取 VERIFIED 不推导任何写权限。实现/证据边界见 [STUDIO_DRY_RUN_SDK_REPORT.md](reports/STUDIO_DRY_RUN_SDK_REPORT.md)。

## Live validation 工具与离线演练

```powershell
npm run build:studio-harness
npm run offline-validation-rehearsal
node scripts/studio-ready-artifacts.mjs
npm test
```

完整 A–H 演练只用 fixture transport，明确标 SIMULATED_OFFLINE；生成 `captures/live-ready/20261005/offline_validation_rehearsal.json`，八步均可 start/capture/diff/compare/finish，网络请求为零。历史 20 段 dry-run 和 save no-op audit 同时输出摘要与 provenance；真实 fixture 不改写。`studio-ready-artifacts` 要先有该目录中的本轮测试日志，属于证据生成工具，不是普通 SDK 调用的前置条件。

正常具备写权限后，启动 controller，用输出的配对 URL 打开 `/studio-validation`（保留 # 后本地配对码），安装独立“被动 Capture Harness”v1.0.0 并刷新一个官方 Suno 标签页；保留已配对的原 Auth Bridge 标签页。新 harness 不替换 v1.3.16 transport。每项 Begin → 等待 armed → 只做一个官方 UI 动作 → End；工具自动归档、GET 已知 project/version、生成 diff/compare/report，不需 DevTools 或复制 JSON。

```powershell
# SUNO_CONTROLLER_KEY 为本地 controller 配对码，绝不是 Suno JWT
npm run studio-validation -- status
npm run studio-validation -- begin B_ADD --run-id RUN --project-id REAL_PROJECT_ID
npm run studio-validation -- end
npm run studio-validation -- report B_ADD --run-id RUN
npm run studio-validation -- export B_ADD --run-id RUN
```

私有 captures 保留业务 UUID，但认证值在 browser/backend 两侧都过滤。Evidence Export 会进一步 alias UUID、隐藏展示文字；不要打包私有 raw captures。可运行 `node scripts/studio-ready-artifacts.mjs` 查看 privacy/write audit，交付工具还会扫描最终 ZIP 的实际值并核对 fixture 原始哈希。Authorization/Cookie 字段名或单测标签不是凭据；完整 JWT、Bearer 值、真实 email、signed-query signature 都不得出现在日志/包中。

GET 不保证暴露未保存 editor memory，因此工具自动将 B/D/F 关联到下一次 C/E/G，不伪造内存快照。capture 的 pending/queued/dropped/omitted 与停录 ack 都有完整性检查；binary/大 body/beacon 无响应会明确暴露缺口。新 harness 本轮尚未真实浏览器安装验证。Registry 可审核单 endpoint 未来 eligibility，但生产写入口仍物理锁定，不能因配置或 read 成功而发送写请求。

状态总表：[STUDIO_SDK_STATUS.md](docs/STUDIO_SDK_STATUS.md)；操作细节：[STUDIO_CAPTURE_HARNESS.md](docs/STUDIO_CAPTURE_HARNESS.md)；render 证据：[STUDIO_RENDER_PIPELINE.md](docs/STUDIO_RENDER_PIPELINE.md)；本轮报告：[STUDIO_LIVE_VALIDATION_READY_REPORT.md](reports/STUDIO_LIVE_VALIDATION_READY_REPORT.md)。
