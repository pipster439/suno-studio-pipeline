# Studio API Map

所有 Studio 接口均视为 Unofficial / Internal / Unstable。本表是证据状态表，不是 endpoint 猜测列表。

| 操作 | Observed endpoint | 状态 | 证据 |
|---|---|---|---|
| 创建（当前客户端） | `POST /api/studio/create-project` | FOUND_STATICALLY / High | 历史默认创建 VERIFIED 证据保留；当前写 dispatch 关闭 |
| 读取工程元数据 | `GET /api/studio/project/{实际返回的 id}` | VERIFIED | controller GET、StudioClient GET、官方 GET 元数据均与创建响应一致；只含 metadata |
| 读取完整工程 | `GET /api/studio/project/{project_id}` | VERIFIED | 用户真实 HTTP 200 fixture |
| 读取版本 | `GET /api/studio/{project_id}/version/{version_id}` | VERIFIED | 本轮 authenticated replay HTTP 200；id/project_id 与真实基线相符；state 对应（见脱敏限制） |
| 读取版本列表 | `GET /api/studio/{project_id}/versions?return_days_only=false` | VERIFIED | 本轮 HTTP 200；返回工程 id 与包含 latest_version_id 的 grouped history |
| 读取 revision | `GET /api/studio/project_revision/{revision_id}` | FOUND_STATICALLY | 未取得真实 revision_id；未调用 |
| 添加已有音频 | UNKNOWN | UNKNOWN | 未捕获 |
| 新建 clip | UNKNOWN | UNKNOWN | 未捕获 |
| 移动 clip | UNKNOWN | UNKNOWN | 未捕获 |
| 调整 clip 起点/终点 | UNKNOWN | UNKNOWN | 未捕获 |
| 调整 timeline 位置 | UNKNOWN | UNKNOWN | 未捕获 |
| 保存工程 / 版本 | `POST /api/studio/save-project` | FOUND_STATICALLY / High | whole serialized state；未写验证 |
| 重新加载工程 | `GET /api/studio/project/{project_id}` | VERIFIED（读取） | 不表示新写入已持久化 |
| 导出/render clip | `POST /api/studio/render-state` | FOUND_STATICALLY / High | 独立 render state；未写验证 |
| 多轨下载 | `POST /api/studio/render-state-multitrack` | FOUND_STATICALLY / High | download_url 局部消费；未写验证 |

状态定义：UNKNOWN = 未识别；OBSERVED = 真实官方操作捕获到候选；REPRODUCED = 通过通用 bridge 成功复现候选；VERIFIED = 复现后读回/官方 UI 比较确认该业务行为成功。录到请求、看到 HTTP 200 或函数命名合理，都不足以确认业务接口。

## 非 Studio 工程接口：认证探针

`GET /api/session/` 的路径来自用户提供的 userscript 的 publish()，没有根据名称推测新接口。2026-10-05 已通过本机 controller → 实际浏览器 → Tampermonkey → Suno → 返回完整 round-trip 只读测试。只保留测试通过结果，不保存 session 响应或认证头。这不验证任何工程/clip/timeline 操作。

## 每个已观察操作的记录模板

操作名称；Observed endpoint / method；Request / Response 脱敏结构；重要 ID；状态；观察日期；capture 文件；操作前后差异；重复实验；复现命令；读回/UI 证据；不确定性。先观察后填写，VERIFIED 需要成功复现及效果确认。

## 创建工程候选（首轮观察）

状态：**OBSERVED**。Verified：**no**。观察于 2026-10-05（Asia/Shanghai）。

实际 capture：`captures/2026-10-04T17-12-20-853Z-7e336b24`；005 和 010 两对记录，均为官方 fetch、POST、HTTP 200。停止时共 51 对，pending/queue/dropped 均为 0；请求归因仍受多个动作影响。

```text
POST /api/studio/create-project?title=<redacted>&major_version=<redacted>
request body: null
```

