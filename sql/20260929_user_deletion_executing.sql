-- 20260929: user_deletion_requests — atomic execution claim + retry budget.
--
-- Problems fixed (NiceNote docs/auth/account-center-code-review-2026-09-27.md §10, N4 + N12):
--   N12  The Backend due-scanner SELECTed due 'pending' rows and executed them without
--        claiming. A user cancelling during execution still lost the account, and the
--        scanner then overwrote 'cancelled' with 'executed'.
--   N4   Any failure flipped the row to 'failed', which nothing ever scanned again, so one
--        transient error permanently stopped a partially executed deletion.
--
-- New lifecycle (authoritative; Backend due-scanner + Logto deletion-request route follow it):
--   awaiting_confirmation -> pending -> executing -> executed
--                                        executing -> executing (retry: next_attempt_at, backoff)
--                                        executing -> failed    (attempt budget exhausted; ops alert)
--   'executing' is irreversible: the store fence is already set and the Logto user may already
--   be gone, so the cancel route refuses it (409 user.deletion_request_executing).
--   'failed' keeps meaning "stopped, needs a human" — historical 'failed' rows are left as-is.
--
-- Forward/backward compatible for rolling deploy: every new column is nullable or has a
-- default, and the old Backend (which never writes 'executing') keeps working unchanged.
-- Apply BEFORE rolling out the Backend due-scanner that uses these columns.

ALTER TABLE user_deletion_requests
  ADD COLUMN IF NOT EXISTS attempt_count   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_owner     varchar(128),
  ADD COLUMN IF NOT EXISTS lease_until     timestamptz;

ALTER TABLE user_deletion_requests
  DROP CONSTRAINT IF EXISTS user_deletion_requests__status_check;
ALTER TABLE user_deletion_requests
  ADD CONSTRAINT user_deletion_requests__status_check
  CHECK (status IN ('awaiting_confirmation', 'pending', 'executing', 'cancelled', 'executed', 'failed'));

-- One open request per (tenant, user) now also covers 'executing', so a user cannot open a
-- second request while the first one is being carried out.
CREATE UNIQUE INDEX IF NOT EXISTS user_deletion_requests__open_per_user_v2
  ON user_deletion_requests (tenant_id, user_id)
  WHERE status IN ('awaiting_confirmation', 'pending', 'executing');
DROP INDEX IF EXISTS user_deletion_requests__open_per_user;

-- Retry / crash-recovery lookup for claimed rows.
CREATE INDEX IF NOT EXISTS user_deletion_requests__executing
  ON user_deletion_requests (next_attempt_at)
  WHERE status = 'executing';

COMMENT ON COLUMN user_deletion_requests.attempt_count IS
  'Execution attempts (incremented when the Backend due-scanner claims the row).';
COMMENT ON COLUMN user_deletion_requests.next_attempt_at IS
  'Earliest retry time for an executing row after a failed attempt (exponential backoff).';
COMMENT ON COLUMN user_deletion_requests.lease_owner IS
  'Backend worker that currently holds the execution claim (host:pid).';
COMMENT ON COLUMN user_deletion_requests.lease_until IS
  'Execution claim expiry; an expired lease can be reclaimed after a crash.';

-- Backend maintenance role (see 20260824_backend_maintenance_role.sql): column grants for the
-- new fields. Guarded so this file also applies on hosts where the role does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nicematrix_backend_maintenance') THEN
    GRANT SELECT (attempt_count, next_attempt_at, lease_owner, lease_until)
      ON user_deletion_requests TO nicematrix_backend_maintenance;
    GRANT UPDATE (attempt_count, next_attempt_at, lease_owner, lease_until)
      ON user_deletion_requests TO nicematrix_backend_maintenance;
  END IF;
END
$$;
