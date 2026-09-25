# Jarvis Desktop and VPS rollout Implementation Plan

> **For agentic workers:** Execute inline. Keep the old installed app and VPS source recoverable until the replacement is verified.

**Goal:** Bring the installed Windows client and the necessary VPS services to the exact reviewed `main` without losing local state or changing VPN service credentials.

**Architecture:** Build from the verified root-level source and update installations only where their running source is behind. Deploy the cloud server from a clean staged checkout using the existing Compose project and volumes; update a Host Agent only if an exact source comparison shows it is required.

**Tech Stack:** Electron, electron-builder, Node.js, Python Host Agent, Docker Compose, PostgreSQL, Ubuntu systemd.

**Spec:** `docs/superpowers/specs/2026-09-25-github-jarvis-cleanup-design.md`

## Global constraints

- Keep `.env`, PostgreSQL volumes, uploaded data, backups, models, and existing pending-operation IDs.
- Run the server preflight, database backup, migration check, readiness check, and smoke procedure before calling deployment complete.
- Keep Compose project name `jarvis-family`; do not recreate the database service or named volumes.
- Before changing the production VPN Supervisor boundary, verify its running flags and owner-acceptance record. This rollout must not change those flags or execute a repair.
- Do not install Docker or a full Compose stack on `jarvis-vps-new`.
- Do not remove an old installer or VPS source until the replacement passes its checks.

---

### Task 1: Compare current Windows source and installed executable

**Files:** Root `package.json`, `package-lock.json`, installed `Jarvis Desktop.exe`, local `dist/` installers.

- [x] Earlier inventory found installed Jarvis Desktop 1.0.0 and source package 1.0.0; compare again after the root move.
- [x] Verify the installed executable path and file version without launching a second copy:

```powershell
$installedExe = 'C:\Program Files\Jarvis Desktop\Jarvis Desktop.exe'
Get-Item -LiteralPath $installedExe | Select-Object FullName,Length,LastWriteTimeUtc
(Get-Item -LiteralPath $installedExe).VersionInfo | Select-Object FileVersion,ProductVersion
```

- [x] Compare Windows-client source commit times against the installed artifact date. If the installed app is stale, bump the package patch version to `1.0.1` in `package.json` and `package-lock.json` so the installed build is distinguishable.

### Task 2: Run desktop and Host Agent verification

**Files:** Existing root test scripts and `host-agent/tests/`; no new dependencies.

- [x] Run the automated Windows-client scripts listed by root `AGENTS.md` from the flattened root:

```powershell
node scripts/testEverythingSearch.js
node scripts/testFileCommands.js
node scripts/testRuntimeDataPath.js
node scripts/testToolGateway.js
node scripts/testRemoteProtocol.js
node scripts/testToolPolicyMapping.js
node scripts/testSttSettings.js
node scripts/testVoiceServiceSttProvider.js
node scripts/testVoiceQualityMonitor.js
node scripts/testVoiceLabController.js
node scripts/testGeminiVoiceAdvisor.js
node scripts/testVoiceLabRenderer.js
node scripts/testTrayMenu.js
node scripts/testQuantumCore.js
node scripts/testLifeOsIpc.js
node scripts/testLifeOsRenderer.js
node scripts/testLifeOsBrowser.cjs
node scripts/testLifeOsDesktopAcceptance.js
node scripts/testVisionTransport.js
node scripts/testVisionRuntime.js
node scripts/testVisionIpc.js
node scripts/testVisionMediaPermission.js
node scripts/testObjectReconciler.js
node scripts/testSceneState.js
node scripts/testVisionRendererBrowser.cjs
node scripts/testVisionCaptureRendererBrowser.cjs
python scripts/testFasterWhisperQuality.py
```

Expected: report each command as pass, fail, or unavailable with the concrete reason. Do not run the hardware camera probe as part of a headless suite.
- [x] Run cloud/desktop Node tests:

```powershell
npm run test:cloud
```

- [x] Run the Operations UI unit suite, production build, and browser fixture from the flattened root:

```powershell
Push-Location .\ops-ui
npm ci
npm test
npm run build
Pop-Location
node scripts/testOperationsBrowser.cjs
```

Expected: unit tests and build pass. If the browser fixture cannot find its configured Playwright runtime or Edge, report that specific missing runtime rather than treating it as a pass.

- [x] Run Host Agent tests from a Python environment already installed on the machine:

```powershell
$env:PYTHONPATH = 'host-agent'
python -m unittest discover -s host-agent/tests
```

Expected: all non-skipped relevant tests pass. Record any unavailable hardware or provider checks as unverified.

### Task 3: Build and install the current Windows client

**Files:** Root `dist/` installer and installed application.

- [x] Confirm local Vosk model and bundled Node runtime assets are present. If a required asset is missing, run the project preparation script instead of copying an unknown build directory.
- [x] Build the installer:

