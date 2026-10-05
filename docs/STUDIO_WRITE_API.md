# 官方 Studio 写 API 静态恢复

> 2026-10-05 后续「最小动态验证 + 客户端边界」更新：version GET 和 versions GET 已实际 VERIFIED；所有当前 StudioClient 写入口（包含历史默认 create）关闭。以下静态调查是历史证据，不重新搜索 bundle。最新结果、serializer 边界和风险见文末及 `reports/STUDIO_READ_BOUNDARIES_REPORT.md`。

2026-10-05，Asia/Shanghai。任务基线 `0b5bdbd4337de819b69c9b45a8e86179dbb1055f`。本轮仅分析官方已下发公共 JS 与用户提供的真实 HTTP 200 GET body；没有向 Suno 发出任何写请求，也没有调用 candidate GET/version 路由、迁移工程或修改权限。

## 结论与状态

已定位统一 client、GET helper、相邻 create/save/version helper、whole-state serializer，以及 render/export 两个分支。**保存版本复用 project save：POST `/api/studio/save-project`，body 为 project_id/state/title，客户端要求响应 version_id。** 当前已接收源码里没有找到独立 createVersion/saveVersion/updateVersion 的 HTTP 路由。

新增写候选统一标 **FOUND_STATICALLY**；下文 Confidence=High 只表示源码构造和调用关系明确，不表示服务器接受请求或账户有写权限。`CORRELATED` 必须有可关联的运行时请求/状态证据；`VERIFIED` 必须实际成功复现。已有默认 Untitled Project、major_version=2 创建的历史 VERIFIED 范围保留，但本轮提取出的额外 create 参数及其他版本不随之升级。

用户提供的 GET `/api/studio/project/3ebbb451-08a7-4599-9885-788f0b8f5def` 完整 body 支持 **READ/schema/timeline/IDs VERIFIED**。latest_version_id=`e491cbde-9266-4884-997c-3a9789877a56`。本轮不重新猜读取协议，也不把读取成功推导成写入成功。

## 来源与统一 HTTP client

当前官方 tab 的 pageAssets inventory=`703505b4-d8be-4035-b1b6-15ba3ff6f3d1`。116 个普通同源 immutable chunk：111 个无认证 curl GET 200，字节哈希与原公开副本一致；5 个下载失败，使用同一已观察 URL 的既有 SHA-256 固定副本，明确标 prior snapshot，不能声称这 5 个重新取得了当前执行字节。带 fragment 的 worker 项没有作为普通 JS chunk 分析。第一次 urllib 下载全部 403；正常 curl 公共 GET 成功，没有携带 cookie/token、改变安全设置或遍历隐藏 URL。

优先 bundle：

| Bundle | SHA-256 | 实际作用 |
|---|---|---|
| `2li5ldyzlvt7d.js` | 见交付 manifest | 已检查，无 `/api/studio/` 字符串；存在通用 fetch shim（转调 runtime fetch/default）。调用栈经过它不能证明它实现了业务 endpoint |
| `04w5zr4x348zb.js` | 见交付 manifest | module 79076：getInstance/useApiClient、固定 baseUrl 与 HTTP wrapper |
| `0kfolb-xhy_j4.js` | `ef24940f421ace114c67bc80a482d93130cba288c2da6a374c8a4d7e236e938d` | GET/create/save/version helpers、management hook、serializer、context render |
| `3g9-3c-u44c0o.js` | `bf8b5b2cc55b072da1b4fce305c5c51dbc3c4c7920f35ec57de24692bcb3ad24` | V2 export/render consumer 与 multitrack request 构造 |
| `455mvnvi04a89.js` | 见交付 manifest | module 329176：multitrack POST 与 download_url 响应消费 |

`04w5zr4x348zb.js` module 79076：factory A（约 6650 附近）、baseUrl literal offset 10506；缓存 factory P/getInstance、useApiClient 导出在约 11300–11500。HTTP wrapper 把 path params 编码进模板、querySerializer 拼 query、bodySerializer 编码 JSON（body undefined 时省略），公开 GET/POST/PUT/PATCH/DELETE 方法；成功返回 `{data,response}`，失败返回 `{error,response}`。浏览器 fetch adapter 取得当前浏览器认证，未读取或导出运行时 token。本地 business client 继续复用 Tampermonkey transport，不复制该认证实现。

