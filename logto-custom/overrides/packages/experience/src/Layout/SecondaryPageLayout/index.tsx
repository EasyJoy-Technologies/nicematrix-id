/*
 * [NiceMatrix override] vs upstream 1.43.0
 *   logto-upstream/packages/experience/src/Layout/SecondaryPageLayout/index.tsx
 * ONE delta: when the page passes no `onSkip`, fall back to the carrier sign-up
 * skip from `CarrierProfileSkipContext` (only provided on the profile-completion
 * pages, and only for a skippable carrier sign-up — review 2026-10-02 B7). The
 * NavBar "Skip" control is upstream's own. Elsewhere the context is undefined and
 * the layout is exactly upstream. Search for `[NiceMatrix override]`.
 */
import type { TFuncKey } from 'i18next';
import { type ReactElement, useContext } from 'react';

import useNavigateWithPreservedSearchParams from '@/hooks/use-navigate-with-preserved-search-params';
import usePlatform from '@/hooks/use-platform';
import DynamicT from '@/shared/components/DynamicT';
import NavBar from '@/shared/components/NavBar';
import PageMeta from '@/shared/components/PageMeta';
// [NiceMatrix override] carrier sign-up profile skip.
import { CarrierProfileSkipContext } from '@/utils/carrier-profile-skip-context';

import { InlineNotification } from '../../components/Notification';

import styles from './index.module.scss';

type Props = {
  readonly title: TFuncKey;
  readonly description?: TFuncKey | ReactElement | '';
  readonly titleProps?: Record<string, unknown>;
  readonly descriptionProps?: Record<string, unknown>;
  readonly notification?: TFuncKey;
  readonly onSkip?: () => void;
  readonly isNavBarHidden?: boolean;
  readonly children: React.ReactNode;
};

const SecondaryPageLayout = ({
  title,
  description,
  titleProps,
  descriptionProps,
  notification,
  onSkip,
  isNavBarHidden,
  children,
}: Props) => {
  const { isMobile } = usePlatform();
  const navigate = useNavigateWithPreservedSearchParams();
  // [NiceMatrix override] the page's own `onSkip` always wins.
  const carrierSkip = useContext(CarrierProfileSkipContext);

  return (
    <div className={styles.wrapper}>
      <PageMeta titleKey={title} />
      <NavBar
        isHidden={isNavBarHidden}
        onSkip={onSkip ?? carrierSkip}
        onBack={() => {
          navigate(-1);
        }}
      />
      {isMobile && notification && (
        <InlineNotification message={notification} className={styles.notification} />
      )}
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.title}>
            <DynamicT forKey={title} interpolation={titleProps} />
          </div>
          {description && (
            <div className={styles.description}>
              {typeof description === 'string' ? (
                <DynamicT forKey={description} interpolation={descriptionProps} />
              ) : (
                description
              )}
            </div>
          )}
        </div>
        {children}
      </div>
      {!isMobile && notification && (
        <InlineNotification message={notification} className={styles.notification} />
      )}
    </div>
  );
};

export default SecondaryPageLayout;
