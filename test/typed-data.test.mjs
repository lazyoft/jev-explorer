import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserExplorer } from '../dist/explore-browser.js';
import { dataSchema, formatDate } from '../dist/typed-data.js';
import { temporaryRoot, scriptedEngine } from './fixtures.mjs';
import { typedSite, tripData } from './typed-fixture.mjs';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createExplorerServer } from '../dist/server.js';

function typedEngine() {
  const fallback = scriptedEngine();
  const requests = [];
  const mapping = { 'First name': 'given', 'Last name': 'family', Destination: 'city', Arrival: 'start', 'Arrival (DD/MM/YYYY)': 'start', Departure: 'end', Adults: 'party', 'Include breakfast': 'breakfast' };
  return { requests, async decide(request, options) {
    requests.push(request);
    if (request.state.phase === 'typed-input') {
      const answers = {};
      for (const [id, field] of Object.entries(request.state.fields)) {
        const data = Object.entries(request.state.data).find(([, data]) => data.key === mapping[field.name]);
        answers['datum_' + id] = { choice: data?.[0] ?? '__none__', confidence: data ? 0.99 : 0.3 };
      }

      return { answers };
    }
    if (request.questions.option) return { answers: { option: { choice: Object.entries(request.questions.option.criteria).find(([, item]) => item?.label === '2 adults')[0], confidence: 0.99 } } };
    const result = await fallback.decide(request, options);
    if (request.questions.action) {
      const button = Object.entries(request.questions.action.criteria).find(([, item]) => item?.kind === 'click' && ['Next', 'Search'].includes(item.target?.name));
      if (button) result.answers.action = { choice: button[0], confidence: 0.99 };
    }
    return result;
  } };
}

test('typed data crosses pages, formats dates and searches with independently observed exact values', async t => {
  const site = await typedSite(t); const engine = typedEngine();
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: () => engine }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: site.url + '/start', objective: 'Fill guest details, continue and search using supplied travel data.', data: tripData, maxCalls: 40 });
  assert.deepEqual(site.records, [{ first: 'Ada', last: 'Example', place: 'Harbor City', arrival: '2030-04-11', departure: '14/04/2030', adults: '2', breakfast: true }]);
  assert.equal(report.typedInputs.length, 7, JSON.stringify(report));
  assert.ok(report.typedInputs.some(input => input.key === 'end' && input.format === 'DD/MM/YYYY'));
  const request = engine.requests.find(request => request.state.phase === 'typed-input');
  assert.ok(request.questions.datum_f0 && request.questions.datum_f1);
  assert.ok(!JSON.stringify(request).includes('Ada'));
});

test('unknown date format and rejected readback stop without claiming an applied value', async t => {
  const site = await typedSite(t);
  for (const [path, code] of [['/unknown', 'DATE_FORMAT_UNKNOWN'], ['/reject', 'INPUT_READBACK_FAILED']]) {
    const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: typedEngine }); t.after(() => explorer.shutdown());
    const report = await explorer.explore({ url: site.url + path, objective: 'Fill the arrival date.', data: { start: tripData.start } });
    assert.equal(report.reason, code, JSON.stringify(report)); assert.equal(report.typedInputs.length, 0); assert.equal(site.records.length, 0);
  }
});

test('continuation adds missing typed data and does not refill fields already correct', async t => {
  const site = await typedSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: typedEngine }); t.after(() => explorer.shutdown());
  const { end, ...partial } = tripData;
  const first = await explorer.explore({ url: site.url + '/trip', objective: 'Fill the supplied travel details and search. Stop if a required value is missing.', data: partial, maxCalls: 40 });
  assert.equal(site.records.length, 0);
  assert.equal(first.status, 'needs_input', JSON.stringify(first));
  const page = explorer.get(first.sessionId).core.page;
  const before = await page.evaluate(() => window.edits);
  const second = await explorer.continue(first.sessionId, { data: { end } });
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(site.records.length, 1, JSON.stringify(second));
  assert.equal(site.records[0].departure, '14/04/2030');
  const after = await page.evaluate(() => window.edits);
  assert.equal(after.place, before.place); assert.equal(after.arrival, before.arrival);
});

test('native select maps supplied number to an observed option without exact string matching', async t => {
  const site = await typedSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: typedEngine }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: site.url + '/select', objective: 'Select the supplied number of adults and stop.', data: { party: tripData.party }, maxSteps: 3 });
  assert.equal(await explorer.get(report.sessionId).core.page.getByLabel('Adults').inputValue(), 'two');
  assert.equal(report.typedInputs[0]?.key, 'party');
});

