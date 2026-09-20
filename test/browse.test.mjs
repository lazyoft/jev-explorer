import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../dist/domain/sessions.js';
import { startBrowsing } from '../dist/start_browsing.js';
import { startSite, scriptedDecider, pick, withRoot } from './helpers.mjs';

const run = (decider, request) => withRoot(async root => {
  const store = new SessionStore(root);
  try { return await startBrowsing(store, decider, request, AbortSignal.timeout(60000)); }
  finally { await store.shutdown(); }
});

const holds = (needle) => (label) => label.toLowerCase().includes(needle.toLowerCase());

test('it follows links and returns the answer word for word', async () => {
  const site = await startSite();
  const decider = scriptedDecider((id, ask) => {
    if (id === 'effect') return 'move';
    if (id === 'action') return pick(ask, holds('Reject optional')) ?? pick(ask, holds('link Contact')) ?? '__nothing__';
    if (id.startsWith('answer_')) return pick(ask, label => label.includes('+39')) ?? '__not_here__';
    return undefined;
  });
  try {
    const report = await run(decider, {
      url: site.url,
      goal: 'Find the workshop phone number of this company.',
      questions: [{ key: 'phone', question: 'What is the workshop phone number?' }],
    });
    assert.equal(report.status, 'answered');
    assert.equal(report.findings.length, 1);
    assert.match(report.findings[0].answer, /\+39 02 5555 1234/);
    assert.match(report.findings[0].source.url, /contact\.html$/);
  } finally { await site.stop(); }
});

test('one acting step costs exactly two messages', async () => {
  const site = await startSite();
  const decider = scriptedDecider((id, ask) => {
    if (id === 'effect') return 'move';
    if (id === 'action') return pick(ask, holds('link Careers')) ?? '__nothing__';
    if (id.startsWith('answer_')) return '__not_here__';
    return undefined;
  });
  try {
    await run(decider, { url: site.url, goal: 'Open the careers page.' });
    const kinds = decider.seen.map(asks => Object.keys(asks).join('+'));
    assert.deepEqual(kinds, ['action', 'effect', 'action']);
  } finally { await site.stop(); }
});

test('it places supplied values and stops before a commit it may not do', async () => {
  const site = await startSite();
  const decider = scriptedDecider((id, ask) => {
    if (id === 'bind_full_name') return pick(ask, holds('full name')) ?? '__none__';
    if (id === 'bind_delivery_day') return pick(ask, holds('Delivery day')) ?? '__none__';
    if (id === 'bind_newsletter') return pick(ask, holds('newsletter')) ?? '__none__';
    if (id === 'action') return pick(ask, holds('Save the request')) ?? '__nothing__';
    if (id === 'effect') return 'commit';
    return undefined;
  });
  try {
    const report = await run(decider, {
      url: site.url + '/form.html',
      goal: 'Ask for a quote for Ada Lovelace, delivered on 2 October 2026, without the newsletter.',
      values: { full_name: 'Ada Lovelace', delivery_day: '2026-10-02', newsletter: 'false' },
    });
    assert.equal(report.status, 'needs_decision');
    assert.match(report.need, /acts outside the page/);
    assert.deepEqual(report.placedValues.map(item => item.name).sort(), ['delivery_day', 'full_name', 'newsletter']);
  } finally { await site.stop(); }
});

test('it waits for a slow page without asking the model', async () => {
  const site = await startSite();
  const decider = scriptedDecider((id, ask) => {
    if (id === 'action') return '__nothing__';
    if (id.startsWith('answer_')) return pick(ask, label => label.includes('09:00')) ?? '__not_here__';
    return undefined;
  });
  try {
    const report = await run(decider, {
      url: site.url + '/slow.html',
      goal: 'Find the opening time.',
      questions: [{ key: 'opening', question: 'At what time does it open?' }],
    });
    assert.equal(report.status, 'answered');
    assert.match(report.findings[0].answer, /09:00/);
    assert.equal(decider.seen.length, 2);
  } finally { await site.stop(); }
});

test('a required field with no value asks the caller for it', async () => {
  const site = await startSite();
  const decider = scriptedDecider(id => (id === 'action' ? '__nothing__' : undefined));
  try {
    const report = await run(decider, { url: site.url + '/form.html', goal: 'Send the quote request.' });
    assert.equal(report.status, 'needs_value');
    assert.match(report.need, /Your full name/);
  } finally { await site.stop(); }
});

test('it stops offering a step that changed nothing', async () => {
  const site = await startSite();
  const decider = scriptedDecider((id, ask) => {
    if (id === 'action') return pick(ask, holds('Accept all cookies')) ?? '__nothing__';
    if (id === 'effect') return 'move';
    return undefined;
  });
  try {
    const report = await run(decider, { url: site.url, goal: 'Do the same thing forever.' });
    assert.equal(report.status, 'needs_decision');
    assert.ok(report.lastSteps.some(step => step.outcome.includes('not offered again')));
  } finally { await site.stop(); }
});

test('a page with more choices than the model allows is split into parts', async () => {
  const site = await startSite();
  const decider = scriptedDecider((id, ask) => {
    if (id === 'action') return '__nothing__';
    if (id.startsWith('answer_')) return pick(ask, label => label.includes('QX-7781')) ?? '__not_here__';
    return undefined;
  });
  try {
    const report = await run(decider, {
      url: site.url + '/many.html',
      goal: 'Find the reference code.',
      questions: [{ key: 'code', question: 'What is the reference code?' }],
    });
    const widest = Math.max(...decider.seen.flatMap(asks => Object.values(asks).map(ask => ask.choices.length)));
    assert.ok(widest <= 255, `one question offered ${widest} choices`);
    assert.equal(report.status, 'answered');
    assert.match(report.findings[0].answer, /QX-7781/);
  } finally { await site.stop(); }
});
