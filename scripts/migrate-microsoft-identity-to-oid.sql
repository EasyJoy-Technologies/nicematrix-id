-- migrate-microsoft-identity-to-oid.sql
-- One-time prod-1 Logto data normalization paired with the connector-oidc
-- identitySource=oid override (2026-06-18).
--
-- Context: the Microsoft connector was migrated azuread->oidc on 2026-06-17.
-- Stock oidc keyed identity on the pairwise `sub`, re-orphaning existing
-- Microsoft users. We switch the Microsoft connector to key on `oid` (tenant-
-- stable, Graph-aligned). Existing stored ids must be normalized to oid form in
-- the SAME transaction as the connector config flip so there is no window where
-- config=oid but data is still in the old form.
--
-- Affected rows (verified 2026-06-18 against prod-1):
--   * ybksi0v7ysgi (xianglin.kong) : azuread.userId 'f6a2d4fcbb835d1a' (MSA CID,
--       = oid tail) -> full oid '00000000-0000-0000-f6a2-d4fcbb835d1a'.
--       (Verified identical account: that user's real login id_token carried
--        oid=00000000-0000-0000-f6a2-d4fcbb835d1a.)
--   * ii1r0gcbut29 (jie.hua)       : azuread binding is a `sub` value whose real
--       oid (00000000-0000-0000-a8b1-c094aed2b37e) is ALREADY held by legacy_cn
--       user d0mcdcpvc7jy. Per decision: DELETE jie.hua's azuread binding (the
--       Microsoft account resolves to d0mcdcpvc7jy under oid). jie.hua keeps
--       username+email+phone+password, so no lockout.
--   * g097omts8ghb / d0mcdcpvc7jy / qqhi9sc6yz7j (legacy_cn): already full oid,
--       NOT touched.
--
-- Connector: e2kv69i2f7o22b594w5s7 (oidc, Microsoft) -> config.identitySource='oid'.
--
-- Idempotent: re-running is a no-op (xianglin update is keyed on the exact old
-- value; jie.hua delete is keyed on `? 'azuread'`; config set is value-stable).
-- Transactional: all-or-nothing.

\set ON_ERROR_STOP on

BEGIN;

-- 0. Pre-flight asserts (fail the txn if reality drifted from what we verified).

-- xianglin must currently hold the CID (or already be migrated).
DO $$
DECLARE v text;
BEGIN
  SELECT identities->'azuread'->>'userId' INTO v FROM users WHERE id='ybksi0v7ysgi';
  IF v IS NULL THEN
    RAISE EXCEPTION 'xianglin ybksi0v7ysgi has no azuread identity (unexpected)';
  END IF;
  IF v NOT IN ('f6a2d4fcbb835d1a','00000000-0000-0000-f6a2-d4fcbb835d1a') THEN
    RAISE EXCEPTION 'xianglin azuread.userId is %, expected CID or migrated oid', v;
  END IF;
END $$;

-- The target oid must not already be held by a DIFFERENT user (collision guard).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM users
   WHERE id <> 'ybksi0v7ysgi'
     AND identities->'azuread'->>'userId' = '00000000-0000-0000-f6a2-d4fcbb835d1a';
  IF n > 0 THEN
    RAISE EXCEPTION 'target oid already held by % other user(s) -- aborting', n;
  END IF;
END $$;

-- 1. xianglin: CID -> full oid (userId + details.id together).
UPDATE users
   SET identities = jsonb_set(
         jsonb_set(identities, '{azuread,userId}', '"00000000-0000-0000-f6a2-d4fcbb835d1a"'::jsonb, false),
         '{azuread,details,id}', '"00000000-0000-0000-f6a2-d4fcbb835d1a"'::jsonb, false)
 WHERE id='ybksi0v7ysgi'
   AND identities->'azuread'->>'userId' = 'f6a2d4fcbb835d1a';

-- 2. jie.hua: remove the stale `sub`-based azuread binding (duplicate of legacy_cn oid).
UPDATE users
   SET identities = identities - 'azuread'
 WHERE id='ii1r0gcbut29'
   AND identities ? 'azuread';

-- 3. Flip the Microsoft connector to key identity on `oid`.
--    (Field is additive; old image ignored it. New image reads it fresh per login.)
UPDATE connectors
   SET config = jsonb_set(config, '{identitySource}', '"oid"'::jsonb, true)
 WHERE id='e2kv69i2f7o22b594w5s7'
   AND connector_id='oidc';

-- 4. Post-conditions (verify inside the txn; any failure rolls everything back).
DO $$
DECLARE v_x text; v_j boolean; v_c text;
BEGIN
  SELECT identities->'azuread'->>'userId' INTO v_x FROM users WHERE id='ybksi0v7ysgi';
  IF v_x <> '00000000-0000-0000-f6a2-d4fcbb835d1a' THEN
    RAISE EXCEPTION 'post: xianglin oid not set (got %)', v_x;
  END IF;

  SELECT (identities ? 'azuread') INTO v_j FROM users WHERE id='ii1r0gcbut29';
  IF v_j THEN
    RAISE EXCEPTION 'post: jie.hua azuread binding still present';
  END IF;

  SELECT config->>'identitySource' INTO v_c FROM connectors WHERE id='e2kv69i2f7o22b594w5s7';
  IF v_c <> 'oid' THEN
    RAISE EXCEPTION 'post: connector identitySource not oid (got %)', v_c;
  END IF;

  -- Final uniqueness sweep: no two azuread users share a userId.
  PERFORM 1 FROM (
    SELECT identities->'azuread'->>'userId' AS uid, count(*) c
      FROM users WHERE identities ? 'azuread'
     GROUP BY 1 HAVING count(*) > 1
  ) dup;
  IF FOUND THEN
    RAISE EXCEPTION 'post: duplicate azuread userId detected after migration';
  END IF;

  RAISE NOTICE 'migration OK: xianglin oid set, jie.hua binding removed, connector identitySource=oid, no dup userIds';
END $$;

COMMIT;
