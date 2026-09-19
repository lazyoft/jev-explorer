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

The typed loop shares model, token, step and deadline budgets with navigation. Each iteration fills one field or runs one navigation step, then observes the same browser again. Model answers identify existing fields, data keys and option IDs. Only the applicable branch is consumed; low confidence on unrelated fields does not block navigation. Field-to-data and select-option choices below the prototype threshold of 0.7 hand off. The fill/navigation route only selects an execution path and does not authorize a write; filling still requires an accepted binding and the deterministic action guard. This threshold is not a universal accuracy guarantee.

Explicit outcomes include `INPUT_MISSING`, `INPUT_AMBIGUOUS`, `DATE_FORMAT_UNKNOWN`, `INPUT_TYPE_MISMATCH`, `INPUT_WIDGET_UNSUPPORTED` and `INPUT_READBACK_FAILED`. Failed readback is never counted as an applied input. `typedInputs[].verification = "readback_at_fill"` records a past field check, not present business correctness. Literal typed values are omitted from the compact input report, but may occur in private page evidence and traces.
