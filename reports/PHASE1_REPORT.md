# Suno Controller / Recorder 第一轮交付报告

日期：2026-10-05，Asia/Shanghai；capture 文件名/请求 timestamp 使用 UTC。

## 结论

第一轮基础设施完成。完整阅读 1076 行源脚本；生成架构审计、本地 controller、WebSocket browser bridge、通用 SunoBridge/raw-call、官方页面 fetch/XHR recorder、两端脱敏和测试。实际 Edge + Tampermonkey v1.3.14 + 已登录 Suno 的只读 `/api/session/` round-trip 成功，HTTP 200。实际官方 fetch 记录已落盘；干净起始状态下的单请求验证 pending=0、queue=0、dropped=0。

所有 Studio 业务操作保持 UNKNOWN，StudioClient 抛 NotImplementedError。未创建新工程、主动添加/移动/修剪素材、保存或导出；MVP 业务目标留待后续单动作观察/复现/读回验证。不猜 endpoint 或字段。

## 主要变更

- `CURRENT_ARCHITECTURE.md` 审计认证来源/续期、事件协议、取消、401、browser-token、GM transport、Cover 和音频能力。
- `vendor/suno-original.user.js` 保留附件原字节；Downloads 原文件未修改。生成脚本从保留源和明确适配模块构建，限制 match/connect 范围，关闭工作台 auth 上传/账号查询和自动更新，添加相对 path 白名单、状态/错误细节、无凭据 auth status 与构建标识。
- `suno/server.mjs` 单进程、固定 loopback、临时本地 capability、Host/Origin 校验、单 bridge、WebSocket heartbeat、显式 capture 会话；从不接收 userscript 的 auth 同步，不持久化 Suno JWT/cookie/device token。
- `suno/bridge/` 支持并发 requestId、GET/POST/PUT/PATCH/DELETE、超时、取消、断线失败、客户端 AbortSignal、结构化错误。断线不重放，写操作 outcome 可能未知。
- `userscripts/recorder.js` 被动观察已开启会话中的官方 /studio fetch/XHR；不改变返回 promise，不消耗官方 response；限定 body 读取和队列，重试入库，显示 pending/queue/dropped/error。
- `shared/privacy.cjs` 浏览器/后端共同执行脱敏：header 默认掩码、凭据/device/captcha 字段递归掩码、嵌套 JSON 字符串、JWT/Bearer、URL query/userinfo/hash、非 JSON 和超限 body 省略。
- `docs/STUDIO_API_MAP.md` 全部业务 UNKNOWN；认证探针与业务证据分开。README 给出安装、启动、配对、capture、replay、测试、磁盘检查和回滚说明。
- 分阶段 Git commits；任务开始时 G:\Suno 为空且无 Git，故独立 patch 是本轮创建文件的完整差异，没有开始前的未提交改动。

## 验证与测试结果

1. `npm test`：12/12 PASS，包含并发/乱序关联、超时、显式取消/AbortSignal、disconnect/reconnect 无重放、API 错误分类、path/method 验证、脱敏、未实现 Studio 业务、实际本地 WebSocket、生成 userscript 的 auth 隔离/401/GM abort、官方 fetch/XHR 观察及 producer→CaptureStore 契约。
2. `npm run test:live` 默认 SKIP；显式 `RUN_SUNO_INTEGRATION_TESTS=1` 实测 PASS。最终 v1.3.14 的真实 Suno 会话 probe 约 1.1 秒；不保存原始 session 响应或认证头。
3. `node --check` 生成脚本和 `git diff --check` PASS；官方 npm registry 的生产依赖 audit：0 vulnerabilities。用户全局 npm mirror 的 audit API 不支持，改用官方 registry 执行检查，没有把镜像错误当作通过。
4. 源文件 SHA-256 与 vendor 副本相同：`D10DE91A2344B18B8CC804955B3903C5D6C215DFA1C5ED5DD4C5825583C48402`。最终生成脚本 SHA-256：`CF57D27A5A544CDDE24CD003832B6C1F0931E16861B21BAC4231414EFA91F548`。
5. 官方真实捕获：修复后加载 baseline 完成 125 对请求/响应，全部已保存响应为 200，但有 8 项 dropped，因此 **不作为完整操作证据**。随后在 capture 关闭时重新进入官方页，加载完成后仅强制原脚本已有会话刷新：完成 1 对 GET session，status=200、pending=0、queue=0、dropped=0。实际捕获扫描共 255 个 JSON/Markdown 文件，无 JWT/Bearer heuristic 疑似命中。
6. 包从独立 staging 构建，白名单限制内容与大小，拒绝嵌套压缩包和路径逃逸，检查重复名、ZIP CRC 和内容哈希。patch 独立提供；最终 ZIP SHA-256 在外部 .sha256 文件，未放入 ZIP 内。检查结果见交付 manifests/日志。

