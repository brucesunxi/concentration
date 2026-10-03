# 本地家庭运行接口 v0.37

适用实现：`apps/api/main.ts`、`packages/contracts/index.ts`。默认根地址为 `http://127.0.0.1:4181/api`；前端 4180 通过同源代理访问。此文件描述已经接通的开发接口；正式 `/v1` OpenAPI 草案仍待对齐。

工作台使用独立来源的 `/api/studio`；身份、编辑与发布见 [内容工作台](CONTENT-STUDIO.md)，本批试玩与回执接口见 [候选试玩](CANDIDATE-PREVIEW.md)。下列约定适用于家庭接口。

## 请求约定

新建账号和新密码最少 15 个 Unicode 码点、最多 128 个 UTF-16 单元；旧密码登录保持原值兼容。账号操作须再次输入当前密码，登录与确认共享持久化失败限制（8 次/15 分钟）。所有家庭业务在执行事务内重新验证凭据，撤销后的旧身份优先返回 UNAUTHENTICATED。完整边界见 [账号管理](ACCOUNT-SECURITY.md)。

- Web 写操作带 `Content-Type: application/json` 和获准的本机 `Origin`。
- Web 除建立家庭、登录和接受邀请外，需 HttpOnly / SameSite=Strict 会话 Cookie。写操作另需 `/me` 或身份响应中的 `csrf`，置于 `X-CSRF-Token`。
- 原生开发端带 `X-Focus-Client: native-local-v1`，使用 `Authorization: Bearer …`；不得带 Origin 或 Cookie。建立家庭、登录、接受邀请、进入孩子空间和进入儿童练习时返回 `accessToken`，不设置 Cookie。服务端绑定会话传输方式，Web/原生令牌不可互用。原生退出不清除 Web Cookie。此机制仍只服务本机开发，不是正式 OIDC。
- 登录后为 parent 作用域；开始练习或单独进入孩子空间会撤销当前会话并设置 child 会话。child 仅能访问绑定孩子及其会话，不能读取家长报告或修改家庭。
- 家长移除生活回顾答案、导出、停止采集和删除需要最近 10 分钟内完成的家长验证。
- 最大 JSON 请求体 256 KiB；单批最多 100 个事件；每个会话事件序号最多 3000。
- `code` 为机器错误码，`message` 为显示信息，`requestId` 可用于排查。当前错误文案仍主要为中文。
- 不接收客户端正确率或成绩字段；结果只能由事件与冻结计划重算。

## 成员权限补充

待确认账号只读自己的成员状态，不返回孩子名称或 ID。已确认协作家长仅访问邀请范围内的孩子；不能添加孩子、导出/删除/停止采集、修改安排、接管另一设备、管理成员或在家长作用域读取/修改生活目标。孩子模式沿用原行为，不证明实际操作者身份。

成员确认/撤销需要强版本标签 `If-Match: "1"`；重复邀请标识返回 `INVITE_ALREADY_CREATED`，不恢复秘密。协作账号密码和失败计数独立，其全部退出只影响该成员签发的家长及孩子凭据；创建者保留全家庭退出。迁移 20–24 和完整权限矩阵见 [家长协作](FAMILY-MEMBERS.md)。

## 历史记录翻页

`GET /children/:id/report` 接收独立可选的 `sessionsCursor` / `observationsCursor`，均为上次响应提供的位置。重复/未知参数、空值及超长值被拒绝；跨孩子或集合的位置返回 `INVALID_HISTORY_CURSOR`。响应保留原字段并新增 `history.version=family-history-1`、`pageSize=50` 及两类 `nextCursor`（末页为 null）。每次请求重新验证家长和成员范围。排序、精度、兼容与一致性边界见 [家庭历史设计](FAMILY-HISTORY.md)。

## 路由