```powershell
npm run dist:win
```

- [x] Verify the installer filename reports the reviewed package version and inspect its size and timestamp before installation.
- [x] Attempt the silent upgrade twice without changing installed app data; both Windows UAC requests were cancelled, so the installed version remains 1.0.0.

```powershell
$installer = (Resolve-Path '.\dist\Jarvis-Desktop-1.0.1-Setup.exe').Path
$process = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
if ($process.ExitCode -ne 0) { throw "Installer exited with $($process.ExitCode)" }
```

- [ ] Re-read the installed executable product version and confirm Jarvis starts after an administrator approves UAC. Keep the prior installer until both checks pass.
- [ ] Remove obsolete `dist/` installers only after the new installation is verified; keep build output untracked.

### Task 4: Inspect production rollout preconditions

**Files:** Read-only production host checks; no deployment yet.

- [x] Current production checkout is on old commit `ec3cac1` and has mixed tracked and untracked source, staging folders, backups, `.env`, and `pendingCommandId`.
- [x] Current public readiness check returned HTTP 200; Compose server, PostgreSQL, GigaAM, and Cloudflare services were running, with server/database/worker health checks healthy. The production image is `sha256:c95cc41d1b4fdcd17a14c881d498ae029a11b912ba2de28ac2570b6caf5afccb`.
- [x] The live image lacks both subscription-label interaction kinds, and production PostgreSQL has not applied migration 028. The current source catalog keeps only owner-confirmed Xray/Hysteria2 restart playbooks enabled; restore playbooks are disabled. A real NL Xray owner-approved repair completed on 2026-09-24 and is recorded in the rollout docs.
- [x] Re-read these conditions immediately before deployment. Do not run `git reset`, `git clean`, or pull into the mixed checkout.
- [x] Inspect the Compose file’s project name, secret-file paths, bind mounts, and named volumes. Keep project name `jarvis-family` and every existing volume/bind path.
- [x] Verify the database backup destination has enough space and that the resulting backup does not print credentials or database content into the task log.
- [x] Read the Supervisor flags and recorded owner-acceptance status required by root `AGENTS.md`. Stop before rollout if the running boundary differs from the reviewed state.

### Task 5: Stage and deploy the production server from verified `main`

**Files:** New temporary release directory under `/home/deploy/apps/`, existing Compose services.

- [x] Fetch the published `main` commit and prepare a clean, uniquely named release directory outside the dirty production checkout.
- [x] Provide Compose only the existing deployment `.env` and explicitly required host secret files; do not copy secrets into the Git worktree or log their values.
- [x] Run `deploy/scripts/preflight.sh` and the documented one-time database backup from the release tree.
- [x] Build the new server image and update only the `server` service with project name `jarvis-family`. Leave `postgres`, `gigaam-asr`, `cloudflared`, the DE/NL VPN daemons, and their credentials untouched.
- [x] Confirm health checks pass, the application reports migration 028 applied, and the public readiness endpoint remains HTTP 200.
- [x] Run `deploy/scripts/smoke.sh` against the deployed server and inspect only bounded/sanitized log summaries.
- [x] Update the deployment record with image commit, migration result, smoke result, service state, and rollback location. Do not claim Telegram client acceptance unless a real owner tap was observed.

### Task 6: Compare both Host Agents with the reviewed source

**Files:** Current `host-agent/` source; installed Host Agent files and systemd units on `jarvis-vps` and `jarvis-vps-new`.

- [x] Compare hashes for the Host Agent modules and systemd units that define the deployed service against the reviewed `main`; never print credentials or client URIs.
- [x] If the installed source is equivalent, leave the Host Agent untouched and record its version/hash.
- [x] If a required code change is missing, run the complete Host Agent unit suite and inspect the deployment script’s backup/rollback behavior before updating that node.
- [x] Update only the Host Agent service on an affected node. Keep the Xray and Hysteria2 services, firewall rules, VPN clients, probe credentials, and probe timer configuration unchanged; the live check found DE disabled/inactive and NL enabled/active.
- [x] After any Host Agent update, verify the socket protocol, active service state, VPN health snapshot, and both service uptimes. Do not issue a client, restart VPN, or enable a probe timer.
- [x] Do not install Docker or Compose on `jarvis-vps-new`.

### Task 7: Final cross-environment comparison

**Files:** GitHub `main`, `F:\test\jarvis`, installed Windows client, and any updated VPS release.

- [x] Compare the Git SHA in GitHub and the canonical Windows clone. Report any service-specific deployed image/Host Agent hash separately because those installations do not track Git branches.
- [x] Verify production Compose health, migration 028, public readiness, and Host Agent state. Installed Windows version remains 1.0.0 pending UAC approval.
- [x] List all checks that could not run and their concrete reason; do not infer real Telegram or hardware acceptance from automated tests.
