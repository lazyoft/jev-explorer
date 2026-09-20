import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureBrowser } from './helpers.mjs';
import { JevBrowser } from '../dist/browser.js';
let browser;
before(async () => { browser = await fixtureBrowser(); });
after(async () => { await browser?.close(); });
async function fixture(t, html, options = {}) {
  const page = await browser.newPage(); t.after(() => page.close());
  await page.setContent(html);
  const requests = [];
  const core = new JevBrowser({ page, ...options, engine: { async decide(request) {
    requests.push(request); const answers = {};
    for (const [id, q] of Object.entries(request.questions)) answers[id] = { choice: id === 'action' ? Object.entries(q.criteria).find(([, value]) => value?.target?.name === 'Reachable')?.[0] ?? '__none__' : 'advance', confidence: 1 };
    return { answers };
  } } }); t.after(() => core.close());
  return { page, core, requests };
}

test('a covered button is absent from offered controls while the foreground button is executable', async t => {
  const f = await fixture(t, '<button id="behind" style="position:absolute;left:20px;top:20px" onclick="window.wrong=true">Covered</button><div style="position:fixed;inset:0;background:white"><button onclick="window.done=true">Reachable</button></div>');
  const view = await f.core.snapshot();
  assert.ok(!view.elements.some(e => e.name === 'Covered'));
  assert.ok(view.elements.some(e => e.name === 'Reachable'));
  await f.core.run('Click Reachable.', { maxSteps: 1 });
  assert.equal(await f.page.evaluate(() => window.done), true);
  assert.equal(await f.page.evaluate(() => window.wrong), undefined);
  assert.ok(f.requests.every(r => !Object.values(r.questions.action?.criteria ?? {}).some(c => c?.target?.name === 'Covered')));
});

test('a partially covered button can use an exposed click point', async t => {
  const f = await fixture(t, '<button style="position:absolute;left:20px;top:20px;width:200px;height:80px" onclick="window.done=true">Reachable</button><div style="position:absolute;left:80px;top:10px;width:80px;height:100px;background:red"></div>');
  assert.ok((await f.core.snapshot()).elements.some(e => e.name === 'Reachable'));
  await f.core.run('Click Reachable.', { maxSteps: 1 });
  assert.equal(await f.page.evaluate(() => window.done), true);
});

test('a control covered after observation fails before dispatch instead of spending the run deadline', async t => {
  let page;
  const f = await fixture(t, '<button onclick="window.wrong=true">Reachable</button>', { timeoutMs: 180000, allowAction: async () => { await page.evaluate(() => { const overlay=document.createElement('div');overlay.style.cssText='position:fixed;inset:0;background:white';document.body.append(overlay); }); return true; } });
  page=f.page;
  const started=performance.now();
  await assert.rejects(f.core.run('Click Reachable.', { maxSteps: 1, timeoutMs: 180000 }), error => error.code === 'ACTION_UNAVAILABLE' && !error.partial.effects.length);
  assert.ok(performance.now()-started < 5000);
  assert.equal(await f.page.evaluate(() => window.wrong), undefined);
});

test('ordinary open shadow-root controls remain observable and clickable', async t => {
  const f = await fixture(t, '<div id="host"></div><script>host.attachShadow({mode:"open"}).innerHTML=\'<button onclick="window.done=true">Reachable</button>\'</script>');
  assert.ok((await f.core.snapshot()).elements.some(e => e.name === 'Reachable'));
  await f.core.run('Click Reachable.', { maxSteps: 1 });
  assert.equal(await f.page.evaluate(() => window.done), true);
});
