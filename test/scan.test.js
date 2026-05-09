import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBrowserContextOptions,
  flattenViolations,
  loadFixtureResults,
  normalizeCookies,
  normalizeAxeResult,
  runWithConcurrency,
} from '../a11y-agent/scan.js';

test('flattenViolations keeps all impacts and flattens nodes', () => {
  const violations = flattenViolations([{
    id: 'image-alt',
    impact: 'critical',
    help: 'Images must have alternate text',
    helpUrl: 'https://example.com/rule',
    nodes: [{ target: ['img'], html: '<img>', failureSummary: 'missing alt' }],
  }, {
    id: 'region',
    impact: 'moderate',
    help: 'Use landmarks',
    nodes: [{ target: ['div'] }],
  }]);

  assert.equal(violations.length, 2);
  assert.equal(violations[0].id, 'image-alt');
  assert.equal(violations[1].id, 'region');
  assert.deepEqual(violations[0].target, ['img']);
});

test('normalizeAxeResult returns agent page result shape', () => {
  const result = normalizeAxeResult('https://example.com/', {
    violations: [{
      id: 'color-contrast',
      impact: 'serious',
      help: 'Contrast',
      nodes: [{ target: ['.cta'], html: '<a>Buy</a>', failureSummary: 'low contrast' }],
    }],
    passes: [{ id: 'document-title' }],
    incomplete: [],
  });

  assert.equal(result.source, 'axe');
  assert.equal(result.violation_count, 1);
  assert.equal(result.raw_violation_count, 1);
  assert.equal(result.passes_count, 1);
});

test('loadFixtureResults loads local axe sample data', () => {
  const results = loadFixtureResults('https://example.com', ['/'], {
    fixture_path: 'test/fixtures/axe-sample.json',
    fail_on_impacts: ['critical', 'serious'],
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].source, 'axe-fixture');
  assert.equal(results[0].violation_count, 3);
  assert.equal(results[0].raw_violation_count, 3);
});

test('buildBrowserContextOptions reads auth values from environment variables', () => {
  process.env.A11Y_USER = 'preview-user';
  process.env.A11Y_PASSWORD = 'preview-password';
  process.env.A11Y_BEARER = 'token-123';
  try {
    const options = buildBrowserContextOptions({
      scan: { viewport: { width: 1024, height: 768 } },
      auth: {
        basic_username_env: 'A11Y_USER',
        basic_password_env: 'A11Y_PASSWORD',
        bearer_token_env: 'A11Y_BEARER',
      },
    });

    assert.deepEqual(options.viewport, { width: 1024, height: 768 });
    assert.deepEqual(options.httpCredentials, {
      username: 'preview-user',
      password: 'preview-password',
    });
    assert.deepEqual(options.extraHTTPHeaders, {
      Authorization: 'Bearer token-123',
    });
  } finally {
    delete process.env.A11Y_USER;
    delete process.env.A11Y_PASSWORD;
    delete process.env.A11Y_BEARER;
  }
});

test('normalizeCookies adds scanned origin when cookie has no scope', () => {
  const cookies = normalizeCookies(JSON.stringify([{
    name: 'preview',
    value: 'ok',
  }]), 'https://preview.example.com/products');

  assert.deepEqual(cookies, [{
    name: 'preview',
    value: 'ok',
    url: 'https://preview.example.com',
  }]);
});

test('runWithConcurrency preserves result order', async () => {
  const results = await runWithConcurrency([3, 1, 2], 2, async (value) => value * 10);

  assert.deepEqual(results, [30, 10, 20]);
});
