# Runtime Tenant Config (prod-1 `admin` tenant)

> These are **runtime DB-state** configurations — NOT source overrides (see
> `patches.md` for overrides). They survive container restarts but are **wiped
> by a fresh re-seed / DB reset**. After any tenant re-seed, re-apply every item
> below. Items 1 live in `logto_configs`; item 2 lives in `connectors.config`.

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

## 2. Microsoft (azuread) OIDC connector — `prompt=select_account`

- **Where:** `connectors.config.authRequestOptionalConfig.prompt = "select_account"`
- **Connector ids:** prod-1 `e2kv69i2f7o22b594w5s7`, staging `f4qdrpq50l4x`
  (both standard `oidc` connector, `target=azuread`). prod-3 (cn) shares prod-1
  Logto cross-border — no separate change.
- **Applied:** 2026-06-18.

### Why
The "Connect OneDrive" incremental-authorization branch where a **non-Microsoft
user binds Microsoft for the first time** was forcing a full password sign-in.
The standard OIDC connector builds the Microsoft authorize URL as
`scope: customScope ?? scope, … , ...authRequestOptionalConfig` (override
`connector-oidc/src/index.ts`). `scope` is per-request overridable, but `prompt`
is **only** sourced from connector config — the client (via
`POST /api/verifications/social`) can pass `scope` but **cannot** inject
`prompt`. So `prompt` must be set on the connector.

`select_account` reuses the browser's Microsoft SSO cookie (**no password**) but
shows the account picker so the user confirms which Microsoft account is being
bound (prevents silent wrong-account binding). **Do NOT use `prompt=login`** — it
forces re-authentication (always asks for password), the exact behavior being
avoided.

### Scope passthrough (client responsibility)
The authorize URL uses `customScope ?? scope` = **replace**, not append. The
client's incremental request must therefore carry the **full** set
`openid profile email offline_access Files.ReadWrite` (not just
`Files.ReadWrite offline_access`), or `openid` is lost and id_token / renewal
break. The backend does **not** filter the scope.

### Properties (verified)
- **Effective immediately, no restart.** `connectors.config` is read fresh from
  DB per authorize (`getConnectorConfig → findAllConnectors → connector.config`).
  The `connectors-well-known` cache stores only `id/metadata/connectorId`, not
  `config`.
- **Connector-level, not per-scenario.** All Microsoft flows through this
  connector (normal login + OneDrive incremental) share this `prompt`. Side
  effect: Microsoft-login users now also see an account-picker step (still
  passwordless). Accepted.
- Microsoft accepts the params (HTTP 200, normal sign-in UI, no hard AADSTS
  config error) for both staging + prod-1 redirect_uris.

### Rollback
Remove the key:
```sql
update connectors set config = config - 'authRequestOptionalConfig'
  where id='e2kv69i2f7o22b594w5s7';   -- prod-1 (staging: f4qdrpq50l4x)
```
Before/after row + config backups on the ops host:
`/root/backups/onedrive-prompt-select-account/` (2026-06-18).
