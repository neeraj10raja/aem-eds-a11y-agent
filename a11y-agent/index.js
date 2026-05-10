import {
  existsSync, readFileSync,
} from 'fs';
import { createHash } from 'crypto';
import { pathToFileURL } from 'url';
import { loadBaseline, saveBaseline, detectRegressions } from './baseline.js';
import { diagnose } from './diagnose.js';
import {
  checkOpenIssues,
  createIssue,
  getCommitDiff,
  getRecentCommits,
} from './github-api.js';
import { scanPages } from './scan.js';
import { validatePaths } from './path-utils.js';

const DEFAULT_CONFIG_PATH = 'a11y-agent.config.json';
const DEFAULT_BASELINE_PATH = '.github/baselines/a11y.json';
const A11Y_LABEL = 'a11y-regression';

function configPath() {
  return process.env.A11Y_CONFIG_PATH || DEFAULT_CONFIG_PATH;
}

function baselinePath() {
  return process.env.A11Y_BASELINE_PATH || DEFAULT_BASELINE_PATH;
}

const DEFAULT_CONFIG = {
  site_url: null,
  paths: ['/'],
  fail_on_impacts: ['critical', 'serious'],
  lookback_hours: 48,
  default_branch: 'main',
  ai_diagnosis_enabled: true,
  model: 'gpt-4o',
  fixture_path: null,
  axe: {
    tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
    disabled_rules: [],
  },
  scan: {
    timeout_ms: 30000,
    wait_until: 'domcontentloaded',
    post_load_delay_ms: 2000,
    concurrency: 3,
    viewport: {
      width: 1366,
      height: 900,
    },
  },
  auth: {
    basic_username_env: null,
    basic_password_env: null,
    bearer_token_env: null,
    cookies_json_env: null,
  },
};

function loadConfig() {
  const path = configPath();
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}. Run scripts/install.js or copy a11y-agent.config.example.json.`);
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const merged = {
    ...DEFAULT_CONFIG,
    ...parsed,
    axe: {
      ...DEFAULT_CONFIG.axe,
      ...(parsed.axe ?? {}),
    },
    scan: {
      ...DEFAULT_CONFIG.scan,
      ...(parsed.scan ?? {}),
      viewport: {
        ...DEFAULT_CONFIG.scan.viewport,
        ...(parsed.scan?.viewport ?? {}),
      },
    },
    auth: {
      ...DEFAULT_CONFIG.auth,
      ...(parsed.auth ?? {}),
    },
  };
  merged.paths = validatePaths(merged.paths);
  return merged;
}

function buildContext() {
  const owner = process.env.REPO_OWNER;
  const repo = process.env.REPO_NAME;
  const token = process.env.GITHUB_TOKEN;
  const dryRun = process.env.DRY_RUN === 'true';

  if (!owner || !repo || !token) {
    throw new Error('REPO_OWNER, REPO_NAME, and GITHUB_TOKEN env vars are required');
  }
  return {
    owner, repo, token, dryRun,
  };
}

function buildSiteBase(config, owner, repo) {
  const configured = config.site_url || `https://${config.default_branch}--${repo}--${owner}.aem.page`;
  return configured.replace(/\/$/, '');
}

function issueFingerprint(regression) {
  const parts = regression.scan_failed
    ? ['scan_failed']
    : (regression.new_violations ?? [])
      .map((violation) => `${violation.id}|${(violation.target ?? []).join(' ')}`)
      .sort();
  const input = parts.length > 0 ? parts.join('\n') : 'no-details';
  return createHash('sha1').update(input).digest('hex').slice(0, 7);
}

function issueTitleFor(regression) {
  const path = new URL(regression.url).pathname;
  const prefix = regression.scan_failed
    ? 'a11y: accessibility scan failed'
    : 'a11y: new accessibility violations';
  return `${prefix} on ${path} [${issueFingerprint(regression)}]`;
}

function impactSummary(counts) {
  return ['critical', 'serious', 'moderate', 'minor']
    .map((impact) => `${impact}: ${counts?.[impact] ?? 0}`)
    .join(', ');
}

function violationTable(violations) {
  if (!violations?.length) return 'No axe violations were captured.';
  const rows = violations.slice(0, 20).map((violation) => (
    `| ${violation.impact} | ${violation.id} | ${violation.help} | \`${(violation.target ?? []).join(' ')}\` |`
  ));
  return [
    '| Impact | Rule | Help | Target |',
    '|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function disabledRulesNote(config) {
  const disabledRules = config.axe?.disabled_rules ?? [];
  if (disabledRules.length === 0) return '';
  return `\n### Configuration Notes\n\nDisabled axe rules: ${disabledRules.map((rule) => `\`${rule}\``).join(', ')}\n`;
}

function buildIssueBody(regression, diagnosisResult, config = {}) {
  let body = regression.scan_failed
    ? '## Accessibility Scan Failed\n\n'
    : '## Accessibility Regression Detected\n\n';
  body += `URL: ${regression.url}\n\n`;
  if (regression.scan_failed) {
    body += `Scan error: \`${regression.scan_error}\`\n\n`;
    body += 'The workflow continued for the remaining pages, but coverage is partial until this URL can be scanned successfully.\n\n';
  }
  body += `New violations: **${regression.new_violation_count}**\n`;
  body += `Current total violations: **${regression.current_violation_count}**\n`;
  body += `Baseline total violations: **${regression.baseline_violation_count ?? 'n/a'}**\n`;
  body += `Impact summary: ${impactSummary(regression.counts_by_impact)}\n\n`;
  body += '### New Violations\n\n';
  body += `${violationTable(regression.new_violations)}\n\n`;
  body += disabledRulesNote(config);
  body += '### AI Diagnosis\n\n';
  body += `- Summary: ${diagnosisResult.summary}\n`;
  body += `- Root cause: ${diagnosisResult.rootCause}\n`;
  body += `- Confidence: ${diagnosisResult.confidence}\n`;
  if (diagnosisResult.recommendations?.length) {
    body += '- Recommendations:\n';
    diagnosisResult.recommendations.forEach((recommendation) => {
      body += `  - ${recommendation}\n`;
    });
  }
  body += '\n---\n*Generated by aem-eds-a11y-agent. Human review required before closing.*';
  return body;
}

