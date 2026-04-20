-- 20260420: NiceMatrix — user self-service account deletion with grace period.
--
-- Flow (see docs/account-deletion.md):
--   1. User clicks "Delete my account" in Account Center → POST /api/my-account/deletion-request
--      with re-verification (password / mfa). Row inserted, status='awaiting_confirmation',
--      confirmation_token generated, email sent.
--   2. User clicks the link in email → POST /api/my-account/deletion-request/confirm
--      with the token. Row flipped to status='pending', scheduled_at = now() + 15 days.
--   3. User may cancel any time before scheduled_at → DELETE /api/my-account/deletion-request
--      sets status='cancelled', scheduled_at cleared.
--   4. NiceMatrix-Backend cron scans status='pending' AND scheduled_at <= now()
--      every hour, then calls Logto DELETE /api/users/:userId and flips the row
--      to status='executed'.

CREATE TABLE IF NOT EXISTS user_deletion_requests (
  id                  varchar(21) PRIMARY KEY,
  tenant_id           varchar(21) NOT NULL,
  user_id             varchar(12) NOT NULL,
  status              varchar(32) NOT NULL DEFAULT 'awaiting_confirmation',
    -- awaiting_confirmation | pending | cancelled | executed | failed
  reason              text,
  created_ip          varchar(128),
  confirmation_token  varchar(128),
    -- opaque token (sha256 of random bytes), cleared after confirmation.
  confirmation_token_expires_at timestamptz,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  confirmed_at        timestamptz,
  scheduled_at        timestamptz,
  cancelled_at        timestamptz,
  executed_at         timestamptz,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_deletion_requests__status_check
    CHECK (status IN ('awaiting_confirmation', 'pending', 'cancelled', 'executed', 'failed'))
);

-- Only one open (awaiting_confirmation or pending) request per (tenant, user).
CREATE UNIQUE INDEX IF NOT EXISTS user_deletion_requests__open_per_user
  ON user_deletion_requests (tenant_id, user_id)
  WHERE status IN ('awaiting_confirmation', 'pending');

-- Cron lookup: find due pending rows efficiently.
CREATE INDEX IF NOT EXISTS user_deletion_requests__due
  ON user_deletion_requests (status, scheduled_at)
  WHERE status = 'pending';

-- Token lookup for confirmation endpoint.
CREATE INDEX IF NOT EXISTS user_deletion_requests__token
  ON user_deletion_requests (confirmation_token)
  WHERE confirmation_token IS NOT NULL;

-- updated_at trigger.
CREATE OR REPLACE FUNCTION user_deletion_requests__touch_updated_at()
  RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_deletion_requests_updated
  ON user_deletion_requests;
CREATE TRIGGER trg_user_deletion_requests_updated
  BEFORE UPDATE ON user_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION user_deletion_requests__touch_updated_at();

-- RLS — Logto enforces that every business table has row-level security,
-- scoped to the current tenant (matched by the Postgres role that the
-- Logto process is connecting as, via the `tenants.db_user` column).
ALTER TABLE user_deletion_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_deletion_requests_tenant_id ON user_deletion_requests
  AS RESTRICTIVE
  USING (
    tenant_id = (SELECT id FROM tenants WHERE db_user = CURRENT_USER)
  );
CREATE POLICY user_deletion_requests_modification ON user_deletion_requests
  AS PERMISSIVE
  USING (true);

-- Grant table permissions to each tenant role. Logto core connects as the
-- tenant role (e.g. `logto_tenant_logto`), not as the `logto` owner; RLS
-- alone is not enough — without these grants, queries fail with
-- `permission denied for table user_deletion_requests`.
DO $$
DECLARE
  role_name text;
BEGIN
  FOR role_name IN SELECT db_user FROM tenants WHERE db_user IS NOT NULL
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON user_deletion_requests TO %I',
      role_name
    );
  END LOOP;
END $$;
