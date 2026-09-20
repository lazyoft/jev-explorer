import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JevBrowser } from '../dist/browser.js';
import { capture, verifyTarget } from '../dist/observation.js';
import { compactDecision } from '../dist/decision-context.js';
import { estimateRequest } from '../dist/request-budget.js';
import { fixtureBrowser } from './helpers.mjs';
let browser;
before(async () => { browser=await fixtureBrowser(); });
after(async () => { await browser?.close(); });
async function pageFixture(t, html) {
  const page=await browser.newPage();t.after(()=>page.close());await page.setContent(html);return page;
}

test('complete acquisition transfers every text beyond the first 800 fragments', async t => {
  const page=await pageFixture(t, `<section aria-label="Data">${Array.from({length:950},(_,i)=>`<p>Row ${i}</p>`).join('')}</section>`);
  const initial=await capture(page,{maxElements:600,maxTexts:800});t.after(()=>initial.dispose());
  assert.equal(initial.data.truncatedTexts,true);
  const full=await capture(page,{maxElements:600,maxTexts:800,complete:true});t.after(()=>full.dispose());
  assert.equal(full.data.truncated,false);
  assert.equal(full.data.texts.filter(text=>text.text.startsWith('Row ')).length,950);
  assert.ok(full.data.texts.some(text=>text.text==='Row 949'));
  assert.equal(new Set(full.data.texts.map(text=>text.id)).size,full.data.texts.length);
});

test('control transfer preserves references across acquisition batches and explicit scope', async t => {
  const page=await pageFixture(t, `<button>Outside</button><section id="wanted">${Array.from({length:620},(_,i)=>`<button>Button ${i}</button>`).join('')}</section>`);
  const full=await capture(page,{scope:'#wanted',maxElements:600,maxTexts:800,complete:true});t.after(()=>full.dispose());
  assert.equal(full.data.truncated,false);assert.equal(full.data.elements.length,620);
  assert.equal(full.refs.size,620);assert.ok(!full.data.elements.some(e=>e.name==='Outside'));
  const last=full.data.elements.find(e=>e.name==='Button 619');assert.ok(last);
  await verifyTarget(full.refs.get(last.id));
  assert.equal(await full.refs.get(last.id).handle.innerText(),'Button 619');
});

for (const scope of [undefined, '#wanted']) test(`a text-truncated ${scope ? 'scoped' : 'whole'} page reaches navigation paging without a region-size error`, async t => {
  const page=await pageFixture(t, `<button>Outside</button><section id="wanted">${Array.from({length:950},(_,i)=>`<p>Row ${i}: ${('Evidence '+i+' ').repeat(12)}</p>`).join('')}<button onclick="window.done=true">Wanted detail</button></section>`);
  const requests=[];
  const engine={prepare:compactDecision,async decide(request){
    requests.push(request);assert.equal(estimateRequest(request).fits,true);
    const answers={};
    for(const[id,q]of Object.entries(request.questions)){
      let choice='advance';
      if(id==='action')choice=Object.entries(q.criteria).find(([,candidate])=>{
        const action=candidate?.actionId?request.state.actions[candidate.actionId]:candidate;
        const target=action?.target?.elementId?request.state.page.elements.find(e=>e.id===action.target.elementId):action?.target;
        return target?.name==='Wanted detail';
      })?.[0]??(q.criteria.__next_page__?'__next_page__':'__none__');
      answers[id]={choice,confidence:1};
    }
    return {answers};
  }};
  const core=new JevBrowser({page,engine,maxElements:600,maxTexts:800});t.after(()=>core.close());
  assert.equal((await core.snapshot({scope})).truncatedTexts,true);
  const result=await core.run('Open Wanted detail.',{scope,maxDecisions:60,maxSteps:1});
  assert.equal(await page.evaluate(()=>window.done),true,JSON.stringify(result));
  assert.ok(requests.some(r=>r.state.pagination?.pageCount>1));
  assert.ok(requests.every(r=>!r.questions.region));
  if(scope)assert.ok(requests.every(r=>!(r.state.page?.elements??[]).some(e=>e.name==='Outside')));
});


test('a control after the 600th entry remains selectable through acquisition and decision pages', async t => {
  const page=await pageFixture(t, `<section id="wanted">${Array.from({length:620},(_,i)=>`<button onclick="window.selected=${i}">Button ${i}</button>`).join('')}</section>`);
  let paged=false;
  const engine={prepare:compactDecision,async decide(request){
    assert.equal(estimateRequest(request).fits,true);
    paged ||= request.state.pagination?.pageCount>1;
    const answers={};
    for(const[id,q]of Object.entries(request.questions)){
      let choice='advance';
      if(id==='action')choice=Object.entries(q.criteria).find(([,candidate])=>{
        const action=candidate?.actionId?request.state.actions[candidate.actionId]:candidate;
        const target=action?.target?.elementId?request.state.page.elements.find(e=>e.id===action.target.elementId):action?.target;
        return target?.name==='Button 619';
      })?.[0]??(q.criteria.__next_page__?'__next_page__':'__none__');
      answers[id]={choice,confidence:1};
    }
    return {answers};
  }};
  const core=new JevBrowser({page,engine,maxElements:600,maxTexts:800,maxCandidates:250});t.after(()=>core.close());
  assert.equal((await core.snapshot({scope:'#wanted'})).truncatedElements,true);
  await core.run('Click Button 619.',{scope:'#wanted',maxDecisions:60,maxSteps:1});
  assert.equal(await page.evaluate(()=>window.selected),619);
  assert.equal(paged,true);
});
