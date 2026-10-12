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

## 一次性原生 PostgreSQL 工程回归

`PostgreSQL runtime quality` 工作流在独立 Ubuntu CI runner 上安装 PostgreSQL 16 工具，通过 [`initdb`](https://www.postgresql.org/docs/16/app-initdb.html) 在本任务临时目录中新建集群，再由 [`pg_ctl`](https://www.postgresql.org/docs/16/app-pg-ctl.html) 启动、核对状态和停止。只绑定回环地址，使用随机空闲端口和固定的 `focus_qa` 虚构数据库；不接受现有数据库 URL。连接前核对目标主机/库名，并在任何迁移或角色写入前核对服务端实际数据目录与本轮新目录完全一致。`trust` 认证仅用于这个单任务临时 runner，不能照搬到共享或生产主机。

入口 `npm run test:postgres` 仅允许临时 Linux CI runner 执行；不会在 Mac 上安装服务、创建 Docker 文件或连接 Neon。测试结束先确认该临时服务停止，再清理其新目录；只上传不含连接串、签名私钥和家庭身份的 JSON 证据。覆盖当前 schema、受限角色、连接池作用域与排队、回滚、借用连接被终止、并发幂等写入和删除后的旧上传。执行结果应查看对应 workflow，新增代码或绿色的普通单元测试不能代替该任务实际通过。

该测试验证标准 PostgreSQL 单机上的应用行为，尚不覆盖 Neon 池化代理、跨区延迟、托管切换、备份恢复或生产容量。当前用户没有授权创建 Neon 测试分支；不得为补这些缺口自动新建项目、分支或数据库。

2026-10-07：家长档案导出的全部分页现在使用同一个 `REPEATABLE READ` 事务读取，身份检查和各栏目不能跨不同快照；见[一致读取验收](qa/child-export-snapshot-2026-10-07.md)。真实 Neon 的并发与大档案演练仍须在独立测试分支完成。
