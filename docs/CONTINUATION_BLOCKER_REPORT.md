> Final RC update: backend core create/save/render submission is VERIFIED; official tested Free UI remains blocked. Browser Harness is LIVE VERIFIED / COMPLETE / FROZEN. This retained phase procedure is historical; see STUDIO_SDK_STATUS.md.

# Studio 完整流程阻塞与完成性审计

日期：2026-10-05，Asia/Shanghai。本轮基线：`11ce0f45f07b219336419449eed13a745b7fbbb1`，工作树开始干净。目标仍为真实可验证的 controller/recorder/bridge 与 Studio 素材→timeline→移动→保存→重读流程，不把只读素材库阶段作为完整 MVP。

## 结论

Browser bridge/auth ready v1.3.15，官方 recorder 已能实际落盘，素材库已验证。继续自主检查完整工程状态读取的 UI 路线，发现 Project menu 无历史入口，Share Project 在进入公开版本查询组件之前显示 Premier 升级提示。关闭该提示，没有订阅、改名、复制分享链接或请求静态候选 endpoint。完整工程版本状态没有新增证据，API Map 未提升任何状态。

同一 Preview / Upgrade 编辑权限限制已在前两轮官方静态分析、素材库验证以及本轮实际 UI 中连续存在。前两轮仍取得了新源码/读取证据；本轮复核剩余只读版本入口后，已无能够完成 Studio 写入/持久化验证的可用合法流程。继续调用受限制的静态 write/version 模板、伪造字段、制造隐藏权限均不满足用户要求。因此 full goal 应标记 blocked，而不是 complete 或自行 paused。

## 本轮实验与证据

1. 当前官方 `https://suno.com/studio`，Untitled Project，Preview / Upgrade to edit，空 timeline/Main，Library 仍打开。现有实际读取对象为自有工程 341de3bf-fceb-44e5-a6d5-b94793385dfc；没有据此断言它与此前 disposable 5595bf9c… 相同。
2. 开始 capture，確認 online、activeSession 匹配、pending/queued/dropped=0；只打开 Project menu。可见 New Project、Open Project、Rename、Duplicate Project、Share Project、Studio Settings，没有历史按钮。capture `2026-10-04T20-40-57-476Z-57326dfc` 已停止，0 对。
3. 已收到的公共 `0ureacebq_re1.js` 在 offset 18545 周边包含 Share modal effect：GET versions，project_id 来自 props，return_days_only=false，解析 aggregated_versions/version_id。offset 28594 周边为版本列表 query。只读取本机已接收公共代码，未执行它、未枚举隐藏资源。Share modal 本身生成本地 URL 的源码不能证明当前允许进入该组件。
4. 独立 capture `2026-10-04T20-41-52-928Z-e860e668`，label `read-only-version-list-dialog-02`。确认 recorder 已收到 marker 后只点击可见 Share Project。Loading 随后变为 Premier 订阅提示：Studio / Your complete creative workspace. Available with Premier. / Subscribe。没有版本请求。唯一官方 API 记录是 GET `/api/billing/eligible-discounts`，2026-10-04T20:42:03.469Z，HTTP 200，1103.26 ms；其响应正文不交付，不重播，不加入已验证 registry。
5. 只点击 Close 关闭提示，原工程仍处 Preview，capture 已停止共 1 对。没有账号或工程修改。原日志只覆盖官方页面 fetch/XHR 范围，0 条版本记录不证明浏览器所有网络均被观察到；可见 gate 和未获得状态共同构成当前无法验证该流程的依据。

本轮尝试 CLI `status` 得到本地 unsupported-command 输出，该命令不存在；后续通过已有 /api/status（临时 localhost 配对 header）取得真正在线状态，没有更改或重启 controller。此局部命令错误不影响 capture，但不应表述为 CLI status 成功。临时 key、auth/cookie/JWT 不进入报告或证据包。

## 原始要求的完成性审计

