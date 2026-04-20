import { useLocation } from 'react-router-dom';

import SwitchIcon from '@/shared/assets/icons/switch-icon.svg?react';
import { UserMfaFlow } from '@/types';
import { type MfaFlowState } from '@/types/guard';

import TextLink from '../TextLink';

type Props = {
  readonly flow: UserMfaFlow;
  readonly flowState: MfaFlowState;
  readonly className?: string;
};

/**
 * Show a "try another verification method" / "link another MFA factor" link whenever
 * the user has at least one OTHER factor available than the one currently displayed.
 *
 * Upstream Logto only shows this link when `availableFactors.length >= 2`. That rule
 * assumed the user was on a landing page that lists factors — but MFA verification
 * deep-links directly to a specific factor page (WebAuthn / TOTP / Email / Phone / BackupCode).
 * If availableFactors is exactly [WebAuthn], the user sees ONLY the WebAuthn page with
 * no escape hatch. When the passkey is unusable (device lost, RP ID changed, new browser),
 * the user is hard-locked out.
 *
 * Fix: show the link whenever there is ANY factor different from the one on the current
 * page. If there's only one factor and the user is already on its page, still hide.
 */
const SwitchMfaFactorsLink = ({ flow, flowState, className }: Props) => {
  const { pathname } = useLocation();
  const { availableFactors } = flowState;

  if (availableFactors.length === 0) {
    return null;
  }

  // Infer the current factor from the URL. Path looks like
  //   /mfa-verification/WebAuthn
  //   /mfa-verification/EmailVerificationCode
  // etc. We don't fail closed if the segment is missing — we just fall back to the
  // upstream rule (need >= 2 factors).
  const currentFactor = pathname.split('/').filter(Boolean).at(-1);
  const hasOtherFactor = availableFactors.some((factor) => factor !== currentFactor);

  if (!hasOtherFactor) {
    return null;
  }

  return (
    <TextLink
      to={`/${flow}`}
      text={
        flow === UserMfaFlow.MfaBinding
          ? 'mfa.link_another_mfa_factor'
          : 'mfa.try_another_verification_method'
      }
      className={className}
      icon={<SwitchIcon />}
      state={flowState}
    />
  );
};

export default SwitchMfaFactorsLink;
