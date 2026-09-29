# Maintenance results — 2026-09-29

## Fixed

The command `покажи config.json в документах` now follows the file-command parser. The Vision matcher accepts `покажи` only with an explicit screen, monitor, camera or `это` target. Regression checks include filenames and folders as well as legitimate Vision requests.

Windows setup now uses `npm run setup`. It installs the lockfile, bypasses only ffi-napi's crashing direct-addon installer probe on Windows, and separately checks the public native modules and Electron executable. Dependency scripts stay enabled. Electron Builder now preserves these Node native dependencies instead of rebuilding them for Electron: the Vosk worker runs under the separately bundled Node executable. The packaged and installed Vosk model checks passed.

Desktop 1.0.2 was built and installed successfully (installer exit 0), with Electron 42.11.9. The installed corrected source matches the build. The application started and its Quantum Core Widget window appeared. User data remains present; a private backup was made under `%LOCALAPPDATA%/Jarvis-maintenance-backups/2026-09-29/`.

Operations UI uses Vitest 4.1.11. Electron, Undici and fast-uri were updated within the existing dependency ranges. Root and Operations UI audits reported zero vulnerabilities. Deprecation notices remain for older transitive packages; an audit result is not a guarantee against every possible security issue.

## Checks

- File-command regression failed before the change and passed afterwards.
- Visual intent, file commands, intent routing, Vision runtime/transport and Tool Gateway tests passed.
- Cloud client tests: 20 passed.
- Server tests: 590 passed, including automated Telegram subscription creation, binding and renaming flows.
- Operations UI: unit test, clean locked installation, TypeScript/Vite build and 27 browser viewport checks passed.
- Clean root setup, native module loading, packaged and installed Vosk recognition smoke checks passed.
- Both VPS source directories were clean before synchronization. Server/PostgreSQL/GigaAM readiness and public readiness were healthy; VPN and Host Agent services were active.

## VPN timers

The instance name means the destination peer. DE correctly runs `jarvis-vpn-probe@nl.timer`; NL correctly runs `jarvis-vpn-probe@de.timer`. Both are enabled and active. The self-target instances are disabled. The old conclusion that the DE timer was missing came from interpreting the peer name as the host name. No timer, service or credential was changed for this maintenance.

Read-only cached probe results on 2026-09-29 showed:

- DE → NL, 20:03:16 UTC: VLESS 443/8443 and Hysteria2 fixed 443/hopping all healthy.
- NL → DE, 20:01:59 UTC: VLESS 443/8443 and Hysteria2 fixed 443 healthy; hopping unknown with CHECK_UNAVAILABLE. The public hopping pool is configured. This bounded failure code does not distinguish client startup, a request failure or unavailable observation. It does not prove a broken timer or establish a specific code defect. No blind credential rotation or production repair was performed.

## Acceptance still requiring a real client

Automated Telegram handler coverage passed. This run did not complete real owner create/bind/rename taps in Telegram or phone-side Happ refresh and label acceptance. It also did not test microphone capture interactively after installation. These remain manual acceptance checks; a test suite or visible application window is not proof of those client flows.

Server production code did not change. The existing immutable server release remains in use; this maintenance updates source material and the Windows application without an unnecessary server restart.
