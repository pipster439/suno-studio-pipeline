# Studio Clip Pipeline

2026-10-05；范围：已有公开官方 JS 快照、现有真实 project fixture、本地纯函数。没有新 Suno 请求、上传流程重跑、付费操作或权限修改。GET project / specific version（LOSSLESS）/ versions list 保持此前 **VERIFIED**；本轮不重复动态读取。

## 结论与证据等级

**ADD_CLIP = CLIENT_STATE_MUTATION（FOUND_STATICALLY / High）**：恢复到的官方 library drop / intent / append 路径构造 arrangement，再向本地 native store 插入 entity 与 membership ID；工程投影成为 `track.clips[]`。management 保存路径随后 serialize 整个 state → POST save-project → 消费 version_id。不是新增的 Add Clip HTTP API。

本轮没有把静态构造、本地测试或读取成功升级为服务器写 **VERIFIED**。四个写候选 create-project / save-project / render-state / render-state-multitrack 仍 **FOUND_STATICALLY / High**，StudioClient 默认拒绝 dispatch。

证据：`captures/clip-pipeline/20261005/evidence.json`，由 [collect-studio-clip-evidence.mjs](../scripts/collect-studio-clip-evidence.mjs) 从已取得的 116 个 hash-pinned 官方文件定向提取；88 个有限 AST 定义/片段，既有 17 个 method/path 模板，未下载或执行 bundle。所有下面 offsets 是 UTF-16 字符位置；JSON 同时保存已提取定义的 UTF-8 byte offset 与原文件 SHA-256。共享 registration 可导出多个逻辑 module，不把 wrapper ID 误认作所有函数的所属 module。

## Source clip → Studio clip mapping

| 发现 | 状态 | 证据 / 边界 |
|---|---|---|
| 普通已有作品元数据 → audio arrangement | FOUND_STATICALLY | `0kfolb-xhy_j4.js` module 738128 export @1317641；metadata content helper module 386462 @1316256 |
| 完成 downbeat analysis 的 arrangement | FOUND_STATICALLY | 同文件 module 934710 export @1315176；由 source content start/end 经 warp helper 得到 read bounds 和片段长度 |
| 未完成 analysis 的中间路径 | FOUND_STATICALLY | `0ureacebq_re1.js` module 728531 @22630：awaitingAnalysis=true，可能使用部分 downbeats |
| Library drop 选择上述三个构造路径 | FOUND_STATICALLY | `3g9-3c-u44c0o.js` module 234008 `L` @2647072；drop handler @2648606；final / partial / metadata fallback 分支不同 |
| Intent 构造可覆盖 placement / read trim / identity warp | FOUND_STATICALLY | 同文件 module 327403 `v` @2651594 |
| 完整真实 state 是 1 audio track / 20 clips | OBSERVED | 不改写的 [fixture](../fixtures/studio_project_get.json) 与其 [provenance](../fixtures/studio_project_get.provenance.json) |

普通 constructor：`asset={type:"clip",id:source.id}`，UUID arrangement ID，streaming=`status !== "complete"`；startBeats=0。普通内容长度采用 `metadata.duration × (metadata.avg_bpm / 60 或 fallbackBPS)`，未知 duration 时源码暂置 960。后者是等待分析的占位值，**不能当真实可导出长度**。metadata helper 会对 infill/extend/fixed_infill 使用 history/context window；本地 builder 对这些特殊任务保留 NotVerifiedError，避免错误套用普通素材规则。

resolved constructor 使用已解析 markers，`readStart=warp(contentStartSeconds)`，`length=warp(contentEndSeconds)-readStart`；loop bounds 来自完整 source bounds，warp.enabled 为 confidence 未指定或 >=0.9，awaitingAnalysis=false。本地 `buildAnalyzedAudioClipDraft` 仅移植普通内容、已知 duration 和显式提供 markers 的分支；不代替音频分析器、downbeats 简化、transient drift correction 或特殊内容窗口。普通 constructor 的 name/title 与 color helper 不移植：调用者显式传 display name/color，默认 New Clip/null（drop 路径也清空颜色）。未知扩展字段用 extraFields 保存，不能覆盖已知构造字段。

## Clip ID semantics 与 Track insertion

