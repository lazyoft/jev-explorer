export const short = (value, length = 240) => {
  const text = String(value ?? '');
  return text.length <= length ? text : text.slice(0, length - 1) + '…';
};

export function compactReport(session, { targets = false, offset = 0 } = {}) {
  const active = session.active;
  const report = {
    sessionId: session.id,
    status: session.status,
    reason: session.reason,
    workflowOutcome: session.workflow,
    pendingEffect: session.pendingEffect ?? false,
    objective: short(session.objective, 500),
    page: { url: short(session.view?.url, 400), title: short(session.view?.title, 140), observationTruncated: session.view?.truncated ?? false },
    findings: session.facts.slice(-8).map(fact => ({
      key: fact.key,
      value: short(typeof fact.value === 'string' ? fact.value : JSON.stringify(fact.value), 240),
      origin: fact.origin,
      current: fact.current,
      source: fact.evidence ? { url: short(fact.url, 300), text: short(fact.evidence.text, 220), context: short(fact.evidence.context, 220), frame: fact.evidence.frame } : undefined,
    })),
    needs: session.needs.slice(0, 8).map(need => short(need, 200)),
    recentActions: session.history.slice(-6).map(event => ({ action: short(event.action, 140), outcome: short(event.outcome, 180) })),
    usage: active ? { calls: active.calls, failedCalls: active.failedCalls, inputTokens: active.inputTokens, outputTokens: active.outputTokens, elapsedMs: active.elapsedMs, observationRetries: active.observationRetries } : undefined,
    artifacts: session.artifacts,
    sessionAlive: !session.closed,
    limitations: session.limitations.slice(-3).map(item => short(item, 180)),
  };
  if (targets) {
    report.targets = (session.view?.elements ?? []).slice(offset, offset + 35).map(element => ({ ref: element.id, role: element.role, name: short(element.name, 100), frame: element.frame, filled: element.filled, checked: element.checked }));
    report.targetCount = session.view?.elements?.length ?? 0;
    report.targetsTruncated = offset + report.targets.length < report.targetCount;
    report.nextOffset = report.targetsTruncated ? offset + report.targets.length : null;
  }
  let truncated = session.facts.length > 8 || session.history.length > 6;
  while (JSON.stringify(report).length > (targets ? 12000 : 6500)) {
    truncated = true;
    if (report.recentActions.length) report.recentActions.shift();
    else if (report.findings.length > 1) report.findings.shift();
    else if (report.targets?.length) report.targets.pop();
    else break;
  }
  report.compact = { truncated, fullEvidenceOnDisk: true };
  if (targets) report.nextOffset = offset + report.targets.length < report.targetCount ? offset + report.targets.length : null;
  return report;
}
