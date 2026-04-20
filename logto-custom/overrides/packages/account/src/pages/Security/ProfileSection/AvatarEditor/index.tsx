/**
 * [NiceMatrix] Avatar row: shows current avatar and lets the user upload or
 * remove it. Upload is a single-step multipart POST to the NiceMatrix
 * `/api/my-account/avatar` override; no cropping UI for now (server resizes
 * are cheap on R2 via Cloudflare Images if we want later).
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
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useApi(uploadAvatar, { silent: true });
  const clear = useApi(deleteAvatar, { silent: true });

  const avatarUrl = userInfo?.avatar ?? DEFAULT_AVATAR_PLACEHOLDER;
  const hasAvatar = Boolean(userInfo?.avatar);

  const handlePickFile = () => {
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
    setIsBusy(true);
    const [error] = await clear();
    setIsBusy(false);
    if (error) {
      setToast(t('profile_section.save_failed'));
      return;
    }
    await refreshUserInfo();
    setToast(t('profile_section.saved'));
  };

  return (
    <div className={styles.row}>
      <img className={styles.avatar} src={avatarUrl} alt={t('profile_section.avatar')} />
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.linkButton}
          disabled={isBusy}
          onClick={handlePickFile}
        >
          {t('profile_section.upload_avatar')}
        </button>
        {hasAvatar && (
          <button
            type="button"
            className={styles.linkDangerButton}
            disabled={isBusy}
            onClick={handleRemove}
          >
            {t('profile_section.remove_avatar')}
          </button>
        )}
        <div className={styles.hint}>{t('profile_section.avatar_hint')}</div>
      </div>
      <input
        ref={inputRef}
        className={styles.hidden}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleFileChange}
      />
    </div>
  );
};

export default AvatarEditor;