已定位的导出 GET helper 位于 `0kfolb-xhy_j4.js` module **140764**，函数 **a / fetchProjectById**（定义 1332157，call 1332226）调用 `e.GET("/api/studio/project/{project_id}",{params:{path:{project_id:n}},signal:i})`。检查 error、data 为 object，返回完整 data。management module **759985** 以 `C=e.i(79076)` 取得 client，以 `m=e.i(140764)` 调用 fetchProjectById，并使用 state/title/latest_version_id；同一个 m 调用 createProject/saveProject/fetchRevisionById/fetchProjectVersion/cloneProject。不是仅按函数名推断相邻关系。

相同 GET 路由另出现于 0kfolb 的 module 477258 / call 1010960，以及 24i4o5miwzvt8.js 的 module 882521 / call 21520。以上是三个静态调用位置；没有取得本次完整运行时栈，不能声称已证明当前响应必由 fetchProjectById 这个函数发起。

所有 offset 为 **UTF-16 字符起点，零起始**；精确 UTF-8 byteOffset、method/path/params/body/callExpression 在 `captures/official-write/20261005/write-analysis.json`。下面给 HTTP call 的 offset，另列定义位置以便定位。关键函数完整原表达式与精简调用图随证据包交付。

## Create Project

- **Endpoint / Method：POST `/api/studio/create-project`**。
- **Request schema：无 body；query title，以及条件出现的 major_version、trigger、extract_mode、num_stems_sent、entry_source。** 条件是源码中的 undefined 检查；不能推测合法枚举值。
- Response schema（客户端消费，不是完整服务端 schema）：要求 data 为 object 且含 id；返回 `{id:data.id,title:data.title||"Untitled Project"}`。这里没有消费 latest_version_id，不声称创建必返回它。
- Source：0kfolb-xhy_j4.js / module 140764 / o=createProject；定义 1333052，POST **1333113**，byte 1333166。
- Status：**FOUND_STATICALLY**（扩展参数/通用创建）；Confidence：High。
- Evidence：export 名、直接 POST 及 params 表达式；management module 759985 的 D 回调在 1304771 调用 m.createProject。createAndSaveNewStudioProject 的 G 回调先 D，再 R 保存 state；createAndLoadNewStudioProject 则先创建、再在客户端构造初始 state。源码不是 create body 含 state 的证据。

```js
{query:{title:t,...void 0!==n&&{major_version:n},
  ...a?.trigger!==void 0&&{trigger:a.trigger},
  ...a?.extract_mode!==void 0&&{extract_mode:a.extract_mode},
  ...a?.num_stems_sent!==void 0&&{num_stems_sent:a.num_stems_sent},
  ...a?.entry_source!==void 0&&{entry_source:a.entry_source}}}
```

## Save Project / Save Version

- **Endpoint / Method：POST `/api/studio/save-project`**。
- **Request schema：body `{project_id:t,state:a,title:n}`**，state 是保存链传入的整份序列化 state，没有独立 tracks/clip PATCH。
- Response schema（局部消费）：读取 `data?.version_id`，缺失/假值时抛 `No version ID in save response`；helper 返回该值。未推断额外 server fields。
- Source：0kfolb-xhy_j4.js / module 140764 / l=saveProject；定义 1333632，POST **1333674**，byte 1333727。
- Status：**FOUND_STATICALLY**；Confidence：High。
- Evidence：management module 759985 的 R 保存回调，**1304075** 调用 `n.serializeProjectState(t)`，**1304114** 调用 `m.saveProject(d,e,a,r)`；把返回版本 id 存进 latestVersionId 相关状态，并 invalidate studio-versions-latest 查询。

management 返回 `saveProject:z,saveProjectVersion:z`（1306467/1306481 周边），两个名称为同一个 z 回调。z 更新本地 loaded project，再 R → serialize → POST。`createAndSaveNewStudioProject:G` 是 create 后 save；没有凭空建立独立 create/save/update version endpoint。源码内部 loading/ref guard 与 UI 权限不是可跳过的服务端权限证明。

