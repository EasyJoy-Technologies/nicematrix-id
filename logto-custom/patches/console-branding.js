#!/usr/bin/env node
/**
 * Patch: Replace Logto branding with NiceMatrix branding (visual only)
 * No auth/token logic changes.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const CONSOLE_DIST = '/etc/logto/packages/console/dist';
const ICON_URL   = 'https://m.nicematrix.com/branding/nicematrix-logo-1024.svg';
const TOPBAR_URL = 'https://m.nicematrix.com/branding/NiceMatrix-170x64.svg';
let patched = 0, errors = [];

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

// 2. JS bundle - logos only
const assetsDir = path.join(CONSOLE_DIST, 'assets');
if (!fs.existsSync(assetsDir)) { errors.push('MISSING_DIR: ' + assetsDir); process.exit(1); }
const bundles = fs.readdirSync(assetsDir).filter(f => f.startsWith('index-') && f.endsWith('.js') && !f.endsWith('.js.map'));

for (const bundle of bundles) {
  const fp = path.join(assetsDir, bundle);
  let c = fs.readFileSync(fp, 'utf8');
  let changed = false;

  // J8 topbar logo (SVG → img)
  if (!c.includes('J8=t=>n.createElement("svg",{width:90')) { /* skip */ }
  else if (c.includes('J8=t=>n.createElement("img"')) { console.log('  [SKIP] J8 done'); }
  else {
    const s = c.indexOf('J8=t=>n.createElement("svg",{width:90');
    const e = c.indexOf(',rC="__cDzoA__topbar"', s);
    if (s > -1 && e > -1 && e - s < 25000) {
      c = c.slice(0,s) + 'J8=t=>n.createElement("img",{src:"'+TOPBAR_URL+'",height:32,style:{height:"32px",width:"auto"},alt:"NiceMatrix",...t})' + c.slice(e);
      console.log('  [OK] J8 topbar logo'); changed = true;
    }
  }

  // i9 loading logo (SVG → img)
  if (!c.includes('i9=t=>n.createElement("svg",{width:154')) { /* skip */ }
  else if (c.includes('i9=t=>n.createElement("img"')) { console.log('  [SKIP] i9 done'); }
  else {
    const s = c.indexOf('i9=t=>n.createElement("svg",{width:154');
    const e = c.indexOf(',Ul="__FiTPO__container"', s);
    if (s > -1 && e > -1 && e - s < 25000) {
      c = c.slice(0,s) + 'i9=t=>n.createElement("img",{src:"'+TOPBAR_URL+'",height:32,style:{height:"32px",width:"auto"},alt:"NiceMatrix",...t})' + c.slice(e);
      console.log('  [OK] i9 loading logo'); changed = true;
    }
  }

  // logto.io URLs
  if (c.includes('https://logto.io/logo.svg')) {
    c = c.replace(/https:\/\/logto\.io\/logo\.svg/g, TOPBAR_URL)
         .replace(/https:\/\/logto\.io\/logo-dark\.svg/g, TOPBAR_URL);
    console.log('  [OK] logto.io URLs'); changed = true;
  }

  if (changed) { fs.writeFileSync(fp, c, 'utf8'); patched++; }
}

console.log('\n=== Summary: patched ' + patched + ' file(s) ===');
if (errors.length) { errors.forEach(e => console.error('ERROR:', e)); process.exit(1); }

// Recompress
const { execSync } = require('child_process');
for (const f of fs.readdirSync(assetsDir).filter(f => f.endsWith('.js') && !f.endsWith('.map'))) {
  const fp = path.join(assetsDir, f);
  try { execSync('gzip -9 -c "'+fp+'" > "'+fp+'.gz"'); } catch(e){}
  if (fs.existsSync(fp+'.br')) try { execSync('brotli -9 -c "'+fp+'" > "'+fp+'.br"'); } catch(e){}
}
console.log('Recompressed.');
