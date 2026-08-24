-- Emergency rollback only. Dropping this column discards receipt idempotency
-- history and requires rolling Backend back before execution.

ALTER TABLE user_deletion_requests
  DROP COLUMN IF EXISTS scheduled_email_sent_at;
