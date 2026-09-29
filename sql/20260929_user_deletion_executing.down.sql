-- Emergency rollback of 20260929_user_deletion_executing.sql.
-- Roll the Backend due-scanner AND the Logto image back first; both reference 'executing'.
-- Any row still 'executing' is returned to 'failed' so a human reviews it (it may be
-- partially executed — never put it back to 'pending', which a user could then cancel).

UPDATE user_deletion_requests
   SET status = 'failed',
       last_error = coalesce(last_error, 'rolled_back_while_executing')
 WHERE status = 'executing';

CREATE UNIQUE INDEX IF NOT EXISTS user_deletion_requests__open_per_user
  ON user_deletion_requests (tenant_id, user_id)
  WHERE status IN ('awaiting_confirmation', 'pending');
DROP INDEX IF EXISTS user_deletion_requests__open_per_user_v2;
DROP INDEX IF EXISTS user_deletion_requests__executing;

ALTER TABLE user_deletion_requests
  DROP CONSTRAINT IF EXISTS user_deletion_requests__status_check;
ALTER TABLE user_deletion_requests
  ADD CONSTRAINT user_deletion_requests__status_check
  CHECK (status IN ('awaiting_confirmation', 'pending', 'cancelled', 'executed', 'failed'));

ALTER TABLE user_deletion_requests
  DROP COLUMN IF EXISTS lease_until,
  DROP COLUMN IF EXISTS lease_owner,
  DROP COLUMN IF EXISTS next_attempt_at,
  DROP COLUMN IF EXISTS attempt_count;