**FOUND_STATICALLY**：当前官方两个 constructor 都生成新的 arrangement `id`，并把 source ID 写到 `asset.id`，**没有自动添加 clipId 字段**。`createStaticAudioArrangement`（`3vyf86o0k-66r.js` module 979354 @179101）甚至默认 `id=static-${clipId}`；说明不能把某一种 UUID 拼法当通用 schema。cloneArrangementWithNewId 另生成 ID，源 asset 保留。

**OBSERVED**：真实 fixture 的 20 个 arrangement.id 均不同于 asset.id；clipId 与 asset.id 全部相等。本地 builder 生成独立 UUID，允许保留经过观察的 clipId alias；不会凭空补该 alias，也拒绝 alias/source 不一致。

**FOUND_STATICALLY**：`1v4_8jwiw44oy.js` module 723181 `l` @72223 创建 clip entity，并把 arrangement ID 插入 container 的 clipIds；append export @72758。library drop 可能先 createAudioTrack，再 dispatch native 插入；`createAudioTrack` 在 `3vyf86o0k-66r.js` shared scope 中 `h` @170590，含 input/height/color/instrument/eq/routingMode/takeLanes 等默认配置。暂不猜这些 imported UI/DSP constants；本地 append 需要已有完整 audio track 或显式外部 track factory 的结果。

本地 `appendClipToEditor` 只操作隔离 JSON editor snapshot，保留 track 未知字段，拒绝重复 arrangement ID 和重叠。这不是与官方 Yjs/native store 同步的接口。官方 `insertArrangementsToContainer`（`3g9-3c-u44c0o.js` module 250367 @138409）还会删除/裁切/分割重叠区及调整 fades/read offset；这些行为超出顺序拼接 MVP，本地没有静默覆盖实现。

**FOUND_STATICALLY**：既有 loaded-client HTTP 清单没有独立 arrangement Add Clip endpoint。实际存在 POST `/api/studio/create-or-load-project-for-clip/{clip_id}`（@1333928）和 GET `/api/studio/clips/{clip_id}/projects`；它们属于以作品定位/创建工程的 helper，不能替代已打开工程的 track 插入。这个否定结论只限已取得模块和恢复的插入路径，不宣称所有未来或未加载代码都不存在该接口。

## Timeline positioning 与 Seconds ↔ beats

**FOUND_STATICALLY**：module 327403 的 intent placement 先以 delta 同时平移 start/end，随后可独立覆盖 end；readStart 不随移动改变。drop handler 的最终对象明确赋值 startBeats/endBeats。顺序拼接本地 helper 将下一段 start 放到前段 end，尾段保留自己的长度，不按第一段长度补齐。

**FOUND_STATICALLY**：`3vyf86o0k-66r.js` module 1755：computeSeconds `y` @160533，computeBeats `H` @164583：

```text
无 automation：seconds = beats / bps + firstBeatSeconds
无 automation：beats = (seconds - firstBeatSeconds) * bps
durationBeats = durationSeconds * bps  // duration 是差值，不加原点
```

官方还处理单 automation point、多段 tempo / 积分及映射 segments；不是所有项目固定 BPS。本地 seconds/project-beats helper 仅接受 manual 且 bpsAutomation=[]，其他输入 NotVerifiedError。fixture manual / bps=1.95 / lockBPS=true 是 **OBSERVED**；lockBPS 不意味着所有将来工程也固定。

**FOUND_STATICALLY**：source seconds → arrangement read beats 属于 warp helper（module 981734 `n` @174380），不是 project timing helper。>=2 markers 分段插值、端点外按最近段斜率外推；稀疏 markers 默认斜率 2 BPS。readStartBeats 不是 timeline start。

## Pitch restoration

**OBSERVED（仅关联）**：用户提供的 import 为 pitchShiftSemitones=+8 / restorePitchInStudio=true；真实 20 clips 的 transposition=-8。

**FOUND_STATICALLY**：参考客户端主 bundle（SHA-256 `61d098da8777cd02fb6a8cb92b8487b1b9e87f0d8d7c990b2b1d7b00b6e74ff8`）在 import payload @398800 附近保留这两个字段，restore flag @398864；收到的官方 116 个快照对两词均零命中。不能从前端 import 参数或数值相反证明其后端实现了取负算法。

