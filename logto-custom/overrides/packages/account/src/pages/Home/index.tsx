/**
 * [NiceMatrix] Account Center home (merged Profile + Security).
 *
 * Logto v1.39 split Profile and Security into separate routes with a sidebar.
 * We don't want a sidebar — single-page stacked layout works better on
 * mobile and matches our 1.38-era visual.
 *
 * Layout:
 *   <h1>Account Center</h1>
 *     <h2>Profile</h2>
 *       ProfileSection (avatar + name/birthdate/gender/address)
 *     <h2>Security</h2>
 *       Username, Email/Phone, Password, Social, MFA, Deletion
 *
 * /account/profile and /account/security are kept as redirects (App.tsx)
 * so existing bookmarks still work.
 */
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';

import { layoutClassNames } from '@ac/constants/layout';

import DeletionSection from '../Security/DeletionSection';
import EmailPhoneSection from '../Security/EmailPhoneSection';
import MfaSection from '../Security/MfaSection';
import PasswordSection from '../Security/PasswordSection';
import ProfileSection from '../Security/ProfileSection';
import SocialSection from '../Security/SocialSection';
import UsernameSection from '../Security/UsernameSection';

import styles from './index.module.scss';

const Home = () => {
  const { t } = useTranslation();

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={classNames(styles.title, layoutClassNames.pageTitle)}>
          {t('account_center.page.title')}
        </div>
      </div>

      <section className={classNames(styles.section, layoutClassNames.pageContent)}>
        <h2 className={styles.sectionHeading}>
          {t('account_center.page.profile_title')}
        </h2>
        <div className={styles.sectionBody}>
          <ProfileSection />
        </div>
      </section>

      <section className={classNames(styles.section, layoutClassNames.pageContent)}>
        <h2 className={styles.sectionHeading}>
          {t('account_center.page.security_title')}
        </h2>
        <div className={styles.sectionBody}>
          <UsernameSection />
          <EmailPhoneSection />
          <PasswordSection />
          <SocialSection />
          <MfaSection />
          <DeletionSection />
        </div>
      </section>
    </div>
  );
};

export default Home;