`title` 和 `major_version` 是实际观察到的 query 名称。值在两端脱敏前的浏览器记录阶段已掩码，无法从日志恢复。响应中的 `major_version: 2` 不是 request query 为 2 的证明，不据此填写 replay 参数。body:null 表示 recorder 未观察到 body，不证明未来调用必须以 JSON null 发送。

共同响应结构（真实返回字段）：

```json
{
  "id": "<project-id>",
  "title": "<title>",
  "created_at": "<server-timestamp>",
  "updated_at": "<server-timestamp>",
  "archived": false,
  "major_version": 2
}
```

| 记录 | 浏览器请求时间（UTC） | 返回 id | 返回 title | status |
|---|---|---|---|---|
| 005 | 2026-10-04T17:15:27.758Z | bea1ee72-b47f-4d8f-b43d-b16d2adfd056 | Untitled Project | 200 |
| 010 | 2026-10-04T17:15:34.083Z | 1cded173-6e85-4db7-9aeb-7d3b7f4f1163 | When the City Finally Sleeps | 200 |

005 的默认标题使其成为空工程创建的较强候选，但 metadata 响应不含 tracks/clips/timeline，不能仅凭标题和 HTTP 200 判定空工程语义。010 返回另一 id 和歌曲标题；同一 session 还有 feed、downbeats、aligned_lyrics、rights 等周边请求，未把它们认定为添加素材接口。

038 的实际 GET `/api/studio/project/1cded173-6e85-4db7-9aeb-7d3b7f4f1163` 返回同样的第二工程 metadata。它只支持“该工程元数据后来被官方页面读回”的观察；尚未验证完整工程状态或 timeline 持久化。不能把响应 metadata 当成完整 Studio 工程模型。

首轮结束 UI：工程标题为第二工程标题，显示 Preview / Upgrade to edit；New Project 对话框再次打开，存在 New empty project 按钮。无需绕过权限、升级或付费。

## 创建工程候选（第二轮重复观察）

状态：**OBSERVED**。Verified：**no**。观察于 2026-10-05（Asia/Shanghai）。

Capture：`captures/2026-10-04T17-25-08-444Z-7e83fae3`，标记 `create-empty-project-repeat-01`。2026-10-04T17:33:46.587Z 已停止；45 对记录的 eventId 均匹配，只有 039 为 create-project。停止前 recorder active，pending/queue/dropped 为 0；停止后 idle，后台 count=45、active=false。

```text
POST /api/studio/create-project?title=<redacted>&major_version=<redacted>
request body: null
039 request timestamp: 2026-10-04T17:27:49.141Z
039 response: HTTP 200, durationMs=301.7449999973178
```

用户先反馈 `"title": "Untitled Project", "major_version": 2`，随后明确确认来源是本次请求的 **Query String Parameters**。这是用户通过 DevTools 提供的非敏感请求参数证据，不能表述成 recorder 日志保留了原 query 值；原日志仍全部掩码。

已观察的 query 值可整理为以下待重播路径，**本轮未执行**：

```text
/api/studio/create-project?title=Untitled%20Project&major_version=2
```

039 的真实返回：

```json
{
  "id": "e6b9e167-14c3-4f44-a3b1-d28d2cb4016f",
  "title": "Untitled Project",
  "created_at": "2026-10-04T17:27:55.086Z",
  "updated_at": "2026-10-04T17:27:55.086Z",
  "archived": false,
  "major_version": 2
}
```

与首轮 005 比较：method/path/query 键一致，响应字段结构、默认标题、版本、archived 值一致；工程 id 和服务器时间不同。041 随后访问含新 id 的 agent conversation 路径，只作为 id 的周边关联证据，不认定为完整工程读取或保存 API。

当前官方 UI 显示 Untitled Project 和 Preview / Upgrade to edit；还出现 Audio Track 及非零播放头。响应不含 timeline，capture 也包含页面重载、旧工程元数据读取、周边 billing 请求，不能断言整段只含一个 UI 动作、Audio Track 来自创建接口、或空 timeline 已证明。中间曾观察 recorder heartbeat 过期，随后恢复；终态 0 dropped 不足以证明所有中间行为均被捕获。

