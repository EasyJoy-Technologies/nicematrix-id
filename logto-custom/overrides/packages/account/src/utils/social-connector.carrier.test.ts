/**
 * [NiceMatrix] Account Center never offers the carrier one-tap login connector
 * (sign-in only; phone binding stays SMS) — utils/social-connector.ts override.
 */
import { ConnectorPlatform, type ExperienceSocialConnector } from '@logto/schemas';

import { hasVisibleSocialSection } from './security-page';
import { getAvailableSocialConnectors } from './social-connector';

const connector = (id: string, target: string): ExperienceSocialConnector =>
  ({
    id,
    target,
    name: { en: target },
    logo: '',
    logoDark: null,
    platform: ConnectorPlatform.Universal,
  }) as unknown as ExperienceSocialConnector;

describe('Account Center carrier exclusion', () => {
  it('drops the carrier connector and keeps every other one', () => {
    const list = getAvailableSocialConnectors([connector('a', 'google'), connector('c', 'carrier')]);
    expect(list.map(({ target }) => target)).toEqual(['google']);
  });

  it('a tenant whose only social connector is carrier shows no social section', () => {
    expect(
      hasVisibleSocialSection('Edit' as never, { socialConnectors: [connector('c', 'carrier')] } as never)
    ).toBe(false);
  });
});
