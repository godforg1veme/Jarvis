# Desktop Writable Data Path Hardening

## Status

Approved for implementation on 2026-09-12.

## Problem

Older packaged Desktop builds wrote runtime JSON files below
`resources/app/data`. A normal Windows installation places that directory under
`C:\Program Files`, where non-elevated processes cannot create or update files.
The resulting `EPERM` exception could escape a timer callback and terminate the
Electron main process.

The current source redirects known runtime files to Electron's `userData`
directory, but the path-selection logic is duplicated across the main process
and several tool modules. That duplication makes regressions and inconsistent
packaged-mode behavior more likely.

## Design

Add one small CommonJS module that owns runtime data-path selection. It will:

- keep repository `data/` paths unchanged during development;
- map files contained by the repository `data/` directory to
  `app.getPath('userData')/data/` in packaged Electron execution;
- use containment-safe path checks instead of string-prefix checks;
- accept injected runtime information so behavior can be tested without
  launching Electron;
- fall back to the requested path when Electron is unavailable or the path is
  outside the managed data directory.

`main.js`, application indexing, AI intent caching, file indexing, learned app
storage, and agent history will use this shared helper. Read operations retain
the existing migration behavior: prefer the writable location, then fall back
to bundled defaults. Write operations remain bounded by their existing error
handling and must not crash the main process on filesystem errors.

## Verification

Add a focused Node test covering development paths, packaged redirection,
nested paths, similarly-prefixed sibling directories, and paths outside the
managed data directory. Run that test first, followed by the adjacent Desktop
file, tool-gateway, and cloud test suites. Build the NSIS installer to verify
that the shared module is packaged and the release remains buildable.

## Documentation and Release

Update `AGENTS.md` and `README.md` only where they currently name the old helper
or need to describe the centralized path policy. Do not commit generated
installer output or runtime data. Commit the implementation using the
repository's Conventional Commit style and push the current `main` branch to
its configured upstream without rewriting history.