| 方法与路径 | 请求/作用 | 响应概要 |
|---|---|---|
| `GET /health` | 无登录 | 本地模式、版本、状态、releaseScopeVersion |
| `GET /ready` | 无登录；实际查询数据库 | 数据库可达且迁移版本匹配时 200；否则固定 503 / DATABASE_NOT_READY，不输出连接信息 |
| `POST /auth/setup` | name、password、timezone、locale、residenceCountry、registrationPlatform、acknowledgedLocalUse=true；本地预览仅接受 ZZ | 会话 Cookie、csrf；未开放返回 MARKET_NOT_OPEN |
| `POST /auth/login` | name、password、可选 memberLogin（省略为 owner） | 家长 Cookie、csrf |
| `POST /auth/join` | code、loginName、displayName、password、acknowledgedLocalUse=true | 独立待确认账号的 Web Cookie/csrf 或原生 accessToken |
| `GET /family/members` | 家长作用域 | family-members-1、familyId、viewerId、canManage、成员与邀请列表；协作账号仅自己 |
| `POST /family/invitations` | 创建者最近验证；childIds、acknowledged=true；Idempotency-Key | 201：id、仅显示一次的 code、expiresAt |
| `POST /family/invitations/:id` | 创建者最近验证；acknowledged=true | 取消尚未接受的邀请，ok |
| `POST /family/members/:id` | 创建者最近验证；action=approve/revoke、acknowledged=true；If-Match | ok；原子更新成员和撤销凭据 |
| `POST /auth/logout` | 撤销当前会话 | ok，并清除 Cookie |
| `GET /account/security` | 有效家长身份 | 契约版本、familyId、密码更新时间、家长/孩子及 Web/App 有效凭据数量 |
| `POST /auth/change-password` | currentPassword、newPassword、acknowledged=true | ok、signInRequired；创建者撤销全家庭登录，协作账号仅撤销自己的登录；Web 清除 Cookie |
| `POST /auth/logout-all` | currentPassword、acknowledged=true | ok、signInRequired；密码不变，按同一成员规则撤销登录 |
| `GET /me` | 当前家庭和允许访问的档案 | family（含 residenceCountry）、role、children、csrf、mode、policyVersion、releaseScopeVersion；每个孩子含 `collectionStatus`。本地模式的 consentActive 需同时满足档案开关与有效本地确认，verifiedGuardianConsent=false；注入批准矩阵的内部测试改为核对当前正式许可 |
| `POST /children` | alias、ageBand、locale、localConfirmation=true | 新档案；家庭最多 3 个；未开放组合返回 MARKET_NOT_OPEN |
| `POST /children/:id/enter` | 家长作用域，请求 {}；不开始练习 | 档案、儿童 Cookie/csrf 或原生 accessToken |
| `GET /children/:id/practice-limits` | 家长或本人孩子作用域，只读 | practice-limits-1、日期/时区、当前/待生效上限、版本、已确认/预留/可用额度 |
| `PATCH /children/:id/practice-limits` | 最近家长验证；minutes、effectiveDay、acknowledged=true；If-Match | 新快照；下一家庭日生效，版本/日期冲突拒绝 |
| `GET /children/:id/parent-guide` | 所属家庭的家长作用域，只读 | parent-guide-2-preview、当前签名内容的分龄双语章节、content 元数据、课程进度与采集状态；不可用时不返回正文，no-store |
| `GET /children/:id/life-goals/history` | 可选 cursor；创建者家长或绑定孩子作用域 | 当前目标加最多 20 个已结束目标；history.version=life-history-1、pageSize=20、nextCursor；no-store |
| `GET /children/:id/life-goals` | 当前档案作用域 | 分龄模板、最多 20 个目标（含当前目标）、总数、采集状态、sharingPolicy；新增 contentPolicy、content、releases |
| `POST /children/:id/life-goals` | intent、templateId、support、contentHash；Idempotency-Key | goal、replayed；家长 suggest / 孩子 choose |
| `PATCH /children/:id/life-goals/:goalId` | action、对应字段；Idempotency-Key 和 If-Match | 当前 goal、replayed；冲突不覆盖 |
| `POST /children/:id/sessions` | task、deviceId、environment、practiceReview；另带 Idempotency-Key | 准入和安排快照复核后返回冻结计划、剩余任务预算、continuation_grant、绑定设备的儿童 Cookie/csrf 或原生 accessToken |
| `POST /children/:id/recovery` | 家长作用域，deviceId | 当前练习快照、最近 20 份独立历史、marketOpen、逐会话 mayResume 和未分配额度 |
| `POST /children/:id/recovery/:sessionId/handover` | 最近家长验证、deviceId、acknowledged=true；If-Match 和 Idempotency-Key | 结束旧课程资格，保存交接来源；回执丢失可重试 |
| `POST /children/:id/recovery/:sessionId/resume` | 最近家长验证，原 deviceId | 原安装/传输恢复，原子切换为孩子凭据，不延长授权 |
| `GET /session-authorities` | 已登录 | 本地会话授权的公开验证身份，no-store |
| `GET /sessions/:id/status` | 绑定设备的儿童作用域 | id、state、canContinue、historyOnly、grantHash、serverTime；检查内容/撤回/补传期限 |
| `GET /content/trust` | 已登录 | 本地模式及受信公钥，无私钥 |
| `GET /content/releases/:sha256` | 已登录 | 未召回且在有效期内的签名发布包；不可用返回 409 |
| `GET /sessions/active` | 儿童作用域；新授权需匹配安装标识 | 当前活动会话和服务器已有事件，或 null |
| `POST /sessions/:id/events` | events 数组 | 接收/重复标识、highestContiguousSeq |
| `POST /sessions/:id/finalize` | lastSeq | 服务端重算的结果与难度决定 |
| `GET /children/:id/report` | 家长作用域 | 最近 50 条会话、最近 50 条观察、累计观察数、档案 |
| `GET /children/:id/weekly` | 家长作用域；可选 weekStart 查询参数 | 按家庭时区的周回顾、同条件分组、生活观察及数据缺口 |
| `POST /children/:id/observations` | task、context、prompts、childChoice；另带 Idempotency-Key | 新观察标识，或同内容重试的既有标识 |
| `GET /children/:id/export` | 最近家长验证 | schemaVersion=2、档案、练习安排、全部会话及上限快照/准入矩阵身份/事件/观察、本地确认、脱敏正式许可历史及生活目标/动作记录 |
| `POST /children/:id/withdraw` | 最近家长验证 | 停止采集、撤销孩子会话、拒绝旧补传 |
| `DELETE /children/:id` | 最近家长验证 | 删除档案及关联数据库记录 |

