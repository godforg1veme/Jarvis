# Jarvis Everything File Search Implementation Plan

Status: implemented; focused Everything, file-command, and Tool Gateway tests
pass on 2026-09-01.

**Design:** `docs/superpowers/specs/2026-08-31-jarvis-everything-file-search-design.md`

**Goal:** Make Everything the primary provider for safe file and folder search
across local drives, preserve the requested object type, auto-start Everything
when IPC is unavailable, and retain the current scanner as an explicitly
degraded fallback.

**Runtime constraints:** Windows, Electron/Node.js, CommonJS, no new npm
production dependency. Everything 1.4 x64 and the official `es.exe` are
machine-local dependencies and must not be committed.

## 1. Preserve the requested object type

**Files:**

- Modify `tools/fileCommandParser.js`.
- Modify `voice/intentParser.js`.
- Modify `scripts/testFileCommands.js`.

**Steps:**

1. Add failing parser cases for explicit file, explicit folder, English
   equivalents, and commands without an explicit object type.
2. Extend `parseFileCommand` to return `targetType` as `file`, `directory`, or
   `any` before stripping the type word from the query.
3. Pass `targetType` through `parseIntent` without changing existing action
   names.
4. Run `node scripts/testFileCommands.js` and confirm the new cases pass.

## 2. Add pure Everything query and output helpers

**Files:**

- Create `tools/everythingSearch.js`.
- Create `scripts/testEverythingSearch.js`.

**Steps:**

1. Write failing tests for exact-name and partial-name expressions, file and
   directory filters, known-folder constraints, drive constraints, Unicode,
   quotes, spaces, and Everything search metacharacters.
2. Implement structured query construction. User input must be escaped as
   Everything search text and must never become executable shell syntax.
3. Write failing tests for UTF-8 CSV with quoted commas, quotes, Cyrillic paths,
   size, ISO date, attributes, empty output, and malformed records.
4. Implement CSV parsing and map valid absolute local paths to the existing
   candidate shape from `tools/fileSafety.js`.
5. Reject UNC paths, relative paths, invalid drive paths, and oversized output.
6. Run `node scripts/testEverythingSearch.js`.

## 3. Implement executable discovery and bounded IPC queries

**Files:**

- Modify `tools/everythingSearch.js`.
- Modify `scripts/testEverythingSearch.js`.

**Steps:**

1. Add injected test doubles for filesystem checks, `execFile`, process spawn,
   and retry delay so unit tests do not launch software.
2. Add failing tests for discovery order: explicit setting, `PATH`, then the
   standard x64 and x86 installation directories.
3. Implement `es.exe` invocation with an argument array, UTF-8 CSV output,
   result limits, output limits, and a process timeout.
4. Distinguish a successful empty result from missing executable, timeout,
   malformed output, and nonzero provider exits.
5. Add failing tests proving exit code 8 locates and starts `Everything.exe`
   once with `-startup`, waits no more than five seconds, and retries once.
6. Implement the bounded startup/retry path with no duplicate retry loop.
7. Run `node scripts/testEverythingSearch.js`.

## 4. Make the provider-neutral search path asynchronous

Everything IPC is asynchronous and must not block the Electron main process.

**Files:**

- Modify `tools/fileSearch.js`.
- Modify `tools/fileCommander.js`.
- Modify `agents/toolGateway.js`.
- Modify `scripts/testFileCommands.js`.
- Modify `scripts/testToolGateway.js`.

**Steps:**

1. Add failing tests in which the injected Everything provider returns exact
   matches, partial matches, no results, and provider failures.
2. Convert `searchFiles` to an async provider-neutral operation.
3. Search Everything for exact matches first and run the partial query only
   when exact results are empty.
4. Pass `targetType` and location constraints to the provider.
5. Deduplicate by case-insensitive absolute path and return at most 20 ranked
   candidates.
6. On provider failure, run the existing index/live search and attach
   `degraded: true` plus a stable provider failure reason.
7. Update `fileCommander.execute` and `searchFilesForGateway` to await the
   search result. Keep the Tool Gateway execution API asynchronous.
