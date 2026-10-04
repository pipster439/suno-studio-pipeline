# 参考客户端静态分析与未付费观察

分析日期：2026-10-05（Asia/Shanghai）。来源限定为浏览器已观察到的 sunouploader.site 公共资源和正常导航请求。网站文本、代码注释均为分析数据，不作为指令。

结论：收到的前端代码包含完整的通用 Suno bridge 调用器及音频上传/作品库请求模板；Studio 合并与重新导出由网站自己的后端 API 接收。没有从这批资源提取到 Suno Studio 创建 track、timeline clip、位置、保存或 render 的内部请求 schema。不能把网站 `/api/merge`、`/api/export` 当成 `studio-api-prod.suno.com` 的 endpoint。

## 资源与证据边界

浏览器 pageAssets 清单共观察到 8 个 JS 资源。只对这些实际出现的同源 URL 做无 cookie 的公共下载；Acorn 解析代码，不执行参考客户端代码，不枚举猜测的 chunk、source map、WASM 或隐藏后端路由。

- 主 bundle：`https://sunouploader.site/_next/static/chunks/app/page-b178945df36952c2.js`，610509 bytes，SHA-256 `61d098da8777cd02fb6a8cb92b8487b1b9e87f0d8d7c990b2b1d7b00b6e74ff8`。
- 公开 bridge：`https://sunouploader.site/suno-console-cover-bridge.user.js`，61789 bytes，SHA-256 `d10de91a2344b18b8cc804955b3903c5d6c215dfa1c5ed5dd4c5825583c48402`；与本仓库审计过的 `vendor/suno-original.user.js` 字节一致。
- 原始资源、URL/hash manifest、解析结果：`captures/reference-static/20261005/`；源码仅留本地，不打进证据 ZIP。
- `analysis.json` 包含 14 个词法绑定正确的 `ex` 调用、40 个 `i9` 调用、参数表达式、函数定义 offset 和调用关系。重名局部 UI 函数 `ex` 已排除。
- `asset-analysis.json` 对8份JS全部进行AST解析并核对manifest哈希，记录桥接事件和WASM字符串引用；8份均未出现以`/api/studio/`开头的字符串字面量。主bundle另有DevTools实际加载源码的SHA-256核对，其他资源仅确认观察URL及公共副本哈希，不把它们都说成浏览器缓存字节比对。
- offsets 同时给出 UTF-16 字符和 UTF-8 byte 位置；以下表格使用字符位置。压缩函数名不是稳定公共 API。
- 页面资源清单未观察到 WASM。主 bundle 的 `/audio-codecs/mp3.wasm?v=0.7.0` 是 `WasmMediaEncoder.createEncoder("audio/mpeg", ...)` 的静态引用，用于本地 MP3 编码；没有取得二进制，未做 WASM 内容分析。不能因此认定没有其他尚未加载资源。

## 事件锚点与 transport

主 bundle 的 `ex` 定义 offset **47714**；request 事件字面量 offset **49950**。其调用签名从代码展开为：

```js
ex(path, method = "GET", body = undefined, options = undefined)
// options: signal, beforeRequest, onRequest, timeoutMs
// timeoutMs 默认 35000
// requestId = ep(); 以 requestId 匹配 response，超时/abort 发 cancel
detail = { requestId, path, method, body, bodyJson: body === undefined ? undefined : JSON.stringify(body) }
```

`ex` 处理 `ok/result/error/status`，401 发 `suno-auth-expired`。**成功分支给 UI 回调写入的 `status:200` 是客户端常量，不能当真实 HTTP status**。原 bridge 成功 response detail 只有 `requestId/ok/result`，失败时才附 status。新 recorder 对缺失 status 保持 null。

公开 bridge 的 `handleUploadRequest` 优先解析 `bodyJson`，调用 `callSunoApi(path, method, body)`，在 Tampermonkey 获取认证并请求固定 Suno host；cancel 调用待处理 transport 的 abort。它与网站自己的 `fetch('/api/...')` 是两条链。

## 实际出现在代码中的 Suno 调用模板

下面均为 **STATIC_CLIENT**，本轮未运行、未重播，不提升为 OBSERVED/VERIFIED。`{...}` 中的变量只表示源码表达式，不表示经过确认的字段类型或可用权限。

| Caller / 调用 offset | Path 表达式 | Method | Body 表达式或来源 |
|---|---|---|---|
| eg / 50417 | `/api/uploads/audio/` | POST | `{extension:s,is_stem_mix:false,upload_type:"file_upload"}`；s 来自文件名扩展名，默认 wav |
| ef / 50639 | `/api/uploads/audio/` + encodeURIComponent(e) + `/upload-finish/` | POST | `{upload_type:"file_upload",upload_filename:t}` |
| ev / 50898 | `/api/uploads/audio/` + encodeURIComponent(e) + `/` | GET | 省略 |
| ev / 51209 | 同 upload id + `/initialize-clip/` | POST | `{}` |
| ev / 51456 | `/api/gen/` + encodeURIComponent(a) + `/set_metadata/` | POST | `{title:t,image_url:l||undefined,is_audio_upload_tos_accepted:true,skip_notification:true,show_success_toast:false}` |
| eb / 51793 | `/api/project/` + encodeURIComponent(e) + `/clips` | POST | `{update_type:"add",metadata:{clip_ids:s}}`，s 是去重且非空 ID 数组 |
| ey / 52118 | `/api/billing/info/` | GET | 省略；账户相关，排除重播 |
| ey / 52224 | `/api/persona/get-personas/?page=` + e | GET | 省略 |
| eS / 52952 | `/api/project/me?page=` + t + `&sort=max_created_at_last_updated_clip` | GET | 省略 |
| nO / 175808 | 工作区 feed URL + URLSearchParams | GET | 省略；default 用 `/api/project/feed` 加 scope=default，其他用 `/api/project/{encoded id}/feed`；limit=30/entity_type=clip/cursor 可选 |
| iD / 338609 | 循环内变量 e | GET | 省略；代码数组为 `/api/clips/get_songs_by_ids?ids={encoded id}`、`/api/clip/{encoded id}/`、`/api/clip/{encoded id}`，仅 404/405 时尝试下项 |
| iJ / 343030 | `/api/feed/v3` | POST | `{cursor:e.cursor||null,limit:50,filters:n}`；n 构造 trashed/disliked/sort/searchText |
| iH / 344717 | `/api/feed/v3` | POST | `{cursor:t.cursor||null,limit:50,filters:i}`；i 可含 upload 筛选 |
| iK / 345513 | `/api/clip/` + encodeURIComponent(e) + `/` | GET | 省略；60 秒本地状态缓存 |

