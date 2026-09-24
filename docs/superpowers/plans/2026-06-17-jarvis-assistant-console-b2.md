# Jarvis Assistant Console B2 Implementation Plan

**Status (2026-08-23):** Implemented and verified. Static JavaScript, UTF-8,
renderer behavior, Electron startup, and runtime visual smoke checks pass.

Documentation status: completed execution record; do not rerun it as an active
plan unless intentionally rebuilding the UI.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Jarvis renderer as the approved Assistant Console B2 UI while preserving launcher, voice, confirmation, history, and candidate-selection behavior.

**Architecture:** Keep the existing vanilla Electron renderer. `index.html` defines stable shell regions, `renderer.js` continues to own state and dynamic result rendering, and `style.css` owns the new graphite/amber/teal visual system. No React, Tailwind, shadcn runtime, or new production dependencies are introduced.

**Tech Stack:** Electron renderer, plain HTML, CSS, JavaScript, CommonJS preload bridge, existing `window.jarvis` IPC API.

---

## File Structure

- Modify `renderer/index.html`: replace the old header/voice/footer layout with the Assistant Console shell: rail, top command bar, content grid, results column, side status panel, confirmation area, and existing debug panel.
- Modify `renderer/style.css`: replace the Spotlight-like styling with the B2 visual system, responsive layout, command rows, rail buttons, status cards, confirmation styling, and candidate buttons.
- Modify `renderer/renderer.js`: keep state and command execution intact, update Russian labels, render result rows with icons/badges, add side-panel history/status refresh, and remove inline styles from candidate rendering.
- Read-only reference `renderer/voiceCapture.js`: verify existing `#voice-status-line`, `startVoiceCapture()`, and `stopVoiceCapture()` hooks remain compatible.

## Task 1: Renderer Shell Markup

**Files:**
- Modify: `renderer/index.html`
- Verify: `renderer/voiceCapture.js`

- [x] **Step 1: Replace the body shell in `renderer/index.html`**

Use this structure inside `<body>` and preserve the existing scripts at the bottom:

```html
<div id="jarvis-window">
  <aside id="rail" aria-label="Разделы Jarvis">
    <div class="jarvis-mark" aria-label="Jarvis">J</div>
    <button class="rail-button active" type="button" title="Команды" aria-label="Команды">⌘</button>
    <button class="rail-button" type="button" title="Голос" aria-label="Голос">🎙</button>
    <button class="rail-button" type="button" title="Поиск" aria-label="Поиск">⌕</button>
    <button class="rail-button" type="button" title="Настройки" aria-label="Настройки">⚙</button>
    <div class="rail-spacer"></div>
    <button class="rail-button" type="button" title="Справка" aria-label="Справка">?</button>
  </aside>

  <main id="assistant-shell">
    <header id="topbar">
      <label id="command-bar" for="input">
        <span class="command-icon" aria-hidden="true">⌕</span>
        <input type="text" id="input" placeholder="Запусти Steam, найди файл или спроси Jarvis..." autofocus autocomplete="off" spellcheck="false">
      </label>
      <div id="voice-pill" class="status-pill" aria-live="polite">
        <span class="status-dot"></span>
        <span id="voice-status-line">Голос готов</span>
      </div>
    </header>

    <section id="workspace">
      <section id="results-panel" aria-label="Результаты Jarvis">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">Jarvis</span>
            <h1>Быстрые действия</h1>
          </div>
          <div class="shortcuts-hint" aria-label="Горячие команды">
            <kbd>/run</kbd>
            <kbd>/ps</kbd>
            <kbd>/find</kbd>
            <kbd>/sys</kbd>
          </div>
        </div>
        <div id="results">
          <div id="results-list"></div>
        </div>
      </section>

      <aside id="side-panel" aria-label="Статус Jarvis">
        <section class="status-card voice-card">
          <div class="card-heading">
            <span class="card-icon">🎙</span>
            <div>
              <h2>Голосовой режим</h2>
              <p>Скажите: “Джарвис, включи доту”.</p>
            </div>
          </div>
          <div class="voice-meter" aria-hidden="true"></div>
          <div class="chip-row">
            <span class="chip">Vosk</span>
            <span class="chip">TTS</span>
            <span class="chip">RU</span>
          </div>
          <div class="voice-actions">
            <button id="voice-start-btn" class="tool-button" type="button">Включить</button>
            <button id="voice-stop-btn" class="tool-button danger" type="button">Выключить</button>
          </div>
        </section>

        <section class="status-card">
          <div class="card-heading compact">
            <span class="card-icon">↺</span>
            <div>
              <h2>Последние команды</h2>
              <p id="history-summary">История появится после первого запуска.</p>
            </div>
          </div>
          <div id="history-chips" class="chip-row"></div>
        </section>
      </aside>
    </section>

    <div id="confirm-dialog" class="hidden">
      <div class="confirm-message">
        <span class="confirm-icon">!</span>
        <span id="confirm-text"></span>
      </div>
      <div class="confirm-actions">
        <button id="confirm-no" class="confirm-btn confirm-btn-no">Отмена</button>
        <button id="confirm-yes" class="confirm-btn confirm-btn-yes">Подтвердить</button>
      </div>
    </div>
  </main>
</div>
```