`task`：search / stop / memory / sustain；`ageBand`：6-8 / 9-11 / 12-14 / 15-17；`locale`：zh-CN / en。设备标识为随机 UUID，不是硬件指纹。观察 context 为 packing / tidying / reading / project，提醒次数为 0–20。

`practiceReview` 版本为 `practice-start-review-1`，包含 `day`、`settingsVersion`、`ageBand`、`locale`、`currentMinutes`、`confirmedMs`、`reservedMs`、`availableMs`。两端从最新安排响应生成，语言取已选孩子的练习语言。在批准矩阵模式的新会话中必需，缺失返回 `428 PRACTICE_REVIEW_REQUIRED`；仅开发预览兼容缺失字段的旧客户端。创建时任一字段与服务端当前状态不符，返回 `409 PRACTICE_PLAN_CHANGED`，不新建会话或旋转凭据。同一幂等键需保留完整原请求；改变快照重用旧键返回 `IDEMPOTENCY_CONFLICT`。已准备会话的原样重试或匹配活动会话恢复不使用新快照改写原授权。这不是监护或孩子身份凭证。

`residenceCountry` 是两位大写国家代码；缺省兼容旧本地客户端并记为虚构 `ZZ`。正式市场清单绝不批准 `ZZ`。原生注册在批准矩阵模式必须提供 `registrationPlatform=ios/android`；Web 注册只能提供 `web`。当前本地服务仅使用开发适配器，详见 [准入契约](RELEASE-SCOPE.md)。

