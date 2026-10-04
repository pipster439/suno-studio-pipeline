# 现有架构审计

审计日期：2026-10-05（Asia/Shanghai）。输入：`C:\Users\ROG\Downloads\suno.txt`，1076 行，版本 1.3.11。附件作为待审计代码，未将其中注释视为任务指令。

## 已有能力

- 官方 Suno 分支只包装 `fetch` 请求头，限定 `studio-api-prod.suno.com`；收集 authorization、device-id、browser-token 和四类 referring header。也合并 `__SUNO_BATCH_API_HEADERS__`。
- 从 `__session` cookie 选择有效非 visitor JWT，按 iat/exp 排序；兼容 Clerk.getToken。JWT decode 只判断身份字段和过期，不证明真实性。以已存在的只读 `GET /api/session/` 验证后写入 Tampermonkey `AUTH_KEY`。
- 15 秒检查续期，10 秒 heartbeat；页面重新可见和跨标签同步事件触发刷新。AUTH_KEY 中的认证是 Tampermonkey 持久存储，并非仅内存。
- 工作台监听 `suno-console-upload-request`，支持 requestId、path、method、body 或 bodyJson。响应事件 `suno-console-upload-response` 包含 `{ requestId, ok, result }`，失败含 error/status。
- pending Map 去重；`suno-console-upload-cancel` 可中断等待续期或 GM 请求。等待续期最多 15 秒，GM 请求 30 秒；方法大写并 JSON 编码 body。
- 通过 `GM_xmlhttpRequest` 请求固定 studio-api origin，复制认证头，每次新建 `browser-token = JSON.stringify({ token: btoa(JSON.stringify({ timestamp: Date.now() })) })`。这是已有实现，不证明所有未来接口都接受它。
- 401：仅在失败请求使用的授权仍等于当前缓存时删除缓存，标记 invalidated，触发 expired 和刷新；不自动重试写请求。
- Cover verification：扫描 React 内部对象找到 session/genForm，调用官方 `getCaptchaTokenIfRequired('generation')`，返回 token/provider/createSessionToken/tier；依赖私有运行时且不属于 Studio API。
- audio capture：跨标签 GM 请求、打开具体 song 页、触发播放；读取官方解密后的 reader/MSE 数据。完整下载限定 CDN/clip UUID，200+Content-Length、256 MiB 上限、180 秒超时，校验字节数、计算 SHA-256、浏览器解码输出 WAV；局部 capture 可返回 base64 分片。未在本轮运行媒体下载或验证物理播放。

## 发现的问题与边界

**现有脚本并不始终将认证保留在浏览器。** 工作台 `sync()` 会 POST `/api/auth`，body 是完整 `payload.headers`；启动/定时读取 `/api/session`，401 时 DELETE `/api/auth?expired=1`。当前工作台后端是否长期保存认证未审计。

原脚本还有外部工作台 match、自动更新检查；不能直接原样装到新后端，并用假的 `/api/auth` 模拟成功。原脚本不会验证 path 和方法白名单，成功响应不暴露 HTTP status，错误丢弃原始 response body。监听官方 fetch 的部分只有请求头，没有请求/响应记录；未覆盖 XHR。音频 reader/MSE 包装影响整个页面，需在真实 Studio 验收时观察兼容性。

## 可以复用的部分

Suno 登录获取/验证/续期、Tampermonkey 跨标签认证、通用 GM transport、CustomEvent 请求关联和取消、401 不重试的语义。`/api/session/` 只作为源脚本已有的认证探针；它不是已验证的 Studio 工程接口。

## 缺少能力与新增部分

1. 本地专用适配：保留源文件，生成范围受限的本地版本，禁用 auth 上传/工作台账号查询/自动更新，新增 path 校验和不含凭据的 auth status。
2. 单一 localhost Node controller + WebSocket bridge；关联、并发、超时、取消、断线失败和重连；使用仅本机的随机会话 capability，认证头从不进入 controller 请求协议。
3. 同脚本中的独立 recorder：官方页面 fetch/XHR，显式开始会话后记录，浏览器和后端两次脱敏，有限 body/队列，错误和丢失可见，session 标记与请求配对文件。
4. SunoBridge.call/raw-call、集中 API map；所有 Studio 操作 UNKNOWN，StudioClient 保持 NotImplementedError，等实测后逐个增加。
5. 单元/本地集成测试及默认关闭的真实 Suno 探针。真实浏览器/Tampermonkey/账号结果须与模拟传输测试分开。

## 目标数据流

`Local Controller ⇄ WebSocket ⇄ Browser Bridge ⇄ CustomEvent ⇄ Tampermonkey ⇄ Suno API`

`Official Suno fetch/XHR → browser redaction → localhost capture ingress → server redaction → captures/<session>/`

未知 Studio endpoint、字段、timeline 模型、export 行为一律不推测。
