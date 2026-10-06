# 家庭记录导出分块交付验收

2026-10-06。`GET /api/children/:id/export` 现在每次读取最多 200 条记录，仍在原有家庭创建者权限和家庭事务边界内。服务端先将完整 JSON 写入权限受限的临时文件，使用每次请求随机生成的 AES-256-GCM 密钥加密；确认文件完整可解密后才发送响应，随后删除临时文件并覆盖应用持有的密钥缓冲区。查询、隐私检查或写入失败时不发送部分文件。响应不设置 `Content-Length`，按连接背压发送；导出的总字节数上限为 100 MB，超限返回明确错误。`no-store` 与近期重新验证规则继续生效。Web 与原生端把导出等待时间设为 180 秒；浏览器合并本机恢复日志后的上限为 5000 万字符，原生端为 1000 万字符。

本地虚构资料验证：205 条观察跨越分页边界，导出内容与原有完整导出逐项一致，含生活目标动作；超过 4.5 MB 的 JSON 文件仍可完整解析，暂存文件不含可读的测试标记，发送完毕即移除。模拟查询失败或容量超限时，仅返回错误而不交付部分资料，临时文件也会清理。家庭 HTTP 用例核对 `Transfer-Encoding: chunked`、无 `Content-Length`、`no-store`，以及导出后撤回与删除路径。本次完整业务回归 **407/407**、HTTP 回归 **19/19**，`npm run check`、`npm run build:vercel`、`npm run mobile:check` 和 iOS/Android 运行代码导出通过。

部署验收脚本使用虚构家庭检查导出、会话与事件完整性、响应头和凭据字段。它只验证小型线上记录；**超过 4.5 MB 的 Vercel 实际端到端传输尚未单独压测**。大规模历史的数据库耗时、分页 `OFFSET` 性能、100 MB 之后的分批导出和浏览器内存限制仍待解决。临时文件若遇到进程意外终止，可能留下无持久化密钥的密文，仍须由运行环境的临时存储清理策略处理。导出只含家庭服务及当前设备仍留存的日志；其他设备须分别导出。此项不代替 Neon 独立分支的备份恢复与删除演练。

平台响应上限与流式建议：[Vercel Functions Limits](https://vercel.com/docs/functions/limitations)、[Vercel 大响应指导](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)。
