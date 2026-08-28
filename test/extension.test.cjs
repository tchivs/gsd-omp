'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const extension = require('../src/extension.cjs');

function schema() {
  return {
    default(value) {
      if (value !== null && typeof value === 'object') {
        throw new TypeError('Mutable schema defaults must use a factory');
      }
      return this;
    },
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
    assert.equal(pi.commands.size >= 40, true);
    assert.equal(pi.commands.has('omp-native'), true);
    assert.equal(pi.tools.has('gsd_invoke'), true);
    assert.equal(pi.tools.get('gsd_invoke').loadMode, 'discoverable');
    assert.equal(pi.events.has('session_start'), true);
    assert.equal(pi.events.has('tool_call'), true);
    assert.equal(pi.events.has('tool_result'), true);
    assert.equal(extension._internals.eos.profile, 'programmatic-cli');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

 test('points GSD_AGENTS_DIR at the OMP agents projection so the gsd-core agent check is not a false negative', () => {
  // gsd-core's checkAgentsInstalled('omp') resolves the agents dir from the
  // runtime home; 'omp' is not a registered runtime, so it falls back to
  // ~/.claude/agents and reports every GSD agent missing. The extension must
  // export GSD_AGENTS_DIR = <runtimeRoot>/agents so init.progress /
  // init.new-project see the projected agents (research/roadmap etc.).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-omp-agents-'));
  const prior = process.env.GSD_AGENTS_DIR;
  try {
    delete process.env.GSD_AGENTS_DIR;
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    assert.equal(
      process.env.GSD_AGENTS_DIR,
      path.join(root, 'agents'),
      'extension must export GSD_AGENTS_DIR pointing at its projected agents dir',
    );
  } finally {
    if (prior === undefined) delete process.env.GSD_AGENTS_DIR;
    else process.env.GSD_AGENTS_DIR = prior;
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

test('phase argument completion reads the active command context cwd', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-omp-completion-cwd-'));
  try {
    fs.mkdirSync(path.join(root, '.planning'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.planning', 'ROADMAP.md'),
      '- [ ] **Phase 7: Context-aware phase**\n',
    );
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const completions = pi.commands.get('gsd-discuss-phase').getArgumentCompletions('', { cwd: root });
    assert.deepEqual(completions?.map(({ value }) => value), ['07']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('gsd_invoke resolves promptly when its abort signal is already set', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-omp-abort-'));
  try {
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const controller = new AbortController();
    controller.abort();
    const result = await pi.tools.get('gsd_invoke').execute(
      'abort-call',
      { family: 'query', subcommand: 'help', args: [] },
      controller.signal,
      null,
      { cwd: root },
    );
    assert.equal(result.details.cancelled, true);
    assert.equal(result.content[0].text, 'GSD command cancelled.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('gsd slash command routes empty input to the GSD CLI help surface', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-omp-gsd-help-'));
  try {
    const sent = [];
    const pi = mockPi();
    pi.sendMessage = async (message) => { sent.push(message); };
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    await pi.commands.get('gsd').handler('', { cwd: root });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].details.ok, true);
    assert.match(sent[0].details.stdout, /Usage: gsd-tools/);
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


test('renders concise OMP-native progress instead of a raw task-count banner', async () => {
  const root = gsdProjectRoot();
  try {
    fs.writeFileSync(
      path.join(root, '.planning', 'STATE.md'),
      '---\nstatus: executing\nprogress:\n  total_plans: 4\n  completed_plans: 2\n---\nPhase: 2 of 3 (Build)\nStatus: executing\n',
    );
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const ctx = { cwd: root };
    await pi.events.get('tool_call')(taskSpawnCall('call_widget', ['Phase1Plan06Executor']), ctx);
    const plain = extension._internals.widgetLines(root).join('\n').replace(/\u001b\[[0-9;]*m/g, '');
    assert.match(plain, /GSD · OMP Native/);
    assert.match(plain, /OMP native execution active/);
    assert.match(plain, /Progress .*Plans 2\/4 complete/);
    assert.match(plain, /\/omp-native/);
    assert.doesNotMatch(plain, /native tasks running/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('omp-native reports native execution status and entry points', async () => {
  const root = gsdProjectRoot();
  try {
    const sent = [];
    const pi = mockPi();
    pi.sendMessage = async (message) => { sent.push(message); };
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    await pi.commands.get('omp-native').handler('', { cwd: root });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].customType, 'omp-native-status');
    assert.match(sent[0].content, /GSD · OMP Native/);
    assert.match(sent[0].content, /Dispatch: OMP native task/);
    assert.match(sent[0].content, /\/gsd-execute-phase/);
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

test('ignores malformed task requests without a call id', async () => {
  const root = gsdProjectRoot();
  try {
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    await pi.events.get('tool_call')({
      toolName: 'task',
      input: { tasks: [{ name: 'Phase1Plan07Executor', agent: 'gsd-executor', task: 'do work' }] },
    }, { cwd: root });
    assert.equal(extension._internals._nativeTaskActivityCount(root), 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('keeps queued native jobs active and tolerates non-array tool content', async () => {
  const root = gsdProjectRoot();
  try {
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const ctx = { cwd: root };
    await pi.events.get('tool_call')(taskSpawnCall('call_queue', ['Phase1Plan08Executor']), ctx);
    await pi.events.get('tool_result')({
      toolName: 'job',
      details: { jobs: [{ id: 'Phase1Plan08Executor', status: 'queued' }] },
      content: 'not-an-array',
    }, ctx);
    assert.equal(extension._internals._nativeTaskActivityCount(root), 1);
    await pi.events.get('tool_result')({
      toolName: 'job',
      details: { jobs: [{ id: 'Phase1Plan08Executor', status: 'completed' }] },
      content: [],
    }, ctx);
    assert.equal(extension._internals._nativeTaskActivityCount(root), 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('status reads the active workstream planning paths', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-omp-workstream-'));
  const workstreamPath = path.join(root, '.planning', 'workstreams', 'demo');
  const priorWorkstream = process.env.GSD_WORKSTREAM;
  try {
    fs.mkdirSync(workstreamPath, { recursive: true });
    fs.writeFileSync(path.join(workstreamPath, 'PROJECT.md'), '# Demo\n');
    fs.writeFileSync(path.join(workstreamPath, 'ROADMAP.md'), '- [ ] **Phase 2: Workstream phase**\n');
    fs.writeFileSync(
      path.join(workstreamPath, 'STATE.md'),
      '---\ncurrent_phase: 2\nstatus: executing\ntotal_plans: 1\ncompleted_plans: 0\n---\nStatus: executing\n',
    );
    fs.writeFileSync(path.join(workstreamPath, 'config.json'), '{}\n');
    process.env.GSD_WORKSTREAM = 'demo';
    const sent = [];
    const pi = mockPi();
    pi.sendMessage = async (message) => { sent.push(message); };
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    await pi.commands.get('gsd-status').handler('', { cwd: root });
    assert.match(sent[0].content, /Phase: 2/);
  } finally {
    if (priorWorkstream === undefined) delete process.env.GSD_WORKSTREAM;
    else process.env.GSD_WORKSTREAM = priorWorkstream;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('status summary reads nested progress and level-three risks', async () => {
  const root = gsdProjectRoot();
  try {
    fs.writeFileSync(
      path.join(root, '.planning', 'STATE.md'),
      [
        '---',
        'status: planning',
        'progress:',
        '  total_plans: 4',
        '  completed_plans: 2',
        '  percent: 50',
        '---',
        '',
        '# Project State',
        '',
        '## Current Position',
        '',
        'Phase: 2 of 3 (Build)',
        'Status: In progress',
        '',
        '### Blockers/Concerns',
        '',
        '- [blocker] API is unavailable',
        '- Waiting for a dependency',
        '',
        '## Deferred Items',
        '',
        'None.',
        '',
      ].join('\n'),
    );
    const sent = [];
    const pi = mockPi();
    pi.sendMessage = async (message) => { sent.push(message); };
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    await pi.commands.get('gsd-status').handler('', { cwd: root });
    assert.match(sent[0].content, /Plans: Plans 2 \/ 4 complete/);
    assert.match(sent[0].content, /1 blocker/);
    assert.match(sent[0].content, /1 concern/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clears a pending continuation after dispatch succeeds', async () => {
  const root = gsdProjectRoot();
  const actionPath = path.join(root, '.planning', '.omp-next-action.json');
  try {
    fs.writeFileSync(actionPath, JSON.stringify({ command: '/gsd-status', label: 'Show status' }));
    const sent = [];
    const pi = mockPi();
    pi.sendMessage = async (message) => { sent.push(message); };
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const ctx = {
      cwd: root,
      hasUI: true,
      ui: { select: async (_title, choices) => choices[0].label },
    };
    await pi.commands.get('gsd-next').handler('', ctx);
    assert.equal(sent[0].customType, 'gsd-native-continuation');
    assert.equal(fs.existsSync(actionPath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('uses localized copy for detected empty-state and invalid lifecycle input', async () => {
  const root = gsdProjectRoot();
  try {
    fs.writeFileSync(path.join(root, '.planning', 'config.json'), JSON.stringify({ response_language: 'Simplified Chinese' }));
    const sent = [];
    const pi = mockPi();
    pi.sendMessage = async (message) => { sent.push(message); };
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    await pi.commands.get('gsd-validate-phase').handler('--text', { cwd: root });
    await pi.commands.get('gsd-new-project').handler('--invalid', { cwd: root });
    assert.match(sent[0].content, /没有可用于 Nyquist 验证/);
    assert.match(sent[1].content, /^用法：/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('blocks phase writes through symlinked planning paths and empty LSP edits', async () => {
  const root = gsdProjectRoot();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-omp-guard-outside-'));
  try {
    fs.symlinkSync(outside, path.join(root, '.planning', 'linked'), 'dir');
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const ctx = { cwd: root };
    await pi.commands.get('gsd-execute-phase').handler('1', ctx);
    const symlinkResult = await pi.events.get('tool_call')({
      toolName: 'write',
      input: { path: '.planning/linked/STATE.md' },
    }, ctx);
    assert.equal(symlinkResult.block, true);
    const emptyLspResult = await pi.events.get('tool_call')({
      toolName: 'lsp',
      input: { action: 'code_actions', apply: true },
    }, ctx);
    assert.equal(emptyLspResult.block, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('keeps a duplicate task name active until every owner settles', async () => {
  const root = gsdProjectRoot();
  try {
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const ctx = { cwd: root };
    const task = 'Phase1Plan09Executor';
    await pi.events.get('tool_call')(taskSpawnCall('call_a', [task]), ctx);
    await pi.events.get('tool_call')(taskSpawnCall('call_b', [task]), ctx);
    assert.equal(extension._internals._nativeTaskActivityCount(root), 1);
    const result = (callId) => ({
      toolName: 'task', toolCallId: callId, isError: false, content: [],
      details: { results: [{ id: task, agent: 'gsd-executor', exitCode: 0, output: '' }] },
    });
    await pi.events.get('tool_result')(result('call_a'), ctx);
    assert.equal(extension._internals._nativeTaskActivityCount(root), 1);
    await pi.events.get('tool_result')(result('call_b'), ctx);
    assert.equal(extension._internals._nativeTaskActivityCount(root), 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('does not route stale task results from a non-project directory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-omp-stale-recovery-'));
  try {
    fs.mkdirSync(path.join(root, '.planning'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.planning', '.omp-task-results.json'),
      JSON.stringify([{ phase: '01', plan: '01-01', task: 'Phase1Plan01Executor', status: 'failed' }]),
    );
    const sent = [];
    const pi = mockPi();
    pi.sendMessage = async (message) => { sent.push(message); };
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    await pi.commands.get('gsd-next').handler('', { cwd: root });
    assert.equal(sent[0].customType, 'gsd-start-project');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ignores non-GSD entries in native task progress snapshots', async () => {
  const root = gsdProjectRoot();
  try {
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    await pi.events.get('tool_result')({
      toolName: 'task',
      details: { progress: [{ id: 'foreign-task', agent: 'worker', status: 'running' }] },
      content: [],
    }, { cwd: root });
    assert.equal(extension._internals._nativeTaskActivityCount(root), 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
