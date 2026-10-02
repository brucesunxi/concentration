# 受保护 Vercel + Neon 合成家庭验收

2026-10-01 · 应用 0.46.0 · 合成地区 `ZZ` · Vercel Authentication 保护的内部预览。

使用 `node scripts/audit-protected-preview.mjs` 对 `https://concentration-two.vercel.app` 连续执行两次。两次均返回：

```json
{"event":"PROTECTED_PREVIEW_AUDIT","databaseReady":true,"familyCreated":true,"childRead":true,"familyDeleted":true,"oldSessionRevoked":true}
```

测试分别生成随机虚构家庭、密码和孩子档案；脚本通过 Vercel CLI 访问真实部署，使用 Web Cookie 与 CSRF 完成开户、建档、读取、创建者注销，再用旧 Cookie 核对 HTTP 401。项目 API 同日核对 `ssoProtection.deploymentType=all`。测试前后均没有遗留 `.focus-data/neon/protected-preview-audit-pending.json`；测试家庭由应用的删除接口清理。脚本不会向终端输出凭据或儿童信息。

这证明当前受保护部署、运行时 Neon 连接、Web 身份传输和这条注销链路能协同工作。它**不证明**其他家庭在并发时的隔离、断网中断、备份清除、原生设备行为或生产准入；这些仍须在隔离 Neon 测试分支与目标设备完成，不能在现有预览库执行破坏性测试。

## 2026-10-02 扩展验收

提交 `afbcc81` 在 GitHub 的 Family quality 检查通过，Vercel Production 部署进入 READY 后，对受保护别名重新执行 `npm run audit:preview`。新增检查实际读取内容包、逐个比对签名图片及预录语音字节摘要，确认已召回素材返回 404；随后上传完整的**合成事件**、结束练习、以家长身份重新登录读取报告，最后删除虚构家庭并验证旧身份失效。脚本返回：

```json
{"event":"PROTECTED_PREVIEW_AUDIT","databaseReady":true,"familyCreated":true,"childRead":true,"billingPreviewRead":true,"signedMediaVerified":true,"recalledMediaRejected":true,"practiceFinalized":true,"parentReportRead":true,"familyDeleted":true,"oldSessionRevoked":true}
```

清理后没有遗留恢复文件。该验收发现并修复了 Vercel 路径改写注入的内部 `path` 查询参数导致家长报告 HTTP 400 的问题。合成事件只证明 API 与报告链路，不代表孩子真实完成练习，也不覆盖原生设备、家庭调研或正式市场准入。
