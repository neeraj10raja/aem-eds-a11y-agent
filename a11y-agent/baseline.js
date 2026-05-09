import { readFileSync, writeFileSync } from 'fs';

function loadBaseline(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function violationFingerprint(violation) {
  return [
    violation.id,
    violation.impact,
    (violation.target ?? []).join(' '),
  ].join('|');
}

function countByImpact(violations) {
  return violations.reduce((counts, violation) => {
    const impact = violation.impact ?? 'unknown';
    return {
      ...counts,
      [impact]: (counts[impact] ?? 0) + 1,
    };
  }, {});
}

function saveBaseline(filePath, pageResults) {
  const data = {};
  for (const page of pageResults) {
    if (!page.scan_failed) {
      const violations = page.violations ?? [];
      data[page.url] = {
        violation_fingerprints: violations.map(violationFingerprint),
        violation_count: violations.length,
        counts_by_impact: countByImpact(violations),
        updated_at: page.timestamp,
      };
    }
  }
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function detectRegressions(pageResults, baseline, config) {
  const impacts = new Set(config.fail_on_impacts ?? ['critical', 'serious']);
  const regressions = [];

  for (const page of pageResults) {
    if (page.scan_failed) {
      regressions.push({
        url: page.url,
        source: page.source,
        scan_failed: true,
        scan_error: page.error ?? 'Unknown scan failure',
        new_violations: [],
        new_violation_count: 0,
        current_violation_count: 0,
        counts_by_impact: {},
        baseline_violation_count: baseline[page.url]?.violation_count ?? null,
        timestamp: page.timestamp,
      });
    } else {
      const base = baseline[page.url];
      const existing = new Set(base?.violation_fingerprints ?? []);
      const violations = page.violations ?? [];
      const newViolations = violations
        .filter((violation) => impacts.has(violation.impact))
        .filter((violation) => !existing.has(violationFingerprint(violation)));

      if (newViolations.length > 0) {
        regressions.push({
          url: page.url,
          source: page.source,
          new_violations: newViolations,
          new_violation_count: newViolations.length,
          current_violation_count: violations.length,
          counts_by_impact: countByImpact(violations),
          baseline_violation_count: base?.violation_count ?? null,
          timestamp: page.timestamp,
        });
      }
    }
  }

  return regressions;
}

export {
  countByImpact,
  detectRegressions,
  loadBaseline,
  saveBaseline,
  violationFingerprint,
};
