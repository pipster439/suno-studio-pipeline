# 创建工程第二轮观察报告

日期：2026-10-05（Asia/Shanghai）。本轮基线：`6ef238cb4cb71c528601f1d42f02589275ff1a2e`，开始时仓库无未提交改动。

## 结论

官方重复操作捕获到一次真实 `POST /api/studio/create-project`：039 返回 HTTP 200，id 为 `e6b9e167-14c3-4f44-a3b1-d28d2cb4016f`，title 为 Untitled Project，major_version 为 2。用户明确确认其提供的 title/major_version 来自 Query String Parameters；请求参数证据已补齐。状态保持 **OBSERVED**，没有 controller 创建重播、没有 VERIFIED 业务接口或 StudioClient 新实现。

## 主要变更

- API Map 追加第二轮独立创建候选、响应 schema、重复比较、用户确认的 query 来源与待重播路径。
- 封存本轮 capture，生成本报告、仅本轮文档改动的独立 patch、小型证据 ZIP 和 ZIP 外部 SHA-256。
- 本轮未修改 userscript/controller/认证/脱敏代码，不需要更新 Tampermonkey。

## 验证与测试结果

- Capture `2026-10-04T17-25-08-444Z-7e83fae3` 已停止，45 对 JSON 全部可解析，45 对 eventId 一致，只出现一个 create-project 请求。
- 039 eventId 为 `e36cc270-01d3-4f72-a5db-462c304db8e6`；请求 UTC 时间 17:27:49.141Z，响应 HTTP 200，duration 约 302ms。
- 与首轮 005 的 method/path/query 键/响应结构一致，id 与时间不同；用户通过 DevTools 确认 title=Untitled Project、major_version=2，不从响应反推请求。
- 停止前 UI：bridge 在线、auth ready v1.3.14、recorder active、pending/queue/dropped 为 0；停止后 UI：recorder idle，capture count=45、active=false。
- 本 capture 91 个 JSON/Markdown 文件的 JWT/Bearer heuristic 扫描无疑似命中；这是模式扫描，不是任意秘密识别证明。ZIP 只收录创建配对与摘要，不收录账号/账单/session/library 响应。
- 本轮仅修改观察文档，没有重新运行既有代码单元测试或真实业务测试。交付检查包括 diff whitespace、基线 patch 可应用性、独立 staging 打包、ZIP CRC/哈希、重复/嵌套/条目白名单检查；对应结果见包内 logs/manifests。

## 发现的问题与风险

1. 元数据响应不含 tracks/clips/timeline。当前 UI 有 Audio Track 与非零播放头，不能从标题推断空工程语义或轨道持久化。
2. Capture 含重载、旧工程 GET 与周边 billing 请求；只有一个创建候选不代表整段只有一个 UI 动作。未把周边请求推断为素材/保存接口。
3. 中间曾出现 recorder heartbeat 过期，随后恢复 active；不能以停止时 0 dropped 宣称中间全部覆盖。新实验应在已加载页面确认 recorder active 后开始。
4. Query 原值仍在日志中脱敏。非敏感值来自用户明确确认的 DevTools Query String Parameters，不是 recorder 原值证据。
5. body:null 不证明必须发送 JSON null；创建重播的 body 发送细节尚未复现。
6. 官方页仍显示 Preview / Upgrade to edit，创建成功不证明后续素材、clip、保存、导出权限。没有升级、付费或绕过限制。
7. 浏览器和服务器时钟约有数秒差异，使用 eventId 和浏览器 duration 配对，不跨时钟推断精确因果。

## 未解决事项

单独重播已观察的创建请求，读回新工程元数据并在官方 UI 验证空工程效果，之后才考虑提升状态。其余 Studio 操作仍 UNKNOWN；未执行任何新的真实 Studio 写入。

## 重要证据与产物位置

- `G:\Suno\captures\2026-10-04T17-25-08-444Z-7e83fae3`：原始脱敏日志，核心 039 request/response。
- `G:\Suno\docs\STUDIO_API_MAP.md`：证据状态表。
- `G:\Suno\reports\CREATE_PROJECT_OBSERVATION_02.md`：本报告。
- `G:\Suno\deliverables\SUNO_CREATE_PROJECT_OBSERVATION_02.patch`：仅本轮从基线产生的文档改动。
- `G:\Suno\deliverables\SUNO_CREATE_PROJECT_OBSERVATION_02_EVIDENCE.zip` 及外部 `.sha256`。
- `G:\Suno\.evidence-staging\phase1-observation2-20261005`：独立 staging，包含报告、创建配对、摘要、用户非敏感参数确认记录、验证日志、manifest/哈希、capture 停止截图；不含 patch、旧交付包或依赖目录。
