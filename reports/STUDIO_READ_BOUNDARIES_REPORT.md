# Studio 最小只读验证与客户端边界报告

日期：2026-10-05，Asia/Shanghai。基线：9d25ccbf985e89fa77cafce361aee50c3acae4e6；开始工作区干净。未继续 bundle 搜索，未发送 Studio 写请求，未绕过产品权限，未修改原始 JSON/既有 fixture。

## 结论

| 只读 API | 结果 | 工程/版本关系 |
|---|---|---|
| GET /api/studio/project/{project_id} | 既有 VERIFIED；本轮未重复调用 | 真实用户 fixture latest_version_id |
| GET /api/studio/{project_id}/version/{version_id} | 本轮 VERIFIED，HTTP 200 | 响应 id=version_id；project_id=真实工程；state 可见字段与基线对应 |
| GET /api/studio/{project_id}/versions?return_days_only=false | 本轮 VERIFIED，HTTP 200 | 顶层 id=工程；分组列表含 latest_version_id |
| GET /api/studio/project_revision/{revision_id} | FOUND_STATICALLY；未调用 | 未有真实 revision_id，不推断或枚举 |

真实 project_id 为 3ebbb451-08a7-4599-9885-788f0b8f5def，version_id 为 e491cbde-9266-4884-997c-3a9789877a56。版本 state 为 1 条 track/20 clips，比较完整未知字段、beats、素材引用、warp/transposition 及 registry。去除 title/name 展示标签后，响应 state 与原 fixture 经现有 transport 隐私投影的 SHA-256 均为 c52d85de8134cbf88b62075ed90aaca1558c1fa7c38c40f9a4a8961a6138584e。

四个当前 write endpoint 均 FOUND_STATICALLY / High：create-project、save-project、render-state、render-state-multitrack。没有写验证或新写权限结论；历史 default create VERIFIED 事实保留，当前客户端发送关闭。

## 主要变更

- StudioClient.get_project_version/get_project_versions：仅 GET，校验两种资源 ID/实际 grouped history，返回完整对象；不缩小到 id/state，不丢未知字段，无重试。
- create_project/save_project/render_project/render_multitrack 及 save/export 别名默认抛 NotVerifiedError。create 从 VERIFIED dispatch registry 移除并保留独立 HISTORICAL_VERIFICATIONS；无当前 write gate/allowWrite 参数。
- 独立 raw wire、editor memory、save serialized、render transformed 品牌和 WeakMap handle。显式 deserializer/project serializer/render transform/render serializer adapter 是接口，未移植官方算法。没有隐式重复序列化 GET。
- create/save/V2 render/multitrack 纯 request builder，只生成 dispatchAllowed=false 的预览；SunoBridge.call 和 controller hub 均在网络前拒绝该预览；snapshot 隔离原数据。render 各种 project ID 必须由调用者明确提供，不能用一个 ID 替代。render clip 与 multitrack download_url schema 独立且开放，未假设完整服务端 response。
- 两个显式只读实验脚本：必须 RUN_SUNO_INTEGRATION_TESTS=1，不自动重试；只记录结构、业务 ID、状态和比较摘要，不存 header/token/完整响应值。原真实 fixture 未重建或改写。
- README、STUDIO_API_MAP 和 STUDIO_WRITE_API 更新当前边界、历史事实与后续最少三个 UI 动作。

## 验证与测试

- **46/46 单元测试通过**：GET correlation/options/资源ID、开放字段保留、伪造状态 handle、raw/save/render 错用、serializer 次数、原数据隔离、redacted/omitted 拒绝、全部写入口零 dispatch、显式 gate 参数无效、preview 在 HTTP/WS 前拒绝、两类 render 参数分离、版本判断及失败处理。
- 真实账户本轮仅 controller→WebSocket→浏览器→Tampermonkey→Suno→返回的两条 GET，各 controller dispatch 一次。版本响应 HTTP 200；版本列表 HTTP 200。没有额外 live getter 测试请求。端到端实验不同于静态分析或 unit transport double，不把 test double 当真实 fixture。
- 默认 tests/studio-read.integration.mjs 跳过，原 live/library integration 默认关闭。本轮不重复扩大真实测试，不以读取成功证明写许可。d.ts 未执行 TypeScript 编译，不将运行时单测当类型编译。
- 初始严格 state digest 比较不相等，后续复核定位唯一 transport mask 为 $.timeSignatureChanges；在不重复 GET 的前提下匹配基线隐私投影，保留首次日志和独立 assessment，不改写失败记录为伪造原始成功。
- 原 Downloads JSON、ignored raw capture copy 和 tracked 脱敏 fixture SHA 均复核不变，见 fixture-integrity.json。

