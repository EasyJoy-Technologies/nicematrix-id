/*
 * [NiceMatrix override] vs upstream 1.43.0
 *   logto-upstream/packages/experience/src/pages/Continue/index.tsx
 * ONE delta: the profile-completion pages are wrapped in `CarrierProfileSkipContext`,
 * which carries an `onSkip` ONLY for a carrier one-tap sign-up the server confirmed
 * as skippable (hooks/use-carrier-profile-skip.ts; review 2026-10-02 B7). Otherwise
 * the value is undefined and every page renders exactly like upstream.
 * Search for `[NiceMatrix override]`; on upstream sync re-copy and re-apply.
 */
import { MissingProfile } from '@logto/schemas';
import { useLocation, useParams } from 'react-router-dom';
import { validate } from 'superstruct';

// [NiceMatrix override] carrier sign-up profile skip.
import { useCarrierProfileSkip } from '@/hooks/use-carrier-profile-skip';
import ErrorPage from '@/pages/ErrorPage';
import { continueFlowStateGuard } from '@/types/guard';
import { CarrierProfileSkipContext } from '@/utils/carrier-profile-skip-context';

import SetEmailOrPhone from './SetEmailOrPhone';
import SetExtraProfile from './SetExtraProfile';
import SetPassword from './SetPassword';
import SetUsername from './SetUsername';

type Parameters = {
  method?: string;
};

// Upstream `Continue`, renamed: the page chosen for the missing profile.
const ContinuePage = () => {
  const { method = '' } = useParams<Parameters>();
  const { state } = useLocation();

  const [, continueFlowState] = validate(state, continueFlowStateGuard);

  if (!continueFlowState) {
    return <ErrorPage title="error.invalid_session" rawMessage="flow state not found" />;
  }

  const { interactionEvent } = continueFlowState;

  if (method === MissingProfile.password) {
    return <SetPassword interactionEvent={interactionEvent} />;
  }

  if (method === MissingProfile.username) {
    return <SetUsername interactionEvent={interactionEvent} />;
  }

  if (
    method === MissingProfile.email ||
    method === MissingProfile.phone ||
    method === MissingProfile.emailOrPhone
  ) {
    return <SetEmailOrPhone missingProfile={method} interactionEvent={interactionEvent} />;
  }

  if (method === 'extra-profile') {
    return <SetExtraProfile interactionEvent={interactionEvent} />;
  }

  return <ErrorPage />;
};

// [NiceMatrix override] provide the carrier skip (undefined = upstream behaviour).
const Continue = () => {
  const { state } = useLocation();
  const [, continueFlowState] = validate(state, continueFlowStateGuard);
  const onCarrierSkip = useCarrierProfileSkip(continueFlowState?.interactionEvent);

  return (
    <CarrierProfileSkipContext.Provider value={onCarrierSkip}>
      <ContinuePage />
    </CarrierProfileSkipContext.Provider>
  );
};

export default Continue;
