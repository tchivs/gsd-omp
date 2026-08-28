#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Eos = require('../src/eos.cjs');
const { buildProjectedArtifacts } = require('../src/projection.cjs');
const packageJson = require('../package.json');
const { t } = require('../src/locale.cjs');

const MANIFEST_NAME = '.gsd-omp-manifest.json';
const GITHUB_REPO = 'tchivs/gsd-omp';
const RELEASE_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const RELEASE_PAGE = `https://github.com/${GITHUB_REPO}/releases/latest`;

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function normalizedReleaseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? '').trim());
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : null;
}

function manifestError(root, message) {
  const error = new Error(t('cli.error.invalidManifest', { path: manifestPath(root), message }));
  error.code = 'ERR_GSD_OMP_MANIFEST';
  return error;
}

function normalizedManifestPath(root, value) {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate || candidate.includes('\0') || path.isAbsolute(candidate)) return null;
  if (candidate.split(/[\\/]+/).includes('..')) return null;
  const resolved = path.resolve(root, candidate);
  const relative = path.relative(path.resolve(root), resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return relative;
}

function safeTarget(root, filePath, errorFactory) {
  const normalized = normalizedManifestPath(root, filePath);
  if (!normalized) throw errorFactory(String(filePath));
  let current = path.resolve(root);
  for (const segment of normalized.split(path.sep).slice(0, -1)) {
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw errorFactory(current);
    } catch (error) {
      if (error?.code === 'ENOENT') break;
      throw error;
    }
  }
  return path.join(root, normalized);
}

function safeArtifactTarget(root, filePath) {
  return safeTarget(root, filePath, (target) => new Error(t('cli.error.refusingOverwrite', { path: target })));
}

function validateManifest(root, manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || !Array.isArray(manifest.files)) {
    throw manifestError(root, 'files must be an array');
  }
  if (manifest.schemaVersion !== 1 || manifest.plugin !== packageJson.name) {
    throw manifestError(root, 'unsupported manifest schema or plugin');
  }
  const seen = new Set();
  const files = manifest.files.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw manifestError(root, 'each file entry must be an object');
    const filePath = normalizedManifestPath(root, entry.path);
    const hash = typeof entry.sha256 === 'string' ? entry.sha256.toLowerCase() : '';
    if (!filePath || filePath === MANIFEST_NAME || seen.has(filePath)) throw manifestError(root, `invalid or duplicate file path: ${String(entry.path)}`);
    if (!SHA256_PATTERN.test(hash)) throw manifestError(root, `invalid SHA-256 for ${filePath}`);
    seen.add(filePath);
    return { ...entry, path: filePath, sha256: hash };
  });
  return { ...manifest, files };
}

function manifestTarget(root, filePath) {
  return safeTarget(root, filePath, (target) => manifestError(root, `unsafe parent path: ${target}`));
}

function fileHash(target) {
  try {
    if (!fs.statSync(target).isFile()) throw new Error('not a regular file');
    return sha256(fs.readFileSync(target));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}


function parseArgs(argv) {
  const args = [...argv];
  let command = 'install';
  if (args[0] === '--help' || args[0] === '-h') {
    args.shift();
    command = '--help';
  } else if (args[0] && !args[0].startsWith('-')) {
    command = args.shift();
  }
  let root;
  let force = false;
  let json = false;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--force') force = true;
    else if (arg === '--json') json = true;
    else if (arg === '--root') {
      const value = args.shift();
      if (!value || value.startsWith('-')) throw new Error(t('cli.error.rootRequiresPath'));
      root = path.resolve(value);
    } else throw new Error(t('cli.error.unknownArgument', { arg }));
  }
  return { command, root, force, json };
}

