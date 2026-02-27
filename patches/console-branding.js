#!/usr/bin/env node

/**
 * Patch: Replace Logto branding in Console with NiceMatrix branding
 *
 * What:
 *   1. index.html — Replace favicon (.ico) and apple-touch-icon (.png)
 *      with NiceMatrix SVG URLs
 *   2. index-*.js bundle — Replace hardcoded logto.io logo URLs
 *      with NiceMatrix banner SVG
 *
 * Target Logto version: 1.36.0
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CONSOLE_DIST = '/etc/logto/packages/console/dist';

const NICEMATRIX_LOGO_SVG = 'https://m.nicematrix.com/branding/nicematrix-logo-1024.svg';
const NICEMATRIX_BANNER_SVG = 'https://m.nicematrix.com/branding/nicematrix-596x221.svg';
const NICEMATRIX_TOPBAR_SVG = 'https://m.nicematrix.com/branding/NiceMatrix-170x64.svg';

let errors = [];
let totalPatched = 0;

// --- 1. Patch index.html ---
const htmlPath = path.join(CONSOLE_DIST, 'index.html');
if (!fs.existsSync(htmlPath)) {
  errors.push(`MISSING: ${htmlPath}`);
} else {
  let html = fs.readFileSync(htmlPath, 'utf8');
  let changed = false;

  // Replace apple-touch-icon (any .png reference in that tag)
  const appleIconOld = /<link rel="apple-touch-icon"[^>]*>/;
  const appleIconNew = `<link rel="apple-touch-icon" sizes="180x180" href="${NICEMATRIX_LOGO_SVG}">`;
  if (!html.includes(NICEMATRIX_LOGO_SVG)) {
    html = html.replace(appleIconOld, appleIconNew);
    changed = true;
  }

  // Replace favicon
  const faviconOld = /<link rel="icon"[^>]*>/;
  const faviconNew = `<link rel="icon" type="image/svg+xml" href="${NICEMATRIX_LOGO_SVG}" />`;
  if (!html.includes('type="image/svg+xml"')) {
    html = html.replace(faviconOld, faviconNew);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log(`  [OK] ${htmlPath}`);
    totalPatched++;
  } else {
    console.log(`  [SKIP] ${htmlPath}: already patched`);
  }
}

// --- 2. Patch console JS bundle ---
const assetsDir = path.join(CONSOLE_DIST, 'assets');
if (!fs.existsSync(assetsDir)) {
  errors.push(`MISSING_DIR: ${assetsDir}`);
} else {
  const bundles = fs.readdirSync(assetsDir).filter(f =>
    f.startsWith('index-') && f.endsWith('.js') && !f.endsWith('.js.map')
  );

  for (const bundle of bundles) {
    const fullPath = path.join(assetsDir, bundle);
    let content = fs.readFileSync(fullPath, 'utf8');

    if (content.includes(NICEMATRIX_BANNER_SVG)) {
      console.log(`  [SKIP] ${bundle}: already patched`);
      continue;
    }

    const hasLogtoLogo = content.includes('https://logto.io/logo.svg') ||
                         content.includes('https://logto.io/logo-dark.svg');

    if (!hasLogtoLogo) {
      console.log(`  [SKIP] ${bundle}: no logto.io logo URLs found`);
      continue;
    }

    content = content
      .replace(/https:\/\/logto\.io\/logo\.svg/g, NICEMATRIX_BANNER_SVG)
      .replace(/https:\/\/logto\.io\/logo-dark\.svg/g, NICEMATRIX_BANNER_SVG);

    // Replace J8 topbar logo (inline SVG, width:90 height:28) with NiceMatrix img
    // End boundary: '),' followed by CSS class var rC="__cDzoA__topbar" (verified offset ~8132)
    const j8Marker = 'J8=t=>n.createElement("svg",{width:90';
    const j8End = '),rC="__cDzoA__topbar"';
    const j8Start = content.indexOf(j8Marker);
    const j8EndIdx = content.indexOf(j8End, j8Start > -1 ? j8Start : 0);
    if (j8Start !== -1 && j8EndIdx !== -1 && j8EndIdx - j8Start < 20000) {
      const newJ8 = `J8=t=>n.createElement("img",{src:"${NICEMATRIX_TOPBAR_SVG}",height:64,style:{height:"64px",width:"auto"},alt:"NiceMatrix",...t})`;
      content = content.substring(0, j8Start) + newJ8 + content.substring(j8EndIdx);
      console.log(`  [OK] ${bundle}: topbar SVG logo (J8) replaced`);
    } else if (!content.includes('J8=t=>n.createElement("img"')) {
      errors.push(`NO_MATCH_J8: topbar logo J8 not found in ${bundle} (j8=${j8Start}, end=${j8EndIdx})`);
    } else {
      console.log(`  [SKIP] ${bundle}: topbar logo already patched`);
    }

    // Replace inline SVG welcome/loading logo (i9) with NiceMatrix-170x64 img
    // End boundary: rC="__cDzoA__topbar" (same block boundary check)
    const i9Marker = 'i9=t=>n.createElement("svg",{width:154';
    const i9EndMarker = 'Ul="__FiTPO__container"';
    const i9Start = content.indexOf(i9Marker);
    const ulIdx = content.indexOf(i9EndMarker, i9Start > -1 ? i9Start : 0);
    if (i9Start !== -1 && ulIdx !== -1 && ulIdx - i9Start < 12000) {
      const newI9 = `i9=t=>n.createElement("img",{src:"${NICEMATRIX_TOPBAR_SVG}",height:64,style:{height:"64px",width:"auto"},alt:"NiceMatrix",...t}),`;
      content = content.substring(0, i9Start) + newI9 + content.substring(ulIdx);
      console.log(`  [OK] ${bundle}: welcome/loading SVG logo (i9) replaced`);
    } else if (!content.includes('i9=t=>n.createElement("img"')) {
      errors.push(`NO_MATCH_I9: welcome logo i9 not found in ${bundle} (i9=${i9Start}, ul=${ulIdx})`);
    } else {
      console.log(`  [SKIP] ${bundle}: welcome logo already patched`);
    }

    // Fix Management API resource indicator: pl(U1) → pl(J4) (default → admin tenant)
    // Required because ADMIN_ENDPOINT == ENDPOINT routes all requests to admin tenant
    // which validates JWT audience as https://admin.logto.app/api
    if (content.includes('[pl(U1).indicator,he.indicator]')) {
      content = content.replace('[pl(U1).indicator,he.indicator]', '[pl(J4).indicator,he.indicator]');
      console.log(`  [OK] ${bundle}: fixed Management API resource indicator (U1→J4)`);
    } else if (!content.includes('[pl(J4).indicator,he.indicator]')) {
      errors.push(`NO_MATCH_RESOURCE: management API resource indicator not found in ${bundle}`);
    } else {
      console.log(`  [SKIP] ${bundle}: resource indicator already patched`);
    }

    // Fix Management API token: R8 hook uses getOrganizationToken("t-default") which gives
    // aud=urn:logto:organization:t-default — wrong audience for management API.
    // Patch R8 to use getAccessToken("https://admin.logto.app/api") instead.
    const r8old = '{isAuthenticated:o,getOrganizationToken:s}=q();return n.useMemo(()=>A8({hideErrorToast:t,isAuthenticated:o,getOrganizationToken:s,tenantId:r,language:i.language}),[r,s,t,o,i.language])';
    const r8new = '{isAuthenticated:o,getAccessToken:s}=q();return n.useMemo(()=>A8({hideErrorToast:t,isAuthenticated:o,getOrganizationToken:()=>s("https://admin.logto.app/api"),tenantId:r,language:i.language}),[r,s,t,o,i.language])';
    if (content.includes(r8old)) {
      content = content.replace(r8old, r8new);
      console.log(`  [OK] ${bundle}: patched R8 to use getAccessToken for management API`);
    } else if (!content.includes('getAccessToken:s}=q()')) {
      errors.push(`NO_MATCH_R8: R8 hook pattern not found in ${bundle}`);
    } else {
      console.log(`  [SKIP] ${bundle}: R8 hook already patched`);
    }

    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`  [OK] ${bundle}`);
    totalPatched++;
  }
}

// --- Summary ---
console.log(`\n=== Console Branding Patch Summary ===`);
console.log(`Patched: ${totalPatched} file(s)`);

if (errors.length > 0) {
  console.error(`\nERRORS (${errors.length}):`);
  errors.forEach(e => console.error(`  ✗ ${e}`));
  process.exit(1);
}

console.log(`All console branding patches applied successfully.\n`);

// --- Recompress all patched bundle files ---
recompressDir(assetsDir);

function recompressDir(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  const { execSync } = require('child_process');
  const files = fs.readdirSync(dir).filter(f =>
    f.startsWith('index-') && f.endsWith('.js') && !f.endsWith('.js.map')
  );
  for (const file of files) {
    const fullPath = path.join(dir, file);
    try {
      execSync(`gzip -9 -c "${fullPath}" > "${fullPath}.gz"`, { shell: true });
      console.log(`  [GZ] ${file}.gz regenerated`);
    } catch (e) {
      console.warn(`  [WARN] gzip failed for ${file}: ${e.message}`);
    }
    if (fs.existsSync(`${fullPath}.br`)) {
      try {
        execSync(`brotli -9 -c "${fullPath}" > "${fullPath}.br"`, { shell: true });
        console.log(`  [BR] ${file}.br regenerated`);
      } catch (e) {
        console.warn(`  [WARN] brotli failed for ${file}: ${e.message}`);
      }
    }
  }
}
