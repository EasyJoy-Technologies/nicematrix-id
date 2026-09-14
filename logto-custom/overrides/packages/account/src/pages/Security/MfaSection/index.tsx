/*
 * [NiceMatrix override] vs upstream packages/account/src/pages/Security/MfaSection/index.tsx
 * (v1.43.0). Verbatim copy EXCEPT the state the toggle is bound to. Search for
 * "[NiceMatrix override]" to find every change.
 *
 * WHY
 * The toggle used to render `skipMfaOnSignIn === false`. That flag is absent on almost every
 * account, so "absent" rendered as ON for 143,375 production users who had never enabled
 * anything - and it read ON for 20 more users whose two-step verification was really off.
 * The switch was showing something the sign-in flow did not agree with.
 *
 * WHAT
 *   - The toggle now reflects `isEnabled` from `GET /api/my-account/mfa-settings`, which the
 *     server derives from the very same module that decides whether sign-in challenges the
 *     user. What the switch says is, by construction, what will happen.
 *   - Writes send `isEnabled`, which sets both underlying flags at once, so they can no longer
 *     drift apart.
 *   - With no bound factor the switch is disabled rather than merely warned about: a primary
 *     email or phone is not something the user chose as a second factor, and turning the
 *     feature on without a factor would be a promise the sign-in flow cannot keep. The existing
 *     `no_verification_method_warning` notification explains what to add - no new phrase key,
 *     and the surrounding markup, styles and skeleton are untouched.
 *
 * See `docs/mfa-explicit-optin-plan.md` §6.
 * On upstream sync: re-copy this file and re-apply the marked changes.
 */
import { InlineNotification } from '@experience/components/Notification';
import { AccountCenterControlValue, MfaPolicy, type UserMfaSettingsResponse } from '@logto/schemas';
import { useCallback, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import PageContext from '@ac/Providers/PageContextProvider/PageContext';
import ConfirmModal from '@ac/components/ConfirmModal';
import ToggleSwitch from '@ac/components/ToggleSwitch';
import { verifiedActionRoute } from '@ac/constants/routes';
import { getPendingReturn, setPendingReturn } from '@ac/utils/account-center-route';
import { hasEnabledSecondFactor, hasVisibleMfaSection } from '@ac/utils/security-page';
import { sessionStorage } from '@ac/utils/session-storage';

import { getMfaSettings, updateMfaSettings } from '../../../apis/mfa';
import useApi from '../../../hooks/use-api';
import useErrorHandler from '../../../hooks/use-error-handler';
import { useMfaVerifications } from '../MfaVerificationsProvider';
import SecurityRow from '../components/SecurityRow';
import SecuritySection from '../components/SecuritySection';
import { SecuritySkeleton } from '../components/SecuritySkeleton';

import MfaSkeleton from './MfaSkeleton';
import styles from './index.module.scss';
import useMfaRows from './use-mfa-rows';

/** MFA policies where users cannot skip MFA verification */
const mandatoryMfaPolicies = new Set<MfaPolicy>([
  MfaPolicy.Mandatory,
  MfaPolicy.PromptAtSignInAndSignUpMandatory,
  MfaPolicy.PromptOnlyAtSignInMandatory,
]);

type MfaContentProps = {
  readonly isLoading: boolean;
  readonly hasToggle: boolean;
  readonly isTwoStepEnabled: boolean;
  /**
   * [NiceMatrix override] whether the user has a bound factor to verify with. Without one the
   * switch cannot be turned on, so it is rendered disabled.
   */
  readonly hasUsableFactor: boolean;
  readonly rows: ReturnType<typeof useMfaRows>;
  readonly onToggleChange: (checked: boolean) => Promise<void>;
};

const MfaContent = ({
  isLoading,
  hasToggle,
  isTwoStepEnabled,
  hasUsableFactor,
  rows,
  onToggleChange,
}: MfaContentProps) => {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <SecuritySkeleton ariaLabel={t('account_center.security.two_step_verification')}>
        <MfaSkeleton hasToggle={hasToggle} rows={rows} />
      </SecuritySkeleton>
    );
  }

  return (
    <>
      {hasToggle && (
        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <div className={styles.toggleTitle}>
              {t('account_center.security.two_step_verification')}
            </div>
            <div className={styles.toggleDescription}>
              {t('account_center.security.turn_on_2_step_verification_description')}
            </div>
          </div>
          <ToggleSwitch
            isChecked={isTwoStepEnabled}
            // [NiceMatrix override] no bound factor -> nothing to verify with -> cannot enable.
            isDisabled={!hasUsableFactor}
            onChange={(checked) => {
              void onToggleChange(checked);
            }}
          />
        </div>
      )}
      {hasToggle && rows.length > 0 && <div className={styles.divider} />}
      {rows.map((row) => (
        <SecurityRow key={row.key} row={row} />
      ))}
    </>
  );
};

