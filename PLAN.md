# MILO: the plan

**MILO** (Monitor and Interface Layer for Operations) is Chris's personal operations companion, and now also a point-and-click RPG. It is set in the **Hushlands**, an original world in the spirit of RuneScape's skills and quests, Albion's gathering-and-crafting sandbox, and Frieren's gentle, time-soaked journeys. Milo still watches over Chris's AI crew, projects, schedule and apps. Now the whole thing is also a world worth wandering, with skills to level, quests to follow, lore to find, and a long road to walk.

The world bible lives in [`LORE.md`](LORE.md), the rift codex in [`RIFTS.md`](RIFTS.md), and the fortress, the endless world and the frontier in [`WORLD.md`](WORLD.md). Build contracts for finished steps are in [`CONTRACT.md`](CONTRACT.md) (step 1) and [`CONTRACT-STEP2.md`](CONTRACT-STEP2.md) (step 2).

---

## 1. The one rule

> **Real work is the fuel. Every system earns its place twice: once by being useful, once by being fun.**

MILO is not a game bolted onto a dashboard, and it's not a dashboard hidden inside a game. Each feature has a *real job* (show what needs you, start a focus session, send Codex to fix a build) and a *game form* (a quest marker, lighting the lantern, a crew commission). If a mechanic has no real job, it has to be cheap, calm and optional. If a real feature has no game form, we give it one: its door on the map, its NPC, its spell.

## 2. Design pillars

