import classNames from 'classnames';
import { useTranslation } from 'react-i18next';

import { layoutClassNames } from '@ac/constants/layout';

import styles from '../Home/index.module.scss';

// NiceMatrix override: replace upstream DeleteAccountSection (external URL link)
// with our self-service DeletionSection (15-day grace request flow + banner).
// All other sections come straight from upstream v1.39 native implementation.
import DeletionSection from './DeletionSection';
import EmailPhoneSection from './EmailPhoneSection';
import MfaSection from './MfaSection';
import PasswordSection from './PasswordSection';
import SocialSection from './SocialSection';
import UsernameSection from './UsernameSection';

const Security = () => {
  const { t } = useTranslation();

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={classNames(styles.title, layoutClassNames.pageTitle)}>
          {t('account_center.page.security_title')}
        </div>
        <div className={classNames(styles.description, layoutClassNames.pageDescription)}>
          {t('account_center.page.security_description')}
        </div>
      </div>
      <div className={classNames(styles.content, layoutClassNames.pageContent)}>
        <UsernameSection />
        <EmailPhoneSection />
        <PasswordSection />
        <SocialSection />
        <MfaSection />
        <DeletionSection />
      </div>
    </div>
  );
};

export default Security;
