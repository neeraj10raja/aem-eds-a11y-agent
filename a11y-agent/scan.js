import { readFileSync } from 'fs';

function normalizeTarget(target) {
  if (Array.isArray(target)) return target.map(String);
  if (target == null) return [];
  return [String(target)];
}

function trimSnippet(value, max = 500) {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function flattenViolations(axeViolations) {
  return (axeViolations ?? [])
    .flatMap((violation) => (violation.nodes ?? []).map((node) => ({
      id: violation.id,
      impact: violation.impact,
      description: violation.description,
      help: violation.help,
      help_url: violation.helpUrl,
      target: normalizeTarget(node.target),
      html: trimSnippet(node.html),
      failure_summary: trimSnippet(node.failureSummary, 800),
    })));
}

function normalizeAxeResult(url, axeResult) {
  const violations = flattenViolations(axeResult.violations);
  return {
    url,
    source: 'axe',
    violations,
    violation_count: violations.length,
    raw_violation_count: axeResult.violations?.length ?? 0,
    passes_count: axeResult.passes?.length ?? 0,
    incomplete_count: axeResult.incomplete?.length ?? 0,
    timestamp: new Date().toISOString(),
  };
}

function loadFixtureResults(siteBase, paths, config) {
  const fixture = JSON.parse(readFileSync(config.fixture_path, 'utf8'));
  return paths.map((path) => {
    const url = new URL(path, `${siteBase}/`).toString();
    const page = (fixture.pages ?? []).find((candidate) => (
      candidate.url === url || candidate.path === path
    ));
    if (!page) {
      return {
        url,
        source: 'axe-fixture',
        violations: [],
        violation_count: 0,
        raw_violation_count: 0,
        passes_count: 0,
        incomplete_count: 0,
        timestamp: fixture.timestamp ?? new Date().toISOString(),
      };
    }
    const violations = flattenViolations(page.violations);
    return {
      url,
      source: 'axe-fixture',
      violations,
      violation_count: violations.length,
      raw_violation_count: page.violations?.length ?? 0,
      passes_count: page.passes_count ?? 0,
      incomplete_count: page.incomplete_count ?? 0,
      timestamp: page.timestamp ?? fixture.timestamp ?? new Date().toISOString(),
    };
  });
}

function readEnvValue(envName) {
  if (!envName) return null;
  return process.env[envName] || null;
}

function buildBrowserContextOptions(config) {
  const contextOptions = {
    viewport: config.scan?.viewport ?? { width: 1366, height: 900 },
  };
  const auth = config.auth ?? {};
  const username = readEnvValue(auth.basic_username_env);
  const password = readEnvValue(auth.basic_password_env);
  const bearerToken = readEnvValue(auth.bearer_token_env);

  if (username && password) {
    contextOptions.httpCredentials = { username, password };
  }

  if (bearerToken) {
    contextOptions.extraHTTPHeaders = {
      Authorization: `Bearer ${bearerToken}`,
    };
  }

  return contextOptions;
}

function normalizeCookies(rawCookies, url) {
  if (!rawCookies) return [];
  let parsed;
  try {
    parsed = JSON.parse(rawCookies);
  } catch {
    throw new Error('Configured auth cookies must be valid JSON');
  }

  const cookies = Array.isArray(parsed) ? parsed : [parsed];
  const { origin } = new URL(url);
  return cookies.map((cookie) => {
    const normalized = { ...cookie };
    if (!normalized.url && !normalized.domain) normalized.url = origin;
    return normalized;
  });
}

async function applyConfiguredCookies(context, config, url) {
  const rawCookies = readEnvValue(config.auth?.cookies_json_env);
  const cookies = normalizeCookies(rawCookies, url);
  if (cookies.length > 0) await context.addCookies(cookies);
}

async function runAxeScanWithBrowser(url, config, browser) {
  const axeModule = await import('@axe-core/playwright');
  const AxeBuilder = axeModule.default ?? axeModule.AxeBuilder;
  const context = await browser.newContext(buildBrowserContextOptions(config));

  try {
    await applyConfiguredCookies(context, config, url);
    const page = await context.newPage();
    await page.goto(url, {
      waitUntil: config.scan?.wait_until ?? 'domcontentloaded',
      timeout: config.scan?.timeout_ms ?? 30000,
    });

    const postLoadDelay = Number(config.scan?.post_load_delay_ms ?? 0);
    if (postLoadDelay > 0) await page.waitForTimeout(postLoadDelay);

    let builder = new AxeBuilder({ page });
    if (config.axe?.tags?.length) builder = builder.withTags(config.axe.tags);
    if (config.axe?.disabled_rules?.length) {
      builder = builder.disableRules(config.axe.disabled_rules);
    }

    const result = await builder.analyze();
    return normalizeAxeResult(url, result);
  } finally {
    await context.close();
  }
}

async function runAxeScan(url, config) {
  const playwright = await import('playwright');
  const browser = await playwright.chromium.launch({ headless: true });

  try {
    return await runAxeScanWithBrowser(url, config, browser);
  } finally {
    await browser.close();
  }
}

function scanFailureResult(url, err) {
  return {
    url,
    source: 'axe',
    scan_failed: true,
    error: err instanceof Error ? err.message : String(err),
    violations: [],
    violation_count: 0,
    raw_violation_count: 0,
    passes_count: 0,
    incomplete_count: 0,
    timestamp: new Date().toISOString(),
  };
}

async function runWithConcurrency(items, requestedLimit, worker) {
  const numericLimit = Number(requestedLimit);
  const limit = Number.isFinite(numericLimit) && numericLimit > 0 ? numericLimit : 1;
  const concurrency = Math.min(limit, Math.max(items.length, 1));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runNext() {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= items.length) return;
    results[index] = await worker(items[index], index);
    await runNext();
  }

  await Promise.all(Array.from({ length: concurrency }, runNext));
  return results;
}

async function scanPages(siteBase, paths, config) {
  if (config.fixture_path) return loadFixtureResults(siteBase, paths, config);

  const playwright = await import('playwright');
  const browser = await playwright.chromium.launch({ headless: true });
  const concurrency = config.scan?.concurrency ?? 3;

  try {
    return await runWithConcurrency(paths, concurrency, async (path) => {
      const url = new URL(path, `${siteBase}/`).toString();
      try {
        return await runAxeScanWithBrowser(url, config, browser);
      } catch (err) {
        return scanFailureResult(url, err);
      }
    });
  } finally {
    await browser.close();
  }
}

export {
  applyConfiguredCookies,
  buildBrowserContextOptions,
  flattenViolations,
  loadFixtureResults,
  normalizeCookies,
  normalizeAxeResult,
  runAxeScan,
  runAxeScanWithBrowser,
  runWithConcurrency,
  scanPages,
};
