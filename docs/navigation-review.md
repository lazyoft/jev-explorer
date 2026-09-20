# Navigation review: confirmed limitations

This is a code review of the current explorer wrapper and local browser engine.
Importing the engine alone did not fix these defects. The assessments below
distinguish subsequent locally tested corrections from remaining limitations. No external website runs were used for this review.

| Finding | Assessment and consequence |
| --- | --- |
| Separate navigation and typed-data paths | Corrected: both paths now use a loop that reevaluates readiness between yielded input/navigation steps and uses the same content-scope selection. Typed filling is an intended capability, not dead code globally. |
| Persistent modal scope | Corrected: scoped dialog observation is transient and does not restrict later navigation or extraction. |
| Unrelated validation affects outcome | Corrected: Jev classifies observed missing/invalid fields for task relevance before they affect the outcome. A local regression preserves evidence despite an unrelated invalid newsletter field. |
| English keyword write guard | Removed. The engine semantic effect is propagated to policy; requested business mutations also require explicit commit permission. Supervised clicks receive a contextual effect check. This remains model-dependent, not a security boundary. |
| Consent banners without dialog semantics | Initial readiness skips their diagnosis when no semantic modal is present. The unified flow may still diagnose the whole page after a no-match; therefore they are not categorically unreachable. |
| Unique accessible names for dismissal | Confirmed. The wrapper also requires a centre-point hit test. Duplicate names can exclude valid controls. |
| Noisy needs | Corrected: only task-relevant field blockers populate needs; generic alert/status text is not copied into it. |
| Readiness waits | Confirmed fixed count of three waits, each with up to two seconds plus observation overhead; this is not an exact six-second wall-clock bound. |
| Result-card shape assumptions | Confirmed. Heading/link structure, ancestor depth and size limits are heuristic; same-path links differing only in query parameters are excluded. This helper now runs in either path on truncated pages; its shape assumptions remain. |
| Compactor coupling | Confirmed. Navigation encoding depends on internal request shapes and question IDs. The local source and regression tests now make that coupling explicit; this does not prove live semantic equivalence. |
| Browser settings | The wrapper hard-codes observation limits, viewport and launch timeout; MCP callers cannot control these. The underlying engine has broader launch options. |
| Hidden internal options | Some core capabilities, including redaction configuration and navigation commands, are not exposed through the MCP schemas. They are not necessarily unreachable to direct library callers. |
| Generic MCP errors | Non-BrowserError exceptions lose detail at the tool boundary. Local traces are needed for diagnosis. |
| New tabs | The engine observes new pages and exposes explicit native tab selection. Automatic transfer of goal execution to a target-blank page is not implemented, and the explorer MCP does not expose tab selection. |

## Remaining follow-up scope

Nonmodal consent discovery, duplicate dismissal labels, loading budgets,
result-card shape assumptions and automatic new-tab continuation remain open.
Local tests cover a modal appearing after navigation, a nonblocking dialog beside
useful content, unrelated invalid fields, harmless labels formerly blocked by
keywords and model-classified mutations under explicit commit permission.
Live coverage is separate and does not establish general browser reliability.

Oversized captured navigation observations now use bounded paging, including
inside a selected/explicit region. Every captured control and text item remains
available across slices. This removes the requirement that one semantic region
alone fit the request budget. Navigation now completes truncated text previews and selected/explicit regions
through batched local acquisition. Region discovery for broad control-truncated
previews, indivisible oversized items and source-extraction budgets still apply.
