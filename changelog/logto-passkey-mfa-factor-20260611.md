# Logto passkey 管理入口修复 — admin 租户 SIE `mfa.factors += WebAuthn`

2026-06-11. 触发：用户报 `/account/passkey/manage` 显示「通行密钥未启用。请联系管理员寻求帮助。」

## 根因（三层 gate，全部独立读 `mfa.factors`，passkeySignIn 只兜底其中一层）

Logto 上游把 passkey 设计成「双语义」：登录方式 + WebAuthn MFA factor，二者**同一份凭证**，都落在 `users.mfa_verifications` 里 `type:"WebAuthn"`，无标志位区分。

| 层 | 文件 | 判据 | 6-10 后状态 |
|---|---|---|---|
| A 登录页 passkey 注册/登录（experience 交互 API） | `experience/classes/mfa.ts checkMfaFactorsEnabledInSignInExperience` → `getMfaFactorsEnabledForBinding()` | `mfa.factors ∪ (passkeySignIn.enabled?[WebAuthn]:[])`，**有 passkeySignIn 兜底** | ✅ 通 |
| B 账户中心后端 `POST /api/my-account/mfa-verifications` | `core/src/routes/account/mfa-verifications.ts:109` | `mfa.factors.includes(type)` — **无兜底** | ❌ 拒 |
| C 账户中心前端 `PasskeyView` + `use-mfa-rows` | upstream（未 override） | `mfa.factors.includes(WebAuthn)` | ❌ 拒 |

- 强制 MFA 策略层 `getConfiguredMfaFactors()` **只读 `mfa.factors`、不注入 passkey** → passkey 单独**不能**满足 Mandatory MFA（防顶替，合理）。
- 6-10 只开了 `passkeySignIn.enabled=true`（登录页 passkey 按钮），未动 `mfa.factors` → A 通、B/C 拒 → 「能在登录页用 passkey，却进不去管理页」。

## 决策：方案 1（配置变更，零代码零 override）

`mfa.factors` 追加 `WebAuthn`，B+C 两道 gate 同时打开。否决方案 2（fork 1 个 core 后端 + 2-3 前端文件按 passkeySignIn 重新 gate）：方案 1 零 override、无升级 review 负担、不削弱安全（passkey 仍进不了 `getConfiguredMfaFactors`，无法顶替 Mandatory MFA），语义更自洽。

副作用（已接受）：passkey 同时成为一个**可选** MFA 二次因素，登录 MFA 绑定提示里会多出 passkey 选项。

## 执行方法（cache-safe）

- staging 无 Redis → SIE 走**进程内** WellKnownCache。直接 DB UPDATE 会 stale → **必须走 Management API** `PATCH /api/sign-in-exp`（`updateDefaultSignInExperience = wellKnownCache.mutate(...)`，写 DB + 失效缓存）。
- M2M：backend `i5xi8o9h6z7sv5xxntwk4`（role `machine:mapi:admin`），resource `https://id.nicematrix.com/admin/api`，token endpoint `https://id-staging.nicematrix.com/oidc/token`。
- PATCH body 发**完整 mfa 对象**（policy + organizationRequiredMfaPolicy + 5 factors）避免部分覆盖。

## staging 已执行 + 验证（2026-06-11 ~03:40 MDT）

- 备份：`/root/backups/logto-sie/staging-admin-sie-20260611_034029.json`（完整 SIE）。
- PATCH HTTP 200；`mfa.factors`=`[Totp,WebAuthn,BackupCode,EmailVerificationCode,PhoneVerificationCode]`，policy/orgPolicy/passkeySignIn 不变。
- 全量 diff vs 备份：**仅** `WebAuthn` 一行新增，无其它漂移。
- DB 持久化✅；public `.well-known/sign-in-exp` 立即显示 WebAuthn（缓存已失效）✅；`default` 租户未动✅。
- 安全：staging WebAuthn 用户 2 个均有 email+phone fallback；**passkey-only 无 fallback 用户 = 0** → 无锁死/新增 MFA 提示风险。（且 Email/Phone factor 本就在 factors+隐式 → 有邮箱/手机的用户早已 MFA-subject，加 WebAuthn 不新触发。）
- 容器 healthy、近 5min 无 error。
- i18n：`account_center.security.passkeys/passkeys_count_one|other/manage/add` + `passkey.*` zh-cn/zh-tw/en 全译齐（i18next 复数 `_one/_other`）。
- 现存 passkey 记录（user ybksi0v7ysgi，name=null→fallback「Chrome on macOS」）完好可渲染。

## prod-1 已执行 + 验证（2026-06-11 ~03:48 MDT，用户确认后执行）

- M2M：client `m-admin`（role `machine:mapi:admin`），resource `https://id.nicematrix.com/admin/api`（prod-1 `LOGTO_API_RESOURCE` 未显式设置→auto-derive），token endpoint `https://id.nicematrix.com/oidc/token`。prod-1 **无 Redis** → 同 staging 走 Management API（cache-safe），不直写 DB。
- 备份：`/root/backups/logto-sie/prod1-admin-sie-20260611_034841.json`（完整 SIE）。
- PATCH HTTP 200；发完整 mfa 对象**保留 prod-1 自身** policy=`PromptOnlyAtSignIn`（注意：与 staging 的 `PromptAtSignInAndSignUp` 不同）+ orgPolicy=Mandatory；`mfa.factors`=`[Totp,WebAuthn,BackupCode,EmailVerificationCode,PhoneVerificationCode]`。
- 全量 diff vs 备份：**仅** `WebAuthn` 一行新增，无其它漂移。
- DB 持久化✅；public `.well-known` 立即生效（缓存失效，无需重启）✅；`default` 租户未动✅；容器 healthy、近 5min 无 error✅。
- 安全：prod-1 全库 3 个 WebAuthn 用户（e5cioozh61ux/ii1r0gcbut29/ybksi0v7ysgi）均有 email+phone fallback；**passkey-only 无 fallback 用户 = 0** → 无锁死风险。

## 待办（用户手动验证）

- 浏览器（需真实平台认证器/生物识别，无法 headless）：staging + prod-1 `/account/passkey/manage` 列表/改名/删除 + 新增 passkey + passkey 登录闭环 + 现有 TOTP/MFA 提示无回归。
