'use strict';

// Bump gsd-omp's version across package.json, package-lock.json, and both
// README install URLs. Idempotent: running with the current version is a no-op.
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

const readmes = ['README.md', 'README.zh-CN.md'];
for (const readme of readmes) {
  const p = path.join(root, readme);
  if (!/v\d+\.\d+\.\d+\.tar\.gz/.test(fs.readFileSync(p, 'utf8'))) {
    console.error(`no versioned install URL found in ${readme}`);
    process.exit(1);
  }
}

pkg.version = version;
lock.version = version;
if (lock.packages && lock.packages['']) lock.packages[''].version = version;

fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

for (const readme of readmes) {
  const p = path.join(root, readme);
  const text = fs.readFileSync(p, 'utf8');
  fs.writeFileSync(p, text.replace(/v\d+\.\d+\.\d+\.tar\.gz/g, `v${version}.tar.gz`));
}

console.log(`bumped to ${version}`);
