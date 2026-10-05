> Historical stage report. Its then-current write availability/evidence conclusions are superseded by docs/STUDIO_SDK_STATUS.md and docs/EVIDENCE_HISTORY.md; original evidence packages are immutable.

# Studio Clip Pipeline：静态恢复与本地 builder 报告

日期：2026-10-05。任务基线：`024a3fb1d79e7085724f47d7a0a98eba1f098c32`，开始时 git status 干净，无既存未提交改动。只解析此前取得的官方/参考客户端公开代码和原有 fixture，不操作浏览器账号，不下载新资源，不发送任何 Suno 请求。

## 结论

本轮限定目标完成：恢复 Add Clip 模型、timeline/read/warp domains、constructor 与后处理证据，建立纯本地 builder/显式 save adapters 和测试。**ADD_CLIP = CLIENT_STATE_MUTATION / FOUND_STATICALLY / High**；恢复路径是 source metadata → arrangement → native store membership / track.clips 投影 → serialize 整体 state → save-project。

现有 READ project / version（LOSSLESS）/ versions list 保持 VERIFIED，未重做 live read/privacy/lossless 实验。create/save/render/multitrack 四个 POST 仍 FOUND_STATICALLY / High；默认写入口拒绝。静态/local evidence 不代表拥有写权限、服务器持久化或 render 音频验证，完整账户自动合并 MVP 尚未完成。

## 主要变更

- `suno/studio/clip-pipeline.mjs/.d.ts`：source metadata、draft、processed clip 使用不同 WeakMap handles；普通/已分析普通素材 constructor、独立 arrangement ID、asset identity、顺序 placement、manual 无 automation 秒/beats、warp 插值、显式 transposition/gain/fade/read offset、非重叠 track snapshot append。
- `state-boundaries.mjs/.d.ts`：显式 editor snapshot mutation / inspection；不允许 raw-wire handle 冒充 editor。
- 静态 project adapters：完整 state 检查，inline markers ↔ registry + MD5 去重，未知字段保留，拒绝 incomplete/redacted/unresolved/double serialization；render 域保持独立。
- `models.d.ts`：官方 drop color=null 的真实静态 schema 扩展。
- AST extractor / 固定 seeds collector：验证已有 116 个官方资源 SHA，提取 88 个有限定义/片段与既有 17 个 literal method/path，未求值；参考 import/merge 只取四个已有 property snippets，没有重新分析上传流程。
- 新 pipeline 文档；API map / write API / README 更新。未来 capture 计划扩大到 A–H，每个动作单独 marker。

## 已足够本地实现 / 尚待验证

| 能力 | 证据状态 | 当前边界 |
|---|---|---|
| Source ID 与 timeline arrangement ID 分离 | FOUND_STATICALLY + OBSERVED | constructor 只写 asset.id；fixture 保留 clipId alias，不自动添加 |
| 普通 draft、resolved warp clip、顺序 placement | FOUND_STATICALLY | resolved 必须提供已确认 metadata duration / markers；不运行 downbeat/transient analysis |
| 显式 transposition、amplitude、fade duration、readStart | FOUND_STATICALLY | 本地 state 编辑；不是完整 trim/loop/reverse UI 或服务端音频效果验证 |
| warp registry、同 map 去重、尾段独立 extent | FOUND_STATICALLY + OBSERVED | 19 段 `{0:0,6:18.572592308027932}`，1 尾段 `{0:0,1.1109791666666666:3.4389605208687692}` |
| +8 上传参数 / restore flag → -8 state | OBSERVED CORRELATION | 自动 restoration 拒绝；未找到参考网站后端转换代码 |
| gainReference / repairLoudness / repairLoudnessOnMerge | FOUND_STATICALLY（第三方字段） | 官方快照零命中；网站 merge 接收 gainRepair，映射到 amplitude/automation/render/worker 未确认 |
| project save adapters | FOUND_STATICALLY，本地往返通过 | 无服务器写入验证，render adapter 不混用 |

两组 fixture marker slope 等于 `1.95 × 2^(8/12)`，是额外数值关联，不作为构造算法证明。官方当前 MD5 marker hash 与历史 fixture `warp_MDow...` 拼法不同；新 preview 重建 hash 时保留数值，原 fixture 不改。

