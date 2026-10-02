# Neon 限权运行账号只读验收

2026-10-02 · 受保护 Vercel 预览所用 Neon 项目 · 应用 schema 32。本批仅使用本机已有的 `0600` 权限运行账号连接文件，不读取家庭行、不修改数据库，也不输出连接串。

执行 `npm run db:audit:runtime -- --url-file .focus-data/neon/runtime-url`。脚本仅接受 Neon 的 `focus_family_runtime` 账号，连接后确认客户端 TLS 套接字已加密、对端证书获验证，再开启 PostgreSQL `READ ONLY` 事务。事务内执行当前服务启动所用的迁移版本、角色权限、家庭表行级隔离、账本只读和跨角色访问检查，结束时回滚。实际输出：

```json
{"event":"NEON_RUNTIME_READONLY_AUDIT","schema":32,"role":"family-runtime","tlsPeerVerified":true,"readOnly":true,"isolationVerified":true}
```

当前驱动曾对连接串中的 `sslmode=require` 给出未来语义变化警告。现在 Neon 连接在传给 `pg` 前统一为 `sslmode=verify-full`，保留原有 `channel_binding` 等参数，并拒绝明确关闭证书校验的 Neon URL。先用相同限权账号验证过该模式能够建立连接、客户端 TLS 已加密且证书获验证，再运行上述完整只读检查通过。[node-postgres 的连接串说明](https://github.com/brianc/node-postgres/blob/master/packages/pg-connection-string/README.md)列明了两种 SSL 语义下的差异。

同日对受保护别名执行完整[虚构家庭预览验收](protected-preview-v0.46-qa.md)通过；无凭据访问 `/api/ready` 返回 HTTP 302，而不是数据库就绪内容。只读检查不能证明真实家庭之间的并发隔离、备份恢复、连接耗尽或正式市场准入；这些破坏性与故障演练必须在独立 Neon 测试分支进行。此批没有采用 Docker。

提交 `950cc93` 的 GitHub `Family quality` 检查通过后，受保护别名切换到 `READY` 部署 `dpl_3kfLfY37LhwQ46efzAzJWGzYZ7nK`。再次运行 `npm run audit:preview` 返回数据库就绪、签名素材、合成练习结算、家长报告、家庭删除和旧会话失效均为 `true`；退出码为 0，清理恢复文件不存在。Vercel 公开的部署摘要未提供可独立核对的提交 SHA，因此这里记录的是部署后该别名的实际行为，不把部署 ID 单独当成源码身份凭据。
