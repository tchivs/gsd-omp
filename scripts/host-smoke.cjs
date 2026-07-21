'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-omp-host-smoke-'));
const ompBin = process.env.OMP_BIN || 'omp';
const gsdOmpBin = process.env.GSD_OMP_BIN;
const hostEnvironment = {
  ...process.env,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'not-a-real-key',
  PI_CODING_AGENT_DIR: runtimeRoot,
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: hostEnvironment,
    timeout: 120_000,
    ...options,
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result.stdout;
}

function runPlugin(args) {
  return gsdOmpBin
    ? run(gsdOmpBin, args)
    : run(process.execPath, [path.join(repositoryRoot, 'bin', 'gsd-omp.cjs'), ...args]);
}

function parseJson(output, label) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`${label} did not emit JSON: ${error.message}\n${output}`);
  }
}

function parseRpcFrames(output) {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => parseJson(line, 'OMP RPC'));
}

try {
  const install = parseJson(runPlugin(['install', '--root', runtimeRoot, '--json']), 'gsd-omp install');
  assert.equal(install.protocolVersion, 1);
  assert.equal(install.coreVersion, '1.7.0');
  assert.ok(install.installed > 50, `expected projected artifacts, received ${install.installed}`);

  const doctor = parseJson(runPlugin(['doctor', '--root', runtimeRoot, '--json']), 'gsd-omp doctor');
  assert.equal(doctor.ok, true);
  assert.equal(doctor.profile, 'programmatic-cli');
  assert.deepEqual(doctor.missing, []);
  assert.deepEqual(doctor.modified, []);

  const descriptor = parseJson(runPlugin(['descriptor', '--json']), 'gsd-omp descriptor');
  assert.equal(descriptor.protocolVersion, 1);
  assert.equal(descriptor.profile, 'programmatic-cli');
  assert.equal(descriptor.axes.transport, 'native-extension');
  assert.equal(descriptor.axes.runtime, 'bun');

  const modelCatalog = parseJson(run(ompBin, ['models', 'openai', '--json']), 'OMP model catalog');
  const model = modelCatalog.models?.find((candidate) => candidate.selector);
  assert.ok(model, 'OMP did not expose a selectable OpenAI model for the host smoke test');

  const rpcOutput = run(
    ompBin,
    [
      '--mode', 'rpc',
      '--no-session',
      '--model', model.selector,
      '--cwd', repositoryRoot,
    ],
    { input: '' },
  );
  const frames = parseRpcFrames(rpcOutput);
  assert.equal(frames.some((frame) => frame.type === 'extension_error'), false, 'OMP reported an extension error');
  assert.equal(frames.some((frame) => frame.type === 'ready'), true, 'OMP did not reach the ready state');

  const commandUpdate = frames.find((frame) => frame.type === 'available_commands_update');
  assert.ok(commandUpdate, 'OMP did not publish its available command surface');
  const extensionCommands = new Map(
    commandUpdate.commands
      .filter((command) => command.source === 'extension')
      .map((command) => [command.name, command]),
  );
  for (const command of ['gsd', 'gsd-next', 'gsd-plan-phase', 'gsd-status']) {
    assert.ok(extensionCommands.has(command), `OMP did not load extension command /${command}`);
  }

  const uninstall = parseJson(runPlugin(['uninstall', '--root', runtimeRoot, '--json']), 'gsd-omp uninstall');
  assert.equal(uninstall.removed, install.installed);
  assert.deepEqual(uninstall.skipped, []);

  process.stdout.write(
    `ok host-smoke: OMP ${process.env.OMP_VERSION || 'local'} loaded ${extensionCommands.size} GSD extension commands\n`,
  );
} finally {
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
}