## 验证 / 测试

- `npm test`：**60 通过，0 失败**；新增 11 项定向测试。覆盖未知字段/源 identity、UUID 独立、constructor defaults、deterministic placement/tail、manual origin、warp references/interpolation、resolved extent、非破坏处理、显式 deserialize→append→serialize→preview、缺失/掩码/混域拒绝、pitch/loudness NotVerifiedError、写入口零 dispatch、AST 不执行源码。
- 三个真实账户 integration tests 在子进程 `RUN_SUNO_INTEGRATION_TESTS=0` 下：**3 跳过，0 失败**。这是默认 gate 验证，不是真实网络测试。
- 116 个已有官方资源与 manifest SHA 一致；有限 source snippets 与 UTF-16/UTF-8 offsets 保存于 evidence.json。参考主 bundle 也核对既有 SHA。
- 本地 serializer 往返保留 fixture 的全数值及未知字段；原 fixture SHA 保持 `b5cc87081cda785b6d59b753908687c0487dfd23f1e3c262b7b563ba5a2ec64a`，Downloads 原 JSON / captures 原副本保持 `a1e2213a987eaa3c3012244eed3e69c9b5e044c1ad54b9fb288f3e19d9ecc334`。不把本地单测重复当作新的 LOSSLESS live 证据。

## 问题、风险与未解决事项

- 缺少独立 Add Clip endpoint 仅限当前 acquired module / 已恢复路径；未加载分支不做全局不存在断言。
- Metadata 构造长度可能来自 source avg_bpm，pending warp fallback 为 2 BPS；不能把 source duration、source read beats 和 project placement duration混为一谈。未知 duration 的 960 是官方占位，不可冒充成品长度。
- 时间 helper 暂拒绝 tempo automation / 非 manual；特殊 infill/extend 内容窗口、overlap replace/split、完整 track factory imported constants 未移植。append 需要已知完整 audio track，操作 JSON snapshot，不同步官方 native editor store。
- 声音后处理的实际听感、trim/loop/reverse 全逻辑、自动 pitch restoration、gain repair 服务器算法、当前 hash 的服务端兼容性、render transformed serializer 尚待正常权限下验证。
- 未来必须 A-create / B-add / C-save / D-move / E-save / F-single property / G-save / H-export 各单动作 capture，单独重播并读回 diff；注意 autosave 时序。不得借 read 成功推导 write 权限，不做 entitlement/subscription 修改。
- 诊断期间有两个本地探针调用错误：一次 PowerShell 转义导致 Node regex parse 失败；一次引用了不存在的旧 reference manifest 名称。随后改用文件脚本与实际 code-manifest 路径，未触发任何网络操作；最终证据收集和测试均成功。

## 证据与交付位置

- 主要模型/来源/offset：[STUDIO_CLIP_PIPELINE.md](../docs/STUDIO_CLIP_PIPELINE.md)。
- 已有完整 source snapshots：`captures/official-write/20261005/`，本机保留，不打包完整 bundles。
- 本轮小型证据：`captures/clip-pipeline/20261005/evidence.json`、`unit-tests.log`、`integration-default.log`。
- 完整输入及 sanitized fixture 保持原样，不打包账户原响应。
- 任务专属 patch：`deliverables/SUNO_STUDIO_CLIP_PIPELINE.patch`（独立于 ZIP；仅基线后的本任务改动）。
- 证据 ZIP：`deliverables/SUNO_STUDIO_CLIP_PIPELINE_EVIDENCE.zip`，外部 `.zip.sha256`。从新独立 staging 构建，含本报告、pipeline 文档、小型 AST/fixture stats、测试日志、任务/源码 hash manifest、patch apply 验证；不包含完整仓库、依赖、原私有 response、认证、旧包或嵌套包。
- 打包脚本执行后验证 ZIP CRC、每项 SHA、路径/大小/重复/嵌套包与敏感字符串；patch 在隔离基线树 apply --check / apply，结果逐文件比对 HEAD blobs。验证结果随包保存，具体内容以 manifest 为准。