function githubLatestRelease() {
  const script = `
const apiUrl = ${JSON.stringify(RELEASE_API)};
const latestPageUrl = ${JSON.stringify(RELEASE_PAGE)};
const headers = { 'User-Agent': 'gsd-omp', Accept: 'application/vnd.github+json' };
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (token) headers.Authorization = \`Bearer \${token}\`;

async function resolve() {
  const apiResponse = await fetch(apiUrl, { headers });
  if (apiResponse.ok) {
    const release = await apiResponse.json();
    if (release.tag_name) {
      process.stdout.write(JSON.stringify({ tag_name: release.tag_name, tarball_url: release.tarball_url }));
      return;
    }
  }

  const pageResponse = await fetch(latestPageUrl, {
    redirect: 'manual',
    headers: { 'User-Agent': 'gsd-omp' },
  });
  const location = pageResponse.headers.get('location') || '';
  const match = location.match(/\\/releases\\/tag\\/(v\\d+\\.\\d+\\.\\d+)$/);
  if (!match) throw new Error('latest release could not be resolved');
  process.stdout.write(JSON.stringify({ tag_name: match[1] }));
}

resolve().catch(() => process.exit(1));
`;
  const res = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    timeout: 15000,
  });
  if (res.status !== 0) throw new Error(t('cli.error.updateCheckFailed'));
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new Error(t('cli.error.updateCheckFailed'));
  }
}

function update({ root: rootOverride, force = false, latestRelease, json = false } = {}) {
  const provider = latestRelease === undefined ? githubLatestRelease : latestRelease;
  const release = typeof provider === 'function' ? provider() : null;
  const latest = normalizedReleaseVersion(release?.tag_name);
  if (!latest) throw new Error(t('cli.error.updateCheckFailed'));
  const comparison = compareVersions(latest, packageJson.version);
  if (comparison <= 0) {
    return { upToDate: comparison === 0, current: packageJson.version, latest, root: runtimeRoot(rootOverride) };
  }
  const tarball = release.tarball_url || `https://github.com/${GITHUB_REPO}/archive/refs/tags/v${latest}.tar.gz`;
  const npmArgs = ['install', '--global', tarball];
  const res = spawnSync('npm', npmArgs, { encoding: 'utf8', stdio: json ? ['ignore', 'ignore', 'inherit'] : 'inherit', timeout: 300000 });
  if (res.status !== 0) throw new Error(t('cli.error.updateFailed'));

  // The current process still contains the old package. Invoke the freshly
  // installed CLI so projection uses the new extension, agents, skills, and
  // bundled gsd-core rather than the old process's module graph.
  const prefix = globalPrefix();
  if (!prefix) throw new Error(t('cli.error.updateProjectionFailed'));
  const cli = process.platform === 'win32'
    ? path.join(prefix, 'gsd-omp.cmd')
    : path.join(prefix, 'bin', 'gsd-omp');
  const installArgs = ['install'];
  if (rootOverride) installArgs.push('--root', rootOverride);
  if (force) installArgs.push('--force');
  const projection = spawnSync(cli, installArgs, { encoding: 'utf8', stdio: json ? ['ignore', 'ignore', 'inherit'] : 'inherit', timeout: 120000 });
  if (projection.status !== 0) throw new Error(t('cli.error.updateProjectionFailed'));
  return { updated: true, from: packageJson.version, to: latest, root: runtimeRoot(rootOverride) };
}

