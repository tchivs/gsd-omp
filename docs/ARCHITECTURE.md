<!-- generated-by: gsd-doc-writer -->
# Architecture

## Scope

This document describes the runtime architecture of `gsd-omp`: the installer and managed-file manifest, the GSD Embeddable Orchestration System (EoS) handshake, projection of GSD Core artifacts into an Oh My Pi (OMP) profile, the OMP extension lifecycle, localization, and the test/host-smoke boundaries. It is intended for maintainers tracing a change from the package entry point to an OMP session. It does not define GSD Core workflows or replace the authoritative command/skill content shipped by `@opengsd/gsd-core`.

Relevant implementation paths:

- `bin/gsd-omp.cjs` — CommonJS installer CLI, runtime-root resolution, manifest ownership, and update checks.
- `src/eos.cjs` — EoS capability declaration and Host-Integration SDK negotiation.
- `src/projection.cjs` — agent/skill projection and OMP-specific path/command rewriting.
- `src/extension.cjs` — OMP ExtensionAPI factory, command/tool registration, lifecycle events, native status, task tracking, and optional Goal Mode adapter.
- `src/locale.cjs` and `src/locales/*.cjs` — shell/EoS message locale selection and dictionaries.
- `scripts/host-smoke.cjs` — isolated OMP integration exercise.
- `.github/workflows/ci.yml` — Node unit/lint job and OMP host-smoke matrix.

## System overview

`gsd-omp` is a CommonJS package that binds the GSD Core public CLI and Host-Integration SDK to OMP's native extension surface. The installer projects a managed extension wrapper plus GSD agents and skills into an OMP runtime root; OMP then loads that wrapper and invokes the extension factory. At extension load time, the plugin negotiates EoS protocol 1 with GSD Core and exposes a programmatic CLI profile. During a session, OMP owns model selection, native task dispatch, approvals, session state, and isolation, while GSD Core owns its CLI semantics and filesystem artifacts. The main data path is filesystem projection → native OMP extension → child-process invocation of `gsd-tools.cjs` → displayed OMP message/status, with project state read from the planning workspace.

The boundary is deliberate: this package adapts host interfaces but does not patch `gsd-core` source, implement a second GSD CLI, or replace OMP's native runtime. `src/eos.cjs` declares `runtime: 'bun'` as an EoS capability axis because that is the host contract; the extension invokes the resolved GSD CLI with Node's child-process API.

## Component diagram

```text
                        npm package / @opengsd/gsd-core
                                      |
                                      v
+-------------------+       +-------------------+       +----------------------+
| bin/gsd-omp.cjs   |------>| src/eos.cjs       |------>| Host-Integration SDK |
| install/update/...|       | axes + handshake  |       | protocol 1           |
+---------+---------+       +-------------------+       +----------+-----------+
          |                                                       |
          | buildProjectedArtifacts                              | adapters
          v                                                       v
+-------------------+       loads wrapper       +-----------------------------+
| OMP runtime root  |-------------------------->| src/extension.cjs          |
| extensions/       |                           | commands/tool/events/UI   |
| agents/ skills/   |                           +------+----------------------+
| manifest          |                                  |
+-------------------+                                  | spawn with
                                                       | GSD_RUNTIME=omp
                                                       v
                                             +-----------------------------+
                                             | gsd-core/bin/gsd-tools.cjs |
                                             | project state + artifacts  |
                                             +--------------+--------------+
                                                            |
                                                            v
                                             OMP messages, widget, status,
                                             native tasks and session state
```

## Installer and manifest

`bin/gsd-omp.cjs` is the package's executable (`package.json` maps the `gsd-omp` bin to this file). It supports `install`, `uninstall`, `doctor`, `descriptor`, and `update`; with no command, `install` is selected. `--root PATH` is resolved to an absolute path and takes precedence over `PI_CODING_AGENT_DIR`; otherwise the root is `$PI_CODING_AGENT_DIR` or `~/.omp/agent`.

An install performs these steps:

