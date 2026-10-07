# Android APK 与 AAB 远程构建交付

2026-10-07。由于本机可用空间约 20 GiB，使用仓库的 [Android test packages 工作流](../../../.github/workflows/android-aab.yml)从同一 Git 提交远程构建可安装 APK 和 AAB，再下载交付包；未在本机生成大型 Android 工程，也未删除旧构建文件。工作流记录 App 源码逐文件摘要，编译、验证签名及包体，并上传产物与报告。没有 Docker 步骤。

## 当前交付：0.2.10

从提交 `816c711` 构建的 APK/AAB 将 Android 版本码增至 `11`，并在 Android 35 模拟器完成 `0.2.9 → 0.2.10` 的离线覆盖安装、恢复与补传。此版修正了无倒计时任务因慢帧被不必要暂停的问题；包体摘要、本机链接、设备报告及旧版失败原因见[覆盖升级验收](android-upgrade-v0.46-2026-10-07.md)。

## 上一批：0.2.9

`54daba0` 将 Android 版本码从 `9` 增至 `10`，用于发现升级后无倒计时任务的慢帧暂停问题；完整过程见[覆盖升级验收](android-upgrade-v0.46-2026-10-07.md)。

## 上一批：后台返回修正版

[构建任务 37584595512](https://github.com/brucesunxi/concentration/actions/runs/37584595512)从提交 `1c6e2d8b2ee431e915a78468067ddd2299fbc08e` 生成新版包；本机下载后重新计算摘要，均与构建报告一致。App 版本仍为 `0.2.8`、Android 版本码为 `9`，包名为 `dev.focusisland.family`。

- [可安装测试 APK](../../../dist/mobile-native/v0.46/github-packages-1c6e2d8/FocusIslandDev-local.apk)：103,661,690 字节；SHA-256 `fb758b3e12f086f4e6ef188b970a97d07f9bdd92cbe5fd9376ed125ee55f868d`。
- [测试 AAB](../../../dist/mobile-native/v0.46/github-packages-1c6e2d8/FocusIslandDev-local.aab)：77,200,191 字节；SHA-256 `4ef05bfdc189ec01b909b43c095e71e39c04a366297c2e91b8278a8b2213f74d`。
- [源码快照](../../../dist/mobile-native/v0.46/github-packages-1c6e2d8/source-snapshot.json)、[APK 静态报告](../../../dist/mobile-native/v0.46/github-packages-1c6e2d8/apk-static-report.json)、[AAB 静态报告](../../../dist/mobile-native/v0.46/github-packages-1c6e2d8/aab-static-report.json)保存在本机 Git 忽略目录；两包签名核验通过，内置运行代码摘要相同。

[Android 35 模拟器验收 37586520758](https://github.com/brucesunxi/concentration/actions/runs/37586520758)安装并运行这一 SHA-256 的 APK，实际按 Home 键验证规则页、反馈页和正式题的返回行为；结果与服务端家长报告一致，详见[后台返回验收](background-return-v0.46-2026-10-07.md)。这仍是使用本地 API 配置与调试证书的测试包，AAB 不能直接安装，也不适合上传应用商店。

## 更早一批交付

[构建任务 37573726397](https://github.com/brucesunxi/concentration/actions/runs/37573726397)与[家庭质量检查 37573708547](https://github.com/brucesunxi/concentration/actions/runs/37573708547)均通过。包体源码提交为 `b8230d3958e921564c8a0a675e7edde4113a0381`，产品源码版本 `0.46.0`，App 版本 `0.2.8`、Android 版本码 `9`。本机副本位于 Git 忽略的 `dist/`，不会随 Git 推送：

- [可安装测试 APK](../../../dist/mobile-native/v0.46/github-packages-b8230d3/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/FocusIslandDev-local.apk)：103,660,802 字节；SHA-256 `0a1d09c0b7da0f076b86aacf58819a2409d6270d3df5de3968d875528f5dc6f7`。
- [测试 AAB](../../../dist/mobile-native/v0.46/github-packages-b8230d3/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/FocusIslandDev-local.aab)：77,199,444 字节；SHA-256 `6f4c35ddf50aaf70ebe226c5463db84ff347d51fd7ca13d283cee234b5ed24f9`。
- [源码快照](../../../dist/mobile-native/v0.46/github-packages-b8230d3/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/source-snapshot.json)、[APK 核验报告](../../../dist/mobile-native/v0.46/github-packages-b8230d3/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/apk-static-report.json)、[AAB 核验报告](../../../dist/mobile-native/v0.46/github-packages-b8230d3/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/aab-static-report.json)。

下载后重新计算两包 SHA-256，均与报告一致。两包使用相同的签名证书指纹 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`；APK 签名验证通过，AAB 签名验证通过。包名为 `dev.focusisland.family`，均含 `arm64-v8a`、`armeabi-v7a`、`x86`、`x86_64` 四种架构，内置运行代码的摘要一致。源码快照逐文件与构建提交核对，包内敏感文件名、关键功能标记和权限也经过静态检查。

这是**使用 Android Debug 证书签名的本地测试包**，配置为访问本地家庭 API，并允许本地开发网络连接；不是商店发行包。AAB 不能直接像 APK 一样安装。本机没有连接的 Android 真机或模拟器；远程模拟器完成了下述安装、在线和离线虚构家庭流程。真机、语音听感、低存储与升级安装尚未验证。内容的专业与母语审核、市场发布要求也未完成。GitHub 附件保留 14 天；本机 `dist/` 副本不受该期限影响。

## Android 虚拟设备实装

[远程模拟器验收任务 37576980888](https://github.com/brucesunxi/concentration/actions/runs/37576980888)已在 Android 35 / x86_64 虚拟设备上重新核对相同 APK 的源码、签名和摘要，实际安装、打开英文家长登录入口、强制关闭及冷启动均通过。验收脚本见 [Android emulator startup 工作流](../../../.github/workflows/android-emulator-smoke.yml)。[运行报告](../../../dist/mobile-native/v0.46/emulator-smoke-37576980888/android-emulator-smoke-37573726397/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/emulator-smoke-report.json)、[启动截图](../../../dist/mobile-native/v0.46/emulator-smoke-37576980888/android-emulator-smoke-37573726397/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/emulator-first-launch.png)和界面结构文件保存在本机 Git 忽略目录。截图可见未连接本地 API 时的清晰错误提示，未输入家庭账号或孩子资料。

这一批次只证明**安装、启动、离线提示和冷启动**，不证明登录或练习。随后在[完整家庭流程任务 37578189008](https://github.com/brucesunxi/concentration/actions/runs/37578189008)中，同一 SHA-256 的 APK 在 Android 35 / x86_64 虚拟设备连接临时本地 API，完成英文虚构家庭创建、6–8 岁虚构档案、规则示范、1 个独立正式找目标步骤，以及服务端确认。家长报告中的独立正式步骤同样为 1。孩子离开练习后，相关生活建议被预选，但服务端家庭目标数仍为 0；共有 4 个适龄模板。流程结束后，虚构家庭已删除，专用模拟器的 App 数据已清空。

[完整流程报告](../../../dist/mobile-native/v0.46/emulator-family-37578189008/android-emulator-smoke-37573726397/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/family-flow-report.json)、[练习结果截图](../../../dist/mobile-native/v0.46/emulator-family-37578189008/android-emulator-smoke-37573726397/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/android-practice-summary.png)与[生活建议预选截图](../../../dist/mobile-native/v0.46/emulator-family-37578189008/android-emulator-smoke-37573726397/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/android-life-preselected.png)已保存到本机 Git 忽略目录。此批在线验收使用临时本地数据服务，不能证明 Vercel/Neon、真机声音或安全存储；离线重启与补传在下一批次单独检查。

## 当前 APK 的离线恢复与补传

[远程模拟器任务 37579840887](https://github.com/brucesunxi/concentration/actions/runs/37579840887)使用相同 SHA-256 的 APK 和临时本地 API。先等本机恢复资料保存完成，再断开 API 端口转发、强制关闭并重新启动 App。界面只提供已准备练习的恢复入口，没有显示虚构家庭名或孩子昵称；恢复后离线完成 2 道示范题和 1 道正式题，提前结束时显示“本机已保存、等待同步”。恢复连接并主动重试后，界面显示服务端确认，家长报告恰有 1 个独立正式步骤。最终虚构家庭已删除，专用模拟器 App 数据已清空。[离线报告](../../../dist/mobile-native/v0.46/emulator-offline-37579840887/android-emulator-smoke-37573726397/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/family-flow-report.json)、[恢复入口](../../../dist/mobile-native/v0.46/emulator-offline-37579840887/android-emulator-smoke-37573726397/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/android-offline-offer.png)、[待同步状态](../../../dist/mobile-native/v0.46/emulator-offline-37579840887/android-emulator-smoke-37573726397/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/android-pending-sync.png)和[已确认状态](../../../dist/mobile-native/v0.46/emulator-offline-37579840887/android-emulator-smoke-37573726397/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/android-practice-summary.png)保存在本机 Git 忽略目录。

这证明当前包在一台 Android 35 / x86_64 虚拟设备上可从已准备会话离线重启并补传；没有覆盖不同网络、真机安全存储、旧包升级或撤回竞态。恢复时家长身份没有自动重新登录，因此已同步摘要只提供返回家庭空间，不能直接进入需重新确认身份的生活目标入口。

## 练习中途切到后台并返回

[远程模拟器任务 37581571389](https://github.com/brucesunxi/concentration/actions/runs/37581571389)在相同 APK、Android 35 / x86_64 虚拟设备和临时本地 API 上，先完成两道规则示范，再于正式找目标步骤呈现后按 Home 键。重新打开 App 时显示“休息一下”和“我准备好了”，孩子可以选择继续或结束；选择继续后重新呈现目标。最终摘要显示 1 个独立正式步骤、0 个使用帮助步骤；服务端家长报告有 1 个独立正式步骤，并单独保留 1 个原因是 `background` 的正式步骤排除记录，后台中断未被计为一次正式答错。生活建议仅被预选，目标数保持 0；虚构家庭及专用模拟器 App 数据均已清理。

[运行报告](../../../dist/mobile-native/v0.46/emulator-background-37581571389/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/family-flow-report.json)、[后台返回截图](../../../dist/mobile-native/v0.46/emulator-background-37581571389/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/android-background-pause.png)与[完成结果截图](../../../dist/mobile-native/v0.46/emulator-background-37581571389/focus-island-android-aab-b8230d3958e921564c8a0a675e7edde4113a0381/android-practice-summary.png)保存在本机 Git 忽略目录。此验收覆盖一台虚拟设备的 Home 键后台切换；来电/音频打断、系统回收进程、长时间后台、低存储、不同设备和旧包升级仍需分别验收。

## 上一轮 AAB 记录

[构建任务 37570609755](https://github.com/brucesunxi/concentration/actions/runs/37570609755)从提交 `932fd15b5a1bce1a22a26783529f1fce2b97ca48`生成 AAB，SHA-256 `00b4b7187353bb78c6f87c13d2f7114ab0ab499c933565e00e01c52dd3784727`，本机旧副本仍位于 `dist/mobile-native/v0.46/github-aab-932fd15/`。它是历史构建，不代表当前 APK 的源码版本。