版本读取关联（本轮仅静态，未调用）：GET `/api/studio/project_revision/{revision_id}`（1332604）、GET `/api/studio/{project_id}/version/{version_id}`（1332841）、GET `/api/studio/{project_id}/versions`（return_days_only=false，0ureacebq_re1.js 18467/28516）。loadProjectByVersionId 先取得 revision.project_id/is_owner，再取 version.state；latest_version_id 被直接读取为 latestVersionId。此链不证明 revision_id、version_id 在所有情境均可互换。

## Whole-state serializer 与真实 fixture

project-save serializer 为 **module 634782**（0kfolb-xhy_j4.js，export 145371、定义 145397）。遍历 audio tracks/clips 与 takeLanes/clips，收集 warp markers，去重到 markersRegistry，保存 clip.warp.markersHash；反序列化恢复 markers。内部对 state/track/clip 使用展开复制，其他字段继续保留。不能把该客户端内存到 wire 的转换反复套用在已经 serialized 的 GET state 上而不验证输入形态。

context render 同一 chunk module 130800 另导出 serializer（371089、函数 p，1308225）：在渲染前整理 warp markers。V2 export 又用另一项 serializer 与 state/timing 变换。三条路径不应当凭名称混用。本轮没有移植 serializer、简化 state 或发送任何保存。

用户真实 GET body：37325 bytes，SHA-256 **a1e2213a987eaa3c3012244eed3e69c9b5e044c1ad54b9fb288f3e19d9ecc334**。Downloads 原文件和 `captures/studio_project_3ebbb451-08a7-4599-9885-788f0b8f5def.json` 字节副本均保持不变。后者 Git ignored，不进交付包。

`fixtures/studio_project_get.json` 仅替换 22 处 title/name 展示标签；保留全部 key、类型、未知字段与数值/ID 引用。原文没有 auth/account/token/email/URL 字段，也没有非空 lyricsCorrections。state 含 1 audio track、20 audio arrangement；warp.enabled 全 true、transposition 全 -8，markersRegistry 有 2 项，bps=1.95。各 arrangement id 与 asset/clipId 是独立字段；源码/fixture 没有将 beats 换算为 seconds。对比校验除已声明标签替换外全部 JSON 值相同，原输入 SHA 未变化。

薄类型见 `suno/studio/models.d.ts` 的 StudioProject/State/Track/Clip/Timing；开放索引为 unknown，未理解字段保留。optional 表示薄客户端兼容其他版本，不是声称当前 fixture 缺少字段。`StudioClient.get_project` 只发已确认 GET，返回完整原对象，拒绝 metadata-only 响应，不构造默认 state。

## Context Render / Export

- **Endpoint / Method：POST `/api/studio/render-state`**。
- Status：**FOUND_STATICALLY**；Confidence：High（两条独立 body 构造链）。
- Source A：0kfolb-xhy_j4.js / module 130800 / y=default，定义 1309054，POST **1309291**，byte 1309344。
- Request schema A：title、lyrics、state、project_id、start_beats、end_beats、downbeats、web_client_pathname、render_engine；StudioExport 分支增加 studio_project_id/export_mode，其他分支增加 from_studio_project_id，export_mode="rendered_context_window"。title 可由 state.title 派生，state 经过两层 transform + 本模块 serializer。
- Response A（局部）：要求 data，检查 moderation_error_message，返回 data；helper 本身不证明完整响应字段。

原 body 表达式保存在证据中；分支关键代码：

```js
...e.clipType===f.StudioExport
  ?{studio_project_id:e.studioProjectId,export_mode:e.exportMode}
  :{from_studio_project_id:e.fromStudioProjectId,export_mode:f.RenderedContextWindow}
```

`StudioRenderClipType.RenderedContextWindow="rendered_context_window"`、StudioExport="studio_export"，SelectionDownload="selection_download_export"。它与用户提供的最终 metadata.type 名称一致，但用户没有给该次原始 POST，因此这只是语义关联，不提升此 endpoint 状态，也不声称参考网站后台就是调用此分支。

