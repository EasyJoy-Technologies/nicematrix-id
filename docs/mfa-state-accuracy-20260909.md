# 两步验证（MFA）状态显示准确性 — 调研与待决策

> 状态：**仅调研，未做任何代码 / 配置 / 数据改动**。2026-09-09。
> 触发：`id.nicematrix.com/account` 上账号 `systemtest` 未添加任何第二验证方式，
> 页面「两步验证」开关却显示为**开**。
> 关联文档：`docs/mfa-deadlock-prevention.md`（Package A，隐式 Email/Phone fallback 的由来）。

---

## 0. 用户已给定的方向约束（本次讨论确定，实施时必须满足）

1. **开关必须与「是否真的开启了两步验证」这一事实完全一致**。若只是添加了验证方式、
   登录时并不会要求二次验证，则必须显示为**关**。
2. **不得因为用户填了邮箱（或手机）就把两步验证算作打开**。
3. 若无法保证准确显示，**宁可去掉这一项显示**（账户中心与客户端一并去掉）。
4. 具体处理方案由用户另行安排时间决定；本文档只做事实沉淀。

---

## 1. 结论

页面开关显示的**不是**两步验证的真实状态。展示侧与登录强制侧读的是**两个不同字段**，
且账户中心的绑定动作与两者都不同步，因此三者可以任意漂移。

`systemtest`（Logto user id `ux4219rvs3g7`，prod-1）实测：

| 维度 | 值 |
|---|---|
| `users.mfa_verifications` | `[]`（无 TOTP / 备份码 / passkey） |
| `users.logto_config` | `{"mfa":{"enabled":false,"skipped":true},"passkey_sign_in":{"skipped":true}}` |
| `mfa.skipMfaOnSignIn` | **字段不存在** |
| `primary_email` / `primary_phone` | 均有 |
| 页面开关 | **开**（错误） |
| 登录时是否真的要求二次验证 | **否** |

---

## 2. 三条独立的判定链（根因）

### 2.1 展示侧：只读 `skipMfaOnSignIn`，缺省即"开"

- `GET /api/my-account/mfa-settings`（`packages/core/src/routes/account/index.ts`）
  只从 `logto_config.mfa.skipMfaOnSignIn` 取值，字段缺失时 `?? false`。
- 账户中心 `packages/account/src/pages/Security/MfaSection/index.tsx`：
  `isTwoStepEnabled = (skipMfaOnSignIn === false)`。

→ 只要用户从没手动动过这个开关（绝大多数用户），后端恒返 `false`，前端恒显示"开"。

### 2.2 执行侧：`MfaValidator.isMfaRequired` 读的是另外两个条件

`packages/core/src/routes/experience/classes/libraries/mfa-validator.ts`：

- adaptive MFA 结果存在时按风险判定（prod-1 `adaptive_mfa.enabled=false`，不走这条）；
- 否则：`(enabled === false || skipMfaOnSignIn) && 策略可跳过` → **不要求**；
- 否则返回 `hasUserFactors` = `getAllUserEnabledMfaVerifications()` 非空
  = 已存储因子（∩ SIE 已启用因子）**∪ 隐式 Email/Phone 因子**。

`systemtest` 命中 `enabled === false` → 直接短路 → 登录不要求二次验证。

### 2.3 写入侧：账户中心绑定因子**不写** `enabled`

- `packages/core/src/routes/account/mfa-verifications.ts` 的 TOTP / 备份码 / WebAuthn
  绑定分支只更新 `mfa_verifications`，完全不碰 `logtoConfig`。
- 而 `enabled` 只有登录流程（`routes/experience/.../mfa.ts`、`submit-interaction.ts`）
  和注册流程会写；注册时 provision 直接写死
  `logtoConfig: { mfa: { enabled: false } }`（`classes/libraries/provision-library.ts`）。

→ 新注册用户天然 `enabled=false`；在账户页添加验证器**不会**真正开启两步验证；
把页面开关拨到"开"也只写 `skipMfaOnSignIn`，`enabled=false` 依旧短路 → **开关无效**。

---

## 3. 客户端可见的 API：目前没有一个能给出准确状态

NiceMatrix-Backend **不返回**任何两步验证状态（全仓仅 admin 侧
`POST /v1/admin/end-users/{userId}/mfa/reset` 与孤儿清理脚本涉及 MFA），
客户端只能读 Logto Account API：

| 接口 | 返回 | 为什么不准 |
|---|---|---|
| `GET /api/my-account/mfa-settings` | 仅 `skipMfaOnSignIn` | 同 §2.1，缺省恒为"开" |
| `GET /api/my-account/mfa-verifications` | 仅已存储因子列表 | 不含隐式 Email/Phone；不反映 `enabled` → 两个方向都会错 |
| `GET /api/my-account/logto-configs` | 原始 `mfa.{enabled,skipped,skipMfaOnSignIn}` + `passkeySignIn.skipped` | `enabled` 的语义是"用户是否主动绑过因子"，不是"两步验证是否生效"；直接展示必错 |
| `GET /api/my-account`（profile） | `hasPassword` / `hasSecurityVerificationMethod` / `ssoIdentities` | 完全不含 MFA 状态 |

