-- Rollback of 20261008_email_templates_zh_tw.sql: remove exactly the rows it added.
-- zh-TW / zh-HK readers then fall back to zh-CN templates (core override, docs/patches.md #16).
-- Restart Logto afterwards (in-process template cache).

DELETE FROM email_templates
WHERE tenant_id = 'admin' AND language_tag = 'zh-TW'
  AND id IN ('nm_tpl_bindmfa_zhtw', 'nm_tpl_bindid_zhtw', 'nm_tpl_forgotpw_zhtw', 'nm_tpl_generic_zhtw', 'nm_tpl_mfaverify_zhtw', 'nm_tpl_orginvite_zhtw', 'nm_tpl_register_zhtw', 'nm_tpl_signin_zhtw', 'nm_tpl_userperm_zhtw');
