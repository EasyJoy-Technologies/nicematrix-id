/**
 * [NiceMatrix] Identity re-verification step for account deletion.
 *
 * The deletion card used to `navigate('/verify')`, a route that never existed: the
 * catch-all rendered Home again, so a user without a live verification record could
 * never open the deletion dialog (NiceNote account-center review 2026-09-27 §10, N11).
 *
 * This page reuses upstream's `VerificationMethodList` (password / email code / phone
 * code, auto-selecting the only method). Once a verification record exists it returns
 * to Home and asks the deletion card to reopen its dialog. Users with no verification
 * method at all see upstream's explicit "no available methods" page instead of a
 * silent bounce.
 */
import { useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import PageContext from '@ac/Providers/PageContextProvider/PageContext';
import VerificationMethodList from '@ac/components/VerificationMethodList';

export const deletionVerifyRoute = '/deletion/verify';

/** Router state key Home's deletion card reads to reopen its dialog after verification. */
export const reopenDeletionStateKey = 'nicematrixReopenDeletion';

const DeletionVerify = () => {
  const navigate = useNavigate();
  const { verificationId } = useContext(PageContext);

  useEffect(() => {
    if (verificationId) {
      navigate('/', { replace: true, state: { [reopenDeletionStateKey]: true } });
    }
  }, [navigate, verificationId]);

  if (verificationId) {
    return null;
  }

  return <VerificationMethodList />;
};

export default DeletionVerify;
