# 原生端退出登录的独立清理

2026-10-07。移动测试版 `0.2.12`，Android 版本码 `13`、iOS 构建号 `13`。此前原生端先撤销本机离线准备资料，再请求服务端注销；若 SQLite 或加密存储在第一步报错，后续的服务端令牌撤销会被跳过。界面可能已经离开家庭空间，但已签发的令牌仍只能等待原有到期或后续处置。

现在退出时先从内存移除身份；本机离线失效、服务端注销和安全存储中的孩子令牌删除同时启动、分别等待结果。任一环节失败仍向界面报告失败，不把未完成的清理当成成功。服务端请求使用退出前捕获的令牌，不依赖已清空的内存身份；整个过程不输出令牌或家庭资料。

专项测试分别模拟本机失效失败、安全存储删除失败和服务端断网，均确认另外两项仍会执行；本机数据库持续等待时，服务端撤销也会立即启动。全量 `npm test` **423/423** 通过；`npm run check`、`npm run mobile:check` 与 Android/iOS Hermes 导出通过。专项测试验证的是清理编排，不等同于真实设备的 Keychain/Keystore 故障、网络断开与服务端令牌状态验收；这些仍在 D03 设备矩阵中。若本机资料和安全存储同时不可写，设备端无法凭一次失败操作保证离线资料立即失效，界面必须如实呈现清理未完成。

## 设备观察与登录页资料保护

`0.2.12` 的[Android 35 模拟器任务 37606568783](https://github.com/brucesunxi/concentration/actions/runs/37606568783)先完成 `0.2.11 → 0.2.12` 覆盖升级、离线恢复、正式练习、补传与家长报告核对，再从孩子空间退出；断开服务并强退重开后没有出现旧的离线恢复入口。这验证了正常退出路径在该虚拟设备上生效，不证明故障注入时服务端令牌已撤销。

设备截图也暴露出另一项隐私缺陷：[退出后的登录页](../../../dist/mobile-native/v0.46/emulator-sign-out-37606568783/android-smoke-input/focus-island-android-aab-a75c9d02aab67cfabfd9e5d5daffaa31e013c13b/android-sign-out-login.png)仍预填虚构家庭名称；只有进程重开后才清空。移动测试版 `0.2.13` 去掉登录页从上一身份预填家庭名称的状态，保留当前登录表单内的正常输入。

修正包由[构建任务 37607820345](https://github.com/brucesunxi/concentration/actions/runs/37607820345)生成；[Android 35 模拟器任务 37609203327](https://github.com/brucesunxi/concentration/actions/runs/37609203327)从 `0.2.12` 覆盖安装后，实际完成离线恢复、重连补传与家长报告核对；再退出孩子空间，立即核对界面节点不含虚构家庭名称，断开服务、强退重开后仍无旧恢复入口。[设备报告](../../../dist/mobile-native/v0.46/emulator-sign-out-37609203327/android-smoke-input/focus-island-android-aab-757cb571b3de4d0a86dd8712a25fad6227ca67bf/family-flow-report.json)、[退出当下登录页](../../../dist/mobile-native/v0.46/emulator-sign-out-37609203327/android-smoke-input/focus-island-android-aab-757cb571b3de4d0a86dd8712a25fad6227ca67bf/android-sign-out-login.png)和[断网重开页](../../../dist/mobile-native/v0.46/emulator-sign-out-37609203327/android-smoke-input/focus-island-android-aab-757cb571b3de4d0a86dd8712a25fad6227ca67bf/android-sign-out-restart.png)保存在本机 Git 忽略目录，截图已目视核对。真实设备及故障时的服务端令牌撤销仍须单独验收。
