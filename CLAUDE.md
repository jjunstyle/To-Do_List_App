# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A static, framework-free to-do list app: `index.html`, `style.css`, `script.js`. No build tooling, no package manager. External resources: a Google Fonts stylesheet link and the `@supabase/supabase-js` v2 UMD bundle, both loaded via `<script>`/`<link>` tags in `index.html` (no bundler, no `node_modules`).

Data is persisted in a Supabase Postgres project (see Data layer below) rather than `localStorage`.

## Commands

There is no build/lint/test tooling. To run the app locally, serve the directory over HTTP rather than opening `index.html` via `file://` (the Chrome automation tooling used during development blocks `file://` navigation, and it's good practice generally):

```bash
python3 -m http.server 8791
# then open http://localhost:8791/index.html
```

There is no automated test suite — verification has been done manually through browser automation (loading the page, exercising each interaction, checking the Supabase `"To_Do_List"` table via the Supabase MCP `execute_sql` tool, and checking console output).

## Architecture

### Data layer (`script.js`, top section)

Todos are persisted in a Supabase Postgres table, `"To_Do_List"` (project ref `aosiieamvurouzcqgzcr`, mixed-case name requires quoting in raw SQL — always `"To_Do_List"`, never unquoted). `SUPABASE_URL` and `SUPABASE_ANON_KEY` are hardcoded in `script.js`; the anon/publishable key is meant to be public (it's the browser-side key), but there is no user auth in this app, so RLS policies on the table grant the `anon` role full `select`/`insert`/`update`/`delete` — anyone with the page open can read or write any row. That's an intentional tradeoff for a single-user local app moved onto a shared backend, not an oversight; don't "fix" it by tightening RLS without checking with the user first, since that would break writes entirely without an auth layer to replace it.

Table columns are quoted to exactly match the JS object keys used throughout the rest of the app (`id`, `text`, `category`, `completed`, `"createdAt"` bigint epoch-ms, `"dueDate"` nullable date) — this lets `supabaseClient.from(TABLE_NAME).insert(newTodo)` take the in-memory todo object as-is and lets rendering code keep reading `todo.createdAt` / `todo.dueDate` unchanged. If columns are ever added, keep this camelCase-quoted convention rather than switching to snake_case, or every read site in rendering/formatting breaks silently (PostgREST matches column names case-sensitively).

`todos` is a single in-memory array — a **cache** of the table, not the source of truth. Mutation functions (`addTodo`, `updateTodo`, `deleteTodo`, `toggleComplete`) update this cache **synchronously and optimistically first** (so the UI reacts instantly, preserving the original localStorage-era call signatures — callers don't `await` them), then fire a background Supabase write via `persistInsert`/`persistUpdate`/`persistDelete`, which are fire-and-forget (`.then()`, not awaited) and only `console.error` on failure. This means a failed write leaves the UI showing a state the database doesn't have until the next reload — acceptable for this app's scope, but worth knowing when debugging a "changes don't stick after refresh" report. `addTodo`/`updateTodo` trim text and silently no-op on whitespace-only input. IDs come from `generateId()` (`` `${Date.now()}-${idCounter++}` ``); a plain `Date.now()` was tried first and rejected because two `addTodo()` calls in the same millisecond produced colliding IDs that corrupted `updateTodo`/`deleteTodo` — keep the counter suffix if touching ID generation.

`loadTodos()` is `async` (a real network call via `supabaseClient...select('*')`) and fails safe: any Supabase error is logged via `console.error` and an empty array is returned rather than throwing. Because loading is async, app startup goes through `async function init()` at the bottom of `script.js` (populates `todos`, seeds example data if the table came back empty, then calls `applyFilterAndRender()`), not a top-level synchronous assignment — there is a brief blank `.task-list` until the initial fetch resolves.

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

Mobile-first with a single breakpoint at `@media (min-width: 640px)`; below it, `.task-item` uses a 3-row CSS grid (`grid-template-areas`: check/index/category/actions, then text, then the `.task-item__meta` date row), above it a 2-row layout (check/index/text/category/actions, then a `meta` row under text+category). If the item markup changes, both `grid-template-areas` blocks need updating together.

`.task-item__text` intentionally uses `justify-self: start` (not the grid default of stretch) so the element's own width matches its text content — the strike-through (`::after`, width-animated 0→100%) is sized as a percentage of that element, so letting it stretch to the full grid column would make the strike line run past the visible text.

Focus is always visible (`:focus-visible` outlines on inputs, buttons, filter tabs, and the checkbox via a sibling selector since the real `<input type="checkbox">` is visually hidden) — never add `outline: none` without replacing it with an equally visible alternative.

### Initial seed data

If `loadTodos()` resolves to an empty array (empty `"To_Do_List"` table) on first load, `init()` seeds three example todos (matching the original static mockup) directly through `addTodo()`/`toggleComplete()`, rather than via hardcoded HTML — `index.html`'s `<ul class="task-list">` starts empty and is always populated by JS. Because this only fires when the table is empty, it runs once ever per Supabase project, not once per browser/device like the old localStorage version did.

### Input Date / Due Date

Every todo carries `createdAt` (epoch ms, set once at creation, never edited) and an optional `dueDate` (`"YYYY-MM-DD"`, the native value of an `<input type="date">`). `formatTimestampYMD()` / `formatDueDateYMD()` in the "날짜 포맷팅" section convert these to the `YYYY/MM/DD` display format shown in each task item's `.task-item__meta` row (입력일 / 마감일). `formatDueDateYMD` deliberately splits the ISO string instead of parsing it through `Date`, to avoid a timezone-driven off-by-one-day bug.

Unlike category, due date **is** editable after creation: `enterEditMode()` swaps in a `.task-item__edit-due-date` date input alongside the text input, and `updateTodo()` accepts a `newDueDate` argument (empty string → `null`, i.e. clears it). If new editable fields are added to the edit flow, follow this same pattern (replace/append into `.task-item__meta`, read the value in `commitEdit()`).
