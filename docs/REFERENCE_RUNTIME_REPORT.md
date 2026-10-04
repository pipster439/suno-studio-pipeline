# 参考客户端未付费观察与本地链路复验

日期：2026-10-05（Asia/Shanghai）。任务开始基线：`a2a182a`，工作区干净。此前静态分析与 recorder 实现是已提交内容，不混入本次 patch。

## 结论

本地页面真实显示 Suno auth ready、版本 v1.3.15；显式真实集成测试通过，验证 backend → browser → Tampermonkey → Suno → backend 的只读 `/api/session/` 调用。未保存返回的账户内容或认证头。这个结果证明通用 transport 恢复可用，不证明新的 Studio 业务能力。

参考网站在积分为 0、工作流未开放的正常状态下打开“项目”，观察到网站 `GET https://sunouploader.site/api/projects` 返回 HTTP 200，响应包含 `projects: []` 和 `auth` 对象。auth 内容不留存，仅保留对象类型；请求/响应 header 值全部脱敏。网络 responseReceived 耗时 736.542 ms，loadingFinished 耗时 735.094 ms，两者按各自 CDP 时间计算，不强行合并。

这次观察窗口的 request/response/cancel CustomEvent 计数均为 0，没有新增可重播的 Suno Studio 请求。没有购买、兑换、上传、提交付费工作流或修改套餐/权限，也没有绕过 Preview/Upgrade 或网站付费限制。

## 主要变更

- 新增本报告，并在 API Map 记录新的运行时证据与明确的证据类别。
- 两条真实 DevTools 网络记录，经现有 localhost `/api/reference/events` 入库，后端分别确认 count=1/2；capture 已停止，事件文件及 timeline/summary 实际存在。
- 本次入库链是 **DevTools network → agent 的本地 HTTP relay → reference store**，不是生产 GM observer。记录明确注明 `devtools-network-relay`，不将其冒充 Tampermonkey recorder 的完整端到端验证。
- 本轮未交付新的源码功能、未知 endpoint 或 StudioClient 方法；临时 DevTools adapter 实验已撤回。已有静态分析、recorder 和 replay 代码保持原样。

## 验证与证据

- 显式开启 `RUN_SUNO_INTEGRATION_TESTS=1`：真实只读集成测试 1/1 PASS，证据 `captures/reference-runtime/20261005/live-test.log`。其返回回执不含账户 body。
- 最终单元/本地 HTTP/WS 测试 22/22 PASS；真实测试默认 1 项 SKIP，见同目录 `tests.log`、`live-default.log`。
- 本轮真实 runtime 回执：`captures/reference-runtime/20261005/runtime-receipt.json`。
- 实际事件目录：`captures/reference/2026-10-04T19-42-34-384Z-6a1c8d55/`，仅两个网站 backend 事件；对应 marker 为 operator action label，时间源是 CDP request wallTime 与网络 monotonic 时间，不声称来自生产 recorder 面板。
- 已移除三个临时事件监听器，删除临时观察对象、移除 CDP binding，并关闭 Network/Runtime instrumentation；没有遗留 fetch/XHR 改写。
- 静态分析结论及函数/参数/调用关系仍见 `REFERENCE_CLIENT_ANALYSIS.md`。已收到的 8 个 JS 资源中，解析出 14 个实际通用 transport 调用点和 40 个网站 JSON helper 调用点；Studio 合并/重新导出指向网站自己的 `/api/merge`、`/api/export`。这些网站 backend 不是 Suno Studio API。
- 既有公共源码哈希与函数 offset 只适用于此前取得的副本，本轮未重新获取全量资源或宣称跨版本稳定；WASM 二进制仍未取得。

## 发现的问题、风险与未解决事项

1. 浏览器工具拒绝访问 Tampermonkey 扩展协议安装页，安装由用户完成；不改用全局 Computer Use 或 CDP 绕过该限制。当前已观察到 v1.3.15 ready。
2. 浏览器仍显示旧 v1.3.11 面板，未证明旧版在所有来源都已禁用。因此本轮仅执行只读请求，不能保证共享事件链只发出一次上游请求；后续写入实验需先消除旧 listener 冲突。本轮没有读取/更改扩展设置或向参考网站主动同步认证。
3. 独立 reference recorder 尚无真实 GM 安装/投递证据。本轮临时 adapter 单元实验通过，但 localhost 文本资源导航被浏览器报 `ERR_BLOCKED_BY_CLIENT`，随后压缩源码部署实验失败，未创建 observer。实验代码和生成文件已撤回，没有将失败结果算作浏览器验证成功。
4. 网站后端如何产生 Suno track/clip/timeline/save/render 请求仍 UNKNOWN。收到的前端和此次正常导航没有暴露这些 schema；不猜 endpoint、不调用受费控端点补证据。
5. 已有创建默认空工程/读取 metadata 的 VERIFIED 范围保持不变。完整素材→timeline→改位置→保存→重新读取 MVP 仍未完成，不能用 metadata 读取替代完整工程持久化验证。
6. 网站原脚本已有第三方认证同步能力；独立 observer 不提供该能力，但不能据此保证原网站不保存认证。交付证据不包含真实 Suno auth、cookie、JWT、device token、本地配对能力或账号标识。

## 交付物

- 报告：`docs/REFERENCE_RUNTIME_REPORT.md`。
- 本轮独立 patch：`deliverables/SUNO_REFERENCE_RUNTIME_VERIFICATION.patch`，只含基线后的本轮文档变更。
- 单一证据包：`deliverables/SUNO_REFERENCE_RUNTIME_VERIFICATION_EVIDENCE.zip`；从独立 staging 构建，仅含报告、测试日志、脱敏回执/事件、manifest/hash，不含源码副本、依赖、临时 adapter 或历史交付包。
- ZIP SHA-256 位于压缩包外部 `.zip.sha256` 文件。内容检查与 patch 独立应用验证见包内 `logs/verification.json`。
