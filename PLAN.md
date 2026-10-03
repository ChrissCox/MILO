# MILO: the plan

**MILO** (Monitor and Interface Layer for Operations) is Chris's personal operations companion, and now also a point-and-click RPG. It is set in the **Hushlands**, an original world in the spirit of RuneScape's skills and quests, Albion's gathering-and-crafting sandbox, and Frieren's gentle, time-soaked journeys. Milo still watches over Chris's AI crew, projects, schedule and apps. Now the whole thing is also a world worth wandering, with skills to level, quests to follow, lore to find, and a long road to walk.

The world bible lives in [`LORE.md`](LORE.md), the rift codex in [`RIFTS.md`](RIFTS.md), the fortress, the endless world and the frontier in [`WORLD.md`](WORLD.md), and the party, the camp and combat in [`COMBAT.md`](COMBAT.md). Build contracts for finished steps are in [`CONTRACT.md`](CONTRACT.md) (step 1) and [`CONTRACT-STEP2.md`](CONTRACT-STEP2.md) (step 2).

---

## 1. The one rule

> **Real work is the fuel. Every system earns its place twice: once by being useful, once by being fun.**

MILO is not a game bolted onto a dashboard, and it's not a dashboard hidden inside a game. Each feature has a *real job* (show what needs you, start a focus session, send Codex to fix a build) and a *game form* (a quest marker, lighting the lantern, a crew commission). If a mechanic has no real job, it has to be cheap, calm and optional. If a real feature has no game form, we give it one: its door on the map, its NPC, its spell.

## 2. Design pillars

