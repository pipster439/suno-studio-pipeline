# 创建工程首轮观察报告

日期：2026-10-05（Asia/Shanghai）。基线 commit：`cf4346b756e3e50e4b7a007171e7538f6b33fa06`。本轮用户反馈“已点击”，任务为分析既有捕获，不代替用户进行创建/编辑。

## 结论

观察到真实 `POST /api/studio/create-project`，query 键为 title、major_version，request body 均记录为 null。005/010 两次均 HTTP 200，返回两个不同工程 id 和不同标题。本轮状态 **OBSERVED，不是 VERIFIED**。没有通过 controller 重播创建，没有新增 StudioClient 实现。

当前页面显示第二个工程标题、Preview / Upgrade to edit，New Project 对话框再次打开，里面存在 New empty project 按钮。因此不能将整段 capture 与一个单独点击严格一一归因，也不能断言第一工程的 tracks/clips/timeline 为空。下一轮只观察明确的 New empty project 按钮。

## 主要变更

- API Map 新增实际创建候选、query 键、null body 观察、响应 schema、两工程 id、请求时间、后续元数据读取、状态与缺失证据。
- README 和页面文案从“全部 UNKNOWN”调整为“尚未 VERIFIED”，不提前宣称业务实现。
- 本报告和独立本轮 patch；独立 staging 中的证据包只包含相关小型 request/response、摘要、日志、manifest 和哈希，不混入上一轮交付包或完整 captures。
- 未修改 userscript、认证机制、controller、脱敏策略或 StudioClient，不要求再次安装脚本。

## 验证与测试结果

- 原 capture `2026-10-04T17-12-20-853Z-7e336b24` 已停止，51 对完成记录。界面观察 pending=0、queued=0、dropped=0、ingress error 无；记录完整性指标正常，操作归因仍不干净。
- 005 request/response eventId 相同，响应 id=bea1ee72-b47f-4d8f-b43d-b16d2adfd056，title=Untitled Project。
- 010 request/response eventId 相同，响应 id=1cded173-6e85-4db7-9aeb-7d3b7f4f1163，title=When the City Finally Sleeps。
- 038 official GET 返回第二个 id 相同的 metadata，与创建响应的 id/title/created_at/updated_at/archived/major_version 一致。
- `check-captures.mjs` 扫描本 session 的 103 个文件：JWT/Bearer heuristic 无疑似命中；只代表指定模式扫描结果，不证明任意未知 opaque secret 都可识别。
- 本轮只改观察文档和静态文案，不重新运行既有 12 项测试来假装新增真实业务验证。检查 diff、JSON 解析、请求响应配对、metadata 一致性、独立 patch 可应用性和证据包 CRC/哈希/重复/嵌套规则。

## 发现的问题与风险

1. 同一会话两次创建，相隔约 6.3 秒。没有足够可信的逐次点击标记，不能替用户推断准确动作序列。默认标题是候选依据，不是空 timeline 的证明。
2. 所有 URL query 值已脱敏。title/major_version 的实际 request 值未知；响应 major_version=2 不能代替请求参数证据。不能用 `<redacted>` 重播，也不能猜值。
3. body:null 不能区分不存在 body、显式空值等底层细节。未来 raw-call 是否省略 body，需要再次观察。
4. 响应时间/created_at 来自不同客户端/服务器时钟，存在数秒差异。使用 eventId 配对和浏览器请求时间/duration 排序，不跨时钟作精确因果推断。
5. 官方 GET 只返回 metadata，没有 tracks/clips/timeline。当前并未确认完整工程读取、素材插入或保存协议。
6. 页面继续显示 Preview / Upgrade to edit，创建候选成功不能证明后续编辑权限。未点击付费、升级或绕过限制。

## 未解决事项

隔离重复 New empty project 操作；取得已观察 query 名称对应的非敏感值；确认“空工程”的 UI/数据状态；再确定是否进行显式重播和读回。其他 Studio 操作仍 UNKNOWN，现阶段不做下一种业务动作。

## 证据位置与下一步

- API Map：`G:\Suno\docs\STUDIO_API_MAP.md`。
- 原捕获：`G:\Suno\captures\2026-10-04T17-12-20-853Z-7e336b24`，核心配对 005、010、038。
- 报告：`G:\Suno\reports\CREATE_PROJECT_OBSERVATION_01.md`。
- 交付：`G:\Suno\deliverables\SUNO_CREATE_PROJECT_OBSERVED.patch`、`SUNO_CREATE_PROJECT_OBSERVED_EVIDENCE.zip` 及 ZIP 外部 `.sha256`。
- 独立 staging：`G:\Suno\.evidence-staging\phase1-observation1-20261005`。
- 下一步从已经打开的 New Project 对话框开始，DevTools Network 只筛选 create-project，再只点击 New empty project 一次。完成后反馈是否创建成功、工程标题，以及仅 title/major_version 两个 query 值。不要复制认证头/cookie/token、整条 URL 或 HAR；不要选歌曲、添加素材或编辑。
