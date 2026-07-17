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