## 发现的问题、修复与风险

- 原工作台 sync POST `/api/auth` 包含完整认证 headers，违背“始终只留在浏览器”的初始描述。本地生成版本禁用该分支；不提供假的 auth/session 后端来假装同步成功。Suno 登录仍按原脚本放在 Tampermonkey AUTH_KEY **浏览器持久存储**，不是纯内存；后端不保存它。
- v1.3.13 实际入库发现 recorder sessionId 被通用凭据脱敏器掩码，导致 ingress 502、0 对记录并丢失。v1.3.14 仅在完成业务体脱敏后恢复本地 controller 发出的关联 envelope 字段，补上 producer→store 契约。失败 baseline 被停止且不用于有效捕获；没有把 mock 测试通过当作实际入库成功。
- 修复后的首次 Studio 加载仍出现队列洪峰，125 对落盘但 8 项丢失。当前限制是有意的有限内存队列，不支持完整大规模启动流量；首轮单操作应在已加载页面上开启 capture。dropped 是官方文档生命周期计数，刷新/重新进入且 capture OFF 才能建立零计数起点。高流量动作若仍触发上限，必须先扩展吞吐/受控队列并重复验证，不能接受不完整业务证据。
- 官方页面当前显示 `Preview / Upgrade to edit`。已观察 New Project 菜单入口可见，但未执行创建，不能推断创建/编辑/保存权限。后续操作可能被账号权限挡住；不绕过权限或购买订阅。
- Recorder 只覆盖当前官方页面 JavaScript 可见 fetch/XHR；不覆盖 Worker/iframe/WebSocket/SSE/sendBeacon，自动 cookie/禁止读取 headers 可能不可见。大/二进制/非 JSON body 省略。多 Studio 标签页可能污染归因；本轮要求只用一个。
- 脱敏保留业务 ID/字段结构但删除所有 URL query 值，日志未必可直接重播。扫描只识别 JWT/Bearer，不证明任意未知命名 opaque secret 都能被识别；共享前需复核。证据包不带真实业务/session body，仅状态、数量、哈希和测试日志。
- 超时/取消/断线只能中止等待和请求传输，不能撤销服务端已接受的写操作。当前业务 endpoint 全部未知，禁止盲重试。
- 原 Cover/audio 私有 runtime/MSE 包装保留，本轮未调用；只读页面加载未见明显破坏，不证明媒体下载或所有 Studio 交互兼容。

## 未解决事项与下一步

Studio 创建/读取/素材/clip/timeline/保存/export API 及 MVP 均未确认。接下来只让用户执行 New Project 创建空工程，若出现选择/权限对话框先停下并反馈；不要同时添加音频或编辑。记录候选、前后差异、必要的重复实验，实际复现和读回后才标 VERIFIED，并在集中 API 模块增加 StudioClient 实现。

## 证据和产物位置

- 源码和 README：`G:\Suno`。
- 架构：`G:\Suno\CURRENT_ARCHITECTURE.md`；API map：`G:\Suno\docs\STUDIO_API_MAP.md`。
- 生成的安装脚本：`G:\Suno\userscripts\local-transport.user.js`（可重建，Git ignored）。
- 原失败 baseline：`G:\Suno\captures\2026-10-04T16-59-02-384Z-aa4a3da1`（只有失败 summary，不用于有效证据）。
- 修复后部分加载 baseline：`G:\Suno\captures\2026-10-04T17-03-59-172Z-6555881e`（125 对，8 dropped）。
- 干净单请求验证：`G:\Suno\captures\2026-10-04T17-08-37-237Z-cb2c73d2`（1 对，零 pending/queued/dropped）。
- 报告：`G:\Suno\reports\PHASE1_REPORT.md`；交付目录：`G:\Suno\deliverables`。
- 证据包：`SUNO_RECORDER_PHASE1_EVIDENCE.zip`；独立 patch：`SUNO_RECORDER_PHASE1.patch`；外部校验文件：`SUNO_RECORDER_PHASE1_EVIDENCE.zip.sha256`。
- 独立 staging：`G:\Suno\.evidence-staging\phase1-20261005`；只包含 REPORT、logs、manifests、hashes、screenshots、必要小型 evidence。无 node_modules、仓库副本、credential、启动配对 URL、完整 captures 或旧交付包。
