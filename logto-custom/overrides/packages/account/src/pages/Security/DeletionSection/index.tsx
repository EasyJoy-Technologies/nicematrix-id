/**
 * [NiceMatrix] Account deletion section + pending/awaiting banner.
 *
 * Rendered at the BOTTOM of the Account Center Security page. Hides itself
 * while `userInfo` is still loading. Consists of two parts:
 *
 *   - <DeletionBanner />: shown when the user already has an open request.
 *   - <DeletionSection />: the red "delete account" card (reason → 2-step
 *     confirm → POST /api/my-account/deletion-request).
 *
 * All sensitive calls require the user to have a valid re-verification record
 * (verificationId in PageContext). If none, the usual Account Center
 * re-verification flow kicks in first (Password / Email / Phone).
 */
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import PageContext from '@ac/Providers/PageContextProvider/PageContext';
import useApi from '@ac/hooks/use-api';
import { getPendingReturn, setPendingReturn } from '@ac/utils/account-center-route';

import {
  cancelDeletionRequest,
  confirmDeletionRequest,
  createDeletionRequest,
  getDeletionRequest,
  type DeletionRequest,
} from '@ac/apis/deletion';
import { injectDeletionPhrases } from '@ac/i18n/deletion-phrases';

import styles from './index.module.scss';

injectDeletionPhrases();

type Step = 'reason' | 'final-confirm';

