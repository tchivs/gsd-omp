'use strict';

// Bump gsd-omp's version across package.json, package-lock.json, install docs,
// README URLs, and the changelog compare link. Idempotent: running with the
// current version is a no-op.
//
// Usage: node scripts/bump-version.cjs <semver>

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const version = process.argv[2];

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`usage: node scripts/bump-version.cjs <semver> (got: ${version})`);
  process.exit(1);
}

const pkgPath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

if (pkg.version === version) {
  console.log(`already at ${version}`);
  process.exit(0);
}

const versionedInstallDocs = ['README.md', 'README.zh-CN.md', 'docs/GETTING-STARTED.md'];
for (const document of versionedInstallDocs) {
  const p = path.join(root, document);
  if (!/v\d+\.\d+\.\d+\.tar\.gz/.test(fs.readFileSync(p, 'utf8'))) {
    console.error(`no versioned install URL found in ${document}`);
    process.exit(1);
  }
}

pkg.version = version;
lock.version = version;
if (lock.packages && lock.packages['']) lock.packages[''].version = version;

fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

for (const document of versionedInstallDocs) {
  const p = path.join(root, document);
  const text = fs.readFileSync(p, 'utf8');
  fs.writeFileSync(p, text.replace(/v\d+\.\d+\.\d+\.tar\.gz/g, `v${version}.tar.gz`));
}

const changelogPath = path.join(root, 'CHANGELOG.md');
if (fs.existsSync(changelogPath)) {
  const text = fs.readFileSync(changelogPath, 'utf8');
  fs.writeFileSync(changelogPath, text.replace(
    /(\[Unreleased\]:\s+https:\/\/github\.com\/tchivs\/gsd-omp\/compare\/v)\d+\.\d+\.\d+(\.\.\.HEAD)/,
    `$1${version}$2`,
  ));
}

console.log(`bumped to ${version}`);
