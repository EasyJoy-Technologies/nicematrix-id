# Customizations

## Current policy

We now use **source-based customization** only.

- Upstream source: `logto-upstream/`
- NiceMatrix overrides: `logto-custom/overrides/`
- Build file: `logto-custom/Dockerfile`

No dist bundle patching is used in the active workflow.

> Source overrides are listed below. **Runtime tenant config** (DB state in
> `logto_configs`, e.g. id_token extended claims) is NOT here — see
> [`runtime-tenant-config.md`](./runtime-tenant-config.md). Re-apply those after
> any tenant re-seed.

## Active customizations

1. Username regex allows dot (`.`) in the middle:
   - Override file: `logto-custom/overrides/packages/toolkit/core-kit/src/regex.ts`
   - Rule: `/^[A-Z_a-z](?:[\w.]*\w)?$/`

2. Branding seed logos use NiceMatrix assets:
   - Override file: `logto-custom/overrides/packages/schemas/src/seeds/sign-in-experience.ts`
   - Logo URL: `https://m.nicematrix.com/branding/NiceMatrix-170x64.svg`

3. Console contact/brand external links:
   - Override file: `logto-custom/overrides/packages/console/src/consts/external-links.ts`
   - contactEmail: `support@nicematrix.com`
   - docs links remain official `docs.logto.io`

4. OSS admin console API resource fix (to avoid 401 on internal pages):
   - Override files:
     - `logto-custom/overrides/packages/console/src/App.tsx`
     - `logto-custom/overrides/packages/console/src/hooks/use-api.ts`
   - Use admin tenant management API resource for console API calls in OSS mode.

5. Management API resource indicator domain override (remove `*.logto.app` audience strings):
   - Override file:
     - `logto-custom/overrides/packages/schemas/src/seeds/management-api.ts`
   - Indicator rule:
     - from: `https://${tenantId}.logto.app/${path}`
     - to:   `https://id.nicematrix.com/${tenantId}/${path}`
   - Effective indicators in current deployment:
     - `https://id.nicematrix.com/admin/api`
     - `https://id.nicematrix.com/admin/me`
     - `https://id.nicematrix.com/default/api`
   - Notes:
     - This change is source-level (schema seed function override), not only DB patch.
     - `nicematrix-backend` M2M `resource` must stay aligned with this value.

6. Allow `hideLogtoBranding` in OSS (remove environment block):
   - Override file: `logto-custom/overrides/packages/core/src/routes/sign-in-experience/index.ts`
   - Behavior:
     - Cloud: keep BYUI quota guard
     - OSS: allow saving `hideLogtoBranding` without `request.invalid_input`

7. Exempt column-backed built-in profile fields (`name`, `avatar`) from the
   account-center / sign-up `profileFields` catalog existence check:
   - Override file:
     `logto-custom/overrides/packages/core/src/libraries/custom-profile-fields/index.ts`
   - Problem (1.41): alteration `1.41.0-...-set-admin-account-center-profile-fields`
     seeds admin `account_centers.profile_fields = [{name},{avatar}]`, but
     `validateProfileFieldsList` checks every referenced name against the
     `custom_profile_fields` catalog with no built-in exemption. `name`/`avatar` are
     backed by dedicated `users` columns, never catalog rows -> every save of
     **Sign-in experience -> Sign-in & account** failed with
     `custom_profile_fields.entity_not_exists_with_names: name, avatar`.
   - Fix: exempt ONLY `name`+`avatar` (derived from `nameAndAvatarGuard.keyof()`) from
     the missing-name check; keep the duplicate-name check on the full list; skip the
     catalog query when nothing remains to verify (`... in ()` is invalid Postgres SQL).
   - Scope guard: other built-in keys (birthdate/gender/nickname/address/...) are
     legitimate catalog rows here, so they stay validated (dangling-ref detection intact).
   - Upgrade note: on the next upstream bump, re-copy this upstream file and re-apply only
     these ~3 diff hunks; verify `nameAndAvatarGuard` still exports `name`+`avatar`.

