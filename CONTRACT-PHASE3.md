# MILO Phase 3 build contract: the Hearth and the Wilds

Read `CONTRACT.md` and `CONTRACT-STEP2.md` first. Their ground rules, shapes, tone and Electron patterns still apply except where this file amends them. The design is `WORLD.md` (the fortress, the frontier, the endless world), `RIFTS.md` (§2 and §10) and `PLAN.md` (Phase 3). Step 1 and step 2 are committed and working: 222 unit tests (`npm test` list in `package.json`) and 25 Electron checks (`tests/ui.mjs`). Keep every one of them passing, changing a test only where Phase 3 deliberately changes behaviour, and say so in your final message.

## 1. What Chris asked for

> I want the camp to remain untouched, like a fortress that I can eventually upgrade to be the ultimate kingdom to fight off these rifts. There should be open world generation that follows a story but also allows Minecraft/Elden Ring-like exploration and fun. Can we also make the rifts procedurally generated? Like it feels like there can be an infinite number of them.

Then: "start phase 3". Phase 3 turns MILO from a vale into a world:

- **Useful.**
  - Real rifts open on the frontier from signals MILO already sees, each naming its real cause in plain words. They sit closer to the walls the more urgent they are, and they seal themselves when the real thing is done.
  - A rift list in the watchtower (every tier).
  - The War Table: a problems dashboard, from the Stockade.
  - The Gate Bell: one desktop note when a rift reaches the walls.
  - The first ward-post: one auto-ward rule, visible and reversible.
- **Game.**
  - Walk out of Hearthvale's four gates into the endless generated wilds, drawn at the vale's scale.
  - Lanterns to light, rest at and travel between.
  - Ruins, caves, chests, notes, hamlets, statues and landmarks.
  - Chop trees for birch and ash.
  - Wild rifts every day.
  - Step through any rift into its generated Elsewhere and mend it, with a ladder of deeper ones beneath.
  - Echoes of rifts inside the vale.
  - A map with fog of war.
  - Regions waiting in the Hush.
  - Raise the Stockade (tier 2).
  - The Prologue, "The Lantern Wakes".

**Promises (tested):**
- Hearthvale's handmade map is never generated, edited or recoloured, and no rift renders inside it.
- The same seed makes the same world.
- A real rift opens outside the ward, closer when more urgent, and seals when its signal clears.
- Chunk generation stays under budget (§10).
- The Stockade's requirements read from real counts.

## 2. Ground rules (all modules)

- Plain JavaScript ES modules, no build step, no new npm packages. Node isn't on PATH: use `C:\Users\chris\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe` (v24).
- **Only edit the files your module owns** (§9). If another module's API is missing or wrong, code against this contract exactly, stub it in your own tests if you must, and report the mismatch in your final message. Never "fix" another module's file.
- Run your own tests plus any existing test file that imports your module. Other agents are editing other files at the same time, so a failure in a file you don't own is theirs to fix; mention it, don't touch it.
- **Privacy is unchanged.** Nothing new leaves the PC, the renderer still has no network, and no new cloud call is made. Rift causes may quote a session title (the renderer already shows titles), but never snippets or transcript text.
- **Calm copy:** sentence case, contractions, no exclamation marks, no "please", no "successfully", no emoji, no alarm styling. Real causes come first, in plain words, before any flavour. Use `assertCalm` (tests/core.test.js) or an equivalent for new copy.
- Every renderer string built into HTML goes through `esc()`. Generated ids used in selectors go through `CSS.escape`.
- Everything that animates has a still version: with motion off (setting or OS reduced motion), draw a deterministic static frame (`t === null` in the engine) and finish walks and fades at once.
- **Pure logic lives in Node-importable modules with unit tests.** DOM and canvas code stays thin.

## 3. Coordinates, areas and the vale's edge

