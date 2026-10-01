# v0.29 原生声音降级与安全存储启动检查

2026-10-01。本轮只修改原生家庭 App 的两条失败路径，不新增或批准声音素材。目标仍是面向全球家庭的专业产品；本批是本地开发证据，不是商业发布批准。

## 已实现

1. 原生练习在已校验固定 MP3 但设备播放器加载失败时，继续显示完整规则与策略，隐藏无法使用的播放按钮，允许孩子按文字继续。播放时失败或播放器报告错误时，显示明确提示；不把声音故障计为练习错误。图片和内容校验失败仍按原规则停止，不能通过这条降级绕过内容签名。
2. 原生入口如果不能读取设备安全存储，显示保留资料与重试页面，不继续登录、建立家庭或接受邀请。重试重新读取安全存储和家庭状态，而非只重试网络请求。
3. 产物校验记录 iOS Keychain 权限是否存在，以免把能启动的模拟器包误判为完成身份与练习验收。

## 本地检查

| 检查 | 结果 |
|---|---|
| 移动类型检查与两平台运行代码导出 | 通过；iOS、Android 均生成 Hermes 包 |
| 业务回归 | [283 项通过](audio-fallback-v0.29/tests.log) |
| Web 与类型构建 | [通过](audio-fallback-v0.29/build.log)；离线入口资源 1,480,172 字节，低于 1,500,000 字节预算 |
| iOS 模拟器 Release 编译 | [成功](audio-fallback-v0.29/native/ios-build.log) |
| Android arm64 Release 编译 | [成功](audio-fallback-v0.29/native/android-build.log) |
| 源码与安装包 | [106 份源码快照](audio-fallback-v0.29/native/source-snapshot.json)逐项匹配；[产物报告](audio-fallback-v0.29/native/artifacts.json)核对两平台代码、架构、Android 开发签名和权限；旧 v0.28 两平台包均因缺本批代码标识被[反例检查](audio-fallback-v0.29/native/verifier-negative.json)拒绝 |
| 文件完整性 | [ZIP 与 APK 摘要](audio-fallback-v0.29/native/delivery.json)；ZIP 内运行代码与 `.app` 一致 |
| iPhone 17 / iOS 26.5 | [安装与代码摘要](audio-fallback-v0.29/native/installation.json)通过，启动后[实际画面](audio-fallback-v0.29/native/launch.png)显示安全存储重试入口 |

本机服务的 `/api/health` 返回 `0.29.0`，Web 首页返回本次构建的不可变版本，见[运行记录](audio-fallback-v0.29/runtime.json)。Android 当前没有连接设备，本轮未安装 Android 包，也未重跑独立 PostgreSQL 套件；本批没有数据库迁移。此轮新增逻辑没有原生触摸、音频中断和播放设备验收。

## 发现的 iOS 测试包阻断

模拟器启动缺少应用权限的 App 后，系统 `securityd` 报 `-34018`：`Client has neither application-identifier nor keychain-access-groups entitlements`。因此当前 iOS 测试包虽然能启动并显示重试页面，**不能完成安全存储初始化，也不能据此验收登录或声音播放**。本机没有有效的 Apple 代码签名身份；试验性的临时签名虽通过本地文件校验，模拟器拒绝启动，已恢复交付包。产物核验如实记录 `keychainEntitlementPresent=false`。需要使用有权访问 Keychain 的正式开发签名重新构建并在设备上复验，不能通过明文存储或跳过身份恢复来规避。

Android APK 已编译和校验但没有连接设备。完整移动端验收仍需：iOS/Android 分别运行安全存储、账号切换、固定音频正常与失败路径、系统静音/打断、后台与断网恢复，以及实际加密文件检查。32 份内容包里仍只有 6 份接入固定 MP3、26 份缺失，专业内容与母语听审未完成，见 [语音清单](content-readiness-v0.28.md)。

## 本地测试包

- [iOS 模拟器 App 压缩包](../../../dist/mobile-native/v0.29/ios-simulator/focus-island-v0.29-ios-simulator.zip)：仅供构建和启动诊断；当前 Keychain 权限缺失。
- [Android arm64 APK](../../../dist/mobile-native/v0.29/android/focus-island-dev-0.2.0-v0.29-arm64-bundled.apk)：开发签名，尚未设备安装。