本地确认仅允许开发试玩，不构成可验证监护同意。记录缺失、目的或版本不符、确认时间在未来、已经撤回，均使 `consentActive=false`；练习创建、事件补传、观察和生活目标写入返回 `CONSENT_REVOKED`。已有历史、导出、停止采集和删除仍可操作。`collectionStatus` 取值为 `local-preview-enabled`、`local-preview-required`、`guardian-verified`、`guardian-verification-required`、`collection-withdrawn`，解释服务端当前决定，不能代替后续写入时的再次检查。批准矩阵已接入正式许可证据判断，但当前 HTTP 不提供核验入口，正式运行入口仍关闭；见[监护核验工程边界](GUARDIAN-CONSENT.md)。

`environment` 必须包含 `platform`（web/ios/android）、`deviceClass`（desktop/tablet/phone）、`input`（pointer/touch/keyboard）和 `modality`（当前仅 visual）。Web 客户端示例为 `{"platform":"web","deviceClass":"desktop","input":"pointer","modality":"visual"}`；原生客户端使用 ios/android 和 touch。原生请求不能自称 web，Web 请求不能自称 ios/android，否则返回 ENVIRONMENT_TRANSPORT_MISMATCH。

`/content-assets/:sha256.png` 和 `.mp3` 是不含家庭数据的公共素材，仅在有效内容包引用它们时返回登记的不可变字节；在线响应使用 `no-store`，以便召回生效。发布包与公钥接口不缓存。当前六个既有中文儿童组合继续使用 0.7.2-preview，新增固定语音的 26 个组合使用 0.7.3-preview；0.3.0-preview 原始素材仍保留；中间版本 0.7.0-preview 和 0.7.1-preview 的记忆内容因图片与蓝莓名称不一致已召回，但制作证据继续保留。网页装饰 WebP 是静态构建资源，不作为任务素材。客户端仍必须核对素材摘要，详见 [内容与协议实现](PROTOCOL-CONTENT.md)。

## 练习与休息

`GET /children/:id/practice-limits` 只读本人可见安排，返回当前上限、分龄最大值、待生效安排和设置版本。PATCH 必须提供带双引号的数字 If-Match，以及读取到的 nextDay 作为 effectiveDay；不支持自动忽略冲突。分钟为整数 0–分龄上限，0 表示暂停新练习，所有修改次一家庭日生效。未提供版本返回 428；并发修改或跨日表单返回 409；最近家长验证仍为 10 分钟。

新会话按当前有效上限减去当日已确认与预留时间签发授权，并保存 daily_limit_snapshot。设置不改变已签发授权，不清除待补传记录；回执不明时必须重新读取。导出包括 practiceLimits（省略重复 generatedAt）及逐会话快照，保留顶层 exportedAt。详细字段、错误与迁移见 [安排设计](PRACTICE-LIMITS.md)。

## 事件与提交

所有事件含随机 UUID `id`、从 1 开始的 `seq`、当前会话单调相对时间 `at`（毫秒）。

| type | 附加字段 | 含义 |
|---|---|---|
| present | trialId、presentation | 按顺序呈现；新版含 frameDeltaMs、assetsReady、method |
| choose | index、input | 真实选择及输入方式；搜索可切换，记忆按序追加 |
| undo | 无 | 撤回最近一次记忆选择 |
| encode_end | 无 | 隐藏记忆材料，进入回忆 |
| help | 无 | 标记使用帮助；记忆重新展示并清空当前选择 |
| submit | 无 | 提交当前题；新版有无响应均等待完整计时窗口 |
| interrupt | reason | background / pause / asset_failure / reload / render_failure / timer_late / input_changed；当前题不评分，恢复后重做 |
| end | reason | completed / child_stopped / time_limit；完整结束必须完成全部计划 |

