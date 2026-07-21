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
npm install --global github:tchivs/gsd-omp#v1.0.1
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

## Commands

The plugin registers 38 slash commands and the `gsd_invoke` tool. Commands are grouped by project lifecycle; descriptions are taken verbatim from the registered command metadata.

### Entry & status

| Command | Description |
|---|---|
| `/gsd-next` | Show or prepare the next localized GSD action |
| `/gsd-progress` | Show GSD progress or advance through its gated next-step workflow |
| `/gsd-status` | Show a localized GSD project summary |
| `/gsd <family> <subcommand> [args]` | Invoke the public `gsd-tools` CLI directly |

### Project lifecycle

| Command | Description |
|---|---|
| `/gsd-new-project` | Initialize a GSD project with native OMP questions |
| `/gsd-new-milestone` | Start a GSD milestone with native OMP questions |
| `/gsd-resume-work` | Restore a GSD project through native OMP controls |
| `/gsd-pause-work` | Create context handoff when pausing work mid-phase |
| `/gsd-complete-milestone` | Archive completed milestone and prepare for next version |

### Phase planning

| Command | Description |
|---|---|
| `/gsd-spec-phase <n>` | Clarify WHAT a phase delivers; produces SPEC.md |
| `/gsd-discuss-phase <n>` | Gather phase context through adaptive questioning |
| `/gsd-plan-phase <n>` | Create PLAN.md with verification loop |
| `/gsd-mvp-phase <n>` | Plan a phase as a vertical MVP slice |
| `/gsd-ai-integration-phase <n>` | Generate AI-SPEC.md design contract for AI phases |
| `/gsd-ui-phase <n>` | Generate UI-SPEC.md design contract for frontend phases |

### Execution & verification

| Command | Description |
|---|---|
| `/gsd-execute-phase <n>` | Execute a phase through OMP native task waves |
| `/gsd-verify-work <n>` | Verify a completed phase through conversational UAT |
| `/gsd-code-review <n>` | Review a phase through native OMP task dispatch |
| `/gsd-add-tests <n>` | Generate phase tests through native OMP approvals |
| `/gsd-validate-phase <n>` | Audit Nyquist validation coverage for a phase |
| `/gsd-secure-phase <n>` | Verify phase threat mitigations |

### Quality audits

| Command | Description |
|---|---|
| `/gsd-ui-review` | Retroactive 6-pillar visual audit of frontend code |
| `/gsd-eval-review` | Audit an executed AI phase's evaluation coverage |
| `/gsd-audit-uat` | Cross-phase audit of outstanding UAT and verification items |
| `/gsd-audit-milestone` | Audit milestone completion against original intent |
| `/gsd-debug` | Run GSD debugging through native OMP questions and tasks |
| `/gsd-audit-fix` | Autonomous audit-to-fix pipeline — find, classify, fix, test, commit |

### Ship & git

| Command | Description |
|---|---|
| `/gsd-ship <n>` | Ship verified work; create PR and prepare for merge |
| `/gsd-update` | Update GSD through native preflight and approval gates |
| `/gsd-undo` | Revert GSD commits through native dependency and approval gates |
| `/gsd-pr-branch` | Build a filtered PR branch through native preview and approval gates |

### Fast paths & admin

| Command | Description |
|---|---|
| `/gsd-quick` | Run a quick task with GSD guarantees (atomic commits, state tracking) |
| `/gsd-fast` | Run a trivial task inline — no subagents, no planning overhead |
| `/gsd-import` | Ingest external plans with conflict detection |
| `/gsd-autonomous` | Run all remaining phases autonomously — discuss→plan→execute |
| `/gsd-phase` | CRUD for phases in ROADMAP.md — add, insert, remove, edit |
| `/gsd-settings` | Configure workflow toggles and model profile |
| `/gsd-workspace` | Manage isolated workspace environments |
| `/gsd-workstreams` | Manage parallel workstreams |

For the full `gsd-tools` CLI surface behind `/gsd`, run `/gsd <family> help` or call the `gsd_invoke` tool with `subcommand: "help"`.

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
npm install --global github:tchivs/gsd-omp#v1.0.1
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
