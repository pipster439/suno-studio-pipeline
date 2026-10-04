# 本地 Suno Controller / API Recorder

第一轮基础设施：Node.js 单进程 + 原生浏览器页面 + 一个依赖 ws，无数据库或前端框架。Studio 业务接口全部 UNKNOWN，`StudioClient` 每个操作均抛 `NotImplementedError`。本轮验证真实认证探针和被动 recorder 入库，不创建工程、不主动运行生成/导出。

## 架构与安装

`SunoBridge.call → localhost HTTP → WebSocket → Browser page → CustomEvent → Tampermonkey GM request → Suno → 原路返回`

官方页面 recorder 独立观察 fetch/XHR，在浏览器先脱敏，以 GM 请求发送给 capture ingress；后端再脱敏。记录来源不经过 auth 传输的业务实现。详见 [CURRENT_ARCHITECTURE.md](CURRENT_ARCHITECTURE.md)。

要求 Node.js 22+，浏览器已安装 Tampermonkey，Suno 官方账号已登录。

```powershell
cd G:\Suno
npm ci --ignore-scripts
npm run build:userscript
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

普通测试使用通用 transport fixtures 和真实本地 WebSocket，不伪造任何 Studio 工程 endpoint，也不接触真实账号。真实测试仅 GET session；将来变更账户的测试需要单独明确加入。

## 如何确认认证没有保存到后端磁盘

- 原 `vendor/suno-original.user.js` 原样保留；生成脚本将工作台 `/api/auth` 上传和账号 fetch 分支禁用、自动更新检查禁用。`tests/userscript.test.mjs` 实际执行适配源码，断言无后端 auth 请求，并覆盖 401 和取消。
- 原脚本认证仍存在 **用户浏览器 Tampermonkey 的 AUTH_KEY 持久存储**。本项目不声称整个浏览器从未保存 JWT；保证 controller 不默认保存它，也不把 auth 同步给 controller。
- 所有 header 除少量安全展示字段外掩码；JSON credential/device/token/cookie 字段递归掩码，JWT/Bearer 文本替换，URL 所有 query 值掩码、userinfo/hash 移除，非 JSON/超限 body 省略。共享脱敏代码由浏览器和后端使用。脱敏有意牺牲部分未知字段的可复现性，不能直接从日志重播 credential。
- `npm test` 使用固定合成敏感标记，扫描落盘捕获确认没有标记且保留业务 ID。可在本机检查实际 capture：`node scripts/check-captures.mjs`；该工具只输出文件数和疑似泄露文件路径，不显示匹配值。扫描是补充检查，不能证明任意未知命名的 opaque secret 都可被识别；共享前仍需复核。
- captures、generated userscript、node_modules、交付包均被 Git 忽略。生成日志只包含测试输出/脱敏状态，证据包不包含认证、raw session 响应或启动配对 URL。controller 无数据库、无 session cookie 文件、无 credential cache。

回滚：Ctrl+C 正常关闭 controller，在 Tampermonkey 禁用本地版本、恢复旧版并刷新页面。生成文件可从保留源重建，不修改 Downloads 的原文件。

实现参考：[ws 官方文档](https://github.com/websockets/ws)；响应 clone 的限制与分支缓冲行为见 [MDN Response.clone](https://developer.mozilla.org/en-US/docs/Web/API/Response/clone)，本 recorder 限制读取并取消观察分支。
