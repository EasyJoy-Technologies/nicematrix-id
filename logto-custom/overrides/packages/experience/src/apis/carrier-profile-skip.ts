/**
 * [NiceMatrix] Carrier sign-up "skip profile completion" — Experience API calls.
 * Server side: core `routes/experience/carrier-profile-skip-routes.ts`. Used only by
 * `hooks/use-carrier-profile-skip.ts`.
 */
import api from './api';
import { experienceApiRoutes } from './experience/const';
import { identifyUser, submitInteraction } from './experience/interaction';

const carrierSkipRoute = `${experienceApiRoutes.profile}/carrier-skip`;

export const fetchCarrierSkippable = async () =>
  api.get(carrierSkipRoute).json<{ skippable: boolean }>();

/** Record the skip, then identify + submit exactly like `fulfillProfile` for Register. */
export const skipCarrierProfile = async () => {
  await api.post(carrierSkipRoute);
  await identifyUser();

  return submitInteraction();
};