**FOUND_STATICALLY**：官方 clip fixer 在 `0kfolb-xhy_j4.js` @120643 附近将有限 transposition 限制到 [-24,24]，constructor 默认 0。本地允许显式设置 -8（范围同 fixer），这是明确参数的 state edit；`restoreUploadedPitch()` 仍 NotVerifiedError，不自动把 +8 变 -8。

## Warp / markersRegistry

**FOUND_STATICALLY**：editor-memory 使用 `clip.warp.markers` 的 map：key=source seconds、value=arrangement read beats。save serializer（module 634782 export @145397）去重 markers，写 state.markersRegistry，并把 clip 的 inline markers 换成 markersHash。deserialize export @145016 执行相反转换，并移除 registry。

**FOUND_STATICALLY**：module 879379（`2ef8--43y8b0e.js`）hash @56249：按数值秒数排序 `key:value`，逗号连接，再 MD5，前缀 warp_。canonical 去重依据完整 marker 内容；**相同 clip 长度不是充分去重条件**。

**OBSERVED**：fixture 前 19 段都引用 `{0:0,6:18.572592308027932}`，尾段引用 `{0:0,1.1109791666666666:3.4389605208687692}`。同内容 marker map 被复用，尾段 map 独立，所有 references 可解析。原 hash 是 `warp_MDow...` 形式，与当前官方 MD5 形式不同；不重写原 fixture，也不把两个 hash 算法混为一谈。

**OBSERVED（仅数值关联）**：两组 slope ≈3.0954320513379887，等于 `1.95 × 2^(8/12)`。这不是官方算法证明，不据此生成自动 pitch/warp 恢复参数。本地 resolved builder 要求显式已确认 markers；serializer 在新输出中按当前静态算法生成 MD5 key，markers 数值不变。新 key 的服务端兼容性仍待有权限环境验证。

## Trim / read offset

**FOUND_STATICALLY**：module 1755 `C` @162149 的无 loop 映射：timeline `[start,end]` → read `[readStart, readStart+(end-start)]`；module 505593 @107689 在未 populate warp 时，还经过 project 秒差、pitch multiplier、warp direction、loop boundary 计算。

因此本地只提供独立 readStartBeats 显式编辑、placement 与已知 warp helper；不把 timeline 平移变成 source trim，不把 seconds 直接当 beats，不声称复现官方完整 crop/loop/reversed 行为。不同 read mapping 必须明确选对应 timing/warp domain。

## Gain / loudness findings 与 Fade defaults

| 发现 | 状态 | 实现边界 |
|---|---|---|
| constructor amplitude=1，fadeIn/OutBeats=0，fadeIn/OutCurve=1 | FOUND_STATICALLY | 普通、resolved、partial 三个 constructor 都明确给出；不是所有历史/编辑后 clips 的恒值 |
| explicit clip amplitude state setter | FOUND_STATICALLY | `3g9-3c-u44c0o.js` `F` @448004 设置 entity amplitude；本地接受有限非负 multiplier，不做自动 normalization |
| fade edit 将 duration clamp >=0 | FOUND_STATICALLY | 同文件 `O` @448187；`3rk3hbpk2zy7n.js` module 291279 @5478 也有同样规则 |
| fixture amplitude=1，fades=0/0/1/1 | OBSERVED | 不能据此确认 repairLoudness 未生效或后端没有预先处理音频 |
| gainReference / repairLoudness / repairLoudnessOnMerge 不在收到的官方快照 | FOUND_STATICALLY | 116 文件精确词检索零命中，限定当前范围 |
| 参考前端导入 gainReference，merge 追加 repairLoudness/gainRepair | FOUND_STATICALLY | 主 bundle import/export property、ss @364237 → i7 → 网站 `/api/merge`；third-party orchestration concern |
| gainReference 是否变 amplitude / automation / worker-only / render-only | OBSERVED | 仅有上游字段存在和最终 amplitude=1 的事实；转换方式未观察，不能排除任何分支。本地自动 repair 全部拒绝 |

fade curve editor mutation未移植，未知曲线继续保留；不能因默认 1 就在已有 state 上覆盖。

## Save interaction 与域边界

