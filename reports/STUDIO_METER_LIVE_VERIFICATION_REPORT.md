> Historical stage report. Its then-current write availability/evidence conclusions are superseded by docs/STUDIO_SDK_STATUS.md and docs/EVIDENCE_HISTORY.md; original evidence packages are immutable.

# Studio v1.3.16 只读 live verification 收尾报告

日期：2026-10-05，Asia/Shanghai。基线：dd8d280ed7e872df054a6a591ea6a2982e2975ec；开始工作区干净。实际 GET 时间：17:50:22（日志 UTC 09:50:22.558）。本轮仅执行用户授权的最后一次只读 version GET，不修改账号/工程/原 fixture，不继续静态扫描。

## 结论

**PASS：HTTP 200、VERIFIED、losslessState=true、maskedStatePaths=[]。** timeSignatureChanges 无损通过，响应全 state 与用户原始完整 GET JSON 的 state 严格相等（包括所有 title/name、未知字段和值）。这是规范化 JSON 值相等：忽略 object key 顺序，保留 array 顺序；不是字节相等，也不忽略展示标签。

| 记录 | 实际值 |
|---|---|
| Method | GET |
| Path | /api/studio/3ebbb451-08a7-4599-9885-788f0b8f5def/version/e491cbde-9266-4884-997c-3a9789877a56 |
| requestId | version-read-1791193822559 |
| HTTP status | 200 |
| Installed userscript | 1.3.16 |
| Build ID | 83bff4080144256f30f44d26a3b50bc8eabc698c8b0fda1c1c3748ef5d1c9ab8 |
| Response id | e491cbde-9266-4884-997c-3a9789877a56（version） |
| Response project_id | 3ebbb451-08a7-4599-9885-788f0b8f5def（project） |
| State presence | true；1 track、20 clips |
| 全 state 规范化 SHA-256（两侧相同） | 99aa0d597aa89363847448d837d12b71f08bad730c4dad36a420bb53c2903418 |

响应顶层 schema：id:string、project_id:string、created_at:string、state:object。state 的 timeSignatureChanges 为1元素 array，元素含 beatsPerSubdivision/startBeats/subdivisionsPerBar:number；字段与原真实 state 相等。完整字段结构在新实验 JSON 中，非根据字段清单拼造 fixture。

## 主要变更

- 不改运行时代码或 endpoint 实现；本轮执行现有 scripts/verify-studio-version.mjs 的 strict 模式，通过既有 SunoBridge/browser/Tampermonkey transport。
- 更新 README、STUDIO_API_MAP、STUDIO_WRITE_API 和隐私修复报告的后续链接，明确 pending 已完成；历史失败/交接记录及旧交付包保持不变。
- 单独生成本轮文档 patch、新证据包及外置 SHA-256；不混入上一轮隐私源码改动。

## 验证/测试结果

1. 前置本地 status HTTP 200：bridge在线、authReady=true、installed version/build 匹配，capture关闭；不导出认证头或 token。
2. 严格实验显式设置 RUN_SUNO_INTEGRATION_TESTS=1、要求v1.3.16/build匹配、指定原 Downloads JSON、SUNO_REQUIRE_LOSSLESS_STATE=1。只派发上述一条 GET，无自动重试；进程exit=0。
3. response.id/project_id 与指定真实 ID 相符；statePresence=true；全 state 严格摘要相等；timeSignatureChangesComparison.equal=true；maskedStatePaths=[]。
4. 原 Downloads JSON、ignored字节副本、tracked脱敏fixture 在实验前后 SHA-256 保持不变。原私有 state 只在内存比较；新日志/包只保存 schema、业务 IDs、哈希、结果和公开 build metadata。
5. 本轮运行时代码未变，不重跑上一轮49项单测或3项默认关闭的集成测试；这些旧测试结果不冒充本次 live evidence。仅此一次真实只读实验，无额外 getter/versions/revision 请求。

## 问题与风险

- v1.3.15 误掩码在此次 v1.3.16/current project/version 上已实际消除。不声称所有未知未来字段/大型payload/凭据字段都无损；原安全脱敏和size/depth限制仍存在，写准备继续拒绝掩码/omitted state。
- 所有写 endpoint 均 FOUND_STATICALLY / High。create/save/render/multitrack 及别名仍 NotVerifiedError，preview 仍网络前拒绝。此次读取不证明账号写权限、serializer adapter正确性、保存持久化或导出成功。
- 本轮记录 controller 派发一次，未额外进行扩展GM网络去重审计。没有未知ID或endpoint枚举。
- 只读收尾后停止本轮临时3001 controller，关闭本轮创建的bridge页；原3000进程与用户其他标签页不动。后续启动controller仍须使用当前代码、新配对码和v1.3.16脚本。

## 未解决事项

当前只读验证无未解决项。真正写功能仍未验证、完整MVP仍未完成。仅当账号正常具备写权限时，再逐一观察官方create、单次移动clip触发save、单轨export三个动作；不自动进入这些步骤，不推断revision_id，不绕过entitlement。

## 证据与产物位置

- 本次真实只读结构与摘要：captures/meter-privacy-live/20261005/version-read.json（无完整私有 response/认证值）。
- 报告：reports/STUDIO_METER_LIVE_VERIFICATION_REPORT.md。
- 仅本轮5个文档变更：deliverables/SUNO_STUDIO_METER_LIVE.patch。
- 单一证据包：deliverables/SUNO_STUDIO_METER_LIVE_EVIDENCE.zip；独立 staging=.evidence-staging/phase1-studio-meter-live-20261005，含报告、版本结构/摘要、fixture输入完整性、执行/cleanup记录、task manifest、隔离patch验证和文件hash。
- ZIP.sha256外置；patch独立。包不含原私有JSON、完整源码、依赖/缓存/构建、旧ZIP、认证或临时配对码；校验CRC、逐文件hash、无重复/嵌套/无关敏感文件。