- Source B：3g9-3c-u44c0o.js / module **748387** / useCallback H，定义 825347，POST **825864**，byte 826412。
- Request schema B：title、lyrics、tags=""、negative_tags=""、style_summary=""、caption=""、state、start_beats、end_beats、project_id、studio_project_id、studio_project_version_id（g??undefined）、web_client_pathname、downbeats、export_mode、render_engine="v2"。export_mode 为 fullsong_export 或 selected_time_range_export；state 过滤 effectively muted tracks，再转换 timing 为 manual/derived timing、metronome 为 disabled，并调用 serializer。不能拿这条加工路径当 save-state 默认行为。
- Response B：检查 data、moderation_error_message；在 **826991** 消费 `I({id:C.data.id,title:C.data.title||e})`。所以此分支返回的 **id** 被传给导出 clip 流程；不是猜测 body/response 字段叫 clipId。完整服务端响应、轮询 API 与成功下载未在本轮执行/验证。

`project_id:N.currentProjectId`、`studio_project_id:m`、`studio_project_version_id:g` 来自不同表达式。不能把这几个 ID 全部替换成同一个已知 Studio project ID；本轮没有推断 N.currentProjectId 的服务端资源身份或生成替换规则。

## Multitrack Render / Export

- **Endpoint / Method：POST `/api/studio/render-state-multitrack`**。
- Source：455mvnvi04a89.js / module 329176 / es=downloadMultitrackV2，定义 24637，POST **24676**，byte 24680。
- helper Request schema：`body:t`（整个传入对象）；只看 helper 不能得出字段。
- 实际调用者：3g9-3c-u44c0o.js 的 **827489** call 起点（member 起点 827492）U callback 调用 `A.downloadMultitrackV2(c,{...})`；body 在证据中原样保留。
- 调用者 body：title、project_id、from_studio_project_id、studio_project_id、studio_project_version_id、web_client_pathname、lyrics、tags/negative_tags/style_summary/caption 的空字符串、state、start_beats、end_beats、downbeats、format="wav"、render_engine="v2"、export_surface=MultitrackExportSurface.StudioV2（常量值 "studio_v2"）。state 为 render transform/serializer，不能简化为 tracks。
- Response schema（局部消费）：helper 检查 error.detail/error_type、response.status；要求 `data.download_url`，创建下载 link，再返回 data。它不是上述单 clip id 导出分支；签名 download URL 必须留在浏览器，当前 transport 日志脱敏值不可作为下载输入。
- Status：**FOUND_STATICALLY**；Confidence：High（已追到 helper 的实际 object 参数）。

## 同一模块与全页面 Studio endpoint 清单

module 140764 全部 8 条调用：GET project、GET project_revision、GET version、POST create-project、POST save-project、POST create-or-load-project-for-clip、GET clips/{clip_id}/projects、POST project_revision/{revision_id}/clone。clone body `{title:a,...void 0!==n&&{major_version:n}}`；create-or-load 无 body。均不在本轮执行。

116 chunk 的 literal/template AST 引用共有 25 处，与识别的 HTTP calls 数一致，17 个不同路径模板；未发现其他 dynamic `/api/studio/` 引用或该命名空间 PUT/PATCH/DELETE。这个结论仅限已接收范围与当前解析方法，不声称后端或未加载客户端不存在其他接口。

| 路径模板 | Method | 请求字段/角色 |
|---|---|---|
| /api/studio/project/{project_id} | GET | project_id path；完整读已由用户真实响应确认 |
| /api/studio/project_revision/{revision_id} | GET | revision_id path |
| /api/studio/{project_id}/version/{version_id} | GET | 两个 path ID |
| /api/studio/{project_id}/versions | GET | return_days_only=false |
| /api/studio/list-projects | GET | cursor/limit/name/archived/sort_order/bookmarked query |
| /api/studio/create-project | POST | query，见 Create |
| /api/studio/save-project | POST | project_id/state/title，见 Save |
| /api/studio/create-or-load-project-for-clip/{clip_id} | POST | path clip_id；响应消费 id |
| /api/studio/clips/{clip_id}/projects | GET | path clip_id；响应消费 projects |
| /api/studio/project_revision/{revision_id}/clone | POST | title、条件 major_version |
| /api/studio/project/{project_id}/metadata | POST | title/notes/image_s3_id 或 title-only；不是 timeline save |
| /api/studio/project/{project_id}/archive | POST | path；无 body |
| /api/studio/project/{project_id}/unarchive | POST | path；无 body |
| /api/studio/project/{project_id}/bookmark | POST | bookmarked body |
| /api/studio/render-state | POST | 两个不同 state/render body |
| /api/studio/render-state-multitrack | POST | whole caller body |
| /api/studio/clip/{clip_id}/download | GET | format query；媒体读取，不当作 submit export |

