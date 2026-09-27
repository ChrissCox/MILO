# MILO step 2 build contract: plots, ideas, and buildings

Read `CONTRACT.md` first. Its ground rules, shapes, tone and Electron patterns still apply, except where this file amends them. Step 1 is committed and working (95 unit tests, 13 Electron checks). Keep all of them passing, updating tests only where step 2 deliberately changes behaviour.

## What Chris asked for

> Make the buildings all empty plots, with the ability to ask what should be built there, as well as 3 suggestions. I want to be able to say a suggestion to build and it makes the plot, pixel art and all, from that suggestion.

So in step 2:

1. Every place except **Milo's camp** and the **Watchtower** (Milo's own working buildings) becomes a generic **empty plot**. The Harbor stays a fogged, unexplored area; it is not a plot.
2. Each empty plot's panel shows **3 suggestions** for what to build there, tailored to Chris, plus a box to **ask Milo** ("what should go here?", "something for my drawing streams") which returns 3 fresh suggestions, and a way to **build your own idea** straight from the same box.
3. Choosing a suggestion (or typing an idea and building it) makes Milo ask the crew to **design** the building. The design comes back as a **blueprint** (below). MILO's pixel-art **kit** turns the blueprint into a building on that plot, in the world's own style, with its name, sign emblem, props, and a **level tree** of real features to build later.
4. While the crew designs it, the plot becomes a **building site** (scaffold, the designing crew member walks over and works there). When the design lands, the scaffold comes down in a short, calm reveal and Milo announces it ("The Clip studio is built."). It persists across restarts.
5. A built plot's panel shows the building, what it's for, who designed it, and its 5 planned levels with their proof checks (all **Planned** in step 2; Dispatch builds them in step 3). Actions: rename, redesign (with an optional tweak such as "make it cozier"), and clear the plot (confirm first).

## Amendment to the privacy rule

MILO may now ask Chris's own crew for designs by running their CLIs headlessly. Only these things may be sent: the question or idea text Chris typed or picked, the plot's name and size, the names of existing buildings, Chris's project folder names (`C:\Users\chris\Projects\*`), and the names plus first 160 characters of the descriptions of his skills (`~/.claude/skills/*/SKILL.md` frontmatter). **Never** session titles, transcripts, snippets, memory files, or anything from `~/.codex`. The UI says plainly who is asked and what is shared: "Milo asks Codex (OpenAI) to draw up plans. It shares your idea, this plot's name and size, the names of your buildings and projects, and your skills' names with the start of each description. Never your sessions, and it can't open your files." In Automatic mode, when Claude Code is the designer and Codex is ready, the line adds "If Claude Code turns out not to be signed in, Milo asks Codex (OpenAI) instead." The renderer still has no network access; only the main process spawns the CLIs. Jev is still never called.

