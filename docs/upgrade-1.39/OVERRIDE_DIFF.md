# 1.39 Upgrade — Override Drift Analysis

For every override file: list whether the upstream content changed v1.38.0 → v1.39.0, and how we plan to handle it.

| # | Override file | Upstream changed 1.38→1.39? | Risk | Action plan | Status |
|---|---|---|---|---|---|
| 1 | `toolkit/core-kit/src/regex.ts` | No | LOW | Re-apply as-is (verify SHA) | pending |
| 2 | `schemas/src/seeds/management-api.ts` | No | LOW | Re-apply | pending |
| 3 | `schemas/src/consts/oidc.ts` | No | LOW | Re-apply | pending |
| 4 | `schemas/src/types/hook.ts` | No | LOW | Re-apply | pending |
| 5 | `console/index.html` | No | LOW | Re-apply | pending |
| 6 | `console/src/consts/tenants.ts` | No | LOW | Re-apply | pending |
| 7 | `console/src/consts/external-links.ts` | YES (2 commits) | MEDIUM | 3-way merge | pending |
| 8 | `console/src/App.tsx` | No | LOW | Re-apply | pending |
| 9 | `console/src/pages/ConnectorDetails/index.tsx` | No | LOW | Re-apply | pending |
| 10 | `console/src/assets/images/logo.svg` | No | LOW | Re-apply | pending |
| 11 | `console/src/favicon.svg` | No | LOW | Re-apply | pending |
| 12 | `console/src/hooks/use-api.ts` | No | LOW | Re-apply | pending |
| 13 | `console/src/hooks/use-image-mime-types.ts` | No | LOW | Re-apply | pending |
| 14 | `console/src/components/AppLoading/index.module.scss` | No | LOW | Re-apply | pending |
| 15 | `console/src/components/Topbar/index.module.scss` | No | LOW | Re-apply | pending |
| 16 | `experience/src/containers/MfaFactorList/index.tsx` | No | LOW | Re-apply | pending |
| 17 | `experience/src/containers/SocialSignInList/use-social.ts` | YES (1 commit) | MEDIUM | 3-way merge with localStorage fallback | pending |
| 18 | `experience/src/pages/SocialSignInWebCallback/use-social-sign-in-listener.ts` | YES (1 commit) | MEDIUM | 3-way merge | pending |
| 19 | `experience/src/utils/social-redirect-override.ts` | N/A (our file) | LOW | Keep | pending |
| 20 | `experience/src/hooks/use-start-identifier-passkey-sign-in-processing.ts` | No | LOW | Re-apply | pending |
| 21 | `experience/src/shared/assets/icons/nicematrix/nicematrix-logo.svg` | N/A (our asset) | LOW | Keep | pending |
| 22 | `experience/src/shared/components/LogtoSignature/index.tsx` | No | LOW | Re-apply | pending |
| 23 | `experience/src/components/SwitchMfaFactorsLink/index.tsx` | No | LOW | Re-apply | pending |
| 24 | `core/static/html/post-logout/index.html` | No | LOW | Re-apply | pending |
| 25 | `core/src/routes/sign-in-experience/index.ts` | YES (1 commit) | MEDIUM | 3-way merge | pending |
| 26 | `core/src/routes/interaction/middleware/koa-interaction-hooks.ts` | No | LOW | Re-apply | pending |
| 27 | `core/src/routes/account/avatar.ts` | N/A (our file, NEW in our fork) | LOW | Keep | pending |
| 28 | `core/src/routes/account/index.ts` | YES (2 commits) | HIGH | 3-way merge (preserve avatar mount) | pending |
| 29 | `core/src/routes/account/deletion-request.ts` | N/A (our file) | LOW | Keep | pending |
| 30 | `core/src/routes/experience/middleware/koa-experience-interaction-hooks.ts` | No | LOW | Re-apply | pending |
| 31 | `core/src/libraries/hook/context-manager.ts` | No | LOW | Re-apply | pending |
| 32 | `core/src/libraries/hook/index.ts` | No | LOW | Re-apply | pending |
| 33 | `account/vite.config.ts` | TBD | TBD | Inspect | pending |
| 34 | `account/src/App.tsx` | YES (8 commits, MAJOR REFACTOR) | HIGH | Decide: drop our override OR restructure | pending |
| 35 | `account/src/pages/SocialFlow/index.tsx` | TBD | TBD | Inspect — upstream 1.39 has SocialFlow | pending |
| 36 | `account/src/pages/Security/SocialSection/index.tsx` | YES (upstream 1.39 native) | HIGH | Drop ours, try upstream version | pending |
| 37 | `account/src/pages/Security/DeletionSection/*` | N/A (our files) | LOW | Keep, used in our Security override | pending |
| 38 | `account/src/pages/Security/index.tsx` | YES (3 commits, full refactor) | HIGH | Use upstream layout BUT swap DeleteAccountSection → DeletionSection | pending |
| 39 | `account/src/pages/Security/ProfileSection/*` | N/A (our content) | HIGH | MIGRATE to `pages/Profile/*` | pending |
| 40 | `account/src/pages/PasskeyBinding/*` | TBD | TBD | Inspect | pending |
| 41 | `account/src/pages/SocialCallback/index.tsx` | No | LOW | Keep override | pending |
| 42 | `account/src/i18n/profile-phrases.ts` | N/A (our file) | LOW | Keep, used by Profile page | pending |
| 43 | `account/src/i18n/deletion-phrases.ts` | N/A (our file) | LOW | Keep | pending |
| 44 | `account/src/apis/profile.ts` | N/A (our file) | LOW | Keep | pending |
| 45 | `account/src/apis/deletion.ts` | N/A (our file) | LOW | Keep | pending |
| 46 | `account/src/components/PageHeader/index.module.scss` | TBD | TBD | Inspect | pending |

(46 entries; some grouped — actual file count 53 from `find` output earlier)
