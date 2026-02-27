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

    // Replace inline SVG topbar logo component (J8) with NiceMatrix img tag
    const j8Start = content.indexOf('J8=t=>n.createElement("svg"');
    const rCIdx = content.indexOf('rC="__cDzoA__topbar"');
    if (j8Start !== -1 && rCIdx !== -1 && rCIdx > j8Start) {
      const newJ8 = `J8=t=>n.createElement("img",{src:"${NICEMATRIX_BANNER_SVG}",height:28,alt:"NiceMatrix",...t}),`;
      content = content.substring(0, j8Start) + newJ8 + content.substring(rCIdx);
      console.log(`  [OK] ${bundle}: topbar SVG logo replaced`);
    } else {
      // Check if already patched
      if (!content.includes('J8=t=>n.createElement("img"')) {
        errors.push(`NO_MATCH_J8: topbar logo component J8 not found in ${bundle}`);
      } else {
        console.log(`  [SKIP] ${bundle}: topbar logo already patched`);
      }
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