上表中除已有真实 READ/default create 范围外均 FOUND_STATICALLY。metadata 改名、archive、bookmark、clone 不是本轮执行目标。`studio_project_start_beats` / `studio_project_end_beats` 在本次公开源 AST 中未出现；实际请求构造用 start_beats/end_beats，不改写成相似名字。

## 变更、验证与限制

- 新 `scripts/analyze-studio-write.mjs`：校验 manifest SHA 后 AST 提取 import/member call/export/keyword/path 与 source map 线索；不执行代码/网络/API。不能声称全程序调用图；动态 aliases、局部重绑定和非当前 bundler 形式仍可能漏检。
- 修正原 analyzer：`e.s(["default",0,function...])` 中的 0 不再被误识别为模块 ID。V2 render 的真实注册模块为 748387，先前旧分析结果 moduleId=0 是归属错误，endpoint/method/body 不变。新增回归测试。
- `fixtures/studio_project_get.json` / provenance、薄 types/full getter、只抛 NotImplementedError 的 save_version/export_multitrack skeleton；静态 endpoint 元数据与 VERIFIED registry 分开，无任何 write dispatch 实现。
- **35/35 单测 PASS**：真实脱敏 fixture 20 clips、warp registry引用、transposition 保留、未知字段/原对象无损、wrong-id/metadata-only 拒绝、write skeleton 零调用、静态模块归属/别名/非执行测试。真实集成测试保持默认关闭；本轮不以 tests 或 source 代替真实写验证。
- 当前 controller 返回 bridgeOnline=false、auth unknown；这是本轮现查状态。静态分析及用户导出的 body 不依赖它。未重装脚本或索取 token，也不声称新增 getter 已在当前离线 bridge 实际重播。
- 5 个关键 sourceMappingURL 的真实 URL 均 GET 404，来源记录于 source-map-check.json；没有枚举猜测其他 map。
- 原 fixture 从 body 导出，不含 HTTP headers/capture timestamp；HTTP 200 和来源由用户确认，不伪造 wire/header 证据。源码和真实 GET 支持模型/调用构造，不能证明写权限、server schema 全集、render moderation 或持久化效果。

## 复核与交付

```powershell
node scripts/analyze-studio-write.mjs captures/official-write/20261005/manifest.json captures/official-write/20261005/write-analysis.json
npm test
```

README/API Map 同步本轮结论。原公共源码和完整解析结果在 ignored `captures/official-write/20261005/`；用户 raw body 字节副本 ignored，不共享。独立 patch 为 `deliverables/SUNO_STUDIO_WRITE_STATIC.patch`，仅基线后本轮变更，隔离应用后与目标 Git blobs 一致。证据包 `deliverables/SUNO_STUDIO_WRITE_STATIC_EVIDENCE.zip` 从独立 `.evidence-staging/phase1-studio-write-static-20261005` 构建，含本报告、脱敏 fixture/provenance、精简调用/body证据、manifest/hash、测试/验证日志；无完整源码、依赖、raw body、token、历史包或嵌套包。zip SHA-256 外置。

本轮静态任务到此结束，不自动推进未知写重播。账号具备相应权限时，仍需逐个实际观察 create/save/render 请求并单独重播，确认 version relation 和服务器 state diff，之后才能实现这些业务写方法。

## 后续：最小只读验证与安全客户端边界（2026-10-05）

本轮未继续静态扫描，controller 经浏览器/Tampermonkey 各派发一次以下 GET，均 HTTP 200，无自动重试或 Studio POST：

