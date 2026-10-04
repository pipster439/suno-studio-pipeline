# Suno Recorder 业务 query 白名单报告

日期：2026-10-05（Asia/Shanghai）。本次任务基线 commit：`f49947f5ee69bf1a010010ddf4fa1cb4cb4b459e`，基线工作区干净。

## 结论

按用户授权添加 title、major_version、project_id、clip_id、offset、duration、position 的 URL query 白名单。浏览器 recorder 与后端使用同一共享代码；白名单保留业务值并保留重复 query 键的顺序。认证、cookie、token、device、签名等规则继续生效。已生成 v1.3.15，controller 已重启加载新策略，浏览器安装更新等待用户完成。

14 项单元/本地集成测试全部通过；默认真实集成测试跳过。重启后的显式真实 Suno 只读会话 probe 通过，约 1.4 秒。本轮未重播创建工程，所有 StudioClient 操作仍未实现，创建候选继续 OBSERVED。

## 主要变更

- `shared/privacy.cjs`：仅普通 `https://studio-api-prod.suno.com` URL 放行 7 个精确小写 query 名称；其余 query 值掩码。外部 URL 或包含 signature/sig/X-Amz/X-Goog/policy/key-pair-id/token/credential 参数的 URL 全部 query 值掩码。
- 值仍经过嵌套 URL/JSON、JWT、Bearer 和可识别 credential 文本清理。白名单不覆盖 headers，也不扩张凭据字段的权限。
- JSON 请求体/响应体中这些业务字段原本就保留，本次未将它们写死成 Suno 业务模型或新增未观察接口。
- `scripts/build-userscript.mjs` 版本升至 v1.3.15；生成脚本 SHA-256：`286f722e5ac36926655360d7397336ef223133100db6421343bdedb92e5b7547`。
- 测试覆盖普通/相对 URL、双重脱敏、全部白名单字段、重复 query、未知参数、外部/签名 URL、伪装在业务值中的可识别凭据、浏览器 recorder 到 CaptureStore 真实契约。
- README 更新脱敏说明；保留此前 capture 原文件，旧日志中的掩码不会被反向恢复。

## 验证/测试结果

- `npm run build:userscript` 成功。
- `npm test`：14 passed，0 failed，覆盖 correlation/timeout/cancel/reconnect/error parsing 与新增白名单检查。
- 首次新增测试错误地假设 XHR 固定对应 002；实际序号按完成顺序分配。修正为读取 source 匹配 XHR，保留字段断言，不更改生产行为。修正后全部通过。
- `npm run test:live` 默认 1 skipped；显式 `RUN_SUNO_INTEGRATION_TESTS=1` 后 1 passed，真实只读会话 probe 约 1409ms，没有保存 Suno session 响应或认证头。
- `node --check shared/privacy.cjs`、生成 userscript 的语法检查、`git diff --check` 均通过。
- controller 维护重启前 capture 已关闭；同一次工作会话的本地配对能力仅在进程内存中保留以便 browser bridge 自动重连，不写入后端磁盘。浏览器实测重连在线，auth ready v1.3.14。
- 本轮独立 patch 对起始基线执行 `git apply --check`；独立 staging ZIP 执行 CRC、条目哈希、重复/嵌套和条目白名单检查，最终结果见证据包 manifest。

## 发现的问题与风险

- 当前真实浏览器仍运行旧版本，尚未实际验证 v1.3.15 官方请求捕获。单元契约测试与 browser 真实更新证据必须区分。
- 白名单按名称保留业务信息。标题和项目/clip ID 会成为本地日志内容，符合本次用户授权；分享 capture 前仍需检查。
- 自动规则识别常见 credential 命名与 JWT/Bearer 格式，不能保证识别放在业务字段中的任意 opaque secret。不会声称脱敏可证明任意秘密不存在。
- 仅 7 个 query 名称放行，尚未观察的字段继续掩码。白名单名称不等于 Suno API 字段已确认；offset/duration/position/clip_id 等业务语义仍 UNKNOWN。
- 签名 URL 的保守检测不能证明穷尽所有签名协议；外部 URL 的 query 全掩码。此前 recorder 的作用域、队列和未覆盖通道限制不变。
- controller 原有用户脚本认证缓存仍位于 Tampermonkey；没有将 JWT/cookie/device token 转移到后端。

## 未解决事项

用户在本地页安装 v1.3.15，并刷新 Suno 与本地页至 auth ready v1.3.15 后，验证实际新 capture 可保留业务 query。此步骤需要用户在已配置的 Tampermonkey 中更新脚本，不是要求再次批准业务接口。

之后继续一个创建实验：重播已观察且用户确认 query 的 `POST /api/studio/create-project?title=Untitled%20Project&major_version=2`，不强制发送 JSON null，不自动重试写请求；读回工程元数据并比较官方 UI。重播/效果确认成功之前不提升为 VERIFIED，也不实现 StudioClient。等待安装期间未执行真实 Studio 写入。

## 重要证据/产物位置

- `G:\Suno\shared\privacy.cjs`：两端共享策略。
- `G:\Suno\reports\BUSINESS_QUERY_ALLOWLIST_REPORT.md`：本报告。
- `G:\Suno\userscripts\local-transport.user.js`：本地生成安装文件（不纳入 Git 或证据 ZIP）。
- `G:\Suno\deliverables\SUNO_BUSINESS_QUERY_ALLOWLIST.patch`：本次基线之后的改动，不混入之前阶段。
- `G:\Suno\deliverables\SUNO_BUSINESS_QUERY_ALLOWLIST_EVIDENCE.zip` 与外部 `.zip.sha256`。
- `G:\Suno\.evidence-staging\phase1-whitelist-replay-20261005`：独立证据 staging，只含本报告、测试摘要、manifest、哈希与必要小型证据，不包含源码副本、旧交付包、依赖目录、配对 key 或认证凭据。
