<!-- generated-by: gsd-doc-writer -->
# Getting Started

`gsd-omp` is an Oh My Pi (OMP) host plugin that exposes the GSD orchestration commands, projected agents and skills, and the native OMP status surface in an OMP session.

For the architecture and runtime boundaries, see [Architecture](ARCHITECTURE.md). For the complete environment and flag reference, see [Configuration](CONFIGURATION.md).

## Prerequisites

- Node.js `>=24.0.0`.
- Oh My Pi with native `ExtensionAPI` support. The repository's CI exercises OMP `17.0.3` and `latest`.
- GSD Core `>=1.11.0`. The compatible `@opengsd/gsd-core` dependency (`^1.11.0`) is installed with `gsd-omp`.
- A project directory in which GSD can create its `.planning/` state when you start a GSD workflow.

## Installation

Install the released plugin globally. Version `1.0.20` is the current release described by this repository:

```bash
npm install --global https://github.com/tchivs/gsd-omp/archive/refs/tags/v1.0.20.tar.gz
```

If OMP is not already installed, install a host version covered by the compatibility checks (the pinned fallback is OMP `17.0.3`):

```bash
npm install --global "@oh-my-pi/pi-coding-agent@17.0.3"
```

Set `PI_CODING_AGENT_DIR` before projection when you want a non-default OMP runtime root. Without it, the installer uses `~/.omp/agent`.

```bash
export PI_CODING_AGENT_DIR="$HOME/.omp/agent"
gsd-omp install
```

`gsd-omp install` writes the managed extension, projected GSD agents and skills, and `.gsd-omp-manifest.json` below that runtime root. If `GSD_AGENTS_DIR` is already set, the in-session extension preserves that value; otherwise it exposes `<runtime-root>/agents` to GSD Core so agent discovery uses the projected files.

Restart OMP after installation. OMP loads the extension at session startup, so an existing session does not automatically acquire the new commands.

## First run

1. Start or restart OMP in a GSD project.
2. Check the integration from the shell:

   ```bash
   gsd-omp doctor
   gsd-omp descriptor
   ```

3. In OMP, inspect the project and choose the next action:

   ```text
   /gsd-status
   /gsd-next
   ```

A healthy `doctor` result reports `"ok": true`, profile `programmatic-cli`, protocol version `1`, and no missing or modified files. `descriptor` reports the same protocol/profile contract without inspecting a particular project.

## OMP compatibility and Goal Mode

The plugin's core integration works on both OMP `17.0.3` and `latest` as exercised by CI. OMP `17.0.3` is the pinned fallback when a newer host introduces an incompatible extension change.

Goal Mode is optional host capability, not a prerequisite:

- Hosts that emit OMP's `goal_updated` event (newer hosts, including a compatible `latest`) are mirrored in `/gsd-status`, the footer, widget, and overlay. The latest state can be restored from the OMP session journal.
- OMP `17.0.3` has no `goal_updated` event. The extension catches that registration failure and keeps commands, tools, status, projection, and the rest of the GSD integration active.
- While a Goal Mode objective is active, `gsd-omp` leaves the pending GSD next action in place and does not start a competing continuation loop. Run `/goal pause` or `/goal drop`, then run `/gsd-next`.

The plugin does not take over OMP's GoalRuntime; it only consumes the optional event and session-journal state when the host provides them.

## Upgrade

The update command checks the latest GitHub release, globally installs its tarball, and re-projects the managed files:

```bash
gsd-omp update
```

Restart OMP after a successful update. If the release check cannot reach GitHub, use the explicit release URL and re-project:

```bash
gsd-omp uninstall
npm install --global https://github.com/tchivs/gsd-omp/archive/refs/tags/v1.0.20.tar.gz
gsd-omp install
```

The update upgrades the plugin's bundled GSD Core dependency. It does not update an OMP-managed engine tree; use OMP's own update path for the host itself.

## Uninstall

Remove managed projections before removing the global installer:

```bash
gsd-omp uninstall
npm uninstall --global gsd-omp
```

The installer is ownership-aware. It preserves files that were changed after installation and reports them as skipped. To intentionally replace or remove a modified GSD-owned projection, pass `--force`:

```bash
gsd-omp install --force
gsd-omp uninstall --force
```

Use `--force` only when the local changes are disposable.

## Common troubleshooting

### `doctor` reports missing or modified files

Run the JSON form to see the exact runtime root and paths:

```bash
gsd-omp doctor --json
```

Confirm that `PI_CODING_AGENT_DIR` is the same value used during installation, then restart OMP. A modified managed file is intentionally not overwritten; inspect or preserve the local edit, or deliberately re-project with `gsd-omp install --force`.

### GSD reports that agents are missing

`PI_CODING_AGENT_DIR` controls where the installer writes projections, while `GSD_AGENTS_DIR` controls where GSD Core searches. If you manage the projection yourself, export the agents directory before starting OMP:

```bash
export GSD_AGENTS_DIR="${PI_CODING_AGENT_DIR:-$HOME/.omp/agent}/agents"
```

Then restart OMP and run `/gsd-status` again. Do not point `GSD_AGENTS_DIR` at a directory that does not contain the projected `gsd-*.md` files.

### Goal Mode commands or status are unavailable

This is expected on OMP `17.0.3`: Goal Mode is optional and depends on `goal_updated`. The GSD commands remain usable; run `/gsd-status` and `/gsd-next` normally. On a newer host, pause or drop an active objective before asking GSD to continue:

```text
/goal pause
/gsd-next
```

### `update` cannot check a release

The update command uses the GitHub release metadata. If that check fails, follow the manual uninstall/install sequence above, then run `gsd-omp doctor` and restart OMP.

### The extension is not visible after installing

OMP reads extensions at startup. Restart OMP, confirm `gsd-omp install` targeted the intended `PI_CODING_AGENT_DIR`, and use `gsd-omp descriptor` to confirm the local CLI's protocol declaration.

## Next steps

- [Configuration](CONFIGURATION.md) — environment variables, CLI flags, ownership, and Goal Mode coordination.
- [Architecture](ARCHITECTURE.md) — module boundaries, projection, and OMP integration.
- [Development](DEVELOPMENT.md) — local changes, packaging, and host smoke checks.
- [Testing](TESTING.md) — unit tests, host validation, CI matrix, and failure diagnosis.
- [Project README](../README.md) — command catalog and EoS contract.
