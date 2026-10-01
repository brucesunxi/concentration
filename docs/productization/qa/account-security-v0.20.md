# 家庭账号管理验收

2026-10-01；应用/API 0.20.0、schema 18、原生壳仍为 0.2.0。所有新增账号检查使用独立临时库中的虚构家庭，不使用真实儿童资料或语音服务密钥。

## 已验证范围

| 检查 | 证据 |
|---|---|
| 业务和共享客户端 | 227 项通过；新增 11 项覆盖父母/孩子范围、家庭计数、密码与确认契约、全传输撤销、记录保留、旧身份延迟读写、并发进入/开始、共享限流、事务回滚、未知结果及卸载后的晚到响应 |
| HTTP | 10 项通过；新增密码更新、Cookie 清除、CSRF/来源、Web/原生/孩子失效、另一家庭保留、重启后新密码与档案保留、原生全退出不设置 Cookie |
| PostgreSQL | 12 项通过；真实 16.14/arm64，受限角色和 18 次迁移；新增旧密码登录/孩子身份轮换/密码更新并发和全退出后的延迟写入拒绝，补充缺失迁移读取授权、旧版/未来版 schema 的启动拒绝 |
| Web 与原生 | TypeScript、Web/工作台构建、原生类型检查、iOS 与 Android Hermes 输出通过；没有新增可安装原生包 |
| 中文浏览器 | 账号卡片、两类计数、空密码表单、自动焦点、禁用提交、取消；全退出的当前密码和确认；两个标签页均回到登录并显示成功，重新登录仍有两个档案 |
| 英文浏览器 | 桌面密码表单、说明、焦点和禁用状态；没有浏览器警告/错误日志 |

## 日志与交付文件

- [业务回归](account-security-v0.20/unit.log)、[接口回归](account-security-v0.20/http.log)、[数据库回归](account-security-v0.20/postgres.log) 和 [数据库证明](account-security-v0.20/postgres-proof.json)。
- [基础检查](account-security-v0.20/check.log)、[Web/工作台构建](account-security-v0.20/build.log)、[原生检查](account-security-v0.20/native-check.log)、[原生运行包](account-security-v0.20/native-bundle.log)。
- [中文卡片](account-security-v0.20/account-card-zh.png)、[中文完整页面](account-security-v0.20/account-zh.png)、[中文空表单](account-security-v0.20/password-form-zh.png)、[英文桌面空表单](account-security-v0.20/password-form-en-desktop.png)、[全退出结果](account-security-v0.20/signout-zh.png)、[第二页同步结果](account-security-v0.20/signout-second-tab.png)。
- [文件摘要和运行证据](account-security-v0.20/runtime.json)。

Web 入口静态图谱 1,478,690 字节，低于 1,500,000 字节预算；没有靠压缩才达到预算。这是构建字节统计，不是首屏加载时间。当前发布摘要 `833652702b0ed2dd59badde266f76e4a5a6b5592deddc5af0a5d417095778d23`。

原生输出：iOS `index-d4d0f7a945f37e39065bf792756c521d.hbc`；Android `index-e347ef33abc94b577ee47e6f63182cc8.hbc`。输出成功不代表在手机上运行通过。

首次完整 HTTP 执行受沙箱监听权限限制，日志还记录一次 Node 26.5 内部断言；保留于 [首次尝试](account-security-v0.20/http-sandbox-attempt.log)。获准以同一套测试启动回环服务后 10 项通过，没有改测试断言来放行。

## 未验证项

浏览器的新密码输入和最终提交按自动化工具规则需人工接手，本轮不执行，也不记为浏览器端到端通过。接口已覆盖更改、重启、旧密码拒绝和凭据撤销。后续测试人员应使用虚构账号手工验证新密码长度、重复输入、错误反馈和最终重新登录。

请求 390×844 的视口设置后，实际 DOM 和截图仍为 1280×720；已恢复设置并将截图命名为 desktop，手机宽度验收保持未完成。原生真机/模拟器交互、存储故障和后台生命周期、其他浏览器与无障碍设备也待检查。

并发正确性不等于生产容量。停止旧 API 后的实际业务升级、云备份恢复、OIDC/找回、监护同意、母语/适龄审核和产品效果研究均未完成。工程全目标继续执行，不能将本批验收写成商业发布完成。
