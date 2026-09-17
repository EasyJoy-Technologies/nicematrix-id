/**
 * PasskeySetup override vs upstream packages/experience/src/pages/PasskeySetup/index.tsx (v1.43.0).
 *
 * WHY
 * When `passkeySignIn.enabled` is on, the server suggests binding a passkey at the end of every
 * sign-in / register interaction (422 `user.passkey_preferred`) and the experience app routes here.
 * Upstream renders a terminal `<ErrorPage title="mfa.webauthn_not_supported" />` for browsers
 * without WebAuthn — but the only skip control lives on `SecondaryPageLayout`, which that branch
 * never renders. The interaction cannot be submitted without skipping, so the user is stuck: going
 * back re-submits and lands on the same error page again.
 *
 * This is not theoretical. On prod-1 over 60 days, 175 users reached this page and 81 of them
 * (46%) never completed a sign-in afterwards; only 6 of those 81 had ever started a WebAuthn
 * registration, i.e. the rest simply had no WebAuthn at all. The affected clients are Android
 * WebView and the stock Chinese-Android browsers that Custom Tabs falls back to when Chrome is
 * absent (Huawei / MIUI / HeyTap / vivo / Quark / UC), so it cannot be fixed on the client side.
 *
 * WHAT
 * On a browser without WebAuthn we call the existing skip endpoint automatically
 * (`POST /experience/profile/mfa/passkey-skipped` + submit, i.e. exactly what the skip button
 * does) and let the flow continue, showing the standard loading layer meanwhile. If that
 * automatic skip fails we fall back to upstream's error page, so the worst case is never worse
 * than today.
 *
 * WHAT IS DELIBERATELY UNCHANGED
 *   - Browsers that do support WebAuthn: identical to upstream, byte for byte. The registration
 *     options fetch, the bind button and the manual skip control all behave exactly as before.
 *   - The skip semantics themselves: we reuse the same request the skip button issues, so the
 *     persisted `logto_config.passkey_sign_in.skipped` flag means the same thing it always did.
 *     (Users can still add a passkey later from the Account Center.)
 *   - No new i18n keys, no style changes, no server-side change.
 *
 * On upstream sync: re-copy this file and re-apply the `supportsWebAuthn` branch below.
 */
import { InteractionEvent, type WebAuthnRegistrationOptions } from '@logto/schemas';
import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { validate } from 'superstruct';

import SecondaryPageLayout from '@/Layout/SecondaryPageLayout';
import SectionLayout from '@/Layout/SectionLayout';
import { createSignInPasskeyRegistrationOptions, skipPasskeyBinding } from '@/apis/experience';
import useApi from '@/hooks/use-api';
import useErrorHandler from '@/hooks/use-error-handler';
import useGlobalRedirectTo from '@/hooks/use-global-redirect-to';
import usePasskeySignIn from '@/hooks/use-passkey-sign-in';
import useSubmitInteractionErrorHandler from '@/hooks/use-submit-interaction-error-handler';
import ErrorPage from '@/pages/ErrorPage';
import Button from '@/shared/components/Button';
import LoadingLayer from '@/shared/components/LoadingLayer';
import { continueFlowStateGuard } from '@/types/guard';

import styles from './index.module.scss';

type RegistrationState = {
  verificationId: string;
  options: WebAuthnRegistrationOptions;
};

const PasskeySetup = () => {
  const { state } = useLocation();
  const redirectTo = useGlobalRedirectTo();
  const [, continueFlowState] = validate(state, continueFlowStateGuard);

  const { handleBindPasskey } = usePasskeySignIn();
  const asyncCreateRegistrationOptions = useApi(createSignInPasskeyRegistrationOptions);

  const [registrationResult, setRegistrationResult] = useState<RegistrationState>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleError = useErrorHandler();
  const onSubmitErrorHandlers = useSubmitInteractionErrorHandler(
    continueFlowState?.interactionEvent ?? InteractionEvent.SignIn,
    {
      replace: true,
    }
  );

  const asyncSkipPasskeyBinding = useApi(skipPasskeyBinding);

  /**
   * [NiceMatrix] Evaluated once per mount so that the render branch and the auto-skip effect can
   * never disagree, and so the effect has a stable dependency.
   */
  const supportsWebAuthn = useMemo(() => browserSupportsWebAuthn(), []);

  /** [NiceMatrix] Set when the automatic skip failed, to fall back to upstream's error page. */
  const [hasAutoSkipFailed, setHasAutoSkipFailed] = useState(false);
  /** [NiceMatrix] Prevents a second skip request if the effect re-runs. */
  const hasAutoSkipInvokedRef = useRef(false);

  useEffect(() => {
    if (!supportsWebAuthn) {
      return;
    }

    (async () => {
      const [error, result] = await asyncCreateRegistrationOptions();

      if (error) {
        await handleError(error);
        return;
      }

      if (result) {
        setRegistrationResult(result);
      }
    })();
  }, [asyncCreateRegistrationOptions, handleError, supportsWebAuthn]);

  const onCreatePasskey = useCallback(async () => {
    if (!registrationResult) {
      return;
    }

    setIsSubmitting(true);
    await handleBindPasskey(
      registrationResult.options,
      registrationResult.verificationId,
      onSubmitErrorHandlers
    );
    setIsSubmitting(false);
  }, [handleBindPasskey, registrationResult, onSubmitErrorHandlers]);

  /**
   * Upstream's `onSkip`, with a boolean result so the automatic path can tell whether the flow
   * moved on. The layout's skip control ignores the value, so its behaviour is unchanged.
   */
  const onSkip = useCallback(async () => {
    const [error, result] = await asyncSkipPasskeyBinding();

    if (error) {
      await handleError(error, onSubmitErrorHandlers);
      return false;
    }

    if (result) {
      await redirectTo(result.redirectTo);
      return true;
    }

    return false;
  }, [asyncSkipPasskeyBinding, handleError, onSubmitErrorHandlers, redirectTo]);

  // [NiceMatrix] see the file header: skip for browsers that cannot bind a passkey at all.
  useEffect(() => {
    if (supportsWebAuthn || hasAutoSkipInvokedRef.current) {
      return;
    }

    // eslint-disable-next-line @silverhand/fp/no-mutation
    hasAutoSkipInvokedRef.current = true;

    void (async () => {
      const hasContinued = await onSkip();

      if (!hasContinued) {
        setHasAutoSkipFailed(true);
      }
    })();
  }, [onSkip, supportsWebAuthn]);

  if (!supportsWebAuthn) {
    return hasAutoSkipFailed ? <ErrorPage title="mfa.webauthn_not_supported" /> : <LoadingLayer />;
  }

  return (
    <SecondaryPageLayout title="passkey_sign_in.setup_page.title" onSkip={onSkip}>
      <SectionLayout
        title="passkey_sign_in.setup_page.subtitle"
        description="passkey_sign_in.setup_page.description"
      >
        <Button
          className={styles.button}
          title="passkey_sign_in.setup_page.subtitle"
          isLoading={isSubmitting}
          disabled={!registrationResult}
          onClick={onCreatePasskey}
        />
      </SectionLayout>
    </SecondaryPageLayout>
  );
};

export default PasskeySetup;
