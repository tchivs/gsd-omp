'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildProjectedArtifacts,
  commandNames,
  projectAgent,
  projectSkill,
  rewriteRuntimePaths,
} = require('../src/projection.cjs');

function temporaryRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

test('rewriteRuntimePaths preserves literal dollar sequences in custom paths', () => {
  const result = rewriteRuntimePaths(
    'CLI: ~/.claude/gsd-core and home: ~/.claude/agents/$&',
    { coreRoot: '/core$root', runtimeRoot: '/omp$root', names: [] },
  );
  assert.equal(result, 'CLI: /core$root/gsd-core and home: /omp$root/agents/$&');
});

test('projectSkill is idempotent and uses the configured agents directory', () => {
  const context = { coreRoot: '/core$root', runtimeRoot: '/omp$root', names: ['demo'] };
  const source = ['---', 'name: gsd-demo', 'description: Demo skill', '---', '<context>', 'Use ~/.claude/gsd-core.', 'Run gsd:demo.'].join('\n');
  const once = projectSkill('gsd-demo', source, context);
  const twice = projectSkill('gsd-demo', once, context);
  assert.equal(twice, once);
  assert.equal((once.match(/<omp_runtime_cli>/g) || []).length, 1);
  assert.match(once, /GSD_AGENTS_DIR/);
  assert.match(once, /\/omp\$root\/agents/);
  assert.match(once, /Run gsd-demo\./);
});

test('buildProjectedArtifacts filters and deterministically orders core artifacts', () => {
  const coreRoot = temporaryRoot('gsd-omp-projection-core');
  const runtimeRoot = '/omp-runtime';
  try {
    fs.mkdirSync(path.join(coreRoot, 'commands', 'gsd'), { recursive: true });
    fs.mkdirSync(path.join(coreRoot, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(coreRoot, 'skills', 'gsd-demo'), { recursive: true });
    fs.writeFileSync(path.join(coreRoot, 'commands', 'gsd', 'b.md'), 'b');
    fs.writeFileSync(path.join(coreRoot, 'commands', 'gsd', 'a.md'), 'a');
    fs.writeFileSync(path.join(coreRoot, 'commands', 'ignore.txt'), 'ignore');
    fs.writeFileSync(
      path.join(coreRoot, 'agents', 'gsd-executor.md'),
      ['---', 'name: gsd-executor', 'description: Execute work', '---', 'Use ~/.claude/gsd-core.'].join('\n'),
    );
    fs.writeFileSync(
      path.join(coreRoot, 'skills', 'gsd-demo', 'SKILL.md'),
      ['---', 'name: gsd-demo', 'description: Demo', '---', '<process>', 'Use gsd:a.'].join('\n'),
    );
    assert.deepEqual(commandNames(coreRoot), ['a', 'b']);
    const artifacts = buildProjectedArtifacts({ coreRoot, runtimeRoot });
    assert.deepEqual(artifacts.map(({ relativePath }) => relativePath), [
      path.join('agents', 'gsd-executor.md'),
      path.join('skills', 'gsd-demo', 'SKILL.md'),
    ]);
    assert.match(artifacts[0].content, /tools: read, write, edit, bash, glob, grep, lsp, web_search, task/);
    assert.match(artifacts[1].content, /Use gsd-a/);
  } finally {
    fs.rmSync(coreRoot, { recursive: true, force: true });
  }
});

test('projectAgent keeps the executor result protocol in projected output', () => {
  const projected = projectAgent(
    ['---', 'name: gsd-executor', 'description: Execute work', '---', 'Use gsd:demo and ~/.claude/agents.'].join('\n'),
    'agents/gsd-executor.md',
    { coreRoot: '/core', runtimeRoot: '/omp', names: ['demo'] },
  );
  assert.match(projected, /spawns: "\*"/);
  assert.match(projected, /\[gsd-task-result\] phase \{PHASE\}/);
  assert.match(projected, /gsd-demo/);
  assert.match(projected, /\/omp\/agents/);
});