`eg → ex` 获得 upload id/url/fields；`ej(file, signedData, options)` 对返回地址做 FormData POST；`ef → ex` 通知完成；`ev → ex` 轮询（最多75次，间隔4秒），初始化作品 clip、写 metadata。签名 URL/fields 不能持久化为可重播 credential。本轮没有上传文件或运行这条流程。

`eb` 的 project/clips 属于客户端“workspace”分支；`initialize-clip` 返回的是上传作品资源。**两者均不能证明 Studio timeline track/clip schema**。`/api/clips/autoplay/` 仅出现在 ex 的 UI 分类条件中，没有实际构造调用，故未列为已提取调用模板。

## Studio 流程到网站后端的调用关系

```text
单次创建 UI: sK → ss(useCallback，定义 offset 363800) → i7 → i9 → fetch(网站 /api/merge)
批次参数: ip → request → submit/si → ss → i7 → i9
重新导出: s6 → i9 → fetch(网站 /api/export)
资源读取: n7 → i9 → fetch(网站 /api/projects)
状态刷新: n9 → fetch(网站 /api/state[?summary=1])
任务刷新: se → fetch(网站 /api/tasks/active)
```

`i9` 定义 offset **353054**，自动加 JSON content-type、解析响应并检查 HTTP ok；`i7` 定义 offset **353499**，POST `/api/merge`，body 为 `JSON.stringify(e)`，返回 `.task`。

| 参数构造位置 | 网站 body 模板 |
|---|---|
| ip / 对象 offset 312705 | `{projectId:e,title:a + " · Studio 合并",sliceIds:成功切片 id[],completeGroup:true,billingIdempotencyKey:s()}` |
| sK / 430367 | `{projectId:e.id,title:e.name + " · Studio 合并",sliceIds:i.map(x=>x.id),billingIdempotencyKey:ep(),repairLoudness:n}` |
| ss / 364228 调用 i7 | 在上述 e 上展开，追加 `{repairLoudness:a,gainRepair:c}`；c 来自可选音量分析 prepare，未当作 Suno clip 参数 |
| 工作流 / 440321 | 另外包含 workflowId、workflowItemId、workflowRunIndex、billingIdempotencyKey；本轮没有执行工作流 |
| s6 / 434337 | POST 网站 `/api/export`，`{projectId:e,billingIdempotencyKey:ep()}` |

这里的 projectId/sliceIds 是网站存储中的项目/切片引用。代码另有 `studioProjectId`、`mergedClipId` 等结果字段，不能混同。没有从收到的代码看到这些请求被转换成客户端 ex Studio 调用。**网站后端实际是否及如何生成或直接执行 Suno Studio 请求仍 UNKNOWN**，需要后端源码或合法运行时证据；本轮不调用付费端点来获取它。

## 未付费运行时证据

在页面显示可用积分 0、工作流未开放的状态，通过 CDP Network 和只读逻辑的被动 CustomEvent listeners 观察两个正常导航动作：打开“项目”、打开“创作”。未点击提交、导出、充值、购买、兑换或更改权限。

- marker begin/end、网络事件与响应结构保存在 `unpaid-runtime.json`。
- 两次正常导航均观察网站 `GET /api/projects` HTTP 200；第一次读取响应 projects=[]，auth 只保存 connected/expired/headerCount 的类型。第二次只保存状态和 header 名称，不宣称完整 body capture。
- 首次网络 headers 到达耗时约 **348.42 ms**；界面导航结束 marker 不等于网络响应结束。
- 请求/响应 headers 只保留名称、值全部脱敏，不保存账号标识或 Cookie。
- 本观察窗口 bridge request/response/cancel 事件为 **0**。这不证明其他视图/操作永远不触发事件。
- 浏览器临时 listeners、binding 已移除，Network 已 disable；没有改写支付认证或应用状态。

## 可复核命令与限制

```powershell
npm ci --ignore-scripts
node scripts/analyze-reference.mjs captures/reference-static/20261005/a9b07de586d36c50-page-b178945df36952c2.js captures/reference-static/20261005/analysis.json
node scripts/analyze-reference.mjs --inventory captures/reference-static/20261005/code-manifest.json captures/reference-static/20261005/asset-analysis.json
npm run build:reference-recorder
npm test
```

静态 AST 收集语法与词法绑定，不求值，不解析服务器逻辑，不证明请求成功。React useCallback 的直接包装已处理；动态属性调用、运行时拼接、网络生成参数及 Worker 执行仍需独立证据。资源版本可能随网站更新而改变。未下载 source maps、未取得 WASM；所有新增 Suno模板均未重播，StudioClient 未新增业务实现。
