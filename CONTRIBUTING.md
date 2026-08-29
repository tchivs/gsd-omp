# Contributing to gsd-omp

Thank you for contributing to `gsd-omp`, an MIT-licensed, independently maintained Oh My Pi host plugin for the GSD Embeddable Orchestration System. See [LICENSE](LICENSE) for the full license text.

## Development environment

- Node.js `>=24.0.0` is required.
- The package is CommonJS and depends on `@opengsd/gsd-core` `^1.11.0`.
- Oh My Pi with native ExtensionAPI support is needed for host integration work and the host smoke test.

Clone the repository and install its development dependency:

```bash
git clone https://github.com/tchivs/gsd-omp.git
cd gsd-omp
npm install
```

## Required checks

Run all required local checks before opening a pull request:

```bash
npm run lint
npm test
```

Run the host smoke test against both OMP versions exercised by CI (`17.0.3` and `latest`). The following reproduces the CI setup for a local checkout without writing to the normal OMP profile:

```bash
package_tarball="$(npm pack --silent --ignore-scripts)"
npm install --global "@oh-my-pi/pi-coding-agent@17.0.3"
npm install --global "./${package_tarball}"
OMP_VERSION=17.0.3 GSD_OMP_BIN=gsd-omp node scripts/host-smoke.cjs

npm install --global "@oh-my-pi/pi-coding-agent@latest"
OMP_VERSION=latest GSD_OMP_BIN=gsd-omp node scripts/host-smoke.cjs
```

The smoke script creates and removes its own temporary `PI_CODING_AGENT_DIR`. `npm pack` produces a local tarball; do not commit that file.

## Branches and pull requests

- Branch from `main`, which is the repository's integration branch.
- No formal branch-name policy is documented. Existing branches use short descriptive prefixes such as `feat/`, `fix/`, `docs/`, and `chore/`; follow that pattern where it makes the purpose clear.
- Keep each pull request focused. Describe the behavior or contract that changed, identify any compatibility considerations, and include the commands you ran and their results.
- Run `npm run lint`, `npm test`, and the applicable OMP host smoke checks before requesting review. Do not report a check as passing unless it was run.
- Update the relevant documentation when commands, installation, configuration, supported hosts, or user-visible behavior changes. Link related issues or pull requests when one exists.
- There is no repository-published reviewer, approval-count, or commit-message policy. Use the GitHub pull request process and respond to the feedback recorded on the pull request.

## Code style and repository hygiene

- Keep the project CommonJS: use `require(...)`, `module.exports`, and the existing `.cjs` module layout.
- When importing a Node.js built-in in new code, use the `node:` prefix (for example, `require('node:fs')` or `require('node:path')`).
- Follow the surrounding style: two-space indentation, semicolons, single-quoted JavaScript strings, and trailing commas where the surrounding code uses them.
- Preserve the OMP ExtensionAPI and GSD Host-Integration SDK contracts. Prefer the existing interfaces and patterns over introducing a second integration path.
- Do not commit generated or local dependency artifacts, including `node_modules/`, `*.tgz`, or coverage output. These paths are ignored by the repository.

## Documentation

Keep the English and Chinese project entry points aligned when a user-visible change affects installation or usage:

- [README.md](README.md) for the English overview and command reference.
- [README.zh-CN.md](README.zh-CN.md) for the Chinese overview and command reference.
- The linked guides under [`docs/`](docs/) for development, testing, architecture, configuration, and getting-started details.
- [CHANGELOG.md](CHANGELOG.md), the canonical release history, for released behavior.

Examples, commands, version requirements, environment-variable names, and links in documentation must match the current source and workflows.

## Security issues

Do not disclose vulnerability details, credentials, or an exploit proof in a public issue or pull request. This repository does not currently contain a `SECURITY.md` file or document a private reporting endpoint. Check the repository's GitHub **Security** tab for a private vulnerability-reporting option and use it only if the repository currently offers one. If no private route is available, contact the maintainer through a private contact route shown by the repository or owner at the time; do not publish sensitive details while waiting for instructions.

A private report should include the affected version or commit, impact, reproduction steps or a minimal proof of concept, relevant Node.js/OMP versions, and any suggested mitigation. Remove secrets and personal data before sending it.
