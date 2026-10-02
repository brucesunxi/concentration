# 当前源码 iOS 模拟器构建与启动验收

2026-10-02，源码提交 `ae5d0e5`。本批检查原生 App 是否真的能在 iOS 模拟器安装与启动，并重新核对以前阻断的 Keychain 权限；这不是商店发布或真机验收。

## 构建与安装

- 使用 `npm run mobile:prepare-build` 将当前源码和依赖复制到临时 ASCII 路径，排除本机家庭数据；源码清单 SHA-256：`21084aef07e1713bbd8a7c4c62041ecd3d19e4afb4f9b8b569f467c61d3a2591`。
- Expo 预生成 iOS 工程，锁定的 CocoaPods 1.16.2 在临时 Ruby 目录安装 94 个 pod。当前机器的系统 Ruby 2.6 需要预加载锁定版 Logger；全局 `CC=gcc-14` 会让 Xcode 参数被 GCC 误解析，改用 `/usr/bin/clang` 和 `/usr/bin/clang++` 后 Release 构建成功。没有修改项目原生依赖或系统 Ruby。
- iOS 26.5 的 iPhone 17（arm64）与全新 iPhone 17e 模拟器都完成安装；应用版本 `0.2.8`、构建号 `9`。内置 Hermes `main.jsbundle` SHA-256：`802a3676e38b61a510d7ad6e58e7f11b1f594babe51502e02899c8a94cbd4c58`，包含本轮未结束练习的英文提示。
- 两台模拟器的 `xcrun simctl launch` 都成功返回应用进程；[全新设备首屏截图](ios-current-launch-v0.46.png)显示当前中文家长登录页面和成人虚构资料提示。没有输入真实家庭资料。

## 首次构建时的安全存储阻断（历史）

Xcode 模拟器构建最终使用 `Sign to Run Locally`；最终包的代码签名验证通过，但 entitlement 字典为空，没有 `application-identifier` 或 `keychain-access-groups`。源码和生成工程声明了 Keychain 权限，构建产物没有兑现。**这并未阻止两台模拟器打开登录首屏**；启动只执行了 SecureStore 读取，不能证明凭据写入及恢复可用。

本机现在有有效 Apple Development 签名身份。对独立包和原标识当前包分别补入相应 entitlement 后，系统允许安装，但 SpringBoard 拒绝启动，返回 `FBSOpenApplicationServiceErrorDomain` / `RBSRequestErrorDomain`。按 Xcode 默认本地签名恢复后，当前包再次正常启动；仅用于诊断的独立包已卸载。这说明“签名验证成功”不能代替“权限及应用可运行”。

以下补验已解决本段当时的 Keychain 写入/读回与练习阻断；本段仅保留首次构建的诊断记录。后台/断网恢复和 Android 设备矩阵尚未实测。正式家庭开放门槛保持关闭。

## 2026-10-02 iPhone 17 补验

Mac 解锁后，用仅供成人验收的虚构家庭和孩子在 iPhone 17 / iOS 26.5 上登录、建档并启动练习。首轮会话创建成功，但准备页停在“练习材料或加密记录尚未准备好”。不含家庭资料的阶段日志把故障缩小到原生素材准备的 `open-asset`；React Native 运行环境在此处调用 `AbortSignal.throwIfAborted()` 抛出 `TypeError`。改为检查通用的 `signal.aborted` 后，同一会话的内容包、图片和预录语音均通过校验并载入。

本机签名的修复包随后通过以下实际界面路径：登录、短练习规则页、语音播放控件切换到“停止播放”、两道示范题、第一道正式题选中和提交、服务端同步、提前结束摘要，以及家长报告中“独立有效步骤 1 个，其中正确 1 个”的记录。素材缓存中有 2 个文件；本地 SQLCipher 数据库为 4096 字节，前 16 字节并非明文 SQLite 标识。安装同标识更新包并重新启动后，孩子身份能够从 Keychain 读取，会话回到暂停页且显示恢复资料已保存。测试的虚构家庭及两份孩子档案随后经家庭删除接口清理，旧身份返回 401；App 重启回到空白登录页。

一次临时的无应用签名诊断包曾扰乱该模拟器的 Keychain / 本机缓存，产生“安全存储不可读”；卸载这个仅含虚构资料的测试容器并重新安装本机签名包后恢复。此过程证明本地签名模拟器路径可用，**不证明**发行签名、真机 Keychain、Android、断网全链路、音质主观评价或商用发布准备完成。