下一步只研究创建操作的 controller 重播与元数据读回：需单独 capture，使用上述已确认 query，避免把 null body 观察变成强制 JSON null，随后比较新 id 和官方 UI。成功重播并确认业务效果之前仍为 OBSERVED，StudioClient 不变。其他素材、clip、保存与导出接口继续 UNKNOWN。

## 创建默认空工程与读取元数据（实际重播验证）

状态：**VERIFIED**。Verified：**yes，范围限下述默认创建和 metadata 读取**。验证于 2026-10-05（Asia/Shanghai）。

Browser bridge/auth ready v1.3.15，buildId 与本机生成脚本一致。独立 capture：`captures/2026-10-04T17-57-48-725Z-012f905d`，标记 `controller-create-replay-01`，已停止共 7 对官方被动 fetch 记录；停止前 online、pending/queued/dropped 为 0。controller 重播走 Tampermonkey GM transport，不会经过官方 fetch/XHR hook；因此重播的请求意图/响应另存于 `.evidence-staging/phase1-create-replay-20261005/evidence`，**不冒充为官方被动捕获**。

```text
POST /api/studio/create-project?title=Untitled%20Project&major_version=2
body: 省略（SunoBridge.call options 没有 body 属性）
requestId: 0d2d8754-8fda-450b-ab3b-6c8fc767daca
status: 200; browser durationMs: 1217
```

只发出一次创建，无自动重试。真实响应：

```json
{
  "id": "5595bf9c-3967-403b-bda0-5a1b9a4adaff",
  "title": "Untitled Project",
  "created_at": "2026-10-04T17:58:39.662Z",
  "updated_at": "2026-10-04T17:58:39.662Z",
  "archived": false,
  "major_version": 2
}
```

验证链：

1. controller 通过真实 bridge 创建新 id，与此前三个观察 id 不同。
2. 以已观察 `/api/studio/project/<id>` 路由代入实际新 id 执行 GET，HTTP 200，整个 metadata 与创建响应深比较一致。
3. 官方 Project menu → Open Project 显示 My Projects / Newest First。001 返回 `projects` 列表，新 id 位于最新条目；仅提取该 id 的存在和位置作为证据，不在交付包保存完整工程列表。
4. 打开最新默认标题工程后，005 官方 GET `/api/studio/project/5595bf9c-3967-403b-bda0-5a1b9a4adaff` HTTP 200、metadata 再次一致；006 conversation 路径含同一个 id，辅助确认打开对象。
5. 官方 UI 对话框关闭，标题 Untitled Project，播放头 00:00.000，只有 Main，未显示音轨或 clip；截图记录可见空 timeline。它验证当前打开行为，不建立未观察的 tracks/clips/timeline 数据模型。
6. 新增的 `StudioClient.get_project_metadata` 再次经真实 bridge 读回，metadata 一致。typed create 方法沿用同一个已验证协议；没有为重复测试再新增工程。

重要 IDs：返回 `id` 是本次工程标识，作为 metadata GET 路径段使用。`project_id` 是本地方法参数名，不声明其为此创建响应字段。白名单里的 clip_id/offset/duration/position 仍不构成任何 clip API 证据。

历史 Client 范围（当时）：默认创建曾放行 Untitled Project、major_version=2。当前默认写入口已全部关闭；get_project/get_project_version/get_project_versions 只读实现见后续更新。metadata 历史校验保留，不能用于验证 timeline 写入。

官方 UI 仍有 Preview / Upgrade to edit。创建及元数据读取验证不证明编辑、保存或导出权限。下一轮只观察添加一个已有音频；先确认用户是否有可编辑 Studio 工程。工程列表路由 `GET /api/studio/list-projects` 及 limit/name/archived/sort_order query 键为本次实际 **OBSERVED**，query 值仍脱敏，未重播、不实现列表 API。

