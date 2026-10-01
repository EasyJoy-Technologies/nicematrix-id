# Logto: 本机号码一键登录 Carrier（2026-09-30）

方案：nicematrix-backend `docs/_plans/2026-09-14_carrier-one-tap-login-browser-retention.md` v0.8.2 §5.7（L1–L9）、§6.0–§6.2、§9。
配套 Backend：API v1.2.704（cn Broker / consume）、admin v1.0.493。授权：Xianglin 2026-09-30 16:23 MDT。

## 改动（全部在 overrides 层 + 一个 NiceMatrix 自有连接器；不改上游源码 / connector-kit / Logto 表结构 / pnpm lockfile）
| # | 文件 | 改动 |
|---|---|---|
| L1 | `schemas/src/consts/oidc.ts` | ExtraParams `carrier_mode`、`carrier_challenge` |
| L2 | `core/src/oidc/utils.ts` | `buildLoginPromptUrl` 透传上述两个参数 |
| L3 | `core/src/libraries/verification-helpers/social-verification.ts`（新 override）+ `core/src/libraries/carrier-launch-context.ts`（ours） | target `carrier`：`scope` = 服务端 interaction 签发的 launch context（HS256、≤60 s、`ixh` 代替原始 jti、一次性 jti） |
| L4 | `experience/src/utils/carrier-capability.ts`（ours）、`shared/utils/search-parameters.ts`、`utils/sign-in-experience.ts`、`containers/SocialSignInList/index.tsx` | boot 捕获并去除参数；未声明时 SIE 列表里没有 carrier；按钮只作为 h5 手动重试入口（≤3 次） |
| L5 | `containers/SocialSignInList/use-social.ts` | carrier 闸门：自动弹出每次登录仅一次（sessionStorage，Back/刷新安全）；条款拒绝 / 出错回 `/sign-in`；跳 Broker 用 `location.replace` |
| L6 | `pages/SocialSignInWebCallback/use-social-sign-in-listener.ts` | Broker 错误回调：取消静默、其它三语提示、终态分类本次登录禁用；`relatedUser.type==='phone'` 直接关联（不打开全局 automaticAccountLinking） |
| L7 | `account/src/utils/social-connector.ts`（新 override） | Account Center 不出现 carrier（也覆盖 `hasVisibleSocialSection`） |
| L8 | `experience/src/utils/carrier-phrases.ts`（ours） | 三语 toast（en / zh-CN / zh-TW+HK）；未改上游 phrase 文件 |
| L9 | `logto-custom/connectors/connector-carrier/`（ours）+ `logto-custom/Dockerfile` | 社交连接器：Broker 跳转 + service-auth 签名 consume（5 s，同 consume_request_id 重试一次）；返回 `att_<attempt>` + `86…` 手机号 |

## 运行期配置（Logto 容器 env，`/etc/nicematrix/id.env`）
- `INTERNAL_SERVICE_HMAC_KEY_CARRIER_LAUNCH`、`INTERNAL_SERVICE_HMAC_KEY_CARRIER_CONSUME`：与 cn Backend 相同的值；**不是**共享内部密钥。
- 可选 `NICEMATRIX_CARRIER_BROKER_URLS`（staging：`{"cn":"https://api-staging.nicematrix.com"}`）、`NICEMATRIX_CARRIER_SERVICE_ID`。
- Console / Management API：创建 `nicematrix-carrier` 社交连接器（配置 `{}`）并加入登录体验社交列表（默认对所有用户不可见）。

## 验证
- `tests/test-connector-carrier.mjs` 6/6（假 connector-kit/zod；签名按后端算法独立重算），且后端真实 `verifyServiceRequest`
  接受连接器签名、拒绝篡改。
- Logto 工作区（v1.43.0 + 全部 overrides）：Core `tsc` 0 错；Experience / Account 仅既有、与本次无关的类型告警（Account Center
  覆盖的 phrase key、PasskeySetup 测试）。
- Jest：Core 51 套件中 50 通过（carrier-launch-context、上游 social-verification.test 等全过；失败的 adaptive-mfa 为既有 MFA
  显式开启覆盖所致）；Experience 相关 27 套件 196 例全过；Account 安全页与 utils 10 套件全过 + carrier 排除 2 例（App/Callback
  6 例失败为既有，换回上游文件同样失败）。
- 真实 Logto 加载器（`@logto/cli` loadConnector + validateConnectorModule + parseMetadata）可加载连接器。
