# Repository Guidelines

## Project Overview

`gsd-omp` is an independently maintained CommonJS host plugin that adapts `@opengsd/gsd-core` to Oh My Pi (OMP). It negotiates GSD Embeddable Orchestration System (EoS) protocol 1, projects GSD agents and skills into an OMP runtime profile, and exposes GSD commands, `gsd_invoke`, status surfaces, and native task/session integrations.

This is a pure Node.js package: there is no transpilation or bundling step. The `npm pack` tarball is the distribution artifact. The package requires Node.js `>=24.0.0` and GSD Core `>=1.11.0` (dependency range `^1.11.0`).

## Architecture & Data Flow

1. **Install and ownership** — `bin/gsd-omp.cjs` resolves the OMP runtime root (`--root` > `PI_CODING_AGENT_DIR` > `~/.omp/agent`), initializes EoS, checks the GSD Core version, builds projected artifacts, and performs a staged install. `.gsd-omp-manifest.json` records SHA-256 ownership so modified or unmanaged files are protected.
2. **EoS contract** — `src/eos.cjs` loads GSD Core's Host-Integration SDK, negotiates protocol `1` with the `programmatic-cli` profile, and caches the imperative OMP adapter, passive model adapter, host hook bus, and filesystem state adapter.
3. **Projection** — `src/projection.cjs` reads GSD Core `agents/`, `skills/`, and `commands/gsd/`. It rewrites runtime paths and `gsd:<name>` references, injects OMP tool/orchestration guidance, and emits artifacts under the selected runtime root's `agents/` and `skills/` directories. Core files remain the source of truth.
4. **OMP extension load** — The generated `extensions/gsd-omp.ts` wrapper loads `src/extension.cjs` and passes the runtime root. The extension factory registers the GSD command surface, `gsd_invoke`, completions, resource discovery, status/widget/overlay integrations, and lifecycle handlers through capability-checked OMP APIs.
5. **Command execution** — `/gsd ...` and `gsd_invoke` resolve the bundled GSD Core `gsd-tools.cjs`, run it with the project as `cwd`, `GSD_RUNTIME=omp`, and the effective `GSD_AGENTS_DIR`, then return bounded output as OMP messages. Hook subprocesses are bounded and fail open unless a hook explicitly blocks a call.
6. **Native runtime state** — OMP owns session lifecycle, model selection, approvals, native tasks, jobs, isolation, compaction, retries, aborts, and session navigation. GSD Core owns its CLI semantics and `.planning/` artifacts. `gsd-omp` translates between those boundaries and feeds project state, native task state, context signals, and Goal Mode state into `/gsd-status`, the widget, footer, and overlay.
7. **Goal Mode** — `goal_updated` is optional. The extension registers it inside a guarded block, validates and caches event state, and can recover the latest goal from the OMP session journal. It does not call private Goal APIs or mutate OMP's GoalRuntime. An active OMP goal holds a pending GSD continuation and instructs the user to pause/drop the goal before `/gsd-next`; OMP 17 remains functional without the event.
8. **Localization** — Shell CLI/EoS messages use `src/locale.cjs` and POSIX environment precedence. In-session extension messages use the project's `response_language`, intentionally keeping shell locale and project session language separate.

## Key Directories

- `bin/` — executable installer/updater and manifest ownership logic.
- `src/` — EoS adapter, OMP extension, artifact projection, localization, and graphify worker.
- `src/locales/` — English and Simplified Chinese message dictionaries.
- `scripts/` — release metadata synchronization and packed OMP host smoke testing.
- `test/` — Node built-in unit and contract tests with temporary-directory fixtures.
- `docs/` — architecture, configuration, development, testing, and getting-started guides.
- `.github/workflows/` — Node unit CI, OMP 17/latest host smoke, upstream drift reporting, and automated release.

## Development Commands

Install dependencies for an editable checkout, or reproduce CI's lockfile install:

```bash
npm install
npm ci
```

Run the package checks:

```bash
npm run lint                         # node --check for all shipped .cjs modules
npm test                             # node --test across test/
node --test test/extension.test.cjs  # focused suite while iterating
```