## 参考客户端公开代码与未付费观察（2026-10-05）

证据来源扩展为 sunouploader.site 已下发前端与正常未付费导航，不要求执行付费工作流。详细函数/offset/body模板见 [REFERENCE_CLIENT_ANALYSIS.md](REFERENCE_CLIENT_ANALYSIS.md)。原有 VERIFIED 创建/metadata 范围未变化。

| 实际代码中的调用 | 分类 | Evidence kind | 状态 | Verified |
|---|---|---|---|---|
| POST `/api/uploads/audio/` | Suno 通用上传签名 | STATIC_CLIENT | UNKNOWN（代码模板已提取，尚无本轮运行/重播） | no |
| POST `/api/uploads/audio/{encoded observed upload id}/upload-finish/` | Suno 上传完成 | STATIC_CLIENT | UNKNOWN | no |
| GET `/api/uploads/audio/{encoded observed upload id}/` | Suno 上传处理状态 | STATIC_CLIENT | UNKNOWN | no |
| POST `/api/uploads/audio/{encoded observed upload id}/initialize-clip/` | 上传作品 clip，不能视为 timeline clip | STATIC_CLIENT | UNKNOWN | no |
| POST `/api/gen/{encoded returned clip id}/set_metadata/` | 作品 metadata | STATIC_CLIENT | UNKNOWN | no |
| POST `/api/project/{encoded workspace id}/clips` | 工作区引用作品，不能视为 Studio track | STATIC_CLIENT | UNKNOWN | no |
| GET `/api/project/me?...`；GET `/api/project/feed?...`；GET `/api/project/{encoded workspace id}/feed?...` | 工作区目录/作品 | STATIC_CLIENT | UNKNOWN | no |
| POST `/api/feed/v3` 的参考源码模板；GET `/api/clips/get_songs_by_ids?ids=...`；GET `/api/clip/{encoded id}[/]` | 作品库 | STATIC_CLIENT | UNKNOWN（feed 的单个官方查询另见下文 VERIFIED） | no（其他模板） |
| GET `/api/persona/get-personas/?page=...` | persona 列表 | STATIC_CLIENT | UNKNOWN | no |
| GET `/api/billing/info/` | 账户信息；排除重播 | STATIC_CLIENT / excluded | UNKNOWN | no |
| 网站 GET `https://sunouploader.site/api/projects` | 参考网站自己的资源 API | RUNTIME / website backend | OBSERVED（200、首个响应 projects=[]） | no（未重播） |
| 网站 POST `https://sunouploader.site/api/merge`；POST `/api/export` | 后端合并/导出入口，非 Suno endpoint | STATIC_CLIENT / website backend | UNKNOWN（模板已提取） | no |

上面的占位段仅是源码 encodeURIComponent 动态拼接的描述，不是猜测具体 ID；方法与 body 原始表达式保存在 analysis.json。模板缺少运行时证据，不填 VERIFIED_ENDPOINTS，不新增 StudioClient 方法。

优先操作现状：参考源码未揭示内部 Studio 创建/读取（此前官方证据仍有效）、track/clip、timeline positioning、clip 参数、保存/commit、render/export 的底层 Suno请求。全部新增 schema 仍 UNKNOWN。网站后端可能负责这些动作，但收到的代码和这次未付费运行时证据不足以确认实现；不调用受费控保护的端点、不修改权限字段来补足。

WASM 仅发现本地 MP3 编码静态引用，浏览器未加载二进制；不声称完成 WASM 逆向。此次导航的 bridge 事件数=0，因此没有新的实际 Suno 请求可供单独重播。

### 未付费运行时复验与 transport 恢复

2026-10-05 再次正常打开参考网站“项目”：网站 GET `/api/projects` HTTP 200，`projects=[]`、`auth` 仅保留类型；耗时 736.542 ms（CDP responseReceived）。request/response/cancel 事件均为 0，仍为网站 backend 的 **OBSERVED**，未新增 Suno Studio endpoint 或提升 VERIFIED。

