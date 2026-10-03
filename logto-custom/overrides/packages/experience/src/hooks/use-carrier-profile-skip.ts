/**
 * [NiceMatrix] Carrier one-tap login — "Skip" on the profile-completion pages of a
 * carrier sign-up (review 2026-10-02 CR-14 / B7; decision 2026-10-03: prompt, but
 * allow skipping).
 *
 * NiceMatrix-owned module (no upstream counterpart). The server decides:
 * `GET /api/experience/profile/carrier-skip` says whether THIS interaction is a
 * carrier sign-up awaiting profile completion (Core `carrier-profile-skip-routes.ts`);
 * only then is the upstream NavBar "Skip" control offered (`SecondaryPageLayout`
 * override reads `utils/carrier-profile-skip-context.ts`). Skip = record it on the interaction,
 * then identify + submit exactly as after a completed form (`fulfillProfile`).
 *
 * The check only runs when the App declared carrier for this sign-in and the flow
 * is a registration, so every other page / flow makes no extra request and renders
 * exactly like upstream.
 */
import { InteractionEvent, experience } from '@logto/schemas';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchCarrierSkippable, skipCarrierProfile } from '@/apis/carrier-profile-skip';
import useApi from '@/hooks/use-api';
import useErrorHandler from '@/hooks/use-error-handler';
import useGlobalRedirectTo from '@/hooks/use-global-redirect-to';
import useNavigateWithPreservedSearchParams from '@/hooks/use-navigate-with-preserved-search-params';
import useSubmitInteractionErrorHandler from '@/hooks/use-submit-interaction-error-handler';
import useToast from '@/hooks/use-toast';
import { type ContinueFlowInteractionEvent } from '@/types';
import { readCarrierContext } from '@/utils/carrier-capability';
import { carrierFailureMessage } from '@/utils/carrier-phrases';

export const useCarrierProfileSkip = (
  interactionEvent: ContinueFlowInteractionEvent | undefined
): (() => void) | undefined => {
  const [skippable, setSkippable] = useState(false);
  const asyncSkip = useApi(skipCarrierProfile);
  const handleError = useErrorHandler();
  const redirectTo = useGlobalRedirectTo();
  const navigate = useNavigateWithPreservedSearchParams();
  const { setToast } = useToast();
  const submitErrorHandlers = useSubmitInteractionErrorHandler(InteractionEvent.Register, {
    replace: true,
  });
  // The number was taken by another account while this sign-up sat on the profile
  // page: same outcome as the callback (review CR-03) — "timed out, try again",
  // back to sign-in; the next carrier sign-in links to that account.
  const errorHandlers = useMemo(
    () => ({
      ...submitErrorHandlers,
      'user.phone_already_in_use': () => {
        setToast(carrierFailureMessage('attempt_expired'));
        navigate('/' + experience.routes.signIn, { replace: true });
      },
    }),
    [navigate, setToast, submitErrorHandlers]
  );

  const isCandidate =
    interactionEvent === InteractionEvent.Register && readCarrierContext() !== null;

  useEffect(() => {
    if (!isCandidate) {
      return;
    }

    let isActive = true;

    // Best-effort: any failure just means "no Skip" (the upstream page).
    fetchCarrierSkippable()
      .then(({ skippable }) => {
        if (isActive) {
          setSkippable(skippable === true);
        }
      })
      .catch(() => {
        if (isActive) {
          setSkippable(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [isCandidate]);

  const onSkip = useCallback(async () => {
    const [error, result] = await asyncSkip();

    if (error) {
      await handleError(error, errorHandlers);

      return;
    }

    if (result?.redirectTo) {
      await redirectTo(result.redirectTo);
    }
  }, [asyncSkip, errorHandlers, handleError, redirectTo]);

  return isCandidate && skippable
    ? () => {
        void onSkip();
      }
    : undefined;
};
