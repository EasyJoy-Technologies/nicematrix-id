/**
 * [NiceMatrix] Carrier one-tap login — "skip profile completion" for carrier sign-ups.
 *
 * NiceMatrix-owned routes (no upstream counterpart), mounted on the experience
 * router by the `routes/experience/index.ts` override, so the interaction is
 * loaded / saved by upstream's `koaExperienceInteraction()` like every other
 * experience route. Review 2026-10-02 CR-14 / B7; decision 2026-10-03: a new
 * number signing up through carrier is PROMPTED for the sign-up requirements
 * (username / email / custom profile fields …) but may skip them.
 *
 *   GET  /api/experience/profile/carrier-skip  → 200 { skippable }
 *        the Experience asks before offering the "Skip" control (server decides)
 *   POST /api/experience/profile/carrier-skip  → 204
 *        records the skip on THIS interaction (Profile.markCarrierProfileSkipped);
 *        the Experience then calls identify + submit exactly like after a filled form
 *
 * `skippable` / the write require: Register interaction + pending profile whose
 * verified social identity is the carrier connector + user not created yet
 * (`Profile.canSkipForCarrier`). Anything else → 400, nothing written. The flag
 * lives inside the server-side interaction (oidc-provider session-bound), so it
 * cannot be forged by the browser or borrowed by another sign-up method.
 */
import type Router from 'koa-router';
import { z } from 'zod';

import koaGuard from '#src/middleware/koa-guard.js';

import { experienceRoutes } from './const.js';
import { type ExperienceInteractionRouterContext } from './types.js';

export const carrierProfileSkipPath = `${experienceRoutes.profile}/carrier-skip`;

export default function carrierProfileSkipRoutes<T extends ExperienceInteractionRouterContext>(
  router: Router<unknown, T>
) {
  router.get(
    carrierProfileSkipPath,
    koaGuard({ status: [200], response: z.object({ skippable: z.boolean() }) }),
    async (ctx, next) => {
      ctx.body = { skippable: ctx.experienceInteraction.profile.canSkipForCarrier };
      ctx.status = 200;

      return next();
    }
  );

  router.post(
    carrierProfileSkipPath,
    koaGuard({ status: [204, 400] }),
    async (ctx, next) => {
      const { experienceInteraction } = ctx;

      experienceInteraction.profile.markCarrierProfileSkipped();
      await experienceInteraction.save();

      ctx.status = 204;

      return next();
    }
  );
}
