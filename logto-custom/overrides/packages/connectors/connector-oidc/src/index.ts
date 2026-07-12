// [NiceMatrix override] connector-oidc index.
//
// Delta vs upstream 1.41.0 (unchanged since 1.40.1) (search "[NiceMatrix]"): a single block inside
// `parseUserInfoFromIdToken` selects the Logto identity id from the configured
// `identitySource` claim (default `sub` = upstream). Everything else is a
// verbatim copy so unrelated OIDC behavior cannot drift.
//
// Rationale: Microsoft Entra `sub` is pairwise (unique per user *and* per OIDC
// application) and changes if the connector/app is re-created; `oid` is the
// tenant-stable, immutable, Graph `id`-aligned identifier Microsoft recommends as
// a database key. We key Microsoft on `oid`; all other OIDC providers keep `sub`.
import { assert, conditional } from '@silverhand/essentials';

import type {
  GetAuthorizationUri,
  GetUserInfo,
  SocialConnector,
  CreateConnector,
  GetConnectorConfig,
  GetTokenResponseAndUserInfo,
  GetAccessTokenByRefreshToken,
} from '@logto/connector-kit';
import {
  ConnectorError,
  ConnectorErrorCodes,
  validateConfig,
  ConnectorType,
  jsonGuard,
} from '@logto/connector-kit';
import { constructAuthorizationUri } from '@logto/connector-oauth';
import { generateStandardId } from '@logto/shared/universal';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HTTPError } from 'ky';

import { defaultMetadata } from './constant.js';
import {
  idTokenProfileStandardClaimsGuard,
  idTokenClaimsGuardWithStringBooleans,
  oidcConnectorConfigGuard,
  type OidcConnectorConfig,
  type AccessTokenResponse,
} from './types.js';
import {
  getIdToken,
  getAccessTokenByRefreshToken as _getAccessTokenByRefreshToken,
} from './utils.js';

const generateNonce = () => generateStandardId();

const getAuthorizationUri =
  (getConfig: GetConnectorConfig): GetAuthorizationUri =>
  async ({ state, redirectUri, scope: customScope }, setSession) => {
    const config = await getConfig(defaultMetadata.id);
    validateConfig(config, oidcConnectorConfigGuard);
    const parsedConfig = oidcConnectorConfigGuard.parse(config);

    const nonce = generateNonce();

    assert(
      setSession,
      new ConnectorError(ConnectorErrorCodes.NotImplemented, {
        message: 'Function `setSession()` is not implemented',
      })
    );
    await setSession({ nonce, redirectUri });

    const {
      authorizationEndpoint,
      responseType,
      clientId,
      scope,
      customConfig,
      authRequestOptionalConfig,
    } = parsedConfig;

    return constructAuthorizationUri(authorizationEndpoint, {
      responseType,
      clientId,
      scope: customScope ?? scope,
      redirectUri,
      state,
      nonce,
      ...authRequestOptionalConfig,
      ...customConfig,
    });
  };

