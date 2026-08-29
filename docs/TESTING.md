<!-- generated-by: gsd-doc-writer -->
# Testing

`gsd-omp` uses Node.js's built-in test runner for unit and contract tests, plus an isolated host smoke test that loads the packed package into OMP. The contributor workflow is described in [Development](DEVELOPMENT.md); user-facing verification is in [Getting Started](GETTING-STARTED.md).

## Test framework and setup

The test command in `package.json` is:

```bash
node --test
```

No separate test framework or global setup is required. Install dependencies first with Node.js `>=24.0.0`:

```bash
npm ci
```

The test files are under `test/` and use `node:test` plus `node:assert/strict`. Tests create temporary directories and remove them in cleanup, so they do not require a project `.planning/` directory or a configured OMP profile.

## Running tests

Run the complete unit/contract suite:

```bash
npm test
```

Run syntax checks (the same command used by CI and `prepack`):

```bash
npm run lint
```

Run one focused suite when iterating:

```bash
node --test test/installer.test.cjs
node --test test/eos.test.cjs
node --test test/projection.test.cjs
node --test test/locale.test.cjs
node --test test/extension.test.cjs
```

`test/release-metadata.test.cjs` is included by `npm test` and checks release/version metadata consistency.

## What the unit tests cover

### Installer ownership and rollback

`test/installer.test.cjs` verifies that installation creates the extension, projected agents, skills, and ownership manifest; `doctor` sees a healthy projection; and uninstall removes exactly the owned artifacts. It also covers stale legacy extension cleanup, refusal to overwrite modified or unmanaged files, `--force`-relevant ownership behavior, malformed release metadata, unsafe manifest paths, directory placeholders, symlinked parents, stale projection refresh, and transaction rollback/preservation behavior.

The expected healthy path is protocol version `1`, more than 50 projected artifacts, `doctor.ok === true`, empty `missing`/`modified`, and an uninstall with no skipped paths.

### EoS handshake

`test/eos.test.cjs` checks the OMP binding's protocol-v1 negotiation: profile `programmatic-cli`, imperative adapter, runtime `omp`, passive model routing, host hook bus, filesystem state, native-extension transport, Bun runtime declaration, and no negotiation warnings.

### Projection

`test/projection.test.cjs` checks safe runtime-path rewriting, literal dollar preservation, idempotent skill projection, configured agent-directory use, deterministic artifact filtering/order, command rewriting, and retention of the executor result protocol in projected output.

### Locale

`test/locale.test.cjs` checks the frozen public locale API, `zh*` normalization to `zh-CN`, English fallback, environment precedence (`GSD_OMP_LOCALE` → `LC_ALL` → `LC_MESSAGES` → `LANG`), placeholder interpolation, dictionary fallback, and English/Chinese key and placeholder parity.

### Extension and Goal Mode

`test/extension.test.cjs` exercises native renderers and status updates, continuation choices, resource discovery, context/job status, native session controls, and command registration. Its Goal Mode cases verify that:

- `goal_updated` updates status, widget, objective, and token budget;
- the latest Goal Mode state can be restored from the OMP session journal;
- an active objective keeps the pending GSD continuation action without opening a competing selector;
- stopping GSD reports the active objective rather than falsely claiming the session is idle; and
- rejecting `goal_updated` registration (the OMP 17 behavior) does not prevent the extension from loading its other events and tools.

`test/release-metadata.test.cjs` ensures `package-lock.json` and both README release install/upgrade URLs use the package version.

## Host smoke test

The host test must use a packed global plugin and an OMP host. The same sequence is used by CI:

```bash
npm ci
npm install --global "@oh-my-pi/pi-coding-agent@17.0.3"
package_tarball="$(npm pack --silent --ignore-scripts)"
npm install --global "./${package_tarball}"
GSD_OMP_BIN=gsd-omp OMP_VERSION=17.0.3 node scripts/host-smoke.cjs
```

Repeat the host steps with `@latest` and `OMP_VERSION=latest`:

