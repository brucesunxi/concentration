# 练习总结到生活活动：Web 验收与 iOS 启动边界

2026-10-02，功能源码提交 `ee369f6`。本批只在已完成至少一个正式步骤、且练习记录已由家庭服务确认时，向孩子提供自愿查看对应生活活动的入口。打开页面只预选分龄模板，不创建目标；孩子仍需自行选择是否保存。

## 已验证

- 本地 353 项测试、Web 与移动端类型检查、Web 构建、iOS/Android Hermes 导出通过。浏览器自动验收实际走通虚构家庭、完成练习、进入对应分龄活动，并读取目标列表确认没有自动创建目标。[GitHub Actions 运行记录](https://github.com/brucesunxi/concentration/actions/runs/36975856614)通过。
- Vercel 受保护预览部署 `dpl_G34rjyuT1otMw96LrdfUam7opZ8P` 已就绪，绑定 `concentration-two.vercel.app`。部署后用虚构资料完成家庭建立、内容与素材验签、练习、报告读取、家庭删除及旧会话失效检查；脚本返回各项 `true`。
- 从当前源码制作不含家庭数据的独立 iOS 构建，锁定的 95 个 Pod 安装成功，iPhone 17 / iOS 26.5 的 Release 构建、同标识覆盖安装和启动通过。Hermes `main.jsbundle` SHA-256 为 `095ec9b7793723c033e471ed1ce33ece2e340d8b67a05f8ce5dd314336b35b62`，包含新增入口文本。[启动画面](ios-practice-life-ee369f6.png)显示成人开发验收登录页。

## 尚未通过的门槛

- 这份本机模拟器包的代码签名文件校验通过，但 Keychain 预检返回 `MISSING_SIGNING_TEAM`、`MISSING_APPLICATION_IDENTIFIER`、`MISSING_KEYCHAIN_ACCESS_GROUP`。登录首屏不代表安全存储写入、重启读回或真实设备签名可用。须用有效团队签名重新构建并完成该预检与设备复验。
- 本机桌面操作接口仍报告 Mac 锁屏，因此不能操作模拟器完成当前源码的练习、生活活动、断网和升级后的交互验收。此前较早本机签名包的练习证据不能替代本包验收。
- 生活迁移效果、内容的专业审核、各地区监护与儿童权利流程、真机设备矩阵均不在这次工程验收范围内，正式家庭发布门槛继续关闭。
