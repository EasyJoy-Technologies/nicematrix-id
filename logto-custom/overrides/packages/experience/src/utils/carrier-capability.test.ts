/**
 * [NiceMatrix] carrier-capability.ts — capture/strip, validation, one-time
 * auto prompt, manual retry cap, disable markers (plan §6.0–§6.2).
 */
import {
  captureCarrierParamsFromUrl,
  claimAutoPrompt,
  claimManualAttempt,
  disableCarrier,
  isCarrierDisabled,
  isDisablingFailure,
  parseCarrierFailure,
  readCarrierContext,
  shouldListCarrierConnector,
  shouldShowCarrierButton,
} from './carrier-capability';

const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const visit = (url: string) => {
  window.history.replaceState({ kept: true }, '', url);
  captureCarrierParamsFromUrl();
};

describe('carrier-capability', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('captures + strips carrier params and keeps other params and history state', () => {
    visit(`/direct/social/carrier?app_id=abc&carrier_mode=h5&carrier_challenge=${challenge}&fallback=sign-in`);
    expect(readCarrierContext()).toEqual({ mode: 'h5', challenge });
    expect(window.location.search).toBe('?app_id=abc&fallback=sign-in');
    expect(window.history.state).toEqual({ kept: true });
  });

  it('without any carrier param the page behaves as if carrier did not exist', () => {
    visit('/sign-in?app_id=abc');
    expect(readCarrierContext()).toBeNull();
    expect(shouldListCarrierConnector()).toBe(false);
    expect(shouldShowCarrierButton()).toBe(false);
  });

  it('a new authorization entry clears a stale context; a callback page keeps it', () => {
    visit(`/sign-in?app_id=abc&carrier_mode=h5&carrier_challenge=${challenge}`);
    visit('/callback/carrierconn?code=x&state=y');
    expect(readCarrierContext()).not.toBeNull();
    visit('/sign-in?app_id=other');
    expect(readCarrierContext()).toBeNull();
  });

  it('rejects malformed mode or challenge', () => {
    visit(`/sign-in?carrier_mode=sms&carrier_challenge=${challenge}`);
    expect(readCarrierContext()).toBeNull();
    visit('/sign-in?carrier_mode=h5&carrier_challenge=short');
    expect(readCarrierContext()).toBeNull();
  });

  it('auto prompt happens exactly once per challenge (Back / refresh safe)', () => {
    visit(`/direct/social/carrier?carrier_mode=native&carrier_challenge=${challenge}`);
    const context = readCarrierContext()!;
    expect(claimAutoPrompt(context)).toBe(true);
    expect(claimAutoPrompt(context)).toBe(false);
  });

  it('manual entry: h5 only, at most 3 attempts, hidden once disabled', () => {
    visit(`/sign-in?carrier_mode=h5&carrier_challenge=${challenge}`);
    const context = readCarrierContext()!;
    expect(shouldShowCarrierButton()).toBe(true);
    expect([1, 2, 3, 4].map(() => claimManualAttempt(context))).toEqual([true, true, true, false]);
    expect(shouldShowCarrierButton()).toBe(false);

    sessionStorage.clear();
    visit(`/sign-in?carrier_mode=h5&carrier_challenge=${challenge}`);
    disableCarrier(context);
    expect(isCarrierDisabled(context)).toBe(true);
    expect(shouldShowCarrierButton()).toBe(false);

    sessionStorage.clear();
    visit(`/sign-in?carrier_mode=native&carrier_challenge=${challenge}`);
    expect(shouldListCarrierConnector()).toBe(true);
    expect(shouldShowCarrierButton()).toBe(false);
  });

  it('failure classes: unknown → internal_error; terminal ones disable', () => {
    expect(parseCarrierFailure('user_cancelled')).toBe('user_cancelled');
    expect(parseCarrierFailure('<script>')).toBe('internal_error');
    expect(parseCarrierFailure(undefined)).toBe('internal_error');
    expect(isDisablingFailure('network_unsupported')).toBe(true);
    expect(isDisablingFailure('number_mismatch')).toBe(false);
    expect(isDisablingFailure('user_cancelled')).toBe(false);
  });
});
