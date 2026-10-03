/**
 * [NiceMatrix] Carrier one-tap login (本机号码一键登录) — server-side `prompt=login`.
 *
 * NiceMatrix-owned middleware (no upstream counterpart), mounted on the OIDC
 * provider by the `oidc/init.ts` override right after `koaResourceParam()`, i.e.
 * after `koaOidcPostToGet()` has turned a form POST into GET parameters.
 *
 * Why (review 2026-10-02 CR-02): the App verifies the number (billed) BEFORE it
 * opens the browser. If the browser still holds a Logto session and the
 * authorize request lacks `prompt=login`, oidc-provider answers from that
 * session without ever showing the Experience — the verified number is never
 * claimed, and the App silently receives whichever account the browser was
 * signed in to. Clients must send `prompt=login consent`; this is the server
 * backstop for a client that forgot.
 *
 * Scope: GET `/auth` (the authorization endpoint; `/auth/:uid` resumes are left
 * alone) carrying a VALID single `carrier_mode` (h5 | native) and
 * `carrier_challenge` (43 base64url chars). Then `login` is APPENDED to the
 * existing `prompt` values (`consent` etc. are kept; a duplicate is never
 * added). Every other request passes through untouched.
 *
 * `prompt=none` + carrier: appending makes oidc-provider reject the request
 * (`none` must stand alone) — intended: a silent answer from another account's
 * session is exactly what this prevents.
 */
import type { MiddlewareType } from 'koa';

const carrierModes = new Set(['h5', 'native']);
const challengePattern = /^[\w-]{43}$/;

const single = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** Pure rule, exported for tests: the new `prompt` value, or undefined = leave as is. */
export const carrierLoginPrompt = (query: Record<string, unknown>): string | undefined => {
  const mode = single(query.carrier_mode);
  const challenge = single(query.carrier_challenge);

  if (!mode || !carrierModes.has(mode) || !challenge || !challengePattern.test(challenge)) {
    return;
  }

  const { prompt } = query;

  // A repeated `prompt` is rejected by oidc-provider anyway — do not touch it.
  if (prompt !== undefined && typeof prompt !== 'string') {
    return;
  }

  const values = (prompt ?? '').split(' ').filter(Boolean);

  if (values.includes('login')) {
    return;
  }

  return [...values, 'login'].join(' ');
};

export default function koaCarrierLoginPrompt<StateT, ContextT, ResponseBodyT>(): MiddlewareType<
  StateT,
  ContextT,
  ResponseBodyT
> {
  return async (ctx, next) => {
    if (ctx.method === 'GET' && ctx.path === '/auth') {
      const prompt = carrierLoginPrompt(ctx.request.query);

      if (prompt) {
        ctx.request.query = { ...ctx.request.query, prompt };
      }
    }

    return next();
  };
}
