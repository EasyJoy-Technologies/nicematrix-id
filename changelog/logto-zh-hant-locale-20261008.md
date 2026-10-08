# Logto：繁体中文连接器名称 + `zh-Hant*` 语言匹配（2026-10-08）

触发：客户端 agent 接入账户中心时反馈繁体下“微信”显示为 “WeChat”。
决定：Xianglin 2026-10-08 10:18 MDT（名称 + `zh-Hant` 语言匹配一起修）。清单：`docs/patches.md` #16。

## 根因
1. **连接器名称**：上游微信 / 支付宝 / QQ 连接器的 `metadata.name` 只有 `en / zh-CN / tr-TR / ko`。Account Center
   （`getLocalizedConnectorName`）与登录页（`SocialLinkButton`）按 UI 语言精确取名，`zh-TW` / `zh-HK` 无值 → 回落 `en`。
   线上 `GET /api/.well-known/sign-in-exp` 已核：微信 `{"en":"WeChat","zh-CN":"微信","tr-TR":"WeChat","ko":"WeChat"}`。
   DB `connectors.metadata` 对这些连接器为 `{}`（staging / prod-1），不覆盖代码值。
2. **语言匹配**：上游 language-kit 不认 script 子标签，`zh-Hant` / `zh-Hant-TW` / `zh-Hant-HK`（iOS 常见）只能 base 匹配到
   `zh-CN`。线上 `GET /api/.well-known/phrases` 已核：`Accept-Language: zh-Hant-TW` → `Content-Language: zh-CN`（简体）。

## 改动（overrides 层 + 自有文件；不改上游源码 / 表结构 / lockfile / 文案文件）
| 文件 | 类型 | 改动 |
|---|---|---|
| `connectors/connector-{wechat-native,wechat-web,alipay-native,alipay-web,qq}/src/constant.ts` | **新** override | `name` 补 `zh-TW` / `zh-HK`：微信 / 支付寶 / QQ |
| `logto-custom/connectors/connector-carrier/lib/index.js` | ours | `name` 补 `zh-HK`：本機號碼 |
| `core/src/utils/nicematrix-chinese-language.ts` | **新** ours | `normalizeChineseLanguageTag`：`zh-Hant[-*]` → `zh-TW`（HK / MO → `zh-HK`）、`zh-MO` → `zh-HK`、`zh-Hans[-*]` → `zh-CN`，其它原样；`chineseLanguageFallbacks` |
| `core/src/i18n/detect-language.ts` | **新** override | Accept-Language 与 `?locale=` 检测结果逐个归一（供 koa-i18next 的 `ctx.locale` 与 `getExperienceLanguage`） |
| `core/src/utils/i18n.ts` | **新** override | `getExperienceLanguage` 的 `lng`（ui_locales / `?lng=`）同样归一 → phrases、SSR、邮件语言一致 |
| `core/src/libraries/connector.ts` | **新** override | `getI18nEmailTemplate`：`zh-TW` / `zh-HK` 无模板 → 另一繁体区域 → `zh-CN` → 租户 fallback |

繁体邮件模板（Xianglin 2026-10-08 11:52 追加）：`sql/20261008_email_templates_zh_tw.sql` 新增 9 个 `zh-TW` 模板（与 zh-CN 逐条对应，
措辞沿用 Logto zh-TW 文案：帳戶 / 兩步驗證 / 登入）；`zh-HK` 经回落使用同一套。结果：所有繁体读者收繁体邮件。

邮件回落的原因：DB 邮件模板只有 `en` + `zh-CN`（staging / prod-1 已核）。不加回落时，原先被误判为 `zh-CN` 的 `zh-Hant` 用户会从
简体邮件退成英文邮件。加回落后：`zh-Hant*` 用户仍收简体（不变），原本收英文的 `zh-TW` / `zh-HK` 用户改收简体。

## 行为变化
| 客户端语言 | 之前 | 之后 |
|---|---|---|
| `zh-TW` / `zh-HK` | 繁体界面，连接器名称为英文（WeChat / Alipay） | 繁体界面，微信 / 支付寶 |
| `zh-Hant` / `zh-Hant-TW` | **简体**界面 | 繁体（台灣）界面 |
| `zh-Hant-HK` / `zh-Hant-MO` / `zh-MO` | **简体**界面 | 繁体（香港）界面 |
| `zh-Hans*` / `zh-CN` / `zh` / 其它语言 | 不变 | 不变 |

## 验证
- 单测（工作区 `/root/work/logto-tc` = 上游 v1.43.0 + 全部 overrides）：新增 `nicematrix-chinese-language.test.ts`（38 例：
  映射表、原样透传、回落顺序、`detectLanguage` 的 q 排序与 `?locale=`、`getExperienceLanguage` 的 Accept-Language / ui_locales /
  关闭自动检测）、`connector.nicematrix-email-i18n.test.ts`（4 例）。破坏性验证：把 helper 改成透传后新测试 21 例失败。
  相关上游套件（`utils/i18n`、`i18n/detect-language`、`libraries/connector`、`koa-i18next`、`koa-email-i18n`、`routes/well-known`、
  `routes|libraries/sign-in-experience`）共 22 套件 273 例，272 过；唯一失败 `custom-ui-assets/index.test.ts`（p-retry 次数断言，
  不引用任何改动模块，单独运行同样失败），与本批无关。Core `tsc`（build:test）0 错误；改动文件 ESLint 0 错误。
  5 个连接器包 `tsc --noEmit` 通过；`logto-custom/tests/run.sh` 全过（含 carrier 名称断言）。
- staging / prod：见下方“部署”。

## 部署
- staging `id-staging`（2026-10-08）：镜像 `nicematrix-logto:release-2bfdcd8e4062c0e61fcb5ee0ad63b794765d0a1a-20261008-104139`（rollback `nicematrix-logto:rollback-staging-20261008-165354`）。
  构建后镜像核对：`requestedResources` 7 / `hookMatchesRegion` 2 / `by-identity` 2 / `verification-records` 4 / `mfaIssuerName` 5 /
  `assertFirstPartyClient` 34、connectors 50，与旧 `:latest` 一致；5 个连接器 lib 含 `zh-TW` / `zh-HK`。
  部署后：discovery 200、`/api/status` 204、JWKS 200、日志 0 错误。`/api/.well-known/phrases` Content-Language：`zh-Hant` / `zh-Hant-TW` →
  zh-TW，`zh-Hant-HK` / `zh-Hant-MO` / `zh-MO` → zh-HK，`zh-Hans-CN` / `zh` → zh-CN，`en` / `ja` / `zh-TW` / `zh-HK` / `zh-CN` 不变，
  `en;q=0.5, zh-Hant-TW` → zh-TW；`?lng=zh-Hant` → zh-TW。`sign-in-exp`：微信 / 支付寶 / QQ / 本機號碼 均含 `zh-TW` + `zh-HK`。
  未做：登录后的 Account Center 真浏览器截图（名称取值走同一 `connector.name[i18n.language]`，`i18n.language` = 上述 Content-Language）。
- staging 邮件模板（2026-10-08）：执行 SQL → 9 行；重复执行 0 行；`.down.sql` 删 9 行（总数回 18）后再执行恢复 9 行；重启 Logto healthy、0 错误。
  未做：真实发信（staging 无测试收件箱）；模板选择逻辑由 `connector.nicematrix-email-i18n.test.ts` 覆盖。
- prod-1：Xianglin 2026-10-08 11:52 确认（与邮件模板一起）。
