# Vercel + Neon 受保护预览

当前部署是 `local-development` 内容与合成地区 `ZZ` 的内部预览。`APP_MODE=production` 仍会拒绝启动。儿童监护人核验、地区规则审核、正式内容审批与运营验证完成前，不得关闭 Vercel Authentication 或宣传为正式商用版本。

## 架构

- Vercel CDN 提供 `dist/web` 页面、内置图片和预录语音；`api/index.ts` 承接 `/api/*` 及非内置的动态素材。内置素材在构建时以内容哈希复制到静态目录。
- Neon 托管 PostgreSQL，schema 版本 30。准备过程使用数据库所有者身份；Vercel 只使用 `focus_family_runtime` 限权身份。
- 会话签名私钥仅放在 Vercel Preview 与 Production 的 Sensitive 环境变量 `FOCUS_SESSION_SIGNING_JWK`；本地准备副本保存在被忽略的 `.focus-data/neon/`，不可提交。
- Preview 与受保护的 Production 域名共用内部预览数据库。`DATABASE_URL` 是带连接池的应用运行账号 URL。所有者 URL 不进入 Vercel。公开商用前须拆分环境。
- Vercel 项目 `concentration` 的 `ssoProtection.deploymentType` 必须保持 `all`。
- 项目与 `brucesunxi/concentration` 的 `main` 分支相连。当前访问域名是 `https://concentration-two.vercel.app/`，属于受保护的内部预览，不代表产品获准公开。

## 复建步骤

1. 创建专用 Neon 数据库和独立运行账号。先确认数据库只属于本应用且无其他表。
2. 在本机私密环境中设置 `DATABASE_MIGRATION_URL`、`FOCUS_DATABASE_ROLE`、`FOCUS_DATA_DIR`，执行 `npm run db:prepare`。此命令仅供数据库所有者运行，迁移、安装内置内容、准备签名身份并授权运行账号。
3. 将限权账号的池化 URL 作为 Vercel Preview 与 Production 的 Sensitive 变量 `DATABASE_URL`，把 `FOCUS_DATA_DIR/session-signing.jwk.json` 的完整 JSON 作为 `FOCUS_SESSION_SIGNING_JWK`。
4. 确认 Vercel Authentication 保护所有部署后，执行 `vercel deploy --prod --archive=tgz`，或显式使用 `--target preview` 建立预览部署。运行 `npm run check`、`npm test`、`npm run test:http` 与 `npm run build:vercel`。
5. 使用登录后的预览页检查家长注册、儿童空间、一次完整练习、静态图像和引导语音，确认不同家庭的数据隔离。

部署与运行都不需要 Docker。Neon 所有者账号只参与受控迁移，不能作为应用运行账号。Vercel Preview 同时保留静态资源缓存，但 API、会话和家庭记录不得缓存。每次迁移先在隔离的 Neon 分支验证，再对目标库执行。

## 正式开放前

完成儿童监护人核验、面向目标地区的儿童隐私及内容审核、正式发布范围签署、OIDC 身份方案、数据保留与删除验证、压力和故障演练、可观测性及真实家庭试点。之后另行进行生产环境密钥、数据与域名配置；不要直接把当前 Preview 数据库提升为商用生产库。
