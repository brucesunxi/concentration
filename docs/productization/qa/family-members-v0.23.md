# 家长协作与独立成员验收

2026-10-01 · 应用/API 0.23.0 · schema 24 · 原生壳 0.2.0。测试仅使用隔离临时库和虚构家庭，没有真实儿童资料、外部邀请发送或语音调用。完整商业产品目标仍未完成。

## 已取得的证据

| 验收层 | 结果与范围 |
|---|---|
| 业务与共享客户端 | 259/259；新增 12 项成员检查：一次性秘密、过期/取消、待确认、孩子范围、角色限制、凭据继承与撤销、独立密码/冷却、并发接受、容量与严格输入、19→24 迁移、结果不明和页面销毁 |
| 真实 HTTP | 12/12；新增 Web/原生加入、来源与 CSRF、确认前无孩子数据、版本确认、重启保留、越权拒绝、派生孩子凭据撤销及邀请码重放 |
| PostgreSQL | 14/14；PostgreSQL 16.14/arm64、13 张已填充家庭表；新增待确认无可见孩子、成员写入不能扩权、协作家长无生活目标/动作、独立密码和撤销；测试容器已清理 |
| 构建 | 类型检查、Web/工作台构建、原生类型检查、iOS/Android Hermes 输出通过 |
| 中文浏览器 | 邀请空表单、待确认账号登录及刷新后无孩子资料、创建者全成员及孩子范围、确认表单未勾选时不可提交 |
| 英文浏览器 | 协作家长仅见所选孩子、隐藏生活目标/添加孩子/数据管理、练习安排只读、成员列表仅自己、账号说明明确只管理自己的登录 |
| 同家庭身份切换 | 最终构建在家长验证弹窗中从创建者切到已确认协作账号，只显示所选孩子、自己的账号数量与权限；再切回创建者恢复完整列表 |
| 撤销与恢复画面 | 隔离 API 撤销虚构协作成员后，浏览器点击 Reload 收到身份失效并清除家庭画面；创建者重新登录仍见两位孩子和“已撤销”成员 |

数据库检查在开发中发现过令牌权限表达式组合不当；修复并加入独立升级迁移后，真实 PostgreSQL 回归通过。另将生活目标访问限制补到数据库层。以上最终结果使用这些修复后的 schema 24。

## 构建与文件

- [业务检查](family-members-v0.23/unit.log)、[HTTP](family-members-v0.23/http.log)、[PostgreSQL](family-members-v0.23/postgres.log)、[数据库证明](family-members-v0.23/postgres-proof.json)。
- [基础检查](family-members-v0.23/check.log)、[构建](family-members-v0.23/build.log)、[原生检查](family-members-v0.23/native-check.log)、[原生导出](family-members-v0.23/native-bundle.log)。
- [邀请表单](family-members-v0.23/join-zh.png)、[待确认](family-members-v0.23/pending-zh.png)、[创建者](family-members-v0.23/owner-zh.png)、[确认前](family-members-v0.23/approval-zh.png)。
- [协作家长](family-members-v0.23/support-en.png)、[只读安排](family-members-v0.23/support-plan-en.png)、[撤销后清屏](family-members-v0.23/revoked-en.png)、[英文创建者](family-members-v0.23/owner-en.png)、[同家庭身份切换](family-members-v0.23/switch-member-zh.png)、[最终中文页面](family-members-v0.23/final-members-zh.png)。
- [来源摘要与运行信息](family-members-v0.23/runtime.json)。

最终网页发布 `437bb49fb7f21bebe12ec8a5c850c5d0069267d4e72dfe74ba0d1bf18c3b2d62`，浏览器实际入口 `/assets/index-BOvNKr0A.js`。静态入口资源 1,488,378 字节，低于 1,500,000 字节预算，不依赖压缩通过；不把字节数解释为实测首屏耗时。

原生输出：iOS `index-d0919223f26fe83d689c8e354407959a.hbc`、Android `index-8648448e6eaaf4cb3b18a578b84533e1.hbc`。没有新增或安装设备安装包。

## 验收边界

浏览器证据来自内置浏览器、正常桌面视口。主要成员流程在发布 `544827352f8656e6f5f5f5f4f96d79078b7315cd2399ff44f76b485c1a5c19a0`（入口 index-pqbLP_3b.js）完成。随后补充同家庭成员切换时重建页面和重读报告；最终构建另行验证双向身份切换并保存最终中文截图。最终变化仅在 Web 页面身份边界，业务/HTTP/PostgreSQL 结果来自相同服务端、契约与数据库代码；最终 Web 类型检查及构建通过。邀请/加入/批准的服务端写入用自动测试验证；浏览器检查空加入表单和确认前状态，没有代替用户输入新的密码，也没有通过浏览器授予真实人员权限。

邀请码明文显示、真实用户输入新密码并提交、30 秒轮询自然触发、手机窄屏、其他浏览器、辅助技术与原生真机仍未由本批实测覆盖。撤销的浏览器证据是主动重新读取后的清屏，不是离线实时撤销。既有共享设备孩子模式不证明实际操作者身份，尚不具备独立青少年身份隔离。

当前为本机家庭成员实现；正式 OIDC/恢复、可验证监护同意、地区开放矩阵、完整专业内容/语音、生产运维和研究仍有后续工作。功能设计见 [家长协作](../FAMILY-MEMBERS.md)，团队分工见 [下一阶段交接](../NEXT-DELIVERY.md)。