| Endpoint | 当前状态 | 确认内容 |
|---|---|---|
| GET /api/studio/project/{project_id} | VERIFIED（此前） | 用户真实完整 project fixture；本轮未再次请求 |
| GET /api/studio/{project_id}/version/{version_id} | VERIFIED | 响应 id=version_id、project_id=真实 project；含 state，与 fixture 的 transport 脱敏投影一致（去除展示标签） |
| GET /api/studio/{project_id}/versions?return_days_only=false | VERIFIED | 顶层 id=真实 project，aggregated_versions[].versions[].version_id 包含真实 latest_version_id |
| GET /api/studio/project_revision/{revision_id} | FOUND_STATICALLY | 未有明确 revision_id，不把 version_id 代替它，未调用 |

version response 顶层实测字段为 id/project_id/state/created_at；列表顶层为 id/aggregated_versions，分组为 hour/versions，每项为 created_at/version/version_id。类型开放并保留完整返回值。`StudioClient.get_project_version` 和 `get_project_versions` 仅发 GET，验证资源关系；response 完整 schema 来自实验日志，不由字段清单拼造 fixture。原 project fixture 不变。

**timeSignatureChanges 限制：** v1.3.15 的 sensitive-key regex 匹配 `signature`，把音乐 timeSignatureChanges 掩码。第一次严格 state 比较因此失败；在不重复请求的情况下，对原 fixture 应用同一已安装隐私规则，其摘要与真实版本响应完全相符。除 title/name 展示标签和该掩码字段外，完整 state 的结构/数值/clip引用匹配；这足以确认读取与工程/版本关系，不能称为无损 state 获取。报告保存首次比较和后续判断两个文件。未修改原 fixture 或已安装 userscript；带掩码或 omitted 的 state 不能进入保存/渲染准备。

`create_project/save_project/render_project/render_multitrack`、save_version/export_project/export_multitrack 均抛 `NotVerifiedError`（继承 NotImplementedError），没有解锁参数或当前写 gate。create 历史默认 VERIFIED 记录保存在 HISTORICAL_VERIFICATIONS，只读 VERIFIED_ENDPOINTS 中已移除 create。四个当前写候选仍 **FOUND_STATICALLY / High**，历史证据与当前账号写许可区分。通用 raw-call 未改，它是明确人工调试能力，不由 StudioClient 写方法调用。

### State 与 serializer 路径

```text
raw wire state（收到的 JSON，可能被 transport 掩码）
  → rawWireState
  → deserializeEditorState(raw, 显式 deserializer adapter)
  → EditorMemoryState
  → serializeProjectState(editor, 显式 project serializer adapter)
  → SaveSerializedState
  → buildSaveProjectRequest({project_id, state, title})
  → 只读 preview；没有 POST dispatch
  → 将来真实保存成功时才消费 version_id

EditorMemoryState
  → prepareRenderTransformedState(editor, 显式 transform, 显式 render serializer)
  → RenderTransformedState
  → buildRenderProjectRequest / buildRenderMultitrackRequest
  → 只读 preview；没有 POST dispatch
```

类型使用不兼容 domain 品牌，运行时使用 WeakMap handle 校验；不接受伪造 kind、GET raw handle、render handle 作为 save 输入，也不接受 save handle 用作 render。没有隐式 identity/default adapter；不存在官方 serializer 的本地已验证移植。接口接受 JSON-compatible state 快照，adapter 语义尚需验证。读取不改变字段；adapter 在隔离副本上执行，未知字段由 adapter 完整保留，单测确保示例快照不会修改原 state。掩码/omitted 数据在转换入口和输出均拒绝。

create builder 仅构造静态已出现的 query，省略 body。save builder 只包装完整 SaveSerializedState 为 project_id/state/title，不再次序列化。两个 render builder 仅预览静态 V2 分支；project_id、studio_project_id、studio_project_version_id 为不同显式输入，绝不按名称替换。context-window branch 没有被合成为新实现。

render-state 对应生成/render clip；局部消费 data.id/title/moderation_error_message，开放 response fragment 不声称完整响应只有这些字段。multitrack 对应多轨下载，独立 download_url fragment（不能当 render clip schema）。前者不会加入 format/export_surface/from_studio_project_id 的 multitrack 字段；后者为 wav/v2/studio_v2，省略单轨 export_mode。download_url 签名仍不保存真实值或用日志掩码值下载。

