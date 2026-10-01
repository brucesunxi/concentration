# 证据、规则与待验证假设

资料核对日期：2026-09-30。以下使用研究原文/摘要、监管机构和官方技术文档。规则可能更新，上线前由负责人再次核查；研究不自动适用于本产品、所有年龄和所有国家。

## 1. 科学依据

| 来源 | 可以支持什么 | 不能据此得出什么 |
|---|---|---|
| [Westwood 等，2023，36 项随机试验元分析](https://pubmed.ncbi.nlm.nih.gov/36977764/) | 计算机认知训练的结果要区分训练领域、症状、评价者与情境；部分记忆结果较好，广泛迁移有限 | 本产品能治疗 ADHD、提高成绩，或所有任务组合都更好 |
| [Ye 等，2026，17 项随机试验元分析](https://pubmed.ncbi.nlm.nih.gov/42110889/) | 部分执行功能与注意相关结果有小幅改善信号，仍需更高质量研究 | 能把小效应夸大为大多数儿童都会明显改变；也不能直接套到普通家庭儿童 |
| [Kollins 等，STARS-ADHD，2020 随机对照试验](https://pubmed.ncbi.nlm.nih.gov/33334505/) | 特定数字训练可以通过预设指标与主动对照研究；其样本、版本和评价条件明确 | 已验证另一产品就等于验证本产品；照搬其时长就是正确训练剂量 |
| [Harvard 执行功能适龄活动指南](https://developingchild.harvard.edu/resources/handouts-tools/activities-guide-enhancing-and-practicing-executive-function-skills/) | 活动应按发展阶段设计，并结合共同活动、规则和日常实践 | 这是本产品课程的临床认证或疗效研究 |

2023 与 2026 年元分析的纳入研究、任务与结果不同；本方案采用共同的保守结论：可以尝试结构化练习，但日常功能收益要由本产品自己的研究检验。不能挑选显著结果后忽略无差异或有偏倚的结果。

本方案没有把患有 ADHD 的研究样本等同于所有儿童，也没有提出诊断或治疗建议。医疗产品路线如将来启动，应另设临床、监管、质量体系与预算；本方案的家庭练习版本不能默认承担该用途。

## 2. 未成年人、隐私与渠道规则

| 来源 | 设计中的落点 |
|---|---|
| [FTC COPPA FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions) | 美国儿童服务的通知、可验证监护人同意、访问删除与留存流程；不能用年龄自报页自动免责 |
| [FTC 2025 COPPA 修订公告](https://www.ftc.gov/legal-library/browse/federal-register-notices/16-cfr-part-312-coppa-final-rule-amendments) | 合规审查应使用修订后的要求，不沿用旧产品模板 |
| [EDPB Guidelines 05/2020 on consent](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_202005_consent_en.pdf) | GDPR 第 8 条适用条件与成员国 13–16 岁差异；按处理目的建立依据 |
| [ICO 儿童与 UK GDPR 关键定义](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/children-and-the-uk-gdpr/overview-and-key-definitions/) | 在相关在线服务依赖同意的情形下处理英国 13 岁门槛，不将其推广为所有法律的一般成年线 |
| [ICO Children’s Code](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/) | 儿童最佳利益、默认高隐私、适龄解释、透明的家长控制和数据最小化 |
| [中国个人信息保护法](https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm) | 不满 14 岁儿童个人信息、监护同意、敏感信息处理及相关评估 |
| [儿童个人信息网络保护规定](https://www.cac.gov.cn/2019-08/23/c_1124913903.htm) | 专门儿童规则、责任人、访问与安全管理 |
| [国家新闻出版署关于未成年人网络游戏的通知](https://www.nppa.gov.cn/xxfb/tzgs/202108/t20210830_666285.html) | 判断是否属于适用的网络游戏服务是大陆发布前置事项；教育命名不能替代分类 |
| [工信部 APP 备案通知](https://www.miit.gov.cn/jgsj/xgj/wjfb/art/2023/art_dd783a581c9644a4aee10afa582811db.html) | 中国大陆应用渠道需核对备案与相关接入要求，具体随主体/形态判断 |
| [Apple Kids](https://developer.apple.com/kids/) | 儿童类别年龄、家长操作与商店要求；与青少年体验分开审查 |
| [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) | 儿童内容、数据、购买与订阅按最终上架形态逐项核对 |
| [Google Play Families Policies](https://support.google.com/googleplay/android-developer/answer/9893335?hl=en) | 真实目标年龄申报、儿童 SDK 与数据要求、商业展示方式 |

上表不是全球法律完备清单。加拿大、澳大利亚、巴西、其他国家，以及美国州级隐私/消费者健康数据规则，均需在目标名单确定后单独核对。不开启任何未完成评审的发布组合。

## 3. 工程依据

| 来源 | 应用 |
|---|---|
| [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) | AA 目标、键盘/焦点/对比度等；任务适配仍需单独验证 |
| [PostgreSQL Row Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) | RLS 默认与绕过条件；不使用有绕过权限的应用角色 |
| [MDN 存储配额与清理](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) | 浏览器缓存不是永久存储，尚未同步需明确提示 |
| [MDN Service Worker 使用](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers) | 离线公共内容与客户端更新；私人 API 缓存另行约束 |
| [Azure 文本转语音 REST](https://learn.microsoft.com/zh-cn/azure/ai-services/speech-service/rest-text-to-speech) | 一次性生成固定语音素材，不在儿童运行流程里使用云端实时语音 |

## 4. 假设登记

| 假设 | 验证方法 | 何时决定 |
|---|---|---|
| 6–17 岁适合分四档设计 | 分层访谈、理解和负担观察 | G2，各档单独判断 |
| 每周 3 次、8 周可被家庭接受 | 可行性研究；不把留存当疗效 | G3 |
| 6–12 分钟左右的分龄上限合适 | 记录疲劳、自主结束、完成与负担 | G2/G3 |
| 自适应阈值与样本窗口合理 | 合成行为仿真 + 真实试用轨迹 | G1 后持续校准，研究期冻结 |
| 生活策略安排有价值 | 访谈、执行率及正式研究主要结果 | G3/正式研究 |
| 两种 App 形态合适 | 目标用户体验、渠道规则、维护成本 | W8 前方案确定，提交前复核 |
| 价格区间成立 | 访谈、付费小试点、退款与留存 | W16 后逐步定稿 |
| 32 周可以有限发布 | 团队投入、依赖、门槛与研究进度 | 每四周复核 |
| 容量、SLO 与留存期限够用 | 压测、恢复与删除演练、法务评审 | G4 前 |

建议每季度及每次进入新市场前更新此文档；研究或政策出现重大变化时立即复核受影响设计。这是维护建议，本次没有创建任何自动提醒或定时任务。
