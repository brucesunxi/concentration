# 正式步骤与当天休息提示浏览器验收

2026-10-02。基线提交 `9bc123b`；修复英文单复数后重新构建。使用隔离的本机数据目录、`APP_MODE=local`、打包后的 Web 页面和 Chrome 154，无真实儿童资料，也未连接线上 Neon。

## 走通的路径

1. 虚构英文 6–8 岁家庭建档，孩子从自主选择页进入搜索任务。
2. 实际在浏览器中完成两道示范题与一道正式题，选择「Take a break」及「That is enough for today」。服务核对并保存正式步骤后，结束页正确显示 [“You completed 1 independent step.”](browser-one-step-v0.46.png)。
3. 返回家庭首页，再次选择练习。邀请页提示孩子今天已经练过，可以离开屏幕，在生活里试刚才的策略，不必用完剩余额度；孩子仍保有选择权。

首次运行曾在同步进行中立即点击「Take a break, sync later」；随后重新登录，服务端仍有已核对的正式记录，再次邀请显示当天提醒。复验时等到「Your record has been checked and saved for your family」后再退出，获得同样提醒。此观察只覆盖本次本地流程，不代替断网补传矩阵。

## 修复与验证

- Web 的单个正式步骤使用英文单数 `step`；原生总结中的正式步骤和受帮助步骤各自按数量选择 `step/steps`。
- `npm run check`、`npm run mobile:check`、`npm run build:vercel`、`npm run mobile:bundle` 通过。Web 入口体积 1,463,621 / 1,500,000 字节；iOS 与 Android 运行代码导出成功。

## 仍需验证

这不是整轮练习完成、真实手机触摸、原生运行、音频播放、断网恢复或线上环境验收。内容适龄性和儿童对提示的理解仍需专业审核与家庭研究。
