'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Eos = require('../src/eos.cjs');

 test('negotiates OMP as a protocol-v1 programmatic CLI', () => {
  const binding = Eos.initialize();
  assert.equal(binding.SDK.PROTOCOL_VERSION >= 1, true);
  assert.equal(binding.negotiation.protocolVersion, binding.SDK.PROTOCOL_VERSION);
  assert.equal(binding.profile, 'programmatic-cli');
  assert.equal(binding.adapter.kind, 'imperative');
  assert.equal(binding.adapter.runtime, 'omp');
  assert.equal(binding.model.mode, 'passive');
  assert.equal(binding.hooks.bus, 'host');
  assert.equal(binding.state.io, 'filesystem');
  assert.deepEqual(binding.negotiation.warnings, []);
});

 test('declares all eight EoS axes from the OMP host contract', () => {
  assert.deepEqual(Object.keys(Eos.OMP_AXES).sort(), [
    'commandSurface', 'dispatch', 'embeddingMode', 'hookBus', 'modelMode',
    'runtime', 'stateIO', 'transport',
  ]);
  assert.equal(Eos.OMP_AXES.commandSurface, 'slash-programmatic');
  assert.equal(Eos.OMP_AXES.transport, 'native-extension');
  assert.equal(Eos.OMP_AXES.runtime, 'bun');
});
