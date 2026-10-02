# Neon PostgreSQL 数据库交接

当前家庭服务使用 Neon PostgreSQL，schema 版本为 32。Vercel 运行时连接 `focus_family_runtime` 限权账号；数据库所有者只在受控迁移时使用。部署和运行不需要本地容器。新增家庭权益账本仅向运行账号授予按家庭隔离的读取权，渠道事件表不授予运行账号访问权。

## 账号边界

| 身份 | 用途 | 要求 |
| --- | --- | --- |
| 数据库所有者 | 执行 `npm run db:prepare` | 仅在专用数据库执行迁移和授权；连接串不放入 Vercel |
| 家庭运行账号 | Vercel 的 `DATABASE_URL` | 无表所有权、建表权限和跨工作台表权限；家庭表启用行级隔离 |
| 工作台运行账号 | 未来独立部署 | 不复用家庭运行账号；未配置时工作台不对外开放 |

服务启动会核对迁移版本、运行角色、家庭表策略和跨角色权限，不满足条件即拒绝启动。家长和孩子的请求作用域还会在每个数据库事务内设置，连接归还后不保留上次请求的家庭身份。

## 初始化专用 Neon 数据库

1. 确认目标数据库只用于本项目，且已创建独立的家庭运行角色。不要对共享数据库执行准备命令。
2. 在本机私密环境设置 `DATABASE_MIGRATION_URL`（数据库所有者连接）、`FOCUS_DATABASE_ROLE`（运行角色名）、`FOCUS_DATA_DIR`（只供准备进程使用的私密目录）。
3. 执行 `npm run db:prepare`。它迁移 schema、写入内置预览内容、建立签名身份，并向运行角色授予所需权限。成功时输出 schema 版本，不输出密码或连接串。
4. 在 Vercel Sensitive 环境变量中设置运行角色的池化连接串 `DATABASE_URL` 和完整的 `FOCUS_SESSION_SIGNING_JWK`。不要把所有者连接串或私钥写进仓库。
5. 部署后以受保护的地址核对 `/api/health` 与实际检查数据库连接和迁移版本的 `/api/ready`，再核对家长注册与登录、图片、语音、家庭隔离和资料删除。流程见 [Vercel + Neon 交接](VERCEL-NEON.md)。

`APP_MODE=production` 仍会拒绝启动；目前的 Vercel Production 域名承载的是受 Vercel Authentication 保护的内部预览，尚非面向真实家庭的正式版本。

## 验证与后续工作

本机运行 `npm run check`、`npm test`、`npm run test:http` 和 `npm run build:vercel`。对真实 PostgreSQL 的破坏性隔离与并发验证，应在**单独的 Neon 测试分支或专用测试库**执行，严禁指向现有家庭数据库。当前没有自动化的 Neon 分支测试启动器；上线前仍需补齐该项验证、备份恢复、慢查询和连接耗尽演练。

现有受保护预览可执行非破坏性的运行账号审计：`npm run db:audit:runtime -- --url-file .focus-data/neon/runtime-url`。连接文件必须只允许本人读取；脚本要求 Neon 限权账号、验证客户端 TLS 对端证书，并在 PostgreSQL `READ ONLY` 事务内复查 schema 32、行级隔离与跨角色权限。当前结果见[Neon 只读验收](qa/neon-runtime-readonly-v0.46-qa.md)。应用代码会把 Neon 连接串的 SSL 模式固定为 `verify-full`，防止驱动升级后 `sslmode=require` 的证书验证语义变弱；非 Neon 数据库连接保持其原有配置。这个审计不能替代独立测试分支的故障与恢复演练。

旧版本验收记录中提到的测试容器属于历史执行证据，不是当前的部署依赖。
