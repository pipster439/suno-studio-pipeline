# 官方已下发 Studio 客户端分析

日期：2026-10-05（Asia/Shanghai）。本轮基线：`f541a8645eb05201719fa6a4a1c20b4c4d4d30b4`，开始时工作区干净。参考网站已有分析仍有效，本轮增加官方已加载前端作为独立证据来源。

## 结论

官方 `/studio` 页面资源清单有 126 个 script 项，其中 117 个是实际出现的同源 immutable JS chunk。无 cookie 下载这 117 个公开 URL，全部 200，共 11647076 bytes；只解析，不执行下载代码、不枚举隐藏 chunk/source map。提取出 25 处 `/api/studio/` 方法调用、17 个不同路径模板。

关键发现：源码 `saveProject` 构造 POST `/api/studio/save-project`，body 为 `{project_id:t,state:a,title:n}`，并要求响应有 `version_id`。`useStudioProjectManagement` 先调用项目状态 serializer，再调用该 helper。轨道与 arrangement 构造发生在客户端对象中；这不是独立 track/clip REST endpoint 的证据。

以上新增结果全部属于 **STATIC_CLIENT，状态 UNKNOWN，Verified=no**；没有发送保存/render/metadata/clone/archive 等请求，没有新增 StudioClient 实现。既有 VERIFIED 创建默认工程/metadata 读取范围保持不变。

## 源码位置与调用关系

主要 chunk：`0kfolb-xhy_j4.js`，1518760 bytes，SHA-256 `ef24940f421ace114c67bc80a482d93130cba288c2da6a374c8a4d7e236e938d`。

- `fetchProjectById`：GET `/api/studio/project/{project_id}`；加载代码使用 `response.state || defaultState`，再检查 timing/tracks/selection。缺少 state 时的客户端默认值不能当成服务器返回的完整工程。
- `fetchRevisionById`：GET `/api/studio/project_revision/{revision_id}`；`fetchProjectVersion`：GET `/api/studio/{project_id}/version/{version_id}`。版本加载依赖真实 revision 的 project_id/is_owner；本轮没有实例化或调用这些路径。
- `saveProject` 路径字面量字符 offset 1333681；接收 apiClient、projectId、serializedState、title，返回版本 id。精确 call offset、UTF-8 byte offset、原 body/params 表达式见 analysis.json。
- `useStudioProjectManagement` 导出 offset 1302042；保存链：saveProjectVersion/saveProject → 内部保存回调 → serializeProjectState → API helper saveProject。
- 项目 serializer 导出 offset 145371：收集 tracks/clips 与 takeLanes/clips 的 warp markers，去重到 markersRegistry；clip warp 保存 markersHash，反序列化恢复 markers。这解释了 state 并非简单 clip 数组，但没有证明服务器约束。
- `createProject` 的 title/major_version 与此前真实请求一致；源码还包含 trigger/extract_mode/num_stems_sent/entry_source。新增参数仅静态模板，不放宽已验证 Client。
- API client 的公开 factory 在 `04w5zr4x348zb.js` 使用固定 baseUrl `https://studio-api-prod.suno.com`；分析未读取运行时认证。

## track / arrangement 字段证据

`3vyf86o0k-66r.js` 的 `createAudioTrack` 导出 offset 171822，绑定 h：生成 uuid；type=audio，name=Audio Track，clips/clipCreationIntents/takeLanes/signalChain 为数组，amplitude=1、balance=0，solo/mute/arm=false，routingMode=linear。构造函数本轮没有执行。

同 chunk `createStaticAudioArrangement` 导出 offset 179106、定义 offset 179139：输入 clipId、lengthBeats 及可选 id/color/name/streaming/readStartBeats，要求 lengthBeats>0。输出包含：type=audio，独立 arrangement id，startBeats=0、endBeats=lengthBeats、readStartBeats，fadeInBeats/fadeOutBeats，amplitude/transposition/formantCorrection，loop、warp，以及 `asset:{type:"clip",id:clipId}`。**arrangement id 与素材 clipId 是两个字段，不混同；beats 不能直接当 seconds。** loop/warp 的完整约束仍需追踪及合法实验。

