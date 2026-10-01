/**
 * [NiceMatrix] Carrier one-tap login (本机号码一键登录) — client-side capability.
 *
 * NiceMatrix-owned module (no upstream counterpart). Plan: nicematrix-backend
 * docs/_plans/2026-09-14_carrier-one-tap-login-browser-retention.md §6.0–§6.2.
 *
 * The App is the ONLY initiator (§6.0): carrier exists for a sign-in exactly
 * when the authorize URL declared `carrier_mode` (h5 | native) and a valid
 * `carrier_challenge`. Without them the page is identical to upstream — the
 * Carrier connector is removed from the sign-in experience list altogether.
 *
 * sessionStorage (per browser tab = per App sign-in):
 *   nmx_carrier_mode / nmx_carrier_challenge      captured context
 *   nmx_carrier_prompted:<challenge>              auto prompt already happened
 *   nmx_carrier_disabled:<challenge>              a terminal failure: hide entry
 *   nmx_carrier_manual:<challenge>                manual (h5) retries used
 * Context is rewritten on every NEW authorization entry (URL has app_id or a
 * carrier param), so a later non-carrier sign-in in the same tab starts clean.
 */

export const carrierTarget = 'carrier';
export const maxManualAttempts = 3;

const storageKeyMode = 'nmx_carrier_mode';
const storageKeyChallenge = 'nmx_carrier_challenge';
const promptedPrefix = 'nmx_carrier_prompted:';
const disabledPrefix = 'nmx_carrier_disabled:';
const manualPrefix = 'nmx_carrier_manual:';

const challengeRegex = /^[\w-]{43}$/;
const modes = new Set(['h5', 'native']);

export type CarrierContext = { mode: 'h5' | 'native'; challenge: string };

// Failure classes after which carrier is hidden for the rest of this sign-in.
const disablingClasses = new Set([
  'not_supported',
  'network_unsupported',
  'provider_locked',
  'provider_config_error',
  'provider_unavailable',
  'provider_timeout',
  'app_binding_mismatch',
  'phone_invalid',
  'rate_limited',
]);

const knownClasses = new Set([
  ...disablingClasses,
  'user_cancelled',
  'number_mismatch',
  'token_invalid_or_expired',
  'attempt_expired',
  'attempt_replayed',
  'sdk_error',
  'internal_error',
]);

const safe = <T>(run: () => T, fallback: T): T => {
  try {
    return run();
  } catch {
    return fallback;
  }
};

/** Capture + strip carrier params at boot (before upstream strips unknown keys). */
export const captureCarrierParamsFromUrl = (): void => {
  safe(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('carrier_mode');
    const challenge = params.get('carrier_challenge');
    const isNewEntry = mode !== null || challenge !== null || params.has('app_id');

    if (!isNewEntry) {
      return;
    }

    for (const [key, value] of [
      [storageKeyMode, mode],
      [storageKeyChallenge, challenge],
    ] as const) {
      if (value === null) {
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, value);
      }
    }

    if (mode !== null || challenge !== null) {
      params.delete('carrier_mode');
      params.delete('carrier_challenge');
      const search = params.toString();
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + (search ? `?${search}` : '') + window.location.hash
      );
    }
  }, undefined);
};

/** Validated context, or null when this sign-in has no carrier option. */
export const readCarrierContext = (): CarrierContext | null =>
  safe(() => {
    const mode = sessionStorage.getItem(storageKeyMode);
    const challenge = sessionStorage.getItem(storageKeyChallenge);

    if (!mode || !modes.has(mode) || !challenge || !challengeRegex.test(challenge)) {
      return null;
    }

    return { mode: mode === 'h5' ? 'h5' : 'native', challenge };
  }, null);

export const isCarrierTarget = (target: string): boolean => target === carrierTarget;

const flag = (prefix: string, context: CarrierContext) => `${prefix}${context.challenge}`;

export const isCarrierDisabled = (context: CarrierContext): boolean =>
  safe(() => sessionStorage.getItem(flag(disabledPrefix, context)) === '1', true);

export const disableCarrier = (context: CarrierContext): void => {
  safe(() => {
    sessionStorage.setItem(flag(disabledPrefix, context), '1');
  }, undefined);
};

/** Mark the one automatic prompt; returns false if it already happened (Back / refresh). */
export const claimAutoPrompt = (context: CarrierContext): boolean =>
  safe(() => {
    if (sessionStorage.getItem(flag(promptedPrefix, context)) === '1') {
      return false;
    }

    sessionStorage.setItem(flag(promptedPrefix, context), '1');

    return true;
  }, false);

/** Reserve one manual (h5) attempt; false once the per-sign-in limit is used. */
export const claimManualAttempt = (context: CarrierContext): boolean =>
  safe(() => {
    const used = Number(sessionStorage.getItem(flag(manualPrefix, context)) ?? '0') || 0;

    if (used >= maxManualAttempts) {
      return false;
    }

    sessionStorage.setItem(flag(manualPrefix, context), String(used + 1));

    return true;
  }, false);

/** Keep the connector in the SIE list only when the App declared carrier. */
export const shouldListCarrierConnector = (): boolean => readCarrierContext() !== null;

/** Manual entry button: h5 only, not disabled, retries left. */
export const shouldShowCarrierButton = (): boolean => {
  const context = readCarrierContext();

  if (!context || context.mode !== 'h5' || isCarrierDisabled(context)) {
    return false;
  }

  const used = safe(() => Number(sessionStorage.getItem(flag(manualPrefix, context)) ?? '0') || 0, maxManualAttempts);

  return used < maxManualAttempts;
};

/** Stable failure class from a Broker error callback's `error_description`. */
export const parseCarrierFailure = (description: unknown): string =>
  typeof description === 'string' && knownClasses.has(description) ? description : 'internal_error';

export const isDisablingFailure = (failureClass: string): boolean => disablingClasses.has(failureClass);
