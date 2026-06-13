/**
 * [NiceMatrix] extra-token-claims-device.ts (new module, no upstream counterpart)
 *
 * Unified read path for the device-session claims. Merged into the provider's
 * `extraTokenClaims` (see oidc/init.ts), it runs on EVERY token issuance and,
 * for access tokens that belong to a grant with a recorded device binding,
 * emits `device_ref` + `app_slug` into the JWT.
 *
 * Because the lookup is keyed by `token.grantId` (stable across refresh
 * rotations) the claim is emitted identically for authorization_code (web),
 * refresh_token (both) and token-exchange (native) issuances — without
 * touching any grant's token-minting code.
 *
 * Fail-soft: a missing binding / DB error yields no claim, which the backend
 * device-lease check treats as exempt (fail-open). Never breaks issuance.
 */

import { type KoaContextWithOIDC, type UnknownObject } from 'oidc-provider';

import type Queries from '#src/tenants/Queries.js';

import { findGrantDevice } from './grant-device-store.js';

export const getExtraTokenClaimsForDeviceSession = async (
  ctx: KoaContextWithOIDC,
  token: unknown,
  queries: Queries
): Promise<UnknownObject | undefined> => {
  // Only access tokens carry resource-scoped device claims.
  if (!(token instanceof ctx.oidc.provider.AccessToken)) {
    return;
  }

  // `grantId` is present for authorization_code / refresh_token / token-exchange
  // issuances; absent for client_credentials and other grant-less tokens.
  const { grantId } = token;
  if (!grantId) {
    return;
  }

  const binding = await findGrantDevice(queries.pool, grantId);
  if (!binding) {
    return;
  }

  return {
    device_ref: binding.deviceRef,
    app_slug: binding.appSlug,
  };
};
