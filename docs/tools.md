# MCP tool contract

## Open and explore

`jev_open({url, headed?})` creates a dedicated browser without calling Jev. Use a headed session for manual login when needed. `jev_explore` can create a session directly from `url` or reuse `sessionId`.

`jev_explore` accepts:

| Field | Default | Purpose |
| --- | --- | --- |
| `objective` | Required | The result to pursue and relevant constraints |
| `url` / `sessionId` | One required | Starting page or retained session |
| `data` | `{}` | Up to 32 typed items: `{type, value, description?}`; types are `text`, `date`, `date-range`, `number`, `boolean` |
| `values` | `{}` | Supplied input data; nested objects are supported |
| `questions` | `[]` | Up to eight `{key, question}` source-extraction requests |
| `allowCommit` | `false` | Allow only submission effects explicitly authorized by the objective |
| `maxSteps` | `35` | Browser action budget |
| `maxCalls` | `20` | Decision request budget |
| `maxTokens` | `800000` | Confirmed input-token budget |
| `timeoutMs` | `180000` | Exploration deadline; independently bounded by the MCP client timeout |

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

Other supported actions are `hover`, `press_key`, `select_option`, `check`, `navigate`, `navigate_back`, `wait_for`, and `mouse` with `action:"wheel"`. Clicks, key presses and selection changes call Jev once to classify the effect against the objective; typing, navigation and observation remain native operations. Classification usage is reported separately in `policyUsage`. A supervised business mutation requires `allowCommit` and remains unresolved until its outcome is confirmed. Arbitrary JavaScript and unobserved generated selectors are not exposed.

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

One loop reevaluates readiness between input/navigation steps with or without typed data, and diagnoses `no-match` once. A transient dialog observation never becomes a persistent scope for navigation or extraction. No grounded action is not proof of completion. Explicit outcomes include `PAGE_NOT_READY`, `PAGE_BLOCKED`, `PAGE_AMBIGUOUS`, `DISMISS_NOT_CONFIRMED` and `NO_GROUNDED_ACTION`. Readiness shares inference, action and deadline budgets with exploration; it is not an unbounded recovery loop.

### Date ranges and suggestion freshness

`date-range` uses `value: {start: "YYYY-MM-DD", end: "YYYY-MM-DD"}` with a strictly later end. Day controls are selected from a complete observed control inventory; truncated decorative text is permitted only when the observed day labels and available headings identify the complete dates. Missing month/year evidence must not be inferred. A unique structurally associated calendar panel needs no model selection; multiple panels are disambiguated by Jev. The final visible range is verified. An open calendar does not invalidate correct dates; choosing whether to close it or navigate remains the next decision.

Autocomplete waits for a stable non-busy suggestion set. After a no-match, it waits for a changed set within the same five-second budget, without retyping or asking Jev again about unchanged options. Ambiguous matching identities still hand off. Control resolution tolerates whitespace differences between accessibility implementations, but still requires a unique observed name.

## Action effects and result relevance

The engine already asks Jev to classify candidate effects in context. The server
uses that classification rather than button-name keywords or HTML submit types.
`allowCommit: true` permits only business effects also judged requested by the
objective; it does not authorize conflicting actions. Form input adapters still
verify the supplied value after the observed input operation.

Invalid or required controls are independently judged for relevance to the task
before changing its outcome. Unrelated forms and generic status text are not
reported as missing caller data. These judgments do not certify business correctness.

## Per-request token estimates

The runtime estimates tokens using two UTF-8 JSON bytes per token plus reserves
of 1,024 per request and 64 per question. It caps the estimate at 48,000 for the
whole request and 24,000 for state plus the longest question, below Jev 1.13's
published 64k/32k limits. The estimator is deliberately conservative and is not
the provider tokenizer. It is separate from `maxTokens`, the cumulative run budget.

The decision frontier splits question batches when they can fit independently.
If even a single question plus its state is too large, `OBSERVATION_LIMIT` includes
the estimates and requests a narrower observation before any inference is sent.
The direct provider boundary also checks requests. There is no silent content
truncation or automatic replay after a provider `max_tokens_exceeded` response;
that response is reported as `PROVIDER_CONTEXT_LIMIT`. Traces retain estimated
and actual counts with call IDs so calibration can be checked over time.

During navigation, a local over-budget request activates observation paging.
Controls and text keep their original identities and contexts. Jev can choose an
action or request the next/previous observation page; these page moves do not
scroll or click the website. No-match visits an uninspected page instead of
concluding that the whole page has no useful action. Completion is unavailable
until all captured slices have been inspected. Actual effects use the original
references and are revalidated before execution. Inference and deadline budgets
bound traversal. Caller scopes are never widened, and indivisible oversized
items still hand off. This does not add pagination to source extraction.

## MCP client timeout

The default exploration deadline is three minutes. Clients must allow enough
time for that deadline plus browser startup and report cleanup; the test client
uses four minutes. With MCP SDK 2, pass options as the second argument:

```js
await client.callTool({ name: 'jev_explore', arguments: task }, { timeout: 240000 });
```

A third argument is ignored by the current JavaScript client. Raising the server
deadline cannot override a shorter timeout imposed by an external MCP client.

## Covered controls and action timeouts

Fully covered controls in the current viewport are omitted from available actions.
Hit testing is local to observation and uses no Jev calls. A selected pointer
action has a one-second preflight and element actions have a two-second execution
ceiling, each bounded further by the remaining run deadline. `ACTION_UNAVAILABLE`
means the preflight did not dispatch the action; the explorer can refresh state
within its bounded observation retries. This does not permit replaying uncertain
business effects. The overall exploration deadline remains three minutes.

Navigation can continue beyond a truncated DOM preview: the server acquires the
complete supported observation for the current scope in local batches, then uses
the model-budget pager. Preview limits are not interpreted as absence of later
controls or text. Inspect responses can still report preview truncation; that
flag describes the inspection preview, not a hard stop for navigation.
