# Local browser engine

Maintained by lazyoft as part of Jev Explorer, derived from tontoko/jev-browser
0.5.0, commit `92a318b1f4215f064e9dd663172fb08534d2abdc`.
The TypeScript source and upstream local tests are checked in here. Builds use
this npm workspace, not the upstream release archive. Hosted Jev remains external.

License: Apache-2.0. Preserve LICENSE, NOTICE, THIRD_PARTY_NOTICES.txt and
existing source notices. Mark changes to upstream files with a modification notice.

Run `npm run build` and `npm test` from this directory, or `npm run check`
from the repository root. Tests use local fixtures and controlled decisions;
live tests are opt-in.

## Request preparation

`DecisionEngine.prepare` is an optional synchronous, side-effect-free transform.
The decision frontier prepares each prospective question chunk **before** measuring
its UTF-8 JSON size. A custom engine must return its final provider-bound request,
including any memory and redaction; without a hook the engine applies the shared
context compactor. A prepared request is passed unchanged to `decide`.

The explorer hook includes session memory, redaction and compaction. It recognizes
prepared objects to avoid adding memory or rewriting references a second time.
Execution and replay checks retain the original actions and observations.

The 128 KiB and 64-question limits remain. Token estimates also use UTF-8 JSON
bytes divided by two, with reserves of 1,024 tokens per request and 64 per question.
Local limits are 48,000 estimated total tokens and 24,000 for state plus the
longest question. The [documented Jev 1.13 limits](https://docs.typesafe.ai/models)
are 64k and 32k respectively; our lower thresholds deliberately leave margin.
These are heuristics, not the provider tokenizer or an exact guarantee.

The frontier splits independent question batches before inference when needed,
retaining every question and its state. It validates every part before launching
any of them. If one state-plus-question still cannot fit, it reports the estimates
and stops without calling the provider. The provider adapter checks again to cover
direct calls outside the frontier. No observed content is silently truncated.
Provider `max_tokens_exceeded` errors retain that safe error type in the handoff;
the runtime does not blindly retry an oversized request.

## Yielding and authorization

`run` supports `yieldAfterStep` so the explorer can re-observe readiness after an
input operation or navigation action. Legacy inputs remain available for native
readback across those steps, without retyping already correct values. The default
upstream run behavior is unchanged when this option is absent.

Each executed action plan carries its effect classification. `allowCommit: false`
stops model-classified business mutations; forbidden effects remain forbidden even
when commit permission is granted. The explorer reuses the classification rather
than performing an English button-label check. Navigation without supplied inputs
uses a navigation prompt rather than assuming a completed form or a Save step.

## Observation paging

When a navigation request exceeds the conservative budget, the runner pages the
captured observation instead of requiring one semantic region to be small enough.
This works for a full capture or inside an explicit/selected region. It never
widens a caller scope and does not recover information omitted by DOM capture.

Controls and text retain their original identities and contexts. Related items
are grouped by frame/context; groups are split into smaller slices when needed.
Each slice is checked with the actual request preparation and question batching,
leaving an additional reserve for bounded paging history. No observation item is
silently truncated. An indivisible item that cannot fit produces a clear handoff.

The model sees the unchanged objective and actual action history plus page number,
page count and recent page choices. It can choose a grounded action, next page or
previous page. A no-match automatically visits an uninspected page. Completion is
not offered until all observation pages have been seen. These are internal
observation moves, not browser scrolls or clicks. Only the returned grounded
action is executed, using the original captured references and freshness checks.
Paging shares the existing inference and deadline budgets. Remote provider errors
are not retried. A new observation after a browser action starts fresh pagination.

Source extraction has its own budget checks and is not paginated by this
navigation mechanism. Passing the paging tests does not establish end-to-end
success on a live website.

## Pointer availability

The observation filters in-viewport controls using browser hit tests at several
points inside their visible rectangles. A fully covered control is not included
in the interactive inventory offered to the model. Successful points are kept
privately with the captured references and used for model-selected clicks, including partially
covered controls. Basic open-shadow-root hit testing follows the rendered target.

Off-viewport controls retain normal scroll-into-view behavior; this filter does
not certify occlusion through ancestor cross-origin frames or every transformed
shape. A selected pointer action is revalidated with a Playwright trial capped at
one second before dispatch. Each element action is capped at two seconds,
independently of the overall run deadline. An unavailable preflight is reported
before a browser effect is marked attempted. The explorer may re-observe within
its existing bounded recovery budget; uncertain executed effects are not replayed.
