'use strict';
// Unit tests for `overrides/packages/core/src/libraries/hook/region-routing.ts`.
// Pure-function coverage (no Logto deps). Cross-region design §6.5: a PostSignIn
// hook tagged via config.headers['x-nicematrix-region'] receives only matching
// events; an untagged hook is region-agnostic (back-compat = today's prod-1).
//
// Run (from repo root):
//   bash logto-custom/tests/run.sh
//
// Or by hand:
//   cp logto-custom/overrides/packages/core/src/libraries/hook/region-routing.ts /tmp/region-routing.ts
//   /path/to/tsc --target es2020 --module commonjs --moduleResolution node \
//     --strict false --skipLibCheck --outDir /tmp /tmp/region-routing.ts
//   node logto-custom/tests/test-region-routing.js

const Module = require('module');
const { readFileSync } = require('fs');

// Load tsc-compiled JS (run.sh compiles to /tmp/region-routing.js).
const src = readFileSync('/tmp/region-routing.js', 'utf8');
const m = new Module('/tmp/region-routing-virtual.js');
m._compile(src, '/tmp/region-routing-virtual.js');
const { hookMatchesRegion, hookRegionTag, normalizeRegion, NICEMATRIX_REGION_HEADER } = m.exports;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  — ' + detail : ''}`); }
}

const untagged = { config: {} };
const noHeaders = { config: { headers: undefined } };
const intlHook = { config: { headers: { 'x-nicematrix-region': 'intl' } } };
const cnHook = { config: { headers: { 'x-nicematrix-region': 'cn' } } };
// Real prod hook shape also carries X-Webhook-Source; ensure mixed headers work.
const cnHookMixed = { config: { headers: { 'X-Webhook-Source': 'logto', 'x-nicematrix-region': 'cn' } } };
// Header key casing must be matched case-insensitively (HTTP headers).
const intlHookUpperKey = { config: { headers: { 'X-NiceMatrix-Region': 'INTL' } } };
const emptyTag = { config: { headers: { 'x-nicematrix-region': '  ' } } };

console.log('normalizeRegion:');
check('absent → intl', normalizeRegion(undefined) === 'intl');
check('null → intl', normalizeRegion(null) === 'intl');
check('empty → intl', normalizeRegion('') === 'intl');
check('whitespace → intl', normalizeRegion('   ') === 'intl');
check('cn → cn', normalizeRegion('cn') === 'cn');
check('CN upper/space → cn', normalizeRegion('  CN ') === 'cn');
check('intl → intl', normalizeRegion('intl') === 'intl');
check('unknown stays unknown', normalizeRegion('eu') === 'eu');

console.log('hookRegionTag:');
check('untagged → undefined', hookRegionTag(untagged) === undefined);
check('no headers → undefined', hookRegionTag(noHeaders) === undefined);
check('empty tag → undefined', hookRegionTag(emptyTag) === undefined);
check('intl tag', hookRegionTag(intlHook) === 'intl');
check('cn tag (mixed headers)', hookRegionTag(cnHookMixed) === 'cn');
check('upper key + upper value → intl', hookRegionTag(intlHookUpperKey) === 'intl');

console.log('hookMatchesRegion — untagged hook (region-agnostic, back-compat):');
check('untagged matches intl', hookMatchesRegion(untagged, 'intl') === true);
check('untagged matches cn', hookMatchesRegion(untagged, 'cn') === true);
check('untagged matches absent', hookMatchesRegion(untagged, undefined) === true);
check('untagged matches unknown', hookMatchesRegion(untagged, 'eu') === true);
check('empty-tag treated as untagged', hookMatchesRegion(emptyTag, 'cn') === true);

console.log('hookMatchesRegion — intl-tagged hook (prod-1 after activation):');
check('intl hook + intl payload', hookMatchesRegion(intlHook, 'intl') === true);
check('intl hook + absent payload (default intl)', hookMatchesRegion(intlHook, undefined) === true);
check('intl hook + empty payload (default intl)', hookMatchesRegion(intlHook, '') === true);
check('intl hook + cn payload → drop', hookMatchesRegion(intlHook, 'cn') === false);
check('intl hook + unknown payload → drop', hookMatchesRegion(intlHook, 'eu') === false);

console.log('hookMatchesRegion — cn-tagged hook (prod-3 after activation):');
check('cn hook + cn payload', hookMatchesRegion(cnHook, 'cn') === true);
check('cn hook + CN upper payload', hookMatchesRegion(cnHook, 'CN') === true);
check('cn hook + intl payload → drop', hookMatchesRegion(cnHook, 'intl') === false);
check('cn hook + absent payload (default intl) → drop', hookMatchesRegion(cnHook, undefined) === false);
check('cn hook mixed-headers + cn payload', hookMatchesRegion(cnHookMixed, 'cn') === true);

console.log('Mutual-exclusion invariant (post-activation: exactly one region owns each event):');
for (const payload of ['intl', 'cn', '', undefined, 'EU', '  Cn ']) {
  const onIntl = hookMatchesRegion(intlHook, payload);
  const onCn = hookMatchesRegion(cnHook, payload);
  const norm = normalizeRegion(payload);
  // Known regions land on exactly one hook; unknown regions land on neither
  // (never mis-attributed) — both are acceptable & non-duplicating.
  const ok = (norm === 'intl' && onIntl && !onCn) ||
             (norm === 'cn' && !onIntl && onCn) ||
             (norm !== 'intl' && norm !== 'cn' && !onIntl && !onCn);
  check(`no double-delivery for payload=${JSON.stringify(payload)} (norm=${norm})`, ok,
    `intl=${onIntl} cn=${onCn}`);
}

check('header const is lowercase canonical', NICEMATRIX_REGION_HEADER === 'x-nicematrix-region');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
