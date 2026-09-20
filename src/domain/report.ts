import type { Session } from './types.js';

const short = (value: string, length: number) => value.length <= length ? value : value.slice(0, length - 1) + '…';

export interface Report {
  sessionId: string;
  status: Session['status'];
  need: string;
  goal: string;
  page: { url: string; title: string };
  findings: { key: string; question: string; answer: string; source: { text: string; context: string; url: string } }[];
  lastSteps: { action: string; outcome: string }[];
  placedValues: { name: string; field: string }[];
  usage: Session['usage'];
  sessionAlive: boolean;
  evidence: Session['artifacts'];
}

export function buildReport(session: Session): Report {
  return {
    sessionId: session.id,
    status: session.status,
    need: short(session.need, 400),
    goal: short(session.goal, 400),
    page: { url: short(session.observation.url, 300), title: short(session.observation.title, 140) },
    findings: session.findings.map(finding => ({
      key: finding.key,
      question: short(finding.question, 200),
      answer: short(finding.text, 300),
      source: { text: short(finding.text, 300), context: short(finding.context, 300), url: short(finding.url, 300) },
    })),
    lastSteps: session.steps.slice(-6).map(step => ({ action: short(step.action, 120), outcome: short(step.outcome, 160) })),
    placedValues: Object.entries(session.placed).map(([name, placement]) => ({ name, field: short(placement.name, 120) })),
    usage: session.usage,
    sessionAlive: !session.closed,
    evidence: session.artifacts,
  };
}
