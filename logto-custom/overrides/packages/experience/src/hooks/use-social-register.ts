/*
 * [NiceMatrix override] vs upstream 1.43.0
 *   logto-upstream/packages/experience/src/hooks/use-social-register.ts
 * ONE delta: optional `errorHandlers`, merged AFTER upstream's pre-register
 * handlers (so they can only add codes). Used by the carrier one-tap login
 * callback for `user.phone_already_in_use` (review 2026-10-02 CR-03); every other
 * caller passes nothing and behaves exactly like upstream.
 */
import { AgreeToTermsPolicy, experience, InteractionEvent } from '@logto/schemas';
import { useCallback, useMemo } from 'react';

import { registerWithVerifiedIdentifier } from '@/apis/experience';
import useNavigateWithPreservedSearchParams from '@/hooks/use-navigate-with-preserved-search-params';

import useApi from './use-api';
import useErrorHandler, { type ErrorHandlers } from './use-error-handler';
import useGlobalRedirectTo from './use-global-redirect-to';
import useSubmitInteractionErrorHandler from './use-submit-interaction-error-handler';
import useTerms from './use-terms';

type Options = {
  readonly replace?: boolean;
  readonly onEmailBlocked?: () => void;
  /** [NiceMatrix override] extra handlers, merged after the upstream ones. */
  readonly errorHandlers?: ErrorHandlers;
};

const useSocialRegister = (
  connectorId: string,
  { replace, onEmailBlocked, errorHandlers }: Options = {}
) => {
  const handleError = useErrorHandler();
  const asyncRegisterWithSocial = useApi(registerWithVerifiedIdentifier);
  const redirectTo = useGlobalRedirectTo();
  const { termsValidation, agreeToTermsPolicy } = useTerms();
  const navigate = useNavigateWithPreservedSearchParams();

  const upstreamPreRegisterErrorHandler = useSubmitInteractionErrorHandler(
    InteractionEvent.Register,
    {
      linkSocial: connectorId,
      replace,
      onEmailBlocked,
    }
  );
  // [NiceMatrix override] add the caller's handlers (no-op when none are passed).
  const preRegisterErrorHandler = useMemo(
    () => ({ ...upstreamPreRegisterErrorHandler, ...errorHandlers }),
    [errorHandlers, upstreamPreRegisterErrorHandler]
  );

  return useCallback(
    async (verificationId: string) => {
      /**
       * Agree to terms and conditions first before proceeding
       * If the agreement policy is `Manual`, the user must agree to the terms to reach this step.
       * Therefore, skip the check for `Manual` policy.
       */
      if (agreeToTermsPolicy !== AgreeToTermsPolicy.Manual && !(await termsValidation())) {
        navigate('/' + experience.routes.signIn);
        return;
      }

      const [error, result] = await asyncRegisterWithSocial(verificationId);

      if (error) {
        await handleError(error, preRegisterErrorHandler);

        return;
      }

      if (result?.redirectTo) {
        await redirectTo(result.redirectTo);
      }
    },
    [
      agreeToTermsPolicy,
      asyncRegisterWithSocial,
      handleError,
      navigate,
      preRegisterErrorHandler,
      redirectTo,
      termsValidation,
    ]
  );
};

export default useSocialRegister;
