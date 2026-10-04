# 自有素材库读取验证报告

日期：2026-10-05，Asia/Shanghai。任务基线：`c78f1bb7a68570cea52e8469547c9a763a15f4a4`，开始时工作树干净。本阶段仅增加真实观察并复现成功的素材库读取，不执行未知 Studio 写入，不修改账号套餐、权限或 subscription。

## 结论

官方 Studio Library 单次正常打开触发 `POST /api/feed/v3`，真实 Tampermonkey recorder 经本地 ingress 保存 6 对请求/响应。素材库主请求 HTTP 200，返回 4 个属于当前用户的 song_schema 资源。原请求通过现有 localhost → Browser page → Tampermonkey → Suno → Browser → localhost 原样重播成功，资源 ID、归属及 has_more 与官方 capture 一致。薄 LibraryClient 实际调用及显式集成测试通过。仅该具体第一页查询升级为 VERIFIED；它不是 Studio timeline clip API。

官方仍显示 Preview / Upgrade to edit。创建、metadata 与素材库读取不证明编辑/保存/导出可用，完整 MVP 未完成。静态 state/serializer 模板继续 UNKNOWN，不用构造请求替代合法运行时证据。

## 主要变更

- `suno/library/api.mjs` 集中固定已观察 POST、path 与 body；保留字符串 True/False、cursor=null、limit=20 和原 filter。
- `suno/library/client.mjs` 实现 get_own_library_page，支持既有 correlation/timeout/cancel signal；不接收 auth header，不发现账号身份，不重试、不分页。拒绝无效 ownerId 和异常结构/归属，保留额外资源字段。
- 新增 3 项契约单元测试与默认关闭的真实素材库测试；README/API Map 记录范围、证据和启用方式。未改 Tampermonkey transport、controller 通信、已有 StudioClient 或业务写入实现。

## 重要证据

官方 capture：`captures/2026-10-04T20-19-24-948Z-96ae9342`，marker/label `read-only-open-library-01`，2026-10-04T20:19:24.948Z 至 20:21:05.613Z（UTC）。开始前 recorder online、activeSession 匹配、pending/queued/dropped=0；结束已停止。只进行打开 Library 一个动作，不打开歌曲或插入素材。UI 观察 My Workspace / 4 songs。

| Record | 实际请求 | 状态 | 判断 |
|---|---|---|---|
| 001 | POST /api/feed/v3 | 200 | 素材库主请求；完整非敏感 body 可重播 |
| 002 | GET /api/studio/list-projects | 200 | 列表周边请求；query 值脱敏，未重播 |
| 003 | GET /api/project/me | 200 | workspace 周边请求；query 值脱敏，未重播 |
| 004 | GET /api/studio/project/341de3bf-fceb-44e5-a6d5-b94793385dfc | 200 | 工程六字段 metadata；不能代表完整 timeline |
| 005 | GET /api/notification/v2 | 200 | 延后的背景请求；私有通知内容不交付 |
| 006 | GET /api/user/get_user_session_id/ | 200 | 延后的背景请求；session_id 实际为 <redacted> |

001 timestamp：20:19:40.435Z → 20:19:40.885Z，duration=450.59 ms。回执 `captures/library-verification/20261005/replay-receipt.json` 记录 requestId=9e69e876-8bde-4f12-a73f-a9b63939112e、HTTP 200、1989.20 ms、4 个实际资源 ID 一致、归属一致、has_more=false。后续 typed-client-receipt.json 记录薄层成功。回执来源是显式 GM transport，不冒充官方被动 fetch capture。

本次打开的 341de3bf… 工程与之前创建验证的 5595bf9c… 不同，不混淆元数据、runtime state 或持久化证据。证据包保留素材资源 ID 与时序/结构，额外掩码账号资源 ID，省略标题、lyrics、通知正文与媒体 URL。

## 验证与发现的问题

`npm test`：29/29 PASS，含新增 3 项契约测试，0 FAIL。`npm run test:live`：默认 1 SKIP。`node --test tests/library.integration.mjs`：默认 1 SKIP；显式 RUN_SUNO_INTEGRATION_TESTS=1 且设置 SUNO_LIBRARY_CAPTURE、临时 localhost key 后，真实素材库测试 1/1 PASS，HTTP 200 结果与原 capture 的资源 ID/has_more 一致。key 用后从执行环境移除，没有写入证据文件。

首次薄客户端真实调用出现 HTTP 200 后的本地 schema 校验失败：我误将 entity_type 校验为 clip，实际值是 song_schema。直接核对原官方响应后修正，并增加拒绝 clip/track discriminator 的回归断言；修正后的实际调用及独立真实测试通过。数组名 clips 不能证明元素类型，更不能证明 timeline clip 身份。失败未作为有效通过证据。

响应校验确认 user_id 等于请求中的 ownerId，但本地 UUID 格式校验不证明账号身份。调用者必须使用当前实际 own-library 请求中的 ID，Suno 继续负责权限控制。客户端不自动恢复或降级 schema；未来不兼容会显式失败。真实测试基于素材库快照，新增/删除素材会改变 ID 对比，不能把失败忽略为通过。

## 风险与未解决事项

- 旧 v1.3.11 UI 面板仍曾出现；未证明旧 listener 已禁用。controller 无自动业务重试，但共享 CustomEvent 可能被多个 listener 接收。本阶段全部是查询；不能声明一个 controller 请求必然仅有一次上游请求，后续写入前必须解决冲突。
- Recorder 只观察对应页面 fetch/XHR；不可见浏览器 Cookie/set-cookie、Worker/iframe 等不因此被宣称已捕获。终态队列为零不能证明不存在任何未覆盖行为。
- 原 capture 中非凭据业务 userId/user_id 可保留；本次共享包额外去除它们。未知 opaque credential 的自动识别仍有限，不直接打包原素材库/通知/session 文件，不交付 auth、cookie、JWT、签名 URL 或本地配对 key。
- 未验证其他 feed filter/cursor/limit；未验证歌曲下载、素材插入、track/arrangement 构造的服务器效果、timeline position、保存/commit、完整状态读回、render/export。StudioClient 相关方法仍 NotImplementedError。
- 参考网站独立 GM recorder 的安装/真实投递仍未证明；不能把此次官方 recorder 成功扩大为参考网站生产脚本成功。此前参考网站未付费正常导航未发出 Studio bridge 事件，付费 backend 实现未知。
- 所有实际 API 都是内部不稳定接口。Preview 限制、禁止付费/权限绕过以及旧 listener 冲突仍约束下一阶段。没有执行静态模板来制造隐藏权限，也没有尝试升级套餐。

## 交付与回滚

独立 patch：`deliverables/SUNO_LIBRARY_READ_VERIFICATION.patch`，仅基线后的本阶段改动；证据：`deliverables/SUNO_LIBRARY_READ_VERIFICATION_EVIDENCE.zip`，外部同名 .zip.sha256。从独立 `.evidence-staging/phase1-library-read-verification-20261005` 打包，只含本报告、脱敏小型证据、日志、manifest/hash。包内排除完整源码、原私有响应、依赖、历史 ZIP、缓存及 patch。

通过脚本检查 CRC、清单、每项哈希、重复/嵌套/不相关条目，并额外扫描已知 account/contact/配对码。patch 在隔离临时 Git 基线应用后与阶段 commit 的目标 blobs 比较。回滚本地新增 library 模块/测试及本阶段文档即可；没有服务器业务变更需撤回。