```bash
npm install --global "@oh-my-pi/pi-coding-agent@latest"
GSD_OMP_BIN=gsd-omp OMP_VERSION=latest node scripts/host-smoke.cjs
```

The script creates an isolated temporary runtime root, so the smoke test does not modify the developer's normal `~/.omp/agent`. It checks:

1. Installer JSON reports protocol `1`, a GSD Core version satisfying the declared `^1.11.0` range, and more than 50 installed artifacts.
2. `doctor --json` reports `ok: true`, profile `programmatic-cli`, and empty `missing`/`modified` arrays.
3. `descriptor --json` reports protocol `1`, profile `programmatic-cli`, native-extension transport, and Bun runtime.
4. OMP reaches `ready` without an `extension_error` and publishes `/gsd`, `/gsd-next`, `/gsd-plan-phase`, and `/gsd-status` from the extension.
5. `gsd_invoke` is discoverable on non-17 hosts (the script retries with an explicit tool list when needed); OMP 17 is allowed its legacy RPC-tools path.
6. Uninstall removes every artifact installed by that smoke run without skipped files.

A successful run ends with output shaped like:

```text
ok host-smoke: OMP 17.0.3 loaded <count> GSD extension commands and <tool surface>
```

The `<tool surface>` is `gsd_invoke` for a host exposing that tool, or `legacy RPC tools` for the OMP 17 compatibility path.

## CI matrix

`.github/workflows/ci.yml` runs on pushes to `main`, pull requests, the scheduled upstream check, and manual dispatch. The jobs are:

| Job | Runtime/host | Commands and purpose |
|---|---|---|
| `unit` | Node.js `24.x` | `npm ci`, `npm run lint`, `npm test` |
| `host-smoke` | Node.js `24.x`, Bun, OMP `17.0.3` and `latest` | `npm ci`, install each OMP version, `npm pack --silent --ignore-scripts`, global packed install, then `node scripts/host-smoke.cjs` |
| `upstream-report` | Scheduled failures only | Opens or updates an upstream-drift issue with the OMP and GSD Core versions and failing smoke context. |

The host matrix is `fail-fast: false`, so pinned and latest compatibility results are reported independently. The smoke job requires the unit job first.

## Diagnosing failures

- **Syntax or unit failure:** run `npm run lint`, then the focused `node --test test/<suite>.test.cjs` command. Read the first failing assertion; the suite names above identify the contract being exercised.
- **Installer/ownership failure:** run `gsd-omp doctor --json` against the same runtime root used for the install. Check `missing`, `modified`, and `root`; do not use `--force` until you have decided whether local edits should be replaced.
- **EoS failure:** run `gsd-omp descriptor --json`. Protocol must be `1` and profile must be `programmatic-cli`; an unsupported GSD Core version or SDK negotiation error points to the installed dependency rather than an OMP session.
- **Projection failure:** inspect the focused projection suite and the generated runtime paths. The installer must keep the manifest inside the selected runtime root and must not follow symlinked parents.
- **OMP 17 host failure:** verify the pinned host was installed as `@oh-my-pi/pi-coding-agent@17.0.3`. Goal Mode is not expected there; absence of `goal_updated` must not be reported as an extension error.
- **Latest host failure:** inspect the RPC frames and `available_commands_update` in the smoke output. The script explicitly retries with `--tools read,write,gsd_invoke` for newer hosts whose default active tool set omits `gsd_invoke`. If both attempts fail, compare the host contract with the assertions in `scripts/host-smoke.cjs`.
- **Network/release failure:** `gsd-omp update` depends on GitHub release metadata. For a local smoke run, install the packed tarball as shown above; this separates package/host failures from release lookup failures.

Do not treat the OMP 17 Goal Mode fallback as a failed test: the required result is a loadable extension with the normal GSD command and status surfaces, without the optional `goal_updated` integration.

## Related guides

- [Development](DEVELOPMENT.md) — packaging and local host validation.
- [Configuration](CONFIGURATION.md) — runtime roots, environment variables, and installer flags.
- [Getting Started](GETTING-STARTED.md) — end-user install and verification.
- [Project README](../README.md) — public commands and compatibility contract.
