import { condString } from '@silverhand/essentials';

import { captureNativeCapsFromUrl } from '@/utils/native-caps';

export const searchKeysCamelCase = Object.freeze(['organizationId', 'appId', 'uiLocales'] as const);

type SearchKeysCamelCase = (typeof searchKeysCamelCase)[number];

export const searchKeys = Object.freeze({
  /**
   * The key for specifying the organization ID that may be used to override the default settings.
   */
  organizationId: 'organization_id',
  /**
   * The current application ID.
   */
  appId: 'app_id',
  /**
   * The end-user's preferred languages, presented as a space-separated list of BCP47 language tags.
   * E.g. `en` or `en-US` or `en-US en`.
   */
  uiLocales: 'ui_locales',
} satisfies Record<SearchKeysCamelCase, string>);

export const handleSearchParametersData = () => {
  // NiceMatrix override: capture native_caps / native_scheme / app_slug FIRST
  // (App-handoff metadata for 方案 X) so the upstream strip below doesn't drop
  // them. Safe no-op when params are absent — PC / non-App entries unaffected.
  captureNativeCapsFromUrl();

  const { search } = window.location;

  if (!search) {
    return;
  }

  const parameters = new URLSearchParams(search);

  // Store known search keys to the session storage and remove them from the URL to keep the URL
  // clean.
  for (const key of Object.values(searchKeys)) {
    const value = parameters.get(key);
    if (value) {
      sessionStorage.setItem(key, value);
      if (key !== searchKeys.appId) {
        // Keep app_id in the URL for resuming sessions
        parameters.delete(key);
      }
    } else if (key !== searchKeys.appId) {
      sessionStorage.removeItem(key);
    }
  }

  const conditionalParamString = condString(parameters.size > 0 && `?${parameters.toString()}`);

  window.history.replaceState({}, '', window.location.pathname + conditionalParamString);
};
