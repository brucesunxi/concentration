# 当前 iOS 包：练习到生活活动的设备验收

2026-10-03。在 iPhone 17 / iOS 26.5 模拟器上，通过原生界面操作当前完整源码包；本机 API 处于 `local-development`，仅使用临时虚构家庭和 6–8 岁英文档案。安装包 `dev.focusisland.family` 的 Hermes `main.jsbundle` SHA-256 为 `095ec9b7793723c033e471ed1ce33ece2e340d8b67a05f8ce5dd314336b35b62`，原生可执行文件 SHA-256 为 `02e7177ab30d6622ac57a6221f33ec9a53100c7f2823d4097710fc9cc8356fd8`；两者均与本地 `dist/mobile-native/v0.46/practice-life-ee369f6/ios-simulator/FocusIslandDev.app` 一致。功能源码为 `ee369f6`；之后到本次的提交只增补验收材料。

## 实际走通的路径

1. 用本地 API 创建随机虚构家庭和孩子档案；App 英文登录页输入虚构家长凭据后进入该家庭。此批没有通过 iOS 界面验收注册或建档表单。
2. 在孩子练习邀请页先点 `Not now`，返回家庭空间；服务端 `/sessions/active` 为 `null`，未创建活跃会话。再次由孩子点 `I want to start` 后进入 `Forest search` 规则页。
3. 规则页显示预录语音 `Listen`；点击后按钮切换为 `Stop audio`，播放结束后回到 `Listen`。这证明播放器在该模拟器上启动和结束；没有录音、声压、系统音频打断或母语主观听审证据。
4. 完成两道规则示范和一道正式找兔子题。安全休息询问在正式题前出现，选择继续后仍回到原示范反馈；正式题完成后主动点 `Stop for today`。总结显示 `1 independent step and 0 assisted steps.` 及 `Your records are confirmed by the family service.`。
5. 点击自愿的生活活动入口后，`Find two little things` 为已选中的单选项，页面明确提示确认前并非已保存目标。服务端只读返回 `goals=0`、`total=0`、`templates=4`；离开页面时没有点击保存。
6. 从模拟器的设备菜单重启整台 iPhone 17，再从主屏搜索打开 `Focus Island Dev`。App 恢复到 `SyntheticWren` 孩子空间，没有安全存储错误页。重新验证家长身份后，家长报告显示本周 `1 confirmed practice record`、`1 valid independent step; 1 correct`，该条 `Forest search` 记录标为 `Stopped early`。
7. 在 App 内退出家长账号，随后用新鲜的虚构家长登录令牌删除测试家庭；旧令牌访问 `/me` 返回 401。本地临时凭据文件已移除，登录页残留的虚构家庭名已清空。孩子本机令牌在家长重新登录时按客户端身份切换流程清除。

文件初查：该模拟器 App 的 `Documents/SQLite/focus-family.db` 为 4096 字节，前 16 字节不是 `SQLite format 3\0`。这只说明文件未呈现明文 SQLite 标识，不能单独证明密钥管理和整库加密的全部性质。

## 尚未通过

- 此包此前运行 `npm run mobile:verify:ios-keychain` 仍返回 `MISSING_SIGNING_TEAM`、`MISSING_APPLICATION_IDENTIFIER`、`MISSING_KEYCHAIN_ACCESS_GROUP`。这台 iPhone 17 的写入、整机重启与读回通过，**不推翻静态签名失败**，也不覆盖曾报 `-34018` 的 iPhone 17e、真实设备、正式开发/发行签名或升级迁移。应使用有效团队签名与配置文件重新构建，并按设备矩阵复验。
- 未在本批重做断网强退重开、音频被系统打断、低存储、辅助技术、不同年龄/语言或真机时序。生活迁移效果、适龄与母语审阅、真实监护核验仍需对应专业与市场验收；正式家庭发布门槛保持关闭。
