# aem-eds-a11y-agent

> Accessibility regression detection and AI-assisted diagnosis for Adobe AEM Edge Delivery Services sites.

![Node 22](https://img.shields.io/badge/node-%3E%3D22-blue)
![License](https://img.shields.io/badge/license-Apache%202.0-lightgrey)

This is a GitHub-native accessibility guardrail for EDS repos. It uses
Playwright and axe-core to scan configured pages, compares results against a
committed baseline, and opens human-review issues for new critical or serious
violations.

It does **not** auto-merge code or create AI-generated accessibility fixes.

## What This Does

1. Runs axe-core against configured EDS pages.
2. Stores a baseline of known violations.
3. Detects newly introduced violations.
4. Fetches recent GitHub commits and diffs.
5. Uses GitHub Models for optional AI-assisted diagnosis.
6. Opens a deduped GitHub issue with rule IDs, selectors, HTML snippets, and recommendations.

## Why This Matters

Enterprise EDS customers have WCAG and legal accessibility requirements, but
accessibility regressions often appear after small block, CSS, or content
changes. This agent catches those regressions in the same GitHub workflow where
developers already review code.

## Setup

```bash
git clone https://github.com/neeraj10raja/aem-eds-a11y-agent
cd aem-eds-a11y-agent
node scripts/install.js --target /path/to/your-eds-repo --paths /,/blog
```

For a custom production domain:

```bash
node scripts/install.js \
  --target /path/to/your-eds-repo \
  --site-url https://www.example.com \
  --paths /,/blog,/products
```

This installs:

```text
a11y-agent/
a11y-agent.config.json
.github/workflows/a11y-regression.yml
.github/baselines/a11y.json
```

## GitHub Setup

1. Enable **Actions read/write workflow permissions**.
2. Run **Accessibility Regression Detection** manually with `update_baseline=true`.
3. Review and commit `.github/baselines/a11y.json`.

The built-in `GITHUB_TOKEN` is used automatically. No personal GitHub token is
needed.

## Configuration

```json
{
  "site_url": "https://www.example.com",
  "paths": ["/", "/products", "/about"],
  "fail_on_impacts": ["critical", "serious"],
  "lookback_hours": 48,
  "default_branch": "main",
  "ai_diagnosis_enabled": true,
  "model": "gpt-4o",
  "fixture_path": null,
  "axe": {
    "tags": ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
    "disabled_rules": []
  },
  "scan": {
    "timeout_ms": 30000,
    "wait_until": "domcontentloaded",
    "post_load_delay_ms": 2000,
    "concurrency": 3,
    "viewport": {
      "width": 1366,
      "height": 900
    }
  },
  "auth": {
    "basic_username_env": null,
    "basic_password_env": null,
    "bearer_token_env": null,
    "cookies_json_env": null
  }
}
```

| Field | Description | Default |
|---|---|---|
| `site_url` | Base URL to scan. Omit for `main--repo--owner.aem.page` | AEM preview URL |
| `paths` | URL paths to scan | `["/"]` |
| `fail_on_impacts` | axe impacts that create issues | `["critical", "serious"]` |
| `ai_diagnosis_enabled` | Send new violations and recent diffs to GitHub Models | `true` |
| `fixture_path` | Local axe fixture for tests/demos | `null` |
| `axe.tags` | axe/WCAG tags to scan | WCAG A/AA + best-practice |
| `axe.disabled_rules` | axe rule IDs to disable with governance approval | `[]` |
| `scan.wait_until` | Playwright page-load event. `domcontentloaded` is safer for analytics-heavy AEM pages | `domcontentloaded` |
| `scan.post_load_delay_ms` | Extra wait after DOM load for late-rendered blocks | `2000` |
| `scan.concurrency` | Number of pages scanned in parallel with one shared browser | `3` |
| `auth.*_env` | Environment variable names for staging auth secrets | `null` |

### Authenticated Scans

For staging or preview environments, store secrets in GitHub Actions secrets and
reference only the environment variable names in config.

```json
{
  "auth": {
    "basic_username_env": "A11Y_BASIC_USER",
    "basic_password_env": "A11Y_BASIC_PASSWORD",
    "bearer_token_env": "A11Y_BEARER_TOKEN",
    "cookies_json_env": "A11Y_COOKIES_JSON"
  }
}
```

`A11Y_COOKIES_JSON` should be a JSON array of Playwright-compatible cookies.
If a cookie omits `url` and `domain`, the agent attaches it to the scanned site
origin.

## Governance Notes

- AI diagnosis sends new violation details, HTML snippets, authored visible copy, selectors, and recent diffs to GitHub Models. This can include internal product names, customer-specific copy, and implementation details.
- Set `ai_diagnosis_enabled` to `false` if your organization does not allow that data sharing.
- Baselines are explicit and committed, so teams can separate known debt from new regressions. The baseline stores all scanned axe violations, then filters issues by `fail_on_impacts` at comparison time.
- Only new violations with configured impacts open issues.
- Disabled axe rules are called out in generated issues so legal/compliance reviewers can see what was intentionally suppressed.
- axe-core rule updates can change results. Review dependency updates and refresh the baseline intentionally.
- This agent opens issues only. It does not make code changes.

## Local Development

```bash
npm install
npm test
npm run lint
npx playwright install chromium
```

Dry run:

```bash
REPO_OWNER=your-org REPO_NAME=your-repo GITHUB_TOKEN=your-token DRY_RUN=true \
  node a11y-agent/index.js
```

Update baseline:

```bash
REPO_OWNER=your-org REPO_NAME=your-repo GITHUB_TOKEN=your-token \
  node a11y-agent/index.js --update-baseline
```

## What The Agent Will Not Do

- It will not merge pull requests.
- It will not create AI-generated code fixes.
- It will not hide existing accessibility debt; it baselines it explicitly.
- It will not run without `GITHUB_TOKEN`.
- It will not send data to GitHub Models when `ai_diagnosis_enabled` is `false`.

## Project Structure

```text
a11y-agent/
├── index.js       # Orchestrator
├── scan.js        # Playwright + axe scanner
├── baseline.js    # Baseline comparison
├── diagnose.js    # GitHub Models diagnosis
├── github-api.js  # GitHub REST client
└── path-utils.js  # Config validation
```

## License

Apache 2.0. See [LICENSE](LICENSE).