const parseUserInfoFromIdToken = async (
  config: OidcConnectorConfig,
  tokenResponse: AccessTokenResponse,
  validationNonce?: string
) => {
  const { id_token: idToken } = tokenResponse;

  if (!idToken) {
    throw new ConnectorError(ConnectorErrorCodes.SocialIdTokenInvalid, {
      message: 'Cannot find ID Token in the response.',
    });
  }

  try {
    const { payload } = await jwtVerify(
      idToken,
      createRemoteJWKSet(new URL(config.idTokenVerificationConfig.jwksUri)),
      {
        ...config.idTokenVerificationConfig,
        audience: config.clientId,
      }
    );

    const result = config.acceptStringTypedBooleanClaims
      ? idTokenClaimsGuardWithStringBooleans.safeParse(payload)
      : idTokenProfileStandardClaimsGuard.safeParse(payload);

    if (!result.success) {
      throw new ConnectorError(ConnectorErrorCodes.SocialIdTokenInvalid, result.error);
    }

    const {
      sub,
      oid,
      name,
      picture,
      email,
      email_verified,
      phone,
      phone_verified,
      nonce,
    } = result.data;

    // [NiceMatrix] Select the identity id from the configured claim. Default
    // `sub` reproduces upstream exactly. `oid` is opt-in (Microsoft only); if it
    // is requested but absent we throw rather than silently fall back to `sub` —
    // a silent fallback would mint a *different* identity id than existing
    // records and re-orphan the user (the exact bug this override fixes).
    const id = config.identitySource === 'oid' ? oid : sub;

    if (!id) {
      throw new ConnectorError(ConnectorErrorCodes.SocialIdTokenInvalid, {
        message: `Cannot find \`${config.identitySource}\` claim in the ID Token.`,
      });
    }

    if (nonce) {
      // TODO @darcy: need to specify error code
      assert(
        validationNonce,
        new ConnectorError(ConnectorErrorCodes.General, {
          message: 'Cannot find `nonce` in session storage.',
        })
      );

      assert(
        validationNonce === nonce,
        new ConnectorError(ConnectorErrorCodes.SocialIdTokenInvalid, {
          message: 'ID Token validation failed due to `nonce` mismatch.',
        })
      );
    }

    return {
      id,
      name: conditional(name),
      avatar: conditional(picture),
      email: conditional((email_verified ?? config.trustUnverifiedEmail) && email),
      phone: conditional(phone_verified && phone),
      rawData: jsonGuard.parse(payload),
    };
  } catch (error: unknown) {
    if (error instanceof HTTPError) {
      throw new ConnectorError(ConnectorErrorCodes.General, JSON.stringify(error.response.body));
    }

    throw error;
  }
};

const getUserInfo =
  (getConfig: GetConnectorConfig): GetUserInfo =>
  async (data, getSession) => {
    const config = await getConfig(defaultMetadata.id);
    validateConfig(config, oidcConnectorConfigGuard);
    const parsedConfig = oidcConnectorConfigGuard.parse(config);

    assert(
      getSession,
      new ConnectorError(ConnectorErrorCodes.NotImplemented, {
        message: 'Function `getSession()` is not implemented.',
      })
    );
    const { nonce, redirectUri } = await getSession();

    assert(
      redirectUri,
      new ConnectorError(ConnectorErrorCodes.General, {
        message: "CAN NOT find 'redirectUri' from connector session.",
      })
    );

    const tokenResponse = await getIdToken(parsedConfig, data, redirectUri);

    return parseUserInfoFromIdToken(parsedConfig, tokenResponse, nonce);
  };

const getTokenResponseAndUserInfo =
  (getConfig: GetConnectorConfig): GetTokenResponseAndUserInfo =>
  async (data, getSession) => {
    const config = await getConfig(defaultMetadata.id);
    validateConfig(config, oidcConnectorConfigGuard);
    const parsedConfig = oidcConnectorConfigGuard.parse(config);

    assert(
      getSession,
      new ConnectorError(ConnectorErrorCodes.NotImplemented, {
        message: 'Function `getSession()` is not implemented.',
      })
    );
    const { nonce, redirectUri } = await getSession();

    assert(
      redirectUri,
      new ConnectorError(ConnectorErrorCodes.General, {
        message: "CAN NOT find 'redirectUri' from connector session.",
      })
    );

    const tokenResponse = await getIdToken(parsedConfig, data, redirectUri);
    const userInfo = await parseUserInfoFromIdToken(parsedConfig, tokenResponse, nonce);

    return {
      tokenResponse,
      userInfo,
    };
  };

const getAccessTokenByRefreshToken =
  (getConfig: GetConnectorConfig): GetAccessTokenByRefreshToken =>
  async (refreshToken: string) => {
    const config = await getConfig(defaultMetadata.id);
    validateConfig(config, oidcConnectorConfigGuard);
    return _getAccessTokenByRefreshToken(config, refreshToken);
  };

const createOidcConnector: CreateConnector<SocialConnector> = async ({ getConfig }) => {
  return {
    metadata: defaultMetadata,
    type: ConnectorType.Social,
    configGuard: oidcConnectorConfigGuard,
    getAuthorizationUri: getAuthorizationUri(getConfig),
    getUserInfo: getUserInfo(getConfig),
    getTokenResponseAndUserInfo: getTokenResponseAndUserInfo(getConfig),
    getAccessTokenByRefreshToken: getAccessTokenByRefreshToken(getConfig),
  };
};

export default createOidcConnector;
