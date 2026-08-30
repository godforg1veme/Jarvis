# Jarvis Windows Autostart Fix Design

## Goal

Make Windows autostart launch Jarvis instead of Electron's `default_app.asar`,
while avoiding any impact on unrelated applications and processes.

## Application behavior

`ensureWindowsAutoStart()` will continue to register the current Electron
executable as the login executable. Its arguments will depend on the runtime:

- Packaged build: `--hidden`.
- Development/source build: the absolute Jarvis application path followed by
  `--hidden`.

This keeps packaged behavior unchanged and gives the Electron development
executable the application path it currently lacks.

## Current-machine migration

The existing `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` value named
`electron.app.Electron` will be updated only if its current command points to
this repository's Electron executable. The replacement command will include
the absolute Jarvis repository path and `--hidden`.

Before stopping the obsolete process, diagnostics must confirm all of the
following:

1. The root process executable is this repository's `electron.exe`.
2. Its command line is the legacy `electron.exe --hidden` form without an app
   path.
3. Every process selected for termination is either that exact root PID or its
   descendant.

No process will be selected by the generic name `electron.exe` alone. Steam,
Dota, and unrelated Electron applications are outside the target set.

The corrected Jarvis application will not be started automatically during the
migration, avoiding Whisper/TTS GPU and CPU load while the user is gaming.

## Verification

- Add a unit-level assertion for packaged and development autostart arguments.
- Run the focused startup/autostart tests.
- Read back the registry value and confirm it contains the Jarvis path.
- Confirm the legacy root PID and only its verified descendants have exited.
- Confirm no new Jarvis, Python STT, or TTS worker was started.

## Failure handling

If the registry value or running process does not exactly match the expected
legacy Jarvis Electron command, stop without changing or terminating it and
report the mismatch.
