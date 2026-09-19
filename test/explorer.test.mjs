import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { BrowserExplorer } from '../src/explore-browser.mjs';
import { JevBrowser, BrowserError } from '@tontoko/jev-browser';
import { localSite, temporaryRoot, scriptedEngine } from './fixtures.mjs';

const question = { key: 'notice', question: 'Cancellation notice for a video appointment, verbatim including its unit' };

test('unknown value discovery returns compact source evidence and a live session', async t => {
  const site = await localSite(t); const engine = scriptedEngine();
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: () => engine }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: site.url, objective: 'Find the cancellation notice for video appointments.', questions: [question] });
  assert.equal(report.status, 'ready_for_review', JSON.stringify(report));
  assert.equal(report.findings[0].value, '36 hours');
  assert.equal(report.findings[0].source.url, site.url + '/help');
  assert.equal(report.sessionAlive, true);
  assert.ok(JSON.stringify(report).length < 6500);
  assert.ok(!('snapshot' in report));
  const before = engine.requests.length; const inspection = await explorer.inspect(report.sessionId);
  assert.equal(engine.requests.length, before); assert.equal(inspection.page.url, site.url + '/help');
  assert.equal((await stat(explorer.get(report.sessionId).dir)).mode & 0o777, 0o700);
});

test('missing input handoff retains findings, field value and browser for continuation without replay', async t => {
  const site = await localSite(t); const engine = scriptedEngine();
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: () => engine }); t.after(() => explorer.shutdown());
  const first = await explorer.explore({ url: site.url + '/form', objective: 'Create the contact using the supplied name and email. If required information is missing, stop and ask the supervisor.', values: { name: 'Ada Example' }, questions: [question], allowCommit: true });
  assert.equal(first.status, 'needs_input', JSON.stringify(first));
  assert.equal(site.records.length, 0); assert.equal(first.findings[0].value, '36 hours');
  const page = explorer.get(first.sessionId).core.page;
  assert.equal(await page.locator('input[name="/name"]').inputValue(), 'Ada Example');
  const second = await explorer.continue(first.sessionId, { values: { email: 'ada@example.invalid' }, note: 'The missing email is now supplied. Continue the existing draft.' });
  assert.equal(explorer.get(first.sessionId).core.page, page);
  assert.deepEqual(site.records, [{ '/name': 'Ada Example', '/email': 'ada@example.invalid' }]);
  assert.equal(await page.evaluate(() => window.edits['/name']), 1);
  assert.ok(engine.requests.some(request => request.state.explorationMemory.facts.some(fact => fact.key === 'notice')));
  assert.notEqual(second.status, 'failed');
});

test('same unchanged state and action hands off instead of looping', async t => {
  const site = await localSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: scriptedEngine }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: site.url + '/loop', objective: 'Use Try again until the app shows a result.', maxCalls: 10 });
  assert.equal(report.reason, 'NO_PROGRESS', JSON.stringify(report));
  assert.equal(report.sessionAlive, true); assert.ok(report.usage.calls <= 4);
});

test('model budget stops explicitly and does not lose the browser', async t => {
  const site = await localSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: scriptedEngine }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: site.url, objective: 'Find the cancellation notice.', questions: [question], maxCalls: 1 });
  assert.equal(report.usage.calls, 1);
  assert.equal(report.sessionAlive, true);
  assert.ok(['budget_exhausted', 'needs_review'].includes(report.status));
});

test('a second operation cannot use a session while its model decision is running', async t => {
  const site = await localSite(t); let entered; const started = new Promise(resolve => { entered = resolve; }); let release;
  const waiting = new Promise(resolve => { release = resolve; }); const base = scriptedEngine();
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: () => ({ async decide(request, options) { entered(); await waiting; return base.decide(request, options); } }) });
  t.after(() => explorer.shutdown());
  const session = await explorer.open({ url: site.url });
  const running = explorer.explore({ sessionId: session.sessionId, objective: 'Find cancellations.', maxCalls: 1 });
  await started;
  await assert.rejects(explorer.inspect(session.sessionId), error => error.code === 'BUSY');
  release(); await running;
});

test('native supervisor typing of a password is not persisted in evidence', async t => {
  const site = await localSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: scriptedEngine }); t.after(() => explorer.shutdown());
  const session = await explorer.open({ url: site.url + '/password' });
  const inspection = await explorer.inspect(session.sessionId, { targets: true });
  const target = inspection.targets.find(target => target.name === 'Password');
  assert.ok(target);
  await explorer.act(session.sessionId, { command: 'type', ref: target.ref, text: 'synthetic-password-unique-937' });
  assert.ok(!(await readFile(session.artifacts.trace, 'utf8')).includes('synthetic-password-unique-937'));
  await explorer.close(session.sessionId);
  await assert.rejects(explorer.inspect(session.sessionId), error => error.code === 'SESSION_NOT_FOUND');
});