客户端先把事件保存到 IndexedDB（Web）或 SQLCipher 日志（原生），再发送服务端；服务端对孩子和会话加事务锁。同 seq/id 相同内容可重传，冲突内容返回 409，不能覆盖。乱序到达的事件可先保存，但只有连续前缀通过协议回放后才确认；finalize 必须完整连续且包含 end。重复 finalize 返回既有结果，不会二次推进课程或累计时长。

新版的 `presentation` 和 `input` 在回放时必需；结构解析仍允许旧事件缺省，以便恢复旧会话。`method` 在 Web 是 raf-pair，原生使用 native-frame，但当前实现仍是 JS 相邻动画帧近似信号，未完成物理呈现校准。结果含 engineVersion、policyVersion、environment、content 和 invalidations；技术排除单独保存，不进入独立正确率分母。

创建请求的 Idempotency-Key 与规范化请求内容绑定。已有同设备活动会话可恢复；另一设备收到 SESSION_CONFLICT，可由家长在恢复入口阅读当前状态并确认结束旧课程资格，不能静默接管。停止采集的校验先于事件去重，不能以“这是重试”绕过撤回。

生活观察也必须提供 16–128 字符的 `Idempotency-Key`，按档案隔离。相同标识和规范化内容返回原 id；相同标识、不同内容返回 `IDEMPOTENCY_CONFLICT`（409）。权限与采集状态检查先于去重。客户端在一份观察尚未收到成功回执时复用该标识；已确认保存后开始另一份观察才换新标识。缺少标识被拒绝，不降级为可能重复写入。详见 [家长资料设计](PARENT-DATA.md)。

## 续练授权与补传

v0.22 新会话的 `continuation_grant.body.version=2`，增加签名 `windowPolicy`（practice-window-1、maxElapsedMs、checkInAfterMs）。四年龄总期限 20/25/30/30 分钟，与内容到期和下一家庭日取最早值；旧 version=1 授权继续按原正文处理，恢复不升级或延长。导出的公开 authorization 增加 version/windowPolicy，无新增数据库列。详见 [单次期限设计](PRACTICE-WINDOW.md)。

新会话的 `continuation_grant` 绑定完整计划摘要、孩子、安装标识、传输方式、预算与期限，使用独立 P-256 密钥签名。创建会话、生成绑定设备的孩子凭据、撤销旧凭据在同一事务内完成，凭据失败不会留下孤立练习。单独 `enter` 取得的未绑定孩子凭据不能访问新授权练习。

`recordUntil` 取签发后 24 小时、家庭当天结束与内容到期三者最早值；`uploadUntil` 为签发后 7 天。前者限制客户端新动作，后者限制服务接受补传；服务不能仅凭签名证明自报事件的实际发生时间。恢复与重试返回原授权，不能延长期限。

权限/撤回/内容检查先于去重；安装标识或传输不符返回 `SESSION_DEVICE_MISMATCH`（403），补传到期返回 `SESSION_UPLOAD_EXPIRED`（409）。过期活动会话在后续有效的新建请求中标记 aborted / upload_expired 并保守占用原预算，不生成结果；旧请求不能复活。服务端导出增加公开授权摘要和 closed_reason，不输出安装标识或完整授权。

历史无授权会话保持原契约。当前只支持已经在线准备的练习暂时断网，不支持离线冷启动；完整语义、时钟边界和迁移见 [离线续练授权](CONTINUATION-AUTHORIZATION.md)。


## 生活目标历史

新接口的 cursor 只表示位置，不提供访问权限；每次请求重新验证创建者或绑定孩子身份，协作家长在家长作用域仍被拒绝。按数据库 UTC 微秒时间及 UUID 排序；旧接口保留原最多 20 条契约。新增、关闭后回到最新页；移除旧答案后保持页码。完整错误、实时一致性及后台刷新边界见 [家庭生活目标](FAMILY-LIFE.md)。