`prepack` runs lint and tests. To inspect the actual distribution artifact without lifecycle scripts:

```bash
package_tarball="$(npm pack --silent --ignore-scripts)"
npm install --global "./${package_tarball}"
```

Exercise the installer without touching the normal OMP profile:

```bash
root="$(mktemp -d)"
PI_CODING_AGENT_DIR="$root" node bin/gsd-omp.cjs install --json
PI_CODING_AGENT_DIR="$root" node bin/gsd-omp.cjs doctor --json
PI_CODING_AGENT_DIR="$root" node bin/gsd-omp.cjs descriptor --json
PI_CODING_AGENT_DIR="$root" node bin/gsd-omp.cjs uninstall --json
rm -rf "$root"
```

The CLI supports `install`, `update`, `uninstall`, `doctor`, and `descriptor`; no command defaults to `install`. Common options are `--root <path>`, `--force`, and `--json`. Use `doctor --json` before considering `--force`.

For host integration, install the packed package and run both compatibility targets:

```bash
npm install --global "@oh-my-pi/pi-coding-agent@17.0.3"
OMP_VERSION=17.0.3 GSD_OMP_BIN=gsd-omp node scripts/host-smoke.cjs

npm install --global "@oh-my-pi/pi-coding-agent@latest"
OMP_VERSION=latest GSD_OMP_BIN=gsd-omp node scripts/host-smoke.cjs
```

## Code Conventions & Common Patterns

- Keep source modules CommonJS: `require(...)`, `module.exports`, `.cjs`, `'use strict'`, two-space indentation, semicolons, single-quoted strings, and the surrounding files' trailing-comma style. Use `node:` prefixes for new Node built-ins.
- Preserve the existing dependency-injection seams. The extension is a factory receiving `(pi, options)`, CLI operations accept option objects, and test-only helpers are exposed through module exports/`_internals` where needed. Prefer passing dependencies and paths as parameters over adding process-global coupling.
- Treat OMP APIs as optional capabilities. Guard `registerShortcut`, `registerFlag`, renderers, `askDialog`, session APIs, context APIs, and resource discovery with `typeof` checks. Keep fallback paths (for example `select` when `askDialog` is unavailable) and wrap optional `goal_updated` registration so OMP 17 still loads.
- Use bounded async subprocesses and explicit abort/settlement cleanup. `invokeAsync` must honor an already-aborted signal, terminate children cleanly, cap captured output, and settle once. Use OMP-managed timers and native tasks rather than shell backgrounding or a second job system.
- Keep state project- and context-scoped. Native GSD task tracking uses ref-counts and terminal settlement to avoid stale or duplicate counts; clear Goal/session/runtime maps on shutdown, switch, branch, and tree changes. Ignore ordinary non-GSD OMP tasks in GSD status.
- Fail safely at boundaries: return structured errors, preserve user files, clean temporary state in `finally`, and avoid silently falling back to an unrelated global executable. Installer paths must be relative to the selected root, point through regular directories, and reject symlink traversal; `--force` does not bypass path-safety checks.
- Keep localization dictionaries in key and placeholder parity. `src/locale.cjs` uses own-property lookup, English fallback, and unchanged placeholders for missing parameters. Add matching keys to both `src/locales/en.cjs` and `src/locales/zh-CN.cjs`.
- Use `/gsd-status` as the user-facing GSD status entry point. Native task/session mechanisms remain internal integration details; do not add a competing status command when extending the native surface.
- Keep versioned install URLs and release metadata synchronized through `scripts/bump-version.cjs`; update both README files and the relevant guide when user-visible behavior changes. Do not hand-edit generated projected runtime artifacts as a source of truth.

## Important Files

