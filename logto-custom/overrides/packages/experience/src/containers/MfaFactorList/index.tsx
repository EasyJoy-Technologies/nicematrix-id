/**
 * [NiceMatrix] Override — skip re-sending an MFA verification code when the
 * user already has an active verificationId for that channel.
 *
 * Upstream behavior: every click on "Phone" or "Email" in the factor list
 * calls `sendMfaVerificationCode`, which hits the rate limiter whenever the
 * user bounces between factors (e.g. sends SMS -> clicks "try another
 * method" -> clicks "Phone" again). That second click re-sends instead of
 * resuming the existing code session, which fails with
 * `verification_code.exceed_max_try` even though a valid code is already in
 * the user's inbox / text message.
 *
 * Fix: before calling the send API, check whether a verificationId is
 * already stored in `UserInteractionContext.verificationIdsMap` for the
 * chosen channel. If yes, navigate straight to the code entry page and
 * reuse the existing code. Only call the API when there is no existing
 * verification id.
 */
import { MfaFactor, SignInIdentifier } from '@logto/schemas';
import { useCallback, useContext } from 'react';

import UserInteractionContext from '@/Providers/UserInteractionContextProvider/UserInteractionContext';
import MfaFactorButton from '@/components/Button/MfaFactorButton';
import useNavigateWithPreservedSearchParams from '@/hooks/use-navigate-with-preserved-search-params';
import useSendMfaVerificationCode from '@/hooks/use-send-mfa-verification-code';
import useStartTotpBinding from '@/hooks/use-start-totp-binding';
import useStartWebAuthnProcessing from '@/hooks/use-start-webauthn-processing';
import { UserMfaFlow } from '@/types';
import { type MfaFlowState } from '@/types/guard';
import { codeVerificationTypeMap } from '@/utils/sign-in-experience';

import styles from './index.module.scss';

type Props = {
  readonly flow: UserMfaFlow;
  readonly flowState: MfaFlowState;
};

const MfaFactorList = ({ flow, flowState }: Props) => {
  const startTotpBinding = useStartTotpBinding();
  const startWebAuthnProcessing = useStartWebAuthnProcessing();
  const navigate = useNavigateWithPreservedSearchParams();
  const { availableFactors, isWebAuthnUsedAsSignInPasskey } = flowState;
  const { onSubmit: sendMfaVerificationCode } = useSendMfaVerificationCode();
  const { verificationIdsMap } = useContext(UserInteractionContext);

  const handleSelectFactor = useCallback(
    async (factor: MfaFactor) => {
      if (factor === MfaFactor.TOTP && flow === UserMfaFlow.MfaBinding) {
        return startTotpBinding(flowState);
      }

      if (factor === MfaFactor.WebAuthn) {
        return startWebAuthnProcessing(flow, flowState);
      }

      if (factor === MfaFactor.EmailVerificationCode && flow === UserMfaFlow.MfaVerification) {
        // If we already have a verification id for email, resume that session
        // instead of re-sending (which would hit the rate limiter).
        const existingEmailVid = verificationIdsMap[codeVerificationTypeMap.email];
        if (existingEmailVid) {
          navigate(`/mfa-verification/${MfaFactor.EmailVerificationCode}`, { state: flowState });
          return;
        }
        await sendMfaVerificationCode(SignInIdentifier.Email, flowState);
        return;
      }

      if (factor === MfaFactor.PhoneVerificationCode && flow === UserMfaFlow.MfaVerification) {
        const existingPhoneVid = verificationIdsMap[codeVerificationTypeMap.phone];
        if (existingPhoneVid) {
          navigate(`/mfa-verification/${MfaFactor.PhoneVerificationCode}`, { state: flowState });
          return;
        }
        await sendMfaVerificationCode(SignInIdentifier.Phone, flowState);
        return;
      }

      navigate(`/${flow}/${factor}`, { state: flowState });
    },
    [
      flow,
      flowState,
      navigate,
      sendMfaVerificationCode,
      startTotpBinding,
      startWebAuthnProcessing,
      verificationIdsMap,
    ]
  );

  return (
    <div className={styles.factorList}>
      {availableFactors.map((factor) => {
        const isEmailOrPhone =
          factor === MfaFactor.EmailVerificationCode || factor === MfaFactor.PhoneVerificationCode;
        const maskedIdentifier = isEmailOrPhone ? flowState.maskedIdentifiers?.[factor] : undefined;
        const isWebAuthnBound = factor === MfaFactor.WebAuthn && !!isWebAuthnUsedAsSignInPasskey;
        const isDisabled = !!flowState.suggestion && (!!maskedIdentifier || isWebAuthnBound);

        return (
          <MfaFactorButton
            key={factor}
            factor={factor}
            isBinding={flow === UserMfaFlow.MfaBinding}
            isDisabled={isDisabled}
            maskedIdentifier={maskedIdentifier}
            onClick={async () => {
              await handleSelectFactor(factor);
            }}
          />
        );
      })}
    </div>
  );
};

export default MfaFactorList;
