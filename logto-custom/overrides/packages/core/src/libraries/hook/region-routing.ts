// [NiceMatrix] Cross-region design §6.5 — Logto-side region routing for PostSignIn.
//
// After the deterministic device_ref change a roaming device exists in BOTH
// regions' `devices` tables, and one Logto application serves cn+intl, so the
// SAME PostSignIn event is fanned out to every registered PostSignIn hook
// (prod-1 + prod-3). The backend already self-filters (S3b), so functionally
// each region drops the other's events. This routing closes the data-residency
// gap: a hook may declare the region it owns via
//   config.headers['x-nicematrix-region'] = 'intl' | 'cn'
// and then ONLY receives PostSignIn events whose payload.region matches. A hook
// with no region tag is region-agnostic and receives ALL events (historical
// single-hook behavior — prod-1 stays untagged = byte-identical to today).
//
// Region matching mirrors the backend exactly (admin-core/webhook.js):
//   - payload.region absent/empty → 'intl' (historical single-hook world).
//   - 'cn' | 'intl' → that region.
//   - any other value → not-ours (never mis-route).
//
// This module is intentionally dependency-free (structural `RegionTaggedHook`
// type, no @logto/schemas import) so it can be unit-tested standalone via tsc
// + node, the same way `experience/.../native-caps.ts` is.

/** The lowercased header key that carries a hook's owning region. */
export const NICEMATRIX_REGION_HEADER = 'x-nicematrix-region';

/** Minimal structural shape needed to read a hook's region tag. */
export type RegionTaggedHook = {
  config: {
    headers?: Record<string, string>;
  };
};

/**
 * Normalize a client-self-reported region value exactly like the backend.
 * Empty/absent → 'intl' (historical single-hook world). Other values are
 * returned lowercased/trimmed and will only match an identically-tagged hook.
 */
export const normalizeRegion = (raw: unknown): string => {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === '') {
    return 'intl';
  }
  return v; // 'cn' | 'intl' | unknown (unknown never matches a tag)
};

/**
 * Read a hook's owning-region tag from `config.headers` (case-insensitive key).
 * Returns undefined when the hook carries no region tag (region-agnostic).
 */
export const hookRegionTag = (hook: RegionTaggedHook): string | undefined => {
  const headers = hook.config.headers;
  if (!headers) {
    return undefined;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === NICEMATRIX_REGION_HEADER) {
      const tag = String(value).trim().toLowerCase();
      return tag === '' ? undefined : tag;
    }
  }
  return undefined;
};

/**
 * True when this hook should receive a PostSignIn event for `payloadRegion`.
 * Untagged hooks match everything (back-compat); tagged hooks match only their
 * own region under the same normalization the backend uses.
 */
export const hookMatchesRegion = (hook: RegionTaggedHook, payloadRegion: unknown): boolean => {
  const tag = hookRegionTag(hook);
  if (tag === undefined) {
    return true; // region-agnostic hook — receives everything (back-compat)
  }
  return tag === normalizeRegion(payloadRegion);
};
