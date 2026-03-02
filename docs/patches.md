# Customizations

## Current policy

We now use **source-based customization** only.

- Upstream source: `logto-upstream/`
- NiceMatrix overrides: `logto-custom/overrides/`
- Build file: `logto-custom/Dockerfile`

No dist bundle patching is used in the active workflow.

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
   - Use admin tenant management API resource (`https://admin.logto.app/api`) for console API calls in OSS mode.

5. Allow `hideLogtoBranding` in OSS (remove environment block):
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