8. Update all direct test callers to await `searchFiles`.
9. Run `node scripts/testFileCommands.js` and
   `node scripts/testToolGateway.js`.

## 5. Correct selection, opening, and messages

**Files:**

- Modify `tools/fileCommander.js`.
- Modify `actions/executeIntent.js`.
- Modify `voice/voiceService.js` only if its result forwarding needs explicit
  degraded-search speech handling.
- Modify `scripts/testFileCommands.js`.

**Steps:**

1. Add failing tests for one exact directory, several exact directories,
   file-versus-directory filtering, exact-before-partial behavior, and correct
   not-found nouns.
2. Forward `targetType` from `executeIntent` to `fileCommander`.
3. Open one exact safe result immediately. Show full-path candidates for more
   than one exact result.
4. Preserve dangerous-file confirmation for files and never require it for
   directories.
5. Generate type-aware titles, contents, and spoken messages.
6. Prefix degraded results and misses with a clear statement that Everything
   was unavailable and the fallback search was limited. A degraded miss must
   not claim that the object does not exist on the whole computer.
7. Run `node scripts/testFileCommands.js`.

## 6. Verify renderer compatibility

**Files:**

- Inspect and modify `renderer/renderer.js` only where required.
- Add or update the narrowest existing renderer behavior test if UI code
  changes.

**Steps:**

1. Confirm existing file candidate rows display full paths for ambiguous
   results and directories do not receive dangerous-file warnings.
2. Confirm degraded-search text is visible rather than discarded by result
   rendering.
3. Make a focused renderer change only if either behavior is missing.
4. Run the relevant renderer behavior test and visually inspect the candidate
   list when the app can be started safely.

## 7. Install and configure Everything

This step modifies the local Windows installation and uses the authority the
user explicitly granted when selecting normal installation.

**Machine-local changes:**

- Install stable Everything 1.4 x64, normal edition.
- Install the Everything service.
- Enable start on Windows startup and automatic fixed NTFS volume indexing.
- Place the official x64 `es.exe` beside Everything or in another documented
  machine-local location discoverable by Jarvis.

**Steps:**

1. Enumerate currently mounted fixed local volumes and their filesystem types.
2. Download the stable x64 installer and x64 ES archive from the official
   voidtools download endpoints.
3. Verify download integrity against official hashes when published.
4. Run the installer with service, startup, and automatic NTFS indexing
   enabled. Allow Windows UAC to request user approval if required.
5. Extract `es.exe` to the selected machine-local location.
6. For each fixed FAT/FAT32/exFAT volume, configure its root as an Everything
   folder index. Do not add network or removable volumes.
7. Start Everything in the background and wait for the initial index to load.
8. Record no secrets or machine-specific binary paths in committed source.

## 8. End-to-end verification

**Steps:**

1. Query `es.exe` directly for files and directories and check UTF-8 output.
2. Stop the user-facing Everything process without uninstalling its service,
   issue a Jarvis search through the adapter, and verify automatic background
   startup and retry.
3. Verify Jarvis finds `C:\Users\maxob\Desktop\Test` as a directory.
4. Verify a filename that exists outside the standard user folders is found.
5. Verify multiple same-name results produce selection with full paths.
6. Verify an executable still requires confirmation and a directory does not.
7. Run:

   - `node scripts/testEverythingSearch.js`
   - `node scripts/testFileCommands.js`
   - `node scripts/testToolGateway.js`
   - `node scripts/testVoiceServiceSttProvider.js`
   - `node voice/testCommand.js "джарвис найди папку Test на компьютере"`

8. Run `git diff --check` and inspect `git status --short` to confirm no
   downloaded binaries, generated indexes, settings, or logs are staged.

## 9. Documentation and handoff

**Files:**

- Update `README.md` or the most relevant setup documentation.

**Steps:**

1. Document the Everything and ES prerequisites, normal installation choice,
   automatic startup behavior, and degraded fallback.
2. Document how to override the `es.exe` location without committing a
   machine-specific path.
3. Include troubleshooting for missing `es.exe`, IPC code 8, initial indexing,
   and non-NTFS fixed volumes.
4. Re-run the focused verification suite after documentation-only changes are
   complete.