```text
sourceClipMetadata（保留全部 metadata）
  → buildAudioClipDraft / buildAnalyzedAudioClipDraft
  → StudioClipDraft
  → postprocessClip / placeClip / placeSequentialClips
  → PostprocessedClip
  → appendClipToEditor（已有完整 audio track 的 JSON snapshot）
  → EditorMemoryState
  → serializeProjectState(editor, serializeAudioProjectState)
  → SaveSerializedState
  → buildSaveProjectRequest({project_id,state,title})
  → dispatchAllowed=false；不提交 POST
```

**FOUND_STATICALLY / 本地重建**：raw-wire 先显式 `deserializeEditorState(raw, deserializeAudioProjectState)`，不能把 GET state 直接再 serializer。新增 adapter 是 audio MVP 的静态移植、严格验证版：拒绝缺少已知完整 state keys/clip numeric fields/takeLanes、mask/omitted、未解析 marker reference、wire hash 混入 memory、memory 带 registry。拒绝未知/不完整输入时不填默认值。所有转换复制输入，完整未知字段保留；完整 hash spelling 在新 wire output 中允许变化，原 fixture 不变。

render-transformed 仍需要独立 transform 和 render serializer，**不能**使用这个 project save serializer 代替。render-state 与 multitrack 的 distinct request/response 分支保持此前文档和默认拒绝。

## Known unknowns 与后续动态计划

本地已足够实现（证据 **FOUND_STATICALLY**）：普通/resolved clip draft、独立 ID、非重叠插入、顺序 placement、manual 无 automation 时间换算、已确认 markers 插值/引用、显式 transposition/amplitude/fade/readStart 编辑、严格 save preview。

仍只静态相关或 **OBSERVED**：metadata/downbeat 真实输入及分析完成时机、+8→-8 causality、gain repair 的服务端算法、MD5 hash 的持久化兼容性、完整官方 crop/loop/reverse、track factory 全套 imported constants、render 音频效果。没有自动反转 pitch、响度算法、tempo automation 或 render transform 移植。

未来账号正常具备写权限后，按以下序列独立清空 capture / marker（所有写接口仍待动态验证）：

| Marker | 只执行一个动作 | 对比 |
|---|---|---|
| A-create | 创建空测试工程 | query/body、project/latest version IDs、空 state |
| B-add | 加入一段已有 clip | before/after arrangement、asset ID、analysis/HTTP 是否发生 |
| C-save | 保存一次 | 完整 payload、version_id、GET 新版本 diff |
| D-move | 轻微移动该 clip | 仅 start/end，read offset 与 processing 不变 |
| E-save | 保存一次 | payload placement 差异、版本更新 |
| F-property | 只改一项 transposition/trim/fade/gain | 单字段或该操作必要字段 diff；记录恢复基线 |
| G-save | 保存一次 | serialized markers/processing、版本持久化 |
| H-export | 单轨导出一次 | render transformed state、关联版本、returned clip 和实际音频结果 |

若官方 autosave 在编辑 marker 内自行发生，记录该事实及完整时间线，再单独标记手动 save 是否有新增请求；不为了凑出两个请求重复操作。只有真实捕获、单独重播及 state/readback 成功后才升级写 **VERIFIED**，read 成功不推导 write 权限。本轮停止在纯本地验证。

## Studio Dry-Run SDK（2026-10-05）

`suno/studio/dry-run-sdk.mjs` 提供真正可执行的离线链路；`validation.mjs`、`warp-registry.mjs` 分别管理严格验证和 marker storage。没有 bridge、fetch、WebSocket 依赖。模块边界沿用现有 handle/domain adapters，没有重排整个仓库。