随后重新从当前完整源码建立隔离快照、生成 iOS 工程、安装锁定的 Pods，独立完成 arm64 Release 构建；最终 Hermes `main.jsbundle` SHA-256 为 `f566448f12d95445dbf2cc2b5c46b0b3172384f6f1bb1cd9ec956c495eb124b2`。本机签名产物的标识为 `dev.focusisland.family`，安装并启动到空白家长登录页，没有安全存储警告。前述练习交互是在相同修复但较早原生源码快照上完成，当前完整源码包只复验了构建、安装与启动；不要把这两种证据合并理解成完整当前源码的所有操作都已实测。

## 断网恢复边界的后续代码修正

原生请求若已收到 HTTP 响应头、读取 JSON 内容时才触发 12 秒超时，先前会把中断当成解析错误，因而不会展示本机已准备练习的离线恢复入口。当前源码把**本请求自己的超时中断**归类为网络不可用，同时保留真正的无效 JSON 为错误；两种情况的针对性测试、移动端类型检查与 iOS/Android Hermes 导出通过。这是代码和运行包导出证据，尚未替代模拟器上断网、强退、重开及补传的交互验收。

## 最新提交的重新构建与跨模拟器首启

2026-10-02，再从提交 `b4f3972` 的完整源码建立不含家庭数据的隔离快照；[源码清单](../../../dist/mobile-native/v0.46/ios-current-qa/source-snapshot.json) SHA-256 为 `9f70ece964f3f71cc6af18584656db582eb908a3d2846e27b18b9269a861040a`。128 个源码文件另存为[独立归档](../../../dist/mobile-native/v0.46/ios-current-qa/source.tgz)，SHA-256 为 `56f8ff52bc75c05b2482fcf322b2b6a8c734acd3aecd5471d8d8d6fce40ca4a6`，逐文件复核通过。重新预生成 iOS 工程、安装 95 个 Pod 并完成 arm64/x86_64 Release 编译。本机模拟器签名包保存在[本地测试 App](../../../dist/mobile-native/v0.46/ios-current-qa/FocusIslandDev.app)，版本 `0.2.8`、构建号 `9`；Hermes 包 SHA-256 为 `07cbd23ae971608eb2fce2264a907d6554052622c06ff138abda28fa53c1872b`。`codesign --verify --deep --strict` 通过。这不是商店包。

- 全新 iPhone 17 Pro / iOS 26.5 原先没有本 App；安装并启动到[正常家长登录页](ios-current-clean-pro-v0.46.png)，没有安全存储警告。设备产生 4096 字节的 SQLCipher 数据库，前 16 字节为 `da 81 ad bb 09 e5 57 27 c8 06 cd 9a 53 22 1b 71`，不是明文 SQLite 标识。此证据覆盖该设备首装与加密文件初查，不覆盖正式签名或练习交互。
- 曾走通虚构练习、已删除虚构家庭的 iPhone 17 安装同版本本机签名更新包后，仍显示正常家长登录页。没有重新走完整练习，也不能以首屏推断旧 Keychain 项和离线日志迁移都已验证。
- 曾安装诊断包的 iPhone 17e 在更新后显示[安全存储不可读的保护页](ios-current-keychain-17e-v0.46.png)，已有数据库文件保留。模拟器 `securityd` 明确报告 `NSOSStatusErrorDomain -34018`：应用缺少 `application-identifier` 与 `keychain-access-groups` entitlement。无签名编译产物、手动补本机 ad-hoc 签名、Xcode 默认 `Sign to Run Locally` 都没有使这台设备恢复；后者的签名 entitlement 字典仍为空。同一构建在另外两台设备能到登录页，不能据此把 iPhone 17e 的失败当作业务代码或密钥损坏，也不能忽略这个环境差异。

本机模拟器构建的 Keychain entitlement 未兑现为可检查的最终签名，是发行门槛。需要使用正式开发/分发签名与配置文件，在独立设备上核验实际 entitlement、SecureStore 写入及重启读回、旧包覆盖安装、断网强退重开与补传；目前桌面操作接口仍报告 Mac 已锁定，无法完成本批界面交互。任何安装测试均未清除 iPhone 17e 的加密文件或录入真实家庭资料。

后续增加 `npm run mobile:verify:ios-keychain -- --app <候选包路径>` 作为签名预检。本批本机包在该检查中明确失败：`MISSING_SIGNING_TEAM`、`MISSING_APPLICATION_IDENTIFIER`、`MISSING_KEYCHAIN_ACCESS_GROUP`；预检不会把两台模拟器的正常首屏误判为可发行的 Keychain 签名，也不能替代后续运行测试。
