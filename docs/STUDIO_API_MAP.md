# Studio API Map

所有 Studio 接口均视为 Unofficial / Internal / Unstable。本表是证据状态表，不是 endpoint 猜测列表。

| 操作 | Observed endpoint | 状态 | 证据 |
|---|---|---|---|
| 新建空工程 | UNKNOWN | UNKNOWN | 等待首轮单操作 capture |
| 打开/读取工程 | UNKNOWN | UNKNOWN | 未捕获 |
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