test('stale observation resumes the same page without replaying its navigation', async t => {
  const site = await localSite(t); let runCount = 0;
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: scriptedEngine, launch: async options => {
    const core = await JevBrowser.launch(options); const run = core.run.bind(core);
    core.run = async (...args) => {
      runCount++;
      if (runCount === 1) {
        await core.page.goto(site.url + '/help');
        throw Object.assign(new BrowserError('STALE_SNAPSHOT', 'Synthetic navigation during capture'), { partial: { status: 'stopped', reason: 'error', steps: [], effects: [{ kind: 'advance', status: 'observed' }] } });
      }
      return run(...args);
    };
    return core;
  } });
  t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: site.url, objective: 'Find the cancellation notice.', questions: [question] });
  assert.equal(report.status, 'ready_for_review');
  assert.equal(report.usage.observationRetries, 1);
  assert.equal(site.requests.filter(request => request.url === '/help').length, 1);
});

test('unknown commit is handed off and never retried even when the error is stale', async t => {
  const site = await localSite(t); let runCount = 0;
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: scriptedEngine, launch: async options => {
    const core = await JevBrowser.launch(options);
    core.run = async () => {
      runCount++;
      throw Object.assign(new BrowserError('STALE_SNAPSHOT', 'Synthetic interrupted save'), { partial: { status: 'stopped', reason: 'error', steps: [], effects: [{ kind: 'commit', status: 'unknown' }] } });
    };
    return core;
  } });
  t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: site.url, objective: 'Inspect the current work.' });
  assert.equal(runCount, 1);
  assert.equal(report.status, 'needs_review');
  assert.equal(report.reason, 'STALE_SNAPSHOT');
  assert.equal(report.pendingEffect, true);
  await assert.rejects(explorer.continue(report.sessionId, { note: 'Try again' }), error => error.code === 'EFFECT_UNRESOLVED');
  assert.equal(runCount, 1);
  const resolved = await explorer.continue(report.sessionId, { effectResolution: 'confirmed', note: 'Independent source confirms that the submission happened once.' });
  assert.equal(resolved.reason, 'effect_confirmed_by_supervisor');
  assert.equal(runCount, 1);
});

test('an invalid field is reported without mistaking an unreadable custom combobox for a missing value', async t => {
  const site = await localSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: scriptedEngine }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: site.url + '/invalid', objective: 'Inspect why this report is not ready.' });
  assert.equal(report.status, 'needs_review');
  assert.equal(report.reason, 'validation_observed');
  assert.ok(report.needs.some(need => need.includes('Report Layout is a required field.')));
  assert.ok(report.needs.every(need => !need.includes('Currency')));
});

test('supervisor can page through targets and act on a later current reference', async t => {
  const site = await localSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: scriptedEngine }); t.after(() => explorer.shutdown());
  const opened = await explorer.open({ url: site.url });
  const page = explorer.get(opened.sessionId).core.page;
  await page.setContent(Array.from({ length: 42 }, (_, i) => `<button onclick="document.body.dataset.selected='${i}'">Action ${i}</button>`).join(''));
  const first = await explorer.inspect(opened.sessionId, { targets: true });
  assert.equal(first.nextOffset, 35);
  const second = await explorer.inspect(opened.sessionId, { targets: true, offset: first.nextOffset });
  const target = second.targets.find(target => target.name === 'Action 37');
  assert.ok(target);
  await explorer.act(opened.sessionId, { command: 'click', ref: target.ref });
  assert.equal(await page.locator('body').getAttribute('data-selected'), '37');
});

test('cancelling a decision preserves an inspectable browser and performs no late action', async t => {
  const site = await localSite(t); let entered; const started = new Promise(resolve => { entered = resolve; });
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: () => ({ async decide(request, { signal }) {
    entered();
    await new Promise((resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  } }) });
  t.after(() => explorer.shutdown());
  const opened = await explorer.open({ url: site.url });
  const abort = new AbortController();
  const running = explorer.explore({ sessionId: opened.sessionId, objective: 'Find the cancellation notice.' }, { signal: abort.signal });
  await started; abort.abort();
  const report = await running;
  assert.equal(report.sessionAlive, true);
  assert.equal((await explorer.inspect(opened.sessionId)).page.url, site.url + '/');
  assert.ok(site.requests.every(request => request.url === '/'));
});
