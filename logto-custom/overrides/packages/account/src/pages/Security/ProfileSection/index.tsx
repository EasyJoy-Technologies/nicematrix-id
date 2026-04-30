/**
 * [NiceMatrix] Profile section rendered at the top of the Account Center
 * Security page. Lets the user edit avatar, family/given name, nickname,
 * birthdate, gender and (formatted) address without leaving the page.
 *
 * All edits go directly to Logto's `/api/my-account` + `/api/my-account/profile`
 * endpoints (plus our `/api/my-account/avatar` override). No NiceMatrix
 * backend proxy is involved.
 */
import { AccountCenterControlValue, type UserProfile } from '@logto/schemas';
import { useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageContext from '@ac/Providers/PageContextProvider/PageContext';
import useApi from '@ac/hooks/use-api';
import { updateName, updateProfile } from '@ac/apis/profile';
import { injectProfilePhrases } from '@ac/i18n/profile-phrases';

import AddressEditor from './AddressEditor';
import AvatarEditor from './AvatarEditor';
import DateFieldEditor from './DateFieldEditor';
import SelectFieldEditor from './SelectFieldEditor';
import TextFieldEditor from './TextFieldEditor';
import styles from './index.module.scss';

type ActiveEditor =
  | null
  | 'name'
  | 'familyName'
  | 'givenName'
  | 'nickname'
  | 'birthdate'
  | 'gender'
  | 'address';

// Runs once at module load so the keys are ready before first render.
injectProfilePhrases();

const ProfileSection = () => {
  const { t } = useTranslation();
  const { userInfo, refreshUserInfo, accountCenterSettings, setToast } = useContext(PageContext);
  const patchProfile = useApi(updateProfile, { silent: true });

  const [activeEditor, setActiveEditor] = useState<ActiveEditor>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  const patchName = useApi(updateName, { silent: true });

  const profile = (userInfo?.profile ?? {}) as Partial<UserProfile>;
  const displayName = userInfo?.name ?? undefined;

  const profileControl = accountCenterSettings?.fields.profile;
  const avatarControl = accountCenterSettings?.fields.avatar;
  const isProfileEditable = profileControl === AccountCenterControlValue.Edit;
  const isAvatarVisible = avatarControl && avatarControl !== AccountCenterControlValue.Off;
  const isProfileVisible = profileControl && profileControl !== AccountCenterControlValue.Off;

  const genderOptions = useMemo(
    () => [
      { value: 'female', label: t('profile_section.gender_female') },
      { value: 'male', label: t('profile_section.gender_male') },
      {
        value: 'prefer_not_to_say',
        label: t('profile_section.gender_prefer_not_to_say'),
      },
    ],
    [t]
  );

  useEffect(() => {
    if (!activeEditor) {
      setErrorMessage(undefined);
    }
  }, [activeEditor]);

  // If both groups are off we render nothing. Must come AFTER all hooks.
  if (!isProfileVisible && !isAvatarVisible) {
    return null;
  }

  const close = () => {
    setActiveEditor(null);
    setErrorMessage(undefined);
  };

  const submitPatch = async (payload: Partial<UserProfile>) => {
    setIsSubmitting(true);
    setErrorMessage(undefined);
    const [error] = await patchProfile(payload);
    setIsSubmitting(false);
    if (error) {
      setErrorMessage(t('profile_section.save_failed'));
      return;
    }
    await refreshUserInfo();
    setToast(t('profile_section.saved'));
    close();
  };

  const submitName = async (value: string) => {
    setIsSubmitting(true);
    setErrorMessage(undefined);
    const trimmed = value.trim();
    const [error] = await patchName(trimmed || null);
    setIsSubmitting(false);
    if (error) {
      setErrorMessage(t('profile_section.save_failed'));
      return;
    }
    await refreshUserInfo();
    setToast(t('profile_section.saved'));
    close();
  };

  const renderRow = (
    key: ActiveEditor,
    label: string,
    rawValue: string | undefined,
    displayFormatter?: (raw: string) => string
  ) => {
    const displayed = rawValue
      ? (displayFormatter ? displayFormatter(rawValue) : rawValue)
      : t('profile_section.not_set');
    return (
      <div key={key ?? label} className={styles.row}>
        <div className={styles.topLine}>
          <div className={styles.name}>{label}</div>
          <div className={rawValue ? styles.value : styles.valueMuted}>{displayed}</div>
          {isProfileEditable && (
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.changeButton}
                onClick={() => setActiveEditor(key)}
              >
                {t('profile_section.change')}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const genderLabel = (value: string) => {
    const found = genderOptions.find((option) => option.value === value);
    return found ? found.label : value;
  };

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{t('profile_section.title')}</div>
      <div className={styles.card}>
        {isAvatarVisible && <AvatarEditor />}

        {isProfileVisible && (
          <>
            {renderRow('name', t('profile_section.display_name'), displayName)}
            {renderRow('familyName', t('profile_section.family_name'), profile.familyName)}
            {renderRow('givenName', t('profile_section.given_name'), profile.givenName)}
            {renderRow('nickname', t('profile_section.nickname'), profile.nickname)}
            {renderRow('birthdate', t('profile_section.birthdate'), profile.birthdate)}
            {renderRow('gender', t('profile_section.gender'), profile.gender, genderLabel)}
            {renderRow('address', t('profile_section.address'), profile.address?.formatted)}
          </>
        )}
      </div>

      <TextFieldEditor
        isOpen={activeEditor === 'name'}
        title={t('profile_section.display_name')}
        label={t('profile_section.display_name')}
        initialValue={displayName ?? ''}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        onCancel={close}
        onSubmit={submitName}
      />
      <TextFieldEditor
        isOpen={activeEditor === 'familyName'}
        title={t('profile_section.family_name')}
        label={t('profile_section.family_name')}
        initialValue={profile.familyName ?? ''}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        onCancel={close}
        onSubmit={async (value) => submitPatch({ familyName: value })}
      />
      <TextFieldEditor
        isOpen={activeEditor === 'givenName'}
        title={t('profile_section.given_name')}
        label={t('profile_section.given_name')}
        initialValue={profile.givenName ?? ''}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        onCancel={close}
        onSubmit={async (value) => submitPatch({ givenName: value })}
      />
      <TextFieldEditor
        isOpen={activeEditor === 'nickname'}
        title={t('profile_section.nickname')}
        label={t('profile_section.nickname')}
        initialValue={profile.nickname ?? ''}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        onCancel={close}
        onSubmit={async (value) => submitPatch({ nickname: value })}
      />
      <DateFieldEditor
        isOpen={activeEditor === 'birthdate'}
        title={t('profile_section.birthdate')}
        label={t('profile_section.birthdate')}
        initialValue={profile.birthdate ?? ''}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        onCancel={close}
        onSubmit={async (value) => submitPatch({ birthdate: value })}
      />
      <SelectFieldEditor
        isOpen={activeEditor === 'gender'}
        title={t('profile_section.gender')}
        label={t('profile_section.gender')}
        initialValue={profile.gender ?? ''}
        options={genderOptions}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        onCancel={close}
        onSubmit={async (value) => submitPatch({ gender: value })}
      />
      <AddressEditor
        isOpen={activeEditor === 'address'}
        title={t('profile_section.address')}
        label={t('profile_section.address')}
        initialValue={profile.address?.formatted ?? ''}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        onCancel={close}
        onSubmit={async (formatted) =>
          submitPatch({
            address: {
              ...(profile.address ?? {}),
              formatted,
            },
          })
        }
      />
    </div>
  );
};

export default ProfileSection;
