-- [NiceMatrix] Device-session binding table for OIDC grants.
--
-- Purpose: persist (device_ref, app_slug) keyed by the OIDC grant id so the
-- access token claim producer (oidc/extra-token-claims-device.ts) can emit
-- them on EVERY token issuance for that grant — including refresh-token
-- rotations, where oidc-provider does not carry custom `extra` fields.
--
-- This table is NiceMatrix-only and NOT part of Logto's managed schema /
-- tenant system (grant_id, a global nanoid, is the natural unique key).
-- The write/read paths are fail-soft: if this table is absent the system
-- behaves exactly as before (no claim emitted → backend lease check
-- fail-open exempts the token). So this migration is an *enabler*, applied
-- AFTER the fail-soft image is deployed.
--
-- Apply (manual, idempotent):
--   docker exec -i <logto-postgres> psql -U postgres -d logto -f - < _nicematrix_grant_device.sql

create table if not exists _nicematrix_grant_device (
  grant_id   varchar(64)  primary key,
  device_ref varchar(64)  not null,
  app_slug   varchar(128) not null,
  created_at timestamptz  not null default now()
);

-- Supports the periodic cleanup of rows whose grant has certainly expired
-- (grant absolute TTL ceiling = 365d, see oidc/init.ts ttl.Grant).
create index if not exists nicematrix_grant_device__created_at
  on _nicematrix_grant_device (created_at);

-- Bounded-growth cleanup (run periodically, e.g. daily cron). Safe to run any
-- time: only deletes bindings older than the grant TTL ceiling, which can no
-- longer back a live token.
--   delete from _nicematrix_grant_device where created_at < now() - interval '370 days';