- **One tile grid.** A vale tile `(x, y)` is world tile `(x, y)`; the vale is `[0,64) × [0,44)` (`worldgen.HEART`). The wilds use every other integer tile, negative ones included. World pixels = tile × 16 (`TILE`). A chunk is 32×32 tiles (`worldgen.CHUNK`); chunk `(cx, cy)` covers tiles `[cx*32, cx*32+32)`. Its key is `'cx,cy'`.
- **Areas.** `'vale'` (inside the heart), `'wilds'` (anywhere else in the world) and `'elsewhere'` (inside a rift's pocket world, a separate scene).
- **The vale is untouched.** `src/world/map.js`, its tiles, objects, `isWalkable` and `findPath` stay as they are. Inside the heart, walkability is always `map.isWalkable` (never `worldgen.walkable`, which calls every heart tile walkable). The vale's ground is always its own baked canvas, drawn over any chunk ground beneath it.
- **The ring and the gates.** The ring is every tile at Chebyshev distance exactly 1 outside the heart (`x ∈ [-1,64], y ∈ [-1,44]`, not in the heart).
  - The four **gate tiles** are `GATES[id].edge + GATES[id].dir`: (32,−1), (−1,20), (64,14) and (11,44). Every other ring tile is a **wall** and is never walkable.
  - So Milo leaves and enters the vale only through the gates, and the vale's own edge row (with its gaps between border trees) stays a walkable edge inside.
  - At tier 1 a wall tile holds a **thicket**: dense bramble and bush, drawn on land ring tiles only, never over water. From tier 2 it holds the **Stockade palisade**, with a gatehouse at each gate.
  - Ring objects are generated by `wilds.ringObjects(tier)`, separate from chunk objects.
- **Roads start at the gate tiles** (worldgen already does this). The three tiles beyond each gate tile, and every road or bridge tile, never hold a blocking object.

## 4. Shared shapes

### 4.1 Content bundle
Main reads `content/*.json` once at startup and serves it over IPC. The page's CSP blocks `fetch` and JSON modules.

```js
content = { genres, riftgen, fortress, wilds, story }   // each the parsed JSON, or null if unreadable
```
Anything that needs content receives it as an argument; nothing imports JSON.

### 4.2 Snapshot additions (watch)
```js
snapshot.capacity = { codex: { usedPercent: number /* 0..100 */, resetsAt: number /* ms */, windowMinutes: number, at: number /* ms of the reading */ } | null }
AgentSession.waitingSince = number | null   // Claude live needs-you only: registry statusUpdatedAt (else lastActivityAt); null otherwise
```

### 4.3 Signal (core, `src/rifts.js`)
```js
{ key: string,            // stable id of the real thing: 'night:2026-09-27', 'knock:claude:<sessionId>', 'capacity:codex:<resetsAt>', 'built:<plotId>:<builtAt>', 'story:first-crack'
  kind: 'nocturne' | 'knocking' | 'capacity' | 'built' | 'story',
  signals: string[],      // genres.json signal ids: 'working-past-bell' | 'session-after-midnight' | 'needs-you-unanswered' | 'crew-capacity-high' | 'milestone-reached' | 'sync-error' (story)
  subject: string,        // ≤ 40 chars: 'last night', '“Letters to answer”', 'Codex', 'the Clip studio', 'the north gate'
  urgency: number,        // 0..1
  cause: string,          // the real cause in plain words, ≤ 160 chars
  stitch: string,         // how to mend it for real, ≤ 140 chars
  since: number,          // ms this episode began (a new episode = a new since)
  echo: { place: 'camp' | 'watchtower' | 'workbench' | <plotId>, icon: 'moon' | 'knocker' | 'spark' | 'star' | 'crack' },
  bright: boolean,
  held: null | <wardPostRuleId>,   // the ward-post rule that keeps it from opening (still listed, never placed)
  sessionId?: string }
```

### 4.4 Rift (what the engine draws and the UI lists)
```js
{ id: string,               // spec.id, 'rift:<base36>'
  key: string | null,       // Signal key for real and story rifts, null for wild
  kind: 'real' | 'story' | 'wild',
  realKind?: Signal.kind,
  spec,                     // the riftgen spec (name, genres, fusion, maelstrom, stage, tier, depth, affixes, strays, taleLead, loot, mood, subject, cause)
  x: number | null, y: number | null,   // tile; null when held
  beyond: number | null, towards: string | null,
  stage: 'hairline' | 'open' | 'gaping', urgency: number, bright: boolean,
  warded: null | { until: number, stage },  held: null | ruleId,  atWalls: boolean,
  cause: string, stitch: string, since: number, echo, subject, sessionId? }
```

### 4.5 Entity (engine → shell, for clicks, hover and the accessible list)
```js
{ kind: 'rift' | 'stray' | 'lantern' | 'poi' | 'tree' | 'gate' | 'echo' | 'war-table'
      | 'exit' | 'stitch' | 'tale-lead' | 'loot' | 'curio',     // the last five only in an Elsewhere
  id: string, x: number, y: number,   // tile (scene coordinates in an Elsewhere)
  label: string,                       // hover text, e.g. 'Sleeping lantern', 'Birch tree · chop'
  riftId?: string, poiType?: string, lit?: boolean, gate?: string, place?: string }
```
Ids:
- `lantern:x,y`
- `poi:<type>:x,y` for ruin, cave, chest, note, hamlet, statue, landmark, quay, ore, herbs and fishing
- `tree:x,y`
- `gate:n|w|e|sw`
- `echo:<riftId>`
- `war-table`
- `stray:<riftId>:<n>`
- in an Elsewhere, `exit`, `stitch`, `tale-lead`, `loot:<n>` and `curio`

Worldgen POIs have no ids; wilds.js assigns these.

### 4.6 State additions (`src/model.js`, all normalised, all new keys after `plots`)
```js
firstSeenAt: number | null,        // earliest evidence if missing: skills[*].provenAt, plots[*].builtAt, lastSeenAt, lastGreetedDay (local midnight)
tally: { daysSeen: 0, lastDay: 'YYYY-MM-DD' | null, sessionsFinished: 0, finishedIds: string[] /* ≤ 400, newest kept */, buildingsDesigned: 0 },
settings: { ...existing, eveningBell: 'HH:MM' | null /* default '22:00' */, gateBell: true, wardPost: null | 'nights-off' | 'patient-knock' | 'capacity-95' },
hearth: { tier: 1 /* 1..8 */, raisedAt: { [tierId]: ms } },
satchel: { materials: { birch: 0, ash: 0, pine: 0 }, essences: { [name]: count }, relics: [{ name, text, genre, at }] /* ≤ 200 */ },
wilds: {
  seed: 'hushlands',               // ≤ 64 chars; the default world, rerolling is an open question
  at: { x, y } | null,             // last tile Milo stood on outside the vale (signed ints, |v| ≤ 1e6)
  wake: string | null,             // lantern id he last rested at
  explored: string[],              // chunk keys, deduped, ≤ 20000 (oldest dropped)
  lanterns: { [lanternId]: litAt },
  opened: { [poiId]: at },         // chests opened, ruins searched (forever)
  notes: { [poiId]: at },          // notes read
  glimmers: { [poiId]: at },       // statues heard
  felled: { [treeId]: dayNumber }  // stumps, dropped when their day has passed
},
rifts: {
  open: { [key]: { id, since, openedAt, kind } },    // real and story rifts open now (to notice seals)
  warded: { [key]: { since, until, stage } },
  letGo: { [key]: { since, at } },
  belled: { [key]: { since, at } },
  closedWild: { [riftId]: dayNumber },              // wild rifts stitched or let go today
  visited: { [riftId]: at },                        // loot claimed from a bright or Elsewhere visit (≤ 300)
  stitched: { real: 0, wild: 0, story: 0 }, deepest: 0,
  history: [{ key, id, name, genres, kind, openedAt, closedAt, how: 'sealed' | 'stitched' | 'let-go' }]  // ≤ 100, newest first
},
story: { prologue: { done: { [stepId]: at } }, letterReadAt: null | ms, trackerHidden: false }
```
- `milo.tile` stays vale-only. A position in the wilds is saved to `wilds.at`, never to `milo.tile`.
- Launch always begins in the vale. If the saved `milo.tile` isn't walkable in the vale, Milo goes home.
- `normalizeState` keeps every new key well-formed, is idempotent, is prototype-safe, and never throws.

## 5. Real rifts (src/rifts.js, used by the shell)

Real rifts come from signals MILO already sees. All times are from the injected clock (`now`), with local wall-clock hours.

| Kind | Opens when | Urgency | Key and since | Seals when | Cause (example) | Stitch | Echo |
|---|---|---|---|---|---|---|---|
| **Nocturne** | The night window runs from the evening bell (default 22:00; `null` turns it off) to 06:00. It opens when, inside the window, a crew session is `working`, or its `lastActivityAt` is within the last 20 min | `0.3 + 0.15 × hours past the bell (+0.15 after midnight)`, capped at 0.95 | `night:<dayKey of the evening>`; since = first late activity | The crew has been quiet for 45 min, or it's 06:00 | "Claude was still working at 00:40, past your evening bell (22:00)." | "Go to bed. The rift closes once the crew has been quiet for 45 minutes, or at dawn." | camp · moon |
| **Knocking** (Gothic) | A session is `needs-you`, not archived, and `now − (waitingSince ?? lastActivityAt)` ≥ 24 h (48 h under the *patient-knock* ward-post) | `0.35 + (h − 24) / 48 × 0.55`, capped at 0.95 | `knock:<session.id>`; since = waitingSince | It stops needing you, or goes | "“Letters to answer” has waited on you for 26 hours." | "Answer Claude in that session." | watchtower · knocker |
| **Capacity** (Neon) | `capacity.codex.usedPercent` ≥ 85 (95 under *capacity-95*) and `resetsAt > now` | `0.4 + (used − 85) / 15 × 0.55`, capped at 0.95 | `capacity:codex:<resetsAt>`; since = reading `at` | It drops below the line, or `resetsAt` passes | "Codex has used 91% of its weekly allowance. It refills on Thursday at 14:20." | "Give Codex a rest, or wait for the refill." | workbench · spark |
| **Built** (Starlight, bright) | A plot was built in the last 72 h | 0.3 | `built:<plotId>:<builtAt>`; since = builtAt | 72 h after builtAt | "The Clip studio was built on Friday." | "Nothing to mend. Visit before it fades." | the plot · star |
| **Story** | Prologue step `first-crack` is current and not done | 0.2, hairline | `story:first-crack` | It's stitched in its Elsewhere | "Something from another story is pressing on the page, just past the north gate." | "Step through and mend it." | camp · crack |

**Rules:**
- Signals are only derived when the snapshot is present and at least one source is `ok`. Otherwise the current rifts stay as they are, so a watcher hiccup never seals everything.
- **Spec.** `riftgen.realRift({ key, subject, signals, urgency, tier: 1, cause })`. The same key and signals always give the same rift.
- **Placement.** `worldgen.placeRealRift(spec, { urgency, wardRadius })`, then nudged to the nearest tile within 6 that `isFree(x, y)` accepts. The shell passes the engine's `world.isWalkable`, which rules out objects. A Titan would stay at sea (no Titan signal in Phase 3).
  - Bright rifts use urgency 0.3.
  - The story rift uses `gate:n` with `beyond = ward + 4`, i.e. the first free tile going north from (32, −1 − ward − 4).
  - A rift is **never** inside the ward (`heartDistance > wardRadius`) and never in the heart; test this.
- **At the walls.** `atWalls = !bright && kind !== 'story' && urgency ≥ 0.9`.
- **Ward (yours).** It lasts 3 days (`until`). While it holds, the stage stays at the stage it had when warded, and the rift never counts as at the walls. After `until`, or once `since` changes, the ward no longer applies.
- **Ward-post (tier ≥ 2, one rule in `settings.wardPost`).** It holds matching signals before they open:
  - `nights-off`: Nocturne on Friday and Saturday nights (by the evening's day);
  - `patient-knock`: the Knocking waits 48 h;
  - `capacity-95`: capacity opens at 95%.

  Held rifts are listed with `held` and are never placed, drawn, belled or counted as open.
- **Let go.** The rift disappears until its `since` changes (a new episode). Bright rifts can't be let go; use "Let it be", which also hides it. The story rift can't be let go.
- **Seals.**
  - A key in `state.rifts.open` whose signal is gone, and which wasn't let go, has **sealed**. It goes into `history` as `how: 'sealed'`, `stitched.real` (or `.story`) goes up by one, and its `spec.loot` goes to the satchel. A bright rift fading goes to history as `sealed`, with no loot.
  - Seals noticed at boot (the app was closed) are summarised in one quiet bubble at most.
- **Bell.** A rift that becomes `atWalls` with a `since` not yet in `belled` rings once:
  - At tier ≥ 2 with `settings.gateBell` on: a bubble plus `bridge.notify`. Main already skips the note while MILO is focused.
  - At tier 1 there's no bell yet: a bubble only.

  Either way it's marked belled.

**API:**
```js
export const RIFT_RULES = { nightEndsHour: 6, nightRecentMin: 20, nightQuietMin: 45, knockHours: 24, patientKnockHours: 48, capacityPercent: 85, capacityHighPercent: 95, brightHours: 72, wardDays: 3, wallsUrgency: 0.9 }
export const WARD_POST_RULES   // [{ id, name, text }] for 'nights-off', 'patient-knock', 'capacity-95'
export function dayNumber(ms)  // local calendar day as an int (DST-safe), also used for wild rifts and felled trees
export function deriveSignals({ snapshot, state, now, story })   // → Signal[] (held ones included, marked)
export function buildRealRifts({ signals, state, now, riftgen, worldgen, wardRadius, isFree })   // → Rift[] (urgent first; let-go ones omitted; held ones with x/y null)
export function reconcileRifts(state, rifts, now, { tier })   // → { state, opened: Rift[], sealed: [{ key, id, name, genres, kind, loot }], bell: Rift[] }
export function wardRift(state, rift, now), unwardRift(state, key), letGoRift(state, rift, now)   // → new state
export function wildRiftsForChunk({ worldgen, riftgen, cx, cy, day, wardRadius, closed, isFree })   // → Rift[] (kind 'wild'; closed: Set or object of rift ids closed today)
export function claimLoot(state, spec, now, { riftId })   // → new state (materials, essences, relic), once per riftId via rifts.visited
export function stitchWild(state, rift, now), letGoWild(state, rift, now)   // → new state (closedWild, stitched.wild, deepest, loot)
```

## 6. The Hearth (src/hearth.js) and the Prologue (src/story.js)

**`hearthStatus(state, fortress)`** returns:
```js
{ tier, def, wardRadius,
  next: null | { id, name, look,
    requirements: [{ kind, count, have, met, text, future }],
    materials: [{ id, need, have, met }],
    construction, ready, defences, unlocks } }
```

- **Requirement kinds MILO can count in Phase 3** (all real):
  - `crew-sessions-finished` → `tally.sessionsFinished`
  - `buildings-designed` → `tally.buildingsDesigned`
  - `days-with-milo` → `tally.daysSeen`
- **Every other kind** has `have: 0`, `met: false` and `future: true`, with a note such as "arrives with the Notice Board". Construction is not enforced before Phase 4, and is shown only as information.
- **`raiseHearth(state, fortress, now)`** → `{ ok, state, reason }`. It spends the materials, sets `hearth.tier` and `raisedAt`, and only works when `ready`.
- **`wardRadius(state, fortress)`** returns the current tier's radius.

**Counting, all in `model.js`:**
- `markSeen` increases `daysSeen` on each new local day. It builds a new `tally` object rather than mutating in place.
- `tallyFinished(state, sessions, now)` adds distinct session ids that have a completion after `firstSeenAt` (and at or before `now`). With `firstSeenAt` null, it counts nothing earlier than `now`.
- `finishDesign` increases `buildingsDesigned` on a first design, not on a redesign.
- Migration seeds `daysSeen` from the distinct days in the evidence, and seeds `buildingsDesigned` from built plots or `skills.tinkering`.

**The Prologue** (`content/story.json`, evaluated by `prologueStatus(state, story, { hasSessions })` → `{ steps: [{ id, title, text, hint, done, current }], current, complete }`, and `markStory(state, stepId, now)`). Steps complete in order. A step whose condition is already true completes on sight, so Chris isn't made to redo what he's done.

| Step | Title | Done when |
|---|---|---|
| `light` | A Light on the Hook | MILO has greeted once (`lastSeenAt`) |
| `crew` | Three Stumps and a Bench | Any session has been seen |
| `ground` | Ground That's Waiting | `tally.buildingsDesigned ≥ 1` |
| `letter` | A Letter by Paper Bird | Oriel's letter has been read (`story.letterReadAt`) |
| `first-crack` | A Crack Past the Gate | The story rift was stitched |
| `lantern` | A Light in the Wilds | Any lantern is lit |
| `stockade` | Walls of Birch and Ash | Tier ≥ 2 |

## 7. The world in the engine

### 7.1 Chunks, ground and objects (`src/world/wilds.js`, `src/world/nav.js`)

**Ground.** A chunk's ground is a `Uint8Array` of palette **key codes**, 512×512 (one per art pixel, 0 = clear). It is painted at the vale's 1:1 pixel scale, never by doubling 8-px art. It matches the vale's own painter, so the seam at the heart's edge disappears:
- grass uses `g`/`j` smooth noise with `G` lips;
- path and sand use `p` with `P` edges;
- water uses `w`/`W`/`f` by distance to shore;
- decals: flowers, tufts, clover and pebbles.

It adds ground for:
- meadow, with more flowers;
- snow (`c`, `C`, `f`);
- basalt (`z`, `S` and an `o` crack pattern, with a rare ember);
- marsh (`j`/`q` with `w` pools);
- moor (`S`/`G` heather patches with `V`);
- the painted hills (`h` with madder, woad and weld stripes in `k`, `e`, `u` and `v`);
- rocky ground (`S`, `s`, `z`);
- downs (`j`, `g`);
- bridges (plank rows `b`/`B`/`n`, running across a river or inlet);
- sky isles (grass on top, a rock underside of `S`/`z`, over deep water).

Heart pixels stay 0. It is deterministic from the seed.

**Objects.** Each object is a vale-shaped object `{ id, kind, x, y, w, h, blocks, dx, dy, place?, frame? }` that goes through `placeObject`.

| Where | Objects (and density) |
|---|---|
| Forest | `tree` (sometimes `tree.blossom`), about 45% |
| Birchwood | `tree.birch` |
| Pine | `pine`, about 50%; `pine.snow` on snow |
| Meadow and grass | Sparse `bush`, `rock` and decals |
| Rock | `rock` |
| Mountain | `crag` (blocking, also covering the next tile); `crag.snow` on snow |
| Basalt | `basalt.column`, `rock.basalt` |
| Marsh | `reeds` |
| Downs | `dice.stone` |
| POIs | `lantern.post`, `ruin`, `cave`, `chest`, `note`, `hamlet`, `statue`, `landmark.stone`, `ore.node`, `herbs`, `fishing.spot`, and the quay (dock and boat) |

Placement rules:
- Port map.js's spacing rules: canopies stay off roads, no two trees within a tile, and jitter of dx ±4 and dy ±2.
- Never place an object on a road or bridge, on the ring, on the three tiles beyond a gate, or on or right next to a POI tile.

**Blocking.** Trees, pines, rocks, crags, columns, dice stones, hamlets, ruins and statues block. Decals, reeds, notes and fishing spots don't. A POI's own tile never blocks, so Milo can stand at it.

**Felled trees.** A tree in `felled` for today is drawn as a `stump`, and it still blocks.

**Hush.** Tiles inside a story region (`regionDistance < 1`, with a dithered edge from 0.85) are drawn with the **hush palette**: base colours pulled 55% toward their grey and lifted 6%. All eleven regions wait in the Hush in Phase 3. Rift bleeds override the hush.

**API** (pure, Node-importable; canvas creation is the engine's job):
```js
// src/world/wilds.js
export function createWilds({ worldgen, maxChunks = 64 })
// → { chunk(cx, cy): ChunkData                     // terrain + objects + pois, sync and cached (≤ 20 ms)
//     ground(cx, cy, { from = 0, to = 512 } = {})  // paints key rows [from, to) into chunk.ground; returns true when complete (for idle slicing)
//     objectsIn(x0, y0, x1, y1)                    // objects whose tile is in the rect, from cached chunks only
//     blocked(x, y)                                // a blocking object on this wild tile (generates the chunk if needed)
//     ringObjects(tier)                            // thicket or palisade pieces with autotile masks, gatehouses, the war table (tier ≥ 2)
//     poiAt(x, y), entitiesIn(rect), drop(cx, cy), keysAround(tile, radiusChunks) }
// ChunkData = { cx, cy, key, tiles: Uint8Array(1024), objects, pois: [{ id, type, x, y, name, depth, mimic? }], hush: Uint8Array(1024) /* 0..255 */, ground: Uint8Array(512*512) | null, groundRows: number }
export function ringKind(x, y)          // 'gate' | 'wall' | null
export function hushPalette(base)       // key → [r,g,b]
export function colouriseChunk(keys, { base, hush, hushMask, bleeds, originX, originY })   // → Uint8ClampedArray RGBA; bleeds as wildsart.colourise (chunk-local px); dithered 2×2 blocks indexed by world px
```
```js
// src/world/nav.js
export function createNav({ valeWalkable = map.isWalkable, valeCost, worldgen, wildBlocked, extraBlocked = () => false })
// → { walkable(x, y), cost(x, y), findPath(from, to, { maxNodes = 40000, margin = 40 }) → tiles after from ([] when unreachable; nearest walkable goal within 3 like map.findPath),
//     nearestWalkable(tile, radius) }
// Vale tiles: map rules and costs. Wild tiles: TERRAIN_INFO walk/cost and no blocking object. Ring walls: never. Gates: always.
```

### 7.2 Rift drawing (`src/world/riftfx.js`)

- **Tear.** Three sizes by stage. Hairline is about 5×13, a hint only, with no strays. Open is about 9×21 (the `scripts/rift-preview.mjs` tear), and strays wander. Gaping is about 13×29, and the Tale-lead also stands beside it.
  - The tear is coloured from the genre's `rift.rim`, `rift.inner` and ink, and it shimmers slowly.
  - A warded rift shows a binding stitch across it. A held rift is never drawn.
- **Bleed.** A radius per stage, in tiles: hairline 3, open 5, gaping 7, with an inner radius of 1.6. It recolours the chunk ground through `colouriseChunk`, and objects whose feet fall inside it through a per-genre sprite atlas: the inner area always, the fringe by the same 2×2 dither. Overlapping bleeds interleave (a fusion). It **never** touches a heart pixel or a vale object. Milo inside a bleed wears the genre too ("outfits for free").
- **Weather.** The genre's particles, drawn only inside the bleed and only while motion is on.
- **Strays.** Up to 2 visible per stray kind, 5 per rift at most. Each is composed by straygen, drawn in its genre's palette (layer 1 in the second genre's), and wanders slowly between walkable tiles inside the inner bleed. With motion off, each stands at a fixed tile.
- **Animations.** A seal plays about 1.2 s: a thread runs through the tear and it closes, with a few sparks. A let-go plays about 2 s: the tear becomes a pale moth that flies west and fades. Both are instant with motion off.

```js
export function tearArt(stage, genre /* genres.json entry */, frame)   // → { rows, colours: { key: [r,g,b] } }
export function spriteTable(genre)                                    // RGBA table for sprites.rowsToImageData / buildAtlas
export function bleedsFor(rift, { tileSize = 16, originX = 0, originY = 0, genres })   // → bleed specs for colouriseChunk (palette by code)
export function strayActors(rift, { walkable, seed })   // → [{ id, name, temperament, genre, second, sprite, home, positionAt(tMs) → { x, y (px), dir, moving } }]
export const RIFT_RADIUS = { hairline: 3, open: 5, gaping: 7 }
```

### 7.3 Elsewhere (`src/world/elsewhere.js`)

```js
export function buildElsewhere(spec, layout, { genres })   // layout = riftgen.layout(spec)
// → { w, h, cellAt(x, y) → 'wall' | 'floor' | 'water' | 'foliage' | 'void', walkable(x, y), ground: Uint8Array (w*16 × h*16 key codes), palettes: [genreId...],
//     objects: [{ id, kind: 'exit' | 'stitch' | 'tale-lead' | 'loot' | 'curio' | 'foliage', x, y, ... }], strays: stray actor specs, spawn: { x, y } }
```

**Scene.**
- Walls are 3/4-view stone blocks: a lighter top face, a front face where the tile below is floor, and ink outlines.
- Floors are the genre's ground keys with a subtle tile pattern.
- Water uses `w`/`W`.
- Foliage `"` uses reeds and bushes.
- Everything is recoloured by the genre palette, and by 2×2-interleaved palettes in a fusion.

**Objects.**
- The exit at `E` is `exit.door`, a torn doorway home in cream and honey.
- The stitch point at `S` is the tear itself.
- The Tale-lead at `B` is a stray composed from the lead's genre with every one of its parts, drawn at 2×.
- Loot at `L` uses `chest`.
- The curio at `P` uses `curio`.

**Rules.**
- For a real rift the seam won't take the thread: stitching is refused with its `stitch` text.
- For wild and story rifts, walking to `S` and choosing Stitch seals it.
- After a wild stitch, "Go deeper" opens `riftgen.deeper(spec)` as a new Elsewhere (the ladder), or Milo leaves.
- Loot chests are claimed once per rift.

### 7.4 Engine API additions (`src/world/engine.js`)

`createWorld(canvas, opts)` keeps every existing option and method. **With `opts.content == null` it behaves exactly as today**, vale only, and its existing tests stay unchanged.

New options:
```js
content = null,                 // content bundle; enables the wilds
seed = 'hushlands',
onEntityClick = (entity) => {}, // fires on arrival (Milo within 1 tile of the entity's approach tile), like onPlaceClick
onAreaChange = (info) => {},    // { area, regionId, regionName, tier, depth, hush: bool, chunk: 'cx,cy', rift?: { id, name } }
onExplore = (keys) => {},       // chunk keys newly seen (any chunk intersecting the view)
```

New methods:
```js
setWildState({ day, tier, wardRadius, closed /* wild rift ids closed today */, lit /* lantern ids */, opened /* poi ids */, felled /* tree ids */ })
setRifts(rifts)                 // real + story Rift[] (held ones ignored); animates moves (≤ 2 s) and plays seal / let-go when one leaves with { how }
closeRift(id, how)              // 'sealed' | 'stitched' | 'let-go': play the animation now
setEchoes([{ id, riftId, place, icon, genre, label }])
isWalkable(x, y)                // nav.walkable (scene-aware)
walkToEntity(idOrEntity) → Promise<boolean>   // approach and arrive (fires onEntityClick too)
travelTo(target /* lantern id | 'home' | {x,y} */) → Promise   // calm fade out and in (instant with motion off); ensures chunks first
chop(treeId) → Promise<{ ok, kind /* 'birch' | 'ash' | 'pine' */ }>   // Milo faces the tree and chops (about 2.5 s, milo.chop frames); the shell adds the logs and marks it felled
floatText(text, tile)           // a small drifting '+5 birch'
enterElsewhere(rift) → Promise, leaveElsewhere() → Promise, elsewhere() → null | { riftId, depth, name }
nearbyEntities() → Entity[]     // in view, nearest first (for the accessible list)
area() → onAreaChange info
raiseReveal(tier)               // the palisade rises with a calm dissolve (instant with motion off)
paintMapChunk(cx, cy, pxPerTile) → canvas | null   // for the map view: wildsart art in base colours (hush applied)
```
`miloTile()` may return wild coordinates. `renderMap` stays vale-only. `walkTo(placeId)` while Milo is in the wilds resolves `false` without moving.

**Camera.** With content on, it follows Milo everywhere with no clamp (the vale sits inside the world). In an Elsewhere it clamps to the scene. Vale-only mode is unchanged.

**Streaming.**
- `roads()` is prewarmed in idle time at start.
- Chunks within one chunk of the view are prepared in `requestIdleCallback` slices (at most 12 ms each), never inside `tick`, and never while the document is hidden.
- A visible chunk that isn't ready is painted synchronously once.
- Chunk canvases are built from `colouriseChunk` and rebuilt when the bleeds or hush that touch them change.
- At most 25 chunk canvases are kept.
- Per frame, only objects in chunks that intersect the view are iterated.

**Hit testing.**
- Order: crew, perches, entities (rifts and strays first), then places.
- Hover labels come from the entity.
- The Enter key fires the entity whose approach tile Milo stands on.

**Dynamic props.**
- Ring objects come from `wilds.ringObjects(tier)`.
- Echoes float over their place: camp by the tent, the watchtower at its door, the workbench on the bench, and a plot at its signpost.
- Lit lanterns glow like the vale's lanterns.
- The war table stands by the north gatehouse at tier ≥ 2, outside the vale.

## 8. The shell

- **Boot.** Load the content with `bridge.content()` and the clock offset with `bridge.clock()` (test-only `MILO_NOW`, else 0). The shell's `now()` is `Date.now() + offset`. Then call `createWorld(..., { content, seed: state.wilds.seed, ... })`. If content is null, the vale-only world runs and Phase 3 UI hides itself.
- **Rift loop.** Runs on every snapshot, every 30 s (even hidden, since it doesn't draw), and on the state changes that matter:
  - `deriveSignals` → `buildRealRifts` → `reconcileRifts`;
  - then `world.setRifts`, `world.setEchoes`, sealed bubbles, bells, and `scheduleSave`.
  - Wild state (day, tier, closed, lit, opened, felled) goes to `world.setWildState` at boot, on day change and on every relevant state change.
- **Bubbles** (existing queue): kinds `bell`, `rift`, `sealed`, `hearth`, `story`, `loot`. Bright rifts never bubble. At most one boot summary of seals.
- **Area.**
  - `#stage[data-area]` and `[data-region]`, and the title bar status reads, for example, "The Whisperwood · waiting in the Hush". In an Elsewhere: "Inside The Crowded Grinding Crypt · depth 4".
  - The canvas `aria-label` follows the area.
  - An Elsewhere shows a slim `px` banner along the top with the rift's name, its genres and a **Leave** button.
- **Place list.**
  - In the vale it keeps its places, adds **The Hearth**, and adds **War Table** at tier ≥ 2.
  - In the wilds it lists nearby entities (`world.nearbyEntities()`) and **Travel home**.
  - **Map** (key `M` when focus isn't in a text field, and a titlebar button) opens the map view.
- **Panels** (the existing panel system; ids pass `cleanId`):
  - **`rift:<id>`**, for any rift or its echo:
    - the tear and strays drawn, the name, genre chips and stage;
    - **Why** (the cause) and **To mend it** (stitch);
    - affixes, the Tale-lead (name, mechanic, line) and loot;
    - actions: **Step through** (walk there first if needed), **Ward for 3 days** or **Take the ward down** (real only), and **Let go** (confirm; not for bright or story). A bright rift has **Visit** and **Let it be**.
    - A rift seen from the vale via its echo gets **Show me** (opens the map at it) instead of walking.
  - **Watchtower**: a **Rifts** section at every tier, listing real and story rifts with cause and stage, plus Ward and Let go.
  - **`war-table`** (tier ≥ 2):
    - the frontier mini map (wilds art around the vale, the ward rings and the rifts);
    - groups: *At the walls*, *On the frontier*, *Bright*, *Held by the ward-post*, *Warded*, *Recently closed*;
    - each row shows the name, genres, cause, "10 tiles out, toward Cinderforge" and actions;
    - **Defences**: the Gate Bell switch, the ward-post rule (none or one of three) and the evening bell time (Off, or 20:00 to 01:00 in half hours).
  - **`hearth`**: the current tier and its look; the next tier's requirements with CHECK/LOCK and have/need, its materials with have/need, and its defences with their real text; **Raise the Stockade** when ready (then `world.raiseReveal(2)`, a bubble, and the War Table appears). It also shows the satchel.
  - **`lantern:<id>`**: **Light it** (sleeping), **Rest here** (sets `wilds.wake`), and **Travel** to any lit lantern or home.
  - **`poi:<...>`**: examine text from content plus its one action:
    - Chest: **Open** (materials, sometimes a friendly mimic).
    - Ruin: **Search** (materials, sometimes a map tablet that reveals a 3×3 chunk area).
    - Note: **Read** (collected).
    - Statue: **Listen** (a Glimmer).
    - Cave: a note that caves open with the Adventurer's Kit.
    - Hamlet: a greeting.
    - Ore, herbs, fishing: "comes with the Notice Board".
    - Quay: the ferry waits for Act VI.
    - Landmark: the region's arrival text and "waiting in the Hush".
  - **`story`**: the Prologue steps.
- **Story tracker.** A small `px` card under the crew strip shows the current Prologue step and a hint. It's collapsible, hidden when complete, and the letter step offers **Read**.
- **Trees.** Click a wild tree to walk there and chop (`world.chop`). Then add the logs (birch trees 4–7 birch, forest trees 3–5 ash, pines 2–4 pine), mark the tree `felled` for today, and call `floatText`.
- **Gate Bell and settings.** Both follow §5, and the settings persist in `state.settings`.
- **Main and preload.**
  - `milo:content` and `milo:clock` over trusted IPC.
  - The watcher is created with the test clock.
  - `snapshotKey` includes `capacity`, and `emptySnapshot` has `capacity: { codex: null }`.
  - The fallback models match the new state shape.
  - Preload exposes `content()` and `clock()`, and the test's bridge key list is updated.
- **The map view** (`src/ui/mapview.js`) is wired with `world.paintMapChunk`, `renderMap(1)` for the vale, explored chunks, markers (Milo, lit and seen lanterns, real rifts, wild rifts in explored chunks, and region names once their landmark chunk is explored) and travel.

## 9. Modules and ownership

| Id | Module | Owns |
|---|---|---|
| A | Watch | `src/watch/*.js`, `tests/watch.test.js`, `tests/fixtures/**` |
| B | Core | `src/model.js`, `src/rifts.js`, `src/hearth.js`, `src/story.js`, `tests/core.test.js`, `tests/rifts.test.js` |
| C | Content | `content/wilds.json`, `content/story.json`, `content/fortress.json`, `tests/content.test.js` |
| D | Art | `src/world/sprites.js`, `tests/art.test.js`, `scripts/capture-sprites.mjs` |
| E | Wilds and nav | `src/world/wilds.js`, `src/world/nav.js`, `tests/wilds.test.js`, `scripts/capture-chunks.mjs` |
| F | Rift FX and Elsewhere | `src/world/riftfx.js`, `src/world/elsewhere.js`, `tests/elsewhere.test.js`, `scripts/capture-elsewhere.mjs` |
| G | Engine | `src/world/engine.js`, `tests/world.test.js`, `scripts/world-preview.html`, `scripts/world-preview-main.cjs`, `scripts/capture-wilds.mjs` |
| H | Shell | `src/app.js`, `src/styles.css`, `index.html`, `electron/main.cjs`, `electron/preload.cjs`, `tests/ui.mjs`, `package.json`, `README.md` |
| I | Map view | `src/ui/mapview.js`, `src/ui/mapview.css`, `tests/mapview.test.js` |

**Order.** A to F build first, in parallel. G, H and I build on them. Then integration, a visual review, and a hard review.

**Specifics:**

- **A. Watch.**
  - Parse `token_count` `payload.rate_limits` for `limit_id === 'codex'` (or a missing id), keeping the window with the highest `used_percent`. Use the newest non-null reading across files: `resets_at` is in seconds, so convert it to ms.
  - Check the bytes with `subarray(start, end).includes('"rate_limits":{')` before any `JSON.parse`, so the large-file test stays fast.
  - Add `waitingSince`.
  - Give the fixture generator a real-shaped reading, without adding rollout files, because the tests count them.
  - Update the watch tests.

- **B. Core.** Everything in §4.6, §5 and §6, with tests covering the full signal table:
  - bell edges (22:00, midnight, 06:00) and the ward-post rules;
  - never placed inside the ward (property test over many seeds, tiers and urgencies);
  - seals, let go and wards, and loot;
  - tally migration;
  - idempotent normalization;
  - prologue auto-completion.

- **C. Content.**
  - `content/wilds.json`:
    - examine lines for every POI type, lantern (sleeping and lit), thicket, palisade, gate, crag, the Westwatch (day and night) and the quay;
    - at least 24 **notes from the Old Company** (from Tamsin, Oriel, Brannoch, Pell and Milo; some regional; warm, specific, short);
    - a statue per region (what's missing, and a Glimmer);
    - a region arrival line and a Hush line per region;
    - hamlet greetings;
    - stray lines by temperament;
    - chest and ruin loot tables and mimic lines;
    - chopping lines;
    - the letter from Oriel.
  - `content/story.json`: the Prologue per §6, and Oriel's letter.
  - `content/fortress.json`:
    - Stockade materials become birch 80 and ash 30;
    - the ward-post defence text matches §5;
    - a `constructionFrom: 'Phase 4'` note.
  - Validate everything in `tests/content.test.js`: calm copy, and every reference resolves.

- **D. Art.** Add the sprites named in §7 in the vale's style, at its level of polish:
  - `tree.birch` and `pine.snow` (2 sway frames each)
  - `crag` and `crag.snow` (about 32×28)
  - `basalt.column` and `rock.basalt`
  - `dice.stone`
  - `lantern.post` (frames: sleeping, lit)
  - `ruin` (about 32×22)
  - `cave` (about 32×20)
  - `chest` (closed, open) and `chest.mimic` (closed, awake)
  - `note`
  - `hamlet` (a small cottage, about 40×36)
  - `statue` (unfinished Tamsin on a plinth)
  - `landmark.stone`
  - `ore.node`, `herbs` and `fishing.spot`
  - `thicket` (2 variants)
  - `palisade.post`, `.n`, `.s`, `.e` and `.w` (autotiled like fences)
  - `gatehouse` (spans a gate tile)
  - `gate.bell`
  - `war.table`
  - `banner`
  - `bridge.h`
  - `exit.door` and `curio`
  - `echo.moon`, `echo.knocker`, `echo.spark`, `echo.star` and `echo.crack`
  - `milo.chop.down`, `.up`, `.left` and `.right` (2 frames each)

  Also:
  - `rowsToImageData(rows, makeImageData, table = RGBA)` and `buildAtlas(createCanvas, { table } = {})`, so genre atlases can be built.
  - No new palette keys.
  - `scripts/capture-sprites.mjs` renders a sheet at 4× (`test-results/sprites-phase3.png`). Look at it and iterate until the new art sits beside the vale's trees and camp without looking out of place.

- **E. Wilds and nav.** §3 and §7.1:
  - `scripts/capture-chunks.mjs` renders chunk ground and objects as PNGs (Node plus the Electron preview, like `rift-preview.mjs`); look at them.
  - Tests:
    - determinism;
    - ring walls and gates;
    - no objects on roads, gates or POIs;
    - every fixed POI and every road tile reachable by `findPath` from home, in hops of up to 60 tiles;
    - valid keys;
    - budgets (§10).

- **F. Rift FX and Elsewhere.** §7.2 and §7.3. Tests:
  - every tear stage and genre renders with valid colours;
  - bleeds never touch the heart;
  - strays stay on walkable tiles inside the inner bleed;
  - every Elsewhere spawn reaches the stitch, the exit, the loot and the curio (across 500 specs, including mirrored and labyrinthine).

- **G. Engine.** §7.4:
  - vale-only mode is unchanged;
  - `tests/world.test.js` adds wilds cases with the fake DOM (walk out of each gate, no crossing the ring elsewhere, no rift sprite drawn in the heart, travel, chop, an Elsewhere entered and left);
  - `world-preview.html` accepts injected content (`window.__content` set by an init script) and query params for a start tile, a tier, test rifts and an Elsewhere;
  - `scripts/capture-wilds.mjs` saves these scenes:
    - the north gate at tier 1 and at tier 2;
    - deep in the Whisperwood (the Hush);
    - Cinderforge;
    - a neon rift, open with strays;
    - a gaping fusion rift;
    - an echo in the vale;
    - three Elsewheres (one of them a fusion);
    - chopping.

  Look at every one and iterate until they're beautiful.
- **H. Shell.** §8, plus `tests/ui.mjs` additions:
  - walk out of the north gate and back;
  - real rifts from fixtures: a Codex rollout with a 91% reading written into the temp home; a Knocking session registered to a sleeper process whose `statusUpdatedAt` is 25 h ago; Nocturne through a relaunch with `MILO_NOW` set past the bell;
  - the watchtower rift list names the causes;
  - no rift coordinate inside the ward or the vale;
  - ward it (saved);
  - the Gate Bell rings once (with the tier seeded to 2 in the saved state for that relaunch);
  - seal when the signal clears;
  - light a lantern, and it's still lit after a restart;
  - enter and leave an Elsewhere;
  - the Hearth panel shows real counts;
  - 1000×700 layouts for the new panels and the map;
  - nothing leaves localhost.

  Update the existing checks only where Phase 3 changes them (the bridge key list, the place list).
- **I. Map view.**
  ```js
  export function createMapView(root, { paintChunk, valeImage, explored, markers, onTravel, onClose, now }) → { open({ center }), close(), isOpen(), refresh() }
  ```
  - Explored chunks are painted lazily at 4 px per tile and cached, and fog of war covers the rest with a dithered edge.
  - Zoom 2, 4 or 8 px per tile. Pan by drag and by the arrow keys, plus a **Centre on Milo** control.
  - A list of travel destinations as buttons (accessible).
  - Esc or M closes it.
  - It fits 1000×700.
  - Pure parts are tested in Node.

## 10. Performance budgets (tested where possible)

- `wilds.chunk()` ≤ 20 ms. A ground slice ≤ 12 ms (paint in 64-row slices). `colouriseChunk` on one chunk ≤ 25 ms, sliced if needed. `roads()` once, off the first frame.
- A frame in the wilds at 1280×820 with 3 rifts in view is drawn in ≤ 12 ms (measured in the preview).
- Nothing generates while the window is hidden. The rift loop does no drawing.
- State stays well under the 2 MiB cap. Keep the explored list at most 20000 keys and history at most 100, and prune `felled`, `closedWild` and `visited`.

## 11. Verification

```
node --test tests/watch.test.js tests/core.test.js tests/world.test.js tests/kit.test.js tests/architect.test.js tests/genres.test.js tests/riftgen.test.js tests/worldgen.test.js tests/rifts.test.js tests/content.test.js tests/art.test.js tests/wilds.test.js tests/elsewhere.test.js tests/mapview.test.js
node tests/ui.mjs
node scripts/capture-sprites.mjs
node scripts/capture-chunks.mjs
node scripts/capture-wilds.mjs
node scripts/worldgen-preview.mjs
```
(absolute node path as above). Screenshots only ever show synthetic data.

## 12. Content shapes (C writes them, B and H read them)

`content/story.json`:
```json
{ "version": 1,
  "prologue": { "id": "prologue", "title": "The Lantern Wakes",
    "steps": [ { "id": "light", "title": "A Light on the Hook", "text": "one or two sentences in the story voice", "hint": "what to do, plainly, ≤ 90 chars" } ] },
  "letters": { "oriel": { "from": "Oriel", "title": "A letter by paper bird", "lines": ["…"], "sign": "— O." } } }
```
There are exactly the seven steps of §6, in that order and with those ids. Completion conditions live in code, keyed by step id, and never in content.

`content/wilds.json`:
```json
{ "version": 1,
  "examine": {
    "lantern": { "sleeping": ["…"], "lit": ["…"] },
    "ruin": ["…"], "ruinSearched": ["…"], "cave": ["…"], "chest": ["…"], "chestOpened": ["…"], "hamlet": ["…"],
    "ore": ["…"], "herbs": ["…"], "fishing": ["…"], "quay": ["…"], "landmark": ["…"],
    "westwatch": { "day": ["…"], "night": ["…"] },
    "thicket": ["…"], "palisade": ["…"], "gate": ["…"], "crag": ["…"], "tree": ["…"], "stump": ["…"], "note": ["…"], "statue": ["…"] },
  "notes": [ { "id": "note-01", "from": "Tamsin" | "Oriel" | "Brannoch" | "Pell" | "Milo", "region": null | "<anchor id>", "text": "≤ 280 chars" } ],
  "statues": { "<anchor id>": { "missing": "her left boot", "glimmer": "≤ 220 chars" } },
  "regions": { "<anchor id>": { "arrive": "≤ 120 chars", "hush": "≤ 120 chars" } },
  "hamlets": { "greetings": ["…"] },
  "strays": { "shy": ["…"], "curious": ["…"], "grumpy": ["…"], "dramatic": ["…"], "sleepy": ["…"], "polite": ["…"], "lost": ["…"], "nosy": ["…"], "proud": ["…"] },
  "loot": { "chest": { "birch": [8, 20], "ash": [3, 10], "pine": [0, 6] }, "ruin": { "birch": [0, 10], "ash": [4, 12], "pine": [0, 4] }, "tabletChance": 0.25, "mimicChance": 0.12 },
  "mimic": ["…"],
  "chop": { "birch": ["…"], "ash": ["…"], "pine": ["…"] },
  "notes_later": { "cave": "…", "gathering": "…", "ferry": "…" } }
```
- There are at least 24 notes, at least 3 lines wherever an array is shown, 11 statues and 11 regions (every `ANCHORS` id except `hearthvale`), and one entry for each of the nine temperaments.
- The shell picks a line deterministically from `hashString(id)`, so the same place always says the same thing.
- Loot ranges are inclusive integers. The same chest always gives the same loot (it's seeded by its id).

## 13. Refinements after wave 1 (2026-09-27)

Modules A to F are built, reviewed and fixed, with 367 unit tests passing. Their full reports, with exact APIs, are in the scratchpad (`wave1/build_*.md` and `wave1/fix_*.md`); read the ones for the modules you consume. Where the reports and §1–§12 differ, these decisions win:

- **Watch.**
  - `snapshot.capacity.codex` and `AgentSession.waitingSince` are as in §4.2.
  - Readings stamped in the future are handled by `latestReading` and `createCapacityClock`.
  - Main must add `capacity` to `snapshotKey`, add `capacity: { codex: null }` to `emptySnapshot`, and create the watcher with the test clock (`MILO_NOW`). It must also pass that clock to `normalizeState(value, now)`.
- **Core.** Actual names:
  - `reconcileRifts` → `{ state, opened, sealed, bell, notify }`.
  - `bellText(rift)` → `{ title, body }`.
  - `sealedSummary(sealed)` → the boot bubble text or null.
  - `settleStory(state, story, { hasSessions }, now)` → `{ state, completed }`.
  - `tallyFinished(state, snapshot, now)`.
  - `addMaterials`, `markFelled`, `lightLantern`, `markPoi(state, 'opened' | 'notes' | 'glimmers', id, now)` and `markExplored(state, keys)`.
  - `claimLoot`, `stitchWild` (which hands the story rift to `stitchStory`), `letGoWild`, `wardRift`, `unwardRift`, `letGoRift` and `letItBe`.
  - `WARD_POST_RULES` are named "Weekend nights off", "A patient knock" and "Room to run".

  Other decisions:
  - Nocturne rifts carry `agents`. `satchel.essenceGenres` exists.
  - `since` stays fixed for a whole night and for a whole capacity window.
  - Rifts depending on a source that's down are carried, never sealed.
  - The Knocking reaches the walls at 72 h.
- **Content.**
  - Notes are placed beside roads (worldgen, about 2 chunks in 5 that a road crosses).
  - A chest's name follows its `mimic` flag.
  - Statues read "It’s missing {missing}." and then the Glimmer.
  - The Westwatch uses `examine.westwatch` (its night lines see the Lighthouse).
  - Oriel's letter is only in `story.json`.
  - The Stockade's unlocks now list only what Phase 3 delivers.
- **Art.**
  - Final sizes are in the D report.
  - `palisade.*` pieces compose into a **16×36** cell: stamp n, w, e, then post, then s, all at (0,0), with the cell's bottom row on the tile's bottom edge.
  - `palisade.jamb` (16×18) is a plain sprite, used on the wall tile just south of the west and east gates.
  - The gatehouse uses frame 0 at the north and south-west gates, and frame 1 with dy −15 at the west and east gates.
  - The D report has suggested `SHADOWS` sizes.
  - `buildAtlas(createCanvas, { table, names })` builds genre atlases.
- **Wilds and nav.**
  - Tree density after spacing is about 16–18% of wood tiles, which matches the vale; §7.1's 45% and 50% are per-tile rolls.
  - `wilds.ringDetours` reroutes roads that worldgen draws along the ring or across the vale's corners. Always ask `wilds.terrainAt` rather than `worldgen.terrainAt`, and paint the map view and mini maps with `paintRegion(wilds, …)`.
  - `ringBlocked(x, y, tier)` is the nav's `extraBlocked`; it covers the war table.
  - `objectsIn(x0, y0, x1, y1, state)` and `entitiesIn(rect, state)` take `{ tier, lit, opened, notes, glimmers, felled, day }`.
  - `o.hush` marks sprites to draw with the hush palette.
- **Rift FX and Elsewhere.**
  - Strays roam `STRAY_ROAM` (2.6 tiles when open, 3.4 when gaping), only on tiles their rift's bleed recolours at least 75% of, and never behind the tear.
  - Build `strayActors` once per rift and stage.
  - `tearArt` results are cached and frozen.
  - Use `tearFrameAt`, `sealArt`, `letGoFrame` and `weatherPixels`.
  - `bleedAt` gives the genre for objects and Milo. Pass rifts in the same order to `bleedsFor` and `bleedAt`.
  - An Elsewhere's ground is `scene.rgba(basePaletteByCode())`, a patchwork for fusions. Its sprites are dressed with `scene.genreAt(feetPx)`.
  - Milo arrives at `scene.spawn`, one step out of the doorway.
  - Objects marked `scenery` take no clicks or hover.
  - The Tale-lead is drawn at 1× in the wilds and 2× in an Elsewhere.

## 14. Refinements after wave 2 and the polish pass (2026-09-27)

- **Bright rifts** are keyed on `plot.firstBuiltAt`: `built:<plotId>:<firstBuiltAt>`. It's set by a first design, kept through redesigns, cleared when a plot is cleared, and seeded from `builtAt` in older saves. A redesign never opens a second bright rift, and a plot being redesigned keeps its bright rift open.
- **Quiet closes.** History `how` also allows `'closed'`: a Nocturne that the evening bell no longer covers, after it's switched off or moved, closes quietly with no loot and no count. `reconcileRifts` also returns `closed: [{ key, id, name, genres, kind, realKind, subject }]`, and the shell plays `closeRift(id, 'let-go')` for each. Each open Nocturne remembers its bell (`rifts.open[key].bell`).
- **Placement** widens its search in steps out to 30 tiles, then falls back to a safe spot outside the ward. The shell's `isFree` also requires that the tile can be reached from the vale.
- **Engine API added:**
  - `world.worldgen` (the shell shares it, so the roads are laid out once);
  - `world.terrainAt(x, y)` (map characters in the vale, wild codes outside);
  - `renderMap(scale, { time, milo = true })`;
  - `world.elsewhereEntities()`.

  During a scene change's fade-out, `travelTo`, `enterElsewhere`, `leaveElsewhere`, walks and `chop` refuse.
- **Fusion bleeds** are lobed, one lobe per genre set off the tear, and this is done inside `riftfx.bleedsFor`, `bleedAt`, `bleedCover`, `weatherPixels` and `strayActors`, so every consumer agrees.
- **Outfits.** Inside a bleed or an Elsewhere only Milo's coat and scarf take the genre's colours (`riftfx.OUTFITS`). His skin, eyes, outline and hair stay his own. Crew clothes work the same way.
- **The Gate Bell's** desktop note follows its own switch (`notify({ kind: 'gate-bell' })`), not Alerts.
- **Rest.** Resting at a lantern puts it right after Home in the travel lists, marked "Where Milo rests".
- **Worldgen.**
  - Roads cross water only on straight decks and stay two tiles clear of the ring.
  - The ring is land except where the bay runs out through it.
  - Water smaller than 10 tiles is filled.
  - Shut-in pockets within 60 tiles of the vale are opened.
  - Fishing spots need water within 2 tiles.
  - The Hush edge is a 2–3 tile dither band.

## 15. Refinements after the final review (2026-09-28)

- **History and episodes.**
  - History entries keep their episode's `since`.
  - A real rift that comes back with the same key and `since` after a seal stands again quietly (`resumed: true`): no second seal, count or loot.
  - A closed Knocking's history name keeps the session title for `SESSION_NAME_DAYS` (3) days, then reads "a waiting session".
- **Capacity.** A reading matches any known window within 10 minutes of its refill time. A window that has already refilled never opens a second rift.
- **The Hearth.** `hearthStatus().def.defences` lists every defence standing, lower tiers first. Future materials name when they arrive ("Mined in the vale once the Notice Board arrives"), and the not-ready reason never asks for the impossible.
- **Sprite dressing.**
  - Sprites take a bleed's genre from the whole foot tile (`riftfx.tileDressAt`), not from one dithered pixel.
  - Walkers use a steady dresser (`makeDresser`), which switches at 0.55 and back at 0.45.
  - Ground keeps the dithered edge.
- **Walking.** A walk begun part way through a step settles on a tile. Scene changes are exclusive.
- **Shell.**
  - The vale's place list has the four gates.
  - Focus returns to the world after travel or leaving.
  - A rift that seals while Milo walks to it is never stepped into.
  - A wild rift's Elsewhere keeps working across midnight.
  - Damaged content turns Phase 3 off cleanly.
  - Nothing is saved before the state has loaded.
- **Worldgen.**
  - Rivers taper before the vale and hard region ground.
  - The last 3 tiles into each gate are one lane.
  - Lanterns, landmarks and statues stand clear of bridges.
  - Hush pockets of 16 tiles or fewer are merged.
  - The Stockade has two banners by the north gate.
- **Sprite dressing (supersedes the "2×2 dither" for sprites in §7.2 and §13).**
  - Objects take the genre that owns their foot tile (`tileDressAt`), with sprites wider than a tile averaged over their whole foot row.
  - Walkers (Milo, crew) use `makeDresser`, reset on travel and scene change.
  - Bleeds are always ordered by `bleedOrder`: real rifts, then story, then wild, then standing, and by id within each.
  - Milo's coat uses its own tone keys (`COAT_TONES`). `coatColours(genre)` picks the genre's glow unless that is within 30 ΔE of his honey coat; then it uses the genre's `rift.inner` colour.
- **The Stockade's props.** The Gate Bell stands on its own beside the north road, clear of the gatehouse, banners and trees. The banners have shadows. With the wilds loaded, the harbour fog fades out before the wall.
- **Chopping.** Milo leans 2 px, measured from the trunk. The axe head is drawn in front of the tree, and leaves fall on the far side.
