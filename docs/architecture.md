# Architecture

The supervising agent delegates an objective. Jev Explorer owns the exploration session and returns concise evidence when it finishes a useful segment or needs intervention.

The pinned browser engine handles DOM/ARIA observation, native Playwright effects, grounded selection, input binding and source extraction. This project adds the session lifecycle, cross-run memory, bounded handoff reports, typed-data adapters and MCP interface.

| File | Responsibility |
| --- | --- |
| `src/explore-browser.ts` | Open, explore, remember, resume, inspect, act and close |
| `src/compact.ts` | Bound the response while retaining essential provenance |
| `src/server.ts` | Six MCP tools and their validated input schemas |
| `src/page-state.ts` | Bounded readiness waits, semantic obstacle classification and verified optional dismissals |
| `src/typed-data.ts` | Validated data, batched semantic binding, deterministic formatting and field readback |
| `src/widgets.ts` | Owned autocomplete and calendar interaction, scoped observation and readback |
| `src/input-choice.ts` | Validate offered choices and applicable confidence |
| `src/types.ts` | Internal session, operation and result contracts |
| `src/main.ts` | Stdio transport and process lifecycle |

## Three kinds of context

1. **Current observation:** page, controls, values, records and explicit validation.
2. **Objective memory:** observed facts, supplied facts, attempted actions and outcomes.
3. **Full local trace:** evidence for diagnosis and reproduction, not automatically returned to the agent.

A successful click is not the same as an observed business effect. Entered text is not necessarily a committed selection. An extracted answer does not prove that every part of the original objective was completed.

## Handoff

The browser remains in the same process between tool calls. Missing values can be supplied without rebuilding the session. Known applied values are checked when their controls are still observable. Unknown submission outcomes block automatic continuation until the supervisor resolves them.

Stale observations can be retried in a bounded way without replaying actions. A commit attempt or unknown effect prevents that automatic recovery. Repeated actions on an unchanged observation trigger a handoff rather than an indefinite loop.

## Evaluation

Default tests exercise local browser behavior using controlled decisions. A separate live test uses real Jev calls and checks application records independently of the model. These tests establish specific properties; they do not establish a universal completion rate, comparative token savings, or correctness of an arbitrary business workflow.

## Typed data execution

The typed-data path alternates a fill opportunity with the pinned engine's one-step navigation. It uses the same decision wrapper for budgets, cancellation, tracing and objective memory. Jev selects the applicable supplied datum for each field in parallel, or marks the field irrelevant or ambiguous. Code consumes the first applicable field in document order, executes through an observed reference and checks its value and native validity. It recaptures the page before another effect; it does not reuse a batch of references after navigation.

Dates retain a canonical calendar-day value without timezone conversion. Native controls use ISO; explicit text-field hints determine formatting. Unknown or conflicting hints hand off unless the control exposes a supported owned calendar popup. Native selects use observed option identities, with a semantic decision for labels that differ from the supplied value. Owned autocomplete and calendar adapters use scoped snapshots, semantic option choices and readback. Widgets lacking an ownership relationship or meaningful readback are explicit limitations, not successful fills.

The adapter reads standard control metadata through uniquely identified accessible controls; native mutations use the engine's captured references. For standard calendar grid cells omitted by the engine inventory, the adapter captures cells inside the owned popup, derives local selectors from that observed inventory, and revalidates their label, month/row context, visibility and enabled state before passing the selector to the engine. Model output never supplies selectors, and arbitrary selectors remain unavailable through the MCP tool contract. Typed field effects use the same conservative authorization label check as engine actions. The default policy remains a heuristic, not a security boundary.

The readiness phase uses semantic dialog roles, scoped snapshots, observed controls and pointer hit-testing rather than site-specific selectors. Read-only observations interrupted by navigation become bounded stale-observation retries. It keeps the original obstruction handle across the dismissal to verify disappearance. One bounded post-`no-match` diagnosis distinguishes missing data, a transient state, an obstruction and an actual result. Legacy engine runs receive the initial readiness phase; typed runs repeat it between operations.
