/*
 * [NiceMatrix override] vs upstream 1.43.0 packages/account/src/utils/social-connector.ts
 * ONE delta: the NiceMatrix Carrier connector (target `carrier`, 本机号码一键登录) is
 * never offered in Account Center. It only exists inside an App-launched sign-in
 * interaction (Broker + launch context); binding a phone number in Account
 * Center keeps using the SMS verification flow (plan §9.7). This is the single
 * source of the Security page's social list AND `hasVisibleSocialSection`, so
 * both stay consistent. Search for `[NiceMatrix override]`.
 */
import { ConnectorPlatform, type ExperienceSocialConnector } from '@logto/schemas';

export const getAvailableSocialConnectors = (
  connectors: ExperienceSocialConnector[]
): ExperienceSocialConnector[] => {
  const connectorMap = new Map<string, ExperienceSocialConnector>();

  for (const connector of connectors) {
    // [NiceMatrix override] carrier one-tap login is sign-in only.
    if (connector.platform === ConnectorPlatform.Native || connector.target === 'carrier') {
      continue;
    }

    if (connector.platform === ConnectorPlatform.Web || !connectorMap.has(connector.target)) {
      connectorMap.set(connector.target, connector);
    }
  }

  return [...connectorMap.values()];
};

export const getLocalizedConnectorName = (
  connector: ExperienceSocialConnector,
  language: string
): string => {
  const localizedName = Object.entries(connector.name).find(([locale]) => locale === language)?.[1];

  return localizedName ?? connector.name.en;
};
