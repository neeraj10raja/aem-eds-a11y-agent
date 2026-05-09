import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  countByImpact,
  detectRegressions,
  loadBaseline,
  saveBaseline,
  violationFingerprint,
} from '../a11y-agent/baseline.js';

const violation = {
  id: 'image-alt',
  impact: 'critical',
  target: ['img.hero'],
  failure_summary: 'missing alt',
};

test('loadBaseline returns empty object when missing or invalid', () => {
  assert.deepEqual(loadBaseline('/missing/a11y.json'), {});
});

test('violationFingerprint is stable for rule, impact, and target', () => {
  assert.equal(
    violationFingerprint(violation),
    'image-alt|critical|img.hero',
  );
});

test('violationFingerprint ignores volatile axe failure summary text', () => {
  assert.equal(
    violationFingerprint(violation),
    violationFingerprint({
      ...violation,
      failure_summary: 'wording changed in a later axe version',
    }),
  );
});

test('saveBaseline writes violation fingerprints keyed by URL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'a11y-agent-'));
  const file = join(dir, 'a11y.json');

  saveBaseline(file, [{
    url: 'https://example.com/',
    violations: [violation],
    timestamp: '2026-05-09T00:00:00.000Z',
  }]);

  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(saved['https://example.com/'].violation_fingerprints, [
    violationFingerprint(violation),
  ]);
});

test('saveBaseline skips failed scans instead of overwriting good baseline data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'a11y-agent-'));
  const file = join(dir, 'a11y.json');

  saveBaseline(file, [{
    url: 'https://example.com/',
    scan_failed: true,
    error: 'Timeout',
    violations: [],
    timestamp: '2026-05-09T00:00:00.000Z',
  }]);

  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {});
});

test('detectRegressions reports only new configured-impact violations', () => {
  const current = [{
    url: 'https://example.com/',
    source: 'axe',
    violations: [
      violation,
      {
        id: 'region',
        impact: 'moderate',
        target: ['main'],
        failure_summary: 'landmark',
      },
    ],
    timestamp: '2026-05-09T00:00:00.000Z',
  }];

  const regressions = detectRegressions(current, {}, {
    fail_on_impacts: ['critical', 'serious'],
  });

  assert.equal(regressions.length, 1);
  assert.equal(regressions[0].new_violation_count, 1);
  assert.equal(regressions[0].new_violations[0].id, 'image-alt');
});

test('detectRegressions reports scan failures as visible coverage issues', () => {
  const regressions = detectRegressions([{
    url: 'https://example.com/products',
    source: 'axe',
    scan_failed: true,
    error: 'Timeout 30000ms exceeded',
    timestamp: '2026-05-09T00:00:00.000Z',
  }], {
    'https://example.com/products': {
      violation_count: 4,
    },
  }, {
    fail_on_impacts: ['critical'],
  });

  assert.equal(regressions.length, 1);
  assert.equal(regressions[0].scan_failed, true);
  assert.equal(regressions[0].scan_error, 'Timeout 30000ms exceeded');
  assert.equal(regressions[0].baseline_violation_count, 4);
});

test('detectRegressions ignores violations already in baseline', () => {
  const regressions = detectRegressions([{
    url: 'https://example.com/',
    source: 'axe',
    violations: [violation],
    timestamp: '2026-05-09T00:00:00.000Z',
  }], {
    'https://example.com/': {
      violation_fingerprints: [violationFingerprint(violation)],
      violation_count: 1,
    },
  }, {
    fail_on_impacts: ['critical'],
  });

  assert.deepEqual(regressions, []);
});

test('countByImpact groups violations by impact', () => {
  assert.deepEqual(countByImpact([
    { impact: 'critical' },
    { impact: 'critical' },
    { impact: 'serious' },
  ]), {
    critical: 2,
    serious: 1,
  });
});
