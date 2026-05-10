# Changelog

All notable changes to this project will be documented in this file.

## [0.2.1] - 2026-05-10

### Fixed

- Shorten `action.yml` description to fit the GitHub Marketplace 125-character limit. No behavior changes.

## [0.2.0] - 2026-05-10

### Added

- Composite GitHub Action entrypoint via `action.yml`.
- Reusable workflow entrypoint via `.github/workflows/scan.yml`.
- Marketplace branding and package metadata (repository, bugs, homepage, keywords).
- `A11Y_CONFIG_PATH` and `A11Y_BASELINE_PATH` env-var overrides so the composite action can drive file paths from inputs.
- `A11Y_UPDATE_BASELINE` env-var support in addition to the existing `--update-baseline` CLI flag.

### Changed

- Recommended install is now `uses: neeraj10raja/aem-eds-a11y-agent@v1`. The air-gapped installer remains available for enterprises that cannot use third-party actions.

## [0.1.0] - 2026-05-09

### Added

- Initial accessibility regression detection agent.
- Playwright + axe-core scanning of configured EDS pages.
- Committed baseline pattern (`.github/baselines/a11y.json`).
- AI-assisted diagnosis via GitHub Models.
- Air-gapped installer.
