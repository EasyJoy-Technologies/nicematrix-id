import classNames from 'classnames';
import { useTranslation } from 'react-i18next';

import PageFooter from '@ac/components/PageFooter';
import { layoutClassNames } from '@ac/constants/layout';

import styles from '../Home/index.module.scss';

// [NiceMatrix] In Logto v1.39 the Profile page is added as a standalone route
// (`/account/profile`) but ships empty. We render our ProfileSection (avatar +
// 6 field editors) here. The implementation lives in `Security/ProfileSection/*`
// from earlier versions; we keep that import path stable so the component
// itself can be migrated in a separate refactor without affecting this layer.
import ProfileSection from '../Security/ProfileSection';

const Profile = () => {
  const { t } = useTranslation();

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={classNames(styles.title, layoutClassNames.pageTitle)}>
          {t('account_center.page.profile_title')}
        </div>
        <div className={classNames(styles.description, layoutClassNames.pageDescription)}>
          {t('account_center.page.profile_description')}
        </div>
      </div>
      <div className={classNames(styles.content, layoutClassNames.pageContent)}>
        <ProfileSection />
      </div>
      <PageFooter />
    </div>
  );
};

export default Profile;
