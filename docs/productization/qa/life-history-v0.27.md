# 生活目标历史翻页验收

2026-10-01，源码 v0.27.0，schema 保持 25。家庭 Web 和原生客户端接通生活目标历史，当前目标始终单独显示，已结束目标每页最多 20 个。全部记录来自虚构家庭，不能作为训练效果证据。设计与接口见 [家庭生活目标](../FAMILY-LIFE.md)。

## 交付与行为

- 新增 `/api/children/:id/life-goals/history`；旧接口继续返回最多 20 条，不改变旧客户端契约。
- 按数据库微秒时间和 UUID 稳定翻页，保留当前目标；跨孩子游标、重复或未知参数被拒绝。
- 每次读取复核创建者家长或绑定孩子身份；协作家长不能借新接口扩大访问。
- 旧页移除分享答案后留在原页；创建或关闭目标后回到最新页。已确认写入但读取失败时清除旧答案，显示保存与刷新状态。
- 后台刷新不占用操作按钮；较晚返回的旧结果不能覆盖已翻页或已修改的状态。翻页网络失败保留本页；后台读取失败则隐藏记录并提示重新读取。

## 自动检查

| 检查 | 结果与范围 |
|---|---|
| 全部业务测试 | [282 项通过](life-history-v0.27/tests.log)，包括微秒同时间边界、20/20/7 分页、旧目标置顶、删除边界、跨家庭与成员权限、旧页撤回、后台读取与写入竞态 |
| 真实 HTTP | [14 项通过](life-history-v0.27/http.log)，新增实际服务的家长与孩子读取、旧接口兼容、重复参数拒绝、服务重启和旧页移除分享；执行于最终后台刷新调整之前，之后未改变服务端 |
| 构建 | [Web 与工作台通过](life-history-v0.27/build.log)，含 TypeScript；入口资源 1,480,011 字节，预算 1,500,000 字节 |
| 原生代码 | [类型检查](life-history-v0.27/mobile-check.log) 与 [iOS/Android Hermes 导出](life-history-v0.27/mobile-bundle.log) 通过，包含最终后台刷新改动 |
| 独立 PostgreSQL | **未执行测试**；在 Docker 镜像检查阶段失败，未创建本次容器，见 [失败证明](life-history-v0.27/postgres-proof.json)。已新增第 17 个用例；此前 v0.26 的 16 项通过不能代替本批结果 |

最终 Web 版本为 `4495cb2316383e64899f375ebc107006ff6a5b51b0d454fc25f933cd5f212951`，入口 `/assets/index-CRvasTVf.js`。早期构建和测试日志以 `before-quiet-refresh` 命名保留，不能与最终构建混淆。

Docker 故障诊断只终止了本次无响应的检查进程，没有重启 Docker 后台或停止其他容器。检查脚本新增失败阶段记录，不输出命令或数据库凭据。环境恢复后运行 `npm run test:postgres`；当前不声称新增 RLS 检查已通过。

## 浏览器验收

使用独立本机端口 4269、两份虚构档案：中文 6–8 岁和英文 15–17 岁，每份 47 个已结束目标及 1 个创建时间更早的当前目标。

- 初构建验证中英文 20/20/7 分页、上一页、末页禁用、当前目标仍显示、切换孩子回第一页及翻页焦点。
- 初构建的 320/390px DOM 宽度检查未发现横向溢出，但小视口截图发生缩放异常；`capture-stale-390.jpg` 不作为视觉通过证据，也不代表真机验收。
- 验收发现周期读取短暂锁住按钮，随后改为后台读取并增加两项竞态检查；最终构建重跑全部 282 项业务、构建和原生导出。
- 最终构建实际点击验证英文第 2/3 页、末页禁用、中文返回第 2 页及焦点落在历史标题。正常视口截图见下方。
- 全服务暂停尝试最终进入通用读取失败提示，恢复服务后点击“读取最新目标与记录”成功恢复。该尝试**未证明浏览器局部翻页错误分支通过**；局部保留和重试由共享客户端自动测试覆盖。

详细范围见 [浏览器记录](life-history-v0.27/browser-checks.json)。本次未通过浏览器提交永久移除答案；真实 HTTP 与客户端用例已验证移除事务和页码语义。

![中文历史第二页](life-history-v0.27/final-page-two-zh.jpg)

![英文历史第二页](life-history-v0.27/final-page-two-en.jpg)

## 原生安装包

| 平台 | 交付文件 | 本次验证 |
|---|---|---|
| Android arm64 | [APK](../../../dist/mobile-native/v0.27/android/focus-island-dev-0.2.0-v0.27-arm64-bundled.apk) | 39,686,882 字节，Release 编译、开发证书签名通过；无连接设备，未安装 |
| iOS 模拟器 | [App 压缩包](../../../dist/mobile-native/v0.27/ios-simulator/focus-island-v0.27-ios-simulator.zip) | 17,924,030 字节，arm64/x86_64；安装到 iPhone 17 / iOS 26.5，代码摘要相符 |

原生壳版本仍为 0.2.0，交付源码版本为 0.27.0。两平台均内置代码，不需要 Metro；在线准备和同步仍连接本机 `http://localhost:4181`。iOS 包仅供模拟器，Android 使用开发签名；这些文件不能直接提交商店。

复用既有隔离构建目录前，先核对 v0.26 源码快照、依赖锁及原生配置，再按允许清单复制当前 106 份源码；没有复制家庭数据或密钥。构建使用原有工具链及缓存，没有改变原生依赖。[准备证明](life-history-v0.27/native/prepare.json)、[源码快照](life-history-v0.27/native/source-snapshot.json)、[iOS 日志](life-history-v0.27/native/ios-build.log)、[Android 日志](life-history-v0.27/native/android-build.log)。

产物检查核对 63 个 iOS 文件及两端内嵌代码、架构、权限和 Android 签名，新增 `life-history-1` 与 `LIFE_HISTORY_PAGE_FAILED` 标识；分别替换成旧 v0.26 iOS/Android 包时均被拒绝。[产物清单](life-history-v0.27/native/artifacts.json)、[旧包反例](life-history-v0.27/native/verifier-negative.json)、[文件摘要及 ZIP 核验](life-history-v0.27/native/delivery.json)。首次签名检查缺少 JAVA_HOME，设置为已有 JDK 后完整复验通过，没有另装 Java。

安装后只核对可执行文件和内嵌代码，未读取私人应用数据。[安装记录](life-history-v0.27/native/installation.json)。本次 UI 工具仍报告 Mac 锁屏，Android 无连接设备，因此**没有取得原生界面、冷启动、实际加密或离线恢复的设备通过结果**。安装及摘要一致不能代替设备流程验收。

交付给用户的家庭 Web 地址为 [本机 4181](http://127.0.0.1:4181/)，已确认健康接口返回 0.27.0，并加载上述最终入口，见 [服务记录](life-history-v0.27/runtime.json)。4269 仅为隔离虚构数据验收入口。

## 保留的发布要求

分页为实时查询，跨页不冻结数据；后台无法确认最新状态时会隐藏记录。生活目标需要联网，未提供私人历史离线缓存。独立 PostgreSQL 本批用例、原生 UI、真实设备时序与存储、读屏和大字体仍需验收。固定语音、真实专业内容审核、独立青少年身份、地区准入、家庭研究和生产运行仍按 [团队交接](../NEXT-DELIVERY.md) 执行。
