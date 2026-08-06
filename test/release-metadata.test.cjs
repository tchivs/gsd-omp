'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

test('release metadata and README install commands use the package version', () => {
  const packageJson = readJson('package.json');
  const packageLock = readJson('package-lock.json');
  const expectedInstall = `npm install --global https://github.com/tchivs/gsd-omp/archive/refs/tags/v${packageJson.version}.tar.gz`;

  assert.equal(packageLock.version, packageJson.version, 'package-lock.json version must match package.json');
  assert.equal(packageLock.packages[''].version, packageJson.version, 'lockfile root package version must match package.json');

  for (const readme of ['README.md', 'README.zh-CN.md']) {
    const installCommands = fs.readFileSync(path.join(root, readme), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.startsWith('npm install --global https://github.com/tchivs/gsd-omp/archive/refs/tags/v'));

    assert.deepEqual(
      installCommands,
      [expectedInstall, expectedInstall],
      `${readme} install and upgrade commands must both use v${packageJson.version}`,
    );
  }
});
