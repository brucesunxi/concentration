# 家庭 API 的运行观测与排障

2026-10-03，平台 v0.46。已实现应用生成的结构化请求日志，覆盖本机家庭 API 与 Vercel 初始化入口。未引入外部分析 SDK、数据库表、儿童行为埋点或屏幕回放。这是运行观测的工程基础，完整告警、区域日志保留、值班与故障演练仍待交付。

## 1. 采集边界

Vercel 默认记录应用处理的 API 请求，包括成功、拒绝、服务器错误和响应完成前断开。本机默认只记录服务器错误/断开；调试可设置 `FOCUS_HTTP_LOGS=1` 记录完整 API 技术结果，`FOCUS_HTTP_LOGS=0` 停止本机制的记录。正常静态文件交付不记录；通过应用处理的静态失败会按类别记录。Vercel CDN 直接交付的文件不经过该采集器。

每个响应有服务端随机生成的 `X-Request-ID`，不接受客户端自报编号。错误 JSON 使用同一 `requestId`。Vercel 初始化之前即生成编号；启动失败也返回 503 和对应记录，不打印异常对象、名称、堆栈或连接字符串。同一响应只产生一个 `FAMILY_HTTP_REQUEST`，不会因初始化层、家庭处理层或 finish/close 两个通知而重复计数。日志输出失败不改变业务响应。

服务器错误使用 error 输出级别，其余技术结果使用普通日志级别。访问/输入拒绝不会被写成服务器错误；聚合时仍以 status/outcome 为准。

| 字段 | 含义 |
|---|---|
| `event / schemaVersion` | `FAMILY_HTTP_REQUEST / 1` |
| `timestamp / requestId` | 记录时服务器时间、该次请求随机编号 |
| `source / version` | 固定运行入口类别、已初始化应用的包版本；初始化失败版本可为 null |
| `method / route / transport` | 固定 HTTP 方法或 OTHER、白名单路由模板、Web/native 请求类别 |
| `status / outcome` | 响应状态；未发头即断开为 null。结果为 ok/rejected/error/aborted |
| `durationMs` | 从采集器进入到响应完成/断开的单调时钟毫秒，包含应用等待；不是用户端体验时间 |
| `runtimeWaitMs` | Vercel 等待应用初始化完成的时间；成功等待后记录。本机或初始化失败为 null；不代表平台完整冷启动 |
| `code` | 白名单技术/业务错误码；未知码只写 REQUEST_REJECTED/REQUEST_FAILED，断开为 REQUEST_ABORTED，成功为 null |

日志对象不包含请求正文、昵称、家庭/孩子/成员/会话标识、原始 URL、查询、Cookie、Bearer、CSRF、IP、User-Agent、设备 UUID、答案、原始事件或付款凭据。动态路由仅显示 `:childId/:sessionId` 等占位符，未知路径归为 unknown-api/web/malformed，不透传原文本。异常字符串和任意错误码也不透传。

这只约束应用生成的 JSON 记录。平台自身的请求日志、代理、数据库、供应商及运维工具有独立的采集范围，仍须逐项配置区域、权限与留存；不能由这里推断所有第三方日志均不含路径或个人相关元数据。请求编号和时间也可能用于关联，应限于必要运维人员，并按审定期限留存。

## 2. 排障流程

网页和原生端在服务端错误或无法确认回复时，向家庭显示经过格式校验的应用请求参考编号。普通填写错误不显示编号；断网且未收到响应时也没有编号。无法确认回复不等于操作失败，家长应先刷新查看最新状态，再决定是否重试。参考编号用于必要的人工排障，不包含孩子资料，也不是平台自身的 request ID。正式客服渠道、区域日志权限和留存仍须单独落实。

