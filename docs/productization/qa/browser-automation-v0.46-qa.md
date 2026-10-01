# 家庭流程可重复浏览器验收

2026-10-02。将此前的人工脚本固定为 `npm run test:browser`，并在 GitHub 的 `Family quality` 工作流中加入相同的检查。本机使用 Chrome 154 与 Playwright Python 1.47.0 跑通；云端 [运行 36908039325](https://github.com/brucesunxi/concentration/actions/runs/36908039325) 已通过。

本机复验：浏览器两项断言通过；`npm test` 324/324、`npm run test:http` 18/18，脚本语法及工作流 YAML 解析通过。

## 覆盖范围

脚本先构建 Vercel Web 产物，然后启动独立本机家庭服务与临时数据库。它用虚构资料创建英文 6–8 岁家庭和孩子，验证孩子自主选择，实际做完两道示范和一道正式搜索题，主动结束，等待服务端核对，检查同日再次邀请的休息提示及服务端确认用时。另用 390px 手机视口检查入口横向溢出。运行后关闭服务并删除临时家庭数据；不使用 Neon、线上账号或真实儿童资料。失败时截图保存在 `dist/browser-qa/failure.png`。

本机或团队设备安装依赖后运行：

```sh
python3 -m pip install -r scripts/qa/requirements.txt
python3 -m playwright install chromium
npm run test:browser
```

已有系统 Chrome 时可用 `FOCUS_BROWSER_PATH` 指向浏览器可执行文件；Python 不在默认路径时用 `FOCUS_BROWSER_PYTHON` 指定。脚本在启动测试服务前清除继承来的 `FOCUS_*`、`DATABASE_*` 和 `VERCEL*` 环境变量，避免误连线上资源或使用部署密钥。

GitHub 工作流在 Ubuntu 24.04 镜像上使用预装的 Chrome，并安装 FFmpeg；还运行类型检查、324 项业务检查、18 项真实本机 HTTP 检查与浏览器家庭流程。浏览器失败时会上传虚构资料的失败截图。前两轮分别暴露出不必要的浏览器下载和缺少 FFmpeg，第三轮全部通过。它不证明 iOS/Android 原生交互、语音听感、Safari/Firefox、正式数据库权限或真实家庭适龄性，这些仍按发布门槛单独验收。