| 要求 | 当前证据与范围 | 结论 |
|---|---|---|
| 完整审计原 userscript；CURRENT_ARCHITECTURE.md | vendor 保留源与根目录架构说明；认证/取消/401/token/Cover/download/audio 范围已记录 | 已有交付；保留能力不等于本轮实测每个业务功能 |
| localhost controller + HTTP/WebSocket browser bridge | SunoBridge/hub/server/web 实现；真实 auth ready、通用 request/response 往返、取消/超时/关联测试 | 基础设施已验证 |
| 官方 recorder 时间、method/path、脱敏 headers/body、status/body、duration | 真正官方 recorder 实际 capture；本轮 0/1 对；前轮 Library 6 对 | 已验证覆盖范围内可工作；非 Worker/iframe/完整 wire capture |
| 参考网站低侵入 recorder、markers、console events 与 backend 区分 | reference-recorder/store/replay 与测试已实现；公共代码和未付费导航得到网站 projects GET；运行时 console 事件为 0 | 独立 GM 脚本浏览器安装/生产投递仍未证明；没有实际 Studio 写请求 |
| 公开 JS/WASM 静态分析 | reference 8 JS、official 117 JS，AST 模板与调用关系；已加载 WASM 名称但未分析二进制 | JS 工作已有证据；不声称 WASM 逆向完成 |
| 逐个实际 Studio 操作识别、状态标注 | create + metadata VERIFIED；本轮版本候选仍 UNKNOWN；不猜 endpoint | 创建/读取 metadata 有证据，clip/position/save/export 缺少成功运行时与复现证据 |
| SunoBridge.call GET/POST/PUT/PATCH/DELETE、timeout/cancel/correlation/errors | 通用层与单元/真实 WebSocket 测试、真实查询往返 | 已有验证，不证明 Studio 内部 schema |
| raw-call 与仅 VERIFIED StudioClient | 默认 create + metadata 实现；未验证 get_project/add/move/trim/update/timeline/save/export 抛 NotImplementedError | 符合证据约束，业务范围未完成 |
| 添加已有素材、加入 timeline、移动、保存、重读确认 | LibraryClient 真实返回同一组 4 song_schema；没有 timeline 写入、version_id/revision state、持久化 diff | MVP 未完成；素材读取不能替代添加/保存 |
| export（如已确认才实现） | render 静态表达式，未确认实际成功 | 未实现，符合禁止猜测要求 |
| README、安全日志、真实测试默认关闭 | 依赖/启动/安装/捕获/重播/测试与磁盘核验说明；JWT/Bearer 文本启发式检查与双侧 redaction | 已有交付；未知 opaque secret 仍需人工/字段审计 |
| 测试、分阶段 Git、报告/任务 patch/独立证据包 | 既有 29 单测通过、explicit library 1 PASS、默认 live 1 SKIP；本轮仅文档与证据，不改执行代码 | 本轮不重复跑不相关测试；输出 task-only patch 与独立包 |

这张表以当前源码、真实 capture 与既有执行日志为依据，不把报告文字或绿色测试当作完整业务验证。历史测试属于前轮提交的证据，本轮无重新执行；server/browser 当前在线状态另行现查。

## 风险与未解决事项

- 编辑/保存/版本入口被实际 Preview/Premier gate 限制。没有合法观察到一次成功编辑和保存，无法根据静态模板将写接口标为 VERIFIED；进一步验证需要外部状态改变，例如当前用户已有且有权限编辑的测试环境或可合法执行的参考客户端工作流。不是请求升级付费或修改权限。
- 参考网站已下发代码把合并/导出交给自己的 /api/merge、/api/export；未付费导航没有发出 Suno Studio console 请求。服务器生成的 state/参数不可从公开客户端臆造。
- 旧 v1.3.11 listener 是否停用仍未证明；即使后续有写入权限，也要先解决可能重复发送。浏览器明确阻止的 extension 安装页不能换 native/CDP 绕过，用户当前不能手动操作；不偷偷改变 extension 权限或安全设置。
- 本轮没有回滚服务器业务状态的需要。只新增报告和 API Map 阻塞证据，关闭升级提示、停止 captures，现有 controller 留在运行，当前 Studio 页保留。

## 交付

`docs/CONTINUATION_BLOCKER_REPORT.md` 和 `docs/STUDIO_API_MAP.md` 为本轮仓库变更。独立 `deliverables/SUNO_STUDIO_BLOCKER_AUDIT.patch` 从本轮基线导出，隔离应用后逐项比对目标 Git blobs；不混入历史阶段。

小型证据包 `deliverables/SUNO_STUDIO_BLOCKER_AUDIT_EVIDENCE.zip` 从独立 `.evidence-staging/phase1-studio-blocker-audit-20261005` 生成，仅报告、当前 captures 的时序摘要、脱敏 bridge 状态、静态模板出处/hash、当前要求审计与 patch 验证日志。原 billing/账号响应、完整源码/仓库、历史 ZIP、依赖、缓存、配对码不入包。外部 `.zip.sha256`、CRC/清单/哈希/重复/嵌套与已知私密值扫描验证随交付保留。
