import { useHandleSignInCallback } from '@logto/react';
import { useEffect } from 'react';

import { clearVerificationRecord } from './Providers/PageContextProvider/verification-storage';
import GlobalLoading from './components/GlobalLoading';

/**
 * NiceMatrix override (Bug-B fix).
 *
 * Upstream Callback.tsx calls `clearAllTokens()` inside a `useEffect`
 * alongside `useHandleSignInCallback`, creating a same-frame race
 * between (a) the PKCE code→token exchange writing freshly-acquired
 * tokens into storage and (b) `clearAllTokens()` wiping them.
 *
 * On PC (fast LAN + V8 microtask order), the exchange almost always
 * resolves first and `location.replace('/account')` fires before the
 * clear takes effect. On iOS Safari / Android Chrome (slower network
 * + different WebKit microtask ordering), the clear can fire AFTER
 * the token write — wiping the session, leaving `useHandleSignInCallback`
 * in an inconsistent state, and the success callback never runs. Users
 * see `/account?code=…` frozen forever.
 *
 * Evidence (prod-1 logs 2026-05-26 21:30–21:50): repeated
 *   POST /oidc/token 400 → invalid_grant / code already consumed
 * matching the race timing.
 *
 * Fix: don't call `clearAllTokens()`. On a sign-in callback the SDK is
 * about to overwrite tokens with the newly-issued pair anyway; clearing
 * first is redundant on PC and racy on mobile. `clearVerificationRecord()`
 * is preserved — it's an unrelated cleanup for the bind verification
 * record state.
 */
const Callback = () => {
  // Bug-B fix: do NOT call clearAllTokens here. Race-free useEffect for
  // verification-record cleanup only (runs once on mount).
  useEffect(() => {
    clearVerificationRecord();
  }, []);

  const { error } = useHandleSignInCallback(() => {
    window.location.replace('/account');
  });

  if (error) {
    return (
      <>
        <p>We couldn&apos;t complete the sign in callback.</p>
        <pre>{error.message}</pre>
        <button
          type="button"
          onClick={() => {
            window.location.replace('/account');
          }}
        >
          Back to sign in
        </button>
      </>
    );
  }

  return <GlobalLoading />;
};

export default Callback;