## 问题、风险与未解决事项

1. **重要：音乐 timeSignatureChanges 被现有 v1.3.15 隐私 regex 中 signature 误掩码。** 网络只读关联已确认，但该响应不是无损 wire state。当前边界拒绝所有含 redacted/omitted 的写准备，不能将 version GET 返回 state 直接保存。修复隐私规则并验证浏览器/后端无损读回是未来写验证前置条件；本轮没有改动或更新已安装 userscript。
2. 官方 serializer 尚未作为本地业务实现移植/验证。adapter 仅接收 JSON-compatible snapshots，并非恢复整个官方 editor runtime；错误 adapter 仍可能丢字段，品牌只防流程混用，不证明转换语义正确。
3. GET version response 类型描述限本次实际结果；未知字段保留。两个 render response fragment 只是静态局部消费，不是完整响应契约。多轨 signed URL 不可从脱敏日志重放。
4. 通用 SunoBridge/raw-call 仍具人工显式调试能力；StudioClient 的默认拒绝不能阻止使用者另外直接调用 raw transport。默认测试均不真实 dispatch Studio POST。本轮不提供写 integration-test gate。
5. 初次当前3000已占用，未停止该现有进程；临时3001 controller 用于本轮配对，完成后已停止，并关闭本轮创建的 bridge 标签页。用户启用 v1.3.15 后后端确认 bridge在线/auth ready/version/build；配对码只作临时本地能力，不进日志或交付包。controller 仅派发各读请求一次；未额外执行扩展网络去重审计。原3000进程没有热重载本轮源码，今后使用新 controller preview guard 须正常重启 controller；本轮 GET 实验在旧 transport 上完成，没有对其发送 preview 或写请求。
6. revision 未有实际 ID，不从 version 推断。没有新建/保存/导出/下载测试，也没有持久化验证；完整 MVP 尚未完成。

## 后续具备写权限时：最少三个官方 UI 动作

每次先从稳定状态开始，marker 标记，capture pending/queue/drop 正常后只执行该动作，结束后单独分析，不混合其他编辑。

1. **create**：官方工程列表中新建一次空工程，记录实际 query/body、project/version IDs，GET 对照。历史默认创建不能替代当前行为。
2. **save**：现有测试工程移动一个已知 clip 一次，让官方保存，记录完整 serialized state、version_id，GET 新版本/project 检查位置、完整未知字段和版本持久化。
3. **export**：从已保存状态提交一次官方单轨导出，记录 render transformed state、不同 project/version IDs、clip 响应和官方后续结果。多轨下载属于另一个独立可选动作，不从单轨成功推导。

不绕过权限，不改 subscription/entitlement，取得真实成功请求后再逐个受控 replay，未验证之前写入口保持拒绝。

## 证据与交付

- 实际结构和状态：captures/version-verification/20261005/version-read.json、version-assessment.json、versions-list.json；全是摘要/schema，无认证头或完整私有响应。
- 代码：suno/studio/{operations,api,models,state-boundaries,request-builders}；实验 scripts/verify-studio-{version,versions}.mjs；单测 tests/studio-boundaries.test.mjs；默认关闭的 tests/studio-read.integration.mjs。
- 文档：docs/STUDIO_API_MAP.md、docs/STUDIO_WRITE_API.md；原 fixture/provenance 保持不变。
- 本次 task-only patch：deliverables/SUNO_STUDIO_READ_BOUNDARIES.patch；以本轮基线为起点，仅包含本次修改。
- 证据包：deliverables/SUNO_STUDIO_READ_BOUNDARIES_EVIDENCE.zip，独立 .evidence-staging/phase1-studio-read-boundaries-20261005 目录构建，含本报告、最小 schema/摘要、test logs、manifest/hash、fixture integrity 和 patch verification。无完整源码、raw响应、依赖、cache、历史ZIP、认证/配对码；patch 和 ZIP.sha256 独立。打包后校验 CRC、每文件 SHA、重复/嵌套和敏感信息。
