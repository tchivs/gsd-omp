'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { doctor, install, uninstall } = require('../bin/gsd-omp.cjs');

function temporaryRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

 test('installs, verifies, and uninstalls owned OMP artifacts', () => {
  const root = temporaryRoot('gsd-omp-install');
  try {
    const result = install({ root });
    assert.equal(result.protocolVersion >= 1, true);
    assert.equal(result.installed > 50, true);
    assert.equal(fs.existsSync(path.join(root, 'extensions', 'gsd-omp.ts')), true);
    assert.equal(fs.existsSync(path.join(root, 'agents', 'gsd-executor.md')), true);
    assert.equal(fs.existsSync(path.join(root, 'skills', 'gsd-plan-phase', 'SKILL.md')), true);

    const health = doctor({ root });
    assert.equal(health.ok, true);
    assert.equal(health.profile, 'programmatic-cli');
    assert.deepEqual(health.missing, []);
    assert.deepEqual(health.modified, []);

    const removed = uninstall({ root });
    assert.equal(removed.removed, result.installed);
    assert.deepEqual(removed.skipped, []);
    assert.equal(fs.existsSync(path.join(root, '.gsd-omp-manifest.json')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

 test('refuses to overwrite or remove a modified managed file', () => {
  const root = temporaryRoot('gsd-omp-ownership');
  try {
    install({ root });
    const target = path.join(root, 'agents', 'gsd-executor.md');
    fs.appendFileSync(target, '\nlocal edit\n');
    assert.throws(() => install({ root }), /Refusing to overwrite unmanaged or modified file/);
    const result = uninstall({ root });
    assert.deepEqual(result.skipped, [path.join('agents', 'gsd-executor.md')]);
    assert.equal(fs.existsSync(target), true);
    assert.equal(fs.existsSync(path.join(root, '.gsd-omp-manifest.json')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