const formatDate = (iso: string | null | undefined, locale: string) => {
  if (!iso) {
    return '';
  }
  try {
    return new Date(iso).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
};

type BannerProps = {
  readonly request: DeletionRequest;
  readonly onCancel: () => void;
};

export const DeletionBanner = ({ request, onCancel }: BannerProps) => {
  const { t, i18n } = useTranslation();
  const isPending = request.status === 'pending';

  return (
    <div
      className={`${styles.banner} ${isPending ? styles.bannerPending : styles.bannerAwaiting}`}
    >
      <div className={styles.bannerTitle}>
        {isPending
          ? t('account_center.deletion.pending_banner_title', {
              date: formatDate(request.scheduled_at, i18n.language),
            })
          : t('account_center.deletion.awaiting_confirmation_banner_title')}
      </div>
      <div className={styles.bannerDescription}>
        {isPending
          ? t('account_center.deletion.pending_banner_description')
          : t('account_center.deletion.awaiting_confirmation_banner_description')}
      </div>
      <div className={styles.bannerActions}>
        <button type="button" className={styles.cancelButton} onClick={onCancel}>
          {t('account_center.deletion.cancel_request')}
        </button>
      </div>
    </div>
  );
};

type Props = {
  readonly onRequestChanged?: (request: DeletionRequest | null) => void;
};

const DeletionSection = ({ onRequestChanged }: Props) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { verificationId, setVerificationId, setToast } = useContext(PageContext);

  const getRequest = useApi(getDeletionRequest, { silent: true });
  const createRequest = useApi(createDeletionRequest, { silent: true });
  const cancelRequest = useApi(cancelDeletionRequest, { silent: true });

  const [currentRequest, setCurrentRequest] = useState<DeletionRequest | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [step, setStep] = useState<Step>('reason');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    const [err, data] = await getRequest();
    // Always mark as loaded, even on error, so the Danger zone is visible.
    // Hiding the section on any transient/permission failure would look like
    // the feature is missing entirely.
    if (err) {
      setIsLoaded(true);
      return;
    }
    setCurrentRequest(data ?? null);
    onRequestChanged?.(data ?? null);
    setIsLoaded(true);
  }, [getRequest, onRequestChanged]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenModal = useCallback(() => {
    // If no verification record, kick the user to the re-verify flow; we
    // persist a "return here after verify" URL so the modal can re-open.
    if (!verificationId) {
      setPendingReturn(getPendingReturn() ?? window.location.href);
      // The standard PageContext re-verification path lives at /verify. We
      // just reset and let the upstream provider redirect.
      setVerificationId(undefined);
      navigate('/verify');
      return;
    }
    setStep('reason');
    setReason('');
    setIsModalOpen(true);
  }, [navigate, setVerificationId, verificationId]);

  const handleSubmit = useCallback(async () => {
    if (!verificationId || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    const [err] = await createRequest(verificationId, reason.trim() || undefined);
    setIsSubmitting(false);

    if (err) {
      const code = err?.data?.code as string | undefined;
      if (code === 'user.deletion_request_already_exists') {
        setToast(t('account_center.deletion.error_already_exists'));
      } else {
        setToast(t('account_center.deletion.error_unknown'));
      }
      return;
    }

    setIsModalOpen(false);
    setToast(t('account_center.deletion.create_success'));
    await refresh();
  }, [
    createRequest,
    isSubmitting,
    reason,
    refresh,
    setToast,
    t,
    verificationId,
  ]);

  const handleCancel = useCallback(async () => {
    const [err] = await cancelRequest();
    if (err) {
      setToast(t('account_center.deletion.error_unknown'));
      return;
    }
    setToast(t('account_center.deletion.cancel_success'));
    await refresh();
  }, [cancelRequest, refresh, setToast, t]);

  const hasOpenRequest = useMemo(
    () =>
      currentRequest?.status === 'awaiting_confirmation' ||
      currentRequest?.status === 'pending',
    [currentRequest]
  );

  if (!isLoaded) {
    return null;
  }

  return (
    <>
      {hasOpenRequest && currentRequest && (
        <DeletionBanner request={currentRequest} onCancel={handleCancel} />
      )}
      {/*
        [NiceMatrix] sectionTitle ("Dangerous zone") removed: the outer
        Home page already renders an H2 "Delete Account" above this,
        so an inner red title produces a duplicate heading. Spacing
        between the H2 and the card now matches Security → Username.
      */}
      <div className={styles.section}>
        <div className={styles.card}>
          <div className={styles.row}>
            <div className={styles.info}>
              <div className={styles.name}>
                {t('account_center.deletion.danger_title')}
              </div>
              <div className={styles.description}>
                {t('account_center.deletion.section_description')}
              </div>
            </div>
            {!hasOpenRequest && (
              <button
                type="button"
                className={styles.deleteButton}
                onClick={handleOpenModal}
              >
                {t('account_center.deletion.delete_button')}
              </button>
            )}
          </div>
        </div>
      </div>

      {isModalOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            {step === 'reason' ? (
              <>
                <div className={styles.modalTitle}>
                  {t('account_center.deletion.step_confirm_title')}
                </div>
                <div className={styles.modalWarning}>
                  {t('account_center.deletion.step_confirm_warning')}
                </div>
                <label className={styles.modalWarning}>
                  {t('account_center.deletion.reason_label')}
                </label>
                <textarea
                  className={styles.textarea}
                  placeholder={t('account_center.deletion.reason_placeholder')}
                  value={reason}
                  maxLength={2000}
                  onChange={(event) => {
                    setReason(event.target.value);
                  }}
                />
                <div className={styles.modalActions}>
                  <button
                    type="button"
                    className={styles.cancelButton}
                    onClick={() => {
                      setIsModalOpen(false);
                    }}
                  >
                    {t('account_center.deletion.cancel')}
                  </button>
                  <button
                    type="button"
                    className={styles.deleteButton}
                    onClick={() => {
                      setStep('final-confirm');
                    }}
                  >
                    {t('account_center.deletion.submit')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={styles.modalTitle}>
                  {t('account_center.deletion.step_second_confirm_title')}
                </div>
                <div className={styles.modalWarning}>
                  {t('account_center.deletion.step_second_confirm_warning')}
                </div>
                <div className={styles.modalActions}>
                  <button
                    type="button"
                    className={styles.cancelButton}
                    onClick={() => {
                      setIsModalOpen(false);
                    }}
                    disabled={isSubmitting}
                  >
                    {t('account_center.deletion.cancel')}
                  </button>
                  <button
                    type="button"
                    className={styles.deleteButton}
                    onClick={() => {
                      void handleSubmit();
                    }}
                    disabled={isSubmitting}
                  >
                    {t('account_center.deletion.confirm_final')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

/**
 * Exported helper used by the Account Center confirmation page
 * (/account/deletion-confirm?token=…).
 */
export const useConfirmDeletion = () => {
  const { t, i18n } = useTranslation();
  const confirm = useApi(confirmDeletionRequest, { silent: true });
  const { setToast } = useContext(PageContext);

  return useCallback(
    async (token: string) => {
      const [err, data] = await confirm(token);
      if (err) {
        const code = err?.data?.code as string | undefined;
        if (code === 'user.deletion_request_token_expired') {
          setToast(t('account_center.deletion.error_token_expired'));
        } else if (code === 'user.deletion_request_token_invalid') {
          setToast(t('account_center.deletion.error_token_invalid'));
        } else {
          setToast(t('account_center.deletion.error_unknown'));
        }
        return false;
      }
      if (data) {
        setToast(
          t('account_center.deletion.confirm_success', {
            date: formatDate(data.scheduled_at, i18n.language),
          })
        );
      }
      return true;
    },
    [confirm, i18n.language, setToast, t]
  );
};

export default DeletionSection;
