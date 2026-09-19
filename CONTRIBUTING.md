# Contributing

Use Node.js 24 or newer, install dependencies with `npm ci --ignore-scripts`, and install Chromium with `npx playwright install chromium`.

Run `npm run check` before submitting a pull request. Keep tests local and synthetic. The default suite must not require API keys or real accounts. Run the opt-in live test when changing real-provider handoff behavior, and state which verification was performed.

Keep each operation readable from observation through action and outcome. Reuse the browser engine instead of introducing an application-specific DOM parser. Preserve session continuity, source provenance, compact reports and unknown-effect handling.

Report failures honestly. A completed test harness is not proof that a business workflow succeeded. Preserve a failing reproduction rather than weakening an assertion or treating missing data as success.

Do not submit traces or screenshots from real accounts. Use synthetic examples and check the staged diff for credentials, private URLs and local paths.
