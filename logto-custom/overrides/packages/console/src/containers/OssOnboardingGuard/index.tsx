/**
 * [NiceMatrix] OSS onboarding survey is disabled in our self-hosted Logto.
 *
 * Logto v1.39 added an OSS onboarding flow that, when DEV_FEATURES_ENABLED=true,
 * forces every fresh admin user through `/console/<tenant>/onboarding`
 * before they can use the console. We don't ship the questionnaire to our
 * users, and we keep DEV_FEATURES_ENABLED=true for unrelated reasons (account
 * center social bind, profile fields). Bypass the redirect entirely.
 */
import { Outlet } from 'react-router-dom';

function OssOnboardingGuard() {
  return <Outlet />;
}

export default OssOnboardingGuard;
