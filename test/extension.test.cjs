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
  const renderers = new Map();
  const shortcuts = new Map();
  const flags = new Map();
  class MockText {
    constructor(text, x, y) {
      this.text = text;
      this.x = x;
      this.y = y;
    }
  }
  class MockContainer {
    constructor() { this.children = []; }
    addChild(child) { this.children.push(child); }
    invalidate() {}
  }
  return {
    commands,
    tools,
    events,
    renderers,
    shortcuts,
    flags,
    pi: { Text: MockText, Container: MockContainer },
    zod: {
      object: schema,
      string: schema,
      boolean: schema,
      array: schema,
    },
    registerCommand(name, contract) { commands.set(name, contract); },
    registerTool(contract) { tools.set(contract.name, contract); },
    registerMessageRenderer(name, renderer) { renderers.set(name, renderer); },
    registerShortcut(name, contract) { shortcuts.set(name, contract); },
    registerFlag(name, contract) { flags.set(name, contract.default); },
    getFlag(name) { return flags.get(name); },
    on(name, handler) { events.set(name, handler); },
    async sendMessage() {},
    getSessionName() { return ''; },
    async setSessionName() {},
  };
}

test('registers native message renderers and updates the OMP status surface', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-omp-renderer-'));
  try {
    fs.mkdirSync(path.join(root, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(root, '.planning', 'STATE.md'), '# State\\n');
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    assert.equal(pi.renderers.has('gsd-status-summary'), true);
    const rendered = pi.renderers.get('gsd-status-summary')(
      { customType: 'gsd-status-summary', content: 'GSD Project Status' },
      { expanded: false },
      { fg: (tone, text) => `<${tone}>${text}`, bold: (text) => `**${text}**` },
    );
    assert.equal(rendered.text, '**<accent>GSD · Status Summary**\nGSD Project Status');

    const statuses = [];
    const workingMessages = [];
    const ctx = {
      cwd: root,
      hasUI: true,
      ui: {
        setWidget() {},
        setStatus(key, text) { statuses.push([key, text]); },
        setWorkingMessage(text) { workingMessages.push(text); },
        theme: { fg: (_tone, text) => text },
      },
    };
    await pi.events.get('session_start')({}, ctx);
    assert.equal(statuses.at(-1)[0], 'gsd');
    assert.match(statuses.at(-1)[1], /STATE ERROR/);
    assert.equal(workingMessages.at(-1), undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('uses askDialog for native continuation choices when select is absent', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-omp-ask-dialog-'));
  try {
    fs.mkdirSync(path.join(root, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(root, '.planning', 'STATE.md'), '# State\\n');
    fs.writeFileSync(path.join(root, '.planning', '.omp-next-action.json'), JSON.stringify({ command: '/gsd-status', label: 'Show status' }));
    const questions = [];
    const sent = [];
    const pi = mockPi();
    pi.sendMessage = async (message) => { sent.push(message); };
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const ctx = {
      cwd: root,
      hasUI: true,
      ui: {
        askDialog: async (received) => {
          questions.push(received);
          return { kind: 'submit', results: [{ id: 'choice', question: received[0].question, options: [], multi: false, selectedOptions: [received[0].options[0].label] }] };
        },
      },
    };
    await pi.commands.get('gsd-next').handler('', ctx);
    assert.equal(questions.length, 1);
    assert.equal(questions[0][0].id, 'choice');
    assert.equal(sent[0].customType, 'gsd-native-continuation');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('exposes the projected GSD skill root through resources_discover', () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-omp-resources-'));
  try {
    const skillsRoot = path.join(runtimeRoot, 'skills');
    fs.mkdirSync(skillsRoot);
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot });
    const result = pi.events.get('resources_discover')({ type: 'resources_discover', cwd: runtimeRoot, reason: 'startup' }, { cwd: runtimeRoot });
    assert.deepEqual(result, { skillPaths: [skillsRoot] });
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('shows context and async-job state and delegates confirmed abort to OMP', async () => {
  const root = gsdProjectRoot();
  try {
    const sent = [];
    const statuses = [];
    const workingMessages = [];
    let aborts = 0;
    let compactions = 0;
    const pi = mockPi();
    pi.sendMessage = async (message) => { sent.push(message); };
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const ctx = {
      cwd: root,
      hasUI: true,
      getContextUsage: () => ({ tokens: 920, contextWindow: 1000, percent: 92 }),
      getAsyncJobSnapshot: () => ({ running: [{ id: 'job_1', type: 'task', status: 'running', label: 'Plan', startTime: Date.now() }], recent: [], delivery: {} }),
      isIdle: () => false,
      compact: async () => { compactions += 1; },
      abort: () => { aborts += 1; },
      ui: {
        setWidget() {},
        setStatus(key, text) { statuses.push([key, text]); },
        setWorkingMessage(text) { workingMessages.push(text); },
        confirm: async () => true,
        theme: { fg: (_tone, text) => text },
      },
    };

    await pi.events.get('auto_compaction_start')({ type: 'auto_compaction_start', reason: 'threshold', action: 'context-full' }, ctx);
    assert.match(statuses.at(-1)[1], /compacting/);
    assert.equal(workingMessages.at(-1), 'GSD: compacting context');

    await pi.commands.get('gsd-status').handler('', ctx);
    assert.match(sent[0].content, /Context: 920\/1000 \(near limit\)/);
    assert.match(sent[0].content, /OMP tasks: 1 async task running/);
    await pi.commands.get('gsd-status').handler('--compact', ctx);
    assert.equal(compactions, 1);
    assert.equal(sent.at(-1).customType, 'gsd-native-compact');
    assert.match(sent.at(-1).content, /compaction completed/);

    await pi.commands.get('gsd-status').handler('--stop', ctx);
    assert.equal(aborts, 1);
    assert.equal(sent.at(-1).customType, 'gsd-native-abort');
    assert.match(sent.at(-1).content, /was asked to stop/);

    await pi.events.get('auto_compaction_end')({ type: 'auto_compaction_end', action: 'context-full', aborted: false, willRetry: false }, ctx);
    assert.equal(workingMessages.at(-1), undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tracks OMP Goal Mode events in the GSD status surface', async () => {
  const root = gsdProjectRoot();
  try {
    const statuses = [];
    const widgets = [];
    const sent = [];
    const pi = mockPi();
    pi.sendMessage = async (message) => { sent.push(message); };
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const ctx = {
      cwd: root,
      hasUI: true,
      ui: {
        setWidget(_key, lines) { widgets.push(lines); },
        setStatus(key, text) { statuses.push([key, text]); },
        setWorkingMessage() {},
        theme: { fg: (_tone, text) => text },
      },
    };
    const goal = {
      id: 'goal_1',
      objective: 'Ship the native integration',
      status: 'active',
      tokensUsed: 1234,
      tokenBudget: 5000,
      timeUsedSeconds: 7,
      createdAt: 1,
      updatedAt: 2,
    };
    await pi.events.get('goal_updated')({ type: 'goal_updated', goal, state: { enabled: true, mode: 'active', goal } }, ctx);
    assert.match(statuses.at(-1)[1], /GOAL active 1,234\/5,000/);
    const plain = widgets.at(-1).join('\n').replace(/\u001b\[[0-9;]*m/g, '');
    assert.match(plain, /GOAL\s+active/);
    assert.match(plain, /Ship the nati/);
    assert.match(plain, /1,234\/5,000/);
    assert.match(plain, /\/goal pause/);

    await pi.commands.get('gsd-status').handler('', ctx);
    assert.match(sent.at(-1).content, /OMP Goal: active · Ship the native integration/);
    assert.match(sent.at(-1).content, /Goal budget: 1,234\/5,000, 3,766 remaining/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restores Goal Mode from the OMP session journal when no getter exists', async () => {
  const root = gsdProjectRoot();
  try {
    const statuses = [];
    const widgets = [];
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const goal = {
      id: 'goal_2',
      objective: 'Keep the GSD project moving',
      status: 'paused',
      tokensUsed: 80,
      tokenBudget: 100,
      timeUsedSeconds: 2,
      createdAt: 1,
      updatedAt: 2,
    };
    const ctx = {
      cwd: root,
      hasUI: true,
      sessionManager: {
        getEntries: () => [
          { type: 'mode_change', mode: 'none' },
          { type: 'mode_change', mode: 'goal_paused', data: { goal } },
        ],
      },
      ui: {
        setWidget(_key, lines) { widgets.push(lines); },
        setStatus(key, text) { statuses.push([key, text]); },
        setWorkingMessage() {},
        theme: { fg: (_tone, text) => text },
      },
    };
    await pi.events.get('session_start')({}, ctx);
    assert.match(statuses.at(-1)[1], /GOAL paused 80\/100/);
    const plain = widgets.at(-1).join('\n').replace(/\u001b\[[0-9;]*m/g, '');
    assert.match(plain, /GOAL\s+paused/);
    assert.match(plain, /Keep the GSD/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('holds GSD continuation while an OMP Goal Mode objective is active', async () => {
  const root = gsdProjectRoot();
  try {
    const actionPath = path.join(root, '.planning', '.omp-next-action.json');
    fs.writeFileSync(actionPath, JSON.stringify({ command: '/gsd-plan-phase 2', label: 'Plan Phase 2' }));
    const sent = [];
    let selected = 0;
    const pi = mockPi();
    pi.sendMessage = async (message) => { sent.push(message); };
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const goal = {
      id: 'goal_3',
      objective: 'Run the overarching objective',
      status: 'active',
      tokensUsed: 1,
      tokenBudget: 20,
      timeUsedSeconds: 0,
      createdAt: 1,
      updatedAt: 2,
    };
    const ctx = {
      cwd: root,
      hasUI: true,
      ui: { select: async () => { selected += 1; return 'Plan Phase 2'; } },
    };
    await pi.events.get('goal_updated')({ type: 'goal_updated', goal, state: { enabled: true, mode: 'active', goal } }, ctx);
    await pi.commands.get('gsd-next').handler('', ctx);
    assert.equal(selected, 0, 'Goal Mode must suppress the GSD continuation selector');
    assert.equal(sent.at(-1).customType, 'gsd-goal-mode-active');
    assert.match(sent.at(-1).content, /\/goal pause/);
    assert.equal(fs.existsSync(actionPath), true, 'the pending GSD action remains available');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reports an active Goal Mode instead of claiming idle when stopping GSD', async () => {
  const root = gsdProjectRoot();
  try {
    const sent = [];
    let aborts = 0;
    const pi = mockPi();
    pi.sendMessage = async (message) => { sent.push(message); };
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const goal = {
      id: 'goal_4',
      objective: 'Keep the agent focused',
      status: 'active',
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 1,
      updatedAt: 2,
    };
    const ctx = {
      cwd: root,
      hasUI: true,
      isIdle: () => true,
      abort: () => { aborts += 1; },
      ui: {},
    };
    await pi.events.get('goal_updated')({ type: 'goal_updated', goal, state: { enabled: true, mode: 'active', goal } }, ctx);
    await pi.commands.get('gsd-status').handler('--stop', ctx);
    assert.equal(aborts, 0);
    assert.equal(sent.at(-1).customType, 'gsd-goal-mode-active');
    assert.match(sent.at(-1).content, /No GSD turn is currently running/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('keeps the extension loadable when a host rejects goal_updated registration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-omp-goal-legacy-'));
  try {
    const pi = mockPi();
    const registerEvent = pi.on;
    pi.on = (name, handler) => {
      if (name === 'goal_updated') throw new Error('legacy host has no Goal Mode event');
      return registerEvent(name, handler);
    };
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    assert.equal(pi.events.has('session_start'), true);
    assert.equal(pi.events.has('tool_call'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('routes native session controls through the existing GSD status command', async () => {
  const root = gsdProjectRoot();
  try {
    const sent = [];
    const actions = [];
    const pi = mockPi();
    pi.sendMessage = async (message) => { sent.push(message); };
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const ctx = {
      cwd: root,
      hasUI: true,
      waitForIdle: async () => { actions.push('idle'); },
      branch: async (entryId) => { actions.push(['branch', entryId]); return { cancelled: false }; },
      navigateTree: async (entryId, options) => { actions.push(['tree', entryId, options.summarize]); return { cancelled: false }; },
      switchSession: async (sessionPath) => { actions.push(['switch', sessionPath]); return { cancelled: false }; },
      reload: async () => { actions.push('reload'); },
      ui: { confirm: async () => true },
    };
    await pi.commands.get('gsd-status').handler('--branch entry_1', ctx);
    await pi.commands.get('gsd-status').handler('--tree entry_2 --summarize', ctx);
    await pi.commands.get('gsd-status').handler('--switch /tmp/omp-session.json', ctx);
    await pi.commands.get('gsd-status').handler('--reload', ctx);
    assert.deepEqual(actions, [
      'idle', ['branch', 'entry_1'],
      'idle', ['tree', 'entry_2', true],
      'idle', ['switch', '/tmp/omp-session.json'],
      'idle', 'reload',
    ]);
    assert.equal(sent.length, 4);
    assert.equal(sent.every((message) => message.customType === 'gsd-native-session'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('opens the native status overlay and can edit the pending action', async () => {
  const root = gsdProjectRoot();
  try {
    fs.writeFileSync(path.join(root, '.planning', '.omp-next-action.json'), JSON.stringify({ command: '/gsd-status', label: 'Show status' }));
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    assert.equal(pi.shortcuts.has('ctrl+shift+g'), true);
    assert.equal(pi.flags.has('gsd-status'), true);
    let overlays = 0;
    let editorCalls = 0;
    let editorText = null;
    const ctx = {
      cwd: root,
      hasUI: true,
      ui: {
        custom: async (factory) => {
          overlays += 1;
          let result;
          const component = factory({ requestRender() {} }, { fg: (_tone, text) => text, bold: (text) => text }, {}, (value) => { result = value; });
          component.handleInput('e');
          return result;
        },
        editor: async () => {
          editorCalls += 1;
          return '/gsd-status';
        },
        setEditorText(value) { editorText = value; },
        notify() {},
      },
    };
    await pi.shortcuts.get('ctrl+shift+g').handler(ctx);
    assert.equal(overlays, 1);
    assert.equal(editorCalls, 1);
    assert.equal(editorText, '/gsd-status');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('specializes projected skills with native validation, completions, and session setup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-omp-projected-'));
  try {
    const sent = [];
    for (const name of ['gsd-config', 'gsd-review', 'gsd-explore']) {
      const dir = path.join(root, 'skills', name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n`);
    }
    const pi = mockPi();
    pi.sendMessage = async (message) => { sent.push(message); };
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const configCommand = pi.commands.get('gsd-config');
    assert.deepEqual(configCommand.getArgumentCompletions('--a').map(({ value }) => value), ['--advanced']);
    await pi.commands.get('gsd-review').handler('--invalid', { cwd: root });
    assert.equal(sent[0].customType, 'gsd-projected-skill-input-error');
    await pi.commands.get('gsd-explore').handler('status widget', { cwd: root });
    assert.equal(sent[1].customType, 'gsd-native-skill-command');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

 test('registers commands, tool, and lifecycle hooks on the OMP ExtensionAPI', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-omp-extension-'));
  try {
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    assert.equal(pi.commands.has('gsd'), true);
    assert.equal(pi.commands.has('gsd-next'), true);
    assert.equal(pi.commands.has('gsd-plan-phase'), true);
    assert.equal(pi.commands.size >= 39, true);
    assert.equal(pi.commands.has('omp-native'), false);
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

test('does not count ordinary OMP task lifecycle as GSD activity', async () => {
  const root = gsdProjectRoot();
  try {
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const ctx = { cwd: root, hasUI: false };
    const event = {
      type: 'tool_execution_start',
      toolName: 'task',
      toolCallId: 'ordinary_task',
      args: { task: 'inspect a fixture', agent: 'scout', name: 'ordinary-task' },
    };
    await pi.events.get('tool_execution_start')(event, ctx);
    await pi.events.get('tool_execution_update')({
      ...event,
      type: 'tool_execution_update',
      partialResult: { details: { progress: [{ id: 'ordinary-task', agent: 'scout', status: 'running' }] } },
    }, ctx);
    assert.equal(extension._internals._nativeTaskActivityCount(root), 0);
    assert.deepEqual(extension._internals._nativeTaskExecutionSnapshot(root), { activeCalls: 0, trackedTasks: 0, updatingTasks: 0 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tracks native task execution lifecycle and keeps legacy tracking idempotent', async () => {
  const root = gsdProjectRoot();
  try {
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const ctx = { cwd: root };
    const args = {
      context: 'phase execution',
      tasks: [{ name: 'Phase1Plan10Executor', agent: 'gsd-executor', task: 'do work' }],
    };
    await pi.events.get('tool_call')(taskSpawnCall('call_lifecycle', ['Phase1Plan10Executor']), ctx);
    await pi.events.get('tool_execution_start')({
      type: 'tool_execution_start',
      toolName: 'task',
      toolCallId: 'call_lifecycle',
      args,
      intent: 'Execute the next plan',
    }, ctx);
    assert.equal(extension._internals._nativeTaskActivityCount(root), 1, 'legacy and lifecycle events share one task reference');
    assert.deepEqual(extension._internals._nativeTaskExecutionSnapshot(root), { activeCalls: 1, trackedTasks: 1, updatingTasks: 0 });

    await pi.events.get('tool_execution_update')({
      type: 'tool_execution_update',
      toolName: 'task',
      toolCallId: 'call_lifecycle',
      args,
      partialResult: {
        content: [{ type: 'text', text: 'running' }],
        details: { progress: [{ id: 'Phase1Plan10Executor', agent: 'gsd-executor', status: 'running', currentTool: 'read' }] },
      },
    }, ctx);
    assert.equal(extension._internals._nativeTaskExecutionSnapshot(root).updatingTasks, 1);
    assert.match(extension._internals.widgetLines(root).join('\n'), /live/);

    await pi.events.get('tool_execution_end')({
      type: 'tool_execution_end',
      toolName: 'task',
      toolCallId: 'call_lifecycle',
      result: {
        content: [{ type: 'text', text: 'done' }],
        details: { results: [{ id: 'Phase1Plan10Executor', agent: 'gsd-executor', exitCode: 0, output: '' }] },
      },
      isError: false,
    }, ctx);
    assert.equal(extension._internals._nativeTaskActivityCount(root), 0, 'execution end settles synchronous task');
    assert.deepEqual(extension._internals._nativeTaskExecutionSnapshot(root), { activeCalls: 0, trackedTasks: 0, updatingTasks: 0 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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


test('renders a two-line OMP status hint instead of a dense task dashboard', async () => {
  const root = gsdProjectRoot();
  try {
    fs.writeFileSync(
      path.join(root, '.planning', 'STATE.md'),
      '---\nstatus: executing\nprogress:\n  total_plans: 4\n  completed_plans: 2\n---\nPhase: 2 of 3 (Build)\nStatus: executing\n\n## Concerns\n- first concern\n- second concern\n',
    );
    const pi = mockPi();
    extension(pi, { runtime: 'omp', runtimeRoot: root });
    const ctx = { cwd: root };
    await pi.events.get('tool_call')(taskSpawnCall('call_widget', ['Phase1Plan06Executor']), ctx);
    const plain = extension._internals.widgetLines(root).join('\n').replace(/\u001b\[[0-9;]*m/g, '');
    assert.deepEqual(plain.split('\n'), [
      'GSD / OMP  RUNNING',
      '1 active · 2 concerns · /gsd-status',
    ]);
    assert.doesNotMatch(plain, /PHASE|PLANS|TASKS|RISK|├─|└─|GSD · OMP Native|OMP native execution active|native tasks running|⚠|⛔/);
    const lines = plain.split('\n');
    assert.equal(lines.length <= 2, true);
    assert.equal(lines.some((line) => line.length > 44), false);
    assert.equal(lines.some((line) => /\s$/.test(line)), false);
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
    assert.match(sent[0].content, /\/gsd-status/);
    assert.doesNotMatch(sent[0].content, /\/omp-native/);
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
