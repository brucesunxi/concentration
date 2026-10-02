# 练习总结到生活活动：Web / Android 流程与 iOS 启动边界

2026-10-02，功能源码提交 `ee369f6`。本批只在已完成至少一个正式步骤、且练习记录已由家庭服务确认时，向孩子提供自愿查看对应生活活动的入口。打开页面只预选分龄模板，不创建目标；孩子仍需自行选择是否保存。

## 已验证

- 本地 353 项测试、Web 与移动端类型检查、Web 构建、iOS/Android Hermes 导出通过。浏览器自动验收实际走通虚构家庭、完成练习、进入对应分龄活动，并读取目标列表确认没有自动创建目标。[GitHub Actions 运行记录](https://github.com/brucesunxi/concentration/actions/runs/36975856614)通过。
- Vercel 受保护预览部署 `dpl_G34rjyuT1otMw96LrdfUam7opZ8P` 已就绪，绑定 `concentration-two.vercel.app`。部署后用虚构资料完成家庭建立、内容与素材验签、练习、报告读取、家庭删除及旧会话失效检查；脚本返回各项 `true`。
- 从当前源码制作不含家庭数据的独立 iOS 构建，锁定的 95 个 Pod 安装成功，iPhone 17 / iOS 26.5 的 Release 构建、同标识覆盖安装和启动通过。Hermes `main.jsbundle` SHA-256 为 `095ec9b7793723c033e471ed1ce33ece2e340d8b67a05f8ce5dd314336b35b62`，包含新增入口文本。[启动画面](ios-practice-life-ee369f6.png)显示成人开发验收登录页。
- 当前源码另在 Android 16 / ARM64 专用模拟器上完成 Release 构建、APK v2 签名校验、同标识覆盖安装和真实界面操作。[本地测试 APK](../../../dist/mobile-native/v0.46/practice-life-ee369f6/android-simulator/FocusIslandDev-arm64.apk) SHA-256 为 `679c3a1e761594ed6f817b15cc9c9b110fc07043fbf9c967f296cd90d6fc2bc5`，内嵌 Hermes 包含新增入口文本；[源码清单](../../../dist/mobile-native/v0.46/practice-life-ee369f6/source-snapshot.json)不含家庭数据。这是开发测试签名，不是商店包。
- Android 使用虚构 `ZZ` 地区家庭和 6–8 岁英文档案：孩子同意开始、完成两道示范和一道正式找一找题，服务端确认后[总结页](android-practice-life-summary-ee369f6.png)显示 1 个独立步骤与自愿生活入口。点击后，[分龄活动](android-practice-life-selected-ee369f6.png)预选 `Find two little things`，允许更换或离开。服务端只读核对返回 `goalCount=0`、`templateCount=4`；没有自动创建目标。虚构家庭随后删除，旧会话返回 401。

## 可重复的 Android 设备验收

[`scripts/qa/android_practice_life.py`](../../../scripts/qa/android_practice_life.py) 对上述关键交互做端到端复验。脚本仅接受名为 `FocusIslandQA` 的 Android 模拟器、`dev.focusisland.family` App、`127.0.0.1:4181` 本地开发服务及明确的 `--reset-synthetic-app` 参数；不会连接真实设备或线上家庭。它安装指定 APK、清空该模拟器的 App 数据、创建随机虚构家庭、完成两道示范与一道正式题、核对服务端确认，再检查 `Find two little things` 的选中状态和服务端目标数为 0。结束时删除虚构家庭、验证旧会话失效，并再次清空 App 数据。失败时也尝试清理。

先启动本地 API 与专用模拟器，然后运行：

```bash
python3 scripts/qa/android_practice_life.py \
  --apk dist/mobile-native/v0.46/practice-life-ee369f6/android-simulator/FocusIslandDev-arm64.apk \
  --reset-synthetic-app \
  --evidence-dir dist/mobile-native/v0.46/practice-life-ee369f6/android-simulator/repeatable-qa
```

2026-10-02 使用上述 APK 连续复验三次，最终一次返回 `formalIndependentSteps=1`、`selectedTemplate=Find two little things`、`goalCount=0`、`templateCount=4`、`familyDeleted=true`、`appDataCleared=true`。人工核看了本地生成的总结和预选活动截图。验收 JSON 不打印虚构密码或会话令牌。截图保存在本地忽略目录；这套脚本覆盖 Android 当前流程，不替代 iOS、安全存储、真机或专业效果验证。

## 尚未通过的门槛

- 这份本机模拟器包的代码签名文件校验通过，但 Keychain 预检返回 `MISSING_SIGNING_TEAM`、`MISSING_APPLICATION_IDENTIFIER`、`MISSING_KEYCHAIN_ACCESS_GROUP`。登录首屏不代表安全存储写入、重启读回或真实设备签名可用。须用有效团队签名重新构建并完成该预检与设备复验。
- iOS 26.5 / iPhone 17 模拟器已启动，命令行可截取当前源码包的登录首屏；但本机桌面操作接口仍报告 Mac 锁屏，不能完成 **iOS** 的练习、生活活动、断网和升级后的交互验收。Android 本批已验证上述练习到生活活动路径，但没有重做完整断网、音频中断、低存储及真机矩阵；此前较早 iOS 签名包的练习证据不能替代本包验收。
- 生活迁移效果、内容的专业审核、各地区监护与儿童权利流程、真机设备矩阵均不在这次工程验收范围内，正式家庭发布门槛继续关闭。
