/*
 * [NiceMatrix override] vs upstream 1.43.0 packages/core/src/i18n/detect-language.ts
 * ONE delta: every detected tag (query `locale` + Accept-Language) goes through
 * `normalizeChineseLanguageTag`, so `zh-Hant*` resolves to zh-TW / zh-HK instead of falling
 * through to Simplified zh-CN. Feeds both koa-i18next (`ctx.locale`) and `getExperienceLanguage`.
 * Search for `[NiceMatrix override]`.
 */
import type { IncomingHttpHeaders } from 'node:http';

import type { Optional } from '@silverhand/essentials';
import { normalizeValueToStringArray } from '@silverhand/essentials';
import type { ParameterizedContext } from 'koa';
import type { IRouterParamContext } from 'koa-router';

// [NiceMatrix override]
import { normalizeChineseLanguageTag } from '#src/utils/nicematrix-chinese-language.js';

/**
 * Resolve language and its q value from string.
 * @param languageString The language string in header, e.g. 'en-GB;q=0.8', 'zh-CN'
 * @returns `[language, q]`, e.g. `['en-GB', 0.8]`; `undefined` if no language is detected.
 */
const resolveLanguage = (languageString: string): Optional<[string, number]> => {
  // Edited from https://github.com/lxzxl/koa-i18next-detector/blob/master/src/lookups/header.js
  const [language, ...rest] = languageString.split(';').map((part) => part.trim());

  if (!language) {
    return;
  }

  for (const item of rest) {
    const [key, value] = item.split('=');
    const quality = Number(value);

    if (key === 'q' && !Number.isNaN(quality)) {
      return [language, quality];
    }
  }

  return [language, 1];
};

const detectLanguageFromHeaders = (headers: IncomingHttpHeaders): string[] =>
  headers['accept-language']
    ?.split(',')
    .map((string) => resolveLanguage(string))
    // eslint-disable-next-line unicorn/prefer-native-coercion-functions
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .slice()
    .sort((lng1, lng2) => lng2[1] - lng1[1])
    .map(([locale]) => locale) ?? [];

const detectLanguage = <StateT, ContextT extends IRouterParamContext, ResponseBodyT>(
  ctx: ParameterizedContext<StateT, ContextT, ResponseBodyT>
): string[] =>
  // [NiceMatrix override] script-tagged Chinese → Logto's region tags.
  [...normalizeValueToStringArray(ctx.query.locale), ...detectLanguageFromHeaders(ctx.headers)].map(
    (language) => normalizeChineseLanguageTag(language)
  );

export default detectLanguage;
