import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function formEngine() {
  return { async decide(request, options = {}) {
    options.signal?.throwIfAborted();
    const answers = {};
    for (const [id, question] of Object.entries(request.questions)) {
      let choice = '__none__';
      if (id.startsWith('bind_')) {
        const input = request.state.inputs.find(input => question.instructions.includes(JSON.stringify(input.path)));
        const target = request.state.page.elements.find(element => element.name === input?.label || element.fieldName === input?.path);
        if (target && Object.hasOwn(question.criteria, target.id)) choice = target.id;
      } else if (id.startsWith('effect_')) choice = request.state.actions?.[id.slice('effect_'.length)]?.target?.name === 'Save' ? 'commit' : 'advance';
      else if (id.startsWith('blocker_')) choice = request.state.objective.includes('Inspect why this report') ? 'blocking' : 'observation';
      else if (id === 'action_effect') choice = 'advance';
      else if (id === 'page_phase') choice = 'ready';
      else if (id === 'completion') choice = 'complete';
      else if (id.startsWith('read_')) {
        const input = request.state.inputs.find(input => question.instructions.includes(JSON.stringify(input.path)));
        choice = request.state.sources.find(source => source.context.startsWith(input.path + ' ') && source.text === '[input:' + input.path + ']')?.id ?? '__none__';
      } else if (id === 'action') choice = Object.entries(question.criteria).find(([, candidate]) => candidate && typeof candidate === 'object' && candidate.kind === 'click' && ['Add', 'Save', 'Next'].includes(candidate.target?.name))?.[0] ?? '__none__';
      answers[id] = { choice, confidence: 0.95 };
    }
    return { answers, model: 'deterministic-test-engine', elapsedMs: 0 };
  } };
}

export async function localSite(t) {
  const records = [];
  const requests = [];
  const form = `<h1>New contact</h1><dl><dt>Cancellation notice for a video appointment</dt><dd>36 hours</dd></dl>
    <form aria-label="New contact"><label>Contact name<input name="/name" required></label><label>Contact email<input name="/email" type="email" required></label><button>Save</button><p role="status"></p></form><section id="results"></section>
    <script>window.edits={};document.querySelectorAll('input').forEach(input=>input.addEventListener('input',()=>window.edits[input.name]=(window.edits[input.name]||0)+1));
    document.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.target;const record=Object.fromEntries(new FormData(form));const response=await fetch('/save',{method:'POST',body:JSON.stringify(record)});const saved=await response.json();form.remove();const article=document.createElement('article');article.innerHTML='<h2>Contact created</h2>';for(const[key,value]of Object.entries(saved)){const dl=document.createElement('dl'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;dl.append(dt,dd);article.append(dl);}document.querySelector('#results').append(article);};</script>`;
  const server = createServer(async (req, res) => {
    requests.push({ method: req.method, url: req.url });
    if (req.method === 'POST' && req.url === '/save') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const record = JSON.parse(raw); records.push(record); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(record)); return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(req.url === '/form' ? form : req.url === '/help' ? '<h1>Help</h1><article><h2>Video appointments</h2><dl><dt>Cancellation notice</dt><dd>36 hours</dd></dl></article>' : req.url === '/loop' ? '<h1>Unresponsive app</h1><button>Try again</button>' : req.url === '/password' ? '<label>Password<input type="password"></label>' : req.url === '/invalid' ? '<label>Report Layout<input value="STANDARD" required aria-invalid="true" aria-errormessage="error"></label><p id="error">Report Layout is a required field.</p><div role="combobox" aria-label="Currency" aria-required="true">EUR</div>' : '<h1>Studio Aurora</h1><a href="/help">Help and cancellations</a><a href="/form">Create contact</a>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { url: `http://127.0.0.1:${server.address().port}`, records, requests };
}

export async function temporaryRoot() { return mkdtemp(join(tmpdir(), 'jev-explorer-test-')); }

export function scriptedEngine() {
  const base = formEngine();
  const requests = [];
  return { requests, async decide(request, options) {
    requests.push(structuredClone(request));
    const result = await base.decide(request, options);
    for (const [name, question] of Object.entries(request.questions)) {
      const options = Object.entries(question.criteria);
      if (name === 'action') {
        const target = options.find(([, value]) => value && typeof value === 'object' && value.kind === 'click' && ['Help and cancellations', 'Try again'].includes(value.target?.name));
        if (target) result.answers[name] = { choice: target[0], confidence: 0.95 };
        else if (request.state.page?.title === '' && request.state.page?.url?.endsWith('/help')) result.answers[name] = { choice: '__done__', confidence: 0.95 };
        else if (request.state.page?.url?.endsWith('/help')) result.answers[name] = { choice: '__done__', confidence: 0.95 };
      }
      const source = options.find(([, value]) => value && typeof value === 'object' && value.text === '36 hours');
      if (source) result.answers[name] = { choice: source[0], confidence: 0.95 };
    }
    return result;
  } };
}
