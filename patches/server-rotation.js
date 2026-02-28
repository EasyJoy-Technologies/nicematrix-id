#!/usr/bin/env node
/**
 * Patch: Disable refresh token rotation globally
 *
 * Logto OSS with ADMIN_ENDPOINT=ENDPOINT causes the admin-console (a public OIDC client)
 * to make 3 parallel refresh_token requests (api, me, organizations).
 * With rotation enabled, parallel requests conflict → 400 → token family revoked → forced logout.
 *
 * Fix: set rotateRefreshToken to always return false in the OIDC provider config.
 *
 * Target: packages/core/build/main-*.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BUILD_DIR = '/etc/logto/packages/core/build';

if (!fs.existsSync(BUILD_DIR)) {
  console.error('ERROR: core build dir not found');
  process.exit(1);
}

const files = fs.readdirSync(BUILD_DIR).filter(f => f.startsWith('main-') && f.endsWith('.js') && !f.endsWith('.map'));
let patched = 0;

for (const file of files) {
  const fp = path.join(BUILD_DIR, file);
  let c = fs.readFileSync(fp, 'utf8');

  const OLD = `    rotateRefreshToken: (ctx) => {
      const { Client: client } = ctx.oidc.entities;
      if (!(client?.metadata().rotateRefreshToken ?? customClientMetadataDefault.rotateRefreshToken)) {
        return false;
      }
      return defaults_default.rotateRefreshToken(ctx);
    },`;

  const NEW = `    rotateRefreshToken: (ctx) => {
      return false;
    },`;

  if (c.includes('return false;\n    },\n    pkce:')) {
    console.log('  [SKIP] ' + file + ': rotation already disabled');
    continue;
  }

  if (!c.includes(OLD)) {
    console.error('  ERROR: rotation pattern not found in ' + file);
    process.exit(1);
  }

  c = c.replace(OLD, NEW);
  fs.writeFileSync(fp, c, 'utf8');
  console.log('  [OK] ' + file + ': rotateRefreshToken → always false');
  patched++;
}

console.log('Patched: ' + patched + ' server file(s)');
