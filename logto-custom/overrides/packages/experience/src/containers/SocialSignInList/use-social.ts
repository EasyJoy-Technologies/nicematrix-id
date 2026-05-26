import {
  AgreeToTermsPolicy,
  ConnectorPlatform,
  VerificationType,
  type ExperienceSocialConnector,
} from '@logto/schemas';
import { useCallback, useContext } from 'react';

import PageContext from '@/Providers/PageContextProvider/PageContext';
import UserInteractionContext from '@/Providers/UserInteractionContextProvider/UserInteractionContext';
import { getSocialAuthorizationUrl } from '@/apis/experience';
import useApi from '@/hooks/use-api';
import useErrorHandler from '@/hooks/use-error-handler';
import useGlobalRedirectTo from '@/hooks/use-global-redirect-to';
import useTerms from '@/hooks/use-terms';
import { searchKeys } from '@/shared/utils/search-parameters';
import { buildTakeoverUrl } from '@/utils/native-caps';
import { getLogtoNativeSdk, isNativeWebview } from '@/utils/native-sdk';
import { generateState, storeState, buildSocialLandingUri } from '@/utils/social-connectors';
import { storeRedirectContext } from '@/utils/social-redirect-fallback-context';
import { getSocialCallbackUri } from '@/utils/social-redirect-override';

const useSocial = () => {
  const { experienceSettings, theme } = useContext(PageContext);

  const handleError = useErrorHandler();
  const asyncInvokeSocialSignIn = useApi(getSocialAuthorizationUrl);
  const { termsValidation, agreeToTermsPolicy } = useTerms();
  const { setVerificationId } = useContext(UserInteractionContext);

  const redirectTo = useGlobalRedirectTo({
    shouldClearInteractionContextSession: false,
    isReplace: false,
  });

  const nativeSignInHandler = useCallback(
    (redirectTo: string, connector: ExperienceSocialConnector) => {
      const { id: connectorId, platform } = connector;

      const redirectUri =
        platform === ConnectorPlatform.Universal
          ? buildSocialLandingUri(`/social/landing/${connectorId}`, redirectTo).toString()
          : redirectTo;

      getLogtoNativeSdk()?.getPostMessage()({
        callbackUri: `${window.location.origin}/callback/social/${connectorId}`,
        redirectTo: redirectUri,
      });
    },
    []
  );

  const invokeSocialSignInHandler = useCallback(
    async (connector: ExperienceSocialConnector) => {
      /**
       * Check if the user has agreed to the terms and privacy policy before navigating to the 3rd-party social sign-in page
       * when the policy is set to `Manual`
       */
      if (agreeToTermsPolicy === AgreeToTermsPolicy.Manual && !(await termsValidation())) {
        return;
      }

      const { id: connectorId, target } = connector;

      const state = generateState();
      storeState(state, connectorId);

      // NiceMatrix override (方案 X): if the App declared native_caps and this
      // target is one the App can take over (wechat / alipay / qq), short-circuit
      // here. Emit a custom-scheme URL that ASWebAuthenticationSession captures;
      // the App then runs the native SDK and posts the result to the business
      // backend. We do NOT call Logto's getSocialAuthorizationUrl, do NOT write
      // any fallback context, and do NOT redirect through the upstream OAuth
      // flow — that is the entire point of the takeover.
      //
      // Apple / Google / Microsoft / etc. never hit this branch because
      // buildTakeoverUrl returns null for non-whitelisted targets.
      const takeoverUrl = buildTakeoverUrl(target, state);
      if (takeoverUrl) {
        window.location.assign(takeoverUrl);
        return;
      }

      const [error, result] = await asyncInvokeSocialSignIn(
        connectorId,
        state,
        getSocialCallbackUri(connectorId)
      );

      if (error) {
        await handleError(error);

        return;
      }

      if (!result) {
        return;
      }

      const { verificationId, authorizationUri } = result;

      setVerificationId(VerificationType.Social, verificationId);

      // Write fallback bundle to localStorage for in-app browser session recovery
      storeRedirectContext({
        state,
        flow: 'social',
        connectorId,
        verificationId,
        appId: sessionStorage.getItem(searchKeys.appId) ?? undefined,
        organizationId: sessionStorage.getItem(searchKeys.organizationId) ?? undefined,
        uiLocales: sessionStorage.getItem(searchKeys.uiLocales) ?? undefined,
      });

      // Invoke native social sign-in flow
      if (isNativeWebview()) {
        nativeSignInHandler(authorizationUri, connector);

        return;
      }

      // Invoke web social sign-in flow
      await redirectTo(authorizationUri);
    },
    [
      agreeToTermsPolicy,
      asyncInvokeSocialSignIn,
      handleError,
      nativeSignInHandler,
      redirectTo,
      setVerificationId,
      termsValidation,
    ]
  );

  return {
    theme,
    socialConnectors: experienceSettings?.socialConnectors ?? [],
    invokeSocialSignIn: invokeSocialSignInHandler,
  };
};

export default useSocial;
