> Historical stage report. Its then-current write availability/evidence conclusions are superseded by docs/STUDIO_SDK_STATUS.md and docs/EVIDENCE_HISTORY.md; original evidence packages are immutable.

# Studio Dry-Run SDK 实现报告

日期：2026-10-05。仓库：G:/Suno。任务开始基线：`d240a306963a4954544d4ccfd218bc2859e4d317`，开始时工作区无未提交改动。此次实现不调用 Suno、不重新执行既有 read/privacy/lossless live 验证、不下载/扫描新 bundle，不改 userscript 或账号权限。

## 结论

**READY FOR LIVE VALIDATION（准备条件，尚未执行）**：20 个真实工程衍生的 source references 可完整执行本地 source → arrangement → sequential placement → explicit post-processing → audio track → editor → save serialization → save/render previews → validation/provenance/diff。`npm run dry-run:studio` 可复现；默认不可发起 Studio 写入。

**STILL STATIC/CORRELATED**：四个 POST endpoint 保持 FOUND_STATICALLY / High；Add Clip 仍为 CLIENT_STATE_MUTATION 的静态模型；constructor/save serializer/current MD5 hash 的服务器兼容性没有写 VERIFIED。显式 pitch/amplitude/read/fade 可执行；uploader inverse pitch 只可严格 opt-in，始终 CORRELATED；自动 loudness repair/完整 trim 拒绝。

**BLOCKED UNTIL REAL STUDIO WRITE ACCESS**：创建/保存/导出成功、最终音频结果、服务器状态持久化均未验证。render preview 尚未完整复现官方两个 normalization transform 和 downbeat derivation；real source duration metadata 与 create/save 返回的真实 project/version bindings 也需补齐。输出明确 `renderTransformComplete=false`、`bindingsReady=false`、`serverSubmissionReady=false`，不会把生成 preview 解释成服务器可提交性。

## 主要变更

- `dry-run-sdk.mjs` 与声明：SourceClip/UploaderMetadata 分层；明确 explicit/derived/unverified profiles；clipId alias compatibility policy；独立 arrangement UUID；本地 draft template/UI/history 清理；完整合并、既有工程 copy-on-write 与 semantic diff。
- `warp-registry.mjs`：显式 PRESERVE_EXISTING / CURRENT_STATIC_ALGORITHM、注册/解析/dedup；既有历史 hash 和未引用/未知 registry 条目无损保留；尾段 map 独立。新 hash 策略不冒充 server VERIFIED。
- `validation.mjs`：完整结构、未掩码/未 omitted、finite JSON、source/arrangement identity、顺序无重叠、warp references、manual 无 automation、unknown-field whitelist。拒绝 credential 数据、signed credential URL、accessors、非 JSON 输入。
- `suno/bridge/errors.mjs`：当前 client/controller/hub 共用的 transport guard 强制拒绝 Studio namespace 非 GET 和四个写候选伪装 GET。编码、dot segments、重复斜线、删除 preview 标记、integration/allowWrite 参数均不能放行。SDK 没有 transport，dispatch() 始终拒绝。
- 新 20 段纯本地输入 fixture、可运行示例与 npm 命令；新增 10 项单元测试。更新 clip pipeline/README，新增 A–H 写验证计划。

四层 state 边界继续显式：raw-wire → adapter decode → editor-memory → save-serialized；render-transformed 使用独立 handle/transform。render 共享的 marker storage primitive 不等于复用整个 save transform。save body 是静态观察的 `{project_id,state,title}`；render 使用明确 V2 字段和各类 IDs，multitrack schema 不混入。

## 验证与测试

| 检查 | 结果 | 证据 |
|---|---|---|
| 全部单元测试 `npm test` | 70 passed / 0 failed / 0 skipped；新增 10 项 | `captures/dry-run-sdk/20261005/unit-tests.log` |
| integration 默认关闭 | 3 skipped / 0 failed，RUN_SUNO_INTEGRATION_TESTS=0 | `integration-default.log` |
| 20 段 dry-run CLI | 20 clips、1 audio track、2 registry entries、0 write dispatch | `dry-run.log`、`dry_run_summary.json` |
| source range / playback timeline | 115.11097916666667 source seconds；182.7272894222562 timeline seconds；356.3182143733995 beats | summary 与 provenance |
| 历史 semantic diff | MATCH 563；EXPECTED_DYNAMIC 69；UNKNOWN_DIFFERENCE 0；BLOCKER 0 | `historical_project_diff.json` |
| no-op 与 unknown preservation | 原 wire → decode → no-op → save 精确保留；额外未知 clip/state/registry 数据、未引用 registry 条目保留；仅 amplitude overlay 无旁路变化 | `tests/studio-dry-run.test.mjs` |
| write dispatch 阻断 | 4 个候选 × 6 种路径形式 × 5 个 method；实际 SunoBridge/BridgeHub 的 send count=0，pending=0 | 同上；不是伪造 Studio response |
| offline SDK | 全链路执行 global fetch counter=0；无 bridge/socket import | 同上与源码 |
| 受限边界 | automation、缺失 binding/未知 render enum、默认 pitch derivation、loudness、trim、disabled-warp resolved placement 拒绝 | 同上 |
| 原始 fixture 完整性 | 原下载/忽略目录副本与已脱敏 repo fixture SHA 不变 | ZIP `logs/fixture-integrity.json` |
| task-only patch | 基线 → 本轮 commits，独立目录 apply --check/apply 与 HEAD blob 字节比较 | ZIP `logs/patch-verification.json` |

