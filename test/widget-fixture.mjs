import { createServer } from 'node:http';

export async function widgetSite(t) {
  const records = [];
  const server = createServer(async (req, res) => {
    if (req.url === '/search' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      const record = JSON.parse(body); records.push(record); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ result: `Available: ${record.place}; arrival ${record.arrival}; departure ${record.departure}; cleanliness 9.4.` })); return;
    }
    const mode = new URL(req.url, 'http://local').searchParams.get('mode') ?? '';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/persisted') { res.end('<label>Destination<input role="combobox" aria-expanded="false" aria-controls="absent-list" value="Harbor City, North Coast" oninput="window.retyped++"></label><script>window.retyped=0</script>'); return; }
    res.end(`<h1>Custom travel search</h1><form>
      <label>Destination<input name="place" role="combobox" aria-controls="places" aria-expanded="false" aria-autocomplete="list" required></label>
      <div id="places" role="listbox" hidden></div>
      ${mode === 'range' ? '<button type="button" aria-expanded="true" onclick="calendar.hidden=!calendar.hidden;this.setAttribute(\'aria-expanded\',String(!calendar.hidden))">Stay dates: Start — End</button><button type="button" role="tab" aria-controls="calendar">Calendar</button>' : ''}
      <label>Arrival<input name="arrival" readonly aria-haspopup="dialog" aria-controls="calendar" aria-expanded="false" required placeholder="Choose a date"></label>
      <label>Departure<input name="departure" readonly aria-haspopup="dialog" aria-controls="calendar" aria-expanded="false" required placeholder="Choose a date"></label>
      <button type="button" onclick="search(this.form)">Search</button>
    </form><div role="listbox" id="unrelated"><div role="option" onclick="window.wrongClicks++">Harbor City, North Coast</div></div>
    <div id="calendar" role="dialog" aria-label="Choose date" hidden><h2 id="month" aria-live="polite"></h2><button type="button" onclick="shift(-1)">Previous month</button><button type="button" onclick="shift(1)">Next month</button><div id="days" role="grid" aria-labelledby="month"></div><button type="button" onclick="applyDate()">Apply date</button></div><div id="results"></div>
    ${mode === 'crowded' ? Array.from({ length: 160 }, (_, i) => `<button>Background ${i}</button>`).join('') : ''}
    <script>
      const mode=${JSON.stringify(mode)};window.rangeValues={};window.wrongClicks=0;window.monthClicks=0;window.selectionClicks=0;
      let selectedPlace='',activeDate=null,pendingDate='',month=2,year=2030;
      const destination=document.querySelector('[name=place]'),places=document.querySelector('#places'),calendar=document.querySelector('#calendar');
      destination.oninput=()=>{selectedPlace='';destination.setAttribute('aria-expanded','true');places.hidden=false;places.innerHTML=mode==='stale-options'?'<div role="option" onclick="window.wrongClicks++">Old City</div>':'';setTimeout(()=>{places.innerHTML='';
        const options=mode==='ambiguous'?['Harbor City, North Coast','Harbor City, North Coast']:['Harbor City, North Coast','Harbor City, South Island','Harbor Village'];
        options.forEach((text,index)=>{const option=document.createElement('div');option.setAttribute('role','option');option.textContent=text;option.onclick=()=>{window.selectionClicks++;if(mode==='reject-option')return;selectedPlace=index===0?'harbor-north':'other';destination.value=text;destination.setAttribute('aria-expanded','false');places.hidden=true;};places.append(option);});
      },mode==='stale-options'?700:100);};
      document.querySelectorAll('[aria-haspopup=dialog]').forEach(input=>input.onclick=()=>{activeDate=input;pendingDate='';month=2;year=2030;input.setAttribute('aria-expanded','true');calendar.hidden=false;renderCalendar();});
      function renderCalendar(){document.querySelector('#month').textContent=new Date(Date.UTC(year,month,1)).toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});const days=document.querySelector('#days');days.innerHTML='';for(let day=1;day<=new Date(Date.UTC(year,month+1,0)).getUTCDate();day++){const date=new Date(Date.UTC(year,month,day)),iso=date.toISOString().slice(0,10),button=document.createElement(mode==='grid-cells'?'td':'button');if(mode==='grid-cells'){button.setAttribute('role','gridcell');button.tabIndex=0;}else button.type='button';button.textContent=day;button.setAttribute('aria-label',date.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}));if(mode==='disabled'&&iso==='2030-04-11')button.disabled=true;button.onclick=()=>{if(mode==='range'){const range=window.rangeValues;if(!range.start||range.end){range.start=iso;delete range.end;}else range.end=iso;document.querySelector('button[aria-expanded]').textContent='Stay dates: '+range.start+' — '+(range.end||'End');return;}pendingDate=iso;days.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed','false'));button.setAttribute('aria-pressed','true');};days.append(button);}}
      if(mode==='range'){document.querySelectorAll('label').forEach(label=>label.remove());calendar.hidden=false;calendar.setAttribute('role','tabpanel');renderCalendar();}
      function shift(delta){window.monthClicks++;if(mode==='stuck')return;month+=delta;if(month>11){year++;month=0;}if(month<0){year--;month=11;}renderCalendar();}
      function applyDate(){if(!pendingDate)return;activeDate.value=mode==='wrong-date'?'2030-04-12':pendingDate;activeDate.setAttribute('aria-expanded','false');calendar.hidden=true;}
      async function search(form){if(!form.reportValidity()||!selectedPlace||!form.elements.arrival.value||!form.elements.departure.value)return;const response=await fetch('/search',{method:'POST',body:JSON.stringify({...Object.fromEntries(new FormData(form)),placeId:selectedPlace})});const data=await response.json();form.remove();calendar.remove();document.querySelector('#unrelated').remove();document.querySelector('#results').textContent=data.result;}
    </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { url: `http://127.0.0.1:${server.address().port}`, records };
}
export const widgetData = {
  city: { type: 'text', value: 'Harbor City', description: 'Destination city on the North Coast, not South Island' },
  start: { type: 'date', value: '2030-04-11', description: 'Arrival, check-in date' },
  end: { type: 'date', value: '2030-04-14', description: 'Departure, check-out date' },
};
