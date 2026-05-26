/**
 * NiceMatrix override: native capability handoff (方案 X).
 *
 * App-launched sign-in flows can declare which Chinese social providers
 * the device can take over via native SDKs by appending ?native_caps=...
 * and ?native_scheme=... to the Logto sign-in URL.
 *
 *   /sign-in?native_caps=wechat,qq&native_scheme=com.easyjoy.<slug>&app_slug=<slug>
 *
 * The Logto sign-in JS then:
 *   1. hides any wechat / alipay / qq button whose target is NOT in
 *      native_caps (so users see only what they can actually use);
 *   2. when the user clicks one of those buttons, bypasses the upstream
 *      Web OAuth handshake and instead emits
 *      `<native_scheme>://oauth/<target>?state=...` so that the App's
 *      ASWebAuthenticationSession / Chrome Custom Tabs listener captures
 *      it and resumes via the native SDK.
 *
 * Safety guarantees (also documented in
 * docs/_plans/2026-05-26_unified_login_with_native_detection.md §2.4):
 *
 *   - takeover NEVER applies when the URL did not declare native_caps
 *     (PC browsers, Admin Console, SSO flows are bit-identical to upstream);
 *   - native_caps values must be in a hard-coded WHITELIST
 *     [wechat, alipay, qq] so Apple/Google/Microsoft can't be hijacked;
 *   - native_scheme must match `^com\.easyjoy\.[a-z0-9-]+$` (no http(s),
 *     no javascript:, no other origins);
 *   - native_scheme's slug part must equal app_slug (defence in depth).
 *
 * If ANY check fails, takeover is silently disabled and the upstream
 * code path proceeds. The user always sees a working sign-in.
 */

const STORAGE_KEY_CAPS = 'nmx_native_caps';
const STORAGE_KEY_SCHEME = 'nmx_native_scheme';
const STORAGE_KEY_SLUG = 'nmx_app_slug';

// Hard whitelist. Apple / Google / Microsoft / Facebook / GitHub / line / etc
// MUST NEVER appear here — they go through standard OAuth.
const TAKEOVER_TARGETS = new Set(['wechat', 'alipay', 'qq']);

const SCHEME_RE = /^com\.easyjoy\.[a-z0-9-]+$/;
const SLUG_RE = /^[a-z0-9-]+$/;

function parseCsv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/**
 * Capture native-caps params from the URL on app boot. Must run BEFORE
 * Logto's `handleSearchParametersData` strips unknown query keys.
 *
 * Idempotent: re-reading the URL is harmless; if params are missing the
 * existing sessionStorage values (if any) are preserved so deep navigation
 * back-and-forth keeps working.
 */
export const captureNativeCapsFromUrl = (): void => {
  try {
    const params = new URLSearchParams(window.location.search);
    const caps = params.get('native_caps');
    const scheme = params.get('native_scheme');
    const slug = params.get('app_slug');

    // Only write keys that are present in this URL. Allow partial deep links.
    if (caps !== null) sessionStorage.setItem(STORAGE_KEY_CAPS, caps);
    if (scheme !== null) sessionStorage.setItem(STORAGE_KEY_SCHEME, scheme);
    if (slug !== null) sessionStorage.setItem(STORAGE_KEY_SLUG, slug);

    // Strip our keys from the URL so Logto's downstream code sees a clean
    // search string. Match upstream's strip behaviour for `app_id` etc.
    if (caps !== null || scheme !== null || slug !== null) {
      params.delete('native_caps');
      params.delete('native_scheme');
      params.delete('app_slug');
      const qs = params.toString();
      const next = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
      window.history.replaceState({}, '', next);
    }
  } catch (e) {
    // Never let URL parsing throw uncaught — fallback to passthrough.
    // eslint-disable-next-line no-console
    console.warn('[nmx native-caps] capture failed; passthrough', e);
  }
};

type ValidatedCaps = {
  caps: Set<string>;
  scheme: string;
  appSlug: string;
};

