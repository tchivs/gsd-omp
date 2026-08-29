<!-- generated-by: gsd-doc-writer -->
# Configuration

## Scope

This document covers configuration that affects the `gsd-omp` installer and its OMP extension: runtime-root selection, projected-agent lookup, shell and project-session localization, installer arguments, manifest ownership, and optional OMP Goal Mode coordination. It targets maintainers and operators of the current `gsd-omp` release. GSD Core's complete project configuration schema remains owned by `@opengsd/gsd-core`; only fields read by this plugin are described here.

Relevant implementation paths:

- `bin/gsd-omp.cjs` — CLI parsing, runtime root, manifest validation, ownership checks, and update behavior.
- `src/extension.cjs` — OMP runtime root/agent lookup, `gsd-tools` environment, project config reads, status, lifecycle events, and Goal Mode coordination.
- `src/locale.cjs` — POSIX locale precedence and normalization.
- `src/locales/en.cjs` and `src/locales/zh-CN.cjs` — shell/EoS message dictionaries.
- `src/eos.cjs` — negotiated EoS values that are fixed by the adapter rather than user configuration.
- `scripts/host-smoke.cjs` — isolated test environment variables and runtime-root setup.

## Runtime root

The runtime root is the directory into which the installer writes OMP artifacts. Resolution is performed by `runtimeRoot()` in `bin/gsd-omp.cjs`:

1. The `--root PATH` CLI option, when supplied, wins.
2. Otherwise `PI_CODING_AGENT_DIR` is used.
3. Otherwise the default is `~/.omp/agent` (with the home directory resolved by Node).

The path is resolved to an absolute path. A normal installed layout is:

```text
<runtime-root>/
├── .gsd-omp-manifest.json
├── extensions/gsd-omp.ts
├── agents/gsd-*.md
└── skills/gsd-*/SKILL.md
```

`PI_CODING_AGENT_DIR` controls where the installer writes. It does not, by itself, change where GSD Core looks for agents during an already running extension. The extension receives the install-time root in the generated wrapper and defaults its own direct-load root to `~/.omp/agent`.

The extension derives its default agent directory as `<runtime-root>/agents`. If `GSD_AGENTS_DIR` was already present when OMP loaded the extension, that explicit value wins and is used as-is. Otherwise the extension sets `GSD_AGENTS_DIR` to the derived directory. This distinction permits operators who manage agent projections separately to point GSD Core at another directory without the plugin replacing it.

## Environment variables

### Runtime and localization variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PI_CODING_AGENT_DIR` | Optional | `~/.omp/agent` | Installer runtime root when `--root` is not supplied. The host smoke script sets this to a temporary directory. |
| `GSD_AGENTS_DIR` | Optional | `<runtime-root>/agents` | Directory passed to every extension-launched `gsd-tools.cjs` process. An existing value is preserved; otherwise the extension exports its derived default. |
| `GSD_OMP_LOCALE` | Optional | Next POSIX locale or `en` | Explicit locale for installer CLI and EoS bootstrap messages. Values beginning with `zh` normalize to `zh-CN`; all other values normalize to `en`. |
| `LC_ALL` | Optional | Next POSIX locale or `en` | First POSIX fallback after `GSD_OMP_LOCALE`. |
| `LC_MESSAGES` | Optional | Next POSIX locale or `en` | Second POSIX fallback after `GSD_OMP_LOCALE` and `LC_ALL`. |
| `LANG` | Optional | `en` | Final POSIX locale fallback after `GSD_OMP_LOCALE`, `LC_ALL`, and `LC_MESSAGES`. |

The effective shell/EoS locale is selected in this exact order: `GSD_OMP_LOCALE`, `LC_ALL`, `LC_MESSAGES`, `LANG`. Supported dictionaries are `en` and `zh-CN`; a value such as `zh_CN.UTF-8` selects `zh-CN`, while an unknown or empty value falls back to English. This locale does not override a project's in-session language setting.

### Update and smoke-test variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_TOKEN` | Optional | Unset | If present, the update release lookup sends it as a Bearer token. It is not required for normal public-release lookup. |
| `GH_TOKEN` | Optional | Unset | Fallback token name used when `GITHUB_TOKEN` is not present. |
| `OMP_BIN` | Smoke-test only | `omp` | Executable selected by `scripts/host-smoke.cjs` to launch OMP. Not read by the installed extension. |
| `GSD_OMP_BIN` | Smoke-test only | Run `bin/gsd-omp.cjs` with the current Node executable | Optional installer executable selected by `scripts/host-smoke.cjs`. |
| `OMP_VERSION` | CI/smoke-test only | `local` in output | Labels the OMP version in the host-smoke result and selects the legacy OMP 17 fallback branch. It is not an extension configuration setting. |
| `OPENAI_API_KEY` | Smoke-test only | `not-a-real-key` for host startup | The smoke script passes an existing key through, or supplies a placeholder so host startup can be exercised without a real request. Do not use the placeholder for an actual model call. |