1. Resolve `@opengsd/gsd-core` and run `Eos.initialize()`.
2. Reject a bundled GSD Core version below `1.11.0`.
3. Build `extensions/gsd-omp.ts`, a thin OMP module wrapper that imports `src/extension.cjs` and passes `{ runtime: "omp", runtimeRoot }`.
4. Project every `gsd-*.md` agent and every `gsd-*` skill with a `SKILL.md` from the resolved core tree.
5. Stage all files in a temporary transaction directory, replace prior targets only after ownership checks, and write `.gsd-omp-manifest.json`.
6. Remove unchanged stale managed projections and recognized legacy CJS extensions. Modified stale files remain protected.

The manifest is a version-1 JSON object containing `schemaVersion`, `plugin`, package `version`, `enginesGsd`, negotiated `protocolVersion`, resolved `coreVersion`, EoS `profile`, `installedAt`, and a `files` array. Each file entry contains a relative `path` and SHA-256 `sha256`. Manifest paths must remain relative, unique, within the runtime root, and point through regular directory components; symlinked parents are rejected.

Ownership is hash-based. Reinstall/update refuses to overwrite a missing-manifest file or a managed file whose current hash differs from the recorded hash. Uninstall removes only unchanged regular files listed in the manifest and preserves modified or directory replacements; it keeps the manifest if anything is skipped. `--force` intentionally bypasses the hash mismatch check, but it does not bypass path-safety checks or permit a symlink traversal. This protects an OMP profile that contains user edits.

`update` obtains the latest release metadata, installs a newer package globally with npm, then invokes the newly installed `gsd-omp install` so the new process projects the new extension, agents, skills, and bundled core. If the installed version is current, it reports that no projection update is needed. The external release lookup is implemented in `githubLatestRelease()` using the repository's GitHub API/latest-release page fallback. <!-- VERIFY: GitHub is an external release service; confirm network and organization policy before relying on it. -->

## EoS handshake and responsibility boundary

`src/eos.cjs` resolves the package location of `@opengsd/gsd-core`, loads `gsd-core/bin/lib/host-integration-sdk.cjs`, builds a handshake request using the SDK protocol constant and `OMP_AXES`, and immediately handles that request. Initialization rejects any result whose profile is not `programmatic-cli` or whose negotiated protocol is not the integer `1`.

The declared axes are:

| Axis | Value or contract |
|---|---|
| `embeddingMode` | `imperative` |
| `commandSurface` | `slash-programmatic` |
| `dispatch` | named and nested to depth 2; background dispatch; full subagent toolkit; `isolation: none` in the EoS declaration |
| `modelMode` | `passive` — OMP remains the model authority |
| `hookBus` | `host` — lifecycle events come from OMP |
| `stateIO` | `filesystem` |
| `transport` | `native-extension` |
| `runtime` | `bun` (the declared host capability) |
| `effortSurface` | `none` |

The initialized adapter bundle contains the imperative adapter (`runtime: 'omp'`), passive model adapter, host hook bus, and filesystem state adapter. The extension uses these negotiated capabilities as the compatibility contract, then invokes the public GSD CLI path resolved beneath the installed core tree.

Responsibilities are intentionally separate:

- **OMP** owns session lifecycle, the active model, native `task` jobs, job settlement, approvals, context compaction, retry/stop controls, session branching/switching, and isolation. A native task with `isolated: true` is OMP's isolation primitive.
- **GSD Core** owns the `gsd-tools.cjs` command families, project/planning artifacts, agent and skill source content, and GSD-specific state transitions.
- **gsd-omp** translates between them: it supplies OMP command handlers, passes `GSD_RUNTIME=omp` and the agent directory to child processes, tracks native task activity, renders status, and forwards hook decisions. It does not invent a replacement public GSD API.

The EoS `dispatch.isolation: 'none'` value must not be read as a request to disable OMP isolation. It describes the adapter's generic dispatch capability; projected execution instructions use OMP's native `task` and request `isolated: true` where repository changes require it.

## Artifact projection

`src/projection.cjs` reads the resolved GSD Core `agents/`, `skills/`, and `commands/gsd/` directories. It computes the available command names from the core command files and rewrites source content for OMP:

