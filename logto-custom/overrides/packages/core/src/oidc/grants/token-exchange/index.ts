/*
 * [NiceMatrix override] vs upstream: this file is a near-verbatim copy of
 *   logto-upstream/packages/core/src/oidc/grants/token-exchange/index.ts (1.43.0)
 * with delta blocks (search "[NiceMatrix override]" markers) that
 *   (1) extend the RFC 8693 token-exchange response with `id_token` (scope
 *       contains `openid`) and `refresh_token` (scope contains `offline_access`
 *       and the client has the `refresh_token` grant type enabled), and
 *   (2) accept a REPEATED `resource` parameter so one native login can serve
 *       several API resource indicators.
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
 *   - Pure increment. Requests without `openid` / `offline_access` scope get
 *     byte-identical output to upstream (`buildTokenResponse` drops the
 *     undefined members).
 *   - Refresh token is anchored to the SAME grantId as the access token, so a
 *     subsequent grant_type=refresh_token finds the grant and rotates normally
 *     (handled by the upstream refresh_token grant, unchanged).
 *   - For public clients (clientAuthMethod === 'none', i.e. native apps) the
 *     AT's jkt / x5t#S256 are copied onto the refresh token, mirroring the
 *     upstream authorization_code grant (DPoP / mTLS binding).
 *   - The id_token is minted by the SHARED v9 helper `issueIdToken` (seam
 *     module `oidc/oidc-provider-internals.js`), exactly as the forked
 *     refresh_token grant does. 1.43 note: that helper no longer sets
 *     `at_hash` and the JWT header no longer carries `typ: "JWT"` — an
 *     upstream-wide v9 change, not a NiceMatrix decision. Official Logto SDKs
 *     are unaffected; clients that hand-roll ID-token validation must not
 *     require those two.
 *
 * 1.43 upgrade note: the pre-1.42 override hand-rolled the id_token (deep
 * `filter_claims.js` import + manual at_hash + manual conformIdTokenClaims
 * branch) because v8 exposed no reusable helper. v9 added `grant_common.js`,
 * re-exported through the seam module, so those ~35 lines are gone. Do not
 * reintroduce deep `oidc-provider/lib/**` imports here — the seam module is
 * the only place allowed to do that.
 *
 * On upstream sync, re-diff against upstream and re-apply the marker blocks.
 *
 * @see {@link https://github.com/logto-io/rfcs | Logto RFCs} for more information about RFC 0005.
 *
 * @remarks
 * Unlike the `refresh_token` and `client_credentials` grants, this grant is Logto's own and has
 * no upstream counterpart to stay in sync with. It still consumes the shared token-endpoint
 * helpers from v9's `grant_common.js` through the `oidc-provider-internals.js` seam module, so
 * the sender-constraining (mTLS and DPoP) behavior stays aligned with the forked grants.
 *
 * This grant is deliberately a first-party-only capability: subject tokens are minted through
 * the Management API by the tenant's own trusted backends, and the exchange involves no user
 * consent, while third-party access is governed by the consent model — the two are mutually
 * exclusive, so third-party applications can never enable this grant type (enforced when
 * configuring applications, see `assertThirdPartyApplicationTokenExchangeDisabled`). That is
 * also why no per-client scope filtering happens here: every client that can reach this grant
 * is first-party and carries no scope allowlist, so issued scopes are capped only by what the
 * user owns and by the global OIDC scope set. A third party that needs an exchanged token
 * should obtain it from the tenant's own machine-to-machine backend instead of performing the
 * exchange itself.
 */

import { buildOrganizationUrn } from '@logto/core-kit';
import { GrantType } from '@logto/schemas';
import { nanoid } from 'nanoid';
import { errors } from 'oidc-provider';

