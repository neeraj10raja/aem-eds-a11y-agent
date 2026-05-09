import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkOpenIssues,
  getCommitDiff,
  getRecentCommits,
} from '../a11y-agent/github-api.js';

test('getCommitDiff retries transient failures and returns truncation metadata', async () => {
  const originalFetch = global.fetch;
  let calls = 0;

  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: false,
        status: 502,
        text: async () => 'bad gateway',
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => '0123456789',
    };
  };

  try {
    const result = await getCommitDiff('owner', 'repo', 'sha', 'token', 5);

    assert.equal(calls, 2);
    assert.equal(result.diff, '01234');
    assert.equal(result.truncated, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('getRecentCommits paginates active repositories', async () => {
  const originalFetch = global.fetch;
  const requested = [];
  const makeCommit = (sha) => ({
    sha,
    commit: {
      message: `Commit ${sha}\n\nDetails`,
      author: {
        name: 'Test User',
        date: '2026-05-09T00:00:00Z',
      },
    },
  });

  global.fetch = async (url) => {
    requested.push(url);
    const page = new URL(url).searchParams.get('page');
    const commits = page === '1'
      ? Array.from({ length: 100 }, (_, i) => makeCommit(`sha-${i}`))
      : [makeCommit('sha-100')];
    return {
      ok: true,
      status: 200,
      json: async () => commits,
    };
  };

  try {
    const commits = await getRecentCommits('owner', 'repo', '2026-05-08T00:00:00Z', 'token');

    assert.equal(commits.length, 101);
    assert.equal(requested.length, 2);
    assert.match(requested[0], /per_page=100/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('checkOpenIssues ignores pull requests and matches title', async () => {
  const originalFetch = global.fetch;
  let requestedUrl;

  global.fetch = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => [
        { title: 'same title', pull_request: {} },
        { title: 'same title' },
      ],
    };
  };

  try {
    const found = await checkOpenIssues('owner', 'repo', {
      label: 'a11y-regression',
      title: 'same title',
    }, 'token');

    assert.equal(found, true);
    assert.match(requestedUrl, /labels=a11y-regression/);
  } finally {
    global.fetch = originalFetch;
  }
});
