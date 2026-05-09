import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPrompt,
  diagnose,
  normalizeDiagnosis,
} from '../a11y-agent/diagnose.js';

const regression = {
  url: 'https://example.com/',
  new_violation_count: 1,
  current_violation_count: 2,
  baseline_violation_count: 1,
  new_violations: [{
    id: 'image-alt',
    impact: 'critical',
    help: 'Images must have alternate text',
    target: ['img.hero'],
    html: '<img class="hero">',
    failure_summary: 'Element does not have an alt attribute',
    help_url: 'https://dequeuniversity.com/rules/axe/image-alt',
  }],
};

test('buildPrompt includes new axe violations and recent diffs', () => {
  const prompt = buildPrompt(regression, [{
    sha: 'abcdef123',
    author: 'Test User',
    date: '2026-05-09T00:00:00Z',
    message: 'Update hero block',
  }], [{
    diff: 'diff --git a/blocks/hero/hero.js b/blocks/hero/hero.js',
    truncated: false,
  }], 24);

  assert.match(prompt, /Accessibility Regression/);
  assert.match(prompt, /image-alt/);
  assert.match(prompt, /img\.hero/);
  assert.match(prompt, /last 24h/);
});

test('normalizeDiagnosis keeps safe defaults', () => {
  const result = normalizeDiagnosis({
    summary: 'Hero image lacks alt text.',
    rootCause: 'abc123 blocks/hero/hero.js',
    confidence: 'high',
    recommendations: ['Add meaningful alt text from authored content.'],
  });

  assert.equal(result.confidence, 'high');
  assert.equal(result.recommendations.length, 1);
});

test('normalizeDiagnosis downgrades unknown confidence values', () => {
  const result = normalizeDiagnosis({
    summary: 'Unknown',
    confidence: 'certain',
  });

  assert.equal(result.confidence, 'low');
  assert.equal(result.rootCause, 'unknown');
});

test('diagnose retries transient GitHub Models failures', async () => {
  const originalFetch = global.fetch;
  let calls = 0;

  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: false,
        status: 429,
        text: async () => 'rate limited',
      };
    }
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              summary: 'Hero image lacks alt text.',
              rootCause: 'abc123 blocks/hero/hero.js',
              confidence: 'low',
              recommendations: ['Add alt text.'],
            }),
          },
        }],
      }),
    };
  };

  try {
    const result = await diagnose(regression, [], [], 'token');

    assert.equal(calls, 2);
    assert.equal(result.summary, 'Hero image lacks alt text.');
  } finally {
    global.fetch = originalFetch;
  }
});
