/**
 * [NiceMatrix] Account Center home (merged Profile + Security + Delete).
 *
 * Layout (single-column, mobile-first):
 *   H1 "Account Center"
 *   H2 "Profile"
 *     ProfileSection  (Logto upstream renders its own "Personal info" sub-card)
 *   H2 "Security"
 *     Username, Sign-in, Password, Social, 2-step verification
 *     (each is upstream component with its own sub-card title)
 *   H2 "Delete Account"
 *     DeletionSection (NiceMatrix override)
 *   PageFooter
 *     Terms / Privacy / Support links sourced from experienceSettings.
 *
 * Why hardcode the H1/H2 labels: upstream i18n keys for `page.title`,
 * `page.profile_title`, `page.security_title` translate to localised values
 * we don't want here (e.g. profile_title -> "Personal info" in en, which
 * conflicts with the inner ProfileSection title of the same name). Brand
 * labels stay short and stable in English; if Chinese is needed later we
 * can add a small i18n bundle.
 *
 * Why include PageFooter here: upstream Profile / Security pages each
 * render <PageFooter /> at the bottom (terms / privacy / support links).
 * When we merged the two pages into a single Home, those links got
 * dropped. Re-adding the upstream PageFooter restores them without
 * re-implementing link logic; the component already reads termsOfUseUrl /
 * privacyPolicyUrl / supportEmail / supportWebsiteUrl from
 * experienceSettings and conditionally renders only the links that are
 * configured.
 *
 * /account/profile and /account/security are kept as redirects (App.tsx)
 * so existing bookmarks still work.
 */
import classNames from 'classnames';

import PageFooter from '@ac/components/PageFooter';
import { layoutClassNames } from '@ac/constants/layout';

import DeletionSection from '../Security/DeletionSection';
import EmailPhoneSection from '../Security/EmailPhoneSection';
import MfaSection from '../Security/MfaSection';
// [NiceMatrix 1.41] MfaSection/PasskeySection now read MFA verifications from
// this shared provider (upstream Security page wraps them the same way).
import MfaVerificationsProvider from '../Security/MfaVerificationsProvider';
import PasskeySection from '../Security/PasskeySection';
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
        {/* [NiceMatrix 1.41] provider is required: without it MfaSection stays in
            its loading skeleton forever. PasskeySection renders null unless
            passkey sign-in is enabled (mirrors upstream Security page). */}
        <MfaVerificationsProvider>
          <PasskeySection />
          <MfaSection />
        </MfaVerificationsProvider>
      </div>
    </section>

    <section className={classNames(styles.section, layoutClassNames.pageContent)}>
      <h2 className={styles.sectionHeading}>Delete Account</h2>
      <div className={styles.sectionBody}>
        <DeletionSection />
      </div>
    </section>

    <div className={styles.footer}>
      <PageFooter />
    </div>
  </div>
);

export default Home;
