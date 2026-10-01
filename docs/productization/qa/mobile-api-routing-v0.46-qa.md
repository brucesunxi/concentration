# 原生远端 API 路由验收

2026-10-02，平台 v0.46.0。目标是使测试手机包能明确绑定获准的 HTTPS 服务，并防止错误地址或明文远端连接进入安装包；此批不开放真实家庭或正式生产模式。

## 行为

- 未配置时仍连模拟器/端口转发使用的 `http://localhost:4181`。公开构建变量 `EXPO_PUBLIC_FOCUS_API_ORIGIN` 可指定 HTTPS 根地址；请求和签名素材沿用同一根地址。
- 地址只允许根路径，不接受内嵌用户名、密码、查询或片段；远端 HTTP 在配置阶段失败。`APP_MODE=production` 的原有启动门槛保持关闭。
- 远端 HTTPS 包将 Android `usesCleartextTraffic` 与 iOS `NSAllowsLocalNetworking` 明确设为 `false`；回环地址 HTTP 的开发包保留本机连接许可。

## 工程验证

- 地址解析测试覆盖默认地址、HTTPS、回环地址和非法输入；Web 与原生 TypeScript 检查通过，完整业务回归 328/328。
- 用不指向真实服务的 `https://family.example.test` 导出 iOS/Android Hermes 运行包，两个包都包含该公开域名；构建变量不包含密钥。用远端 HTTP 执行 Expo 配置被 `MOBILE_API_ORIGIN_HTTPS_REQUIRED` 拒绝。
- 在隔离的预生成原生工程中核对远端设置：Android manifest 为 `android:usesCleartextTraffic="false"`，iOS Info.plist 的 `NSAllowsLocalNetworking` 为 `false`。本机默认配置仍保留相应本地连接许可。
- `APP_MODE=production` 加远端地址仍被现有发布门槛拒绝，不会因这项连接配置自动开放市场。
- 使用提交 `0863142` 的独立源码副本，iOS 26.5 / iPhone 17e arm64 Release 整包编译成功，本地签名严格校验通过，安装并启动后显示[正常的中文家长登录首屏](mobile-api-routing-ios-v0.46.png)。内置 `main.jsbundle` SHA-256 为 `855e8f9ca4fdff8f655a22015dcca225adb4ba68fe2b359ad9138302ff5f4356`。本机可复查的模拟器包与源码清单保留在被忽略的 `dist/mobile-native/v0.46/ios-simulator/`；它不是商店包。

## 仍需完成

没有真实的获准手机测试服务，也未在真机验证 TLS、登录、固定语音和断网恢复。受 Vercel Authentication 保护的当前网页预览不能直接充当原生登录服务；不得把它的访问凭据写入 App。区域路由、正式身份与监护许可、生产发布审批仍按各自门槛完成。