脱敏网络记录通过现有 controller ingress 入库到 `captures/reference/2026-10-04T19-42-34-384Z-6a1c8d55/`，两条真实确认，已停止。证据链注明 `devtools-network-relay`，不冒充生产 GM recorder 验证。另一次显式真实只读集成测试证明 v1.3.15 的通用 transport 可用；不代表编辑/保存/导出可用。旧 v1.3.11 面板仍出现，后续写操作必须先消除共用事件 listener 冲突。详情见 [REFERENCE_RUNTIME_REPORT.md](REFERENCE_RUNTIME_REPORT.md)。

## 官方已下发源码模板（2026-10-05）

117 个实际出现的官方 JS chunk 中，提取 25 处调用、17 个不同 `/api/studio/` literal 模板。以下新增候选全部 **STATIC_CLIENT / UNKNOWN / Verified=no**，未实际调用，未放入已验证 endpoint registry。此前默认 create-project 与 metadata GET 的 VERIFIED 范围保持不变。原表达式、函数/字符/byte offset、来源哈希见 `captures/official-static/20261005/analysis.json`；详细调用关系与状态字段见 [OFFICIAL_STUDIO_STATIC_REPORT.md](OFFICIAL_STUDIO_STATIC_REPORT.md)。

| 实际出现的源码调用 | Method | 请求结构（静态） |
|---|---|---|
| `/api/studio/save-project` | POST | body: project_id、state、title；helper 要求响应 version_id |
| `/api/studio/project_revision/{revision_id}` | GET | path params: revision_id |
| `/api/studio/{project_id}/version/{version_id}` | GET | path params: project_id、version_id |
| `/api/studio/{project_id}/versions` | GET | path project_id；query return_days_only=false |
| `/api/studio/render-state` | POST | body 含 state、title、lyrics、start_beats/end_beats、project_id、export_mode/render_engine；两处分支不同，保留原表达式 |
| `/api/studio/render-state-multitrack` | POST | body 为函数参数 t；完整入参仍待合法观察 |
| `/api/studio/clip/{clip_id}/download` | GET | path clip_id；query format=a，未确认取值 |
| `/api/studio/create-or-load-project-for-clip/{clip_id}` | POST | path clip_id；未视为普通插入 clip |
| `/api/studio/clips/{clip_id}/projects` | GET | path clip_id |
| `/api/studio/project_revision/{revision_id}/clone` | POST | path revision_id；body title、可选 major_version；未执行 |
| `/api/studio/project/{project_id}/metadata` | POST | body title/notes/image_s3_id，另有 title-only 分支；未执行 |
| `/api/studio/project/{project_id}/archive`、`/api/studio/project/{project_id}/unarchive` | POST | path project_id；未执行 |
| `/api/studio/project/{project_id}/bookmark` | POST | path project_id；body bookmarked；未执行 |

剩余三个不同模板是此前已实际出现的 create-project、project metadata GET、list-projects；源码附加 query 参数不自动进入 VERIFIED。track/arrangement 使用客户端对象构造，保存链序列化 whole state，warp markersRegistry/markersHash 由 serializer 处理；这不证明不存在其他 clip API。

空工程只读运行时取得 tracks=[]、majorVersion=2、manual timing bps=2 和 beats selection/loop。它是浏览器状态，不是已验证的服务器完整工程读取或保存，不能据此完成 MVP。官方仍显示 Preview / Upgrade to edit；本轮没有账号写入或付费调用。

## 自有素材库第一页（非 Studio timeline API）

状态：**VERIFIED**。Verified：**yes，严格限本节单个查询**。Observed on：2026-10-05（Asia/Shanghai）。证据与测试见 [LIBRARY_VERIFICATION_REPORT.md](LIBRARY_VERIFICATION_REPORT.md)。

