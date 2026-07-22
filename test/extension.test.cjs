'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const extension = require('../src/extension.cjs');

function schema() {
  return {
    default() { return this; },
    optional() { return this; },
  };
}

function mockPi() {
  const commands = new Map();
  const tools = new Map();
  const events = new Map();
  return {
    commands,
    tools,
    events,
    zod: {
      object: schema,
      string: schema,
      boolean: schema,
      array: schema,
    },
    registerCommand(name, contract) { commands.set(name, contract); },
    registerTool(contract) { tools.set(contract.name, contract); },
    on(name, handler) { events.set(name, handler); },
    async sendMessage() {},
    getSessionName() { return ''; },
    async setSessionName() {},
  };
}

 test('registers commands, tool, and lifecycle hooks on the OMP ExtensionAPI', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-omp-extension-'));
  try {
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    assert.equal(pi.commands.has('gsd'), true);
    assert.equal(pi.commands.has('gsd-next'), true);
    assert.equal(pi.commands.has('gsd-plan-phase'), true);
    assert.equal(pi.commands.size > 25, true);
    assert.equal(pi.tools.has('gsd_invoke'), true);
    assert.equal(pi.events.has('session_start'), true);
    assert.equal(pi.events.has('tool_call'), true);
    assert.equal(pi.events.has('tool_result'), true);
    assert.equal(extension._internals.eos.profile, 'programmatic-cli');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('uses OMP-managed timers for gsd_invoke progress updates', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-omp-managed-timer-'));
  try {
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const timer = {};
    let scheduled;
    let cleared;
    let updates = 0;
    const ctx = {
      cwd: root,
      setInterval(callback, milliseconds) {
        scheduled = { callback, milliseconds };
        return timer;
      },
      clearTimer(handle) {
        cleared = handle;
      },
    };

    const result = await pi.tools.get('gsd_invoke').execute(
      'tool-call',
      { family: 'query', subcommand: 'help', args: [] },
      new AbortController().signal,
      () => { updates += 1; },
      ctx,
    );

    assert.equal(typeof scheduled.callback, 'function');
    assert.equal(scheduled.milliseconds, 250);
    assert.equal(cleared, timer);
    assert.equal(updates, 1);
    assert.equal(Array.isArray(result.content), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function gsdProjectRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-omp-task-track-'));
  fs.mkdirSync(path.join(root, '.planning'), { recursive: true });
  fs.writeFileSync(path.join(root, '.planning', 'STATE.md'), '# State\n');
  return root;
}

function taskSpawnCall(toolCallId, names) {
  return {
    toolName: 'task',
    toolCallId,
    input: {
      context: 'phase execution',
      tasks: names.map((name) => ({ name, agent: 'gsd-executor', task: 'do work' })),
    },
  };
}

test('detached GSD task releases its tracked id when the job settles (no stale count)', async () => {
  // Regression: trackGsdTaskRequest keys on task `name` (agent registry id) but
  // job-completion events key on `jobId` (AsyncJob.jobId != agentId). Without
  // bridging at the spawn ack, every detached task leaked a name entry and
  // /gsd-next was permanently blocked by a stale count.
  const root = gsdProjectRoot();
  try {
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const count = () => extension._internals._nativeTaskActivityCount(root);
    const toolCall = pi.events.get('tool_call');
    const toolResult = pi.events.get('tool_result');
    const ctx = { cwd: root };

    await toolCall(taskSpawnCall('call_1', ['Phase1Plan01Executor', 'Phase1Plan02Executor']), ctx);
    assert.equal(count(), 2, 'two names tracked at spawn');

    await toolResult({
      toolName: 'task', toolCallId: 'call_1', isError: false, content: [],
      details: {
        async: { state: 'running', jobId: 'job_1', type: 'task' },
        progress: [
          { id: 'Phase1Plan01Executor', agent: 'gsd-executor', status: 'running' },
          { id: 'Phase1Plan02Executor', agent: 'gsd-executor', status: 'running' },
        ],
      },
    }, ctx);
    assert.equal(count(), 1, 'spawn ack swaps two names -> one jobId');

    await toolResult({
      toolName: 'job', toolCallId: 'call_2', isError: false, content: [],
      details: { jobs: [{ id: 'job_1', type: 'task', status: 'completed', label: 'p1', durationMs: 1 }] },
    }, ctx);
    assert.equal(count(), 0, 'job completion releases the bridged jobId');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('synchronous GSD task releases on terminal tool_result', async () => {
  const root = gsdProjectRoot();
  try {
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const count = () => extension._internals._nativeTaskActivityCount(root);
    const ctx = { cwd: root };

    await pi.events.get('tool_call')(taskSpawnCall('call_s', ['Phase1Plan03Executor']), ctx);
    assert.equal(count(), 1, 'name tracked at spawn');

    await pi.events.get('tool_result')({
      toolName: 'task', toolCallId: 'call_s', isError: false, content: [],
      details: { results: [{ id: 'Phase1Plan03Executor', agent: 'gsd-executor', exitCode: 0, output: '' }] },
    }, ctx);
    assert.equal(count(), 0, 'sync completion clears the tracked name');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('failed GSD task request releases tracked names', async () => {
  const root = gsdProjectRoot();
  try {
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const count = () => extension._internals._nativeTaskActivityCount(root);
    const ctx = { cwd: root };

    await pi.events.get('tool_call')(taskSpawnCall('call_f', ['Phase1Plan04Executor']), ctx);
    assert.equal(count(), 1);

    await pi.events.get('tool_result')({
      toolName: 'task', toolCallId: 'call_f', isError: true, content: [],
    }, ctx);
    assert.equal(count(), 0, 'errored spawn releases the tracked name');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('gsd-next does not advance while a native GSD task is still running', async () => {
  // /gsd-next must check native task activity BEFORE dispatching a saved
  // continuation, mirroring chooseNextAction. Otherwise it spawns the next
  // phase on top of in-flight executor tasks.
  const root = gsdProjectRoot();
  fs.writeFileSync(
    path.join(root, '.planning', '.omp-next-action.json'),
    JSON.stringify({ command: 'gsd-plan-phase 2', label: 'Plan Phase 2' }),
  );
  try {
    const sent = [];
    const pi = mockPi();
    pi.sendMessage = async (message) => { sent.push(message); };
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const ctx = { cwd: root, hasUI: true, ui: {} };

    await pi.events.get('tool_call')(taskSpawnCall('call_run', ['Phase1Plan05Executor']), ctx);
    assert.equal(extension._internals._nativeTaskActivityCount(root), 1, 'task tracked');

    await pi.commands.get('gsd-next').handler({}, ctx);
    assert.equal(sent.length, 1, 'gsd-next emitted exactly one message');
    assert.equal(sent[0].customType, 'gsd-native-tasks-active',
      'gsd-next reports active tasks instead of dispatching the saved continuation');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
