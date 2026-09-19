import { createServer } from 'node:http';

export async function typedSite(t) {
  const records = [];
  const server = createServer(async (req, res) => {
    if (req.url === '/search' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      records.push(JSON.parse(body)); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ result: 'Synthetic hotel: cleanliness 9.4; three nights available.' })); return;
    }
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/start') {
      res.end(`<h1>Guest details</h1><form><label>First name<input name="first" required></label><label>Last name<input name="last" required></label><button type="button" onclick="sessionStorage.guest=JSON.stringify(Object.fromEntries(new FormData(this.form)));location.href='/trip'">Next</button></form>`); return;
    }
    if (req.url === '/unknown') { res.end('<label>Arrival<input name="arrival" required></label>'); return; }
    if (req.url === '/reject') { res.end('<label>Arrival (DD/MM/YYYY)<input name="arrival" required oninput="this.value=\'\'"></label>'); return; }
    if (req.url === '/select') { res.end('<label>Adults<select name="adults"><option value="one">1 adult</option><option value="two">2 adults</option></select></label>'); return; }
    res.end(`<h1>Travel search</h1><form><label>Destination<input name="place" required></label><label>Arrival<input name="arrival" type="date" required></label><label>Departure<input name="departure" placeholder="DD/MM/YYYY" required></label><label>Adults<input name="adults" type="number" required min="1" max="6"></label><label>Include breakfast<input type="checkbox" name="breakfast"></label><button type="button" onclick="search(this.form)">Search</button></form><div id="results"></div>
    <script>window.edits={};document.querySelectorAll('input').forEach(input=>input.addEventListener('input',()=>window.edits[input.name]=(window.edits[input.name]||0)+1));async function search(form){if(!form.reportValidity())return;const guest=JSON.parse(sessionStorage.guest||'{}');const payload={...guest,...Object.fromEntries(new FormData(form)),breakfast:form.elements.breakfast.checked};const response=await fetch('/search',{method:'POST',body:JSON.stringify(payload)});const data=await response.json();form.remove();document.querySelector('#results').textContent=data.result;}</script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { url: `http://127.0.0.1:${server.address().port}`, records };
}

export const tripData = {
  given: { type: 'text', value: 'Ada', description: 'Guest first name' },
  family: { type: 'text', value: 'Example', description: 'Guest last name' },
  city: { type: 'text', value: 'Harbor City', description: 'Travel destination' },
  start: { type: 'date', value: '2030-04-11', description: 'Arrival, check-in date' },
  end: { type: 'date', value: '2030-04-14', description: 'Departure, check-out date' },
  party: { type: 'number', value: 2, description: 'Number of adults' },
  breakfast: { type: 'boolean', value: true, description: 'Include breakfast in search' },
};
