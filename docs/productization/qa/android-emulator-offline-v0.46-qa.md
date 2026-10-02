# Android ARM64 模拟器：首次启动与离线练习验收

2026-10-02。只使用本地家庭服务、虚构 `ZZ` 地区的家庭和未审定开发内容；本记录不代表真实家庭试用或商店发布批准。

## 设备与构建

- 本机 Android Emulator 37.2.12，Pixel 7 配置，Android 16 / API 36、AOSP ARM64 默认系统镜像，无 Google Play。用 `adb reverse tcp:4181 tcp:4181` 接入本地家庭服务；移除该转发后验证断网流程。
- 从当前完整源码建立隔离快照，SHA-256 `95a267409d9cd951da37f72592e5952e6be3294d0c7ef97f40c353e89bc3b4cf`。使用已有 Android SDK/JDK 和 Gradle 离线依赖构建 `:app:assembleRelease`；业务模式仍是 `local-development`。
- [本地测试 APK](../../../dist/mobile-native/v0.46/android-emulator-qa/FocusIslandDev-arm64.apk) SHA-256 `a6bd5523d981657656bf6a1091270c754078685b366705eadb2268d796e14356`；包名 `dev.focusisland.family`、版本 `0.2.8` / 版本码 `9`、仅 `arm64-v8a`，APK v2 签名校验通过，包含 Hermes 代码和 `libexpo-sqlite.so`。这不是商店签名包。[源码快照](../../../dist/mobile-native/v0.46/android-emulator-qa/source-snapshot.json)随本地安装包保存。

## 首次启动阻断与修复

最初的包能显示登录页，却提示“本机访问状态尚未清理完成”。全新模拟器的 App 数据目录实际不存在 SQLite 文件；阶段日志定位到 `check-existing-file`。原因是 Android 的 Expo SQLite 返回普通绝对路径，Expo FileSystem 的 `File` 使用文件 URI；此前直接传入路径，使首次安装误报为“数据库存在、密钥丢失”。现在只接受绝对路径或 `file:///` 目录，Android 路径转成 `file:///` 后才检查文件；不认识的路径继续拒绝初始化。诊断日志只输出阶段与异常类型，不包含密钥、SQL 或家庭资料。

修复包清空模拟器测试数据后首启，不再出现安全清理错误；连接本机服务时显示正常家长登录页。随后建立的 SQLCipher 数据库为 4096 字节，头 16 字节为 `04 4e c6 3e cc 40 14 18 38 e2 de 9c 4b 79 89 ed`，不是明文 SQLite 标识；运行时 `PRAGMA cipher_version` 也已通过。文件头和配置只是本次模拟器证据，仍需真实设备与发行签名复验。

## Android 实际家庭流程

1. 用虚构家庭建立一位 6–8 岁英文档案，从孩子可拒绝的邀请页进入“Forest search”。签名内容、两份公共素材、加密日志和本机恢复资料均准备成功；固定语音按钮从“Listen”切换为“Stop audio”。无声的后台模拟器无法证明声音听感或扬声器输出。
2. 移除本地服务端口转发、强退并重开 App。约 12 秒连接超时后，只显示原练习的离线恢复入口、原授权截止时间，以及无法即时收到家长撤回/换设备通知的说明；未展示家长资料或孩子昵称。点击恢复后再次核验素材与日志，回到原规则页。
3. 离线完成两道示范题和一道正式题，界面显示“Saved here · Pending sync”；孩子选择提前结束，摘要显示 1 个独立步骤、0 个协助步骤，并明确等待服务器确认。
4. 重新建立转发并点击“Retry sync”，界面显示“Synced”和服务器已确认。家长重新登录后，本周报告显示 10 月 2 日 1 条已确认练习、1 个有效独立步骤，其中 1 个正确，0 个协助步骤；[报告截图](android-emulator-offline-report-v0.46.png)。虚构家庭及孩子资料随后通过本地家庭删除接口清理。

## 丢失密钥保护

删除虚构家庭后，在专用模拟器中保留加密数据库文件、清除 App 安全存储，再把文件放回原位置。App 在 `check-existing-file` 阶段停止，不创建新密钥或覆盖旧文件；测试前后文件 SHA-256 均为 `10345a2d47cdfb6ba165c4efeb0fb40dd3db5abb1d59574bb86a67d30d2e5036`。最后清空模拟器的合成测试数据。

## 检查与剩余范围

`npm run check`、`npm run mobile:check`、335 项业务测试及 iOS/Android Hermes 导出通过。Android 这批已验证首装、登录、建档、预录语音控件、断网强退重开、离线事件、联网补传、家长报告和丢密钥停止。尚未验证真实 Android 设备、扬声器听感、后台/来电中断、低存储、旧 APK 覆盖安装的数据保留、读屏与不同设备时序；iOS 断网重开仍待独立设备验收。
