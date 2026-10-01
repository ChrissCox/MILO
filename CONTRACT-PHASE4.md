# MILO Phase 4 build contract: the Adventurer's Kit and the Company

Read `CONTRACT.md`, `CONTRACT-STEP2.md` and `CONTRACT-PHASE3.md` first. Their ground rules, shapes, tone and Electron patterns still apply except where this file amends them. The design is `COMBAT.md` (all of it, including §18, "Questions, settled"), `PLAN.md` §4, §6, §7, §9, §12 and §13's Phase 4, `LORE.md` §9–§12, §16 and §21, `RIFTS.md` and `WORLD.md` §6. Phase 3 is committed at `90575a7` (the baseline is `0b8f5ae`): 527 unit tests in 16 files and 47 Electron checks (`tests/ui.mjs`). Keep every one of them passing. Change a pinned test only where this contract says Phase 4 deliberately changes the behaviour it pins, and say so in your final message.

Where this contract and a design doc disagree, this contract wins for the build, and §17 says why. Where COMBAT.md is silent, this contract decides, and each such decision is marked **Decided**.

## 1. What Chris asked for

> Answer the questions yourself and build phase 4.

That was 2026-09-29, after COMBAT.md was written. Phase 4 is **the gameplay phase**, with combat as its spine. It turns MILO from a world into a game:

- **Useful.**
  - **Kindle and Banked Coals**, the 50/15 focus timer, with a bell that rings on time even when MILO is covered.
  - **Embers** earned only from real work (focus sessions, honoured rests, crew sessions watched to the end, needs-you answered, real rifts mended, buildings designed), with a wallet, a lifetime count and a ledger.
  - **The Chronicle**: a daily and weekly history, where every Ember and every fight is written down.
  - **The Log and command bar**: one feed for everything, and plain words or `::` spells to act.
  - **Right-click menus** on everything, with **Examine** last.
  - **Life skills** from real signals: Command from the crew, Artifice from buildings, Focus and Hearthkeeping from Kindle.
  - **Quiet and Adventure modes**, and suggested levels on the rift panel and the War Table.
- **Game.**
  - **Fights**: turn-based party tactics with no dice. Three actions and a reaction, four degrees, heat and edge, height, cover, light, surfaces, conditions, spells, rests. The odds shown are the odds used.
  - **The Company**: Milo, the Scribe, the Artificer, Jev, the Tollkeeper and up to two regulars, gathered at the camp, mustered at the fire, following Milo in a formation.
  - **They learn from you**: every companion drafts from a notebook of your choices, with a confidence and a *why?*.
  - **Strays** from riftgen in every fight room, **Tale-leads** with one mechanic per genre and a bow, canon foes in caves, field bosses you choose to Challenge.
  - **The 24 skills** on the classic curve, with guides, XP drops and Marks.
  - **Day and night, seasons and weather** from the real clock and a seeded roll.
  - **Examine on everything**, with at least 150 lines.
  - **The first Riddle Note trail**, which ends at the Last Bridge, where the Tollkeeper can be out-riddled and joins.
  - **Animation waves A0–A2**: about 150 hand-drawn frames, the rest derived or procedural.

**Promises (tested):**
- Nothing is lost. A hero at 0 Integrity dozes until someone Reboots them. If everyone goes offline, they wake at the last lantern with everything they found, *Try again* is free, and going back in is free once.
- Embers come only from real work, each payment happens once, and a relaunch never pays twice.
- The odds shown are the odds used (§5.7 says exactly what "used" means), within 0.5 percentage points per bar over 100,000 seeded outcomes, and replaying a fight's commands gives the saved battle.
- Notebooks learn only from the drafts Chris accepts and the changes Chris makes, and never drop a note on their own.
- A fight pauses between any two actions, a relaunch lands on the same tick, and a focus session or a rest's end pauses at the next action.
- Phase 3's worlds are unchanged: every rift, layout, Elsewhere, chunk and stray in the golden fixtures (§16.2) is byte-identical, apart from a Tale-lead's shown name where it would clash with a companion's.
- Sight never starts a fight in the wilds.
- By the end of the phase the muster can offer six companions for three places: the Scribe, the Artificer, Jev, the Tollkeeper and two regulars.

## 2. Ground rules (all modules)

- Plain JavaScript ES modules, no build step, no new npm packages. Node isn't on PATH: use `C:\Users\chris\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe` (v24.19). There's no `npm`; §16 spells out every command.
- **Only edit the files your module owns in your wave** (§14). If another module's API is missing or wrong, code against this contract exactly, stub it in your own tests if you must, and report the mismatch in your final message. Never "fix" another module's file.
- Run your own tests plus every existing test file that imports a module you changed. Other agents are editing other files at the same time, so a failure in a file you don't own is theirs to fix; mention it, don't touch it.
- **Privacy is unchanged.** Nothing new leaves the PC. No game path imports `src/architect/**` or `src/watch/**`, and no crew tool or cloud service is ever called for the game. Game text may quote a session **title**, never `lastMessage` or transcript text, and a stored title is dropped after 3 days (`SESSION_NAME_DAYS`). Notebooks hold in-game choices only and stay in MILO's data folder.
- **Imports.** `src/model.js` loads `src/architect/blueprint.js` at top level, so every file Phase 4 creates (the pure modules listed below, `src/state4.js`, `src/combat/**`, the new `src/world/*` and `src/ui/*` files) never imports `src/model.js`, `src/hearth.js` or `src/rifts.js`; what it needs from them lives in `src/clean.js` or `src/state4.js` (§7.6), or comes through `shell`. Phase 3's `src/ui/frontier.js` and `src/app.js` keep their imports. Wave 0's `tests/imports.test.js` walks each of those new files' static and dynamic imports and fails on any path into `src/architect/**` or `src/watch/**`, or on an import of those three modules (a listed file that doesn't exist yet is skipped).
- **UI state never touches the URL.** No `location.hash`, `pushState`, `replaceState` or query string, for tabs, pages or history: main's `trustedSender` compares the whole frame URL, so any change would make every IPC call untrusted.
- **Pure rules.** Nothing in `src/combat/**`, `src/party.js`, `src/camp.js`, `src/embers.js`, `src/kindle.js`, `src/chronicle.js`, `src/lifeskills.js`, `src/sky.js`, `src/state4.js`, `src/world/arena.js`, `src/world/caves.js`, `src/world/fieldboss.js` or `src/world/trail.js` reads `Date.now()`, `Math.random()`, `performance.now()` or the DOM. The clock is passed in as `now` (ms on the MILO clock, `clockNow()` in the shell), and randomness comes from seeded hashes (`rng.js`: `hashInts`, `hashString`, `unit`, `createRng`). A function that falls back to `Date.now()` when `now` is missing is a bug.
- **New seeds get new tags.** A new feature seeds itself with a new tag on its parent seed (`hashInts(spec.seed, 'arena')`), never with an extra draw in an existing stream. `content/riftgen.json` and `content/genres.json` are frozen byte for byte.
- **Calm copy** in everything Chris reads: sentence case, contractions, curly quotes and apostrophes (’ “ ”), no exclamation marks, no "please", no "successfully", no emoji. Real causes come first, in plain words. Fights use the cosy words: strays *settle* and are *sorted*, heroes *go offline* and *doze*; nobody dies, is killed, slain or wiped. Check copy with the shared `tests/calm.js` (§16.3).
- Every renderer string built into HTML goes through `esc()`. Generated ids used in selectors go through `CSS.escape`. Colours in `style=""` pass a hex check.
- Everything that animates has a still version. With motion off, the engine draws a deterministic frame (`t === null`), clips jump to their final frame, walks and fades finish at once, and playback promises resolve at once.
- **Pure logic lives in Node-importable modules with unit tests.** DOM and canvas code stays thin. New files stay at or under 1,500 lines; `src/app.js` (4,035), `src/world/engine.js` (2,891), `src/world/sprites.js` (2,514), `src/world/wilds.js` (2,323) and `src/model.js` grow only by the wiring this contract names.
- Every state step takes `(state, …, now)` and returns a **new** state, or **the same object** when nothing changed. Callers rely on `next === state`.
- Test files are named `tests/<name>.test.js`, start with a comment naming the module, the contract section and the run command, and use plain-English test names in the house voice. Timing tests warm up and assert on the median or p90, never one sample.

## 3. Scope and cut lines

Phase 4 ships COMBAT §17's slices 4.0–4.4 and animation waves A0–A2. Where the docs leave room, these are the lines.

### 3.1 In Phase 4

| Area | In |
|---|---|
| Callings | All nine to level 5, because regulars use six of them. The Scrivener, the Tinker and the Skirmisher to level 12, for the Wayfarers. The Warden to 5, for the Tollkeeper. |
| Spells | The eight knacks and the twelve circle-1 and circle-2 spells of COMBAT §6. Circles 3–5 ship as data stubs (`stub: true`) that are never legal actions. |
| Conditions and surfaces | Every COMBAT §7 condition and every COMBAT §4.3 surface, in the rules. |
| Tale-leads | One mechanic per shadow genre (Throttles speed, Streetlights out, Snuffs candles, Assembly lines, Too big to see, Alibis, Noon duel, Stomps) with its bow, the generic fallback for the other 24, *Asides*, plot armour, feints, and *The last page*. The seven bright and Backhalls mechanics are no-fight puzzles and never fight. |
| Companions who can join | Milo, the Scribe (`claude`), the Artificer (`codex`), Jev (`jev`), the Tollkeeper (`tollkeeper`, slice 4.4) and regulars (up to 2 at the Stockade). |
| Warmth | A number per companion with its five thresholds (§4.19). **Decided:** in Phase 4 it rises only from outings (+2, up to +6 a week) and each companion's one real habit (+1 on a day it happens: the Scribe a Claude session watched to the end, the Artificer a Codex one, the Tollkeeper a feature tried for the first time; Jev's arrives in Phase 7). It never falls, and a gain never notifies (COMBAT §18, settled question 7). Acquaintance (10) opens each companion's camp scene; Companion, Friend and Fireside unlock nothing until Phase 5 (§3.2). |
| Cheers | From Charm talk-downs (§4.6), a talk choice a companion likes (`[likes: id]`, §9.10), and one Cheer as a gift after the first fight ever won. |
| Choices in conversation | The requirement mechanism (§9.10), used in the Tollkeeper's riddles and the first camp lines. |
| Skills | All 24 skills on the classic curve, with guides, XP drops and Marks. XP flows only where §4.21 names a source. The rest show at level 1 with a line on where they come from. |
| Sky | Day and night from the real clock, seasons from the real date, weather from a seeded daily roll: a tint and particles, never a repaint of cached chunks. |
| Examine | Right-click Examine on every entity, with at least 150 lines in a new `content/examine.json` (`wilds.examine`'s key set stays pinned). |
| The trail | The first Riddle Note trail, ending at the Last Bridge, a new overlay landmark on its own seed tag at the Whisperwood's southern edge. The Tollkeeper's riddles, then he joins. |
| Caves | A new scene kind (`kind: 'cave'`) with no stitch, its own seed tag and tier, a 3-Ember entry, and canon foes and region creatures (COMBAT §8.5). `notes_later.cave` changes on purpose. |
| Field bosses | Tier ≥ 5 Tale-leads roaming inside a gaping wild rift's bleed, on a new `'lead-roam'` seed tag, fought only by *Challenge*. |
| Field skills | Right-click options named after whoever can do them, or greyed with who could ("Pick lock (the Artificer, at camp)"). **Decided** for Phase 4: Light (Milo: lanterns), Read (the Scribe: an extra line at ruins and statues; Unwritten settle to listen), Pick (the Artificer: each cave's one locked chest), Sort (Jev: tells whether a chest is a Mimic), Riddle (the Tollkeeper: Tollmen and the riddle board). The other ten are data only. K1's `menus.js` lists them; L1's `expedition.fieldSkill` does them (§12.4). |
| Swapping | At the muster, a lit lantern's panel, or an Elsewhere's doorway only, never mid-dungeon. Setting out counts as a Campfire. |
| Ways to play | Guided (default), Command, *Let them choose*, *Let them handle it*, *Tell me how it went*, *Wrap it up*; per-hero *Mine*, *Review* and *Let them choose*; reactions' Ask, Always, Under half and Never; the calm settings (genre noise, stray adaptation, odds as bars or words). |
| Modes | Storybook, Long Road (default) and Maud's Table. |

### 3.2 Not in Phase 4

- Warmth from campfire conversations, gifts and banter; campfire conversations; camp jobs and their output; meal boons (Phase 5).
- **Gear drops and gear slots.** **Decided:** heroes fight with their calling's kit (§4.11). A fight's loot pays Marks, essences, relics and tonics (no materials; those still come from rifts' own loot and chopping). *Equip best*, scrolls and Tune-ups' gear upgrades wait for Phase 5's Smithing and Crafting. Tune-ups gives the Tinker's devices +1 Guard (at most 2) and 2 × level more Integrity instead.
- Team-ups, second paths and heart feats in play (their data may exist). **Decided:** warmth can reach Friend in about five weeks of outings and habits, but in Phase 4 Companion, Friend and Fireside unlock nothing; warmth keeps counting, and Phase 5 opens whatever it has reached by then.
- The evening bell's Hearthkeeping source (PLAN §4: 800 for stopping at the bell). **Decided:** Phase 4 can't tell stopping at the bell from MILO simply being closed, so it waits for Phase 5's wind-down.
- The Tollkeeper's service (Riddle Notes that lead to features not yet tried, COMBAT §2.2). **Decided:** Phase 5; `tally.features` is recorded from Phase 4 so his first notes can start from it. Stall signs ("Out with Milo. The board still works.") arrive with the board in Phase 5.
- Maelstrom councils, the Crew Colossus, guests, and every other Tale-lead mechanic's rule (data may name them; they fight as the generic fallback). A Maelstrom's lead fights as the generic fallback, alone.
- Every companion but the five above: their files exist as data with `joins.phase > 4`, and nothing recruits them.
- Story delves (20 Embers), outposts, the Mana orb's spend, market rerolls, commissions as watchable fights.
- Hearth tier 3 and above, so the Road level stays at or below 5 (the Stockade's cap).
- The Prologue is unchanged. **Decided:** Kindle is introduced by the first Riddle Note trail's first step, not as a new Prologue step, so no finished Prologue reopens.
- Construction isn't enforced for raising the Hearth. **Decided:** it has no Phase 4 source, so `content/fortress.json`'s `constructionFrom` becomes `"Phase 5"`.

### 3.3 Data only in Phase 4

`content/party/companions/*.json` for all fifteen named companions, `content/party/teamups.json`, the other 24 fighting mechanics in `leads.json` (rule text, `xInt` and bow text, `ships: false`; they fight as the generic fallback), circles 3–5 in `spells.json` (stubs), the Great Ones in `foes.json`, and every calling feature above level 5 except the three Wayfarer callings.

## 4. The numbers

Every number the rules use lives here once. `content/combat/rules.json`, `callings.json`, `spells.json` and `content/economy.json` hold them as data, and a content test checks each table cell for cell against this section (and COMBAT.md). Code reads the data; it never hard-codes a table.

Three tables live in COMBAT.md rather than here, and are used exactly: the conditions (COMBAT §7: effect, number, how each ends, and how it lands on a Critical or a Graze), the surfaces (COMBAT §4.3: effect, the Resolve they meet, and their reactions with damage kinds), and the spells and calling features (COMBAT §5.4 and §6: costs, ranges, areas, amounts and riders). B's `combat-content.test.js` carries a transcription of the first two and C's `content-party.test.js` of the third, each checked cell for cell against the JSON, so a drift in either the data or the transcription fails a test.

### 4.1 Degrees and heat bands

| Degree | Effect |
|---|---|
| Critical | ×2, plus the move's critical effect |
| Hit | as written |
| Graze | ×½, rounded down, for damage or an effect's number |
| Miss | nothing |

Helpful actions (patches, Brace, Assist, buffs) can't miss: a Miss counts as a Graze. A Cheer folds Graze and Miss into Hit.

| Band | Heat | Critical | Hit | Graze | Miss | Expected ×damage |
|---|---|---|---|---|---|---|
| Cool | 0–30 | 5 | 80 | 10 | 5 | 0.95 |
| Warm | 31–60 | 15 | 60 | 15 | 10 | 0.975 |
| Hot | 61–100 | 30 | 35 | 15 | 20 | 1.025 |

Bars are whole percents, listed Critical / Hit / Graze / Miss, and always sum to 100. Storybook uses every band one step cooler (Hot uses Warm's bars, Warm uses Cool's, Cool stays Cool). The first Tale-lead Chris ever meets uses Storybook's numbers whatever the mode.

### 4.2 Edge

Edge is capped at +3 and −3 after every source is summed. Each point shifts the bars once:
- **Positive,** top-down: Hit→Critical, then Graze→Hit, then Miss→Graze, each moving `min(10, what the lower outcome has at that moment)`.
- **Negative,** bottom-up: Graze→Miss, then Hit→Graze, then Critical→Hit, each moving `min(10, what the higher outcome has at that moment)`.

The reference table (Critical / Hit / Graze / Miss) must come out of that rule exactly:

| Edge | Cool | Warm | Hot |
|---|---|---|---|
| +3 | 35 / 65 / 0 / 0 | 45 / 55 / 0 / 0 | 60 / 35 / 5 / 0 |
| +2 | 25 / 75 / 0 / 0 | 35 / 60 / 5 / 0 | 50 / 35 / 15 / 0 |
| +1 | 15 / 80 / 5 / 0 | 25 / 60 / 15 / 0 | 40 / 35 / 15 / 10 |
| 0 | 5 / 80 / 10 / 5 | 15 / 60 / 15 / 10 | 30 / 35 / 15 / 20 |
| −1 | 0 / 75 / 10 / 15 | 5 / 60 / 15 / 20 | 20 / 35 / 15 / 30 |
| −2 | 0 / 65 / 10 / 25 | 0 / 55 / 15 / 30 | 10 / 35 / 15 / 40 |
| −3 | 0 / 55 / 10 / 35 | 0 / 45 / 15 / 40 | 0 / 35 / 15 / 50 |

Sources, each shown in the planner with its reason:

| +1 each | −1 each |
|---|---|
| high ground (attacker higher than target) | the target's low cover (heavy cover −2) |
| a shadow-genre target standing in the Hooklight's light | a target in darkness the attacker can't see into |
| an Assist on this action | each point of the target's Guard, against attacks that meet Guard |
| an Exposed target | each point of the target's Resolve, against effects |
| 2+ levels above the target: +1 per 2 levels, up to +2 | 2+ levels below the target: −1 per 2 levels, down to −2 |
| an elite's or Tale-lead's own attacks (+1) | Rattled N on the actor (−N) |
| conditions, marks and features that say so | each attack after the first in a turn (−1, −2, cumulative) |
| | a ranged attack or ranged knack while a foe stands beside the attacker |

Level difference counts from the actor's fighting level to the target's level, `sign × min(2, floor(|diff| / 2))`. At party levels 1 and 2 nothing counts as more than 2 levels above the party (§4.10).

### 4.3 Heat

- Heat runs 0–100 and never goes above 100 or below 0. A fight starts every actor at its idle heat.
- **Each attack after the first in your turn** adds 20 heat (10 with a light weapon) and −1 edge on that attack, cumulatively: the second attack is at +20 heat and −1 edge, the third at +40 and −2. The heat is added **before** the attack's outcome is picked, so the attack uses its new band. Non-attack actions and reactions add no heat and take no penalty. **Decided:** the light-weapon 10 applies only to weapon Strikes and Throws made with a light weapon (a knack marked `attack: true`, such as *Mote*, adds 20); reactions (Parting swipes, *Ready a shot*) and a lead's Asides never count toward the attack index; an ability with several pieces (`split`, *Inkdarts*, *Volley*) is one attack; `attackPenalty` returns the increment for that attack, not the running total.
- **Drift:** at the start of each turn (the start of the round, before tick 1), heat moves 10 toward idle (20 inside Milo's raised lantern), never past idle.
- **Cool down** (1 action): −30, not below 0. A Breather resets heat to idle.
- **Rooms:** from round 2, at the start of each round, Neon rooms add 10 to everyone and Iron rooms take 10 off, after drift.
- **Maud's Table:** every party unit's idle heat +15 (Milo, companions and regulars; **Decided**). Paths shift idle heat by up to 10.

Idle heat:

| Heat | Companions |
|---|---|
| 10 | Rivet |
| 15 | Nell, the Tollkeeper |
| 20 | Milo, Tova, Whisper, Vesperine |
| 25 | The Scribe |
| 30 | The Artificer, Dusty, Mae |
| 35 | Lumi |
| 40 | Juno |
| 45 | Pip |
| 50 | Jev |

Strays and regulars take theirs from temperament (§4.6).

### 4.4 Actions

Every actor has **3 actions and 1 reaction** a round. Costs, ranges and rules are COMBAT §3.4's, with these exact numbers:

| Action | Cost | Numbers |
|---|---|---|
| Stride | 1 | Speed: 5; Small heroes (Milo) 4; fliers (Jev) 6; +1 at Grace 3 or more. **Decided:** a tile costs its diagonal step (1 or 2, alternating) × 2 on difficult terrain, + 1 for a step up a height step (0 on stairs). |
| Step | 1 | 1 tile, no Parting swipe |
| Strike | 1 | The Strike line (§4.8) in the weapon's kind; reach 1, or range 12 for bows, slings and cork-guns |
| Brace | 1 | Buffer = 3 + level, +2 with a shield, until the start of your next turn |
| Examine | 1 | Needs line of sight. Reveals resistances, weaknesses and temperament; at Wit 3+, a Tale-lead's next-phase mechanic too |
| Seek | 1 | Reveals hidden intents and Unseen foes within 6 tiles (8 at Heed 3+) |
| Interact | 1 | A lever, an item, a door, waking a Drowsy ally beside you, or shaking off lingering damage |
| Assist | 1 | +1 edge on a named ally's next action against a named target; ends that ally's lingering damage |
| Talk down | 1 | +1 calm to one kind of stray in sight (§4.6) |
| Cool down | 1 | −30 heat |
| Reboot | 2 | An Offline ally within reach 1 returns at ¼ of max Integrity (rounded down, at least 1) and Rattled 1 until their next Breather |
| Delay | 0 | See §5.5 |
| Hide | 1 | Needs Dim or Dark, foliage or high cover; on a Hit or better against the watchers' best mind Resolve you're Unseen |
| Throw | 1 | Range 3 + 2 × Might (at least 1); the 1-action line in Plain; a thrown tonic (`ability: 'cordial'`) patches everyone within 1 instead |
| Use an item | 1 or 2 | Drink a tonic (1), or give one to an ally beside you (2). Tonics are the party's, carried on Milo's spec (`carry`), and any hero may use one while one is left |
| Shove | 1 | Meets body Resolve. Hit: push 1 (none if the target is larger). Critical: push 2 or Tumble. Large foes can't be Tumbled by a shove; Tale-leads can't be shoved off height |
| Jump | 1 | 2 + Might tiles (at least 1) over gaps, surfaces and creatures, or up one height step |
| Dip | 1 | Next Strike deals Light (candlefire, burning oil, a lit candle) or Spark (a charged puddle) and 2 more |
| Sustain | 1 | Keeps your one sustained spell going this round |
| Ready | 2 | From Warding 10 (`createBattle`'s `warding` option). Name a trigger from `READY_TRIGGERS` (`foe-enters-reach`, `foe-moves-in-sight`, `strike-at-ally`); the plan's next slot fires as your reaction when it happens, and is lost if it doesn't this round |
| Head home | 0 | The Hooklight takes everyone home at the end of the tick, keeping everything |

**Attacks** are Strikes, Throws, Shoves, Parting swipes and any ability marked `attack: true`. Strikes and knacks that fly like them meet Guard; everything else aimed at a foe meets the Resolve it names.

**Reactions:** Parting swipe (a foe leaves your reach without Stepping; one melee Strike; fliers draw none), Shoulder (an ally within 1 is struck; your Buffer applies to that hit), Ready, and each calling's own (§9.4). One a round each. Reactions add no heat and take no heat penalty. Each is set to Ask, Always, Under half (**Decided:** fires only for an ally under half Integrity) or Never. Their ids are `REACTION_IDS` (effects.js): `parting-swipe`, `shoulder`, `ready`, then the calling reactions' ability ids. Defaults (COMBAT §15): Parting swipe Always; Shoulder, *Draw the blow* and *Stand in my light* Under half; *Proofread* and *Cross it out* Ask; everything else Always. A companion's file may set its own defaults over these: the Scribe's Shoulder is Always, as COMBAT §3.7 plays it. An Ask pauses only playback, never times out, and answering it isn't a note.

### 4.5 Abilities, defences and speed

- Abilities run −1 to +5: Might, Grace, Grit, Wit, Heed, Charm.
- **Key ability:** a calling's damage and patch amounts assume +3. Each point above adds 1 to every amount the unit deals; each point below takes 1.
- **Grace 3+:** +1 Speed, and +1 Guard in no or light armour. **Grit 3+:** +1 body Resolve. **Heed 3+:** +1 mind Resolve, Seek 8, and a Tale-lead's feint shows a tick early. **Wit 3+:** Examine reveals a lead's next-phase mechanic; 2- and 3-action spells reach 1 tile further and areas are 1 tile wider. **Charm 3+ in the party:** every kind needs one fewer Talk down (at least 2), and each kind talked down gives a Cheer.
- **Guard** 0–2: none or light armour 0, mail 1, plate 2, +1 from Grace 3+ in no or light armour, never above 2.
- **Resolve** 0–2, body and mind: the calling's base plus 1 for Grit 3+ (body) or Heed 3+ (mind), never above 2.
- Initiative: Speed + Grace + a seeded spread in [0, 2) (§5.4). *Read the ground* and *Early riser* each add 2.

### 4.6 Temperaments and talking down

| Temperament | In a fight | Heat | Talk downs |
|---|---|---|---|
| shy | Keeps its distance; settles at half Integrity | 15 | 2 |
| curious | Examines the nearest hero first | 35 | 3 |
| grumpy | Strikes the nearest | 45 | 4 (3 with Dusty or Mae in the party) |
| dramatic | Opens with its biggest move | 60 | only after its big moment, then 2 |
| sleepy | Starts Drowsy; can be crept past | 20 | 3 |
| polite | Never touches an Offline hero | 20 | 2 |
| lost | Idles one turn in three | 25 | 2 |
| nosy | Goes for the lantern-bearer | 35 | 3 |
| proud | Duels the strongest hero | 40 | 4 (3 with Dusty or Mae in the party) |

The ids and their order are riftgen's `TEMPERAMENTS` exactly. A kind's calm resets to 0 when any attack or harmful outcome (damage, a bane, a hostile move) lands on one of that kind, whoever made it. With a hero of Charm 3+ in the party, every kind needs one fewer (at least 2). Talking a kind down settles every stray of that kind for full XP and loot. **Decided:** each hero may Talk down once from the doorway before the fight (in sight of the room, outside its sight ring); those count through `createBattle`'s `talk` option, and the party then gives up any surprise. "Its big moment" (dramatic) is its first telegraphed `big: true` move resolving. The **gentlest** stray of a rift (for a regular's invitation, §7.5) is the first in this order: shy, polite, sleepy, lost, curious, nosy, proud, grumpy, dramatic; ties go to the lower stray index.

### 4.7 Hero Integrity

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Sturdy (Warden, Tinker) | 22 | 34 | 46 | 58 | 70 | 84 | 98 | 112 | 126 | 140 | 154 | 168 |
| Middle (Lanternkeeper, Skirmisher, Longshot, Chorister) | 18 | 28 | 39 | 49 | 60 | 72 | 84 | 96 | 108 | 120 | 132 | 144 |
| Light (Scrivener, Mender, Weaver) | 16 | 24 | 33 | 41 | 50 | 60 | 70 | 80 | 90 | 100 | 110 | 120 |

The table assumes Grit +1. Each point of Grit above +1 adds 1 Integrity per level after the first; each point below takes 1. So Milo (Middle, Grit +2) has 18 at level 1 and 64 at level 5. Past 12 (Wayfarers only), each level adds the build's last step: Sturdy 14, Middle 12, Light 10.

### 4.8 Damage and patch lines

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `one` (a 1-action ability) | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 13 | 14 | 15 | 16 | 17 |
| `strike` | 7 | 9 | 10 | 12 | 13 | 15 | 17 | 18 | 20 | 22 | 24 | 26 |
| `two` (a 2-action spell) | 12 | 15 | 17 | 20 | 22 | 25 | 28 | 30 | 33 | 36 | 39 | 42 |
| `three` (a 3-action spell) | 18 | 22 | 26 | 29 | 33 | 37 | 41 | 46 | 50 | 54 | 58 | 62 |
| `area` (the three line ×0.75) | 13 | 16 | 19 | 21 | 24 | 27 | 30 | 34 | 37 | 40 | 43 | 46 |

- Patches use the same lines. **Decided:** past 12 each line adds its last step (`one` +1, `strike` +2, `two` +3, `three` +4, `area` +3) per level.
- Weapons: standard deals `strike`; light deals `strike − 2` and its extra attacks add only 10 heat; heavy two-handed deals `strike + 2`; bows, slings and cork-guns deal `strike` at range 12.
- **Damage order** (**Decided**, one sequence for every hit; `damageSteps` implements it and a table test pins it):
  1. the base: the line at the user's level × `frac` (floored), or the Strike amount; plus `plus`, upcast quarters, key-ability adjustment and flat additions (Dip, *Bead*, an elite's +2, deep rank);
  2. Storybook's ×0.75, rounded down (foes' damage only, while the mode or `firstLead` applies it);
  3. the degree: ×2, or ×½ rounded down;
  4. weakness adds, or resistance subtracts, once, not below 0; where *Hearth*'s "resist all damage" and a kind resistance both apply, only the larger counts;
  5. a lead's `damageTaken` (§6.6);
  6. *Tuck and roll* halves, rounded down;
  7. *Stand in my light* takes the `one` line off, not below 0;
  8. Buffer soaks; the rest comes off Integrity.
- Buffer = 3 + level (4 at 1, 8 at 5, 13 at 10), +2 with a shield. **Decided:** Buffer is a pool: each hit lowers it by what it soaked (a Buffer of 4 against hits of 3 and 3 soaks 3, then 1). It lasts until the start of your next turn; Shoulder lends it for one hit, and that hit spends the shoulderer's pool.
- Resistances and weaknesses on heroes and residents grow 3 at level 1, 6 at 5, 9 at 10 (**Decided:** the stray line's resistance row, §4.9).
- Lingering damage ticks at the start of the holder's turn, needs no outcome, and ends after 3 turns, on an Interact, or on an ally's Assist.

### 4.9 Strays, lackeys, elites and Tale-leads

| Level n | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Integrity | 15 | 20 | 34 | 48 | 61 | 75 | 92 | 109 | 126 | 143 | 160 | 177 | 194 |
| Strike | 5 | 6 | 8 | 9 | 11 | 12 | 14 | 15 | 17 | 18 | 20 | 22 | 23 |
| Resistance, weakness | 2 | 3 | 3 | 4 | 5 | 6 | 6 | 7 | 8 | 9 | 9 | 10 | 11 |

- Past 12: Integrity +17 a level; **Decided:** Strike = `23 + floor(1.5 × (n − 12))`; resistance = `3 + floor(3(n − 1) / 4)`.
- Archetypes:

  | Archetype | Role | Integrity × | Speed | Grace | Guard | Resolve body / mind | Strike | Special |
  |---|---|---|---|---|---|---|---|---|
  | walker | Soldier | 1 | 5 | +1 | 1 | 1 / 0 | melee | — |
  | crawler | Skirmisher | 1 | 6 | +3 | 0 | 0 / 1 | melee | *Pounce* (2 actions: Stride then Strike; a Hit or better also Tumbles) |
  | floater | Artillery | 0.8 | 4, hovers | +0 | 0 | 0 / 1 | range 8 | ignores surfaces |
  | flier | Harrier | 0.8 | 6, flies | +3 | 0 | 0 / 1 | melee | draws no Parting swipes; ignores height |
  | ghost | Lurker | 0.8 | 5, through walls | +1 | 0 | 0 / 1 | melee in its genre's kind; a Hit or better also Spooks 1 | resists Plain except inside the Hooklight's light and for a round after a Light hit; weak to Light; Unseen in the dark; ignores Tangled and Tumbled |
  | construct | Bulwark | 1.25 | 4 | −1 | 1 | 2 / 0 | melee | weak to Spark; ignores Queasy, Drowsy and Beguiled |

  Integrity is `Math.round(line × multiplier)`, then any elite bonus is added. A stray's full Integrity (**Decided**, in this order): `Math.round((Math.round(line(level) × multiplier) + elite) × (1 + 0.1 × deepRank) × integrityFactor(level, partySize))`, where `integrityFactor` is `tuning.json`'s (default 1).
  Each archetype's and genre's moves are abilities in `foes.json` (§9.8), named by id in `rules.json`: the crawler's `pounce`, the ghost's Strike rider (Spooked 1 on a Hit or better), and one `big: true` move per shadow genre, which a dramatic stray opens with. The bestiary copies them into `abilityIds`.
- Genres (a stray's Strike deals its genre's kind):

  | Genre | neon | nocturne | gothic | iron | void | noir | frontier | kaiju |
  |---|---|---|---|---|---|---|---|---|
  | Kind (resisted) | static | chill | dread | grind | warp | doubt | dust | quake |
  | Weak to | warp | dust | light | static | ink | light | chill | plain |

  A fusion stray has both genres' resistances and only its own (first) genre's weakness. An archetype's resistance or weakness never stacks with its genre's: the same kind counts once. Bright strays (verdant, starlight, summit) never fight: in a fusion they stand aside and cheer (one ally gets +1 edge on their first action each round). Backhalls strays never fight.
- **Lackeys** (**Decided**): `UnitSpec.level` is `max(0, n − 2)`, used for edge, budget cost and adaptation; Integrity is `Math.round(line(n) × multiplier × 0.5)` and Strike `floor(0.75 × strike(n))`, both from the **room's** n (for a walker: 10, 38, 80 and 4, 9, 15 at room levels 1, 5, 10).
- **Elites** are Large (2×2): +10 Integrity at level 1 or below, +15 at 2–4, +20 from 5; +1 edge on their attacks and +2 damage. A level-5 elite walker has 95 Integrity and Strikes for 14 at +1 edge. **Decided:** generated elites carry no signature in Phase 4 (COMBAT §8.3's named elites, such as the Clock, bring theirs when they're written).
- **Tale-leads:** an on-theme stray two levels below the room (one below at gaping, never below 0), made elite, with a ranged option (**Decided:** `UnitSpec.ranged`, range 8, its Strike line) and exactly one mechanic. Each phase has its own bar (**Decided**, in this order): `bar = Math.round((Math.round(line(level) × multiplier) + elite) × (1 + 0.1 × deepRank) × share / xInt)`, where `share` is the room's budget ÷ the same role's budget for four heroes (1, ¾, ½ or ¼ for 4, 3, 2 or 1 heroes) and `xInt` is `tuning.json`'s `xInt[mechanic]`, else `leads.json`'s. Leads take no `integrityFactor`. Hairline leads have two phases (Opening, Last page); open and gaping have three (Opening, Twist, Last page).
  - *Asides* per round: Storybook 1; Long Road 1 in the Opening, 2 from the Twist; Maud's Table 2, then 3. An Aside is a Stride of half its Speed, a Strike for half its Strike (both rounded down, at least 1), or a push of its mechanic, taken at the end of a tick and telegraphed.
  - *Plot armour:* once per phase, the first effect meeting its body or mind Resolve whose outcome is a Graze or better lands one degree worse (a Miss doesn't use it; Strikes meeting Guard never do).
  - *The last page:* at the end of round 8 a lead facing a party that's still standing yields (off at Maud's Table).
  - The bow pays +25% loot and Road XP.

### 4.10 Encounters and budgets

| Tier | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Foe level n | 1 | 2 | 4 | 5 | 7 | 9 | 10 | 11 |

Past tier 8, every 3 depths adds a deep rank: +10% Integrity, +1 damage, +10% loot. **Decided:** `deepRank = max(0, floor((depth − 8) / 3))` for rifts at tier 8. Real rifts run at the party's Road level, never a Wayfarer's. Caves run at `worldgen.tierAt(x, y)` of the cave mouth.

| Stray level | n−4 | n−3 | n−2 | n−1 | n | n+1 | n+2 | n+3 | n+4 |
|---|---|---|---|---|---|---|---|---|---|
| Cost | 10 | 15 | 20 | 30 | 40 | 60 | 80 | 120 | 160 |

- An elite costs as a stray one level higher; a lackey as one two below. Below n−4 costs 5 (**Decided**).
- For four heroes: Trivial ≤ 40, Low 60, Moderate 80, Severe 120; Extreme (160) is never used. Each hero fewer takes 10, 15, 20 or 30 off Trivial, Low, Moderate and Severe.
- A room's **weight** is its budget ÷ 20 (Moderate for four weighs 4), kept unrounded (§4.13 rounds the pay once). A Tale-lead counts as its elite level per bar: 30 a bar from 2 below, 40 from 1 below, times the same `share` as its bars (§4.9), so with two heroes an open lead costs 3 × 30 × ½ = 45 of a Severe 60. Helpers fill what's left; if nothing fits, the lead comes alone.
- **Depth** adds 2 per hero per depth past 3, up to 10 per hero. **Affixes:** crowded ×1.25, lonely ×0.6, colossal adds an elite, sleepy starts the strays surprised; flooded, overgrown, snowbound, smoggy and candlelit lay their surfaces (water, foliage, ice, smog, candle wax) on 15% of a fight room's floor (**Decided**).
- **Caps:** 8 foes and 3 kinds a room; one elite until depth 7. At party levels 1 and 2 nothing counts as more than 2 levels above the party.
- Fights chained without a Breather play a tier harder; staggered waves count a tier lower (both are the sim's concern, not the budget code's).

| Stage | Fight rooms | Mix | Tale-lead's room | Lead phases | Hearth-nook |
|---|---|---|---|---|---|
| hairline | 1 | Low | lead from 2 below, with a lackey: Moderate | 2 | none |
| open | 2 | Moderate | lead from 2 below, with a stray a level below: Severe | 3 | one |
| gaping | 3 | Moderate, two back to back | lead from 1 below, alone: Severe | 3 | one |

**Targets for the tuning suite, as pass criteria** (**Decided** bands; `scripts/tune.mjs` exits non-zero on any failing cell, and a failing cell blocks wave 4's sign-off until it's fixed in the data or taken to Chris; it's never quietly reported):

| Measure | Pass |
|---|---|
| Low rooms, rounds | median in [1.5, 2.5] |
| Moderate rooms, rounds | median in [2.5, 3.5], p95 ≤ 6 |
| Tale-leads, rounds across their phases | median in [4, 5], max ≤ 8 |
| Win rates | Storybook ≥ 99%; Long Road ≥ 95% Moderate, ≥ 85% chained or crowded, ≥ 80% Tale-leads; Maud's Table in [60%, 80%]. A cell passes when the 95% Wilson interval of its 200 fights reaches the target (so the upper bound is ≥ a floor, and the interval overlaps a band) |
| Time to down | a Middle hero survives `floor(middle(L) / strike(L))` on-level stray Strikes = 3, 5 and 6 at levels 1, 5 and 10; Sturdy and Light within one of that (B's content test, from the lines alone) |
| Minutes | a hairline Elsewhere's median ≤ 12 minutes in Command and ≤ 6 Guided, under the model: Command 75 s a round, Guided 40 s, the walk and loot 90 s |
| Pay | auto modes pay the same as Command over 200 seeds per cell (the same rooms, the same Rewards) |
| Noise | over 200 paired seeds per cell, (won with noise off and lost with it on) minus (the reverse) ≤ 2% of fights |

The cells are Road levels 1–5 × the three modes × room kinds (low, moderate, severe, chained, crowded, lead) × party sizes 1–4, each 200 fights. **The reference party** (COMBAT §9's *D*) is pinned: Milo on the Wick path, a sword-and-shield Warden, a Skirmisher and a Scrivener with *Full stop*, all at the Road level, playing Guided with notebooks trained against the scripted player; smaller parties drop members from the end of that list. `npm test`'s 200-fight smoke asserts the same bands widened by half their width again.

### 4.11 Callings

| Calling | Build | Key | Resolve | Armour | Charges | Kit (**Decided**) |
|---|---|---|---|---|---|---|
| lanternkeeper | middle | heed | mind 1 | light | three-quarter | light weapon |
| warden | sturdy | might | body 1 | mail (plate from Road level 5), shield | none | standard weapon and shield |
| mender | light | heed | mind 1 | mail, shield | full | light weapon, shield |
| scrivener | light | wit | mind 1 | none | full | light weapon |
| tinker | sturdy | wit | body 1 | mail, shield | half | standard weapon, shield |
| skirmisher | middle | grace | body 1 | light | none | light weapon |
| longshot | middle | grace | body 1 | mail | half | ranged weapon |
| chorister | middle | charm | mind 1 | light | full | light weapon |
| weaver | light | charm | mind 1 | light | pact | standard weapon (COMBAT §3.7's Pip Strikes for 7 at +20 heat) |

Ability spreads start at +3/+2/+2/+1/+0/−1 as set per character. Milo: Heed +3, Grace +2, Grit +2, Charm +1, Wit +0, Might −1, Small. Regulars take their calling from archetype: construct warden, crawler skirmisher, flier longshot, ghost mender, floater weaver, walker chorister.

What each level brings (every calling): 1 core features; 2 second feature; 3 path; 4 boon; 5 power jump; 6 path feature; 7 calling feature; 8 boon; 9 circle 5; 10 capstone; 11 path feature and damage step; 12 boon, capstone twice per Campfire. The power jump at 5 is a steadier second attack for wardens and longshots (no −1 edge, still +20 heat), circle 3 for full and pact casters, circle 2 for half casters, and **Decided:** *The lantern calls* for Milo, and *Tuck and roll* for skirmishers. §9.4 lists every feature by level.

### 4.12 Lantern charges

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| full | 2 | 3 | 4 | 5 | 7 | 8 | 10 | 11 | 13 | 14 | 15 | 16 |
| three-quarter (Milo) | 2 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
| half | 0 | 2 | 2 | 3 | 3 | 4 | 4 | 5 | 5 | 6 | 6 | 7 |
| pact | 1 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 3 | 3 | 3 |

Highest circle: full and pact reach circle 1 at level 1, 2 at 3, 3 at 5, 4 at 7, 5 at 9; three-quarter 1 at 1, 2 at 3, 3 at 6, 4 at 9; half 1 at 2, 2 at 5, 3 at 9. A spell's circle is its cost in charges. Each extra charge adds a quarter of its amount (rounded down), up to as many extra charges as its circle. Pact charges always cast at the highest circle and return on a Breather; other charges return on a Campfire. **Decided:** past 12 the Wayfarer's charges stay at level 12's.

### 4.13 Road level, the Hearth's cap and rewards

| Road level | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Road XP | 200 | 1,000 | 3,800 | 11,500 | 24,000 | 46,000 | 84,000 | 147,000 | 250,000 | 380,000 | 550,000 |

| Hearth tier (fortress id) | camp | stockade | hold | keep | castle | citadel | kingdom | bright-kingdom |
|---|---|---|---|---|---|---|---|---|
| Highest Road level | 3 | 5 | 7 | 8 | 10 | 11 | 12 | 12 (**Decided**) |
| Regulars' room | 0 (**Decided**) | 2 | 4 | 6 | 8 | 12 | 12 | 12 |

XP past the cap is kept and counts the moment the cap rises. Levels never drop.

| Foe level n | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Road XP per weight | 10 | 20 | 35 | 55 | 80 | 110 | 145 | 185 | 230 | 280 | 335 | 395 |

- **Road XP** = weight × the table at the room's n, +45 per weight per deep rank; a bow ×1.25. A Tale-lead's room pays as 8, 10 or 12 weights at hairline, open and gaping. A wild stitch pays 4 weights at the rift's n. A real rift stitched pays 8 weights at the party's Road level, once per episode (`party.payRealStitches`). **Decided:** past n = 12 the table adds 60 a level. Everyone on the roster gets it, out or not, and Warding gets the same amount.
- **Marks:** 4 × weight × n per fight.
- **Rounding** (**Decided**): Road XP and Marks are computed unrounded (weights are often fractional: Low for three heroes weighs 2.25) and floored once, after the bow's ×1.25.
- **Essences:** 30% per stray room (one of the room's genre), 2–4 from a Tale-lead, and a relic 20% of the time, named the way riftgen names relics (an adjective, a relic and an owner from `riftgen.json`'s lists for the room's genre) and stored in Phase 3's `satchel.relics`. A real rift's Elsewhere pays none; its essences come only from its real stitch.
- **Tonics:** 25% per room: a Hearthberry cordial (`cordial`) 70% of the time, a Brew of clear morning (`brew-of-clear-morning`; counted as `brew`) 30%.
- Loot is seeded per room (`hashInts(fightSeed, 'loot')`). Talking down, bows and every auto mode pay in full. A fight id pays once (§5.1).

### 4.14 Wayfarers' work levels

| Work level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Finished pieces | 0 | 5 | 15 | 30 | 50 | 80 | 120 | 170 | 230 | 300 | 400 | 520 |

**Decided:** past 12, each level needs 140 more pieces. A piece is a crew session of that agent watched to the end (`tally.byCrew`); passed commissions add 3 each from Phase 6. The Scribe and the Artificer fight at `max(workLevel, roadLevel − 1)` with no ceiling. **Decided:** Jev's pieces start only with Judgebird's Glance in Phase 7, so until then Jev fights at the Road level, like Milo, the Tollkeeper and the regulars (`party.fightingLevel`, with a C test). Titles arrive at work levels 1, 4, 8 and 12. Margin Notes (the Scribe) and Spare Parts (the Artificer): one per session watched to the end, up to 3 held, each a one-use page or device for the next fight (§9.4).

### 4.15 Adaptation and modes

| Step | What it does |
|---|---|
| 0 | Never adapts; plays its temperament |
| 1 | Within a fight, dodges one habit once it's seen it twice |
| 2 | Counters your most-used habit from round 2, and reads its genre's memory |
| 3 | Plans for your most-used habit from the start; a lead feints once a phase |
| 4 | Plans for your two most-used habits; a lead feints twice a phase |

Start by rank: lackey 0, stray 1, elite 2, Tale-lead or council member 3. One step down if the foe is 2+ levels below the party's Road level, one up if 2+ above; clamp 0–4. **Decided:** leads and lackeys compare the **room's** n with the Road level, not their own (built-in lower) level, so an on-level Tale-lead adapts at step 3 and at 4 when its room is 2+ above the party, as COMBAT §8.3 has it. Storybook and the *Stray adaptation* switch set every step to 0; Maud's Table adds 1, never past 4. `adaptStep` lives in B's `rules.js` (§7.1), shared by D, B and H. Only leads feint (`LeadState.feintsLeft`).

What each step does, observably (H's `counterFor`, **Decided**): step 0 returns null; step 1 names the first habit in `battle.seen` with a count of 2 or more; step 2, from round 2, names the habit with the highest count in `battle.seen`, or the genre's memory when that's higher; step 3 does the same from round 1; step 4 names the top two. A countered habit changes the foe's plan (it avoids the tile, target or opening the habit uses) and shows the eye with its words.

| | Storybook | Long Road (default) | Maud's Table |
|---|---|---|---|
| Foes | −1 level (the room's n′ = max(1, n − 1); a foe's level never below 0), ×0.75 damage (rounded down) | as written | +1 level |
| Heat | every band one step cooler | as written | every party unit's idle heat +15 |
| AI | plain and polite; never adapts | cover, surfaces, swipes; adapts by rank and level | focus fire, surface combos, crowds a hero who's Rebooting; adapts a step more |
| Genre noise | off | the room's own | every genre in the room at once |
| Breathers per Campfire | 3 | 2 | 1 |
| Tale-lead Asides | 1 | 1, then 2 from the Twist | 2, then 3 |
| *The last page* | round 8 | round 8 | off |

Loot, XP and *Try again* are identical in all three. Chris can ease to Storybook at any moment (a fight switches at the next round start) and make things harder only between fights.

**Where modes apply** (**Decided**). The bestiary builds every foe as Long Road (mode-free), and `heroSpec` takes no mode. B applies the mode from `battle.mode`:
- **At creation:** each foe's level shifts (Storybook −1, Maud's +1, never below 0), and its Integrity (max and current) and Strike scale by the stray row's ratio between the shifted and the built level (`strayRow(level′) / strayRow(level)`, rounded); party units' idle heat gets Maud's +15.
- **From the next round's start after a switch:** foe levels for edge, the ×0.75, the bands, Asides, adaptation, noise, idle heat and *The last page* change; Integrity and Strike stay as they are, so no bar jumps mid-fight. Nothing changes before that round starts.
- **The first Tale-lead** Chris ever meets gets every Storybook modifier above, at creation, whatever the mode.

### 4.16 Genre noise

Named on a banner before Run with its rate. Seeds (never the outcome stream; `i` is the actor's index on the ribbon): per-action draws use `hashInts(seed, attempt, round, tick, i, slot, 'noise:' + genre)`; the void pair `hashInts(seed, attempt, round, tick, 'noise:void-pair')`; the kaiju row `hashInts(seed, attempt, round, 'noise:tremor')`; the Backhalls repeat `hashInts(seed, attempt, round, 'noise:hum')`. Each actor's draws are independent, so over 100,000 (round, tick, actor) draws each rate is within 0.5 points and Lag and Nodding off correlate below 0.01 (a B test).

| Genre | Noise | Rule |
|---|---|---|
| neon | Lag | Each action lands a tick late with chance 1 in 5: it resolves after every other action of the next tick (a tick-3 action resolves after tick 3 and any fourth tick) |
| void | Out of order | In each tick with 2+ actions, one seeded adjacent pair swaps with chance 1 in 4 (**Decided**: COMBAT gives no rate) |
| nocturne | Nodding off | Each action is slept through (lost) with chance 1 in 6 |
| iron | Backlog | At most 4 actions resolve in a tick; the rest wait for the next tick (the last tick's overflow waits for the end of the round) |
| frontier | Fastest gun | Within each tick, the fastest actor (by Speed, ties by the ribbon) acts first; the rest keep ribbon order, as COMBAT §3.6 has it |
| gothic | Guttering candles | Telegraphs whose target tiles are all Dark are hidden ("?") until the tick they happen |
| kaiju | Tremor | At the start of each round one seeded row of arena tiles turns to rough ground (difficult) for the round |
| backhalls | The hum | One seeded queued stray action repeats once at the end of the round |
| starlight (bright, in a fusion) | Kind noise | A Hit becomes a Critical with chance 1 in 10. **Decided:** it's folded into the bars before the pick (a tenth of the Hit bar, rounded down, moves to Critical), so the bars shown are the bars used and it takes no draw of its own |

Noise never delays or sleeps through a Reboot, or a patch on an ally under ¼ of their Integrity (a B test per rule). With noise off, every tick plays in ribbon order.

**Hidden and false intents** (not noise; H's `strays.telegraphsOf`, **Decided**): a Noir stray's telegraphs show "?" until a Seek reveals them for the round, an Examine for the fight, or it stands in the Hooklight's light. A Void stray's telegraph names a false target with chance 1 in 3 (`hashInts(seed, attempt, round, i, slot, 'void-false')`, only when another legal target exists) until it's Examined.

### 4.17 Light, sight, sneak and surfaces

- Tiles are Lit, Dim or Dark. A tile's light is the brightest of: the arena's own (`Arena.light`), any light in `Battle.lights` whose radius covers it (the Hooklight, *Little light*, a lit lamp or candle), and a lit surface on it (candlefire, burning oil, burning foliage, a streetlight pool); inside a light's radius a tile is Lit. The Hooklight is the light `hooklight`, following Milo, radius 3 (5 when raised; raised automatically at the fight's start; 0 when dropped, §6.5). Lamps and candles are objects with `state: 'lit' | 'dark'` and radii in `rules.json` (a lamp 3, a candle 1). Darksight: Pip, Whisper, Lumi and ghosts; anything aimed into Dark tiles the attacker can't see into is −1 edge.
- **Cover** (**Decided**, `grid.cover`): draw the line between tile centres. Low cover (an `o` cell, a `cover-low` prop or object, or a creature in the way) counts when the line crosses it on a tile next to the target but not next to the attacker: −1 edge. The line clipping a high-cover corner (`O`, `#`, a `cover-high` prop) next to the target is heavy cover: −2. A line through a high-cover tile blocks sight. An attacker standing higher than a low-cover tile sees over it (no penalty).
- **Hazard props** (flag `hazard`) burst once when a Light hit reaches them: the `two` line in Plain on every unit within 1, at the room's level, then the prop becomes rubble (low cover).
- A fight room's sight: 6 tiles in Lit, 3 in Dim or Dark (1-2-1 distance, with line of sight) from any foe post. In the open wilds, sight never starts a fight.
- **Sneak** halves walking speed (the engine's `setSneak`). Entering a room's sight while sneaking lands one outcome for the whole party on the Cool band from `unit(hashInts(fightSeed, 'sneak'))`: +1 edge if most of the party stands in Dim, +2 in Dark or foliage, −1 per point of the sharpest watcher's mind Resolve. Hit or better: the party is Unseen. Hovering the room while sneaking shows those odds first (B's `sneakCheck`). A surprised side loses all three actions of round 1.
- **Creeping past** (**Decided**): while Unseen, the party may walk through a room whose foes are all sleepy or lost without starting its fight; attacking, Talking down or ending a move beside one of them starts it, with the foes surprised.
- **Set the ambush** (Warding 30): while Unseen, before round 1, the party may be placed on any free tiles within 3 of their formation tiles (`createBattle`'s `placement`).
- Surfaces land on the Cool band against the Resolve they name. Their numbers are level 1's and grow by 1 for every 3 levels of the room past the first (**Decided:** `+ floor((level − 1) / 3)`, so +1 at level 4). Floaters and fliers ignore them. Stepping onto a slippery tile is always safe.
- Height is 0, 1 or 2 (8 px a step). A fall or a shove off a ledge deals the `one` line in Plain, at the room's level, per step, and Tumbles.

### 4.18 Rests and recovery

- **After every fight:** everyone tops up to half Integrity (rounded up), anyone Offline comes back at half (rounded up), heat returns to idle, every condition ends except a Reboot's Rattled.
- **Breather:** offered on the victory card, at most one per fight (`party.outing.breatherFight`), up to 3 / 2 / 1 per Campfire by mode. A short rest at a lit lantern counts as one. A focus session that finishes while the party is out gives a free Breather that doesn't count; if a fight is live then, it sets `party.outing.freeBreather` and `afterFight` applies it, because a Battle only ever changes through `apply`. Each hero gets back half their max Integrity (rounded down, at least 1; capped at max), heat to idle, per-Breather features and pact charges return, and Rattled clears.
- **Campfire:** everything returns (Integrity, charges, Breathers, features) and Rattled clears. Free at the muster, at home by Hearthvale's fire, at a lit lantern outside any Elsewhere once per real day (`party.rests.lanternDay`), and at an Elsewhere's hearth-nook once per Elsewhere.
- **Reboot:** ¼ of max Integrity and Rattled 1 until the next Breather. A hero who drops a second time in the same fight stays Offline until it ends.
- **Everyone offline** (every hero Offline; a standing drone, turret or decoy doesn't count): Toby's handcart, and everyone wakes at `wilds.wake` (the last lantern rested at; home when none) with full Integrity and everything found. The Elsewhere keeps its settled rooms and opened chests until the rift closes; other rooms reset. *Try again* (back to the start of that fight with the Integrity it was entered with, `attempt + 1`) is free; so is going back in once (`party.rests.freeReentry`).
- **The expedition's life** (**Decided**): `state.expedition` is made when the party steps in (after the Ember spend) and survives *Head home*, *Go home*, everyone going offline and relaunches, with `inside: false` while the party is out. It clears when its place closes (a wild rift or field boss when its id rolls over, a real or story rift when its episode ends, a cave when the day rolls) or when the party steps into a different place, which replaces it; that place's settled rooms and opened chests are then forgotten. L1's frontier pass does the clearing (normalisers never do).

### 4.19 Warmth, cheers and the party

- Warmth thresholds: Stranger 0, Acquaintance 10, Companion 30, Friend 60, Fireside 100. It never falls, and never notifies. Outings pay +2 each (`afterFight`, once per outing), at most +6 a week, where a week starts on the local Monday (**Decided**); a habit pays +1 on a local day it happens (`topUpCrewGifts`). In Phase 4 only Acquaintance does anything: it opens that companion's camp scene (§9.10).
- Cheers: up to 4 held (`party.cheers`). Spending one on a slot before Run folds its Graze and Miss into Hit. The first fight ever won gives one (`afterFight`, `road.firstWin`).
- Playbook rules: 1 per companion from the start, 3 from Warding 15, 6 from Warding 50 (`party.maxRules`, enforced by C's rule setter).
- Four go out: Milo and up to three companions. The Ember cost ignores party size.

### 4.20 Embers

Bank cap 100. `lifetime` counts every Ember earned, banked or not: it keeps counting past the cap (COMBAT §12, PLAN §6). The ledger keeps the newest 300 entries. Only `embers.earn` raises the balance, and only `payFromSignals` and `kindleTick` call it (a source-scan test in A).

| Earned | Embers | Key (pays once) |
|---|---|---|
| A finished Kindle focus session | 10 | `focus:<startedAt>` |
| An honoured rest (the 15-minute rest after a finished focus session ran out without a new focus starting early) | 5 | `rest:<restStartedAt>` |
| A crew session finished, by `tallyFinished`'s once-per-session rule | 2, at most 10 **Embers** a local day | high-water mark on `tally.sessionsFinished`; the mark always advances in full, so sessions past the day's cap are forfeited, not carried over (**Decided**) |
| A needs-you answered (`tallyAnswered`; a session vanishing, its process ending or its source going down is never an answer) | 1, at most 5 Embers a local day | high-water mark on `tally.answered`, forfeiting the same way |
| A real rift stitched (`rifts.stitched.real`: a Nocturne, Knocking or Capacity rift sealed, as Phase 3 counts it; §17) | 5 | high-water mark on `rifts.stitched.real` |
| A building designed (first designs only) | 5 | high-water mark on `tally.buildingsDesigned` |

| Spent | Embers |
|---|---|
| Stepping into a wild rift's Elsewhere, or a ladder rung | `min(10, 5 + floor((depth − 1) / 3))`: 5 at depth 1–3, 6 at 4–6 … 10 from 16 (COMBAT §12: "+1 per 3 depths, up to 10") |
| A real rift's Elsewhere | 5 |
| A story rift's Elsewhere (the Prologue's crack) | 0 (**Decided**: the Prologue is unchanged, §3.2) |
| A field boss's *Challenge* | 5 |
| A cave | 3 |
| A new wild chunk charted | 1 |

*Try again*, fights inside, rests, the muster and the camp cost nothing. Going back into a rift after everyone went offline is free once. Leaving by choice and going back costs the entry again. A door Chris can't afford says so calmly and offers only leaving; nothing ever blocks leaving or walking. **Decided:** walking with an empty wallet still works everywhere, but new chunks stay under fog (and pay no Cartography) until there are Embers again, when the shell charts the ones it skipped (§12.4); the Log says so once a day. A ruin tablet's reveal is free and pays no Cartography (`chartChunks(…, { free: true })`).

**The backlog** (**Decided** mechanism): the first load with an `embers` section missing marks `through: null`. The next `payFromSignals` pays every counter's whole count at the rates above, ignoring daily caps, as one ledger entry "From before the Kit" (its `n` may be up to 1,000,000), banked up to the cap, with all of it counted in `lifetime`, then sets `through` to the current counts. Life XP's backlog is paid the same way, uncapped (§4.21).

### 4.21 Skills

- The classic curve: `xpForLevel(L) = floor(¼ × Σ_{l=1}^{L−1} floor(l + 300 × 2^(l/7)))`; level 99 = 13,034,431 XP; XP is capped at 200,000,000.
- Life skills (from real work only): Artifice, Scribing, Illumination, Scholarship, Stewardship, Command, Focus, Hearthkeeping, Tidereading. Gathering: Woodcutting, Fishing, Foraging, Mining, Gardening. Making and roaming: Cooking, Smithing, Crafting, Alchemy, Construction, Cartography, Wayfaring, Warding, Spellcraft, Seamcraft.
- Phase 4's sources (in `content/xp.json`; every other skill shows level 1 and where it comes from):

  | Source | Skill | XP | Notes |
  |---|---|---|---|
  | A Kindle focus session finished | focus | 1,000 | PLAN §4 |
  | An honoured rest | hearthkeeping | 400 | PLAN §4. **Decided:** Phase 4 has the source, so it flows |
  | A crew session finished | command | 100 | **Decided** |
  | A needs-you answered within 15 minutes | command | 100 | PLAN §4; slower answers pay no XP |
  | A building designed (first design) | artifice | 1,000 | **Decided** (proven levels pay 5,000 × level from Phase 6) |
  | Road XP from any fight, bow or stitch | warding | same amount | COMBAT §5.2 |
  | A knack in a fight / a spell in a fight | spellcraft | 5 / 40 × circle | COMBAT §6 |
  | A new wild chunk charted | cartography | 40 | **Decided** |
  | A lantern lit for the first time / a lantern travel | wayfaring | 150 / 25 (at most 10 travels a day) | **Decided** |
  | A log chopped | woodcutting | 25 per log | **Decided** |
  | A wild stitch / a real rift stitched | seamcraft | 300 + 30 × depth / 500 | **Decided** |

- **Who pays what:** A's `payFromSignals` and `payLifeFromSignals` (Command, Artifice, backlogs), `kindleTick` (Focus, Hearthkeeping) and `chartChunks` (Cartography) each write the Chronicle themselves; C's `payFight` (Road XP and Warding for a room), `payStitch` (a wild stitch: Road XP, Warding and Seamcraft, called by L2's `stitchInside` in `app.js`) and `payRealStitches` (a real rift stitched: Road XP, Warding and Seamcraft 500, from the `road.stitchedThrough` high-water mark, called by L1's `frontier.runRiftLoop` pass); L1's `fight.js` pays Spellcraft from the fight's `act` events; L2's `app.js` pays Wayfaring (a lantern lit, a travel) and Woodcutting (a chop). Every payer uses `lifeskills.addXp`, which records the Chronicle's XP line (`chronicle.xpLines`) and returns the drop to show.
- Warding unlocks options, never power: *Wedge* at 5; *Ready* at 10 (`createBattle`'s `warding` option gates it in `legalActions`); 1 playbook rule per companion from the start, 3 at 15 and 6 at 50 (`party.maxRules`); *Set the ambush* at 30 (while Unseen, place the party within 3 tiles of its formation before round 1, through `createBattle`'s `placement`).

### 4.22 Timing

| Beat | Time |
|---|---|
| A tile of movement | 140 ms |
| Melee | 600 ms |
| Cast | 800 ms + 400–700 ms of effect |
| Hit reaction | 250 ms |
| Outcome flash | 150 ms over the hit reaction |
| A stray beat | at most 1.5 s; halved by *Fast foe turns* (on by default) and again at 2× or 4× |
| A Critical | 80 ms hit-stop and a 3-frame ink flash (neither with motion off) |

Clips play at 8–12 fps on the engine's accumulated `dt`, never `setTimeout`. A hidden window holds playback. Playback speed 1×, 2× or 4× divides every beat.

### 4.23 Kindle

Focus 50 minutes, rest 15. A focus session's end starts the rest at once. A rest that runs its full 15 minutes without a new focus starting is honoured. Banked Coals started on its own (without a finished focus) rests but pays nothing (**Decided**, so rests can't be farmed). Stopping a focus early pays nothing and ends the cycle.

## 5. Shared shapes

Every shape here is plain JSON-able data (no functions, no `Map`, no typed arrays except where marked), frozen by whoever creates it, and never mutated by a consumer. Field order in the listings is the order producers write. Anything not listed is not allowed in a `Battle` or a `BattleSave`.

### 5.1 Ids, coordinates and seeds

- **Unit ids:** `milo`; companion ids `claude`, `codex`, `jev`, `tollkeeper`, and the data-only ten `rivet`, `pip`, `dusty`, `juno`, `mae`, `lumi`, `tova`, `nell`, `whisper`, `vesperine` (their file names and `rules.json`'s idle-heat keys); regulars `reg-<base36>` (a slug ≤ 40, from `hashInts(riftSeed, strayIndex, 'regular')`); foes `f0`, `f1`… (index in `FightSpec.foes`, which never holds the lead); the Tale-lead `lead` (`FightSpec.leadUnit`); foes a fight makes (a clerk off the assembly line) `s0`, `s1`…; devices a fight makes `d0`, `d1`… The engine's entity id for any of them is `cb:<unitId>`.
- **Room ids:** `r<i>` (the index in `layout.roomRects`), `lead` (the Tale-lead's room), `field` (a field boss).
- **Fight ids** pay once (`road.paidFights`) and name the episode:
  - a wild rift or ladder rung: `fight:<riftId>:w:<roomId>` (a wild rift's id already changes daily);
  - a real or story rift: `fight:<riftId>:<since base36>:<roomId>`;
  - a cave: `fight:cave:<x>,<y>:<dayNumber>:<roomId>` (a cave's rooms reset each real day, **Decided**);
  - a field boss: `fight:<riftId>:w:field`.

  All match `/^fight:[a-z0-9:,.-]{1,90}$/`.
- **Coordinates:** a battle's tiles are **scene tiles**: the Elsewhere's or cave's own grid (0,0 top-left), or world tiles for a field boss. `arena.rect` uses the same coordinates. The words for a tile in telegraphs are the arena's column letter (`a`–`t`, left to right from `rect.x`) and row number (1–16, top down from `rect.y`): "the puddle at e5".
- **Seeds:** `fightSeed = hashInts(sceneSeed, roomId, 'fight')`, where `sceneSeed` is `spec.seed` for rifts and `cave.seed` (§7.7) for caves. Outcome *k* of attempt *a* is `unit(hashInts(fightSeed, a, k))` against the bars (Critical first, then Hit, Graze, Miss, cumulative). `k` starts at 0 and rises by 1 for every outcome picked, and nothing else draws from it. Other streams: initiative spread `2 × unit(hashInts(fightSeed, unitIndex, 'init'))` (independent of the attempt, so the ribbon never changes on *Try again*), noise and Void's false targets (§4.16), loot `hashInts(fightSeed, 'loot')`, sneak `hashInts(fightSeed, 'sneak')`.
- **Damage kinds:** `static`, `chill`, `dread`, `grind`, `warp`, `doubt`, `dust`, `quake`, `light`, `ink`, `spark`, `plain`.
- **Condition ids:** `tumbled`, `tangled`, `drowsy`, `dazzled`, `spooked`, `beguiled`, `queasy`, `rattled`, `dazed`, `slowed`, `quickened`, `brisk`, `winded`, `sparked`, `singed`, `soaked`, `hushed`, `unseen`, `exposed`, `singled-out`, `offline`, plus `lingering` (any kind; `data.kind`, `n` = amount).
- **Surface ids:** `neon-puddle`, `candle-wax`, `candlefire` (lit wax), `oil-slick`, `burning-oil`, `smog`, `gravity-well`, `dust-cloud`, `streetlight-pool`, `moonbrew-spill`, `steam`, `water`, `foliage`, `burning-foliage`, `ice`, `rough-ground` (Titan tremor).

### 5.2 UnitSpec (party.js and bestiary.js → battle.js)

```js
UnitSpec = {
  id: string,                       // §5.1
  side: 'party' | 'foe' | 'neutral',  // neutral: a bright stray that cheers, never targeted by the party's attacks
  name: string,                     // ≤ 40, calm; leads pass through leadDisplayName (§7.3)
  kind: string,                     // 'milo' | companion id | 'regular' | 'stray' | canon foe id | 'creature' | 'lead' | device template id
  talkKind: string | null,          // the kind Talk down counts against: 'k<i>' (spec.strays index), a foe or creature id; null for heroes, leads, devices
  rank: 'hero' | 'lackey' | 'stray' | 'elite' | 'lead' | 'device',
  level: number,                    // fighting level, 0–40
  size: 1 | 2,                      // 2 = Large on (x..x+1, y..y+1); (x, y) is the top-left tile
  small: boolean,
  archetype: null | 'walker' | 'crawler' | 'floater' | 'flier' | 'ghost' | 'construct',
  genres: string[],                 // [] for vale heroes and cave foes; a stray's [genre] or [genre, second]
  temperament: null | 'shy' | 'curious' | 'grumpy' | 'dramatic' | 'sleepy' | 'polite' | 'lost' | 'nosy' | 'proud',
  calling: null | string, path: null | string,
  abilities: { might: number, grace: number, grit: number, wit: number, heed: number, charm: number },   // −1..5
  maxIntegrity: number, integrity: number,     // integrity ≤ max; heroes carry the outing's value
  guard: 0 | 1 | 2,
  resolve: { body: 0 | 1 | 2, mind: 0 | 1 | 2 },
  speed: number,                    // final, 1–12 (Small, flying and Grace already applied)
  moves: { flies: boolean, hovers: boolean, throughWalls: boolean, darksight: boolean },
  strike: { amount: number, kind: string, reach: 1, range: number /* 0 melee, 8 floater, 12 bows */, weapon: 'light' | 'standard' | 'heavy' | 'ranged' | 'natural' },
  ranged: null | { range: number, amount: number },   // a second, ranged Strike option (Tale-leads: range 8, the Strike line); a Strike action picks by target distance
  keyAdjust: number,                // heroes and regulars: key ability − 3, added to every amount they deal; foes 0
  flat: number,                     // added to every damage amount (elite and lead +2; deep rank +1 each)
  attackEdge: number,               // edge on its own attacks (elite and lead +1)
  resist: { [kind]: number }, weak: { [kind]: number },
  ignores: string[],                // condition ids (constructs: queasy, drowsy, beguiled; ghosts: tangled, tumbled)
  idleHeat: number,                 // 0–100, path shifts applied; never the mode's (B adds Maud's +15, §4.15)
  shield: boolean,
  charges: { pool: 'full' | 'three-quarter' | 'half' | 'pact' | null, max: number, left: number, circle: number },   // circle 0 = none
  abilityIds: string[],             // every ability (§6) it may use; basic actions (§4.4) are implicit; foes' come from rules.json's archetype and genre lists
  uses: { [abilityId]: number },    // uses left of per-Breather and per-Campfire abilities, from the outing
  reactions: { [reactionId]: 'ask' | 'always' | 'under-half' | 'never' },   // settings; foes use 'always'
  control: 'mine' | 'review' | 'choose' | 'auto',   // party: set per hero; foes and devices 'auto'
  adapt: 0 | 1 | 2 | 3 | 4,         // foes; heroes 0
  rattled: boolean,                 // a Reboot's Rattled 1 carried until the next Breather
  lead: null | { mechanic: string /* leads.json id, or 'fallback' */, phases: 2 | 3, bars: number[], quote: string },
  post: null | { x: number, y: number },   // foes' start tile; heroes are placed from arena.entry
  look: Look,
  carry: { cordial: number, brew: number, margin: number, spare: number, essences: number, stitched: string[] }
    // only Milo's spec carries the party's tonics (any hero may use them, §4.4); the Scribe's Margin Notes, the Artificer's Spare Parts,
    // and a Weaver's essences and stitched genres (for Borrow a rule) sit on their own specs; everything else 0 or [].
    // An ability with `consumes` (§6.1) takes one from here; `afterFight` writes what's left back to the satchel and `Member.gifts`
}

Look = { kind: 'rig', rig: 'coat' | 'robe' | 'jev' | 'toll', who: string, likeness: null | 'clay' | 'slate' }
     | { kind: 'stray', archetype, bodyKey, parts: [{ id, layer }], eyeKey: null | string, genres: [string | null, string | null], scale: 1 | 2 }
     | { kind: 'device', template: string }   // drawn from PROPS4's `device.<template>` frames (§7.8)
     | { kind: 'sprite', name: string }      // an existing SPRITES name, e.g. 'chest.mimic' for a Mimic
```

A hero's amounts are `line(level) + keyAdjust + flat`, where `line` is §4.8's row for the ability; a Strike's is `strike.amount + keyAdjust + flat` (party.js has already applied light −2 or heavy +2 to `strike.amount`). A foe's amounts are its stray line + `flat`.

### 5.3 Arena, FightObject and FightSpec (encounters.js → battle.js and the engine)

```js
Arena = {
  rect: { x, y, w, h },       // scene tiles: the fight room plus 2 tiles into each corridor mouth (§7.3); w ≤ 20 and h ≤ 16
  cells: string,              // w*h chars, row-major, terrain only: '#' wall · '.' floor · '~' deep water · ' ' void · 'o' low-cover prop · 'O' high-cover prop · '=' stairs
  height: string,             // w*h chars '0' | '1' | '2'
  light: string,              // w*h chars 'L' lit · 'd' dim · 'D' dark (the room's own; lights add to it, §4.17)
  mouths: [{ x, y }],         // corridor tiles inside the rect that lead out of the room
  entry: [{ x, y }],          // 4 party start tiles in formation order, Milo's first, on the side the party came from
  seed: number                // hashInts(sceneSeed, roomId, 'arena')
}
FightObject = { id: string /* 'o0', 'o1'… */, kind: string, x, y, state: string, flags: string[], integrity: number | null }
```
- `#`, `O` and void block movement and sight. `~` (water that isn't a ford) blocks movement but not sight. `o` blocks movement and gives low cover. `=` stairs make a height change free. **Decided:** shallow water and foliage aren't cells: they're `FightSpec.surfaces` entries (`water`, `foliage`) with `rounds: null`, so a surface reaction (water to ice, foliage to burning foliage) changes the one record.
- Object kinds and their states (**Decided**, closed; `effects.js` exports `OBJECT_KINDS` and `OBJECT_STATES`): `prop` (flags from `cover-low`, `cover-high`, `light`, `hazard`, `throwable`; `state` is its PROPS4 id, §7.8, or `'rubble'` once burst), `lever` `up|down`, `junction` `off|on`, `lamp` `lit|dark`, `candle` `lit|dark`, `line` `running|shut`, `console` `idle|used`, `lectern` `idle|read`, `alibi` `standing|broken`, `clue` `hidden|found`, `plan-tile` `clear|marked`, `breaker` `on|off`, `forge` `cold|stoked`, `bell` `still|rung`, `riddle-board` `idle|solved`, `chest` `shut|open`, and the devices `snare` `set|sprung`, `patch-kit` `full|used`, `pop-up-cover` `up|broken`. Mechanic objects get their meaning from leads.js (§6.6); `integrity` is set only for breakable ones.

```js
FightSpec = {
  id: string,                 // fight id §5.1
  room: string,               // room id
  kind: 'room' | 'lead' | 'field' | 'cave',
  seed: number,               // fightSeed
  level: number,              // the room's foe level n, after deep rank, before mode
  deepRank: number,
  budget: number, weight: number,
  stage: null | 'hairline' | 'open' | 'gaping',
  genres: string[],           // the room's genres; [] in a cave
  affixes: string[],          // affix ids that matter to a fight
  arena: Arena,
  foes: UnitSpec[],           // side 'foe', or 'neutral' for cheering bright strays; ids f0, f1…; never the lead
  leadUnit: null | UnitSpec,  // the Tale-lead or field boss, id 'lead'
  objects: FightObject[],
  surfaces: [{ x, y, id, rounds }],   // rounds null = until it reacts; includes the room's shallow water and foliage
  lead: null | { mechanic: string, phases: 2 | 3, bow: string, quote: string },
  sight: 6 | 3,
  surprised: null | 'foes',   // the sleepy affix
  real: null | { key: string, cause: string },   // a real rift's Elsewhere: its lead yields and names the cause
  rewards: Rewards
}
Rewards = { weight, n, deepRank, xp, marks, essences: [{ name, genre, qty }], relic: null | { name, genre }, tonics: { cordial: number, brew: number } }
```

### 5.4 Battle and Unit (battle.js; saved as a `BattleSave` in `expedition.battle`)

```js
Battle = {
  v: 1,
  id: string, seed: number, attempt: number, k: number,
  round: number,              // 1-based
  tick: 0 | 1 | 2 | 3 | 4,     // 0 while planning
  cursor: number,             // how many entries of `schedule` have resolved this round
  status: 'planning' | 'running' | 'asking' | 'won' | 'talked' | 'bowed' | 'yielded' | 'last-page' | 'offline' | 'home',
  mode: 'storybook' | 'long-road' | 'mauds-table',
  modeNext: null | 'storybook',   // a switch waiting for the next round's start
  calm: { noise: boolean, adaptation: boolean },
  firstLead: boolean,
  roadLevel: number, warding: number,   // from createBattle's options (§7.1)
  kind, level, genres, affixes, sight, weight, real,   // copied from the FightSpec
  arena: Arena,
  units: Unit[],              // heroes in formation order, then foes (f<i>), then the lead, then spawned foes and devices as they appear
  order: string[],            // the initiative ribbon (unit ids), fixed at creation; a device joins right after its maker, a spawned foe at the end
  objects: FightObject[],
  surfaces: [{ x, y, id, rounds, level }],
  lights: [{ id: string, x: number, y: number, radius: number, rounds: number | null, source: string }],   // ≤ 24; 'hooklight' follows Milo, radius 0 | 3 | 5
  sustained: [{ unitId, abilityId, rounds, target, cost }],
  talk: { [talkKind]: { calm: number, need: number, done: boolean } },
  cheers: number,
  plans: { [unitId]: Plan },  // committed this round, heroes and foes
  telegraphs: Telegraph[],
  drafted: { [unitId]: { confidence: number, source: string, choices: [{ slot: number, template: number, ability: number }], layers: ('rule' | 'habit' | 'personality')[] /* per slot, for thought bubbles */ } },
  schedule: null | [{ unitId, slot, tick, late: boolean }],
  lead: null | LeadState,
  seen: { [habitKey]: number },     // habits shown this fight (adaptation step 1)
  memory: null | { habit: string, count: number },   // the genre's memory read at creation (step 2+)
  log: string[],              // the newest 30 Log lines, each ≤ 100 chars
  ask: null | ReactionAsk,
  result: null | FightResult
}
Unit = UnitSpec + {
  x: number, y: number, facing: 'left' | 'right',
  heat: number, buffer: number,
  conditions: [{ id: string, n: number | null, source: string | null, data: object | null }],
  marks: [{ id: 'bead' | 'wanted' | 'that-pile' | 'drawn' | 'assist', by: string, n: number, until: string }],
  mods: [{ stat: string, by: number, until: string, source: string }],
  offline: boolean, drops: number,
  sorted: null | 'settled' | 'talked' | 'bowed',
  reactionUsed: boolean, attacks: number,   // attacks made this turn (§4.3's index)
  examined: boolean,          // foes: Examined by the party (weaknesses shown; a Void stray's false target gone)
  revealedUntil: null | 'end-of-round' | 'fight',   // a Noir stray's intents: a Seek shows them for the round, an Examine for the fight
  usedRound: { [abilityId]: number }        // per-round and per-target limits
}
LeadState = { unitId: 'lead', mechanic: string, phase: 'opening' | 'twist' | 'last-page', bar: number, bars: number[],
              armourUsed: boolean, feintsLeft: number, asides: number, bow: { progress: number, need: number },
              data: object /* ≤ 1,024 bytes compact; lists of object ids, never tiles */ }
ReactionAsk = { unitId: string, reactionId: string, trigger: string, words: string }   // 'Shoulder the bite on Pip?'

BattleSave = {                 // saveBattle(battle): the Battle minus everything restoreBattle rebuilds (§7.1)
  v: 2, id, seed, attempt, k, round, tick, cursor, status, mode, modeNext, calm, firstLead, roadLevel, warding,
  levels: { [heroId]: number },   // the fighting levels the heroes were built at, so a level that rises mid-pause waits for the fight's end
  units: [{ id, x, y, facing, integrity, maxIntegrity, strikeAmount, heat, buffer, conditions, marks, mods, offline, drops, sorted,
            reactionUsed, attacks, examined, revealedUntil, usedRound, uses, chargesLeft, rattled, carry,
            spawn: null | { template: string, by: string } | { foe: string /* a leads.json or foes.json id */ } }],   // dynamic fields only
  order, objects: [{ id, state, integrity }],
  surfaces: { grid: string /* w*h: '.' none, else the surface's index in SURFACE_IDS in base 36 */, timed: [{ x, y, rounds, level }] },
  lights, sustained, talk, cheers, plans /* only while running or asking */, drafted, lead, seen, memory, log, ask, result
}
```

- **Caps** battle.js enforces itself: units ≤ 16, sustained ≤ 8, surfaces ≤ w×h, lights ≤ 24, objects ≤ 24, telegraphs ≤ 48, per unit conditions ≤ 8, marks ≤ 4, mods ≤ 6, log 30 lines.
- **What's saved** is `saveBattle(battle)`, never the live Battle: the arena, every UnitSpec's static fields, `telegraphs` and `schedule` are rebuilt by `restoreBattle(save, ctx, { fight, heroes })` from the FightSpec (rebuilt from `expedition.source`), the heroes (`party.partySpecs` at `save.levels`), the device templates and `ctx.minds`. A property test over 500 seeds saves at random points and requires `restoreBattle(saveBattle(b))` to deep-equal `b`.
- **Size:** `battleBytes(x)` is the UTF-8 byte length of `JSON.stringify(x)`, the one measure everywhere. `battleBytes(saveBattle(b)) ≤ 49,152` for the fixture of 16 units with every list at its cap, 30 log lines of 100 chars, a 20×16 arena and a plan for every unit (a measured draft of this shape is about 43,400; a typical 8-unit save about 13,500).
- `restoreBattle` is the only way a save becomes a Battle again; it returns `null` for anything it can't trust, and the fight then restarts at attempt 0 of the same room.

### 5.5 Action and Plan

```js
Action = {
  id: 'stride' | 'step' | 'strike' | 'brace' | 'examine' | 'seek' | 'interact' | 'assist' | 'talk-down' | 'cool-down'
    | 'reboot' | 'delay' | 'hide' | 'throw' | 'shove' | 'jump' | 'dip' | 'sustain' | 'ready' | 'head-home' | 'use' | 'aside',
  ability: string | null,     // 'use': an ability id (§6), including items ('cordial', 'brew-of-clear-morning') and mechanic actions ('mech:<name>'); 'throw': null or a tonic id
  cost: 0 | 1 | 2 | 3,        // actions it occupies; a scalable ability's chosen count
  target: null | Target,
  extra: number,              // extra charges (upcast), 0..circle
  choice: string | null,      // an ability's named choice ('pile' | 'sure' for Verdict, a genre for Borrow a rule)
  cheer: boolean,
  trigger: string | null      // Ready's trigger id, from READY_TRIGGERS
}
Target = { unit?: string, units?: string[], tile?: { x, y }, object?: string, path?: [{ x, y }] }
Plan = {
  unitId: string,
  slots: Action[],            // in order
  reactions: { [reactionId]: 'ask' | 'always' | 'under-half' | 'never' },
  by: 'draft' | 'you' | 'auto' | 'foe',
  changed: boolean[]          // per slot, true where Chris changed the draft
}
```

**Ticks.** `ticksOf(plan, unit)` assigns ticks: `t = 1`; for each slot, `delay` (cost 0) waits one tick (`t += 1`); any other action starts at `t`, resolves at the end of tick `t + cost − 1`, then `t` moves past it. An action that would end after the unit's last tick is **lost**, and the planner says so before Run. **Decided:** that's what Delay means in a fixed three-tick round: it holds your later actions one tick back. A unit has 3 ticks, minus Slowed N (the last N are lost), minus 1 when Winded; Quickened adds tick 4 (Brisk's fourth may only Stride or Strike). Dazed N loses the next N actions as they come up (a Tale-lead never more than 2 in a turn).

**Within a tick** actors go in ribbon order (noise aside), each resolving the one action that ends in that tick (a multi-action activity resolves at the end of its last tick; its earlier ticks show it "winding up"). Reactions fire the moment they're triggered, once per round each, and resolve before the triggering action continues.

**When a plan meets the round.** If an action can't happen when its tick comes (target sorted or offline, path blocked, object gone), a companion improvises from its personality (ai.js, §7.2) and Milo Braces; foes re-pick by temperament. Each emits an `improvise` event. Improvisations never become notes.

### 5.6 Telegraph

```js
Telegraph = {
  unitId: string, slot: number, tick: 1 | 2 | 3 | 4,
  icon: 'strike' | 'bite' | 'shoot' | 'cast' | 'area' | 'move' | 'brace' | 'patch' | 'summon' | 'surface'
      | 'shove' | 'talk' | 'hide' | 'examine' | 'mechanic' | 'wait',   // the 16 intent icons (§7.8)
  words: string,              // ≤ 60, plain: 'Bite Pip', 'Short the puddle at e5'
  targets: string[], tiles: [{ x, y }],
  hidden: boolean,            // shown as '?'
  falseTarget: string | null, // Void: shown instead of the real target until an Examine (1 in 3, §4.16)
  adapting: string | null,    // the eye's words: 'Staying off the stairs: Dusty’s climbed them twice.'
  aside: boolean
}
```

### 5.7 Odds

```js
Odds = {
  bars: [number, number, number, number],   // Critical, Hit, Graze, Miss; whole percents summing to 100, the bars actually used
  band: 'cool' | 'warm' | 'hot', heat: number,  // the heat the action will use (after its attack penalty)
  edge: number,               // −3..3 after the cap
  parts: [{ why: string, n: number }],      // 'high ground' +1, 'second attack' −1, 'Guard 1' −1…
  amounts: null | [number, number, number, number],   // what each degree would do after weakness or resistance, before Buffer
  known: boolean,             // false shows '?' beside amounts until the target is Examined
  helpful: boolean, cheer: boolean,
  words: 'likely' | 'about even' | 'a long shot',     // Hit or better ≥ 70%, 40–69%, < 40% (Decided)
  critInReach: boolean,       // Critical ≥ 20%
  changeable: boolean         // a telegraphed foe action that resolves before this slot could change the edge (a Stride into cover, a light going out)
}
```

**The odds used** (**Decided**, what §1 promises): the `bars` of the `outcome` event an action's pick emits. They must equal `oddsFor(battle, unitId, action, ctx, { slot, plan })` computed on the Battle as it stands just before that pick. Every modifier that's settled before the pick is folded into those bars, in this order, each a bars transform in whole percents: the band and edge; Kind noise (§4.16); the helpful floor (Miss into Graze); a Cheer (Graze and Miss into Hit); *Being sure* (one degree better); plot armour while unused (one degree worse, §4.9). The one draw then picks from the folded bars. A reaction that moves the degree after the pick (*Proofread*) emits a second `outcome` event with `by` set to the reaction, so the Log shows both. The planner computes odds before Run, so a slot whose edge a telegraphed foe action can still change is drawn with `changeable: true` ("could change: the beetle may step into cover"). The honesty test compares shown and used bars on 100,000 seeded picks and requires every bar within 0.5 percentage points, and every pick's degree to fall where its `k` draw says.

### 5.8 Event (battle.js → describe.js, anim.js, the HUD and the Log)

Every event is `{ t, round, tick, … }`. `unit` is the actor, `target` the unit acted on. Consumers ignore types they don't know.

| `t` | Fields |
|---|---|
| `round` | `round` (drift, room heat and lingering damage have run; `heat` and `damage` events follow) |
| `telegraphs` | `list: Telegraph[]` |
| `tick` | `tick` |
| `act` | `unit, action: Action, words` (an action begins resolving) |
| `thought` | `unit, text: string / null, picture: 'pile' / 'tilt' / null` (a drafted hero's action, in their own voice, from `describe.thoughtText`: "Patching Milo, like you would."; Jev's are pictures only) |
| `move` | `unit` (the one who moves), `by: string / null` (who made it move: a pusher, a puller, a swapper), `path: [{x, y}]`, `how: 'stride' / 'step' / 'jump' / 'push' / 'pull' / 'teleport' / 'swap' / 'fall'`; a swap is two linked `move` events, one per unit |
| `outcome` | `unit, target, degree: 'crit' / 'hit' / 'graze' / 'miss', bars, k, cheer, by: string / null` (`by` names a reaction that moved an earlier outcome) |
| `damage` | `unit, target, amount, kind, degree, weak, resist, buffered, integrity, max` |
| `patch` | `unit, target, amount, integrity, max` |
| `condition` | `target, id, n, on` |
| `heat` | `unit, heat, band` |
| `buffer` | `unit, buffer` |
| `offline` | `unit` |
| `reboot` | `unit, by` |
| `sorted` | `unit, how: 'settled' / 'talked' / 'bowed'` |
| `calm` | `kind, calm, need` |
| `surface` | `tiles, id, rounds, on` |
| `object` | `object, state` |
| `light` | `lights` (the whole `Battle.lights` after a change: the Hooklight dropped or raised, a lamp out, *Little light*) |
| `spawn` | `unit: UnitView / null, object: FightObject / null` (a clerk off the line, a device, a snare or cover) |
| `gone` | `unit, why: 'expired' / 'broken' / 'left'` (a decoy at the round's end, a turret's rounds up) |
| `reaction` | `unit, id, trigger` |
| `ask` | `ask: ReactionAsk` (playback pauses until answered) |
| `noise` | `genre, what: 'lag' / 'swap' / 'slept' / 'backlog' / 'fastest' / 'hidden' / 'tremor' / 'repeat' / 'kind', unit` |
| `feint` | `unit, spotted` |
| `improvise` | `unit, from: Action, to: Action, why` |
| `lost` | `unit, action, why: 'dazed' / 'slowed' / 'winded' / 'wont-fit' / 'offline' / 'asleep'` |
| `phase` | `unit, phase, quote` |
| `bar` | `unit, bar, integrity, max` |
| `bow` | `progress, need` |
| `reveal` | `unit, what: 'stats' / 'unseen' / 'intent' / 'mechanic', text` |
| `cheer` | `cheers` |
| `bark` | `unit, text: string / null, gesture: string / null` (B emits it from `ctx.party`'s barks, on a Critical or when someone goes Offline, at most one a round; Jev's are gestures only) |
| `line` | `text` (a Log line that no other event carries) |
| `end` | `result: FightResult` |

### 5.9 Outcome bars and the FightResult

The four-bar display is `Odds.bars`. A FightResult:

```js
FightResult = {
  fightId: string,
  outcome: 'won' | 'talked' | 'bowed' | 'yielded' | 'last-page' | 'offline' | 'home',
  rounds: number,
  sorted: number, calmed: string[],        // talk kinds settled
  bow: boolean,
  real: null | { cause: string },          // "Settle me all you like. The Habitack checks are still red."
  auto: boolean,                           // any round played on auto
  summary: string                          // ≤ 200, the campfire summary: 'Rivet held the door. Milo kept the lantern high.'
}
```
`won`, `talked`, `bowed`, `yielded` and `last-page` pay the room's Rewards (a bow ×1.25). `offline` and `home` pay nothing for this room and spend nothing.

### 5.10 Situation features and the Note (24 bytes)

A notebook file is a run of frames (§10.2); each frame holds whole notes. A note is exactly 24 bytes, little-endian:

| Byte | Name | Meaning |
|---|---|---|
| 0 | selfShare | `round(255 × integrity / max)` |
| 1 | lowAlly | the lowest share among standing allies other than self (255 if none) |
| 2 | allies | bits 0–1 allies below half (0–3); bits 2–3 allies Offline (0–3); bit 4 self in light; bits 5–6 self's cover (0 none, 1 low, 2 high or heavy); bit 7 self on higher ground than the nearest foe |
| 3 | foes | bits 0–4 1-2-1 distance to the nearest standing foe (capped 31); bits 5–7 foes standing (capped 7) |
| 4 | threat | bits 0–2 what the next foe to act aims its first hostile action at (0 nothing, 1 self, 2 the lowest ally, 3 another ally, 4 an area with self in it, 5 an area without); bits 3–5 its kind (0 strike, 1 effect, 2 move, 3 hidden, 4 a spotted feint); bits 6–7 ticks until it lands (0–3) |
| 5 | genre | the room's first genre as its index in `content.genres.genres` + 1 (0 none) |
| 6 | foe | bits 0–3 the nearest foe's temperament index + 1 (0 none or a lead); bits 4–6 its rank (0 lackey, 1 stray, 2 elite, 3 lead, 4 canon foe or creature) |
| 7 | heat | own heat, 0–100 |
| 8 | round | bits 0–3 round (capped 15); bits 4–5 lead phase (0 none, 1 Opening, 2 Twist, 3 Last page); bit 6 the party is Unseen or the foes surprised; bit 7 a lead is present |
| 9 | foeShare | the lowest standing foe's share, 0–255 |
| 10 | resources | bits 0–3 own charges left (capped 15); bit 4 reaction unused; bit 5 a Cheer held; bit 6 Buffer up; bit 7 a limited ability ready |
| 11 | known | bits 0–1 the nearest foe's weakness to own kind (0 unknown, 1 none, 2 weak); bit 2 nearest foe Examined; bit 3 an Offline ally within 2; bit 4 a hurting surface under self; bit 5 self Unseen; bit 6 a kind's calm > 0; bit 7 an unlit lamp, candle or junction in the arena |
| 12 | conditions | bit 0 self Tumbled; 1 Tangled; 2 Spooked; 3 Rattled; 4 an ally within 6 Drowsy or Beguiled; 5 a foe in reach Drowsy or Tangled; 6 an ally under a quarter; 7 self Singled out |
| 13 | reach | bits 0–3 foes within own reach or range; bits 4–7 foes within 6 |
| 14 | allyNear | bits 0–3 distance to the lowest ally (capped 15); bits 4–5 allies within 2 (capped 3); bits 6–7 party size − 1 |
| 15 | mode | bits 0–1 difficulty (0 Storybook, 1 Long Road, 2 Maud's Table); bits 2–3 room kind (0 stray room, 1 lead room, 2 field, 3 cave); bits 4–7 party level − room level, clamped −8..7, + 8 |
| 16 | template | choice template id (notebook.js `CHOICES`, stable forever once shipped) |
| 17 | slotInfo | bits 0–1 slot (0–3); bits 2–3 action count (1–3); bits 4–5 target relation (0 none, 1 self, 2 ally, 3 foe); bits 6–7 zero |
| 18–19 | ability | uint16: `hashString(abilityId) & 0xffff`; 0 for a basic action |
| 20 | weight | bits 0–1 weight (1 accepted or written in Command, 2 a correction); bit 2 taught at the fire (counts once); bits 3–7 zero |
| 21–23 | order | uint24: this note's sequence number in its notebook, strictly increasing from 0 |

Bytes 0–15 are the **situation**, computed by `situationOf(battle, unitId)` (notebook.js) at planning time, before any change. Bytes 16–23 are the **choice**. A **habit** is a `(template, ability)` pair; its key is `'<template>:<ability>'`.

### 5.11 Draft and why

```js
Draft = {
  unitId: string,
  plan: Plan,                 // by: 'draft'
  confidence: number,         // 0–100; drawn dashed under 50
  source: 'rule' | 'habit' | 'personality' | 'mixed',
  why: [{ slot: number | 'reaction', layer: 'rule' | 'habit' | 'personality' | 'rail',
          text: string,       // 'You patched the most hurt ally in 11 of 12 fights like this.'
          count: number | null, of: number | null }],
  choices: [{ slot: number, template: number, ability: number }]
}
```
Jev's `why` text is the planner's voice ("Jev piles the nearest stray first, in 5 of 6 fights like this."), never Jev's.

## 6. The effect language

Every knack, spell, calling feature, companion move, weapon art, boon, item, device and Margin Note is data in this one language. B implements it (`src/combat/effects.js` and `abilities.js`); C writes callings, spells and companion moves in it; D and I use it for foes and mechanic actions. **The vocabulary is closed:** a content file may use only the fields, verbs, predicates, triggers and rule ids below, and a content test (C's and D's) rejects anything else. A new verb or rule id is a contract change, recorded in §18.

### 6.1 An ability

```js
Ability = {
  id: string,                 // slug, unique across callings.json, spells.json, companions' moves, regulars.json, foes.json and leads.json
  name: string,               // in LORE §21 or in the owner's pending list (§16.3)
  kind: 'knack' | 'spell' | 'feature' | 'move' | 'reaction' | 'passive' | 'art' | 'boon' | 'item' | 'device',
  circle: 0 | 1 | 2 | 3 | 4 | 5,   // spells; 0 for everything else
  attack: boolean,            // adds heat and takes the attack penalty (§4.3)
  big: boolean,               // a stray's biggest move: a dramatic stray opens with it (§4.6); false everywhere else
  consumes: null | 'cordial' | 'brew' | 'margin' | 'spare' | 'essence',   // legal only while the carrier has one (tonics: Milo's carry); one is used up per use
  meets: 'guard' | 'body' | 'mind' | null,   // what an effect on a foe lands against; null = helpful or automatic
  helpful: boolean,           // a Miss counts as a Graze
  cannotMiss: boolean,        // harmful, but a Miss counts as a Graze (Inkdarts)
  outcome: boolean,           // picks an outcome per target (default true; false for automatic effects such as Interact-like moves)
  spoken: boolean,            // Hushed stops it
  costs: number[],            // allowed action counts, e.g. [1], [2], [1, 2, 3]; [] for reactions and passives
  uses: null | { per: 'turn' | 'round' | 'target-round' | 'breather' | 'campfire' | 'fight', n: Num },
  sustained: null | { max: 10 },   // a sustained spell (one at a time per unit)
  requires: Predicate[],      // on the user: 'lantern-down', 'has-device', 'examined-target', 'stitched-genre'
  reaction: null | { when: Trigger, range: number },
  passive: null | { mods: Mod[], aura: null | { radius: Num | 'light', who: 'allies' | 'allies-and-self' | 'foes', mods: Mod[] }, rules: string[],
                    summons: [{ template: string, at: 'fight-start' }] /* the Bench drone stands ready when the fight begins */ },
  choices: null | { [choice: string]: { words: string, target: TargetSpec, effects: Effect[] } },
  by: null | { [cost: string]: { target: TargetSpec, effects: Effect[] } },   // per action count
  target: null | TargetSpec, effects: null | Effect[],   // for single-cost abilities, instead of `by`
  crit: Effect[],             // the move's critical effect, applied in addition on a Critical
  upcast: boolean,            // spells: each extra charge adds ¼ of every amount, up to `circle` extras
  words: string,              // the planner's short verb phrase: 'Letter Pip' is words + target
  text: string,               // calm description, ≤ 140
  stub: boolean, from: string | null   // a stub is never a legal action; `from` says when it arrives ('Phase 5')
}
Num = number | { byLevel: { [level: string]: number } } | 'wit' | 'charm'   // byLevel: the value at the highest key ≤ the user's level; 'wit' and 'charm': the user's ability, at least 1
```

Exactly one of `by`, `choices`, or `target` with `effects` is set, except for passives (none of them) and reactions (`target` and `effects`, with the trigger's subject as the default target).

### 6.2 Targets

```js
TargetSpec = {
  who: 'self' | 'ally' | 'ally-or-self' | 'foe' | 'unit' | 'offline-ally' | 'tile' | 'object' | 'none',
  range: number,              // 0 self · 1 beside (reach) · n tiles by 1-2-1 distance; Wit 3+ adds 1 for 2- and 3-action spells
  sight: boolean,             // needs line of sight (default true)
  area: null | { shape: 'burst' | 'square' | 'line', size: number, at: 'self' | 'target' },   // burst radius, square side, line length; Wit 3+ adds 1
  hits: 'foes' | 'allies' | 'allies-and-self' | 'all',   // who an area touches (default 'foes' for harmful, 'allies-and-self' for helpful)
  count: number,              // distinct units picked (Take heart 3); default 1
  need: Predicate[]           // each must hold for a unit to be a legal pick
}
```

**Predicates** (closed): `below-half`, `below-third`, `below-quarter`, `offline`, `standing`, `small`, `not-lead`, `not-elite`, `not-large`, `examined`, `has-boon`, `has-bane`, `lingering`, `beside-ally` (an ally of the user stands beside the target), `in-light`, `dim-or-dark`, `lantern-down`, `has-device`, `examined-target`, `stitched-genre`.

### 6.3 Verbs

Each effect is `{ do: <verb>, …params, min?: 'hit' | 'crit', to?: 'target' | 'self' | 'area', if?: Predicate }`. `min` gates it on the outcome (a Hit or better, or a Critical). `to` picks who it lands on (default the target). Effects run in order on each target. **Decided:** once an ability's effects include an `act` (Pounce's Strike, a weapon art), every effect after it reads that act's degree for `min` and for halving; effects before it read the ability's own outcome.

**Degrees on effects.** Damage and patches follow §4.1. A numbered condition doubles on a Critical and halves (down) on a Graze; a yes-or-no condition, or one that halves to 0, doesn't land on a Graze. Moves on a foe need a Hit or better unless `min` says otherwise. On a helpful action a Graze halves amounts and numbers of 2 or more; edge buffs and yes-or-no effects still land (**Decided**).

| Verb | Params | Does |
|---|---|---|
| `damage` | `line: 'one' \| 'strike' \| 'two' \| 'three' \| 'area' \| 'weapon' \| 'stray' \| 'fixed'`, `amount` (for `fixed`), `kind: 'caster' \| 'weapon' \| <kind>`, `frac: Num \| [num, den]`, `plus: Num \| 'bead'`, `split: Num` | Deals the line at the user's level (`weapon` = its Strike amount; `stray` = the stray Strike line) × `frac`, + `plus` + keyAdjust + flat, through §4.8's order. A fraction `[num, den]` is `floor(line × num / den)`, exact in integers (*Inkdarts*' "a third" is `[1, 3]`: 4 at level 1, never 3); a plain number is `floor(line × frac)`. `split: n` lands n pieces, each with its own outcome, as one attack (§4.3). `caster` = the user's own kind (Light for Milo, Ink for the Scribe, Spark for the Artificer, Plain for Jev and the Tollkeeper, a stray's genre kind) |
| `patch` | `line`, `frac`, `plus`, `ofMax` | Restores Integrity (never above max; never on an Offline unit). `ofMax: 0.25` patches a quarter of the target's max |
| `condition` | `id`, `n: Num`, `data` | Applies a condition (§4, §5.1); refreshes to the higher number if already held |
| `end-condition` | `id` or `class: 'boon' \| 'bane' \| 'any' \| 'lingering'`, `count` | Ends conditions (boons: Quickened, Brisk, Unseen, positive mods and marks a foe's allies gave; banes: every other condition but Offline) |
| `move` | `who: 'target' \| 'self'`, `how: 'push' \| 'pull' \| 'stride' \| 'step' \| 'teleport' \| 'swap'`, `tiles: Num`, `noSwipes`, `into: 'any' \| 'dim'` | Moves along 1-2-1 lines, stopping at walls, units and void. Push and pull are away from or toward the user. A push off a ledge Tumbles and deals a fall. `swap` trades places: the user with the target, or, when the ability's target has `count: 2`, the two targets with each other |
| `act` | `action: 'stride' \| 'step' \| 'hide' \| 'brace' \| 'strike' \| 'seek'`, `noSwipes` | Performs a basic action as part of the ability, with its own targeting |
| `heat` | `by` or `to: 'idle'` | Changes heat, clamped 0–100 |
| `buffer` | `amount: 'brace' \| Num` | Sets Buffer to the larger of the current and the new |
| `mark` | `id: 'bead' \| 'wanted' \| 'that-pile' \| 'drawn' \| 'assist'`, `n: Num`, `edge`, `edgeHot`, `hotAt`, `spend: 'attack' \| 'action'`, `until` | A mark: `bead` (+n damage on the marker's Strikes, moves free when its foe is sorted), `that-pile` (allies +edge against the target, +edgeHot while the marker's heat ≥ hotAt), `drawn` (the target spends its next attack or action on the marker; its telegraph turns to show it), `assist` (+1 edge on a named ally's next action against this target) |
| `mod` | `stat`, `by: Num`, `until` | A timed modifier. Stats: `edge-next`, `edge-first-each-turn`, `edge-all`, `resolve-mind`, `resolve-body`, `resolve-set` (sets both to `by`, never above 2), `guard`, `speed`, `speed-next-stride`, `resist-all`, `drift`, `reboot-cost`, `initiative`, `light-radius`, `degree-next-on-foe`, `degree-next-from-foe` |
| `degree` | `by: 1 \| −1` | Reaction only: moves the outcome that triggered it one degree (up for an ally's action, down for a foe's) |
| `reveal` | `what: 'stats' \| 'unseen' \| 'intents' \| 'mechanic'`, `radius` | Examines, reveals Unseen and hidden intents |
| `surface` | `id`, `rounds`, `area` | Lays a surface (the target area if `area` is absent) |
| `summon` | `template: 'drone' \| 'turret' \| 'snare' \| 'patch-kit' \| 'pop-up-cover' \| 'decoy'`, `rounds` | Makes a device (§6.5): a unit (`d<i>`, joining the ribbon right after its maker) or an object (the next `o<i>`), with a `spawn` event |
| `command` | `device: 'drone' \| 'turret'`, `order: 'zap' \| 'assist' \| 'carry'` | A device acts now |
| `reboot` | `frac: 0.25` | Brings an Offline ally back (Rattled 1 until the next Breather) |
| `calm` | `n` | Adds calm to the target's talk kind |
| `light` | `radius`, `rounds` | Adds a light to `Battle.lights` at the target tile (Little light) |
| `take` | `item: 'cordial' \| 'brew'` | Takes one from the party's carry (the fetchfox's pinch); nothing when none is left |
| `cancel` | `what: 'spell'`, `maxCircle` | Stub only in Phase 4 (Cross it out) |
| `rule` | `id`, params | A named rule from §6.5's closed registry |

A `Mod` (in passives and auras) is the `mod` verb's params without `do`: `{ stat, by, until }`, with `until: 'fight'` for passives.

`until` (closed): `next-action`, `next-attack`, `next-stride`, `next-effect`, `start-of-next-turn`, `end-of-round`, `end-of-next-round`, `sustained`, `fight`, `rounds:<n>`.

**Triggers** (closed): `foe-leaves-reach` (Parting swipe), `ally-struck-beside` (Shoulder), `strike-at-ally` (Draw the blow; `range`), `hit-on-ally` (after the degree is known, before damage; `range`), `outcome-in-sight` (Proofread), `self-struck` (before the hit lands), `foe-moves-in-sight` (Ready a shot), `foe-enters-reach`, `readied` (Ready, firing on one of `READY_TRIGGERS`), and the data-only `spell-in-sight`, `telegraph-at-ally`, `big-blow-on-ally`.

**Uses** reset: `turn` and `round` at the round's start, `target-round` per target per round, `breather` on a Breather, `campfire` on a Campfire, `fight` at the fight's end. `n` may be `'wit'` or `'charm'` (the user's ability, at least 1). Items and gifts have `uses: null` and `consumes` set: their limit is what's carried.

**Sustained spells:** casting applies the effects; each round the caster spends a Sustain (1 action) and the effects apply again when the Sustain resolves. It ends when not sustained in a round, when the caster goes offline, when the fight ends, or after 10 rounds. Buffs and areas can only be started once the fight has begun.

### 6.4 Which actions pick an outcome

Strike, Throw, Shove, Hide, Brace (helpful), Assist (helpful) and every ability with `outcome: true` pick one outcome per target. Stride, Step, Jump, Examine, Seek, Interact, Talk down, Cool down, Reboot, Delay, Sustain, Ready, Head home and Dip are automatic. An area picks one outcome per unit it catches. A reaction that deals damage (Parting swipe, Ready a shot) picks its own.

### 6.5 The rule registry (closed; B implements every id)

| Rule id | Used by | Rule |
|---|---|---|
| `hooklight` | Milo (passive) | The Hooklight (`Battle.lights`' `hooklight`) lights 3 tiles, 5 while raised (raised automatically at the fight's start). It drops (radius 0) when Milo goes offline, is Tumbled or falls asleep; `raise-lantern` raises it again. Allies inside drift 20 heat toward idle; Unseen foes inside are revealed; ghosts inside lose their Plain resistance; +1 edge against any shadow-genre foe inside; foes can't Hide within it. It never spoils the party's own hiding |
| `raise-lantern` | Milo (1 action) | Raises a dropped Hooklight |
| `stand-in-my-light` | Milo (reaction, `hit-on-ally`, range 4) | The hit deals the `one` line less |
| `lantern-calls` | Milo (3 actions, once per Campfire) | Every Offline ally within 6 who can still come back does, as if Rebooted |
| `hearth-path` | Milo's Hearth path | Allies in his light resist all damage by 2 (3 from level 5, 4 from 10); his Salve never lands below a Hit |
| `wick-path` | Milo's Wick path | *Mote* deals 2 more |
| `wayward-path` | Milo's Wayward path | +1 Speed; once per Breather, 1 action: a mote to a tile within 8 in sight, and he steps into it |
| `draw-the-blow` | warden (reaction, `strike-at-ally`, range 2) | Steps 1 tile in beside the ally if needed, drawing no Parting swipe, and becomes the target with its own Guard and Buffer |
| `unbroken` | warden 10 | Once per Campfire, drops to 1 Integrity instead of going offline |
| `settle-low` | mender (*Still water*) | Strays 4 or more levels below the party in the area settle (full rewards) |
| `lullaby` | *Lullaby* | Drowsy 2 on a Hit or better against mind Resolve, lowest Integrity first, until the Drowsy foes' Integrity would pass twice the user's `two` line |
| `unseen-strike` | skirmisher (passive) | Once a turn, a Strike with edge on its target, or with an ally beside the target, adds the `one` line |
| `tuck-and-roll` | skirmisher 5 (reaction, `self-struck`) | Halves that hit (after the degree, before Buffer) |
| `ignore-difficult` | *Read the ground* | Natural difficult terrain (water, foliage, rough ground) costs normal |
| `first-in-tick` | *Borrow a rule* (Frontier) | Next round the user acts first in every tick |
| `burn-essence` | weaver (once per Campfire, 0 actions) | Spends one carried essence for one pact charge |
| `cleave` | *Cleave* | A second foe beside the first takes half the Strike's damage (same degree) |
| `tune-ups` | tinker 2 (passive) | The user's devices have +1 Guard (at most 2) and 2 × level more Integrity |
| `tollkeeper-toll` | the Tollkeeper (passive) | A foe that moves into a tile beside him stops there on a Hit or better against body Resolve (one outcome per foe per move) |
| `steady-hands` | the boon | Tonics patch a third of max Integrity instead of a quarter |
| `steady-second` | warden and longshot 5 (passive) | The second attack in a turn takes no −1 edge (it still adds heat) |
| `steady-third` | warden 11 (data only) | The third attack in a turn takes −1 edge instead of −2 |
| `two-sustained` | scrivener 10 | Sustains two spells at once |
| `two-drones` | tinker 10 | Keeps two bench drones |
| `swipe-strike` | skirmisher 10 | *Unseen strike* can land on a Parting swipe |

Device templates (for `summon`), all level = the maker's, side = the maker's, acting only when commanded:

| Template | What |
|---|---|
| `drone` | A Tiny unit: Guard 1, Integrity 5 × level, Speed 5, flies. Commanded for 1 action: `zap` (an attack at the maker's heat, the `one` line in Spark, range 6), `assist`, or `carry` (moves 5 and hands a tonic to an ally beside it) |
| `turret` | A unit that doesn't move: Guard 1, Integrity 5 × level. Commanded for 1 action: `zap` (range 8) |
| `snare` | An object on a tile: the first foe to enter it is Tangled 1 on a Hit or better against body Resolve, then it's gone |
| `patch-kit` | An object: an ally who Interacts beside it is patched for the `two` line, once |
| `pop-up-cover` | An object on a tile: low cover, Integrity 10 + 2 × level; breaks at 0 |
| `decoy` | A unit with 1 Integrity that foes' telegraphs prefer when it's nearer than a hero; gone at the round's end |

A device is never a hero: a standing one doesn't stop "everyone offline" (§4.18). On the ribbon it wears its maker's side shape.

### 6.6 Hooks for Tale-lead mechanics, canon-foe bows and minds

B's battle runs every round through these hooks, taken from `ctx` (§7.1). A missing hook is a no-op. B owns what every lead shares: its bars and phase changes (with the title card's quote), plot armour, a real rift's yield, and ending on a bow. B also ships a **bare lead** (those alone, with no Asides and no *Last page*) so fights work in wave 1. I's `leads.js` supplies `MECHANICS.fallback`, the generic lead with its Asides and *The last page*, and the eight shipped mechanics, each built on the fallback's hooks. B uses `ctx.mechanics[id]`, else `ctx.mechanics.fallback`, else its bare lead.

```js
Mechanic = {                               // src/combat/leads.js exports MECHANICS: { [id]: Mechanic }
  id: string,
  setup(battle, ctx) → Battle,             // fill lead.data; mechanic objects are already placed by encounters.js
  roundStart(battle, ctx) → { battle, events },   // after drift: a lamp goes dark, a line makes a clerk, candles are snuffed
  telegraphs(battle, ctx) → Telegraph[],   // the lead's own intents, Asides and mechanic pushes this round
  actions(battle, unitId, ctx) → ActionOption[], // extra legal actions for a hero ('use' with ability 'mech:<name>')
  resolve(battle, unitId, action, ctx) → null | { battle, events },   // mech actions, and Interacts on its objects; null = not mine
  damageTaken(battle, hit, ctx) → number,  // hit = { target: 'lead', amount, kind, degree, source }; returns the amount to use
  tickEnd(battle, tick, ctx) → { battle, events },   // Asides resolve here
  roundEnd(battle, ctx) → { battle, events, yielded: boolean },   // the fallback's Last page check (end of round 8, not at Maud's Table)
  phaseChange(battle, from, to, ctx) → { battle, events },
  bow(battle, ctx) → { progress: number, need: number, done: boolean }
}
Bows = {                                   // canon-foe bows (§9.8), from leads.js FOE_BOWS; merged by legalActions like mechanic actions
  actions(battle, unitId, ctx) → ActionOption[],   // a hero's extra options: 2 actions at a lectern or the riddle board, ringing the bell
  resolve(battle, unitId, action, ctx) → null | { battle, events },   // those, and an Interact on a foe whose bow kind accepts one (`open`, `walk`, `read`)
  afterAction(battle, unitId, action, ctx) → { battle, events }
}
Minds = {                                  // src/combat/ai.js, strays.js and notebook.js, via makeMinds() (§7.2)
  foePlan(battle, unitId) → Plan,
  telegraphs(battle, unitId, plan) → Telegraph[],   // strays.telegraphsOf: hidden and false intents, the adapting eye
  draft(battle, unitId) → Draft,           // heroes: notebook, else personality
  situation(battle, unitId) → Uint8Array,  // notebook.situationOf: 16 bytes (§5.10)
  choices(battle, unitId, plan) → [{ slot, template, ability, relation, cost } | null],   // notebook.choiceOf per slot; keys Battle.seen
  improvise(battle, unitId, action, why) → Action | null,
  revise(battle, unitId, tick) → Action | null   // a feint (leads only): replaces the lead's queued action for this tick
}
```
B's stub `Minds` (wave 1) returns plain telegraphs from the plan, 16 zero bytes and nulls, so `Battle.seen` stays empty until H lands. `ctx` is built as a plain object, then `ctx.minds = makeMinds(ctx, …)` is assigned, then it's frozen: minds may read `ctx` but never replace it.

Rules for the hooks:
- They're pure, take and return Battles, and never call `Math.random` or the clock. Any choice they make that needs variety uses `hashInts(battle.seed, battle.attempt, battle.round, <tag>)`.
- Lead damage runs through `damageTaken` after the degree and weakness and before Buffer. When a bar reaches 0, B changes phase (Opening → Twist → Last page, or Opening → Last page at hairline) and calls `phaseChange`. The last bar reaching 0 sorts the lead (`settled`); a real rift's lead yields instead (`yielded`, naming the cause).
- `bow().done` ends the fight as `bowed` at the end of the tick.
- Plot armour: B folds it into the bars of the first effect of each phase meeting the lead's Resolve (§4.9, §5.7), and marks it used when the unfolded degree was a Graze or better.
- Feints: `revise` may replace a lead's queued action at most `feintsLeft` times a phase (step 3: 1, step 4: 2). A hero with Heed 3+ spots it a tick early: B emits `feint` with `spotted: true` at the start of the tick before.

## 7. Module APIs

Signatures are exact: names, argument order, option names and return shapes. Everything below is pure unless it says otherwise. "→ state" means a new state or the same object when nothing changed.

### 7.1 The combat kernel (B)

Every combat call takes a `ctx`:

```js
CombatCtx = {
  rules: Rules,                  // loadRules(content.combat.rules, content.combat.tuning)
  abilities: AbilityIndex,       // buildAbilityIndex(...)
  minds: Minds,                  // makeMinds(...) (§7.2); B's own tests pass a stub
  mechanics: { [id]: Mechanic }, // leads.js MECHANICS (§7.4), including `fallback`; {} means every lead is B's bare lead
  bows: Bows | null,             // leads.js FOE_BOWS
  genres: string[],              // content.genres.genres ids, in file order
  party: { [unitId]: { personality: string | null, barks: [{ on: 'critical' | 'offline', say?: string, does?: string }], voice: 'words' | 'pictures' } }
                                 // from the companion files and regulars.json (L1 builds it); B's barks and thought bubbles read it
}
```

`src/combat/heat.js`
```js
export const BANDS                                  // { cool: [5, 80, 10, 5], warm: [15, 60, 15, 10], hot: [30, 35, 15, 20] }, frozen
export function bandOf(heat) → 'cool' | 'warm' | 'hot'
export function shiftBars(bars, edge) → bars        // §4.2's ladder, edge clamped to ±3
export function barsFor(heat, edge, { storybook = false, helpful = false, cheer = false } = {}) → bars
export function expected(bars) → number             // (2c + h + 0.5g) / 100
export function attackPenalty(attackIndex, { light = false } = {}) → { heat: number, edge: number }   // index 0 = the first attack; heat is this attack's increment (§4.3)
export function foldBars(bars, { kind = false, helpful = false, cheer = false, sure = false, armour = false } = {}) → bars   // §5.7's order
export function drift(heat, idle, amount = 10) → number
export function pick(seed, attempt, k, bars) → 'crit' | 'hit' | 'graze' | 'miss'
export function oddsWords(bars) → { words, critInReach }
```

`src/combat/grid.js`
```js
export function dist(a, b) → number                 // max(dx, dy) + floor(min(dx, dy) / 2)
export function createGrid(battle) → Grid           // built fresh per call site; cheap
Grid = {
  inside(x, y), cell(x, y), height(x, y), light(x, y), difficult(x, y),
  blocksMove(x, y, unit), blocksSight(x, y), occupant(x, y) → unitId | null,
  reachable(unitId, { budget, noSwipes = false }) → Map<'x,y', { cost, from: 'x,y' | null, swipes: string[] }>,
  path(unitId, to, { noSwipes = false }) → [{ x, y }] | null,   // excludes the start
  sees(from, to) → boolean,
  cover(fromUnitId, toUnitId) → 0 | 1 | 2 | null,                // none, low, heavy; null = high cover blocks (§4.17's rule)
  surfaceAt(x, y) → string | null,
  area(shape, size, at, from) → [{ x, y }],
  caught(tiles) → string[],                                      // unit ids an area would catch, allies included (the overlay lists them)
  threatened(side) → Set<'x,y'>                                  // tiles the other side can reach and strike this round
}
```
Diagonals alternate 1 then 2 along a path (so `reachable` searches over tile and diagonal parity); a step's cost is §4.4's formula; nothing moves or sees between two blocking corners; a Large unit needs all four tiles clear. `light(x, y)` is §4.17's brightest-of rule over `Arena.light`, `Battle.lights` and lit surfaces. `difficult(x, y)` is true on a surface whose `SurfaceInfo.difficult` is set (water, foliage, rough ground); floaters and fliers ignore it.

`src/combat/rules.js`
```js
export function loadRules(json, tuning = null) → Rules              // validates and freezes; throws with the path of the first problem
export function line(rules, name, level) → number                   // §4.8, past 12 by its last step
export function heroIntegrity(rules, build, level, grit) → number   // §4.7
export function strayRow(rules, row /* 'integrity' | 'strike' | 'resist' */, level) → number   // §4.9
export function integrityFactor(rules, level, partySize) → number   // from tuning.json, default 1 (strays only, §4.9)
export function adaptStep({ rank, level, roomLevel, roadLevel }, { mode, adaptation, rules }) → 0 | 1 | 2 | 3 | 4   // §4.15; D, B and H all call this one
export function condition(rules, id) → ConditionInfo; export function surface(rules, id) → SurfaceInfo
ConditionInfo = { id, numbered: boolean, class: 'boon' | 'bane', ends: string /* 'stand' | 'turns' | 'interact' | 'breather' | … */, crit: 'double' | 'as-hit', graze: 'halve' | 'none' }
SurfaceInfo = { id, meets: null | 'body' | 'mind', difficult: boolean, slippery: boolean, lit: boolean, hurts: boolean, on: Effect[], reacts: { [kind]: string /* surface id, or 'arc' */ } }
export function damageSteps({ amount, degree, weak, resist, scale = 1, taken = null, halve = false, less = 0, buffer }) → { dealt, buffered, bufferLeft, weakAdded, resisted }
  // §4.8's eight steps: scale is Storybook's 0.75, taken a lead's damageTaken result, halve Tuck and roll, less Stand in my light's line
```

`src/combat/effects.js`
```js
export const VERBS, PREDICATES, TRIGGERS, RULE_IDS, UNTIL, DEVICE_TEMPLATES, READY_TRIGGERS, REACTION_IDS, OBJECT_KINDS, OBJECT_STATES, SURFACE_IDS   // §5–§6, frozen
export function validateAbility(ability) → string[]                 // problems, [] when fine; content tests call it
export function applyUse(battle, unitId, ability, use /* { cost, target, choice, extra, cheer } */, ctx) → { battle, events }
```

`src/combat/abilities.js`
```js
export function buildAbilityIndex({ callings, spells, companions, regulars, foes, leads }) → AbilityIndex   // Map<id, Ability>, frozen; throws on a duplicate id
export function basicActions(battle, unitId, ctx) → ActionOption[]
export function abilityActions(battle, unitId, ctx) → ActionOption[]
ActionOption = { action: Action /* target null */, words: string, cost: number, targets: Target[] | 'tile' | 'path' | null, why: string | null /* why it's greyed */ }
```

`src/combat/battle.js`
```js
export function createBattle(fight, heroes /* UnitSpec[], Milo first */, {
  attempt = 0, mode = 'long-road', calm = { noise: true, adaptation: true }, cheers = 0, firstLead = false,
  sneak = null /* 'unseen' | null */, roadLevel = 1, warding = 0,
  memory = null /* strays.genreMemory(state.party, genre), read once here */,
  talk = {} /* { [talkKind]: n }: doorway Talk downs already counted (§4.6) */,
  placement = null /* { [heroId]: { x, y } }: Set the ambush (Warding 30, Unseen only; checked) */
} = {}, ctx) → Battle
export function legalActions(battle, unitId, ctx, { slot = 0, plan = null } = {}) → ActionOption[]   // basic + abilities + mechanic and bow actions
export function oddsFor(battle, unitId, action, ctx, { slot = 0, plan = null } = {}) → Odds[]      // one per target the action would roll for
  // both project the unit's tile, attack index, heat, charges and uses through plan.slots.slice(0, slot) (plan defaults to battle.plans[unitId])
export function trouble(battle, unitId, plan, ctx) → [{ slot: number, words: string }]   // the planner's likeliest trouble: a telegraphed bite on a tile you're leaving, a slot aimed at a stray that probably won't last
export function spawnFoe(battle, spec /* UnitSpec */, at /* { x, y } */) → { battle, events }   // for leads.js: id s<i>, joins the end of the ribbon, a `spawn` event
export function unitView(battle, unitId) → UnitView                                   // §11.3's shape: `spawn` events, startCombat and syncCombat all use it
export function sneakCheck(fight, tiles /* the party's tiles */, { lightAt, rules }) → { odds: Odds, unseen: boolean }   // §4.17, from `hashInts(fight.seed, 'sneak')`
export function apply(battle, command, ctx) → { battle, events }                       // the one reducer
export function saveBattle(battle) → BattleSave                                         // §5.4
export function restoreBattle(save, ctx, { fight, heroes }) → Battle | null
export function battleBytes(value) → number                                             // UTF-8 bytes of JSON.stringify(value)
Command = { t: 'plan', unitId, plan: Plan }       // set or replace a plan while planning (free, any number of times)
        | { t: 'cheer', unitId, slot, on: boolean }
        | { t: 'commit' }                          // fills only missing foe plans (ctx.minds.foePlan), schedules the round; status 'running'
        | { t: 'step' }                            // resolves exactly one scheduled action and the reactions it triggers
        | { t: 'answer', yes: boolean }            // a pending ReactionAsk
        | { t: 'mode', mode: 'storybook' }         // easing only; takes effect at the next round's start (§4.15)
        | { t: 'head-home' }                       // at the end of the current tick
        | { t: 'wrap' }                            // resolves the rest as auto play (only when canWrap)
        | { t: 'end', outcome: 'won', why: 'seam-closed' }   // a real rift fixed while the fight was paused: a win that pays the room
```
- `createBattle` places heroes on `arena.entry` in formation order (or at `placement`), sets idle heat (Maud's +15 included), applies the mode's creation effects (§4.15), surprise, sneak and the doorway calm, adds the Hooklight to `lights` and each `passive.summons`, runs `mechanic.setup`, and enters round 1's planning: drift (none in round 1), foe plans from `ctx.minds.foePlan`, telegraphs from `ctx.minds.telegraphs`, and noise for the banner.
- The last `step` of a round runs the round's end (the mechanic's `tickEnd` for tick 3 or 4, conditions count down, sustained spells without a Sustain end, decoys go, then the mechanic's `roundEnd`), then the next round's start (a waiting mode switch, drift, room heat from round 2, lingering damage, `mechanic.roundStart`, foe plans, telegraphs), leaving `status: 'planning'`.
- **Decided:** conditions count down at the end of the round (the end of each holder's turn); heat drift and lingering damage happen at the round's start.
- B emits `thought` when a hero's drafted, unchanged slot begins (text from `describe.thoughtText`), and `bark` from `ctx.party` (§5.8).
- Replaying the same commands from the same `createBattle` inputs gives a deep-equal Battle, with any `Minds`: every hero's plan is an explicit `plan` command (the driver sends drafts that way), so nothing replayed depends on a notebook. `apply` never mutates its input.

`src/combat/round.js`
```js
export function ticksOf(plan, unit) → [{ slot, tick, ends, lost: string | null }]   // §5.5
export function schedule(battle, ctx) → [{ unitId, slot, tick, late }]           // ribbon order, then noise (§4.16)
export function noiseBanner(battle) → null | { genres: string[], words: string }  // 'Neon: lag. About 1 action in 5 lands a tick late.'
```

`src/combat/driver.js` (the one round loop; the HUD, every auto mode and the sim use it)
```js
export function roundView(battle, ctx) → { telegraphs, drafts: { [unitId]: Draft }, plans: { [unitId]: Plan }, noise, cheers, canWrap: boolean, trouble: { [unitId]: [{ slot, words }] } }
export function commit(battle, plans /* { [unitId]: Plan } */, ctx, { auto = false } = {}) → { battle, events, record: RoundRecord }
  // sends one explicit { t: 'plan' } per hero (drafts included), then { t: 'commit' }; auto: Let them handle it
export function step(battle, ctx) → { battle, events, roundOver: boolean, ask: ReactionAsk | null, result: FightResult | null }
export function answer(battle, yes, ctx) → { battle, events }
export function runToEnd(battle, ctx, { policy = 'drafts' /* | 'scripted' */, maxRounds = 30 } = {}) → { battle, events, result, records: RoundRecord[] }
export function canWrap(battle, ctx) → boolean     // the foes' remaining Integrity < one round of the party's expected damage
RoundRecord = { key: number /* hashString(`${fightId}:${attempt}:${round}`) >>> 0 */, round,
  units: { [unitId]: { situation: string /* base64 of 16 bytes */, draft: { confidence, choices }, plan: Plan,
                       choices: [{ slot, template, ability, relation, cost } | null] /* the committed plan's, from ctx.minds.choices */,
                       accepted: boolean[] /* per drafted slot: its choice equals the draft's (same template, ability and relation) */,
                       auto: boolean } } }
```
- Drafts are made for heroes whose control isn't `mine` (Command mode sets everyone to `mine`, with ghosted drafts only if the setting is on). `commit` builds the `RoundRecord` from the drafts and plans before anything resolves, so learning never sees an outcome.
- **Nothing played on auto is learned** (COMBAT §15): `auto` is true for a hero on `choose` (they commit their own draft), for everyone under *Let them handle it*, and for every round `runToEnd` plays. Auto slots never count toward sync.
- `runToEnd` is *Tell me how it went* and *Wrap it up*: it plays every round with drafts (or the scripted player), answers every Ask by the reaction's setting (Ask counts as Always), and marks every record `auto: true`.
- Nothing in the driver waits, sleeps or reads a clock. Pausing is the caller's: it simply stops calling `step`.

`src/combat/describe.js`
```js
export function logLines(events, battle, { odds = 'bars' } = {}) → string[]      // calm Log lines, ≤ 100 chars each: 'Pip — Critical — 17 Warp'
export function oddsText(odds, { style = 'bars' } = {}) → string                  // 'Critical 20% 14? · Hit 35% 7? · Graze 15% 3? · Miss 30%' or 'Likely. A Critical is in reach.'
export function whyText(why) → string
export function combatantLabel(battle, unitId, ctx) → string   // 'Glitch drone, 6 of 16 Integrity, Spooked 1, telegraphing Bite Milo, Hit or better 85%'
export function examineLine(battle, unitId) → string           // 'Resists Static 3. Weak to Warp 3. Curious.'
export function summary(battle, result) → string               // the campfire summary
export function actionWords(battle, unitId, action) → string   // 'Letter Pip', 'Stride to c4'
export function thoughtText(layer /* 'rule' | 'habit' | 'personality' */, words, who /* ctx.party[unitId] */) → { text: string | null, picture: 'pile' | 'tilt' | null }
  // 'Patching Milo, like you would.' · 'Patching Milo. Your rule.' · 'Talking first. It’s what I do.'; Jev: a picture, never text
export function draftReadout(draft, battle) → string            // for screen readers: 'The Scribe drafts Letter on Milo, Stride, Draft. 38 percent sure: new to Neon.'
```

### 7.2 The minds (H)

`src/combat/notebook.js`
```js
export const NOTE_BYTES = 24, SITUATION_BYTES = 16, FRAME_MAGIC = 0x424e /* 'NB' */, FRAME_VERSION = 1, FRAME_HEADER = 13
export const CHOICES                                  // frozen [{ id: 0..255, key, phrase, relation }], ids never reused
export function situationOf(battle, unitId, ctx) → Uint8Array   // 16 bytes, §5.10
export function choiceOf(battle, unitId, action, slot, ctx) → { template, ability, relation } | null
export function resolveChoice(battle, unitId, choice, slot, ctx) → Action | null
export function encodeNote({ situation, template, slot, cost, relation, ability, weight, taught, order }) → Uint8Array   // 24 bytes
export function decodeNote(bytes, offset = 0) → Note
export function frame(notes /* Uint8Array, a multiple of 24 */, key /* u32: a RoundRecord's key, or a lesson's */) → Uint8Array   // §10.2
export function unframe(bytes) → { notes: Uint8Array, frames: number, torn: number, good: number /* bytes through the last whole good frame */, lastKey: number | null }
export function crc32(bytes) → number                  // table-based, matches zlib.crc32
export function createNotebook(id, notes = new Uint8Array(0), { struck = [], rules = [] } = {}) → Notebook
Notebook = { id, count, notes: Uint8Array, struck: string[], rules: PlaybookRule[], index /* private */ }
export function draftFor(notebook, battle, unitId, ctx) → Draft   // layers: rules, then the 7 nearest notes per slot, then personality (ai.js)
export function learn(notebook, record, unitId, { command = false } = {}) → { notebook, added: Uint8Array }
export function habits(notebook) → [{ key, phrase, count, of, strength, struck }]   // strongest first
export function sync(accepts /* Member.notebook.accepts */) → number   // 0–100: the share of '1's among the last 50 drafted, non-auto slots
export function teachNotes(from, habitKey, toOrderStart) → Uint8Array   // the habit's notes, taught bit set, renumbered
export const RULE_IFS, RULE_THENS                      // playbook vocabulary: [{ id, words }]
PlaybookRule = { if: string, then: string }            // ids from RULE_IFS and RULE_THENS; reads as 'If anyone’s below half, patch them first.'
export function ruleText(rule) → string
```
- `learn` writes one note per slot: accepted unchanged at weight 1, changed at weight 2 (from `record.units[id].choices`, the committed slot's choice, not the draft's), Command-written at weight 1. It writes nothing for `auto` records, improvisations or slots with no choice. L1 learns and appends **at commit**, from the record `commit` returns, so a round's notes are written once whatever happens after.
- **Accepts and sync.** "Accepted unchanged" means the committed slot's `choiceOf` has the same template, ability and target relation as the draft's (not Action deep-equality, so a Stride to a neighbouring tile still counts). L1 calls `party.noteAccepts(state, id, record.units[id].accepted, now)` at commit for drafted, non-auto slots; `sync(accepts)` reads that string alone.
- **Drafting, per slot** (**Decided**): for each slot in order, the 7 nearest notes among those whose slot (byte 17, bits 0–1) matches, falling back to any slot when fewer than 7 match; struck habits are filtered out **before** the 7 are chosen; ties by newer order. Each note scores `weight × 0.5^((newest − order) / 2000) / (1 + distance)`; the best-scoring habit whose cost fits the ticks left wins, ties to the newest note, and `resolveChoice` turns it into an Action (a habit it can't resolve falls to the next). Reaction settings are never drafted from notes: they come from `Member.reactions` (the why's `slot: 'reaction'` names the setting). Confidence = `round(100 × agreement × closeness)` where agreement is the winner's share of the seven's score and closeness is `1 / (1 + meanDistance / 32)`; a draft's confidence is the lowest of its slots'. A draft from personality alone has confidence 35 (**Decided**). The same notebook, battle and seed always give the same draft.
- **Distance** (**Decided**): the situation bytes are decoded into fields, and distance is the sum of these weighted differences (a mismatch counts once; Δ is the absolute difference of the decoded values):

  | Fields | Weight |
  |---|---|
  | selfShare, lowAlly, foeShare | `Δ / 32` each |
  | allies below half, allies Offline, cover, foes within reach, foes within 6, allies within 2 | `Δ × 2` each (reach counts capped at 4) |
  | nearest foe's distance, distance to the lowest ally | `min(Δ, 8)`, `min(Δ, 8) / 2` |
  | foes standing | `Δ × 1.5` |
  | threat target, threat kind | mismatch 4, 3 |
  | ticks until the threat lands, round (capped 4 apart) | `Δ`, `Δ / 2` |
  | **genre** | mismatch **33** |
  | foe temperament, foe rank, lead phase, room kind | mismatch 3, 4, 3, 3 |
  | heat | `Δ / 10` |
  | charges left | `min(Δ, 8) / 2` |
  | every single-bit flag (bytes 2, 8, 10, 11, 12) | mismatch 1 each |
  | weakness to own kind, difficulty, party size | mismatch 2 each |
  | party level − room level | `Δ / 2` |

  So seven notes from other genres always have a mean distance ≥ 33, closeness < 0.5 and confidence < 50. The index (by genre, then brute force within) must return exactly the brute-force 7 nearest: a property test over 1,000 random notebooks.
- Guard rails: never target a sorted or offline foe, never step into a surface that hurts right now, unless a playbook rule says so. Hot companions (heat ≥ 61) prefer attacks over Brace and Shoulder by personality; Cool ones the reverse.

`src/combat/ai.js`
```js
export const PERSONALITIES                               // { [id]: { prefers: string[], avoids: string[], talksFirst: boolean } }; companion JSON names these ids
export function personalityDraft(battle, unitId, ctx) → Draft
export function foePlan(battle, unitId, ctx) → Plan      // temperament and role, plus strays.js adaptation
export function scriptedPlan(battle, unitId, ctx) → Plan // the scripted player (sim and notebook tests): patch the lowest under half, else strike the weakest in reach, else close in
export function improvise(battle, unitId, action, why, ctx) → Action | null
export function makeMinds(ctx, { notebooks = {}, scripted = false } = {}) → Minds   // §6.6
```

`src/combat/strays.js`
```js
export function telegraphsOf(battle, unitId, plan, ctx) → Telegraph[]   // §4.16's Noir and Void rules, Guttering candles, the adapting eye
export function counterFor(battle, unitId, ctx) → null | { habit: string, words: string }   // §4.15's steps (adaptStep is B's rules.js)
export function revise(battle, unitId, tick, ctx) → Action | null        // leads only
export function genreMemory(party /* state.party */, genre) → null | { habit: string, count: number }
export function rememberHabits(party, genre, records) → party   // updates party.strayMemory; returns the same object when unchanged
```
`ai.js`'s `foePlan` plays each temperament as §4.6 says (shy keeps its distance and settles at half Integrity, curious Examines the nearest hero first, grumpy strikes the nearest, dramatic opens with its `big` move, sleepy starts Drowsy, polite never touches an Offline hero, lost idles one turn in three, nosy goes for the lantern-bearer, proud duels the strongest hero), by role, and at Maud's Table plays its row of §4.15 (focus fire, surface combos, crowding a hero who's Rebooting).

`scripts/sim.mjs` and `scripts/tune.mjs` import without side effects (they run only when they're the main module). `sim.mjs` exports `simulate({ level, mode, room: 'low' | 'moderate' | 'severe' | 'chained' | 'crowded' | 'lead', partySize, party = 'reference' /* | UnitSpec[] */, play = 'guided' /* | 'command' | 'handle' */, fights, seed, noise = true }) → { wins, rounds: number[], minutes: number[], pay: { xp, marks }, pairedNoise: { flippedToLoss: number, flippedToWin: number } }`, where `'reference'` is §4.10's pinned party, cut to `partySize`. `tune.mjs` runs §4.10's cells, writes `content/combat/tuning.json` and `test-results/tune.json`, and exits non-zero when any cell fails its band.

### 7.3 Encounters (D)

`src/world/riftgen.js`: `carve()` appends `roomRects: [{ id, x, y, w, h, role: 'entrance' | 'lead' | 'loot' | 'puzzle' | 'room', mirror?: true }]` **last** in its return, with no new RNG draws. Nothing else changes.

`src/world/arena.js`
```js
export function arenaPass(spec, layout, { genres, rules, walkable /* from a plain buildElsewhere of the same layout */ }) → ArenaPlan
ArenaPlan = {
  layout,                       // same w, h, origin and marks (E B S P L); walls turned to floor only where the new floor stays ≥ 1 tile from another room's floor
  rooms: [{ roomId, role, rect, fight: boolean, arena: Arena, dais: boolean }],
  props: [{ x, y, state, flags }],   // 1–3 genre props per fight room (none in the corridor mouths)
  heights: string,              // w*h, '0'–'2'
  nook: { x, y } | null,        // open and gaping only
  lead: null | { footprint: [{ x, y }] /* (B.x−1..B.x, B.y−1..B.y) */, arena: Arena }
}
```
- Seed `hashInts(spec.seed, 'arena')`. Fight rooms come from `roomRects`, chosen by the built scene's `walkable` (never `riftgen.reachable`, which counts water as open: about 9.5% of rooms in wet Elsewheres can't be reached), plain rooms first, then loot and puzzle rooms. Rooms widen toward 7×6 where there's wall to spare; 35% of fight rooms get a height-1 dais; props are placed with the bush rule (a prop never cuts reachability to E, B, S, P or L).
- **Decided:** the Tale-lead's arena is the 12×9 window centred on B, clamped inside the scene, never grown past the scene's edge and never merging rooms; its walls stay walls (§17).
- A fight room's arena rect is the room plus 2 tiles into each corridor mouth (COMBAT §4.1), clipped to 20×16, so one-tile corridors are chokepoints. Props come from the genre's two PROPS4 ids and the crate (§7.8), with their flags.
- `layout === plan.layout`: the one widened layout goes to `buildElsewhere`, the engine and `elsewhereLandmarks`.

`src/world/elsewhere.js`: `buildElsewhere(spec, layout, { genres, kind = null, words, hooks = [], fight = null /* { plan: ArenaPlan, encounters: Encounters | null } */ })`. With `fight` null it builds exactly Phase 3's scene (the golden test), except that the `tale-lead` object's `name` and `label` come from `leadDisplayName(spec, words, { hooks })`. With `fight` it also: paints dais heights; adds props as `prop` objects (`scenery: true`, blocking); adds a `nook` object (clickable, kind `nook`, label `'Hearth-nook · rest here'`); makes the `tale-lead` object block its 2×2 footprint with its approach beside the footprint; and, when `encounters` isn't null, sets `scene.encounters = encounters.rooms` and places `encounters.chests` as `loot` objects (with `locked` and `mimic` on the object). `prepareElsewhere` builds once with `encounters: null` (the scene `planEncounters` reads), then again with them. With `kind: 'cave'` it places no stitch and no Tale-lead. `scene.strays` is never touched.

`src/world/leadname.js`
```js
export const COMPANY_NAMES   // frozen: Juno, Lumi, Vesperine, Ashcombe, Maddox, Holloway, Dusty, Calloway, Rivet, Pip, Mae, Tova, Nell, Whisper, Jev, Milo, Tamsin
export function leadDisplayName(spec, words, { hooks = [] } = {}) → string
```
A lead whose name contains a company name as a whole word shows the next name from the same genre bank, starting at `hashInts(spec.seed, 'lead-name') % names.length` and stepping until clear; a name in `hooks` keeps its own. `hooks` is always a list of names: callers pass `content.combat.leads.hooks.map((h) => h.name)`. Every place that shows a lead's name uses this with the same hooks: `buildElsewhere`, riftfx's wild lead actor (J), `frontier.elsewhereLandmarks` (L1, `frontier.js:499`) and app.js's lead bubble and rift panel (L2, `app.js:2699` and `:2942`).

`src/combat/bestiary.js`
```js
export function strayUnit(spec, kindIndex, n, { level, rank /* 'lackey' | 'stray' | 'elite' */, rules, foes, deepRank = 0, partySize, roadLevel }) → UnitSpec
export function leadUnit(spec, { level, rules, leads, foes, tuning = null, words, partySize, deepRank = 0, roadLevel, hooks }) → UnitSpec
export function foeUnit(foe, n, { level, rank, rules, foes, partySize, roadLevel }) → UnitSpec     // canon foes and creatures (foes.json)
export function mechanicOf(spec, leads, words) → { id, genre, index, entry, noFight: boolean }   // by the lead's mechanic text across every genre
```
Specs are Long Road and mode-free (B applies modes, §4.15). Integrity follows §4.9's pipelines exactly (strays with `integrityFactor(level, partySize)`, leads with `share` and `tuning.xInt[id] ?? leads.json xInt`); `adapt` is `rules.adaptStep` at Long Road with `roadLevel`.

`src/combat/encounters.js`
```js
export function roomLevel(spec, { kind /* 'wild' | 'real' | 'story' | 'cave' */, roadLevel }) → { n, deepRank }
export function budgetFor(role /* 'low' | 'moderate' | 'severe' */, partySize, depth) → number
export function planEncounters(spec, plan, scene, { kind, roadLevel, partySize, rules, leads, foes, tuning = null, words, hooks, riftKey = null, since = null, cause = null }) → Encounters
export function prepareElsewhere(spec, { riftgen, genres, words, kind, roadLevel, partySize, rules, leads, foes, tuning = null, hooks, riftKey = null, since = null, cause = null }) → { layout, plan: ArenaPlan, encounters: Encounters }
  // riftgen.layout → a plain buildElsewhere for walkable → arenaPass → buildElsewhere with { plan, encounters: null } → planEncounters.
  // Returns layout === plan.layout. The shell passes { layout, fight: { plan, encounters } } to world.enterElsewhere and
  // elsewhereLandmarks(spec, layout, { plan }), which lists the nook, so the landmark ids still equal the scene's non-scenery objects.
Encounters = { rooms: [{ roomId, role, fightId, rect, sight, posts: [{ unitId, x, y }], fight: FightSpec }], nook, leadRoom: string | null,
               chests: [{ id: string /* 'loot:<i>' */, x, y, locked: boolean, mimic: null | { fight: FightSpec } }] }   // caves only; [] in rifts
export function fieldFight(rift, arena, { roadLevel, partySize, rules, leads, foes, tuning = null, words, hooks }) → FightSpec
export function prepareCave(cave, { layout, roadLevel, partySize, rules, foes, words }) → { layout, plan: ArenaPlan, encounters: Encounters }   // §7.7
export function rewardsFor(fight, { rules, words }) → Rewards   // §4.13 from hashInts(fight.seed, 'loot'); names a relic from riftgen's lists (words)
export function realLine(cause) → string    // 'Settle me all you like. <cause>'
```
- Seeds: `hashInts(spec.seed, 'encounters')` for picks, and `fightSeed` (§5.1) per room. A room's foes stand at posts that avoid object tiles, approach tiles, the spawn, the door, blocking bushes and non-ford water.
- Caps and budgets per §4.10. Bright and Backhalls leads (`noFight`) get no fight. A real or story rift's `FightSpec.real` is `{ key: riftKey, cause }`, with `cause` passed by L1 from the rift's state; its lead yields.
- Mechanic objects come straight from `leads.json`'s `mechanics[].objects` (D reads the data in wave 1; I's `objectsFor` is an accessor over the same data in wave 2), including the Alibis' `clue` tiles.
- **Field-skill objects never guard the way** (COMBAT §2.1, a tested promise): no locked chest, Mimic or other field-skill object stands on the only path between the entrance and the stitch point, the nook or any fight room (a D test over 500 seeds, rifts and caves).

### 7.4 Leads and canon foes in play (I)

`src/combat/leads.js`
```js
export const MECHANICS          // { fallback, 'throttles-speed', 'streetlights-out', 'snuffs-candles', 'assembly-lines', 'too-big-to-see', 'alibis', 'noon-duel', 'stomps' }: Mechanic (§6.6)
export const FOE_BOWS           // Bows (§6.6) for the canon foes' bow kinds (§9.8): actions, resolve and afterAction
export function objectsFor(mechanicId, leads) → [{ kind, count, where: 'wall' | 'floor' | 'edge' | 'lead-side' }]   // leads.json's objects for that mechanic, [] for the fallback
```
Mechanic rules are COMBAT §8.3's table exactly (the eight shipped). Where a rule needs a number COMBAT doesn't give, leads.js decides it and `leads.json` records it; §18 lists them after wave 2.

### 7.5 Party and camp (C)

`src/party.js`
```js
export const PHASE4_COMPANIONS                       // ['milo', 'claude', 'codex', 'jev', 'tollkeeper']
export function roadLevel(state, rules) → { level, cap, xp, next: number | null, capped: boolean }
export function workLevel(pieces, rules) → number
export function fightingLevel(state, id, rules) → number   // §4.14: the Scribe and the Artificer max(work, road − 1); everyone else the Road level
export function crewStateOf(snapshot, agent) → 'working' | 'idle' | 'unknown'   // 'working' sends a likeness; needs-you is idle (Decided)
export function heroSpec(state, id, { content, rules, abilities, snapshot, now, level = null /* a BattleSave's pinned level */ }) → UnitSpec   // mode-free (§4.15)
export function partySpecs(state, { content, rules, abilities, snapshot, now, levels = null }) → UnitSpec[]   // Milo first, then party.chosen
export function musterView(state, { content, rules, snapshot, now, destination }) → MusterView
export function suggestParty(state, destination, { content }) → { ids: string[], words: string }   // 'Noir rift with an alibi. Mae will want this one.'
export function choose(state, ids, now) → state          // the same state while expedition.battle is live (no swapping mid-fight)
export function recruit(state, id, now, { content }) → state
export function gentlestStray(spec) → number | null          // the stray index §4.6's order picks; null when the rift has no fighting strays
export function inviteRegular(state, { rift, stray, lead = false }, now, { content, rules }) → { state, ok: boolean, words: string, regular: object | null }
  // re-offering needs no memory: every wild stitch and every bow asks again, unless that stray already joined (same riftSeed and index) or there's no room
export function payFight(state, fightId, rewards, result, now, { rules }) → { state, paid: boolean, xp, marks, loot, levelUps: string[] }
export function payStitch(state, { kind: 'wild', level, depth, key }, now, { rules }) → { state, paid: boolean, xp: number }   // Road XP, Warding, Seamcraft; key pays once (road.paidFights)
export function payRealStitches(state, now, { rules }) → { state, paid: number }   // from rifts.stitched.real over road.stitchedThrough: Road XP, Warding, Seamcraft 500 each
export function breather(state, now, { rules, free = false, fightId = null, where /* 'victory' | 'lantern' | 'focus' */ }) → { state, ok, reason }
  // one per fight (outing.breatherFight); a lantern rest counts toward the Campfire's limit; free (focus) never counts
export function campfire(state, now, { where /* 'muster' | 'home' | 'lantern' | 'nook' */, lanternId = null, riftId = null }) → { state, ok, reason }
export function afterFight(state, battle, result, now) → state
  // tops up (§4.18), applies a waiting outing.freeBreather, writes carry back to satchel.tonics, satchel.essences and Member.gifts,
  // pays outing warmth (+2, once per outing, the weekly cap) and the first win's Cheer (road.firstWin)
export function wake(state, now) → state                  // everyone offline: full Integrity at wilds.wake
export function addCheer(state, n, now) → state
export function addWarmth(state, id, n, source /* 'outing' | 'habit' */, now) → state   // callers: afterFight and topUpCrewGifts only
export function warmthStep(n) → 'stranger' | 'acquaintance' | 'companion' | 'friend' | 'fireside'
export function setControl(state, id, control, now) → state
export function setReaction(state, id, reactionId, setting, now) → state
export function setFormation(state, formation, now) → state   // 'line' | 'pairs' | 'loose' | 'wedge' (Warding 5)
export function setMode(state, mode, now) → state; export function setPlay(state, play, now) → state; export function setCalm(state, patch, now) → state
export function maxRules(state) → 1 | 3 | 6                     // Warding 15 and 50 (§4.21)
export function setRules(state, id, rules /* PlaybookRule[] */, now) → state   // refuses past maxRules (returns the same state); allowed between rounds
export function pendingChoices(state, id, { content, rules }) → [{ kind: 'path' | 'boon' | 'spells', options: [{ id, name, text }] }]
export function levelUp(state, id, choice, now, { content, rules }) → state   // never while expedition.battle is live
export function swapPath(state, id, pathId, now, { content }) → state      // at camp: Milo among his three; a companion among unlocked paths (one in Phase 4)
export function swapBoon(state, id, from, to, now, { content }) → state    // at the campfire, free
export function preparePages(state, id, spellIds, now, { content, rules, where /* 'camp' | 'lantern' */ }) → state   // the Scribe's Pages: Wit + level spells
export function noteAccepts(state, id, accepted /* boolean[] */, now) → state   // appends to notebook.accepts, keeping the last 50
export function strikeOut(state, id, habitKey, now) → state     // only notebook.struck changes; refused calmly when 40 are struck
export function unstrike(state, id, habitKey, now) → state
export function resetNotebook(state, id, now) → state         // keeps `previous` until the next Campfire
export function restoreNotebook(state, id, now) → state
export function topUpCrewGifts(state, now) → state             // Margin Notes and Spare Parts from tally.byCrew's high-water mark, and habit warmth:
                                                               // the Scribe (byCrew.claude rose today), the Artificer (codex), the Tollkeeper (a tally.features firstAt today)
MusterView = { canSwap: boolean, room: { used, max },
  members: [{ id, name, calling, level, warmth, warmthStep, fieldSkill, sync, mood, likeness: string | null /* 'Claude is working on ‘MILO plan’. Her likeness will go.' */, chosen: boolean }],
  suggestion: { ids, words }, formation, mode, play, calm }
```

`src/camp.js`
```js
export function campDay(state, now, { content }) → { part: 'dawn' | 'day' | 'dusk' | 'evening' | 'night' | 'asleep', places: [{ id, where: 'fire' | 'bedroll' | 'tower' | 'bridge' | 'away' | 'roof', pose: 'sit' | 'sleep' | 'talk' | 'stand' }], bell: boolean }
export function nextScene(state, now, { content }) → null | CampScene      // an arrival not yet seen, else a camp scene whose needs are met (Acquaintance for each companion's own)
export function parseTalk(text) → Talk                                       // §9.10; throws with a line number on bad input
export function talkView(talk, state, { now, party, facts }) → { lines: TalkLine[], choices: [{ id, text, needs, met, why }] }
export function chooseLine(talk, state, choiceId, now, { party, facts }) → { state, next: string | null, done: boolean, liked: string | null }
export function canTeach(state, now) → boolean                               // once a real night
export function markTaught(state, from, to, habitKey, now) → state
Talk = { id, with, once, needs: Requirement[], start: string, nodes: { [nodeId]: { lines: TalkLine[], choices: TalkChoice[] } } }
TalkLine = { speaker: string | null, text: string | null, gesture: string | null }
TalkChoice = { id, text, needs: Requirement[], next: string | null, reply: string | null, set: string | null, likes: string | null, join: string | null, end: boolean }
Requirement = { kind: 'with' | 'warmth' | 'fact' | 'trail', id: string, n: number | null, words: string }
CampScene = { id, when, who, lines: TalkLine[], needs: Requirement[] }
```
`chooseLine` records `set` facts with `state4.markFact` (never `model.js`, §2), applies `join` with `party.recruit`, applies `likes` with `party.addCheer(…, 1, …)` and returns the small line "The Scribe liked that." as `liked` (no warmth in Phase 4), and never locks: a choice with unmet needs can't be picked, and every node can reach an end. `markTaught` only records the lesson in state; the shell appends the lesson's notes (`teachNotes` → `frame` → `bridge.notebooks.append`), never rewriting a notebook (§10.2).

### 7.6 Groundwork (A)

`src/clean.js` (a leaf with no imports): `isRecord`, `UNSAFE_KEYS`, `safeCopy`, `toTime`, `clip`, `cleanCount`, `cleanInt`, `cleanMap`, `keepNewest`, `cleanRecentList`, `cleanDayKey`, `dayKey`, `dayNumber`, `dayStart`, `weekStart` (the local Monday's day number), `stripUnsafe(value, depth = 12)` (recursive). `model.js` imports them and re-exports the ones it exported before, unchanged. `hearth.js` imports `toTime` from `clean.js` instead of `model.js`.

`src/state4.js` (imports only `clean.js`)
```js
export const STATE4_KEYS                 // ['embers', 'xp', 'kindle', 'chronicle', 'road', 'party', 'expedition']
export const STATE4_LIMITS               // §8
export function emptyState4() → { embers, xp, kindle, chronicle, road, party, expedition }
export function normalize4(source, { now, tally }) → { embers, xp, kindle, chronicle, road, party, expedition }   // each section in its own try/catch, falling back to its empty value
export function cleanTally4(tally, { finishedIds }) → { byCrew, answered, answeredFast, waiting, focusSessions, restsHonoured, chunksCharted, features }
export function markFact(state, factId, now) → state       // story.facts; model.js re-exports it
export function markFeature(state, featureId, now) → state // tally.features' first use; model.js re-exports it
export function hearthTierOf(state) → number               // state.hearth.tier, cleaned (1–8), for the Road level's cap
```

`src/embers.js`
```js
export function entryCost(kind /* 'wild' | 'real' | 'story' | 'field' | 'cave' | 'chunk' */, { depth = 1 } = {}) → number   // 'story' is 0
export function payFromSignals(state, now, economy) → { state, paid: LedgerEntry[] }   // counters' high-water marks; the backlog once (§4.20)
export function earn(state, { source, key, n, text }, now, economy) → { state, entry: LedgerEntry | null }   // event keys pay once (embers.paid); lifetime += n, balance += banked
export function spend(state, { n, what, text }, now) → { ok: boolean, state, reason: string | null }   // reason: 'That needs 5 Embers. You have 3.'
export function canAfford(state, n) → boolean
export function walletView(state, now) → { balance, cap, lifetime, today: { earned, spent } }
export function chartChunks(state, keys, now, { economy, xp, free = false }) → { state, charted: string[], skipped: string[] }
  // replaces both of the shell's bare markExplored calls (app.js:2475 and the ruin tablets at :3570, which pass free: true: no cost, no Cartography)
LedgerEntry = { at: number, n: number /* + earned, − spent */, banked: number, source: string /* ≤ 20 */, text: string /* ≤ 60 */ }
```

`src/kindle.js`
```js
export function kindleStart(state, now) → { state, events }
export function bankedCoals(state, now) → { state, events }
export function kindleStop(state, now) → { state, events }
export function kindleTick(state, now, { economy, xp }) → { state, events }   // pays once per key, from absolute times; safe to call any number of times
export function kindleView(state, now) → { phase: 'idle' | 'focus' | 'rest', endsAt: number | null, left: number, words: string }
export function nextAlarm(state) → null | { id, at, title, body }             // 'The focus session is done' · 'Rest for fifteen minutes.'
KindleEvent = { t: 'focus-started' | 'focus-done' | 'rest-started' | 'rest-done' | 'rest-broken' | 'stopped', id, at }
```

`src/chronicle.js`
```js
export function note(state, now, patch /* { embersIn, embersOut, focus, rests, crew, answered, stitched, fights, xp: { [skill]: n } } */) → state
export function noteFight(state, now, summary /* FightSummary, §8 */) → state
export function noteXp(state, now, line /* { skill, n, source, text } */) → state   // chronicle.xpLines; lifeskills.addXp calls it
export function dayView(state, day, { now }) → DayView; export function weekView(state, anyDayOfWeek, { now }) → WeekView
DayView = { day: string /* 'YYYY-MM-DD' */, totals: { embersIn, embersOut, focus, rests, crew, answered, stitched, fights },
            xp: [{ skill, n }], ledger: LedgerEntry[], xpLines: [{ at, skill, n, source, text }], fights: FightSummary[] }   // that day's, newest first
WeekView = { start: string /* the local Monday */, days: [{ day, embersIn, embersOut, focus, fights }] /* 7 */, totals: { embersIn, embersOut, focus, rests, crew, answered, stitched, fights }, xp: [{ skill, n }] }
```

`src/lifeskills.js`
```js
export const SKILL_IDS                        // the 24, in LORE §12's order
export function xpForLevel(level) → number; export function levelForXp(xp) → number
export function addXp(state, skill, amount, now, { source, text }) → { state, drop: null | { skill, amount, level, levelled: boolean } }   // also writes the Chronicle's XP line
export function payLifeFromSignals(state, now, rates /* content.xp.sources */) → { state, drops }   // Command and Artifice from the counters' high-water marks; the backlog once
export function skillsView(state, content) → [{ id, name, family, level, xp, next, guide, source }]
```

`src/commands.js`
```js
export function parseCommand(text, { grimoire, places }) → Intent
Intent = { kind: 'spell', spell, arg } | { kind: 'open', panel } | { kind: 'go', place } | { kind: 'hud', mode }
       | { kind: 'help' } | { kind: 'not-yet', spell, from } | { kind: 'unknown', text, suggest: string | null }
export function completions(prefix, { grimoire, places }) → string[]
```
Phase 4 understands `::kindle`, `::banked-coals` (and "rest"), `::stop`, `::muster`, `::chronicle` (Recall the Road), `::wayfinding <place>`, `::map`, `::skills`, `::home`, `::quiet`, `::adventure`, `::help`, plus plain-word forms of each ("kindle the lantern", "open the chronicle", "go home"). Every other Grimoire spell answers `not-yet` with its `from`.

`src/sky.js`
```js
export function skyAt(now, { seed = 'hushlands', sky /* content.sky */ }) → Sky
Sky = { daypart: 'dawn' | 'day' | 'dusk' | 'night', light: number /* 0..1 */, night: boolean,
        season: 'spring' | 'summer' | 'autumn' | 'winter',
        tint: [r, g, b, a], weather: { kind: 'clear' | 'rain' | 'snow' | 'mist' | 'wind' | 'leaves', density: number, key: string },
        key: string }        // changes only when what's drawn changes (quantised to 10 minutes)
export function isNight(now, { sky /* content.sky */ }) → boolean   // replaces the Westwatch's inline `hour >= 20 || hour < 6`, from the same sun table as skyAt
```
Weather is `hashInts(hashString(seed), dayNumber(now), 'weather')` against the season's weights in `content/sky.json`.

### 7.7 World additions (E)

`src/world/caves.js`
```js
export function caveSpec(poi, { worldgen, wilds /* a createWilds() instance, for wilds.regionDistance */, words }) → CaveSpec
CaveSpec = { id: 'cave:<x>,<y>', seed: number /* hashInts(S, x, y, 'cave') */, kind: 'cave', x, y, tier, depth,
             stage: 'hairline' | 'open', region: string, name: string, genres: [], affixes: [], strays: [], taleLead: null, loot: [], creatures: string[] }
export function caveLayout(cave, riftgen) → layout          // riftgen.layout on the cave's own seed and stage, no affixes
export function caveLabel(cave) → string                   // 'A cave mouth · Cinderforge side' (hover and panel title)
```
A cave's stage is hairline at tiers 1–3 and open from 4 (**Decided**). Its region is the nearest anchor by `wilds.regionDistance`, falling back to the nearest story region out in the unnamed wilds. It has no Tale-lead, no stitch and no nook. D builds its fights: `encounters.prepareCave(cave, { layout, roadLevel, partySize, rules, foes, words })` (§7.3) fills rooms from `foes.caves[cave.region]` (creatures and canon foes; a region with no list, such as `hearthvale`, `far-shore`, `painted-hills` or `ivory-college`, uses the nearest region that has one, **Decided**) with §4.10's mix at the cave's tier, and returns in `encounters.chests` one Mimic chest (its `mimic.fight` is a one-foe FightSpec at the chest, `fightId` `fight:cave:<x>,<y>:<day>:mimic`) and one locked chest (`locked: true`, only *Pick* opens it). D's proofs: `prepareCave` is deterministic, every room's budget holds, exactly one Mimic and one locked chest, and neither on the path to any room (§7.3).

`src/world/fieldboss.js`
```js
export function isFieldBoss(rift) → boolean                 // wild, gaping, tier ≥ 5
export function leadRoam(rift, { walkable, genres }) → null | { home: { x, y }, allowed: string[], positionAt(t) → { x, y, dir, moving } }
export function fieldArena(rift, { worldgen, wilds, walkable }) → null | { arena: Arena, hiddenTrees: string[] }
export function sightRing(rift) → { x, y, radius: 3 }
```
`leadRoam` uses `makeWanderer` over tiles inside the bleed at `bleedCover ≥ STRAY_COVER`, off the tear and not `behindTear`, seeded `hashInts(spec.seed, salt, 'lead-roam')`; `positionAt(null)` stands at home. The arena is the 16×12 window at the nearest clearing to the rift inside its bleed, with trees thinned to 20% (`hiddenTrees` are the place ids hidden for the fight only; `wildState.felled` is never written).

`src/world/trail.js`
```js
export const STEP_KINDS                // ['feature', 'visit', 'examine', 'read']
export const FEATURES                  // ['kindle', 'rest', 'chronicle', 'command', 'examine', 'muster', 'fight', 'talk-down', 'map', 'skills', 'war-table', 'ward', 'stitch', 'step-through', 'lantern', 'notebook']
export function lastBridge(worldgen) → { id: 'landmark:last-bridge', x, y, deck: [{ x, y }], stand: { x, y }, dir: 'h' | 'v', dry: boolean }
export function trailView(state, trails, now) → { trail, step, steps: [{ id, riddle, hint, done }], done: boolean, atBridge: boolean }
export function stepDone(state, trails, event /* { kind, target } */, now) → state   // marks story.trails progress
```
- **The Last Bridge** stands on the short river crossing (1–5 river tiles, walkable land at both ends) whose midpoint scores lowest on `|distance to the Whisperwood anchor − its radius| + 0.25 × distance to where the north road crosses that radius`, among crossings south of the anchor within 16 tiles of the edge; ties by `hashInts(S, x, y, 'last-bridge')`. With none, it's a footbridge on the north road at that crossing (`dry: true`). Its deck is drawn, not walkable, in Phase 4 (the far bank waits in the Hush until Phase 7), and the Tollkeeper stands on `stand`, the near bank's tile at the deck's end, reachable from the vale. worldgen's output is unchanged (it's an overlay, not a fixed POI).
- The first Riddle Note is found in the first wild chest Milo opens after Phase 4 lands (its `trails.json` step 1 is `found: 'chest'`); if the Prologue's `first-crack` step isn't done yet, it waits for the next chest after it is.

- The trail's wiring (§12.4): K1's `trail-view.js` shows the note; L2 hands the note out from the first wild chest, calls `stepDone` on `shell.feature`, visits (`onSceneStep` onto a target place), Examines and reads, sets the landmarks at boot, and makes the Tollkeeper at `stand` an entity that opens `talk:tollkeeper-riddles`.

`src/ui/wildtext.js` (E, wave 1): `poiView(poi, content, state, { regionId, night, fresh, phase4World = false })`'s `cave` case returns, only when `phase4World` is true (L1 passes it), `action: { id: 'enter-cave', label: 'Go in · 3 Embers', cost: 3 }` (the `label` and id `poiPanel` already renders as `poi-enter-cave`) and no `later` text; with it false the cave case is Phase 3's, reading the new `notes_later.cave`.

### 7.8 Art (F)

`src/world/sprites-party.js` (the registry; per-rig files under `src/world/party/`)
```js
export const RIGS          // { coat: { w: 16, h: 20, frame: [32, 28], feet: [16, 26], split: 18 }, robe: { w: 16, h: 18, frame: [32, 28], feet: [16, 26] },
                           //   jev: { w: 12, h: 10, frame: [32, 28], feet: [16, 26] }, toll: { w: 20, h: 26, frame: [36, 34], feet: [18, 32] } }
export const CLIPS         // ['ready', 'walk', 'melee', 'ranged', 'cast', 'sustain', 'gesture', 'hit', 'dodge', 'brace', 'jump', 'tumble', 'stand',
                           //  'offline', 'dozing', 'reboot', 'item', 'cheer', 'wave', 'think', 'laugh', 'shrug', 'sit', 'sleep', 'camp-sit', 'camp-talk', 'camp-sleep', 'camp-job']
export function clipFrames(look, clip, facing /* 'left' | 'right' | 'down' */) → Frame[]   // frozen, memoised; left = right with mirror: true
export function exploreFrames(look, dir) → Frame[]        // the Tollkeeper at the bridge (20×26), followers without art fall back to crew frames
export function likenessTable(kind /* 'clay' | 'slate' */) → { [key]: key }
export const CLIP_TIMING   // { [clip]: { fps, frames, still: 'last' | 'first', loop: boolean } }
Frame = { rows: string[], layers: string[] | null, wear: string[] | null, split: number | null,
          anchors: { head: [x, y], handL: [x, y], handR: [x, y], back: [x, y] }, feet: [x, y], w, h, mirror: boolean, family: 'milo' | 'claude' | 'codex' | null }
```
Frames draw at `(x − feet[0], y − feet[1])` with `painter.grid(rows, …, { mirror, layers, table2 })`. People are dressed with `outfitGrid(family, rows, { split, wear })`. Jev and the Tollkeeper draw plain.

`src/world/icons.js`
```js
export const INTENT_ICONS    // the 16 of §5.6 plus 'hidden' ('?'), 8×8 rows, ink outline
export const CONDITION_ICONS // 22: one per condition id of §5.1 (21 plus `lingering`), 8×8, each with room for a 4×6 number
export const KIND_ICONS      // the 12 damage kinds, 8×8
export const THOUGHT_ICONS   // { pile, tilt }: Jev's thought pictures, 8×8
export const MARKERS         // { active, target, ally (circle), foe (diamond), neutral (square), pathDot, coverLow, coverHeavy, heightUp, heightDown, reach, eye, feint ('!'), cheer ('✦' as pixels) }
export const FLASHES         // { crit: rows[3], graze: rows[3], miss: rows[3] }
```

`src/world/scene-art.js` gains `numberRows(text /* '17', '+5', '14?', 'miss' */, { size = 'small' /* 4×6 */ | 'big' /* 6×9 */, fill = 'c', star = false } = {}) → frozen rows` (cached; fill `c` damage, `l` patch, `u` with a star for a Critical, `S` for "miss"), and `painter.dissolve(rows, step, steps, { invert, table, key, tag, layers, table2 })` honours `layers` and `table2`. `textRows` and `FONT_GLYPHS` are unchanged.

`src/world/fx.js`
```js
export function ring({ r, key, width = 1, dither = false }, frame) → rows
export function sparks({ n, key, spread, seed }, frame) → rows
export function beam({ length, dir, key }, frame) → rows
export function fillRows({ w, h, key, dither = 0 }) → rows
export function effectFrame(effectId, frame, { anims }) → rows | null   // per-spell data from anims.json, cached by (effect, frame)
export function shimmerOutline(rows, warm) → rows                         // cached per rows identity
```

`src/world/props4.js`: `PROPS4 = { [id]: { frames: rows[][], w, h, feet: [x, y], cover: 'low' | 'high' | null } }` for the handcart, Breather tea, the paper lantern, bedrolls, the hearth-nook, the Last Bridge (`last-bridge.h`, `last-bridge.v`), the genre props, the mechanic objects (`junction`, `lamp`, `candle`, `lever`, `line`, `console`, `lectern`, `alibi`, `clue`, `plan-tile`, `breaker`, `forge`, `bell`, `riddle-board`, each with a frame per state of §5.3), and six device frames (`device.drone`, `device.turret`, `device.decoy` for units; `device.snare`, `device.patch-kit`, `device.pop-up-cover` for objects).

The genre props (**Decided**; ids are the `state` of a `prop` object, flags as listed): `crate` (cover-low, throwable); neon `neon.server-rack` (cover-high), `neon.vending` (cover-low); nocturne `nocturne.streetlamp` (cover-high, light), `nocturne.bench` (cover-low); gothic `gothic.candelabra` (cover-low, light, throwable), `gothic.pew` (cover-low); iron `iron.oil-drum` (cover-low, hazard), `iron.girder` (cover-high); void `void.shard` (cover-high), `void.orbit-stone` (cover-low); noir `noir.filing-cabinet` (cover-high), `noir.desk` (cover-low); frontier `frontier.barrel` (cover-low, throwable), `frontier.cart` (cover-high); kaiju `kaiju.rubble` (cover-low), `kaiju.car` (cover-high); and `rubble` (cover-low), what a burst hazard prop becomes.

`src/world/straygen.js`: `composeStray({ archetype, bodyKey = 'r', parts = [], eyeKey = null, pose = null, poseName = null, frame = 0, size = 20 })`, where `pose` is the anims.json pose object and `poseName` its key (`idle`, `move`…). With no pose and size 20 the output is byte-identical and not memoised. Otherwise it's memoised (an LRU of 2,048) by `archetype|bodyKey|eye|parts|poseName|frame|size` and returns frozen `{ rows, layers }`. At size 28 the margins are (6, 8), so `pad(composeStray(x), 4)` equals the size-28 rest pose. `restFeet({ archetype, bodyKey, parts, size })` gives the feet once from the rest frame.

`src/world/riftfx.js` (F, wave 1): `outfitGrid(name, rows, { split, wear } = {})` (the two-argument behaviour and its identity cache are unchanged), and `leadSprite(spec)` also returns `parts`.

## 8. State

### 8.1 Where it goes

The new sections come after `story`, in this order, in `createState`, `normalize` and `KNOWN_KEYS`: `embers`, `xp`, `kindle`, `chronicle`, `road`, `party`, `expedition`. (A key missing from `KNOWN_KEYS` would be overwritten by its raw `extras` copy.) Their empty values and cleaners live in `src/state4.js`; `model.js` calls `normalize4(source, { now, tally })` once and spreads the result. Each section's cleaner runs in its own `try`/`catch` that falls back to that section's empty value, so one bad section never resets a save. `STATE_VERSION` stays 1.

Every cleaner follows Phase 3's rules: unknown sub-keys survive (`{ ...safeCopy(source), …known }`); idempotent (`normalize(normalize(x)) ≡ normalize(x)`, also through JSON); prototype-safe at every level; every list and map bounded; counters never go down; `now` is injected; **normalisers never pay, award or advance anything**. Main normalises every save with its own clock, so nothing time-based may prune what a live fight needs.

### 8.2 Additions to existing sections

```js
settings: { ...Phase 3, hud: 'adventure' | 'quiet' /* default 'adventure', cleaned explicitly */, kindleBell: true /* in DEFAULT_SETTINGS */ }
tally: { ...Phase 3,
  byCrew: { claude: 0, codex: 0, jev: 0, whisper: 0 },   // max(saved, finishedIds with that prefix); bumped by tallyFinished
  answered: 0, answeredFast: 0,                          // by tallyAnswered
  waiting: { [sessionId]: waitingSince },                // ≤ 60, newest kept
  focusSessions: 0, restsHonoured: 0, chunksCharted: 0,
  features: { [featureId]: firstAt } }                   // ids from trail.FEATURES
satchel: { ...Phase 3 /* materials, essences, essenceGenres and relics keep their shapes; fights add to them */, marks: 0 /* ≤ 1e9 */, tonics: { cordial: 0, brew: 0 } /* each ≤ 20 */ }
story: { ...Phase 3,
  trails: { [trailId]: { found: { [stepId]: at }, done: { [stepId]: at }, joinedAt: number | null } },   // ≤ 20 trails
  facts: { [factId]: at } }                              // ≤ 200, newest kept: 'note:<noteId>', 'examined:<genre>:<archetype>', 'glimmer:<poiId>', 'riddle:<id>'
```

`tallyAnswered(state, snapshot, now)` (model.js, beside `tallyFinished`): a live Claude session that is `needs-you` with a `waitingSince` is remembered in `waiting`; it's **answered** when a later snapshot shows it still `live` with status `working` or `done`, or with a completion after `waitingSince`. Each `id@waitingSince` counts once, then its wait is dropped. It's fast when `min(now, lastActivityAt) − waitingSince ≤ 15 min`. A session that disappears, stops being live, is archived, or whose source is down is **never** an answer; its wait is kept (for at most 7 days) in case it comes back.

`tallyFinished` also bumps `byCrew[agent]` for each session it counts (agent from `session.agent`, or the id's prefix). `byCrew` never exceeds `sessionsFinished`.

### 8.3 The new sections

```js
embers: {
  balance: 0,                 // 0..100
  lifetime: 0,                // every Ember earned, banked or not
  ledger: LedgerEntry[],      // ≤ 300, oldest dropped (newest last)
  paid: { [key]: at },        // ≤ 200 event keys ('focus:<ms>', 'rest:<ms>'), newest kept
  paidBefore: 0,              // any event key whose time ≤ this counts as paid (raised when `paid` is pruned)
  through: null | { sessionsFinished, answered, stitchedReal, buildingsDesigned },   // null until the backlog is paid
  day: { key: 'YYYY-MM-DD' | null, crew: 0, answered: 0 },   // today's capped payments
  backlogAt: null | number
}
xp: {
  skills: { [skillId]: number },   // whole XP, 0..200,000,000; only the 24 ids
  through: null | { sessionsFinished, answeredFast, buildingsDesigned },
  day: { key: 'YYYY-MM-DD' | null, travels: 0 }
}
kindle: {
  phase: 'idle' | 'focus' | 'rest',
  startedAt: null | number, focusEndsAt: null | number,       // the focus session
  restStartedAt: null | number, restEndsAt: null | number,
  earned: boolean,                                             // this rest follows a finished focus session
  paid: { focus: null | number, rest: null | number }          // the startedAt / restStartedAt last paid
}
chronicle: {
  days: { [dayKey]: { embersIn, embersOut, focus, rests, crew, answered, stitched, fights, xp: { [skillId]: n } /* non-zero skills only, ≤ 6 kept (the largest) */ } },   // ≤ 60 days, oldest dropped
  fights: FightSummary[],     // ≤ 50, newest last
  xpLines: [{ at: number, skill: string, n: number, source: string /* ≤ 20 */, text: string /* ≤ 60: 'Focus 1,000: focus session 09:10–10:00' */ }]   // ≤ 120, newest last
}
FightSummary = { id: string, at: number, where: string /* ≤ 60 */, outcome: string, rounds: number, xp: number, marks: number, summary: string /* ≤ 200 */ }
road: {
  xp: 0,
  paidFights: { [fightId]: at },   // ≤ 500, newest kept; fight and stitch keys never recur (they carry the day, the episode or a daily rift id), so pruning is safe
  stitchedThrough: null | number,  // high-water mark on rifts.stitched.real for Road XP, Warding and Seamcraft (null until first seen: seeded, not paid)
  levelShown: 1,                   // the highest level whose Level up moment has been shown
  firstWin: false
}
party: {
  roster: { [id]: Member },   // milo, claude, codex and jev are always present (added by the cleaner); tollkeeper once he joins; regulars
  chosen: string[],           // ≤ 3 roster ids, never 'milo', no repeats
  formation: 'line' | 'pairs' | 'loose' | 'wedge',
  cheers: 0,                  // 0..4
  regulars: Regular[],        // ≤ 12
  outing: { startedAt: null | number, breathers: 0, breatherFight: null | string, freeBreather: false, warmed: false /* this outing's warmth paid */,
            heroes: { [id]: { integrity: number, charges: number, uses: { [abilityId]: number }, rattled: boolean } } },
  rests: { lanternDay: null | number, nooks: { [riftId]: at } /* ≤ 50 */, freeReentry: { [riftId]: at } /* ≤ 50 */ },
  mode: 'storybook' | 'long-road' | 'mauds-table',
  play: 'guided' | 'command' | 'choose' | 'handle',   // the way to play (default 'guided'); each Member's control can differ
  calm: { noise: true, adaptation: true, odds: 'bars' | 'words', fastFoes: true, playback: 1 | 2 | 4, ghosts: false },
  strayMemory: { [genre]: { habit: string, count: number } },   // ≤ 12 genres
  firstLeadMet: false,
  teachDay: null | number,
  seenScenes: { [sceneId]: at }   // ≤ 100
}
Member = {
  joinedAt: number,
  warmth: 0, warmthWeek: { week: null | number /* weekStart's day number */, outing: 0 }, habitDay: null | number,
  path: null | string, boons: string[] /* ≤ 3 */, pending: ('path' | 'boon')[],
  control: 'mine' | 'review' | 'choose',          // default 'review'; Milo too
  reactions: { [reactionId]: 'ask' | 'always' | 'under-half' | 'never' },
  prepared: string[],                             // the Scribe's Pages (spell ids, ≤ 20)
  gifts: { margin: 0, spare: 0, through: null | number },   // Margin Notes / Spare Parts held (≤ 3), high-water on byCrew
  notebook: { count: 0, fights: 0 /* ≤ 1e6: fights that taught at least one note ('Trained on N of your fights') */,
              rules: PlaybookRule[] /* ≤ maxRules, at most 6 */, struck: string[] /* ≤ 40, never pruned: strikeOut refuses a 41st */,
              accepts: string /* ≤ 50 of '0' | '1' */, previous: null | { count: number, at: number } }
}
Regular = { id, riftId, riftSeed, name, genre, second: null | string, archetype, bodyKey, parts: [{ id, layer }], eyeKey: null | string,
            temperament, calling, lead: boolean, mechanic: null | string, joinedAt }
expedition: null | {             // its life is §4.18's: kept after leaving, cleared when its place closes or another is entered
  runId: string,
  kind: 'wild' | 'rung' | 'real' | 'story' | 'cave' | 'field',
  riftId: null | string, key: null | string, since: null | number,
  source: { seed, tier, depth, weights, rungs: number }                     // wild and rung: riftgen.wildRift's inputs
        | { key, subject, signals: string[], urgency, tier, cause, since }  // real and story: riftgen.realRift's inputs as they were at entry,
                                                                            // so a resume never rebuilds from the live signal (whose urgency moves the stage)
        | { poi: string }                                                   // cave
        | { seed, tier, depth, weights, x, y },                             // field boss
  depth: number, tier: number, enteredAt: number, embersPaid: number,
  inside: boolean,               // false after Head home, Go home or everyone offline
  rooms: { [roomId]: 'won' | 'talked' | 'bowed' | 'yielded' | 'last-page' },
  chests: { [lootId]: at },
  nookUsed: boolean,
  entry: { [heroId]: number },   // Integrity when the current fight began (Try again)
  battle: null | BattleSave,     // ≤ 49,152 bytes by battleBytes, else null (the expedition stays)
  card: null | 'offline' | 'victory' | 'bow' | 'yielded'
}
```

Cleaner specifics:
- `embers.ledger` entries need a finite `at`, an integer `n` (−100..1,000,000; only the backlog's entry goes past 100), `banked` 0..100, `source` ≤ 20 and `text` ≤ 60 (titles never stored, §2). `balance` is clamped 0..100. `lifetime ≥` the sum of the ledger's positive `banked`.
- `kindle`: a phase whose times are missing or out of order becomes `idle`; times stay absolute; the phase is never advanced here.
- `party.roster` ids are slugs (`reg-` prefix for regulars, never a Windows device name); a `chosen` id not in the roster is dropped; `warmth` ≤ 1,000.
- `expedition.battle` passes `stripUnsafe`, must have `v === 2` and a string `id`, and must be ≤ 49,152 bytes by `battleBytes`; otherwise it's `null`. Deep checks are `restoreBattle`'s job.
- **Size.** Phase 4's sections at every cap, with a `BattleSave` at its cap, are ≤ 400 KB pretty-printed (a measured draft of these caps: about 275 KB without the Battle, about 100 KB for it), and the whole capped state stays under the pinned 1.6 MiB test. A extends `core.test.js`'s capped fixture to Phase 3's **full** caps (glimmers, felled, closed wild rifts and visited places included, about 1,145,000 bytes on their own) plus Phase 4's, and measures both.

## 9. Content

### 9.1 The manifest (`electron/content.cjs`) and the bundle

```js
content = {
  genres, riftgen, fortress, wilds, story,                    // unchanged, content/<name>.json
  skills, xp, economy, spells, examine, trails, sky,          // content/<name>.json; spells is the Grimoire
  combat: { rules, callings, spells, leads, foes, anims, tuning },   // content/combat/<name>.json; tuning may be null
  party: { companions: { [id]: object }, regulars, teamups, banter },   // content/party/companions/*.json keyed by file name
  camp: { scenes, talks: { [id]: string } }                   // content/camp/talks/*.md as raw text
}
```
- Directory reads are `readdir`, filtered by `/^[a-z0-9][a-z0-9-]{0,39}\.(json|md)$/`, sorted by name. Caps: 1 MiB per file, 200 files and 8 MiB per bundle. A UTF-8 BOM is stripped; `.md` has CRLF turned into LF. A JSON file must parse to a plain object; anything else is `null`. A missing file is `null`; a missing directory makes its group `null`. Nothing outside `content/` is read. The five Phase 3 keys come out byte-identical to today's bundle.
- `src/content4.js` exports `phase4Problem(bundle) → { groundwork: null | string, combat: null | string, party: null | string, world: null | string }`, naming the first missing or malformed file per area (presence, `version === 1`, and each file's top-level keys from this section). It never touches Phase 3's `contentProblem`. The shell switches off only the broken area: groundwork (Embers, Kindle, the Chronicle, skills), combat and party together (fights; Elsewheres stay Phase 3 walks), or world (the trail, caves, field bosses, `examine.json`).

Every file has `"version": 1` and an `"about"` string that passes the calm check. Strings follow the house keys: `id`, `…Id`, `kind`, `genre`, `archetype`, `calling`, `skill`, `needs`, `from` are machine keys; `text`, `lines`, `say`, `hint`, `look`, `bow`, `examine`, `words` are prose; `name` and `title` are names.

### 9.2 `content/combat/rules.json` (B)

```json
{ "version": 1, "about": "…",
  "bands": { "cool": { "to": 30, "bars": [5, 80, 10, 5] }, "warm": { "to": 60, "bars": [15, 60, 15, 10] }, "hot": { "to": 100, "bars": [30, 35, 15, 20] } },
  "edge": { "cap": 3, "step": 10, "reference": { "cool": { "3": [35, 65, 0, 0], "…": [] }, "warm": {}, "hot": {} } },
  "heat": { "max": 100, "attack": 20, "attackLight": 10, "drift": 10, "driftLantern": 20, "coolDown": 30, "room": { "neon": 10, "iron": -10 }, "maudsIdle": 15,
            "companions": { "tollkeeper": 15, "milo": 20, "claude": 25, "codex": 30, "jev": 50, "…": 0 }, "temperaments": { "shy": 15, "…": 0 } },
  "actions": { "speed": 5, "small": 4, "flies": 6, "grace": 3, "seek": 6, "seekHeed": 8, "reboot": 0.25, "throwBase": 3, "throwMight": 2, "jumpBase": 2, "brace": 3, "shield": 2, "bowRange": 12,
               "drink": 1, "give": 2, "difficult": 2, "stepUp": 1 },
  "lights": { "lamp": 3, "candle": 1, "max": 24 },
  "lines": { "one": [5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17], "strike": [], "two": [], "three": [], "area": [] },
  "integrity": { "sturdy": [22, 34, 46, 58, 70, 84, 98, 112, 126, 140, 154, 168], "middle": [], "light": [], "gritBase": 1 },
  "strays": { "integrity": [15, 20, 34, 48, 61, 75, 92, 109, 126, 143, 160, 177, 194], "strike": [], "resist": [], "past12": { "integrity": 17, "strike": 1.5 } },
  "archetypes": { "walker": { "integrity": 1, "speed": 5, "grace": 1, "guard": 1, "resolve": { "body": 1, "mind": 0 }, "range": 0, "hovers": false, "flies": false, "throughWalls": false, "resist": {}, "weak": {}, "ignores": [], "abilities": [] }, "…": {} },
  "lackey": { "levels": -2, "integrity": 0.5, "strike": 0.75 },
  "elite": { "integrity": [[1, 10], [4, 15], [99, 20]], "edge": 1, "damage": 2 },
  "lead": { "below": { "hairline": 2, "open": 2, "gaping": 1 }, "range": 8, "phases": { "hairline": 2, "open": 3, "gaping": 3 },
            "asides": { "storybook": [1, 1, 1], "long-road": [1, 2, 2], "mauds-table": [2, 3, 3] }, "lastPage": 8, "bow": 1.25 },
  "genres": { "neon": { "kind": "static", "weak": "warp", "fights": true, "noise": { "id": "lag", "rate": 0.2 }, "abilities": ["<neon's big move>"] }, "…": {} },
  "hidden": { "voidFalse": [1, 3], "noirHidden": true },
  "temperaments": { "shy": { "heat": 15, "talk": 2 }, "…": {} },
  "gentle": ["shy", "polite", "sleepy", "lost", "curious", "nosy", "proud", "grumpy", "dramatic"],
  "conditions": { "tumbled": { "numbered": false, "class": "bane", "ends": "stand", "crit": "as-hit", "graze": "none" }, "…": {} },
  "surfaces": { "neon-puddle": { "meets": null, "difficult": false, "slippery": false, "lit": false, "hurts": false, "on": [{ "do": "condition", "id": "soaked", "n": 1 }], "reacts": { "spark": "arc", "static": "arc", "chill": "ice" } }, "…": {} },
  "surfaceGrowth": { "every": 3, "from": 1 },
  "hazard": { "line": "two", "kind": "plain", "radius": 1, "burstOn": "light" },
  "budgets": { "cost": { "-4": 10, "-3": 15, "-2": 20, "-1": 30, "0": 40, "1": 60, "2": 80, "3": 120, "4": 160 }, "below": 5,
               "for4": { "trivial": 40, "low": 60, "moderate": 80, "severe": 120 }, "fewer": { "trivial": 10, "low": 15, "moderate": 20, "severe": 30 },
               "depth": { "from": 3, "perHero": 2, "max": 10 }, "affixes": { "crowded": 1.25, "lonely": 0.6 }, "caps": { "foes": 8, "kinds": 3, "eliteDepth": 7 },
               "leadBar": { "2": 30, "1": 40 }, "surfaceShare": 0.15 },
  "tiers": [1, 2, 4, 5, 7, 9, 10, 11], "deepRank": { "every": 3, "integrity": 0.1, "damage": 1, "loot": 0.1 },
  "road": { "xp": [0, 200, 1000, 3800, 11500, 24000, 46000, 84000, 147000, 250000, 380000, 550000],
            "cap": { "camp": 3, "stockade": 5, "hold": 7, "keep": 8, "castle": 10, "citadel": 11, "kingdom": 12, "bright-kingdom": 12 },
            "regulars": { "camp": 0, "stockade": 2, "hold": 4, "keep": 6, "castle": 8, "citadel": 12, "kingdom": 12, "bright-kingdom": 12 },
            "perWeight": [10, 20, 35, 55, 80, 110, 145, 185, 230, 280, 335, 395], "past12": 60, "deep": 45,
            "leadWeights": { "hairline": 8, "open": 10, "gaping": 12 }, "wildStitch": 4, "realStitch": 8 },
  "rewards": { "marks": 4, "essence": 0.3, "leadEssences": [2, 4], "relic": 0.2, "tonic": 0.25, "cordial": 0.7 },
  "work": [0, 5, 15, 30, 50, 80, 120, 170, 230, 300, 400, 520], "workPast12": 140,
  "adapt": { "lackey": 0, "stray": 1, "elite": 2, "lead": 3 },
  "modes": { "storybook": { "foeLevel": -1, "damage": 0.75, "cooler": true, "adapt": false, "noise": "off", "breathers": 3 },
             "long-road": { "foeLevel": 0, "damage": 1, "cooler": false, "adapt": true, "noise": "room", "breathers": 2 },
             "mauds-table": { "foeLevel": 1, "damage": 1, "cooler": false, "adapt": true, "adaptPlus": 1, "noise": "all", "breathers": 1, "lastPage": false } },
  "rests": { "topUp": 0.5, "breatherPatch": 0.5 }, "cheers": { "max": 4 },
  "warmth": { "stranger": 0, "acquaintance": 10, "companion": 30, "friend": 60, "fireside": 100, "outing": 2, "outingWeek": 6, "habit": 1 },
  "warding": { "wedge": 5, "ready": 10, "rules": [[0, 1], [15, 3], [50, 6]], "ambush": 30 },
  "tuning": { "low": [1.5, 2.5], "moderate": [2.5, 3.5], "moderateP95": 6, "lead": [4, 5], "leadMax": 8,
              "win": { "storybook": 0.99, "moderate": 0.95, "chained": 0.85, "lead": 0.8, "maudsTable": [0.6, 0.8] }, "noiseFlip": 0.02,
              "minutes": { "command": 12, "guided": 6, "round": { "command": 75, "guided": 40 }, "walk": 90 } },
  "sight": { "lit": 6, "dim": 3, "lantern": 3, "lanternRaised": 5 },
  "weapons": { "light": -2, "standard": 0, "heavy": 2, "rangedRange": 12 }, "armour": { "none": 0, "light": 0, "mail": 1, "plate": 2 },
  "cover": { "tree": "high", "pine": "high", "basalt.column": "high", "crag": "high", "rock": "low", "bush": "low", "dice.stone": "low", "ruin": "low", "reeds": null },
  "timing": { "tile": 140, "melee": 600, "cast": 800, "effect": [400, 700], "hit": 250, "flash": 150, "strayBeat": 1500, "hitStop": 80, "fps": [8, 12] },
  "odds": { "likely": 70, "even": 40, "crit": 20 } }
```
Every array and table equals §4 cell for cell (B's `combat-content.test.js`), and the conditions and surfaces equal B's transcription of COMBAT §7 and §4.3 (§4's opening). `…` marks entries elided here that the file must have in full: all 12 genres (each fighting genre naming its `big: true` ability), 9 temperaments, 6 archetypes (the crawler's `pounce`, the ghost's Spook rider), 22 conditions, 16 surfaces, and the fifteen companions' idle heats of §4.3 under the ids of §5.1 (regulars take theirs from temperament). Companions' idle heats live **only** here: companion files don't carry `idleHeat`. The ability ids named here resolve in `foes.json`'s `abilities` (§9.8).

### 9.3 `content/combat/callings.json` (C)

```json
{ "version": 1, "about": "…",
  "charges": { "full": [2, 3, 4, 5, 7, 8, 10, 11, 13, 14, 15, 16], "three-quarter": [], "half": [], "pact": [] },
  "circles": { "full": { "1": 1, "3": 2, "5": 3, "7": 4, "9": 5 }, "pact": {}, "three-quarter": { "1": 1, "3": 2, "6": 3, "9": 4 }, "half": { "2": 1, "5": 2, "9": 3 } },
  "callings": [ { "id": "scrivener", "name": "Scrivener", "role": "Prepared magic, areas", "build": "light", "key": "wit",
                  "resolve": { "body": 0, "mind": 1 }, "armour": "none", "plateFrom": null, "shield": false, "charges": "full", "weapon": "light",
                  "maxLevel": 12, "levels": { "1": ["pages", "proofread"], "2": ["turn-back-a-page"], "3": ["path"], "4": ["boon"], "5": [], "…": [] },
                  "spells": ["full-stop", "ink-blot", "salve", "…"] } ],
  "paths": [ { "id": "three-pens", "name": "Three Pens", "companion": "claude", "calling": "scrivener", "levels": { "3": ["…"], "6": ["…"], "11": ["…"] }, "text": "…" } ],
  "abilities": [],             // Ability[] (§6): calling features, path features, weapon arts, boons, items, devices, Margin Notes, Spare Parts
  "weaponArts": { "light": "tripping-cut", "standard": "pommel-tap", "heavy": "cleave", "ranged": "pinning-shot" },
  "boons": ["ability-up", "early-riser", "good-boots", "steady-hands"],
  "items": ["cordial", "brew-of-clear-morning"], "gifts": { "margin": "margin-note", "spare": "spare-part" } }
```
`"path"` and `"boon"` in `levels` mark a pick (Level up). A power jump is either an ability id or a circle step (the `circles` table), not both.

### 9.4 Features by level

Levels 1–5 for every calling, and 6–12 for the scrivener, tinker and skirmisher. Names are COMBAT §5.4's; everything marked **Decided** is this contract's call where COMBAT gives no level.

| Calling | 1 | 2 | 5 (power jump) | Notes |
|---|---|---|---|---|
| lanternkeeper | `hooklight`, `raise-lantern`, `stand-in-my-light` (2 per Campfire, 3 from 5, 4 from 9), knacks `mote`, `flare` | `scarf` | `the-lantern-calls` (**Decided**) | Paths at 3: `hearth`, `wick`, `wayward` (rules §6.5); Wick adds `hearthburst` (a circle-3 stub until level 6). *Second wick* at 10 is data only |
| warden | `draw-the-blow`, `hold-here` (per Breather), `second-breath` (per Breather) | `surge` (per Breather) | `steady-second` | Plate from Road level 5. `unbroken` (10) and `steady-third` (11) are data only |
| mender | `soothe` (knack), `reach-out` (twice per Breather) | `still-water` (per Breather) (**Decided**) | circle 3 | |
| scrivener | `pages`, `proofread` (2 per Campfire, 3 from 5, 4 from 9) | `turn-back-a-page` (once per Campfire) (**Decided**) | circle 3 | 7: `turn-back-a-page` twice per Campfire (**Decided**); 9: circle 5 (upcasts); 10: `two-sustained`; 12: boon |
| tinker | `bench-drone`, `pop-up-cover` (2 per Breather), `quick-fix` (Wit per Campfire) | `tune-ups` | circle 2 | 7: `pop-up-cover` 3 per Breather (**Decided**); 10: `two-drones`; 12: boon |
| skirmisher | `unseen-strike` | `slip` (**Decided**) | `tuck-and-roll` (**Decided**) | 7: +1 Speed (**Decided**); 10: `swipe-strike`; 12: boon |
| longshot | `ready-a-shot`, `bead` | `read-the-ground` (**Decided**) | `steady-second` | `volley` (7) and `steady-aim` (10) are data only |
| chorister | `heartening-verse` (Charm per Campfire), knack `hum-off-key`, spell `lullaby` | `hum-along` | circle 3 | `last-verse` (10) is data only |
| weaver | knack `loose-thread` (2 threads at ⅔ from 5, 3 at ½ from 11), `burn-an-essence` | `borrow-a-rule` (per Breather; twice from 7) (**Decided**) | circle 3 | |

- Level 3 is the path pick, levels 4, 8 and 12 a boon, 6 and 11 a path feature, 9 circle 5 (casters), 11 the damage step (the warden's `steady-third`; nothing more for the others, since the lines already step, **Decided**).
- **Path features for the Scribe (Three Pens, Footnote), the Artificer (Bench, Slate), Jev (Gavel, Courier) and the Tollkeeper (Bridge, Troll-kin)** are C's to design, in §6's vocabulary only, named by their path's name, each worth at most about one `one`-line a round, and each with a unit test. Regulars have no path.
- These levels use §6.5's `steady-second`, `steady-third` (data only), `two-sustained`, `two-drones` and `swipe-strike`.
- Out-of-fight features live in party.js: `pages` (`preparePages`: Wit + level spells at camp or a lantern), `turn-back-a-page` (a Breather also restores half the level in charges, rounded down), `burn-an-essence`'s satchel side (a Weaver's `carry.essences` come from `satchel.essences` at setting out, and `afterFight` takes the burnt ones off the satchel), boons (applied to the spec; `swapBoon` at the campfire) and paths (`swapPath` at camp).

**Companion moves (Phase 4):**
- The Scribe: `draft` (1 action: strikes out one boon on a foe; meets mind), `letter` (1: patches an ally beside her for `one`; 2: one within 6 for `two`; 3: everyone within 2 for `area`), `being-sure` (1: an ally's next effect on a foe lands one degree better, or the next foe effect on an ally lands one degree worse).
- The Artificer: `device` (2 actions, once a turn, besides the drone: a `turret`, `snare` or `patch-kit`).
- Jev: flies; `verdict` (1 action; choice `pile`: allies +1 edge against a foe, +2 while Jev is at 60 heat or more, until the end of the next round; choice `sure`: an ally's Resolve is 2 against the next effect).
- The Tollkeeper: `tollkeeper-toll` (passive), `riddle-me` (1 action: a foe spends its next action on him, on a Hit or better against mind Resolve).
- Heart feats exist as stubs (`from: 'Fireside warmth'`).
- **Margin Note** (1 action, `consumes: 'margin'`: an ally within 6 has one bane ended and is patched for the `one` line) and **Spare Part** (1 action, `consumes: 'spare'`: a turret that lasts 3 rounds), **Decided**. The tonics are items with `consumes` too: `cordial` (drink 1 action or give 2: a quarter of max Integrity, a third with *Steady hands*) and `brew-of-clear-morning` (drink 1 or give 2: ends one condition); the spell `clear-morning` keeps its own id.
- **C's table test** checks every shipped spell, knack, calling feature, weapon art and item against its transcription of COMBAT §5.4 and §6 (costs, ranges, areas, amounts, uses and riders), including *Stand in my light* 2/3/4 a Campfire, *Scarf* pulling 2 tiles from up to 3 away, Pop-up cover 10 + 2 × level, the Bench drone 5 × level, *Loose thread* range 10 and each weapon art's once-per-Breather rider; and that no id is shared by an item, spell, move, feature or foe ability.

### 9.5 `content/combat/spells.json` (C)

`{ "version": 1, "about": "…", "spells": Ability[] }`. Shipped in full: knacks `mote`, `flare`, `loose-thread`, `full-stop`, `hum-off-key`, `ink-blot`, `little-light`, `steady-hand`; circle 1 `salve`, `kind-word`, `take-heart`, `inkdarts`, `sudden-shelter`, `lullaby`, `tangleweed`; circle 2 `hold-still`, `step-through-the-seam`, `quiet`, `fogcloak`, `clear-morning`. Stubs: `hearthburst`, `neon-line`, `tidesong`, `brisk`, `cross-it-out`, `send-home`, `candle-wall`, `the-long-song`, `rewrite-the-room`. Numbers are COMBAT §6's; where it gives none, **Decided:** `ink-blot` range 6, `inkdarts` range 8, `little-light` radius 2 for 10 rounds at a tile within 6, `hold-still` range 8, `clear-morning` range 6.

### 9.6 `content/party/companions/<id>.json` (C)

```json
{ "version": 1, "id": "claude", "name": "The Scribe", "crew": "Claude", "pronoun": "she", "calling": "scrivener", "paths": ["three-pens", "footnote"],
  "rig": "robe", "joins": { "phase": 4, "how": "start" },
  "service": "…", "fieldSkill": "read", "sleeps": "…", "lives": "…",
  "abilities": { "might": -1, "grace": 1, "grit": 1, "wit": 3, "heed": 2, "charm": 0 }, "small": false, "flies": false,
  "damageKind": "ink", "weapon": "light", "personality": "careful",
  "reactions": { "shoulder": "always", "proofread": "ask" },   // her own defaults over §4.4's (COMBAT §3.7 plays her Shoulder on Always)
  "moves": ["draft", "letter", "being-sure"], "abilityDefs": [], "heartFeat": "one-line",
  "quest": { "name": "The Short Version", "habit": "claude-session", "from": "Phase 5" },
  "workLevel": { "crew": "claude" }, "likeness": { "name": "Clay Likeness", "look": "…" },
  "titles": [{ "level": 1, "title": "Scribe" }, { "level": 4, "title": "…" }, { "level": 8, "title": "…" }, { "level": 12, "title": "…" }],
  "barks": [{ "on": "critical", "say": "…" }, { "on": "offline", "say": "…" }], "examine": ["…"] }
```
- `abilityDefs` holds the moves' Ability objects (§6), or they live in callings.json; ids are unique either way.
- `joins.how`: `start` (Milo, the Scribe, the Artificer, Jev), `trail` (the Tollkeeper, with `"trail": "first-trail"`), and for data-only companions `rift`, `hearth`, `story` or `bell` with `phase > 4`.
- **Jev** has `"does"` gestures instead of `"say"` in barks, and no `say` anywhere; its `pronoun` is `"it"`.
- Personality ids come from `ai.js`'s `PERSONALITIES`; C proposes them in its report and H defines them (C may use `careful`, `bold`, `steady`, `quick`, `guarding`, `talker`, `patcher`).
- All fifteen files exist, named by the ids of §5.1. The ten data-only ones need `id`, `name`, `pronoun`, `calling`, `paths`, `joins` (phase > 4), `service`, `fieldSkill`, `damageKind`, `examine`, and their moves as stubs. No companion file carries `idleHeat` (it's `rules.json`'s, §9.2).
- A companion's `barks` are the only barks: B reads them through `ctx.party` (§7.1). Its thought bubbles use `personality` and `describe.thoughtText`'s templates, so the files need no thought lines.

`content/party/regulars.json`: `{ "version", "about", "callingByArchetype": { "construct": "warden", "crawler": "skirmisher", "flier": "longshot", "ghost": "mender", "floater": "weaver", "walker": "chorister" }, "personalityByTemperament": { "shy": "careful", "curious": "quick", "grumpy": "bold", "dramatic": "bold", "sleepy": "steady", "polite": "patcher", "lost": "steady", "nosy": "talker", "proud": "guarding" }, "ask": ["Can I sit by the fire a while?", …], "noRoom": ["Another time, then.", …], "signatures": { "<genre>": "<abilityId>" }, "tricks": { "<genre>": "<abilityId>" }, "abilityDefs": Ability[], "barks": [{ "on", "say" }] }`. One genre signature per fighting genre; a regular's idle heat is its temperament's (§4.6). A bowed Tale-lead regular keeps its mechanic as a once-per-fight trick: **Decided:** that trick is its own ability per genre (`tricks`, id `<signature>-trick`), the signature's effects at +1 degree with `uses: { per: 'fight', n: 1 }`. Its ids are in `buildAbilityIndex`'s uniqueness check.

`content/party/teamups.json` and `banter.json`: data only (COMBAT §2.8's table; `banter.json` holds exploring banter for Phase 5, never fight barks).

### 9.7 `content/combat/leads.json` (D)

```json
{ "version": 1, "about": "…",
  "mechanics": [ { "id": "throttles-speed", "genre": "neon", "index": 0, "text": "throttles everyone’s speed until you reroute the power",
                   "name": "Throttles speed", "ships": true, "noFight": false, "xInt": 1.2,
                   "rule": "Party Slowed 1 until 3 junctions are rerouted (an Interact each); then the lead is Dazed 2.",
                   "bow": "All three in one phase.", "objects": [{ "kind": "junction", "count": 3, "where": "edge" }] } ],
  "fallback": { "xInt": 1.0, "rule": "A plain Tale-lead: its bars, its phases and its quote." },
  "hooks": [{ "name": "…", "companion": "…", "talk": "…" }] }   // `companion` and `talk` resolve against the companion files and camp talks (L1's cross-content test)
```
- 39 mechanics in `riftgen.json`'s order (genre by genre, then index), `text` equal to riftgen's exact string, ids unique. The eight shipped have `ships: true`; the seven bright and Backhalls ones `noFight: true`; the other 24 carry their COMBAT §8.3 rule, `xInt` and bow text with `ships: false`.
- Ids: neon `throttles-speed`, `copies`, `firewall`, `reboots-once`; nocturne `no-weakens-it`, `streetlights-out`, `clock-skips-back`, `squeaky-bicycle`; gothic `snuffs-candles`, `portrait-swap`, `old-letters`, `ravens`; iron `assembly-lines`, `shift-whistle`, `stamped-forms`, `steam-vents`; void `too-big-to-see`, `sideways`, `splits`, `hides-unseen`; noir `alibis`, `lights-out`, `red-herrings`, `questions`; frontier `noon-duel`, `circles`, `posse`, `fair-parley`; kaiju `grows-daily`, `only-the-colossus`, `stomps`, `alarms`; verdant `plant-three-seeds`, `a-tour-of-good-things`; starlight `a-transformation`, `three-small-wins`; summit `sit-still`, `a-trial-of-stillness`; backhalls `the-different-door`.
- Object needs for the eight: throttles-speed 3 junctions; streetlights-out 4 lamps; snuffs-candles 6 candles; assembly-lines 3 lines and 3 levers; too-big-to-see none; alibis 3 alibis and 3 clues (object kind `clue`, §5.3); noon-duel none; stomps 4 plan tiles. I may refine counts in wave 2 (recorded in §18).

### 9.8 `content/combat/foes.json` (D)

```json
{ "version": 1, "about": "…",
  "canon": [ { "id": "hollow-sentries", "name": "Hollow Sentries", "one": "Hollow Sentry", "archetype": "construct",
               "where": ["delves", "caves under old ruins"], "look": { "bodyKey": "s", "parts": [], "eyeKey": null },
               "bow": { "kind": "talk-down", "count": 3, "text": "Reminded what they guard, they lay down arms." }, "examine": ["…"] } ],
  "creatures": [ { "id": "cinder-beetles", "name": "cinder beetles", "one": "cinder beetle", "archetype": "crawler", "temperament": "curious",
                   "look": { "bodyKey": "r", "parts": [], "eyeKey": null }, "special": null, "examine": ["…"] } ],
  "caves": { "cinderforge": ["cinder-beetles", "cinder-golems"], "…": [] },
  "mimic": { "id": "mimic", "name": "Mimics", "one": "Mimic", "archetype": "construct", "bite": 1, "bow": { "kind": "open", "count": 1 } },
  "abilities": [],             // Ability[] (§6): pounce, the ghost's Spook rider, each shadow genre's big move, the Mimic's bite, the fetchfox's pinch (`take`)
  "greatOnes": [ { "id": "tollkeeper", "name": "The Tollkeeper", "kind": "talk" }, { "id": "cloud-leviathan", "name": "The Cloud Leviathan", "kind": "no-fight" } ] }
```
- Canon foes: Hollow Sentries (talk-down 3), Unwritten (`read`: the Scribe's Interact beside one, or 2 actions at a lectern), Tollmen (`riddle`: the Tollkeeper's *Riddle me* beside one, or a Wit 3+ hero's 2 actions at the riddle board), cinder golems (`forge`: an Interact at the forge, then a Light hit on it), Hush hounds (`walk`: a hero Interacts beside one two turns running), drowned bell-ringers (`bell`: three Talk downs, or the bell rung at the lectern). Their bows pay like talking down.
- Cave creatures by region (COMBAT §8.5): cinderforge cinder beetles, cinder golems; glass-fen glass eels (floater), fen herons (flier); archive-peaks inkwyrms (crawler), Unwritten; mistmere kite-crabs (crawler), fog seals (walker); whisperwood Murmurs (a swarm of lackeys), fetchfoxes (shy crawlers that pinch a tonic and run); dicing-downs dicing frogs; skyward-isles sky-rays (flier); greyreach Hush hounds. These eight regions have lists; `painted-hills`, `ivory-college`, `hearthvale` and `far-shore` have none and use the nearest listed region's (**Decided**: `painted-hills` gets Mistmere's, `ivory-college` the Glass Fen's, until their own creatures are written). The Mimic can join any cave: it's the chest's `mimic.fight`, found by opening the chest (it joins with the party beside it) or told apart first by Jev's *Sort*, and it settles the moment someone Interacts to open it (bow kind `open`). A fetchfox that pinches a tonic takes one from the party's carry (`take`) and settles; **Decided:** the tonic comes back in that room's loot.

### 9.9 `content/combat/anims.json` (F) and `tuning.json` (H)

```json
{ "version": 1, "about": "…",
  "poses": { "walker": { "idle": { "fps": 8, "loop": true, "still": "first", "frames": [ { "anchors": { "headTop": [0, 0], "right": [1, -1] }, "ops": [ { "op": "swapLegs" } ], "eyes": null } ] }, "…": {} }, "…": {} },
  "flourishes": { "neon": { "frames": [], "effect": "glitch-slash" }, "…": {} },
  "effects": { "mote": { "primitive": "beam", "params": {}, "frames": 5, "size": 32 }, "…": {} },
  "spells": { "mote": "mote", "…": "…" },
  "clipPoses": { "ready": "idle", "walk": "move", "melee": "attack", "ranged": "attack", "cast": "attack", "hit": "hit", "offline": "settle", "…": "…" } }
```
Timing lives only in `rules.json` (§9.2). `clipPoses` maps every CLIP (§7.8) to the stray pose that plays it, so `anim.timeline` asks for one clip name for heroes and strays alike. 16 pose specs per archetype (idle, move, attack, hit, settle, and the rest of COMBAT §14.3's table with their frames), 96 in all. Ops are closed: `swapLegs`, `squash` (a row), `stretch`, `shift` (a band by dx), `lift` (whole sprite by dy), `flash`, `dither` (for fades). Anchor offsets apply before stamping; eye swaps at the placeholder stage.

`content/combat/tuning.json` (written by `scripts/tune.mjs`): `{ "version": 1, "about": "…", "integrityFactor": { "<level>": { "<partySize>": number } }, "xInt": { "<mechanicId>": number }, "measured": "YYYY-MM-DD", "fights": number }`. Absent until H's first run; rules default to factor 1 and leads.json's `xInt`.

### 9.10 Camp scenes and the talk grammar (C)

`content/camp/scenes.json`: `{ "version", "about", "scenes": [ { "id", "when": "arrival" | "rain" | "night" | "dawn", "who": "<companion id>", "lines": [ { "speaker": "…", "text": "…" } | { "gesture": "…" } ], "needs": "<requirements>" } ] }`, with an arrival for the Scribe, the Artificer, Jev, the Tollkeeper and a generic regular, and each of those four companions' **camp scene** (`when: 'night'`, `needs: "warmth <id> 10"`: Acquaintance opens it, COMBAT §2.7). Scenes and talks play in K2's dialogue box (§12.4).

`content/camp/talks/<id>.md`:

```
---
id: tollkeeper-riddles
with: tollkeeper
once: false
---
# first
Tollkeeper: I have a bank but never count my coins. What am I?
> A river. [next: second] [set: riddle:river]
> A miser. [reply: “A fair guess. Misers count all day.”]
> The Tide Market. [needs: fact note:note-20] [reply: “Brannoch would laugh at that.”]
(He leans on the rail and waits, perfectly patient.)
# second
…
```
- Front matter between `---` lines: `id` (the file name), `with` (a companion id or `none`), `once` (`true`/`false`), optional `needs`.
- `# <node-id>` starts a node; the first node starts the talk.
- `Speaker: text` is speech; the speaker is a companion's id or `name` (`Tollkeeper:` and `The Tollkeeper:` both work) or a person's name from LORE. `Jev:` is a parse error.
- `(text)` is a stage direction (Jev may appear in these).
- `> text` is a choice, followed by tags: `[needs: …]`, `[next: node]`, `[reply: text]`, `[set: factId]`, `[likes: companionId]`, `[join: companionId]`, `[end]`. A choice without `next` or `end` answers with its reply and returns to the same node with that choice greyed. Every path can reach an end, so nothing locks. `[likes: id]` gives a Cheer and a small "The Scribe liked that." (**Decided**: no warmth in Phase 4, §3.1); a liked choice pays once per talk.
- Requirements (comma-separated in `needs`): `with <id>` (in the party), `warmth <id> <n>`, `fact <factId>`, `trail <trailId>:<stepId>`. Unmet choices show greyed with the requirement in words: "With Mae", "Friend warmth with the Tollkeeper", "Once you’ve read Brannoch’s note".
- `tollkeeper-riddles.md` has three riddles; the third right answer carries `[join: tollkeeper]`. `first-night.md` is the first camp lines (with a choice needing `with jev`).

### 9.11 Groundwork content (A)

- `content/skills.json`: `{ "version", "about", "curve": { "kind": "classic", "max": 99, "at99": 13034431 }, "families": { "life": "…", "gathering": "…", "making": "…" }, "skills": [ { "id", "name", "family", "lore", "risesFrom", "mantle", "resources"?: [], "unlocks": [ { "level", "text", "from" } ], "phase4": "…" } ] }`: the 24 skills in LORE §12's order, names and mantles equal to LORE §21. `phase4` is the one line saying where XP comes from today ("Comes with the Notice Board.").
- `content/xp.json`: `{ "version", "about", "sources": [ { "id", "skill", "xp", "text", "perDay"?: n } ] }` with §4.21's rows (`focus-session`, `rest-honoured`, `crew-session`, `answered-fast`, `building-designed`, `spell-knack`, `spell-circle`, `chunk-charted`, `lantern-lit`, `lantern-travel`, `log-chopped`, `wild-stitch`, `wild-stitch-depth`, `real-stitch`).
- `content/economy.json`: `{ "version", "about", "cap": 100, "ledger": 300, "earn": [ { "id": "focus", "n": 10 }, { "id": "rest", "n": 5 }, { "id": "crew", "n": 2, "perDay": 10 }, { "id": "answered", "n": 1, "perDay": 5 }, { "id": "stitch", "n": 5 }, { "id": "design", "n": 5 } ], "spend": { "wild": { "base": 5, "every": 3, "offset": 1, "max": 10 }, "real": 5, "story": 0, "field": 5, "cave": 3, "chunk": 1 } }`. `perDay` counts Embers. The wild cost is `min(max, base + floor((depth − offset) / every))`, and the code reads every number from here.
- `content/spells.json` (the Grimoire): `{ "version", "about", "spells": [ { "id", "name", "school", "words": ["kindle", "light the lantern"], "intent": "kindle" | "banked-coals" | "chronicle" | "wayfinding" | … | null, "from": "Phase 4" | "Phase 5" | …, "flavour": "…" } ] }` for every LORE §11 spell; names equal LORE §21's Spells group.
- `content/sky.json`: `{ "version", "about", "sun": { "1": { "rise": "07:40", "set": "17:10" }, "…": {} }, "twilight": 40, "tints": { "dawn": [255, 214, 170, 0.12], "dusk": [255, 170, 120, 0.16], "night": [40, 50, 110, 0.38] }, "seasons": { "spring": [3, 4, 5], "summer": [6, 7, 8], "autumn": [9, 10, 11], "winter": [12, 1, 2] }, "weather": { "spring": { "clear": 5, "rain": 3, "mist": 1, "wind": 1 }, "…": {} }, "particles": { "rain": { "key": "w", "density": 0.004 }, "…": {} } }`.

### 9.12 World content (E)

- `content/examine.json`: `{ "version", "about", "groups": { "vale": {}, "camp": {}, "company": {}, "creatures": {}, "foes": {}, "elsewhere": {}, "wilds": {}, "sky": {}, "things": {} } }`. Each entry is `id → string[]` (3+ lines, or 1 for a unique thing) or `id → { variant: string[] }` with variants from `day`, `night`, `dawn`, `dusk`, `lit`, `sleeping`, `opened`, `read`, `rain`, `snow`, `spring`, `summer`, `autumn`, `winter`. Lines ≤ 120 chars. `examine.json` itself holds at least 150 lines (`wilds.examine`'s 73 are on top). `things.ruin` and `things.statue` have a `read` variant: the Scribe's extra line for *Read* (§3.1). The Hooklight's line is canon: “Lit from the Hook. The big one stays home, so home stays safe.”
- **Every entity kind has lines.** K1's `examineKey(entity)` follows this table exactly, so E can prove coverage in wave 1 (**Decided**; `variant` is picked by the sky, the time, or the thing's state, else absent):

  | Entity | `{ group, id }` |
  |---|---|
  | `milo`, a crew member, a party follower (`party:<id>`), the Tollkeeper | `company`, the member id |
  | a vale place (campfire, watchtower, a plot, a building, the Lantern Hook, a gate, the War Table, the bell) | `vale` or `camp`, the place kind |
  | a lantern | `wilds`, `lantern` (`lit` when lit) |
  | a wild POI (cave, ruin, statue, hamlet, glimmer…) | `poi`, its kind: read from Phase 3's `wilds.examine`, unchanged; for *Read*, ruins and statues use `things`, `ruin` or `statue`, variant `read` |
  | a tree, rock or bush | `wilds`, its place kind |
  | a rift, an echo | `elsewhere`, `rift` or `echo` |
  | a stray, an encounter post (`enc:…`) | `creatures`, its archetype (`sleeping` when sleepy) |
  | the Tale-lead, a field boss | `foes`, `tale-lead` |
  | a canon foe or cave creature | `foes`, its foes.json id |
  | inside an Elsewhere: the stitch, the exit, a chest (`loot`), a curio, the nook | `elsewhere`, `stitch` / `exit` / `chest` (`opened`) / `curio` / `nook` |
  | the Last Bridge (`landmark:last-bridge`) | `things`, `last-bridge` |
  | a combatant (`cb:<id>`) | none: `describe.examineLine` |
  | the sky (Examine on empty ground) | `sky`, the weather kind (season or daypart as variant) |
- `content/trails.json`: `{ "version", "about", "tiers": { "easy": { "name": "Birch-bark" }, "medium": { "name": "Parchment" }, "hard": { "name": "Sealed" }, "elder": { "name": "Written in five hands" } }, "trails": [ { "id": "first-trail", "tier": "easy", "title", "steps": [ { "id", "found": "chest" | "given", "riddle": ["…"], "sign": "— T.", "solve": { "kind": "feature" | "visit" | "examine" | "read", "target": "…" }, "hint": "…" } ], "end": { "landmark": "landmark:last-bridge", "talk": "tollkeeper-riddles", "joins": "tollkeeper" }, "reward": { "smallSpell": null | "…" } } ] }`. The first trail has 4 or 5 steps; step 1 is `found: 'chest'` with `solve: { kind: 'feature', target: 'kindle' }`; the last is `visit` `landmark:last-bridge`. Every step can be done within a week of ordinary use and none depends on a randomly placed note. Riddle Notes are in Tamsin's hand.
- `content/wilds.json`: only `notes_later.cave` changes (caves open now; its text no longer promises the Kit). `content/fortress.json`: only `constructionFrom` becomes `"Phase 5"`.
- Each trail step's `solve` is met by L2's wiring (§12.4): `feature` by `shell.feature(id)`, `visit` by Milo stepping onto the target, `examine` by an Examine of it, `read` by opening a note or tablet.

## 10. Main, IPC and the bridge (G)

### 10.1 Channels

Every handler checks `trustedSender(event)` first, returns a refusal of the same shape as success, cleans every argument in preload (types) and in main (bounds and regexes), and never throws across IPC.

| Channel | Kind | In | Out (trusted) | Untrusted |
|---|---|---|---|---|
| `milo:content` | handle | — | the bundle of §9.1 (from `electron/content.cjs`) | `null` |
| `milo:notebook-read` | handle | `id` | `{ ok: true, bytes: Uint8Array, size }` (a missing file is empty bytes) or `{ ok: false, code }` | `{ ok: false, code: 'untrusted' }` |
| `milo:notebook-append` | handle | `id, bytes: Uint8Array, at: number` | `{ ok: true, size }` or `{ ok: false, code: 'moved' \| 'too-large' \| 'bad-id' \| 'blocked' \| 'failed', size? }` | same, `'untrusted'` |
| `milo:notebook-replace` | handle | `id, bytes, { keepPrevious: boolean }` | `{ ok: true, size }` or `{ ok: false, code }` | same |
| `milo:notebook-restore` | handle | `id` | `{ ok: true, size }` (the previous file becomes current) or `{ ok: false, code: 'none' \| … }` | same |
| `milo:notebook-drop-previous` | handle | `id` | `{ ok: true }` | same |
| `milo:alarm-set` | handle | `{ id, at, title, body }` or `null` | `true` when armed or cleared | `false` |
| `milo:alarm` | main → renderer | `{ id }` | sent when the alarm rings | — |
| `milo:notify` | handle | `{ title, body, kind }` | `kind` is now `'gate-bell' \| 'alert' \| 'kindle'`; `kindle` follows `settings.kindleBell`; still never while MILO is focused | `false` |

### 10.2 `electron/notebooks.cjs`

```js
module.exports = {
  createNotebookStore({ dir /* <data>/notebooks */, fs = require('node:fs/promises'), atomicWrite, blocked = () => false }) → {
    read(id) → Promise<{ ok, bytes, size } | { ok: false, code }>,
    append(id, bytes, at) → Promise<{ ok, size } | { ok: false, code, size? }>,
    replace(id, bytes, { keepPrevious = false } = {}) → Promise<…>,
    restore(id) → Promise<…>, dropPrevious(id) → Promise<…>,
    flush() → Promise<void>      // resolves when every queued write is done
  },
  isNotebookId(id) → boolean,    // /^[a-z0-9][a-z0-9-]{0,39}$/, and not con, prn, aux, nul, com1–com9, lpt1–lpt9
  MAX_APPEND: 65536, MAX_FILE: 16 * 1024 * 1024, FRAME_HEADER: 13
}
```
- Files are `<data>/notebooks/<id>.notes` and `<id>.notes.previous`; the folder is made on first write. Main stores bytes and never interprets notes. **The file is the source of truth**; `party.roster[id].notebook.count` is only a hint the renderer reconciles on read.
- **Frames** (written by notebook.js, §7.2): `[u16 LE 0x424e][u8 version 1][u16 LE count][u32 LE crc32 of the notes][u32 LE key] + count × 24 bytes`. The `key` is the round's (`RoundRecord.key`) or a lesson's (`hashString('lesson:' + from + ':' + habit + ':' + day) >>> 0`), so a frame is never written twice. One append holds whole frames only, ≤ 64 KiB. No notebook exists on disk before Phase 4, so this 13-byte header is version 1.
- **Append:** writes per id are queued, and the renderer awaits each append before sending the next for that id. The renderer's `at` is `unframe(file).good` (the bytes through its last whole, good frame) plus what it has appended since. Main stats the file: if `size === at` it appends, fsyncs and closes; if `at < size ≤ at + MAX_APPEND`, the tail past `at` is a torn frame from a crash, so it truncates to `at` first, then appends; only `size < at` returns `moved` with the real size. Appends that would pass `MAX_FILE` return `too-large`.
- **The renderer never drops a note on its own:** before appending it skips a frame whose key equals the file's `lastKey` (a relaunch between the append and the state save); on `moved` it re-reads and retries once; on `blocked` it holds the frames (at most 20) and retries after the next successful save.
- **Replace** is for a reset only (and `restore`'s swap back); it uses `atomicWrite`, and with `keepPrevious` the old file is renamed to `.previous` first (the one a reset keeps until the next Campfire, when L2 calls `dropPrevious`). A strike-out never touches the file (it lives in `Member.notebook.struck`, COMBAT §3.3 keeps the notes), and a lesson appends.
- Every write is refused with `blocked` while main's `loadError` is set. `before-quit` awaits `Promise.all([saveQueue, notebooks.flush()])` inside the same 3 s budget. The single-instance lock is what makes append-only safe; tests use separate `MILO_DATA_DIR`s.

### 10.3 `electron/alarm.cjs`

```js
module.exports = { createAlarm({ now, notify, send, setTimer = setTimeout, clearTimer = clearTimeout }) → { set(alarm | null) → boolean, recheck() → void, dispose() → void } }
```
One slot. `set({ id, at, title, body })` arms it (replacing any other); `at ≤ now()` clears it without ringing (the renderer pays and ends phases from absolute times itself); `null` clears. When it fires: `notify({ title, body, kind: 'kindle' })` and `send('milo:alarm', { id })`. `powerMonitor`'s `resume` calls `recheck()`. The renderer re-arms it at boot and after every Kindle change from `kindle.nextAlarm(state)`. Under `MILO_TEST`, main keeps `globalThis.__miloAlarm = { id, at } | null` and appends each ring to `globalThis.__miloAlarmRings`, beside `__miloNotifications`, for ui-phase4's check 2.

### 10.4 Preload (`window.milo`)

```js
notebooks: Object.freeze({ read(id), append(id, bytes, at), replace(id, bytes, options), restore(id), dropPrevious(id) }),
    // every call resolves { ok: false, code: 'not-loaded' } until loadState() has resolved, like saveState
alarm: Object.freeze({ set(alarm), onRing(cb) → unsubscribe }),
notify({ title, body, kind })   // kind coerced to 'gate-bell' | 'alert' | 'kindle'
```
The pinned key lists in `tests/ui.mjs` become:
- `window.milo`: `alarm, architect, clock, content, finishClose, loadState, notebooks, notify, onBeforeClose, onSnapshot, saveState, scan, windowAction`;
- `window.milo.notebooks`: `append, dropPrevious, read, replace, restore`;
- `window.milo.alarm`: `onRing, set`.

G changes that assertion in the same change as preload.

### 10.5 Other main changes

- `electron/main.cjs` reads content through `content.cjs` (wave 0) and the `fallbackModel` gains the Phase 4 sections' empty values (§8), `settings.hud` and `settings.kindleBell`, so the window still opens without `model.js`. `expedition` stays out of `fallbackModel`'s section-merge list (its `{ ...base[key], ...record(value[key]) }` would turn `null` into `{}`): it's copied as saved, `null` or a record.
- `scripts/world-preview-main.cjs` reads the same manifest (wave 0), so every capture sees the Phase 4 bundle with `MILO_PREVIEW_CONTENT=1`.
- Nothing else in main changes: the CSP, the trusted-sender rule, the architect bridge and the watchers stay as they are.

## 11. The engine API (J)

`createWorld(canvas, opts)` keeps every Phase 3 option and method, and `content == null` still means the vale alone. **`engine.js` grows by wiring only (about 250 lines)**; behaviour goes in `scene-combat.js`, `anim.js`, `follow.js`, `scene-camp.js` and `scene-sky.js`.

### 11.1 The layer protocol

```js
layer = { update?(dt, t) → boolean /* still animating */, settle?() /* motion off: jump to the end */,
          ground?(target, visible, t, shadow), collect?(drawables, target, visible, t, shadow), above?(target, visible, t),
          hit?(ax, ay, t, opaque) → Entity | null, entities?(rect, t) → Entity[], hidden?(id) → boolean, dispose?() }
```
The engine calls `ground` after shadows and rings and before the y-sort, `collect` into the same drawables, and `above` after the sort and before fog and floats, in both `drawScene` and `drawElsewhere`; `update` in `tick` with the clamped `dt`; `settle` in `settleForStillness` and the motion watchdog; `dispose` in `dispose`. Layers draw only cached canvases (frozen rows through `painter.grid`), never read a clock or randomness in a draw, and tag every canvas they make (`cb:<id>`, `overlay:<kind>`, `sky`, `camp:<id>`, `landmark:<id>`, `num`).

### 11.2 New options

```js
onSceneStep = ({ x, y, scene /* 'world' | 'elsewhere' | 'cave' */, sceneId /* rift or cave id, or null */, who /* 'milo' | member id */ }) => {}
onCombatHover = (target /* null | { tile: { x, y }, unitId: string | null } */) => {}
onCombatCommand = (cmd /* { kind: 'tile' | 'unit', tile?, unitId?, shift, alt } */) => {}   // a left click in combat; pointer only, never keys
onContextMenu = ({ kind, id, entity, x, y /* CSS px */, tile }) => {}
```
`onSceneStep` fires from `setTile` for every tile step Milo or a follower takes, in every scene; `onMiloMove` is unchanged (it still never fires inside an Elsewhere, as `world.test.js` pins). `onContextMenu` comes from one canvas `contextmenu` listener (with `preventDefault`) that runs the same hit test as a click; in combat a right-click goes **only** there (never to `onCombatCommand`). The engine never handles keys in combat: the shell's key stack is their one owner (§12.1).

### 11.3 New methods

```js
setParty(members /* [{ id, look: Look, name }] in formation order; [] clears */) → void
setFormation(formation /* 'line' | 'pairs' | 'loose' | 'wedge' */) → void
partyTiles() → [{ id, x, y }]                        // 'milo' first, then followers as 'party:<memberId>'
chain(memberId, on) → boolean                        // unchain a follower (it stays put until moved) or chain it back; false when unknown
selectMember(memberId | null) → void                 // while an unchained follower is selected, a floor click or walkTo moves it instead of Milo
setSneak(on) → void                                  // sneaking: everyone walks at half speed (§4.17); off on every scene change
setMode(mode /* 'explore' | 'combat' */) → boolean   // false while `changing`
mode() → 'explore' | 'combat'
frameArena(rect /* { x, y, w, h } scene tiles */ | null) → void
  // centres the arena in the free rect left by all four insets; when it doesn't fit, the camera follows the tile cursor or the selected unit;
  // an Elsewhere's clamp allows the top and bottom insets too
hideActors(ids /* 'milo', 'party:<id>', 'stray:…' ids, 'tale-lead', 'enc:<roomId>' (a whole room's posts) or 'enc:<roomId>:<unitId>', 'tree:x,y' place ids */) → void
startCombat({ arena: Arena, units: UnitView[], objects: FightObject[], surfaces, lights, telegraphs: Telegraph[] }) → Promise<boolean>
syncCombat(view /* the same shape as startCombat's */) → void   // a resumed fight: puts every unit, object, surface, light and telegraph where the Battle says, at once
playEvents(events /* Event[] */, { speed = 1, fastFoes = true } = {}) → Promise<void>
showOverlay(overlay /* Overlay */ | null) → void
endCombat({ place /* { [unitId]: { x, y } } final tiles */ }) → Promise<void>
setSky(sky /* Sky */ | null) → void
setLandmarks(list /* [{ id, kind: 'last-bridge' | 'tollkeeper', x, y, deck, dir, label }] */) → void
setCamp(view /* CampView */ | null) → void
enterElsewhere(rift, { layout = null, fight = null /* { plan, encounters } */ } = {}) → Promise<boolean>   // without options: exactly Phase 3
enterCave(cave /* CaveSpec */, { layout, fight }) → Promise<boolean>
screenOfTile(tile) → { x, y } | null                 // CSS px of a tile's feet, for HUD popovers
playMoment(kind /* 'lantern-rise' | 'handcart' | 'tea' | 'pen' */, at /* { x, y } tile */) → Promise<void>   // level up, the wake-up, a Breather, the notebook's pen; at once with motion off
benchmark({ frames = 200, actors = 16 } = {}) → { median: number, p90: number }   // a combat frame's draw time, for J's own proof and L2's capture
UnitView = { id, side, rank, talkKind: string | null, look: Look, x, y, size, facing, name, integrity, max, buffer: number, offline: boolean,
             sorted: null | 'settled' | 'talked' | 'bowed', conditions: [{ id, n: number | null }], heat: number,
             bar: null | { phase: string, bar: number, bars: number[] } /* a lead's */ }
Overlay = { reachable?: [{ x, y }], path?: { tiles, cost, of, swipes: [{ x, y }] }, areas?: [{ tiles, kind: 'harm' | 'help', caught: string[] /* unit ids, allies included */ }],
            threats?: [{ x, y }], cover?: [{ x, y, level: 1 | 2 }], telegraphs?: Telegraph[], cursor?: { x, y },
            selected?: string, targets?: string[] }
CampView = { night: boolean, members: [{ id, look: Look, seat: number, pose: 'sit' | 'sleep' | 'talk' | 'stand', bubble: boolean }], props: string[] }
```

### 11.4 Rules the engine keeps

- **Combat is a mode, not a scene.** `setMode('combat')` stops everything (`stopEverything`, marker, hover, held keys), refuses `walkTo`, `walkToEntity`, `travelTo`, `enterElsewhere`, `enterCave`, `leaveElsewhere` and `chop` (resolving `false`, as during `changing`), stops making way, and routes the pointer to `onCombatHover` and `onCombatCommand`; it ignores keys and never calls `keyStep`, so WASD, M, A, W and the other letters are free for the HUD's handler. `startCombat` is refused while `changing`; scene changes are refused in combat.
- **Fight start and playback grouping** (`anim.js`): a fight opens with the "noticed you" swirl over the foes that saw the party (never "!", which stays for needs-you and a spotted feint), then the grid fades in; within a tick, consecutive actions by strays of one `talkKind` play as one beat (moving together, one stray-beat of time).
- **Everyone is a combatant in a fight.** Combat units draw every hero, Milo included; the engine hides its own Milo and followers while combat runs, and `endCombat` puts `milo.tile` (scene coordinates) on his unit's final tile. Inside an Elsewhere that fires nothing; in the wilds (a field boss) it fires `onMiloMove` once.
- **Hit-testing:** the entity kind `combatant` (`{ kind: 'combatant', id: 'cb:<unitId>', x, y, label, side, approach }`) comes first in **both** hit-test branches (the Elsewhere branch returns before crew), first in `nearbyEntities()`, and in `elsewhereEntities()`. Hidden actors leave hit tests and entity lists.
- **Playback** advances a clock by the tick's clamped `dt`, never absolute time and never `setTimeout`; a hidden or paused window holds it. The 80 ms hit-stop freezes that clock. With motion off `playEvents` resolves at once at the final frame, with no hit-stop and no flash. `dispose` settles every open promise.
- **Damage numbers** have their own renderer in `scene-combat.js` (`numberRows`), not `floatText`, which keeps its Phase 3 behaviour.
- **The sky** is a full-view tint drawn after the scene and before floats, with lights (the campfire, lit lanterns, bleeds' glow, the Hooklight) drawn over it at night, and weather particles in `above`. Chunk canvases are never repainted for it. `renderMap` stays untinted, and the vale-only and content worlds still give the same `renderMap` draw list.
- **Followers** walk to the tiles Milo stood on 2, 4 and 6 steps ago (per formation) at Milo's speed, are kept out of the `crew` map, are reset on every scene change, travel and entrance, snap when motion is off, and join `keepClear` as kind `'party'`. Their ids everywhere in the engine (`hideActors`, `partyTiles`, hit entities, `keepClear`) are `party:<memberId>`, so the Scribe as a follower never collides with the crew member `claude` or Jev's perch `jev`. The `keepClear` kinds with no party set stay `['campfire', 'claude', 'codex', 'jev', 'milo']`. An unchained follower stays where it was left until it's moved or chained back; every scene change chains everyone.
- **The camp** is a vale layer at the fire. `MAP.slots` gains a new key `camp4` (8 bedroll seats round the fire); `campfire` stays 5 seats and its length pin holds. Crew already sat by `setCrew` keep their seats; the camp layer skips them.
- **Encounters** inside an Elsewhere or cave: `scene.encounters`' foes idle at their posts (never wandering) as a scene layer, with actor ids `enc:<roomId>:<unitId>` (a post's `unitId` repeats across rooms), hidden with `hideActors(['enc:<roomId>'])` when their fight starts; Phase 3's wandering strays stay as they are.
- **Caves** are scenes with the same interface `createElsewhereScene` returns (`scene-elsewhere.js`, its return object), built with `kind: 'cave'` (stone colours, no stitch). `elsewhere()` reports `{ riftId: null, caveId, depth, name }` and `area()` says `'elsewhere'` with `cave: true`.
- **Field bosses:** `scene-rifts.js` swaps the gaping tier-5+ lead's `positionAt` for `fieldboss.leadRoam(...)`'s and draws `sightRing` softly; `riftfx.js`'s wild lead actor takes its name from `leadDisplayName` (J, wave 2); the Elsewhere's lead object already does (D, wave 1). Sight never starts anything in the wilds.
- **Budgets:** a combat frame with 16 actors ≤ 12 ms at 1280×820 (J proves it with `world.benchmark` in `scripts/world-preview.html`, and L2's `scripts/capture-combat.mjs perf` repeats it in the app); the sky tint ≤ 0.3 ms a frame; weather ≤ 1 ms; nothing new runs in `tick` for the sight check.
- **Fit:** a 12×9 lead arena plus the combat HUD fits at 3× at 1280×820 (COMBAT §14.1); smaller windows and larger arenas follow the cursor (`frameArena`).

## 12. The shell and the UI modules

### 12.1 DOM and keys

New containers, all **after `#map-view`** in `index.html` (so nothing focusable comes before `#bubble`), fixed-positioned, with `.titlebar-slot` spacers where they sit in the title bar:

| Id | What | Owner of its contents |
|---|---|---|
| `#wallet` | a title-bar button: the Ember balance | K1 `wallet.js` |
| `#kindle-orb` | a title-bar button: the focus timer | K1 `kindle-view.js` |
| `#hud` | the Adventure HUD: minimap orbs and `nav#side-tabs` | K1 `hud.js` |
| `#log` | `section.px`: tabs, `ol[aria-live=polite]`, `input#command`; fixed at right 14 px, bottom 18 px, width `min(360px, 34vw)`, height ≤ 30vh, z 5 | K1 `log.js` |
| `#context-menu` | `div.px[role=menu]`, z 13 | K1 `menus.js` |
| `#combat-hud` | the ribbon (top), the planner (bottom), the cards | K2 `combat-hud.js`, `planner.js` |

`html[data-hud="adventure" | "quiet"]`, `html[data-focus]` (a focus session dims the Adventure HUD), `#stage[data-mode="explore" | "combat"]` (combat folds the minimap to its orbs, collapses the side tabs and hides the tracker). The 1000×700 fit holds for every new overlay, and every control shows a focus ring. **Nothing new overlaps Phase 3's `.places`** (left 14 px, bottom 18 px, z 6) or the area its list pops up into: the Log sits bottom-right, and in combat the planner sits bottom-centre, leaving a 220 px column on the left clear (the place list becomes the combatant list there).

**Keys.** The shell gains a capture-phase key stack (`shell.keys.push(handler) → pop`); the top handler sees keys first and returns `true` to consume. The context menu, then the combat HUD, then the command bar push handlers while open. In combat the stack is the **only** keyboard owner (the engine forwards the pointer alone, §11.2). Every handler ignores keys while `isTyping()` (so `input#command` gets its letters and digits), and the combat handler leaves Enter and Space alone when a button or select inside `#combat-hud` has focus (native activation), and never takes Tab (focus moves as usual, so focus rings and `assertFocusRings` hold). Escape order is: context menu, a combat slot or popover, the map, the bubble, the panel. The document's **M** (map) ignores keys while in combat or typing. In combat (COMBAT §13, with one change, §17): **[** and **]** cycle targets and slots, arrows move a tile cursor, Enter confirms or accepts the selected draft, Shift+Enter accepts every draft, Esc goes back, 1–9 and 0 pick from the bar, M moves, Backspace clears a slot, Y shows why, Space runs (and takes the company back from *Let them handle it*), P pauses, G toggles Guided, W wraps up when offered, A hands the company over, ? shows the keys.

### 12.2 The shell context object (L, in `app.js`)

```js
shell = {
  get state(), set(next, { save = 150 } = {}) → boolean,   // false when next === state
  now() /* clockNow */, motion(), content(), snapshot(), area(), phase4 /* phase4Problem's result */,
  world(method, ...args) → any,                            // worldCall; a calm no-op without a world
  bubble(message), log(entry /* LogEntry */),
  openPanel(id, opts), closePanel(), refreshPanel(opts),
  registerPanel(prefix, { title(id), render(id), exists(id), action(button, id) → boolean }),   // consulted before the Phase 1–3 switches
  on(event /* 'state' | 'snapshot' | 'area' | 'second' | 'kindle' | 'combat' | 'hud' */, fn) → off,
  keys: { push(handler) → pop },
  insets(name, rect /* CSS px */ | null),                  // feeds world.setInsets (bottom included), bubble avoid and the tip keep-out
  esc, face(id, size), miloSays(text),
  travel(target), leaveElsewhere(), feature(featureId),   // feature() records a first use in tally.features and marks a trail step
  status(source /* 'kindle' | … */, text | null),         // a line for #titlebar-status; summarizeStatus (app.js) owns the element and shows it first
  bridge: { notebooks, alarm, notify },
  settings: { get(key), set(key, value) }
}
LogEntry = { tab: 'crew' | 'milo' | 'world' | 'combat', text: string /* ≤ 120 */, at: number, detail: string[] | null, action: null | { id, label } }
```
Every bubble also goes to the Log (one sink). `'second'` fires once a second only while the window is visible.

### 12.3 The UI module interface

```js
// src/ui/<name>.js
export const id = '<name>';
export function build<Thing>(view) → string       // pure, deterministic HTML; every value esc()'d; tested in Node
export function mount(shell) → { dispose(), refresh?(reason) }
```
- `mount` never throws (it catches and `console.error`s), returns a no-op handle when its container is missing, and touches only its own container and panels it registers.
- Modules import only pure modules and never `app.js`. They reach everything else through `shell`.
- Builders are deterministic: no `Date.now()`, no random ids. Per-second text (Kindle's countdown, playback) lives outside `#panel` and updates text nodes in place.
- Panels use `registerPanel` with ids that pass `cleanId` and don't shadow `rift:`, `lantern:` or `poi:`: `chronicle`, `kindle`, `skills`, `trail`, `satchel`, `muster`, `camp-fire`, `company:<id>`, `notebook:<id>`, `levelup:<id>`, `talk:<id>`, `cave:<x>,<y>`.
- Buttons use `data-action="<module>-<verb>"` with `data-focus-key`, and confirms are `.confirm[role=alertdialog]` with the safe button focused first.

### 12.4 The modules

**K1, groundwork UI:**
- `log.js`: `buildLog(view)`, tabs All, Crew, Milo, World (and Combat in a fight), newest 200 lines in memory, a line expands to its `detail`. The command bar handles Enter on the input (the CSP forbids form submits), runs `commands.parseCommand` and dispatches each intent to the same function a button would call; anything that reaches the architect goes through its existing gate. `#places-toggle` stays where it is in the DOM.
- `menus.js`: `optionsFor(target, ctx) → [{ id, label, disabled, why }]`, the left-click default first and **Examine last**; greyed field skills name who could ("Pick lock (the Artificer, at camp)"). Opened by the canvas's `onContextMenu`, the ContextMenu key or Shift+F10 on crew chips, place-list buttons, rift rows, Log lines and combatants. The hover tip reads `${first.label} / ${n} more options`.
- `examine.js`: `examineKey(entity) → { group, id, variant }` and `examineLine(entity, { content, state, now, sky }) → string` with `wildtext.pickLine`; an Examine opens a `note` bubble. Combatants use `describe.examineLine`.
- `wallet.js`: `buildWallet(walletView)`; opens `chronicle`.
- `chronicle-view.js`: `buildChronicle(view)`: today, this week (Starfall's shape), the ledger with every Ember's source, fight summaries, and "Show more".
- `kindle-view.js`: `buildKindle(view)`; start, stop, rest; its line for the title-bar status through `shell.status('kindle', …)` (first in Quiet mode); `html[data-focus]`; bubbles at phase ends; arms `shell.bridge.alarm`.
- `hud.js`: `buildHud(view)`: Adventure (a 96×96 minimap from `world.paintMapChunk` at most once a second while visible, the Embers, Mana and Focus orbs, and the side tabs) and Quiet (today's overlay). `::quiet` and `::adventure` switch it. The tabs and what they open: Skills → `skills`; Quests → `trail` (the Riddle Note trail; companions' quests "arrive in Phase 5"); Satchel → `satchel`; Company → `company:<first chosen, else milo>`; Grimoire → a line saying it arrives in Phase 5; Crew → the Log's Crew tab; Chronicle → `chronicle`; Settings → the camp panel's Settings section (Phase 3's, plus `kindleBell` and `hud`). Inside an Elsewhere or cave the HUD also shows a **Sneak** toggle (`data-action="hud-sneak"`), which L2 turns into `world.setSneak`.
- `skills-view.js`: `buildSkills(view)`: the 24 skills with levels and guides; XP drops through `world.floatText` (at most one a second); a level-up bubble ("Cartography is level 5."). The camp panel's "Skills" heading becomes “Milo’s Arts” (L).
- `trail-view.js`: `buildTrail(view /* trail.trailView */)` for panel `trail`, reusing Phase 3's `panels.trackerCard` for the note: its riddle in Tamsin's hand, its sign, the hint once asked for, and the steps done.
- `satchel-view.js`: `buildSatchel(view)` for panel `satchel`: Marks, tonics, essences, relics and materials, read-only.
- `chronicle-view.js` also lists the day's `xpLines` ("Focus 1,000: focus session 09:10–10:00").

**K2, company UI:**
- `combat-hud.js`: `buildHudView(battle, roundView, ui, ctx) → HudView` (pure) and `createCombatHud(root, { onCommand, onHover }) → { show(view), update(view), dispose() }`, which updates cells in place and never rebuilds `innerHTML` per tick. The ribbon (allies on circles, foes on dashed diamonds, neutrals on squares; ◂ on the actor; "tick 2 of 3"), portraits (Integrity notched every 10 with numbers, Buffer, conditions with numbers, charges as ✦, a sustained-spell flame, the control badge, and each hero's heat gauge: a thermometer with its number), a stray's bar with its check segments (a lead's phases), calm pips beside each kind's telegraphs, the noise banner, Cheers, playback 1×/2×/4×, and the cards: victory (with Breather and the room's pay), bow, the wake card ("Everyone went offline. Everyone’s fine." with **Try again** and **Go home**) and a real rift's yield card with **Stitch** (opens that rift's panel, where its real cause and Phase 3's actions are), **Ward** and **Let go** (**Decided**: no *Send the crew* until Phase 6's commissions).
  `ui = { selected: string | null, slot: number | null, cursor: { x, y } | null, hover: string | null, popover: null | 'odds' | 'why' | 'rules', odds: 'bars' | 'words', playback: 1 | 2 | 4 }`; `HudView = { ribbon, portraits, telegraphs, calm, noise, cheers, playback, card, planner /* planner.js's view */, live: string /* the aria-live line */ }`.
- `planner.js`: `buildPlanner(view)`: three slots per hero (four when Quickened), each draft's confidence (dashed under 50%), sync and **why?**, the odds popover (bars or words, with amounts and "?", and "could change" when `changeable`), the likeliest trouble under a slot (`driver.roundView().trouble`), an area slot's list of everyone it would catch, allies included, reactions' Ask, Always, Under half and Never, a Cheer per slot, undo back to the round's start, and a **Playbook** popover to edit a companion's rules between rounds (`party.setRules`, up to `maxRules`). Drafts are read out for screen readers with their confidence and why (`describe.draftReadout`).
- `company-view.js`: `buildCompany(view)` for panel `company:<id>`: a companion's character sheet (calling, level, path, boons, warmth, reactions set through `party.setReaction`, a link to their notebook page), with the camp's swaps when at camp: `swapPath`, `swapBoon` and the Scribe's `preparePages`.
- `dialogue.js`: `buildDialogue(view /* { speaker, face, lines, choices, more: boolean } */)`: PLAN §4's dialogue box with a chat-head portrait and "Click to continue"; camp scenes and `talk:<id>` panels render through it.
- `combatants.js`: `buildCombatants(view)`: in a fight `#place-list` lists `cb:<id>` entries first, labelled with `describe.combatantLabel`; activating one selects it as the target (never walks).
- `muster.js`: `buildMuster(view)` for panel `muster` (Setting out), opened from the campfire, `::muster`, a lit lantern's panel or an Elsewhere's doorway (anywhere else it shows who's out, without swapping): portraits, calling, level, warmth, field skill, sync, mood, "Claude is working on ‘MILO plan’. Her likeness will go.", Milo's suggestion, **Same as last time** (the default), formation, mode and the calm settings (a `data-calm` handler, not `data-setting`).
- `camp-view.js`: `buildCamp(view)` for panel `camp-fire`: who's at the fire (`camp.campDay`), arrival scenes, `talk:<id>` panels (choices greyed with their requirement), and teaching at the fire once a night.
- `notebook-view.js`: `buildNotebookPage(view)` for `notebook:<id>`: "Trained on N of your fights · sync N%", habits strongest first with counts, **Strike out**, **Teach**, **Reset** (confirm: "Start Rivet’s notebook fresh? He’ll play on instinct until he learns you again."), and playbook rules as if/then selects.
- `levelup.js`: `buildLevelUp(view)` for `levelup:<id>` and a `levelup` bubble kind; path, boon and Pages choices, never during a fight.
- `panelart.js` (K2, wave 2): `rowsScene(rows, { layers, table2, scale })` and `portraitScene(look, { genre })` for portraits.

**L, the fight in the shell:**
- `src/ui/fight.js`: `createFight(shell, { ctx, loadNotebook }) → { start(entry), resume(expedition), pause(reason), command(cmd), dispose() }`, pure `sightCheck(rooms, tiles, { lightAt, walls }) → roomId | null`, and pure `sneakOdds(room, partyTiles, { lightAt, rules }) → Odds` (B's `sneakCheck`, shown on hover while sneaking). It builds `ctx` (including `ctx.party` from the companion files and regulars.json) and `createBattle`'s options (`roadLevel`, `warding`, `memory` from `strays.genreMemory`, `talk` from doorway Talk downs, `placement` from *Set the ambush*). It runs the driver: plans from the HUD, `commit`, then `step` → `world.playEvents` → `scheduleSave(150)` after each action, saving `saveBattle(battle)`, pausing at the next action boundary for a focus session starting or a rest ending ("The fight will keep. Back at your next rest."). **At each commit** it learns from the record `commit` returns: `party.noteAccepts`, `notebook.learn` → `frame(notes, record.key)` → `bridge.notebooks.append` (with §10.2's skip and retries), and `notebook.fights` rises once per fight that taught a note. After the fight: `party.afterFight`, `party.payFight`, `chronicle.noteFight`, `strays.rememberHabits`, `world.endCombat`. The creep-past rule (§4.17) is here: while Unseen, a room of only sleepy or lost strays doesn't start.
- `src/ui/expedition.js`: every door: `stepThrough` and `goDeeper` (wild, rung, real, story), `enterCave`, `challenge` (field boss), with `embers.spend` after the still-standing check and before entering (a story rift costs 0), the free re-entry after a wake, **Try again** and **Go home**, and boot's resume (rebuild the place from `expedition.source`, never the live signal, re-enter, `restoreBattle(save, ctx, { fight, heroes })` with `partySpecs(…, { levels: save.levels })`, then `world.syncCombat`, landing on the saved tick). It creates, keeps and clears `state.expedition` by §4.18's life. A real rift whose cause was fixed while a fight was paused ends with the `end` command: "The seam closed while you were away." It also exports `fieldSkill(state, skill /* 'light' | 'read' | 'pick' | 'sort' | 'riddle' */, target, now, { content }) → { state, words, fight: FightSpec | null }`: Light lights a lantern (Milo), Read gives a ruin's or statue's `read` line (the Scribe), Pick opens a cave's locked chest (the Artificer), Sort says whether a chest is a Mimic (Jev), Riddle settles a Tollman or answers the riddle board (the Tollkeeper); each needs that companion in the party. Opening a Mimic chest returns its `mimic.fight`, which starts at once with the party where it stands (after *Sort* the chest says so first).
- `src/ui/frontier.js`: `runRiftLoop` also runs `tallyAnswered`, `payFromSignals`, `payLifeFromSignals`, `topUpCrewGifts` and `party.payRealStitches`, as pure passes, and clears `state.expedition` when its place has closed (§4.18); `elsewhereEntries` lists combatants first in a fight; `elsewhereLandmarks` takes `{ plan }` and lists the nook, and names the lead through `leadDisplayName` (line 499); `LANDMARK_ORDER` gains `nook`; `riftActions` gains **Challenge** for field bosses; caves get their panel action (L1 passes `phase4World` to `poiView`); the rift panel and the War Table show suggested levels ("Runs at level 5. Your company is level 3 (4 on average, with the Scribe).").
- `fight.js` also pays Spellcraft from the fight's `act` events (5 a knack, 40 × circle a spell), offers a regular's invitation after a bow (`party.inviteRegular` with `gentlestStray` or the lead), sets `party.outing.freeBreather` when a focus session finishes while a fight is live (otherwise `party.breather(state, now, { free: true, where: 'focus' })`), and asks once after the evening bell before a fight starts.
- **L2's wiring in `app.js`** (each by name, so none is left without a caller):
  - `world.setParty` and `setFormation` on setting out and on every swap; `world.setSky(sky.skyAt(…))` on `'second'` whenever `sky.key` changes; `world.setCamp` from `camp.campDay` when the camp is on screen; `world.setLandmarks` at boot (the Last Bridge and the Tollkeeper at `stand`); `world.playMoment('lantern-rise')` on a level-up and `'pen'` after a round with changes.
  - `embers.chartChunks` in place of both `markExplored` calls (app.js:2475, and the ruin tablets at :3570 with `free: true`), keeping a `pendingCharts` set of skipped keys that it charts again whenever the balance rises.
  - `stitchInside` (app.js:3447) calls `party.payStitch({ kind: 'wild', … })` and offers a regular's invitation (`inviteRegular` with `gentlestStray`).
  - `bridge.notebooks.dropPrevious` for every notebook on a Campfire; a lesson at the fire appends (`teachNotes` → `frame` → `append`).
  - The trail: the first wild chest after Phase 4 lands (and after `first-crack`) hands out the note (`story.trails`), and `trail.stepDone` runs on `shell.feature`, `onSceneStep` visits, Examines and reads; the Tollkeeper at the bridge is a `landmark:tollkeeper` entity whose activation opens `talk:tollkeeper-riddles`, whose `[join]` calls `party.recruit`.
  - The combatant list: `renderPlaces` uses `buildCombatants` in a fight, with its cap raised to 16 plus landmarks (`NEARBY_MAX` is 12 outside fights); `goToEntity('cb:…')` selects the target and never walks; `KIND_WORDS` and `handleEntity` gain `combatant`, `nook` and `landmark`.
  - A portrait click unchains that follower (`world.chain(id, false)`, then `selectMember`); a double-click on Milo chains everyone back.
  - `summarizeStatus` takes Kindle's line through `shell.status`; the lead's name at app.js:2699 and :2942 goes through `leadDisplayName`; the Westwatch's night comes from `sky.isNight(now, { sky })`.

### 12.5 Copy the player reads (pinned)

"Everyone went offline. Everyone’s fine." · "Courier." (Toby) · "You worked. They sat down for a bit." · "The fight will keep. Back at your next rest." · "It’s late. Start anyway?" · "The seam closed while you were away." · "Can I sit by the fire a while?" · "Another time, then." · "That needs 5 Embers. You have 3." · Examine for the Hooklight: “Lit from the Hook. The big one stays home, so home stays safe.” ("Out with Milo. The board still works." waits for Phase 5's board, and "The Hold’s up. Everyone feels it." for tier 3, which Phase 4 never reaches.)

## 13. Modules, waves and deliverables

Waves run in order; modules within a wave run in parallel and never talk to each other. Each module's final message lists the exact APIs it shipped (with any difference from this contract), the tests it added, the pinned tests it changed and why, and anything it couldn't do. After each wave the orchestrator writes §18's refinements from those reports, and the next wave reads §18 first.

### Wave 0: the baseline (module 0, one agent, before anyone edits riftgen, elsewhere, worldgen, straygen or sprites)

- **Creates** `tests/fixtures/make-golden.mjs`, `tests/fixtures/phase3-golden.json`, `tests/golden.test.js`, `tests/calm.js`, `tests/fakedom.js`, `tests/ui-helpers.mjs`, `electron/content.cjs`, `src/content4.js` (a stub: every area reports its files missing), `tests/content-manifest.test.js`, `tests/imports.test.js` (§2's import-graph test over every file Phase 4 creates in §14's table, skipping files not yet written, plus the rule that those files never import `src/model.js`, `src/hearth.js` or `src/rifts.js`).
- **Edits** `tests/world.test.js` (imports `manualClock`, `fakeDom`, `flush`, `drive` and `testSpec` from `tests/fakedom.js`; nothing else changes), `tests/ui.mjs` (imports its helpers from `tests/ui-helpers.mjs`; the same 47 checks in the same order), `electron/main.cjs` (reads content through `content.cjs`), `scripts/world-preview-main.cjs` (the same), `package.json` (§16.1's scripts).
- **Golden fixtures** (§16.2) are generated from HEAD and committed as a test before any wave 1 work starts.
- **`tests/calm.js`** exports `assertCalm(text, where, { proper } = {})` (content.test.js's strict rules), `assertTitle`, `assertName` (allows inner full stops: "Built. Tests pass."), `assertFragment`, `assertGesture` (a parenthetical stage direction), `strings(value, path)`, `lines(list, where, { min = 3, max = 140 } = {})`, `DENYLIST` (COMBAT §16.4's other-games terms, with Faerun and Honor variants), `COSY` (die, dies, died, dead, death, kill, killed, slain, slay, wiped, blood, murder), `loreIndex()` (LORE §21 parsed into normalised names by group), `normaliseName(name)` (strips `*`, a trailing parenthetical, a leading the/a/an, curly/straight apostrophes, case), `PROPER` (every capitalised word in the index plus Chris, Milo, MILO, Claude, Codex, the days and months, and Phase 4's UI words: Embers, Kindle, Chronicle, Road, Log, Adventure, Quiet, Command, Guided, Storybook), and `ECHOES` (Hearth, Stonewright, High Noon, Case File, Afterhours, Quiet Order).
- **`tests/ui-helpers.mjs`** exports `createUiKit({ repo, environment }) → { launch, close, poll, check, scan, savedState, bubble, panel, settle, openPlace, dismissBubbles, waitForScanWhere, area, closePanelNow, openPlacesList, activeName, stepKeys, listEntry, assertFocusKept, travelHome, fitsAt1000, assertFocusRings, standingAt, wildsPlan, get application(), get window(), get completed() }` and `makeRoot(prefix) → { root, data, claudeHome, codexHome, projects, environment }`.
- **Proof:** all 527 unit tests and 47 Electron checks still pass; `tests/golden.test.js` passes on the untouched tree; the content bundle's five Phase 3 keys are deep-equal to the old reader's.

### Wave 1 (parallel)

**A. Groundwork core.** Creates `src/clean.js`, `src/state4.js`, `src/embers.js`, `src/chronicle.js`, `src/kindle.js`, `src/lifeskills.js`, `src/commands.js`, `src/sky.js`, `content/skills.json`, `content/xp.json`, `content/economy.json`, `content/spells.json`, `content/sky.json`; tests `tests/state4.test.js`, `tests/embers.test.js`, `tests/kindle.test.js`, `tests/chronicle.test.js`, `tests/lifeskills.test.js`, `tests/commands.test.js`, `tests/sky.test.js`. Edits `src/model.js` (§8: `KNOWN_KEYS`, `createState`, `normalize`, the imports from `clean.js`, `tallyFinished`'s `byCrew`, new `tallyAnswered`, re-exports of `state4.js`'s `markFeature` and `markFact`, `settings.hud`, `settings.kindleBell`, `satchel.marks` and `tonics`, `story.trails` and `facts`), `src/hearth.js` (`focus-sessions` counts `tally.focusSessions`; its future note goes; `toTime` now comes from `clean.js`), `src/skills.js` (adds `ARTS` and `evaluateArts` aliases; nothing else), `tests/core.test.js` and `tests/rifts.test.js` (only the pins §8 changes on purpose: the `createState` key list, the five-key `tally`, the capped-state size fixture, the `focus-sessions` future note).
- `embers.js` also exports `chartChunks(state, keys, now, { economy, xp, free = false }) → { state, charted: string[], skipped: string[] }`: a chunk that touches the heart, or was already explored, is free; otherwise it costs 1 Ember and pays 40 Cartography, and with an empty wallet it's skipped (left unexplored); with `free` it charts at no cost and pays nothing.
- Proofs: each payment happens once, across a normalise-and-reload; the cap holds and lifetime counts every Ember earned, past the cap; the backlog pays once as one entry (with an `n` past 100); daily caps count Embers, reset at local midnight, and forfeit the excess (8 sessions in a day pay 10, and the next day pays nothing for them); spends refuse calmly, and a story rift costs 0; a 50/15 cycle under a moving clock pays 10 and 5 once each, survives a "relaunch" (normalise the saved state at later times), and a broken rest pays nothing; every life-XP source pays its rate once (a crew session 100 Command, a needs-you answered within 15 minutes 100 Command and a slower one none, a first design 1,000 Artifice, a focus session 1,000 Focus, an honoured rest 400 Hearthkeeping), each writing its `xpLines` entry; `chartChunks` is free on the heart and on explored chunks, spends 1 and pays 40 otherwise, skips on an empty wallet, and charges nothing with `free`; a source scan finds `embers.earn` called only from `payFromSignals` and `kindleTick`; the curve gives 13,034,431 at 99; the state junk loop and hostile keys at every level; idempotence through JSON; Phase 4's sections ≤ 400 KB at caps with a capped `BattleSave`, and the whole capped state (Phase 3's full caps included) < 1.6 MiB; `payFromSignals`, `kindleTick` and `tallyAnswered` ≤ 1 ms.

**B. The combat kernel.** Creates `src/combat/heat.js`, `rules.js`, `grid.js`, `effects.js`, `abilities.js`, `battle.js`, `round.js`, `driver.js`, `describe.js`, `content/combat/rules.json`; tests `tests/combat-heat.test.js`, `combat-grid.test.js`, `combat-rules.test.js`, `combat-effects.test.js`, `combat-battle.test.js`, `combat-round.test.js`, `combat-driver.test.js`, `combat-honesty.test.js`, `combat-describe.test.js`, `combat-content.test.js`.
- Delivers §5, §6 and §7.1 whole: every verb, predicate, trigger, rule id and device template; every condition and surface; what every lead shares (bars, phases, plot armour, the real rift's yield, the bow's end) and the bare lead; every hook of §6.6 called at its point; genre noise; modes; reactions and Asks; Cheers; Sneak and surprise; *Head home*; *Wrap it up*; lights; `saveBattle` and `restoreBattle`; thought bubbles and barks.
- Its tests use fixed level-1 blocks (Milo, the Scribe and the Artificer against three strays) and a stub `Minds`, built inside the tests.
- Proofs (4.1a): 1,000 seeded 3v3 fights end within 10 rounds with no stuck state; replaying the commands equals the saved battle (a property test over 500 seeds, with stub minds and with an empty notebook's drafts); `restoreBattle(saveBattle(b))` deep-equals `b` at random points over 500 seeds; the odds shown equal the odds used (§5.7) within 0.5 points per bar over 100,000 seeded samples; a *Try again* gets different outcomes; the band table, §4.2's reference table cell for cell from the rule, the attack penalty (light only for light-weapon Strikes and Throws; reactions and Asides never counted; a `split` ability one attack), drift, Cool down and room heat from round 2, and the expected multipliers 0.95, 0.975 and 1.025; the Integrity and damage lines match §4; `rules.json` equals §4 and the conditions and surfaces equal B's transcription of COMBAT; the time-to-down targets (§4.10); `damageSteps` in §4.8's order as a table test, and Buffer as a pool; movement costs as a `reachable` table test (diagonals, difficult, steps up, stairs); the save at caps is ≤ 49,152 bytes; `apply` ≤ 1 ms and reachable tiles ≤ 2 ms (median); Log copy passes `assertCalm` and `COSY`.
- **COMBAT §3.7's round, scripted:** Milo, the Scribe (Shoulder on Always) and Pip (a level-1 Weaver at 45 heat, standard weapon, Warp) against a level-1 curious crawler (20 Integrity, resists Static 3, weak to Warp 3), with that section's plans and seeds that force its outcomes, gives its bars (Warm 15 / 60 / 15 / 10, then Hot 20 / 35 / 15 / 30), its damage (10, then a Critical for 17), the Buffer of 4 soaking the Graze of 3, and the beetle sorted in tick 3.
- **Named proofs for the rest of B:** each condition's effect, how it ends, and how it lands on a Critical and on a Graze; each surface's effect and its reactions with damage kinds (and slippery tiles safe to step onto, floaters and fliers unaffected, growth at level 4); Parting swipe, Shoulder (lending the pool), Ready (gated at Warding 10, each `READY_TRIGGERS` entry, lost when it doesn't fire), Asks, and every reaction setting including Under half; cover 0, 1, 2 and blocked by §4.17's rule, a higher attacker seeing over low cover, height steps and falls at the room's level, darksight and Dark's −1; hazard props bursting on a Light hit; the Hooklight (lit radius, dropping on Offline, Tumbled or asleep, `raise-lantern`, revealing Unseen foes, ghosts losing Plain resistance, +1 edge on shadow foes inside, never spoiling the party's hiding); each of the nine noise rules, per-actor independence, and noise never delaying a Reboot or a patch on an ally under ¼; a mode switch changing nothing before the next round's start, and creation's row-ratio scaling; sustained spells ending in each of their four ways; each device template and each §6.5 rule id; items and gifts used up through `consumes`; `take`; `spawnFoe` and the `spawn` and `gone` events; *Head home* at the end of the tick; *Wrap it up* only when `canWrap`; the `end` command; a doorway `talk` and a `placement`; the calm reset on any harmful outcome; a thought bubble only on a drafted, unchanged slot, and at most one bark a round.

**C. Party and camp core.** Creates `src/party.js`, `src/camp.js`, `content/party/companions/*.json` (all fifteen), `content/party/regulars.json`, `teamups.json`, `banter.json`, `content/combat/callings.json`, `content/combat/spells.json`, `content/camp/scenes.json`, `content/camp/talks/*.md` (`tollkeeper-riddles.md`, `first-night.md`); tests `tests/party.test.js`, `tests/camp.test.js`, `tests/content-party.test.js`.
- Proofs: Milo's Integrity is 18 at level 1 and 64 at 5; every calling table validates; every Wayfarer feature to level 12 has a unit test on `heroSpec`; charges and circles match §4.12; the table test of every shipped spell, feature, weapon art and item against COMBAT §5.4 and §6 (§9.4), and that no item, spell, move, feature or foe ability shares an id; the Road level caps by the Hearth and XP past the cap counts when it rises; levels never drop; warmth never falls, outings pay once per outing and cap at +6 a local-Monday week, a habit pays +1 on its day, and nothing notifies; a likeness has identical stats and the same notebook; a Wayfarer's fighting level is never below their work level, and Jev fights at the Road level; a fight id pays once (after a restore or a *Try again*), and so does a wild stitch's key and each real stitch past `road.stitchedThrough`; Road XP and Marks floor once (Low for three heroes at n = 1); auto modes pay in full; everyone offline spends nothing and loses nothing; letting a rift go re-offers its invitation (a later stitch of the same genre asks again), and `gentlestStray` follows §4.6's order; the regulars' room follows the tier ("Another time, then." when full); a second Breather for the same fight is refused and a lantern rest counts toward the Campfire's limit; a free Breather while a fight is live waits for `afterFight`; `maxRules` gives 1, 3 and 6 at Warding 0, 15 and 50 and `setRules` refuses past it; `swapPath`, `swapBoon` and `preparePages` (Wit + level) at camp only; `afterFight` writes carry back to the satchel and gifts; strike-out stops at 40 and never un-strikes; every ability passes B's `validateAbility` (until B lands, C checks against §6's lists and says so); Jev never speaks anywhere; every name is in LORE §21 or C's pending list; the talk parser rejects `Jev:`, every path through `tollkeeper-riddles` reaches `[join: tollkeeper]`, and `[likes]` gives one Cheer; each companion's camp scene waits for Acquaintance.

**D. Encounters.** Edits `src/world/riftgen.js` (`roomRects` only) and `src/world/elsewhere.js` (the `fight`, `hooks` and `kind: 'cave'` options only); creates `src/world/arena.js`, `src/world/leadname.js`, `src/combat/bestiary.js`, `src/combat/encounters.js`, `content/combat/leads.json`, `content/combat/foes.json`; tests `tests/arena.test.js`, `tests/encounters.test.js`, `tests/bestiary.test.js`, `tests/content-foes.test.js`.
- Proofs: the golden layouts and scenes are byte-identical (ignoring `roomRects` and the lead's display name, §16.2); `roomRects` never overlap and the lead rect holds B, S and the footprint; over 500 seeds the arena pass keeps every wall face (every wall with floor directly south of it stays a wall), never merges rooms, never cuts reachability to E, B, S, P or L, and never puts the lead's footprint on the stitch point; budgets and caps hold per stage and party size 1–4 (a lead's cost scaled by `share`, so it fits even with one hero); bright and Backhalls leads never fight; the level-5 elite walker (95, 14), the open lead (63 before `xInt`, 11) and the lackeys (10, 38, 80 and 4, 9, 15) come out exactly, by §4.9's pipelines; specs are mode-free; no fought lead shares a company name unless hooked; arena rects are the room plus 2 tiles into each mouth; `leads.json` has 39 mechanics in riftgen's order with its exact text, eight shipped and seven no-fight; every foes.json and rules.json ability id resolves; `prepareCave` is deterministic with one Mimic and one locked chest; no field-skill object sits on the only path to the stitch point, the nook or any room (500 seeds); every cave region resolves to a list; `prepareElsewhere` ≤ 8 ms median.

**E. World additions.** Creates `src/world/caves.js`, `src/world/fieldboss.js`, `src/world/trail.js`, `content/examine.json`, `content/trails.json`; edits `content/wilds.json` (`notes_later.cave` only), `content/fortress.json` (`constructionFrom` only), `src/ui/wildtext.js` (the cave case only), `tests/content.test.js` and `tests/shell.test.js` (only the pins those edits change); tests `tests/caves.test.js`, `tests/fieldboss.test.js`, `tests/trail.test.js`, `tests/content-world.test.js`.
- Proofs: caves are deterministic from the seed, with the tier of their tile and a region; a field boss roams only inside its bleed, off the tear, still at `null`, and its arena is a 16×12 window inside the bleed that never writes `felled`; `lastBridge` is deterministic over 50 seeds, never on a road tile unless `dry`, its `stand` tile reachable from the vale by `nav` in hops ≤ 60; the no-POI-on-bridges rule is re-run over `fixedPois()` plus the Last Bridge with **a named exemption, `landmark:last-bridge`**, for its deck only; worldgen's golden chunks are unchanged; `examine.json` holds at least 150 lines, every row of §9.12's `examineKey` table resolves to lines, and ruins and statues have `read` lines; every trail step's kind and target resolve against `STEP_KINDS`, `FEATURES` and real places; `poiView`'s cave action appears only with `phase4World`.

**F. Art.** Creates `src/world/sprites-party.js`, `src/world/party/coat.js`, `robe.js`, `jev.js`, `toll.js`, `src/world/icons.js`, `src/world/fx.js`, `src/world/props4.js`, `content/combat/anims.json`, `scripts/capture-anims.mjs`, `tests/art4.test.js`; edits `src/world/straygen.js` (pose, frame, size, memo, `restFeet`), `src/world/riftfx.js` (`outfitGrid`'s third argument, `leadSprite`'s `parts`), `src/world/scene-art.js` (`numberRows`, `dissolve`'s layers).
- Delivers waves A0–A2's hand frames (about 150): the coat and robe rigs' key poses, Milo's *Scarf*, *Raise the lantern* and Wayward step, the Scribe's and the Artificer's overlays, the likeness recolours, Jev (about 12), the Tollkeeper (about 15, with a 36×34 fight frame and 20×26 exploration frames), the 96 stray pose specs, 8 genre flourishes, the effect primitives and the first spells' effect data, projectiles and impacts, numbers, 16 surfaces' tiles, heat shimmer, the Reboot clip, the notebook's pen, the "noticed you" swirl, camp props (handcart, Breather tea, paper lantern, bedrolls), the Last Bridge, genre props (§7.8's list) and mechanic props (a frame per state, `clue` included), the six device frames, Jev's two thought pictures, and 22 condition icons.
- Proofs: palette keys only (the 38 stay pinned); every frame's size and feet match its rig; every clip has a still frame; `outfitGrid` with a split or wear mask dresses the coat and not a held lantern, and the two-argument call is unchanged; `composeStray`'s default is byte-identical (golden) and `pad(x, 4)` equals the size-28 rest pose; a posed stray is built once per pose and frame (`painter.made` stays flat); icons are 8×8 with an ink outline; no ink touches a frame's edge unless marked. `node scripts/capture-anims.mjs` writes `test-results/anims-*.png`; look at them beside the vale's art and iterate.

**G. Main.** Creates `electron/notebooks.cjs`, `electron/alarm.cjs`, `tests/notebooks.test.js`, `tests/alarm.test.js`; edits `electron/content.cjs` (the Phase 4 manifest), `src/content4.js` (the real `phase4Problem`), `electron/main.cjs` (IPC, `before-quit`, notify kinds, `fallbackModel`), `electron/preload.cjs`, `tests/content-manifest.test.js`, and `tests/ui.mjs` (the bridge key assertion only).
- Proofs: ids refuse traversal, uppercase and device names; append handles `at` exactly, truncates any torn tail up to `MAX_APPEND` past `at` (a multi-note frame half-written included) and appends after it, and says `moved` only when the file is shorter than `at`; replace keeps a previous; restore and drop; writes refuse while blocked; `flush` awaits everything; the alarm keeps one slot, never rings for a past time, and shows in `__miloAlarm` under `MILO_TEST`; the manifest sorts, strips BOMs, turns CRLF into LF, caps sizes and counts, and keeps the five Phase 3 keys identical.

### Wave 2 (parallel, on wave 1's code)

**H. The minds.** Creates `src/combat/notebook.js`, `src/combat/ai.js`, `src/combat/strays.js`, `scripts/sim.mjs`, `scripts/tune.mjs`, `content/combat/tuning.json`; tests `tests/combat-notebook.test.js`, `tests/combat-ai.test.js`, `tests/combat-strays.test.js`, `tests/tuning-smoke.test.js`.
- Proofs: notes round-trip; frames with a bad CRC or a torn tail are ignored, and `unframe` reports `good` and `lastKey`; notebooks learn only from accepts and changes (changes count double), never from improvisations or auto play (20 rounds with a companion on `choose` add 0 notes); nothing leaves a notebook except by reset (a strike-out only filters); a lesson copies exactly one habit; sync from `accepts` after 20 scripted fights ≥ 80% against the scripted player (**pinned:** the Scribe at level 1, an empty notebook, seeds 1–20, Long Road stray rooms at n = 1); a draft is per slot, never repeating one habit into a slot it doesn't fit; a genre with no notes gives confidence < 50; the index returns exactly the brute-force 7 nearest over 1,000 random notebooks; the same notebook, seed and fight give the same drafts; guard rails hold over 500 seeds; a 50,000-note notebook drafts in ≤ 0.5 ms (median); a fast-policy decision ≤ 0.3 ms; `counterFor` does what §4.15 says at each step; each of the nine temperaments plays its row of §4.6 (shy settles at half, polite never touches an Offline hero, dramatic opens with its `big` move, lost idles one turn in three, and so on) and Maud's Table AI plays its row of §4.15; Noir intents hide until a Seek, an Examine or lantern light, and Void false targets come 1 in 3 (within a point over 100,000 telegraphs) and clear on Examine; the 200-fight smoke ≤ 5 s and within its widened bands; 1,000 seeded 3v3 fights with the real minds end within 10 rounds; §4.10's noise rule on paired seeds; every generated stray room is won on auto (Long Road, a party of 4 at the room's n, within 3 *Try again*s, on 100% of 200 seeds); caves the same over 200 seeds; auto modes pay the same as Command over 200 seeds per cell; the named cases (the first lead: ≥ 99% wins with three heroes at level 1; a Wayfarer above the Road level: on paired seeds a win-rate difference ≥ 0 and median rounds ≤ the reference party's). `node scripts/tune.mjs` runs §4.10's cells (Road levels 1–5, three modes, room kinds, party sizes 1–4, the reference party, 200 fights each with Wilson intervals) in ≤ 10 minutes, writes `tuning.json`, and exits non-zero on any failing cell; H reports the pace table.
- **H2** (after I lands, before wave 3; H's files only): `tune.mjs` runs the lead cells with I's `MECHANICS` and writes their `xInt` into `tuning.json`, and H's winnability proof adds every shipped mechanic and the fallback (Long Road, a party of 4, within 3 *Try again*s, 100% of 200 seeds).

**I. Leads and foes in play.** Creates `src/combat/leads.js` (the generic fallback with Asides and *The last page*, the eight mechanics and their bows, and the canon foes' bows), `tests/combat-leads.test.js`; edits `content/combat/leads.json` and `content/combat/foes.json` (rule numbers and object counts only).
- Proofs: each of the eight mechanics follows COMBAT §8.3's rule and bow, with its phases and objects; the fallback for the rest; Asides by mode and phase; plot armour once a phase; feints by step, spotted a tick early at Heed 3+ (a hairline lead in a room at the party's level gets step 3 and one feint); *The last page* at the end of round 8 (never at Maud's Table); the first lead uses every Storybook modifier; a real rift's lead yields and names its cause; each canon foe's bow works through `Bows.actions`, `resolve` and an Interact on a foe (the Mimic's `open` included) and pays like talking down; assembly lines' clerks arrive through `spawnFoe`; every mechanic can be won on auto with I's own scripted stub minds (strike the nearest, work the mechanic's objects), Long Road, a party of 4, within 3 *Try again*s on 100% of 200 seeds (H2 repeats it with the real minds).

**J. Engine.** Edits `src/world/engine.js`, `src/world/scene-rifts.js`, `src/world/scene-elsewhere.js`, `src/world/scene-wilds.js`, `src/world/map.js` (`slots.camp4` only), `src/world/riftfx.js` (the lead's display name only), `scripts/world-preview.html`, `tests/elsewhere.test.js` (only its wild-lead name assertion at line 822, which now compares with `leadDisplayName`); creates `src/world/scene-combat.js`, `src/world/anim.js`, `src/world/follow.js`, `src/world/scene-camp.js`, `src/world/scene-sky.js`, `tests/engine4.test.js`.
- `anim.js` exports `timeline(events, { units /* UnitView[] at the start */, abilities /* AbilityIndex */, anims /* content.combat.anims */, motion, speed, fastFoes, rules }) → Timeline` (`{ duration, at(ms) → { units: { [id]: { x, y, clip, frame, facing, flash } }, numbers: [...], effects: [...], shake } }`), `poseFrame(frame, op) → Frame` (the pose operations on rows, masks and anchors together), and `withLegs(rows, legs, at)`. Strays' clips map to poses through `anims.clipPoses`.
- Proofs: the layer protocol runs in both scenes; combat mode refuses walks, travel, chops and scene changes, never walks on WASD, and forwards no keys; a right-click in combat reaches only `onContextMenu`; combatants come first in both hit-test branches and the entity lists; hidden actors vanish from draws, hits and lists, `enc:<roomId>` hides a whole room and `party:<id>` never hides a crew member; playback runs on `dt`, holds while hidden and resolves at once with motion off; a timeline opens with the "noticed you" swirl and plays one kind's strays as one beat; `syncCombat` puts a resumed board exactly where the view says; `frameArena` centres in the free rect with all four insets and follows the cursor when the arena doesn't fit; two still frames draw identical lists; `painter.made` stays flat over 200 combat frames; followers keep 2, 4 and 6 steps back, reset on every scene change, unchain and chain back, and a selected follower walks instead of Milo; `setSneak` halves speed and clears on a scene change; `keepClear`'s pins hold with no party; `renderMap` is untinted and identical; the sky never repaints a chunk; `onSceneStep` fires inside Elsewheres; `enterElsewhere(rift)` with no options is unchanged; `mapview.test.js`'s source-scanned lines in `engine.js` keep their shape; the combat frame budget through `world.benchmark` in engine4.test.js's fake canvas (a ceiling) and in the preview (the real number).

**K1. Groundwork UI.** Creates `src/ui/log.js`, `menus.js`, `examine.js`, `wallet.js`, `chronicle-view.js`, `kindle-view.js`, `hud.js`, `skills-view.js`, `trail-view.js`, `satchel-view.js`, `src/ui/kit.css`, `tests/ui-kit.test.js`.

**K2. Company UI.** Creates `src/ui/combat-hud.js`, `planner.js`, `combatants.js`, `muster.js`, `camp-view.js`, `company-view.js`, `dialogue.js`, `notebook-view.js`, `levelup.js`, `src/ui/company.css`, `tests/ui-company.test.js`; edits `src/ui/panelart.js` (`rowsScene`, `portraitScene`).
- K1's and K2's proofs are their builders in Node: escaping (the `<img onerror>` and `<script>` titles), `data-*` attributes and focus keys, calm copy, determinism (the same view gives the same string), Examine always last, keyboard maps as pure tables (no Tab; `[` and `]`), odds in bars and in words, dashed drafts under 50%, and Jev's why in the planner's voice; `examineKey` follows §9.12's table; each hud tab opens its panel; and one builder test each for the heat thermometer, a stray bar's check segments, calm pips, the sustained-spell flame, "could change" odds, likeliest-trouble lines, an area's caught list, a draft's screen-reader readout, the Playbook popover, the yield card's three actions, the company sheet, the dialogue box and the trail note. They're mounted and proven in the app in wave 3.

### Wave 3: integration (L, which may run as L1 then L2)

**L1. The fight in the shell.** Creates `src/ui/fight.js`, `src/ui/expedition.js`, `tests/fight.test.js`, `tests/expedition.test.js`, `tests/content-cross.test.js`; edits `src/ui/frontier.js`, `src/ui/panels.js` (`ACTION_WORDS` and the cave and Challenge actions), `tests/shell.test.js`.
- Proofs: an expedition's life (settle a room, *Head home*, step back in paying the entry again: the room stays settled; the place closes: the expedition clears; entering another place replaces it); a resume rebuilds from `expedition.source` even after the live signal's urgency moved; `fieldSkill` for each of the five skills, refused calmly without the right companion, and a Mimic chest starting its fight; the creep-past rule; the free Breather waiting for `afterFight` while a fight is live; a commit's notes appended once across a simulated relaunch between append and save (`lastKey`), and retried on `moved` and `blocked`; `payRealStitches` and a wild stitch paying once each. `content-cross.test.js`: every id one content file names in another resolves (leads.json `hooks` → companions and camp talks, trails → features and places, callings → abilities, regulars' signatures and tricks, rules.json and foes.json ability ids, companion `fieldSkill`s, scene `who`s), and no combat name collides with another in LORE's index unless it's one of `calm.js`'s `ECHOES` (COMBAT §16.4).

**L2. Wiring and proofs.** Edits `src/app.js` (the shell object and panel registry, about 150 lines; `setupPhase4` behind `phase4Problem`, never in `PHASE3_MODULES`; module loading; the resume step after `entrance()`; the key stack; insets; “Milo’s Arts”; `runRiftLoop`'s new passes; every wiring item listed in §12.4), `src/styles.css`, `index.html` (§12.1's containers and the two stylesheets), `tests/ui.mjs` (only pins Phase 4 changes on purpose, each named in the final message), `tests/ui-helpers.mjs`, `package.json` (nothing unless a script is missing); creates `tests/ui-phase4.mjs`, `scripts/capture-combat.mjs`, `scripts/capture-camp.mjs`.
- **Phase 3's checks that step into Elsewheres** (`tests/ui.mjs` at about lines 1482, the real rift; 2043 and 2063, the wild rift and deeper; 2159, midnight; 1530, the story crack, which costs nothing now) would be refused for want of Embers once wave 3 lands: L2 patches each one's `state.json` before its block with `embers: { balance: 100, lifetime: 100, through: { …the current counts } }`, as the Stockade check already patches `tally`, and seeds the same into the midnight check's bare state. It names each in its final message.
- `tests/ui-phase4.mjs` seeds its own data directories (the minimal-state template) and checks, with motion off except where named:
  1. A fresh launch in Adventure mode: nothing focusable before `#bubble`, the 1000×700 fit, focus rings on every new control.
  2. Kindle through relaunches: start at T; relaunch at T+20 min in focus; at T+51 min 10 Embers and 1,000 Focus paid once and the rest running (main's `__miloAlarm` armed for T+66 min); relaunch again, no second pay; at T+66 min the rest honoured, 5 Embers and 400 Hearthkeeping once.
  3. A finished crew session pushed as a snapshot pays 2 Embers and 100 Command once; the Chronicle lists both with their sources; a relaunch pays nothing more.
  4. The command bar: `::kindle`, "open the chronicle", and a calm answer to nonsense.
  5. Right-click a lantern: a menu with Examine last; Examine gives a line.
  6. Step into a wild rift (5 Embers in the ledger), fight and win a room, then a keyboard-only round; Road XP and Warding rise.
  7. A relaunch mid-fight lands on the same tick.
  8. A focus session started mid-fight pauses at the next action; a rest's end does the same.
  9. Correct a draft; the notebook page gains the habit; the notebook file survives a relaunch.
  10. Everyone offline: the wake card, a free *Try again*, then *Go home*, then going back in costs nothing once.
  11. Recruit a regular at tier 2, pick them at the campfire over a Wayfarer, set out and follow through a gate.
  12. A working-Claude fixture shows "Her likeness will go." at the muster.
  13. The trail from its note: the first wild chest hands it out, the Kindle step completes it, the trail panel shows the next riddle; then the last step: the Last Bridge, the Tollkeeper's three riddles, he joins; the muster then offers six companions for three places.
  14. A cave for 3 Embers, with a fight; the Artificer picks its locked chest.
  15. A field boss: sight alone starts nothing; *Challenge* for 5 Embers does.
  16. Quiet and Adventure modes; the combat HUD and every new panel at 1000×700.
  17. Nothing leaves localhost; no `[MILO]` warning and no console error.
- `scripts/capture-combat.mjs` (scenes and `perf`, writing `test-results/combat-perf.json`) and `capture-camp.mjs` write `combat-*` and `camp-*` sheets; look at every one beside the vale and iterate.

### Wave 4: review and docs

A multi-lens review (rules, honesty, calm copy, privacy, performance, accessibility), adversarial checks of §1's promises, fixes by whichever module owned the file (the orchestrator assigns them), a full `node scripts/tune.mjs` run that passes every §4.10 cell (a failing cell is fixed in the data or taken to Chris before sign-off), a visual review of every capture, then the docs: `README.md` (verify commands and the new features), PLAN.md's Done list and the doc changes COMBAT §17 lists, LORE §21's new names (and an Echoes bullet, so the validators' pending lists empty), and §18 of this contract.

## 14. File ownership

One owner per file per wave; a blank cell means nobody edits it that wave. Wave 4 fixes are assigned by the orchestrator per file.

| File | W0 | W1 | W2 | W3 |
|---|---|---|---|---|
| `tests/fixtures/make-golden.mjs`, `phase3-golden.json`, `tests/golden.test.js` | 0 | | | |
| `tests/calm.js`, `tests/fakedom.js` | 0 | | | |
| `tests/ui-helpers.mjs` | 0 | | | L2 |
| `tests/world.test.js` | 0 | | | |
| `tests/ui.mjs` | 0 | G | | L2 |
| `electron/content.cjs`, `src/content4.js`, `tests/content-manifest.test.js` | 0 | G | | |
| `tests/imports.test.js` | 0 | | | |
| `electron/main.cjs` | 0 | G | | |
| `scripts/world-preview-main.cjs` | 0 | | | |
| `package.json` | 0 | | | L2 |
| `electron/preload.cjs`, `electron/notebooks.cjs`, `electron/alarm.cjs`, `tests/notebooks.test.js`, `tests/alarm.test.js` | | G | | |
| `src/clean.js`, `src/state4.js`, `src/embers.js`, `src/chronicle.js`, `src/kindle.js`, `src/lifeskills.js`, `src/commands.js`, `src/sky.js` | | A | | |
| `src/model.js`, `src/hearth.js`, `src/skills.js` | | A | | |
| `content/skills.json`, `xp.json`, `economy.json`, `spells.json`, `sky.json` | | A | | |
| `tests/core.test.js`, `tests/rifts.test.js`, and A's new tests | | A | | |
| `src/combat/heat.js`, `rules.js`, `grid.js`, `effects.js`, `abilities.js`, `battle.js`, `round.js`, `driver.js`, `describe.js` | | B | | |
| `content/combat/rules.json`, B's new tests | | B | | |
| `src/party.js`, `src/camp.js`, `content/party/**`, `content/camp/**`, `content/combat/callings.json`, `content/combat/spells.json`, C's new tests | | C | | |
| `src/world/riftgen.js`, `src/world/elsewhere.js` | | D | | |
| `src/world/arena.js`, `src/world/leadname.js`, `src/combat/bestiary.js`, `src/combat/encounters.js`, D's new tests | | D | | |
| `content/combat/leads.json`, `content/combat/foes.json` | | D | I | |
| `src/world/caves.js`, `src/world/fieldboss.js`, `src/world/trail.js`, E's new tests | | E | | |
| `content/examine.json`, `content/trails.json`, `content/wilds.json`, `content/fortress.json` | | E | | |
| `tests/content.test.js` | | E | | |
| `src/ui/wildtext.js` | | E | | |
| `tests/shell.test.js` | | E | | L1 |
| `src/world/sprites-party.js`, `src/world/party/*.js`, `src/world/icons.js`, `src/world/fx.js`, `src/world/props4.js` | | F | | |
| `src/world/straygen.js`, `src/world/scene-art.js`, `content/combat/anims.json`, `scripts/capture-anims.mjs`, `tests/art4.test.js` | | F | | |
| `src/world/riftfx.js` | | F | J | |
| `src/combat/notebook.js`, `ai.js`, `strays.js`, `scripts/sim.mjs`, `scripts/tune.mjs`, `content/combat/tuning.json`, H's new tests | | | H, then H2 | |
| `src/combat/leads.js`, `tests/combat-leads.test.js` | | | I | |
| `src/world/engine.js`, `scene-rifts.js`, `scene-elsewhere.js`, `scene-wilds.js`, `map.js`, `scripts/world-preview.html` | | | J | |
| `src/world/scene-combat.js`, `anim.js`, `follow.js`, `scene-camp.js`, `scene-sky.js`, `tests/engine4.test.js` | | | J | |
| `tests/elsewhere.test.js` (its wild-lead name assertion only) | | | J | |
| `src/ui/log.js`, `menus.js`, `examine.js`, `wallet.js`, `chronicle-view.js`, `kindle-view.js`, `hud.js`, `skills-view.js`, `trail-view.js`, `satchel-view.js`, `kit.css`, `tests/ui-kit.test.js` | | | K1 | |
| `src/ui/combat-hud.js`, `planner.js`, `combatants.js`, `muster.js`, `camp-view.js`, `company-view.js`, `dialogue.js`, `notebook-view.js`, `levelup.js`, `company.css`, `src/ui/panelart.js`, `tests/ui-company.test.js` | | | K2 | |
| `src/ui/fight.js`, `src/ui/expedition.js`, `src/ui/frontier.js`, `src/ui/panels.js`, `tests/fight.test.js`, `tests/expedition.test.js`, `tests/content-cross.test.js` | | | | L1 |
| `src/app.js`, `src/styles.css`, `index.html`, `tests/ui-phase4.mjs`, `scripts/capture-combat.mjs`, `scripts/capture-camp.mjs` | | | | L2 |
| `README.md`, `PLAN.md`, `COMBAT.md`, `LORE.md`, `RIFTS.md`, `WORLD.md`, `CONTRACT-PHASE4.md` §18 | | | | (W4) |

**Must not touch in Phase 4, by anyone:** `content/riftgen.json`, `content/genres.json`, `content/story.json`, `src/world/sprites.js` (and its `SPRITES`, palette and atlas), `src/world/kit.js`, `src/world/wilds.js`, `src/world/worldgen.js`, `src/world/nav.js`, `src/world/rng.js`, `src/world/genres.js`, `src/world/wildsart.js`, `src/ui/mapview.js`, `src/ui/mapview.css`, `src/rifts.js`, `src/story.js`, `src/recap.js`, `src/watch/**`, `src/architect/**`, `tests/fixtures/claude-home/**`, `tests/fixtures/codex-home/**`, `tests/fixtures/architect/**`, and every existing test file not named in this table. If one of them truly must change, stop and report it.

## 15. Performance budgets

Tested where possible, with a warm-up and a median or p90, never one sample.

| Work | Budget | Where tested |
|---|---|---|
| A combat frame at 1280×820 with 16 actors | ≤ 12 ms | `world.benchmark` in `world-preview.html` (J); `capture-combat.mjs perf` (L2) |
| Reachable tiles for one unit | ≤ 2 ms | B |
| One `apply` | ≤ 1 ms | B |
| One fast-policy decision | ≤ 0.3 ms | H |
| One companion's draft, even at 50,000 notes | ≤ 0.5 ms | H |
| Building a 50,000-note notebook's index from bytes | ≤ 50 ms | H |
| *Tell me how it went*, a whole fight | ≤ 100 ms | B (with stub minds), H (real) |
| The 200-fight smoke in `npm test` | ≤ 5 s | H |
| `npm run tune`, every cell | ≤ 10 minutes | H |
| `prepareElsewhere` (layout, arena pass, encounters) | ≤ 8 ms median, ≤ 20 ms p90 | D |
| `payFromSignals`, `kindleTick`, `tallyAnswered`, `payLifeFromSignals` | ≤ 1 ms each | A |
| `normalizeState` at every Phase 3 and Phase 4 cap | ≤ 10 ms | A |
| Phase 4 state at caps (a capped `BattleSave` included) / the whole capped state (Phase 3's full caps included) | ≤ 400 KB / < 1.6 MiB, pretty-printed | A |
| A saved Battle (`saveBattle`, every list at its cap, 16 units) | ≤ 49,152 bytes by `battleBytes` | B |
| The sky tint / weather particles per frame | ≤ 0.3 ms / ≤ 1 ms | J |
| The HUD's update per tick | ≤ 4 ms, no `innerHTML` rebuild | K2, L2 |
| Content suites together | ≤ 1.5 s | C, D, E |
| `tests/ui-phase4.mjs` | ≤ 12 minutes | L2 |

Nothing generates or draws while the window is hidden. Nothing new runs in the engine's `tick` except layers' `update`. Timers belong in main (the alarm) or run only while visible (`'second'`).

## 16. Verification

### 16.1 Commands

With `$node` as the absolute path in §2:

```
& $node --test tests/*.test.js          # every unit suite (package.json "test"); the glob is expanded by node itself
& $node tests/ui.mjs                    # Phase 1–3's 47 Electron checks
& $node tests/ui-phase4.mjs             # Phase 4's Electron checks
& $node scripts/tune.mjs                # the tuning grid (not part of npm test)
& $node scripts/sim.mjs --level 3 --mode long-road --room moderate --party 4 --fights 200
& $node scripts/capture-anims.mjs
& $node scripts/capture-combat.mjs      # and: capture-combat.mjs perf
& $node scripts/capture-camp.mjs
& $node scripts/capture-sprites.mjs     # Phase 3's sheets, unchanged
& $node scripts/capture-wilds.mjs perf  # the wilds frame budget still holds
```

`package.json` (wave 0): `"test": "node --test tests/*.test.js"`, `"test:ui": "node tests/ui.mjs"`, `"test:ui4": "node tests/ui-phase4.mjs"`, `"tune": "node scripts/tune.mjs"`, `"sim": "node scripts/sim.mjs"`. **Decided:** the glob replaces the explicit list, so every new `tests/*.test.js` runs from the day it lands and nobody edits `package.json` per module. Screenshots only ever show synthetic data.

### 16.2 The golden fixtures (wave 0)

`tests/fixtures/make-golden.mjs` generates `tests/fixtures/phase3-golden.json` from HEAD (`0b8f5ae`) and refuses to overwrite it without `--force`, which nobody uses in Phase 4. Each entry is a SHA-256 (`node:crypto`) of `JSON.stringify` of the value (typed arrays as arrays):

| Group | What's hashed | Cases |
|---|---|---|
| Rift specs | `wildRift` and `realRift` specs, whole | `wild(i)` for i < 300 as `riftgen.test.js` builds them, every 8th with a forced awkward affix (mirrored, labyrinthine, sunken, overgrown, flooded, vast, tiny); a real rift per genre signal and per fusion pair; `story:first-crack`; 20 ladder rungs from 4 roots |
| Layouts | `riftgen.layout(spec)`, with `roomRects` removed before hashing | the same specs (about 500) |
| Elsewhere scenes | `buildElsewhere(spec, layout, { genres, kind, words })` with no `fight`: `ground`, `objects` (functions dropped), `spawn`, and each stray's `id`, `home` and `positionAt` at 0, 5,000 and 60,000 ms | 100 of the specs |
| Worldgen | `chunk(cx, cy)` tiles and POIs, `fixedPois()`, `wildRiftSpawns(cx, cy, 20000)` | seeds `hushlands` and `moonrise`, chunks in [−6, 6]² plus every chunk a road crosses |
| Wild objects | `createWilds(...).chunk(cx, cy).objects` | `hushlands`, chunks in [−3, 3]² |
| Strays | `composeStray({ archetype, bodyKey, parts })` at 20×20 | every archetype × every part alone × body keys `r`, `e`, `k`; every genre's full lead parts |
| Wild actors | `strayActors(rift)`: ids, homes, temperaments and `positionAt` at 0 and 5,000 ms (not names) | 50 wild rifts |

`tests/golden.test.js` rebuilds each case and compares hashes. It ignores exactly two things: `layout.roomRects`, and the `tale-lead` object's `name` and `label` (a lead's display name changes on purpose, §7.3).

### 16.3 Shared test helpers

New tests import copy checks from `tests/calm.js`, and engine tests import fakes from `tests/fakedom.js` and use `manualClock` with `drive`, never real timers. Content test files that meet a name not yet in LORE §21 keep it in a `PENDING_NAMES` array at the top of the file, with a comment, and pass any extra proper nouns to `assertCalm(text, where, { proper })` rather than editing `calm.js`; wave 4 adds those names to LORE §21 and empties every pending list.

## 17. Open risks and decisions against the brief or the docs

1. **The wild rift's Ember cost.** The brief says "5, +1 per 5 depths"; COMBAT §12 says "+1 per 3 depths (up to 10)", and the task says the Embers must match COMBAT exactly. This contract uses COMBAT's rule (`min(10, 5 + floor((depth − 1) / 3))`). If Chris prefers the brief's, only `economy.json`'s `every` changes.
2. **The Tale-lead's 12×9 arena** can't be stamped without merging rooms in about a third of layouts, and growing the scene would move every saved coordinate. The arena is the 12×9 window clamped inside the scene, with walls left as walls; the lead's room itself (at least 5×4) plus its corridor mouths is always the playable core. The sim measures whether cramped lead rooms run long.
3. **Adventure mode is the default** (PLAN §7), which puts new chrome into every Phase 3 Electron check's window. Everything new sits after `#map-view` and is fixed-positioned; if a Phase 3 pin still can't hold, L2 changes it deliberately and says so.
4. **Hearthkeeping XP flows from honoured rests**, which the brief's list of sources leaves out; Phase 4 has the source (Kindle), so it pays.
5. **Delay** in a fixed three-tick round waits a tick and can push an action out of the round; the planner shows it before Run.
6. **Balance.** Paths for the Scribe, the Artificer, Jev and the Tollkeeper are designed in wave 1 without the sim; H's tuning may need `tuning.json` factors and C's numbers adjusted in wave 4. §4.10's bands are pass criteria: a cell that can't be met (the likeliest are a party of one at Maud's Table, or a cramped lead room) blocks wave 4's sign-off until the data is fixed or Chris decides, never quietly reported.
7. **The note format is permanent.** Once notebooks exist on disk, byte meanings can't change; a change needs a frame version bump and a reader for both.
8. **Suite times.** `world.test.js` is already 38 s; new engine tests use the manual clock. `ui-phase4.mjs` relaunches with `MILO_NOW` for every time proof and must stay within 12 minutes.
9. **The Last Bridge's deck** isn't walkable until the wood wakes (Phase 7), and the Examine line says so; seeds with no river crossing near the wood's edge get a footbridge on the north road instead.
10. **Field bosses are far away.** Tier 5+ gaping rifts appear mostly 220+ tiles out, so Chris may not meet one early; the Electron check seeds one.
11. **`riftfx.js` changes hands** (F in wave 1, J in wave 2); J must read F's report first.
12. **Gear is cut** (§3.2), so Wardens get plate at Road level 5 from their calling, not from loot.
13. **Names.** Phase 4 content will need names LORE §21 doesn't have yet (path features, props, Adventure mode, Quiet mode); the pending lists carry them until wave 4.
14. **`tallyFinished` can recount** an id that fell out of the newest 400; `byCrew` never exceeds `sessionsFinished`, and Embers' high-water marks inherit the same small leak.
15. **Warmth from real habits** is the only warmth beyond outings; the brief allows it (it names conversations, gifts, banter and camp jobs as Phase 5), but Chris hasn't seen it in play.
16. **How signals pay once.** The brief keys payments by source id. Event sources (focus sessions, rests, fights) are keyed that way; the counter-driven signals (crew sessions, answers, real stitches, designs) pay from high-water marks on their monotone counters instead, because `finishedIds` keeps only 400 ids and a per-id map would grow without end. The promise is the same: each pays once and a relaunch never pays twice.
17. **Where the arena pass runs.** The brief has `elsewhere.js` call into the new module. Here `encounters.prepareElsewhere` runs `arena.js` and hands the plan to `buildElsewhere(…, { fight })`, so `elsewhere.js` needs no rules and stays byte-identical without the option. The pass still lives in its own module.
18. **Two `sky` files.** The brief names `sky.js` for both A (the pure clock maths) and J (the drawing). A's is `src/sky.js`; J's is `src/world/scene-sky.js`.
19. **The test list** becomes a glob (§16.1) in wave 0, which is the brief's "new test files go into `package.json` together" done once for every module.
20. **Leads split across waves.** B owns what every lead shares and a bare lead so wave 1's fights work; I owns the generic fallback's Asides and *The last page*, as the brief asks. Until wave 2 lands, lead fights have no Asides and never yield at round 8, so no wave 1 proof depends on either.
21. **The Last Bridge's placement** is `hushlands`' crossing about 40 tiles west of the north road's entry into the wood; it's on the wood's edge but not on the road. If Chris would rather meet it on the road, E weights the road distance more (one number in `trail.js`).
22. **Tab doesn't cycle targets.** COMBAT §13 has Tab cycle targets and slots; here **[** and **]** do, because a captured Tab traps keyboard focus and breaks the focus-ring checks. Tab moves focus through the HUD's controls as everywhere else in MILO.
23. **Real stitches pay as Phase 3 counts them.** `rifts.stitched.real` also rises when a Nocturne seals at dawn after an all-nighter, when a Capacity window refills, and when a Knocking's session vanished; the needs-you rule is stricter. `src/rifts.js` is frozen for Phase 4 and keeps one counter, and each rift pays once per episode, so the leak is small and bounded. **Decided:** keep the counter; if Chris wants only mended seals to pay, Phase 5 splits the counter in `rifts.js`.
24. **Lifetime counts past the cap** (COMBAT §12, PLAN §6), so the backlog's whole count goes into `lifetime` even when only 100 is banked.
25. **The story crack is free.** COMBAT §12 prices no story rift, and the Prologue is unchanged (§3.2).
26. **Saving a fight.** The live Battle can't fit a save budget (about 44 KB with 16 units and empty lists), so the save is `saveBattle`'s dynamic fields (§5.4), rebuilt by `restoreBattle` from the FightSpec, the heroes and the templates; the budget rose to 48 KiB and Phase 4's state budget to 400 KB to match, still well under the pinned 1.6 MiB.
27. **Modes apply at runtime.** COMBAT's "−1 level, ×0.75 damage" is applied by B from `battle.mode` (§4.15), not baked into specs, so easing to Storybook mid-fight works from the next round without bars jumping.

## 18. Refinements

Written by the orchestrator after each wave from the modules' reports. Where these and §1–§17 differ, these win.

### 18.1 After wave 0

- Wave 0 passed its independent check: 548 unit tests (the 527 plus golden 10, content-manifest 7, imports 4) and all 47 Electron checks.
- **The golden Elsewhere scenes pin more than §16.2's table.** Each scene's hash also covers, per tile, `walkable`, `cellAt` and the owning genre (`genreAt` at the tile's centre), plus `palettes`. So D's `elsewhere.js` edits must leave walkability and a fusion's patchwork unchanged whenever no `fight` option is passed. The fixture was regenerated from the untouched `src/` and `content/` to add these, and nobody regenerates it again.
- `tests/calm.js`'s `PROPER` follows §13 (every capitalised word in LORE §21), so first words of move names ("Better", "Kind word") pass sentence-case checks mid-sentence. Accepted as written; content authors shouldn't rely on it.
- `makeRoot` in `tests/ui-helpers.mjs` is async.
- `package.json`'s `"test"` is the glob `node --test tests/*.test.js`. In PowerShell, node expands the glob itself; run it from the repo folder.

### 18.2 After wave 1

Wave 1's seven modules shipped and were cross-checked: 1,289 of 1,290 unit tests pass (one `todo`, item 1), and 263 fights ran with C's heroes, D's encounters, B's driver and A's saves, round-tripping 2,238 saves with no throws. The module reports are the orchestrator's `reports/A.md` … `G.md` and `wave1-cross.md`; the APIs they list are what shipped. These decisions win over §1–§17:

1. **Size pins.**
   - The whole capped state (Phase 3's true full caps included) must stay **under 1.9 MiB** (1,992,294 bytes, pretty-printed), not 1.6 MiB. Phase 3 alone at its full caps is about 1.44 MB, which §8's estimate missed.
   - Phase 4's own sections must stay **≤ 450 KiB** at the cleaners' outer bounds.
   - Main's 2 MiB write cap is unchanged.
   - A turns `core.test.js`'s `todo` into a passing test at these pins.
2. **A kind counts once.** When a unit's genre resistances, genre weakness and archetype resistances and weaknesses name the same kind in both lists, it's removed from both: neither resisted nor weak. This matches the net of applying both, and Examine shows neither.
   - D owns one exported helper, `bestiary.defencesFor(genres, archetype, level) → { resist, weak }`.
   - C's regulars import it, so a stray and the regular made from it always match.
3. **Caves have a day.**
   - §7.7's `prepareCave` and §8.3's cave `source` gain `day` (the MILO day number at entry), stored at entry and passed on every rebuild.
   - Ids: the expedition's `riftId` is `cave:<x>,<y>`; `source.poi` is the wilds place id `poi:cave:<x>,<y>`.
   - E's CaveSpec carries `day`. L1 stores it.
4. **`take` is structured and settles the taker.** B's `take` verb emits a `take` event (`{ kind: 'take', unit, from, item }`) and, when the ability says `settle: true`, the taker is sorted at once (it pinches and runs home). The fetchfox's pinch uses `settle: true`. D counts pinches from these events, never from Log text, and a fox that pinched nothing adds nothing to the loot.
5. **`heat` to idle** is written `{ do: 'heat', idle: true }`, not `to: 'idle'` (`to` stays the landing parameter). B changes the kernel and `validateAbility` together.
6. **A choice can carry its own `meets`.** Each entry in an ability's `choices` may set `meets` ('body' or 'mind'), which wins over the ability's. B reads it; C sets it (*Borrow a rule*'s Titan stomp meets body).
7. **`inviteRegular` takes the rift record or its spec** (`rift.spec ?? rift`). A bowed Tale-lead joins under `leadDisplayName`'s name, never riftgen's raw one. A regular keeps at most 4 `parts` (A's cap).
8. **Outing heroes always carry `charges`.** Every write of an outing hero is `{ integrity, charges, uses, rattled }` (C); a missing `charges` is a bug, not "full".
9. **Wild rifts rebuild from the spawn.** A wild or field `source` stores `worldgen.wildRiftSpawns(cx, cy, day)`'s inputs for that seed, `weights` included, taken at entry (L1), because the rift record carries no `weights` and `rifts.js` is frozen.
10. **Standoffs end calmly.** If three whole rounds pass with no Integrity change, no condition landed, no calm added and no unit moving closer to a foe, the fight ends as settled ("They’ve lost interest and wandered home."): B emits `end` with `why: 'standoff'`, and it pays in full. H's minds should still avoid standoffs (a ranged option, a Shove).
11. **B's `BattleSave` is B's compact shape** (surfaces as three base-36 strings, units as tuples with defaults left out, plus `auto` and `spawn.spec`/`like`), versioned `v: 2`. Nothing but B reads its insides; A checks `v`, the id and the byte cap.
12. **Art:** `anims.clipPoses.offline` is `'tumble'`, and the extra key `sorted: 'settle'` serves B's `sorted` event (J reads both).
13. **One owner per duplicated rule:**
    - walkable objects: B's `grid.WALKABLE_OBJECTS`, which D imports;
    - the cave borrow list: `foes.json`'s `borrow`, which E reads;
    - `story.trails['first-trail'].joinedAt`: written only by E's `markJoined`, which C's `recruit` calls.
14. **Numbers from content.** Everything priced reads `economy.json`, including `wildtext.js`'s cave door.
15. **`tests/ui.mjs` check 43** now accepts a real count on the Hold's focus-sessions row (Kindle counts them), with every other row still "Later". The orchestrator made this edit; L2 must reword `app.js`'s privacy note to name focus sessions.
16. **Reduced motion keeps walking (Chris, 2026-09-30).** Chris's Windows has "Animation effects" off, so the system asks for reduced motion, and Milo used to snap to wherever he was sent. Now there are three motion states.
    - **Full motion:** MILO's Motion setting is on and the system doesn't ask for reduced motion. Everything moves.
    - **Reduced motion:** Motion is on and the system asks for reduced motion.
      - Movement still plays: Milo, the crew and (from Phase 4) the party and every combatant walk their paths tile by tile, and the camera keeps to Milo.
      - Everything decorative holds still, drawn at `t === null`: shimmer, weather, fades, celebrations, chop swings, flashes, shake, particles and idle loops.
      - The loop runs only while somebody walks.
      - A click's marker is a steady ring until he arrives.
    - **Still:** MILO's own Motion setting is off. Nothing moves, and walks and clips finish at once, as §2 describes.
    - The engine takes MILO's setting as `motion` and reads the system preference itself (`walksOn()` and `motionOn()` in `engine.js`).
    - `tests/motion.test.js` pins this. J, K2 and L2 follow the same split: combat playback under reduced motion slides units between tiles and plays no flashes, shake, particles or hit-stop.

17. **Wave 1.5 (settle) closed wave 1.** Every module passed a fresh review, and the gate ran 1,334 of 1,334 unit tests, 47 of 47 Electron checks and 10 of 10 golden tests.
    - Stray part ids are a slug or camelCase, as straygen names them (`jetFlame`); `state4.js` keeps both. That was the gate's one failure, fixed by the orchestrator.
    - D's `bestiary.defencesFor` takes a required `rules` argument.
    - Size pins as measured: Phase 4 450,934 bytes (under 450 KiB), whole state 1,948,959 bytes (under 1.9 MiB).
    - Timing tests (`wilds.test.js:1373`, `elsewhere.test.js:1064`, `encounters.test.js:1440`) can fail when other agents load the machine; they pass alone. Judge them on a quiet run.

### 18.3 After wave 2

Wave 2 shipped H (with H2), I, J, K1 and K2. The cross-check (the orchestrator's `reports/wave2-cross.md`) played full fights with the real minds through J's timeline and K2's planner.
- Unit tests: 1,607 of 1,613 pass. The fails are D's pins loading tuned rules, plus timing tests under load.
- Electron checks: 47 of 47.

Its §5 is the wiring list for wave 3, and its §6 lists the shipped signatures that differ from §7; both are binding. These decisions win over §1–§17:

1. **Asks outside a scheduled entry.** An Ask raised during a round's start or a tick's end resolves as Never (or Always on an auto plan), as `leads.js` already does. Answers never live in `usedRound`. This was the blocking bug: a Proofread on Ask at the round's start looped for ever. B fixes it; L1 still guards against the same Ask coming back after an answer.
2. **Every drawn change has an event.** B emits:
   - `light` whenever the Hooklight moves, not only when it drops;
   - `condition { on: true, n }` on every count-down, Dazed included;
   - `buffer` at 0 when round start clears Buffers;
   - `telegraphs` whenever the list changes after a step.

   L1 still calls `world.syncCombat(view)` once a round, when planning starts.
3. **`Battle.seen` records the choice made at commit**, read before the action resolves, so adaptation and the eye count the habit Chris actually showed.
4. **Restore equality holds with the real minds.** B saves each telegraph's `adapting` words and `falseTarget` in the `BattleSave` while the round runs, and `restoreBattle` uses them, so a resume shows the same eye and the same Void lie.
5. **Telegraphs are drawn honestly.**
   - A Void false target's `tiles` and `targets` are the false target's (H).
   - A hidden telegraph carries no `adapting` words (B nulls them when hiding).
   - K2 drops the `title` of a hidden telegraph and shows up to 8 telegraphs on a lead's card.
   - `plannerOverlay` passes `telegraphs` and `threats` (the tiles of every visible area or stomp telegraph) so the board draws them.
6. **One correction teaches one slot.** A draft's habit wins over personality only when its confidence is at least personality's 35%, and a slot drafts from notes made in that slot before borrowing another slot's (H). After one round of notes, a hero must not draft one habit into every slot.
7. **The eye's words are grammatical.**
   - "you’ve gone for the Tale-lead five times", never "you’ve went".
   - Counts use words for one to nine and figures from 10.
   - A draft's why counts rounds, never notes (H).
8. **Minds don't work the bell or the riddle board** (their bows are `mech:` actions): both leave `OBJECT_READY` (H).
9. **Carried to B from I's review:**
   - a real rift's last-page yield carries `result.real`;
   - the Sentries' and bell-ringers' doorway need comes from `foes.json`'s `bow.count`;
   - `damageTaken` reports the amount before resistance;
   - `project` simulates an Examine;
   - `describe.draftReadout` never doubles "on";
   - a lead room's summary is about the lead.
10. **The shell's `'combat'` message** is `{ live, battle, roundView, ctx, command }`.
    - L2 sets `#stage.dataset.mode = 'combat'` before the first message.
    - Every message carries `live: true`, and the fight ends with `{ live: false }`.
    - K1's Log and K2's HUD both read `live`.
11. **The company at camp (L2):**
    - C's `fire` and `bedroll` map to J's seats;
    - `tower` is Jev's Phase 3 perch;
    - `bridge` means `trail.bridgeLandmarks(…, { joined: joined && where !== 'bridge' })`.
12. **Tuning.** Lead fights can't reach 4–5 rounds and stay winnable at level 1 with one `xInt` per mechanic, so leads gain a factor by Road level and party size in `tuning.json` (`leadFactor[level][size]`). D's lead builder multiplies by it, and `xInt` becomes a pure mechanic multiplier.
    - The tuning pass (module T, after wave 2.5) fits both. It speeds up `tune.mjs` to fit the 10-minute budget, and reports every cell.
    - Where a §4.10 band can't be met without breaking a promise (the first lead, level 1, a party of one at Maud's Table), T proposes a reading with numbers, and the orchestrator takes it to Chris before sign-off.
13. **Test kits load the rules they pin.** `bestiary.test.js`'s pins use factor-1 rules explicitly and never load the tuned `tuning.json` (D).
14. **Shipped differences recorded** (from wave2-cross §6, binding):
    - A and C: `spend(…, now, economy)`, `entryCost(kind, { depth, economy })`, the `content`/`xp` arguments, `noteGrowth(…, { fight })`, `gentlestStray(spec, { genres })`, `caveSpec(…, { day })`/`caveSource`/`caveFromSource`, `isFieldBoss(rift, { leads, rules })`, and `tallyAnswered` in `state4.js`.
    - J: `hideActors` replaces the set; `startCombat` takes `abilities` and `noticed`; `syncCombat` enters combat mode itself; `benchmark({ flush })`.
    - K1: `#context-menu`'s role sits on its inner div; a Log line's menu has no Examine; `shell.emit` and `openMap`.
    - K2: Enter and Space stay with any focused control, Backspace mid-plan leaves a Delay, and there's no `'odds'` popover.

15. **Wave 2.5 (settle) closed wave 2.** Every module passed a fresh review.
    - The gate ran 1,655 of 1,659 unit tests (the rest are timing tests under load that pass alone, plus H’s Maud’s Table todo), 10 of 10 golden tests and 47 of 47 Electron checks.
    - 3,000 headless auto fights with Proofread on Ask all ended within 30 rounds.
    - Tuning (module T) runs beside wave 3 and owns only `tuning.json`, `tune.mjs`, `sim.mjs`, `tuning-smoke.test.js`, a new `tuning-lead.test.js`, and the lead builder’s `leadFactor` lines in `bestiary.js`.

### 18.4 After wave 3 and the review

18. **Wave 3 became one wiring pass (`src/ui/phase4.js` and the hooks in `src/app.js`), done by hand rather than by module agents.**
    - **Trail.** The first Riddle Note is handed out by the first wild chest after the Prologue’s `first-crack` (`phase4.onChest`). A feature’s first use solves its step (`shell.feature` → `stepDone`). A step to visit counts only Milo’s own steps, because the followers’ steps reach `onSceneStep` too. The north gate counts when Milo lands within four tiles of its edge, since going out by a gate is a jump and never stands on the gate’s two tiles. The Tollkeeper, once every step is done, opens `talk:tollkeeper-riddles`.
    - **World sync.** `syncWorld` keeps the engine in step with the state: landmarks (the Tollkeeper’s stand empties once he has joined), the sky from the real clock, followers (the chosen party, in the wilds and Elsewheres only, with each one’s `look` from `heroSpec`, since `musterView` carries none), and the camp (non-crew companions at the fire or in a bedroll).
    - **Doors.** The rift panel asks `phase4.costsFor`, `suggestedLevel` and `isFieldBoss`; Challenge and a cave’s *Go in* walk to the place first (`challengeRift`, `enterCaveAction`), then the door spends the Embers. A wild stitch pays Road XP through `payStitch`, and the gentlest stray may ask to stay (`invitation`, asked again at the yes so nothing earned since is lost).
    - **Menus.** `act:*` choices call `combatHud.act`, and `combatHud.actions()` gives the menu the selected hero’s legal actions. Sneak is remembered from the HUD’s `setSneak` so the sight check reads it.
    - **Bubbles.** A bubble may carry `onAction(actionId)`; the Log no longer repeats a title that its first line starts with.

## 19. Critique decisions

Four reviews (completeness, interfaces, codebase, rules) were applied to this contract before wave 0. Every fix was taken except these, which were rejected or taken in a different form, for the reason given:

- **The Scribe's Shoulder default** (interfaces 17, rules 32: change `claude.json`'s sample to `"under-half"`): rejected. COMBAT §3.7 plays her Shoulder on Always, so her file sets her own default over §4.4's; §4.4 now says a companion's file may do that. The pinned `REACTION_IDS` were taken.
- **`UnitSpec.unlocks`** (interfaces 21): not added. Warding is Milo's one party-wide skill, so `createBattle`'s `warding` option (completeness 7) carries it; `READY_TRIGGERS` and "the readied action is the next slot" were taken.
- **Paying real-stitch Embers from `rifts.history`, minus Capacity, dawn seals and vanished Knockings** (rules 17): rejected. `src/rifts.js` is frozen, its history keeps neither the real kind nor how a Knocking ended, and each episode pays once; recorded as a **Decided** risk in §17.23. The source-scan test was taken.
- **`stitchedReal` in `xp.through`** (rules 30): not added. `party.payRealStitches` pays Road XP, Warding and Seamcraft 500 from the one mark, `road.stitchedThrough`, so a second mark could only drift.
- **Renaming the tonic's counters to `brew-of-clear-morning`** (completeness 1): the item's ability id was renamed; `Rewards.tonics`, `carry` and `satchel.tonics` count it under `brew`, since they're counter keys, never ability ids, and can't collide.
- **A `burnEssence` function in party.js** (completeness 18): not added. The burn is the in-fight `burn-essence` rule; its satchel side is setting out (the Weaver's `carry.essences`) and `afterFight` (taking the burnt ones off the satchel). `swapPath`, `swapBoon` and `preparePages` were added.
- **Saving the Battle as a replayed command log** (interfaces 1, codebase 1, first option): the second option was taken instead (`saveBattle`'s dynamic fields), because a log grows with every round (up to 30 rounds of plans) and a restore would replay every action. Capping telegraph `tiles` was dropped: telegraphs are rebuilt, never saved.
- **Moving `struck` and `rules` into the notebook file** (codebase 2, alternative): `struck` stays in state at ≤ 40 and is never pruned (rules 25), so `strikeOut` refuses a 41st calmly.
- **Cutting the ledger to 200 entries** (codebase 2, alternative): the ledger keeps COMBAT's and PLAN's 300, with `text` ≤ 60 and `source` ≤ 20 instead; the state budget was re-measured.
- **A `party.invites` memory** (completeness 22, alternative): re-offering is automatic (every stitch and bow asks again), so no memory is needed.
- **Friend unlocking the second path** (completeness 5, alternative): the thresholds above Acquaintance stay inert until Phase 5, with the reason corrected in §3.2.
- **Showing *Send the crew* greyed** (completeness 15, alternative): left out of the yield card.
- **A signature per generated elite** (completeness 25, alternative): generated elites have none in Phase 4 (§4.9).
- **The evening bell's Hearthkeeping** (completeness 33, alternative): deferred to Phase 5 (§3.2).
- **Named cave creatures for the Painted Hills and the Ivory College** (codebase 12, alternative): they borrow the nearest listed region's, so no canon is invented.
- **`sneakCheck` in encounters.js** (interfaces 20): it's B's `battle.js`, beside the outcome maths it uses, because D's wave-1 code can't import B's unfinished `heat.js`.
- **Option names:** the doorway calm is `createBattle`'s `talk` (not `calm` or `calm0`, since `calm` already names the noise and adaptation switches), and *Set the ambush* is `placement` (not `ambush`).
- **Frame version 2** (rules 16): the round key is in the header, but the version stays 1, since no notebook exists on disk before Phase 4.
- **Rounding "back at half"** (rules 39): after a fight both the top-up and an Offline hero's return round up, as §4.18 already said; only the Breather's half rounds down (at least 1).
- **The import-graph test in A** (codebase 9): it's wave 0's `tests/imports.test.js`, so it runs from the first day; A only moves the helpers.
- **Barks emitted by L1 after each `step`** (interfaces 28, alternative): B emits them from `ctx.party`, so replay and playback agree.
