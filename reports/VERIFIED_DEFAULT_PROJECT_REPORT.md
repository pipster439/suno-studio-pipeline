# 默认空工程创建与元数据读取验证报告

日期：2026-10-05（Asia/Shanghai）。本轮基线 commit：`98b0073ca7578b09246f663de07e89cce3a3652b`，开始时仓库无未提交改动。

## 结论

已完成 backend → browser → Tampermonkey → Suno → browser → backend 的真实默认创建重播一次，HTTP 200。新工程 id：`5595bf9c-3967-403b-bda0-5a1b9a4adaff`。随后 controller GET、官方 GET、StudioClient GET 的元数据均与创建响应完全一致；官方列表含新 id，打开对应最新工程后显示默认标题、播放头 00:00.000 和可见空 timeline。

默认空工程创建和工程元数据读取提升为 **VERIFIED**，范围限 `title=Untitled Project`、`major_version=2` 和 metadata。完整 timeline/clip/素材/保存/导出仍 UNKNOWN，完整 MVP 尚未完成。官方页面仍显示 Preview / Upgrade to edit，编辑权限尚待用户确认。本轮仅新增上述一个测试工程，未进行其他 Studio 写入。

## 主要变更

- `suno/studio/api.mjs` 集中登记两项已验证协议，证据和范围见 API Map；不把 endpoint 写入 Tampermonkey。
- `StudioClient.create_project()` 省略 body，不自动重试，仅支持验证过的默认标题及版本；其他参数组合抛 NotImplementedError。
- `get_project_metadata(id)` 校验本地单路径 ID、响应已观察字段类型和返回 id，保留额外字段。`get_project()` 仍未实现，避免将 metadata 假装成完整 timeline 状态。
- 未验证的 add_audio/add_clip/move/trim/update/set_timeline/save/export 保持 NotImplementedError。
- 增加未验证参数拒绝、不安全 ID 拒绝、失败不重试、错误返回 ID 检测及未知字段保留测试；无模拟 Studio HTTP endpoint。
- API Map、README、工作台状态文案更新；生成本报告、任务专属 patch 与独立小型证据 ZIP。不改 userscript，无需重新安装。

## 验证与测试结果

1. 真浏览器 auth ready v1.3.15，buildId 与本机生成脚本相同；bridge 在线，capture 开始前未开启。
2. `POST /api/studio/create-project?title=Untitled%20Project&major_version=2`，body 省略，requestId=`0d2d8754-8fda-450b-ab3b-6c8fc767daca`。真实响应 200，浏览器 durationMs=1217；仅一个写尝试，未自动重试。
3. GET 已观察的 `/api/studio/project/<id>` 路由，将实际返回的新 id 作为路径段，HTTP 200，metadata 与创建响应深比较完全一致。
4. 官方 Project menu → Open Project：捕获 001 `GET /api/studio/list-projects`，响应 projects 的最新条目为新 id。按官方 Newest First 列表打开该条目；005 实际 GET 新 id、006 conversation 路径也含新 id，确认打开对象。工程列表仅 OBSERVED，未实现或重播列表 API。
5. 官方页面对话框关闭，标题 Untitled Project，00:00.000，只有 Main，无可见音轨或 clip，截图及 DOM 文本归档。该 UI 证据不建立未观察的 timeline JSON 模型。
6. 新增 StudioClient.get_project_metadata 经真实 bridge 读回并深比较成功。typed create 沿用本轮已重播的相同协议，未为了测试方法再创建一个工程。
7. 被动 capture `2026-10-04T17-57-48-725Z-012f905d` 已停止，7 对记录；停止前 recorder online，pending/queued/dropped=0。JWT/Bearer heuristic 扫描 15 个文件无疑似命中。
8. `npm test`：16 passed，0 failed；普通单元/本地集成测试不调用真实账户。新增测试使用 transport stub 检查拒绝/契约行为，不能替代上述真实证据。
9. 两个 Studio 源文件 node --check 及 git diff --check 通过。任务独立 patch 以本轮基线 git apply --check 验证；证据 ZIP 从独立 staging 构建并检查 CRC/条目哈希/重复/嵌套/白名单。最终结果见 manifests/validation.json。

## 发现的问题与风险

- 官方 UI 仍为 Preview / Upgrade to edit。创建和只读 metadata 成功不证明素材/clip/保存/导出权限；未点击升级、付费或绕过限制。
- 实际 metadata 仅 id/title/created_at/updated_at/archived/major_version，不能验证完整 timeline 持久化。UI 只证明当时可见空工程。
- v1.3.15 已真实安装运行，但本轮官方 query 为列表/会话参数（均非白名单），没有另一次官方 create-project 来证明白名单 query 的实地输出。白名单的双重脱敏行为由此前 producer→store 契约测试验证；不将 controller intent 当成官方 query 捕获。
- controller 的 GM 重播不会经过官方 fetch/XHR hook，所以创建和读回回执明确标注 source，单独保存；7 对被动 capture 不是 7 次 controller 调用。未伪造 fetch 事件或插入虚假录制记录。
- 创建参数来自上轮真实观察和用户 Query String Parameters 确认。自定义 title、其他 major_version 不开放，避免将未复现范围误标 VERIFIED。
- 测试工程已存在于真实账户，本轮没有删除。超时/断线/取消无法撤销服务端写入，源码没有自动写重试。
- 浏览器/服务器时钟存在约数秒差异；只用 requestId/eventId 和同源 duration 比较，不跨时钟推断精确因果。
- 日志与 ZIP 不保存 authorization、cookie、JWT、device token、签名 query 或本地配对 key。字段脱敏与 JWT/Bearer 扫描不能证明任意未知 opaque secret 都能识别。

## 未解决事项

当前完整 MVP 尚缺素材加入 timeline、位置修改、保存后重载验证；这些接口仍 UNKNOWN。下一轮先由用户确认是否有可编辑 Studio 工程，再只观察“添加一个已有音频”。此前空工程创建验证不授权绕过 Preview 限制，也没有发现可用的编辑 API。

## 重要证据与产物位置

- `G:\Suno\docs\STUDIO_API_MAP.md`：已验证协议、作用域及历史观察。
- `G:\Suno\captures\2026-10-04T17-57-48-725Z-012f905d`：7 对被动官方请求，核心 005 metadata GET，006 关联新 id。
- `G:\Suno\.evidence-staging\phase1-create-replay-20261005\evidence`：create-attempt/result、read-attempt/result、metadata 比较、StudioClient 真实读验证、capture 终态、官方列表中新 id 的有限提取、官方 UI 文本。
- `G:\Suno\.evidence-staging\phase1-create-replay-20261005\screenshots\created-empty-project.jpg`：实际打开后的可见空 timeline 与 Preview 状态。
- `G:\Suno\reports\VERIFIED_DEFAULT_PROJECT_REPORT.md`：本报告。
- `G:\Suno\deliverables\SUNO_VERIFIED_DEFAULT_PROJECT.patch`：仅本轮基线之后源码/文档改动。
- `G:\Suno\deliverables\SUNO_VERIFIED_DEFAULT_PROJECT_EVIDENCE.zip` 与 ZIP 外部 `.sha256`：报告和必要小型证据，不包含 patch、源码仓库、依赖、完整私人工程列表/对话或旧交付包。
