'use strict';

// English (default) messages for the gsd-omp host CLI and EoS bootstrap.
// Keys are flat and dotted by namespace. Add parallel keys to zh-CN.cjs.

module.exports = {
  'cli.usage': 'Usage: gsd-omp [install|uninstall|doctor|descriptor] [--root <path>] [--force] [--json]',

  'cli.error.unknownCommand': 'Unknown command: {command}',
  'cli.error.unknownArgument': 'Unknown argument: {arg}',
  'cli.error.rootRequiresPath': '--root requires a path',
  'cli.error.cannotReadManifest': 'Cannot read {path}: {message}',
  'cli.error.unsupportedCore': 'gsd-omp requires @opengsd/gsd-core >=1.8.0; found {version}',
  'cli.error.refusingOverwrite': 'Refusing to overwrite unmanaged or modified file: {path} (rerun with --force to replace GSD-owned projections)',

  'eos.error.unexpectedProfile': 'gsd-omp: EoS negotiation produced {profile}, expected programmatic-cli',
  'eos.error.unsupportedProtocol': 'gsd-omp: unsupported EoS protocol {version}',
};