后端集成文档 `nicematrix-backend/docs/integration/logto-account-api.md` §5 目前还写着
"Logto v1.39 加入了统一 2FA toggle，可以在 Account Center UI 一键开关 MFA" —— 与实际不符，
需一并修订。

---

## 4. 与 Package A（隐式 Email/Phone fallback）的冲突 ⚠️

用户约束 #2（不能因为有邮箱就算开启两步验证）与现网既有设计存在**正面冲突**，
这是后续决策的核心分歧点：

- `docs/mfa-deadlock-prevention.md` 为防止"只绑一个 passkey/TOTP 丢失即锁死"，
  刻意在 SIE `mfa.factors` 中启用了 `EmailVerificationCode` + `PhoneVerificationCode`，
  并配套把 `signIn.methods[email].verificationCode` 改为 `false`。
- Logto 的 `getProfileMfaFactors()` 会把用户的 `primaryEmail` / `primaryPhone`
  **隐式**当作可用的第二因子，无需任何绑定动作。
- 后果：对 `enabled` 未设置的历史用户，`isMfaRequired` = "有邮箱或手机" = **真的会**
  在登录时要求邮件/短信验证码。这不是显示问题，而是**真实的强制行为**。

因此"准确显示"落地前必须先定义清楚：**隐式 Email/Phone 因子算不算"两步验证已开启"**。

- 若按事实口径（会被要求验证码 = 开启）→ 与约束 #2 冲突；
- 若按约束 #2（隐式因子不算开启）→ 必须同时改变**登录强制逻辑**（不能只改显示），
  否则显示与行为再次不一致；而改强制逻辑会削弱 Package A 的死锁防御。

---

## 5. prod-1 现网数据分布（2026-09-09 实测）

按 `logto_config.mfa.enabled` × `skipMfaOnSignIn` × 是否有已存储因子分组：

| 分组 | 人数 |
|---|---|
| `enabled` 未设 + 无因子 | 143,253 |
| `enabled=false` + 无因子 | 134 |
| `enabled=true` + 有因子 | 73 |
| `enabled=false` + **有因子** | 19 |
| `enabled=true` + `skipMfaOnSignIn=true` + 有因子 | 11 |
| `enabled=false` + `skipMfaOnSignIn=true` + 无因子 | 1 |

`enabled` 未设的 143,253 人中，按联系方式细分（决定隐式因子是否存在）：

| 分组 | 人数 | 现有强制行为 |
|---|---|---|
| 仅有手机 | 115,017 | 登录会被要求短信验证码 |
| 仅有邮箱 | 101 | 登录会被要求邮件验证码 |
| 邮箱 + 手机 | 2 | 同上 |
| 无邮箱无手机 | 28,133 | 不要求 |

近 14 天 Logto `logs` 表中**没有任何 MFA 校验事件**（仅 12 条
`Interaction.SignIn.BindMfa.BackupCode.Submit`），说明上述 11.5 万历史账号目前
基本没有经 Logto 登录，隐式短信 2FA 尚未大规模触发 —— 但客户端放量前必须先处置。

值得单独注意的 19 人：已绑了 TOTP/备份码/passkey，但 `enabled=false`，
**他们以为开了、实际没开**（登录不会要求二次验证）。

---

## 6. 上游（logto-io/logto）情况

本地 `logto-upstream` 检出为 v1.41.0（`91e55698a`，2026-06-30），
已 fetch 至 `origin/master`（2026-09-05，落后 306 个提交）后比对：

- ✅ **已修**：`d91696c70 fix(core): enable MFA after binding a factor via Account APIs (#9193)`
  （2026-07-14）—— 账户 API 绑定 TOTP / 备份码 / WebAuthn 时写 `logtoConfig.mfa.enabled=true`。
  注意：**删除**最后一个因子时并不会写回 `enabled=false`。
- ❌ **未修**：显示口径。`origin/master` 的 `GET /api/my-account/mfa-settings` 仍只返回
  `skipMfaOnSignIn`，`MfaSection` 仍是 `isTwoStepEnabled = skipMfaOnSignIn === false`。
  这部分若要修，只能我们自己 override（并建议向上游反馈）。

---

## 7. 候选方案（未决，供后续决策）

### 方案 A：服务端统一事实源 + 前端如实展示

1. core 新增共享判定（如 `libraries/user-mfa-state.ts`）：由 SIE 设置 + 用户数据算出
   `usableFactors` 与 `isEnforcedAtSignIn`；`MfaValidator.isMfaRequired` 改为消费同一函数，
   保证展示 / API / 强制三处不可能漂移。