const MfaSection = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { accountCenterSettings, experienceSettings, verificationId, setVerificationId, setToast } =
    useContext(PageContext);
  const {
    mfaVerifications,
    isLoading: isLoadingMfaVerifications,
    hasLoaded: hasLoadedMfaVerifications,
  } = useMfaVerifications();
  // [NiceMatrix override] the whole settings payload replaces the single `skipMfaOnSignIn` flag.
  const [mfaSettings, setMfaSettings] = useState<UserMfaSettingsResponse>();
  const [hasLoadedMfaSettings, setHasLoadedMfaSettings] = useState(false);
  const [isLoadingMfaSettings, setIsLoadingMfaSettings] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const handleError = useErrorHandler();

  const updateMfaSettingsApi = useApi(updateMfaSettings);

  const mfaControl = accountCenterSettings?.fields.mfa;
  const mfaPolicy = experienceSettings?.mfa.policy;
  const isEditable = mfaControl === AccountCenterControlValue.Edit;
  const isMfaSectionVisible = hasVisibleMfaSection(mfaControl, experienceSettings);

  const showToggle =
    isEditable &&
    mfaPolicy !== undefined &&
    !mandatoryMfaPolicies.has(mfaPolicy) &&
    hasEnabledSecondFactor(experienceSettings);

  // [NiceMatrix override] both values come from the server, which computes them with the same
  // module that drives sign-in enforcement.
  const isTwoStepEnabled = mfaSettings?.isEnabled === true;
  const hasUsableFactor = mfaSettings?.hasUsableFactor === true;
  const isMfaSectionLoading =
    (isMfaSectionVisible && (!hasLoadedMfaVerifications || isLoadingMfaVerifications)) ||
    (showToggle && (!hasLoadedMfaSettings || isLoadingMfaSettings));

  const getMfaSettingsRequest = useApi(getMfaSettings, { silent: true });

  const fetchMfaSettings = useCallback(async () => {
    setIsLoadingMfaSettings(true);
    const [error, result] = await getMfaSettingsRequest();
    if (!error && result) {
      setMfaSettings(result);
    }
    setHasLoadedMfaSettings(true);
    setIsLoadingMfaSettings(false);
  }, [getMfaSettingsRequest]);

  useEffect(() => {
    if (showToggle) {
      void fetchMfaSettings();
    }
  }, [showToggle, fetchMfaSettings]);

  const navigateTo = useCallback(
    (route: string) => {
      setPendingReturn(getPendingReturn() ?? window.location.href);
      navigate(route);
    },
    [navigate]
  );

  const rows = useMfaRows(mfaVerifications, navigateTo);
  const shouldShowMfaCard = showToggle || rows.length > 0;

  // [NiceMatrix override] one authoritative write: `isEnabled` sets both server-side flags.
  const updateTwoStepVerification = useCallback(
    async (verifiedId: string, isEnabled: boolean) => {
      const [error, result] = await updateMfaSettingsApi(verifiedId, { isEnabled });

      if (error) {
        await handleError(error, {
          'verification_record.permission_denied': async () => {
            setVerificationId(undefined);
            setToast(t('account_center.verification.verification_required'));
          },
        });
        return;
      }

      if (result) {
        setMfaSettings(result);
      }
    },
    [handleError, setToast, setVerificationId, t, updateMfaSettingsApi]
  );

  const handleToggleChange = useCallback(
    async (checked: boolean) => {
      if (!checked) {
        setIsConfirmModalOpen(true);
        return;
      }

      if (verificationId) {
        await updateTwoStepVerification(verificationId, true);
        return;
      }

      sessionStorage.setPendingVerifiedAction('enable-mfa');
      navigateTo(verifiedActionRoute);
    },
    [navigateTo, updateTwoStepVerification, verificationId]
  );

  const handleConfirmDisable = useCallback(async () => {
    setIsConfirmModalOpen(false);

    if (verificationId) {
      await updateTwoStepVerification(verificationId, false);
      return;
    }

    sessionStorage.setPendingVerifiedAction('disable-mfa');
    navigateTo(verifiedActionRoute);
  }, [navigateTo, updateTwoStepVerification, verificationId]);

  useEffect(() => {
    if (!verificationId) {
      return;
    }

    const pendingAction = sessionStorage.getPendingVerifiedAction();

    if (pendingAction !== 'enable-mfa' && pendingAction !== 'disable-mfa') {
      return;
    }

    sessionStorage.clearPendingVerifiedAction();
    void updateTwoStepVerification(verificationId, pendingAction === 'enable-mfa');
  }, [updateTwoStepVerification, verificationId]);

  if (!shouldShowMfaCard) {
    return null;
  }

  return (
    <>
      <SecuritySection
        title={t('account_center.security.two_step_verification')}
        notification={
          // [NiceMatrix override] the notification now explains why the switch is unavailable,
          // instead of warning about an "on" state that could not be enforced.
          !isMfaSectionLoading && showToggle && !hasUsableFactor ? (
            <InlineNotification
              message="account_center.security.no_verification_method_warning"
              className={styles.notification}
            />
          ) : undefined
        }
      >
        <MfaContent
          isLoading={isMfaSectionLoading}
          hasToggle={showToggle}
          isTwoStepEnabled={isTwoStepEnabled}
          hasUsableFactor={hasUsableFactor}
          rows={rows}
          onToggleChange={handleToggleChange}
        />
      </SecuritySection>
      <ConfirmModal
        isOpen={isConfirmModalOpen}
        title="account_center.security.turn_off_2_step_verification"
        confirmText="account_center.security.disable_2_step_verification"
        confirmButtonType="danger"
        cancelText="action.cancel"
        onConfirm={() => {
          void handleConfirmDisable();
        }}
        onCancel={() => {
          setIsConfirmModalOpen(false);
        }}
      >
        {t('account_center.security.turn_off_2_step_verification_description')}
      </ConfirmModal>
    </>
  );
};

export default MfaSection;
