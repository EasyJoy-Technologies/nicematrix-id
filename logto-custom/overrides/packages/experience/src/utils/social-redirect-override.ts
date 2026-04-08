/**
 * NiceMatrix Override: QQ connector redirect_uri domain mapping.
 *
 * QQ互联 requires the OAuth callback domain to have ICP备案.
 * `id.nicematrix.com` is not ICP-registered, but `id.ej-mobile.cn` is.
 *
 * This utility rewrites the callback origin for QQ so that:
 * 1. The redirect_uri sent to QQ uses `id.ej-mobile.cn` (passes QQ's domain check)
 * 2. nginx on `id.ej-mobile.cn` 302-bounces the callback back to `id.nicematrix.com`
 * 3. Session cookies + sessionStorage remain on the original origin
 */

// QQ connector ID in our Logto instance
const QQ_CONNECTOR_ID = 'xelhp9uuatn4qmf4pb7hb';

// ICP-registered domain that reverse-proxies to Logto
const QQ_CALLBACK_ORIGIN = 'https://id.ej-mobile.cn';

/**
 * Returns the correct callback URI for a social connector.
 * For QQ, uses the ICP-registered domain; for all others, uses current origin.
 */
export const getSocialCallbackUri = (connectorId: string): string => {
  const origin =
    connectorId === QQ_CONNECTOR_ID ? QQ_CALLBACK_ORIGIN : window.location.origin;

  return `${origin}/callback/${connectorId}`;
};