## 换设备后的历史记录

家长确认将旧会话标记为 aborted / device_handover，暂占原预算。原安装可在原补传期限内恢复和提交完整日志；finalize 产生 historyOnly=true 的独立历史结果，不推进课程、增加完成次数或修改难度。完整结束确认后按有效时长结算，释放未用额度；未确认时不提前释放。周回顾分开说明来源并抑制涉及交接记录的差值。恢复、确认、数据撤回和新建都锁定档案；If-Match 防止覆盖确认前刚上传的数据。详见 [换设备与恢复设计](DEVICE-RECOVERY.md)。

## 周回顾

`weekly?weekStart=YYYY-MM-DD` 指定最近 52 周内的周一；省略时取家庭时区的本周。非法日期、非周一、未来周和超范围返回 `INVALID_REPORT_WEEK`（400），重复或未知参数返回 `INVALID_REQUEST`。按服务确认日期归周，观察按保存日期归周；离线补传可能归入较晚一周。

响应包含 schemaVersion、ruleVersion、childId、generatedAt、timezone、range、coverage、days、strategies、groups 和 life；group 携带结构化比较条件、两周分母与比较状态。进行中、缺元数据、帮助/中断、已知缺失或样本不足时 changePoints 为 null。详细语义见 [周回顾规则](WEEKLY-REVIEW.md)。

只读取已确认结果，未结束会话单独计数；没有继承旧 report 的 50 条上限。事务锁定档案生成一致快照；最多扫描各 5000 条会话/观察，超过返回 `REPORT_RANGE_TOO_LARGE`（413），不悄悄截断。响应不可缓存，停止采集后仍可读取历史，删除后返回 404。

## 家庭生活目标

单独 enter 会在一个事务内验证有效家长会话、生成孩子凭据并撤销家长凭据；不创建练习。目标创建的 intent 与真实作用域必须匹配；动作 accept / decline / reflect 只允许孩子作用域，stop 允许两者。日志作用域不证明屏幕前身份。

每份档案最多一个 proposed / active 目标。PATCH 必须带 `If-Match: "1"` 形式的当前版本；缺少返回 428，格式错误 400，版本或状态不符 409。动作重试返回目标当前状态，不退回旧回执快照；权限和采集状态优先于去重。模板创建时冻结，回顾不进入练习分数或课程进度。详细请求、状态机、帮助/回顾取值见 [家庭生活目标](FAMILY-LIFE.md)。

停止采集同时关闭开放目标并追加原因；导出包含全部目标与动作，但不含内部去重字段；删除档案级联删除二者。客户端保存确认后读取最新列表，写成功而刷新失败时分别反馈，页面离开后的晚到回执不再更新视图。当前为在线流程，没有新增离线队列。

## 内部素材接口

工作台独立来源新增 PNG/MP3 二进制导入、来源/使用权声明与草稿换用，详见 [素材库接口](MEDIA-LIBRARY.md)。这些接口不接受家庭账号；家庭仍只从签名内容清单读取对应交付文件。新增媒体字节须有 active 的发布引用才可从家庭媒体路由获取，已有内置公共素材保持原访问方式。原件没有 HTTP 下载入口。工作台迁移 11–14 分别保存身份/编辑/审核、写锁、候选试玩、媒体对象与导入记录。

## 安全与迁移边界

迁移 18 新增密码更新时间、失败计数和冷却，以及有效凭据查询索引。独立 PostgreSQL 须停全部旧 API 并重新准备当前 schema 26 及迁移表只读授权；不能混用缺少执行身份核验、练习上限、成员权限或本地确认只读策略的旧实例。