- `package.json` — package entry point, Node/GSD engine requirements, scripts, dependency, packed-file list, and keywords.
- `bin/gsd-omp.cjs` — CLI parsing, runtime-root resolution, install/update/uninstall/doctor/descriptor, manifest validation, hashes, and transactional writes.
- `src/eos.cjs` — cached protocol-v1 EoS negotiation and adapter construction.
- `src/extension.cjs` — OMP extension factory; command/tool registration, child-process bridge, native task tracking, status surfaces, session controls, hooks, localization, and Goal Mode.
- `src/projection.cjs` — deterministic agent/skill projection, path rewriting, command-name conversion, and OMP orchestration text.
- `src/locale.cjs` and `src/locales/*.cjs` — shell/EoS locale selection and dictionaries.
- `src/gsd-graphify-worker.cjs` — detached graphify rebuild worker with lock/status handling.
- `scripts/host-smoke.cjs` — isolated packed-install and OMP RPC compatibility test.
- `scripts/bump-version.cjs` — semver metadata updater for package/lock files, install docs, and `CHANGELOG.md`.
- `test/extension.test.cjs` — primary extension, native OMP, status, task lifecycle, and Goal Mode regression coverage.
- `test/installer.test.cjs`, `test/eos.test.cjs`, `test/projection.test.cjs`, `test/locale.test.cjs`, `test/release-metadata.test.cjs` — focused contract suites for installer safety, EoS, projection, localization, and release synchronization.
- `.github/workflows/ci.yml` and `.github/workflows/release.yml` — required CI matrix and automatic patch release flow.

## Runtime/Tooling Preferences

- Use Node.js `24.x` or newer for development, tests, lint, CLI work, and package operations. Use npm; `package-lock.json` is lockfile version 3. The source is not TypeScript/ESM and has no build command.
- OMP's EoS declaration advertises `runtime: "bun"`; the OMP host is installed separately for smoke tests. The extension still launches the resolved GSD Core CLI through Node child-process APIs.
- `PI_CODING_AGENT_DIR` selects the install/runtime root; `--root` overrides it. Preserve a pre-existing `GSD_AGENTS_DIR`; otherwise use `<runtime-root>/agents`. `GSD_RUNTIME=omp` is an internal child-process bridge setting.
- Shell locale precedence is `GSD_OMP_LOCALE` → `LC_ALL` → `LC_MESSAGES` → `LANG`; supported values normalize to `en` or `zh-CN`. Project-session language comes from `.planning/config.json` `response_language`.
- `GITHUB_TOKEN`/`GH_TOKEN` are process-environment credentials for release lookup during `update`. `OMP_BIN`, `GSD_OMP_BIN`, `OMP_VERSION`, and `OPENAI_API_KEY` are host-smoke controls; the smoke script uses a placeholder key only to start the host and does not make a model request.
- `main` is protected. Work on a descriptive branch, run applicable checks, and use a pull request; CI covers Node 24 plus OMP `17.0.3` and `latest`. The release workflow bumps patch versions, opens/merges a release PR, tags, and publishes the GitHub release.

## Testing & QA

Tests use `node:test` and `node:assert/strict`; there is no external test framework or separate coverage command. Fixtures generally use `fs.mkdtempSync(...)`, isolated runtime/project roots, and cleanup in `finally`, so tests should not depend on a developer's real `~/.omp/agent` or `.planning/` workspace.

The unit/contract suites cover:

- installer ownership, manifest validation, hashes, rollback, stale projections, modified files, directories, and symlink safety;
- protocol-v1 EoS negotiation and declared axes;
- deterministic projection, path rewriting, command rewriting, idempotence, and executor result protocol;
- locale precedence, fallback, own-property behavior, dictionary key parity, and placeholders;
- extension registration, command routing, native renderers, status/context/task/session behavior, abort handling, resource discovery, and Goal Mode event/journal/fallback behavior;
- package/lockfile version and README/Getting Started install URL synchronization.

For extension or installer changes, run `npm run lint`, `npm test`, and the packed host smoke against both OMP `17.0.3` and `latest`. The smoke test creates a temporary runtime root, verifies JSON `install`/`doctor`/`descriptor`, launches OMP in RPC mode, checks readiness and representative commands, validates `gsd_invoke` or the OMP 17 legacy RPC surface, and uninstalls the projection. OMP 17 is expected not to expose `goal_updated`; that absence is a compatibility path, not a failure.

Before opening a PR, also run `git diff --check` and inspect `npm pack --silent --ignore-scripts` contents when packaging or documentation files change. Add a focused regression test in the closest existing suite for each behavior or compatibility boundary changed; do not claim a check passed unless it was actually run.
