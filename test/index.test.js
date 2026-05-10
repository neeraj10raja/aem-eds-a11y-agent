import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_CONFIG,
  buildIssueBody,
  buildSiteBase,
  impactSummary,
  issueFingerprint,
  issueTitleFor,
  loadConfig,
  violationTable,
} from '../a11y-agent/index.js';

const regression = {
  url: 'https://example.com/products',
  new_violation_count: 1,
  current_violation_count: 3,
  baseline_violation_count: 2,
  counts_by_impact: {
    critical: 1,
    serious: 2,
  },
  new_violations: [{
    id: 'color-contrast',
    impact: 'serious',
    help: 'Elements must meet minimum color contrast ratio thresholds',
    target: ['.cta'],
    html: '<a class="cta">Buy now</a>',
    failure_summary: 'Insufficient contrast',
    help_url: 'https://dequeuniversity.com/rules/axe/color-contrast',
  }],
};

test('DEFAULT_CONFIG is human-review only and enterprise safe', () => {
  assert.equal(DEFAULT_CONFIG.ai_diagnosis_enabled, true);
  assert.deepEqual(DEFAULT_CONFIG.fail_on_impacts, ['critical', 'serious']);
  assert.equal(DEFAULT_CONFIG.scan.wait_until, 'domcontentloaded');
  assert.equal(DEFAULT_CONFIG.scan.post_load_delay_ms, 2000);
  assert.equal(DEFAULT_CONFIG.scan.concurrency, 3);
});

test('buildSiteBase uses configured site or AEM preview convention', () => {
  assert.equal(buildSiteBase({ site_url: 'https://www.example.com/' }, 'owner', 'repo'), 'https://www.example.com');
  assert.equal(buildSiteBase({ default_branch: 'main' }, 'owner', 'repo'), 'https://main--repo--owner.aem.page');
});

test('issueTitleFor dedupes by page path and violation fingerprint', () => {
  assert.match(issueTitleFor(regression), /^a11y: new accessibility violations on \/products \[[a-f0-9]{7}\]$/);
});

test('issueFingerprint is stable across violation order', () => {
  const first = {
    ...regression,
    new_violations: [
      { id: 'image-alt', target: ['img.hero'] },
      { id: 'color-contrast', target: ['.cta'] },
    ],
  };
  const second = {
    ...regression,
    new_violations: [
      { id: 'color-contrast', target: ['.cta'] },
      { id: 'image-alt', target: ['img.hero'] },
    ],
  };

  assert.equal(issueFingerprint(first), issueFingerprint(second));
});

test('issueTitleFor separates different violations on the same page', () => {
  const imageAlt = {
    ...regression,
    new_violations: [{ id: 'image-alt', target: ['img.hero'] }],
  };
  const contrast = {
    ...regression,
    new_violations: [{ id: 'color-contrast', target: ['.cta'] }],
  };

  assert.notEqual(issueTitleFor(imageAlt), issueTitleFor(contrast));
});

test('impactSummary renders missing impact counts as zero', () => {
  assert.equal(impactSummary({ critical: 1 }), 'critical: 1, serious: 0, moderate: 0, minor: 0');
});

test('violationTable includes rule and target', () => {
  const table = violationTable(regression.new_violations);

  assert.match(table, /color-contrast/);
  assert.match(table, /\.cta/);
});

test('buildIssueBody includes violation details, disabled rules, and diagnosis', () => {
  const body = buildIssueBody(regression, {
    summary: 'CTA contrast is too low.',
    rootCause: 'abc123 blocks/cta/cta.css',
    confidence: 'high',
    recommendations: ['Increase foreground/background contrast.'],
  }, {
    axe: {
      disabled_rules: ['region'],
    },
  });

  assert.match(body, /Accessibility Regression Detected/);
  assert.match(body, /CTA contrast is too low/);
  assert.match(body, /color-contrast/);
  assert.match(body, /Disabled axe rules: `region`/);
  assert.match(body, /Human review required/);
});

test('loadConfig reads A11Y_CONFIG_PATH when provided by the action', () => {
  const dir = mkdtempSync(join(tmpdir(), 'a11y-agent-config-'));
  const file = join(dir, 'custom.config.json');
  writeFileSync(file, JSON.stringify({ paths: ['/custom'], lookback_hours: 12 }));
  process.env.A11Y_CONFIG_PATH = file;

  try {
    const config = loadConfig();
    assert.deepEqual(config.paths, ['/custom']);
    assert.equal(config.lookback_hours, 12);
    assert.equal(config.scan.wait_until, DEFAULT_CONFIG.scan.wait_until);
  } finally {
    delete process.env.A11Y_CONFIG_PATH;
  }
});

test('buildIssueBody makes scan failures explicit', () => {
  const body = buildIssueBody({
    url: 'https://example.com/private',
    scan_failed: true,
    scan_error: 'Timeout 30000ms exceeded',
    new_violation_count: 0,
    current_violation_count: 0,
    baseline_violation_count: 2,
    counts_by_impact: {},
    new_violations: [],
  }, {
    summary: 'The page could not be scanned.',
    rootCause: 'scan failure',
    confidence: 'medium',
    recommendations: [],
  });

  assert.match(body, /Accessibility Scan Failed/);
  assert.match(body, /coverage is partial/);
  assert.match(body, /Timeout 30000ms exceeded/);
});
