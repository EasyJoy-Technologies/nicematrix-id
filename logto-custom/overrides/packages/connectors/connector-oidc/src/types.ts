// [NiceMatrix override] connector-oidc types.
//
// Delta vs upstream 1.41.0 (unchanged since 1.40.1) (search "[NiceMatrix]"):
//   1. `oid` added to `idTokenProfileStandardClaimsGuard` so the Microsoft Entra
//      `oid` claim survives the zod parse (upstream `z.object` strips unknown keys
//      from `result.data`; `rawData` keeps the full payload but the id selector
//      reads `result.data`).
//   2. `identitySource` added to `oidcConnectorConfigGuard` — which id_token claim
//      becomes the Logto identity id. Default `sub` = byte-identical upstream
//      behavior; Microsoft sets `oid` (tenant-stable, Graph-aligned, Microsoft's
//      recommended immutable DB key — `sub` is pairwise/per-app and breaks if the
//      OIDC app/connector is ever re-created).
import { yes } from '@silverhand/essentials';
import { z } from 'zod';

import { oauth2ConfigGuard } from '@logto/connector-oauth';

const scopeOpenid = 'openid';
export const delimiter = /[ +]/;

/**
 * Space-delimited 'scope' MUST contain 'openid', see https://openid.net/specs/openid-connect-core-1_0.html#CodeFlowAuth
 */
export const scopePostProcessor = (scope: string) => {
  const splitScopes = scope.split(delimiter).filter(Boolean);

  if (!splitScopes.includes(scopeOpenid)) {
    return [...splitScopes, scopeOpenid].join(' ');
  }

  return scope;
};

/**
 * See https://openid.net/specs/openid-connect-core-1_0.html#StandardClaims.
 * We only concern a subset of them, and social identity provider usually does not provide a complete set of them.
 */
export const idTokenProfileStandardClaimsGuard = z.object({
  sub: z.string(),
  // [NiceMatrix] Microsoft Entra object id — tenant-stable immutable identifier.
  // Kept nullish so non-Microsoft OIDC providers (which omit it) parse unchanged.
  oid: z.string().nullish(),
  name: z.string().nullish(),
  email: z.string().nullish(),
  email_verified: z.boolean().nullish(),
  phone: z.string().nullish(),
  phone_verified: z.boolean().nullish(),
  picture: z.string().nullish(),
  profile: z.string().nullish(),
  nonce: z.string().nullish(),
});

/**
 * Extend `idTokenProfileStandardClaimsGuard` by accepting string-typed boolean claims.
 */
export const idTokenClaimsGuardWithStringBooleans = idTokenProfileStandardClaimsGuard
  .omit({ email_verified: true, phone_verified: true })
  .extend({
    email_verified: z
      .boolean()
      .or(z.string().transform((value: string) => yes(value)))
      .nullish(),
    phone_verified: z
      .boolean()
      .or(z.string().transform((value: string) => yes(value)))
      .nullish(),
  });

export const userProfileGuard = z.object({
  id: z.preprocess(String, z.string()),
  email: z.string().optional(),
  phone: z.string().optional(),
  name: z.string().optional(),
  avatar: z.string().optional(),
});

export type UserProfile = z.infer<typeof userProfileGuard>;

/**
 * We remove `nonce` in `authRequestOptionalConfigGuard` because it should be a randomly generated string,
 * should not be fixed in config and will be generated in Logto core according to `response_type` of authorization request.
 */
export const authRequestOptionalConfigGuard = z
  .object({
    responseMode: z.string(),
    display: z.string(),
    prompt: z.string(),
    maxAge: z.string(),
    uiLocales: z.string(),
    idTokenHint: z.string(),
    loginHint: z.string(),
    acrValues: z.string(),
  })
  .partial();

/**
 * See https://github.com/panva/jose/blob/main/docs/interfaces/jwt_verify.JWTVerifyOptions.md for details.
 */
export const idTokenVerificationConfigGuard = z.object({ jwksUri: z.string() }).merge(
  z
    .object({
      issuer: z.string().or(z.string().array()),
      audience: z.string().or(z.string().array()),
      algorithms: z.string().array(),
      clockTolerance: z.string().or(z.number()),
      crit: z.record(z.string(), z.boolean()),
      currentDate: z.date().default(new Date()),
      maxTokenAge: z.string().or(z.number()),
      subject: z.string(),
      typ: z.string(),
    })
    .partial()
);

export type IdTokenVerificationConfig = z.infer<typeof idTokenVerificationConfigGuard>;

/**
 * [NiceMatrix] Which id_token claim becomes the Logto identity id.
 * - `sub` (default): upstream behavior, pairwise/per-application subject.
 * - `oid`: Microsoft Entra object id (tenant-stable, Graph `id`-aligned).
 */
export const identitySourceGuard = z.enum(['sub', 'oid']);
export type IdentitySource = z.infer<typeof identitySourceGuard>;

export const oidcConnectorConfigGuard = oauth2ConfigGuard.extend({
  // Override `scope` to ensure it contains 'openid'.
  scope: z.string().transform(scopePostProcessor),
  acceptStringTypedBooleanClaims: z.boolean().optional().default(false),
  trustUnverifiedEmail: z.boolean().optional().default(false),
  // [NiceMatrix] identity id claim selector — default 'sub' keeps upstream behavior.
  identitySource: identitySourceGuard.optional().default('sub'),
  idTokenVerificationConfig: idTokenVerificationConfigGuard,
  authRequestOptionalConfig: authRequestOptionalConfigGuard.optional(),
  customConfig: z.record(z.string()).optional(),
});

export type OidcConnectorConfig = z.infer<typeof oidcConnectorConfigGuard>;

export const authResponseGuard = z
  .object({
    code: z.string(),
    state: z.string().optional(),
  })
  .catchall(z.string());

export type AuthResponse = z.infer<typeof authResponseGuard>;

export const accessTokenResponseGuard = z.object({
  id_token: z.string(),
  access_token: z.string().optional(),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  code: z.string().optional(),
});

export type AccessTokenResponse = z.infer<typeof accessTokenResponseGuard>;
