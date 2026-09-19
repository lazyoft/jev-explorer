import { createServer } from 'node:http';

export async function readinessSite(t) {
  const server = createServer((req, res) => {
    const mode = new URL(req.url, 'http://local').searchParams.get('mode') ?? '';
    const form = `<form aria-label="Destination search"><label>Destination<input name="city" required></label><button type="button" onclick="window.searches++;document.querySelector('#result').textContent='Search result: '+this.form.city.value;this.form.remove()">Search</button></form><p id="result" role="status"></p>`;
    const dialogs = mode === 'security' ? '<div role="dialog" aria-modal="true">Security challenge: authentication required<button onclick="window.unwanted++">Continue verification</button></div>' : mode === 'workflow' ? '' : `<div role="dialog" aria-label="Optional analytics"><p>Optional analytics cookies</p><button onclick="window.dismissals.push('analytics');this.parentElement.remove()">Decline</button><button onclick="window.unwanted++">Accept</button></div><div role="dialog" aria-label="Optional newsletter"><p>Optional newsletter offer</p><button onclick="window.dismissals.push('newsletter');${mode === 'noop' ? '' : 'this.parentElement.remove()'}">Not now</button></div>`;
    const body = mode === 'deadend' ? '<h1>Task not achieved</h1><p>No useful controls are available.</p>' : mode === 'workflow' ? `<div role="dialog" aria-label="Destination search">${form}</div>` : form + (mode === 'crowded' ? Array.from({ length: 160 }, (_, i) => `<button>Background ${i}</button>`).join('') : '') + dialogs;
    res.setHeader('Content-Type', 'text/html');
    res.end(`<html><head><title>Readiness test</title><style>[role=dialog]{position:fixed;inset:20%;background:white;border:1px solid;padding:20px}[role=dialog]:last-child{inset:25%;z-index:2}</style></head><body><script>window.dismissals=[];window.unwanted=0;window.searches=0;${mode === 'delay' ? `setTimeout(()=>document.body.insertAdjacentHTML('beforeend',${JSON.stringify(body)}),650)` : `document.body.insertAdjacentHTML('beforeend',${JSON.stringify(body)})`}</script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}
