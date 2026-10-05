# Studio 写验证计划

## 当前边界

本轮 SDK 只生成本地 draft 和 request preview。三个已验证 GET 保持 VERIFIED；create-project、save-project、render-state、render-state-multitrack 保持 FOUND_STATICALLY / High。账号读取成功不证明写权限。只有在账号正常获得官方 Studio 写权限后执行本计划，不修改 subscription、entitlement 或权限字段。

controller / SunoBridge / BridgeHub 的统一 transport validator 现在拒绝整个 `/api/studio` 命名空间的非 GET 请求，并拒绝四个写候选被伪装成 GET。没有环境变量或 integration flag 能解除这一限制。现有 controller 没有热重载，运行旧进程须正常重启才能加载新 guard。本轮未操作旧进程。官方 UI 的自身网络 transport 独立于本地 controller，可用于未来合法 capture；后续 replay 必须经过单独审查的实现变更，不能删除 preview 标记后调用 raw-call。

## 每一步共用流程

打开官方 Studio，保持正常登录，准备一段本人已有的 Suno clip。按 [Capture Harness](STUDIO_CAPTURE_HARNESS.md) 完成一次正常安装/配对，保持原 Auth Bridge 在线、一个官方标签页；无需下载音频或 DevTools。每项在本地页选 scenario → Begin → 等待 armed → 只做指定官方 UI 动作 → End。工具自动获取已知 project 基线、停录归档、读取 project/latest version、生成 diff/compare/report。不要人工复制 JSON，也不要在 armed 前操作。

每项记录时间、method/path/query、非敏感完整 body、status、response 结构与业务 IDs；不记录认证 headers、cookies、JWT、signed URL 签名。保留 timeline/state 的未知字段。按事件时间线区分官方 Studio API、辅助素材分析请求和纯本地 state mutation。若 autosave 在 add/move/property 动作内发生，记录它，不假设下一次手动 save 必定产生新请求。

| Marker / 唯一动作 | 需要抓什么 | before/after 比较 | 升级或推翻的 hypothesis |
|---|---|---|---|
| A-create：创建空测试工程 | create-project 的真实 query/body/response；随后读取新工程 | project ID、初始 version ID、空 state、结构默认值；区分 workspace project ID 与 Studio project ID | 静态 create schema、template reset 是否符合官方构造；只捕获后为 OBSERVED/CORRELATED，成功受控复现才 VERIFIED |
| B-add：添加一段已有 clip | 素材引用及 Studio 新增请求/本地 mutation marker；GET 基线，后续 C-save 的持久化 state | arrangement UUID 与 asset.id/source ID、可选 clipId alias、duration、markers、默认 fade/warp | ADD_CLIP=CLIENT_STATE_MUTATION 是否成立；是否有未观察的独立网络调用；exact constructor 仍需要完整素材 metadata，不能用 marker extent 冒充 |
| C-save：保存一次 | 完整 save-project body、response、实际 version ID；GET 该真实版本 | wire → editor → save 的未知字段、registry/hash、project/version 关联、重新读取的 clip | save serializer、当前 MD5 key 的服务器兼容性、保存 payload 完整性 |
| D-move：仅轻微移动该 clip | state diff、autosave 及关联请求 | startBeats/endBeats 应同步改变；readStartBeats、warp、processing 是否不变 | timeline placement 与 source read offset 边界；不要同时 trim |
| E-save：保存一次 | save payload 与新 version ID；GET 精确新版本 | 仅 placement 的必要差异、实际持久化位置、未知字段保留 | copy-on-write save 是否可安全重放；版本是否真的更新 |
| F-transposition：只修改 transposition | 记录原值，设置一个明确值；editor diff、autosave | transposition 与伴随的 formant/warp 必要变化；避免同时改 gain/fade | 显式 pitch state mutation、clamp；不能用这个动作证明 uploader +8→-8 因果关系 |
| G-save：保存一次 | 完整 save body、version ID；GET 新版本 | pitch 与 registry/marker 数值、未知字段是否持久化 | post-processing → serialized state → readback 链路 |
| H-export：单轨生成/render 一次 | render-state body、完整 response、真实 returned clip ID；若官方实际出现后续请求则记录 | 已移植 manual render state/range/downbeats 与实际 payload 比较；lyrics/pathname、不同 project/version bindings、输出范围/时长 | 静态两段 normalization/derived timing/downbeats、服务器 marker hash 接受与完整响应；不能用 multitrack schema 代替，不能猜 polling |

H 仅研究 `/render-state` 分支。多轨下载需另建独立单动作实验，不混用 response schema。当前示例 downbeats 由静态 helper 派生，symbolic IDs、空 lyrics 与 `/studio` pathname 仍是明确本地输入，不可直接提交。V2 consumer 当前只把返回 id 用作 song link，没有观察到它发起轮询。

GET 可能只反映保存版本，harness 不访问 closed-over native CRDT/editor memory。B→C、D→E、F→G 自动生成 deferred comparison；若 edit 内发生 autosave，保留真实时间线，后续 Save 无请求也如实报告。MOVE/TRANSPOSE 自动分析使用 after-state 的动作值时标 CONDITIONAL_RULE_COMPARISON，不能伪装成独立输入预测。可选 prediction 文件用于有完整 SourceClip/profile 时的独立比较。Capture gap 或 read error 保留 evidence，但阻止完整性/升级声明。

## 判断与复现要求

每个静态候选只有 HTTP 行为已捕获、账号正常权限允许、单独受控 replay 成功且读取状态/输出合理对应以后，才能标 VERIFIED。重播 create/save/render 会改变账号数据，必须在未来明确授权的测试工程中执行；本轮没有发送。重播前补齐真实 IDs/source metadata，动态比较已移植 state transform、非空歌词及 response schema。Offline ReplayTransport 永远不访问 Suno。

集中 EndpointVerificationRegistry 已准备逐 endpoint eligibility：VERIFIED + explicit allow_verified_studio_writes=true + human review + schema/evidence refs。即使 eligibility 成立，当前生产 dispatch 仍物理拒绝；未来还需单独审查的 activation adapter 变更，不会全局解锁或由工具自动修改文档。本轮 UI 验证工具无需开启该写能力，正常官方 UI 自身 transport 独立执行动作。

验证失败时使用 `dry_run_provenance.json` 找到 USER_SUPPLIED、DEFAULT、FOUND_STATICALLY、CORRELATED 字段，逐项回看真实 payload。不得删未知字段、填猜测 enum、替换权限字段或用假 endpoint 让测试通过。保存原基线和单动作 state diff，任何结论只升级该动作实际验证的范围。