本机会话 Cookie 尚不带 Secure，因为只在 loopback HTTP 开发模式使用；正式发布必须接入 HTTPS 和正式身份体系。密码采用加盐 scrypt，数据库保存会话令牌摘要。PostgreSQL 已增加受限角色与家庭 RLS，见 [数据库运行交接](POSTGRESQL.md)。CSRF、来源限制、对象权限与 RLS 不替代生产 OIDC、可验证监护同意、限流/防滥用及安全审计。

迁移版本 1 创建家庭、档案、会话、事件、观察与开发确认；版本 2 增加独立 `course_units` 并从实际完成会话回填；版本 3 增加受信公钥、不可变发布清单及内容审计表；版本 4 增加身份传输绑定，既有会话默认归入 Web；版本 5 增加生活观察幂等索引；版本 6 增加周回顾所需的会话报告时间和观察时间索引，保留旧结果；版本 7 新增生活目标、动作表、单个开放目标和请求去重约束；版本 8 增加会话签名身份、continuation_grant 和认证 device_id；版本 9 增加会话 closed_reason，保留永久关闭原因；版本 10 新增 session_handovers，保存确认、请求去重和目标安装绑定，档案/会话删除时级联清除。仅推荐任务完整完成才推进课程，其他完整练习仍计入累计次数。完整基础课程为 24 个单元。

服务端导出不包含密码摘要、认证令牌、CSRF、请求幂等标识或设备标识。原生另附本设备的恢复日志，不能将它与服务端事件直接相加。删除范围为本地家庭数据库及发起操作的客户端缓存；原生清理会保留随机档案标识的加密阻止标记以拒绝晚到写入，并单独报告本机清理失败。其他离线设备尚不具备即时撤回；生产对象存储、备份、审计和供应商链路尚待建设。

## 生活回顾分享契约

读取必须返回 `sharingPolicy=reflection-sharing-1`。回顾请求显式指定 `sharing=none`（不得含 reflection）或 `sharing=family`（必须含三项答案）；省略 sharing 返回 428。`action=unshare` 原子移除目标及动作记录中的答案和答案摘要，保留目标及结束状态；家长需要最近验证，停止采集后仍允许家长减少保存信息。旧分享重试不能恢复答案。字段、迁移和发布顺序见 [自主分享设计](REFLECTION-SHARING.md)。

## 家庭网页版本文件

默认读取 `dist/web-releases/current.json`，可用 FOCUS_WEB_RELEASE_DIR 指定隔离版本库。仅公开首页、离线脚本/清单/预算及登记的哈希资源；私有构建清单、隐藏文件、版本库目录与未知文件返回 404。首页与运行脚本 no-store，哈希资源 immutable；损坏的发布文件返回 503 WEB_RELEASE_UNAVAILABLE，不静默换成旧代码。响应 X-Focus-Web-Release 标识实际字节所属版本。GET/HEAD 与既有 CSP 等安全头仍保留；API、固定语音和签名内容路由分别处理。见 [发布设计](WEB-RELEASE.md)。

## 家长陪伴课程

`GET /children/:id/parent-guide` 不新增阅读记录或目标，保留停止采集后所属家长的只读访问。推荐来自服务端 `course_units`，不采用客户端提供的阶段。客户端只接受 `parent-guide-1-preview` 和 `unreviewed`，错误或身份变化后清除旧快照。打开生活建议仅在界面预选，实际写入仍由生活目标接口授权与确认。详见 [家长课程设计](PARENT-GUIDE.md)。

### 家庭内容版本约束

v0.24 新目标必须携带本次读取的 `contentHash`。缺失返回 428 `FAMILY_CONTENT_UPDATE_REQUIRED`，过时返回 409 `FAMILY_CONTENT_CHANGED`。目标保存 `contentHash` 和模板快照，接受/回顾检查该版本；召回/到期不阻断停止或撤回答案。旧 `contentHash=null` 不被回填为新版批准。完整工作台接口、签名与迁移 25 见 [家庭内容发布](FAMILY-CONTENT.md)。
