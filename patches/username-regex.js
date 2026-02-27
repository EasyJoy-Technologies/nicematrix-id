#!/usr/bin/env node

/**
 * Patch: Allow dots (.) in Logto usernames
 *
 * Why: Logto hardcodes usernameRegEx as /^[A-Z_a-z]\w*$/ which only allows
 *      letters, digits, and underscores. We need dots for usernames like
 *      "xianglin.kong".
 *
 * What: Replace /^[A-Z_a-z]\w*$/ with /^[A-Z_a-z](?:[\w.]*\w)?$/
 *       - First char: letter or underscore
 *       - Middle: letters, digits, underscores, dots
 *       - Last char: letter, digit, or underscore (no trailing dot)
 *       - Single-char usernames still valid
 *
 * Target Logto version: 1.36.0
 * If this script fails after a Logto upgrade, update the file paths below.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { globSync } = require('fs').promises ? require('fs') : { globSync: null };

const BASE = '/etc/logto/packages';
const OLD_REGEX_STR = '/^[A-Z_a-z]\\w*$/';
const NEW_REGEX_STR = '/^[A-Z_a-z](?:[\\w.]*\\w)?$/';

// --- Explicit file list ---
// These are the ONLY files that should be patched.

const explicitFiles = [
  // Runtime source (imported by core at runtime)
  'toolkit/core-kit/lib/regex.js',
  // TypeScript source (consistency)
  'toolkit/core-kit/src/regex.ts',
];

// Bundle files have hashed names — find them by directory + glob pattern
const bundleDirs = [
  { dir: 'console/dist/assets',    glob: 'index-*.js', label: 'console' },
  { dir: 'experience/dist/assets', glob: 'index-*.js', label: 'experience' },
  { dir: 'account/dist/assets',    glob: 'index-*.js', label: 'account' },
  { dir: 'demo-app/dist/assets',   glob: 'index-*.js', label: 'demo-app' },
];

let totalPatched = 0;
let errors = [];

// Patch explicit files
for (const relPath of explicitFiles) {
  const fullPath = path.join(BASE, relPath);
  if (!fs.existsSync(fullPath)) {
    errors.push(`MISSING: ${fullPath}`);
    continue;
  }
  const result = patchFile(fullPath);
  if (result === false) {
    errors.push(`NO_MATCH: ${fullPath} — old regex not found (already patched or file changed)`);
  } else {
    totalPatched++;
  }
}

// Patch bundle files
for (const { dir, glob: pattern, label } of bundleDirs) {
  const dirPath = path.join(BASE, dir);
  if (!fs.existsSync(dirPath)) {
    errors.push(`MISSING_DIR: ${dirPath} (${label})`);
    continue;
  }

  // Manual glob: find files matching index-*.js
  const files = fs.readdirSync(dirPath).filter(f => {
    return f.startsWith('index-') && f.endsWith('.js') && !f.endsWith('.js.map');
  });

  if (files.length === 0) {
    errors.push(`NO_BUNDLE: No index-*.js in ${dirPath} (${label})`);
    continue;
  }

  let matched = false;
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    if (content.includes(OLD_REGEX_STR)) {
      const result = patchFile(fullPath);
      if (result !== false) {
        totalPatched++;
        matched = true;
      }
    }
  }

  if (!matched) {
    // Check if already patched
    const alreadyPatched = files.some(f =>
      fs.readFileSync(path.join(dirPath, f), 'utf8').includes(NEW_REGEX_STR)
    );
    if (alreadyPatched) {
      console.log(`  [SKIP] ${label}: already patched`);
    } else {
      errors.push(`NO_MATCH_BUNDLE: ${label} — old regex not found in any index-*.js`);
    }
  }
}

// Summary
console.log(`\n=== Username Regex Patch Summary ===`);
console.log(`Patched: ${totalPatched} file(s)`);

if (errors.length > 0) {
  console.error(`\nERRORS (${errors.length}):`);
  errors.forEach(e => console.error(`  ✗ ${e}`));
  console.error(`\nPatch FAILED. Logto version may have changed.`);
  console.error(`Review file paths and update this script.`);
  process.exit(1);
}

console.log(`All patches applied successfully.\n`);

// --- Helper ---
function patchFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const count = content.split(OLD_REGEX_STR).length - 1;

  if (count === 0) return false;

  if (count !== 1) {
    errors.push(`MULTI_MATCH: ${filePath} has ${count} occurrences (expected 1)`);
    return false;
  }

  content = content.replace(OLD_REGEX_STR, NEW_REGEX_STR);

  // Verify
  if (content.includes(OLD_REGEX_STR)) {
    errors.push(`VERIFY_FAIL: ${filePath} still contains old regex after replace`);
    return false;
  }
  if (!content.includes(NEW_REGEX_STR)) {
    errors.push(`VERIFY_FAIL: ${filePath} does not contain new regex after replace`);
    return false;
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`  [OK] ${filePath}`);
  return true;
}
