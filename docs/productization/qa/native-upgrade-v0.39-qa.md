# v0.39 原生版本递增与服务初始化验收

日期：2026-10-01。面向本地研发测试，不构成真实家庭试用或商店发布批准。

## 本批变更

- 移动端应用版本为 0.2.1。`build-identity.json` 统一记录 Android 版本码 2、iOS 构建号 2；Expo 配置从包版本和该文件读取，隔离构建快照包含该文件。
- [Android arm64 本地测试 APK](../../../dist/mobile-native/v0.39/android/focus-island-v0.39-arm64-local.apk) 已编译。其 [核验报告](../../../dist/mobile-native/v0.39/android/verification.json)记录 39,707,098 字节、SHA-256 `ec9b0a0e0a17b09eab21fc4c79aaa0add211fb3e39d3a07f9b46e1ed70715264`、内置 v0.39 运行代码、签名与权限。与 [v0.38 包](native-package-v0.38-qa.md)对照：包名和测试证书相同，Android 版本码由 1 升至 2。验证器也以同版本码的另一文件做负例，明确拒绝 `Android version code must increase`，且未写出成功报告。
- 后续已保存[完整源码归档](../../../dist/mobile-native/v0.39/android/source-archive.tar.gz)并独立逐文件复核；原临时构建目录已清理。见[源码留存记录](source-provenance-v0.40-qa.md)。
- 服务端创建未使用的家庭服务对象时，不再立即启动内容和会话授权的数据库初始化。此前完整并发回归两次出现测试关闭数据库后仍有异步访问；修改后完整回归通过。

## 运行检查

`npm run mobile:check`、`npm run check`、`npm test`（296/296）、`npm run test:http`（14/14）和 `npm run build` 通过；Web 离线入口 1,490,568 字节，低于 1,500,000 字节预算。Expo 配置输出确认 iOS 构建号 2 和 Android 版本码 2；生成的 Android 工程及最终 APK 清单均确认 0.2.1/2。

## 尚待设备与发布验证

`adb devices -l` 没有连接设备，故不能声称已完成 v0.38→v0.39 覆盖安装、原有本机记录保留、登录、声音、加密落盘或离线恢复。iOS 只更新了配置，没有生成或运行本批安装包；旧模拟器包的 Keychain 权限问题仍待解决。当前 APK 使用 Android Debug 测试证书、只含 arm64、连接本机开发服务，生产模式继续关闭。真实家庭研究、正式监护核验、市场批准、内容与语音真人审核和完整真机矩阵仍是发布门槛。
