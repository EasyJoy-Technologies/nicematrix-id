import { InteractionEvent, MfaFactor, type SignInIdentifier, VerificationType } from '@logto/schemas';
import { trySafe } from '@silverhand/essentials';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { useCallback, useContext, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import UserInteractionContext from '@/Providers/UserInteractionContextProvider/UserInteractionContext';
import WebAuthnContext from '@/Providers/WebAuthnContextProvider/WebAuthnContext';
import {
  createIdentifierPasskeyAuthentication,
  verifyIdentifierPasskey,
} from '@/apis/experience';
import useNavigateWithPreservedSearchParams from '@/hooks/use-navigate-with-preserved-search-params';
import { UserFlow } from '@/types';
import type { IdentifierPasskeyState } from '@/types/guard';

import useApi from './use-api';
import useErrorHandler, { type ErrorHandlers } from './use-error-handler';
import useGlobalRedirectTo from './use-global-redirect-to';
import useSubmitInteractionErrorHandler from './use-submit-interaction-error-handler';
import useToast from './use-toast';

type Props = {
  readonly hideErrorToast: boolean;
};

/**
 * Hook to start identifier-based passkey verification flow.
 *
 * OVERRIDE (NiceMatrix):
 * This version attempts to trigger WebAuthn authentication IMMEDIATELY within the
 * same user-gesture callback (no navigation in between), so the browser's WebAuthn
 * prompt appears without requiring the user to click an additional button.
 *
 * Fallback behaviour:
 * - If WebAuthn fails or the user cancels, we still navigate to /sign-in/passkey
 *   so the user can retry via button or switch to password/verification code.
 * - If user has no passkeys, returns false so caller falls back to password/OTP.
 */
const useStartIdentifierPasskeySignInProcessing = ({ hideErrorToast }: Props) => {
  const { t } = useTranslation();
  const { setToast } = useToast();
  const navigate = useNavigateWithPreservedSearchParams();
  const asyncCreateAuthentication = useApi(createIdentifierPasskeyAuthentication);
  const asyncVerifyIdentifierPasskey = useApi(verifyIdentifierPasskey);
  const { setVerificationId, setHasBoundPasskey } = useContext(UserInteractionContext);
  const { abortConditionalUI } = useContext(WebAuthnContext);
  const [isProcessing, setIsProcessing] = useState(false);
  const handleError = useErrorHandler();
  const preSignInErrorHandler = useSubmitInteractionErrorHandler(InteractionEvent.SignIn);
  const redirectTo = useGlobalRedirectTo();

  const errorHandlers: ErrorHandlers = useMemo(
    () => ({
      'session.mfa.webauthn_verification_not_found': async (error) => {
        // No passkeys registered
        if (!hideErrorToast) {
          setToast(error.message);
        }
        // Do nothing and silently fall back to other methods if hideErrorToast is true
      },
    }),
    [setToast, hideErrorToast]
  );

  /**
   * @returns
   * `true` if passkey flow was started (either verified directly, or user sent to retry page)
   * `false` if user has no passkeys (caller should fall back to other verification methods)
   * `undefined` if already processing
   */
  const startProcessing = useCallback(
    async (identifier: { type: SignInIdentifier; value: string }): Promise<boolean | undefined> => {
      if (isProcessing) {
        return undefined;
      }

      // Abort any ongoing conditional UI (e.g. passkey autofill prompt) in the previous step.
      abortConditionalUI();

      setIsProcessing(true);
      const [error, result] = await asyncCreateAuthentication(identifier);

      if (error) {
        setIsProcessing(false);
        await handleError(error, errorHandlers);
        // User likely has no passkeys; caller will fall back to password/OTP.
        return false;
      }

      if (!result) {
        setIsProcessing(false);
        return false;
      }

      const { verificationId, options } = result;
      setVerificationId(VerificationType.SignInPasskey, verificationId);
      setHasBoundPasskey(true);

      const state: IdentifierPasskeyState = { options };

      // --- NiceMatrix auto-trigger block ---
      // Try to trigger WebAuthn authentication immediately within the same user-gesture chain.
      // If this succeeds, sign-in completes without any intermediate button page.
      if (browserSupportsWebAuthn()) {
        const authResponse = await trySafe(async () => startAuthentication(options));

        if (authResponse) {
          const [verifyError, verifyResult] = await asyncVerifyIdentifierPasskey(verificationId, {
            ...authResponse,
            type: MfaFactor.WebAuthn,
          });

          setIsProcessing(false);

          if (verifyError) {
            // Verification backend rejected; show error and send to retry page.
            await handleError(verifyError, preSignInErrorHandler);
            navigate({ pathname: `/${UserFlow.SignIn}/passkey` }, { state });
            return true;
          }

          if (verifyResult) {
            await redirectTo(verifyResult.redirectTo);
            return true;
          }
        }
        // authResponse undefined = user cancelled or WebAuthn prompt was blocked.
        // Fall through to navigate to retry page.
      }
      // --- end auto-trigger block ---

      setIsProcessing(false);
      // Fallback: navigate to passkey retry page (original upstream behaviour).
      navigate({ pathname: `/${UserFlow.SignIn}/passkey` }, { state });
      return true;
    },
    [
      abortConditionalUI,
      asyncCreateAuthentication,
      asyncVerifyIdentifierPasskey,
      errorHandlers,
      handleError,
      isProcessing,
      navigate,
      preSignInErrorHandler,
      redirectTo,
      setHasBoundPasskey,
      setVerificationId,
    ]
  );

  return useMemo(
    () => ({
      startProcessing,
      isProcessing,
    }),
    [startProcessing, isProcessing]
  );
};

export default useStartIdentifierPasskeySignInProcessing;
