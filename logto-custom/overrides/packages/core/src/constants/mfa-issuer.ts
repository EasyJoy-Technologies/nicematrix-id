/**
 * [NiceMatrix override] new file (no upstream counterpart).
 *
 * The `issuer` of a TOTP `otpauth://` URI is what an authenticator app
 * (Google Authenticator, 1Password, etc.) shows as the account's *title*.
 * Upstream Logto hard-codes this to the request hostname (`ctx.URL.hostname`),
 * so NiceMatrix users saw `id.nicematrix.com` instead of a brand name.
 *
 * Centralising the brand name here keeps every TOTP code path (experience
 * MFA binding, legacy interaction, admin Management API, Account Center) in
 * sync from a single source of truth. Account Center (`packages/account`) is a
 * separate frontend bundle that cannot import from `packages/core`; it inlines
 * the same literal with a comment pointing back here.
 *
 * This is a pure display-layer change: the issuer is not part of the TOTP
 * algorithm (HMAC over the shared secret + time step), so changing it never
 * affects code generation/verification for existing or new bindings.
 */
export const mfaIssuerName = 'NiceMatrix ID';
