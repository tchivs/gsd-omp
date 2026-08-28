'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { doctor, install, uninstall, update, parseArgs } = require('../bin/gsd-omp.cjs');
// Pin locale to English so the ownership-error regex stays deterministic
// regardless of the dev shell's LANG.
require('../src/locale.cjs').setLocale('en');

function temporaryRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

 test('installs, verifies, and uninstalls owned OMP artifacts', () => {
  const root = temporaryRoot('gsd-omp-install');
  try {
    const result = install({ root });
    assert.equal(result.protocolVersion, 1);
    assert.equal(result.installed > 50, true);
    assert.equal(fs.existsSync(path.join(root, 'extensions', 'gsd-omp.ts')), true);
    assert.equal(fs.existsSync(path.join(root, 'agents', 'gsd-executor.md')), true);
    assert.equal(fs.existsSync(path.join(root, 'skills', 'gsd-plan-phase', 'SKILL.md')), true);
    const extensionContent = fs.readFileSync(path.join(root, 'extensions', 'gsd-omp.ts'), 'utf8');
    assert.equal(extensionContent.includes(JSON.stringify(root)), true);
    const projectedSkill = fs.readFileSync(path.join(root, 'skills', 'gsd-plan-phase', 'SKILL.md'), 'utf8');
    assert.equal(projectedSkill.includes(path.join(root, 'agents')), true);

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

 test('update reports up-to-date when the local version matches the latest GitHub release', () => {
  const packageJson = require('../package.json');
  const { update } = require('../bin/gsd-omp.cjs');
  // Inject a stub instead of hitting the live GitHub API.
  const result = update({
    root: temporaryRoot('gsd-omp-update'),
    latestRelease: () => ({ tag_name: `v${packageJson.version}`, tarball_url: 'https://api.github.com/repos/tchivs/gsd-omp/tarball/x' }),
  });
  assert.equal(result.upToDate, true);
  assert.equal(result.current, packageJson.version);
});

test('rejects a missing --root value instead of consuming another option', () => {
  assert.throws(() => parseArgs(['install', '--root', '--force']), /--root requires a path/);
});

test('rejects malformed release metadata before attempting an update', () => {
  assert.throws(
    () => update({ latestRelease: () => ({ tag_name: 'latest' }) }),
    /could not check for updates/,
  );
});

test('rejects unsafe manifest paths and invalid hashes', () => {
  const root = temporaryRoot('gsd-omp-invalid-manifest');
  try {
    fs.writeFileSync(
      path.join(root, '.gsd-omp-manifest.json'),
      JSON.stringify({ files: [{ path: '../outside', sha256: '0'.repeat(64) }] }),
    );
    assert.throws(() => doctor({ root }), /Invalid gsd-omp manifest/);
    assert.throws(() => uninstall({ root }), /Invalid gsd-omp manifest/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refuses to replace a managed artifact path occupied by a directory', () => {
  const root = temporaryRoot('gsd-omp-directory-artifact');
  try {
    fs.mkdirSync(path.join(root, 'extensions', 'gsd-omp.ts'), { recursive: true });
    assert.throws(() => install({ root }), /Refusing to overwrite unmanaged or modified file/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not follow a symlinked artifact parent during install or uninstall', () => {
  const root = temporaryRoot('gsd-omp-symlink-root');
  const outside = temporaryRoot('gsd-omp-symlink-outside');
  const outsideArtifact = path.join(outside, 'gsd-omp.ts');
  fs.writeFileSync(outsideArtifact, 'keep me\n');
  try {
    fs.symlinkSync(outside, path.join(root, 'extensions'), 'dir');
    assert.throws(() => install({ root, force: true }), /Refusing to overwrite unmanaged or modified file/);
    assert.equal(fs.readFileSync(outsideArtifact, 'utf8'), 'keep me\n');

    fs.rmSync(path.join(root, 'extensions'), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(root, 'extensions'), 'dir');
    fs.writeFileSync(
      path.join(root, '.gsd-omp-manifest.json'),
      JSON.stringify({ files: [{ path: 'extensions/owned', sha256: '0'.repeat(64) }] }),
    );
    assert.throws(() => uninstall({ root, force: true }), /Invalid gsd-omp manifest/);
    assert.equal(fs.existsSync(outsideArtifact), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('removes unchanged stale artifacts when refreshing a projection', () => {
  const root = temporaryRoot('gsd-omp-stale-artifact');
  const staleRelativePath = path.join('skills', 'obsolete', 'SKILL.md');
  const staleContent = 'obsolete projection\n';
  try {
    const installed = install({ root });
    const manifestPath = path.join(root, '.gsd-omp-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const staleTarget = path.join(root, staleRelativePath);
    fs.mkdirSync(path.dirname(staleTarget), { recursive: true });
    fs.writeFileSync(staleTarget, staleContent);
    manifest.files.push({ path: staleRelativePath, sha256: sha256(staleContent) });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const refreshed = install({ root });
    assert.equal(refreshed.installed, installed.installed);
    assert.equal(fs.existsSync(staleTarget), false);
    const nextManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(nextManifest.files.some((file) => file.path === staleRelativePath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preserves modified stale artifacts instead of dropping ownership', () => {
  const root = temporaryRoot('gsd-omp-modified-stale');
  const staleRelativePath = path.join('skills', 'obsolete', 'SKILL.md');
  const original = 'obsolete projection\n';
  try {
    install({ root });
    const manifestPath = path.join(root, '.gsd-omp-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const staleTarget = path.join(root, staleRelativePath);
    fs.mkdirSync(path.dirname(staleTarget), { recursive: true });
    fs.writeFileSync(staleTarget, original);
    manifest.files.push({ path: staleRelativePath, sha256: sha256(original) });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(staleTarget, 'local edit\n');

    assert.throws(() => install({ root }), /Refusing to overwrite unmanaged or modified file/);

    assert.equal(fs.readFileSync(staleTarget, 'utf8'), 'local edit\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('keeps the manifest when force cannot remove a directory placeholder', () => {
  const root = temporaryRoot('gsd-omp-directory-uninstall');
  const target = path.join(root, 'extensions', 'gsd-omp.ts');
  try {
    install({ root });
    fs.rmSync(target, { force: true });
    fs.mkdirSync(target);
    const result = uninstall({ root, force: true });
    assert.deepEqual(result.skipped, [path.join('extensions', 'gsd-omp.ts')]);
    assert.equal(fs.existsSync(path.join(root, '.gsd-omp-manifest.json')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
