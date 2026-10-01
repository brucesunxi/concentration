# 练习与休息验收

2026-10-01；应用/API 0.21.0、schema 19、原生壳 0.2.0。使用隔离临时库和虚构家庭，没有真实儿童资料、外部语音请求或新增密钥。

## 已取得的证据

| 检查 | 本批结果 |
|---|---|
| 业务与共享客户端 | 237 项全部通过；新增 10 项涵盖四年龄、授权、上限、下一家庭日、原授权保留、重复开启/预留、暂停/恢复、并发、夏令时、撤回/删除及晚到/未知结果 |
| 真实 HTTP | 11 项全部通过；新增 Web/原生版本竞争、只读孩子、来源/CSRF、独立家庭、重启保存及停止采集检查 |
| 真实 PostgreSQL | 13 项全部通过；16.14/arm64，迁移 19、并发修改、行级隔离、数据库范围约束、跨日预算与会话快照；测试容器已清理 |
| 编译与构建 | Web/工作台构建、基础检查、原生类型检查及 iOS/Android Hermes 导出通过 |
| 中文桌面浏览器 | 家长选择 3 分钟、勾选后保存、今天仍 8 分钟、次日安排可见；旧页面冲突拒绝并重新读取 |
| 英文桌面浏览器 | 青少年选择次日暂停，转到生活目标及进入孩子空间；孩子只读，无设置表单或兄弟姐妹入口 |
| 最终构建复验 | API 重启后数据保留；确认新入口脚本，中文 3 分钟安排、英文暂停安排和孩子只读；英文 1 minute 单数正确；最终页无警告/错误日志 |

中文保存、双标签页冲突和英文暂停提交使用初构建 `5e71afed…`。随后修正英文单数文案，以及导出里重复生成时间影响只读一致性的问题；最终回归全通过，最终页面另行验证。没有把初构建截图写成最终提交过程证据。

## 文件与运行信息

- [业务回归](practice-limits-v0.21/unit.log)、[接口回归](practice-limits-v0.21/http.log)、[数据库回归](practice-limits-v0.21/postgres.log)、[数据库证明](practice-limits-v0.21/postgres-proof.json)。
- [基础检查](practice-limits-v0.21/check.log)、[Web 构建](practice-limits-v0.21/build.log)、[原生检查](practice-limits-v0.21/native-check.log)、[原生导出](practice-limits-v0.21/native-bundle.log)。
- 初构建：[中文保存](practice-limits-v0.21/parent-saved-zh.png)、[旧页面冲突](practice-limits-v0.21/conflict-zh.png)、[英文暂停](practice-limits-v0.21/parent-pause-en.png)、[孩子只读](practice-limits-v0.21/child-readonly-en.png)。
- 最终构建：[中文家长](practice-limits-v0.21/parent-final-zh.png)、[英文家长](practice-limits-v0.21/parent-final-en.png)、[英文孩子](practice-limits-v0.21/child-final-en.png)。
- [来源文件摘要与运行证明](practice-limits-v0.21/runtime.json)。

最终 Web 发布：`2a0c2a47511bc7a48847b312590cdefe14e4f399eb6b70c69a7d4e42eedde6eb`，实际浏览器入口 `/assets/index-CDyxUwVn.js`。静态入口 1,479,714 字节，低于 1,500,000 字节预算；无需压缩才通过。这是构建大小，不是实际首屏耗时。关闭下载完成后的旧标签页再打开，新入口已生效；刷新尚被旧离线运行文件控制的页面仍可能显示旧版。

最终原生输出：iOS `index-c7731a72b19511b53d8a39b13ffd45a3.hbc`、Android `index-99f20344a710e34b26031a12c0158490.hbc`。本批没有生成或安装新的设备安装包。

首轮完整 HTTP 为 10 通过、1 失败，原有家长课只读检查发现两次导出的 `practiceLimits.generatedAt` 不同。已在导出删除重复动态字段，保留顶层 `exportedAt`；原测试断言未改，最终 11 项全部通过。[修复前日志](practice-limits-v0.21/http-before-export-fix.log) 保留供回溯。

## 验收边界

浏览器实际宽度为 1280、高度为 720；本批不声明手机宽度通过。原生交互、实际加密存储、后台/断网生命周期、其他浏览器、屏幕阅读器和真实家庭可用性仍需设备检查。

跨日和夏令时由可控时钟业务测试验证，没有修改用户系统时间，也没有给 HTTP 增加测试时钟入口。上述数据库并发检查不代表生产容量。专业内容、完整声音、身份/同意、经营地区、支付、备份恢复、研究与商业发布要求仍未完成。全目标继续执行。
