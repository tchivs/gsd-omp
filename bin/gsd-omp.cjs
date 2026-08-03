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

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'install';
  let root;
  let force = false;
  let json = false;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--force') force = true;
    else if (arg === '--json') json = true;
    else if (arg === '--root') {
      if (!args.length) throw new Error(t('cli.error.rootRequiresPath'));
      root = path.resolve(args.shift());
    } else throw new Error(t('cli.error.unknownArgument', { arg }));
  }
  return { command, root, force, json };
}

function githubLatestRelease() {
  const res = spawnSync(
    process.execPath,
    ['-e', `fetch('${RELEASE_API}', { headers: { 'User-Agent': 'gsd-omp' } }).then(r => r.json()).then(j => process.stdout.write(JSON.stringify({ tag_name: j.tag_name, tarball_url: j.tarball_url }))).catch(() => process.exit(1))`],
    { encoding: 'utf8', timeout: 15000 },
  );
  if (res.status !== 0) throw new Error(t('cli.error.updateCheckFailed'));
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new Error(t('cli.error.updateCheckFailed'));
  }
}

function update({ root: rootOverride, force = false } = {}) {
  const release = githubLatestRelease();
  const latest = String(release.tag_name || '').replace(/^v/, '');
  if (latest && latest === packageJson.version) {
    return { upToDate: true, current: packageJson.version, root: runtimeRoot(rootOverride) };
  }
  const tarball = release.tarball_url || `https://github.com/${GITHUB_REPO}/archive/refs/tags/${release.tag_name || 'main'}.tar.gz`;
  const npmArgs = ['install', '--global', '--prefix', globalPrefix(), tarball];
  if (!process.env.GSD_OMP_UPDATE_SKIP_BIN) npmArgs.push('--no-save');
  const res = spawnSync('npm', npmArgs, { encoding: 'utf8', stdio: 'inherit', timeout: 300000 });
  if (res.status !== 0) throw new Error(t('cli.error.updateFailed'));
  const installed = install({ root: rootOverride, force });
  return {
    updated: true,
    from: packageJson.version,
    to: latest || 'latest',
    root: installed.root,
    manifestPath: installed.manifestPath,
    installed: installed.installed,
  };
}

function globalPrefix() {
  const res = spawnSync('npm', ['prefix', '--global'], { encoding: 'utf8' });
  return (res.stdout || '').trim() || undefined;
}

function runtimeRoot(override) {
  return override || path.resolve(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.omp', 'agent'));
}

function manifestPath(root) {
  return path.join(root, MANIFEST_NAME);
}

function readManifest(root) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(root), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(t('cli.error.cannotReadManifest', { path: manifestPath(root), message: error.message }));
  }
}

function atomicWrite(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, target);
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
  if (!match || Number(match[1]) < 1 || (Number(match[1]) === 1 && Number(match[2]) < 8)) {
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
  const previousFiles = new Map((previous?.files || []).map((file) => [file.path, file.sha256]));
  const artifacts = desiredArtifacts(root, eos.coreRoot);

  for (const artifact of artifacts) {
    const target = path.join(root, artifact.relativePath);
    if (!fs.existsSync(target)) continue;
    const currentHash = sha256(fs.readFileSync(target));
    const priorHash = previousFiles.get(artifact.relativePath);
    if (!force && currentHash !== priorHash) {
      throw new Error(t('cli.error.refusingOverwrite', { path: target }));
    }
  }

  const files = [];
  for (const artifact of artifacts) {
    const target = path.join(root, artifact.relativePath);
    atomicWrite(target, artifact.content);
    files.push({ path: artifact.relativePath, sha256: sha256(artifact.content) });
  }

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
  atomicWrite(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, manifestPath: manifestPath(root), installed: files.length, coreVersion, protocolVersion: manifest.protocolVersion };
}

function uninstall({ root: rootOverride, force = false } = {}) {
  const root = runtimeRoot(rootOverride);
  const manifest = readManifest(root);
  if (!manifest) return { root, removed: 0, skipped: [], absent: true };
  const skipped = [];
  let removed = 0;
  for (const file of [...manifest.files].reverse()) {
    const target = path.join(root, file.path);
    if (!fs.existsSync(target)) continue;
    const currentHash = sha256(fs.readFileSync(target));
    if (!force && currentHash !== file.sha256) {
      skipped.push(file.path);
      continue;
    }
    fs.unlinkSync(target);
    removeEmptyParents(target, root);
    removed += 1;
  }
  if (!skipped.length || force) fs.unlinkSync(manifestPath(root));
  return { root, removed, skipped, absent: false };
}

function doctor({ root: rootOverride } = {}) {
  const root = runtimeRoot(rootOverride);
  const manifest = readManifest(root);
  const eos = Eos.initialize();
  const missing = [];
  const modified = [];
  for (const file of manifest?.files || []) {
    const target = path.join(root, file.path);
    if (!fs.existsSync(target)) missing.push(file.path);
    else if (sha256(fs.readFileSync(target)) !== file.sha256) modified.push(file.path);
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
  return options.command === 'doctor' && !result.ok ? 1 : 0;
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
