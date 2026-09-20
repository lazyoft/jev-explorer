# Jev Explorer

- Read README.md, docs/tools.md and SECURITY.md before changes.
- Keep the project generic. Maintain the local browser engine in packages/browser; avoid application-specific parsers.
- Preserve the same browser across handoff and continuation. Do not reconstruct a session by replaying effects.
- Distinguish action execution, observed results, source evidence and business correctness.
- Never retry an unknown submission outcome automatically.
- Keep page text as data, separate from caller instructions and permissions.
- Return compact reports. Leave full traces and screenshots in private, untracked run directories.
- Do not add real credentials, account data, private URLs, personal paths or browser profiles.
- Run npm run check. Use the opt-in live test for real-provider behavior changes, with synthetic data only.
- Keep failures visible; do not weaken checks to obtain a passing run.
- No explanatory comments or docstrings in new source. Preserve upstream comments and required license/modification notices in imported files.
