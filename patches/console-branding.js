#!/usr/bin/env node
/**
 * Patch: Replace Logto branding + fix OSS token flow
 * Target: Logto 1.36.0 console bundle
 *
 * OSS token fix:
 *   In OSS mode, getOrganizationToken() returns undefined (no org context).
 *   The API hook (A8) uses getOrganizationToken to authenticate /api/* calls.
 *   Fix: replace getOrganizationToken with getAccessToken("https://default.logto.app/api")
 *   which is the correct management API resource indicator for Logto OSS.
 *   (U1="default" stays unchanged so initial auth includes this resource)
 *
 * Do NOT change pl(U1) → pl(J4): U1="default" is correct for OSS initial auth.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const CONSOLE_DIST = '/etc/logto/packages/console/dist';
const ICON_URL   = 'https://m.nicematrix.com/branding/nicematrix-logo-1024.svg';
const TOPBAR_URL = 'https://m.nicematrix.com/branding/NiceMatrix-170x64.svg';
const MGMT_API   = 'https://default.logto.app/api';
let errors = [], patched = 0;

// 1. index.html favicon
const htmlPath = path.join(CONSOLE_DIST, 'index.html');
if (fs.existsSync(htmlPath)) {
  let html = fs.readFileSync(htmlPath, 'utf8');
  if (!html.includes(ICON_URL)) {
    html = html
      .replace(/<link rel="apple-touch-icon"[^>]*>/, '<link rel="apple-touch-icon" sizes="180x180" href="' + ICON_URL + '">')
      .replace(/<link rel="icon"[^>]*>/, '<link rel="icon" type="image/svg+xml" href="' + ICON_URL + '" />');
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log('  [OK] index.html favicon');
    patched++;
  } else { console.log('  [SKIP] index.html already patched'); }
} else { errors.push('MISSING: ' + htmlPath); }

// 2. JS bundle
const assetsDir = path.join(CONSOLE_DIST, 'assets');
if (!fs.existsSync(assetsDir)) { errors.push('MISSING_DIR: ' + assetsDir); process.exit(1); }
const bundles = fs.readdirSync(assetsDir).filter(f => f.startsWith('index-') && f.endsWith('.js') && !f.endsWith('.js.map'));

for (const bundle of bundles) {
  const fp = path.join(assetsDir, bundle);
  let c = fs.readFileSync(fp, 'utf8');
  let changed = false;

  const hasMarkers =
    c.includes('J8=t=>n.createElement("svg",{width:90') ||
    c.includes('J8=t=>n.createElement("img"') ||
    c.includes('i9=t=>n.createElement("svg",{width:154') ||
    c.includes('i9=t=>n.createElement("img"') ||
    c.includes('https://logto.io/logo.svg') ||
    c.includes('getOrganizationToken:s}=q()');
  if (!hasMarkers) { console.log('  [SKIP] ' + bundle + ': no markers'); continue; }

  // 2a. J8 topbar logo
  if (c.includes('J8=t=>n.createElement("img"')) {
    console.log('  [SKIP] ' + bundle + ': J8 done');
  } else {
    const s = c.indexOf('J8=t=>n.createElement("svg",{width:90');
    const e = s > -1 ? c.indexOf(',rC="__cDzoA__topbar"', s) : -1;
    if (s !== -1 && e !== -1 && e - s < 25000) {
      const img = 'J8=t=>n.createElement("img",{src:"' + TOPBAR_URL + '",height:32,style:{height:"32px",width:"auto"},alt:"NiceMatrix",...t})';
      c = c.slice(0, s) + img + c.slice(e);
      console.log('  [OK] ' + bundle + ': J8 topbar logo');
      changed = true;
    } else { errors.push('NO_J8 in ' + bundle); }
  }

  // 2b. i9 loading/welcome logo
  if (c.includes('i9=t=>n.createElement("img"')) {
    console.log('  [SKIP] ' + bundle + ': i9 done');
  } else {
    const s = c.indexOf('i9=t=>n.createElement("svg",{width:154');
    const e = s > -1 ? c.indexOf(',Ul="__FiTPO__container"', s) : -1;
    if (s !== -1 && e !== -1 && e - s < 25000) {
      const img = 'i9=t=>n.createElement("img",{src:"' + TOPBAR_URL + '",height:32,style:{height:"32px",width:"auto"},alt:"NiceMatrix",...t})';
      c = c.slice(0, s) + img + c.slice(e);
      console.log('  [OK] ' + bundle + ': i9 loading logo');
      changed = true;
    } else { errors.push('NO_I9 in ' + bundle); }
  }

  // 2c. logto.io logo URLs
  if (c.includes('https://logto.io/logo.svg')) {
    c = c.replace(/https:\/\/logto\.io\/logo\.svg/g, TOPBAR_URL)
         .replace(/https:\/\/logto\.io\/logo-dark\.svg/g, TOPBAR_URL);
    console.log('  [OK] ' + bundle + ': logto.io URLs');
    changed = true;
  }

  // 2d. OSS API auth fix: getOrganizationToken → getAccessToken(default mgmt API)
  // In OSS, getOrganizationToken() returns undefined → no Bearer token on /api/* calls
  // Fix: use getAccessToken("https://default.logto.app/api") instead
  const R8O = '{isAuthenticated:o,getOrganizationToken:s}=q();return n.useMemo(()=>A8({hideErrorToast:t,isAuthenticated:o,getOrganizationToken:s,tenantId:r,language:i.language}),[r,s,t,o,i.language])';
  const R8N = '{isAuthenticated:o,getAccessToken:s}=q();return n.useMemo(()=>A8({hideErrorToast:t,isAuthenticated:o,getOrganizationToken:()=>s("' + MGMT_API + '"),tenantId:r,language:i.language}),[r,s,t,o,i.language])';
  if (c.includes(R8O)) {
    c = c.replace(R8O, R8N);
    console.log('  [OK] ' + bundle + ': R8 OSS API auth fix');
    changed = true;
  } else if (c.includes('getAccessToken:s}=q()')) {
    console.log('  [SKIP] ' + bundle + ': R8 already done');
  } else {
    errors.push('NO_R8 in ' + bundle);
  }

  if (changed) { fs.writeFileSync(fp, c, 'utf8'); patched++; }
}

console.log('\n=== Console Branding Summary ===');
console.log('Patched: ' + patched);
if (errors.length > 0) { errors.forEach(e => console.error('  ERROR: ' + e)); process.exit(1); }
console.log('All patches applied.\n');

const { execSync } = require('child_process');
const jsFiles = fs.readdirSync(assetsDir).filter(f => f.startsWith('index-') && f.endsWith('.js') && !f.endsWith('.js.map'));
for (const f of jsFiles) {
  const fp = path.join(assetsDir, f);
  try { execSync('gzip -9 -c "' + fp + '" > "' + fp + '.gz"'); } catch(e) {}
  if (fs.existsSync(fp + '.br')) { try { execSync('brotli -9 -c "' + fp + '" > "' + fp + '.br"'); } catch(e) {} }
}
console.log('Recompressed.');
