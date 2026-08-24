-- Least-privilege database role for NiceMatrix-Backend's host-local Logto
-- maintenance jobs. The password is deliberately not stored in source; set it
-- separately with ALTER ROLE after applying this file.
--
-- BYPASSRLS is required because these jobs intentionally operate across the
-- authoritative Logto tenant while the core tables use restrictive tenant RLS.
-- It does not grant table access: the explicit column grants below are the
-- complete data surface available to this role.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'nicematrix_backend_maintenance'
  ) THEN
    CREATE ROLE nicematrix_backend_maintenance
      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS;
  END IF;
END
$$;

ALTER ROLE nicematrix_backend_maintenance
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS;

GRANT CONNECT ON DATABASE logto TO nicematrix_backend_maintenance;
GRANT USAGE ON SCHEMA public TO nicematrix_backend_maintenance;
REVOKE CREATE ON SCHEMA public FROM nicematrix_backend_maintenance;

GRANT SELECT (
  id, tenant_id, user_id, status, reason, confirmation_token,
  confirmation_token_expires_at, scheduled_at, last_error,
  scheduled_email_sent_at
) ON user_deletion_requests TO nicematrix_backend_maintenance;

GRANT UPDATE (
  status, confirmed_at, scheduled_at, cancelled_at, executed_at, last_error,
  confirmation_token, confirmation_token_expires_at, updated_at,
  scheduled_email_sent_at
) ON user_deletion_requests TO nicematrix_backend_maintenance;

GRANT SELECT (
  tenant_id, id, username, primary_email, primary_phone, password_encrypted,
  name, profile, application_id, identities, custom_data, mfa_verifications,
  last_sign_in_at, created_at
) ON users TO nicematrix_backend_maintenance;

GRANT UPDATE (application_id) ON users TO nicematrix_backend_maintenance;
GRANT SELECT (id) ON applications TO nicematrix_backend_maintenance;
