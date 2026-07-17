# GSD for Oh My Pi

`gsd-omp` is an independently maintained Oh My Pi host plugin for the [GSD Embeddable Orchestration System](https://github.com/open-gsd/gsd-core/blob/next/docs/explanation/embeddable-orchestration-system.md). It binds OMP's native extension, command, event, task, and filesystem surfaces to GSD through protocol version 1 of the public Host-Integration SDK.

This project is third-party software. It is not endorsed, reviewed, or maintained by OpenGSD.

## Requirements

- Node.js 22 or newer
- Oh My Pi with native ExtensionAPI support
- GSD Core 1.7.0 or newer; installed automatically as this package's dependency

## Install

Install the released plugin globally, then project its managed extension, agents, and skills into OMP:

```bash
npm install --global github:tchivs/gsd-omp#v1.0.0
gsd-omp install
```

`PI_CODING_AGENT_DIR` is honored. Without it, files are installed under `~/.omp/agent`.

Restart OMP after installation, then use:

```text
/gsd-next
/gsd-progress
/gsd-plan-phase 1
/gsd <gsd-tools family> <subcommand> [args]
```

The plugin also registers the `gsd_invoke` tool for structured access to the public `gsd-tools` CLI.

## Verify

```bash
gsd-omp doctor
```

A healthy install reports `"ok": true`, EoS profile `programmatic-cli`, and protocol version `1`.

To inspect the exact EoS declaration:

```bash
gsd-omp descriptor
```

## Upgrade

```bash
gsd-omp uninstall
npm install --global github:tchivs/gsd-omp#v1.0.0
gsd-omp install
```

The installer refuses to overwrite unmanaged or locally modified projections. Use `--force` only when intentionally replacing earlier GSD-owned OMP files:

```bash
gsd-omp install --force
```

## Uninstall

Remove managed OMP artifacts before removing the package that owns the installer:

```bash
gsd-omp uninstall
npm uninstall --global gsd-omp
```

Modified managed files are preserved and reported. Pass `--force` only when they should be deleted.

## EoS contract

| Field | Value |
|---|---|
| Protocol | `1` |
| Profile | `programmatic-cli` |
| Interface points | `command`, `dispatch`, `model`, `hooks`, `state`, `artifact` |
| `embeddingMode` | `imperative` |
| `commandSurface` | `slash-programmatic` |
| `dispatch` | named, nested to depth 2, background, full subagent toolkit |
| `modelMode` | `passive` — OMP owns model routing |
| `hookBus` | `host` — OMP owns lifecycle events |
| `stateIO` | `filesystem` |
| `transport` | `native-extension` |
| `runtime` | `bun` |

The plugin imports GSD's versioned Host-Integration SDK entry, negotiates the EoS handshake at load time, and invokes GSD through the package's public `gsd-tools` executable. It does not patch or modify `gsd-core` source.

## Managed files

The installer writes:

- `extensions/gsd-omp.ts`
- projected `agents/gsd-*.md`
- projected `skills/gsd-*/SKILL.md`
- `.gsd-omp-manifest.json` with ownership hashes

The manifest makes upgrades and uninstalls ownership-aware. Files changed after installation are not overwritten or removed without `--force`.

## Development

```bash
npm install
npm run lint
npm test
```

A local isolated install can be exercised without touching the user's OMP profile:

```bash
PI_CODING_AGENT_DIR="$(mktemp -d)" node bin/gsd-omp.cjs install
```

## Attribution

The OMP extension began from the MIT-licensed pi reference host in `open-gsd/gsd-core` and was adapted into this independently maintained EoS plugin. The upstream Open GSD copyright notice is retained in `LICENSE`.

## License

MIT
