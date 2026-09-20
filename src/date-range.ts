import { BrowserError } from '@lazyoft/jev-browser';
import type { DecisionEngine, ElementInfo, JevBrowser, NativeCommand, OperationOptions } from '@lazyoft/jev-browser';
import type { Control, Datum } from './typed-data.js';
import { chosen } from './input-choice.js';

interface RangeArgs {
  core: JevBrowser; control: Control; datum: Extract<Datum, { type: 'date-range' }>; objective: string;
  previousSelection?: string | boolean;
  engine: DecisionEngine; operation: OperationOptions;
  act: (command: NativeCommand, target: ElementInfo) => Promise<void>;
}

export async function dateRange(args: RangeArgs): Promise<{ value: string; format: string; reused?: boolean }> {
  const { core, control, datum, engine, operation } = args;
  const trigger = await control.locator.elementHandle();
  if (!trigger) throw new BrowserError('STALE_TARGET', 'The date range trigger disappeared.');
  try {
    const read = () => trigger.evaluate(node => ({ value: node.getAttribute('aria-valuetext') ?? (node instanceof HTMLInputElement ? node.value : node.textContent?.trim() ?? ''), expanded: node.getAttribute('aria-expanded') === 'true' }));
    const verify = async (selected: string[]) => {
      const actual = await read();
      const criteria = { match: 'The field displays the supplied start and end dates in the requested order, consistently with observed calendar date labels.', different: 'The dates differ or the field still asks for a start or end date.', unknown: 'Insufficient evidence for the complete requested date range.' };
      const result = await engine.decide({ state: { task: args.objective, expected: datum.value, description: datum.description ?? '', actual: actual.value, selectedDateLabels: selected }, questions: { range_readback: { type: 'choice', instructions: 'Verify both endpoints of the date range from the field display and observed date labels. A successful click alone is not a confirmed range. Preserve start/end order, month and year.', criteria } } }, operation);
      return { matched: chosen(result, 'range_readback', criteria) === 'match', actual };
    };
    const initial = await read();
    if (typeof args.previousSelection === 'string' && initial.value === args.previousSelection) return { value: initial.value, format: 'date-range-selection', reused: true };
    if (!control.element.expanded) await args.act({ command: 'click', ref: control.element.id }, control.element);
    const panelScopes = await trigger.evaluate(node => {
      const form = node.closest('form') ?? node.parentElement;
      const owners = [node, ...Array.from(form?.querySelectorAll('[role="tab"][aria-controls]') ?? [])];
      return owners.flatMap(owner => (owner.getAttribute('aria-controls') ?? owner.getAttribute('aria-owns') ?? '').split(/\s+/).filter(Boolean).flatMap(id => {
        const panel = node.ownerDocument.getElementById(id);
        return panel && panel.getClientRects().length > 0 ? [{ selector: '#' + CSS.escape(id), label: owner.getAttribute('aria-label') ?? owner.textContent?.trim() ?? '', text: (panel.textContent ?? '').trim().slice(0, 1200) }] : [];
      }));
    });
    if (!panelScopes.length) throw new BrowserError('INPUT_WIDGET_UNSUPPORTED', 'The range control has no visible owned or same-form tab-controlled calendar panel.');
    let panelIndex = 0;
    if (panelScopes.length > 1) {
      const panelCriteria = { ...Object.fromEntries(panelScopes.map((panel, i) => [`p${i}`, { label: panel.label, text: panel.text }])), __none__: 'No visible calendar panel belongs to this date range.' };
      const picked = await engine.decide({ state: { task: args.objective, field: control.element.name, expected: datum.value }, questions: { range_panel: { type: 'choice', instructions: 'Choose the visible calendar panel containing day controls for the requested date range. A day calendar may also include flexibility controls. Do not select a separate flexible-date-only or unrelated panel.', criteria: panelCriteria } } }, operation);
      const panelId = chosen(picked, 'range_panel', panelCriteria);
      if (panelId === '__none__') throw new BrowserError('INPUT_WIDGET_UNSUPPORTED', 'No calendar panel was identified for the range.');
      panelIndex = Number(panelId.slice(1));
    }
    const scope = panelScopes[panelIndex].selector;
    const selected: string[] = [];
    for (const [endpoint, date] of Object.entries(datum.value)) {
      let applied = false;
      const seen = new Set<string>();
      for (let step = 0; step < 16; step++) {
        operation.signal?.throwIfAborted();
        const snapshot = await core.snapshot({ ...operation, scope });
        if (snapshot.truncatedElements) throw new BrowserError('OBSERVATION_LIMIT', 'The range calendar control inventory is incomplete.');
        const targets = snapshot.elements.filter(element => !element.disabled && ['button', 'checkbox', 'radio', 'gridcell', 'cell'].includes(element.role));
        const criteria = { ...Object.fromEntries(targets.map((target, i) => [`d${i}`, { role: target.role, name: target.name, context: target.context, checked: target.checked ?? null }])), __none__: 'No applicable visible control.' };
        const result = await engine.decide({ state: { task: args.objective, endpoint, requestedDate: date, range: datum.value, previousSelectedLabels: selected, textObservationComplete: !snapshot.truncatedTexts, headings: snapshot.texts.filter(text => text.role === 'heading').map(text => text.text) }, questions: {
          range_day: { type: 'choice', instructions: 'Select only the enabled day control for requestedDate, preserving its complete day, month and year from the observed control label and available headings. Never infer a missing month or year. If that day is not shown, choose __none__; never choose navigation or a nearby date here.', criteria },
          range_navigation: { type: 'choice', instructions: 'If requestedDate is not shown, select the month/year navigation control that moves toward it. Otherwise choose __none__. This answer is ignored when range_day identifies the day.', criteria },
        } }, operation);
        const day = chosen(result, 'range_day', criteria);
        let choice = day;
        if (day === '__none__') {
          let navigation = result;
          if (result.answers.range_navigation.choice === '__none__' || result.answers.range_navigation.confidence < 0.7) navigation = await engine.decide({ state: { requestedDate: date, displayedMonths: snapshot.texts.filter(text => text.role === 'heading').map(text => text.text), dayNotVisible: true }, questions: { range_navigation: { type: 'choice', instructions: 'The requested day is not in the current visible calendar. Which observed month/year navigation control moves the displayed calendar toward requestedDate? Choose only calendar navigation, not a day or confirmation button. Choose __none__ only when no such control is available.', criteria } } }, operation);
          choice = chosen(navigation, 'range_navigation', criteria);
        }
        if (choice === '__none__') throw new BrowserError('INPUT_AMBIGUOUS', 'The requested range endpoint has no observed enabled selection or navigation.');
        const target = targets[Number(choice.slice(1))];
        const fingerprint = JSON.stringify([snapshot.texts.map(text => text.text), target.name]);
        if (seen.has(fingerprint)) throw new BrowserError('NO_PROGRESS', 'The range calendar did not advance.');
        seen.add(fingerprint);
        await args.act({ command: 'click', ref: target.id }, target);
        if (day !== '__none__') { selected.push(target.name); applied = true; break; }
      }
      if (!applied) throw new BrowserError('INPUT_WIDGET_LIMIT', 'Date range navigation exceeded its action limit.');
    }
    const checked = await verify(selected);
    if (!checked.matched) throw new BrowserError('INPUT_READBACK_FAILED', 'The date range field does not confirm both supplied endpoints.');
    return { value: checked.actual.value, format: 'date-range-selection' };
  } finally { await trigger.dispose(); }
}
