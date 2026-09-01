# Jarvis Assistant Console B2 Design

Date: 2026-06-17
Status: implemented and verified, including runtime visual smoke

Documentation status: implemented local-client design retained as history. It
does not describe the newer cloud control plane.

## Goal

Redesign the Jarvis renderer from a plain Spotlight-style launcher into a compact assistant console while preserving the current Electron, Node.js, CommonJS, and vanilla renderer architecture.

The first implementation should improve the visible launcher window only. It should not change command execution, app launching, voice recognition, TTS, AI intent resolution, or IPC behavior except where minor DOM hooks are needed to render the same data in the new layout.

## Chosen Direction

Use the "Assistant Console B2" direction:

- Left vertical rail for modes and status areas.
- Main search/command input at the top.
- Primary result and quick-action list in the main column.
- Voice and recent-history/status panel on the right when space allows.
- Russian UI text by default.
- Dark graphite base with a warm Jarvis accent and a cooler live-status accent.

This direction is based on shadcn/ui patterns found through the MCP server: `command`, `command-dialog`, `sidebar`, `sidebar-10`, `card`, `badge`, `dialog`, `alert-dialog`, and `empty`. Jarvis will not adopt React or shadcn directly in this pass; the current renderer stays vanilla HTML/CSS/JS.

## Visual System

Palette:

- Base: near-black graphite and deep charcoal.
- Brand accent: warm amber/gold for Jarvis identity, selected state, and primary focus.
- Live/status accent: teal for voice active, listening state, and healthy activity.
- Risk accent: muted red only for destructive, PowerShell, or confirmation states.
- Text: high-contrast off-white for primary text, muted blue-gray for secondary text.

Shape and spacing:

- Window radius: about 16-18px.
- Internal controls: 10-14px radius.
- Repeated cards/items: 8-14px radius depending on density.
- Keep the interface compact and command-first, not a marketing-style dashboard.

Motion:

- Keep existing fast fade/selection feedback.
- Avoid decorative or slow animation.
- Voice level/status may use subtle glow or pulse if it remains readable and low-distraction.

## Layout

The renderer should be organized into these visible regions:

1. Rail
   - Jarvis mark at the top.
   - Mode icons for command, voice, search/history, settings/help.
   - Active mode indicator as a slim amber bar.
   - Icons may be text symbols or lightweight inline UI for now; production dependency additions require approval.

2. Top Command Bar
   - Main input remains the primary focus target.
   - Placeholder should be Russian, for example: "Запусти Steam, найди файл или спроси Jarvis..."
   - Show voice status as a compact pill on the right when available.
   - Preserve autofocus and keyboard behavior.

3. Main Results Area
   - Display suggestions, history, execution progress, errors, and selection candidates as command rows.
   - Selected row uses amber-tinted background and clear border/focus treatment.
   - Rows include icon/marker, title, secondary description, and optional shortcut/type badge.
   - Existing result data should render without requiring backend changes.

4. Right Status Panel
   - Voice card: current listening state, short Russian hint, provider/status chips.
   - Recent commands or context card: compact recent history, confirmation/status badges.
   - This panel may collapse below the main results or hide at narrow window widths.

5. Confirmation Area
   - Keep confirmation visually distinct.
   - Use muted red/amber risk styling.
   - Buttons must remain explicit in Russian: "Подтвердить" and "Отмена".

## Russian Text Requirement

All user-facing renderer text introduced or touched by the redesign should be valid UTF-8 Russian. Existing mojibake in touched UI areas should be deliberately corrected with nearby context.

Target visible text examples:

- "Запусти Steam, найди файл или спроси Jarvis..."
- "Быстрые действия"
- "Голос активен"
- "Голосовой режим"
- "Последние команды"
- "Опасные действия требуют подтверждения"
- "Ничего не найдено"
- "Попробуйте: /run notepad, /find *.txt, /sys"

## Behavior Constraints

- Preserve current keyboard navigation: ArrowUp, ArrowDown, Enter, Escape.
- Preserve candidate selection behavior for ambiguous app launches.
- Preserve confirmation behavior for PowerShell and other risky commands.
- Preserve `window.jarvis` preload contract.
- Do not add production dependencies without user approval.
- Do not migrate to React, Tailwind, or shadcn components in this implementation pass.
- Do not change voice recognition, TTS, app indexing, or AI intent logic as part of the visual redesign.

## Implementation Boundaries

Expected files:

- `renderer/index.html`: restructure markup around rail, topbar, results, status panel, and confirmation area.
- `renderer/style.css`: replace the current plain Spotlight styling with the B2 visual system.
- `renderer/renderer.js`: update rendering functions only where needed for new class names, icons, labels, and right-panel content.

Avoid:

- Broad refactors in `main.js`, `preload.js`, `voice/`, `tts/`, `tools/`, or `actions/`.
- New generated state changes in `data/`.
- New production packages.

## Verification

Manual and automated checks should cover:

- App starts with `npm start` when feasible.
- Renderer opens without console errors.
- Typing in the command bar shows suggestions.
- Arrow selection and Enter still work.
- Empty history state renders in Russian.
- Confirmation dialog still appears and can cancel.
- Voice controls/status do not overlap other UI.
- Layout remains readable at the current Electron window size and at a narrower fallback width.

Visual verification should be done in the renderer when possible.
