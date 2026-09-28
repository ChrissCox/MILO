# MILO step 1 build contract

MILO (Monitor and Interface Layer for Operations) is Chris's personal operations companion: a calm, pixel-art, open-world desktop app where Milo, a small chibi character, watches over Chris's AI crew (Claude Code, Codex, and helper tools such as Jev and Whisper). It grows out of Habitack (`C:\Users\chris\Projects\Habitack`, read-only reference for tone and Electron patterns). **Do not modify Habitack.**

Step 1 delivers: the pixel world with Milo's camp, Milo's pop-up greeting with a "while you were away" recap, **Watchkeeping** (read-only monitoring of agent sessions), and gentle "task finished" alerts while the app is open.

## Ground rules (all modules)

- Plain JavaScript ES modules in `src/` (browser + Node where noted). Electron main/preload are CommonJS (`.cjs`). No build step, no bundler, no new npm packages. `node_modules` holds only `electron` 44 and `playwright-core` 1.63 (copied in; npm is not installed).
- Node is **not on PATH**. Use `C:\Users\chris\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe` (v24). Run PowerShell or Bash tools with that absolute path.
- **Read-only and private.** MILO never writes to, moves, or deletes anything under `~/.claude` or `~/.codex`. Transcript text never leaves the PC: no network calls except a local probe of `http://127.0.0.1:11434` (Ollama). The renderer has a CSP with `connect-src 'none'`. MILO never calls Jev or any cloud API in step 1.
- The renderer only receives **summaries** (title, project, status, timestamps, a short last-message snippet ≤ 200 chars). Full transcripts stay in the main process.
- Calm by design: no flashing, no shake, no red alarm styling, no exclamation marks in copy. Respect `prefers-reduced-motion` and the in-app motion setting.
- Copy style: sentence case, contractions, no "please", no "successfully", no emoji.
- Only edit the files your module owns (listed below). If you need something from another module, code against this contract exactly.

## Shared data shapes

### AgentSession (produced by `src/watch`, consumed everywhere)

```js
{
  id: 'claude:<sessionId>' | 'codex:<threadId>',  // globally unique
  agent: 'claude' | 'codex',
  sessionId: string,
  title: string,           // best human title, <= 80 chars, never empty ('Untitled session')
  project: string,         // basename of cwd, e.g. 'Claude' for 'Z:\\Claude'; '' if unknown
  cwd: string,
  startedAt: number,       // ms epoch
  lastActivityAt: number,  // ms epoch of the newest meaningful record, never later than scannedAt
  status: 'working' | 'needs-you' | 'done' | 'stopped',
  statusDetail: string,    // short calm phrase: 'Working now', 'Waiting on you', 'Finished', 'Stopped partway'
  live: boolean,           // a running process owns this session right now
  lastMessage: string,     // last assistant text, whitespace collapsed, <= 200 chars, '' if none
  completions: number[],   // ms timestamps of finished turns, ascending, at most the last 50
  turns: number,           // total finished turns
  model: string,           // '' if unknown
  source: string,          // entrypoint/originator, e.g. 'claude-desktop', 'cli', 'Codex Desktop'
  archived: boolean,       // Codex archived threads; Claude sessions archived in the desktop app (never while live)
}
```

