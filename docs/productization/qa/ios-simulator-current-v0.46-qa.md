# 当前源码 iOS 模拟器构建与启动验收

2026-10-02，源码提交 `ae5d0e5`。本批检查原生 App 是否真的能在 iOS 模拟器安装与启动，并重新核对以前阻断的 Keychain 权限；这不是商店发布或真机验收。

## 构建与安装

- 使用 `npm run mobile:prepare-build` 将当前源码和依赖复制到临时 ASCII 路径，排除本机家庭数据；源码清单 SHA-256：`21084aef07e1713bbd8a7c4c62041ecd3d19e4afb4f9b8b569f467c61d3a2591`。
- Expo 预生成 iOS 工程，锁定的 CocoaPods 1.16.2 在临时 Ruby 目录安装 94 个 pod。当前机器的系统 Ruby 2.6 需要预加载锁定版 Logger；全局 `CC=gcc-14` 会让 Xcode 参数被 GCC 误解析，改用 `/usr/bin/clang` 和 `/usr/bin/clang++` 后 Release 构建成功。没有修改项目原生依赖或系统 Ruby。
- iOS 26.5 的 iPhone 17（arm64）与全新 iPhone 17e 模拟器都完成安装；应用版本 `0.2.8`、构建号 `9`。内置 Hermes `main.jsbundle` SHA-256：`802a3676e38b61a510d7ad6e58e7f11b1f594babe51502e02899c8a94cbd4c58`，包含本轮未结束练习的英文提示。
- 两台模拟器的 `xcrun simctl launch` 都成功返回应用进程；[全新设备首屏截图](ios-current-launch-v0.46.png)显示当前中文家长登录页面和成人虚构资料提示。没有输入真实家庭资料。

## 安全存储待验

Xcode 模拟器构建最终使用 `Sign to Run Locally`；最终包的代码签名验证通过，但 entitlement 字典为空，没有 `application-identifier` 或 `keychain-access-groups`。源码和生成工程声明了 Keychain 权限，构建产物没有兑现。**这并未阻止两台模拟器打开登录首屏**；启动只执行了 SecureStore 读取，不能证明凭据写入及恢复可用。

本机现在有有效 Apple Development 签名身份。对独立包和原标识当前包分别补入相应 entitlement 后，系统允许安装，但 SpringBoard 拒绝启动，返回 `FBSOpenApplicationServiceErrorDomain` / `RBSRequestErrorDomain`。按 Xcode 默认本地签名恢复后，当前包再次正常启动；仅用于诊断的独立包已卸载。这说明“签名验证成功”不能代替“权限及应用可运行”。

当前未能在应用内执行 SecureStore 写入/读回、登录、固定语音、后台/断网恢复和 SQLCipher 文件检查。macOS 当前锁定，无法使用界面自动化操作模拟器；Android 也无连接设备。下一步在解锁后的模拟器上完成凭据写入、重启读回和完整交互；若失败，再定位实际 Keychain 签名或配置问题，然后覆盖双平台设备矩阵。正式家庭开放门槛保持关闭。
