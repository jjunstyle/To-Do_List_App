# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A static, framework-free to-do list app: `index.html`, `style.css`, `script.js`. No build tooling, no package manager, no dependencies (the only external resource is a Google Fonts stylesheet link in `index.html`).

## Commands

There is no build/lint/test tooling. To run the app locally, serve the directory over HTTP rather than opening `index.html` via `file://` (the Chrome automation tooling used during development blocks `file://` navigation, and it's good practice generally):

```bash
python3 -m http.server 8791
# then open http://localhost:8791/index.html
```

There is no automated test suite — verification has been done manually through browser automation (loading the page, exercising each interaction, checking `localStorage` and console output).

## Architecture

### Data layer (`script.js`, top section)

`todos` is a single in-memory array, the source of truth, persisted to `localStorage` under the key `"todos"` via `loadTodos()` / `saveTodos()`. `loadTodos()` fails safe: any missing key, JSON parse error, or non-array value returns `[]` rather than throwing.

Mutation functions (`addTodo`, `updateTodo`, `deleteTodo`, `toggleComplete`) all mutate the module-level `todos` array directly and call `saveTodos(todos)` themselves — callers never need to persist manually. `addTodo`/`updateTodo` trim text and silently no-op on whitespace-only input. IDs come from `generateId()` (`` `${Date.now()}-${idCounter++}` ``); a plain `Date.now()` was tried first and rejected because two `addTodo()` calls in the same millisecond produced colliding IDs that corrupted `updateTodo`/`deleteTodo` — keep the counter suffix if touching ID generation.

### Category code ↔ label mapping

The stored data model uses Korean category labels (`업무` / `학습` / `일상`) per the original data spec, but the DOM (`<select>` option values, filter tab `data-filter`, CSS class suffixes like `.task-item__category--work`) uses English codes (`work` / `study` / `daily`). `CATEGORY_CODE_TO_LABEL`, `CATEGORY_LABEL_TO_CODE`, and `FILTER_CODE_TO_LABEL` bridge the two directions — any new UI touching category must go through these maps rather than assuming the DOM value equals the stored value.

### Keyword-based category auto-classification

`CATEGORY_KEYWORDS` + `detectCategoryFromText()` scan `addInputEl`'s `input` event and live-set `addCategoryEl.value` (checked in `work` → `study` → `daily` order, first keyword match wins) with a hint shown in `.add-task__hint`. This only runs while `categoryManuallySet` is `false`; picking the `<select>` manually flips that flag so auto-classification stops stomping on the user's choice for the rest of that entry, and `handleAddTodo()` resets the flag after a successful add so the next todo starts in auto mode again. This is add-only — `enterEditMode()` doesn't touch category, so edits keep the todo's existing category untouched.

### Rendering: full re-render, not incremental

`renderTodos(filteredTodos)` clears and fully rebuilds `.task-list`'s children from scratch on every call (or renders a `.task-list__empty` message when the list is empty). There is no diffing. Because of this, event listeners are bound once via **delegation** on stable parent containers (`.task-list`, `.filter-tabs`, the add-task controls) — never on individual `<li>` elements, since those are destroyed and recreated on each render.

`applyFilterAndRender()` is the single choke point called after every data mutation: it re-derives the filtered list from `currentFilter` + `todos`, calls `renderTodos()`, then `updateRemainingCount()`. New mutation call sites should route through this function (or at least call `updateRemainingCount()`) rather than updating the DOM ad hoc.

Completed items are sorted to the bottom inside `renderTodos()` via a stable sort — new items keep their relative creation order within the completed/incomplete groups.

### Checkbox toggle: two-phase animation

Checking a box does *not* immediately call `applyFilterAndRender()`. It toggles the `is-done` class on the existing (not-yet-recreated) `<li>` first so the CSS strike-through transition actually plays, updates the count immediately, then defers the full re-render (which reorders the list) via `window.setTimeout(applyFilterAndRender, STRIKE_ANIMATION_MS)`. `STRIKE_ANIMATION_MS` (450) in `script.js` must stay equal to the `.task-item__text::after` `transition-duration` in `style.css` — if one changes, change the other.

### Enter-to-submit and IME composition

Both `addInputEl`'s keydown handler and the inline-edit `<input>`'s keydown handler (in `enterEditMode()`) guard Enter with `if (e.isComposing || e.keyCode === 229) return;` before calling `handleAddTodo()` / `updateTodo()`. This exists because of a real bug: typing Korean (or any IME-composed text) and pressing Enter fires the `keydown` twice in Chrome — once with `isComposing: true` to confirm the IME composition, once more right after with `isComposing: false`. Without the guard, the first Enter added the todo correctly, then clearing+refocusing the input mid-composition let the IME drop its last pending character back into the now-empty field, and the second Enter added *that single trailing character* as a second todo. Any new Enter-to-submit input in this app must carry the same guard.

### Design system (`style.css`)

Modern glassmorphism, chosen after an earlier "editorial grid, no gradients/blur ever" direction was explicitly reversed by the user — don't reintroduce that constraint from habit or from stale context. Current direction: a fixed vibrant diagonal gradient page background (with two blurred decorative color-blob pseudo-elements on `body`), and every content block (masthead, add-task bar, filter tabs, task list) is a frosted-glass panel — `background: var(--glass-bg)` (translucent white) + `backdrop-filter: blur(20px) saturate(180%)` + a light border + a soft colored `box-shadow`, no hard borders-as-separators anymore. Category tags and the active filter tab/add button use `var(--accent-grad)` / `--grad-work|study|daily` (small gradients), not solid colors. Corners are large and rounded (`--radius-lg: 22px`, pills via `--radius-pill`), not sharp. Font pairing is `Poppins` (display/headline number, gradient-clipped text) + `Inter` (body), replacing the old serif/mono pairing — both fall back to `sans-serif` so Korean text still renders via the system font.

If asked to touch visual design again, ask which direction currently applies rather than assuming; do not silently revert to the editorial look.

Mobile-first with a single breakpoint at `@media (min-width: 640px)`; below it, `.task-item` uses a 2-row CSS grid (`grid-template-areas`), above it a 1-row layout — if the item markup changes, both `grid-template-areas` blocks need updating together.

`.task-item__text` intentionally uses `justify-self: start` (not the grid default of stretch) so the element's own width matches its text content — the strike-through (`::after`, width-animated 0→100%) is sized as a percentage of that element, so letting it stretch to the full grid column would make the strike line run past the visible text.

Focus is always visible (`:focus-visible` outlines on inputs, buttons, filter tabs, and the checkbox via a sibling selector since the real `<input type="checkbox">` is visually hidden) — never add `outline: none` without replacing it with an equally visible alternative.

### Initial seed data

If `loadTodos()` returns an empty array on first load, `script.js`'s init block seeds three example todos (matching the original static mockup) directly through `addTodo()`/`toggleComplete()`, rather than via hardcoded HTML — `index.html`'s `<ul class="task-list">` starts empty and is always populated by JS.
