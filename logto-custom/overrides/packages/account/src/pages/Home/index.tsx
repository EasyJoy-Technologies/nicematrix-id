/**
 * [NiceMatrix] Custom Home page for Account Center.
 *
 * Logto v1.39 stripped the Home page down to a "Page not found" ErrorPage
 * because the entire content has moved to /profile and /security routes.
 * For our users this is confusing — opening /account shows an error.
 *
 * Behavior:
 *   - If Profile is enabled (dev features + visible profile fields), redirect
 *     to /account/profile.
 *   - Else if Security has at least one visible section, redirect to
 *     /account/security.
 *   - Else fall back to upstream's ErrorPage (correctly indicates no content).
 */
import { useContext } from 'react';
import { Navigate } from 'react-router-dom';

import ErrorPage from '@ac/components/ErrorPage';
import PageContext from '@ac/Providers/PageContextProvider/PageContext';
import { isDevFeaturesEnabled } from '@ac/constants/env';
import { profileRoute, securityRoute } from '@ac/constants/routes';
import { hasVisibleSecuritySection } from '@ac/utils/security-page';

const Home = () => {
  const { accountCenterSettings, experienceSettings } = useContext(PageContext);

  const showsSecurityPage = hasVisibleSecuritySection(accountCenterSettings, experienceSettings);
  const showsProfilePage = isDevFeaturesEnabled;

  if (showsProfilePage) {
    return <Navigate replace to={profileRoute} />;
  }

  if (showsSecurityPage) {
    return <Navigate replace to={securityRoute} />;
  }

  return (
    <ErrorPage
      titleKey="account_center.home.title"
      messageKey="account_center.home.description"
    />
  );
};

export default Home;
