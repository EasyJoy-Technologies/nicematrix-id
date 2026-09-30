-- 20260929: Sign in with Apple authorization-code hand-off + change-notification column grants.
--
-- 1) nicematrix_apple_authorization_codes
--    Logto (libraries/apple-authorization-capture.ts) records the one-time authorization code Apple
--    posts back on every Apple sign-in / link / re-verification. NiceMatrix Backend on prod-1
--    (apple-siwa/) exchanges it for a refresh_token within Apple's 5-minute code validity, stores that
--    token encrypted in the Backend DB, and deletes the row. The refresh_token is what
--    https://appleid.apple.com/auth/revoke needs when the account is deleted or Apple is unlinked
--    (App Store guideline 5.1.1(v)). Rows are short-lived; the Backend also purges stale ones.
--    No id_token / email is stored here.
--
-- 2) users column grants for the Backend maintenance role: `updated_at` (change watermark) and
--    `password_updated_at` (password-change detection) for the account-change e-mail notice.
--
-- Idempotent. Additive only: Logto without the capture code and the Backend without apple-siwa/
-- keep working on this schema. Apply BEFORE the Logto image that writes the table (a missing table
-- is only logged by Logto, never fails sign-in, but codes would be lost).

CREATE TABLE IF NOT EXISTS nicematrix_apple_authorization_codes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  apple_sub   varchar(255) NOT NULL,
  client_id   varchar(255) NOT NULL,
  code        varchar(512) NOT NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT nicematrix_apple_authorization_codes__code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS nicematrix_apple_authorization_codes__created
  ON nicematrix_apple_authorization_codes (created_at);

-- Logto refuses to start unless EVERY public table has row-level security enabled
-- (packages/core/src/env-set/preconditions.ts). No policy on purpose: the Logto owner role (superuser)
-- and nicematrix_backend_maintenance both have BYPASSRLS; any other role is denied by default.
ALTER TABLE nicematrix_apple_authorization_codes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE nicematrix_apple_authorization_codes IS
  'NiceMatrix: Apple one-time authorization codes awaiting exchange by NiceMatrix Backend (prod-1).';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nicematrix_backend_maintenance') THEN
    GRANT SELECT, DELETE ON nicematrix_apple_authorization_codes TO nicematrix_backend_maintenance;
    GRANT SELECT (updated_at, password_updated_at) ON users TO nicematrix_backend_maintenance;
  END IF;
END
$$;
