/**
 * [NiceMatrix] Account Center home (merged Profile + Security).
 *
 * Layout (single-column, mobile-first):
 *   H1 "Account Center"
 *   H2 "Profile"
 *     ProfileSection  (Logto upstream renders its own "Personal info" sub-card)
 *   H2 "Security"
 *     Username, Sign-in, Password, Social, 2-step verification, Deletion
 *     (each is upstream component with its own sub-card title)
 *
 * Why hardcode the H1/H2 labels: upstream i18n keys for `page.title`,
 * `page.profile_title`, `page.security_title` translate to localised values
 * we don't want here (e.g. profile_title -> "Personal info" in en, which
 * conflicts with the inner ProfileSection title of the same name). Brand
 * labels stay short and stable in English; if Chinese is needed later we
 * can add a small i18n bundle.
 *
 * /account/profile and /account/security are kept as redirects (App.tsx)
 * so existing bookmarks still work.
 */
import classNames from 'classnames';

import { layoutClassNames } from '@ac/constants/layout';

import DeletionSection from '../Security/DeletionSection';
import EmailPhoneSection from '../Security/EmailPhoneSection';
import MfaSection from '../Security/MfaSection';
import PasswordSection from '../Security/PasswordSection';
import ProfileSection from '../Security/ProfileSection';
import SocialSection from '../Security/SocialSection';
import UsernameSection from '../Security/UsernameSection';

import styles from './index.module.scss';

const Home = () => (
  <div className={styles.container}>
    <div className={styles.header}>
      <div className={classNames(styles.title, layoutClassNames.pageTitle)}>
        Account Center
      </div>
    </div>

    <section className={classNames(styles.section, layoutClassNames.pageContent)}>
      <h2 className={styles.sectionHeading}>Profile</h2>
      <div className={styles.sectionBody}>
        <ProfileSection />
      </div>
    </section>

    <section className={classNames(styles.section, layoutClassNames.pageContent)}>
      <h2 className={styles.sectionHeading}>Security</h2>
      <div className={styles.sectionBody}>
        <UsernameSection />
        <EmailPhoneSection />
        <PasswordSection />
        <SocialSection />
        <MfaSection />
      </div>
    </section>

    <section className={classNames(styles.section, layoutClassNames.pageContent)}>
      <h2 className={styles.sectionHeading}>Delete Account</h2>
      <div className={styles.sectionBody}>
        <DeletionSection />
      </div>
    </section>
  </div>
);

export default Home;