import { type EnvSet } from '#src/env-set/index.js';
import { assertUserHasApplicationAccessForOidc } from '#src/oidc/application-access-control.js';
import {
  applyDpopBinding,
  applyMtlsBinding,
  // [NiceMatrix override] shared token-endpoint helpers reused for the extra tokens.
  buildTokenResponse,
  checkDpopRequired,
  checkMtlsCert,
  createAccessToken,
  dpopValidate,
  getProviderConfiguration,
  type GrantTypeHandler,
  // [NiceMatrix override] shared id_token minting (same helper the refresh_token grant uses).
  issueIdToken,
  resolveResource,
  validateAccount,
  validatePresence,
} from '#src/oidc/oidc-provider-internals.js';
import type Libraries from '#src/tenants/Libraries.js';
import type Queries from '#src/tenants/Queries.js';
import assertThat from '#src/utils/assert-that.js';

import {
  getSharedResourceServerData,
  isThirdPartyApplication,
  reversedResourceAccessTokenTtl,
} from '../../resource.js';
import { checkOrganizationAccess } from '../utils.js';

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
type Handler = (
  envSet: EnvSet,
  queries: Queries,
  applicationAccessControl: Libraries['applicationAccessControl']
) => GrantTypeHandler;

export const buildHandler: Handler = (envSet, queries, appAccess) => async (ctx) => {
  const { client, params, requestParamScopes, provider } = ctx.oidc;
  // [NiceMatrix override] Pull the RefreshToken constructor so we can mint the
  // extra token. Upstream destructures only { AccessToken, Grant }.
  const { AccessToken, Grant, RefreshToken } = provider;

  assertThat(params, new InvalidGrant('parameters must be available'));
  assertThat(client, new InvalidClient('client must be available'));

  const isThirdParty = await isThirdPartyApplication(queries, client.clientId);

  validatePresence(ctx, ...requiredParameters);

  const {
    features: {
      userinfo,
      resourceIndicators,
      mTLS: { getCertificate },
    },
    scopes: oidcScopes,
    findAccount,
    // [NiceMatrix override] needed by the shared `issueIdToken` helper below.
    conformIdTokenClaims,
  } = getProviderConfiguration(provider);

  const dPoP = await dpopValidate(ctx);

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

  const account = await validateAccount(ctx, findAccount, { accountId: userId }, 'subject token');

  ctx.oidc.entity('Account', account);

  await assertUserHasApplicationAccessForOidc(
    appAccess,
    client.clientId,
    account.accountId,
    client.metadata().appLevelAccessControlEnabled
  );

  // Pre-generate grant ID to avoid a separate DB write just to obtain it.
  // oidc-provider's BaseModel.save() skips ID generation when jti is already set.
  const grantId = nanoid();
  // eslint-disable-next-line no-restricted-syntax -- jti is accepted by BaseModel constructor at runtime but not in Grant typings
  const grant = new Grant({
    jti: grantId,
    accountId: account.accountId,
    clientId: client.clientId,
  } as ConstructorParameters<typeof Grant>[0]);

  const { organizationId } = await checkOrganizationAccess(ctx, {
    envSet,
    queries,
    account,
    isThirdParty,
  });

  const accessToken = createAccessToken(
    ctx,
    AccessToken,
    {
      accountId: account.accountId,
      grantId,
    },
    GrantType.TokenExchange
  );
  accessToken.extra = {
    ...(subjectTokenId ? { subjectTokenId } : {}),
  };

  await applyDpopBinding(ctx, dPoP, accessToken);
  checkDpopRequired(ctx, dPoP);

  const cert = checkMtlsCert(ctx, getCertificate);
  applyMtlsBinding(accessToken, cert);

  /** The scopes requested by the client. */
  const scope = requestParamScopes;

  // [NiceMatrix override] === BEGIN multi-resource normalization ===
  // RFC 8707 allows the `resource` parameter to be repeated, and
  // `registerGrants()` already declares `resource` as a duplicable parameter for
  // this grant, so `params.resource` may legitimately arrive as an array.
  //
  // Upstream assumed a single value and stored that single value on the refresh
  // token. A refresh_token minted that way carries exactly ONE resource
  // indicator, so a later `grant_type=refresh_token&resource=<other>` fails with
  // `InvalidTarget` (oidc-provider `resolve_resource.js`:
  // `if (resource && !model.resourceIndicators.has(resource)) throw`).
  // That is the CN self-hosted-cloud case: business API + store API are two
  // different resource indicators on one login session.
  //
  // Normalize to an array here. `requestedResources[0]` stays the ACCESS token's
  // single audience (a JWT `aud` must be one value); the remaining entries are
  // registered on the grant and persisted on the refresh token so subsequent
  // refreshes can target any of them — mirroring what the upstream
  // authorization_code grant already does when `authorize` declares multiple
  // resources (verified in production: those refresh tokens store an array).
  const requestedResources: string[] = (
    Array.isArray(params.resource) ? params.resource : [params.resource]
  ).filter((value): value is string => typeof value === 'string' && value.length > 0);
  const primaryResource: string | undefined = requestedResources[0];

  // `resolveResource` reads `ctx.oidc.params.resource` directly and throws
  // `InvalidTarget` when it resolves to an array. Critically, before throwing it
  // routes arrays through `resourceIndicators.defaultResource()`, and Logto's
  // implementation IGNORES the passed candidates and returns the tenant-wide
  // default resource — which would silently mint a token for the WRONG audience.
  // (Re-verified against the v9 fork `lib/helpers/resolve_resource.js`: the
  // array → defaultResource → throw sequence is unchanged, and upstream's own
  // 1.43 fake model `new Set([params.resource])` would additionally fail the
  // membership check because the Set would hold the array object itself.)
  // So we must never hand it an array: give it a view of `ctx` whose
  // `oidc.params.resource` is pinned to the primary value.
  //
  // This is done by PROTOTYPE SHADOWING, not a Proxy. `ctx.oidc` is a
  // non-configurable data property, so a Proxy `get` trap is required by the JS
  // spec to return that exact object; returning a wrapper throws
  // "TypeError: 'get' on proxy: property 'oidc' is a read-only and
  // non-configurable data property" (caught on id-staging, 2026-08-06).
  // `Object.create` sidesteps the invariant entirely: the derived object keeps
  // the full prototype chain (so every other ctx / oidc member, including
  // getters and methods, resolves exactly as before) and only shadows `params`.
  // Single-resource requests pass the real `ctx` through untouched, keeping the
  // pre-existing code path byte-identical.
  const resolveCtx =
    requestedResources.length > 1
      ? (Object.create(ctx, {
          oidc: {
            value: Object.create(ctx.oidc, {
              params: {
                value: { ...params, resource: primaryResource },
                enumerable: true,
              },
            }) as typeof ctx.oidc,
            enumerable: true,
          },
        }) as typeof ctx)
      : ctx;

  const resource = await resolveResource(
    resolveCtx,
    {
      // We don't restrict the resource indicators to the requested resource,
      // because the subject token does not have a resource indicator.
      // Use the params.resource to bypass the resource indicator check.
      // [NiceMatrix override] seed with every requested indicator (upstream seeds
      // the single `params.resource`) so the primary passes the membership check
      // unchanged. With zero or one requested resource this Set is identical to
      // upstream's for every reachable code path.
      resourceIndicators: new Set(requestedResources),
    },
    { userinfo, resourceIndicators },
    scope
  );
  // [NiceMatrix override] === END multi-resource normalization ===

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

    // [NiceMatrix override] === BEGIN secondary resource registration ===
    // The access token above is bound to `resource` (the primary) only. Register
    // the remaining requested indicators on the SAME grant so that a later
    // `grant_type=refresh_token&resource=<secondary>` can resolve a scope for
    // them — `refresh_token` computes its access-token scope via
    // `grant.getResourceScopeFiltered(resource, ...)`, which returns '' for any
    // resource the grant never recorded.
    //
    // `getResourceServerInfo` throws `InvalidTarget` for an indicator that is not
    // a registered API resource, so an unknown secondary fails fast HERE (at
    // login) instead of silently minting a refresh token that cannot serve it.
    for (const secondary of requestedResources) {
      if (secondary === resource) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const secondaryInfo = await resourceIndicators.getResourceServerInfo(ctx, secondary, client);
      const secondaryScopes = new Set(
        String(secondaryInfo.scope ?? '')
          .split(' ')
          .filter(Boolean)
      );
      grant.addResourceScope(
        secondary,
        [...scope].filter((name) => secondaryScopes.has(name)).join(' ')
      );
    }
    // [NiceMatrix override] === END secondary resource registration ===
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
  // the grant only got the resource scope. For id_token issuance and for the
  // follow-up `grant_type=refresh_token` call to honour OIDC scopes
  // (openid / offline_access / profile / email / ...), we must also register the
  // OIDC subset on the grant — `issueIdToken` filters through
  // `grant.getOIDCScopeFiltered(scope)`. Idempotent: the pure-OIDC branch above
  // already added them and Grant#addOIDCScope is additive.
  const oidcScopeSet = new Set<string>(oidcScopes as unknown as Iterable<string>);
  const requestedOidcScope = [...scope].filter((name) => oidcScopeSet.has(name)).join(' ');
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
  // The gate is kept explicit here (rather than delegating to the provider's
  // `issueRefreshToken` config hook) so this grant's issuance rule is unchanged
  // by the 1.43 upgrade — the hook additionally issues for
  // `applicationType === 'web' && alwaysIssueRefreshToken`, which no
  // token-exchange client is.
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
      // Persist ALL requested indicators when more than one was asked for.
      // oidc-provider's `BaseToken#resourceIndicators` getter is
      // `new Set(Array.isArray(this.resource) ? this.resource : [this.resource])`,
      // so an array makes every listed resource a valid refresh target while a
      // single value keeps the exact pre-existing shape (and therefore the exact
      // pre-existing behaviour) for every client that sends one resource.
      // Rotation carries this through untouched: the upstream refresh_token grant
      // copies `resource: refreshToken.resource` verbatim into the rotated token.
      resource: requestedResources.length > 1 ? requestedResources : primaryResource,
      // Carry over claims (may be undefined for resource / org branches) so the
      // refresh grant's id_token path has the same claim shape as ours.
      claims: accessToken.claims,
    } as ConstructorParameters<typeof RefreshToken>[0]);

    // Public clients (Native + SPA, clientAuthMethod === 'none') must bind the
    // refresh token to the same DPoP / mTLS proof as the access token, matching
    // the upstream authorization_code grant (`setRefreshTokenBindings`).
    if (client.clientAuthMethod === 'none') {
      if (accessToken.jkt) {
        rt.jkt = accessToken.jkt;
      }
      if (accessToken['x5t#S256']) {
        rt['x5t#S256'] = accessToken['x5t#S256'];
      }
    }

    ctx.oidc.entity('RefreshToken', rt);
    refreshTokenString = await rt.save();
  }
  // [NiceMatrix override] === END refresh_token issuance ===

  // [NiceMatrix override] === BEGIN id_token issuance ===
  // Delegate to the shared v9 helper, exactly as the forked refresh_token grant
  // does. It returns `undefined` when the scope has no `openid`, so requests
  // without it keep the byte-identical upstream response.
  //
  // There is no source token in a token exchange (no interactive session), so we
  // pass a minimal source carrying only `claims`; every other member the helper
  // reads (`acr` / `amr` / `authTime` / `nonce` / `sid`) is legitimately absent
  // here and the helper tolerates `undefined` (the same shape a refresh token
  // minted without a nonce produces). `scopeOverride` is the request scope, so
  // the helper never reads `source.scope` / `source.scopes`.
  const idTokenString = await issueIdToken(
    ctx,
    { claims: accessToken.claims } as unknown as Parameters<typeof issueIdToken>[1],
    accessToken,
    grant,
    { conformIdTokenClaims, userinfo },
    scope
  );
  // [NiceMatrix override] === END id_token issuance ===

  // [NiceMatrix override] Response built through the shared `buildTokenResponse`
  // helper so `id_token` / `refresh_token` are included only when issued
  // (undefined members are dropped by JSON serialisation) and the remaining
  // fields stay identical to upstream.
  ctx.body = buildTokenResponse(accessToken, accessTokenString, {
    idToken: idTokenString,
    refreshToken: refreshTokenString,
    source: { scope: accessToken.scope },
  });
};
/* eslint-enable @silverhand/fp/no-mutation, @typescript-eslint/no-unsafe-assignment */
