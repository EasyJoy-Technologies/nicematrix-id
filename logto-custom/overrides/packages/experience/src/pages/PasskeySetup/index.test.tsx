/**
 * [NiceMatrix] Tests for the PasskeySetup override (see `index.tsx` header).
 *
 * The contract under test is narrow on purpose:
 *   1. a browser without WebAuthn must never be shown the terminal error page — it must skip
 *      the suggestion automatically and continue the interaction;
 *   2. if that automatic skip fails, upstream's error page is still the fallback;
 *   3. a browser WITH WebAuthn must behave exactly as upstream did — no skip request at all.
 *
 * (3) is the regression guard: it is what proves we did not touch the working path.
 */
import { waitFor } from '@testing-library/react';

import renderWithPageContext from '@/__mocks__/RenderWithPageContext';
import SettingsProvider from '@/__mocks__/RenderWithPageContext/SettingsProvider';
import { createSignInPasskeyRegistrationOptions, skipPasskeyBinding } from '@/apis/experience';

import PasskeySetup from '.';

const mockSupportsWebAuthn = jest.fn<boolean, []>(() => true);
const mockRedirectTo = jest.fn(async () => {});

jest.mock('@simplewebauthn/browser', () => ({
  __esModule: true,
  browserSupportsWebAuthn: () => mockSupportsWebAuthn(),
  browserSupportsWebAuthnAutofill: async () => true,
  startRegistration: async () => ({}),
  startAuthentication: async () => ({}),
  WebAuthnAbortService: class WebAuthnAbortService {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    abort() {}
  },
  WebAuthnError: class WebAuthnError extends Error {},
}));

jest.mock('@/apis/experience', () => ({
  __esModule: true,
  skipPasskeyBinding: jest.fn(),
  createSignInPasskeyRegistrationOptions: jest.fn(),
  bindSignInPasskey: jest.fn(),
  initInteraction: jest.fn(),
  verifySignInPasskey: jest.fn(),
}));

jest.mock('@/hooks/use-global-redirect-to', () => ({
  __esModule: true,
  default: () => mockRedirectTo,
}));

const mockedSkipPasskeyBinding = skipPasskeyBinding as jest.MockedFunction<
  typeof skipPasskeyBinding
>;
const mockedCreateRegistrationOptions =
  createSignInPasskeyRegistrationOptions as jest.MockedFunction<
    typeof createSignInPasskeyRegistrationOptions
  >;

const renderPasskeySetup = () =>
  renderWithPageContext(
    <SettingsProvider>
      <PasskeySetup />
    </SettingsProvider>
  );

describe('PasskeySetup on a browser without WebAuthn', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupportsWebAuthn.mockReturnValue(false);
  });

  it('skips the suggestion automatically and continues the interaction', async () => {
    mockedSkipPasskeyBinding.mockResolvedValue({ redirectTo: 'https://example.com/callback' });

    const { queryByText } = renderPasskeySetup();

    await waitFor(() => {
      expect(mockedSkipPasskeyBinding).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockRedirectTo).toHaveBeenCalledWith('https://example.com/callback');
    });

    // Never asks for registration options, and never shows the dead-end error page.
    expect(mockedCreateRegistrationOptions).not.toHaveBeenCalled();
    expect(queryByText('mfa.webauthn_not_supported')).toBeNull();
  });

  it('requests the skip only once even if the component re-renders', async () => {
    mockedSkipPasskeyBinding.mockResolvedValue({ redirectTo: 'https://example.com/callback' });

    const { rerender } = renderPasskeySetup();

    await waitFor(() => {
      expect(mockedSkipPasskeyBinding).toHaveBeenCalledTimes(1);
    });

    rerender(
      <SettingsProvider>
        <PasskeySetup />
      </SettingsProvider>
    );

    expect(mockedSkipPasskeyBinding).toHaveBeenCalledTimes(1);
  });

  it('falls back to the upstream error page when the automatic skip fails', async () => {
    mockedSkipPasskeyBinding.mockRejectedValue(new Error('network down'));

    const { findByText } = renderPasskeySetup();

    expect(await findByText('mfa.webauthn_not_supported')).toBeTruthy();
    expect(mockRedirectTo).not.toHaveBeenCalled();
  });
});

describe('PasskeySetup on a browser with WebAuthn', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupportsWebAuthn.mockReturnValue(true);
  });

  it('behaves as upstream: fetches registration options and never skips by itself', async () => {
    mockedCreateRegistrationOptions.mockResolvedValue({
      verificationId: 'verification-id',
      options: { challenge: 'challenge' },
    });

    const { queryByText } = renderPasskeySetup();

    await waitFor(() => {
      expect(mockedCreateRegistrationOptions).toHaveBeenCalledTimes(1);
    });

    expect(mockedSkipPasskeyBinding).not.toHaveBeenCalled();
    expect(mockRedirectTo).not.toHaveBeenCalled();
    expect(queryByText('mfa.webauthn_not_supported')).toBeNull();
  });
});
