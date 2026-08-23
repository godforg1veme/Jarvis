# Jarvis File Commands Design

Status: implemented and verified, including Vosk and Electron smoke checks

## Goal

Add safe natural-language file commands to Jarvis so the user can open, reveal,
or find local files from text or voice commands without manually searching in
Explorer.

Example commands:

- "Джарвис, открой файл vscode.bat на рабочем столе"
- "Открой invoice.pdf в загрузках"
- "Покажи config.json в документах"
- "Найди файл setup.exe на компьютере"
- "Найди invoice.pdf, не помню где"

Jarvis should identify the requested file name, the intended location, and the
requested action. It must avoid launching dangerous files accidentally.

## User-Facing Behavior

Jarvis supports three file actions:

- `open`: open the file with the default Windows association.
- `reveal`: show the file in Explorer. The Russian verb "покажи" maps to this
  action.
- `find`: show matching files only.

If exactly one safe file is found, Jarvis performs the requested action.

If several matching files are found, Jarvis shows candidates in the existing
Spotlight-style result list and asks the user to choose. It does not choose a
file randomly.

If no file is found, Jarvis reports that clearly and offers to search in other
standard locations or on the computer.

For text input, the current keyboard and mouse selection patterns continue to
work: arrow keys move through candidates, Enter chooses, and clicking a
candidate chooses it.

For voice input, if several files are found, Jarvis opens the main window,
shows candidates, and says that several files were found.

## Locations

Jarvis understands these explicit locations in v1:

- Desktop / "рабочий стол"
- Downloads / "загрузки"
- Documents / "документы"
- Pictures / "изображения"
- Videos / "видео"
- Music / "музыка"
- User home / "домашняя папка"

Jarvis also understands broad search phrases:

- "на ПК"
- "на компьютере"
- "везде"
- "не помню где"

Explicit location commands use live search inside that location.

Broad search commands use a hybrid strategy:

1. Search the local file index if it exists.
2. If the index is missing, stale, or insufficient, search standard folders.
3. Offer a limited disk scan/index operation when deeper search is needed.

Jarvis does not scan network drives by default in v1.

## Architecture

The feature is implemented as a separate file-command path instead of extending
the app launcher path.

### `voice/intentParser.js`

Add regex parsing for file commands. The parsed intent should include:

- `action`: `open_file`, `reveal_file`, or `find_file`
- `query`: the requested file name or partial name
- `location`: a normalized location id, such as `desktop`, `downloads`, or
  `computer`
- `rawText`: the original recognized command

This parser should recognize natural Russian commands and tolerate the wake word
"Джарвис" when present.

### `actions/executeIntent.js`

Route file intents to the new file command tool through injected options or a
small wrapper. Voice execution must support:

- normal success/failure speech
- showing the main window when a selection is needed
- pending voice confirmation for dangerous single-file launches
- stricter voice selection for dangerous candidates

### `tools/fileCommander.js`

New high-level tool for file commands. It accepts:

- `action`: `open`, `reveal`, or `find`
- `query`: file name or partial file name
- `location`: normalized location id
- `confirmed`: boolean for dangerous single-file opens
- optional direct candidate data for selected candidates

Responsibilities:

- call file search
- decide whether the result is not found, single match, or multiple matches
- return UI-compatible result objects
- open safe files
- reveal files in Explorer
- enforce dangerous-file rules

### `tools/fileSearch.js`

New low-level search module. Responsibilities:

- resolve known locations to Windows paths
- search one directory with depth and result limits
- search standard folders
- query the file index
- score and sort matches
- skip inaccessible folders without failing the whole command

Result shape:

- `name`
- `path`
- `extension`
- `directory`
- `size`
- `modifiedAt`
- `source`
- `score`
- `dangerous`

### `tools/fileIndex.js`

New local index module. It stores generated state in `data/file-index.json`.
This file is local/generated state and should not be committed.

The index contains file metadata needed for fast name search. It should not
store file contents.

Indexing in v1 is manual or lazy:

- broad search can use an existing index
- if there is no useful index, Jarvis can offer to create/update it
- automatic background monitoring is out of scope for v1

### Renderer

