/**
 * [NiceMatrix] grant-device-store.ts (new module, no upstream counterpart)
 *
 * Persists the device-session binding (device_ref, app_slug) keyed by the OIDC
 * `grant_id` in the `_nicematrix_grant_device` table, and reads it back.
 *
 * Why a side table instead of a token `extra` field: oidc-provider's
 * RefreshToken has no `extra` and a fixed `IN_PAYLOAD`, so custom fields do not
 * survive refresh rotations (upstream's own `act` claim has the same
 * limitation). The grant id is the only stable anchor that is preserved across
 * the whole refresh chain, so we key the binding on it and let the unified
 * `extraTokenClaims` producer look it up on EVERY issuance type
 * (authorization_code / refresh_token / token-exchange).
 *
 * Both functions are FAIL-SOFT: any error (table missing, DB hiccup, invalid
 * input) degrades to a no-op / undefined. The backend device-lease check is
 * fail-open on a missing claim, so a soft failure here simply means the token
 * is exempt from enforcement — never a login break.
 *
 * Write sites:
 *   - native (token-exchange): oidc/grants/token-exchange/index.ts
 *   - web   (authorization_code, incl. first-party auto-consent + third-party
 *            manual consent): libraries/session/consent.ts
 * Read site:
 *   - oidc/extra-token-claims-device.ts (merged into init.ts extraTokenClaims)
 */

import { sql, type CommonQueryMethods } from '@silverhand/slonik';

/** Canonical lowercase-hex UUID (matches backend `DEVICE_REF_RE`). */
const deviceRefRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** App slug: same shape the backend / Logto app_slug accepts. */
const appSlugRe = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

export type GrantDeviceBinding = {
  deviceRef: string;
  appSlug: string;
};

const normalize = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/**
 * Upsert the binding for a grant. No-op (silently) when grant id is missing or
 * when device_ref / app_slug are absent or fail validation — callers can pass
 * partial context without guarding.
 */
export const upsertGrantDevice = async (
  pool: CommonQueryMethods,
  grantId: unknown,
  deviceRef: unknown,
  appSlug: unknown
): Promise<void> => {
  try {
    const grant = normalize(grantId);
    const device = normalize(deviceRef);
    const slug = normalize(appSlug);

    if (!grant || !deviceRefRe.test(device) || !appSlugRe.test(slug)) {
      return;
    }

    await pool.query(sql`
      insert into _nicematrix_grant_device (grant_id, device_ref, app_slug)
      values (${grant}, ${device}, ${slug})
      on conflict (grant_id) do update
        set device_ref = excluded.device_ref,
            app_slug = excluded.app_slug
    `);
  } catch {
    // fail-soft: table absent / DB error → no binding (token stays exempt).
  }
};

/** Read the binding for a grant, or undefined when absent / on any error. */
export const findGrantDevice = async (
  pool: CommonQueryMethods,
  grantId: unknown
): Promise<GrantDeviceBinding | undefined> => {
  try {
    const grant = normalize(grantId);
    if (!grant) {
      return undefined;
    }

    const row = await pool.maybeOne<{ deviceRef: string; appSlug: string }>(sql`
      select device_ref, app_slug
        from _nicematrix_grant_device
        where grant_id = ${grant}
    `);

    if (!row) {
      return undefined;
    }

    const deviceRef = normalize(row.deviceRef);
    const appSlug = normalize(row.appSlug);
    if (!deviceRef || !appSlug) {
      return undefined;
    }

    return { deviceRef, appSlug };
  } catch {
    return undefined;
  }
};
