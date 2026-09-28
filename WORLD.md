# The Hearth and the Wilds

Hearthvale stays exactly as it is: a handmade vale, and a sanctuary no rift can ever touch. Around it, the camp grows into a fortress and then a kingdom, and every wall and tower is a real automation that keeps problems away. Beyond its gates the Hushlands go on forever. The story's regions sit where the Long Road puts them, and everything between them, and past them, is generated from a seed: coasts, forests, rivers, ruins, caves, lanterns, hamlets and rifts. It's an open world to wander like Minecraft or Elden Ring, kept calm the MILO way.

The rest of the design lives in [`PLAN.md`](PLAN.md), the world bible in [`LORE.md`](LORE.md) and the rift codex in [`RIFTS.md`](RIFTS.md). The tiers are data in [`content/fortress.json`](content/fortress.json).

---

## 1. Three promises

1. **Hearthvale is sanctuary.** The vale's map (`src/world/map.js`) is never generated or rewritten, and no rift, wild or real, ever opens inside it. The only things that change it are things you build.
2. **The world keeps to the story and never ends.** Twelve story anchors sit in the order and direction the Long Road walks. Everything between and beyond them comes from the world seed, chunk by chunk, with no edge.
3. **Distance is urgency, and defences are automations.** Real problems open as rifts on the frontier. The more urgent the problem, the closer to your walls its rift opens. The kingdom's defences are real rules that deal with problems before they get there.

## 2. The Hearth: from camp to kingdom

The Lantern Hook's light makes a ring around the vale, the **Hearthward**. It's the same kind of lantern ring the old towns survived inside during the Age of Lanterns (LORE.md §2). Each tier of the Hearth pushes the ring further out, and the land inside it becomes the kingdom's: safe, buildable, and closed to rifts.

