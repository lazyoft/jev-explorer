# Browser engine provenance

The runtime uses the local `@lazyoft/jev-browser` npm workspace in
`packages/browser`. Source and tests are maintained in this repository.

- Upstream source: https://github.com/tontoko/jev-browser
- Imported version: `@tontoko/jev-browser` 0.5.0
- Source commit: `92a318b1f4215f064e9dd663172fb08534d2abdc`
- Source archive: https://codeload.github.com/tontoko/jev-browser/tar.gz/92a318b1f4215f064e9dd663172fb08534d2abdc
- Source archive SHA-256: `53c3a0b00a6449ed91f4ce04271bd0404fc904c169f4f907b82ddad0fbd24b6a`
- License: Apache-2.0, retained in `packages/browser/LICENSE`
- Attribution and local modifications: `packages/browser/NOTICE`
- Bundled component notices: `packages/browser/THIRD_PARTY_NOTICES.txt`

The root lockfile resolves the engine to the local workspace. `npm run build`
compiles the engine before the MCP wrapper; `npm run check` runs both upstream
local regression tests and the explorer tests. No live provider calls are part
of that command. Source changes to the imported engine carry modification notices.

The local fork prepares and compacts decision requests before the 128 KiB
frontier checks. It retains the byte limit and adds conservative total and
state-plus-question token estimates; requests that remain too large stop locally.
This does not establish end-to-end reliability on any external website.
