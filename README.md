# 专注岛 · 家庭成长空间

面向全球 6–17 岁家庭的注意相关技能练习产品。当前为 **v0.46 内部预览版**；Web、原生 App 和内容工作台持续按[产品化方案](docs/productization/README.md)实现，尚未开放真实家庭试用或商业服务。

Vercel + Neon 内部预览地址：[concentration-two.vercel.app](https://concentration-two.vercel.app/)（需登录有权限的 Vercel 账号）。部署受 Vercel Authentication 保护；所有者数据库凭据不在 Vercel 运行环境。部署结构和开放前条件见 [Vercel + Neon 说明](docs/productization/VERCEL-NEON.md)。

v0.44 调整两端常用点击区域：主按钮至少 56 像素，次要按钮、图标按钮和折叠记录入口至少 48 像素；网页小屏规则也覆盖这些尺寸。[Android arm64 本地测试包](dist/mobile-native/v0.44/android/focus-island-v0.44-arm64-local.apk)已构建并做静态核验。长期使用的[年龄档复核与成年转换实施契约](docs/productization/PROFILE-LIFECYCLE.md)明确了旧授权、未同步记录和监护许可的处理边界；实际转换功能仍待实现。详见[本批验收](docs/productization/qa/touch-targets-v0.44-qa.md)。

v0.43 缩小网页两张装饰图的交付体积，保留原画、透明边缘与全部计分用任务图片；首页离线资源从 1,499,746 降至 1,453,786 字节。图片构建现在按清单中明确的编码参数逐字节复核。Android 历史安装包也可直接根据归档源码复核，无须把当前工作目录退回旧版。[新版 Android arm64 本地测试包](dist/mobile-native/v0.43/android/focus-island-v0.43-arm64-local.apk)已完成构建与静态核验，详见[本批验收](docs/productization/qa/web-visual-delivery-v0.43-qa.md)。

v0.42 为 12–17 岁孩子新增双语「我的策略足迹」：孩子作用域只读最近练习的任务、日期、结束状态，并可按每页 20 条翻看旧记录；页面给出下次可自行尝试的策略，不显示总分或排名。家长账号、其他孩子和较小年龄档不能读取这一接口。Web 已用虚构档案走通中英文与已有记录；[Android arm64 本地测试包](dist/mobile-native/v0.42/android/focus-island-v0.42-arm64-local.apk)已完成签名、权限、源码归档及内置页面核验。见[本批验收](docs/productization/qa/teen-strategy-history-v0.42-qa.md)。

v0.41 在孩子首页加入分龄双语的「谁能看到我的记录」说明：区分练习记录、默认不保存的生活回顾答案、主动分享和撤回的实际范围，也如实说明共用设备和已下载副本的限制。Web 已用虚构青少年档案走通中英文界面；[Android arm64 本地测试包](dist/mobile-native/v0.41/android/focus-island-v0.41-arm64-local.apk)已重新构建并核对签名、版本码、源码快照和内置文案。详见[本批验收](docs/productization/qa/child-data-visibility-v0.41-qa.md)。

v0.40 改进原生家庭入口的读屏标题、控件状态和多孩子按钮名称，已编入 [Android arm64 本地测试包](dist/mobile-native/v0.40/android/focus-island-v0.40-arm64-local.apk)。[本批验收](docs/productization/qa/mobile-accessibility-v0.40-qa.md)说明已验证的代码与构建范围；限时视觉任务的读屏适用性和设备体验仍需专门验证。

v0.39 将 Android 测试包的版本码从 1 递增到 2，并保持与上版相同的测试签名；iOS 配置的构建号也递增到 2。服务端修复了未使用对象提前初始化数据库的竞态。新版 [Android arm64 本地测试包](dist/mobile-native/v0.39/android/focus-island-v0.39-arm64-local.apk)与[验收记录](docs/productization/qa/native-upgrade-v0.39-qa.md)已交付；覆盖安装和资料保留仍需连接设备验证。

v0.38 在新建练习前加入孩子自主选择：四个年龄段的中英文邀请让孩子决定现在开始或稍后再说。拒绝不会创建练习；确认后才请求服务端，并继续由服务端核查权限。详见[交互契约](docs/productization/CHILD-PARTICIPATION.md)与[本批验收](docs/productization/qa/child-invitation-v0.38-qa.md)。包含本批代码的 [Android arm64 本地测试包](dist/mobile-native/v0.38/android/focus-island-v0.38-arm64-local.apk)已生成并完成静态核验；[安装包验收记录](docs/productization/qa/native-package-v0.38-qa.md)列出设备测试与正式发布的剩余条件。

v0.37 将供应商核验移出家庭数据库事务，在最终写入前重新验证家长身份、孩子状态与开放范围；迟到的核验不能恢复已撤回的采集。Web 和原生源码会明确显示本机试玩、待核验或已停止采集，旧服务缺少状态字段时给出保守提示。完整结果见[本批验收](docs/productization/qa/guardian-flow-v0.37-qa.md)；这些改动现已进入 v0.38 Android 测试包。

v0.36 将本地预览确认与正式监护核验分开：真实市场规则必须绑定告知文本，服务端只接受受信任核验适配器的证明，按用途、孩子和时间检查并可撤回。当前没有真实核验服务或正式同意界面，因此正式市场仍关闭；详见[监护核验工程边界](docs/productization/GUARDIAN-CONSENT.md)与[前批验收](docs/productization/qa/guardian-consent-v0.36-qa.md)。

v0.35 将国家/年龄/语言/平台准入矩阵绑定到练习会话，规则改变后服务器拒绝旧会话继续上传和恢复；家长仍可查看并导出已有记录。293 项业务测试、14 项接口测试和 Web 构建通过；[Android arm64 本地测试 APK](dist/mobile-native/v0.35/android/focus-island-v0.35-arm64-local.apk)已通过签名、权限和内置代码核验，但尚无设备安装测试。完整范围和限制见[本批验收](docs/productization/qa/release-revocation-v0.35-qa.md)。

v0.29 修复原生声音加载失败会中断练习的问题，并为安全存储读取失败提供保留资料的重试入口。iOS 模拟器实际启动暴露出测试包缺 Keychain 权限（系统错误 `-34018`），因此目前不能在该包上验收登录或声音播放；Android 尚无连接设备。283 项业务检查和两平台构建通过，准确范围见 [v0.29 验收](docs/productization/qa/audio-fallback-v0.29-qa.md)。

v0.30 已为四年龄段、两语言、四任务共 32 个组合接入固定语音候选；真人母语听审、适龄审核和真机播放仍未完成，见[语音验收](docs/productization/qa/fixed-audio-v0.30-qa.md)。v0.28 的[缺口清单](docs/productization/qa/content-readiness-v0.28.md)作为历史基线保留。

v0.27 新增 [生活目标历史翻页](docs/productization/FAMILY-LIFE.md)：当前目标保持可见、旧记录每页 20 个、旧页撤回答案及不打断操作的后台刷新。282 项业务与 14 项接口检查通过，独立 PostgreSQL 本批检查未启动。见 [本批验收](docs/productization/qa/life-history-v0.27.md)。iOS 模拟器和 Android 本地安装包见 [交付记录](docs/productization/qa/life-history-v0.27.md#原生安装包)。

v0.26 新增 [家庭历史翻页](docs/productization/FAMILY-HISTORY.md)：练习与观察独立翻页、微秒精度排序、失败保留页码、权限失效清除，以及两端中英文提示。见 [功能验收](docs/productization/qa/history-v0.26.md)。已交付包含本批代码的 [原生安装包](docs/productization/qa/native-package-v0.26.md)，原生界面与设备行为仍待验收。

v0.25 新增 [小屏导航与键盘操作](docs/productization/COMPACT-FAMILY.md)：带文字的四个常用入口、完整菜单、长昵称换行和弹窗焦点管理。中英文及 320–1024px 浏览器视口验收见 [本批记录](docs/productization/qa/compact-family-v0.25.md)；该批未更新原生安装包。

v0.24 新增 [家长指导与生活任务的审核发布](docs/productization/FAMILY-CONTENT.md)：分龄双语版本、三项独立审阅、签名发布与召回；目标绑定创建版本，保留历史和撤回分享。仍为本地开发预览，真实专业内容与商业发布条件未完成。

## 打开本地应用

需要 Node.js 24.14 或更高版本。

```sh
npm ci
npm run dev
```

- 家庭应用：<http://127.0.0.1:4180/>
- 家庭服务：<http://127.0.0.1:4181/api/health>
- 内容工作台：<http://127.0.0.1:4184/>；须先构建并由本机操作人员配置独立管理账号，见 [工作台交接](docs/productization/CONTENT-STUDIO.md)。
- 默认只监听本机，端口固定，避免与旧的 4173/4174 应用混淆。
- 浏览器前端由 Vite 更新，家庭服务由 Node 监测源码变化。

家长建立本地家庭名称和密码后，可以为最多三个孩子选择昵称、年龄段、练习语言。进入练习会锁定家长权限；再次查看记录或资料需要家长密码。创建者登录名为 `owner`；受邀家长使用自己的登录名及密码，批准后仅访问指定孩子。

### 开发验收用的虚构家庭

启动服务后，可执行 `node scripts/seed-local-qa.mjs`，创建两份虚构档案。家庭名称为 `验收家庭020`，密码为 `Local-QA-2026-020!`。这些是公开的本地测试凭据，只用于开发检查，不能用于真实家庭或上线系统。

## 已接通的功能

- React / TypeScript 家庭 Web 客户端；新增 iOS/Android 原生工程，中英文界面、儿童插画与青少年图形主题。
- 四类练习：视觉搜索、Go/No-Go、顺序记忆、短段目标监测。
- 可重放的任务引擎：示范、正式、帮助、中断、提前结束分别记录；服务端重算结果。
- 基于同类任务、有效样本和近期记录的保守难度调整。
- 家庭账号、儿童权限、个人课程、生活观察、家长记录及 JSON 导出。
- 两端家长协作：独立密码、一次性邀请、创建者确认、指定孩子范围及撤销；旧家庭密码和记录保留。见 [成员设计](docs/productization/FAMILY-MEMBERS.md)。
- 两端「账号与登录」：当前登录数量、修改密码与全部退出；执行时复核凭据，撤销后的旧身份不能继续读写。见 [账号设计](docs/productization/ACCOUNT-SECURITY.md)。
- 两端「练习与休息」：家长可安排较短上限或暂停，修改从下一家庭日生效；孩子只读，跨设备共用当天额度。见 [安排设计](docs/productization/PRACTICE-LIMITS.md)。
- PostgreSQL 数据结构、迁移、事务、幂等事件接收、重复/冲突/缺失处理。
- 浏览器 IndexedDB 保存未确认事件；刷新恢复、联网重试、后台中断重做。
- 停止采集、档案删除、最近家长验证、会话撤销与本浏览器缓存清理。
- 第二版协议：固定计时窗口，记录重复响应与技术排除；设备、输入和内容条件分别比较，保留旧记录的原有解释。
- 内容清单、P-256 签名、素材摘要校验、不可变版本和召回。32 个组合均是未审核开发包，不能直接发布给儿童。
- 原生家长记录、生活观察和资料管理；观察重试去重，敏感操作重新验证密码，清理失败可重试，阻止旧日志重新出现。
- 四组重新生成的位图与六个交付文件，网页静态入口资源约 1.480 MB；历史素材保留，更新不替换旧练习条件。
- 两端生活小目标：分龄活动、家长建议、孩子选择、帮助约定与结构化回顾；在线保存、版本冲突保护、完整导出和撤回/删除。
- 两端家长陪伴小课：准备章节与八个主题、四年龄段双语例子、当前课程对应、确认后才保存的生活建议。内容待专业审核，不追踪阅读、不改变成绩。见 [家长课设计](docs/productization/PARENT-GUIDE.md)。
- 两端家长周回顾：家庭时区、最近 52 周、同条件分组、帮助/中断与数据缺口、生活观察；进行中或证据不足时不计算差值。
- 两端换设备恢复：家长核对后结束旧练习，旧设备记录单独补传；完整确认后结算额度，避免重复推进课程。
- 两端练习总期限与休息询问：新授权限制说明/暂停/后台在内的总期限，在安全间隙让孩子选择休息或继续，重开不延长期限。见 [练习期限设计](docs/productization/PRACTICE-WINDOW.md)。
- 新练习的签名续练授权：绑定设备和完整计划，截止不跨家庭日；到期停止新题，保留已记录内容补传。原生与构建后的 Web 均已接入已准备练习的断网恢复入口，重新核验原授权、事件和素材；Web 增加跨页单写入保护和公共运行文件缓存。

- 图片与声音素材库：导入 PNG 四格图集和固定 MP3，保存制作来源、权利声明与文件摘要；换素材开启新稿，完整试玩和双审后才能发布本地预览。见 [素材库交接](docs/productization/MEDIA-LIBRARY.md)。

- 独立内容工作台：编辑、方法审核、语言审核与发布角色；密码加动态验证码、稿件冻结、逐版本双审、签名本地预览与召回。源材料仍待真实专业审核。

自由选择的练习会进入成长记录，只有当前推荐任务的完整练习推进基础课程。完成 24 个课程单元后会显示完成状态，不会重置成未完成。

## 原生 App 开发

```sh
npm run mobile:check
npm run mobile:bundle
npm run mobile:prepare-build
```

已接通原生家庭入口、四类练习、家长资料管理、固定音频、签名内容校验、加密日志适配和已准备练习的断网恢复。**v0.29 本地测试包**保存在 `dist/mobile-native/v0.29/`：两平台均内置当前运行代码，不需要 Metro；在线准备和同步仍依赖本机家庭 API。iOS 已安装到 iPhone 17 / iOS 26.5 模拟器并核对代码摘要及启动画面，但当前包缺 Keychain 权限，登录和练习尚不能验收。Android 使用开发签名，尚无设备安装。两包不能提交商店。详见 [原生设计与构建交接](docs/productization/NATIVE-APP.md) 和 [本批记录](docs/productization/qa/audio-fallback-v0.29-qa.md)。普通运行不需要新的 API Key。

## 数据保存与运行方式

本地模式使用 PGlite（基于 PostgreSQL 的嵌入式运行方式），持久化到 `.focus-data/postgres/`；目录已排除出版本控制。可用 `FOCUS_DATA_DIR` 指向独立开发数据目录。浏览器只持有 HttpOnly 会话 Cookie，未上传事件暂存在 IndexedDB。

独立 PostgreSQL 已接通受限角色、家庭行级隔离和真实并发检查。先通过 `npm run db:prepare` 初始化，再用受限的 `DATABASE_URL` 运行；工作台使用另一份 `FOCUS_STUDIO_DATABASE_URL`。详见 [PostgreSQL 交接](docs/productization/POSTGRESQL.md)。生产负载、备份和故障切换仍待验证。`APP_MODE=production` 当前会拒绝启动，防止把开发确认误当作已完成全球商业准入。

```sh
npm run build
npm start
```

家庭 Web 现在先在独立目录构建，检查通过后切换版本，并保留旧页面引用的文件。默认版本库是 `dist/web-releases`，旧 `dist/web` 只作首次迁移来源，不再原位覆盖；直接运行 Vite 只生成候选。详见 [网页发布与更新](docs/productization/WEB-RELEASE.md)。

构建后可以通过 <http://127.0.0.1:4181/> 查看本机发布包并准备 Web 离线重开。4180 开发入口不安装离线运行文件；请在同一地址开始、恢复和同步。页面新版本下载完成后，关闭本站全部旧标签页再打开，新版本才会生效。详见 [Web 恢复说明](docs/productization/WEB-OFFLINE.md)。`npm start` 仍是本机开发服务，不表示已获生产发布资格。备份开发数据时须先停止服务再复制 `.focus-data/`；这不是正式生产备份方案。

## 固定语音素材

新版运行时只播放事先生成的本地 MP3，不调用实时语音模型、不采集孩子声音，也不使用浏览器合成语音作为自动回退。

目前接入中文儿童版的搜索规则、记忆规则和过桥策略。其余中文台词、英语素材、动态顺序播报及分龄审核仍待补齐。旧的 16 段素材保存在 `src/audio/`；不把“文件存在”当作新协议的完整覆盖。

若以后需要更新固定台词，可使用已有 Azure 制作脚本，密钥只从当前进程环境读取：

```sh
read -s AZURE_SPEECH_KEY
export AZURE_SPEECH_KEY
export AZURE_SPEECH_REGION=eastus
npm run voice:generate:azure
unset AZURE_SPEECH_KEY
```

普通开发、试玩和构建均不需要提供 API Key。脚本不会在浏览器中使用密钥。制作好的文件也可直接通过工作台素材库导入；MP3 技术检查需要本机 FFmpeg（PATH 或 FOCUS_FFMPEG_PATH），既有声音播放不依赖该工具。

## 验证

```sh
npm test
npm run check
npm run build
npm run test:http
npm run test:browser
npm run content:audit
npm run visuals:check
```

`test:http` 会在本机 4192/4195、4197 和 4201/4204 端口启动隔离的家庭与工作台服务，使用临时数据库验证请求保护和重启持久化，结束后清理自己的虚构数据。需要允许本地监听和连接。线上数据库使用 Neon，部署及运行步骤见 [Vercel + Neon 说明](docs/productization/VERCEL-NEON.md)。

`test:browser` 需要 Python Playwright 和 Chromium，安装及验收范围见[浏览器自动验收](docs/productization/qa/browser-automation-v0.46-qa.md)。它会构建网页，并在隔离本机服务中走通虚构家庭的正式步骤与休息提示。

v0.26 完整回归为 271 项业务、13 项真实 HTTP 和 16 项真实 PostgreSQL 检查通过；最终提示位置调整后又执行了历史专项、两端类型、构建和原生运行代码导出。浏览器已检查分页、超时保留与恢复重试，详见 [本批验收](docs/productization/qa/history-v0.26.md)。单次期限、休息询问、旧授权兼容与保存见 [v0.22 验收](docs/productization/qa/practice-window-v0.22.md)。两端练习安排、下一家庭日生效、共享额度和版本冲突见 [v0.21 练习与休息验收](docs/productization/qa/practice-limits-v0.21.md)。两端账号管理、执行身份复核、密码更改和全登录撤销见 [v0.20 账号验收](docs/productization/qa/account-security-v0.20.md)。新增十张表的家庭隔离、受限运行角色、并发与断连恢复，见 [v0.19 数据库验收](docs/productization/qa/postgres-v0.19.md)。新增两端家长陪伴课、分龄双语内容、课程关联和生活建议预选，见 [v0.18 家长课程验收](docs/productization/qa/parent-guide-v0.18.md)。新增独立构建、不可变版本、旧文件保留、并发发布及服务重启验证；浏览器已实际完成旧页面跨版本保存和新版读取，见 [v0.17 网页发布验收](docs/productization/qa/web-release-v0.17.md)。新增生活回顾自主分享、默认不保存答案、历史撤回及兼容保护，见 [v0.16 自主分享验收](docs/productization/qa/reflection-sharing-v0.16.md)。新增素材导入、不可变保存、换稿、访问控制和重启/召回验证；浏览器已完成导入图像和声音后的完整任务，见 [v0.15 素材库验收](docs/productization/qa/media-library-v0.15.md)。新增冻结内容的完整候选试玩，通过决定必须关联本人当前稿的完整记录；详见 [候选试玩验收](docs/productization/qa/candidate-preview-v0.14.md)。内容工作台的编辑、冻结、双角色审核、发布、召回与跨页退出已经用隔离虚构账号在浏览器走通，详见 [v0.13 工作台历史验收](docs/productization/qa/studio-v0.13.md)。已在内置浏览器用中文儿童与英文青少年虚构档案验证服务离线重开、重复页面保护、离线结束与补传；其他浏览器和原生设备验收仍待完成。详见 [v0.12 Web 验收](docs/productization/qa/web-offline-v0.12.md)、[原生构建记录](docs/productization/qa/offline-v0.11.md)、[换设备历史记录](docs/productization/qa/recovery-v0.10.md)、[家庭目标历史记录](docs/productization/qa/life-v0.8.md)、[计时修复历史记录](docs/productization/qa/interaction-v0.5.md) 和 [前一批浏览器记录](docs/productization/qa/2026-09-30.md)。

## 工程结构

| 目录 | 用途 |
|---|---|
| `apps/family-web/` | 家庭、儿童、青少年 Web 客户端 |
| `apps/family-mobile/` | 原生控件、生命周期、安全存储与固定媒体的移动端 |
| `apps/content-admin/` | 独立来源的内容编辑、双审与发布工作台 |
| `apps/api/` | 家庭会话、练习事件、报告、数据权限及数据库 |
| `packages/task-engine/` | 确定性计划、事件回放、结果和难度规则 |
| `packages/contracts/` | 运行接口的输入校验与共享数据模型 |
| `packages/session-runtime/` | 持久化事件、恢复、补传与结果确认 |
| `packages/reports/` | 按家庭日历分组的周回顾与双语解释 |
| `packages/visuals/` | 原始图片、制作提示词、尺寸导出与历史素材保护 |
| `packages/content/` | 内容与资产清单、文本源、签名与审核验证 |
| `packages/audio/` | 固定素材播放器 |
| `tests/platform/` | 新引擎与服务测试 |
| `tests/http/` | 真实 HTTP 与持久化验收 |
| `src/` | 保留的 v0.1 原型及现有图片、语音素材 |

旧版仍可通过 `PORT=4174 npm run dev:legacy` 启动，数据结构与新版分开；旧版浏览器记录尚未导入新家庭服务。

## 产品化方案与实施边界

- [方案总览](docs/productization/README.md)
- [家庭历史翻页](docs/productization/FAMILY-HISTORY.md)
- [家庭 Web 小屏导航与键盘操作](docs/productization/COMPACT-FAMILY.md)
- [产品方案](docs/productization/PRODUCT-PLAN.md)
- [技术设计](docs/productization/TECHNICAL-DESIGN.md)
- [执行计划](docs/productization/DELIVERY-PLAN.md)
- [图片资产与加载预算](docs/productization/VISUAL-ASSETS.md)
- [离线续练授权与恢复边界](docs/productization/CONTINUATION-AUTHORIZATION.md)
- [原生断网恢复设计与设备验收](docs/productization/OFFLINE-RESUME.md)
- [Web 断网重开与缓存边界](docs/productization/WEB-OFFLINE.md)
- [换设备与旧记录恢复](docs/productization/DEVICE-RECOVERY.md)
- [内容工作台、审核与发布](docs/productization/CONTENT-STUDIO.md)
- [候选试玩与审核证据](docs/productization/CANDIDATE-PREVIEW.md)
- [图片与固定语音素材库](docs/productization/MEDIA-LIBRARY.md)
- [实现进度与未完成要求](docs/productization/IMPLEMENTATION.md)
- [完整方案阅读版](docs/productization/index.html)

当前有四年龄段的档案与参数，尚未通过各年龄段的专业适用性验证。原生发行包和设备验收、原生断网重开的设备复验、Web 离线的多浏览器验收与生产授权、换设备的真机复验、完整内容发布与召回、全球身份和监护同意、独立青少年身份与逐成员共享权限、支付退款、运营恢复演练及效果研究仍是后续工作。这里记录具体任务中的表现，不提供标准化注意力分数或已验证的治疗。
