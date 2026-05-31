# Runtime Tenant Config (prod-1 `admin` tenant)

> These are **runtime DB-state** configurations stored in the `logto_configs`
> table — NOT source overrides (see `patches.md` for overrides). They survive
> container restarts but are **wiped by a fresh re-seed / DB reset**. After any
> tenant re-seed, re-apply every item below.

## 1. id_token extended claims — include `custom_data`

- **Key:** `logto_configs(tenant_id='admin', key='idToken')`
- **Value:** `{"enabledExtendedClaims": ["roles","organizations","organization_roles","custom_data"]}`
- **Default Logto seed (for contrast):** `["roles","organizations","organization_roles"]` (no `custom_data`).
- **Applied:** 2026-05-31, via Management API `PUT /api/configs/id-token`.

### Why
NiceMatrix migrates each legacy CN user's `t_user.user_identify` into Logto
`users.custom_data.legacy_user_identify`. The cloud-sync (netdisk) client must
learn that legacy id **without a dedicated lookup** (new users must not need any
special query either). Enabling `custom_data` as an id_token extended claim makes
every login / refresh id_token carry the `custom_data` object:

| User type | id_token `custom_data` |
|---|---|
| Migrated (legacy CN) | `{ legacy_user_identify: "UE...", source, legacy_phone_e164, legacy_account_check, legacy_phone_country }` |
| New / native-registered | `{}` (no `legacy_user_identify`) |

The client uses **presence of `legacy_user_identify`** as the legacy/new
discriminator. Absent ⇒ treat as a new user; no branch query.

### Properties (verified against the running 1.40.1 image, prod-1)
- **Effective immediately, no restart.** `PUT /api/configs/id-token` runs through
  `wellKnownCache.mutate` (cache invalidation). prod-1 runs Logto **without Redis**,
  so the config is effectively read from DB on every token issuance.
- **Covers BOTH login paths.** Standard `authorization_code` and the NiceMatrix
  `token-exchange` override (native social: wechat/alipay/qq) both build the
  id_token via the same `account.claims('id_token', scope, …)` pipeline that reads
  this config.
- **Scope-gated.** Only requests whose `scope` contains `custom_data` receive the
  claim. The client SDK config already lists `custom_data` (see backend
  `docs/integration/logto-sdk.md`).
- **access_token is unaffected** — `custom_data` is an id_token / userinfo claim
  only; API access tokens do not carry it.
- **Tenant-scoped.** Only the `admin` tenant is changed; the built-in `default`
  (console) tenant is left at the stock seed.

### Trade-off (accepted)
The id_token carries the **whole** `custom_data` object (for migrated users that
includes `legacy_phone_e164` / `legacy_account_check` / `source`). This is the
user's own data delivered to the user's own first-party app under an explicit
`custom_data` grant — acceptable. A single-claim projection is **not** natively
possible: Logto's JWT customizer supports only `access-token` and
`client-credentials` token types — there is no id_token customizer — so a
projection would require a source override, which is not warranted here.

### Re-apply / verify
```bash
# idempotent; needs admin-tenant M2M creds (resource = .../admin/api)
M2M_ID=m-admin M2M_SECRET=*** ./scripts/ensure-idtoken-custom-data-claim.sh          # apply
M2M_ID=m-admin M2M_SECRET=*** ./scripts/ensure-idtoken-custom-data-claim.sh --check  # report only
```

### Rollback
`PUT /api/configs/id-token` with `{"enabledExtendedClaims":["roles","organizations","organization_roles"]}`.
Backups of the before/after value were saved on the ops host under
`/root/backups/prod1-logto-idtoken-config-*.json` (2026-05-31).