/**
 * Read + validate captured params from sessionStorage. Returns null if
 * any safety check fails — in which case callers must fall back to the
 * upstream OAuth flow (passthrough).
 */
export const readValidatedCaps = (): ValidatedCaps | null => {
  let capsRaw: string | null = null;
  let scheme: string | null = null;
  let appSlug: string | null = null;

  try {
    capsRaw = sessionStorage.getItem(STORAGE_KEY_CAPS);
    scheme = sessionStorage.getItem(STORAGE_KEY_SCHEME);
    appSlug = sessionStorage.getItem(STORAGE_KEY_SLUG);
  } catch {
    return null; // Private-mode storage failure → fall back.
  }

  // Require ALL three. Partial config is suspect.
  if (!capsRaw || !scheme || !appSlug) return null;

  // Validate scheme.
  if (!SCHEME_RE.test(scheme)) return null;

  // Validate app slug.
  if (!SLUG_RE.test(appSlug)) return null;

  // Defence in depth: scheme suffix must equal app slug.
  const schemeSlug = scheme.replace(/^com\.easyjoy\./, '');
  if (schemeSlug !== appSlug) return null;

  // Validate caps: every entry must be in whitelist.
  const parsed = parseCsv(capsRaw);
  if (parsed.length === 0) return null;
  for (const cap of parsed) {
    if (!TAKEOVER_TARGETS.has(cap)) return null;
  }

  return {
    caps: new Set(parsed),
    scheme,
    appSlug,
  };
};

/**
 * Returns true if the given connector target should be HIDDEN from
 * the social sign-in button list because:
 *   - we are in an App handoff context (native_caps declared);
 *   - the target is a Chinese provider (wechat / alipay / qq);
 *   - the App did NOT list it in native_caps (it's not installed).
 *
 * Apple / Google / Microsoft / etc. are NEVER hidden by this rule.
 */
export const shouldHideTarget = (target: string): boolean => {
  const validated = readValidatedCaps();
  if (!validated) return false; // No App context → never hide.
  const lower = target.toLowerCase();
  if (!TAKEOVER_TARGETS.has(lower)) return false; // Not a target we manage.
  return !validated.caps.has(lower);
};

/**
 * Decide whether to take over the click for this connector.
 * Returns the custom-scheme URL to navigate to if takeover applies,
 * or null to let upstream code run.
 */
export const buildTakeoverUrl = (
  target: string,
  state: string
): string | null => {
  const validated = readValidatedCaps();
  if (!validated) return null;
  const lower = target.toLowerCase();
  if (!TAKEOVER_TARGETS.has(lower)) return null;
  if (!validated.caps.has(lower)) return null;

  // The state is generated by Logto's standard signIn flow and must be
  // echoed back so App can correlate the handoff. We do NOT store it
  // separately; App is responsible for state validation post-callback.
  const params = new URLSearchParams();
  params.set('state', state);
  params.set('app_slug', validated.appSlug);
  return `${validated.scheme}://oauth/${lower}?${params.toString()}`;
};

/**
 * Build an error-handoff URL that hands control back to the App when the
 * social sign-in pipeline reaches a dead-end inside an ASWebAuthenticationSession
 * (e.g. session lost on legacy redirect_uri config — Bug-A defence layer).
 *
 * Returns null when there's no App context to hand back to.
 */
export const buildErrorHandoffUrl = (reason: string): string | null => {
  const validated = readValidatedCaps();
  if (!validated) return null;
  const params = new URLSearchParams();
  params.set('reason', reason);
  return `${validated.scheme}://oauth/error?${params.toString()}`;
};

// Exported only for unit tests.
export const _internals = {
  STORAGE_KEY_CAPS,
  STORAGE_KEY_SCHEME,
  STORAGE_KEY_SLUG,
  TAKEOVER_TARGETS,
  SCHEME_RE,
  SLUG_RE,
};
