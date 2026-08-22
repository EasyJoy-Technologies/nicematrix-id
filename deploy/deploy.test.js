'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const deploy = path.join(__dirname, 'deploy.sh');
const candidate = 'nicematrix-logto:release-abcdef1234567890-20260822-010203';

function fixture(stamp) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-id-deploy-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(root, 'stamp'), `${stamp}\n`);
  fs.writeFileSync(path.join(root, 'id.env'), 'TEST_ONLY=true\n');
  fs.writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return { root, bin };
}

function run(f, args, extra = {}) {
  return spawnSync(deploy, args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${f.bin}:${process.env.PATH}`,
      DEPLOY_TARGET_FILE: path.join(f.root, 'stamp'),
      ID_ENV_FILE: path.join(f.root, 'id.env'),
      ...extra,
    },
  });
}

test('staging preflight accepts a descriptive immutable candidate', () => {
  const f = fixture('staging-build-host');
  const result = run(f, ['--target', 'staging', '--candidate', candidate]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /preflight OK/);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('latest is rejected as a candidate because it is mutable', () => {
  const f = fixture('staging-build-host');
  const result = run(f, ['--target', 'staging', '--candidate', 'nicematrix-logto:latest']);
  assert.equal(result.status, 2);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('a target-matching rollback tag is accepted for guarded recovery', () => {
  const f = fixture('staging-build-host');
  const result = run(f, ['--target', 'staging',
    '--candidate', 'nicematrix-logto:rollback-staging-20260822-010203']);
  assert.equal(result.status, 0, result.stderr);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('production preflight fails closed without a fresh R2 receipt', () => {
  const f = fixture('prod-1-intl');
  const result = run(f, ['--target', 'prod-1', '--candidate', candidate], {
    LOGTO_BACKUP_RECEIPT: path.join(f.root, 'missing.ok'),
  });
  assert.equal(result.status, 4);
  assert.match(result.stderr, /backup receipt missing/);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('backup retention refuses values below two', () => {
  const f = fixture('staging-build-host');
  const result = run(f, ['--target', 'staging', '--candidate', candidate], {
    BACKUP_KEEP: '1',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /BACKUP_KEEP must be an integer >= 2/);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('production preflight rejects a touched but invalid backup receipt', () => {
  const f = fixture('prod-1-intl');
  const receipt = path.join(f.root, 'backup.ok');
  fs.writeFileSync(receipt, '{}\n');
  const result = run(f, ['--target', 'prod-1', '--candidate', candidate], {
    LOGTO_BACKUP_RECEIPT: receipt,
  });
  assert.equal(result.status, 4);
  assert.match(result.stderr, /invalid or stale Logto R2 receipt/);
  fs.rmSync(f.root, { recursive: true, force: true });
});
