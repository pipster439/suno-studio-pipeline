# Suno 参考客户端分析交付报告

日期：2026-10-05（Asia/Shanghai）。任务基线：`de47f20716dc9b5cb07ecf38ac6c3b1415b34494`；任务开始时工作区干净。本报告与 patch 只涵盖本次参考 recorder、静态分析、未付费观察与文档变更。

## 结论

完成当前授权范围的静态分析和未付费运行时观察。主 bundle 610509 bytes，浏览器实际加载源码经 DevTools 取回计算 SHA-256，完全匹配无 cookie 下载的分析副本：`61d098da8777cd02fb6a8cb92b8487b1b9e87f0d8d7c990b2b1d7b00b6e74ff8`。

以 suno-console-upload-request 为锚点，解析并区分 14 个实际调用通用 Suno transport 的源码位置、40 个网站 JSON fetch helper 的调用位置；输出函数名/定义 offset、path/method/body 原表达式、参数构造位置和调用关系。Studio 合并与重新导出调用的是参考网站 `/api/merge`、`/api/export`；当前资源没有揭示底层 Suno Studio timeline 请求。没有猜 endpoint、没有绕过付费、没有调用新模板、没有新增 VERIFIED StudioClient 业务实现。

未付费页面的两次正常导航观察到网站 GET /api/projects 返回200；首个响应 projects=[]，header 值全部脱敏，账户数据只保留类型结构。窗口内 request/response/cancel bridge 事件为0；临时 listeners/binding已撤除，Network/Debugger已disable。没有付款、兑换、账户套餐/权限修改、音频上传或付费任务提交。

## 主要变更

- 独立 observer userscript：监听 console request/response/cancel、fetch/XHR 网站后端数据；只将脱敏记录投递127.0.0.1，不接管网站 transport，不同步认证。
- marker、pageId/requestId/sequence correlation；保留重复/孤立/晚到响应，真实缺失 status 为null，不采信客户端UI硬编码200。
- reference capture store 与localhost ingress：事件文件、timeline、summary，重试去重、限额、停止后120秒宽限；来源限定，只对参考origin开放记录/status，不开放控制器调用。
- 单个已观察 console请求的计划/显式单次 replay：拒绝取消、失败/歧义、脱敏或省略的输入及账户/订阅/权限操作；新requestId、独立回执、不自动重试或提升VERIFIED。本轮仅使用通用fixture测试，不执行真实replay。
- Acorn静态分析器：词法绑定消除重名UI ex假命中，支持直接React useCallback包装；记录UTF-16与UTF-8offset；不执行第三方代码。
- STUDIO_API_MAP补充证据类别，README补充观察/回滚/重播边界；详述见REFERENCE_CLIENT_ANALYSIS.md。

## 验证结果

- `npm test`：**22/22通过**，0失败。原有16项继续通过；新增6项覆盖被动事件/乱序/重复/孤立/取消/missing status、fetch promise/原body/XHR返回/异常保留、producer→磁盘脱敏、重播拒绝条件/单次执行/失败不重试、静态绑定与不执行代码。真实本地HTTP/WS测试另外覆盖reference origin限制与后台账户body强制省略。
- `npm run build:reference-recorder`成功；`node --check userscripts/reference-recorder.user.js`成功。
- `npm run test:live`默认关闭：1项SKIP。本轮没有真实Suno账号写入。
- 对主bundle解析：14 bridge calls、40 site-helper calls、0以`/api/studio/`开头的字符串字面量；这只是本资源的静态统计，不覆盖未加载代码/服务端。
- DevTools主bundle字节数及SHA-256与分析文件一致；公开bridge与vendor原文件SHA-256一致。
- localhost controller已正常重启，保留原临时本地配对；HTTP状态接口200，Browser bridge在线，独立recorder下载200。**当前Suno auth为unknown/ready=false；独立参考recorder尚未在真实Tampermonkey安装，状态offline。** 本轮CDP观察独立于该安装，不能声称reference脚本真实浏览器落盘链路已验证。
- 现有本地transport v1.3.15文件未修改，SHA-256仍为`286f722e5ac36926655360d7397336ef223133100db6421343bdedb92e5b7547`。
- git diff whitespace检查通过；patch独立验证结果与ZIP内容检查见交付包logs/verification.json。

