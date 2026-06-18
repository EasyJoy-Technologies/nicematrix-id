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
4. Run smoke tests (sign-in, menu navigation, core pages).
5. Update docs.

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

10. 区域感知三方登录按钮显隐 `hide_social` / `show_social`（2026-06-17，决策：Xianglin）：
    - Override 文件（4 改 + 1 新建）：
      - `packages/schemas/src/consts/oidc.ts`（ExtraParamsKey `HideSocial`/`ShowSocial`）
      - `packages/core/src/oidc/utils.ts`（`buildLoginPromptUrl` +2 `appendExtraParam`）
      - `packages/experience/src/utils/native-caps.ts`（`shouldHideSocialTarget` 纯函数 + capture）
      - `packages/experience/src/utils/sign-in-experience.ts`（**新** override：唯一过滤点 + google 隐藏时关 One Tap）
    - 用途：客户端传 `?hide_social=google,facebook`（黑名单）或 `?show_social=apple,wechat`（白名单）控制托管登录页三方按钮显隐；中国区构建包据此隐藏 Google/Facebook。
    - 护栏：结构性，只作用于 `socialConnectors` 数组，永不影响邮箱/密码主登录。
    - 纯前端显隐（`/.well-known/experience` 仍下发被隐藏连接器，只是不渲染）。
    - 都不传 = 上游字节级等价；详见 `custom-extra-params.md`。单测 `logto-custom/tests/test-native-caps.js`。
