/**
 * [NiceMatrix] Chinese language-tag resolution (ours, not an upstream file).
 *
 * Logto ships Chinese phrases only under region tags: `zh-CN` (Simplified), `zh-TW` and `zh-HK`
 * (Traditional). Clients — iOS in particular — send script tags instead: `zh-Hant`,
 * `zh-Hant-TW`, `zh-Hans-CN`, ... Upstream matching knows no script subtags, so every one of
 * them only matched the base language `zh` and landed on Simplified `zh-CN`, even for
 * Traditional users. `normalizeChineseLanguageTag` rewrites those tags to the region tag that
 * carries the same script before Logto's own matching runs; every other tag passes through
 * unchanged.
 *
 * `chineseLanguageFallbacks` is the companion for resources that exist only for some Chinese
 * tags (e.g. email templates seeded for `zh-CN` only): the other Traditional region first, then
 * Simplified — still closer to the reader than the tenant's English fallback.
 */

/** Regions whose Traditional Chinese is served by `zh-HK`; every other Traditional reader → `zh-TW`. */
const hongKongStyleRegions = new Set(['HK', 'MO']);

const parseLocale = (language: string): Intl.Locale | undefined => {
  try {
    return new Intl.Locale(language.trim().replaceAll('_', '-'));
  } catch {
    // Not a valid BCP 47 tag (e.g. `*`, empty string) — leave it to upstream matching.
  }
};

export const normalizeChineseLanguageTag = (language: string): string => {
  const locale = parseLocale(language);

  if (locale?.language !== 'zh') {
    return language;
  }

  const { script, region } = locale;

  if (script === 'Hant') {
    return region && hongKongStyleRegions.has(region) ? 'zh-HK' : 'zh-TW';
  }

  if (script === 'Hans') {
    return 'zh-CN';
  }

  // Script-less Macau tag: Traditional, but no `zh-MO` phrases — upstream would pick `zh-CN`.
  if (!script && region === 'MO') {
    return 'zh-HK';
  }

  return language;
};

/** Ordered substitutes to try when a resource is missing for an exact Chinese language tag. */
export const chineseLanguageFallbacks = (language: string): string[] => {
  const locale = parseLocale(normalizeChineseLanguageTag(language));

  if (locale?.language !== 'zh' || locale.script) {
    return [];
  }

  if (locale.region === 'TW') {
    return ['zh-HK', 'zh-CN'];
  }

  if (locale.region === 'HK') {
    return ['zh-TW', 'zh-CN'];
  }

  return [];
};