Status rules:
- **Claude**: a session is `live` when `~/.claude/sessions/<pid>.json` names it, that pid is alive (`process.kill(pid, 0)` does not throw), and, when the entry has a `procStart`, the process holding that pid was created at that time (Windows: one CIM query per new (pid, procStart), cached; within 10 ms; an unreadable or failed probe keeps the pid check). Entries with `spare: true` or a `parkedJobId` are not sessions (as in Claude Code). Live registry `status: 'busy'` → `working`; `'idle'` → `done` (turn finished, Chris's move); any other registry status string → `needs-you` with `statusDetail` 'Waiting on you'. Not live: last main-chain assistant message had `stop_reason: 'end_turn'` and no human prompt follows it in file order (a user record with `origin.kind === 'human'`, or, without `origin`, plain text that is not a tool result, meta record, command/shell echo, task notification or interrupt marker) → `done`; otherwise activity within the last 3 minutes (and not more than 60 s in the future) → `working`; otherwise `stopped`.
- **Codex**: from `event_msg` payloads. Last lifecycle event `task_started` with no later `task_complete`/`turn_aborted` → `working` (and `live: true`) if the newest activity record is at most 10 minutes old (and not more than 60 s in the future), else `stopped`. `task_complete` → `done`. `turn_aborted` → `stopped`. Activity records are every record except `session_meta` and `event_msg` `thread_settings_applied` (Codex writes those when a thread is merely opened).
- A finished turn (for `completions`/`turns`): Claude = main-chain assistant record with `message.stop_reason === 'end_turn'`; Codex = `event_msg` `task_complete`. For a Codex thread listed in `external_agent_session_imports.json`, only native turns count: turns whose `turn_id` has a `turn_context` record (replayed turns have none).
- Times past the scan time (clock skew) are clamped to it in the snapshot.

### LocalTool

```js
{ id: 'jev' | 'whisper' | 'ollama', name: string, kind: 'cloud' | 'local',
  installed: boolean, active: boolean, detail: string, note: string }
```
- **Jev** (`kind: 'cloud'`): TypeSafe's decision model, reached through Chris's Jev skill/router. Installed when `~/.claude/jev-router/state.json` exists. `active` = its `enabled` flag. `detail` e.g. 'Router on · 14 messages sized · $0.0004' from `sent_to` counts and `cost_usd`. `note`: 'Cloud service. When the router is on, message text goes to TypeSafe.' MILO only reads this local stats file.
- **Whisper** (`kind: 'local'`): installed when `python -c "import importlib.util as u; print(bool(u.find_spec('whisper')))"` prints True (8 s timeout, run once per app launch, cached). `active` = installed. detail 'Speech to text, runs on your PC'.
- **Ollama** (`kind: 'local'`): `active` when GET `http://127.0.0.1:11434/api/tags` answers within 800 ms (detail lists up to 3 model names); `installed` when that answers or `%LOCALAPPDATA%\Programs\Ollama\ollama.exe` exists. Otherwise detail 'Not installed. Local models would live here.'

### Snapshot (what `scan()` returns and what the renderer receives)

```js
{ scannedAt: number,
  sessions: AgentSession[],      // sorted by lastActivityAt desc, at most 200
  tools: LocalTool[],            // always jev, whisper, ollama in that order
  sources: { claude: { ok: boolean, path: string, count: number, live: boolean, error?: string },
             codex:  { ok: boolean, path: string, count: number, live: boolean, error?: string } },
  capacity: { codex: { usedPercent: number, resetsAt: number, windowMinutes: number, at: number } | null } }   // Phase 3
```
`sources.X.live` = live status is readable for that agent (Claude: the sessions registry folder exists; Codex: lifecycle events were found).

**Phase 3 additions** (CONTRACT-PHASE3.md §4.2):
- `capacity.codex` is the newest Codex allowance reading, taken from `token_count` rate limits in the `codex` bucket. It uses the fuller of its windows, and `resetsAt` is in ms.
- Every AgentSession also carries `waitingSince`: the time a live Claude session began waiting on Chris, or null.
- Main's `snapshotKey` includes `capacity`.

## Modules and ownership

### A. Watch — `src/watch/claude.js`, `src/watch/codex.js`, `src/watch/local.js`, `src/watch/index.js`, `tests/watch.test.js`, `tests/fixtures/**`

Node-only ESM (fs/promises, path, os, child_process, http). `index.js` exports:

```js
export function createWatcher({ claudeHome, codexHome, localAppData, now = () => Date.now(), probeTools = true, processStarts } = {})
// defaults: claudeHome = process.env.MILO_CLAUDE_HOME || ~/.claude
//           codexHome  = process.env.MILO_CODEX_HOME  || ~/.codex
//           processStarts = the Windows process creation-time probe (tests inject a fake)
// returns { scan(): Promise<Snapshot>, dispose(): void }
```
- Claude transcripts: `<claudeHome>/projects/<project-slug>/<sessionId>.jsonl` (top level of each project folder only; skip `subagents/` and nested folders). Skip records with `isSidechain: true`. A live session's `lastActivityAt` also takes the newest file mtime under `<project-slug>/<sessionId>/subagents/**` (stat only, nothing read), so a session busy with subagents doesn't look idle. Desktop release markers `<sessionId>.desktop-released.json` (`{ v, releasedAt, reason }`): `reason: 'delete'` drops the session unless it is live; `'archive'` sets `archived: true` unless live. Title priority: newest `custom-title.customTitle` > newest `ai-title` > newest `agent-name.agentName` > live registry `name` > newest `last-prompt.lastPrompt` (first line) > 'Untitled session'. `cwd`, `entrypoint` (source), `version` from records; `model` from the newest assistant `message.model`. Live registry: `<claudeHome>/sessions/<pid>.json` with `{pid, sessionId, cwd, name, status, updatedAt, entrypoint}`. A registry entry whose transcript is missing still produces a session (title from `name`).
- Codex: `<codexHome>/sessions/YYYY/MM/DD/rollout-*.jsonl` and `<codexHome>/archived_sessions/rollout-*.jsonl` (archived: true). `session_meta.payload` gives `id`, `cwd`, `originator`, `thread_source`, `timestamp`. Titles from `<codexHome>/session_index.jsonl` lines `{id, thread_name, updated_at}` matched by thread id; fallback to the first user message text. **Verify against the real files on this PC** how rollout files, `session_meta.payload.id`/`session_id`, `history_base.thread_id`, and index ids relate, and how subagent threads are marked (e.g. `thread_source`); merge multiple files of one thread and exclude subagent/spawned threads from the top-level list. Report what you found in your final message. When checking real data, print counts and field names only, never message text.
- Codex threads imported from a Claude Code session that is also listed (the import record's `source_path` file name, minus `.jsonl`, is that session's id) are the same work twice: they are left out of the snapshot unless Codex has native turns in them.
- Transcripts and rollouts are append-only, so they are parsed incrementally: the cache keeps each file's byte offset, first bytes and running summary, and a file that only grew is read from where the last scan stopped (a shrunk, rewritten or replaced file is read again from the start). Every record counts, however big the file. An unterminated last line waits until it is whole (unless it already parses as a complete record). A rollout whose first line isn't whole yet is left out until it is. A repeat scan with no changes reuses results by `(mtimeMs, size)`. Malformed lines are skipped, never fatal. One bad file never breaks a scan; a missing home folder yields `ok: false` with a calm `error`.
- `tests/fixtures/claude-home/` and `tests/fixtures/codex-home/` hold small synthetic homes that mirror the real record shapes (made-up text only). Tests must cover: titles, statuses (done/working/stopped/needs-you via a registry file whose pid is `process.pid`), sidechain and subagent exclusion, malformed lines, caching, Codex merge/archive, snippet trimming, Jev stats, missing homes.

### B. Core — `src/model.js`, `src/recap.js`, `src/skills.js`, `tests/core.test.js`

Pure ESM usable in the browser and Node. No DOM, no fs.

`src/model.js`:
```js
export function createState(now = Date.now())
export function normalizeState(input, now = Date.now())   // never throws; keeps unknown fields
export function looksLikeSavedState(value)                // plain object with settings, milo and user objects
// State:
{ version: 1,
  user: { name: 'Chris' },
  milo: { name: 'Milo', tile: { x, y } | null },
  lastSeenAt: number | null,        // last moment Chris was looking at MILO
  lastGreetedDay: 'YYYY-MM-DD' | null,
  settings: { motion: true, notifications: true, greeting: true },
  skills: { [skillId]: { level: number, provenAt: number | null } },
  panel: string | null }            // last open place panel id
export function markSeen(state, now)             // sets lastSeenAt
export function dayKey(ms)                       // local 'YYYY-MM-DD'
```

`src/recap.js`:
```js
export function buildRecap(sessions, lastSeenAt, now)
// → { awayMs, finished: Item[], started: Item[], working: Item[], needsYou: Item[], quiet: boolean }
//   Item = { id, agent, title, project, count }   (count = finished turns since lastSeenAt for 'finished')
//   finished: sessions with completions after lastSeenAt; started: startedAt after lastSeenAt;
//   working/needsYou: current status. lastSeenAt null → treat as first visit: nothing finished/started, just current state.
export function greeting(recap, { name = 'Chris', now = Date.now(), firstToday = false } = {})
// → { title: string, lines: string[] (1–4 short lines, <= 90 chars each), hasNews: boolean }
//   title: 'Good morning, Chris' (5–11), 'Good afternoon, Chris' (12–16), 'Good evening, Chris' (17–21), else 'Hi, Chris' — only when firstToday; otherwise 'Welcome back' (away >= 10 min) or 'Here with you' (shorter).
//   lines summarize by agent: 'Claude finished 3 tasks.' / 'Codex finished “Fix portfolio build”.' / 'Claude is still working on “Habitack development”.' / 'Codex is waiting on you.'  Quiet: 'All quiet while you were away.'
export function diffSnapshots(prevSessions, nextSessions, now = Date.now())
// → Event[] for live alerts: { type: 'finished' | 'needs-you' | 'started', session }
//   finished, once per turn even when Claude's two signals (registry idle, transcript end_turn) land in
//   different scans: working → done always; a gained completion (newest completion > previous newest)
//   while still working waits for that working → done; a gained completion on a session that wasn't
//   working counts only when it is newer than the previous lastActivityAt (else it is the late record
//   of a finish already reported). A new session counts when its newest completion is after every time
//   (≤ now) the previous scan knew about.
//   needs-you: status changed to 'needs-you'. started: id not present before and status working.
//   Truncated titles never split a surrogate pair.
export function alertText(event)   // → { title, body } calm one-liners, e.g. { title: 'Claude finished a task', body: '“Habitack development” is ready for you.' }
```

`src/skills.js` (Milo's skills; levels are real capabilities, each proven by a check):
```js
export const SKILLS  // array of { id, name, place, summary, levels: [{ level, title, proof }] }
// ids and places: watchkeeping→'watchtower', dispatch→'workshop', timekeeping→'harbor', lore→'library', voice→'camp', tinkering→'building-site'
// Watchkeeping: L1 'Reads your agent sessions' (proof: at least one source ok), L2 'Live status and task alerts' (proof: at least one source live),
//               L3 'Watches GitHub PRs and CI', L4 'Notices an agent stuck in a loop' (future).
// Dispatch: L1 'Launches one agent run', L2 'Runs agents side by side', L3 'Second agent reviews the first', L4 'Chains research, build, test'.
// Timekeeping: L1 'Reads your calendar', L2 'Deadline warnings', L3 'Agent runs on a timetable', L4 'Morning briefing'.
// Lore: L1 'Remembers decisions per project', L2 'Recall across projects'.  Voice: L1 'Push to talk', L2 'Spoken briefings'.
// Tinkering: L1 'Scaffolds a new app', L2 'Writes its level tree'.
export function evaluateSkills(snapshot)   // → { [skillId]: { level, next: {level,title}|null, proven: [{level,title}] } }
//   Only proofs implementable now return true (watchkeeping L1, L2). Everything else is level 0 (locked).
```

### C. World — `src/world/sprites.js`, `src/world/map.js`, `src/world/engine.js`, `tests/world.test.js`, `scripts/world-preview.html`

Browser ESM, canvas 2D, no libraries. `map.js` and the data parts of `sprites.js` must also import cleanly in Node for tests (no DOM at import time).

`map.js`:
```js
export const TILE = 16
export const MAP      // { width, height, tiles: string[] rows or Uint8Array, ... } ~ 64 x 44 tiles
export const PLACES   // [{ id, name, blurb, built: boolean, fogged: boolean, door: {x,y}, area: {x,y,w,h} }]
// ids: 'camp' (Milo's camp, built), 'watchtower' (built), 'workshop' ('Workshop row', plot), 'clip-studio' (plot),
//      'library' (plot), 'game-table' (plot), 'building-site' (plot with scaffold), 'harbor' (fogged, by water)
export function isWalkable(x, y)
export function findPath(from, to)   // A* 4-direction on tiles; [] when unreachable; path excludes `from`, ends at `to` (or nearest walkable neighbour)
export function placeAt(x, y)        // place id whose area contains the tile, or null
```
`engine.js`:
```js
export function createWorld(canvas, {
  onPlaceClick = (placeId) => {}, onCrewClick = (crewId) => {}, onHover = (info /* {kind:'place'|'crew', id, x, y} | null */) => {},
  onMiloMove = (tile) => {}, motion = () => true, startTile = null } = {})
// → { setCrew(crew), walkTo(target /* placeId or {x,y} */): Promise<void>,
//     entrance(): Promise<void>   // Milo steps out of his tent and walks to startTile (when walkable) or home
//     miloScreenPos(): { x, y }   // CSS px within the canvas element, top-centre of Milo's head, for the speech bubble
//     keepClear(): [{ kind: 'milo'|'campfire'|'crew', id, x, y, w, h }]   // CSS px rects a bubble shouldn't cover
//     setInsets({ top, right, bottom, left })   // CSS px of the view covered by overlays; the camera centres Milo in the rest
//     setPaused(bool), resize(), dispose(), miloTile(): {x,y} }
// Also exported: objectBoxes() → where each map object's sprite sits (world px), for layout checks.
// crew: [{ id: 'claude'|'codex'|'jev'|'whisper'|'ollama'|string, state: 'working'|'needs-you'|'done'|'idle'|'offline', label: string, count: number }]
```
- Pixel art: 16×16 tiles drawn at an integer scale (2–4, chosen from canvas size: floor(min(w/320, h/208)), and 4x only once the view still holds 26×16 tiles, so a bigger window never shows less of the world) with `imageSmoothingEnabled = false`. Camera follows Milo smoothly, centres a point a little above his feet (tall sprites stand north of their feet) inside the part of the view not covered by `setInsets`, and clamps to the map. Scatter props (rocks, bushes) are left out where a taller sprite in front would hide more than a fifth of them. Click a tile to walk (A*); click a place to walk to its door then `onPlaceClick`; arrow keys / WASD step Milo one tile at a time when the canvas has focus. ~30 fps loop that stops when paused, hidden, or `motion()` is false (then draw static frames on change only).
- Crew as characters: `working` → at the Workshop row plot doing a small hammer/typing loop; `needs-you` → just outside Milo's camp with a small speech-dot icon; `done`/`idle` → sitting at the campfire; `offline` → not drawn. Jev is a small courier bird on the watchtower roof when installed; Whisper a little owl near the library plot; unknown ids a generic helper. Distinct palettes per crew id (Claude warm clay, Codex slate blue).
- Places: Milo's camp (tent + cabin + campfire + flag), a watchtower, empty plots with signposts and fences for unbuilt places, a small scaffold at the building site, water and a dock area under soft fog for the harbor. Trees, flowers, paths, a pond, gentle ambient motion (campfire flicker, water shimmer, tree sway every few seconds) that stops when motion is off.
- Art direction: calm top-down 3/4 pixel art, soft pastel palette (~24 colours), soft dark outlines (#3d4038-ish, never pure black), chibi Milo ~16×20 px with a big head, 4-direction walk (at least 3 frames), idle breathing. Original art only; take the *feel* of cozy browser idle-MMOs (Microscape) without copying anything.
- `scripts/world-preview.html` loads the engine alone with a fake crew so the world can be screenshotted without Electron wiring.
- `tests/world.test.js` (Node): map dimensions, every place door walkable and reachable from the camp door, `findPath` correctness, sprite grids have consistent sizes and only palette keys.

### D. Shell — `electron/main.cjs`, `electron/preload.cjs`, `index.html`, `src/app.js`, `src/styles.css`, `tests/ui.mjs`, `Launch MILO.vbs`, `scripts/Create-Shortcut.ps1`, `README.md`

Follow Habitack's hardened Electron patterns (`C:\Users\chris\Projects\Habitack\electron\main.cjs`): frameless window with custom titlebar, contextIsolation, sandbox, trusted-sender IPC checks, CSP, blocked navigation/web requests, atomic state writes with a `.backup`, save queue, flush-on-close, single-instance lock (skipped when `MILO_TEST=1`).
- Data: `process.env.MILO_DATA_DIR || %APPDATA%\\milo` → `state.json` (+ `state.json.backup`). Main imports `src/model.js` for normalization. A state file that parses but isn't a saved state (`looksLikeSavedState` false: `null`, `[]`, a number, `{}`) is treated like a damaged one: the backup is tried, and nothing is overwritten with defaults.
- The trusted-sender check compares the frame URL with the main page's URL built from its canonical path (`fs.realpathSync.native`), case-insensitively on Windows, so a launch through `c:\...` still works.
- Main owns the watcher: `import('../src/watch/index.js')` → `createWatcher()`; scans at launch, then every 10 s while running, and pushes `milo:snapshot` to the renderer when anything changed.
- Preload exposes `window.milo = { loadState(), saveState(state), scan(), onSnapshot(cb), notify({title, body}), windowAction(action), onBeforeClose(cb), finishClose() }`. `notify` shows an Electron `Notification` only when the main window is not focused and `settings.notifications` is on; clicking it focuses MILO.
- Renderer (`src/app.js`): full-window world canvas with calm HTML overlays:
  - **Milo's speech bubble**, anchored to `world.miloScreenPos()` and placed above Milo, beside him (tail at his face) or below him, whichever leaves `world.keepClear()` rects, the crew strip and the place list uncovered (a side that still fits is kept while Milo moves). It comes right after the canvas in the DOM so its buttons are early in tab order. On launch Milo walks out (`world.entrance()`, to his saved tile), then greets using `buildRecap(snapshot.sessions, state.lastSeenAt, now)` + `greeting(...)`, with 'Show me' (opens the Watchtower panel) and 'Later' buttons; it fades after ~12 s if untouched. Greeting can be turned off in settings. Update `lastSeenAt` on launch after computing the recap, every 60 s while visible, and on close.
  - **Live alerts**: on each snapshot, `diffSnapshots(prev, next)` → a short bubble from Milo (queued, one at a time) and, when unfocused, `window.milo.notify(alertText(e))`.
  - **Crew strip** (top-left): one pixel-framed chip per crew member with its aggregated state (any working → working; else any needs-you; else done/idle; tools by installed/active). The shell passes the strip's bottom edge and an open panel's width to `world.setInsets`. Map hover tips never cover the strip or the place list (they flip below the pointer or slide clear).
  - **Place panels** (right side, slide in, closeable, keyboard reachable): Watchtower = sessions grouped Needs you / Working now / Finished recently (24 h) / Earlier, each row showing agent, title, project, relative time, snippet; plus a 'Helpers' section for LocalTools with Jev's cloud note. Camp = Milo's skills (`evaluateSkills`) with proven levels and the next level, plus settings (motion, alerts, greeting). Unbuilt places = what they will become and their planned levels ('Coming in a later step'). Harbor = fogged: 'Connect a calendar to clear the fog.'
  - An accessible place list (buttons) mirrors the canvas for keyboard/screen-reader users; the canvas gets an `aria-label`. The list shows when opened, or while keyboard focus (`:focus-visible`) is inside it.
  - Watchtower rows: agent badge, title, then a meta line with the project marked as a folder, status and time (working rows say 'Updated just now' / 'Last update 40 min ago'), and the snippet.
  - Visual style: pixel-art UI chrome (2px soft-dark borders, stepped corners, solid 3px drop edge, cream panels, pastel greens), a readable UI font for text. Calm and uncluttered. Pixel glyphs are drawn at integer multiples of their grids (8×8 faces at 16 or 24 px, 7-pixel ticks at 14 px, 2px tail steps). Small text is at least 4.5:1 against its background; focus rings are ink so they read on grass and cream alike.
- `tests/ui.mjs`: Playwright `_electron` like Habitack's, with isolated temp `MILO_DATA_DIR`, `MILO_CLAUDE_HOME`, `MILO_CODEX_HOME` built from `tests/fixtures` (plus a live registry file using the test process pid to simulate a working Claude session, then flipped to idle to trigger a finished alert). Checks: window opens with no renderer errors; greeting bubble appears with recap text and 'Show me' opens the Watchtower; sessions and statuses render; a finished alert appears after the flip; state persists `lastSeenAt` across restart and a second launch greets with 'Welcome back' logic; 1000×700 layout has no overflow; no network requests leave localhost. Save screenshots to `test-results/`, and only ever of the synthetic homes: never screenshot MILO running on Chris's real `~/.claude` or `~/.codex` into the repo (a one-off real-data check blurs `.session-title`, `.session-meta`, `.session-snippet`, `.bubble-line` and `.hover-tip` first and saves outside the repo, or reports counts only).
- `Launch MILO.vbs` and `scripts/Create-Shortcut.ps1` mirror Habitack's (desktop shortcut named MILO, icon `assets/milo.ico`).

## Verification commands

```
node --test tests/watch.test.js tests/core.test.js tests/world.test.js
node tests/ui.mjs
```
(with the absolute node path above)