The rule covers what each CLI adds on its own, not just the brief MILO writes (checked with localhost captures of the real requests, 2026-09-27):
- **Claude Code** reads every CLAUDE.md above its working folder (the temp folder is under `C:\Users\chris`, so `~/.claude/CLAUDE.md`, `~/.claude/rules/*.md` and `C:\Users\chris\CLAUDE.md` would ride along whatever `--setting-sources` says), and its auto memory creates `~/.claude/projects/<temp folder>/memory` on every run. Every Claude Code run (calls and the sign-in probe) gets `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, added after `childEnv`. (Folders the auto memory left before this fix, `~/.claude/projects/*milo-crew-*` and `milo-architect-*`, are safe for Chris to delete by hand; MILO never deletes under `~/.claude`.)
- **Codex** adds a skills block (the names, full descriptions and SKILL.md paths of `~/.agents/skills`), environment and permission notes, and tools that can run commands and read any file. `CODEX_LOCKDOWN` in `crew.js` turns these off with `-c` settings (never `--disable`, which exits on a feature name a Codex update removed): the skills block, the environment, permission, app and collaboration notes, the shell, unified exec, view_image, web search, apps, plugins, goals and memories are gone, and the code-mode `exec` tool fails closed ("code-mode host is disabled"), checked by playing the model's side and calling it. Codex's own base instructions and its sub-agent tools remain (a sub-agent gets the same locked-down tools). The briefs also say to answer from the brief alone.
- Codex always sends `$CODEX_HOME/AGENTS.md` (or `AGENTS.override.md`) and no setting stops it, so while such a file exists Codex is not asked at all (detail "Not asked: Codex would also send the AGENTS.md in your .codex folder"). MILO only checks that the file exists; it never opens it.

## Plots

`src/world/map.js` PLACES: keep `camp`, `watchtower`, `harbor` (fogged, not a plot). Replace `workshop`, `clip-studio`, `library`, `game-table`, `building-site` with five plots that keep the same map areas and doors:

| id | name | old id |
|---|---|---|
| `plot-meadow` | Long meadow | workshop |
| `plot-rise` | Sunny rise | clip-studio |
| `plot-birch` | Birch hollow | library |
| `plot-pond` | Pondside plot | game-table |
| `plot-orchard` | Old orchard | building-site |

Place objects gain `kind: 'camp' | 'watchtower' | 'plot' | 'fog'`. Old ids in saved state (e.g. `panel: 'workshop'`) map to the new plot ids during normalization. The step 1 "working crew gather at Workshop row" behaviour moves to a small **crew workbench** beside the camp (decorative, not a plot), except that a crew member currently designing a building works at that plot.

## Shared shapes

### Suggestion

```js
{ id: string,               // stable within its list, e.g. 'local:clip-studio' or 'codex:1'
  title: string,            // <= 28 chars, a building name: 'Clip studio'
  pitch: string,            // <= 110 chars, what it would do for Chris
  why: string,              // <= 110 chars, the evidence: 'You have a video-expert skill and stream drawing'
  source: 'local' | 'claude' | 'codex' }
```

### Blueprint (the design; the crew returns it, the kit draws it)

```js
{ version: 1,
  name: string,             // <= 28
  tagline: string,          // <= 70
  purpose: string,          // <= 160, what the app/tool will do for Chris
  style: {
    shape: 'cottage' | 'hall' | 'tower' | 'barn' | 'shop' | 'greenhouse' | 'observatory' | 'mill' | 'pavilion' | 'workshop',
    walls: 'log' | 'plank' | 'stone' | 'plaster' | 'brick' | 'glass',
    wallColor: Colour, roof: 'gable' | 'hip' | 'flat' | 'dome' | 'thatch' | 'shingle' | 'awning', roofColor: Colour,
    trim: Colour, door: 'plain' | 'arched' | 'double' | 'sliding',
    windows: 'none' | 'square' | 'round' | 'tall' | 'shopfront',
    chimney: boolean, flag: Colour | 'none', awning: Colour | 'none' },
  emblem: string[],         // exactly 12 rows of exactly 12 chars; keys from EmblemKey or '.' (transparent); shown on the sign
  props: [{ kind: PropKind, side: 'left' | 'right' | 'front' }],   // 0–4
  yard: 'grass' | 'path' | 'stone' | 'flowers' | 'garden' | 'sand',
  levels: [{ level: 1..5, title: string /* <= 50 */, summary: string /* <= 140 */, proof: string /* <= 140, a concrete check that shows the level works */ }],  // exactly 5, levels 1..5 in order
}
// Colour: 'cream' | 'wood' | 'woodDeep' | 'woodLight' | 'stone' | 'stoneDeep' | 'clay' | 'clayDeep' | 'blossom' | 'butter' | 'honey' | 'slate' | 'slateDeep' | 'lavender' | 'leaf' | 'leafDeep' | 'water' | 'sand'
// EmblemKey: o ink, c cream, r clay, u butter, U honey, e slate, l leaf, L leafDeep, k blossom, v lavender, b wood, B woodDeep, s stone, w water
// PropKind: 'easel' | 'anvil' | 'crates' | 'barrels' | 'bookcart' | 'telescope' | 'camera' | 'filmreel' | 'musicstand' | 'gardenbed' | 'lantern' | 'bench' | 'mailbox' | 'pottedplant' | 'well' | 'handcart' | 'dicetable' | 'chalkboard' | 'antenna' | 'beehive' | 'workbench' | 'scrollrack' | 'trophy' | 'kiln' | 'fishingrack' | 'birdhouse' | 'fountain' | 'signboard'
```

`src/architect/blueprint.js` (pure ESM, browser + Node) exports the enums, `BLUEPRINT_SCHEMA` and `SUGGESTIONS_SCHEMA` (strict JSON Schemas: every property required, `additionalProperties: false`, suitable for both `claude --json-schema` and `codex exec --output-schema`), `validateBlueprint(x) → { ok, blueprint, problems[] }` (repairs what it safely can: clamps lengths, drops bad props, pads/crops the emblem, replaces unknown enum values with defaults; `ok: false` only when unusable), and `validateSuggestions(x) → Suggestion[]`. All AI output is untrusted data: never `innerHTML`, never used as a path or command.

### Plot state (in `state.plots`)

```js
state.plots = { [plotId]: {
  status: 'empty' | 'designing' | 'built',
  suggestions: Suggestion[],          // the 3 shown now (persisted so they don't reshuffle)
  asked: string | null,               // last question asked here
  idea: Suggestion | null,            // what is being or was built
  blueprint: Blueprint | null,        // when built
  designedBy: 'claude' | 'codex' | 'kit' | null,
  builtAt: number | null,
  name: string | null,                // Chris's rename; falls back to blueprint.name
} }
```
`normalizeState` fills missing plots as empty, validates stored blueprints with `validateBlueprint`, and turns a leftover `designing` (app closed mid-design) back into `empty` while keeping `idea`, so the panel can offer "Try again".

## Modules and ownership

### E. Architect (main process) — `src/architect/*.js`, `tests/architect.test.js`, `tests/fixtures/architect/**`

```js
// src/architect/index.js (Node ESM)
export function createArchitect({ home = os.homedir(), projectsDir = 'C:\\Users\\chris\\Projects', mode = process.env.MILO_ARCHITECT || 'auto', spawnImpl, now } = {})
// → { status(): Promise<{ designer: 'claude'|'codex'|'kit', crew: [{ id:'claude'|'codex', found, ready, detail }] }>,
//     localSuggestions(plot, built): Suggestion[3],               // instant, offline, from Chris's signals
//     suggest({ plot, question, built }): Promise<{ suggestions: Suggestion[3], by }>,
//     design({ plot, idea, tweak, built }): Promise<{ blueprint, by }>,
//     cancel(): void }
// plot = { id, name, w, h } (buildable size in tiles); built = names of existing buildings.
// mode: 'auto' (Claude Code if signed in, else Codex, else kit), 'claude', 'codex', 'kit'/'offline' (no crew calls), 'fake' (deterministic canned crew for tests).
```
- **Signals** (`context.js`): skill names + descriptions (first 160 chars) from `~/.claude/skills/*/SKILL.md` frontmatter, project folder names in `projectsDir`, existing building names. Nothing else.
- **Local ideas** (`offline.js`): a curated idea pool matched to signals (e.g. video/watch skills → Clip studio; pf2e/ttrpg → Game table; Habitack project → Town hall for the quest board; fantasy football → Draft room; jev → Sorting office; plus general ones such as Library, Greenhouse, Post office, Observatory, Workshop), each with a `why` naming the evidence. Different plots get different picks; never suggest something already built. Also an offline **kit designer**: turns any idea text into a sensible blueprint by keyword (a bakery gets an awning, warm colours, crates and a bread emblem; a studio an easel and camera; unknown ideas a tidy cottage), with a generic but honest 5-level tree.
- **Crew calls** (`crew.js`): find binaries: Claude Code = `MILO_CLAUDE_BIN` > `%USERPROFILE%\.local\bin\claude.exe` > newest `%APPDATA%\Claude\claude-code\<version>\claude.exe`; Codex = `MILO_CODEX_BIN` > newest `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe` > `codex` on PATH. Spawn with an argument array (never a shell), in a fresh empty temp directory, prompt on stdin, `windowsHide`, 150 s timeout, one call at a time, killable by `cancel()`.
  - Claude: `-p --output-format json --json-schema <schema> --tools "" --no-session-persistence --setting-sources project --model sonnet`. `--setting-sources project` from an empty temp dir keeps Chris's user hooks (the Jev router) out of it; verified 2026-09-26. Parse `structured_output` (fallback: JSON inside `result`). A result like "Failed to authenticate…" marks Claude **not signed in** for this launch, with detail "Sign in by running claude in a terminal once", and auto mode moves on to Codex.
  - Codex: `exec --ephemeral --skip-git-repo-check --sandbox read-only --ignore-user-config --ignore-rules`, then `-c <setting>` for each of `CODEX_LOCKDOWN` (see the privacy amendment), then `-C <tmp> --output-schema <tmp>/schema.json -o <tmp>/out.json --color never -` (prompt on stdin). Verified 2026-09-26: returns schema-valid JSON in about 5 s and writes no session files. Sign-in trouble is read only from Codex's own `ERROR`/`warning` lines (it echoes the whole brief to stderr, and a building called "Refresh token desk" must not sign Codex out).
  - Any crew failure or invalid output → validate/repair; if unusable, fall back to the kit designer and say so (`by: 'kit'`, plus a calm note). **Except a redesign**: when a crew member was asked and couldn't finish, `design()` throws `code: 'crew-failed'` ("Codex didn't answer, so the building stays as it was.") and the building that stands is kept. When nobody was going to be asked (Milo's kit chosen, no crew, or known to be signed out) a redesign is the kit's, as before.
  - A stopped call stops its whole process tree: `taskkill /T /F` runs first and the root is ended only after it (the root must be alive for taskkill to find its children). Leftover `os.tmpdir()/milo-crew-*` folders older than the flight limit are swept when the architect loads.
  - Sign-in probes: a "signed in" answer holds until a call fails to authenticate (then not signed in for the launch, as above); "not signed in" or "can't tell" is asked again after a minute (`PROBE_TTL_MS`), or at once with `status({ refresh: true })`, which the camp panel uses. Both probes run at once.
- **Prompts** (`prompts.js`): a design brief with MILO's art direction (calm, cozy top-down pixel art, soft pastels, soft dark outlines), the plot's size, the allowed values, how to draw a readable 12×12 emblem, and how to write the level tree. Levels are real features Chris could actually build, from a small, useful level 1 (one agent run) up to level 5, each with a concrete proof ("a clip file appears in the output folder"). A suggestion brief asks for 3 distinct, specific, useful buildings for Chris, grounded in his signals and the question, none duplicating existing buildings.
- Tests use fake crew binaries: small Node scripts under `tests/fixtures/architect/` run through `spawnImpl` or `MILO_*_BIN`, covering success, auth failure → fallback, garbage output → repair or kit, timeout/cancel, and argument shapes (assert the exact flags above, and that no shell is used).

### F. World and kit — `src/world/kit.js`, `src/world/map.js`, `src/world/engine.js`, `src/world/sprites.js`, `tests/world.test.js`, `tests/kit.test.js`, `scripts/capture-kit.mjs`, `scripts/world-preview.html`, `scripts/world-preview-main.cjs`, `scripts/capture-world.mjs`

- `kit.js` (pure, Node-importable): `drawBuilding(blueprint, { w, h }) → { rows: string[], anchor: { x, y }, door: { x, y } }`, rows of PALETTE keys and '.', sized to fit the plot's buildable area (tiles × 16 px). It composes shape × walls × roof × door × windows × chimney × flag × awning × sign-with-emblem × props × yard into one cohesive sprite with the world's outline and shading rules. Also `drawConstruction(plot, stage 0..3)` (stakes → frame → scaffold with planks → nearly done) and `drawEmptyPlot(plot)` (tidy fenced plot with a small "For you" signpost). Every combination of the enums must produce clean, charming art; no clashing colours, no floating pixels, a readable door facing the plot's door tile.
- `map.js`: the PLACES change above (`kind`, new plot ids/names), the crew workbench, `plotById`, `buildableArea(plotId) → { x, y, w, h }` in tiles.
- `engine.js`: `world.setPlots(state.plots)` draws each plot as empty, construction (animated through stages while designing), or built (kit sprite, cached per blueprint); `world.celebrate(plotId)` plays a short calm reveal (scaffold dissolves over ~1.5 s, a few drifting leaves; instant when motion is off); crew with `{ state: 'designing', plotId }` walk to that plot and work there. Hover tips name the plot ("Long meadow · empty plot") or the building. Everything else in step 1 keeps working.
- `scripts/capture-kit.mjs`: renders a **gallery** of at least 24 varied blueprints (every shape, walls, roof, window and prop value appears at least once, plus realistic ideas: Clip studio, Game table, Town hall, Draft room, Sorting office, Library, Bakery, Observatory) to `test-results/kit-gallery.png` at 3× scale, and shows several of them placed on real plots in the world to `test-results/kit-world.png`. Look at them and iterate until the buildings are as good as the hand-made camp and watchtower.
- `tests/kit.test.js`: every enum combination in a sampled matrix renders without throwing, the output fits the plot, uses only palette keys, and has the door on the bottom edge.

### G. Shell and core — `src/model.js`, `src/skills.js`, `src/recap.js`, `src/app.js`, `src/styles.css`, `index.html`, `electron/main.cjs`, `electron/preload.cjs`, `tests/core.test.js`, `tests/ui.mjs`, `README.md`

- `model.js`: `state.plots` as above, normalization, old-id mapping, `settings.designer: 'auto' | 'claude' | 'codex' | 'kit'` (default 'auto').
- `skills.js`: skills no longer live at plots. `SKILLS` places: watchkeeping → watchtower; everything else → camp. **Tinkering L1 'Designs a building from your idea'** (proof: at least one plot is built with a valid blueprint and level tree); L2 'Scaffolds its project folder', L3 'Builds level 1 with the crew' (future). **Dispatch L1 'Sends one task to the crew'** (proof: at least one building was designed by Claude or Codex). `evaluateSkills(snapshot, state)` takes state for these proofs.
- `recap.js`: `builtText(plot, { asked, placeName, fallback, skipped, redesign, levels }) → { title, body, says }` for the "built" announcement: `body` for a desktop note ("Codex isn't signed in, so Milo drew this one himself."), `says` in Milo's own voice for his bubble and the panel ("…so I drew this one myself."). A redesign is "The Clip studio has its new look".
- `main.cjs` + `preload.cjs`: `window.milo.architect = { status(), localSuggestions(plotId), suggest(plotId, question), design(plotId, idea, tweak), cancel() }` over trusted IPC. Main owns the architect, passes plot sizes from `buildableArea`, reads `settings.designer`, and persists nothing on its own (the renderer saves state). Design and suggest calls are single-flight; a second request while one runs gets a calm "Milo is already asking the crew" error.
- `app.js` plot panel (empty): plot name and a one-line note, 3 suggestion cards (title, pitch, why, 'Build this'), then an input "Ask Milo what should go here, or describe your own idea" with two buttons, **Ask for ideas** and **Build my idea**. Enter = Ask for ideas. A small "What Milo shares" line names the designer and what's shared. While asking or designing: the plot panel shows calm progress ("Codex is drawing up plans…"), Milo's bubble says the same, the plot shows construction, and Cancel stops it. On success: `world.celebrate`, bubble plus alert "The Clip studio is built." and the panel switches to the building view. On fallback to the kit: say so kindly ("Codex didn't answer, so Milo drew this one himself.").
- `app.js` building panel: the building drawn large (from `kit.drawBuilding`, crisp pixels), name (renameable), tagline, purpose, "Designed by Codex · 26 Sep", a level tree with 5 **Planned** levels and their proof checks ("Dispatch builds these in a later step"), and Redesign (optional tweak text) and Clear plot (confirm dialog).
- Camp panel: a **Designer** setting (Automatic, Claude Code, Codex, Milo's kit) with each crew member's readiness from `architect.status()` (e.g. "Claude Code: sign in by running claude in a terminal once").
- `tests/ui.mjs` (with `MILO_ARCHITECT=fake`): every non-camp, non-watchtower place is an empty plot with 3 suggestions; asking returns 3 new ones; building a suggestion shows construction and then a built building in the world and its panel; the level tree shows 5 planned levels; renaming, redesigning and clearing work; the built plot survives a restart; a failed design falls back kindly; nothing leaves localhost from the renderer; layouts fit at 1000×700.

## Refinements after review (2026-09-27)

These refine the sections above; where they differ, these win.

- **Architect results** also carry `fallback` (`{ by, code }` when Milo drew it himself: `missing | auth | agents | invalid | failed | timeout | spawn`, `by: null` for "the crew") and `skipped` (crew Automatic mode moved past). `suggest` and `design` take `onAsk(id)`, called just before each crew member is asked; main forwards it as `milo:architect-asking` and preload exposes `architect.onAsking(cb)` (only 'claude' or 'codex' pass), so the panel, bubble, crew chip and shares line always name who has the brief. `status()` also returns `fallsBack` (Automatic might still hand over to Codex); `window.milo.architect.status({ refresh })`. When nobody can be asked because nobody is signed in, the note says so ("The crew isn't signed in, …").
- **Redesign** keeps the plan: `model.finishDesign(state, plotId, result, now, { keepPlan })` keeps the old name, tagline, purpose and level tree and takes the new look (style, emblem, props, yard). The Redesign form has a **Rethink its levels too** checkbox (off by default) for a full redo; Milo says whether the level tree stayed or changed. While a redesign runs the building stays standing with a light scaffold round it (`kit.drawRedesign(blueprint, plot)`, engine `plotLook` `{ status: 'designing', redesign: true }`, hover "Stream room · being redesigned"), in the world and in the panel; the reveal dissolves that picture. Skill proofs count a building being redesigned.
- **Building sites go up at the designer's pace**: engine `SITE_PACE = { kit: 2400, crew: 11000 }` ms a stage, shared with the panel, so "nearly done" arrives around when real crew plans land; after 25 s Milo says once that the crew is still drawing.
- **Shell details**: the progress line (not Cancel) takes keyboard focus when a request starts, so a double or held Enter never cancels it; it scrolls into view whole. A new building's save is never pushed back by Milo walking (a pending save keeps its earlier deadline). An idea typed without a name is quoted in Chris's words ("your idea, “Somewhere to keep my…”"), never as "Your idea". The busy note names who is working. Quoted questions don't get a second full stop. What a build taught Milo goes into the built bubble ("I learned Dispatch level 1 and Tinkering level 1 along the way.") rather than two more bubbles. Closing MILO during a crew call waits (briefly) for the call to stop and its temp folder to go; a cancel waits up to 4.5 s.
- **Camera** (amends CONTRACT.md's "clamps to the map"): with a panel open the view may run past the map's east edge by as much as the panel covers, so Milo is never hidden under it; the strip past the edge is meadow grass. Top and left still clamp.
- **Crew walks**: a designer who reached the plot stays for the reveal (standing still), then leaves through the gate; one still walking in turns round where it is (`crewRoute`).
- **Making way** (crew never walk through Milo): a plot's gate is a one-tile gap in its fence and Milo waits on it, so a designer walking in, or out once the plans land, would pass over him. When a crew walk will reach Milo's tile within `MAKE_WAY_LEAD_MS` (1.2 s, counting a reveal hold, so for a designer leaving it is just as the scaffold finishes coming down) and he is standing still, he steps aside to the nearest free tile off every crew route (`makeWay` in engine.js; never just south of a route, where passing crew would walk behind him and his head would hide their legs), facing the gate. Once they're by (1.5 tiles clear, nobody's route crossing his way back, then 0.4 s) he steps back and faces the way he did. Meanwhile his spot stays the gate: the camera holds still, Enter opens the plot, and the hops aren't reported to `onMiloMove`, so nothing new is saved. A walk or key press of Chris's (or the shell's `walkTo`) ends it, and he stays where he is sent. If a crew member comes to rest on his spot, he stays where he stepped, and that tile is reported. A crew member whose next tile is Milo's waits for him to move, standing still, and walks on only if he hasn't moved in 2.5 s (`YIELD_MAX_MS`). With motion off the crew don't walk, so Milo doesn't step aside, and turning motion off puts him back on his spot.
- **Local ideas**: every pool idea has its own why; a plot's flavour ("Sunny rise gets the best light and view, a good fit for an observatory") is used only where it's true and on at most one card; Milo's line is "Here are three ideas for this spot." The kit's bakery bakes (recipes, scaling, bake logs, timers) and meal planning is a **Kitchen**; a name that says its building type gets that shape (a backup shed is a barn, not a windmill), and a loose keyword match borrows a theme's look but not its tagline.
- **Titles** compare case-, spacing- and Latin-accent-insensitively ('Café' = 'Cafe') with other scripts kept whole (`titleKey`). Level repair fills from any unused kit level (later ones first) and a level with no usable number keeps its place.

## Verification

```
node --test tests/watch.test.js tests/core.test.js tests/world.test.js tests/kit.test.js tests/architect.test.js
node tests/ui.mjs
node scripts/capture-kit.mjs
```
(absolute node path as in CONTRACT.md)
