# Jarvis Everything File Search Design

Status: approved for specification review

## Goal

Make Jarvis reliably find and open files and folders by name across all local
drives. Replace the current depth- and time-limited broad scan with Everything
as the primary search provider while preserving Jarvis safety checks and a
clearly identified limited fallback.

Representative commands:

- `Джарвис, открой папку Test на рабочем столе`
- `Открой файл report.pdf`
- `Найди папку Projects на диске D`
- `Покажи config.json в проводнике`

## Dependencies and Installation

Use the stable x64 release of Everything 1.4 and the matching official
Everything command-line interface, `es.exe`.

- Install the normal Everything edition, not Lite, because Lite does not expose
  the IPC interface required by `es.exe`.
- Enable the Everything service and startup behavior during installation.
- Enumerate all fixed local volumes during setup. Everything indexes fixed NTFS
  volumes automatically; add fixed FAT/FAT32/exFAT volumes as folder indexes in
  Everything 1.4 and report any volume that could not be included.
- Keep `Everything.exe` and `es.exe` as machine-local dependencies. Do not add
  either binary to Git or `node_modules`.
- Place `es.exe` beside the installed Everything executable when practical.
- Resolve `es.exe` from an explicit Jarvis setting first, then `PATH`, then the
  standard Everything installation directories.

Everything owns and updates the filesystem index. Jarvis does not duplicate
that index in `data/file-index.json` when Everything is available.

## Command Model

File-command parsing must preserve the requested object type:

- `file` for phrases such as `файл` and `файлик`;
- `directory` for phrases such as `папка` and `директория`;
- `any` when the user does not name a type.

The parsed intent includes:

- `action`: `open_file`, `reveal_file`, or `find_file`;
- `query`: the requested name without command or location words;
- `targetType`: `file`, `directory`, or `any`;
- `location`: a normalized known location, drive, or `computer`;
- `rawText`: the original input.

The type flows unchanged through `actions/executeIntent.js` and
`tools/fileCommander.js` into the search provider. User-facing responses use
the correct noun: file, folder, or file/folder.

## Search Architecture

Add `tools/everythingSearch.js` as a focused adapter around `es.exe`.
It is responsible for:

- locating `es.exe` and `Everything.exe`;
- creating an Everything search expression from validated structured input;
- invoking `es.exe` with `execFile` and an argument array, never through a
  command shell;
- requesting UTF-8 CSV output with full path, size, modified date, and
  attributes;
- parsing CSV records and mapping them to the existing file-candidate shape;
- distinguishing successful empty results from provider failures;
- starting Everything and retrying when IPC is unavailable.

`tools/fileSearch.js` remains the provider-neutral entry point. Broad and
explicit-location searches call Everything first. The existing index and live
scanner are retained only as a degraded fallback.

## Query Rules

1. Search all local drives when no narrower location is requested.
2. Apply a path constraint for a known folder or requested drive.
3. Apply a file-only or directory-only constraint when `targetType` is known.
4. Search for a case-insensitive exact basename first.
5. Run a partial-name search only if the exact search is empty.
6. Return at most 20 ranked candidates to the UI while allowing the adapter to
   fetch a modest larger set for filtering and deduplication.
7. Exclude network paths and disconnected volumes from the default all-local-
   drives scope.

Exact matches always rank above partial matches. Results are deduplicated by
case-insensitive absolute path. Jarvis does not silently choose between
multiple exact matches.

## User-Facing Behavior

- One exact safe match for `open` is opened immediately.
- Multiple exact matches produce a selection list containing full paths.
- Partial matches are shown only when no exact match exists.
- `find` shows results without opening them.
- `reveal` selects the object in Explorer.
- Opening a directory does not require confirmation.
- Opening a file with an existing dangerous extension still requires explicit
  confirmation.
- Empty successful searches say `Файл не найден`, `Папка не найдена`, or
  `Файл или папка не найдены`, according to `targetType`.

## Everything Startup and Recovery

When `es.exe` reports that the Everything IPC window is unavailable, Jarvis:

1. locates the installed `Everything.exe`;
2. starts it in the background with `-startup`;
3. waits up to five seconds for IPC readiness;
4. retries the original query once.

Jarvis must not start duplicate Everything instances. Startup and retry are
bounded so a file command cannot hang indefinitely.

If Everything or `es.exe` is missing, startup fails, IPC remains unavailable,
the query times out, or CSV output is invalid, Jarvis runs the existing limited
search. The result must carry degraded-search metadata. The UI and voice reply
must state that Everything was unavailable and that the search was limited;
Jarvis must not present a limited-search miss as proof that the object does not
exist on the computer.

## Security and Process Safety

- Pass every `es.exe` and `Everything.exe` argument as a separate `execFile`
  argument.
- Escape user text for Everything search syntax; do not concatenate untrusted
  text into executable command strings.
- Validate location filters before adding them to a query.
- Enforce process timeouts and output-size limits.
- Accept only absolute local filesystem paths from provider output.
- Reuse `tools/fileSafety.js` before opening results.
- Preserve the existing confirmation flow for executable files and scripts.

## Testing

Unit coverage must include:

- parser preservation of `file`, `directory`, and `any` target types;
- Russian and English commands, Unicode names, spaces, and quotes;
- safe Everything argument construction with shell metacharacters in names;
- UTF-8 CSV parsing, quoted fields, dates, sizes, and directory attributes;
- exact-before-partial behavior and case-insensitive matching;
- path and drive constraints;
- file-only and directory-only filtering;
- deduplication and multiple-result selection;
- exit code 8 causing one background startup and one retry;
- timeout, missing executable, malformed output, and degraded fallback states;
- dangerous-file confirmation remaining intact.

Integration verification must confirm that:

- Everything and `es.exe` are installed and discoverable;
- every currently mounted fixed local volume is covered by the Everything
  index, including non-NTFS volumes configured as folder indexes;
- Everything can be started automatically when stopped;
- a CLI query returns both files and directories;
- Jarvis finds the real directory `C:\Users\maxob\Desktop\Test`;
- voice intent execution preserves `targetType` and opens the correct result.

Because voice routing changes, run `node scripts/testVoiceServiceSttProvider.js`
and at least one intent-parser test in addition to the file-search tests.

## Out of Scope

- File-content search.
- Network-share search by default.
- Cloud-only objects that are not visible to Everything as local paths.
- Replacing Everything's index with a second Jarvis-managed full-disk index.
- Automatically opening one of several same-name matches without user choice.
