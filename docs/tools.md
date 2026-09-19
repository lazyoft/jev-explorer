# MCP tool contract

## Open and explore

`jev_open({url, headed?})` creates a dedicated browser without calling Jev. Use a headed session for manual login when needed. `jev_explore` can create a session directly from `url` or reuse `sessionId`.

`jev_explore` accepts:

| Field | Default | Purpose |
| --- | --- | --- |
| `objective` | Required | The result to pursue and relevant constraints |
| `url` / `sessionId` | One required | Starting page or retained session |
| `data` | `{}` | Up to 32 typed items: `{type, value, description?}`; types are `text`, `date`, `number`, `boolean` |
| `values` | `{}` | Supplied input data; nested objects are supported |
| `questions` | `[]` | Up to eight `{key, question}` source-extraction requests |
| `allowCommit` | `false` | Allow only submission effects explicitly authorized by the objective |
| `maxSteps` | `35` | Browser action budget |
| `maxCalls` | `20` | Decision request budget |
| `maxTokens` | `800000` | Confirmed input-token budget |
| `timeoutMs` | `60000` | Exploration deadline |

The token budget is checked before new requests. Requests already in flight may exceed it; reported usage retains the actual returned counts. Up to three sessions can be active per server process, with one operation at a time per session.

## Inspect and take over

`jev_inspect({sessionId})` returns a compact report without inference. Add `targets:true` for up to 35 current target references; use the returned `nextOffset` as `offset` for the next page. A fresh inspection can invalidate older references. `observationTruncated` distinguishes an incomplete browser observation from report pagination.

Use `screenshot:true` to receive a PNG through MCP. Screenshots are not included in ordinary handoffs.

`jev_act` accepts a `sessionId` and one native `action`. Examples:

```json
{"sessionId":"SESSION_ID","action":{"command":"click","ref":"OBSERVED_REF"}}
```

```json
{"sessionId":"SESSION_ID","action":{"command":"type","ref":"OBSERVED_REF","text":"Provided input"}}
```

Other supported actions are `hover`, `press_key`, `select_option`, `check`, `navigate`, `navigate_back`, `wait_for`, and `mouse` with `action:"wheel"`. These do not call Jev. Arbitrary JavaScript and unobserved generated selectors are not exposed.

## Continue

`jev_continue({sessionId, note?, values?, data?, facts?})` resumes the same objective. `facts` are caller-supplied `{key, value, url?}` records and remain distinguishable from observations. New values replace the corresponding supplied values. Historical findings are not treated as currently visible until their source context is observed again.

If a submission outcome is unknown, continuation requires `effectResolution` and a nonempty evidence-backed `note`:

- `confirmed`: acknowledge the observed effect without another browser action;
- `not_applied`: permit continuation after the supervisor has established that the effect did not occur.

The server does not infer this authorization from page text or model confidence.

## Results and artifacts

The compact result includes status, reason, underlying `workflowOutcome`, current page, findings with provenance, required inputs or issues, recent actions, usage, and local artifact paths. Full details live in:

- `trace.jsonl`: observations, decision requests/responses, and actions;
- `memory.json`: facts, outcomes, input progress and session metadata;
- `report.json`: compact result;
- `screen.png`: last captured viewport.

`sessionAlive` describes the session when the result is returned. `jev_close` or server shutdown ends that session. Persisted evidence does not restore a browser or justify replaying effects.

## Typed input behavior

`data` and nonempty legacy `values` are mutually exclusive, including during continuation. Dates are validated before a browser is opened. Replacing a data item replaces the whole descriptor; provide its type and value again. Descriptions distinguish roles such as arrival/departure or billing/shipping address.

The typed loop shares model, token, step and deadline budgets with navigation. Each iteration applies a field adapter or runs one navigation step, then observes the same browser again. Every native effect inside a widget adapter consumes the shared browser action budget. Model answers identify existing fields, data keys and option IDs. Only the applicable branch is consumed; low confidence on unrelated fields does not block navigation. Field-to-data choices below the prototype threshold of 0.7 get one focused confirmation with the selected candidate value as additional evidence. The confirmation must explicitly accept the binding at 0.7 or above; otherwise it hands off. Ambiguous/no-match choices do not become assignments. Select-option choices below 0.7 hand off directly. A binding selects a supplied datum or explicitly marks the field as irrelevant or ambiguous. Code chooses the input adapter from the observed control and datum type. Every native widget effect still passes the deterministic action guard. This threshold is not a universal accuracy guarantee.

Explicit outcomes include `INPUT_MISSING`, `INPUT_AMBIGUOUS`, `DATE_FORMAT_UNKNOWN`, `INPUT_TYPE_MISMATCH`, `INPUT_WIDGET_UNSUPPORTED`, `INPUT_WIDGET_LIMIT`, `INPUT_STEP_LIMIT` and `INPUT_READBACK_FAILED`. Failed readback is never counted as an applied input. `typedInputs[].verification = "readback_at_fill"` records a past field check, not present business correctness. Literal typed values are omitted from the compact input report, but may occur in private page evidence and traces.

### Owned widget popups

Autocomplete waits for options in the field's declared popup, then asks Jev to select the supplied identity among the enabled options. A query such as `Harbor City` can match `Harbor City, North Coast` using its supplied description. Options from unrelated lists are excluded. Indistinguishable candidates, missing options and a popup that never commits a selection hand off without claiming success.

Calendar adapters observe only the popup associated with the field. Jev chooses grounded month/year controls, day buttons or grid cells, and confirmation controls. Observed `aria-selected`, `aria-pressed` and `aria-checked` states distinguish a selected day from an unconfirmed click. The adapter supports the standard `Alt+ArrowDown` opening gesture for calendar comboboxes, stops after 18 calendar decisions or an earlier shared budget, and rejects a final date that does not match the supplied complete ISO day. Formatting or selected-state evidence is required; an executed click alone does not verify a date.

The public WAI State autocomplete remains an open compatibility case: field binding and its focused confirmation can stay below the acceptance threshold. The server hands off before typing. `test/widget-public-live.mjs` preserves the exact expected selection assertion rather than treating that handoff as success. The WAI calendar combobox and the synthetic owned-widget flow have passed with real Jev.

## Page readiness and optional obstructions

Empty or busy pages receive bounded waits for an observed change. When a visible dialog is present, the server scopes its observation to dialogs so a crowded background cannot hide their controls, then asks Jev to classify the page as usable, loading, obstructed by an optional overlay, complete, missing caller data, or blocked. Task dialogs remain usable; authentication and security challenges are not treated as optional dismissals.

For an optional obstruction, Jev judges the effect of each currently reachable control alongside the page classification. Code selects the first control whose effect is confidently classified as an optional dismissal or a decline of optional consent. No redundant global choice forces an order among equivalent dismissals; effect confidence and the existing action guard still apply. The server verifies disappearance of the original dialog or dismissal control before continuing. A no-op click produces `DISMISS_NOT_CONFIRMED` rather than another blind click.

Readiness handling runs before both legacy and typed exploration. The typed loop also reevaluates readiness between field/navigation steps and diagnoses `no-match` once. No grounded action is not proof of completion. Explicit outcomes include `PAGE_NOT_READY`, `PAGE_BLOCKED`, `PAGE_AMBIGUOUS`, `DISMISS_NOT_CONFIRMED` and `NO_GROUNDED_ACTION`. Readiness shares inference, action and deadline budgets with exploration; it is not an unbounded recovery loop.
