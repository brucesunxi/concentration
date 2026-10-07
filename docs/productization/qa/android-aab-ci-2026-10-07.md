# Android APK 与 AAB 远程构建交付

2026-10-07。由于本机可用空间约 20 GiB，使用仓库的 [Android test packages 工作流](../../../.github/workflows/android-aab.yml)从同一 Git 提交远程构建可安装 APK 和 AAB，再下载交付包；未在本机生成大型 Android 工程，也未删除旧构建文件。工作流记录 App 源码逐文件摘要，编译、验证签名及包体，并上传产物与报告。没有 Docker 步骤。

## 当前交付

[构建任务 37573726397](https://github.com/brucesunxi/concentration/actions/runs/37573726397)与[家庭质量检查 37573708547](https://github.com/brucesunxi/concentration/actions/runs/37573708547)均通过。包体源码提交为 `b8230d3958e921564c8a0a675e7edde4113a0381`，产品源码版本 `0.46.0`，App 版本 `0.2.8`、Android 版本码 `9`。本机副本位于 Git 忽略的 `dist/`，不会随 Git 推送：

- [可安装测试 APK](../../../dist/mobile-native/v0.46/github-packages-b8230d3/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/FocusIslandDev-local.apk)：103,660,802 字节；SHA-256 `0a1d09c0b7da0f076b86aacf58819a2409d6270d3df5de3968d875528f5dc6f7`。
- [测试 AAB](../../../dist/mobile-native/v0.46/github-packages-b8230d3/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/FocusIslandDev-local.aab)：77,199,444 字节；SHA-256 `6f4c35ddf50aaf70ebe226c5463db84ff347d51fd7ca13d283cee234b5ed24f9`。
- [源码快照](../../../dist/mobile-native/v0.46/github-packages-b8230d3/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/source-snapshot.json)、[APK 核验报告](../../../dist/mobile-native/v0.46/github-packages-b8230d3/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/apk-static-report.json)、[AAB 核验报告](../../../dist/mobile-native/v0.46/github-packages-b8230d3/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/aab-static-report.json)。

下载后重新计算两包 SHA-256，均与报告一致。两包使用相同的签名证书指纹 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`；APK 签名验证通过，AAB 签名验证通过。包名为 `dev.focusisland.family`，均含 `arm64-v8a`、`armeabi-v7a`、`x86`、`x86_64` 四种架构，内置运行代码的摘要一致。源码快照逐文件与构建提交核对，包内敏感文件名、关键功能标记和权限也经过静态检查。

这是**使用 Android Debug 证书签名的本地测试包**，配置为访问本地家庭 API，并允许本地开发网络连接；不是商店发行包。AAB 不能直接像 APK 一样安装。当前没有连接的 Android 真机或模拟器，因此 APK 的安装、登录、离线恢复、加密存储、声音及升级体验尚未完成设备验收。内容的专业与母语审核、市场发布要求也未完成。GitHub 附件保留 14 天；本机 `dist/` 副本不受该期限影响。

## 上一轮 AAB 记录

[构建任务 37570609755](https://github.com/brucesunxi/concentration/actions/runs/37570609755)从提交 `932fd15b5a1bce1a22a26783529f1fce2b97ca48`生成 AAB，SHA-256 `00b4b7187353bb78c6f87c13d2f7114ab0ab499c933565e00e01c52dd3784727`，本机旧副本仍位于 `dist/mobile-native/v0.46/github-aab-932fd15/`。它是历史构建，不代表当前 APK 的源码版本。
