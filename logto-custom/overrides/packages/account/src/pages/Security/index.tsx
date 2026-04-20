/**
 * [NiceMatrix override]
 *
 * Adds <ProfileSection /> to the top of the Account Center Security page so
 * users can manage their avatar and OIDC profile (name / nickname / birthdate /
 * gender / address) in the same place as username / email / phone / password /
 * social / MFA.
 *
 * Everything below is identical to upstream.
 */
import { useTranslation } from 'react-i18next';

import PageFooter from '@ac/components/PageFooter';

import styles from '../Home/index.module.scss';

import EmailPhoneSection from './EmailPhoneSection';
import MfaSection from './MfaSection';
import PasswordSection from './PasswordSection';
import ProfileSection from './ProfileSection';
import SocialSection from './SocialSection';
import UsernameSection from './UsernameSection';

const Security = () => {
  const { t } = useTranslation();

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.title}>{t('account_center.page.security_title')}</div>
        <div className={styles.description}>{t('account_center.page.security_description')}</div>
      </div>
      <div className={styles.content}>
        <ProfileSection />
        <UsernameSection />
        <EmailPhoneSection />
        <PasswordSection />
        <SocialSection />
        <MfaSection />
      </div>
      <PageFooter />
    </div>
  );
};

export default Security;