1. **The game plays itself while you work; you play it while you rest.** During a 50-minute focus session Milo gathers, crafts and explores on his own, idle-game style, and the HUD dims. During the 15-minute rest you play: delves, quests, trading, decorating. Active play costs **Embers**, and Embers only come from real work. So the game can't eat your day, and the day feeds the game.
2. **Nothing real is faked, nothing fake is paid for with reality.** Life skills only rise from real events MILO can see (finished tasks, completed focus sessions, crew runs, deadlines met). Wild skills only rise in-game. Buildings only level up when a real feature passes its check (step 2's rule).
3. **Calm, never punishing.** No death, no decay, no streak-shaming. Rifts (real problems, shown as other genres bleeding in) wait patiently and can be stitched, warded, or let go. Fainting in a delve sends you home with nothing lost but the Embers you spent.
4. **A world with memory.** Finished things leave marks: flowers where tasks were done, statues for milestones, anniversaries Milo remembers. The Chronicle keeps your history like a travel diary, and the Far Shore keeps what you retire.
5. **Readable like RuneScape.** Left-click does the obvious thing, right-click offers every option, **Examine** works on everything, XP drops float up, every skill has a guide showing what its levels unlock, and the log tells you what happened.
6. **Private by default.** The step 1 and 2 privacy rules hold. Game content is local. Crew calls only carry what the rules allow, and anything that leaves the PC is visibly marked.
7. **Content is data.** Items, quests, dialogue, examine text, books, spells and regions live in `content/` files with validators, so new lore keeps flowing without code changes.
8. **Genres collide on purpose.** Problems arrive as other stories bleeding through **rifts** (cyberpunk, a night city, gothic horror, dieselpunk, cosmic horror, noir, western, kaiju), and good seasons open bright ones (solarpunk, magical girl, cultivation). The strays who stay turn Hearthvale into Chris's own crossover. The full design is in [`RIFTS.md`](RIFTS.md).
9. **Home is a fortress; its walls are automations.** Hearthvale is sanctuary: no rift ever opens inside it. It grows from a camp to a kingdom in eight tiers, each earned with real progress, and every defence is a real automation (auto-ward rules, dispatch rules, earlier warnings), so a stronger kingdom means fewer problems ever reach you. Distance from the walls *is* urgency. See [`WORLD.md`](WORLD.md).
10. **The world never ends, and it keeps to the story.** Beyond the gates the Hushlands are generated from a seed, chunk by chunk, forever: coasts, rivers, ruins, caves, lanterns, hamlets and rifts, with the story's regions always where the Long Road puts them. Exploring is Minecraft's endlessness with Elden Ring's sense of discovery, at MILO's pace. Rifts are generated too, so there's always another one, and a ladder beneath every stitched wild rift that goes down forever.

## 3. The translation table: real life ↔ the Hushlands

| Real thing | In the Hushlands | Where you see it | Real use |
|---|---|---|---|
| A task on your board | A **quest** (main or side, as Habitack sorted them) on the Town hall notice board | Quest journal, board | One-prompt capture, triage, priority |
| A project with milestones | A **delve**: a dungeon whose floors are milestones and whose locked doors are blockers | Delve map | Project progress at a glance |
| A 50-minute focus session | **Kindling the lantern**: Milo gathers while you work | Focus orb, idle gathering | The 50/15 timer |
| The 15-minute rest | **Banked coals**: rest-time play, Hearthkeeping XP | Break banner | Healthy breaks |
| A task left untouched 14+ days | A **Gothic rift**: portrait wraiths whose eyes follow the forgotten quest | The frontier; its echo on the notice board | Stale-task nudge |
| A task whose steps keep growing, or too much in progress | An **Iron rift** (dieselpunk): tin clerks, smog, a quota that keeps rising | The board, the Dispatch Office | "Split this up", in-progress limit |
| A task too big or vague to start | A **Void rift** (cosmic horror): the Unbounded, something too big to see | Over its quest | Break it into steps |
| Working past your evening bell, or after midnight | A **Nocturne rift** (a night city at 3 a.m.) and Lumi on her bicycle | The frontier toward the Whisperwood | Go to bed; the night watch |
| Tasks untouched 30+ days | They drift to the **Greyreach**, the backlog wilderness | A region on the map | Backlog grooming, letting go |
| A Claude or Codex session | A **Wayfarer** on a commission | Crew on the map, crew tab | Watchkeeping (step 1) |
| A session waiting on you | An NPC with a **"!" quest marker** | Map, minimap, log | The needs-you inbox |
| A session left waiting 24+ hours | *The Knocking*: a gothic door beside the crew member | Map | A gentle escalation |
| A crew member asking you a question, or a failure nobody can explain | A **Noir rift**: gumshoe shades and an informant | Map, Holloway Investigations | Questions and mysteries in one place |
| A session stuck in a loop | A **Neon rift** (cyberpunk): a loop daemon circling the building | Map | Loop detection |
| A failing build or check | A **Neon rift**: glitch drones over the forge | The frontier toward Cinderforge; an echo on the building | CI/check watching |
| How urgent a problem is | **How close to your walls its rift opens** (urgent ones about 10 tiles out, far-off ones 40) | The walls, the War Table | See what's pressing at a glance |
| An automation (a snooze rule, an auto-dispatch rule, an earlier warning) | A **defence**: a ward-tower, a ballista, a lookout | The fortress | Problems handled before they reach you |
| MILO growing with you (weeks of use, focus, proven buildings, residents) | **The Hearth** rising from camp to stockade, hold, keep, castle, citadel and kingdom | Hearthvale and the land around it | A long-term goal made of real progress |
| Free time to wander | **The wilds**: an endless seeded world with lanterns, ruins, caves, hamlets and wild rifts | Beyond the gates | Play for rests, capped by Embers |
| Crew rate limits (Codex's `used_percent`, `resets_at`) | **Mana**: the crew's pool and when it refills | Mana orb, crew tab | Know before you hit limits |
| Sending an agent to do work | A **commission**: the crew member sets out, works on the plot, returns with a chest | Map, log | Dispatch (step 3 in the old plan) |
| An app you built | A **building** whose levels are real, proven features | Its plot | Step 2, continued |
| A calendar event | A **ship** docking at Mistmere Harbor | Harbor, Tide Clock | Schedule awareness |
| A deadline within 48 h with nothing started | A **Frontier rift** (western): a wanted poster, then High Noon | Harbor, the Bounty Board | Early warning |
| A big deadline (an exam, a launch) | A **Titan** on the horizon, walking closer each day; the crew assemble a colossus | The sea, the Hangar | Big-deadline planning |
| A balanced week, a milestone, a focus streak | A **bright rift**: Verdant gardens, a Starlight celebration, the Summit's breakthroughs | Anywhere | Rewards that mean something |
| A stray who stays after its rift is stitched | A **resident** with a shop, a quest line and a real service | Hearthvale and beyond | Each brings a feature (the night watch, the bounty board, task-splitting) |
| Morning brief | The **Dawn Bell**: the town crier reads your day | Hearthvale square | Daily plan |
| Evening recap | **Campfire tales**: the crew tell what they did | Camp at dusk | Daily review |
| Weekly review | **Starfall**, a page in the Chronicle | Chronicle | Weekly stats and reflection |
| Search across tasks, notes, sessions | **Found Things**, a spell taught by Oriel in the Stacks | Grimoire, chat | Local search |
| A quick note | **Pocket Note** (global hotkey), filed in the Hollow of Thoughts | Satchel, Whisperwood | Thought capture |
| Automations and commands | **Spells** in the Grimoire | Grimoire, chat, voice | Command palette, macros |
| Settings | **Gear** you wear (the Quiet Hood is Do Not Disturb) | Gear tab | Modes and toggles |
| Real outputs (a clip, a commit, an essay) | **Crafting materials** (a Painted Reel, Forged Parts, an Annotated Scroll) | Satchel | Proof of work you can build with |
| Archiving a project | **Sailing it to the Far Shore** | Harbor ferry, Far Shore | Archive with ceremony |
| A milestone | A **statue** in the Garden of Statues | Far Shore, Hearthvale | Remembering wins |
| Where your work happened | The **Blossomfield**: a flower grows where each task was finished | Map overlay | A history heatmap |
| Backups and export | **Carving a waystone** | Grimoire | Safe data |

## 4. Progression: six tracks that never cross wires

1. **Your skills (1–99).** 24 skills in three families, RuneScape-style, on the classic XP curve (level 99 = 13,034,431 XP). Every skill has a guide listing its unlocks, and every 99 earns a **Mantle**.
   - **Life skills (from real events only):** Artifice (code and apps), Scribing (writing), Illumination (art and creative work), Scholarship (study and reading), Stewardship (errands and life admin), Command (leading the crew), Focus (completed focus sessions), Hearthkeeping (rest, breaks, stopping on time) and Tidereading (deadlines met).
   - **Gathering (in-game, mostly idle during focus):** Woodcutting, Fishing, Foraging, Mining, Gardening.
   - **Making and roaming (in-game, active during rests):** Cooking, Smithing, Crafting, Alchemy, Construction, Cartography, Wayfaring, Warding (combat), Spellcraft and **Seamcraft** (stitching rifts, weaving genre essences into fusion gear and building skins).
2. **Milo's Arts (feature levels).** Watchkeeping, Dispatch, Timekeeping, Lore, Voice and Tinkering. These are the step 1 "skills", renamed so they don't collide with yours. They level only when a real capability ships and its proof check passes.
3. **Crew levels.** Each Wayfarer levels from real finished work: commissions completed and sessions observed. They gain titles and cosmetic gear. They're never paywalled or nerfed.
4. **Buildings.** Each app's level tree (step 2), proven feature by feature.
5. **Story and renown.** Quest points, faction renown, titles, Glimmers (memory fragments), Small Spells, books and statues: the collector's layer.
6. **The Hearth.** Eight tiers from the Camp to the Bright Kingdom ([`content/fortress.json`](content/fortress.json)). Each tier needs real progress (weeks with MILO, focus sessions, proven buildings, residents, story acts), plus game materials and Construction, and brings real defences. Its ward widens with each tier: 0, 12, 28, 48, 72, 100, 140 and then 200 tiles.

**Calibrating life-skill XP.** It's tuned so a steady year of a habit reaches the 70s and a 99 takes years, like mastery should. Early levels come fast; level 10 arrives within the first few days. Starting rates live in `content/xp.json`:

| Real event | XP |
|---|---|
| Completed 50-minute focus session | 1,000 Focus |
| Honoured the full 15-minute rest | 400 Hearthkeeping |
| Stopped by your evening bell | 800 Hearthkeeping |
| A **Stillday** (a planned day off, kept) | 2,000 Hearthkeeping |
| Main quest finished | 1,200 in its skill (Stewardship, Scholarship, and so on; auto-tagged, correctable) |
| Side quest finished | 600 in its skill |
| Commission you dispatched finishes and passes its check | 400 Command |
| Needs-you answered within 15 minutes | 100 Command |
| Deadline met | 800 Tidereading (+400 if early) |
| Building level proven | 5,000 × level Artifice |

Soft daily caps apply per source (for example, beyond 12 quests a day each is worth a quarter), and the same completion never pays twice (Habitack's replay protection).

## 5. The loops

- **Moment to moment (seconds):** click to walk, click to gather, right-click for options, Examine for lore, watch XP float up.
- **Session (50/15):** Kindle the lantern and Milo heads to a gathering spot while the HUD dims. Chris works; logs, fish and herbs pile up. The bell rings: Embers, Focus XP, a small haul. Rest for 15 minutes: turn in a field journal, run a short delve, read a book Oriel sent, cook the fish. The lantern dims again when the rest ends.
- **Daily:** the Dawn Bell (schedule, deadlines, overnight crew work) → work → campfire tales at dusk (what the crew did, what's still open) → Milo tidies the camp.
- **Weekly:** Starfall (weekly review page), the Tide Market fair (new wares, trades for your crafted goods), a Riddle Note trail, faction errands.
- **Seasonal:** festivals on the real calendar, Lantern Trials (monthly goals with ranks), new story chapters unlocking.
- **Long term:** open new regions, finish story acts, earn Mantles, fill the Garden of Statues, sail finished projects to the Far Shore.

## 6. Economy

| Currency | Comes from | Goes to | Notes |
|---|---|---|---|
| **Embers** | Real work only: focus sessions (10), honoured rests (5), quests (5–15 by importance), commissions (5) | Active play: delve runs (20), story chapters (10), exploring new ground in the wilds (1 per chunk revealed), stepping into a wild rift (5, more further down the ladder), market rerolls (2) | Bank caps at 100 so play keeps pace with work |
| **Marks** (coin) | Quests, loot, selling crafts at the Tide Market | Tools, decor, services, cosmetics | Purely in-game |
| **Materials** T1–T8 | Gathering, delve loot, real outputs (reels, parts, scrolls) | Crafting, construction, building cosmetics | Albion-style tiers by region |
| **Genre essences** | Stitching rifts (Neon shards, Grave wax, Diesel cogs, Moonlit coins, and more) | Seamcraft: fusion gear, genre skins for buildings, music tracks | Maelstrom glass, the rarest, comes from 3+ genres at once |
| **Mana** | Mirrors real crew capacity (Codex rate limits now; Claude when visible) | Crew commissions and spells that call the crew | Can't be bought or farmed; it *is* reality |
| **Renown** | Real work in a faction's domain, plus faction quests | Faction gear, titles, regional perks | Seven factions (see LORE.md) |

**Sinks and pacing.** Embers cap and spend; Marks buy decor and cosmetics (endless and harmless); materials feed construction projects that take days of idle gathering. Nothing essential is behind Marks. Nothing useful is behind Embers, and no *real* feature ever costs game currency.

**Albion flavour, single-player.** Materials come in tiers by region; crafters specialise; "you are what you wear" (gear sets change Milo's gathering, and some carry real modes); plots are claims you build on; your vale is your island. The Tide Market has NPC merchants whose wares and prices follow the season and your own production. There's no multiplayer for now.

## 7. Interface

- **Two modes, one world.** **Adventure mode** is the full game HUD and the default. **Quiet mode** is today's minimal overlay, one click away. Focus sessions auto-dim Adventure mode.
- **Adventure HUD (RuneScape-readable, pastel pixel chrome):**
  - **Minimap** (top right) with orbs for **Embers**, **Mana** and the **Focus timer**.
  - **Side tabs:** Skills, Quests, Satchel (28 slots), Gear, Grimoire, Crew, Chronicle, Settings.
  - **The Log** (bottom left): the activity feed for crew, alerts, loot and XP, with tabs (All, Crew, Milo, World). Its input line is the command bar: talk to Milo in plain words, or cast with `::` (`::kindle`, `::found clip studio`, `::send codex "fix the portfolio build"`).
  - **Hover text** (top left): `Talk-to Codex / 4 more options`. Right-click opens the full menu.
  - **Dialogue box** with chat-head portraits and "Click to continue", for NPCs and crew.
  - **XP drops**, level-up moments (a paper lantern rises, calm), skill guides, and quest journal pages.
- **Accessibility:** everything clickable on the canvas is mirrored in the place list and tabs; keyboard walking; reduced motion; text scale; the crew strip and alerts stay screen-reader friendly.

## 8. The world map (details in LORE.md)

The Hushlands open region by region. Each region is a game area (tiered resources, creatures, delves, NPCs and lore) *and* a real domain. The regions are story anchors in a generated world: their places are fixed by the Long Road (north to the Whisperwood, east to Mistmere, west to Cinderforge, and so on), while the land between and beyond them comes from the world seed and never ends ([`WORLD.md`](WORLD.md) §5).

| Region | Tier | Real domain | Opens when |
|---|---|---|---|
| **Hearthvale** (home) | T1–T2 | Overview, your buildings, the watchtower | Now |
| **The Whisperwood** | T2–T3 | Voice, notes, thought capture | Prologue |
| **Mistmere Harbor** | T2–T4 | Calendar, deadlines, messages later | Calendar connected (clears the fog) |
| **The Painted Hills** | T2–T4 | Creative work, the Clip studio | Act I |
| **The Ivory College** | T2–T4 | Coursework, reading | Act I |
| **The Dicing Downs** | T1–T5 | Hobbies: game prep, fantasy drafts | Act I |
| **Cinderforge** | T3–T6 | Code repos as forges, CI | Act II (or a repo connected) |
| **The Glass Fen** | T3–T5 | Deep watch: logs, loops | Act II |
| **The Archive Peaks** | T4–T5 | Memory, decisions, search | Act III |
| **The Skyward Isles** | T5–T7 | Cloud services (clearly marked as leaving the PC) | Act IV |
| **The Greyreach** | T6–T8 | The backlog wilderness | Act V |
| **The Far Shore** | none | Archive, history, year in review | Act VI |

Every region is there to walk to from the start, as land. It **wakes** (its people, quests, services and resources) when the condition in the table is met, and until then it waits in the Hush, grey and quiet, like Mistmere does today.

Danger is colour-coded and gentle, Albion style: **Hearth** (green, safe; everything inside the Hearthward), **Wild** (amber, rifts open more easily), **Deepwild** (violet, bosses and Maelstroms) and **Far** (silver, sacred and peaceful; no rift has ever opened there). Outside the regions, the tier comes from distance (one tier per 55 tiles, up to 8), and depth keeps counting forever.

**Elsewheres.** Behind each genre's rifts is a small pocket world to visit for Embers: Lumen Row (Neon), Afterhours (Nocturne), Hollowmoor (Gothic), Ironvale Front (Iron), the Unmeasured Deep (Void), Grayrain (Noir), Dustwater Junction (Frontier), Titan Bay, Solace Gardens, Starfall Plaza, Cloudgate Peak and the Backhalls. Each has its own story arc, loot, music and, for most, a boss. After Act VII they become doors you can open whenever you like.

## 9. Rifts, delves and combat

The full design is in [`RIFTS.md`](RIFTS.md), with the genre data in [`content/genres.json`](content/genres.json).

- **Rifts are real problems wearing other genres' clothes.** The Hushlands is one book on a shelf of unfinished stories, and where something is left unfinished, unattended or overfull, the page thins and a neighbouring genre bleeds through. The genre is chosen by the real signal:

  | Genre | Signal |
  |---|---|
  | Neon (cyberpunk) | Machine trouble: failing checks, looping agents, crew capacity running high |
  | Nocturne (a night city) | Working past your evening bell or after midnight, skipped rests |
  | Gothic | Old things: stale tasks, a crew member left waiting, abandoned buildings |
  | Iron (dieselpunk) | Too much at once, scope creep, admin piles |
  | Void (cosmic horror) | Too big or vague to start, alert floods |
  | Noir | Questions and unexplained failures |
  | Frontier (western) | Deadlines |
  | Titan (kaiju and mecha) | Big deadlines |

- **Bright rifts are rewards.** Verdant (solarpunk) opens for a balanced week, Starlight (magical girl) for milestones, and Summit (cultivation) for focus streaks. The Backhalls (liminal spaces) are where search takes you.
- **Where they open.** Never inside Hearthvale. Real rifts open on the frontier beyond the Hearthward, facing their genre's region and closer the more urgent they are, with an echo on the thing they're about. Wild rifts come and go with the days in the wilds, as optional adventures ([`WORLD.md`](WORLD.md) §4 and §7).
- **Every rift is generated** ([`RIFTS.md`](RIFTS.md) §10): its name, affixes, strays, Tale-lead, loot and Elsewhere all come from a seed. A real rift's seed is its cause, so the same problem is always the same rift. A wild rift's seed is the world, the place and the day. Stitching a wild rift reveals a deeper one: the ladder, with no bottom.
- **How it looks.** Each genre recolours the world by role, with 2×2 dithered edges. Overlapping bleeds interleave into a fusion. Weather, music and the crew's outfits shift with the genre. `scripts/rift-preview.mjs` renders this on the real map today.
- **What you can do** from a rift:
  - **Stitch** (fix the real thing).
  - **Send the crew** (a commission).
  - **Ward** (snooze; the rift stops growing).
  - **Let go** (release the task; the tear becomes a moth that flies west).
  - **Step through** (visit its Elsewhere; for fun, costs Embers).
  - **Invite to stay** (after a stitch, a stray or Tale-lead can become a resident).
- **Rules.** Every rift names its real cause in plain words, never grows past Gaping, and never harms anything. Horror genres stay cosy, and each genre can be switched off.
- **Fusions.** When one real thing carries several signals, its rift fuses genres. A build failing at 3 a.m. is *Neon Nocturne*; a failing check nobody's looked at for weeks is a *Haunted Machine*. Three or more make a Maelstrom.
- **Residents.** Stitched strays can stay, each bringing a real service:
  - Lumi the vampire keeps the night watch over overnight crew runs.
  - Sheriff Dusty keeps the deadline bounty board.
  - Sergeant Rivet holds your in-progress limit.
  - Pip the voidling splits big tasks.
  - Mae Holloway tracks open questions.
  - Juno explains failing checks.
- **Genre skins.** Any building can be redrawn in any genre you've befriended.
- **Delves are projects and adventures.** A *real delve* is a project: floors are milestones, rooms are tasks, locked doors are blockers, and the boss is the final deliverable. A *story delve* is a short, handmade dungeon for a rest break, with lore, Mimics, and a boss.
- **Combat** is light and approachable, in the Soda Dungeon style: auto-battle with optional actions. Your party is Milo plus any crew who aren't on real commissions. Crew fighting strength follows their real level. Warding and Spellcraft grow from play. When a real commission runs, you can watch it as an expedition: its progress follows the agent's actual turns, and its outcome is the real outcome (checks pass → victory).

## 10. The Grimoire and Voice

Spells are MILO's commands and automations, collected like Frieren's small spells. You can cast them by clicking, by hotkey, with `::` in the log, or by voice (Whisper push-to-talk: "Milo, kindle the lantern").

- **Useful spells** (examples, full list in LORE.md): Kindle (focus), Banked Coals (rest), Dawn Bell (brief), Found Things (search), Quiet Hours (Do Not Disturb), Pocket Note, Summon the Scribe or Artificer (dispatch), Mend the Forge (fix a failing check), Bloom a Clip (clip workflow), Tidecount (deadlines), Wayfinding (jump anywhere), Letting Go, Carve a Waystone (backup), Starfall (weekly review).
- **Small Spells** are purely for joy: Warm Tea, the Other Side of the Pillow, Unfold a Map Perfectly, Find the End of the Tape. Oriel collects them, and so will you.
- **Inscribe** (Tinkering): write your own spells, either a chain of actions or a crew prompt template with a ward level.
- **Wards** are permission levels for crew spells: *Look only*, *Suggest*, *Change files in a project folder*, *Anything, with my OK first*.

## 11. Lore and content pipeline

- **LORE.md is canon.** It holds the style guide, cosmology, history, regions, characters, bestiary, grimoire, items, story acts, festivals and books.
- **`content/` holds the game data:** `skills.json`, `xp.json`, `items.json`, `npcs.json`, `spells.json`, `examine.json`, `quests/*.json`, `dialogue/*.md` (a tiny script format), `books/*.md`, `regions/*.json`, `festivals.json`. Tests check that every reference resolves, every name exists in the lore index, and every string follows the voice rules.
- **Targets for "tons of content"** by the end of Phase 9: 300+ examine lines, 60+ quests (main and side), 40+ NPCs with dialogue, 40+ spells, 200+ items, 30+ books, 12 regions, 8 story delves and 6 festivals. For rifts: 12 genres (more from the "far shelf" as content packs), 15 named fusions, 40+ strays, 13 residents, 12 Elsewheres and a dozen-plus fusion recipes.
- **`content/genres.json` already exists.** It holds each genre's role colours, weather, signals and the fusion table. `src/world/genres.js` turns role colours into full palettes. Tests will check every genre has every role and every fusion names real genres.
- **The Lorekeeper** (optional, opt-in, Phase 9+): the crew drafts new side tales, rumours and books from a weekly *numbers-only* summary (counts and categories, never session text), in the LORE.md voice. Chris approves each one before it enters the world.
- **Art pipeline:** hand-authored string grids (as now), the step 2 kit for buildings, and crew-drafted sprites validated against the palette, then reviewed by eye. Genres multiply the art for free: every sprite, tile and building is drawn once in palette keys and recoloured per genre by role. Strays and genre props add on top.
- **Music and sound (optional, off by default):** calm procedural chiptune per region via WebAudio, tracks unlocking as you explore (a RuneScape homage), and soft sounds for level-ups.

## 12. Honesty, privacy, performance

- Every XP source is idempotent and capped. Deleting and re-adding a task doesn't re-pay. The Chronicle shows where every XP came from ("Focus 1,000: focus session 09:10–10:00").
- The privacy rules from steps 1 and 2 stand. New integrations (calendar, GitHub, email) are opt-in, read-only first, and marked on the map as places where data *arrives from* or *goes to*.
- Canvas rendering stays light. Regions load one at a time, and nothing animates in the background while hidden or during focus unless it's Milo's idle loop.

## 13. Roadmap

**Done:**
- **Step 1:** the world, Milo's greeting, Watchkeeping.
- **Step 2:** plots, ideas, and crew-designed buildings.
- **App icon** (2026-09-27): a pixel Milo portrait for small sizes, and Milo at dusk beside his lantern for large ones (`scripts/make-icon.mjs`).
- **The generators** (2026-09-27): the world, rifts and their Elsewheres, strays, map art for the wilds, and the Hearth's tiers.
- **Phase 3, The Hearth and the Wilds** (2026-09-28; spec `CONTRACT-PHASE3.md`):
  - Walk out of Hearthvale's four gates into the endless seeded wilds, with lanterns, ruins, caves, chests, notes, statues and chopping.
  - Real rifts from real signals: late nights, a session waiting 24 hours, Codex capacity, a new building, and the Prologue's crack. They're placed on the frontier by urgency, with echoes in the vale.
  - Daily wild rifts, with Elsewheres to walk and stitch, and the ladder below them.
  - The Hearth, with the Stockade, the War Table, the Gate Bell and the first ward-post.
  - The Prologue, and a map with fog of war.
  - 500+ unit tests and 47 Electron checks.

Each phase below ships useful features and game features together, with tests and a visual review, like steps 1 and 2. Each also raises the Hearth by the tier its features make possible.

### Phase 3: The Hearth and the Wilds (MILO becomes a world)
- **Useful:**
  - **Real rifts on the frontier** from the signals MILO already sees, each placed by urgency and naming its real cause:
    - Nocturne: sessions past your evening bell or after midnight.
    - Gothic: the Knocking, for a crew member waiting 24+ hours.
    - Neon: Codex capacity past 85%.
    - Starlight: a building design landing.
  - **The War Table**: every open rift with its real cause, on a map and in a list.
  - **The Gate Bell**: one calm note when a rift reaches the walls.
  - **The first ward-post**: one auto-ward rule, visible and reversible.
- **Game:**
  - **The wilds in the engine.** Walk out through a gate and the world streams in around Milo, 3×3 chunks generated in idle time, drawn at the vale's scale with its own tree and rock sprites. The map view uses `wildsart.js`, with fog of war.
  - **The rift engine**: genre bleed (proven by `scripts/rift-preview.mjs`), tears, stages, generated strays, and the Stitch, Ward and Let go actions.
  - **Wild rifts** every day. **Stepping through** a rift into its generated Elsewhere: walk it, meet its strays, find the stitch point (combat comes with the Kit).
  - **Lanterns** to light, rest at and travel between.
  - **Points of interest**: ruins, caves, chests, notes from the Old Company, hamlets.
  - **Echoes** in the vale.
  - Every story region is there to walk to as land, waiting in the Hush until it wakes in its own phase.
  - **The Stockade** (tier 2), built with birch and ash.
  - The Prologue, "The Lantern Wakes", with its crack past the north gate.
- **Proof:**
  - Each real rift opens from its real signal, outside the ward, closer when more urgent, and seals when the signal clears.
  - No rift ever renders inside the vale.
  - The same seed gives the same world.
  - Chunk generation stays under budget (15 ms).
  - The Stockade's requirements read from real counts.

### Phase 4: The Adventurer's Kit (MILO becomes a game)
- **Useful:**
  - The Log doubles as the activity feed and command bar, with plain-words commands and `::` spells.
  - Right-click menus on everything.
  - The Chronicle (daily and weekly history).
  - Quiet and Adventure modes.
- **Game:**
  - The Adventure HUD (minimap, orbs, tabs, hover text, dialogue box).
  - The skills engine: 24 skills, the XP curve, skill guides, XP drops.
  - Embers and Marks.
  - Examine on everything, with the first 150 examine lines.
  - Day and night from the real clock; seasons and weather.
  - Light combat and Warding in Elsewheres and caves (Soda Dungeon style), with Tale-leads as bosses.
  - Embers gate active play: revealing new ground in the wilds, stepping into rifts, delves. Cartography and Wayfaring level from exploring.
  - The first Riddle Note trail.
  - Milo's Arts renamed.
  - The `content/` pipeline with validators.
- **Proof:** life XP flows from real signals MILO already sees: crew sessions finished → Command; needs-you answered → Command; buildings designed → Artifice. Embers come only from real work, and exploring spends them.

### Phase 5: The Notice Board (Habitack comes home)
- **Useful:**
  - The Town hall task board (one-prompt capture, main/side sorting, corrections, projects, notes).
  - The 50/15 focus timer (Kindle and Banked Coals).
  - Stale-task and scope-creep nudges.
  - Letting go.
  - Projects as delves with milestones and blockers.
- **Game:**
  - Quests from tasks, with the quest journal.
  - Idle gathering during focus: Woodcutting, Fishing, Foraging and Mining in Hearthvale.
  - Field journals.
  - Task rifts:
    - Gothic: stale quests.
    - Iron: too much in progress, scope growing, admin piles.
    - Void: too vague to start.
    - Frontier: due dates.
  - Bright rifts: Summit for focus streaks, Verdant for a balanced week.
  - The first residents: Sergeant Rivet's Dispatch Office, Pip, Sheriff Dusty's Bounty Board.
  - Seamcraft and the first essences.
  - The Blossomfield.
  - Cooking over the campfire.
  - Act I, first chapters, with Mags Quire and the Bindery.
  - Nan Bristle and Hob the carpenter.
  - The Hold's requirements start counting (focus sessions, quests finished).

### Phase 6: Commissions (Dispatch)
- **Useful:**
  - Send Claude or Codex to build a building's next level (or any task), in its project folder, under a ward.
  - Proof checks run and building levels are proven.
  - Results review.
  - Cancel and retry.
  - Mana from real rate limits.
  - Loop and failure detection (Watchkeeping L3–L4).
- **Game:**
  - Commissions shown as expeditions, and optionally as watchable battles.
  - "!" markers and crew dialogue for needs-you.
  - Neon rifts for loops and failing checks; Noir rifts for crew questions and unexplained failures.
  - Juno's Fixit Kiosk and Holloway Investigations.
  - Lumi's night watch over overnight runs.
  - Crew levels and titles.
  - Spoils chests.
  - Materials from real outputs.
  - Fusion rifts and Maelstroms.
  - Genre skins for buildings in the step 2 kit.
  - **The Hold** (tier 3):
    - the Sally Port (the commission queue);
    - ward-towers (two auto-ward rules);
    - the Barracks for residents;
    - outposts in explored land.

### Phase 7: The Grimoire and the Owl (spells and voice)
- **Useful:**
  - The command palette and automations: Pocket Note hotkey, Found Things (local search), Quiet Hours, Gathering Echoes (daily summary).
  - Inscribe (custom spells) with wards.
  - Push-to-talk voice through local Whisper.
- **Game:**
  - The spellbook, Spellcraft, and Small Spells.
  - The Whisperwood region.
  - Whisper's quests.
  - The Listening Stones.

### Phase 8: Mistmere and the Tide (Timekeeping and the first new regions)
- **Useful:**
  - A read-only calendar connection (ICS or Google) that clears the Harbor fog: ships are events, the Tide Clock shows deadlines, Frontier rifts ride in, and big events bring a Titan (with Chief Kurogane's Hangar).
  - The Dawn Bell morning brief.
  - Campfire tales at dusk.
- **Game:**
  - Mistmere Harbor as a walkable region.
  - Waystones (sleeping Lanternkeepers).
  - T2–T4 resources.
  - Smithing, Crafting and Alchemy.
  - Gear sets, including the Quiet Hood and the Night Watch Lantern.
  - The weekly Tide Market.
  - Act II and the first story delve boss (The Drowned Bell).
  - The first festivals.
  - **The Keep** (tier 4):
    - the Dawn Bell tower;
    - Ballistae (auto-dispatch rules);
    - Lookouts (a 7-day horizon);
    - waystones between outposts.

### Phase 9: The Stacks and the Forge (Lore and code)
- **Useful:**
  - Decision memory per project (Lore L1–L2).
  - Search over notes and decisions.
  - Git repos as forges: commits, PRs and CI, with Mend the Forge commissions.
  - Starfall weekly review.
- **Game:**
  - The Archive Peaks with Oriel (Act III: the Index of Tales and the Bindery's hidden wing), and Cinderforge with Brannoch (Act IV).
  - The Painted Hills, Ivory College and Dicing Downs attached to their buildings.
  - Books and the library.
  - The handmade story **Elsewheres**, each genre's home beyond the generated ones: Lumen Row, Afterhours, Hollowmoor, Ironvale Front, Grayrain and Dustwater Junction first.
  - Fusion recipes and the Mixtape of Worlds.
  - The Lorekeeper (opt-in).
  - **The Castle** (tier 5):
    - guild halls;
    - the Hangar (Titan defence);
    - the Great Hall, where Starfall is held.

### Phase 10: The Greyreach and the Far Shore (endgame)
- **Useful:**
  - Backlog grooming at scale.
  - Archiving with ceremony.
  - Year in review (the Long Look).
  - Lantern Trials (monthly goals).
- **Game:**
  - The Greyreach Maelstrom and the Someday King's masquerade of strays (Act V).
  - The Far Shore, the Garden of Statues and the Great Lighthouse, which is a bookmark (Act VI).
  - **Act VII: The Margin.** Meeting the Beginner; the Age of Doors (every befriended Elsewhere becomes a door).
  - The remaining Elsewheres: the Unmeasured Deep, Titan Bay, Solace Gardens, Starfall Plaza, Cloudgate Peak and the Backhalls.
  - The Night of Many Tales (31 October).
  - Mantles.
  - Festivals all year.
  - The Skyward Isles.
  - The first "far shelf" genre packs.
  - **The Citadel, the Kingdom and the Bright Kingdom** (tiers 6 to 8):
    - the Observatory;
    - siege engines;
    - districts;
    - the Lantern Spire;
    - royal decrees;
    - the coronation;
    - the Bookmark.
  - **The Unmapped Lands and the endless ladder:** deeper tiers, far-land genre mixes, and the deepest rung you've reached kept in the Chronicle.

### Housekeeping (slots in wherever it's needed)
A packaged Windows build and installer, starting in the tray with background watch (the Night Watch Lantern), phone pings (opt-in), backups and export (Carve a Waystone), and updates.

## 14. Open questions for Chris

1. **Adventure mode by default?** The plan says yes, with Quiet mode one click away and focus auto-dimming.
2. **Ember gating.** Is "active play costs Embers, Embers come from real work" the right amount of discipline, or should rests simply be free play?
3. **How much of Habitack's combat to keep.** It could become Warding and delves as planned, or stay a small side game.
4. **Life-skill tagging.** Tasks are auto-tagged into Artifice, Scholarship and the rest by rules like Habitack's classifier, and you can correct them. Are any life areas missing (fitness, social, money)?
5. **Sound.** Should procedural music and sounds stay off by default?
6. **Rift genres.** Are these the right twelve, and which "far shelf" genres (space opera, pirate, post-apocalyptic, steampunk, dark fairy tale, samurai, heist and more) should come first?
7. **How spooky?** Gothic and Void are cosy-spooky by default, with a "gentle rifts" setting to soften them further. Is that the right default?
8. **Your world's seed.** The plan makes one seed at first run and shows it in Settings, so your Hushlands are yours and stay the same. Should you be able to reroll it before Act I, and should there be a way to visit someone else's seed?
9. **The frontier's reach.** Real rifts open about 10 tiles beyond the ward when urgent and about 40 when not. Is that the right spread, and should the Gate Bell (one desktop note when a rift reaches the walls) be on by default?
