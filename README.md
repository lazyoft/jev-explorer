# Jev Explorer

Delegate browser exploration to Jev. Get back concise findings, source evidence, and a browser session you can inspect and continue.

Jev Explorer is an MCP server for agents that should spend less context on routine browser navigation. Give it an objective rather than a sequence of clicks. It explores with [TypeSafe's Jev](https://docs.typesafe.ai/), retains progress, and hands control back when it finds evidence or needs help.

**Early prototype.** It includes a [locally maintained browser engine](packages/browser), derived from [`@tontoko/jev-browser`](https://github.com/tontoko/jev-browser) 0.5.0. It does not claim universal browser reliability or a measured speedup over other agents.

Known navigation limitations are tracked in [the current code review](docs/navigation-review.md).

## What it does

- Explores toward a natural-language objective and extracts previously unknown answers with verbatim source context.
- Keeps the browser alive across missing-input handoffs and supervisor interventions.
- Remembers findings, prior actions, observed outcomes, and supplied facts separately.
- Returns a compact report instead of automatically sending the full DOM and trace to the supervising agent.
- Waits for loading, dismisses optional obstructions, and verifies their disappearance before continuing.
- Pages oversized navigation observations within the request budget while retaining captured controls and text.
- Stops on budgets, repeated actions without progress, validation problems, and uncertain submission outcomes.
- Lets the supervisor inspect, act, continue, or close the same session.

```text
Agent gives an objective
        ↓
Jev observes → chooses → acts → observes the effect
        ↓
Compact findings + evidence + retained browser
        ↓
Agent reviews, supplies missing information, or takes over
        ↓
Jev continues in the same session
```

## Install

Requires **Node.js 24+**. An API key is needed for Jev inference. Inspection does not call the model. Supervised clicks, key presses and selection changes use a contextual Jev effect check.

```sh
git clone https://github.com/lazyoft/jev-explorer.git
cd jev-explorer
npm ci --ignore-scripts
npm run build
npx playwright install chromium
cp .env.example .env
```

Set `TYPESAFE_API_KEY` in your local `.env` file. It is ignored by Git. The default model is `jev-1.13.0`; override it with `JEV_MODEL` when deliberately evaluating another version.

The browser engine source is included in `packages/browser` and built as a local npm workspace. Upstream provenance, licenses and local changes are recorded in [dependency provenance](docs/dependency.md).

## Connect an MCP client

Use absolute paths in client configuration:

```json
{
  "mcpServers": {
    "jev-explorer": {
      "command": "node",
      "args": [
        "--env-file=/absolute/path/to/jev-explorer/.env",
        "/absolute/path/to/jev-explorer/bin/jev-explorer.mjs"
      ]
    }
  }
}
```

If your client already supplies the API key through its environment or secret manager, omit `--env-file`. No shell-profile reading, personal browser profile, Python launcher, or machine-specific configuration is required.

For Codex, the equivalent configuration is:

```toml
[mcp_servers.jev-explorer]
command = "node"
args = ["--env-file=/absolute/path/to/jev-explorer/.env", "/absolute/path/to/jev-explorer/bin/jev-explorer.mjs"]
startup_timeout_sec = 15
tool_timeout_sec = 240
```

You can also start the stdio server directly:

```sh
node --env-file=.env bin/jev-explorer.mjs
```

It waits for MCP messages; it is not an interactive terminal chatbot.

## Delegate an objective

Call `jev_explore`:

```json
{
  "url": "https://example.com",
  "objective": "Find the notice required to cancel a video appointment without a charge. Do not submit any forms.",
  "questions": [
    {
      "key": "notice",
      "question": "Minimum cancellation notice for video appointments, verbatim including the unit."
    }
  ],
  "allowCommit": false
}
```

The question defines what to discover, not the expected answer. The report includes the observed text, surrounding context, source URL, remaining issues, and a `sessionId`.

When the task needs information that was not supplied, use `jev_continue`:

```json
{
  "sessionId": "SESSION_ID_FROM_THE_PREVIOUS_RESULT",
  "note": "The missing email is now available. Continue the existing draft.",
  "values": { "email": "example@example.invalid" }
}
```

Input values come from the caller or observed sources. Jev chooses controls and values; it does not generate free-form prose. This prototype asks the supervising agent when it needs a new string rather than guessing it.

## Typed input data

Supply known data separately from the objective. Jev chooses which supplied datum, if any, should be applied to each observed field. The server copies the selected value, formats dates, executes through a current browser reference, and checks the value and field validity afterwards.

```json
{
  "url": "https://example.com/search",
  "objective": "Fill the travel search with the supplied data and show availability.",
  "data": {
    "destination": { "type": "text", "value": "Harbor City", "description": "Travel destination" },
    "arrival": { "type": "date", "value": "2030-04-11", "description": "Check-in date" },
    "departure": { "type": "date", "value": "2030-04-14", "description": "Check-out date" },
    "adults": { "type": "number", "value": 2, "description": "Number of adults" }
  }
}
```

Use `data` or legacy `values` in an exploration, not both. `jev_continue` accepts additional or replacement `data` items. A verified field is checked again when it remains visible; changing its supplied datum or its displayed value makes it eligible for filling again. Data is available to the workflow, not a requirement to fill every item on every page.

The first adapters support text inputs, native date inputs, text dates with an explicit format, combined date ranges, number inputs, checkboxes and single native selects. Date values must be real calendar dates in `YYYY-MM-DD` form. For text controls, supported visible hints are `DD/MM/YYYY`, `MM/DD/YYYY`, `DD.MM.YYYY`, `DD-MM-YYYY`, `YYYY/MM/DD` and `YYYY-MM-DD`, including Italian `gg/mm/aaaa`. No day/month order is guessed. Accessible autocomplete lists and custom calendars are also supported when the field identifies its popup with `aria-controls` or `aria-owns`. Autocomplete chooses among observed suggestions instead of requiring an exact label match. Calendars can navigate month/year controls, select a day and confirm it. Both require a valid field readback. Split date controls, visual-only calendars and widgets without an identifiable owned popup can still require handoff.

For a combined check-in/check-out control, provide one `date-range` item:

```json
{"stay":{"type":"date-range","value":{"start":"2030-04-11","end":"2030-04-14"},"description":"Check-in through check-out"}}
```

Both endpoints must be valid ISO dates, and end must follow start. The adapter uses a directly owned calendar or a visible tab-controlled panel in the same form. It verifies both endpoints in order before treating the range as applied. Composite buttons whose displayed value already matches the supplied scalar can be verified without editing; changing such a value still requires a supported editor.

Autocomplete observes suggestion changes and loading state for a bounded period. A no-match on an initial suggestion set does not immediately fail while a newer set may still arrive; unchanged sets do not trigger repeated inference or retyping.

Field/data associations are requested together. The code applies the first relevant association; if none applies, the browser engine continues navigation. Native select options are chosen in a further grounded decision using the supplied value. Model selection cannot manufacture a new value. `typedInputs` reports which datum was read back in which field; it does not certify a reservation, a saved record, or continued correctness after a later page transition.

## Tools

| Tool | Purpose |
| --- | --- |
| `jev_open` | Open a dedicated session, optionally headed for manual authentication, without inference |
| `jev_explore` | Explore toward an objective and return a compact handoff |
| `jev_continue` | Resume the same objective with missing values, notes, or sourced facts |
| `jev_inspect` | Inspect the session; request target references or a screenshot explicitly |
| `jev_act` | Perform one supervisor-directed native action without Jev |
| `jev_close` | Close the browser while retaining local evidence |

[Tool contract and examples](docs/tools.md)

## What a result means

| Status | Meaning |
| --- | --- |
| `ready_for_review` | Source evidence is available, or the supervisor confirmed an effect. This is not certified business correctness. |
| `needs_input` | A required value is still missing during the workflow. |
| `needs_review` | Validation, ambiguity, lack of progress, an uncertain effect, or another issue needs attention. |
| `budget_exhausted` | The configured model budget was reached; the browser remains available. |
| `closed` | The live browser no longer exists. Its trace is not a resumable browser session. |

`workflowOutcome` preserves the underlying workflow result separately. Finding one answer does not silently turn an incomplete workflow into a successful one.

When `pendingEffect` is true, inspect the outcome before retrying. The supervisor must explicitly resolve it with `effectResolution: "confirmed"` or `"not_applied"` and an evidence-backed note. Confirming an effect does not replay it.

## Privacy and limits

Reports are normally limited to about 6,500 characters. Full traces and screenshots stay in a private local run directory. Target lists and screenshot payloads are opt-in.

Runs default to `$XDG_STATE_HOME/jev-explorer/runs`, or `~/.local/state/jev-explorer/runs`. Override this with `JEV_EXPLORER_RUNS`. Sessions live in one MCP server process and expire after 30 minutes of inactivity. A server restart preserves files, not browser memory or cookies.

`allowCommit` defaults to false. Jev classifies action effects in context; code additionally requires commit permission for business mutations. These model-dependent checks are **not a security boundary or a universal read-only mode**. Browser controls can have unexpected effects. Use appropriately restricted accounts and only delegate authorized work.

Page text and evidence may contain sensitive information and may be sent to TypeSafe as decision context. Do not publish run directories. See [security and data handling](SECURITY.md).

Current limitations include non-standard widgets, values represented as selected tokens, visual-only interfaces, and incomplete modelling of application-specific dependencies. The server exposes dedicated browsers, not automatic attachment to personal browser profiles.

## Test and contribute

```sh
npm run check
```

Tests use real local browsers, synthetic applications, deterministic model decisions, and independent checks of saved records. No API key is needed for the default suite.

Source code is TypeScript with `strict` enabled. `npm run build` emits `dist/`; the existing `.mjs` command-line launcher remains compatible with client configurations. Build after pulling source changes.

For opt-in tests with actual Jev calls:

```sh
npm run test:live
npm run test:live:typed
npm run test:live:widgets
npm run test:live:page-state
npm run test:live:date-range
```

This makes paid API calls using synthetic local data. It does not run in CI or use real accounts. Local results are not a benchmark of arbitrary websites.

An additional opt-in `npm run test:live:public-widgets` exercises the W3C WAI public examples with synthetic data. It depends on those external pages and is excluded from CI. The custom calendar example has passed; the public State autocomplete currently hands off on binding confidence before typing, so that probe remains a failing compatibility reproduction. The synthetic end-to-end autocomplete/calendar flow passes with real Jev.

[Contributing](CONTRIBUTING.md) · [Architecture](docs/architecture.md) · [Changelog](CHANGELOG.md)

## License and attribution

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The hosted TypeSafe service and Jev model weights are not included. This is an independent project built on third-party software and services.