`17qjv6hsx8zmw.js` 的 `createStaticUploadArrangement` 函数 offset 162603 则引用 `asset:{type:"upload",id:uploadId}`。`0kfolb-xhy_j4.js` 的素材构造函数 A（约 offset 1219200）解析 completed 素材、downbeats/lyrics 后构造 track、arrangement、timing 和 selection。这是构造关系，不是已验证的上传/插入操作。

## 真实只读运行时与哈希核对

- 官方页面仍显示 Untitled Project、Preview、Upgrade to edit、120 BPM、Main，未触发任何编辑。
- 只读 window.currentState：majorVersion=2、tracks=[]、timing={type:manual,bps:2,bpsAutomation:[]}，loop/selection 使用 beats 字段。保存的证据只取业务字段，未保存 libraryPanelState 或账户信息。这是浏览器状态，不是服务器持久化，也未据此断言关联的具体 project id。
- 两个关键 URL 已见于 pageAssets 与 Debugger.scriptParsed。浏览器侧重新读取公共资源（credentials=omit）计算 SHA-256，与本地副本一致：上述 0kfolb，以及 `3g9-3c-u44c0o.js` 的 `bf8b5b2cc55b072da1b4fce305c5c51dbc3c4c7920f35ec57de24692bcb3ad24`，2757055 bytes。
- 完整 Debugger.getScriptSource 读取导致连接断开，未完成加载源码全文的字节哈希比对；后续正常新建 HTTPS tab 恢复连接，用小响应完成公共副本核对。**不把重新 fetch 的哈希宣称为原 Debugger 源码字节比对。** 本轮没有更改页面 state、fetch/XHR、认证、权限或订阅；Runtime 已 disable。
- 另外观察到两个官方 WASM URL：emscripten-module.3iesnj72fbexk.wasm、dsp-engine.016w4733m_2uw.wasm。本轮未下载/执行/分析其二进制；不推断未观察资源。

## 实现与验证

新增 `scripts/analyze-studio.mjs`：校验同源 immutable URL/文件名与 SHA-256，Acorn 提取真实语法中的 GET/POST/PUT/PATCH/DELETE literal 路径，保留完整 params/body 表达式与 offset；按数字模块数组的词法范围关联 export，支持 mixed getter/constant 记录。动态路径/别名和其他 bundler 形式可能漏检，不做求值、不请求任何候选 endpoint。

新增 4 项测试覆盖：解析不执行第三方代码、原表达式/UTF-8 offset、文件哈希和来源/路径校验、嵌套 shadow 与跨模块 alias 隔离、getter/constant 混合顺序。完整测试 **26/26 PASS**；真实测试默认 **1 项 SKIP**。日志见证据包 logs。没有新真实 Suno 请求重播或账号写入。

复核：`node scripts/analyze-studio.mjs captures/official-static/20261005/manifest.json captures/official-static/20261005/analysis.json`；随后 `npm test`、`npm run test:live`。

## 风险与未解决事项

- Preview 权限仍限制实际编辑；不得用改 entitlement、调用 setter 或强行 POST 保存绕过。旧 v1.3.11 共用事件 listener 风险、独立 reference recorder GM 验证缺口仍未解决。
- 17 个路径是源码模板数量，不是 17 个成功 API。渲染 body 有不同 serializer、engine/export mode 和 state 组合，不能把两个 render helper 混成一个已验证模型。
- 素材→arrangement→track→state→save 的客户端构造已找到，完整服务端验证/授权范围、保存版本返回与重载持久化仍没有实际证据；MVP 未完成，业务方法保留 NotImplementedError。
- 公开 chunk 副本未全部与原浏览器执行字节比对，未扫描服务端、未加载资源或 WASM 内容；函数名字/offset 仅适用于 manifest 哈希版本。

## 产物

- 本地原始公共源码和解析结果：`captures/official-static/20261005/`（源码不入 ZIP）。
- API Map：`docs/STUDIO_API_MAP.md`；本报告：`docs/OFFICIAL_STUDIO_STATIC_REPORT.md`。
- 独立 patch：`deliverables/SUNO_OFFICIAL_STUDIO_STATIC.patch`，只含本轮代码、测试与文档。
- 证据包：`deliverables/SUNO_OFFICIAL_STUDIO_STATIC_EVIDENCE.zip`；独立 staging、仅报告/logs/manifest/hash/小型脱敏证据，不含旧交付包、完整源码、依赖或 credential；外部 `.zip.sha256`。
