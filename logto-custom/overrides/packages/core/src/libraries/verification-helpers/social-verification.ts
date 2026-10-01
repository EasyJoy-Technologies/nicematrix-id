/*
 * [NiceMatrix override] vs upstream 1.43.0
 *   logto-upstream/packages/core/src/libraries/verification-helpers/social-verification.ts
 * ONE delta, inside `createSocialAuthorizationUrl()`: for the NiceMatrix Carrier
 * Connector (target `carrier`) the `scope` handed to `getAuthorizationUri` is a
 * signed launch context built from the server-side interaction
 * (`../carrier-launch-context.ts`). Every other connector is byte-identical to
 * upstream. Search for `[NiceMatrix override]` to find the delta; on upstream
 * sync re-copy the file and re-apply the marker block only.
 */
import type { ConnectorSession, SocialUserInfo } from '@logto/connector-kit';
import {
  connectorSessionGuard,
  GoogleConnector,
  isExternalGoogleOneTap,
  isGoogleOneTap as isGoogleOneTapChecker,
  logtoGoogleOneTapCookieKey,
} from '@logto/connector-kit';
import type { SocialConnectorPayload } from '@logto/schemas';
import { ConnectorType } from '@logto/schemas';
import type { Context } from 'koa';
import type { Provider } from 'oidc-provider';
import { z } from 'zod';

import type { WithLogContext } from '#src/middleware/koa-audit-log.js';
import type TenantContext from '#src/tenants/TenantContext.js';
import assertThat from '#src/utils/assert-that.js';

import { buildCarrierLaunchContext, carrierConnectorTarget } from '../carrier-launch-context.js';

type SocialAuthorizationUrlPayload = {
  connectorId: string;
  state: string;
  redirectUri: string;
  scope?: string;
};

export const createSocialAuthorizationUrl = async (
  ctx: WithLogContext,
  { provider, connectors }: TenantContext,
  payload: SocialAuthorizationUrlPayload
) => {
  const { getLogtoConnectorById } = connectors;

  const { connectorId, state, redirectUri, scope } = payload;
  assertThat(state && redirectUri, 'session.insufficient_info');

  const connector = await getLogtoConnectorById(connectorId);

  assertThat(connector.type === ConnectorType.Social, 'connector.unexpected_type');

  const {
    headers: { 'user-agent': userAgent },
  } = ctx.request;

  const { jti, params } = await provider.interactionDetails(ctx.req, ctx.res);

  // [NiceMatrix override] Carrier one-tap login: the Connector needs the App
  // identity + challenge, which only the server-side interaction can vouch for.
  // It rides the otherwise-unused `scope` field (no connector-kit change).
  const isCarrier = connector.metadata.target === carrierConnectorTarget;
  const connectorScope = isCarrier
    ? await buildCarrierLaunchContext({ jti, params, state, redirectUri })
    : scope;

  return connector.getAuthorizationUri(
    {
      state,
      redirectUri,
      scope: connectorScope,
      /**
       * For POST /authn/saml/:connectorId API, we need to block requests
       * for non-SAML connector (relies on connectorFactoryId) and use `connectorId`
       * to find correct connector config.
       */
      connectorId,
      connectorFactoryId: connector.metadata.id,
      jti,
      headers: { userAgent },
    },
    async (connectorStorage: ConnectorSession) =>
      assignConnectorSessionResult(ctx, provider, connectorStorage)
  );
};

export const verifySocialIdentity = async (
  { connectorId, connectorData }: SocialConnectorPayload,
  ctx: WithLogContext,
  { provider, libraries }: TenantContext
): Promise<SocialUserInfo> => {
  const {
    socials: { getUserInfo, getConnector },
  } = libraries;

  const log = ctx.createLog('Interaction.SignIn.Identifier.Social.Submit');
  log.append({ connectorId, connectorData });

  const connector = await getConnector(connectorId);

  // Verify the CSRF token if it's a Google connector and has credential (a Google One Tap
  // verification)
  if (connector.metadata.id === GoogleConnector.factoryId && isGoogleOneTapChecker(connectorData)) {
    if (isExternalGoogleOneTap(connectorData)) {
      assertThat(
        connectorData[GoogleConnector.oneTapParams.credential] ===
          ctx.cookies.get(logtoGoogleOneTapCookieKey),
        'session.google_one_tap.cookie_mismatch'
      );
    } else {
      const csrfToken = connectorData[GoogleConnector.oneTapParams.csrfToken];
      const value = ctx.cookies.get(GoogleConnector.oneTapParams.csrfToken);
      assertThat(value === csrfToken, 'session.csrf_token_mismatch');
    }
  }

  const userInfo = await getUserInfo(connectorId, connectorData, async () =>
    getConnectorSessionResult(ctx, provider)
  );

  log.append(userInfo);

  return userInfo;
};

export const assignConnectorSessionResult = async (
  ctx: Context,
  provider: Provider,
  connectorSession: ConnectorSession
) => {
  const details = await provider.interactionDetails(ctx.req, ctx.res);
  await provider.interactionResult(ctx.req, ctx.res, {
    ...details.result,
    connectorSession,
  });
};

export const getConnectorSessionResult = async (
  ctx: Context,
  provider: Provider
): Promise<ConnectorSession> => {
  const { result } = await provider.interactionDetails(ctx.req, ctx.res);

  const signInResult = z
    .object({
      connectorSession: connectorSessionGuard,
    })
    .safeParse(result);

  assertThat(result && signInResult.success, 'session.connector_validation_session_not_found');

  const { connectorSession, ...rest } = result;
  await provider.interactionResult(ctx.req, ctx.res, {
    ...rest,
  });

  return signInResult.data.connectorSession;
};