The extension itself sets `GSD_RUNTIME=omp` for each child `gsd-tools.cjs` invocation. This is an internal bridge variable, not a user setting; callers should not depend on changing it through the shell. The EoS descriptor's `runtime: "bun"` is a negotiated capability declaration and is not an environment-variable override.

## Project configuration

The extension reads the active planning workspace's `config.json`, normally `.planning/config.json`, through the resolved GSD Core planning-path helper. It parses JSON and treats an unreadable or absent file as unavailable configuration rather than inventing values. Onboarding writes a temporary file and atomically renames it, preserving existing keys.

The plugin consumes these fields:

| Path | Type | Effect |
|---|---|---|
| `response_language` | string | Selects in-session extension messages. Values matching `zh`, `Chinese`, or `中文` (case-insensitive) use Simplified Chinese; all other values use English. |
| `workflow.text_mode` | boolean | Preserved and optionally set by first-session onboarding when the user chooses terminal text versus OMP interactive controls. |
| `hooks.workflow_guard` | truthy value | Enables a session-start reminder derived from the current state file. Hook execution itself is handled by GSD Core hook files and is bounded/fail-open by the extension. |
| `graphify.enabled` | boolean | Enables the graphify integration gate when combined with `graphify.auto_update`. |
| `graphify.auto_update` | boolean | Allows the extension to start a background `graphify` rebuild after a successful, HEAD-advancing command on the configured default branch. The rebuild is disabled in CI. |

A minimal project-language example is:

```json
{
  "response_language": "English",
  "workflow": {
    "text_mode": false
  }
}
```

To select Simplified Chinese explicitly, use `"response_language": "Simplified Chinese"`. The first interactive `session_start` for a GSD project with no `response_language` offers `Simplified Chinese` or `English`; it can also ask for interaction style if `workflow.text_mode` is not already explicit. Projects without an interactive UI do not receive that picker.

## Installer CLI configuration

The executable accepts one command followed by common options:

```text
gsd-omp [install|update|uninstall|doctor|descriptor] [--root <path>] [--force] [--json]
```

With no command, the CLI behaves as `install`. `--help`/`-h` prints usage. `--root` requires a following path and is normalized to an absolute path; a missing value or unknown argument is an error. `--json` prints the command result as JSON. The supported commands are:

| Command | Behavior | Useful result fields |
|---|---|---|
| `install` | Negotiate EoS, validate GSD Core, project the wrapper/agents/skills, and update the manifest transactionally. | `root`, `manifestPath`, `installed`, `coreVersion`, `protocolVersion` |
| `update` | Resolve a newer public release, globally install it with npm, then run the newly installed CLI's `install` projection. | `updated`/`upToDate`, `from`, `to`, `current`, `latest`, `root` |
| `uninstall` | Remove unchanged files listed in the manifest and remove the manifest only when no files are skipped. | `root`, `removed`, `skipped`, `absent` |
| `doctor` | Check manifest presence, missing/modified projected files, and EoS profile. | `ok`, `installed`, `version`, `coreVersion`, `protocolVersion`, `profile`, `missing`, `modified` |
| `descriptor` | Print the negotiated plugin identity, EoS axes, interface points, and protocol/core requirement. | `id`, `protocolVersion`, `enginesGsd`, `profile`, `interfacePoints`, `axes` |

`doctor` returns a failing process status when the installation is absent/unhealthy. `uninstall` returns a failing process status if any managed file was skipped. These status rules make the JSON form suitable for a deployment or dotfiles check without treating a modified user file as silently removed.

Examples:

```bash
# Use a disposable profile; no files are written to the normal OMP root.
root="$(mktemp -d)"
PI_CODING_AGENT_DIR="$root" gsd-omp install --json
PI_CODING_AGENT_DIR="$root" gsd-omp doctor --json
PI_CODING_AGENT_DIR="$root" gsd-omp descriptor --json
PI_CODING_AGENT_DIR="$root" gsd-omp uninstall --json
rm -rf "$root"
```

```bash
# Use an explicit root; this overrides PI_CODING_AGENT_DIR.
gsd-omp install --root "$HOME/.omp/agent" --json
```

