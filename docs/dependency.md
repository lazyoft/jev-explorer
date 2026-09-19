# Browser engine provenance

The runtime uses the official `@tontoko/jev-browser` 0.5.0 release archive:

https://github.com/tontoko/jev-browser/releases/download/v0.5.0/tontoko-jev-browser-0.5.0.tgz

- Upstream source: https://github.com/tontoko/jev-browser
- Release source commit: `92a318b1f4215f064e9dd663172fb08534d2abdc`
- Archive SHA-256: `f87bbeb98f033b18d08174a3b4f384652b326e59e9db937de7e866e8c724e99f`
- License: Apache-2.0

`package-lock.json` also records npm's archive integrity. Installation uses this compiled release directly, with no local vendor tree or nested build step. Changes to the dependency should be deliberate, pinned, and followed by the local and live handoff tests.
