/**
 * [NiceMatrix] Override: Fix connectorId extraction in social callback flow.
 *
 * Root cause: In App.tsx, `SocialCallback` is rendered via an early return
 * (`if (isSocialCallback) { return <SocialCallback />; }`) OUTSIDE the
 * `<Routes>` wrapper. React Router's `useParams()` only works inside a
 * matching `<Route>`, so `connectorId` comes back as `undefined`, causing
 * the "social sign-in method not enabled" error.
 *
 * Fix: Fall back to parsing `connectorId` from `window.location.pathname`
 * when `useParams()` returns nothing.
 */
import { AccountCenterControlValue, type ExperienceSocialConnector } from '@logto/schemas';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import PageContext from '@ac/Providers/PageContextProvider/PageContext';
import { linkSocialIdentity, verifySocialVerification } from '@ac/apis/social';
import ErrorPage from '@ac/components/ErrorPage';
import GlobalLoading from '@ac/components/GlobalLoading';
import { getSocialAddRoute, socialCallbackRoutePrefix } from '@ac/constants/routes';
import useApi from '@ac/hooks/use-api';
import useErrorHandler from '@ac/hooks/use-error-handler';
import { accountStorage } from '@ac/utils/session-storage';
import { getLocalizedConnectorName } from '@ac/utils/social-connector';
import { finalizeSocialFlowFailure, finalizeSocialFlowSuccess } from '@ac/utils/social-flow';
import { accountCenterBasePath } from '@ac/utils/account-center-route';

/**
 * Extract connectorId from the current URL path as a fallback when useParams()
 * returns nothing (which happens when this component renders outside <Routes>).
 *
 * Expected path: /account/callback/social/:connectorId
 */
const extractConnectorIdFromPath = (): string | undefined => {
  const prefix = `${accountCenterBasePath}${socialCallbackRoutePrefix}/`;
  const { pathname } = window.location;

  if (!pathname.startsWith(prefix)) {
    return undefined;
  }

  // Everything after the prefix, up to the next slash (if any)
  const rest = pathname.slice(prefix.length);
  const id = rest.split('/')[0];

  return id || undefined;
};

const SocialCallback = () => {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const navigate = useNavigate();
  const [searchParameters] = useSearchParams();
  const { connectorId: routerConnectorId } = useParams<{ connectorId: string }>();

  // [NiceMatrix] Fallback: extract from URL when useParams fails (early-return rendering path)
  const connectorId = routerConnectorId || extractConnectorIdFromPath();

  const {
    accountCenterSettings,
    experienceSettings,
    refreshUserInfo,
    setToast,
    verificationId,
    setVerificationId,
  } = useContext(PageContext);
  const verifySocialVerificationRequest = useApi(verifySocialVerification);
  const linkSocialIdentityRequest = useApi(linkSocialIdentity);
  const handleError = useErrorHandler();
  const [startedConnectorId, setStartedConnectorId] = useState<string>();

  const connector = useMemo(
    (): ExperienceSocialConnector | undefined =>
      experienceSettings?.socialConnectors.find(({ id }) => id === connectorId),
    [connectorId, experienceSettings?.socialConnectors]
  );
  const connectorName = connector ? getLocalizedConnectorName(connector, language) : undefined;

  const redirectToReverify = useCallback(() => {
    if (!connectorId) {
      return;
    }

    setStartedConnectorId(undefined);
    setVerificationId(undefined);
    setToast(t('account_center.verification.verification_required'));
    navigate(getSocialAddRoute(connectorId), { replace: true });
  }, [connectorId, navigate, setToast, setVerificationId, t]);

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

    if (!verificationId) {
      return;
    }

    setStartedConnectorId(connectorId);

    const storedSocialFlow = accountStorage.socialFlow.get(connectorId);

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
      const [verifyError] = await verifySocialVerificationRequest({
        verificationRecordId: storedSocialFlow.verificationRecordId,
        connectorData: Object.fromEntries(searchParameters.entries()),
      });

      if (verifyError) {
        await handleCallbackError(verifyError);
        return;
      }

      accountStorage.socialFlow.setVerified(connectorId, {
        verificationRecordId: storedSocialFlow.verificationRecordId,
        expiresAt: storedSocialFlow.expiresAt,
      });

      const [linkError] = await linkSocialIdentityRequest(
        verificationId,
        storedSocialFlow.verificationRecordId
      );

      if (linkError) {
        await handleCallbackError(linkError, false);
        return;
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
    navigate,
    redirectToReverify,
    searchParameters,
    setToast,
    startedConnectorId,
    verificationId,
    verifySocialVerificationRequest,
    t,
  ]);

  if (
    !accountCenterSettings?.enabled ||
    accountCenterSettings.fields.social !== AccountCenterControlValue.Edit
  ) {
    return (
      <ErrorPage titleKey="error.something_went_wrong" messageKey="error.feature_not_enabled" />
    );
  }

  if (!experienceSettings) {
    return <GlobalLoading />;
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