async function diagnoseRegression(regression, commits, diffs, config, token) {
  if (regression.scan_failed) {
    return {
      summary: 'The page could not be scanned, so axe could not evaluate accessibility rules for this URL.',
      rootCause: 'scan failure',
      confidence: 'medium',
      recommendations: [
        'Confirm the URL is reachable from GitHub Actions.',
        'Check staging authentication, redirects, and scan timeout settings.',
        'Re-run the workflow after the page can load successfully.',
      ],
    };
  }

  if (config.ai_diagnosis_enabled === false) {
    return {
      summary: 'AI diagnosis disabled by configuration.',
      rootCause: 'unknown',
      confidence: 'low',
      recommendations: [],
    };
  }

  try {
    return await diagnose(regression, commits, diffs, token, config.model, config.lookback_hours);
  } catch (err) {
    console.error(`[diagnose] Failed: ${err.message}`);
    return {
      summary: 'AI diagnosis unavailable.',
      rootCause: 'unknown',
      confidence: 'low',
      recommendations: [],
    };
  }
}

async function openRegressionIssue(regression, diagnosisResult, context, config) {
  const {
    owner, repo, token, dryRun,
  } = context;
  const title = issueTitleFor(regression);
  const alreadyOpen = await checkOpenIssues(owner, repo, { label: A11Y_LABEL, title }, token);
  if (alreadyOpen) {
    console.log(`[a11y-agent] Open issue already exists: "${title}"`);
    return;
  }

  if (dryRun) {
    console.log(`[DRY RUN] Would open issue: "${title}"`);
    return;
  }

  const issue = await createIssue(owner, repo, {
    title,
    body: buildIssueBody(regression, diagnosisResult, config),
    labels: [A11Y_LABEL],
  }, token);
  console.log(`[a11y-agent] Issue created: ${issue.url}`);
}

async function main() {
  const config = loadConfig();
  const context = buildContext();
  const {
    owner, repo, token, dryRun,
  } = context;
  const siteBase = buildSiteBase(config, owner, repo);
  const updateBaseline = process.argv.includes('--update-baseline')
    || process.env.A11Y_UPDATE_BASELINE === 'true';
  const baselineFile = baselinePath();

  console.log(`[a11y-agent] site=${siteBase} paths=${config.paths.join(',')}${dryRun ? ' DRY_RUN' : ''}`);
  const pageResults = await scanPages(siteBase, config.paths, config);
  pageResults.forEach((page) => {
    if (page.scan_failed) {
      console.log(`[axe] ${page.url} scan_failed="${page.error}"`);
      return;
    }
    console.log(`[axe] ${page.url} violations=${page.violation_count} rawRules=${page.raw_violation_count}`);
  });

  if (updateBaseline) {
    saveBaseline(baselineFile, pageResults);
    console.log(`[a11y-agent] Baseline updated. Commit ${baselineFile} to persist.`);
    return;
  }

  const baseline = loadBaseline(baselineFile);
  if (Object.keys(baseline).length === 0) {
    console.log('[a11y-agent] No baseline found — saving current accessibility state.');
    if (!dryRun) saveBaseline(baselineFile, pageResults);
    console.log(`[a11y-agent] Commit ${baselineFile} to start tracking regressions.`);
    return;
  }

  const regressions = detectRegressions(pageResults, baseline, config);
  if (regressions.length === 0) {
    console.log('[a11y-agent] No new accessibility regressions detected.');
    return;
  }

  console.log(`[a11y-agent] ${regressions.length} page(s) with new accessibility regression(s).`);
  const since = new Date(Date.now() - config.lookback_hours * 3_600_000).toISOString();
  const commits = await getRecentCommits(owner, repo, since, token);
  const diffs = await Promise.all(
    commits.map((commit) => getCommitDiff(owner, repo, commit.sha, token)),
  );

  for (const regression of regressions) {
    const diagnosisResult = await diagnoseRegression(regression, commits, diffs, config, token);
    await openRegressionIssue(regression, diagnosisResult, context, config);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[a11y-agent] Fatal: ${err.message}`);
    process.exit(1);
  });
}

export {
  DEFAULT_CONFIG,
  buildIssueBody,
  buildSiteBase,
  buildContext,
  impactSummary,
  issueFingerprint,
  issueTitleFor,
  loadConfig,
  main,
  violationTable,
};
