/**
 * [NiceMatrix] Chinese language-tag resolution: the helper itself plus the two upstream entry
 * points it is wired into (detectLanguage → koa-i18next / getExperienceLanguage, and the
 * explicit `lng` / ui_locales path of getExperienceLanguage).
 */
import type { ParameterizedContext } from 'koa';
import type { IRouterParamContext } from 'koa-router';

import detectLanguage from '#src/i18n/detect-language.js';
import createMockContext from '#src/test-utils/jest-koa-mocks/create-mock-context.js';

import { getExperienceLanguage } from './i18n.js';
import {
  chineseLanguageFallbacks,
  normalizeChineseLanguageTag,
} from './nicematrix-chinese-language.js';

const languageInfo = { autoDetect: true, fallbackLanguage: 'en' } as const;

const contextWith = (
  acceptLanguage?: string,
  query?: Record<string, string>
): ParameterizedContext<unknown, IRouterParamContext> =>
  // Router params are irrelevant to language detection; the mock context lacks them.
  createMockContext({
    ...(acceptLanguage && { headers: { 'accept-language': acceptLanguage } }),
    ...(query && { url: `/?${new URLSearchParams(query).toString()}` }),
  }) as unknown as ParameterizedContext<unknown, IRouterParamContext>;

describe('normalizeChineseLanguageTag', () => {
  it.each([
    ['zh-Hant', 'zh-TW'],
    ['zh-Hant-TW', 'zh-TW'],
    ['zh-hant-tw', 'zh-TW'],
    ['zh_Hant_TW', 'zh-TW'],
    ['zh-Hant-CN', 'zh-TW'],
    ['zh-Hant-HK', 'zh-HK'],
    ['zh-Hant-MO', 'zh-HK'],
    ['zh-MO', 'zh-HK'],
    ['zh-Hans', 'zh-CN'],
    ['zh-Hans-CN', 'zh-CN'],
    ['zh-Hans-HK', 'zh-CN'],
    ['zh-Hans-SG', 'zh-CN'],
  ])('maps %s → %s', (input, expected) => {
    expect(normalizeChineseLanguageTag(input)).toBe(expected);
  });

  it.each([
    'zh-TW',
    'zh-HK',
    'zh-CN',
    'zh',
    'zh-SG',
    'en',
    'en-US',
    'ja',
    'pt-BR',
    '*',
    '',
    'not a tag',
  ])('leaves %p unchanged', (input) => {
    expect(normalizeChineseLanguageTag(input)).toBe(input);
  });
});

describe('chineseLanguageFallbacks', () => {
  it('tries the other Traditional region, then Simplified', () => {
    expect(chineseLanguageFallbacks('zh-TW')).toEqual(['zh-HK', 'zh-CN']);
    expect(chineseLanguageFallbacks('zh-HK')).toEqual(['zh-TW', 'zh-CN']);
    expect(chineseLanguageFallbacks('zh-Hant-HK')).toEqual(['zh-TW', 'zh-CN']);
  });

  it('adds nothing for Simplified or non-Chinese tags', () => {
    for (const tag of ['zh-CN', 'zh', 'zh-Hans', 'en', 'fr-CA', '']) {
      expect(chineseLanguageFallbacks(tag)).toEqual([]);
    }
  });
});

describe('detectLanguage (override)', () => {
  it('normalizes Accept-Language and keeps the q-order', () => {
    expect(detectLanguage(contextWith('en;q=0.5, zh-Hant-TW, zh-Hans;q=0.8'))).toEqual([
      'zh-TW',
      'zh-CN',
      'en',
    ]);
  });

  it('normalizes the `locale` query parameter too', () => {
    expect(detectLanguage(contextWith(undefined, { locale: 'zh-Hant-HK' }))).toEqual(['zh-HK']);
  });
});

describe('getExperienceLanguage (override)', () => {
  it.each([
    ['zh-Hant', 'zh-TW'],
    ['zh-Hant-TW', 'zh-TW'],
    ['zh-Hant-HK', 'zh-HK'],
    ['zh-Hans-CN', 'zh-CN'],
    ['zh-TW', 'zh-TW'],
    ['zh-HK', 'zh-HK'],
    ['zh-CN', 'zh-CN'],
    ['zh', 'zh-CN'],
  ])('Accept-Language %s → %s', (header, expected) => {
    expect(
      getExperienceLanguage({ ctx: contextWith(header), languageInfo, customLanguages: [] })
    ).toBe(expected);
  });

  it('normalizes explicit ui_locales before Accept-Language', () => {
    expect(
      getExperienceLanguage({
        ctx: contextWith('en'),
        languageInfo,
        customLanguages: [],
        lng: 'zh-Hant fr',
      })
    ).toBe('zh-TW');
  });

  it('does not use detection when auto-detect is off', () => {
    expect(
      getExperienceLanguage({
        ctx: contextWith('zh-Hant'),
        languageInfo: { autoDetect: false, fallbackLanguage: 'en' },
        customLanguages: [],
      })
    ).toBe('en');
  });
});