- Agent frontmatter is validated for `name` and `description`, then rebuilt with OMP's tool list (`read, write, edit, bash, glob, grep, lsp, web_search, task`) and `spawns: "*"`.
- GSD Core paths such as `~/.claude/gsd-core` and `~/.claude` are rewritten to the resolved core/runtime paths.
- `gsd:<command>` references are rewritten to OMP's `gsd-<command>` command spelling.
- Projected agents receive the OMP native orchestration guidance. The executor additionally receives the OMP task-result lifecycle line contract.
- Projected skills receive an `<omp_runtime_cli>` block identifying the authoritative `gsd-tools.cjs` path, `GSD_RUNTIME=omp`, and the projected agents directory. Existing copies of that block are not duplicated.

The installer places the resulting files under `agents/` and `skills/` below the runtime root. The source files remain in the installed GSD Core package; projection is generated output, not a second source of truth.

## OMP extension lifecycle and command surface

The installed wrapper loads `src/extension.cjs` through CommonJS and calls the exported extension factory with the OMP `ExtensionAPI` object. The factory requires a Zod-capable API, initializes EoS, resolves the engine root/CLI, and derives `runtimeRoot` from the installer-provided option (falling back to `~/.omp/agent` for a directly loaded extension). It sets `GSD_AGENTS_DIR` only when the host did not already define it; the default is `<runtimeRoot>/agents`.

At registration time the extension:

- discovers projected skills through `resources_discover`;
- registers the projected skill commands plus OMP-native handlers for the core GSD command surface (including `gsd`, `gsd-status`, `gsd-next`, lifecycle, planning, execution, review, audit, workspace, and fast-path entries);
- registers the discoverable `gsd_invoke` tool with Zod parameters `family`, `subcommand`, `args`, and optional `raw`;
- registers custom GSD message renderers when OMP exposes `registerMessageRenderer` and `pi.Text`;
- registers `Ctrl+Shift+G` and the `--gsd-status` flag when those OMP registration methods exist; and
- registers the OMP event handlers described below.

`/gsd <family> <subcommand> [args]` is a thin programmatic route. The extension parses quote-aware arguments, spawns the resolved `gsd-tools.cjs` with the current project as `cwd`, and returns bounded stdout/stderr in a native message. `gsd_invoke` exposes the same child-process path to structured tool callers. Missing CLI resolution returns a structured unsuccessful result rather than silently invoking another executable.

The extension also invokes selected GSD hook scripts on `tool_call` (`Write`/`Edit`/`Bash` as applicable). Hook subprocesses are bounded and fail open on missing hooks, spawn errors, malformed output, or timeout; a hook may still block a call through its explicit decision. This keeps hook checks from blocking OMP's event loop while preserving their advisory/blocking boundary.

Lifecycle event handling is project-scoped (the extension first checks whether the current directory has a recognizable planning workspace):

- `session_start` schedules one-time onboarding when `response_language` is absent, refreshes status, optionally opens the `--gsd-status` overlay, and shows a workflow-guard reminder.
- `session_switch`, `session_branch`, `session_tree`, and `session_compact` refresh status and clear context-local Goal Mode state where appropriate.
- `auto_compaction_start/end`, `auto_retry_start/end`, and `session_stop` expose transient native runtime signals in status.
- `message_end` extracts pending next-action/checkpoint records from assistant text and persists them in the planning workspace.
- `tool_execution_start/update/end`, `tool_result`, and `tool_call` track native GSD task IDs, progress, failures, settlement, hook decisions, and guarded repository writes.
- `session_shutdown` clears context and project runtime tracking.

## Status surface and optional Goal Mode adapter

`/gsd-status` is the single user-facing GSD status command. Without a control argument it combines a localized project summary with native context usage, compaction/retry/stop signals, running async task counts, and (when available) Goal Mode state. `--compact` asks OMP to compact context after confirmation; `--stop`/`--abort` asks OMP to abort after confirmation. Native session controls accept `--reload`, `--branch ENTRY_ID`, `--tree ENTRY_ID [--summarize]`, and `--switch SESSION_PATH`, subject to confirmation where required.

The same status data feeds the `gsd` widget above the editor and the live overlay opened by `Ctrl+Shift+G` or the `--gsd-status` flag. The overlay refreshes periodically and supports `Esc`/Enter to close and `e` to load the pending next action into OMP's editor. Native task tracking remains internal to the extension; status is the display surface.

