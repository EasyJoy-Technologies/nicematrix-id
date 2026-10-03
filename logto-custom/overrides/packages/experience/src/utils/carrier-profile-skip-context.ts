/**
 * [NiceMatrix] `onSkip` for the profile-completion pages of a carrier sign-up, or
 * undefined (= upstream page as is). Provided by the `pages/Continue` override from
 * `hooks/use-carrier-profile-skip.ts`; read by the `SecondaryPageLayout` override.
 * Kept in its own module so the layout depends on nothing but React.
 */
import { createContext } from 'react';

export const CarrierProfileSkipContext = createContext<(() => void) | undefined>(undefined);
