# Studio API Map

所有 Studio 接口均视为 Unofficial / Internal / Unstable。本表是证据状态表，不是 endpoint 猜测列表。

| 操作 | Observed endpoint | 状态 | 证据 |
|---|---|---|---|
| 新建空工程 | `POST /api/studio/create-project`，query 见下文 | OBSERVED | 第二轮仅一次创建；用户确认 query 值；尚未 controller 重播 |
| 读取工程元数据 | `GET /api/studio/project/1cded173-6e85-4db7-9aeb-7d3b7f4f1163` | OBSERVED | 038 配对记录；未通过 controller 重播 |
| 添加已有音频 | UNKNOWN | UNKNOWN | 未捕获 |
| 新建 clip | UNKNOWN | UNKNOWN | 未捕获 |
| 移动 clip | UNKNOWN | UNKNOWN | 未捕获 |
| 调整 clip 起点/终点 | UNKNOWN | UNKNOWN | 未捕获 |
| 调整 timeline 位置 | UNKNOWN | UNKNOWN | 未捕获 |
| 保存工程 | UNKNOWN | UNKNOWN | 未捕获 |
| 重新加载工程 | UNKNOWN | UNKNOWN | 未捕获 |
| 导出/render | UNKNOWN | UNKNOWN | 未捕获 |

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
