/**
 * [NiceMatrix] Override of upstream SocialCallback.
 *
 * Two deltas on top of the upstream 1.41.0 base:
 *   1. `extractConnectorIdFromPath()` defensive fallback for `connectorId`.
 *      Upstream 1.40 renders SocialCallback inside <Routes> so `useParams()`
 *      normally resolves; we keep the path-parse fallback as defence in depth
 *      (our App.tsx still reaches this component via an `isSocialCallback`
 *      branch, and a future refactor of that branch must not silently break
 *      connectorId resolution).
 *   2. QQ ICP redirect: the verify `redirectUri` must use the connector-specific
 *      callback origin (`getSocialCallbackOriginOverride`) instead of the raw
 *      `window.location.origin`, so QQ's token exchange sees the ICP-filed host.
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
import {
  getSocialAddRoute,
  getSocialCallbackRoute,
  getSocialChangeRoute,
} from '@ac/constants/routes';
import useApi from '@ac/hooks/use-api';
import useErrorHandler from '@ac/hooks/use-error-handler';
import { accountCenterBasePath } from '@ac/utils/account-center-route';
import { canManageSocialIdentitiesWithoutVerification } from '@ac/utils/security-page';
import { accountStorage } from '@ac/utils/session-storage';
import { getLocalizedConnectorName } from '@ac/utils/social-connector';
import { finalizeSocialFlowFailure, finalizeSocialFlowSuccess } from '@ac/utils/social-flow';
import { socialCallbackRoutePrefix } from '@ac/constants/routes';
import { getSocialCallbackOriginOverride } from '@experience/utils/social-redirect-override';

/**
 * Extract connectorId from the current URL path as a fallback when useParams()
 * returns nothing. Expected path: /account/callback/social/:connectorId
 */
const extractConnectorIdFromPath = (): string | undefined => {
  const prefix = `${accountCenterBasePath}${socialCallbackRoutePrefix}/`;
  const { pathname } = window.location;

  if (!pathname.startsWith(prefix)) {
    return undefined;
  }

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
  // [NiceMatrix] Fallback: extract from URL when useParams resolves nothing.
  const connectorId = routerConnectorId || extractConnectorIdFromPath();
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
      // [NiceMatrix] QQ ICP redirect: use the connector-specific callback origin
      // override (if any) so QQ token exchange sees the ICP-filed host; falls back
      // to window.location.origin for every other connector (= upstream behaviour).
      const callbackOrigin = getSocialCallbackOriginOverride(connectorId) ?? window.location.origin;
      const redirectUri = `${callbackOrigin}${accountCenterBasePath}${getSocialCallbackRoute(
        connectorId
      )}`;
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