### 账号具备真实写权限后的最少三个官方动作

1. **Create：** 从官方工程列表开始，capture marker=create；只创建一次空工程，捕获实际 query/body 和响应 IDs，再只读确认工程与版本关系。历史默认 create 证据不替代当前版本权限验证。
2. **Save：** 打开测试工程，capture marker=save；只移动一个已知 clip 一次，让官方完成一次保存。捕获完整 save state、版本响应，GET 新 version/project 比较指定 clip 位置及所有未知字段保留。不要另外手工点击多个编辑动作。
3. **Export：** 从已保存状态开始，marker=export；只提交一次官方单轨导出，捕获 render transformed state、关联 IDs、返回 clip 与官方后续状态。multitrack 是独立第四个可选动作，不能由单轨成功推导。

只在账号正常具有权限后做这三个动作；本轮不执行、不修改权限或 entitlement。录制完整、实际重播成功及状态读回验证后才能升级写状态。

## 后续：音乐 meter 隐私修复（2026-10-05）

源码中的 timeSignatureChanges 误掩码已通过精确 JSON key 例外修复，生成 v1.3.16；值仍递归过滤凭据，header/query/signed URL 和相似名称不放宽。49 项单测通过，真实 source fixture 的全部业务值经浏览器/后端双重过滤相等，原 fixture 不改写。

当前浏览器仍为 v1.3.15/waiting；本轮暂未发送新的 version GET，也不能宣称修复已在真实浏览器端到端验证。新只读实验要求匹配 installed version/build，strict 模式必须提供原真实 JSON 并比较所有 state 值（包括展示标签），无掩码才能成功；只存 schema、摘要和业务 IDs，不存原值/认证。本轮保留3001 controller/bridge 页面待用户安装更新，原3000不动。真实读验证完成后仍不放行任何写方法；save/render serializer 仍只提供显式 adapter，不能自动再次序列化 GET。报告：[STUDIO_METER_PRIVACY_REPORT.md](../reports/STUDIO_METER_PRIVACY_REPORT.md)。

## v1.3.16 动态只读收尾（2026-10-05）

交接后用户已安装1.3.16，后端实际确认 ready 与目标 build。指定 project/version 只执行一次 authenticated GET，HTTP 200；响应资源关系正确，全 state 与 Downloads 原真实 JSON 规范化严格比较相等（含 title/name 和所有未知字段），timeSignatureChanges 相等，无掩码，losslessState=true。此次无损 wire 验证通过，不再处于 pending；详细 schema/摘要/原输入哈希见 [STUDIO_METER_LIVE_VERIFICATION_REPORT.md](../reports/STUDIO_METER_LIVE_VERIFICATION_REPORT.md)。旧 pending 日志/包保留为历史证据，未覆盖。

没有 Studio 写请求，write endpoint 仍 FOUND_STATICALLY / High，所有写方法及 preview guard 保持拒绝。无损 GET 不验证 in-memory deserializer、save serializer 或 render transformation，也不意味着取得写权限或服务器持久化效果。接下来只有账号正常具有写权限时，才逐一 capture create/save/export 三个官方动作；本轮到只读验证完成为止。

## Clip pipeline 扩展与当前 serializer 状态（2026-10-05）

Add Clip 已恢复为 **CLIENT_STATE_MUTATION / FOUND_STATICALLY**，不是一个新写 endpoint。library drop/intent 构造 audio arrangement，native store 添加 entity 与 container membership，save 时序列化整个工程。已取得模块的 17 个 method/path 模板仍无单独 arrangement insert API；create-or-load-project-for-clip 属于工程初始化 helper。

本地新增 `deserializeAudioProjectState` / `serializeAudioProjectState`：对 audio MVP 显式重建 module 634782 的 inline markers ↔ registry/hash 转换，保留未知字段，严格拒绝不完整/掩码/错误域。marker hash 复现 module 879379 的当前 MD5 算法；真实历史 fixture 使用不同 hash 拼法，只在新 preview 输出改变 key，原 fixture 不变。静态 port 和本地往返测试不升级写 VERIFIED、不授权服务器提交，也不代替 render serializer。此前“只有 adapter 接口、未移植”的描述是扩展前的历史状态；现在有静态 local adapter，仍无 server write verification。

