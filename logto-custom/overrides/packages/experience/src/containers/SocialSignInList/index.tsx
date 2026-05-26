import type { ExperienceSocialConnector } from '@logto/schemas';
import classNames from 'classnames';
import { useMemo, useState } from 'react';

import SocialLinkButton from '@/components/Button/SocialLinkButton';
import useNativeMessageListener from '@/hooks/use-native-message-listener';
import { getLogoUrl } from '@/shared/utils/logo';
import { shouldHideTarget } from '@/utils/native-caps';

import styles from './index.module.scss';
import useSocial from './use-social';

type Props = {
  readonly className?: string;
  readonly socialConnectors?: ExperienceSocialConnector[];
};

const SocialSignInList = ({ className, socialConnectors = [] }: Props) => {
  const { invokeSocialSignIn, theme } = useSocial();
  useNativeMessageListener();

  const [loadingConnectorId, setLoadingConnectorId] = useState<string>();

  // NiceMatrix override (方案 X): hide wechat / alipay / qq buttons when the App
  // declared `native_caps` and the given target is NOT among them. PC browsers
  // and any non-App entry see the upstream button list unchanged because
  // shouldHideTarget returns false when no App context is present.
  const visibleConnectors = useMemo(
    () => socialConnectors.filter((c) => !shouldHideTarget(c.target)),
    [socialConnectors]
  );

  const handleClick = async (connector: ExperienceSocialConnector) => {
    setLoadingConnectorId(connector.id);
    await invokeSocialSignIn(connector);
    setLoadingConnectorId(undefined);
  };

  return (
    <div className={classNames(styles.socialLinkList, className)}>
      {visibleConnectors.map((connector) => {
        const { id, name, logo: logoUrl, logoDark: darkLogoUrl, target } = connector;

        return (
          <SocialLinkButton
            key={id}
            className={styles.socialLinkButton}
            name={name}
            logo={getLogoUrl({ theme, logoUrl, darkLogoUrl })}
            target={target}
            isLoading={loadingConnectorId === id}
            onClick={() => {
              void handleClick(connector);
            }}
          />
        );
      })}
    </div>
  );
};

export default SocialSignInList;