- [x] **Step 2: Wire voice buttons without inline handlers**

After `const confirmNo = document.getElementById('confirm-no');` in `renderer/renderer.js`, add:

```js
const historySummary = document.getElementById('history-summary');
const historyChips = document.getElementById('history-chips');
const voiceStartBtn = document.getElementById('voice-start-btn');
const voiceStopBtn = document.getElementById('voice-stop-btn');

if (voiceStartBtn) {
  voiceStartBtn.addEventListener('click', () => {
    if (typeof window.startVoiceCapture === 'function') {
      window.startVoiceCapture();
    }
  });
}

if (voiceStopBtn) {
  voiceStopBtn.addEventListener('click', () => {
    if (typeof window.stopVoiceCapture === 'function') {
      window.stopVoiceCapture();
    }
  });
}
```

- [x] **Step 3: Verify voiceCapture hook compatibility**

Run:

```powershell
rg -n "voice-status-line|startVoiceCapture|stopVoiceCapture" renderer
```

Expected: `renderer/voiceCapture.js` still references `voice-status-line` and exports `window.startVoiceCapture` / `window.stopVoiceCapture`; `renderer/renderer.js` references the new buttons.

## Task 2: Result Rendering and Russian Copy

**Files:**
- Modify: `renderer/renderer.js`

- [x] **Step 1: Add small rendering helpers near `candidateLabel()`**

```js
const typeLabels = {
  run: 'Запуск',
  runProgram: 'Запуск',
  powershell: 'PowerShell',
  find: 'Поиск',
  searchFiles: 'Поиск',
  sys: 'Система',
  sysinfo: 'Система',
  history: 'История',
  error: 'Ошибка',
  ai: 'AI',
  voice: 'Голос',
};

const typeIcons = {
  run: '▶',
  runProgram: '▶',
  powershell: '⚡',
  find: '⌕',
  searchFiles: '⌕',
  sys: '▣',
  sysinfo: '▣',
  history: '↺',
  error: '!',
  ai: '◇',
  voice: '🎙',
};

function labelForType(type) {
  return typeLabels[type] || type || 'Команда';
}

function iconForType(type) {
  return typeIcons[type] || '⌘';
}

function updateHistoryPanel() {
  if (!historySummary || !historyChips) return;

  const recent = (state.history || []).slice(0, 3);
  historySummary.textContent = recent.length
    ? recent.map((item) => item.command || '').filter(Boolean).join(' · ')
    : 'История появится после первого запуска.';

  historyChips.innerHTML = '';
  recent.forEach((item) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = item.tool || 'run';
    historyChips.appendChild(chip);
  });
}
```

- [x] **Step 2: Call `updateHistoryPanel()` when history changes**

Add `updateHistoryPanel();` at the end of `init()`, `showHistory()`, and after refreshing `state.history` in `saveAndDisplay()`.

- [x] **Step 3: Replace mojibake UI strings touched by the redesign**

Use valid UTF-8 Russian in these existing branches:

```js
content: 'Пожалуйста, подождите...',
content: `Найдено ${data.count} приложений`,
title: 'Ошибка перевода',
content: 'Перевод выделенного текста недоступен.',
message: 'Голосовой модуль не загружен. Проверь подключение voiceCapture.js.',
message: 'Голос включён. Скажите: джарвис включи доту.',
message: 'Голос выключен.',
```

- [x] **Step 4: Replace `showEmptyState()` content**

```js
function showEmptyState() {
  resultsList.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">J</div>
      <h2>Ничего не выбрано</h2>
      <p>Начните вводить команду, название приложения или путь к файлу.</p>
      <div class="empty-examples">
        <span>/run notepad</span>
        <span>/find *.txt</span>
        <span>/sys</span>
      </div>
    </div>
  `;
}
```

- [x] **Step 5: Replace `renderResults()` row markup**

Each result item should render:

```js
const div = document.createElement('div');
div.className = `result-item${index === state.selectedIndex ? ' selected' : ''}`;

const iconDiv = document.createElement('div');
iconDiv.className = 'result-icon';
iconDiv.textContent = iconForType(item.type || 'history');

const bodyDiv = document.createElement('div');
bodyDiv.className = 'result-body';

const titleDiv = document.createElement('div');
titleDiv.className = 'result-title';

const titleText = document.createElement('span');
titleText.textContent = item.title || '';
titleDiv.appendChild(titleText);

