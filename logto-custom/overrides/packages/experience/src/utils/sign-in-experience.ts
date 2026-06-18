/**
 * Temp Solution for getting the sign in experience
 * Remove this once we have a better way to get the sign in experience through SSR
 *
 * [NiceMatrix override] Single delta vs upstream: after upstream's platform-based
 * `filterSocialConnectors`, apply the region-aware `show_social` / `hide_social`
 * visibility rule (see `utils/native-caps.ts`). This is the SINGLE source of truth
 * for the social-connector list — every consumer (the "or" Divider gate in
 * SignIn/Register, SocialSignInList, DirectSignIn, the web callback resolver) reads
 * the already-filtered array, so a hidden provider disappears consistently with no
 * orphan "or" divider. When neither param is declared (PC / intl / no-App entries)
 * the rule is null and this is byte-identical to upstream.
 *
 * GUARDRAIL: we only ever touch `socialConnectors`. Email/password/username live in
 * `signIn.methods` and are untouched, so primary login can never be hidden.
 *
 * Upgrade note: re-derive from upstream `utils/sign-in-experience.ts` if it changes;
 * the NiceMatrix delta is marked with `[NiceMatrix]` comments below.
 */

import { SignInIdentifier, VerificationType } from '@logto/schemas';
import { isObject } from '@silverhand/essentials';
import i18next from 'i18next';

import { getSignInExperience } from '@/apis/settings';
import { searchKeys, searchKeysCamelCase } from '@/shared/utils/search-parameters';
import type { SignInExperienceResponse } from '@/types';
import { shouldHideSocialTarget } from '@/utils/native-caps';
import { filterSocialConnectors } from '@/utils/social-connectors';

const parseSignInExperienceResponse = (
  response: SignInExperienceResponse
): SignInExperienceResponse => {
  const { socialConnectors, googleOneTap, ...rest } = response;

  // Upstream platform-based filter first…
  const platformFiltered = filterSocialConnectors(socialConnectors);
  // …then the NiceMatrix region-aware show/hide rule.
  const visibleSocialConnectors = platformFiltered.filter(
    (connector) => !shouldHideSocialTarget(connector.target)
  );

  // [NiceMatrix] If the Google connector is hidden by the rule, also suppress the
  // Google One Tap auto-prompt so a "hidden" provider can't silently reappear as a
  // floating One Tap card. `google` is the connector target; One Tap is keyed to it.
  const googleHidden = shouldHideSocialTarget('google');

  return {
    ...rest,
    socialConnectors: visibleSocialConnectors,
    googleOneTap: googleHidden ? undefined : googleOneTap,
  };
};

export const getSignInExperienceSettings = async (): Promise<SignInExperienceResponse> => {
  if (isObject(logtoSsr)) {
    const { data, ...rest } = logtoSsr.signInExperience;

    if (
      searchKeysCamelCase.every((key) => {
        const ssrValue = rest[key];
        const storageValue = sessionStorage.getItem(searchKeys[key]) ?? undefined;
        return (!ssrValue && !storageValue) || ssrValue === storageValue;
      })
    ) {
      return parseSignInExperienceResponse(data);
    }
  }

  const response = await getSignInExperience<SignInExperienceResponse>();
  return parseSignInExperienceResponse(response);
};

export const isEmailOrPhoneMethod = (
  method: SignInIdentifier
): method is SignInIdentifier.Email | SignInIdentifier.Phone =>
  [SignInIdentifier.Email, SignInIdentifier.Phone].includes(method);

export const parseHtmlTitle = (path: string) => {
  // Will update soon, remove generic of `.t()` to unblock
  if (path.startsWith('/sign-in') || path.startsWith('/callback') || path.startsWith('/consent')) {
    return i18next.t('description.sign_in');
  }

  if (path.startsWith('/register') || path.startsWith('/social/link')) {
    return i18next.t('description.create_account');
  }

  if (path.startsWith('/forgot-password')) {
    return i18next.t('description.reset_password');
  }

  // Return undefined for all continue flow pages to keep title remain the same as the previous page
  if (path.startsWith('/continue')) {
    return;
  }

  return 'Logto';
};

export const codeVerificationTypeMap = Object.freeze({
  [SignInIdentifier.Email]: VerificationType.EmailVerificationCode,
  [SignInIdentifier.Phone]: VerificationType.PhoneVerificationCode,
});
