# v0.24 原生安装包交付与核验

2026-10-01。产品源码版本 0.24.0，原生壳版本 0.2.0，业务模式保持本地开发。本批把此前只导出运行代码的 v0.24 制作为可安装产物；没有增加外部 API、真实家庭数据或商店发布。

## 可交付的文件

| 平台 | 产物 | 实际结果 |
|---|---|---|
| Android | [arm64 APK](../../../dist/mobile-native/v0.24/android/focus-island-dev-0.2.0-v0.24-arm64-bundled.apk) | 39,671,574 字节，Release 编译，原开发证书；无连接设备，未安装 |
| iOS 模拟器 | [App 压缩包](../../../dist/mobile-native/v0.24/ios-simulator/focus-island-v0.24-ios-simulator.zip) | arm64 / x86_64，iOS Simulator SDK 26.5；已安装到 iPhone 17 / iOS 26.5 |

两份产物均内置运行代码，不需要 Metro。在线登录、准备和同步仍连接开发机 `http://localhost:4181`。iOS 产物不能安装到真实 iPhone；Android 是 arm64 本地开发签名包，不能作为商店发行包。系统显示的原生版本仍为 0.2.0，使用交付路径和摘要区分本次 0.24.0 源码产物与历史包。

交付压缩包、APK、构建工具和核验依据的摘要见 [交付清单](native-package-v0.24/delivery.json)。本机 API 已只读核对为 0.24.0 / local-development，见 [运行检查](native-package-v0.24/api-health.json)。

## 工程核验

| 检查 | 证据与范围 |
|---|---|
| Android 构建 | [最终日志](native-package-v0.24/android-build.log)，357 项 Gradle 任务，构建成功 |
| iOS 构建 | [最终日志](native-package-v0.24/ios-build.log)，独立 `build-ios-v024` 目录，构建成功 |
| Pods 配置 | [配置日志](native-package-v0.24/ios-pods.log)，94 个 Pods 安装完成，按配置生成 SQLCipher 源码 |
| 源码对应 | [源码快照](native-package-v0.24/source-snapshot.json)，101 个文件逐份与仓库和隔离构建目录核对 |
| 可复现准备入口 | [新准备流程](native-package-v0.24/prepare-proof.json)，实际新建隔离目录并核对全部源码；未复制家庭数据根目录、环境文件或旧原生工程 |
| 最终产物 | [文件与签名清单](native-package-v0.24/artifacts.json)，iOS 63 个文件、可执行架构、两份内嵌代码、Android 签名/权限/备份设置 |
| 失败分支 | [拒绝记录](native-package-v0.24/verifier-negative.json)，源码摘要不符、越界路径和篡改 APK 均不能生成成功报告 |
| iOS 安装 | [安装记录](native-package-v0.24/installation.json)，安装后的可执行文件及内嵌代码摘要与交付产物一致；未读取私人应用数据 |

固定检查包含 `family-content-1`、`parent-guide-2-preview`、内容变更处理与离线恢复标识，确认新功能代码进入安装包。标识存在不是功能运行、可信编译器或内容效果证明。

APK 禁用备份，未声明录音、摄像头、精确/粗略定位或旧式共享存储读写权限。签名证书与 v0.11 开发包一致。仍有开发工具链权限和本地明文通信配置；详细权限以清单为准，正式发行仍需收敛。iOS 未声明麦克风、摄像头和位置使用说明。

本批没有改动业务规则、家庭数据协议或 App 页面，沿用上一批 264 项业务、12 项 HTTP、15 项 PostgreSQL 结果，不把这些历史检查记录为本批重新运行。新增构建脚本完成语法检查、实际准备、真实产物正例和拒绝路径验证。

## 本次发现与处理

更新隔离目录的依赖后，第一次 iOS 构建缺少 Expo SQLite 生成的头文件；重新安装锁定 Pods 后，旧编译缓存仍出现 `exsqlite3_*` 接口缺失。生成的 SQLite C 源码、头文件、Swift 和 podspec 与原成功构建逐份一致；改用全新 DerivedData 后构建通过。没有修改或关闭 SQLCipher。

系统 Ruby 2.6 的 logger 加载顺序也造成配置失败。最终在同一 Ruby 进程先加载锁定 Bundler，再加载 logger 并运行 Pods；原始失败日志保留在本批目录。旧 Ruby 无 `filter_map`，Expo 提示回退到源码构建。团队构建环境仍应使用受支持 Ruby，不能把本机兼容方式当作正式 CI 基线。

首次篡改 APK 检查已收到签名失败，但 Node 26 子进程在未捕获异常退出时停在工作线程回收；调用栈确认后终止该临时进程。校验工具改为明确捕获错误、返回非零状态，再次独立执行拒绝检查。最终结果以拒绝记录中的退出码为准。

## 团队安装与验收顺序

1. 在开发机启动现有家庭服务；使用虚构资料进行开发验收。
2. iOS 模拟器安装压缩包内的 `.app`。本机 iPhone 17 已安装最新包；解锁 Mac 后打开 App，先验证冷启动和连接。
3. Android 连接 arm64 设备后，使用 `adb reverse tcp:4181 tcp:4181` 转发本机服务端口，再用 `adb install -r` 安装本批 APK。不能将 API 暴露到公网来绕过连接问题。
4. 完成中文儿童与英文青少年的登录、家长课、生活目标、一次完整练习和提前结束，保存设备、系统、包摘要及实际结果。
5. 再执行后台/前台、锁屏、断网重开、补传、账号切换、撤回、导出与删除矩阵；检查 SQLCipher 文件、密钥不可用和系统分享取消。

**当前仍未通过**：原生界面操作、实际音频、触摸与计时、加密文件、生命周期和断网恢复验收。Mac 在 UI 工具检查时处于锁屏，不能观察或操作模拟器界面；Android 没有连接设备。安装成功不代替这些检查，也不代替真实手机、家庭研究或商业发布门槛。
