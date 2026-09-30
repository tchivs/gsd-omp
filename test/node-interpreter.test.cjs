'use strict';

/**
 * Regression coverage for the OMP child-process interpreter fix.
 *
 * OMP ships as a single-file Bun executable, so `process.execPath` inside the
 * loaded extension is `omp.bin` — not Node. Before the fix, every GSD hook ran
 * through `spawn(process.execPath, [hook.js])`, which booted a second full OMP
 * runtime (~400 MB RSS, ~1 CPU core) per tool call. High-frequency sessions then
 * stacked several of them, saturating the host CPU.
 *
 * These tests pin the contract: GSD children must be launched with a real Node
 * interpreter, and the Bun host must never be selected as the interpreter.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { _internals } = require('../src/extension.cjs');
const { runHook, resolveNodeBinary, NODE_BINARY } = _internals;

const BUN_HOST = /omp\.bin$|bun$|\.mount_/;

test('resolveNodeBinary never returns the Bun/OMP host binary as interpreter', () => {
  const resolved = resolveNodeBinary();
  assert.equal(typeof resolved, 'string');
  assert.notEqual(resolved, '', 'interpreter path must not be empty');
  assert.doesNotMatch(
    path.basename(resolved),
    BUN_HOST,
    `interpreter resolved to the Bun host (${resolved}); GSD children would boot a second OMP runtime`,
  );
});

test('resolveNodeBinary honours an explicit GSD_NODE_BIN override', () => {
  const original = process.env.GSD_NODE_BIN;
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gsd-node-'));
  const fake = path.join(dir, 'node');
  fs.writeFileSync(fake, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  try {
    process.env.GSD_NODE_BIN = fake;
    assert.equal(resolveNodeBinary(), fake);
  } finally {
    if (original === undefined) delete process.env.GSD_NODE_BIN;
    else process.env.GSD_NODE_BIN = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('NODE_BINARY is loaded once at module load and is a usable path', () => {
  assert.equal(typeof NODE_BINARY, 'string');
  assert.equal(fs.existsSync(NODE_BINARY), true, `NODE_BINARY does not exist: ${NODE_BINARY}`);
});

test('runHook spawns the resolved Node interpreter, never the Bun/OMP host', async () => {
  const seen = [];
  const spawnChild = (command, args) => {
    seen.push({ command, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stdin = new EventEmitter();
    child.stdin.end = () => {};
    child.kill = () => {};
    setImmediate(() => child.emit('close', 0));
    return child;
  };

  const result = await runHook('gsd-workflow-guard.js', { hook_event_name: 'PreToolUse' }, {
    timeout: 2000,
    spawnChild,
  });

  assert.equal(result.timedOut, false);
  if (seen.length === 0) {
    // Hook file missing in this fixture layout: the fail-open contract applies.
    assert.deepEqual(result, { stdout: '', exitCode: 0, timedOut: false });
    return;
  }
  // Under a real Node host the interpreter legitimately equals process.execPath;
  // what must never happen is resolving to the Bun single-file host.
  assert.equal(seen[0].command, NODE_BINARY);
  assert.doesNotMatch(
    path.basename(seen[0].command),
    BUN_HOST,
    'runHook must not spawn the Bun/OMP host as the hook interpreter',
  );
  assert.equal(path.basename(seen[0].args[0]), 'gsd-workflow-guard.js');
});

test('runHook stays fail-open when the interpreter cannot start', async () => {
  const spawnChild = (command, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stdin = new EventEmitter();
    child.stdin.end = () => {};
    child.kill = () => {};
    setImmediate(() => child.emit('error', new Error('ENOENT')));
    return child;
  };
  const result = await runHook('gsd-context-monitor.js', {}, { timeout: 1000, spawnChild });
  assert.equal(result.exitCode, 0, 'a hook failure must not disable the tool call');
  assert.equal(result.timedOut, false);
});
