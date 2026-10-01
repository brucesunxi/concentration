# 家长资料管理与双平台开发包验收

日期：2026-09-30。平台 0.5.0，原生 0.2.0。测试仅使用合成输入与公开的虚构验收家庭。

## 当前证据

| 项目 | 状态 | 范围 |
|---|---|---|
| TypeScript | Web/服务端与原生通过 | 代码类型检查 |
| 自动测试 | 81 / 81 通过 | 包括真实 SQLite 上的所有者/阻止标记，以及同连接操作队列 |
| 真实 HTTP | 3 / 3 通过 | Web、原生练习、原生家长观察/导出/撤回/删除和重启 |
| Web 构建 | 通过 | JS 338.29 kB，gzip 105.83 kB |
| Hermes 打包 | 两平台通过 | iOS 约 2.7 MB，Android 约 2.8 MB；单独不是安装包 |
| Android 工具链 | 隔离安装并校验完成 | Temurin 21.0.12.1、SDK/Build Tools 36、NDK 27.1.12297006、CMake 3.22.1 |
| Android Debug | 权限收紧后的最终 arm64 APK 编译通过 | 原生 0.2.0；还未安装到设备，不是商店发行包 |
| iOS Debug | 新增分享模块的 0.2.0 编译通过 | arm64 / x86_64 模拟器 App，已安装到 iPhone 17 / iOS 26.5 |
| iOS Simulator 界面工具 | 曾读取主屏；恢复验收时 Mac 锁屏，工具无法操作 | 安装命令退出 0；未打开当前 App，不计界面通过 |
| 依赖审计 | 11 项 moderate，0 high / critical | Expo 工具链同一已知级联依赖，尚未修复清零 |

各测试证明的含义与恢复规则见 [资料管理设计](../PARENT-DATA.md)。SQLite 测试验证 SQL 的行为，没有运行移动 SQLCipher 插件；编译开关和类型检查也不能单独证明设备上的加密文件正确。

## 构建记录

JDK 与 Android 命令行工具来自官方源，下载后与官方发行信息的 SHA-256 比对成功。工具解压在 `/private/tmp/focus-native-build-z4OuQt/.native-tools/android-build`，未替换系统 Java。SDK 包安装成功，Gradle 9.3.1 首次 arm64 Debug 构建在 28 分 58 秒后完成。

首次构建后检查依赖清单，发现 Expo FileSystem 为旧 Android 声明外部存储读写权限；当前导出使用用户选择的目录，因此移除这些声明并重新构建。最后一次构建报告 `BUILD SUCCESSFUL in 1m 8s`。最终 APK 清单确认没有摄像头、麦克风、定位及外部存储读写权限，`allowBackup=false`。仍有网络、振动、音频设置、唤醒、生物识别与调试悬浮窗等声明，不能据此声称零额外权限；正式发行清单仍需审阅。

iOS 使用隔离 Ruby/CocoaPods 和 Xcode Clang，Metro 开发端口保持 4183。分享模块是原生依赖，必须更新安装包，不能只将新 JavaScript 连接到上一批 0.1.0 App。

最终 Xcode 日志报告 `BUILD SUCCEEDED`。安装到已启动的 iPhone 17 模拟器成功，随后验收工具报告 Mac 锁屏。已请求手动解锁，未用其他方式绕过；登录、练习、系统分享和加密文件未验证。

## 可交接产物

- iOS：`dist/mobile-native/v0.5/ios-simulator/FocusIslandDev.app`，模拟器专用 Debug 包。
- Android：`dist/mobile-native/v0.5/android/focus-island-dev-0.2.0-arm64.apk`，63,102,870 字节，仅 arm64-v8a。
- APK SHA-256：`16cf99370234b843c16cd70d2030a7a2ef00589ac683479399f53410b1b9d9ff`。
- 每个平台同目录有 manifest；汇总为 [机器可读构建证据](native-build-v0.5.json)。前一批 v0.4 产物与记录保留。

两者均依赖 4183 上的 Metro 和 4181 上的家庭 API。Android 包允许开发用明文连接且可调试，没有商店签名/发行资格。校验码证明所交接文件的字节身份，不能代替运行、安全或适龄验证。

## 设备检查清单

- 虚构家庭登录、SQLCipher 初始化；儿童与青少年档案选择。
- 四任务的理解检查、正式阶段、帮助、退出、后台恢复和音频。
- 生活观察保存及断线重试；家长报告同步更新。
- 重新输入家长密码、导出范围、系统分享/保存、取消和失败反馈。
- 停止采集/删除后新练习被拒；本机清理失败不能显示全部完成。
- 用户切后台、系统文件选择器、锁屏及再次进入时，家长数据不恢复给孩子。
- 大字号、VoiceOver/TalkBack、屏幕尺寸和真实设备计时。

未完成的条目不计为通过。完整产品发布门槛继续保留在 [总账本](../IMPLEMENTATION.md)。

参考：[Android 官方工具](https://developer.android.com/studio)、[Gradle Java 兼容表](https://docs.gradle.org/current/userguide/compatibility.html)。