test('MCP validates real dates and accepts the typed data contract', async t => {
  const site = await typedSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: typedEngine });
  const server = createExplorerServer(explorer); const client = new Client({ name: 'typed-contract', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); await explorer.shutdown(); });
  await server.connect(st); await client.connect(ct);
  const invalid = await client.callTool({ name: 'jev_explore', arguments: { url: site.url + '/trip', objective: 'Search.', data: { start: { type: 'date', value: '2026-02-30' } } } });
  assert.equal(invalid.isError, true); assert.equal(explorer.sessions.size, 0);
  const mixed = await client.callTool({ name: 'jev_explore', arguments: { url: site.url + '/trip', objective: 'Search.', data: tripData, values: { city: 'Other' } } });
  assert.equal(mixed.isError, true);
  const response = await client.callTool({ name: 'jev_explore', arguments: { url: site.url + '/trip', objective: 'Search using supplied travel details.', data: tripData, maxCalls: 40 } });
  assert.notEqual(response.isError, true); assert.equal(site.records.length, 1, JSON.stringify(response));
});

test('date formats preserve calendar days and reject ambiguous order', () => {
  assert.equal(dataSchema.safeParse({ birthday: { type: 'date', value: '2024-02-29' } }).success, true);
  assert.equal(dataSchema.safeParse({ birthday: { type: 'date', value: '2025-02-29' } }).success, false);
  assert.deepEqual(formatDate('2030-04-11', 'text', 'gg/mm/aaaa'), { value: '11/04/2030', format: 'DD/MM/YYYY' });
  assert.equal(formatDate('2030-04-11', 'text', 'MM/DD/YYYY').value, '04/11/2030');
  assert.throws(() => formatDate('2030-04-11', 'text', 'DD/MM/YYYY or MM/DD/YYYY'), error => error.code === 'DATE_FORMAT_UNKNOWN');
});

test('uncertain selected datum stops before typing despite other confident matches', async t => {
  const site = await typedSite(t); const base = typedEngine();
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: () => ({ async decide(request, options) {
    if (request.questions.confirm_binding) return { answers: { confirm_binding: { choice: 'ambiguous', confidence: 0.99 } } };
    const result = await base.decide(request, options);
    for (const [key, answer] of Object.entries(result.answers)) if (key.startsWith('datum_') && !answer.choice.startsWith('__')) answer.confidence = 0.4;
    return result;
  } }) }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: site.url + '/start', objective: 'Fill guest details.', data: tripData });
  assert.equal(report.reason, 'INPUT_AMBIGUOUS');
  assert.equal(await explorer.get(report.sessionId).core.page.getByLabel('First name', { exact: true }).inputValue(), '');
  assert.equal(report.typedInputs.length, 0);
});

test('typed decisions obey the model budget and replacement data updates the same visible field', async t => {
  const site = await typedSite(t);
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: typedEngine }); t.after(() => explorer.shutdown());
  const limited = await explorer.explore({ url: site.url + '/start', objective: 'Fill guest details.', data: tripData, maxCalls: 1 });
  assert.equal(limited.status, 'budget_exhausted'); assert.equal(limited.usage.calls, 1);
  assert.equal(limited.typedInputs.length, 1);
  const first = await explorer.explore({ url: site.url + '/trip', objective: 'Fill the destination.', data: { city: tripData.city }, maxSteps: 1 });
  const page = explorer.get(first.sessionId).core.page;
  assert.equal(await page.getByLabel('Destination').inputValue(), 'Harbor City');
  const second = await explorer.continue(first.sessionId, { data: { city: { type: 'text', value: 'Mountain Town', description: 'Travel destination' } } });
  assert.equal(await page.getByLabel('Destination').inputValue(), 'Mountain Town');
  assert.equal(second.typedInputs.length, 1);
  assert.equal(site.records.length, 0);
});


test('an uncertain binding uses the candidate value for one explicit confirmation before typing', async t => {
  const site = await typedSite(t); const base = typedEngine(); let confirmations = 0;
  const explorer = new BrowserExplorer({ root: await temporaryRoot(), engineFactory: () => ({ async decide(request, options) {
    if (request.questions.confirm_binding) {
      confirmations++;
      assert.equal(request.state.proposedDatum.value, 'Ada');
      return { answers: { confirm_binding: { choice: 'confirmed', confidence: 0.98 } } };
    }
    const result = await base.decide(request, options);
    for (const [key, answer] of Object.entries(result.answers)) if (key.startsWith('datum_') && answer.choice === 'd0') answer.confidence = 0.55;
    return result;
  } }) }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: site.url + '/start', objective: 'Fill the guest first name.', data: { given: tripData.given }, maxSteps: 1 });
  assert.equal(confirmations, 1);
  assert.equal(await explorer.get(report.sessionId).core.page.getByLabel('First name', { exact: true }).inputValue(), 'Ada');
  assert.equal(report.typedInputs.length, 1);
});