11. 账户中心整改批次（2026-09-29，决策：Xianglin；NiceNote 审查 §10）：
    - 备份码原子替换、TOTP `otpauthUri`、用已绑定第三方账号验证身份（social step-up，使用时再校验）、
      Apple 授权码交给 Backend 用于撤销、
      错误码文案 4 locale。
    - Schema：`sql/20260929_apple_authorization_codes.sql`（先于镜像应用）。
    - 文件清单与部署顺序：`logto-custom/README.md`「Account-center batch」+
      `changelog/logto-account-center-batch-20260929.md`；客户端契约：backend `docs/integration/logto-account-api.md` §3 §4.1 §5.4 §6 §9。

## How to add customization

1. Locate target source file in `logto-upstream/`.
2. Copy the same relative path into `logto-custom/overrides/`.
3. Edit only the required lines in the override copy.
4. Build via `deploy/docker-compose.yml` (which uses `logto-custom/Dockerfile`).
5. Document the change in this file and API/integration docs when behavior changes.

## Upgrade checklist

1. Bump `logto-upstream` submodule tag.
2. Rebuild image.
3. Resolve override drift if upstream files changed.
4. **Seam check for OUR-NEW files**: drift tooling only diffs override files against
   upstream; it cannot see when one of OUR-NEW files (e.g. `account/avatar.ts`,
   `account/deletion-request.ts`, `admin-user/verification-records.ts`) calls an
   upstream-internal function whose **signature/return shape changed** this release.
   For every OUR-NEW file, grep its imports of upstream modules; if any imported
   module appears in the upstream CHANGED list, manually re-verify each call site.
   (Lesson from 1.41: `getScopedProfile` return changed to `{ profile, user }` —
   `avatar.ts` call sites were missed → 500 on avatar upload/delete.)
5. Run smoke tests (sign-in, menu navigation, core pages) — include one **real
   user-token** round-trip per OUR-NEW route (e.g. actual avatar upload), not just
   route-existence/auth curls.
6. Update docs.

6. AppLoading 加载动画 Logo 尺寸限制：
   - Override 文件：`logto-custom/overrides/packages/console/src/components/AppLoading/index.module.scss`
   - 原因：上游 SCSS 对 svg 只设 `margin-bottom`，无尺寸约束，自定义 Logo 会撑满屏幕
   - 修改：在 `.container svg {}` 中添加 `height: 48px; width: auto`

7. 品牌名称 mainTitle 改为 NiceMatrix：
   - Override 文件：`logto-custom/overrides/packages/console/src/consts/tenants.ts`
   - 原因：浏览器标题栏显示 `Logto Console`
   - 修改：`mainTitle = isCloud ? 'NiceMatrix Cloud' : 'NiceMatrix Console'`
   - 注意：仅改字符串值，变量名 `mainTitle` 及其他代码保持不变

8. OIDC Grant 绝对上限 180 → 365 天（2026-06-10）：
   - Override 文件：`logto-custom/overrides/packages/core/src/oidc/init.ts`
   - 原因：登录有效期 = min(refresh-token 闲置 TTL 60d, Grant 上限)。
     原 180d 上限使持续活跃用户半年被迫重新登录；提到 365d 后活跃用户
     可整年免登录（60 天不活跃仍会掉，由 RT TTL 管）。
   - 修改：`ttl.Grant: 365 * 3600 * 24`（仅此一行 + 注释；其余为
     upstream v1.40.1 `packages/core/src/oidc/init.ts` 的逐字拷贝）。
   - ⚠️ 升级 upstream 时必须用新版 init.ts 重新做这份 override（diff 后只
     保留 Grant 行差异）。

