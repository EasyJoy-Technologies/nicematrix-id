/**
 * [NiceMatrix] Avatar row: large centered avatar with hover-based remove `×`
 * (with confirm modal) and click-to-upload. A "Change avatar" link lives below
 * the avatar together with the supported formats hint.
 *
 * Upload is a single-step multipart POST to the NiceMatrix
 * `/api/my-account/avatar` override; no cropping UI.
 */
import { useContext, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageContext from '@ac/Providers/PageContextProvider/PageContext';
import useApi from '@ac/hooks/use-api';
import { deleteAvatar, uploadAvatar } from '@ac/apis/profile';

import styles from './index.module.scss';

// Mirrors @logto/schemas maxUploadFileSize (5 MB) — kept in sync manually to
// avoid pulling the schema constant into the Account bundle.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const DEFAULT_AVATAR_PLACEHOLDER =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" fill="%23e1e1e5"/>' +
  '<circle cx="32" cy="26" r="11" fill="%23bfbfc4"/>' +
  '<path d="M10 58c4-11 14-16 22-16s18 5 22 16z" fill="%23bfbfc4"/>' +
  '</svg>';

const AvatarEditor = () => {
  const { t } = useTranslation();
  const { userInfo, refreshUserInfo, setToast } = useContext(PageContext);
  const [isBusy, setIsBusy] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useApi(uploadAvatar, { silent: true });
  const clear = useApi(deleteAvatar, { silent: true });

  const avatarUrl = userInfo?.avatar ?? DEFAULT_AVATAR_PLACEHOLDER;
  const hasAvatar = Boolean(userInfo?.avatar);

  const handlePickFile = () => {
    if (isBusy) {
      return;
    }
    inputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // reset so selecting the same file twice still triggers onChange
    event.target.value = '';
    if (!file) {
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setToast(t('profile_section.upload_too_large'));
      return;
    }
    if (!ALLOWED_MIME.has(file.type)) {
      setToast(t('profile_section.upload_bad_type'));
      return;
    }

    setIsBusy(true);
    const [error] = await upload(file);
    setIsBusy(false);

    if (error) {
      setToast(t('profile_section.upload_failed'));
      return;
    }
    await refreshUserInfo();
    setToast(t('profile_section.saved'));
  };

  const handleRemove = async () => {
    setIsConfirmOpen(false);
    setIsBusy(true);
    const [error] = await clear();
    setIsBusy(false);
    if (error) {
      setToast(t('profile_section.save_failed'));
      return;
    }
    await refreshUserInfo();
    setToast(t('profile_section.removed'));
  };

  const handleRemoveClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (isBusy) {
      return;
    }
    setIsConfirmOpen(true);
  };

  return (
    <div className={styles.centered}>
      <div
        className={styles.avatarWrapper}
        role="button"
        tabIndex={0}
        onClick={handlePickFile}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handlePickFile();
          }
        }}
        aria-label={t('profile_section.upload_avatar')}
      >
        <img
          className={styles.avatar}
          src={avatarUrl}
          alt={t('profile_section.avatar')}
        />
        {hasAvatar && (
          <button
            type="button"
            className={styles.removeBadge}
            disabled={isBusy}
            onClick={handleRemoveClick}
            aria-label={t('profile_section.remove_avatar')}
            title={t('profile_section.remove_avatar')}
          >
            ×
          </button>
        )}
      </div>
      <button
        type="button"
        className={styles.changeLink}
        disabled={isBusy}
        onClick={handlePickFile}
      >
        {t('profile_section.change_avatar')}
      </button>
      <div className={styles.hint}>{t('profile_section.avatar_supported_formats')}</div>
      <input
        ref={inputRef}
        className={styles.hidden}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleFileChange}
      />

      {isConfirmOpen && (
        <div
          className={styles.confirmOverlay}
          role="dialog"
          aria-modal="true"
          onClick={() => setIsConfirmOpen(false)}
        >
          <div
            className={styles.confirmBox}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.confirmTitle}>
              {t('profile_section.remove_avatar_confirm_title')}
            </div>
            <div className={styles.confirmBody}>
              {t('profile_section.remove_avatar_confirm_body')}
            </div>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.confirmCancel}
                onClick={() => setIsConfirmOpen(false)}
                disabled={isBusy}
              >
                {t('profile_section.cancel')}
              </button>
              <button
                type="button"
                className={styles.confirmDelete}
                onClick={() => {
                  void handleRemove();
                }}
                disabled={isBusy}
              >
                {t('profile_section.remove_avatar_confirm_ok')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AvatarEditor;