| Tier | Name | Ward | Needs (real progress, can't be ground out) | Defences (real features) |
|---|---|---|---|---|
| 1 | The Camp | 0 | nothing | The Lantern Hook (sanctuary), the Watchtower (Watchkeeping) |
| 2 | The Stockade | 12 | 20 crew sessions watched to the end, a building designed, a week with MILO | The War Table, the Gate Bell, the first ward-post |
| 3 | The Hold | 28 | 30 focus sessions, a building's level 1 proven, 25 quests finished | Ward-towers, the Sally Port, the Barracks |
| 4 | The Keep | 48 | A project delve finished, a month with MILO, a calendar connected | The Dawn Bell tower, Ballistae, Lookouts |
| 5 | The Castle | 72 | Three buildings at level 3, 100 focus sessions, six residents | Guild halls, the Hangar, the Great Hall |
| 6 | The Citadel | 100 | 250 focus sessions, six months with MILO, Act IV | The Observatory, siege engines, districts |
| 7 | The Kingdom | 140 | Act VI, a year with MILO, twelve residents | The Lantern Spire, royal decrees, the coronation |
| 8 | The Bright Kingdom | 200 | Act VII, a 99 in any life skill | The Bookmark |

Ward radii are tiles beyond the vale's edge. Each tier also costs game materials and a Construction level, so building it is something you do in the game, but the requirements are always real.

**How it grows.** The camp at the centre is never torn down: the tent, the cabin, the campfire with its three stumps and the Lantern Hook stay where they are at every tier, like an old square inside a city. The Stockade's palisade stands along the vale's edge, and its gates are the four gaps already in the tree line. From the Hold on, walls, towers and districts spread over the land the ward has claimed, which was wild before. The kingdom grows outward from an untouched heart.

## 3. Defences are automations

A defence is a real rule or capability. Its job in the story is to stop rifts before they reach the walls, and its job in reality is to stop problems before they reach you.

| Defence | Tier | What it really does |
|---|---|---|
| The Watchtower | Camp | Watchkeeping: every crew session, live. |
| The War Table | Stockade | Every open rift on one map, with its real cause in plain words: the problems dashboard. |
| The Gate Bell | Stockade | When a rift reaches the walls (it's become urgent), a soft desktop note, once. |
| Ward-posts and ward-towers | Stockade, Hold | Auto-ward (snooze) rules, such as "someday quests never open rifts", or "hold Nocturne rifts on a Stillday". |
| The Sally Port | Hold | A queue for commissions, so the crew go out one at a time and never pile up. |
| Ballistae | Keep | Auto-dispatch rules: when a rift of a kind you choose opens (a failing check, say), a crew member sets out under a ward, and asks before changing anything important. |
| Lookouts, then the Observatory | Keep, Citadel | Rifts seen earlier: deadlines 7, then 14 days out instead of 2. |
| Siege engines | Citadel | Chains of crew runs (research, build, test) for the rifts you choose. |
| Guild halls | Castle | Each faction's rules for its own domain (the Quiet Order keeps your evening bell). |
| Royal decrees | Kingdom | Every standing rule (focus, rest, crew, alerts) in one place. |

**Rules for every automation:** you can see it, pause it and undo it; it writes what it did into the Chronicle; it never acts outside its ward level (PLAN.md §10); and anything that would leave the PC is marked on the map.

## 4. The frontier: distance is urgency

- **Where a real rift opens.** Outside the Hearthward, on the side of the vale that faces its genre's home region. Neon and Iron rifts face Cinderforge, Gothic faces the Greyreach, Void the Archive Peaks, Noir the Glass Fen, Frontier Mistmere Harbor, Nocturne the Whisperwood, the bright genres the Painted Hills and the Ivory College. Titans rise from the bay instead, since the sea is how they come.
- **How far out.** `3 + (1 − urgency) × 38` tiles beyond the ward, give or take a few. An urgent build failure opens about 10 tiles from the walls, while a far-off exam sits 30 or more tiles out on the water. Standing on the walls, you can see at a glance what's pressing. The War Table lists the same rifts in order.
- **Moving in.** As a problem gets more urgent (a deadline nears, a task gets staler), its rift walks closer. It never breaches the walls. When it reaches them it rings the Gate Bell once and waits.
- **Same problem, same place.** A real rift's spot comes from its cause, so it doesn't jump around between days.

`world.placeRealRift(spec, { urgency, wardRadius })` does this, and the tests check every rift lands outside the ward, on land (or at sea for a Titan), and closer when it's more urgent.

## 5. The Hushlands: an endless world that keeps to the story

**The seed.** Each install makes one world seed at first run, shown in Settings. The same seed always makes the same world. The anchors below keep their order and direction under every seed, shifted by up to 8 tiles, so the story always reads the same but no two worlds are identical.

| Region | Where | Distance | Land | Story | Tier | Wild rift genres lean toward |
|---|---|---|---|---|---|---|
| Hearthvale | the centre | 0 | handmade | Prologue | 1 | none: sanctuary |
| The Whisperwood | north | ~80 | pinewood with clearings | Act I | 2 | Nocturne, Gothic |
| Mistmere Harbor | east coast | ~70 | grassy headland, quay | Act II | 2 | Frontier, Titan, Nocturne |
| The Painted Hills | south-east, over the strait | ~110 | hills striped with madder, woad and weld | Act I | 2 | Starlight, Verdant |
| The Ivory College | south | ~100 | meadows | Act I | 2 | Summit, Backhalls, Noir |
| The Dicing Downs | south-west | ~115 | open downs, dice stones | Act I | 1 | Frontier, Noir, Starlight |
| Cinderforge | west | ~150 | basalt ravine | Act IV | 3 | Iron, Neon |
| The Glass Fen | far south | ~180 | marsh and still pools | Act II | 3 | Noir, Neon, Void |
| The Archive Peaks | north-east | ~160 | snow ridges; the Stacks at the centre | Act III | 4 | Void, Gothic, Summit |
| The Skyward Isles | above the eastern sea | ~165 | floating isles (by kite from Mistmere) | Act IV | 5 | Neon, Starlight, Titan |
| The Greyreach | far north-west | ~245 | grey moor and the Maelstrom patchwork | Act V | 6 | Gothic, Void, and everything else |
| The Far Shore | across the western sea | ~365 | white cliffs west, a beach east | Act VI | 1 | none: the Lighthouse is a bookmark |

**The land.**
- **The continent** is a warped oval around the vale. Temperature falls toward the north, so pinewoods and snow lie that way, and meadows, forests and marshes toward the south.
- **Rivers** wind through the lowlands and cross under bridges.
- **The bay** south-east of the vale (where the vale's own dock is) joins the eastern sea by a strait.
- **The regions** have ragged, warped edges, so none of them is a circle.
- **Beyond the continent**, other shores and isles rise from the sea forever: the Unmapped Lands.

**Roads.** The Long Road and its branches run from Hearthvale's four gates (north, west, east, south-west) to every region, found by A* over the terrain. They merge where they meet, bridge rivers and inlets, and climb through mountain passes when they must. The Skyward Isles are reached by kite and the Far Shore by Captain Sloe's ferry from Mistmere. On the west coast the road ends at **the Westwatch**, where on a clear night you can see the Great Lighthouse turning across the sea.

**Difficulty.** A region has its own tier. Everywhere else, the tier is `1 + distance / 55` tiles, capped at 8. **Depth** keeps counting past the cap for ever, so the far lands keep getting stranger and their loot keeps getting better.

**Names.** Regions from the story keep their names. Everywhere else gets a stable name of its own from the word banks, such as the Saltglass Reach or the Owlwing Vale, in cells of 96 tiles.

## 6. Exploring: Minecraft and Elden Ring, calm

- **Lanterns are sites of grace.** Sleeping lanterns stand along the old roads (about every 40 tiles) and at the heart of every region. Light one to rest, to set it as the place you wake if you faint, and to fast travel between any two you've lit. A region's own lantern is its sleeping Lanternkeeper, so waking it is a story beat as well as a waystone.
- **Fog of war.** Beyond the vale the map starts blank. Walking reveals it, Cartography levels as you chart it, and **map tablets** found in Maker ruins reveal a stretch at once. Exploring new ground costs Embers once the Adventurer's Kit arrives (PLAN.md §6), so the wilds can't eat your day.
- **Things you can see from far off.** The Stacks on the peaks, the Great Lighthouse from the Westwatch, and later your own Lantern Spire from anywhere. Elden Ring's rule: if you can see it, you can walk to it.
- **What the wilds hold** (generated per chunk, about 16 per chunk before rolling):
  - **Maker ruins:** loot, lore and map tablets.
  - **Caves:** short procedural delves, carved by the same generator as rift layouts, in stone colours.
  - **Chests**, a few of them Mimics, who are friendly and suspiciously pleased to see you.
  - **Notes from the Old Company** on the roads: story fragments, collected by region.
  - **Hamlets:** people, errands and trade.
  - **Resource nodes:** ore, herbs and fishing spots, tiered by region, Albion style.
- **Tamsin's statues.** One in every region, each unfinished in its own way (LORE.md §3). Each holds a Glimmer.
- **Field bosses.** A gaping wild rift at tier 5 or more lets its Tale-lead roam a little way out. It's optional, always.
- **Outposts (from the Hold).** Claim a spot in explored land and build a small camp there: a lantern, storage and one or two plots. An outpost has a little ward of its own. The Keep links outposts by waystones, and the Citadel links them by road.
- **Calm rules.** There's no death and no lost items. Fainting sends you to your last lantern, having spent only the Embers you'd already spent. Nothing in the wilds chases you home or nags you.

## 7. Wild rifts

- **Every day is different.** Each chunk rolls for wild rifts every day. The chance is `10% + 3.5%` per tier (up to 50%, and more in the Greyreach), and busy chunks get two. A wild rift never opens inside the Hearthward, and none has ever opened on the Far Shore.
- **They fit the land.** A wild rift's genre follows the region's affinity: Cinderforge's rifts lean Iron and Neon, and the Greyreach's lean Gothic and Void, with everything else mixed in. The far lands mix everything equally.
- **They're optional.** Wild rifts are adventures with no real cause. They're labelled *wild*, they never ring the Gate Bell, they never nag, and they close with the day unless you're inside one.
- **The ladder.** Stitch one and a deeper rift opens beneath it, with no bottom (RIFTS.md §10).

## 8. How it's built

Phase 3 put all of this into the app. The build spec is `CONTRACT-PHASE3.md`.

**The world**

| File | What it does |
|---|---|
| `src/world/rng.js` | Seeded randomness (mulberry32), string and integer hashes, and Perlin, fbm and ridged noise. |
| `src/world/worldgen.js` | Terrain, story regions, and roads that cross water only on straight decks and meet the vale only at its gates. Also lanterns, statues and points of interest, wild rift spawns, the Greyreach patchwork, real-rift placement, tiers, depth and names. |
| `src/world/wilds.js` | Chunks at the vale's own 1:1 pixel scale: ground painted in palette keys so the vale's edge is seamless, and objects (trees, crags, lanterns, ruins…). Also the ring of thicket or palisade with its gates, and the Hush. |
| `src/world/nav.js` | Walking across the vale and the wilds as one world: Milo leaves the vale only through a gate. |
| `src/world/riftgen.js`, `straygen.js` | Rifts from real causes and from seeds, the ladder, each rift's Elsewhere layout, and its strays. |
| `src/world/riftfx.js`, `elsewhere.js` | Tears, bleeds (fusions as lobes), strays that wander, the seal and let-go animations, Milo's genre coat, and the Elsewhere scenes. |
| `src/world/engine.js`, `scene-*.js` | Streaming chunks in idle time, a camera that follows Milo everywhere, entities you can click, lanterns, chopping, travel, echoes, and the Stockade rising. |

**The shell**

| File | What it does |
|---|---|
| `src/rifts.js`, `hearth.js`, `story.js`, `model.js` | Real rifts from real signals, the Hearth's tiers, the Prologue, and the saved state. |
| `src/ui/` | The rift loop, the panels (rift, War Table, Hearth, lantern, places, story) and the map view with fog of war. |
| `content/` | `genres.json`, `riftgen.json`, `fortress.json`, `wilds.json` (notes from the Old Company, statues, examine lines) and `story.json` (the Prologue and Oriel's letter). Main reads them and serves them over IPC. |

**Previews and tests.** `scripts/capture-chunks.mjs`, `capture-wilds.mjs`, `capture-elsewhere.mjs`, `capture-sprites.mjs`, `capture-mapview.mjs` and `worldgen-preview.mjs` render everything to `test-results/`. Together, the unit tests and the Electron checks cover:
- an untouched vale;
- rift-free wards;
- gates as the only way in;
- connected roads and walkable Elsewheres;
- one bell and one payout per episode;
- calm copy;
- the frame budget.

**Chunks.** The world is 32×32-tile chunks. Terrain and objects take a few milliseconds per chunk, and the ground is painted in 64-row slices during idle time. The roads are laid out once per world (about 200 ms, off the first frame). The engine and the shell share one worldgen.

**What's saved:**
- explored chunks (the fog);
- lit lanterns and the one Milo rests at;
- opened chests, searched ruins, read notes and heard statues;
- today's stumps and today's closed wild rifts;
- open, warded, let-go and belled real rifts;
- the rift history;
- the Hearth's tier and the satchel.

The seed is 'hushlands' for now. Everything else is regenerated from it.

**Performance:**
- chunk work happens only in idle time, never while the window is hidden;
- at most 25 chunk canvases are kept;
- a frame in the wilds at 1280×820 with three rifts in view takes under 12 ms.
