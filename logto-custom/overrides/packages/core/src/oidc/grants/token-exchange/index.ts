/*
 * [NiceMatrix override] vs upstream: this file is a near-verbatim copy of
 *   logto-upstream/packages/core/src/oidc/grants/token-exchange/index.ts (1.39.0)
 * with delta blocks (search "[NiceMatrix override]" markers) that extend the
 * RFC 8693 token-exchange response with `id_token` (when scope includes `openid`)
 * and `refresh_token` (when scope includes `offline_access` AND the client has
 * the `refresh_token` grant type enabled).
 *
 * Rationale: native mobile apps go through the multi-app social login flow
 *   (backend mints a subject_token via /api/subject-tokens → app exchanges
 *   for OIDC tokens via grant=token-exchange). Upstream returns only the
 *   access_token, which forces the app to re-do the whole native social
 *   handshake on every AT expiry (wechat `code` is one-shot, alipay token
 *   is short-lived, qq openid + access_token combo is fragile) and breaks
 *   ID-token-based user attribute retrieval. RFC 8693 §2.2.1 explicitly
 *   permits refresh_token and id_token in the response.
 *
 * Behaviour:
 *   - Pure increment. Requests without `openid` / `offline_access` scope
 *     get the exact same response as before (only access_token).
 *   - Refresh token is anchored to the SAME grantId as the access token,
 *     so subsequent grant_type=refresh_token finds the grant and rotates
 *     normally (handled by the upstream refresh_token grant unchanged).
 *   - For public clients (clientAuthMethod === 'none', i.e. native apps)
 *     we copy AT's jkt / x5t#S256 onto the refresh token, mirroring the
 *     upstream authorization_code grant behaviour (DPoP / mTLS binding).
 *   - For id_token issuance we follow the auth_code grant pattern verbatim:
 *     same claim filtering, same conformIdTokenClaims handling, same
 *     at_hash / sid / nonce / acr / amr / auth_time semantics.
 *
 * On upstream sync, re-diff against upstream and re-apply the marker blocks.
 */

import { buildOrganizationUrn } from '@logto/core-kit';
import { GrantType } from '@logto/schemas';
import { nanoid } from 'nanoid';
import type { Provider } from 'oidc-provider';
import { errors } from 'oidc-provider';
// eslint-disable-next-line import/no-unresolved
import filterClaims from 'oidc-provider/lib/helpers/filter_claims.js';
// eslint-disable-next-line import/no-unresolved
import resolveResource from 'oidc-provider/lib/helpers/resolve_resource.js';
// eslint-disable-next-line import/no-unresolved
import validatePresence from 'oidc-provider/lib/helpers/validate_presence.js';
// eslint-disable-next-line import/no-unresolved
import instance from 'oidc-provider/lib/helpers/weak_cache.js';

import { type EnvSet } from '#src/env-set/index.js';
import type Queries from '#src/tenants/Queries.js';
import assertThat from '#src/utils/assert-that.js';

import {
  getSharedResourceServerData,
  isThirdPartyApplication,
  reversedResourceAccessTokenTtl,
} from '../../resource.js';
import { handleClientCertificate, handleDPoP, checkOrganizationAccess } from '../utils.js';

import { validateSubjectToken } from './account.js';
import { handleActorToken } from './actor-token.js';
import { type TokenExchangeAct } from './types.js';

const { InvalidClient, InvalidGrant } = errors;

/**
 * The valid parameters for the `urn:ietf:params:oauth:grant-type:token-exchange` grant type. Note the `resource` parameter is
 * not included here since it should be handled per configuration when registering the grant type.
 */
export const parameters = Object.freeze([
  'subject_token',
  'subject_token_type',
  'actor_token',
  'actor_token_type',
  'organization_id',
  'scope',
] as const);

/**
 * The required parameters for the grant type.
 *
 * @see {@link parameters} for the full list of valid parameters.
 */
const requiredParameters = Object.freeze([
  'subject_token',
  'subject_token_type',
] as const) satisfies ReadonlyArray<(typeof parameters)[number]>;

