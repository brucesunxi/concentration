# v0.28 固定语音覆盖与正式内容发布验收

2026-10-01。本轮建立四年龄段、两种语言、四类任务的固定语音制作清单，并在**正式 `published` 内容**的签名校验中增加语音门槛。当前应用仍为本机开发预览；本轮没有生成新的 MP3，也没有把未审内容标记为批准。

## 内容团队交付

运行 `npm run content:readiness -- --out <report.json> --markdown <checklist.md>`，从干净的源码开发内容库核验签名和每份引用素材的字节摘要，生成 [32 个组合的台词及缺口](content-readiness-v0.28.md) 和 [机器可读清单](content-readiness-v0.28.json)。工具不读取家庭资料，也不检查实际工作台数据库；实际审核及市场发布须在工作台和发布流程中另行核对。

| 指标 | 当前源码情况 |
|---|---:|
| 年龄 × 语言 × 任务组合 | 32 |
| 已接入固定 MP3 且字幕与指令一致 | 6 |
| 缺少固定 MP3 | 26 |
| 已获真实专业审核 | 0 |
| 当前可据此认定为正式发布 | 0 |

清单逐项给出台词、语种、年龄段、任务、已有声音摘要与音色 ID。内容团队需按内容版本制作固定语音，由母语与方法负责人听审，并在真实参考设备上验证音文一致、播放、字幕和可理解性。自动摘要检查无法判断声音是否自然或适合儿童。

## 软件行为与检查

`published` 内容要求绑定固定 MP3，素材带音色 ID；原有内容模型已要求其语言、字幕与指令逐字一致。缺少声音或音色 ID 返回 `AUDIO_COVERAGE_REQUIRED`。本机 `local-preview` 保持开发验收流程；`reviewed-preview` 仍限本机。国家与年龄的开放结论、真实审阅身份和效果证据仍是独立发布门槛。

| 验证 | 证据与结果 |
|---|---|
| 关键规则 | [专项测试](content-readiness-v0.28-targeted.log)：伪造“已批准且已签名”的内容仍因缺少 MP3 或音色 ID 被拒绝；字幕改动和原始字节篡改检查继续通过 |
| 业务回归 | [283 项通过](content-readiness-v0.28-tests.log) |
| 真实 HTTP | [14 项通过](content-readiness-v0.28-http.log)；首次在受限环境尝试因无法监听回环端口失败，获本机监听权限后完整重跑通过 |
| 类型与 Web 构建 | [通过](content-readiness-v0.28-build.log)，入口离线资源 1,480,172 字节，低于 1,500,000 字节预算；[移动类型检查](content-readiness-v0.28-mobile-check.log)通过 |
| 服务入口 | [本机 4181](http://127.0.0.1:4181/) 返回版本 0.28.0，入口脚本 `/assets/index-Nfm36O2N.js`，见 [服务记录](content-readiness-v0.28/runtime.json) |

本轮未重跑独立 PostgreSQL 套件。上轮新增历史用例在 Docker 镜像检查阶段未启动，仍须独立复验；本批没有数据库迁移。成功的 PGlite 与 HTTP 检查不能当作真实 PostgreSQL 行级隔离通过。

## 本地原生测试包

| 平台 | 文件 | 验证情况 |
|---|---|---|
| Android arm64 | [APK](../../../dist/mobile-native/v0.28/android/focus-island-dev-0.2.0-v0.28-arm64-bundled.apk) | Release 编译、开发证书签名和内嵌代码检查通过；未连接 Android 设备 |
| iOS 模拟器 | [App 压缩包](../../../dist/mobile-native/v0.28/ios-simulator/focus-island-v0.28-ios-simulator.zip) | arm64/x86_64，ZIP 完整；安装至 iPhone 17 / iOS 26.5，安装后代码摘要与交付包一致 |

两平台内嵌了 `AUDIO_COVERAGE_REQUIRED` 校验代码，分别换入 v0.27 包均被新增标识检查拒绝。构建源目录与当前仓库的 106 份允许清单文件逐项匹配，依赖锁除根版本外未变、原生配置未变，未复制家庭数据。[准备记录](content-readiness-v0.28/native/prepare.json)、[源码快照](content-readiness-v0.28/native/source-snapshot.json)、[iOS 构建](content-readiness-v0.28/native/ios-build.log)、[Android 构建](content-readiness-v0.28/native/android-build.log)、[产物核验](content-readiness-v0.28/native/artifacts.json)、[旧包反例](content-readiness-v0.28/native/verifier-negative.json)、[文件摘要](content-readiness-v0.28/native/delivery.json)及[安装核对](content-readiness-v0.28/native/installation.json)均已保存。

原生壳版本仍为 0.2.0；测试包运行在线功能仍使用本机 API。UI 工具报告 Mac 锁屏，且没有连接 Android 设备，**没有完成原生界面、声音播放、真实加密文件和断网恢复的设备验收**。这些开发签名和模拟器产物不能作为商店发行包。

## 下一步通过条件

内容负责人先按缺口清单确定每组合固定台词与制作批次，再由母语和方法负责人对具体版本签署审阅；测试负责人在目标设备核对音频、字幕、图像和任务反馈。产品、法务与安全负责人按国家、年龄、语言和渠道确认可开放范围。完成这些证据后，发布人才能将相应组合纳入正式发行清单；代码中的声音门槛仅是其中一项检查。
