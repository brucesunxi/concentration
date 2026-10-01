# 受保护 Vercel + Neon 合成家庭验收

2026-10-01 · 应用 0.46.0 · 合成地区 `ZZ` · Vercel Authentication 保护的内部预览。

使用 `node scripts/audit-protected-preview.mjs` 对 `https://concentration-two.vercel.app` 连续执行两次。两次均返回：

```json
{"event":"PROTECTED_PREVIEW_AUDIT","databaseReady":true,"familyCreated":true,"childRead":true,"familyDeleted":true,"oldSessionRevoked":true}
```

测试分别生成随机虚构家庭、密码和孩子档案；脚本通过 Vercel CLI 访问真实部署，使用 Web Cookie 与 CSRF 完成开户、建档、读取、创建者注销，再用旧 Cookie 核对 HTTP 401。项目 API 同日核对 `ssoProtection.deploymentType=all`。测试前后均没有遗留 `.focus-data/neon/protected-preview-audit-pending.json`；测试家庭由应用的删除接口清理。脚本不会向终端输出凭据或儿童信息。

这证明当前受保护部署、运行时 Neon 连接、Web 身份传输和这条注销链路能协同工作。它**不证明**其他家庭在并发时的隔离、断网中断、备份清除、原生设备行为或生产准入；这些仍须在隔离 Neon 测试分支与目标设备完成，不能在现有预览库执行破坏性测试。