Observed endpoint：`POST /api/feed/v3`，官方 Library 点击产生的 fetch，非参考网站 backend。request body（account identifier 在共享文档中掩码）：

```json
{
  "cursor": null,
  "limit": 20,
  "filters": {
    "disliked": "False",
    "trashed": "False",
    "fromStudioProject": { "presence": "False" },
    "stem": { "presence": "False" },
    "stemComplement": "False",
    "user": { "presence": "True", "userId": "<observed current account id>" }
  }
}
```

Capture `2026-10-04T20-19-24-948Z-96ae9342` / 001：2026-10-04T20:19:40.435Z → 20:19:40.885Z，HTTP 200，450.59 ms。response JSON 包含 clips 数组和 has_more=false；实际 4 个条目的 id/title/status/entity_type/user_id 类型为 string，entity_type="song_schema"，status="complete"，metadata.duration 为 number。只证实观察到的这些字段；媒体 URL 已省略，不据此声明下载可重播。

Important IDs：`clips[].id` 是作品资源 ID；不能当作 Studio arrangement/track ID。`filters.user.userId` 与所有返回 user_id 一致，是账号资源身份，不能当作 session/auth token。薄层只接受来自当前 own-library 观察的 ID，服务端继续负责授权。

Verification：通过 localhost SunoBridge.call 原样重播，HTTP 200，4 个排序后的资源 ID、归属、has_more 与官方 capture 一致；LibraryClient 修正为真实 song_schema discriminator 后实际调用成功；独立显式真实测试也通过。官方 UI 的 My Workspace 显示 4 songs。controller 每次调用只派发一次、无自动重试；旧 v1.3.11 listener 停用尚未证明，不能据此断言上游只有一条请求。

同一单动作窗口另观察到 list-projects、project/me、project metadata GET；002/003 的 query 值仍脱敏，不猜值重播。005 notification 与 006 session 查询是延后的背景请求，未认定为素材库主调用。会话字段实际掩码已核验。

Only this body/query is VERIFIED；其他 filters、cursor、limit、workspace feed/get_songs/clip 路由继续 UNKNOWN 或 STATIC_CLIENT。LibraryClient.get_own_library_page 不负责完整素材分页、插入 timeline、保存或导出。现有 StudioClient 未扩大，MVP 未完成。

## 当前读取完整版本状态的阻塞复核（2026-10-05）

本轮只打开 Project menu，再在独立 marker 中点击 Share Project；未提交 rename、copy link 或 subscribe。前者 capture `2026-10-04T20-40-57-476Z-57326dfc` 为 0 对；后者 `2026-10-04T20-41-52-928Z-e860e668` 为 1 对，唯一记录是 GET `/api/billing/eligible-discounts` HTTP 200。此请求属于升级提示周边，排除 replay/API registry。对话框实际显示 Studio / Available with Premier 和 Subscribe，已关闭。

公开 `0ureacebq_re1.js` 的 Share modal 内部确有 GET `/api/studio/{project_id}/versions`、query return_days_only=false，但当前页面在进入它之前显示升级提示，本轮没有观察到该版本请求。它继续 STATIC_CLIENT / UNKNOWN / Verified=no；不把静态模板代入真实 ID 后强行调用，也不因此声称取得 revision/version state。

完整 get_project、timeline 写入、save/readback、export 仍未完成。当前证据支持的执行层仅默认创建、六字段 metadata、自有素材库固定第一页读取。更详细的完成性与阻塞审计见 [CONTINUATION_BLOCKER_REPORT.md](CONTINUATION_BLOCKER_REPORT.md)。

## 新完整 GET 证据与本轮静态写分析（2026-10-05）

本节使用用户新提供的真实响应，更新此前「尚未取得完整 state」的历史结论；旧报告保留当时证据，不作为当前 schema 的限制。GET `/api/studio/project/3ebbb451-08a7-4599-9885-788f0b8f5def`：**VERIFIED**，来源为用户导出的 HTTP 200 response body。latest_version_id=`e491cbde-9266-4884-997c-3a9789877a56`；[fixture/provenance](../fixtures/studio_project_get.provenance.json) 保存源 SHA 与脱敏规则，未虚构 headers/timestamp。

