const API = 'https://api.github.com';
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_RETRIES = 3;

function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

async function request(url, options = {}) {
  const {
    retries = DEFAULT_RETRIES,
    parse = 'json',
    ...fetchOptions
  } = options;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, fetchOptions);
      if (res.status === 204) return null;
      if (res.ok) {
        if (parse === 'text') return res.text();
        return res.json();
      }

      const body = await res.text().catch(() => '');
      lastError = new Error(`GitHub API ${res.status} on ${url}: ${body.slice(0, 200)}`);
      if (!RETRY_STATUSES.has(res.status) || attempt === retries) throw lastError;
    } catch (err) {
      lastError = err;
      if (attempt === retries) throw lastError;
    }

    const status = Number(lastError.message.match(/GitHub API (\d+)/)?.[1]);
    if (status && !RETRY_STATUSES.has(status)) throw lastError;

    await wait(1000 * 2 ** attempt);
  }

  throw lastError;
}

async function ghFetch(path, token, options = {}) {
  return request(`${API}${path}`, {
    ...options,
    headers: {
      ...headers(token),
      ...(options.headers ?? {}),
    },
  });
}

async function getRecentCommits(owner, repo, sinceISO, token, maxPages = 5) {
  const allCommits = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const params = new URLSearchParams({ since: sinceISO, per_page: '100', page: String(page) });
    const commits = await ghFetch(`/repos/${owner}/${repo}/commits?${params}`, token);
    allCommits.push(...commits);
    if (commits.length < 100) break;
  }

  return allCommits.map((commit) => ({
    sha: commit.sha,
    message: commit.commit.message.split('\n')[0],
    author: commit.commit.author.name,
    date: commit.commit.author.date,
  }));
}

async function getCommitDiff(owner, repo, sha, token, maxBytes = 20000) {
  const diff = await ghFetch(`/repos/${owner}/${repo}/commits/${sha}`, token, {
    headers: { Accept: 'application/vnd.github.diff' },
    parse: 'text',
  }) ?? '';
  return {
    sha,
    diff: diff.slice(0, maxBytes),
    truncated: diff.length > maxBytes,
  };
}

async function addLabels(owner, repo, issueNumber, labels, token) {
  if (!labels?.length) return;
  await Promise.all(labels.map(async (label) => {
    try {
      await ghFetch(`/repos/${owner}/${repo}/labels/${encodeURIComponent(label)}`, token, { retries: 0 });
    } catch {
      try {
        await ghFetch(`/repos/${owner}/${repo}/labels`, token, {
          method: 'POST',
          body: JSON.stringify({ name: label, color: '0e8a16' }),
        });
      } catch (err) {
        if (!err.message.includes('422')) throw err;
      }
    }
  }));
  await ghFetch(`/repos/${owner}/${repo}/issues/${issueNumber}/labels`, token, {
    method: 'POST',
    body: JSON.stringify({ labels }),
  });
}

async function checkOpenIssues(owner, repo, options, token) {
  const { label, title } = options;
  const params = new URLSearchParams({ state: 'open', per_page: '50' });
  if (label) params.set('labels', label);
  const issues = await ghFetch(`/repos/${owner}/${repo}/issues?${params}`, token);
  return issues.some((issue) => !issue.pull_request && (!title || issue.title === title));
}

async function createIssue(owner, repo, options, token) {
  const { title, body, labels } = options;
  const issue = await ghFetch(`/repos/${owner}/${repo}/issues`, token, {
    method: 'POST',
    body: JSON.stringify({ title, body }),
  });
  await addLabels(owner, repo, issue.number, labels, token);
  return { url: issue.html_url, number: issue.number };
}

export {
  addLabels,
  checkOpenIssues,
  createIssue,
  getCommitDiff,
  getRecentCommits,
  ghFetch,
  request,
};
