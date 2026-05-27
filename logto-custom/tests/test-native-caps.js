'use strict';
// Unit tests for `overrides/packages/experience/src/utils/native-caps.ts`.
// Pure-function coverage (no React / no Logto deps). Targets the scheme-relax
// behaviour shipped 2026-05-26: native_scheme is no longer required to match
// `^com\.easyjoy\.<slug>$` — we accept any RFC-3986 lowercase scheme that is
// NOT in DANGEROUS_SCHEMES.
//
// Run (from repo root):
//   bash logto-custom/tests/run.sh
//
// Or by hand:
//   cp logto-custom/overrides/packages/experience/src/utils/native-caps.ts /tmp/native-caps.ts
//   /path/to/tsc --target es2020 --module commonjs --moduleResolution node \
//     --strict false --skipLibCheck --outDir /tmp /tmp/native-caps.ts
//   node logto-custom/tests/test-native-caps.js

const Module = require('module');
const { readFileSync } = require('fs');

// Mock globals before module eval.
const store = new Map();
global.window = {
  location: { search: '', pathname: '/sign-in', hash: '' },
  history: { replaceState: () => {} },
};
global.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

// Load tsc-compiled JS
const src = readFileSync('/tmp/native-caps.js', 'utf8');
const m = new Module('/tmp/native-caps-virtual.js');
m._compile(src, '/tmp/native-caps-virtual.js');
const mod = m.exports;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.error('  \u2717 ' + name + (detail ? ' \u2014 ' + detail : '')); }
}
function setCaps(caps, scheme, slug) {
  store.clear();
  if (caps !== undefined) store.set('nmx_native_caps', caps);
  if (scheme !== undefined) store.set('nmx_native_scheme', scheme);
  if (slug !== undefined) store.set('nmx_app_slug', slug);
}

console.log('--- SCHEME_RE shape (RFC-3986 lowercase) ---');
const { SCHEME_RE, DANGEROUS_SCHEMES } = mod._internals;
check('accepts com.easyjoy.nicenote', SCHEME_RE.test('com.easyjoy.nicenote'));
check('accepts nicematrix.nicenote.cn', SCHEME_RE.test('nicematrix.nicenote.cn'));
check('accepts cn.example.app', SCHEME_RE.test('cn.example.app'));
check('accepts coap+tcp', SCHEME_RE.test('coap+tcp'));
check('accepts myapp-v2', SCHEME_RE.test('myapp-v2'));
check('accepts single letter', SCHEME_RE.test('a'));
check('rejects uppercase', !SCHEME_RE.test('Com.Easyjoy.X'));
check('rejects leading digit', !SCHEME_RE.test('1com'));
check('rejects underscore', !SCHEME_RE.test('com_x'));
check('rejects empty', !SCHEME_RE.test(''));
check('rejects 65 chars', !SCHEME_RE.test('a'.repeat(65)));
check('accepts 64 chars', SCHEME_RE.test('a'.repeat(64)));
check('rejects whitespace', !SCHEME_RE.test('com.x y'));
check('rejects colon', !SCHEME_RE.test('com.x:'));
check('rejects slash', !SCHEME_RE.test('com.x/y'));
check('rejects null bytes', !SCHEME_RE.test('com.x\u0000'));

console.log('--- DANGEROUS_SCHEMES denylist ---');
for (const dangerous of ['http', 'https', 'javascript', 'data', 'file', 'blob', 'about', 'ws', 'wss', 'ftp', 'mailto', 'tel', 'vbscript']) {
  check('denylist contains ' + dangerous, DANGEROUS_SCHEMES.has(dangerous));
}

console.log('--- readValidatedCaps: success paths ---');
setCaps('wechat', 'com.easyjoy.nicenote', 'nicenote');
let v = mod.readValidatedCaps();
check('com.easyjoy.<slug> still works', !!v && v.scheme === 'com.easyjoy.nicenote');

setCaps('wechat,qq', 'nicematrix.nicenote.cn', 'nicenote');
v = mod.readValidatedCaps();
check('legacy non-easyjoy scheme now accepted', !!v && v.scheme === 'nicematrix.nicenote.cn');

setCaps('wechat', 'org.example.myapp', 'completelydifferentslug');
v = mod.readValidatedCaps();
check('scheme suffix need NOT match slug (constraint removed)',
  !!v && v.appSlug === 'completelydifferentslug' && v.scheme === 'org.example.myapp');

setCaps('alipay', 'a', 'a');
v = mod.readValidatedCaps();
check('single-letter scheme accepted', !!v && v.scheme === 'a');

setCaps('wechat,alipay,qq', 'com.example.app', 'someapp');
v = mod.readValidatedCaps();
check('all three caps accepted', !!v && v.caps.size === 3);

