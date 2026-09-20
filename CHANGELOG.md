# Changelog

## Unreleased — local browser engine and unified navigation

- Complete truncated navigation observations through batched local acquisition before applying model-budget pagination, retaining later controls and scope boundaries.

- Filter covered viewport controls before proposing actions; preserve usable click points and cap preflight/element-action waits independently of the run deadline.

- Default exploration to three minutes and pass MCP client timeout options in the SDK 2 argument position.

- Page oversized navigation observations with stable controls, text, objective and history; support next/previous slices and retain explicit scope and inference budgets.
- Estimate request tokens conservatively, split feasible question batches and enforce both total and state-plus-longest-question budgets before inference.
- Preserve provider context-limit errors and log estimates alongside identifiable decision calls.

- Run navigation and input handling through one observation loop, with transient modal scope and task-relevant blockers.
- Replace English label guards with the engine's semantic effect classification plus explicit commit permission; classify supervised clicks separately.
- Import the Apache-2.0 browser engine source and regression tests as a local npm workspace, preserving provenance and third-party notices.
- Prepare memory and compact repeated context before the engine request-size check; retain the 128 KiB limit.

## 0.4.0

- Wait for updated autocomplete suggestions and avoid repeated inference on unchanged sets.
- Add typed date ranges with ordered endpoint selection and final field readback.
- Resolve accessible controls across whitespace differences and verify existing composite summaries.
- Keep calendar days out of scalar checkbox binding when no boolean data is supplied.
- Add regression tests for stale suggestions, date ranges and invalid endpoints.

## 0.3.0

- Add generic page readiness handling for loading, optional overlays, usable task dialogs and blocked states.
- Verify dismissal effects before continuing and retain conservative action guards.
- Diagnose typed navigation with no next action without treating it as completion.
- Add synthetic stacked-dialog, delayed-loading, no-op-dismissal and security-challenge tests plus a real-Jev readiness test.

## 0.2.0

- Migrate production source to TypeScript with strict checking and compiled distribution.
- Add typed text, date, number and boolean data to exploration and continuation.
- Let Jev choose applicable field-to-data associations in one request.
- Format native and explicitly labelled date fields without guessing locale.
- Add semantic native-select and owned-autocomplete option matching with field readback.
- Add scoped custom calendar navigation, day selection and confirmation.
- Count widget effects against the shared action budget and stop on ambiguous or unchanged state.
- Preserve browser continuity and share budgets with typed input decisions.
- Add synthetic multi-page browser tests and an opt-in live Jev test.

## 0.1.0

- Six MCP tools for objective-driven exploration and supervisor handoff.
- Retained browser sessions, compact source evidence and cross-run progress.
- Explicit missing-input, validation, budget and no-progress outcomes.
- Supervisor resolution of unknown submission effects before retries.
- Native inspection, paginated target references and optional screenshots.
- Local synthetic regression tests and an opt-in real-provider MCP test.