Do not put access tokens or other secrets in the generated wrapper, projected skills, or manifest. If update authentication is needed, provide `GITHUB_TOKEN` or `GH_TOKEN` through the process environment/secret manager rather than writing it to project files. The update endpoint and latest-release fallback are external GitHub infrastructure defined by `githubLatestRelease()`; confirm network and organization policy before relying on them. <!-- VERIFY: GitHub is an external release service; confirm network and organization policy before relying on it. -->

## Manifest ownership and `--force`

`.gsd-omp-manifest.json` is the ownership record, not a general OMP configuration file. The installer records SHA-256 hashes for every generated file. On reinstall, stale manifest entries and recognized legacy extension files are considered for removal, but each target is checked first. A target is safe only when it is a regular file with the expected hash; path components must be real directories, not symlinks.

Normal behavior is intentionally conservative:

- A missing or changed target is not overwritten.
- An unmanaged file at a desired target is protected.
- An invalid manifest (wrong schema/plugin, duplicate path, absolute/parent-traversing path, or invalid hash) stops the operation.
- Uninstall preserves modified files and keeps the manifest when cleanup is incomplete.
- `--force` permits replacement/removal despite a hash mismatch, but still rejects unsafe manifest paths, symlinked parents, directories in place of files, and invalid manifests.

Use `--force` only when the operator has reviewed and intentionally wants to replace or delete local changes in GSD-owned projections:

```bash
gsd-omp install --force
# or, after reviewing the projected files:
gsd-omp uninstall --force
```

A safer refresh is to run `gsd-omp doctor --json` first and inspect `missing`/`modified`; do not use `--force` merely to silence a warning.

## OMP Goal Mode coordination

Goal Mode support is optional and host-dependent. The extension attempts to register the OMP `goal_updated` event in a guarded block. OMP 17 does not expose this event, so the registration failure is caught and the normal command, task, status, and localization surfaces continue to work.

When the event exists, the adapter accepts either `event.state` or an `event.goal` payload and validates a goal containing at least a non-empty `objective`, a `status`, and finite non-negative `tokensUsed`. It also preserves optional finite positive `tokenBudget`, finite non-negative `timeUsedSeconds`, string `id`, and numeric `updatedAt`. The normalized state is displayed by `/gsd-status`, the GSD widget, and the live status overlay. On state refresh, the extension can recover the latest goal from the session journal's most recent `mode_change` entry whose mode is `goal` or `goal_paused`.

Coordination rule:

1. If Goal Mode is active (`enabled === true` and goal status is `active`), a pending GSD continuation is held rather than automatically started.
2. The user pauses or drops the OMP goal with `/goal pause` or `/goal drop`.
3. The user then runs `/gsd-next` when it is safe for the GSD continuation to proceed.

This prevents two continuation loops from competing. It does not take ownership of OMP's GoalRuntime, alter the goal, or make Goal Mode a prerequisite for GSD. A stop request still uses OMP's native abort behavior; detached native tasks remain tracked. On OMP 17, omit assumptions about goal status/events and use the rest of the integration normally.

## Safe operational patterns

Use an isolated root while testing installer changes or a new OMP version:

```bash
set -eu
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
PI_CODING_AGENT_DIR="$root" GSD_OMP_LOCALE=en gsd-omp install --json
PI_CODING_AGENT_DIR="$root" GSD_OMP_LOCALE=en gsd-omp doctor --json
```

Use a separate, explicit agent directory only when the projected agents are managed there already:

```bash
GSD_AGENTS_DIR="$HOME/.omp/managed-gsd-agents" omp
```

The extension preserves that value and passes it to GSD Core. Ensure the directory contains the projected `gsd-*.md` files before starting a project session; otherwise GSD Core's agent availability checks can report them missing.

For a project-local language override without changing the shell's CLI language:

```json
{
  "response_language": "English"
}
```

For shell-only Chinese installer output:

```bash
GSD_OMP_LOCALE=zh_CN.UTF-8 gsd-omp doctor --json
```

## Fixed adapter settings

These are not user-configurable environment values. `src/eos.cjs` negotiates them on each process's first EoS initialization and caches the result:

- protocol version `1`;
- profile `programmatic-cli`;
- model mode `passive` (OMP controls the session model);
- host hook bus and filesystem state I/O;
- native-extension transport; and
- the declared dispatch capabilities, including named nested/background dispatch and `isolation: none` in the EoS axes.

The last value describes the generic adapter declaration. Native OMP task isolation remains governed by OMP and the projected command/agent instructions; changing model profiles or adding an environment override does not turn the EoS adapter into a per-agent model router.
