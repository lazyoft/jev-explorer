import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { BrowserExplorer } from '../dist/explore-browser.js';
import { temporaryRoot } from './fixtures.mjs';

test('real Jev selects a state on the public WAI autocomplete example', async t => {
  assert.ok(process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY);
  const explorer = new BrowserExplorer({ root: await temporaryRoot() }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: 'https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-autocomplete-list/', objective: 'Choose the supplied US state in the State autocomplete example. Stop after the option is selected. Do not use site search or follow documentation links.', data: { state: { type: 'text', value: 'Alaska', description: 'US state to select in the example combobox' } }, maxCalls: 20, maxSteps: 6, timeoutMs: 60000 });
  await mkdir('results', { recursive: true }); await writeFile('results/public-autocomplete-live.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ test: 'public-autocomplete', report }));
  const field = explorer.get(report.sessionId).core.page.getByRole('combobox', { name: 'State', exact: true });
  assert.equal(await field.inputValue(), 'Alaska');
  assert.equal(await field.getAttribute('aria-expanded'), 'false');
  assert.ok(report.typedInputs.some(input => input.format === 'autocomplete-selection'));
});

test('real Jev selects a date on the public WAI calendar combobox example', async t => {
  assert.ok(process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY);
  const today = new Date();
  const target = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 23));
  const iso = target.toISOString().slice(0, 10);
  const expected = `${String(target.getUTCMonth() + 1).padStart(2, '0')}/23/${target.getUTCFullYear()}`;
  const explorer = new BrowserExplorer({ root: await temporaryRoot() }); t.after(() => explorer.shutdown());
  const report = await explorer.explore({ url: 'https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-datepicker/', objective: 'Choose the supplied date in the Date calendar combobox example, using its calendar dialog. Stop when the selected date appears in the field. Do not use site search or follow documentation links.', data: { date: { type: 'date', value: iso, description: 'Calendar date to choose in the Date example' } }, maxCalls: 25, maxSteps: 12, timeoutMs: 60000 });
  await mkdir('results', { recursive: true }); await writeFile('results/public-calendar-live.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ test: 'public-calendar', expected, report }));
  const field = explorer.get(report.sessionId).core.page.getByRole('combobox', { name: 'Date', exact: true });
  assert.equal(await field.inputValue(), expected);
  assert.equal(await field.getAttribute('aria-expanded'), 'false');
  assert.ok(report.typedInputs.some(input => input.format === 'calendar-selection'));
});
