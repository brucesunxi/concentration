# 最新源码的 Android AAB 构建与核验

2026-10-07。由于本机只余约 20.6 GiB 可用空间，使用仓库的手动 GitHub Actions 工作流构建，未复制大型 Android 工程到这台 Mac，也未删除旧构建目录或旧包。工作流见 `.github/workflows/android-aab.yml`：安装固定版本依赖、检查原生类型、记录 149 份被跟踪的 App 源文件及摘要、生成 Android 工程、编译 Release AAB、核对源码和包体，最后上传三份附件。没有 Docker 步骤。

最终通过的任务：[Android test AAB · 37570609755](https://github.com/brucesunxi/concentration/actions/runs/37570609755)，源码提交 `932fd15b5a1bce1a22a26783529f1fce2b97ca48`。常规[家庭质量检查 · 37570596027](https://github.com/brucesunxi/concentration/actions/runs/37570596027)也通过。首轮 `8aff6bd` 已成功；将已弃用的 Java 设置动作更新为 v5 后，再次完整构建、核验和上传，耗时约 13 分钟。

本机交付副本（Git 忽略的 `dist/`，仅在这台电脑）：

- [AAB](../../../dist/mobile-native/v0.46/github-aab-932fd15/focus-island-android-aab-932fd15b5a1bce1a22a26783529f1fce2b97ca48/FocusIslandDev-local.aab)
- [源码快照](../../../dist/mobile-native/v0.46/github-aab-932fd15/focus-island-android-aab-932fd15b5a1bce1a22a26783529f1fce2b97ca48/source-snapshot.json)
- [静态核验报告](../../../dist/mobile-native/v0.46/github-aab-932fd15/focus-island-android-aab-932fd15b5a1bce1a22a26783529f1fce2b97ca48/aab-static-report.json)

下载后的包体 SHA-256 为 `00b4b7187353bb78c6f87c13d2f7114ab0ab499c933565e00e01c52dd3784727`，与报告一致；大小 77,199,447 字节。包名 `dev.focusisland.family`、版本 `0.2.8` / 版本码 `9`，包含 `arm64-v8a`、`armeabi-v7a`、`x86`、`x86_64` 四种架构。ZIP、清单、内置运行代码标记、敏感文件名、JAR 签名与源码逐文件摘要均经构建任务核对。签名者是 `CN=Android Debug`，报告明确 `storeRelease=false`。

以后在 GitHub 仓库的 **Actions → Android test AAB → Run workflow → main** 可再次手动构建。构建附件保留 14 天；本机副本不受该期限影响，但不会随 Git 推送。AAB 不能像 APK 一样直接安装。此包仍指向本地测试服务，使用开发调试签名和未获专业批准的预览内容，**不是应用商店发行包**。最新恢复日志完整性改动只完成源码、单元测试及 AAB 静态核验；旧库升级、离线恢复、系统导出、设备听感和真实 Android 设备仍须在对应安装包上验收。