9. 账户注销无邮箱用户直落 pending（2026-06-10，决策：Xianglin）：
   - Override 文件：`logto-custom/overrides/packages/core/src/routes/account/deletion-request.ts`
     （本来就是 NiceMatrix 自有路由，非上游文件）
   - 原因：99.9% 存量用户（legacy 手机号/纯三方）无 primaryEmail，邮件确认
     不可达，原流程会把他们永久卡在 awaiting_confirmation。
   - 修改：POST 时查 `tenant.queries.users.findUserById`；无 primaryEmail →
     直接 INSERT status='pending' + scheduled_at=now()+15d（confirmed_at=now()，
     不生成 token）。响应改为按 status 区分的 discriminatedUnion。
   - 配套：Account Center `apis/deletion.ts` 联合返回类型、
     `DeletionSection/index.tsx` 按 userInfo.primaryEmail 切换弹窗文案 +
     按响应 status 切换成功 toast；`i18n/deletion-phrases.ts` 新增
     `step_confirm_warning_no_email` / `create_success_no_email`（4 locale 齐）。
   - 后端兜底：`nicematrix-backend` user-deletion sweeper（见该 repo
     docs/account-deletion.md）。
   - 2026-09-29 追加（NiceNote 账户中心审查 §10 N11/N12）：
     - schema `sql/20260929_user_deletion_executing.sql`：新增 `executing` 状态与
       `attempt_count / next_attempt_at / lease_owner / lease_until`（Backend 原子认领 + 重试）；
     - 路由：GET / POST 的「开放请求」包含 `executing`；DELETE 遇 `executing` 返回
       409 `user.deletion_request_executing`（取消与 Backend 认领在行锁上串行化）；
     - Account Center：新页 `pages/DeletionVerify`（路由 `/deletion/verify`，经
       `App.tsx` override 注册）取代不存在的 `/verify` 死路由；DeletionSection 支持
       `executing` 横幅（无取消按钮）、验证记录过期提示；`deletion-phrases.ts` 新增
       `executing_banner_*` / `error_executing`（4 locale 齐）。

10. 区域感知三方登录按钮显隐 `hide_social` / `show_social`（2026-06-17，决策：Xianglin）：
    - Override 文件（4 改 + 1 新建）：
      - `packages/schemas/src/consts/oidc.ts`（ExtraParamsKey `HideSocial`/`ShowSocial`）
      - `packages/core/src/oidc/utils.ts`（`buildLoginPromptUrl` +2 `appendExtraParam`）
      - `packages/experience/src/utils/native-caps.ts`（`shouldHideSocialTarget` 纯函数 + capture）
      - `packages/experience/src/utils/sign-in-experience.ts`（**新** override：唯一过滤点 + google 隐藏时关 One Tap）
    - 用途：客户端传 `?hide_social=google,facebook`（黑名单）或 `?show_social=apple,wechat`（白名单）控制托管登录页三方按钮显隐；中国区构建包据此隐藏 Google/Facebook。
    - 护栏：结构性，只作用于 `socialConnectors` 数组，永不影响邮箱/密码主登录。
    - 纯前端显隐（`/.well-known/experience` 仍下发被隐藏连接器，只是不渲染）。
    - 都不传 = 上游字节级等价；详见 `custom-extra-params.md`。单测 `logto-custom/tests/test-native-caps.js`（97/97 绿）。
    - 空值 caveat：`hide_social=` / `show_social=`（空）经 OIDC 流被 `appendExtraParam` 跳过转发 = passthrough（全显示）；每个参数必须带 ≥1 target。
    - **部署（2026-06-17）**：staging `id-staging`（image `a09568b35463`）+ prod-1 `id.nicematrix.com`（image config `437265c852fc`，`docker save`→scp md5 `4fdbac85e17d` 校验一致→force-recreate）均 healthy。两环境各跑 7 例真实 OIDC headless e2e 全过（hide/show/优先级/隐藏全部时分隔线消失/passthrough），0 日志错误。prod-1 回滚 tag：`nicematrix-logto:pre-social-visibility-rollback` = `90dc641ca8a4`。
    - **客户端用法**：iOS/Android/Flutter 在 `/oidc/auth` authorization 请求的 extra params 里加 `hide_social` / `show_social`。