1. **The game plays itself while you work; you play it while you rest.** During a 50-minute focus session Milo gathers, crafts and explores on his own, idle-game style, and the HUD dims. During the 15-minute rest you play: delves, quests, trading, decorating. Active play costs **Embers**, and Embers only come from real work. So the game can't eat your day, and the day feeds the game.
2. **Nothing real is faked, nothing fake is paid for with reality.** Life skills only rise from real events MILO can see (finished tasks, completed focus sessions, crew runs, deadlines met). Wild skills only rise in-game. Buildings only level up when a real feature passes its check (step 2's rule).
3. **Calm, never punishing.** No death, no decay, no streak-shaming. Rifts (real problems, shown as other genres bleeding in) wait patiently and can be stitched, warded, or let go. If the whole party goes offline, everyone wakes at the last lantern they rested at, with everything they found, and nothing is lost but the Embers it cost to go in.
4. **A world with memory.** Finished things leave marks: flowers where tasks were done, statues for milestones, anniversaries Milo remembers. The Chronicle keeps your history like a travel diary, and the Far Shore keeps what you retire.
5. **Readable like RuneScape.** Left-click does the obvious thing, right-click offers every option, **Examine** works on everything, XP drops float up, every skill has a guide showing what its levels unlock, and the log tells you what happened.
6. **Private by default.** The step 1 and 2 privacy rules hold. Game content is local. Crew calls only carry what the rules allow, and anything that leaves the PC is visibly marked.
7. **Content is data.** Items, quests, dialogue, examine text, books, spells and regions live in `content/` files with validators, so new lore keeps flowing without code changes.
8. **Genres collide on purpose.** Problems arrive as other stories bleeding through **rifts** (cyberpunk, a night city, gothic horror, dieselpunk, cosmic horror, noir, western, kaiju), and good seasons open bright ones (solarpunk, magical girl, cultivation). The strays who stay turn Hearthvale into Chris's own crossover. The full design is in [`RIFTS.md`](RIFTS.md).
9. **Home is a fortress; its walls are automations.** Hearthvale is sanctuary: no rift ever opens inside it. It grows from a camp to a kingdom in eight tiers, each earned with real progress, and every defence is a real automation (auto-ward rules, dispatch rules, earlier warnings), so a stronger kingdom means fewer problems ever reach you. Distance from the walls *is* urgency. See [`WORLD.md`](WORLD.md).
10. **The world never ends, and it keeps to the story.** Beyond the gates the Hushlands are generated from a seed, chunk by chunk, forever: coasts, rivers, ruins, caves, lanterns, hamlets and rifts, with the story's regions always where the Long Road puts them. Exploring is Minecraft's endlessness with Elden Ring's sense of discovery, at MILO's pace. Rifts are generated too, so there's always another one, and a ladder beneath every stitched wild rift that goes down forever.
11. **Your company goes with you, and learns from you.** Fights are small turn-based tactics battles with no dice. You lead Milo and three companions you gathered at camp and picked at the campfire. Each round the strays show what they're about to do, everyone, Milo included, drafts their three actions from a notebook of how you've played them, and you change whatever you'd do differently, then press Run. The longer you play together, the more their drafts match yours. Three actions a round, in the spirit of Pathfinder 2 but with MILO's own names, make each round a small puzzle about where to stand and what to spend. Nothing is rolled: a hero's **heat** sets how far their results swing (Cool is steady, Hot is streaky), and height, light and a found weakness tilt the odds. Every companion's kit echoes their real service, so a fight teaches what they do for you. Nobody dies, and any fight pauses between two actions. See [`COMBAT.md`](COMBAT.md).

## 3. The translation table: real life ↔ the Hushlands

| Real thing | In the Hushlands | Where you see it | Real use |
|---|---|---|---|
| A task on your board | A **quest** (main or side, as Habitack sorted them) on the Town hall notice board | Quest journal, board | One-prompt capture, triage, priority |
| A project with milestones | A **delve**: a dungeon whose floors are milestones and whose locked doors are blockers | Delve map | Project progress at a glance |
| A 50-minute focus session | **Kindling the lantern**: Milo gathers while you work | Focus orb, idle gathering | The 50/15 timer |
| A focus session finished while the company is out | A free **Breather** for the party: *"You worked. They sat down for a bit."* | The party's portraits, the Log | Work keeps the company going |
| The 15-minute rest | **Banked coals**: rest-time play, Hearthkeeping XP | Break banner | Healthy breaks |
| A rest break, out with the company | Time for a fight or two (a stray room takes about 2 minutes in Guided play), with a **Breather** of tea after a fight; when the rest ends, any fight pauses at the next action | Elsewheres, caves, the victory card | Breaks that stay breaks |
| A task left untouched 14+ days | A **Gothic rift**: portrait wraiths whose eyes follow the forgotten quest | The frontier; its echo on the notice board | Stale-task nudge |
| A task whose steps keep growing, or too much in progress | An **Iron rift** (dieselpunk): tin clerks, smog, a quota that keeps rising | The board, the Dispatch Office | "Split this up", in-progress limit |
| A task too big or vague to start | A **Void rift** (cosmic horror): the Unbounded, something too big to see | Over its quest | Break it into steps |
| Working past your evening bell, or after midnight | A **Nocturne rift** (a night city at 3 a.m.) and Lumi on her bicycle | The frontier toward the Whisperwood | Go to bed; the night watch |
| Tasks untouched 30+ days | They drift to the **Greyreach**, the backlog wilderness | A region on the map | Backlog grooming, letting go |
| A Claude or Codex session | A **Wayfarer** on a commission | Crew on the map, crew tab | Watchkeeping (step 1) |
| Your crew's finished work, and whether they're working right now | **Wayfarers in the company**: they fight at their real work level, with no ceiling, and when one is really working a **likeness** goes out instead (the Scribe's Clay Likeness, the Artificer's Slate Double) | The muster, fights | Real work shows in play, and crew state is never faked |
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
| A stray who stays after its rift is stitched | A **resident** with a shop, a quest line and a real service, and, for seven of them, a companion in the company | Hearthvale and beyond, the muster | Each brings a feature (the night watch, the bounty board, task-splitting) |
| A stray who stays after a wild rift is stitched, or a Tale-lead who bowed | A **regular**: a companion with no real service, who fights at the Road level with one genre signature | Camp, the muster | Play for rests; every genre can join the company |
| Setting out on a rest | **The muster**: click the campfire and pick three companions to go with Milo, or keep *Same as last time* | The campfire, `::muster` | Out in a click, rested, with a glance at who's really working |
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

## 4. Progression: seven tracks that never cross wires

1. **Your skills (1–99).** 24 skills in three families, RuneScape-style, on the classic XP curve (level 99 = 13,034,431 XP). Every skill has a guide listing its unlocks, and every 99 earns a **Mantle**.
   - **Life skills (from real events only):** Artifice (code and apps), Scribing (writing), Illumination (art and creative work), Scholarship (study and reading), Stewardship (errands and life admin), Command (leading the crew), Focus (completed focus sessions), Hearthkeeping (rest, breaks, stopping on time) and Tidereading (deadlines met).
   - **Gathering (in-game, mostly idle during focus):** Woodcutting, Fishing, Foraging, Mining, Gardening.
   - **Making and roaming (in-game, active during rests):** Cooking, Smithing, Crafting, Alchemy, Construction, Cartography, Wayfaring, Warding (combat), Spellcraft and **Seamcraft** (stitching rifts, weaving genre essences into fusion gear and building skins).
2. **Milo's Arts (feature levels).** Watchkeeping, Dispatch, Timekeeping, Lore, Voice and Tinkering. These are the step 1 "skills", renamed so they don't collide with yours. They level only when a real capability ships and its proof check passes.
3. **Crew levels.** Each Wayfarer levels from real finished work: commissions completed and sessions observed. They gain titles and cosmetic gear. They're never paywalled or nerfed.
4. **Buildings.** Each app's level tree (step 2), proven feature by feature.
5. **Story and renown.** Quest points, faction renown, titles, Glimmers (memory fragments), Small Spells, books and statues: the collector's layer.
6. **The Hearth.** Eight tiers from the Camp to the Bright Kingdom ([`content/fortress.json`](content/fortress.json)). Each tier needs real progress (weeks with MILO, focus sessions, proven buildings, residents, story acts), plus game materials and Construction, and brings real defences. Its ward widens with each tier: 0, 12, 28, 48, 72, 100, 140 and then 200 tiles.
7. **The Company.** Milo, the residents and the regulars share one **Road level** (1–12), earned from play and from stitching real rifts, and each named companion gains **warmth** (Stranger to Fireside), which Phase 5 widens into **approval** for every named person (earned in conversation, remembered, and the only way anyone comes to camp) and two personal **paths** (one at level 3, the second at Friend warmth). It touches the other tracks in three named places only: the Road level to the Hearth's cap and to Warding's XP, the Wayfarers' fighting level to crew levels with no cap, and warmth to one real habit each. See [`COMBAT.md`](COMBAT.md) §2.7, §5.2 and §12.

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
| **Embers** | Real work only: focus sessions (10), honoured rests (5), quests (5–15 by importance), commissions (5) | Active play: delve runs (20), story chapters (10), exploring new ground in the wilds (1 per chunk revealed), stepping into a wild rift (5, more further down the ladder), a real rift's Elsewhere or challenging a field boss (5), a cave (3), market rerolls (2) | Bank caps at 100 so play keeps pace with work |
| **Marks** (coin) | Quests, loot, selling crafts at the Tide Market | Tools, decor, services, cosmetics | Purely in-game |
| **Materials** T1–T8 | Gathering, delve loot, real outputs (reels, parts, scrolls) | Crafting, construction, building cosmetics | Albion-style tiers by region |
| **Genre essences** | Stitching rifts (Neon shards, Grave wax, Diesel cogs, Moonlit coins, and more) | Seamcraft: fusion gear, genre skins for buildings, music tracks | Maelstrom glass, the rarest, comes from 3+ genres at once |
| **Mana** | Mirrors real crew capacity (Codex rate limits now; Claude when visible) | Crew commissions and spells that call the crew | Can't be bought or farmed; it *is* reality |
| **Renown** | Real work in a faction's domain, plus faction quests | Faction gear, titles, regional perks | Eight factions (see LORE.md) |

**Embers pay for the trip, not the swing** ([`COMBAT.md`](COMBAT.md) §12). The company adds the spends for real rifts' Elsewheres, field bosses and caves; the other costs above stand. Fights, *Try again*, rests, the muster and watching a commission cost nothing, four go out for the price of one, and going back in after everyone went offline is free once per rift. The bank still caps at 100, but a lifetime count keeps going past it, and a ledger of the newest 300 entries in the Chronicle shows where every Ember came from and went.

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
- **The combat HUD** ([`COMBAT.md`](COMBAT.md) §13): in a fight the minimap folds to its orbs and the side tabs collapse. The round planner runs along the bottom: three action slots and a reaction for each hero, holding their draft with its confidence and a *why?*, a heat gauge beside each portrait, and the Run button. Strays wear their telegraphs, the initiative ribbon runs along the top, the grid previews reachable tiles, paths and areas, and hovering any action shows its four odds (Critical, Hit, Graze, Miss) and what each would do. The odds you see are the odds used. The Log gains a Combat tab.
- **Accessibility:** everything clickable on the canvas is mirrored in the place list and tabs; keyboard walking; reduced motion; text scale; the crew strip and alerts stay screen-reader friendly.

## 8. The world map (details in LORE.md)

The Hushlands open region by region. Each region is a game area (tiered resources, creatures, delves, NPCs and lore) *and* a real domain. The regions are story anchors in a generated world: their places are fixed by the Long Road (north to the Whisperwood, east to Mistmere, west to Cinderforge, and so on), while the land between and beyond them comes from the world seed and never ends ([`WORLD.md`](WORLD.md) §5).

| Region | Tier | Real domain | Opens when |
|---|---|---|---|
| **Hearthvale** (home) | T1–T2 | Overview, your buildings, the watchtower | Now |
| **The Whisperwood** | T2–T3 | Voice, notes, thought capture | The Last Bridge in Phase 4; the wood itself in Phase 7 |
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
  - **Invite to stay** (after a stitch, a stray or Tale-lead can become a resident, or, from a wild rift, a regular in the company).
- **Rules.** Every rift names its real cause in plain words, never grows past Gaping, and never harms anything. Horror genres stay cosy, and each genre can be switched off.
- **Fusions.** When one real thing carries several signals, its rift fuses genres. A build failing at 3 a.m. is *Neon Nocturne*; a failing check nobody's looked at for weeks is a *Haunted Machine*. Three or more make a Maelstrom.
- **Residents.** Stitched strays can stay once they like you enough (the approval system, Phase 5), each bringing a real service; seven of them also join the company with a kit that echoes it, and the rest fight as guests in their own stories:
  - Lumi the vampire keeps the night watch over overnight crew runs.
  - Sheriff Dusty keeps the deadline bounty board.
  - Sergeant Rivet holds your in-progress limit.
  - Pip the voidling splits big tasks.
  - Mae Holloway tracks open questions.
  - Juno explains failing checks.
  - Lady Vesperine keeps the Unanswered Letters desk.
- **Genre skins.** Any building can be redrawn in any genre you've befriended.
- **Delves are projects and adventures.** A *real delve* is a project: floors are milestones, rooms are tasks, locked doors are blockers, and the boss is the final deliverable. A *story delve* is a short, handmade dungeon for a rest break (20 Embers), with lore, Mimics whose bite tickles, canon foes who settle rather than fall and often have a bow of their own, and a boss ([`COMBAT.md`](COMBAT.md) §8.5).
- **Combat is turn-based party tactics, with no dice** ([`COMBAT.md`](COMBAT.md)). Milo and up to three companions you picked at the campfire fight on a grid that fades in where everyone stands. Each round is planned, then run: the strays show their next moves, everyone drafts three actions and a reaction, Milo included, you change what you'd do differently, and Run plays the round in three ticks. Every action lands as a Critical, a Hit, a Graze or a Miss. The odds come from the hero's **heat**, which sets how far results swing, and from **edge** (height, cover, light, a found weakness), and you see them before you commit. Integrity, damage kinds with flat resistances and weaknesses, conditions that count down, spells of one to three actions, height, cover, light and surfaces, and short and long rests (Breathers and Campfires) fill it out. Warding and Spellcraft grow from play.
  - **They learn from you.** Each hero, Milo included, keeps a notebook, stored only on this PC, of the rounds you've played with them: the situation in relative terms, and what you had them do. Your changes count double, their own improvising never counts, and nothing is forgotten unless you strike it out. Every draft shows a confidence and a *why?*, a sync score shows how often you accept their drafts unchanged, and at camp you can read a companion's habits, strike one out, or have one companion teach another at the fire.
  - **Variety without dice.** Heat climbs with every extra attack in a turn and cools between turns, so pressing hard is a gamble you choose. Strays learn your habits as far as their strength allows: lackeys never do, ordinary strays a little, elites and Tale-leads more, and more again when they're above your level. Genres remember your habits across fights, and Tale-leads can feint. Each genre adds its own noise at Run (Neon lag, drowsy Nocturne, Void out of order). All of it shows before you press Run, and noise alone never takes the whole party down.
  - **Where fights happen.** Only where you chose to go: Elsewheres, caves, story delves, and field bosses you challenge. Never in the vale, on the roads or at a real rift on the frontier, and strays never ambush.
  - **Tale-leads are three-phase bosses** (the Opening, the Twist and the Last page; two phases at hairline), each built on its rift's generated mechanic. Every one has a **bow**, a way to win without bringing it to 0 Integrity, which pays a quarter more loot, and a bowed wild lead can be invited to stay. In a real rift's Elsewhere a fight never mends the real thing: the lead yields, names the cause, and its card offers Stitch, Send the crew, Ward and Let go.
  - **Strays are settled, not slain.** A stray's bar turns green check by check as it's worked on, and at 0 it waves and drifts home through the tear. Talking a room down pays exactly what fighting it does. A hero at 0 Integrity goes offline until an ally spends two actions to Reboot them, and *Try again* is always free.
  - **Modes and ways to play.** Storybook (steadier, and strays don't adapt), Long Road (the default) and Maud's Table (hotter and noisier, with strays that learn faster) all pay the same. In Guided play (the default) the companions' drafts are ready each round, so a round you agree with is one key; you can also write every action yourself, let the company play itself (the Soda Dungeon idea, kept as *Let them handle it*), or have a fight told as a campfire summary. A stray room fits in a rest, and any fight pauses between two actions and resumes exactly where it stopped.
  - **The party.** Companions are the Wayfarers, the residents and friends met on the road (fifteen named by Phase 10, counting Milo), and the regulars you invite from wild rifts ([`COMBAT.md`](COMBAT.md) §2). The Wayfarers fight at their real work level, with no ceiling. When Claude or Codex is really working, a **likeness** goes out instead (a Clay Likeness or a Slate Double, with identical stats), so a Wayfarer's state on the map is always their real state.
  - **Commissions as watchable expeditions** (Phase 6). A running commission can open as a battle in the same renderer, where each finished real turn plays as one action and the final blow waits for the real check. A pass is victory and a failure a draw, never a defeat, and it costs nothing.

## 10. The Grimoire and Voice

Spells are MILO's commands and automations, collected like Frieren's small spells. You can cast them by clicking, by hotkey, with `::` in the log, or by voice (Whisper push-to-talk: "Milo, kindle the lantern").

- **Useful spells** (examples, full list in LORE.md): Kindle (focus), Banked Coals (rest), Dawn Bell (brief), Found Things (search), Quiet Hours (Do Not Disturb), Pocket Note, Summon the Scribe or Artificer (dispatch), Mend the Forge (fix a failing check), Bloom a Clip (clip workflow), Tidecount (deadlines), Wayfinding (jump anywhere), Letting Go, Carve a Waystone (backup), Starfall (weekly review).
- **Small Spells** are purely for joy: Warm Tea, the Other Side of the Pillow, Unfold a Map Perfectly, Find the End of the Tape. Oriel collects them, and so will you.
- **Inscribe** (Tinkering): write your own spells, either a chain of actions or a crew prompt template with a ward level.
- **Wards** are permission levels for crew spells: *Look only*, *Suggest*, *Change files in a project folder*, *Anything, with my OK first*.

## 11. Lore and content pipeline

- **LORE.md is canon.** It holds the style guide, cosmology, history, regions, characters, bestiary, grimoire, items, story acts, festivals and books.
- **`content/` holds the game data:** `skills.json`, `xp.json`, `items.json`, `people/npcs/*.json` (one sheet per person, Phase 5b), `spells.json`, `examine.json`, `quests/*.json`, `dialogue/*.md` (a tiny script format), `books/*.md`, `regions/*.json`, `festivals.json`. Tests check that every reference resolves, every name exists in the lore index, and every string follows the voice rules.
- **Targets for "tons of content"** by the end of Phase 9: 300+ examine lines (500+ with the running gags), 60+ quests (main and side; 25+ of them small errands for the running-gag cast), 40+ NPCs with dialogue, 40+ spells, 200+ items, 30+ books, 12 regions, 9 story delves and 6 festivals. For rifts: 12 genres (more from the "far shelf" as content packs), 15 named fusions, 40+ strays, 13 residents, 12 Elsewheres and a dozen-plus fusion recipes.
- **`content/genres.json` already exists.** It holds each genre's role colours, weather, signals and the fusion table. `src/world/genres.js` turns role colours into full palettes. Tests will check every genre has every role and every fusion names real genres.
- **Lore at the scale of Skyrim and the Forgotten Realms.** The goal is a world with more history, people, books and rumours than anyone finishes: every region with its own past, factions with grudges, hundreds of readable books and notes, and a living cast. That means a lot of writing, so it is spread across every phase from Phase 5 on, not saved for the end. LORE.md stays canon, and each region ships with its names, its books and its small famous people before its quests do.
- **Funny and ironic lore is part of the voice.** Each region gets a handful of solemn experts in tiny things (LORE §15.1: "Jonas, inventor of the second spoon", the Cabbage Man whose cart is always lost again). They recur across regions as signs, letters, plaques and book dedications, and each has a quest that ends in a kindness. The jokes are specific and affectionate, never mean.
- **The Lorekeeper** (optional, opt-in, Phase 9+): the crew drafts new side tales, rumours and books from a weekly *numbers-only* summary (counts and categories, never session text), in the LORE.md voice. Chris approves each one before it enters the world.
- **Art pipeline:** hand-authored string grids (as now), the step 2 kit for buildings, and crew-drafted sprites validated against the palette, then reviewed by eye. Genres multiply the art for free: every sprite, tile and building is drawn once in palette keys and recoloured per genre by role. Strays and genre props add on top.
- **Music and sound (optional, off by default):** calm procedural chiptune per region via WebAudio, tracks unlocking as you explore (a RuneScape homage), and soft sounds for level-ups. It all arrives in Phase 11, the last phase, once the world is finished enough to sound like itself.

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
- **Phase 4, The Adventurer's Kit and the Company** (2026-10-01; spec `CONTRACT-PHASE4.md`):
  - Embers, the Chronicle, Kindle and Banked Coals, the Adventure HUD, the Log and right-click menus, skills, the satchel and Examine.
  - The fight: plan the turn, Run, degrees, heat and edge, Integrity and damage kinds, the planner, the three plays and "They learn from you" notebooks, saved after every action and resumed on the same tick.
  - The Company: Jev, the Tollkeeper, regulars from stitches, the muster, followers in the wilds, and the camp fire by day and night.
  - Caves, field bosses by Challenge, suggested levels, Sneak, day and night, and the first Riddle Note trail to the Last Bridge.
  - Walking is real movement now (paths, no diagonals, steady click marker).
  - 1,690+ unit tests and the 47 Electron checks.

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

### Phase 4 (done, 2026-10-01): The Adventurer's Kit and the Company (MILO becomes a game)
This is the gameplay phase, with combat as its spine. It ships in slices, each with useful and game features together ([`COMBAT.md`](COMBAT.md) §17).
- **4.0 Groundwork:**
  - Embers: the wallet, a lifetime count and a ledger, earned from signals MILO already sees.
  - The Chronicle (daily and weekly history), where the Ember ledger and every fight's summary live.
  - Kindle and Banked Coals (the 50/15 focus timer), brought forward from Phase 5, because the company's rests and the focus pause need it.
  - The Log doubles as the activity feed and command bar, with plain-words commands and `::` spells; right-click menus on everything.
- **4.1 The first fight:** the rules on paper (three actions and a reaction, the four degrees, heat and edge, Integrity and damage kinds, the grid, the round and a seeded sim, all headless); one room of a wild Elsewhere as the board, with the round planner and Run, and companions drafting from their personalities alone; saving after every action, and pausing at the next action when a focus session starts or a rest ends.
- **4.2 The full rules:**
  - Callings to level 5 (the Wayfarers' to 12), about 10 spells, conditions and weapon arts; Road XP, Warding and Spellcraft; Breathers and Campfires wired to real rests.
  - Height, light, the Hooklight and the 11 surfaces.
  - The bestiary, with temperaments, telegraphs, Sneak and talking down; resistances and weaknesses by damage kind; elites; strays that adapt by rank and level, and Tale-leads that feint; one Tale-lead mechanic per genre with its bow, and a plain fallback for the rest; each genre's noise at Run; the three modes.
  - **They learn from you:** each companion's notebook, drafts with confidence and *why?*, the sync score, and the notebook page at camp.
  - Every way to play (Guided, Command, *Let them handle it*, *Tell me how it went*) on one shared round driver.
- **4.3 The party and the camp:** Jev; **regulars** from wild stitches and bows (the Stockade has room for 2); the muster, likenesses and following; field skills; the Road level and the Hearth's cap; work levels and titles; Margin Notes and Spare Parts; Cheers; conversations that open on what you know and who's with you; and companions teaching each other at the fire.
- **4.4 The wilds and the rest of the Kit:**
  - Caves with canon foes; field bosses by *Challenge*; suggested levels on the rift panel and the War Table.
  - The Adventure HUD (minimap, orbs, tabs, hover text, dialogue box), with Quiet and Adventure modes.
  - The skills engine (24 skills, the XP curve, skill guides, XP drops), Marks, and Examine on everything, with the first 150 examine lines.
  - Day and night from the real clock; seasons and weather.
  - Cartography and Wayfaring level from exploring, and revealing new ground costs 1 Ember a chunk.
  - The first Riddle Note trail, which ends at the Last Bridge, where the Tollkeeper can be out-riddled and joins. The Last Bridge, at the Whisperwood's southern edge, wakes with the first trail, ahead of the rest of the wood (Phase 7).
  - Milo's Arts renamed.
  - The `content/` pipeline with validators.
- **Animation track:** its own lane beside the slices, in waves A0–A2 (placeholder frames with 4.1; the rigs, the stray poses and the effects with 4.2; Jev, the Tollkeeper and camp scenes with 4.3 and 4.4). That's about 150 hand-drawn frames, most of the rest derived or procedural, and every wave ends with a capture sheet looked at beside the vale's art and iterated until it sits right ([`COMBAT.md`](COMBAT.md) §14).
- **Proof:**
  - Life XP flows from real signals MILO already sees: crew sessions finished → Command; needs-you answered → Command; buildings designed → Artifice.
  - Embers come only from real work, each pays once, and exploring spends them; the Chronicle lists every Ember with its source; a 50/15 cycle under `MILO_NOW` survives a relaunch and pays once.
  - 1,000 seeded fights end with no stuck state, replaying the commands equals the saved battle, and the odds shown are the odds used (within 0.5% over 100,000 seeded outcomes).
  - Notebooks learn only from drafts you accept and changes you make, never from a companion's own improvising, and never drop a note on their own. After 20 scripted fights, a companion's drafts match the scripted player's choices at least 80% of the time, and their confidence stays low in a genre they've never met.
  - Fight and win, and a keyboard-only round, in the Electron checks; a relaunch mid-fight lands on the same tick; a focus session and a rest's end each pause at the next action.
  - The tuning suite passes at levels 1–5 in every mode, and the auto modes pay the same as Command.
  - Arenas keep every wall face and never merge rooms, and Phase 3's layouts are unchanged.
  - Recruit a regular, pick them at the campfire over a Wayfarer and take them out through a gate; a Wayfarer above the Road level only makes fights easier; sight never starts a fight in the wilds.
  - By the end of the phase the muster can offer six companions (the Scribe, the Artificer, Jev, the Tollkeeper and two regulars) for three places.

### Phase 5: The Notice Board (Habitack comes home)
- **Built so far (2026-10-02):** 5.0, the Board. The HUD's Quests tab opens it: one line adds a quest, which is sorted main or side by Habitack's rules (and corrected with a tap), tagged with the life skill it trains, and moved through To do, Doing and Done, with steps and notes. Finishing a quest pays Embers (3 main, 2 side) and Stewardship-style XP once. `src/quests.js`, `src/state5.js`, `src/ui/board-view.js`.
- **5.2 (2026-10-02), the Town hall:** a Town hall stands on the upper road, east of the watchtower, and opens the Board. The Board gained Projects ("Name: task" files a quest under one), a Pocket for stray thoughts that become quests, Letting go (a quest leaves with no mark and can come back), a "Waiting a while" section (To do after 14 days, Doing after 7, with Start / Keep / Let go), a note when more than five are in progress, and one quiet word from Milo a day at most about what has waited.
- **5.1 (2026-10-02), the first people:** three of the running-gag cast stand on the north road, each a person to talk to (LORE §15.1): Wendell, Gorrin Teague the Cabbage Man, and Jonas Pennywhistle, inventor of the second spoon. Click one and a panel opens with their portrait (Milo's chibi in their own colours), the subject they raise, and your ways of answering. None is labelled: each is a kind word, a joke, a favour, the plain truth or shared craft underneath, and what fits them earns approval, what puts them off costs a point, and some things simply slide off. You learn which by trying, and the journal page records it. Moments that matter end with "Name will remember that" and are kept in their words. Three subjects a day, then they'd rather get on. At Fond, a **Come to camp** option opens: they come if there's a bed, sit by the fire (and sleep when the camp does), and leave the road. `src/people.js`, `src/ui/people-view.js`, `content/people/npcs/*.json`.
- **5.5 (2026-10-02), errands and Act I:** once someone is Warm, **Do you need anything?** brings their errand: a want, a little doing, and a kindness. Steps are things MILO already does (stand somewhere, cook at the fire, bring what Milo gathered). Finishing it earns approval, a "will remember that" and a keepsake in the satchel, never Embers. Wendell wants someone to stand at both ends of the road, Gorrin wants six birch for a wheel, and Jonas wants a soup that deserves the second spoon. The Board gains an **Errands** tab once there is one. **Act I: Hearthvale Rekindled** opens when the Prologue's crack is mended and shows under the Prologue in the story panel; its first five chapters complete on real things, in any order (a real rift sealed, meeting Mags Quire, someone living at camp, five flowers in the Blossomfield, the Tollkeeper joining), and the story card follows Act I once the Prologue is told. **Mags Quire** of the Bindery arrives on the north road with the first chapter; she can be befriended and will never come to camp. `src/errands.js`, `src/acts.js`, `content/people/npcs/mags.json`. Still to come from Act I: the Well of Small Wishes, Hob's Waystone, Letters to Nobody and Starfall, each with the system it needs.
- **5.4 (2026-10-02), camp life:** in Kindle, **While you focus** picks what Milo does (nothing, chop wood, fish, forage or mine). When a focus session completes, the haul comes home once (three to five things, more at higher levels, trout and copper from level 5) with 250 XP in that skill, and the bell's bubble says what came. It can't be farmed: stopping early brings nothing. At **the fire** (a button in the camp panel) the haul becomes what fights already use: Hearthberry cordial (3 berries), Brew of clear morning (3 herbs), Minnow supper (4 minnow, +1 Cheer) and Trout stew (2 trout and a herb, +2 Cheers, Cooking 3), never wasting a full tonic or a full set of Cheers. The Satchel lists what was gathered. The **Blossomfield** is a meadow south of the camp where every finished quest blooms as three flowers. `src/camplife.js`, `src/world/blossoms.js`, `src/ui/fire-view.js`. Still to come: Milo shown at his work during a session, Seamcraft essences, field journals, and Nan Bristle tending the field.
- **5.3 (2026-10-02), task rifts:** the Board's own trouble opens rifts over the Town hall, one of each kind at most, and none names a quest. **Gothic** when quests have waited a while (To do 14 days, Doing 7). **Iron** when more than five have been in progress for a day. **Void** when a quest three days old is too vague to start (no steps, no notes, words like "sort stuff out"). **Frontier** when a quest is due within two days or overdue and has been on the board a day. Quests now have due dates, read from the words ("by Friday", "tomorrow", "10/20") or set by hand. Each rift seals by mending the Board (finish, keep, let go, add a step, move the date), counts as a real stitch, and so pays its 5 Embers and Seamcraft once.
- **Useful:**
  - The Town hall task board (one-prompt capture, main/side sorting, corrections, projects, notes).
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
  - Seamcraft and the first essences.
  - The Blossomfield.
  - Cooking over the campfire.
  - Act I, first chapters, with Mags Quire and the Bindery.
  - Nan Bristle and Hob the carpenter.
  - The Hold's requirements start counting (focus sessions, quests finished).
- **People and stories:**
  - **Approval and recruiting:** anyone you meet can come to camp, but only if they like you enough. Every named NPC has an approval (the companions' warmth, widened to everyone), moved by what you do and say, the gifts you give, the quests you finish and the company you keep, shown as small quiet "Name approves / frowns" notes, never a scolding. Conversations borrow Pathfinder 2e's Influence idea, minus the dice: you learn what a person cares about and what puts them off, then pick approaches that fit, earning points toward their threshold. A choice that matters ends with a quiet "Name will remember that" and is kept as a real entry on their journal page, so later conversations, banter and quests can call back to it. A faction keeps a separate Reputation that opens its doors and shops. At high enough approval a **Come to camp** option appears in their conversation. Below it, they stay where they are, and asking too early just gets a polite no and a hint about what they care about. Recruits settle in at camp with a bedroll, a spot at the fire and (where it fits) their real service. Nobody is a reward or a collectible: they're people with their own lives, and some will never leave them. Rivet, Pip, Dusty and the rest are people you can meet, not the starting cast. See LORE §9 for the approval rules.
  - **Side quests and the running gags:** the quest journal gets its first side quests, written in LORE §15's tradition. Each region's small famous people (LORE §15.1) appear with an errand, a callback and a kindness, and the first ones arrive in the Hushlands already seen: the Cabbage Man's cart on the north road, a plaque for the middle of the road, the second spoon. At least one side quest per region, funny and with a real payoff, and every quest ships with its Examine lines, a book or note, and a reason to come back.
  - Quests, side quests and every NPC keep to the terse-copy rule: short labels, with the detail in hover text and the journal.
- **The company grows:** Approval, gifts, banter and campfire conversations; the first quest parts; lean-tos at the Stockade; camp jobs with output; meal boons; Gothic, Iron, Void and Frontier's other Tale-lead mechanics, tuned against real task rifts; the Tollkeeper's Act I delve becomes the first part of his quest.
- **Animation:** wave A3 starts and runs through Phase 9: each resident's overlays as they join, then Whisper and the team-up duets (about 200 hand-drawn frames).
- **Moved to Phase 4:** the 50/15 focus timer (Kindle and Banked Coals) now arrives in slice 4.0, beside the Chronicle, because the company's rests and the focus pause need it.

### Phase 5b: The Cast and the Settled World (every named person gets a life, and a place to live it) ✓ built
*Built 2026-10-02, apart from the first city, which waits for Phase 8. What was built is listed under "Built so far" below.*
Phase 5 puts the first people in the world and the machinery to win them over. This phase fills the world with them and with the places they live. The reference for how it should feel is **Hytale**: a procedural world full of handmade places, where each region has its own people, its own buildings and its own ruins, and where most of the people you meet belong to where they are.

**What MILO takes from Hytale**
- **Regions are zones.** Each of the twelve regions has its own folk, its own way of building, its own weather and creatures, and its own ruins. Crossing a border should be obvious without reading the title bar.
- **Handmade places in a generated world.** The land is generated; the places on it are written. Two sorts: **story places**, one of a kind and always in the same spot (the Last Bridge, the Middle of the Road, the Ivory College's gate), and **scattered places**, drawn from a set and placed by the world (hamlets, camps, ruins, shrines, wells).
- **People belong to places.** Nobody stands somewhere for no reason. A person is where their story is: the man who found the middle of the road stands in the middle of the road.
- **Most people are set pieces.** A settlement has a baker, a lamplighter, somebody minding goats and a child in charge of a puddle. They have a name, a job, a routine and a line, and they are not coming to your camp. They make the place a place.
- **Settlements have roles.** Each one has a merchant, a keeper of something, an elder, and a bed you can rest in. Bigger ones add an inn, a notice board and a shrine.
- **Old and new.** Some settlements are older than the road and half asleep in the Hush. Others went up after the lantern woke, fresh timber and all. The old ones have history and the new ones have opinions. Ruins are settlements that didn't make it, and what's left says why.
- **A welcome that depends on you.** Hytale's villages have a disposition toward the player that can change with what the player does. The calm version here: a settlement's welcome follows your Reputation with its folk, and it reacts to what you carry and do (walk into a wood-village with an axe out and the shop shuts until you put it away). Nobody ever attacks. They frown, and they say so.
- **Roads and rivers lead somewhere.** Every road ends at a place worth reaching, and settlements sit where roads meet water.
- **A world that does things when you're not looking.** People sleep, wake, shelter from rain and gather at the fire. Simple routines that overlap are what make a place feel lived in.

**Three kinds of people**
1. **Companions.** A few. They have approval, errands, memories and a full sheet, and if they come to like you they can come to camp.
2. **Named locals.** Many. They have the same sheet and can be befriended, and they will never leave their place: the ferry captain, the Bindery's quartermaster, the innkeeper. They are who you go back to a place to see.
3. **Folk.** Most of the world. Generated for each settlement from a role, a name and the settlement's age. They can't be befriended or recruited. They are the world's set pieces, and they should be funny.

**A character sheet for companions and named locals** (`content/people/npcs/<id>.json`, checked by a validator):
- **Where and why:** the place they stand and the reason they stand there, in one line. No sheet is accepted without it.
- **Wants:** what they are after right now (a want that an errand can serve), what they are really after (a need that only a long friendship reaches), and what worries them. Wants change as they are met, and their talk moves on with them.
- **Likes and dislikes:** favourite foods, weather, places, topics and people, and the things that put them off. These feed approval and gifts.
- **Personality:** a temperament, how they treat strangers and friends, what makes them open up, and what makes them go quiet. The same person reacts the same way on Tuesday.
- **Speech pattern and accent:** a **voice sheet** per person. Sentence length and rhythm, favourite words and words they never use, verbal tics (how often, and which), formality, how they greet and say goodbye, and how they sound when pleased or put out. Accents are carried by word choice and rhythm, with at most a light respelling, always readable and never mocking a real-world way of speaking. Every voice stays plain, deadpan and free of the habits in LORE §15.1.
- **Gifts:** a reaction of their own to every item Chris can give. Liked things earn approval; the rest still get an answer.
- **A day:** where they are at each time of day and in each weather, what they do there, and where they sleep.
- **Relationships:** what they think of each other. Residents talk to each other at the fire, and locals talk about their neighbours.
- **Camp role** (companions only): what they bring when they live there, and what they leave behind if they go home.
- **A small arc:** a want, a complication, and a kindness, with callbacks to what they remember about Chris.

**Settlements**
- **Kinds:** a camp (two tents and a fire), a hamlet (a few houses and a well), a village (an inn, a board, a shrine), a town (a market, a hall, walls), and one city in each of the great regions (Mistmere Harbor, the Ivory College, Cinderforge, the Stacks in the Archive Peaks).
- **Ages:** *old* (there before the road: stone, lantern-posts, leaning houses, some of it asleep in the Hush), *new* (went up after the lantern woke: fresh timber, tents, unfinished fences), and *ruined* (Maker stones and Old Company camps, with what's left telling what happened).
- **New places follow your light.** Lighting a lantern wakes its stretch of road, and within a few real days a camp appears beside it. A camp that is visited grows into a hamlet. So the map fills in where you've been, and the new settlements are, in a small way, yours.
- **Built from parts.** Each region has a kit of houses, roofs, fences, wells and signs in its own style, and a settlement is laid out from the kit by rule. A city is laid out by hand.

**Tools that keep a big cast consistent:** a voice lint that checks every line against its speaker's sheet (forbidden words, tic rate, sentence length, no stage directions, no similes, no "it's not X, it's Y"); a check that no two people share a tic; a cast report that lists, for every person, which sheet fields are still empty; a map report that shows who stands where and flags anyone standing somewhere for no reason; and a writing guide with a template and finished examples.

**Order of work**
1. Folk at the hamlets that already exist, old and new, and the first people moved to where their stories are. *(Done.)*
2. Sheets, voices and gifts for the people already written, then the other companions (Rivet, Pip, Dusty, Juno, Mae, Lumi, Tova, Nell, Vesperine), each placed where they are met. *(Done.)*
3. Named locals for the vale and the nearest regions: Nan Bristle, Hob the carpenter, Captain Sloe at his quay, an innkeeper, a harbor clerk. *(Done.)*
4. Settlement kits and layouts for the first three regions, routines, and the welcome that depends on you. *(Done.)*
5. New places that follow your light. *(Done.)*
6. The first city, Mistmere Harbor, with Phase 8.

**Proof:** every person passes the validator and the voice lint; nobody stands anywhere without a reason on their sheet; every settlement has at least a keeper, a seller and a bed; every gift gets a reply from everyone who can be given it; a person's talk changes after their want is met; a lantern lit brings a camp; and Chris can tell any two people apart by a single line.

**Built so far**
- **5b.1 (2026-10-02), a scattered world:** the people stand where their stories are. Wendell is in the middle of the road, halfway between the north gate and the Last Bridge. Gorrin is beside the east road to Mistmere and its market, where the cart stopped. Jonas waits outside the Ivory College, where his patent is. Mags Quire stays by the north gate, where the first crack opened. Every hamlet now has two or three **folk**: a name, a job and something to say, different for an old hamlet and a new one. They can't be befriended or recruited. Each hamlet is old or new, and says so. `src/world/folk.js`, `content/people/folk.json`.
- **5b.2 (2026-10-02), the first settlements:** a hamlet is now several buildings, not one. Round its first home the world lays out a well, one or two cottages, sometimes a market stall, and a lamp post, from a kit that differs by age: thatch and slate for an old place; fresh shingle, a tent and a pile of timber for a new one. The rule is the hamlet's own, so it stands the same every time, keeps a tile between any two buildings, stays off the road and cuts no walk in two. Folk stand at their posts (the seller by the stall, the keeper by the well, the lamplighter under the lamp), and a hamlet with a stall always has a seller. The hamlet's panel says what stands in it. `src/world/settlement.js`; new sprites `cottage` (four roofs), `well`, `stall`. *Not yet:* villages and towns, anything to buy at the stall, paths or fences between the buildings.
- **5b.3 (2026-10-02), character sheets:** every named person's file now carries a sheet (`sheet`: wants now, next, really and a worry; favourites and aversions; temperament), a **voice sheet** (`voice`: rhythm, longest sentence, favourite words, words they never use, a tic of their own), a reply to **every gift** (`gifts`), a line for each part of the **day** and for rain (`day`), what they **think of** their neighbours (`thinks`), callbacks to what they remember (`recalls`), greetings for after their want is met (`helloAfter`), and a small `arc`. In the game: **Give something** hands over anything Milo gathered (a thing they love earns 2 approval, a thing they like 1, once a day; everything gets an answer and is used up); **About …** asks a Warm person about anyone you have met; their first line each visit is their hello, their day or a callback; their talk moves on once their errand is done; the journal shows what they want and what they turned out to like; and at the fire one resident says something about another. `src/sheets.js`.
- **5b.4 (2026-10-02), the companions, each where they are met:** Rivet (by the west gate, after an Iron rift is mended), Pip (a stone by the south-west gate, Void), Dusty (the fork on the south-west road, Frontier), Juno (the lantern on the road to Cinderforge, Neon), Mae (under the lantern on the Mistmere road, Noir), Lumi (the quietest lantern on the north road, Nocturne), Vesperine (the old ruin west of the vale, Gothic), Tova (the foot of the Last Bridge, once a first building is designed) and Nell (above Mistmere Harbor; she waits for the chapter that wakes Mistmere). Each has topics, an errand, a keepsake and a full sheet, and can come to camp once Fond. *Not yet:* fighting beside Milo. Their fight sheets are still stubs, so for now they are camp residents.
- **5b.5 (2026-10-02), named locals:** Nan Bristle at the edge of the Blossomfield and Hob at the foot of the Watchtower (both inside the vale, and in its Places list), Captain Sloe at his quay, Bram Tolliver at Gamewright's Rest, and Odo Marsh, clerk of Mistmere Harbor. They can be befriended and given things, and they never leave.
- **5b.6 (2026-10-02), a seller, a keeper, a bed, a day and a welcome:** every hamlet's folk include a **seller** and a **keeper** of something (the well, the lamps, the goats or the road). Every hamlet has a **bed**: *Rest here* is the company's Campfire, once a real day away from home. Folk keep a **day**: at night only the lamplighter and the road-watcher are out, in the rain the seller stays under the awning and the rest go in, and of an evening they gather at the well. A hamlet's **welcome** follows what you do there: fell one of its trees and it is cool for as long as the stump stands (they frown, they say so, and the stall is shut); come by on three different days and they know you. Nobody is ever hostile. **Regional kits:** wood-villages in the Whisperwood (mossy shingle, timber by the door) and harbor villages at Mistmere (slate, a stall that is always open, barrels and crates); anywhere else builds as the home country does. `src/welcome.js`.
- **5b.7 (2026-10-02), new places follow your light:** two real days after a lantern is lit, somebody has pitched a **camp** beside it (a fire, a tent, two of the folk). Come by on three different days and it becomes a **hamlet** of its own, with a home, a well and its full folk. `src/world/camps.js`.
- **Tools:** `node scripts/cast-report.mjs` (the cast report and the map report; `--check` fails on any gap, voice fault or missing reason), the voice lint and the no-shared-tic check in `tests/sheets.test.js`, and the writing guide `CAST.md`.
- **Left for later phases:** the first city (Mistmere Harbor, Phase 8); villages, towns and walls; buying and selling at a stall; the companions' fight sheets; each person walking between places through their day (they change what they say by the hour, and folk go in and out, but named people stay at their post).

### Phase 6: Commissions (Dispatch) ✓ built
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
  - Commissions that pass their check add to crew levels and titles, which have counted finished sessions since Phase 4.
  - Spoils chests.
  - Materials from real outputs.
  - Fusion rifts and Maelstroms.
  - Genre skins for buildings in the step 2 kit.
  - **The Hold** (tier 3):
    - the Sally Port (the commission queue);
    - ward-towers (two auto-ward rules);
    - the Barracks for residents;
    - outposts in explored land.
- **The company grows:** Juno, Mae, Lumi and Tova join. The Hold raises the Road level cap to 7, with the Barracks and room for 4 regulars, and levels 6–7 are tuned; second paths; team-ups; fusion fights and Maelstrom councils; Neon and Noir's other mechanics; watchable commissions; title feats.
- **Animation:** wave A4 starts and runs through Phase 10: Tale-lead signature clips (mostly data), commission playback, and later the Colossus and the Great Ones (about 150 hand-drawn frames).

**The rules a commission keeps** (none can be switched off from the game): one folder a commission, picked by Chris in the system's folder dialog, and never his home folder, a whole drive, MILO's own folder or anywhere under `.claude` or `.codex`, checked again on the real disk with links followed; nothing is sent until he presses Send, every time, and a commission that may change files asks once more with the folder named; one runs at a time, and it is called back after 20 minutes; the ward is held by the CLI's own switches (Claude gets only Read, Glob and Grep, plus Edit and Write under Change files, and never a shell; Codex runs in its read-only or workspace-write sandbox, rooted at the folder); and MILO never commits, pushes or deletes on the crew's behalf.

**Built so far**
- **6.0 and 6.1 (2026-10-02), the crew panel and sending the crew:** the HUD's Crew tab opens **The crew**: who of the crew is set up on this PC, who is out (with Call back), what has come back to be read, the drafts and what went before. A draft comes from a line typed in the panel, from a quest, or from a building's next level (its own panel has **Send the crew**, and the brief is written from the level's title, summary and proof). Each draft has a brief, Claude or Codex, a ward (Look only, Suggest, Change files) and a folder, and it says what will leave the PC before it is sent. Under Change files the files that really changed are read off the disk, not taken from the crew's word. A building goes up a level only when a Change files commission for that level comes back and Chris says **It works**. `src/commissions.js` (the rules, pure), `src/commission/runner.js` (the CLIs, main process only), `src/ui/commissions-view.js`. Tests use a fake crew and a made-up folder: no real CLI is ever started by them.
- **6.2 to 6.4 (2026-10-02), checks, pay, rifts and Mana:** a building can have a **check**, a command Chris sets (`npm test`, say) that MILO runs in its folder as he would in a terminal; the crew can't set or change one. When a building has a check, **It works** stays off until the check has passed since the commission came back. Reading a commission that came back pays 5 Embers (15 a day at most, once each) and 100 Command XP, or 400 when it proved a level. A failing check opens a **Neon** rift over its building until a check passes; commissions that came back unfinished open one **Noir** rift over the camp until they are read. The crew panel shows Codex's allowance (Mana) and says so on a Codex draft when it is nearly gone. `src/commission/pay.js`.
- **6.5 to 6.8 (2026-10-02), expeditions, long runs, the company and the Hold:** whoever is out on a commission shows at work on their crew card ("On a commission"). Reading one pays a spoils chest of materials from real outputs: a **Forged Part** when it really changed files, a **Captain's Seal** when its check passed or it proved a level; they sit in the Satchel under Spoils. MILO notes when it first sees a crew session busy, and one busy for **three hours without a break** opens a Neon rift over the Watchtower (a break, or MILO restarting, starts the count again). **Juno, Mae, Lumi and Tova fight**: their moves are written from COMBAT.md §2 with the engine's own effects (Read the error, Jack in, Name it, Streetlight, On her bicycle, Raise stone, Humming bridge, Hammer tap), and a companion whose moves are written joins the roster once they come to camp. Their heart feats wait for their quests. **The Hold** is reachable: a proven building level, finished quests and residents count towards it, and the stone and copper Milo mines are its stone and copperstone. `src/company.js`.
- **6.9 to 6.12 (2026-10-03), the Hold and the rest of the company:**
  - **Rivet, Pip and Dusty fight.** Rivet: Holds the line (foes beside him move 1 tile less), and his whistle's Fall in (allies within 6 are Brisk), Shift change (patches an ally within 6) and Tools down (everyone within 6 cools down). Pip: Many small things (three small hits, each its own roll), Bit by bit (a reaction that lightens a hit on an ally) and Round the corner (step through and Strike). Dusty: Noon (a reaction that Strikes the first foe to move in sight) and Wanted (singles a foe out). Their heart feats wait for their quests; Nell, Vesperine and Whisper still wait for their phases.
  - **The Sally Port** (the Hold): with someone out, Send becomes **Queue it**. Up to three wait and set out one after another as each is back, each as sent (and, for Change files, confirmed) by Chris. The queue lasts while MILO is open, and if one comes back unfinished or is called back, what waits goes back to the drafts.
  - **Ward-towers** (the Hold): two more rules beside the first ward-post, chosen at the War Table, five rules in all. The two new ones are **A quiet Sunday** (late Sunday nights don't open a Nocturne rift) and **Admin until Monday** (too much in progress waits until Monday on a weekend). A rule stands in one place only.
  - **Outposts** (the Hold): a lit lantern becomes an outpost for 20 birch and 10 stone. No rift opens within six tiles of one, the way none opens in the vale. The Hold allows two, and each tier after allows two more. `src/outposts.js`.
  - **The Road level cap of 7** was already in rules.json for the Hold. Levels 6 and 7 play (30 of 30 simulated fights won at each), but that is too easy, and tuning them belongs to Phase 12 with the rest of the fight balance.
- **Phase 6 is built.** Left over for later phases: the companions' heart feats, outposts as a place to build (a lantern, storage and plots, with the Keep's waystones between them), and the Hold's other unlock, the Barracks.

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
- **The company grows:** Whisper joins, fighting only in the Whisperwood and sending the Listening Leaf everywhere else; voice commands in a fight ("Milo, raise the lantern"); Judgebird's Glance starts counting toward Jev's work level.

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
  - Act II and the first Great One you fight (The Drowned Bell).
  - The first festivals.
  - **The Keep** (tier 4):
    - the Dawn Bell tower;
    - Ballistae (auto-dispatch rules);
    - Lookouts (a 7-day horizon);
    - waystones between outposts.
- **The company grows:** Nell joins. Hana and the Crew Colossus, with Titan's other mechanics, and a wild Titan's Colossus built from this week's focus; the Drowned Bell as a fight-puzzle; forged and crafted gear and tonics; the Keep raises the cap to 8.

### Phase 9: The Stacks and the Forge (Lore and code)
- **Useful:**
  - Decision memory per project (Lore L1–L2).
  - Search over notes and decisions.
  - Git repos as forges: commits, PRs and CI, with Mend the Forge commissions.
  - Starfall weekly review.
- **Game:**
  - The Archive Peaks with Oriel (Act III: the Index of Tales and the Bindery's hidden wing), and Cinderforge with Brannoch (Act IV).
  - The Painted Hills, Ivory College and Dicing Downs attached to their buildings.
  - The Glass Fen, the deep-watch region for logs and loops, with the Mirror Heron's Stair.
  - Books and the library.
  - The handmade story **Elsewheres**, each genre's home beyond the generated ones: Lumen Row, Afterhours, Hollowmoor, Ironvale Front, Grayrain and Dustwater Junction first.
  - Fusion recipes and the Mixtape of Worlds.
  - The Lorekeeper (opt-in).
  - **The Castle** (tier 5):
    - guild halls;
    - the Hangar (Titan defence);
    - the Great Hall, where Starfall is held.
- **The company grows:** Vesperine joins. The handmade Elsewheres' bosses (the Throttle, the Endless Assembly, the Dowager of Dust, the Man with No Clues, the Deadline's duel); the Cinder Wyrm, the Blank Sovereign and the Mirror Heron; heart feats; relic gear; little homes; the Castle raises the cap to 10.

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
- **The company grows:** Pip's and Jev's homeward quests; the Grey Stag, the Someday King and the Cloud Leviathan's rescue; the remaining guests; *The Company Again*; deep ranks; the Citadel and Kingdom caps; and Act VII's *Show Them Hearthvale*, played with your own camp, the Beginner at the fire with the companions you really gathered.

### Phase 11: The Sound (everything MILO sounds like)
MILO is silent until this phase, and quiet after it. Sound is a finishing layer on a finished world: calm, optional, and never in the way of work.
- **Principles:**
  - **Off until asked, and always easy to quiet.** A master volume and one switch per bus (music, effects, ambience, voices). Quiet mode is silent. Nothing plays during a focus session except the Kindle bell, and none of it plays while the window is hidden unless it is the bell Chris asked for.
  - **Nothing needs sound.** Every sound has a visible twin (the Gate Bell, the Dawn Bell, a rest ending), so a muted MILO loses nothing.
  - **Small and made on the spot.** No audio files: everything is synthesised with WebAudio from seeds, so the app stays small, the sounds are the same every time, and tests can check them without a speaker.
- **Music:** a calm chiptune score built from the world itself. A theme for each region, each time of day, the weather and the seasons, the camp fire, a rest, and the Hush. Fights get a score by genre (Neon, Nocturne, Gothic, Iron, Void, Noir, Frontier and the rest), softened so it never sounds like a fight you can lose. Tracks unlock as you explore, as a RuneScape homage. Companions can have a short leitmotif that joins the camp theme when they sit by the fire.
- **Effects:**
  - The interface: clicks, panels, the Board, a quest finished, a level-up, an Ember earned, a Riddle Note unfolding.
  - The world: footsteps by ground, the wind, water, birds by day and crickets by night, the campfire, rain and snow, doors, lanterns lighting, chopping and gathering.
  - Rifts: a hum for each genre, a seam closing, a stray settling.
  - Fights: a sound for each degree of an action (Critical, Hit, Graze, Miss), heat rising, a round starting and ending, a hero going Offline and a Reboot.
  - The bells: the Gate Bell, the Dawn Bell, the evening bell and the Kindle bell each get a tone of their own.
- **Voices without voice acting:** every person speaks in short blips tuned to their voice sheet (pitch, speed and timbre from Phase 5b), as in the games this one loves, so the Tollkeeper, Wendell and Gorrin each sound unlike the others. Dialogue ducks the music. Whisper's own voice is the Owl's (Phase 7); this layer never records or sends anything.
- **Settings and care:** the same switches in Settings and in the HUD; a "sounds, not music" mode; captions for the bells for anyone who can't hear them; no sudden loud sound ever; and every sound respects the system's reduced-motion and quiet settings where they apply.
- **Proof:** the synthesiser is a pure module whose note schedules are tested for determinism; no Electron check ever makes a sound (the test mode is silent and asserts that); each bus mutes independently; music never plays during a Kindle focus session; and a build with sound off is byte-for-byte what it was before.

### Phase 12: Fine-tune and Fix (the loose ends, tied off)
Earlier phases left a few things built but unfinished. This phase goes back for them. It adds no new systems: it makes what is already there play well and look right.

- **Fight balance (from Phase 4).** The tuning pass was never finished. The first fight (three Sergeants) nearly wipes a level-1 party that accepts every draft.
  - Finish the tuning run with `scripts/sim.mjs` and `scripts/tune.mjs`, encounter by encounter, against the budgets in COMBAT.md.
  - A first fight that a new party wins by accepting the drafts, and a curve that stays fair from level 1 to the current cap.
  - Maud's Table sits under its ceiling, which clears the one standing todo in the unit suite.
- **Act I's unbuilt chapters (from Phase 5).** Four are written in the lore and not in the game: the Well of Small Wishes, Hob's Waystone, Letters to Nobody and Starfall.
  - Each is a chapter in `content/story.json` and `src/acts.js`, finished by doing something MILO already does, and shown in the story panel.
  - The Well of Small Wishes collects wishes for MILO itself. Hob's Waystone is a backup, carved with Hob at the Watchtower. Letters to Nobody is Vesperine's desk of everything waiting on you. Starfall is the weekly review.
  - Any chapter whose real feature belongs to a later phase is built here as its story half only, and says so.
- **Stalls that sell something (from Phase 5b).** Every hamlet has a stall and a seller with nothing to sell.
  - Trade what Milo gathered for things he can use, at the stall, from the seller. No Embers change hands: those come only from real work.
  - The stall is shut while the hamlet is cool, as it already says, and a regular gets the regular's price.
- **The companions look like themselves (from Phase 5b).** Pip, Lumi and several others are Milo's sprite in other colours.
  - A sprite of their own for each of the nine companions and the five named locals, in the world, in their portrait and at the fire: Pip round and starry with too many eyes, Lumi with her bicycle, Vesperine faint and upright, Rivet in tin.
  - Folk stay recoloured: they are set pieces.

**Proof:** a level-1 party wins the first fight on drafts alone, nine times in ten in the simulator; the unit suite has no todo left; all of Act I's chapters can be finished in the real app; something can be bought at a stall, and no trade earns an Ember; and no named person shares a silhouette with Milo.

### Housekeeping (slots in wherever it's needed)
A packaged Windows build and installer, starting in the tray with background watch (the Night Watch Lantern), phone pings (opt-in), backups and export (Carve a Waystone), and updates.

## 14. Questions, settled

Chris asked Claude to settle these on 2026-09-29. Each is a default, and any of them can change later.

1. **Adventure mode is the default.** Quiet mode is one click away, and a focus session dims the world by itself.
2. **Embers stay the gate.** Active play costs Embers, and only real work earns them. The camp, the vale, talking, the muster, fights inside an outing and *Try again* cost nothing, so a rest is never empty.
3. **Habitack's combat retires** into Warding and the Company when the board comes home in Phase 5, rather than staying a side game ([`COMBAT.md`](COMBAT.md) §18 Q9).
4. **Life-skill tagging** works by rules like Habitack's classifier, with a one-click correction. No new life areas (fitness, social, money) for now: MILO sees no signals for them, and a skill with no real signal would be busywork. Skills are data, so adding one later is cheap.
5. **Sound is off by default,** with one switch in Settings.
6. **The twelve genres stand.** When the far shelf opens in Phase 10, steampunk, pirate and space opera come first, because they mix best with the twelve already there.
7. **Cosy-spooky stays the default** for Gothic and Void, with the gentle-rifts setting to soften them further.
8. **One world seed,** made at first run and shown in Settings. It can be rerolled only until the Prologue ends, before any of the world is yours. There's no visiting another seed: that would mean sharing data between PCs, which MILO doesn't do.
9. **The frontier's reach stays** at about 10 tiles beyond the ward when urgent and about 40 when not, and the Gate Bell stays on by default: it's the only desktop note, and it's calm.
10. **The Hearth caps the Road level** (the Stockade 5, the Hold 7 and so on). XP past the cap is kept, and the cap never touches the Wayfarers.
11. **Likenesses stay.** When Claude or Codex is really working, a Clay Likeness or a Slate Double goes out with identical stats and the same notebook.
12. **Kindle comes early,** in Phase 4's slice 4.0, so a finished focus session gives a party that's out a Breather.

The combat questions are settled in [`COMBAT.md`](COMBAT.md) §18.