| 边界/行为 | 证据 | 当前实现 |
|---|---|---|
| SourceClip → draft | FOUND_STATICALLY | source clip_id、duration_seconds、title 与未知 source 字段保留；第三方字段只进入 uploader_metadata，绝不 spread 到 wire |
| arrangement.id 与 asset.id | FOUND_STATICALLY；历史 alias OBSERVED | 独立 UUID；asset.id 引用 source；只有显式 compatibility policy 和已观察 alias 一致时添加 clipId |
| sequential placement | FOUND_STATICALLY | SOURCE_DURATION 使用真实输入 duration；RESOLVED_WARP 使用明确 markers 的映射跨度。仅 manual 无 bpsAutomation，尾段按实际长度，二者单位/来源独立报告 |
| explicit pitch/gain/read/fade | FOUND_STATICALLY；值 USER_SUPPLIED | transposition clamp [-24,24]、有限非负 amplitude、显式 readStartBeats/fade；不覆盖已有 fade 默认值，不实现完整 trim |
| 上传音高逆规则 | CORRELATED | derivePitchRestoration 默认 NotVerifiedError；严格 true 的 allow_observed_uploader_pitch_rule 才开启，输出 provenance 仍 CORRELATED、serverVerified=false |
| 自动 loudness repair | OBSERVED 上游字段，转换 UNKNOWN | applyLoudnessRepair 始终 NotVerifiedError；gainReference 等 opaque metadata 保留、默认不影响 wire |
| warp registry | OBSERVED / FOUND_STATICALLY | PRESERVE_EXISTING 保留历史 hash/registry/未引用条目；新建用 CURRENT_STATIC_ALGORITHM，MD5 与 dedup 仅静态高置信、非服务器 VERIFIED；尾段不同 map 独立 entry |
| project structural template | OBSERVED | 克隆完整 fixture，生成新 track/draft UUID，清理 selection/focus/UI 中旧身份，重置新工程 convenience state；未知 history-keyed UI 或剩余旧身份拒绝 |
| existing project modification | FOUND_STATICALLY / 本地验证 | modifyExistingProject copy-on-write；默认保留已有 hash、未知 clip/track/state/registry 字段；变更 whitelist 检测意外丢失 |
| save request | FOUND_STATICALLY / High | 只返回 POST save-project `{project_id,state,title}`，strict validation 与不可变 preview；dispatchAllowed=false |
| render request | FOUND_STATICALLY / High | 独立 render-transformed handle；只接受明确 V2 engine/mode/其他参数与 bindings。实现已知 manual timing/metronome overlay，两个官方 normalization transform 尚未完整移植 |

SDK 使用显式的 save_project_id / render project_id / studio_project_id / studio_project_version_id bindings，禁止把本地 draft UUID 推断成服务器 ID。示例均为 LOCAL_PLACEHOLDER。create/save 返回的真实 ID 必须在未来合法验证后绑定。preview 拒绝缺失或未观察 engine/mode；没有自动 enum 猜测。

运行 `npm run dry-run:studio`。`fixtures/studio_20_clip_dry_run.json` 来自真实 20 段工程的 source IDs、markers、timing 和显式 processing，使用中性显示标签。原 GET fixture 和原始 JSON 保持不变。source duration 是 OBSERVED_MARKER_EXTENT（19×6s + 尾段 1.1109791666666666s），不是新获取的完整音频 metadata。resolved warp 下 source range 总长 115.11097916666667s，对应 timeline 182.7272894222562s / 356.3182143733995 beats；不能把两者混为一谈。

历史 semantic diff 逐字段比较 decode 后 state：MATCH 563、EXPECTED_DYNAMIC 69、UNKNOWN_DIFFERENCE 0、BLOCKER 0。预期差异为新 UUID/中性标签/UI reset/静态 constructor formantCorrection 默认值与显式 hash 策略；asset/source、marker 数值、timeline 和 processing 不允许被这些类别掩盖。另有 no-op 测试保持 wire state 精确等价，包括额外未知字段及未引用 registry entries。这只证明本地转换没有损坏样本，save serializer 仍非 VERIFIED。

输出 summary、每个 wire leaf 的 provenance、validation、historical diff、draft 与 request previews。renderTransformComplete=false / serverSubmissionReady=false 明确暴露未移植 normalization、未恢复的官方 downbeats 与 placeholder bindings；生成 preview 不代表可向服务器提交。未来单动作计划见 [STUDIO_WRITE_VALIDATION_PLAN.md](STUDIO_WRITE_VALIDATION_PLAN.md)。

**写入物理边界**：本地 SDK 无 dispatch 能力；StudioClient 写方法拒绝；当前 shared transport validator 对 `/api/studio` 非 GET 全部拒绝，四个写候选即使去掉 dispatchAllowed、改 flag、编码 path 或改为 GET 也无法发送。旧 controller 进程需正常重启加载新代码。本轮不修改 Tampermonkey、不重新运行已完成 read/privacy/lossless live 实验、不发送 Suno 请求。
