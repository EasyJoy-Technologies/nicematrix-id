# MFA 死锁防御（Package A）

> 目标：避免用户只绑定一个 MFA factor 后，在该 factor 不可用时（设备丢失、浏览器
> 清空、passkey RP ID 改变、换设备等）**完全无法登录**。

## 背景

Logto 上游在 `/mfa-verification` 流程下判断"可用 factor"仅看 `mfaVerifications`
里的 factor `type`，**不检查 WebAuthn 是否在当前 origin 可用**。如果用户只
有一个 WebAuthn factor，且浏览器无法找到匹配 credential：
- 服务端返回 `availableFactors=[WebAuthn]`
- 前端直接跳 `/mfa-verification/WebAuthn`，且 `SwitchMfaFactorsLink` 因
  `availableFactors.length < 2` 而隐藏
- 浏览器调 `navigator.credentials.get()` 找不到 credential → 用户卡死

## 修复

### 1. 启用隐式 Email / Phone MFA fallback（SIE 配置）

在 `sign_in_experiences` (tenant `admin`) 的 `mfa.factors` 中加入：
- `EmailVerificationCode`
- `PhoneVerificationCode`

Logto 上游规则：
- 当一个 identifier 用作 sign-in `verificationCode=true` 时，它**不能**作
  MFA factor。因此同步将 `signIn.methods[email].verificationCode` 改为
  `false`（email 登录改为只密码）。
- `phone.verificationCode` 保持 `false`，以支持 PhoneVerificationCode 作
  MFA factor。
- 用户忘记密码时走现有"忘记密码"邮件 OTP 流程，体验退化很小。

`packages/core/src/routes/experience/classes/helpers.ts.getProfileMfaFactors()`
会**隐式**把用户的 `primaryEmail` / `primaryPhone` 映射到 Email/Phone MFA
factor——只要 SIE 开了这两个 factor，用户就自动获得 fallback，**无需为每
个用户手动绑定**。

### 2. `SwitchMfaFactorsLink` 组件 override

路径：`overrides/packages/experience/src/components/SwitchMfaFactorsLink/`

- 上游规则：`availableFactors.length >= 2` 才显示。
- 新规则：只要 `availableFactors` 里存在"**当前页面以外**"的 factor，就
  显示切换链接。
- URL 末尾段被识别为"当前 factor"（`/mfa-verification/WebAuthn` →
  `WebAuthn`）。当上游兜底数据结构扩展时，回退为上游行为（要求 ≥ 2）。

### 3. 绑定 Passkey 后强制 Backup Code

路径：`overrides/packages/account/src/pages/PasskeyBinding/index.tsx`

- Passkey 命名保存成功后：
  1. 若 SIE 启用 `BackupCode`，且用户既没有 `BackupCode` 也没有 `TOTP`，
     **自动跳转**到 `/backup-codes/generate` 而非 `/passkey/success`。
  2. 否则走原逻辑。
- 理由：`EmailVerificationCode`/`PhoneVerificationCode` 是隐式 fallback，
  但它们依赖服务器通道（邮件/短信）。BackupCode 是**离线**最后手段，必须
  有。

### 4. Admin 紧急重置 MFA 端点（NiceMatrix-Backend）

`POST /v1/admin/end-users/:userId/mfa/reset`

- 要求 `user.manage.write` 权限。
- 调用 Logto Management API 逐条 DELETE 所有 mfa_verifications。
- 写入 `admin_audit_logs`（action=`end_user.mfa_reset`）。
- 通过通知模板 `mfa_reset_by_admin` 给用户发安全告警邮件。
- 文件：`apps/api/src/modules/end-users.js` +
  `migrations/20260420_mfa_reset_template.sql`。

### 5. Passkey 自动检测（Conditional UI）

Logto 上游已实现 `usePasskeyAutofillConditionalUI`，并已在 SIE 里配置
`passkey_sign_in.allowAutofill=true, showPasskeyButton=true`。用户打开登
录页时：
- 浏览器支持 WebAuthn Autofill → 自动弹出 passkey 选择
- 用户可以不选 passkey，直接输密码走下方普通登录流程

**无需 override**。
