import {
  AgreeToTermsPolicy,
  ConnectorPlatform,
  VerificationType,
  experience,
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
import useToast from '@/hooks/use-toast';
import { searchKeys } from '@/shared/utils/search-parameters';
import {
  claimAutoPrompt,
  claimManualAttempt,
  disableCarrier,
  isCarrierDisabled,
  isCarrierTarget,
  readCarrierContext,
} from '@/utils/carrier-capability';
import { carrierRetryLimitMessage } from '@/utils/carrier-phrases';
import { buildTakeoverUrl } from '@/utils/native-caps';
import { getLogtoNativeSdk, isNativeWebview } from '@/utils/native-sdk';
import { generateState, storeState, buildSocialLandingUri } from '@/utils/social-connectors';
import { storeRedirectContext } from '@/utils/social-redirect-fallback-context';
import { getSocialCallbackUri } from '@/utils/social-redirect-override';

// NiceMatrix carrier one-tap login: any carrier dead end on the DirectSignIn
// page goes to the ordinary sign-in page of the SAME interaction (replace, so
// Back never re-enters the auto prompt). Elsewhere the user simply stays.
const leaveCarrierDirectPage = () => {
  if (window.location.pathname.startsWith('/direct/')) {
    window.location.replace('/' + experience.routes.signIn);
  }
};

const useSocial = () => {
  const { experienceSettings, theme } = useContext(PageContext);

  const handleError = useErrorHandler();
  const asyncInvokeSocialSignIn = useApi(getSocialAuthorizationUrl);
  const { termsValidation, agreeToTermsPolicy } = useTerms();
  const { setVerificationId } = useContext(UserInteractionContext);
  const { setToast } = useToast();

  /**
   * NiceMatrix carrier gate (plan §6.2). Auto prompt (DirectSignIn) happens at
   * most ONCE per sign-in, keyed by the challenge in sessionStorage (upstream's
   * in-memory ref is lost on Back / refresh). The list button is a manual h5
   * retry, capped per sign-in. A disabled or absent context never proceeds.
   */
  const passCarrierGate = useCallback((): boolean => {
    const context = readCarrierContext();

    if (!context || isCarrierDisabled(context)) {
      return false;
    }

    if (window.location.pathname.startsWith('/direct/')) {
      return claimAutoPrompt(context);
    }

    if (context.mode !== 'h5') {
      return false;
    }

    if (!claimManualAttempt(context)) {
      setToast(carrierRetryLimitMessage());
      return false;
    }

    return true;
  }, [setToast]);

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
      const isCarrier = isCarrierTarget(connector.target);

      if (isCarrier && !passCarrierGate()) {
        leaveCarrierDirectPage();
        return;
      }

      /**
       * Check if the user has agreed to the terms and privacy policy before navigating to the 3rd-party social sign-in page
       * when the policy is set to `Manual`
       */
      if (agreeToTermsPolicy === AgreeToTermsPolicy.Manual && !(await termsValidation())) {
        if (isCarrier) {
          leaveCarrierDirectPage();
        }

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
        // [NiceMatrix] carrier: a `connector.*` error means this sign-in cannot
        // offer carrier login (Core refused the launch context: App context
        // missing / no key, or the connector has no Broker for the region) —
        // behave exactly like `not_supported`: silent, hidden for this sign-in.
        // Session / guard errors keep upstream handling (review CR-17).
        await handleError(
          error,
          isCarrier
            ? {
                global: (body) => {
                  if (body.code.startsWith('connector.')) {
                    const context = readCarrierContext();

                    if (context) {
                      disableCarrier(context);
                    }

                    return;
                  }

                  setToast(body.message);
                },
              }
            : undefined
        );

        if (isCarrier) {
          leaveCarrierDirectPage();
        }

        return;
      }

      if (!result) {
        if (isCarrier) {
          leaveCarrierDirectPage();
        }

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

      // NiceMatrix carrier: the Broker is an intermediate hop of THIS interaction —
      // replace (not push) so Back from the Broker never re-runs the auto prompt.
      if (isCarrier) {
        window.location.replace(authorizationUri);

        return;
      }

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
      passCarrierGate,
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
