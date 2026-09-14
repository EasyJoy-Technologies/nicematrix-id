/**
 * [NiceMatrix] Override of upstream SocialCallback (1.43.0 base).
 *
 * Single delta: the verify `redirectUri` goes through `getSocialCallbackUri()`,
 * which swaps in the ICP-filed origin (`id.ej-mobile.cn`) for the QQ connector
 * and returns `window.location.origin` — i.e. verbatim upstream — for every
 * other connector. It must produce the SAME string the authorization request
 * used, so both sides call the one helper.
 *
 * 1.43 upgrade note: upstream `b64d46d495` unified the Sign-in Experience and
 * Account Center social callback URI on `/callback/:connectorId` (routed by the
 * `state` prefix in `core/src/routes/callback.ts`) precisely so single-redirect
 * connectors like QQ can serve both flows. That makes the AC redirect URI
 * identical in shape to the Experience one, so this file now reuses the same
 * helper instead of composing its own account-center path.
 *
 * Also dropped in 1.43: the `extractConnectorIdFromPath()` fallback. Upstream
 * renders this component inside `<Routes path={`${socialCallbackRoutePrefix}/:connectorId`}>`
 * (App.tsx), so `useParams()` always resolves; the fallback was dead defensive
 * code and pure drift.
 */
import { AccountCenterControlValue, type ExperienceSocialConnector } from '@logto/schemas';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import PageContext from '@ac/Providers/PageContextProvider/PageContext';
import {
  linkSocialIdentity,
  replaceSocialIdentity,
  verifySocialVerification,
} from '@ac/apis/social';
import ErrorPage from '@ac/components/ErrorPage';
import GlobalLoading from '@ac/components/GlobalLoading';
import { getSocialAddRoute, getSocialChangeRoute } from '@ac/constants/routes';
import useApi from '@ac/hooks/use-api';
import useErrorHandler from '@ac/hooks/use-error-handler';
import { canManageSocialIdentitiesWithoutVerification } from '@ac/utils/security-page';
import { accountStorage } from '@ac/utils/session-storage';
import { getLocalizedConnectorName } from '@ac/utils/social-connector';
import { finalizeSocialFlowFailure, finalizeSocialFlowSuccess } from '@ac/utils/social-flow';
// [NiceMatrix] connector-specific callback origin (QQ ICP domain).
import { getSocialCallbackUri } from '@experience/utils/social-redirect-override';

