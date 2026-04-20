/**
 * [NiceMatrix override]
 *
 * Adds <ProfileSection /> at the top and <DeletionSection /> at the bottom of
 * the Account Center Security page.
 *
 * Also handles the email confirmation link: when the user clicks
 *   https://id.nicematrix.com/account/security?deletion_token=...
 * we auto-consume the token on mount, show a success/error toast, and clean
 * up the URL.
 *
 * Everything else is identical to upstream.
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import PageFooter from '@ac/components/PageFooter';

import styles from '../Home/index.module.scss';

import DeletionSection, { useConfirmDeletion } from './DeletionSection';
import EmailPhoneSection from './EmailPhoneSection';
import MfaSection from './MfaSection';
import PasswordSection from './PasswordSection';
import ProfileSection from './ProfileSection';
import SocialSection from './SocialSection';
import UsernameSection from './UsernameSection';

const Security = () => {
  const { t } = useTranslation();
  const confirmDeletion = useConfirmDeletion();
  const hasConsumedToken = useRef(false);

  // Auto-consume `?deletion_token=...` on mount. Runs exactly once per page
  // load, regardless of re-renders.
  useEffect(() => {
    if (hasConsumedToken.current) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const token = params.get('deletion_token');
    if (!token) {
      return;
    }
    // eslint-disable-next-line @silverhand/fp/no-mutation
    hasConsumedToken.current = true;
    void confirmDeletion(token).finally(() => {
      // Remove the token from the URL so refreshing the page doesn't retry.
      params.delete('deletion_token');
      const nextSearch = params.toString();
      const nextUrl =
        window.location.pathname +
        (nextSearch ? `?${nextSearch}` : '') +
        window.location.hash;
      window.history.replaceState(null, '', nextUrl);
    });
  }, [confirmDeletion]);

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
        <DeletionSection />
      </div>
      <PageFooter />
    </div>
  );
};

export default Security;
