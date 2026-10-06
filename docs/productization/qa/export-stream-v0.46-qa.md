# 家庭记录导出分块交付验收

2026-10-06。现有 `GET /api/children/:id/export` 先收齐家庭服务记录，再按顶层集合逐条写出 JSON。响应不设置 `Content-Length`，按连接背压发送；开始写出前复查全部字段名，发现凭据字段即拒绝，不发送部分文件。家长近期重新验证、家庭创建者权限、孩子范围及 `no-store` 规则继续由原接口执行。网页版将该操作的请求等待延长至 120 秒，并把浏览器合并本机恢复日志后的文件上限提高至 5000 万字符；原生端维持 1000 万字符上限，以免在设备内存中构造过大的分享文件。

本地虚构资料验证：超过 4.5 MB 的 JSON 文件以分块响应返回，可完整解析且与原始记录相同；包含凭据键时，服务端在任何导出字节发送前拒绝。家庭 HTTP 用例再次核对 `Transfer-Encoding: chunked`、无 `Content-Length`、`no-store`，以及导出后撤回与删除路径。完整业务回归 406/406、HTTP 回归 19/19、`npm run check`、`npm run build:vercel`、`npm run mobile:check` 和两平台原生代码导出通过。

部署验收脚本新增虚构家庭导出、会话与事件完整性、响应头和凭据字段检查。它只验证小型线上记录；**超过 4.5 MB 的 Vercel 实际端到端传输尚未单独压测**。服务层仍会在内存中收齐记录，超长历史的数据库耗时、内存及浏览器 5000 万字符后的分批导出尚未完成。导出只含家庭服务及当前设备仍留存的日志；其他设备须分别导出。此项不代替 Neon 独立分支的备份恢复与删除演练。

平台响应上限与流式建议：[Vercel Functions Limits](https://vercel.com/docs/functions/limitations)、[Vercel 大响应指导](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)。