/* eslint-disable @silverhand/fp/no-mutation, @typescript-eslint/no-unsafe-assignment */
export const buildHandler: (
  envSet: EnvSet,
  queries: Queries
) => Parameters<Provider['registerGrantType']>['1'] = (envSet, queries) => async (ctx, next) => {
  const { client, params, requestParamScopes, provider } = ctx.oidc;
  // [NiceMatrix override] Pull RefreshToken + IdToken constructors so we can
  // mint the extra tokens. Upstream destructures only { Account, AccessToken, Grant }.
  const { Account, AccessToken, Grant, RefreshToken, IdToken } = provider;

  assertThat(params, new InvalidGrant('parameters must be available'));
  assertThat(client, new InvalidClient('client must be available'));

  const isThirdParty = await isThirdPartyApplication(queries, client.clientId);

  validatePresence(ctx, ...requiredParameters);

  const providerInstance = instance(provider);
  const {
    features: { userinfo, resourceIndicators },
    scopes: oidcScopes,
    // [NiceMatrix override] needed for id_token claim conformance + RT issuance policy.
    conformIdTokenClaims,
  } = providerInstance.configuration();

  const { userId, subjectTokenId } = await validateSubjectToken({
    queries,
    subjectToken: String(params.subject_token),
    subjectTokenType: String(params.subject_token_type),
    AccessToken,
    jwtVerificationOptions: {
      localJWKSet: envSet.oidc.localJWKSet,
      issuer: envSet.oidc.issuer,
    },
  });

  const account = await Account.findAccount(ctx, userId);

  if (!account) {
    throw new InvalidGrant('subject token invalid (referenced account not found)');
  }

  ctx.oidc.entity('Account', account);

  // Pre-generate grant ID to avoid a separate DB write just to obtain it.
  // oidc-provider's BaseModel.save() skips ID generation when jti is already set.
  const grantId = nanoid();
  // eslint-disable-next-line no-restricted-syntax -- jti is accepted by BaseModel constructor at runtime but not in Grant typings
  const grant = new Grant({
    jti: grantId,
    accountId: account.accountId,
    clientId: client.clientId,
  } as ConstructorParameters<typeof Grant>[0]);

  const { organizationId } = await checkOrganizationAccess(ctx, queries, account, isThirdParty);

  const accessToken = new AccessToken({
    accountId: account.accountId,
    clientId: client.clientId,
    gty: GrantType.TokenExchange,
    client,
    grantId,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    scope: undefined!,
    extra: {
      ...(subjectTokenId ? { subjectTokenId } : {}),
    },
  });

  await handleDPoP(ctx, accessToken);
  await handleClientCertificate(ctx, accessToken);

  /** The scopes requested by the client. If not provided, use the scopes from the refresh token. */
  const scope = requestParamScopes;
  const resource = await resolveResource(
    ctx,
    {
      // We don't restrict the resource indicators to the requested resource,
      // because the subject token does not have a resource indicator.
      // Use the params.resource to bypass the resource indicator check.
      resourceIndicators: new Set([params.resource]),
    },
    { userinfo, resourceIndicators },
    scope
  );

  if (organizationId && !resource) {
    /* === RFC 0001 === */
    const audience = buildOrganizationUrn(organizationId);
    /** All available scopes for the user in the organization. */
    const availableScopes = await queries.organizations.relations.usersRoles
      .getUserScopes(organizationId, account.accountId)
      .then((scopes) => scopes.map(({ name }) => name));

    /** The intersection of the available scopes and the requested scopes. */
    const issuedScopes = availableScopes.filter((name) => scope.has(name)).join(' ');

    accessToken.aud = audience;
    // Note: the original implementation uses `new provider.ResourceServer` to create the resource
    // server. But it's not available in the typings. The class is actually very simple and holds
    // no provider-specific context. So we just create the object manually.
    // See https://github.com/panva/node-oidc-provider/blob/cf2069cbb31a6a855876e95157372d25dde2511c/lib/helpers/resource_server.js
    accessToken.resourceServer = {
      ...getSharedResourceServerData(envSet),
      accessTokenTTL: reversedResourceAccessTokenTtl,
      audience,
      scope: availableScopes.join(' '),
    };
    accessToken.scope = issuedScopes;
    grant.addResourceScope(audience, accessToken.scope);
    /* === End RFC 0001 === */
  } else if (resource) {
    const resourceServerInfo = await resourceIndicators.getResourceServerInfo(
      ctx,
      resource,
      client
    );
    // @ts-expect-error -- code from oidc-provider
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    accessToken.resourceServer = new provider.ResourceServer(resource, resourceServerInfo);
    // For access token scopes, there is no "grant" to check,
    // filter the scopes based on the resource server's scopes
    accessToken.scope = [...scope]
      // @ts-expect-error -- code from oidc-provider
      .filter(Set.prototype.has.bind(accessToken.resourceServer.scopes))
      .join(' ');
    grant.addResourceScope(resource, accessToken.scope);
  } else {
    accessToken.claims = ctx.oidc.claims;
    // Filter scopes from `oidcScopes`,
    // in other grants, this is done by `Grant` class
    // See https://github.com/panva/node-oidc-provider/blob/0c569cf5c36dd5faa105fb931a43b2e587530def/lib/helpers/oidc_context.js#L159
    accessToken.scope = Array.from(scope)
      // Wrong typing for oidc-provider, `oidcScopes` is actully a Set,
      // wrap it with `new Set` to make it work
      .filter((name) => new Set(oidcScopes).has(name))
      .join(' ');
    grant.addOIDCScope(accessToken.scope);
  }

  // [NiceMatrix override] When the resource / organization branches above run,
  // grant only got the resource scope. For id_token issuance and for the
  // refresh_token follow-up `grant_type=refresh_token` call to honour OIDC
  // scopes (openid / offline_access / profile / email / ...), we must also
  // register the OIDC subset on the grant. Idempotent: the pure-OIDC branch
  // already added them and Grant#addOIDCScope is additive.
  const oidcScopeSet = new Set<string>(oidcScopes as unknown as Iterable<string>);
  const requestedOidcScope = [...scope].filter((s) => oidcScopeSet.has(s)).join(' ');
  if (requestedOidcScope) {
    grant.addOIDCScope(requestedOidcScope);
  }

  // Handle the actor token
  const { actorId } = await handleActorToken(ctx);
  if (actorId) {
    // @see https://github.com/panva/node-oidc-provider/blob/main/lib/models/formats/jwt.js#L118
    // The JWT generator in node-oidc-provider only recognizes a fixed list of claims,
    // to add other claims to JWT, the only way is to return them in `extraTokenClaims` function.
    // We save the `act` data in the `extra` field temporarily,
    // so that we can get this context it in the `extraTokenClaims` function and add it to the JWT.
    accessToken.extra = {
      ...accessToken.extra,
      ...({ act: { sub: actorId } } satisfies TokenExchangeAct),
    };
  }

  await grant.save();
  ctx.oidc.entity('Grant', grant);
  ctx.oidc.entity('AccessToken', accessToken);
  const accessTokenString = await accessToken.save();

  if (subjectTokenId) {
    await queries.subjectTokens.updateSubjectTokenById(subjectTokenId, {
      consumedAt: Date.now(),
    });
  }

  // [NiceMatrix override] === BEGIN refresh_token issuance ===
  // Mirror the upstream authorization_code grant: issue a refresh_token only if
  //   (1) the client has the `refresh_token` grant type enabled in its metadata
  //   (Logto's syncAppToLogto() includes RefreshToken for Native / SPA / Web), and
  //   (2) `offline_access` is in the requested scope.
  let refreshTokenString: string | undefined;
  if (scope.has('offline_access') && client.grantTypeAllowed(GrantType.RefreshToken)) {
    const rt = new RefreshToken({
      accountId: account.accountId,
      client,
      // Anchor to the SAME grantId as the access token so the standard
      // refresh_token grant finds the grant on subsequent rotation calls.
      grantId,
      gty: GrantType.TokenExchange,
      // Refresh token's stored scope = full request scope. The refresh grant
      // will further filter by what the resource server / OIDC scopes allow.
      scope: [...scope].join(' '),
      // Preserve resource audience binding across rotations, mirroring upstream
      // authorization_code grant (`resource: code.resource`).
      resource: params.resource,
      // Carry over claims (may be undefined for resource / org branches) so the
      // refresh grant's id_token path has the same claim shape as ours.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      claims: (accessToken as any).claims,
    } as ConstructorParameters<typeof RefreshToken>[0]);

    // Public clients (Native + SPA, clientAuthMethod === 'none') must bind the
    // refresh token to the same DPoP / mTLS proof as the access token,
    // matching upstream authorization_code grant behaviour.
    if (client.clientAuthMethod === 'none') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const atAny = accessToken as any;
      if (atAny.jkt) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rt as any).jkt = atAny.jkt;
      }
      if (atAny['x5t#S256']) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rt as any)['x5t#S256'] = atAny['x5t#S256'];
      }
    }

    ctx.oidc.entity('RefreshToken', rt);
    refreshTokenString = await rt.save();
  }
  // [NiceMatrix override] === END refresh_token issuance ===

  // [NiceMatrix override] === BEGIN id_token issuance ===
  // Mirror the upstream authorization_code grant when openid scope is present.
  let idTokenString: string | undefined;
  if (scope.has('openid')) {
    // `accessToken.claims` may be undefined for the resource / organization branches.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const atClaims = (accessToken as any).claims as Record<string, unknown> | undefined;
    const filteredClaims = filterClaims(atClaims, 'id_token', grant);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rejected: string[] = (grant as any).getRejectedOIDCClaims();
    const token = new IdToken(
      {
        ...(await account.claims('id_token', [...scope].join(' '), filteredClaims, rejected)),
      },
      { ctx }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tokenAny = token as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const atAny = accessToken as any;
    if (conformIdTokenClaims && userinfo.enabled && !atAny.aud) {
      tokenAny.scope = 'openid';
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tokenAny.scope = (grant as any).getOIDCScopeFiltered(scope);
    }
    tokenAny.mask = filteredClaims;
    tokenAny.rejected = rejected;
    token.set('at_hash', accessTokenString);

    idTokenString = await token.issue({ use: 'idtoken' });
  }
  // [NiceMatrix override] === END id_token issuance ===

  ctx.body = {
    access_token: accessTokenString,
    expires_in: accessToken.expiration,
    scope: accessToken.scope,
    token_type: accessToken.tokenType,
    // [NiceMatrix override] Conditionally include id_token / refresh_token.
    // Omitted (undefined ⇒ JSON-serialised out) when corresponding scope absent.
    ...(idTokenString === undefined ? {} : { id_token: idTokenString }),
    ...(refreshTokenString === undefined ? {} : { refresh_token: refreshTokenString }),
  };

  await next();
};
/* eslint-enable @silverhand/fp/no-mutation, @typescript-eslint/no-unsafe-assignment */
