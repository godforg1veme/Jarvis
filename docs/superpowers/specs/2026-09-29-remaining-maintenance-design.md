# Remaining maintenance fixes

Date: 2026-09-29
Status: implemented and checked; see the dated maintenance result record.

The owner approved fixing the remaining file-command, Windows installation and Operations UI dependency issues. Work stays on a temporary branch until checks pass.

## Decisions

- A `покажи` request triggers Vision only when followed by an explicit visual target (screen, monitor, camera or a deictic target). File and folder commands continue through the existing file parser. Other visual commands keep their current behavior.
- Use Vitest 4.1.11, the first patched stable version in the existing compatible Vite/Node range. Refresh root Electron, Undici and fast-uri within their existing version ranges because the current audit reports new advisories.
- Provide `npm run setup` as the supported Windows installation command. It runs locked `npm ci` with the ffi-napi installer's documented package-name bypass for its crashing direct-addon probe. It then independently loads ffi-napi, ref-napi and Vosk through their public entry points and checks Electron's installed executable. Any failed installation or load returns a failing exit status. No dependency install scripts are globally disabled and no native binaries are copied from the previous installation.
- DE probes the NL peer and NL probes the DE peer. Their corresponding enabled timer instances and recent successful systemd results are correct. Record both host and peer to remove the old ambiguity; do not enable self-target timers.
- Run real Telegram-handler subscription E2E and adjacent tests. Real phone/Happ behavior can only be reported when actually observed; synthetic handlers do not prove phone taps.
- Keep credentials and user state private. No production dependency is added. Publish checked changes to main, synchronize source checkouts and remove the temporary task branch/worktree.

## Verification

File-command regression tests cover filenames, folders and explicit Vision targets. Clean setup must install from the lockfile and load native entry points. Operations UI tests, typecheck/build and audit must pass. Recheck both VPS source revisions, services, peer timers and public readiness. Record any unresolved manual acceptance honestly.
