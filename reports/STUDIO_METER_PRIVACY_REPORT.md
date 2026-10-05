> Historical stage report. Its then-current write availability/evidence conclusions are superseded by docs/STUDIO_SDK_STATUS.md and docs/EVIDENCE_HISTORY.md; original evidence packages are immutable.

# Studio 音乐 timeSignatureChanges 隐私过滤修复

> 后续收尾：2026-10-05 用户安装 v1.3.16 后，指定 version GET 已 HTTP 200 且全 state（包括展示标签）严格比对相等，timeSignatureChanges 无损、无掩码；见 [STUDIO_METER_LIVE_VERIFICATION_REPORT.md](STUDIO_METER_LIVE_VERIFICATION_REPORT.md)。下文 pending 是修复交接时的历史状态，旧日志/包不覆盖。

日期：2026-10-05，Asia/Shanghai。基线：0a96a92c5aed3e277f533129ca0cfeec72bb6547；开始工作区干净。

## 结论

shared/privacy.cjs 原 sensitive regex 中 signature 会误匹配 timeSignatureChanges。现仅对大小写精确的 JSON key timeSignatureChanges 增加例外，其值继续递归走同一过滤器；不改变 JWT、authorization、cookie、session/captcha/device、普通 signature、header 或 signed URL query 的策略。生成本地 transport/recorder v1.3.16，browser/server/reference recorder 仍共享同一规则。

真实 Studio project fixture 含 timeSignatureChanges=[{subdivisionsPerBar:4,startBeats:0,beatsPerSubdivision:1}]。49 项单元测试确认 fixture 的全部值经浏览器与后端双重过滤仍完整相等；不是仅比较字段存在。原 fixture 与 Downloads raw source 不修改。

## 主要变更

- 精确 JSON key 例外，值仍递归过滤，禁止相似名称和 header/query 放宽；生成脚本版本为1.3.16。
- 真实 fixture/browser VM 双重过滤、credential/header/signed URL 负例、嵌套 JSON、实际生成脚本版本和 meter 响应契约回归测试。
- 旧 masked/omitted state 拒绝测试继续保留，改用明确的 legacy payload，不以新过滤输出伪造旧问题。
- version 只读实验增加原真实 JSON 全 state 严格比较（包括 title/name/未知字段）、logical requestId、timeSignatureChanges schema/相等性、无掩码检查，以及 installed version/build 前置检查；没有原 baseline 或安装版本不符时零 Suno dispatch。
- 认证证据日志只保留明确 allowlist 的 ready、version、build 摘要。原始认证 header/token、原 response 值和原私有 state 不写日志，只在内存比较。
- README/API Map/Write API 同步修复状态；create/save/render/multitrack 默认仍 NotVerifiedError，preview 双层拒绝，不重扫 bundle、不发写请求。

## 验证/测试

- 49/49 单测 PASS，3 项真实集成测试默认 SKIP。包括原 fixture 所有值、同名/近似名、嵌套 credentials、headers/signed URLs、完整严格 state 比较、错误基线零 dispatch、旧掩码拒绝和现有所有 write/default guard。
- 动态验证记录尚待浏览器启用 v1.3.16；执行前必须后端确认 ready/version/build，且 controller 已加载本轮过滤器。不会用单元测试或旧 v1.3.15 投影成功代替新无损 wire 验证。
- 本轮最后检查为 bridgeOnline=true、auth ready=false/state=waiting、installed v1.3.15/buildId=a1dca8015d0a4e72e0356d42552dd5cf921106d6f7bb89719bc99afc9757d6f5。**本轮 Suno 请求数为0**；没有在旧脚本上重复 GET，也不因版本未更新就降低 gate。该证据只来自本地 status；后续真实验证必须另存新结果。
- 新生成 script v1.3.16 buildId=83bff4080144256f30f44d26a3b50bc8eabc698c8b0fda1c1c3748ef5d1c9ab8，脚本文件 SHA-256=0e541545bfa5ef2acdb895d30e5c553a180cd7ead0a2af0f5a91fb1a39bc4991；这是构建证据，不是安装成功证据。

## 问题与风险

- 旧 userscript、旧本地页或未重启 controller 任一仍加载 v1.3.15 规则，就可能继续掩码音乐字段。本轮使用新3001 controller，原3000不停止/不替换。
- 对非音乐 key 的凭据脱敏始终保留；音乐 key 的值仍过滤真实 token，因此“无损”只针对本次正常业务字段及实际数据，不意味着日志应保留 credential。
- serializer adapter 仍非已验证官方实现；read 成功不能解释为写权限、保存持久化或导出成功。掩码/omitted state guard 不删除。
- 没有真实 revision_id，不推测或调用 revision；没有未知写接口调用，没有账号权限变更，没有购买。
- 已通过 async 问题请求用户在 Tampermonkey 更新并刷新两个页面。浏览器工具不能访问扩展安装确认页，不能用其他接口绕过；目前缺少实际 installed ready v1.3.16。因此保留本轮3001 controller/bridge标签页作为交接，不结束/替换原3000；临时配对码不进日志/交付包。后续完成真实读验后关闭本轮临时进程/页面。

## 未解决事项与后续

必须完成当前真实 project/version 的新 transport 全 state 严格读验证，才能宣称该修复端到端无损。此后写 API 仍保持 FOUND_STATICALLY / High，账号具备正常写权限时仅逐一 capture create/save/export 三个官方动作，不因“继续”自动发送写请求。

## 证据与交付

- 单测/默认集成日志：.evidence-staging/phase1-studio-meter-privacy-20261005/logs。
- 动态读验目标：captures/meter-privacy-verification/20261005/version-read.json，只读结构与摘要。
- 本次 patch：deliverables/SUNO_STUDIO_METER_PRIVACY.patch。
- 证据包：deliverables/SUNO_STUDIO_METER_PRIVACY_EVIDENCE.zip，独立 staging 构建；报告、最小日志、manifest/hash、fixture 原哈希复核和隔离 patch apply 验证。没有完整源码、原响应、依赖、缓存、历史ZIP或凭据；patch 和 zip.sha256 独立。