## 发现的问题与风险

1. 原公开bridge成功事件不返回HTTP status，而前端ex成功回调常量写200；这是UI行为，不能作为响应状态证据，recorder保持null。
2. 测试发现bodyJson内嵌JSON的未知header值会逃过普通key脱敏；已在reference privacy递归处理嵌套JSON，双端契约测试证明合成敏感标记未落盘。共享给本地v1.3.15的privacy未更改。
3. 测试初次等待逻辑只让出setImmediate，无法稳定等待实际timer驱动投递；改为有截止时间的条件等待后通过，没有跳过断言。
4. 参考网站自己的backend行为不可见。原公开bridge还包含向网站/api/auth同步认证的已有逻辑；独立recorder不运行/替代该逻辑，不能宣称网站原设计从不保存Sunoauth。本次agent没有发认证同步或读取/保存实际credential。
5. body1MiB、读取10秒、queue200/retry10、结构/深度限额会导致明确省略/丢失；出现这些信号不能称完整capture。只覆盖window fetch/XHR/CustomEvent，Worker、iframe、WebSocket、sendBeacon及第三方媒体上传未覆盖。
6. query业务白名单仍只七个既有字段；其他query值脱敏可能妨碍replay，但不能为了重播持久化secret。静态表达式和实际有权限的合法重测可用于后续确认。
7. AST不求值，不解析所有动态调用/别名/后端参数；minified名字随版本变。源码offset/hash要与每次获取版本一起核对。

## 未解决事项

- 未取得WASM二进制；只看到本地MP3编码静态引用，未推测或下载未观察资源。
- 新Studio内部track/clip/position/trim/save/commit/render请求仍UNKNOWN；音频上传/作品库模板仅静态提取、未实际重播。
- 参考backend如何把网站项目/切片ID转换为Suno Studio状态仍UNKNOWN。不得把网站projectId与Suno project id直接混同。
- 本地auth当前unknown；以后真实Suno replay需恢复ready，并先取得一条有成功匹配响应的实际console请求。无需为本轮静态分析购买套餐。
- 独立recorder尚未经过真实安装验证；本轮runtime来自CDP。后续如要持续capture，需用户安装observer并刷新，按单动作marker观察。
- 无新endpoint满足VERIFIED条件，因此保留现有StudioClient限制。本轮没有实现MVP新增素材/timeline/保存/导出。

## 证据与产物

- 仓库报告：`G:\Suno\docs\REFERENCE_ANALYSIS_REPORT.md`。
- 函数/模板分析说明：`G:\Suno\docs\REFERENCE_CLIENT_ANALYSIS.md`；状态映射：`G:\Suno\docs\STUDIO_API_MAP.md`。
- 本地公共资源/小型证据：`G:\Suno\captures\reference-static\20261005\`，包括browser-asset-inventory、code-manifest、analysis、browser-code-verification、unpaid-runtime、controller-state、tests.log。原始公共JS不入交付ZIP。
- 新独立脚本：`G:\Suno\userscripts\reference-recorder.user.js`；可由构建脚本重建，安装入口localhost页面。
- 交付patch：`G:\Suno\deliverables\SUNO_REFERENCE_STATIC_ANALYSIS.patch`，只含基线之后本次改动。
- 单一证据包：`G:\Suno\deliverables\SUNO_REFERENCE_STATIC_ANALYSIS_EVIDENCE.zip`，来自独立`.evidence-staging/phase1-reference-static-20261005`，仅报告/logs/manifest/hash/小型证据，不含依赖、完整源码、旧包、真实账号信息或配对key。
- ZIP SHA-256外部文件：同目录`.zip.sha256`；ZIP不包含自身/其他ZIP/patch。最终文件清单、CRC、哈希和敏感标记检查见logs/verification.json与manifests。

回滚观察：停止capture，禁用独立reference recorder并刷新参考页；临时CDP监听器已自行移除。原Downloads脚本及现有Studio实现未改。Git按基础设施与分析文档分别本地commit，无push。
