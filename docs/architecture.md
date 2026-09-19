# Architecture

The supervising agent delegates an objective. Jev Explorer owns the exploration session and returns concise evidence when it finishes a useful segment or needs intervention.

The pinned browser engine handles DOM/ARIA observation, native Playwright effects, grounded selection, input binding and source extraction. This project adds the session lifecycle, cross-run memory, bounded handoff reports and MCP interface.

| File | Responsibility |
| --- | --- |
| `src/explore-browser.mjs` | Open, explore, remember, resume, inspect, act and close |
| `src/compact.mjs` | Bound the response while retaining essential provenance |
| `src/server.mjs` | Six MCP tools and their validated input schemas |
| `src/main.mjs` | Stdio transport and process lifecycle |

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
