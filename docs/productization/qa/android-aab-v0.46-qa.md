# Android AAB 本地构建核验（v0.46）

2026-10-03，从 `mobile:prepare-build` 生成的独立源码快照构建 Android Release AAB。快照记录 `sourceVersion=0.46.0`、应用版本 `0.2.8`，构建命令为 `:app:bundleRelease --offline --no-daemon --max-workers=2`，Gradle 结果为 `BUILD SUCCESSFUL`。

本机交付文件：[FocusIslandDev-v0.2.8-9-local.aab](../../../dist/mobile-native/v0.46/practice-life-ee369f6/android-bundle/FocusIslandDev-v0.2.8-9-local.aab)；[逐文件源码清单](../../../dist/mobile-native/v0.46/practice-life-ee369f6/android-bundle/source-snapshot.json)。这些文件位于 Git 忽略的 `dist/`，只保存在当前工作电脑，并未推送至 GitHub。

| 检查项 | 结果 |
| --- | --- |
| 包体 | 约 74 MiB；SHA-256 `a896c4780e6eb88c23860ce8363825c124a5b4afb9a55e83998b8882a0d8115d`；ZIP 完整性检查通过 |
| 应用身份 | `dev.focusisland.family`；版本名 `0.2.8`；版本码 `9`，与生成的 Android Gradle 配置一致 |
| 运行内容 | 含 `base/assets/index.android.bundle`、Android 清单、四种架构的 `libexpo-sqlite.so`：`arm64-v8a`、`armeabi-v7a`、`x86`、`x86_64` |
| 签名 | JAR 内容验证通过；签名者为自签的 `CN=Android Debug`，SHA-256 证书指纹 `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`。严格信任链检查因调试证书自签而未通过 |
| 敏感文件名 | 包内文件列表未发现 `.env`、数据库、JWK 或私钥文件名；这项检查不替代完整安全审计 |

**用途：**这是用于确认 Android Bundle 能构建的本地测试产物，不是可提交应用商店的正式包。当前 Release 仍使用调试签名，应用配置仍指向本机测试 API，且 `APP_MODE=production` 会阻止未经审批的正式构建。AAB 也不能像 APK 一样直接安装；现有 [arm64 本地 APK 与模拟器验收](android-emulator-offline-v0.46-qa.md)用于实际设备流程测试。正式上架前应确定发行身份和市场、完成内容及隐私审查、配置线上 API 和受控上传签名，再重新构建与验证。
