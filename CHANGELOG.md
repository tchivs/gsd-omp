# Changelog

All notable changes to `gsd-omp` are recorded here in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) style. The canonical changelog filename is **CHANGELOG.md**. See the [README](README.md) for the current installation and usage documentation.

## [Unreleased]

No unreleased changes recorded.

## [1.0.20] - 2026-08-29

### Added

- Integrated OMP Goal Mode through the optional `goal_updated` event. When the host provides that event, the plugin mirrors the goal objective, status, and token budget in `/gsd-status`, the footer, the widget, and the live status overlay.
- Restored the latest Goal Mode state from the OMP session journal when a session starts or reloads.

### Changed

- Added a continuation guard: while an active Goal Mode objective is running, GSD continuation prompts remain pending so the Goal Mode and GSD continuation loops do not compete. Pause or drop the goal before running `/gsd-next`.
- Kept Goal Mode host-owned and optional. Hosts without `goal_updated`, including OMP 17, retain the rest of the GSD integration and simply omit this optional status surface.

Related: [PR #57](https://github.com/tchivs/gsd-omp/pull/57), [release PR #58](https://github.com/tchivs/gsd-omp/pull/58).

## [1.0.19] - 2026-08-29

### Added

- Deepened native OMP integration around `/gsd-status`, including native controls for context compaction, stopping the current turn, branching and navigating the session tree, switching sessions, and reloading runtime state.
- Added OMP argument completion and session naming where projected skills expose stable parameter contracts.

### Changed

- Unified native task execution, context usage, compaction, retry, and asynchronous job state under the `/gsd-status` status surface, widget, footer, and overlay while keeping native task tracking internal.

Related: [PR #55](https://github.com/tchivs/gsd-omp/pull/55), [release PR #56](https://github.com/tchivs/gsd-omp/pull/56).

## [1.0.18] - 2026-08-29

### Changed

- Refined the OMP status widget layout with visual progress bars and clearer blocker and concern indicators.

Related: [PR #53](https://github.com/tchivs/gsd-omp/pull/53), [release PR #54](https://github.com/tchivs/gsd-omp/pull/54).

## [1.0.17] - 2026-08-29

### Changed

- Kept native task execution internal to the extension and removed the public `/omp-native` command.
- Directed native execution status and continuation guidance to `/gsd-status`; host smoke coverage verifies that `/omp-native` is not exposed.

Related: [PR #51](https://github.com/tchivs/gsd-omp/pull/51), [release PR #52](https://github.com/tchivs/gsd-omp/pull/52).

[Unreleased]: https://github.com/tchivs/gsd-omp/compare/v1.0.20...HEAD
[1.0.20]: https://github.com/tchivs/gsd-omp/releases/tag/v1.0.20
[1.0.19]: https://github.com/tchivs/gsd-omp/releases/tag/v1.0.19
[1.0.18]: https://github.com/tchivs/gsd-omp/releases/tag/v1.0.18
[1.0.17]: https://github.com/tchivs/gsd-omp/releases/tag/v1.0.17