`renderer/renderer.js` should reuse the existing result list, candidate list,
and confirmation dialog patterns.

Add a `file` result type with styling consistent with the current Jarvis UI:

- badge label: "Файл"
- compact result rows
- candidate buttons matching existing candidate buttons
- no nested cards or large new panels
- long paths clipped or wrapped cleanly

Candidate rows should show:

- file name
- parent folder or full path where useful
- size
- modified date when available
- warning marker for dangerous files when the action is `open`

## Search Rules

When a location is explicit, search only that location.

When the command asks to search on the computer, use the hybrid broad search.

Search sorting:

1. Exact file name match.
2. Exact extension match when the query includes an extension.
3. Standard user folders over deep/system locations.
4. More recently modified files.
5. Higher fuzzy/name score.

The UI should show at most 20 candidates for one command.

Limited disk scan/indexing skips heavy or risky folders by default:

- `node_modules`
- `.git`
- `Windows`
- `AppData`
- `Program Files`
- `Program Files (x86)`
- `ProgramData`
- temporary folders

The scanner must use depth, time, and result limits so Jarvis remains
responsive.

## Safety Rules

Dangerous extensions in v1:

- `.exe`
- `.bat`
- `.cmd`
- `.ps1`
- `.msi`
- `.reg`
- `.vbs`
- `.js`
- `.jar`
- `.scr`
- `.com`

Extension checks are case-insensitive.

For `open`, a single dangerous file requires confirmation:

"Это исполняемый файл/скрипт. Его открытие может запустить команды. Запустить?"

The confirmation stores the full path and action. If the user changes input or
cancels, pending confirmation is cleared.

For `reveal`, no confirmation is required because Jarvis only shows the file in
Explorer.

For `find`, no confirmation is required because Jarvis only shows results.

If multiple dangerous files are found, Jarvis first shows candidates. It does
not show a separate confirmation before the user chooses. In the UI, choosing a
dangerous candidate marked with a warning is treated as explicit confirmation.

For voice, choosing a dangerous candidate must be more explicit than "first".
The accepted voice form is a command like "запусти первый". A vague selection
such as "первый" can select or highlight the candidate but must not launch a
dangerous file.

## Confirmation UX

Use the existing confirmation dialog where possible.

Text/UI confirmation accepts:

- button click
- Enter on the focused confirmation button

Voice confirmation accepts:

- "да"
- "запусти"
- "открой"
- "подтверждаю"

Voice cancellation accepts:

- "нет"
- "отмена"
- "не надо"

The pending confirmation state must be specific to one file path and one action.

## IPC and Tool Access

Add the file command tool to the allowed tool list in `main.js`.

Expose only the minimal preload API needed by the renderer. Prefer reusing
`executeTool` and `confirmCommand` if the result shape can stay compatible.

Do not expose arbitrary shell execution or unrestricted filesystem operations to
the renderer.

## Error Handling

Common errors should produce friendly Russian messages:

- missing file query
- unknown location
- location folder does not exist
- permission denied during search
- open failed
- reveal failed
- index unavailable

Search should continue past inaccessible folders and report partial results
when available.

## Verification

Parser tests or command-line checks:

- `открой файл vscode.bat на рабочем столе`
- `покажи config.json в документах`
- `найди invoice.pdf в загрузках`
- `найди setup.exe на компьютере`
- `найди файл не помню где`

File commander checks:

- one safe file opens
- `покажи` reveals in Explorer
- `find` only shows results
- multiple files return candidates
- one dangerous file requires confirmation
- dangerous candidate selected in UI launches only from a warning-marked choice
- dangerous candidate selected by voice requires "запусти первый"

Index checks:

- `data/file-index.json` is created as generated local state
- inaccessible folders do not crash indexing
- excluded directories are skipped
- result count is limited

Project verification:

- for voice changes, run `node scripts/testVoskLoad.js`
- run at least one `node voice/testCommand.js "<command text>"`
- for UI changes, visually verify the renderer when possible

## Out of Scope for v1

- continuous background file monitoring
- scanning network drives by default
- content-based search inside documents
- opening files from arbitrary natural-language paths outside known locations
  without explicit future design
- adding new production dependencies
