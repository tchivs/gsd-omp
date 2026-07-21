# GSD for Oh My Pi
[![Release](https://img.shields.io/github/v/release/tchivs/gsd-omp?logo=github&label=release)](https://github.com/tchivs/gsd-omp/releases)
[![License: MIT](https://img.shields.io/github/license/tchivs/gsd-omp?color=blue)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![GSD Core](https://img.shields.io/badge/gsd--core-%E2%89%A51.7.0-0066cc)](https://github.com/open-gsd/gsd-core)
[![OMP EoS](https://img.shields.io/badge/OMP-EoS%20v1-6c31c4)](#eos-contract)
[![Last Commit](https://img.shields.io/github/last-commit/tchivs/gsd-omp?logo=git&logoColor=white)](https://github.com/tchivs/gsd-omp/commits)
[![Stars](https://img.shields.io/github/stars/tchivs/gsd-omp?style=social)](https://github.com/tchivs/gsd-omp/stargazers)

**English** · [简体中文](./README.zh-CN.md)

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

## Locale

The host CLI (`gsd-omp install|uninstall|doctor|descriptor`) and EoS bootstrap messages localize through the POSIX environment, resolved in this order:

1. `GSD_OMP_LOCALE` — explicit override, takes precedence
2. `LC_ALL`
3. `LC_MESSAGES`
4. `LANG`

Any value whose lowercased form starts with `zh` (e.g. `zh_CN.UTF-8`, `zh_TW`) selects Simplified Chinese; everything else falls back to English. Unknown keys fall back to English, and unknown placeholders are left intact.

```bash
# force Chinese output regardless of shell locale
GSD_OMP_LOCALE=zh_CN.UTF-8 gsd-omp doctor
```

Messages from the in-session OMP extension (`/gsd-*` commands, status widgets, continuations) are localized separately through the project's `response_language` field in `.planning/config.json`. The first time the extension loads in a GSD project without that field set, it offers a one-time `简体中文 / English` picker.

Supported locales: `en` (default), `zh-CN`.

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
