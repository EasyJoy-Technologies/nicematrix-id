/**
 * [NiceMatrix] getI18nEmailTemplate Chinese fallback (libraries/connector.ts override):
 * zh-TW / zh-HK readers get the other Traditional region, then zh-CN, before the tenant's
 * fallback language — templates are seeded for en + zh-CN only.
 */
import { TemplateType } from '@logto/connector-kit';
import { type EmailTemplate } from '@logto/schemas';
import { type Nullable } from '@silverhand/essentials';

import { mockSignInExperience } from '#src/__mocks__/sign-in-experience.js';
import { MockQueries } from '#src/test-utils/tenant.js';

const { jest } = import.meta;

const { createConnectorLibrary } = await import('./connector.js');

const details = (tag: string) => ({ subject: `subject-${tag}`, content: `content-${tag}` });

const libraryWithTemplates = (tags: string[]) => {
  const findByLanguageTagAndTemplateType = jest.fn(
    async (templateType: TemplateType, languageTag: string): Promise<Nullable<EmailTemplate>> =>
      tags.includes(languageTag)
        ? {
            tenantId: 'fake_tenant',
            id: languageTag,
            languageTag,
            templateType,
            details: details(languageTag),
            createdAt: 0,
          }
        : null
  );
  const { getI18nEmailTemplate } = createConnectorLibrary(
    new MockQueries({
      emailTemplates: { findByLanguageTagAndTemplateType },
      signInExperiences: {
        // Tenant fallback language = 'en' (mockSignInExperience.languageInfo).
        findDefaultSignInExperience: jest.fn(async () => mockSignInExperience),
      },
    }),
    { getClient: jest.fn() }
  );

  return { getI18nEmailTemplate, findByLanguageTagAndTemplateType };
};

describe('getI18nEmailTemplate Chinese fallback', () => {
  it('serves zh-CN to a zh-TW reader when only en + zh-CN exist (not English)', async () => {
    const { getI18nEmailTemplate, findByLanguageTagAndTemplateType } = libraryWithTemplates([
      'en',
      'zh-CN',
    ]);

    await expect(getI18nEmailTemplate(TemplateType.SignIn, 'zh-TW')).resolves.toEqual(
      details('zh-CN')
    );
    expect(findByLanguageTagAndTemplateType.mock.calls.map(([, tag]) => tag)).toEqual([
      'zh-TW',
      'zh-HK',
      'zh-CN',
    ]);
  });

  it('prefers the other Traditional region over Simplified', async () => {
    const { getI18nEmailTemplate } = libraryWithTemplates(['en', 'zh-CN', 'zh-TW']);

    await expect(getI18nEmailTemplate(TemplateType.SignIn, 'zh-HK')).resolves.toEqual(
      details('zh-TW')
    );
  });

  it('keeps the exact template when it exists', async () => {
    const { getI18nEmailTemplate, findByLanguageTagAndTemplateType } = libraryWithTemplates([
      'en',
      'zh-CN',
      'zh-HK',
    ]);

    await expect(getI18nEmailTemplate(TemplateType.SignIn, 'zh-HK')).resolves.toEqual(
      details('zh-HK')
    );
    expect(findByLanguageTagAndTemplateType).toHaveBeenCalledTimes(1);
  });

  it('leaves non-Chinese tags on the upstream path (exact → tenant fallback)', async () => {
    const { getI18nEmailTemplate, findByLanguageTagAndTemplateType } = libraryWithTemplates([
      'en',
      'zh-CN',
    ]);

    await expect(getI18nEmailTemplate(TemplateType.SignIn, 'fr')).resolves.toEqual(details('en'));
    expect(findByLanguageTagAndTemplateType.mock.calls.map(([, tag]) => tag)).toEqual(['fr', 'en']);
  });
});
