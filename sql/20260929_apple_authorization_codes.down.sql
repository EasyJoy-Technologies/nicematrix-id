-- Rollback of 20260929_apple_authorization_codes.sql.
-- Roll the Logto image back first (it writes the table; a missing table is only logged).
-- Pending codes are lost — affected users get a refresh_token on their next Apple sign-in.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nicematrix_backend_maintenance') THEN
    REVOKE SELECT (updated_at, password_updated_at) ON users FROM nicematrix_backend_maintenance;
  END IF;
END
$$;

DROP TABLE IF EXISTS nicematrix_apple_authorization_codes;
