# 原生首次语言入口验收

2026-10-02，平台 v0.46.0、原生壳 0.2.8。本批只处理安装后首次打开的语言选择；正式家庭内容和全球市场准入仍按发布门槛独立验收。

## 行为

- 首次进入时按设备首选语言顺序寻找已支持语言：英语或简体中文。繁体中文不自动视为简体中文；如果没有匹配项，暂用英语。
- 登录页仍允许家长手动切换。登录成功或恢复已有会话后，使用该家庭保存的语言。
- Expo 原生配置声明 iOS 的 `en`、`zh-Hans` 和 Android 的 `en`、`zh-CN`，供系统的应用语言设置识别；这不声称其他语言已完成翻译。

## 当前证据

- 语言映射的优先顺序和繁体中文回退通过单元测试；原生 TypeScript 检查、iOS/Android Hermes 运行代码导出通过。
- 隔离临时工程预生成 iOS 和 Android：iOS `Info.plist` 包含 `en`、`zh-Hans`；Android `AndroidManifest.xml` 指向 `locales_config.xml`，其中包含 `en`、`zh-CN`。
- 锁定的 CocoaPods 1.16.2 完成安装，`Podfile.lock` 包含 `ExpoLocalization 57.0.2`。本机系统 Ruby 2.6 在预编译组件脚本中提示 `filter_map` 不可用，Pods 仍完成安装；团队正式构建环境需使用受维护的 Ruby。
- 首次全架构 iOS Release 编译耗尽本机磁盘空间并中断；仅清理旧的临时构建目录后，使用提交 `cbd210b` 的独立源码副本，针对 iOS 26.5 / iPhone 17e 的 arm64 架构重新执行 Pods、Release 编译，**整包构建成功**。内置 `main.jsbundle` SHA-256 为 `4a7ac48480feb8ba0a9a1defb0f040a47dc792743434ce7b344a59b934729a26`。此前空间失败不再是当前构建阻断。
- 同一包未签名时虽可安装启动，却显示“本机安全存储无法读取”。以 Xcode 的模拟器本地签名重建后，严格签名校验通过，安装、启动及登录首屏显示正常。签名的 entitlement 字典仍为空；首屏成功只证明 SecureStore 启动读取未阻断，**不证明写入或重启读回可用**。
- 本机可复查的已签名模拟器包及逐文件源码清单位于被忽略的 `dist/mobile-native/v0.46/ios-simulator/`；它不是商店包，也没有提交到 Git。生成目录清理后重新验签通过，测试模拟器仍保留已安装的 App。
- iPhone 17e 实测：设备语言顺序 `zh-Hans-CN, en-CN` 显示[简体中文首屏](native-locale-zh-v0.46.png)；`en-US, zh-Hans-CN` 显示[英文首屏](native-locale-en-v0.46.png)；仅 `zh-Hant-TW` 时回退[英文首屏](native-locale-hant-v0.46.png)。结束时已恢复模拟器原来的语言顺序。
- 清理后重跑 Web 与原生 TypeScript 检查、差异空白检查及完整 `npm test`，全部通过；业务测试为 326/326。

## 尚未验证

首次登录、SecureStore 凭据写入与重启读回、已登录家庭语言保持、系统设置中的单应用语言操作和 Android 设备首屏仍待交互验收。模拟器界面自动化当前受 macOS 锁屏阻断；已完成的三种 iOS 首屏语言检查不能代替这些流程。