11. 本机号码一键登录 Carrier（2026-09-30，方案 nicematrix-backend `docs/_plans/2026-09-14_carrier-one-tap-login-browser-retention.md` v0.8.2 §5.7 L1–L9）：
    - ExtraParams：`packages/schemas/src/consts/oidc.ts`（`CarrierMode` / `CarrierChallenge`）+ `packages/core/src/oidc/utils.ts`
      （`buildLoginPromptUrl` +2 `appendExtraParam`）。
    - Core（**新** override）：`packages/core/src/libraries/verification-helpers/social-verification.ts` —— 仅 target `carrier`
      时把 `scope` 换成服务端 interaction 签发的 launch context（`packages/core/src/libraries/carrier-launch-context.ts`，
      ours，HS256 ≤60 s，key `INTERNAL_SERVICE_HMAC_KEY_CARRIER_LAUNCH`）。其余连接器与上游逐字节一致。
    - Experience：`utils/carrier-capability.ts`（ours：capture/strip、一次性自动弹出、手动重试 ≤3、禁用标记）、
      `utils/carrier-phrases.ts`（ours：三语 toast）；`shared/utils/search-parameters.ts`（boot capture）、
      `utils/sign-in-experience.ts`（无声明时从 SIE 列表移除 carrier）、`containers/SocialSignInList/index.tsx`（按钮仅 h5 手动入口）、
      `containers/SocialSignInList/use-social.ts`（carrier 闸门 + replace 跳转 + 失败回 /sign-in）、
      `pages/SocialSignInWebCallback/use-social-sign-in-listener.ts`（错误回调：取消静默 / 三语提示 / 禁用；
      `relatedUser.type==='phone'` 自动关联，不开全局 automaticAccountLinking）。
    - Account Center（**新** override）：`packages/account/src/utils/social-connector.ts` —— 绑定列表与
      `hasVisibleSocialSection` 同时排除 carrier（方案写的是 SocialSection；改在其唯一数据源，覆盖面更全、改动更小）。
    - Connector（ours，非 workspace 包）：`logto-custom/connectors/connector-carrier/`（纯 ESM，无构建步骤）。
      `logto-custom/Dockerfile` 在生产依赖重装后把它复制进 `packages/core/connectors/`，依赖从 core 的 node_modules
      解析——**不改上游 pnpm lockfile**。
    - 都不传 `carrier_mode` + `carrier_challenge` = 与没有号码认证完全一致（SIE 列表里也没有 carrier）。
    - 单测：`tests/test-connector-carrier.mjs`（run.sh）、`experience/src/utils/carrier-capability.test.ts`、
      `core/src/libraries/carrier-launch-context.test.ts`、`account/src/utils/social-connector.carrier.test.ts`。
    - 升级时：重新 diff 上述两个**新** override（social-verification.ts、account social-connector.ts）；确认
      `connector-kit` 的 `GetAuthorizationUri` payload 仍有 `scope`、`ConnectorErrorCodes` 名称未变。