真实 state 含 1 audio track、20 audio clip，timing/markersRegistry/routing/selection/loop/layout/contextualWindowConfig 等字段完整保留。clip 有独立 arrangement id、clipId、asset.id/type=clip、start/end/readStartBeats、transposition=-8、warp.enabled=true、amplitude/mute/loop/fades/reversed/streaming/name/color。source 原文件未改动；共享 fixture 仅替换展示标签。`StudioClient.get_project` 返回完整 state 原值；新薄 types 保留未知字段。

写候选状态按本轮要求为 **FOUND_STATICALLY**，详细 schema、统一 client/helper、create→serialize→save/version、render 分支和具体 offsets 见 [STUDIO_WRITE_API.md](STUDIO_WRITE_API.md)。POST save-project 的 version_id 消费已找到；saveProjectVersion 与 saveProject 为同一回调。POST render-state 与 render-state-multitrack 也找到实际构造链，但未发送任何请求，不升级 VERIFIED。

新增 save_version/export_multitrack skeleton 只抛 NotImplementedError，既有 save_project/export_project 仍不 dispatch。完整 GET 已确认，不表示 timeline 写入、保存持久化或导出成功；此前完整 MVP 仍未验证。本轮按用户范围完成静态分析后停止。

## 最小动态只读验证与客户端边界（2026-10-05）

当前新增 VERIFIED：GET `/api/studio/{project_id}/version/{version_id}` 与 GET `/api/studio/{project_id}/versions?return_days_only=false`。

- project_id：3ebbb451-08a7-4599-9885-788f0b8f5def；version_id：e491cbde-9266-4884-997c-3a9789877a56。前者版本响应返回 id=version_id、project_id=project_id；后者顶层 id=project_id，aggregated_versions[].versions[].version_id 含该 latest version。
- 两条 GET 各由 controller 显式派发一次，HTTP 200，经过现有 v1.3.15 authenticated bridge；日志没有 auth header/token。版本 state 含 1 track/20 clips，与真实 project fixture 在 transport 可见字段上对应。第一次完整比较失败原因是 timeSignatureChanges 被隐私 regex 误掩码；原 fixture 脱敏投影摘要与收到的 state 一致。不能把该返回值称为无损 state，不能用它保存。
- revision_id 未知，没有调用 project_revision；version_id 不冒充 revision_id。
- GET wrappers 保留整个返回对象及未知字段。所有当前写入口及别名均 NotVerifiedError 默认拒绝；纯 builder 无 dispatch；历史默认 create 证据保留为历史事实，不充当写许可。
- raw wire / editor memory / save serialized / render transformed 使用独立品牌与运行时 handle；serializer 是显式 adapter 接口，GET 不自动重序列化。mask/omitted state 在写准备边界拒绝。
- render-state 与 multitrack 返回 fragment 分开，multitrack download_url 不套用到 clip render；真实完整 render response 仍未知。

实验记录：`captures/version-verification/20261005/version-read.json`（首次）、`version-assessment.json`（同一次响应的脱敏投影核验）、`versions-list.json`。报告/交付路径及后续 create/save/export 三个官方动作见 [STUDIO_READ_BOUNDARIES_REPORT.md](../reports/STUDIO_READ_BOUNDARIES_REPORT.md) 和 [STUDIO_WRITE_API.md](STUDIO_WRITE_API.md)。

## timeSignatureChanges 精确隐私修复（2026-10-05）

shared/privacy.cjs 已对精确 JSON key timeSignatureChanges 递归保留值，生成 userscript v1.3.16；相似名称、header/query、JWT/cookie/token 和 signed URL 仍过滤。49 项单测通过，包括真实完整 fixture/browser/backend 双重过滤；旧 masked-state 写准备拒绝仍保留。