2. `GET /api/my-account/mfa-settings` 增补 `isEnabled` / `hasUsableFactor` / `usableFactors`
   （纯新增字段，旧客户端不受影响）；账户中心开关绑定 `isEnabled`。
3. 开关"打开" = 写 `enabled=true` + 清 `skipMfaOnSignIn`；无可用因子时不允许打开。
   开关"关闭" = 写 `skipMfaOnSignIn=true`。
4. cherry-pick 上游 #9193。
5. 必须先解决 §4 的隐式因子口径问题，否则"准确"无从定义。

### 方案 B（约束 #3 的兜底）：移除该显示项

账户中心去掉「两步验证」开关这一项，客户端同步不展示任何 2FA 状态，
只保留"添加/管理验证方式"入口。代价最小、不会说谎，但用户失去总开关。

### 方案 C：口径对齐到约束 #2

把隐式 Email/Phone 排除出"两步验证已开启"的定义，同时调整登录强制逻辑，
使其与显示一致 —— 需重新评估 Package A 的死锁防御（可能改为强制备份码等替代手段）。

### 共同的遗留决策项

- 19 个"有因子但 `enabled=false`"的用户是否回填 `enabled=true`（回填 = 他们下次登录
  真的会被要求二次验证）。
- 11.5 万历史用户的隐式短信/邮箱 2FA 是保留、收敛还是关闭。
- 客户端（NiceNote / NiceList / NiceRecorder 等）当前是否已经在展示 2FA 状态；
  若有，需按最终口径统一下发（跨仓，交由各自 agent 执行）。

---

## 8. 实施影响面预估（若走方案 A/C）

- 改动仓库：`nicematrix-id`（Logto 自编译镜像），约 6 个 override 文件
  （`core` 的 account 路由 / mfa-validator / 新增 library、`schemas` 的响应 guard、
  `account` 的 `MfaSection`），其中 #9193 属上游回合，升级后可退役。
- 目标是不新增 i18n key（复用现有 `account_center.security.no_verification_method_warning`）；
  如确需新增，按 GLOBAL_I18N_STANDARD 补齐全部 locale。
- 文档需同步：`nicematrix-backend/docs/integration/logto-account-api.md` §5、
  本仓 `docs/mfa-deadlock-prevention.md`。
- 部署：镜像重建 → id-staging 验证 → prod-1（重启中断登录约 10–30s，**高风险，需单独确认**）。
  prod-3(cn) 跨境共用 prod-1 Logto，一次生效。

---

## 附录 A：核对方式（可复现）

- 部署态核对：本文所有代码判定均在**运行中的容器**内逐行确认，非仅比对本地仓库
  （`docker exec nicematrix-logto sh -lc 'sed -n ... /etc/logto/packages/core/src/...'`），
  确认与 `logto-upstream` v1.41.0 一致，不是版本差异。
- 用户状态：
  `select id, username, primary_email, primary_phone, mfa_verifications::text, logto_config::text from users where username='systemtest';`
- 分布统计：按 `logto_config->'mfa'->>'enabled'`、`->>'skipMfaOnSignIn'`、
  `jsonb_array_length(mfa_verifications::jsonb)>0` 分组计数。
- SIE：`select tenant_id, mfa, adaptive_mfa, passkey_sign_in from sign_in_experiences;`
  → admin 租户 `policy=PromptOnlyAtSignIn`，
  `factors=[Totp, BackupCode, EmailVerificationCode, PhoneVerificationCode]`，
  `adaptive_mfa.enabled=false`，`passkey_sign_in.enabled=true`。
  （注：`WebAuthn` 已不在 `factors` 中，passkey 由独立 passkey 区块承载。）

## 附录 B：关键文件清单

| 作用 | 路径（`logto-upstream/`） |
|---|---|
| 展示侧 API | `packages/core/src/routes/account/index.ts`（`/mfa-settings` GET/PATCH） |
| 因子绑定 API | `packages/core/src/routes/account/mfa-verifications.ts` |
| 原始 flag API | `packages/core/src/routes/account/logto-config.ts`（`/logto-configs`） |
| 登录强制判定 | `packages/core/src/routes/experience/classes/libraries/mfa-validator.ts` |
| 可用因子（含隐式） | `packages/core/src/routes/experience/classes/helpers.ts`（`getProfileMfaFactors` / `getAllUserEnabledMfaVerifications`） |
| 注册期写 `enabled:false` | `packages/core/src/routes/experience/classes/libraries/provision-library.ts` |
| flag 读写工具 | `packages/core/src/libraries/user-logto-config.ts` |
| 字段定义 | `packages/schemas/src/types/user-logto-config.ts` |
| 账户中心开关 | `packages/account/src/pages/Security/MfaSection/index.tsx` |
| 开关可见性判定 | `packages/account/src/utils/security-page.ts` |