Source duration 的证据是历史 marker 范围，示例明确 `OBSERVED_MARKER_EXTENT; full audio metadata not available`；没有伪造完整 audio metadata API response。RESOLVED_WARP 模式按 marker 跨度换算 playback，SOURCE_DURATION 模式按输入秒数 × bps 排列；测试证明两种模式不被悄悄混同。短尾采用 1.1109791666666666s source 范围及其独立 marker map，未当成 6s 标准段。

预期差异限于新身份、中性显示标签/UI reset、constructor formantCorrection 默认与显式 hash spelling 策略；对 asset、marker 数值、pitch/gain/read/timing/placement 的不符分类为 blocker。此 diff 和 no-op 测试只说明本地样本没有被转换损坏，不能升级 save serializer 的服务器证据等级。

## 问题、风险与未解决事项

1. 官方 render 的两个 normalization transform 未完整移植，示例空 downbeats 与 `/studio` pathname 是显式 preview 输入。输出 render request 不保证与未来官方 export 完全一致；需要 H-export capture 比较。
2. 请求 bindings 是明显的 LOCAL_PLACEHOLDER。save project_id、render workspace project_id、studio_project_id、version_id 不能推断为同一个身份；必须使用未来真实响应。
3. 完整媒体 duration metadata 没有本轮获取。对于非本 fixture 输入，调用方须给明确 source duration 和 marker/identity 策略；特殊 infill/extend、tempo automation、多轨/take lanes/plugins、完整 trim/gain repair 仍不支持。
4. `gainReference` 等第三方 metadata 默认完整保留但不应用；+8→-8 是历史关联，严格 opt-in 仍非官方规则。只设置明确 amplitude 不构成响度修复算法。
5. controller 没有热重载。本轮未停止/替换既有进程；当前源码 guard 只有在正常重启后对旧 controller 生效。SDK 当前调用进程无网络能力，更新后的 SunoBridge/BridgeHub 本地验证立即生效。Tampermonkey 本身仍是 generic transport，官方 UI 独立于本地 controller；本报告的不可 dispatch 保证范围是当前 SDK/controller/client 代码路径。
6. 新 draft 以当前真实单 audio track 的结构 template 为界，清理已知 UI/history references、保留无身份未知字段；不声明已经恢复完整官方空工程 factory。未知 history-keyed 数据拒绝。
7. 本地 validators 对 fixture 与受支持 MVP 有严格约束，不证明服务器业务许可或未来内部 API 稳定性。旧 read VERIFIED 不推导写权限。

## 证据与产物

- 新源码/输入/测试：`suno/studio/{dry-run-sdk,warp-registry,validation}.mjs`、对应 `.d.mts`，`fixtures/studio_20_clip_dry_run.json`、`examples/studio-20-clip-dry-run.mjs`、`tests/studio-dry-run.test.mjs`。
- 运行结果：`captures/dry-run-sdk/20261005/` 下 summary/provenance/diff/validation/draft/previews JSON；没有认证 headers、cookies 或账号秘密。ZIP 只收 summary/provenance/diff/validation 和必要日志，不收原始私人 GET response 或完整生成 state。
- 文档：`docs/STUDIO_CLIP_PIPELINE.md`、`docs/STUDIO_WRITE_VALIDATION_PLAN.md`。
- 交付：`deliverables/SUNO_STUDIO_DRY_RUN_SDK.patch`（独立、仅本轮改动）、`SUNO_STUDIO_DRY_RUN_SDK_EVIDENCE.zip`、外部 `.zip.sha256`。ZIP 的 MANIFEST.json 包含 baseline/commits、变更文件、patch hash 和执行范围。
- ZIP 从全新独立 `.evidence-staging/` 目录建立，member CRC/重复名/路径/内容哈希/credential 模式扫描在打包时校验；不包含旧交付包、嵌套包、依赖、缓存、完整 bundle、用户私人 response、auth data。详细检查结果记录于外部 `SUNO_STUDIO_DRY_RUN_SDK_PACKAGE_CHECK.json`，不把压缩包自身 hash 写入包内。

本轮到此停止。后续仅在正常写权限环境按 A-create/B-add/C-save/D-move/E-save/F-transposition/G-save/H-export 分别捕获、比较、受控复现，不自动解除任何写 gate。