1. 取得用户反馈的响应编号或发生时间、应用版本，不要求提供孩子昵称、答案或完整导出。用编号检索 `FAMILY_HTTP_REQUEST`。
2. 先确认 deployment 与当前提交一致，再按 route、status/outcome 和 version 分组。Vercel 的平台 request ID 与本应用 UUID 是不同编号，不能混用。
3. `/api/ready` 返回 503 / DATABASE_NOT_READY 时检查运行账号、schema、数据库连接与 TLS。它是实际数据库就绪检查；`/api/health` 成功不能替代它。
4. SERVICE_UNAVAILABLE 表示应用初始化未完成。runtimeWaitMs 为 null 时仍看 durationMs；检查部署配置与启动门槛，不通过开放正式市场来绕过错误。
5. 409 PRACTICE_PLAN_CHANGED、DAILY_LIMIT、PRACTICE_PAUSED 是业务保护；401/403 是访问拒绝，不能按服务器故障一起计算。检查是否符合用户操作，不重放儿童写请求以排障。
6. 对 error 比例、按接口 P95/P99 耗时及 aborted 比例建立时间窗口，附请求数量；零请求或少样本不声称达到 SLO。原技术设计的延迟/RPO/RTO 候选值仍须在参考区域实测与演练。
7. aborted 只证明响应尚未完整发出便关闭，不能据此判断是谁主动退出或孩子是否完成。家庭记录和同步状态仍以服务端结果/本机日志协议为准。

在项目目录可用 CLI 检索，例如 `vercel logs --since 30m --query '<应用请求编号>' --expand`。此处 query 用于查应用日志消息；`--request-id` 是平台自己的请求编号。CLI 的项目访问需要现有管理员登录，不在命令参数中传秘密。外部日志导出或监控接入须继续审阅地域与资料流。

## 3. 按部署汇总技术结果

在具有项目访问权的终端对**指定部署**运行，例如：

```sh
FOCUS_DEPLOYMENT='dpl_替换为要检查的部署编号'
set -o pipefail
vercel logs "$FOCUS_DEPLOYMENT" --since 30m --json --limit 1000 | node scripts/summarize-request-observations.mjs --minutes 30 --source-limit 1000
```

命令只向标准输出写匿名聚合 JSON；不保存原始日志。`traffic` 排除 `/api/health` 和 `/api/ready`，这两个探针列在 `probes`；`routes` 按固定路径类别、方法和 Web/原生分别列出。业务拒绝列为 `rejected`，不计入服务器错误率。`aborted` 单列，不能推断孩子是否完成。错误率和 P95 至少需要 20 个相应样本，P99 至少需要 100 个完成请求；耗时统计不包括断开的请求。

`integrity.completeInput=false` 表示没有有效来源记录、平台结果达到指定条数上限、记录格式不合法或同一请求编号出现互相矛盾的结果；此时只给数量，不计算错误率和耗时百分位。`pipefail` 使上游 CLI 失败也令整条命令失败。若达到条数上限，缩短窗口或使用经批准的日志服务取得完整数据。空窗口和样本不足也不代表健康达标。工具只读取已知版本的 `FAMILY_HTTP_REQUEST`，只允许服务端固定路径类别进入汇总；原始 URL、请求编号、正文、平台消息和错误文本不会出现在输出中。上线告警阈值须依据参考区域和真实流量另外批准；本命令不会发出通知。

## 4. 当前证据与后续

实现入口：`apps/api/request-observation.ts`、`apps/api/main.ts`、`api/index.ts`。专项验证了路径/查询/标识移除、编号与响应一致、双层复用、完成/断开去重、未知码回退、输出故障、配置关闭、静态静默，以及真实 Vercel 入口初始化失败后的重试。真实进程 HTTP 测试覆盖虚构家庭建档、Web 校验拒绝、原生身份拒绝和敏感值不出现在日志对象中。

完整测试与本次部署证据见[运行观测验收](qa/request-observation-v0.46-qa.md)和[匿名汇总验收](qa/request-summary-v0.46-qa.md)。后续仍须落实：值班与联系人、批准区域的日志服务/访问/留存、告警通知与去重、故障演练、请求日志与平台指标的核对、压力和长请求表现。未配置商业报警渠道，没有自动发消息给外部人员；正式开放门槛保持原状态。