Goal Mode is an optional host capability, not a replacement for GSD continuation. The extension attempts to register `goal_updated` inside a guarded `try` block. For each event it accepts either `event.state` or an `event.goal` shape, validates objective/status/token fields, and mirrors the normalized objective, status, token usage/budget, and time usage into status/widget/overlay output. On session start/reload-related state refresh, it can reconstruct the latest state from `sessionManager.getEntries()` by reading the most recent `mode_change` entry with `mode: 'goal'` or `mode: 'goal_paused'`.

When a goal is active (`enabled === true` and goal status `active`), the extension holds a pending GSD continuation rather than competing with OMP's Goal Mode loop. The user should run `/goal pause` or `/goal drop` before running `/gsd-next`; stopping a turn follows OMP's native Goal Mode behavior, while detached native tasks remain tracked. OMP 17 has no `goal_updated` event: registration is caught, and all other commands, status, task tracking, and filesystem integration remain available without the optional Goal Mode display/coordination surface.

## Localization

`src/locale.cjs` handles messages emitted by the shell CLI and EoS bootstrap. It resolves the first non-empty value in this order: `GSD_OMP_LOCALE`, `LC_ALL`, `LC_MESSAGES`, `LANG`. Values whose lowercased form starts with `zh` select `zh-CN`; all other values select `en`. Missing dictionary keys fall back to English, and unknown placeholders remain unchanged.

The in-session extension uses the project planning config's `response_language` instead. On the first interactive session for a project without that field, onboarding offers Simplified Chinese or English and writes the selected value to `.planning/config.json`; the optional interaction-style selection can also write `workflow.text_mode`. This separation prevents a shell locale from unexpectedly changing an already configured project session.

## Tests and host-smoke boundary

Unit tests live under `test/` and exercise installer ownership/manifest safety, EoS negotiation, projection rewriting, extension helpers, and locale selection. `npm test` runs Node's built-in test runner; `npm run lint` runs `node --check` across the CommonJS sources. These are package-level checks and do not prove that a particular installed OMP release accepts the extension API.

`scripts/host-smoke.cjs` is the integration boundary. It creates a temporary `PI_CODING_AGENT_DIR`, installs the package into that isolated root, runs JSON `install`, `doctor`, and `descriptor`, starts OMP in RPC mode against the repository, verifies readiness and representative extension commands (`gsd`, `gsd-next`, `gsd-plan-phase`, `gsd-status`), checks the `gsd_invoke` exposure according to host behavior, and uninstalls the projection. It supplies a placeholder `OPENAI_API_KEY` only for host startup when no key is present; it does not perform a model request.

CI runs the Node 24 unit job (`npm ci`, `npm run lint`, `npm test`) first, then the host-smoke job against OMP `17.0.3` and `latest` with Bun installed. The matrix deliberately keeps Goal Mode optional: the pinned OMP 17 path must remain healthy without `goal_updated`, while newer hosts may expose the additional adapter event. The host smoke test is not a substitute for testing GSD Core's own workflows or OMP's complete native UI.

## Maintainer tracing examples

Inspect the negotiated contract and verify the installed projection without modifying the default profile:

```bash
root="$(mktemp -d)"
PI_CODING_AGENT_DIR="$root" gsd-omp install --json
PI_CODING_AGENT_DIR="$root" gsd-omp descriptor --json
PI_CODING_AGENT_DIR="$root" gsd-omp doctor --json
PI_CODING_AGENT_DIR="$root" gsd-omp uninstall --json
rm -rf "$root"
```

To trace a command from OMP to GSD Core, start OMP in a GSD project and use the programmatic route; the extension will execute the resolved core CLI rather than a global `gsd-tools` on `PATH`:

```text
/gsd query help
/gsd-status
```

To inspect the exact projection implementation, begin at `bin/gsd-omp.cjs:desiredArtifacts()`, follow `buildProjectedArtifacts()` in `src/projection.cjs`, then follow `invokeAsync()` and the `pi.registerCommand()` calls in `src/extension.cjs`.