const SocialCallback = () => {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const navigate = useNavigate();
  const [searchParameters] = useSearchParams();
  const { connectorId } = useParams<{ connectorId: string }>();
  const {
    accountCenterSettings,
    experienceSettings,
    isLoadingExperience,
    refreshUserInfo,
    setToast,
    userInfo,
    verificationId,
    setVerificationId,
  } = useContext(PageContext);
  const canSkipVerification = canManageSocialIdentitiesWithoutVerification(userInfo);
  const verifySocialVerificationRequest = useApi(verifySocialVerification);
  const linkSocialIdentityRequest = useApi(linkSocialIdentity);
  const replaceSocialIdentityRequest = useApi(replaceSocialIdentity);
  const handleError = useErrorHandler();
  const [startedConnectorId, setStartedConnectorId] = useState<string>();

  const connector = useMemo(
    (): ExperienceSocialConnector | undefined =>
      experienceSettings?.socialConnectors.find(({ id }) => id === connectorId),
    [connectorId, experienceSettings?.socialConnectors]
  );
  const connectorName = connector ? getLocalizedConnectorName(connector, language) : undefined;
  const storedSocialFlow = connectorId ? accountStorage.socialFlow.get(connectorId) : undefined;

  const redirectToReverify = useCallback(async () => {
    if (!connectorId) {
      return;
    }

    await refreshUserInfo();
    setStartedConnectorId(undefined);
    setVerificationId(undefined);
    setToast(t('account_center.verification.verification_required'));
    navigate(
      storedSocialFlow?.mode === 'change'
        ? getSocialChangeRoute(connectorId)
        : getSocialAddRoute(connectorId),
      { replace: true }
    );
  }, [
    connectorId,
    navigate,
    refreshUserInfo,
    setToast,
    setVerificationId,
    storedSocialFlow?.mode,
    t,
  ]);

  const finishLinkFlow = useCallback(async () => {
    if (!connectorId || !connectorName) {
      return;
    }

    await finalizeSocialFlowSuccess({
      connectorId,
      refreshUserInfo,
      navigate,
    });
  }, [connectorId, connectorName, navigate, refreshUserInfo]);

  useEffect(() => {
    if (!connectorId || !connector || startedConnectorId === connectorId) {
      return;
    }

    if (!verificationId && !canSkipVerification) {
      return;
    }

    setStartedConnectorId(connectorId);

    if (storedSocialFlow?.status !== 'pending') {
      finalizeSocialFlowFailure({
        connectorId,
        clearFlowRecord: true,
        message: t('error.invalid_session'),
        setToast,
        navigate,
      });
      return;
    }

    if (storedSocialFlow.state !== (searchParameters.get('state') ?? undefined)) {
      finalizeSocialFlowFailure({
        connectorId,
        clearFlowRecord: true,
        message: t('error.invalid_connector_auth'),
        setToast,
        navigate,
      });
      return;
    }

    const handleCallbackError = async (error: unknown, clearPendingVerification = true) => {
      await handleError(error, {
        'verification_record.permission_denied': redirectToReverify,
        'user.social_account_exists_in_profile': async (requestError) => {
          finalizeSocialFlowFailure({
            connectorId,
            clearFlowRecord: true,
            message: requestError.message,
            setToast,
            navigate,
          });
        },
        global: async (requestError) => {
          finalizeSocialFlowFailure({
            connectorId,
            clearFlowRecord: clearPendingVerification,
            message: requestError.message,
            setToast,
            navigate,
          });
        },
      });
    };

    const completeCallback = async () => {
      // [NiceMatrix] QQ ICP redirect: `getSocialCallbackUri` returns
      // `${window.location.origin}/callback/${connectorId}` (= upstream) for every
      // connector except QQ, which gets the ICP-filed origin instead.
      const redirectUri = getSocialCallbackUri(connectorId);
      const [verifyError] = await verifySocialVerificationRequest({
        verificationRecordId: storedSocialFlow.verificationRecordId,
        connectorData: {
          ...Object.fromEntries(searchParameters.entries()),
          redirectUri,
        },
      });

      if (verifyError) {
        await handleCallbackError(verifyError);
        return;
      }

      accountStorage.socialFlow.setVerified(connectorId, {
        verificationRecordId: storedSocialFlow.verificationRecordId,
        expiresAt: storedSocialFlow.expiresAt,
        mode: storedSocialFlow.mode,
      });

      if (storedSocialFlow.mode === 'change') {
        const [error] = await replaceSocialIdentityRequest(
          verificationId,
          storedSocialFlow.verificationRecordId
        );

        if (error) {
          await handleCallbackError(error);
          return;
        }
      } else {
        const [error] = await linkSocialIdentityRequest(
          verificationId,
          storedSocialFlow.verificationRecordId
        );

        if (error) {
          await handleCallbackError(error, false);
          return;
        }
      }

      await finishLinkFlow();
    };

    void completeCallback();
  }, [
    connector,
    connectorId,
    finishLinkFlow,
    handleError,
    linkSocialIdentityRequest,
    replaceSocialIdentityRequest,
    navigate,
    redirectToReverify,
    searchParameters,
    setToast,
    startedConnectorId,
    storedSocialFlow,
    canSkipVerification,
    verificationId,
    verifySocialVerificationRequest,
    t,
  ]);

  if (isLoadingExperience) {
    return <GlobalLoading />;
  }

  if (!accountCenterSettings || !experienceSettings) {
    return <ErrorPage titleKey="error.something_went_wrong" />;
  }

  if (
    !accountCenterSettings.enabled ||
    accountCenterSettings.fields.social !== AccountCenterControlValue.Edit
  ) {
    return (
      <ErrorPage titleKey="error.something_went_wrong" messageKey="error.feature_not_enabled" />
    );
  }

  if (!connectorId || !connector) {
    return (
      <ErrorPage
        titleKey="error.something_went_wrong"
        messageKey="account_center.social.not_enabled"
      />
    );
  }

  return <GlobalLoading />;
};

export default SocialCallback;
