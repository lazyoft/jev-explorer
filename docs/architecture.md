# Architecture

The supervising agent delegates an objective. Jev Explorer owns the exploration session and returns concise evidence when it finishes a useful segment or needs intervention.

The locally maintained browser engine (`packages/browser`) handles DOM/ARIA observation, native Playwright effects, grounded selection, input binding and source extraction. This project adds the session lifecycle, cross-run memory, bounded handoff reports, typed-data adapters and MCP interface.

| File | Responsibility |
| --- | --- |
| `src/explore-browser.ts` | Open, explore, remember, resume, inspect, act and close |
| `src/compact.ts` | Bound the response while retaining essential provenance |
| `src/server.ts` | Six MCP tools and their validated input schemas |
| `src/page-state.ts` | Bounded readiness waits, semantic obstacle classification and verified optional dismissals |
| `src/typed-data.ts` | Validated data, batched semantic binding, deterministic formatting and field readback |
| `src/date-range.ts` | Ordered date-range selection and readback from owned or same-form tabbed calendars |
| `src/control-name.ts` | Whitespace-tolerant, unique accessible-name matching |
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

One loop handles navigation, legacy values and typed data. It observes readiness, optionally fills supplied data, and lets the local engine yield after an input step or navigation action before observing again. It uses the same decision wrapper for budgets, cancellation, tracing and objective memory. Jev selects the applicable supplied datum for each field in parallel, or marks the field irrelevant or ambiguous. Code consumes the first applicable field in document order, executes through an observed reference and checks its value and native validity. It recaptures the page before another effect; it does not reuse a batch of references after navigation.

Dates retain a canonical calendar-day value without timezone conversion. Native controls use ISO; explicit text-field hints determine formatting. Unknown or conflicting hints hand off unless the control exposes a supported owned calendar popup. Native selects use observed option identities, with a semantic decision for labels that differ from the supplied value. Owned autocomplete and calendar adapters use scoped snapshots, semantic option choices and readback. Widgets lacking an ownership relationship or meaningful readback are explicit limitations, not successful fills.

The adapter reads standard control metadata through uniquely identified accessible controls; native mutations use the engine's captured references. For standard calendar grid cells omitted by the engine inventory, the adapter captures cells inside the owned popup, derives local selectors from that observed inventory, and revalidates their label, month/row context, visibility and enabled state before passing the selector to the engine. Model output never supplies selectors, and arbitrary selectors remain unavailable through the MCP tool contract. Typed adapters execute grounded input operations chosen by their semantic binding and widget decisions. Navigation reuses the engine's contextual effect classification; business mutations additionally require caller commit permission. No English keyword list or submit-button-type rule determines permission. Model classification is not a security boundary.

The readiness phase uses semantic dialog roles, scoped snapshots, observed controls and pointer hit-testing rather than site-specific selectors. Read-only observations interrupted by navigation become bounded stale-observation retries. It keeps the original obstruction handle across the dismissal to verify disappearance. One bounded post-`no-match` diagnosis distinguishes missing data, a transient state, an obstruction and an actual result. Both navigation and typed runs repeat readiness between operations. Dialog-only observations are transient; they do not constrain later navigation or evidence extraction. Required and invalid fields are judged against the task before becoming blockers; status text alone is not a missing input.

## Decision request boundaries

The engine frontier calls the explorer's synchronous preparation hook before
checking request size and conservative token estimates. This hook attaches memory, redacts and compacts repeated
context. The checked object reaches the provider without a second transformation.
Native action execution and loop detection retain their original observations.
The 128 KiB ceiling remains alongside local estimates capped at 48,000 total
tokens and 24,000 for state plus the longest question. Estimates use UTF-8 JSON
bytes divided by two, plus framing reserves. Batches may split; a single oversized
state/question requires narrower observation. The provider adapter repeats the
check before HTTP. Traces carry estimates, actual usage and matching call IDs;
these estimates are not an exact provider tokenizer.

Navigation recovers from local request-budget rejection by paging the captured
controls and text. The model receives bounded slices with unchanged identity,
context, objective and actual action history, plus explicit paging metadata. It
can choose an action or navigate observation pages. No-match advances to unseen
pages, and completion is unavailable until the whole captured observation has
been inspected. Paging does not mutate the browser or widen caller scope.
Existing budgets bound page traversal; actual provider failures are not retried.
Indivisible oversized observations remain explicit limitations.

The browser's interactive inventory excludes fully covered in-viewport controls
using hit tests before model selection. Pointer coordinates remain private to the
captured references. A short trial revalidates the selected target before dispatch,
and individual element actions use a two-second ceiling rather than the remaining
whole-run deadline. Safe preflight failures permit bounded re-observation; an
uncertain executed effect still prevents automatic replay.

DOM preview limits and model request limits are separate. Navigation recovers a
truncated text preview, or a truncated explicit/selected region, by acquiring its
complete supported DOM observation locally and transferring controls/texts in
batches. The existing decision pager then bounds what reaches Jev. Global IDs and
native references survive acquisition batches; caller scopes remain unchanged.
Candidate-count limits apply to decision pages rather than dropping later controls.
Public inspection previews and standalone extraction are unchanged.
