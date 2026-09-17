/**
 * Staging verification for the PasskeySetup auto-skip override.
 *
 * Runs two real hosted sign-ins against id-staging with the SAME user and the SAME steps,
 * differing in exactly one variable: whether the browser exposes `window.PublicKeyCredential`.
 *
 *   A. WebAuthn absent  -> must NOT show the dead-end error page, must skip automatically,
 *                          must finish the interaction and come back with an authorization code.
 *   B. WebAuthn present -> must still show upstream's "set up passkey" page (regression guard),
 *                          and its manual skip must still work.
 *
 * Usage: node verify-passkey-autoskip.mjs <username> <password> [--keep-webauthn]
 */
import { chromium, devices } from 'playwright';
import crypto from 'node:crypto';

const [username, password] = process.argv.slice(2);
const keepWebAuthn = process.argv.includes('--keep-webauthn');
const ID = process.env.ID_BASE ?? 'https://id-staging.nicematrix.com';
const SPA = process.env.SPA ?? 'dfrfskfsq5zd2nikm1u3f';
const REDIR = process.env.REDIR ?? 'https://m1.nicematrix.com/callback';

if (!username || !password) {
  console.error('usage: node verify-passkey-autoskip.mjs <username> <password> [--keep-webauthn]');
  process.exit(2);
}

const b64u = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const verifier = b64u(crypto.randomBytes(48));
const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
const authorizeUrl =
  `${ID}/oidc/auth?client_id=${SPA}&redirect_uri=${encodeURIComponent(REDIR)}` +
  `&response_type=code&scope=${encodeURIComponent('openid profile offline_access')}` +
  `&state=verify&code_challenge=${challenge}&code_challenge_method=S256`;

const trail = [];
const snap = async (page, label) => {
  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 160));
  trail.push(`${label} :: ${new URL(page.url()).pathname} :: ${text}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['Pixel 5'] });

if (!keepWebAuthn) {
  await context.addInitScript(() => {
    // Equivalent of a browser with no WebAuthn at all (Android WebView, MIUI/Huawei/Quark ...).
    Reflect.deleteProperty(window, 'PublicKeyCredential');
  });
}

const page = await context.newPage();
await page.goto(authorizeUrl, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[name="identifier"]', { timeout: 30_000 });

console.log(
  `browserSupportsWebAuthn-equivalent: ${await page.evaluate(
    () => typeof window.PublicKeyCredential === 'function'
  )}`
);

await page.fill('input[name="identifier"]', username);
await page.fill('input[name="password"]', password);
const terms = page.locator('input[name="termsAgreement"]');
if ((await terms.count()) > 0 && (await terms.isVisible()) && !(await terms.isChecked())) {
  await terms.check();
}
await snap(page, 'sign-in page');
await page.click('button[type="submit"]');

// Walk whatever suggestion screens the tenant puts in front of us, skipping each one.
let sawPasskeyPage = false;
let sawErrorPage = false;

for (let step = 0; step < 8; step++) {
  await page.waitForTimeout(2500);

  if (page.url().startsWith(REDIR)) {
    break;
  }

  await snap(page, `step ${step}`);

  const body = await page.evaluate(() => document.body.innerText);

  if (/webauthn_not_supported|not supported/i.test(body)) {
    sawErrorPage = true;
    break;
  }

  if (page.url().includes('create-passkey')) {
    sawPasskeyPage = true;
  }

  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter((b) => b.offsetParent !== null)
      .map((b) => b.innerText.replace(/\s+/g, ' ').trim())
  );
  trail.push(`        buttons: ${JSON.stringify(buttons)}`);

  // Backup-code gate (staging-only policy): acknowledge and continue.
  if (page.url().includes('mfa-binding/BackupCode')) {
    const primary = page.locator('button[type="submit"], button').last();
    await primary.click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const confirm = page
      .locator('button')
      .filter({ hasText: /confirm|ok|continue|确认|继续/i })
      .last();
    await confirm.click({ timeout: 5000 }).catch(() => {});
    continue;
  }

  const skip = page.locator('text=/^\\s*(Skip|跳过)\\s*$/i').first();
  if ((await skip.count()) > 0) {
    await skip.click({ timeout: 10_000 }).catch(() => {});
    continue;
  }

  // Nothing to skip on this screen; give the app a moment to redirect on its own.
  await page.waitForTimeout(2500);
  if (page.url().startsWith(REDIR)) {
    break;
  }
}

const finalUrl = page.url();
const code = finalUrl.startsWith(REDIR) ? new URL(finalUrl).searchParams.get('code') : null;

console.log('--- trail ---');
console.log(trail.join('\n'));
console.log('--- result ---');
console.log(
  JSON.stringify(
    {
      webAuthnPresent: keepWebAuthn,
      sawPasskeySetupPage: sawPasskeyPage,
      sawWebAuthnNotSupportedErrorPage: sawErrorPage,
      finalUrl: finalUrl.slice(0, 80),
      gotAuthorizationCode: Boolean(code),
    },
    null,
    2
  )
);

await browser.close();
process.exit(code ? 0 : 1);
