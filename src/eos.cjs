'use strict';

const path = require('node:path');
const { t } = require('./locale.cjs');

const OMP_AXES = Object.freeze({
  embeddingMode: 'imperative',
  commandSurface: 'slash-programmatic',
  dispatch: Object.freeze({
    namedDispatch: true,
    nested: true,
    maxDepth: 2,
    background: true,
    subagentToolkit: 'full',
    backgroundDispatch: true,
  }),
  modelMode: 'passive',
  hookBus: 'host',
  stateIO: 'filesystem',
  transport: 'native-extension',
  runtime: 'bun',
});

let cached;

function resolveCoreRoot() {
  return path.dirname(require.resolve('@opengsd/gsd-core/package.json'));
}

function loadSdk(coreRoot = resolveCoreRoot()) {
  return require(path.join(coreRoot, 'gsd-core', 'bin', 'lib', 'host-integration-sdk.cjs'));
}

function initialize() {
  if (cached) return cached;
  const coreRoot = resolveCoreRoot();
  const SDK = loadSdk(coreRoot);
  const request = SDK.buildHandshakeRequest({
    protocolVersion: SDK.PROTOCOL_VERSION,
    axes: OMP_AXES,
  });
  const negotiation = SDK.handleHandshakeRequest(request);
  const profile = SDK.profileOf(negotiation.effective);
  if (profile !== 'programmatic-cli') {
    throw new Error(t('eos.error.unexpectedProfile', { profile: JSON.stringify(profile) }));
  }
  if (negotiation.protocolVersion < 1) {
    throw new Error(t('eos.error.unsupportedProtocol', { version: JSON.stringify(negotiation.protocolVersion) }));
  }

  cached = Object.freeze({
    SDK,
    coreRoot,
    cliPath: path.join(coreRoot, 'gsd-core', 'bin', 'gsd-tools.cjs'),
    axes: OMP_AXES,
    request,
    negotiation,
    profile,
    adapter: SDK.createImperativeAdapter({ runtime: 'omp' }),
    model: SDK.createModelAdapter({ modelMode: 'passive' }),
    hooks: SDK.createHookBus({ bus: 'host' }),
    state: SDK.createStateIO({ io: 'filesystem' }),
  });
  return cached;
}

module.exports = Object.freeze({ OMP_AXES, resolveCoreRoot, loadSdk, initialize });
