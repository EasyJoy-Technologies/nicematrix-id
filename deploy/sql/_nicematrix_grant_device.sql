-- [NiceMatrix] Device-session binding table for OIDC grants.
--
-- Purpose: persist (device_ref, app_slug) keyed by the OIDC grant id so the
-- access token claim producer (oidc/extra-token-claims-device.ts) can emit
-- them on EVERY token issuance for that grant - including refresh-token
-- rotations, where oidc-provider does not carry custom `extra` fields.
--
-- This table is NiceMatrix-only and NOT part of Logto's managed schema /
-- tenant system (grant_id, a global nanoid, is the natural unique key).
-- The write/read paths are fail-soft: if this table is absent the system
-- behaves exactly as before (no claim emitted -> backend lease check
-- fail-open exempts the token). So this migration is an *enabler*, applied
-- AFTER the fail-soft image is deployed.
--
-- IMPORTANT - two hard requirements Logto imposes on EVERY table in its DB,
-- both of which this script satisfies (do NOT create the table without them):
--
--  1. Row-level security. Logto refuses to *boot* if any table in its database
--     lacks RLS (checkRowLevelSecurity precondition). We enable RLS and add a
--     single PERMISSIVE policy. This table is NOT tenant-scoped (no tenant_id;
--     grant_id is globally unique), so `using (true) with check (true)` is the
--     correct model.
--
--  2. Per-request role grant. Logto does NOT run queries as the connection
--     owner (logto); each request switches to the restricted, no-login role
--     logto_tenant_logto via SET ROLE (see upstream
--     packages/schemas/tables/_after_all.sql which grants DML on every managed
--     table to logto_tenant_${database}). Without an explicit grant to that
--     role, every insert/select from the running app fails with
--     "permission denied for table _nicematrix_grant_device" (silently, since
--     the store is fail-soft). We grant DML to logto_tenant_logto (role name
--     for the `logto` database; identical on staging and prod-1).
--
-- Apply (manual, idempotent):
--   docker exec -i <logto-postgres> psql -U logto -d logto -f - < _nicematrix_grant_device.sql

create table if not exists _nicematrix_grant_device (
  grant_id   varchar(64)  primary key,
  device_ref varchar(64)  not null,
  app_slug   varchar(128) not null,
  created_at timestamptz  not null default now()
);

create index if not exists nicematrix_grant_device__created_at
  on _nicematrix_grant_device (created_at);

-- (1) RLS: satisfy Logto's "every table must enforce RLS" boot precondition.
alter table _nicematrix_grant_device enable row level security;
drop policy if exists nicematrix_grant_device_all on _nicematrix_grant_device;
create policy nicematrix_grant_device_all
  on _nicematrix_grant_device
  using (true)
  with check (true);

-- (2) Grant DML to the restricted per-request role Logto switches to (SET ROLE).
grant select, insert, update, delete
  on _nicematrix_grant_device
  to logto_tenant_logto;

-- Bounded-growth cleanup (run periodically, e.g. daily cron):
--   delete from _nicematrix_grant_device where created_at < now() - interval '370 days';
