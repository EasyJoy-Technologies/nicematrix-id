-- NiceMatrix account-deletion receipt-mail idempotency marker.
--
-- This schema is owned by NiceMatrix-ID. Backend code must not perform DDL at
-- runtime; the additive, nullable column keeps both old and new Backend builds
-- forward/backward compatible during rolling deployment.

ALTER TABLE user_deletion_requests
  ADD COLUMN IF NOT EXISTS scheduled_email_sent_at timestamptz;

COMMENT ON COLUMN user_deletion_requests.scheduled_email_sent_at IS
  'Timestamp of the successful deletion-scheduled receipt email; owned by NiceMatrix-ID schema migrations.';
