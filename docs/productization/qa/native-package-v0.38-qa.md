# v0.38 Android 本地测试包验收

日期：2026-10-01。此包面向本地研发测试，不对真实家庭开放。

## 交付物与核验

- [Android arm64 APK](../../../dist/mobile-native/v0.38/android/focus-island-v0.38-arm64-local.apk)：39,707,086 字节，SHA-256 `57acec4851432fef7e3efde83ba79942319bad3e52dd16e362f1a4547f4ffe89`。
- [静态核验报告](../../../dist/mobile-native/v0.38/android/verification.json)和[源码快照](../../../dist/mobile-native/v0.38/android/source-snapshot.json)：111 个源码文件的大小与摘要和隔离构建目录一致；Gradle Release 编译成功。报告确认包名 `dev.focusisland.family`、arm64-v8a、内置 Hermes 代码、v2 签名和本批孩子邀请与拒绝文案。
- 后续已保存[完整源码归档](../../../dist/mobile-native/v0.38/android/source-archive.tar.gz)并独立逐文件复核；原临时构建目录已清理，历史 APK 的原始核验报告因此不能再直接指向该目录重跑。见[源码留存记录](source-provenance-v0.40-qa.md)。
- Android Debug 测试证书摘要与 v0.35 APK 相同；已禁用应用备份。安装包不请求录音、摄像头、定位或旧式外部存储读写权限，仍包含网络、振动、生物识别等依赖权限。

## 本地安装路径

连接 arm64 Android 设备，并保持本地家庭服务运行。通过 `adb reverse tcp:4181 tcp:4181` 把设备的服务请求转到开发机，再用 `adb install -r` 安装 APK；内嵌运行代码无需 Metro。`adb devices -l` 本批返回空列表，因此这些安装、登录、播放、SQLCipher 落盘、断网恢复与孩子实际选择流程**均未完成设备验收**。与 v0.35 相同的包名、版本码 1 和测试证书允许同签名覆盖安装，但正式升级应递增版本码；测试前应备份需保留的本地资料。

## 发布限制

此包的原生壳版本仍为 0.2.0，使用 Debug 测试证书并允许到本机服务的明文连接，只能用于本地测试。正式市场准入、真实监护核验与告知、适龄内容和声音的真人审阅、真机矩阵、可恢复的签名与升级方案仍未验收。iOS 没有本批新安装包，旧模拟器包存在 Keychain 权限错误。不能据此声称产品已经可供家庭使用或可以提交商店。
