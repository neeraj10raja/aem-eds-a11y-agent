const MODELS_ENDPOINT = 'https://models.inference.ai.azure.com/chat/completions';
const DEFAULT_MODEL = 'gpt-4o';
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

const SYSTEM_PROMPT = `You are an accessibility engineer reviewing Adobe AEM Edge Delivery Services pages.
Analyze new axe-core violations and recent code changes. Respond with valid JSON only — no markdown, no code fences.

Required shape:
{
  "summary": "one sentence explaining the likely cause",
  "rootCause": "commit sha + file/line, or 'unknown'",
  "confidence": "high" | "low",
  "recommendations": ["short actionable recommendation"]
}

Rules:
- Set confidence "high" only when a recent code change clearly explains the violation.
- Set confidence "low" for content-author issues, ambiguous selectors, generated markup, or truncated diffs.
- Do not invent file paths or line numbers.`;

function violationBlock(violation) {
  return `- ${violation.impact?.toUpperCase()} ${violation.id}: ${violation.help}
  Target: ${(violation.target ?? []).join(' ')}
  HTML: ${violation.html || '(not available)'}
  Failure: ${violation.failure_summary || '(not available)'}
  Help: ${violation.help_url}`;
}

function buildPrompt(regression, commits, diffs, lookbackHours = 48) {
  const violations = regression.new_violations.map(violationBlock).join('\n\n');
  const commitLog = commits
    .map((commit, i) => {
      const diffInfo = typeof diffs[i] === 'string' ? { diff: diffs[i], truncated: false } : diffs[i];
      const warning = diffInfo?.truncated
        ? '\n\n[DIFF TRUNCATED: diagnose only with low confidence unless the cause is fully visible]\n'
        : '\n\n';
      return `### Commit ${commit.sha.slice(0, 7)} by ${commit.author} on ${commit.date}
"${commit.message}"${warning}${diffInfo?.diff || '(no diff)'}`;
    })
    .join('\n\n---\n\n')
    .slice(0, 20000);

  return `## Accessibility Regression
URL: ${regression.url}
New violations: ${regression.new_violation_count}
Current total violations: ${regression.current_violation_count}
Baseline total violations: ${regression.baseline_violation_count ?? 'no baseline'}

## New axe-core Violations
${violations}

## Recent Code Changes (last ${lookbackHours}h)
${commitLog || '(no commits found in lookback window)'}`;
}

function normalizeDiagnosis(parsed) {
  return {
    summary: parsed.summary ?? 'Accessibility diagnosis unavailable.',
    rootCause: parsed.rootCause ?? 'unknown',
    confidence: parsed.confidence === 'high' ? 'high' : 'low',
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.slice(0, 5)
      : [],
  };
}

async function diagnose(
  regression,
  commits,
  diffs,
  token,
  model = DEFAULT_MODEL,
  lookbackHours = 48,
) {
  let lastError;

  for (let attempt = 0; attempt <= 3; attempt += 1) {
    const res = await fetch(MODELS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildPrompt(regression, commits, diffs, lookbackHours) },
        ],
        temperature: 0.1,
        max_tokens: 1024,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content ?? '{}';
      try {
        return normalizeDiagnosis(JSON.parse(raw));
      } catch {
        return {
          summary: raw.slice(0, 200),
          rootCause: 'unknown',
          confidence: 'low',
          recommendations: [],
        };
      }
    }

    const text = await res.text().catch(() => '');
    lastError = new Error(`GitHub Models ${res.status}: ${text.slice(0, 200)}`);
    if (!RETRY_STATUSES.has(res.status) || attempt === 3) throw lastError;

    await wait(5000 * 2 ** attempt);
  }

  throw lastError;
}

export {
  buildPrompt,
  diagnose,
  normalizeDiagnosis,
};