const contentDiv = document.createElement('div');
contentDiv.className = 'result-content' +
  (item.error ? ' error' : '') +
  (item.success ? ' success' : '');
contentDiv.textContent = item.content || '';

if (item.fullContent !== undefined) {
  contentDiv.textContent = item.fullContent;
} else if (contentDiv.textContent.length > 300) {
  contentDiv.textContent = contentDiv.textContent.slice(0, 300) + '...';
}

bodyDiv.appendChild(titleDiv);
bodyDiv.appendChild(contentDiv);

const badge = document.createElement('span');
badge.className = `result-type type-${item.type || 'history'}`;
badge.textContent = labelForType(item.type || 'history');

div.appendChild(iconDiv);
div.appendChild(bodyDiv);
div.appendChild(badge);
```

- [x] **Step 6: Remove inline candidate button styles**

Candidate buttons should only set classes:

```js
btn.className = `candidate-button${isSelected ? ' selected' : ''}`;
btn.textContent = candidateLabel(candidate);
```

## Task 3: Assistant Console B2 CSS

**Files:**
- Modify: `renderer/style.css`

- [x] **Step 1: Replace the CSS file with B2 theme variables and shell layout**

Define:

```css
:root {
  --bg: #080b10;
  --panel: rgba(18, 23, 31, 0.94);
  --panel-soft: rgba(255, 255, 255, 0.045);
  --line: rgba(255, 255, 255, 0.085);
  --text: #f8fafc;
  --muted: rgba(203, 213, 225, 0.62);
  --faint: rgba(203, 213, 225, 0.38);
  --amber: #f59e0b;
  --amber-soft: rgba(245, 158, 11, 0.16);
  --teal: #2dd4bf;
  --teal-soft: rgba(45, 212, 191, 0.12);
  --danger: #f87171;
  --danger-soft: rgba(127, 29, 29, 0.24);
}
```

Add shell selectors for `body`, `#jarvis-window`, `#rail`, `.jarvis-mark`, `.rail-button`, `#assistant-shell`, `#topbar`, `#command-bar`, `#input`, `.status-pill`, `#workspace`, `#results-panel`, `#side-panel`.

- [x] **Step 2: Add result, empty, candidate, and confirmation styles**

Cover `.result-item`, `.result-icon`, `.result-body`, `.result-title`, `.result-content`, `.result-type`, `.candidate-list`, `.candidate-button`, `.empty-state`, `.empty-icon`, `.empty-examples`, `#confirm-dialog`, `.confirm-btn`.

- [x] **Step 3: Add status panel and responsive styles**

Cover `.status-card`, `.voice-card`, `.card-heading`, `.voice-meter`, `.chip-row`, `.chip`, `.tool-button`, and a media query:

```css
@media (max-width: 720px) {
  #jarvis-window {
    grid-template-columns: 64px 1fr;
  }

  #workspace {
    grid-template-columns: 1fr;
  }

  #side-panel {
    display: none;
  }
}
```

## Task 4: Static and Runtime Verification

**Files:**
- Verify: `renderer/index.html`
- Verify: `renderer/style.css`
- Verify: `renderer/renderer.js`

- [x] **Step 1: Check syntax**

Run:

```powershell
node --check renderer/renderer.js
```

Expected: no syntax errors.

- [x] **Step 2: Check touched Russian text is not mojibake**

Run:

```powershell
rg -n "Р.|С.|вљ|вњ|вќ|рџ" renderer/index.html renderer/renderer.js renderer/style.css
```

Expected: no matches in intentionally touched UI strings. If old unrelated mojibake remains in untouched code, fix only when it is visible in the redesigned UI.

- [x] **Step 3: Start app for visual verification**

Run:

```powershell
npm start
```

Expected: Electron opens Jarvis with the Assistant Console B2 shell. If startup runs TTS preparation for a long time, keep the process running until the window appears or a clear error is printed.

- [x] **Step 4: Manual UI smoke test**

In the window:

- Type `notepad`; suggestions render as command rows.
- Press ArrowDown and ArrowUp; selected row changes.
- Press Escape; empty state returns in Russian.
- Type `/sys` and press Enter; result renders without layout overlap.
- Trigger a command that requires confirmation if available; confirmation area shows `Отмена` and `Подтвердить`.
- Use the voice buttons; `#voice-status-line` changes without overlapping the command bar.

Verified on 2026-08-23 in the real Electron window: the B2 graphite/amber
shell, Russian empty/result states, confirmation area, history panel, and voice
status rendered without overlap. Deterministic renderer tests cover keyboard
selection, slash commands, candidate/confirmation behavior, and voice-button
wiring.

- [x] **Step 5: Commit implementation**

Only stage implementation files:

```powershell
git add renderer/index.html renderer/style.css renderer/renderer.js docs/superpowers/plans/2026-06-17-jarvis-assistant-console-b2.md
git commit -m "Redesign Jarvis renderer as assistant console"
```
