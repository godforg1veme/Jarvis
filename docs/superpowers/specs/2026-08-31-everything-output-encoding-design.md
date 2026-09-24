# Everything Output Encoding Design

Status: implemented and covered by focused decoding tests on 2026-09-01;
retained as the decoding decision record.

## Problem

On Russian Windows, `ES.exe` can write search results using the active OEM
console code page (CP866). Jarvis currently asks Node.js to decode stdout as
UTF-8. Cyrillic names such as `бз доки` therefore become replacement
characters (`�� ����`), fail filename scoring, and are reported as missing even
though Everything found them.

## Scope

Change only the decoding boundary in `tools/everythingSearch.js`. Preserve the
existing Everything query, startup, ranking, fallback, and file-opening flows.
Do not add a production dependency.

## Design

Run `ES.exe` with buffered stdout and stderr instead of decoding them in
`execFile`. Decode output using this order:

1. UTF-8 when the byte sequence is valid UTF-8.
2. CP866 and Windows-1251 as legacy Windows candidates.
3. Select a legacy candidate by output plausibility: no replacement/control
   characters, a recognizable CSV header, and valid absolute Windows paths in
   result rows. Prefer CP866 when candidates are otherwise equivalent because
   ES console output on Russian Windows normally uses the OEM code page.

The decoder will be a small isolated helper exported for deterministic tests.
ASCII is valid UTF-8 and remains unchanged.

Decode stderr with the same mechanism so diagnostic messages remain readable.
If decoding or CSV validation fails, return the existing
`everything_output_invalid` provider failure. The existing restricted-search
fallback and its explicit user-facing warning remain unchanged.

## Data Flow

`ES.exe` → raw stdout/stderr buffers → encoding decoder → CSV parser → safe
file candidates → existing filename scoring and location ranking → command
execution.

## Tests

Extend `scripts/testEverythingSearch.js` with fixtures for:

- valid UTF-8 Cyrillic output;
- CP866 output containing `C:\Users\maxob\Desktop\бз доки`;
- Windows-1251 Cyrillic output;
- unchanged ASCII output;
- invalid output failing safely.

Then run the Everything adapter tests, file-command tests, Tool Gateway tests,
voice-provider test, a live search for `бз доки`, and the standalone voice
command parser/execution probe. Finally restart Jarvis so the fix is loaded.