function compareVersions(left, right) {
  const parse = (value) => String(value || '').match(/^(\\d+)\\.(\\d+)\\.(\\d+)/)?.slice(1).map(Number) || null;
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return 0;
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function globalPrefix() {
  const res = spawnSync('npm', ['prefix', '--global'], { encoding: 'utf8' });
  if (res.error || res.status !== 0) return undefined;
  return (res.stdout || '').trim() || undefined;
}

function runtimeRoot(override) {
  return override ? path.resolve(override) : path.resolve(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.omp', 'agent'));
}

function manifestPath(root) {
  return path.join(root, MANIFEST_NAME);
}

function readManifest(root) {
  const location = manifestPath(root);
  try {
    const stat = fs.lstatSync(location);
    if (!stat.isFile() || stat.isSymbolicLink()) throw manifestError(root, 'manifest must be a regular file');
    return validateManifest(root, JSON.parse(fs.readFileSync(location, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'ERR_GSD_OMP_MANIFEST') throw error;
    throw new Error(t('cli.error.cannotReadManifest', { path: location, message: error.message }));
  }
}

function pathExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function writeStagedFile(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'wx' });
}

function installTransaction(root, artifacts, staleFiles, manifestContent) {
  fs.mkdirSync(root, { recursive: true });
  const transactionRoot = fs.mkdtempSync(path.join(root, '.gsd-omp-install-'));
  const stagedRoot = path.join(transactionRoot, 'staged');
  const backupRoot = path.join(transactionRoot, 'backup');
  const records = [];
  const entries = [
    ...artifacts.map((artifact) => ({ relativePath: artifact.relativePath, content: artifact.content })),
    { relativePath: MANIFEST_NAME, content: manifestContent },
    ...staleFiles.map((file) => ({ relativePath: file.path, content: null })),
  ];
  try {
    for (const entry of entries) {
      if (entry.content !== null) writeStagedFile(path.join(stagedRoot, entry.relativePath), entry.content);
    }
    for (const entry of entries) {
      let target = safeArtifactTarget(root, entry.relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      target = safeArtifactTarget(root, entry.relativePath);
      const backup = path.join(backupRoot, entry.relativePath);
      const record = { target, backup, hadPrevious: false, installed: false };
      records.push(record);
      if (pathExists(target)) {
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.renameSync(target, backup);
        record.hadPrevious = true;
      }
      if (entry.content !== null) {
        fs.renameSync(path.join(stagedRoot, entry.relativePath), target);
        record.installed = true;
      }
    }
  } catch (error) {
    for (const record of records.reverse()) {
      try {
        if (record.installed && pathExists(record.target)) fs.unlinkSync(record.target);
      } catch { /* preserve the original transaction error */ }
      try {
        if (record.hadPrevious && pathExists(record.backup)) {
          fs.mkdirSync(path.dirname(record.target), { recursive: true });
          fs.renameSync(record.backup, record.target);
        }
      } catch { /* preserve the original transaction error */ }
    }
    throw error;
  } finally {
    fs.rmSync(transactionRoot, { recursive: true, force: true });
  }
}

function removeEmptyParents(start, stop) {
  let current = path.dirname(start);
  const boundary = path.resolve(stop);
  while (current.startsWith(`${boundary}${path.sep}`)) {
    try {
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

function assertSupportedCore(coreRoot) {
  const corePackage = JSON.parse(fs.readFileSync(path.join(coreRoot, 'package.json'), 'utf8'));
  const match = String(corePackage.version || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match || compareVersions(corePackage.version, '1.11.0') < 0) {
    throw new Error(t('cli.error.unsupportedCore', { version: corePackage.version || 'unknown' }));
  }
  return corePackage.version;
}

function extensionWrapper(root) {
  const extensionPath = path.join(__dirname, '..', 'src', 'extension.cjs');
  return `import { createRequire } from "node:module";\n\nconst require = createRequire(import.meta.url);\nconst extension = require(${JSON.stringify(extensionPath)});\n\nexport default (pi: unknown) => extension(pi, { runtime: "omp", runtimeRoot: ${JSON.stringify(root)} });\n`;
}

function desiredArtifacts(root, coreRoot) {
  return [
    {
      relativePath: path.join('extensions', 'gsd-omp.ts'),
      content: extensionWrapper(root),
    },
    ...buildProjectedArtifacts({ coreRoot, runtimeRoot: root }),
  ];
}

function install({ root: rootOverride, force = false } = {}) {
  const root = runtimeRoot(rootOverride);
  const eos = Eos.initialize();
  const coreVersion = assertSupportedCore(eos.coreRoot);
  const previous = readManifest(root);
  const artifacts = desiredArtifacts(root, eos.coreRoot);
  const artifactPaths = new Set(artifacts.map((artifact) => artifact.relativePath));
  const staleFiles = (previous?.files || []).filter((file) => !artifactPaths.has(file.path));
  const previousFiles = new Map((previous?.files || []).map((file) => [file.path, file.sha256]));
  const checkOwnership = (filePath, expectedHash) => {
    const target = safeArtifactTarget(root, filePath);
    if (!pathExists(target)) return;
    let currentHash;
    try {
      currentHash = fileHash(target);
    } catch {
      throw new Error(t('cli.error.refusingOverwrite', { path: target }));
    }
    if (!force && currentHash !== expectedHash) {
      throw new Error(t('cli.error.refusingOverwrite', { path: target }));
    }
  };
  for (const artifact of artifacts) checkOwnership(artifact.relativePath, previousFiles.get(artifact.relativePath));
  for (const file of staleFiles) checkOwnership(file.path, file.sha256);

  const files = artifacts.map((artifact) => ({ path: artifact.relativePath, sha256: sha256(artifact.content) }));
  const manifest = {
    schemaVersion: 1,
    plugin: packageJson.name,
    version: packageJson.version,
    enginesGsd: packageJson.engines.gsd,
    protocolVersion: eos.negotiation.protocolVersion,
    coreVersion,
    profile: eos.profile,
    installedAt: new Date().toISOString(),
    files,
  };
  installTransaction(root, artifacts, staleFiles, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of staleFiles) {
    try { removeEmptyParents(safeArtifactTarget(root, file.path), root); } catch { /* cleanup is best effort */ }
  }
  return { root, manifestPath: manifestPath(root), installed: files.length, coreVersion, protocolVersion: manifest.protocolVersion };
}

function uninstall({ root: rootOverride, force = false } = {}) {
  const root = runtimeRoot(rootOverride);
  const manifest = readManifest(root);
  if (!manifest) return { root, removed: 0, skipped: [], absent: true };
  const skipped = [];
  let removed = 0;
  for (const file of [...manifest.files].reverse()) {
    const target = manifestTarget(root, file.path);
    if (!pathExists(target)) continue;
    let currentHash;
    try {
      if (fs.statSync(target).isDirectory()) {
        skipped.push(file.path);
        continue;
      }
      currentHash = fileHash(target);
    } catch {
      skipped.push(file.path);
      continue;
    }
    if (!force && currentHash !== file.sha256) {
      skipped.push(file.path);
      continue;
    }
    fs.unlinkSync(target);
    removeEmptyParents(target, root);
    removed += 1;
  }
  if (!skipped.length) fs.unlinkSync(manifestPath(root));
  return { root, removed, skipped, absent: false };
}

function doctor({ root: rootOverride } = {}) {
  const root = runtimeRoot(rootOverride);
  const manifest = readManifest(root);
  const eos = Eos.initialize();
  const missing = [];
  const modified = [];
  for (const file of manifest?.files || []) {
    const target = manifestTarget(root, file.path);
    if (!pathExists(target)) missing.push(file.path);
    else {
      try {
        if (fileHash(target) !== file.sha256) modified.push(file.path);
      } catch {
        modified.push(file.path);
      }
    }
  }
  return {
    ok: Boolean(manifest) && missing.length === 0 && modified.length === 0 && eos.profile === 'programmatic-cli',
    root,
    installed: Boolean(manifest),
    version: manifest?.version || null,
    coreVersion: manifest?.coreVersion || null,
    protocolVersion: eos.negotiation.protocolVersion,
    profile: eos.profile,
    missing,
    modified,
  };
}

function descriptor() {
  const eos = Eos.initialize();
  return {
    id: 'gsd-omp',
    protocolVersion: eos.negotiation.protocolVersion,
    enginesGsd: packageJson.engines.gsd,
    profile: eos.profile,
    interfacePoints: ['command', 'dispatch', 'model', 'hooks', 'state', 'artifact'],
    axes: Eos.OMP_AXES,
  };
}

function print(value, json) {
  if (json || typeof value !== 'string') process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${value}\n`);
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  let result;
  if (options.command === 'install') result = install(options);
  else if (options.command === 'uninstall') result = uninstall(options);
  else if (options.command === 'doctor') result = doctor(options);
  else if (options.command === 'descriptor') result = descriptor();
  else if (options.command === 'update') result = update(options);
  else if (options.command === 'help' || options.command === '--help') {
    print(t('cli.usage'), false);
    return 0;
  } else throw new Error(t('cli.error.unknownCommand', { command: options.command }));
  print(result, options.json);
  const unhealthy = options.command === 'doctor' && !result.ok;
  const incompleteUninstall = options.command === 'uninstall' && result.skipped?.length > 0;
  return unhealthy || incompleteUninstall ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`gsd-omp: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { descriptor, doctor, install, main, parseArgs, runtimeRoot, uninstall, update, githubLatestRelease, globalPrefix };