12. 本机号码一键登录审查修复批 B（2026-10-03，审查 nicematrix-backend `docs/_reviews/2026-10-02-carrier-one-tap-code-review.md` §6 批 B；
    changelog `changelog/logto-carrier-review-fixes-20261003.md`）：
    - B1（CR-03/CR-18）Core **新** override `routes/experience/classes/verifications/social-verification.ts`：carrier 新用户的号码已被
      其他账户占用 → 422 `user.phone_already_in_use`（上游静默丢号）；Experience `hooks/use-social-register.ts`（**新** override，
      可选 `errorHandlers`）+ 回调监听把它映射为“已超时，请重试”回登录页。其它连接器与上游一致。
    - B2（CR-07）ExtraParam `app_version`（`schemas/src/consts/oidc.ts`），签进 launch context（格式不合法则不签 = 未声明）；不转发给 SPA。
    - B3（CR-02）Core **新** ours `middleware/koa-carrier-login-prompt.ts`，由 `oidc/init.ts` override 在 `koaResourceParam()` 之后挂载：
      GET `/auth` 带合法 `carrier_mode` + `carrier_challenge` 时在 `prompt` 上**追加** `login`（保留 `consent`，不重复）；其它请求不动。
    - B4（CR-17）`carrier-launch-context.ts`：缺 key / client_id / app_slug / region / 合法 carrier 参数 → `connector.not_enabled`（400，
      data.carrier=not_supported）；Experience `use-social.ts` 对 carrier 的 `connector.*` 错误静默、禁用本次号码登录、回普通登录页。
    - B7（CR-14）carrier 新注册补资料可跳过：Core `routes/experience/types.ts`（**新** override，`carrierProfileSkipped`）、
      `classes/profile.ts`（**新** override：`canSkipForCarrier` / `markCarrierProfileSkipped` / 必填校验放行 / cleanUp 保留标记）、
      `routes/experience/index.ts`（**新** override，挂载）+ ours `carrier-profile-skip-routes.ts`（GET/POST
      `/api/experience/profile/carrier-skip`，含 `.openapi.json`）。Experience：ours `apis/carrier-profile-skip.ts`、
      `hooks/use-carrier-profile-skip.ts`、`utils/carrier-profile-skip-context.ts`；**新** override `pages/Continue/index.tsx`（提供 onSkip）、
      `Layout/SecondaryPageLayout/index.tsx`（页面无 onSkip 时用 context 的）。“跳过”是上游 NavBar 自带控件与上游文案
      `action.nav_skip`（en / zh-CN / zh-TW / zh-HK 均已有），无新文案。放行条件：Register + 待建用户的社交身份为 carrier +
      交互内已记录跳过（只能由该 POST 写入，服务端 interaction 内，浏览器不可伪造）；短信 / 密码 / 其它社交注册、已有用户登录不变；
      不使用租户级 `skipRequiredIdentifiers`。
    - 单测：`core/src/middleware/koa-carrier-login-prompt.test.ts`、`core/src/libraries/carrier-launch-context.test.ts`（扩充）、
      `core/src/routes/experience/classes/verifications/social-verification.carrier.test.ts`、
      `core/src/routes/experience/classes/profile.carrier.test.ts`、`experience/src/pages/Continue/carrier-skip.test.tsx`。
    - 升级时：重新 diff 本条所有**新** override（social-verification 验证类、types.ts、profile.ts、experience index.ts、
      use-social-register.ts、Continue/index.tsx、SecondaryPageLayout/index.tsx）与 `oidc/init.ts` 的挂载行。

13. Core Jest 资源保护（2026-10-03）：
    - Override：`logto-custom/overrides/packages/core/jest.config.js`。
    - `maxWorkers: 2`，避免 8 核开发主机默认启动 7 个高内存 worker，耗尽主机 RAM 与 Swap。
    - 保留上游 `workerIdleMemoryLimit: '2.5GB'`；升级时重新复制上游配置，仅重加并发限制及说明。

14. Core 请求日志脱敏（2026-10-03，审查 nicematrix-backend `docs/_reviews/2026-10-02-carrier-one-tap-code-review.md` CR-04）：
    - **新** override `core/src/app/init.ts`（仅改 koa-logger `transporter` 一处）+ ours `core/src/utils/request-log-redaction.ts`。
    - 上游 koa-logger 原样打印 `ctx.originalUrl`，`carrier_challenge`、授权码 `code` 等会写入容器日志。查询串含敏感参数时整段替换为
      `?<redacted>`（保留路径）；参数表与各主机 nginx `nocreds` 的 map 一致（backend `docs/runbooks/nginx-access-log-redaction.md`）。
    - 单测 `core/src/utils/request-log-redaction.test.ts`。升级时：重新 diff `app/init.ts`，只重加 import 与 transporter 改动。

