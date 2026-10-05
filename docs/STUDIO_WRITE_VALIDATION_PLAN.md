# Studio 写验证计划

## 当前边界

本轮 SDK 只生成本地 draft 和 request preview。三个已验证 GET 保持 VERIFIED；create-project、save-project、render-state、render-state-multitrack 保持 FOUND_STATICALLY / High。账号读取成功不证明写权限。只有在账号正常获得官方 Studio 写权限后执行本计划，不修改 subscription、entitlement 或权限字段。

controller / SunoBridge / BridgeHub 的统一 transport validator 现在拒绝整个 `/api/studio` 命名空间的非 GET 请求，并拒绝四个写候选被伪装成 GET。没有环境变量或 integration flag 能解除这一限制。现有 controller 没有热重载，运行旧进程须正常重启才能加载新 guard。本轮未操作旧进程。官方 UI 的自身网络 transport 独立于本地 controller，可用于未来合法 capture；后续 replay 必须经过单独审查的实现变更，不能删除 preview 标记后调用 raw-call。

## 每一步共用流程

打开官方 Studio，保持正常登录，准备一段本人已有的 Suno clip。无需下载音频；开启 recorder，确认请求/响应脱敏。每项动作开始前停止上一 capture，新建 capture 并标记下面的 marker。先保留当前完整 project/version state 的脱敏结构基线，再只执行指定动作，等待该动作完成，停止 capture。

每项记录时间、method/path/query、非敏感完整 body、status、response 结构与业务 IDs；不记录认证 headers、cookies、JWT、signed URL 签名。保留 timeline/state 的未知字段。按事件时间线区分官方 Studio API、辅助素材分析请求和纯本地 state mutation。若 autosave 在 add/move/property 动作内发生，记录它，不假设下一次手动 save 必定产生新请求。

| Marker / 唯一动作 | 需要抓什么 | before/after 比较 | 升级或推翻的 hypothesis |
|---|---|---|---|
| A-create：创建空测试工程 | create-project 的真实 query/body/response；随后读取新工程 | project ID、初始 version ID、空 state、结构默认值；区分 workspace project ID 与 Studio project ID | 静态 create schema、template reset 是否符合官方构造；只捕获后为 OBSERVED/CORRELATED，成功受控复现才 VERIFIED |
| B-add：添加一段已有 clip | 本地 before/after editor state、素材 metadata/analysis、所有新增网络请求 | arrangement UUID 与 asset.id/source ID、可选 clipId alias、duration、markers、默认 fade/warp | ADD_CLIP=CLIENT_STATE_MUTATION 是否成立；是否有未观察的独立网络调用；constructor/alias/实际 source duration |
| C-save：保存一次 | 完整 save-project body、response、实际 version ID；GET 该真实版本 | wire → editor → save 的未知字段、registry/hash、project/version 关联、重新读取的 clip | save serializer、当前 MD5 key 的服务器兼容性、保存 payload 完整性 |
| D-move：仅轻微移动该 clip | state diff、autosave 及关联请求 | startBeats/endBeats 应同步改变；readStartBeats、warp、processing 是否不变 | timeline placement 与 source read offset 边界；不要同时 trim |
| E-save：保存一次 | save payload 与新 version ID；GET 精确新版本 | 仅 placement 的必要差异、实际持久化位置、未知字段保留 | copy-on-write save 是否可安全重放；版本是否真的更新 |
| F-transposition：只修改 transposition | 记录原值，设置一个明确值；editor diff、autosave | transposition 与伴随的 formant/warp 必要变化；避免同时改 gain/fade | 显式 pitch state mutation、clamp；不能用这个动作证明 uploader +8→-8 因果关系 |
| G-save：保存一次 | 完整 save body、version ID；GET 新版本 | pitch 与 registry/marker 数值、未知字段是否持久化 | post-processing → serialized state → readback 链路 |
| H-export：单轨生成/render 一次 | render-state body、完整 response、真实 returned clip ID；官方轮询请求与完成 metadata | render transformed state 与 save state diff、实际 downbeats、lyrics/pathname、各 project/version bindings、输出范围/时长 | 两个未移植 normalization transform、V2 参数默认值和 response 全结构；不能用 multitrack download_url schema 代替 |

H 仅研究 `/render-state` 分支。需要多轨下载时另建独立单动作实验捕获 `/render-state-multitrack`，不混用 response schema。当前 20 段示例的空 downbeats、symbolic IDs 与 `/studio` pathname 只是显式本地输入，不可直接提交。

## 判断与复现要求

每个静态候选只有 HTTP 行为已捕获、账号正常权限允许、单独受控 replay 成功且读取状态/输出合理对应以后，才能标 VERIFIED。重播 create/save/render 都会改变账号数据，必须在未来明确授权的测试工程中执行；本轮没有发送。重播前须补齐真实 create/save 返回的 IDs，确认 source 完整 duration metadata，移植或动态确认 render normalization/downbeat derivation，再评估是否解除某个集中入口的 guard。

验证失败时使用 `dry_run_provenance.json` 找到 USER_SUPPLIED、DEFAULT、FOUND_STATICALLY、CORRELATED 字段，逐项回看真实 payload。不得删未知字段、填猜测 enum、替换权限字段或用假 endpoint 让测试通过。保存原基线和单动作 state diff，任何结论只升级该动作实际验证的范围。