原四个 POST method/path/body schema、NotVerifiedError 入口及 dispatchAllowed=false preview 不变；render-state 的生成/clip 流程与 multitrack download_url 模型继续分开。通用 raw-call 能力未修改，本轮未调用。

## 当前静态/离线收敛结果（2026-10-05）

本节更新当前状态，前面的pending描述与旧报告保留为历史。已有116个asset快照做固定目标AST追踪，无新下载，无真实Suno读写。GET三个状态不变；所有写继续FOUND_STATICALLY / High / dispatchAllowed=false。

| Candidate | Exact recovered request | Partial response use | Current implementation |
|---|---|---|---|
| POST create-project | query title；不同callsite的major_version/trigger/extract_mode/num_stems_sent/entry_source；无body | id/title；完整schema UNKNOWN | Pure preview；production throws |
| POST save-project | `{project_id,state,title}`，serializer634782；无已观察base_version/If-Match | version_id；完整schema UNKNOWN | Save handle + strict validation；production throws |
| POST render-state | V2 title/lyrics/tags/negative_tags/style_summary/caption/project_id/studio_project_id/optional studio_project_version_id/web_client_pathname/state/start_beats/end_beats/downbeats/render_engine/export_mode | moderation error / id/title；open schema | Scoped state chain + preview；production throws |
| POST render-state-multitrack | Distinct V2 body incl from_studio_project_id/format=wav/export_surface=studio_v2；no single-track export_mode | download_url；open schema | Separate preview/transform；production throws |

上表来自真实callsite，不代表同一路径所有分支都只有这些字段。完整表达式/source offset见inventory。create-or-load-project-for-clip POST无body、消费id，是素材关联工程初始化/加载；clips/projects GET消费data.projects；project_revision GET消费project_id/is_owner，不把revision ID等同version ID；它们未动态VERIFIED，也未调用。

Save边界：raw-wire显式decode inline markers→EditorMemoryState→SaveSerializer→SaveSerializedState，只包装一次。PRESERVE_EXISTING用于已有工程编辑，unknown/orphan registry保留；current official serializer重建registry/hash，24条路径变化单独报告，decode语义等价，UNKNOWN/BLOCKER=0。selection/UI/runtime/clipCreationIntents/signalChain/automation/timing/routing由spread保留，没发现额外删除；SDK拒绝undefined/Map/Set/non-JSON及redacted/omitted状态，null保留。No-op仅证明本地安全，不升级服务器VERIFIED。

Render边界：effectively muted track filter→17660 supported assets→950155 main clip mute→derived manual timing/metronome→current serializer重建referenced registry；downbeats/range已移植。Editing PRESERVE_EXISTING不能流入render。非空歌词alignment/crop/merge未全port，tempo automation/follow-track/take lanes超出MVP显式拒绝。详见render pipeline。

Registry准备逐endpoint eligibility：VERIFIED AND显式allow_verified_studio_writes=true AND human review/schema/evidence。它不提供当前生产激活能力，StudioClient/shared guard物理拒绝。合法观察/受控复现后仍需单独审查activation adapter，不全局解锁其他写。ExpectedProjectVersion仅本地检查latest_version_id，wireFieldsAdded=[]，不编造并发字段。

Capture/比对/回放工具自动A–H归档和deferred save配对，不修改文档/registry状态。新被动harness尚未真实浏览器验证；合法权限出现后先做官方UI动作，不能以read或离线演练代替权限。真实write=0。[状态](STUDIO_SDK_STATUS.md)、[Harness](STUDIO_CAPTURE_HARNESS.md)、[计划](STUDIO_WRITE_VALIDATION_PLAN.md)。

后续有正常写权限时，验证动作扩展为 **A create → B add one existing clip → C save → D move → E save → F change one processing property → G save → H single-track export**，各动作独立 capture/marker，通过 before/after state 和 version_id diff 对应；遇到 autosave 明确记录其实际时序。只有捕获、单独重播及读回验证后升级 VERIFIED。详细证据和已实现/未实现边界见 [STUDIO_CLIP_PIPELINE.md](STUDIO_CLIP_PIPELINE.md)。本轮停止在本地 preview。
