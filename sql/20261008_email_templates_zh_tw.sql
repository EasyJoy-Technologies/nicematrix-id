-- Traditional Chinese (zh-TW) email templates — one per template type, mirroring the zh-CN set
-- (same structure / placeholders / footer; wording follows Logto's own zh-TW phrases: 帳戶, 兩步驗證, 登入).
--
-- Why: Logto now resolves zh-Hant* readers to zh-TW / zh-HK (docs/patches.md #16). zh-HK has no own
-- set on purpose: core `getI18nEmailTemplate` falls back zh-HK → zh-TW → zh-CN (same override).
-- Data-only, tenant `admin` (where this deployment's end users live); idempotent (unique
-- tenant_id + language_tag + template_type). Logto memoizes template lookups in its in-process
-- well-known cache (no Redis here) → restart Logto after applying so cached misses are dropped.
-- Decision: Xianglin 2026-10-08 11:52 MDT. Rollback: 20261008_email_templates_zh_tw.down.sql.

BEGIN;

INSERT INTO email_templates (tenant_id, id, language_tag, template_type, details) VALUES
  ('admin', 'nm_tpl_bindmfa_zhtw', 'zh-TW', 'BindMfa', '{"subject": "NiceMatrix帳戶兩步驗證設定碼", "content": "<p>您好，</p><p>您正在設定兩步驗證，驗證碼是：<strong>{{code}}</strong></p><p>驗證碼有效期為 10 分鐘，請勿將驗證碼透露給他人。</p><p>NiceMatrix Technologies</p>", "contentType": "text/html"}'::jsonb),
  ('admin', 'nm_tpl_bindid_zhtw', 'zh-TW', 'BindNewIdentifier', '{"subject": "NiceMatrix帳戶綁定驗證碼", "content": "<p>您好，</p><p>您正在綁定新的登入方式，驗證碼是：<strong>{{code}}</strong></p><p>驗證碼有效期為 10 分鐘，請勿將驗證碼透露給他人。</p><p>NiceMatrix Technologies</p>", "contentType": "text/html"}'::jsonb),
  ('admin', 'nm_tpl_forgotpw_zhtw', 'zh-TW', 'ForgotPassword', '{"subject": "NiceMatrix帳戶重設密碼驗證碼", "content": "<p>您好，</p><p>您的重設密碼驗證碼是：<strong>{{code}}</strong></p><p>驗證碼有效期為 10 分鐘。如果您沒有要求重設密碼，請忽略此郵件。</p><p>NiceMatrix Technologies</p>", "contentType": "text/html"}'::jsonb),
  ('admin', 'nm_tpl_generic_zhtw', 'zh-TW', 'Generic', '{"subject": "NiceMatrix帳戶驗證碼", "content": "<p>您好，</p><p>您的驗證碼是：<strong>{{code}}</strong></p><p>驗證碼有效期為 10 分鐘，請勿將驗證碼透露給他人。</p><p>NiceMatrix Technologies</p>", "contentType": "text/html"}'::jsonb),
  ('admin', 'nm_tpl_mfaverify_zhtw', 'zh-TW', 'MfaVerification', '{"subject": "NiceMatrix帳戶兩步驗證碼", "content": "<p>您好，</p><p>您的兩步驗證碼是：<strong>{{code}}</strong></p><p>驗證碼有效期為 10 分鐘，請勿將驗證碼透露給他人。</p><p>NiceMatrix Technologies</p>", "contentType": "text/html"}'::jsonb),
  ('admin', 'nm_tpl_orginvite_zhtw', 'zh-TW', 'OrganizationInvitation', '{"subject": "NiceMatrix帳戶組織邀請", "content": "<p>您好，</p><p>您收到了一份組織邀請，驗證碼是：<strong>{{code}}</strong></p><p>驗證碼有效期為 10 分鐘。</p><p>NiceMatrix Technologies</p>", "contentType": "text/html"}'::jsonb),
  ('admin', 'nm_tpl_register_zhtw', 'zh-TW', 'Register', '{"subject": "NiceMatrix帳戶註冊驗證碼", "content": "<p>您好，</p><p>您的註冊驗證碼是：<strong>{{code}}</strong></p><p>驗證碼有效期為 10 分鐘，請勿將驗證碼透露給他人。</p><p>NiceMatrix Technologies</p>", "contentType": "text/html"}'::jsonb),
  ('admin', 'nm_tpl_signin_zhtw', 'zh-TW', 'SignIn', '{"subject": "NiceMatrix帳戶登入驗證碼", "content": "<p>您好，</p><p>您的登入驗證碼是：<strong>{{code}}</strong></p><p>驗證碼有效期為 10 分鐘，請勿將驗證碼透露給他人。</p><p>NiceMatrix Technologies</p>", "contentType": "text/html"}'::jsonb),
  ('admin', 'nm_tpl_userperm_zhtw', 'zh-TW', 'UserPermissionValidation', '{"subject": "NiceMatrix帳戶安全驗證碼", "content": "<p>您好，</p><p>您正在進行敏感操作，驗證碼是：<strong>{{code}}</strong></p><p>驗證碼有效期為 10 分鐘，請勿將驗證碼透露給他人。</p><p>NiceMatrix Technologies</p>", "contentType": "text/html"}'::jsonb)
ON CONFLICT (tenant_id, language_tag, template_type) DO NOTHING;

COMMIT;