console.log('--- readValidatedCaps: failure paths still hold ---');
setCaps('wechat', 'https://evil.example.com', 'nicenote');
check('https-with-://-shape rejected (SCHEME_RE)', mod.readValidatedCaps() === null);

setCaps('wechat', 'https', 'nicenote');
check('bare https rejected (denylist)', mod.readValidatedCaps() === null);

setCaps('wechat', 'http', 'nicenote');
check('bare http rejected (denylist)', mod.readValidatedCaps() === null);

setCaps('wechat', 'javascript', 'nicenote');
check('javascript scheme rejected (denylist)', mod.readValidatedCaps() === null);

setCaps('wechat', 'data', 'nicenote');
check('data scheme rejected (denylist)', mod.readValidatedCaps() === null);

setCaps('wechat', 'file', 'nicenote');
check('file scheme rejected (denylist)', mod.readValidatedCaps() === null);

setCaps('wechat', 'blob', 'nicenote');
check('blob scheme rejected (denylist)', mod.readValidatedCaps() === null);

setCaps('wechat', 'about', 'nicenote');
check('about scheme rejected (denylist)', mod.readValidatedCaps() === null);

setCaps('wechat', 'vbscript', 'nicenote');
check('vbscript scheme rejected (denylist)', mod.readValidatedCaps() === null);

setCaps('wechat', 'Com.Easyjoy.X', 'nicenote');
check('uppercase scheme rejected', mod.readValidatedCaps() === null);

setCaps('apple', 'com.easyjoy.nicenote', 'nicenote');
check('non-whitelist cap rejected', mod.readValidatedCaps() === null);

setCaps('wechat,apple', 'com.easyjoy.nicenote', 'nicenote');
check('mixed whitelist + non-whitelist caps rejected', mod.readValidatedCaps() === null);

setCaps('wechat', '', 'nicenote');
check('empty scheme rejected', mod.readValidatedCaps() === null);

setCaps(undefined, 'com.easyjoy.nicenote', 'nicenote');
check('missing caps -> null', mod.readValidatedCaps() === null);

setCaps('wechat', undefined, 'nicenote');
check('missing scheme -> null', mod.readValidatedCaps() === null);

setCaps('wechat', 'com.easyjoy.nicenote', undefined);
check('missing slug -> null', mod.readValidatedCaps() === null);

setCaps('wechat', 'com.easyjoy.nicenote', 'BAD-Slug-UPPER');
check('invalid slug shape rejected', mod.readValidatedCaps() === null);

setCaps('', 'com.easyjoy.nicenote', 'nicenote');
check('empty caps string rejected', mod.readValidatedCaps() === null);

console.log('--- buildTakeoverUrl: new schemes work ---');
setCaps('wechat', 'nicematrix.nicenote.cn', 'nicenote');
const url1 = mod.buildTakeoverUrl('wechat', 'state-1234');
check('takeover URL uses legacy scheme',
  url1 === 'nicematrix.nicenote.cn://oauth/wechat?state=state-1234&app_slug=nicenote',
  'got: ' + url1);

setCaps('alipay', 'org.example.myapp', 'differentslug');
const url2 = mod.buildTakeoverUrl('alipay', 'abc');
check('takeover URL with different slug/scheme',
  url2 === 'org.example.myapp://oauth/alipay?state=abc&app_slug=differentslug',
  'got: ' + url2);

setCaps('wechat', 'com.easyjoy.nicenote', 'nicenote');
check('not-declared cap -> null', mod.buildTakeoverUrl('qq', 's') === null);
check('non-target -> null', mod.buildTakeoverUrl('apple', 's') === null);

setCaps(undefined);
check('no app context -> null', mod.buildTakeoverUrl('wechat', 's') === null);

console.log('--- buildErrorHandoffUrl ---');
setCaps('wechat', 'nicematrix.nicenote.cn', 'nicenote');
const err = mod.buildErrorHandoffUrl('session_lost:foo');
check('error URL uses scheme as-is',
  err === 'nicematrix.nicenote.cn://oauth/error?reason=session_lost%3Afoo',
  'got: ' + err);

setCaps(undefined);
check('no caps -> null', mod.buildErrorHandoffUrl('x') === null);

console.log('--- shouldHideTarget ---');
setCaps('wechat', 'com.x.y', 'x-y');
check('hides qq when caps=wechat', mod.shouldHideTarget('qq'));
check('hides alipay when caps=wechat', mod.shouldHideTarget('alipay'));
check('does not hide wechat', !mod.shouldHideTarget('wechat'));
check('does not hide apple', !mod.shouldHideTarget('apple'));

setCaps(undefined);
check('no App context -> never hide', !mod.shouldHideTarget('wechat'));

console.log('---');
console.log('PASS ' + pass + '  FAIL ' + fail);
process.exit(fail ? 1 : 0);