本轮浏览器仍报告 v1.3.15/waiting，因此**尚未发出新 version GET**，也尚未获得修复后的真实无损 wire 证据。原有版本/列表 VERIFIED 关联证据不变，不把单测提升为动态完整 state 验证。更新脚本并确认 ready/version/build 后，用原真实 JSON（只读）对同一 version 全 state 比较，包括 display labels 和全部未知字段；只保存 schema/hash/result。详情见 [STUDIO_METER_PRIVACY_REPORT.md](../reports/STUDIO_METER_PRIVACY_REPORT.md)。写 API 继续 FOUND_STATICALLY / High；没有 Studio 写 dispatch，也不继续扫描 bundle。

## v1.3.16 最后一次只读 live verification（2026-10-05）

上述 pending 是修复交接阶段的历史状态。用户安装更新后，本轮 localhost 3001 后端确认 bridgeOnline=true/auth ready/version=1.3.16/buildId=83bff4080144256f30f44d26a3b50bc8eabc698c8b0fda1c1c3748ef5d1c9ab8，capture 关闭。

仅派发一次 GET `/api/studio/3ebbb451-08a7-4599-9885-788f0b8f5def/version/e491cbde-9266-4884-997c-3a9789877a56`，requestId=version-read-1791193822559，HTTP 200。返回 id=version ID、project_id=project ID；state 为1 track/20 clips，与用户原始完整 GET JSON 的 state 严格比较成功（包含所有 title/name、全部未知字段和值，不仅脱敏投影）。规范化全 state SHA-256 两侧均为99aa0d597aa89363847448d837d12b71f08bad730c4dad36a420bb53c2903418。timeSignatureChanges 为原1元素 array，字段 beatsPerSubdivision/startBeats/subdivisionsPerBar，相等；maskedStatePaths=[]、losslessState=true、verified=true。

该 version GET 的 **VERIFIED** 现在包括本次真实 state 的无损 transport 读回。不是 JSON 字节/对象key顺序比较，也不是所有未来 state 的普遍无损保证；认证过滤仍保留。没有第二次 GET、versions/revision 请求、Studio POST、权限变更或 bundle 搜索。所有 write 仍 FOUND_STATICALLY / High / 默认拒绝。新证据见 [STUDIO_METER_LIVE_VERIFICATION_REPORT.md](../reports/STUDIO_METER_LIVE_VERIFICATION_REPORT.md)；原 fixture 与旧报告/证据包不重写。

## Clip workflow：API 与 state mutation 分离（2026-10-05）

**ADD_CLIP = CLIENT_STATE_MUTATION / FOUND_STATICALLY / High**。官方已有 clip metadata → UUID audio arrangement / asset.id → native clip entity + track clipIds → project projection tracks[].clips[] → 整体 serialize/save 的链路已恢复。当前 loaded-client 17 个 method/path 模板没有独立 arrangement 插入 API；不新增猜测 endpoint。POST create-or-load-project-for-clip 是工程定位/初始化 helper，不等同于已打开工程内插入 clip。

新增纯本地 clip-pipeline 独立于 StudioClient HTTP 层：draft / processed clip / editor snapshot / save-serialized 的 handles 不混用；builder、顺序 placement、显式处理和 save preview 没有网络 dispatch。legacy StudioClient.add_clip 等业务写 stub 仍禁用，不把它改为未经验证的 HTTP 请求。

READ 状态不变；四个 POST 候选继续 FOUND_STATICALLY / High。本轮不重跑 live read / privacy 实验。pitch +8/import flag 与 transposition=-8 仍仅 OBSERVED CORRELATION；gain repair 的 Studio 映射未确认。详细 source offsets、markers 编码、serializer 边界和未来 A-create 至 H-export 单动作计划见 [STUDIO_CLIP_PIPELINE.md](STUDIO_CLIP_PIPELINE.md)，交付见 [报告](../reports/STUDIO_CLIP_PIPELINE_REPORT.md)。