15. 审计日志明文密码屏蔽（2026-10-03，决策：Xianglin）：
    - **新** override `core/src/utils/sensitive-data.ts`：`sanitizeSensitiveDataRecord` 在同级 `type` 为 `password` 时屏蔽 `value`。
    - 原因：上游 `routes/experience/profile-routes.ts` 把请求体 `{ type: 'password', value }` 原样写进
      `Interaction.<Event>.Profile.Update` 审计日志；上游只按键名脱敏（`password` / `secret` / `token` …），键名 `value` 漏网 →
      `logs` 表存明文密码（prod-1 2026-02 起累计 406 行）。改在唯一的脱敏入口（`koa-audit-log` 写入前），任何同形载荷都覆盖。
    - 单测 `core/src/utils/sensitive-data.password-value.test.ts`；上游 `sensitive-data.test.ts`、`koa-audit-log.test.ts` 不变且通过。
    - 升级时：重新复制上游 `sensitive-data.ts`，只重加 `isPasswordTypedValue` 与一处 `||`；若上游已修复同类问题则删除本 override。

16. 繁体中文：连接器名称 + `zh-Hant*` 语言匹配（2026-10-08，决策：Xianglin；changelog `changelog/logto-zh-hant-locale-20261008.md`）：
    - 连接器名称：**新** override `connectors/connector-{wechat-native,wechat-web,alipay-native,alipay-web,qq}/src/constant.ts`，
      `defaultMetadata.name` 补 `zh-TW` / `zh-HK`（微信 / 支付寶 / QQ）；ours `logto-custom/connectors/connector-carrier` 补 `zh-HK`。
      原因：Account Center（`getLocalizedConnectorName`）与登录页（`SocialLinkButton`）按 UI 语言**精确**取名，缺键回落 `en` →
      繁体下显示 “WeChat”。DB `connectors.metadata` 对这些连接器为 `{}`（staging / prod-1 已核），不覆盖代码值。
    - 语言匹配：ours `core/src/utils/nicematrix-chinese-language.ts`；**新** override `core/src/i18n/detect-language.ts`（Accept-Language +
      `?locale=`）与 `core/src/utils/i18n.ts`（`getExperienceLanguage` 的 `lng` / ui_locales）。上游 language-kit 不认 script 子标签，
      `zh-Hant` / `zh-Hant-TW` / `zh-Hant-HK` 只能 base 匹配到简体 `zh-CN`。映射：`zh-Hant[-*]` → `zh-TW`（HK / MO → `zh-HK`），
      `zh-MO` → `zh-HK`，`zh-Hans[-*]` → `zh-CN`；其它标签原样。覆盖 phrases / SSR / `ctx.locale` / 邮件语言。
    - 邮件模板回落：**新** override `core/src/libraries/connector.ts`（仅 `getI18nEmailTemplate`）：`zh-TW` / `zh-HK` 无模板时依次试
      另一繁体区域、`zh-CN`，再回租户 fallback（`en`）。DB 只有 `en` + `zh-CN` 模板，否则 `zh-Hant` 用户会从简体邮件退成英文。
    - 单测 `core/src/utils/nicematrix-chinese-language.test.ts`、`core/src/libraries/connector.nicematrix-email-i18n.test.ts`；
      `logto-custom/tests/test-connector-carrier.mjs` 断言 `zh-TW` / `zh-HK`。
    - 升级时：5 个 `constant.ts` 重新复制上游、只重加两行名称；若上游已补 `zh-TW` / `zh-HK` 则删除对应 override。
      `detect-language.ts` / `i18n.ts` / `connector.ts` 只重加标 `[NiceMatrix override]` 的 import 与一处调用；若上游 language-kit
      已支持 script 子标签匹配则删除语言匹配三件。
