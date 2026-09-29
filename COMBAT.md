# The Company: party, camp and combat

MILO's fights are small turn-based tactics battles: a party you gather, camp with and talk to, in the spirit of Baldur's Gate 3, and three actions a turn, in the spirit of Pathfinder 2, with height and cover, surfaces, spells, conditions and rests. Nothing is rolled. Each round the strays show what they mean to do, your companions draft their own turns from what they've learned from you, you review the plan, and you press **Run**. You command a party of four: Milo, plus three companions you've collected and picked at the campfire before heading out. The mechanics are generic and every name is original. Those two game names appear only in this design prose, never in a content string (§16.4).

It's still MILO. Nobody dies, a fight pauses between any two actions and fits inside a 15-minute rest, real work is the fuel, and horror stays cosy. This file replaces PLAN.md §9's "light combat in the Soda Dungeon style", fills in Phase 4, and proposes an answer to PLAN.md §14 Q3: Habitack's combat retires into Warding and the Company when its board comes home in Phase 5, rather than staying a side game (§18 Q9). The rest of the design is in [`PLAN.md`](PLAN.md), the world bible in [`LORE.md`](LORE.md), the rift codex in [`RIFTS.md`](RIFTS.md) and the fortress and the wilds in [`WORLD.md`](WORLD.md).

---

## 1. The promise

A fight should feel like running a small, good team. The room you walked into becomes the board: a grid fades in under everyone's feet, the strays show their plans, and each companion has already drafted a turn: where to stand, who to shoulder and which of tonight's few spells to spend. Every odd is shown before you press Run, and the odds you see are the odds used. Your companions are small minds who learn how you play, and the strays are people from other stories who'd honestly rather be home.

1. **Nothing is lost.** A hero at 0 Integrity goes Offline and dozes where they stood until someone Reboots them. If the whole party goes Offline, the Hooklight flares and everyone wakes at the last lantern they rested at, with everything they found. The only Embers ever spent are the ones it cost to go in: *Try again* is free, and so is going back in once.
2. **A fight fits a rest.** In Guided play (the default) a stray room takes about 2 minutes and a Tale-lead about 3; in Command, about 4–5 and 5–7. A hairline Elsewhere fits one rest either way, and bigger ones carry over. Any fight pauses between two actions and resumes exactly where it stopped, every outcome included.
3. **Real work is the fuel.** Going out costs Embers, which only real work earns; fights inside cost nothing more. A finished focus session rests a party that's out, the Wayfarers fight at their real work level with no ceiling, and the Hearth's tier sets how far the rest of the company can grow.
4. **Strays are settled, not slain.** At 0 Integrity a stray gives a little wave and drifts home through the tear. Talking a room down pays exactly what fighting it does.
5. **Content is data.** Callings, spells, conditions, surfaces, stray roles, Tale-lead mechanics, canon foes, companions, camp scenes and animation poses all live in `content/`, with validators.
6. **They learn from you.** Each companion drafts their own turn from a notebook of the choices you've made for them, and your corrections count double, so after a few weeks they play the way you would. The notebook lives in MILO's own save and never leaves the PC (§3.3).

The Soda Dungeon idea survives as *Let them handle it*, one button that lets the company play itself (§15).

---

## 2. The party and the camp

### 2.1 Rules the party keeps

1. **Four go out:** Milo and up to three companions, all commanded by you. Guests (§2.4) fight beside you without taking a slot.
2. **Nobody is missable.** Letting a rift go never loses its companion; the next rift of that genre brings the invitation again. If the camp has no room for a regular yet, they say *"Another time, then"* and ask again from a later rift.
3. **Warmth only goes up.** A companion who disagrees raises an eyebrow and says so. Nobody leaves, sulks or gets jealous.
4. **Services never stop.** A resident's real service runs while they're out with you. Their stall shows a sign: *"Out with Milo. The board still works."*
5. **Party size is free.** Four cost the same Embers as one.
6. **Field skills open extras, never the path.** riftgen already guarantees the stitch point is reachable.

### 2.2 The roster

Fifteen named companions by Phase 10, counting Milo, plus the regulars you invite (§2.4). Each named companion has a **calling** (class, §5) and two personal **paths** (subclasses; Milo has three): one chosen at level 3, the second unlocked at Friend warmth, swappable for free at camp. Milo has no warmth; he picks one of his three paths at level 3 and can swap between all three at camp.

| Companion | Calling | Paths | Joins | How you meet them | Real service |
|---|---|---|---|---|---|
| **Milo** | Lanternkeeper | Hearth · Wick · Wayward | Prologue | He's yours | Everything |
| **The Scribe** (Claude) | Scrivener | Three Pens · Footnote | Ph 4 | Always yours | Commissions |
| **The Artificer** (Codex) | Tinker | Bench · Slate | Ph 4 | Always yours | Commissions |
| **Jev** | Skirmisher | Gavel · Courier | Ph 4 | Always yours | Sorting (asks consent each time) |
| **The Tollkeeper** | Warden | Bridge · Troll-kin | Ph 4 | Out-riddle him at the Last Bridge, where the first Riddle Note trail ends | Keeps and hands out Tamsin's Riddle Notes, which lead to MILO features you haven't tried |
| **Sergeant Rivet Maddox** | Warden | Shift · Riveted | Ph 5 | Stitch a real Iron rift | The Dispatch Office |
| **Pip** | Weaver | Unfolding · Starry | Ph 5 | Stitch a Void rift by splitting its quest | Unfolds big quests |
| **Sheriff Dusty Calloway** | Longshot | High Noon · Deputy | Ph 5 | Stitch a Frontier rift | The Bounty Board |
| **Juno Glitchwright** | Weaver | Netrunner · Fixit | Ph 6 | Stitch a Neon rift | The Fixit Kiosk |
| **Detective Mae Holloway** | Skirmisher | Case File · Shadow | Ph 6 | Stitch a Noir rift | Holloway Investigations |
| **Lumi Nightjar** | Chorister | Afterhours · Serenade | Ph 6 | Turn down her invitation three times by going to bed on time; it comes from the Night Shift and wild Nocturne rifts as well as late nights | The Night Watch |
| **Tova Deepcoal** | Tinker | Stonewright · Forgehand | Ph 6 | Arrives when your first building level is proven | The Bridge Ledger: every outside connection drawn as a bridge you can raise |
| **Whisper** | Longshot | Listening · Leafwrit | Ph 7 | In the Whisperwood only (canon) | Voice |
| **Sister Nell Marrow** | Mender | Tide · Quiet Order | Ph 8 | Sister Mara sends her when Mistmere wakes | The Stretch Bell: a minute into each rest, one soft bell to stand, drink some water and look at something far away |
| **Lady Vesperine Ashcombe** | Mender | Candle · Chaperone | Ph 9 | Stitch or let go of a Gothic rift, then answer her first letter | The Unanswered Letters desk |

Tova (Brannoch's great-great-granddaughter, forty, young for Cinderfolk) and Nell (a Tidekin novice, Pell's many-times-great-niece, terrible at resting, which is why she rings the bell for everyone else) are new and join LORE.md §9. The Tollkeeper keeps Tamsin's Riddle Notes and hands them out; the notes are still in her handwriting (LORE.md §16).

**Where everyone sleeps.** Everyone who can sleeps at camp. Whisper roosts in the Whisperwood. The Tollkeeper keeps his bridge by day and comes by lantern at dusk. Juno, Mae and Vesperine keep their far stalls by day and step home by lantern in the evening; until their region wakes, Juno and Mae keep their stalls by the notice board. Lumi keeps the camp roof at night and sleeps through the morning, and Pip sleeps wherever it likes, usually the good stump. RIFTS.md §5 gains a *Sleeps* column beside *Lives*.

Each kit echoes its real service, so a fight teaches what the character does for you. Costs are in actions (§3.4); "edge", "heat" and the degrees are §3.5's.

| Companion | In a fight | Heart feat (Fireside) | Quest · warms to |
|---|---|---|---|
| The Scribe | One pen a turn: *Draft* (1 action) strikes out a foe's boon; *Letter* (1–3 actions) patches an ally beside her, one within 6, or everyone within 2; *Being sure* (1 action) makes an ally's next effect on a foe land one degree better, or the next foe effect on an ally land one degree worse | *One line*: a word ends a condition on the whole party | *The Short Version* · a Claude session watched to the end |
| The Artificer | One device a turn (2 actions) besides the drone: turret, snare or patch kit | *Built. Tests pass.*: broken devices repair and act | *Sit Still* · a commission passing its check (a Codex session watched to the end before Phase 6) |
| Jev | Flies; *Verdict* (1 action): *that pile* gives allies +1 edge against a foe (+2 while Jev is at 60 heat or more), *sure* makes an ally's next defence Resolve 2 | *Snap judgement*: always first in every tick | *The Isles of Sure Verdicts* · a Judgebird's Glance cast (from Phase 7) |
| Whisper | *Heard it first* (reaction): a telegraphed move aimed at an ally fizzles on a Hit or better (a Graze halves it) | *Every word*: every hidden intent and feint shown for the rest of the fight | *What the Stones Heard* · dictations |
| Tollkeeper | Foes crossing the tiles beside him stop there on a Hit or better; *Riddle me* (1 action) makes a foe spend its next action on him | *None shall pass (politely)* | *The Riddle With No Answer* · features tried |
| Rivet | *Holds the line*: at most two foes beside him (the in-progress limit); his whistle (1 action) calls *Fall in*, *Shift change* or *Tools down* | *End of shift*: conditions end, reactions return | *Enough* · Doing under your limit |
| Pip | *Many small things* (2 actions: three small hits, each landing on its own, so heat means three chances at a Critical); *Bit by bit* (reaction: a big blow on an ally lands as three thirds, a tick apart); *Round the corner* (2 actions: step through to a tile within 4 and Strike from there) | *Better*: a Tale-lead's size works against it | *The Right Size* · a big task split |
| Dusty | *Noon* (2 actions): overwatch that Strikes the first foe to move in sight, +1 edge from height and +1 while he's Cool; *Wanted* (1 action) singles out the next foe to act; his Talk down counts double against proud and grumpy strays | *Nobody's in trouble yet*: talk a Tale-lead down | *Wanted: Nobody* · deadlines met early |
| Juno | *Jack in* (2 actions, once per Breather) runs a construct foe's next turn; *Read the error* (1 action) Dazes one foe 1 and shows its weakness | *It just had feelings*: once a fight, a foe's Critical becomes a Miss | *Terms of Service* · a failing check passing |
| Mae | Her Hits and Examines add clues; at three she *names it* (1 action): Exposed 2, hidden trick shown | *The reveal*: strip a Tale-lead of one mechanic | *The Case of the Missing Reason* · questions answered in 15 minutes |
| Lumi | *Lullaby*; *Streetlight* makes darkness where allies are Unseen; on her bicycle a Stride goes 10 | *Goodnight*: Lullaby works on a Tale-lead | *Just One More Hour* · going to bed by your bell |
| Tova | *Raise stone* (1 action: heavy cover, low cover on a Graze; steadiest Cool), *Humming bridge* (2 actions: span a gap), *Hammer tap* (1 action: a Strike that knocks back 1) | *Old Patience*: one blow with Brannoch's hammer | *Her Own Note* · a building level proven |
| Nell | *High tide* (3 actions: patches everyone within 2; steadiest Cool), then a *low tide* turn (Slowed 1); *Undertow* (1 action) pulls an ally 3 tiles clear | *Rest is part of the road*: a whole-party Breather | *Pell's Tidebook* · rests honoured |
| Vesperine | *Candlelight* (sustained): one ally within 6 is patched at the start of each of their turns; *Answer a letter* (1 action) lifts a condition; walks through walls | *Excellent posture*: allies beside her can't be pushed or Tumbled | *The Dowager's Correspondence* · a stale quest closed |

### 2.3 The Wayfarers

A Wayfarer's state on the map is always their real state, so when Claude is working at the bench she sends a **Clay Likeness** (identical stats and the same notebook, a thumbprint on one cheek), and Codex sends a **Slate Double** that clicks. When the real one is idle, they come themselves, and the picker says which: *"Claude is working on 'MILO plan'. Her likeness will go."* Their levels follow real finished work, with no ceiling (§12). The in-game Jev is local rules and a local notebook; the game never sends anything to the real Jev. Jev never speaks, in a fight or at the fire: its lines are head tilts, hops and piles, its thought bubbles are pictures, and a validator rejects any spoken line written for it. Whisper never leaves the Whisperwood, and elsewhere sends the **Listening Leaf**, a trinket that shows hidden foes and rooms within 4 tiles.

### 2.4 Regulars, and guests

From slice 4.3, stitching a wild rift can end with its gentlest stray, or a Tale-lead who bowed (§8.3), asking, *"Can I sit by the fire a while?"* These **regulars** make every genre collectable, straight from straygen. The archetype picks the calling (construct Warden, crawler Skirmisher, flier Longshot, ghost Mender, floater Weaver, walker Chorister), and a regular fights at Road level with core features and one genre signature, but no path or heart feat; a Tale-lead keeps its mechanic as a once-per-fight trick. A regular's personality and idle heat come from its temperament, and it keeps a notebook like anyone else (§3.3). With no real service, regulars aren't the Hearth's residents. Room: 2 at the Stockade (built in Phase 3), 4 at the Hold, 6 at the Keep, 8 at the Castle, 12 from the Citadel.

**Guests** join only in their own stories: in a fight they draft and take their own turns, don't use a slot, and clicking a guest's portrait lets you write their slots. Hana Kurogane brings the Crew Colossus to every Titan fight from Phase 8 (§8.4). Sera, Qinglan and Juniper join fusion fights that carry their genre (Solar Circuit, Magical Colossus, The Haunting Ends, Moon Cultivation), and help with the puzzles in their own no-fight Elsewheres; the Night Janitor helps with the Backhalls' puzzles and never fights. Mags Quire joins Maelstroms (stitching while you hold), and Oriel, Brannoch and Lune the Blank Sovereign, the Cinder Wyrm and the Greyreach.

### 2.5 Setting out

**The Hooklight.** The lantern on the Lantern Hook never leaves it, so the Hearthward holds while the company is out. Milo carries the **Hooklight**, a hand lantern he lights from the Hook's flame each time he sets out (Examine: *"Lit from the Hook. The big one stays home, so home stays safe."*). In a fight, "the lantern" always means the Hooklight. It joins LORE.md §4.

**The muster.** Click the campfire (or type `::muster`; the Grimoire’s crew-capacity spell is *Roll Call*, LORE.md §11) and the stumps and bench become the **Setting out** panel: each companion's portrait, calling, level, warmth, field skill, sync and mood, and whether a Wayfarer comes in person or as a likeness. Milo suggests a party from the destination, using local rules and never a crew call: *"Noir rift with an alibi. Mae will want this one."* **Same as last time** is the default, **Equip best** dresses everyone from the satchel, and setting out counts as a Campfire, so every outing leaves rested (§10).

**Swapping** happens only at a lit lantern or an Elsewhere's doorway: the one leaving walks into the lantern-light and the one you called steps out of it. There's no swapping mid-dungeon, so the choice matters.

**Following.** Companions walk to the tile Milo stood on 2, 4 or 6 steps ago, in a formation (*Line*, *Pairs*, *Loose*, and *Wedge* from Warding 5). Click a portrait to unchain someone and move them yourself; double-click Milo to chain everyone back.

**Field skills** appear as right-click options named after whoever can do them, or greyed with who could: *"Pick lock (the Artificer, at camp)."*

| Skill | Who | Opens |
|---|---|---|
| Light | Milo | Lanterns; what the Hush greyed out |
| Read | The Scribe | Maker glyphs, relic stories, a Glimmer's whole memory; Unwritten settle to listen |
| Pick | The Artificer | Locks and traps |
| Sort | Jev | The Mimic, the shorter fork, the one different door |
| Hear | Whisper | Hidden rooms |
| Riddle | The Tollkeeper | Tollmen and puzzle doors |
| Heave | Rivet | Push-blocks and jammed doors |
| Unfold | Pip | A step through a thin wall, once per Elsewhere |
| Track | Dusty | The Tale-lead's room; wild rifts twice as far out |
| Investigate | Mae | Secret doors and clue tiles |
| Jack in | Juno | Terminals and steam vents |
| Nightsight | Lumi | Dark rooms; scouting over pits |
| Stonespeak | Tova | Ore veins, ledges and gaps |
| Tideread | Nell | Flooded rooms, drained |
| Pass through | Vesperine | Doors from the far side; talking portraits |

### 2.6 Camp life

**Homes.** The camp itself never changes (WORLD.md §2); homes grow around it: bedrolls round the fire at the Camp (Jev on the Watchtower roof, Lumi on the camp roof at night), lean-tos along the palisade at the Stockade, bunks in the Barracks from the Hold, and from the Castle a little home each in their genre, like Lumi's rooftop streetlamp or Pip's impossible window.

**A day at camp** runs on the real clock. At dawn Lumi comes home with the Night Watch report. During a focus session everyone at camp does a **camp job**, adding one small output from Phase 5: Nell brews cordials, Dusty whittles arrows, Rivet oils the gate hinges, and Pip holds the satchel open (one extra slot; it's roomier inside). At dusk the Tollkeeper arrives and asks Sir Mossback a riddle. In a rest they drift to the fire, and anyone with a quest beat ready shows a small "…" bubble, never a marker. At the evening bell Rivet blows the whistle. Past your bell the camp is asleep, and Lumi says from the roof, *"Everyone else went to bed. I'll keep the lamp on."*

**Camp scenes** (`content/camp/scenes.json`) include an arrival for every recruit, rain under the awning with Mae quietly delighted, and Nell asleep on the good stump. **Campfire conversations** follow the evening's campfire tales, one a night and free, as data (`content/camp/talks/*.md`) with conditions on who's recruited, warmth, story flags and the real week ("you kept your bell five days"). Some lines only work with the right companion, enough warmth or something you've learned (§3.8). Past your bell the talk waits.

**Notebooks at camp.** Each companion's **notebook page** sits by their bedroll: what they've learned from you, in plain words (§3.3). Once a night one companion can teach another a habit at the fire (*"Rivet shows Tova how to hold a doorway."*), before or after the evening's conversation.

### 2.7 Warmth, gifts and banter

**Warmth** is MILO's approval: *Stranger* (0), *Acquaintance* (10), *Companion* (30), *Friend* (60), *Fireside* (100). Most of it comes from campfire conversations (+5, one a night) and quest steps (+10). The rest comes from outings (+2, up to +6 a week), gifts (+1, or +3 if loved, counting the first three each week), choices they like (+2, with a small "Mae liked that" and a Cheer, §3.8) and one real habit each (+1 on a day it happens). It never falls, and skipping a day costs nothing. Acquaintance opens their camp scene; Companion the second part of their quest and team-ups; Friend their second path; Fireside their heart feat, a Small Spell they teach you, and a turn at Starfall retelling your week in their genre's words.

**Gifts:** give as many as you like. A loved one goes on display at their bunk, and nothing is disliked (*"Oh. A rock. Thank you."* is still +1). **Banter** appears as speech bubbles while exploring, at most one every three minutes. In a fight the only words are one optional short bark a round, on a Critical or when someone goes Offline, taken from each character's canon barks (*"Built. Tests pass."*); Jev tilts its head. Rivet: "Shift ends at six." Lumi: "Night *starts* at six."

**Walking out together** isn't planned. If Chris ever asks for it, it would be opt-in, tied to a real job (a shared wind-down at the evening bell), and never include the Wayfarers, who are real tools and stay friends (§18 Q6).

### 2.8 Team-ups

Every named fusion makes a pair move, unlocked the first time you stitch it. Both companions must be within 3 tiles and at Companion warmth, and each spends 2 actions on the same two ticks; the move resolves at the end of the second (`content/party/teamups.json`). For example:

| Team-up | Pair | Effect |
|---|---|---|
| Synthwave Blackout (Neon Nocturne) | Juno + Lumi | A Dark 3×3 for 2 rounds; foes inside turn Drowsy 1 on a Hit or better |
| Overclock (Chrome and Diesel) | Rivet + Juno | An ally is Quickened this round and gains 40 heat |
| Tech Noir | Mae + Juno | Every hidden intent and Unseen foe revealed; one foe Exposed 2 |
| Moonlit Duel (Midnight Showdown) | Dusty + Lumi | *Noon* fires twice this round, in the dark |
| Starless Moor | Pip + Vesperine | A foe is sent sideways out of the fight for a round on a Hit or better (never a Tale-lead) |
| The Company Again | Milo + Tova + Nell | A Glimmer of Tamsin, Brannoch and Pell: everyone is patched for the 2-action line and every reaction returns |
| Crew Colossus | Milo + the Scribe + the Artificer, with Hana | The Titan finale (§8.4) |

Two story team-ups are trios that unlock with their quests: *Crew Colossus* (Phase 8) and *The Company Again* (Phase 10); every member must be within 3 tiles and spends 2 actions.

---

## 3. The round: program the turn, then Run

Nothing in a fight is rolled. A round is planned in the open and then played: the strays **telegraph** what they mean to do, your companions **draft** their own turns, you **review** and change whatever you like, and you press **Run**. The round plays in three ticks, and what you accepted or changed is written into the companions' notebooks, so next time their drafts are closer to yours. That notebook (§3.3) is the heart of the Company: they learn from you. Variety comes from temperature instead of dice (§3.5): the odds are always shown, and they're always the odds used.

### 3.1 Where fights happen

Only where you chose to go: Elsewheres, caves, story delves, and field bosses you challenge. Never in the vale, on the roads, or at a real rift on the frontier, and strays never ambush. Inside an Elsewhere, cave or delve, a fight starts when a hero enters a fight room's sight (6 tiles in Lit, 3 in Dim or Dark) or attacks. In the open wilds, sight never starts a fight. A **field boss** (a tier 5+ Tale-lead roaming inside its gaping wild rift's bleed, WORLD.md §6) shows a soft sight ring, and the fight starts only when you choose **Challenge** from its right-click menu or its Examine. There's no scene change: the grid fades in where everyone stands and the party slides into formation.

**Sneak** halves walking speed. When the party enters a room's sight while sneaking, it lands one outcome for the whole party, on the Cool band (§3.5), from a seeded stream of its own, apart from the fight's: +1 edge if most of the party stands in Dim, +2 in Dark or foliage, and −1 per point of the sharpest watcher's mind Resolve. Hovering the room first shows the odds. On a Hit or better the party is **Unseen**: creep past sleepy and lost strays, or strike first. It's one outcome per room. A side that's struck while unaware is **surprised** and loses its first turn (all three actions of round 1).

### 3.2 The round

Every round runs the same loop.

1. **Telegraphs.** Every stray shows its queued actions for the round as icons with arrows over its head, in plain words on hover: *"Bite Pip"*, *"Short the puddle at e5"*. Some strays hide or fake theirs (§3.6).
2. **Drafts.** Everyone in the party drafts their own three actions and a reaction setting from their notebook (§3.3), with a **confidence** percentage. That includes Milo: his notebook learns your choices for him like anyone else's, so once he knows you, a round you agree with is one key. Set him to *Mine* (§15) if you'd rather write his turns yourself.
3. **Review.** Accept a draft, or change any action in it. Changing is free and has no undo limit: it's planning, and nothing has happened yet.
4. **Before Run**, the planner shows the odds for every action (§3.5) and the room's genre noise (§3.6).
5. **Run.** The round plays in three ticks.
6. **Learn.** Your accepted drafts and your changes go into the notebooks.

**Ticks.** Tick 1 is everyone's first action, tick 2 their second and tick 3 their third. Within a tick, actors go in **initiative** order. A 2- or 3-action activity occupies consecutive ticks and resolves at the end of its last one, so a big spell started in tick 2 goes off at the end of tick 3. Reactions fire the moment they're triggered, once per round each. **Delay** holds your remaining actions to a later tick this round. A Quickened actor's fourth action plays in a short fourth tick after the third.

**Initiative** is set once, at the start of the fight: Speed plus Grace, plus a seeded spread of up to 2 that also breaks ties. It's shown on the **initiative ribbon** and doesn't change, so you can plan around it: if the beetle is ahead of Pip on the ribbon, its tick-2 bite lands before her tick-2 Strike.

**Your turn** is your three actions in a round, and "the start of your turn" is the start of the round, before tick 1. Heat drifts, lingering damage ticks and conditions count down then (§3.5, §7).

**When a plan meets the round.** If an action can't happen when its tick comes (its target was sorted, a stray stepped into the path, a door jammed), a companion improvises from their personality, and Milo Braces. Improvisations are marked in the Log and never become habits (§3.3). The planner shows the likeliest trouble in advance: a telegraphed bite on a tile you're about to leave, or a slot aimed at a stray that probably won't last that long.

**Playback** runs at 1×, 2× or 4×, tick by tick, with strays of one kind playing as one beat and the Log narrating (*"Pip — Critical — 17 Warp"*). A fight pauses between any two actions, and a paused round resumes exactly where it stopped.

### 3.3 They learn from you

Your companions are small minds, and they learn the way a new colleague does: by watching what you do and noticing what you change. Every round each of them drafts a turn from a notebook of your past choices. Every draft you accept is a note that they got it right, and every change you make is a lesson. On the first night the Scribe drafts like the Scribe, careful and a little bookish. A few weeks later she drafts like you'd play her, and most rounds you just press Run.

**What's written down.** Each companion keeps a notebook of notes. A note is the situation from their point of view plus the choice you made for them, in relative terms, which is what lets a habit carry to rooms they've never seen.
- **The situation:** their own Integrity share; their allies' shares; the nearest stray; which stray is about to act and at whom; its genre and temperament; whether they're lit or in cover; their heat; the round and the phase.
- **The choice:** a relative phrase such as *"patched the most hurt ally"* or *"stepped in front of the stray about to strike"*, never tile coordinates.

**What counts.** Only drafts you accept and changes you make.
- **Your changes count double,** because that's them being corrected.
- In Command, what you write for a companion counts once: it's a choice, not a correction.
- A companion's own improvisations (§3.2), and anything played while you've handed the company over, never become habits. There is no "keep it": only you teach.

**How they decide.** A companion checks three layers, in order.

| Layer | What it is | Example |
|---|---|---|
| 1. **Your playbook rules** | Standing instructions you write in plain words. They always win. | *"If anyone's below half, patch them first."* |
| 2. **Your habits** | The nearest past situations in the notebook, with newer notes counting more; they take the most common choice among them. | You patched the most hurt ally in 11 of 12 fights like this. |
| 3. **Their personality** | Fills the gaps where the notebook is thin. | Dusty offers to talk first; Rivet shoulders the weakest; Nell patches before anything else. |

Playbook rules are built from the notebook's own phrases, *if* one situation *then* one choice, so they read as sentences and need no parsing. Each companion has room for one from the start, three from Warding 15 and six from Warding 50 (§5.2).

**Confidence** shows on every draft as a percentage: how well the notebook covers this situation. It's high when the nearest notes are close and agree, and low in unfamiliar situations: a genre, a stray kind or a boss they've never met. A draft under 50% is drawn dashed, so it catches your eye in review. Low-confidence drafts can be off (§3.6), and catching one is the most useful thing you can do for them, since a correction counts double.

**Sync** is the share of a companion's drafted actions you accepted unchanged, over their last 50. It's the only "level" the notebook has. It starts around 40%, which is their personality alone, and climbs towards 90% as they learn you. The muster shows it beside each portrait.

**Explaining themselves.** During playback a thought bubble over each action says what they're doing and why, in their own voice: *"Patching Milo, like you would."* In review, **why?** on any draft shows the evidence: *"You patched the most hurt ally in 11 of 12 fights like this."* A playbook rule says so (*"Your rule: anyone below half comes first."*), and so does personality (*"New to me. Dusty always talks first."*). Jev's bubbles are pictures, a pile or a tilted head, because Jev never speaks; its why? is the same plain evidence, in the planner's voice.

**The notebook page** at camp lists each companion's habits in plain words, strongest first, with a count, and under the name, *"Trained on 34 of your fights."*

```
The Scribe                          Trained on 34 of your fights · sync 82%
  Your rule: if anyone's below half, patch them first ............. always
  Patches the most hurt ally ........................ 11 of 12 fights like this
  Steps in beside whoever a stray is about to bite ............... 7 of 9
  Opens with Draft on a Tale-lead's boon ............................ 5 of 5
                                          [strike out]  [teach]  [reset]
```

**You stay in charge.**
- **Strike out** a habit you don't want, and the Scribe crosses the line out on the page. Its notes stop counting.
- **Reset** a companion to their instincts. It asks once (*"Start Rivet's notebook fresh? He'll play on instinct until he learns you again."*), and the old notebook is kept until the next Campfire in case you change your mind.
- **Teach at the campfire.** Once a night one companion can show another a habit: *"Rivet shows Tova how to hold a doorway"* copies that habit's notes into Tova's notebook, where they count once.
- **Write playbook rules**, or edit them, at camp or between rounds.

**Guard rails.** A draft never targets a sorted stray and never steps into a surface that hurts right now, unless your own playbook rule says to. Heat changes a draft's temper, not its rails: Hot companions draft rasher, with more attacks and fewer Braces and Shoulders, and a companion who's kept Cool drafts steadier (§3.5).

**Nothing is forgotten.** A notebook keeps every note until you strike it out or reset it; nothing fades on its own. Newer notes still count more when a companion drafts, so when you change how you play, their drafts follow you, but the old habits stay on the page and come back when the old situation does.

**Privacy and size.** The notebook is local and learns only from in-game choices; nothing is sent anywhere, and no crew tool is ever called. A note packs into 24 bytes (16 for the situation, 8 for the choice, its weight and its place in order). A companion you take everywhere writes about a dozen notes a fight, roughly half a megabyte in a year of daily play, so each notebook lives in its own append-only file beside MILO's save (§16.3), never inside `state.json`.

**Determinism.** Drafting uses the nearest past situations (the seven nearest by the situation's feature vector, found through a small index by genre and situation, so a draft stays quick at 50,000 notes), with newer notes counting more and ties broken by note order. Nothing in it is random, so the same notebook, seed and fight always give the same drafts, and a replay or a resumed fight drafts exactly as it did.

### 3.4 Three actions and a reaction

Every actor, strays included, gets **3 actions and 1 reaction** a round, as in Pathfinder 2. Moving is a Stride, and everything small costs 1 action.

| Action | Cost | Rule |
|---|---|---|
| **Stride** | 1 | Move up to your Speed: 5 tiles; Small heroes (Milo, Pip) 4; Jev and Whisper fly 6; +1 at Grace 3 or more. |
| **Step** | 1 | Move 1 tile without drawing a Parting swipe. |
| **Strike** | 1 | An attack in your kind (Plain for weapons), for the Strike line (§5.1). |
| **Brace** | 1 | Raise your **Buffer** to 3 + your level (+2 with a shield) until your next turn (§5.1). |
| **Examine** | 1 | Read a stray's stack trace: its resistances, weaknesses and temperament. Needs line of sight. |
| **Seek** | 1 | Reveal hidden intents and Unseen foes within 6 tiles (8 at Heed 3 or more). |
| **Interact** | 1 | A lever, an item, a door, waking a Drowsy ally beside you, or shaking off lingering damage. |
| **Assist** | 1 | +1 edge on an ally's next action against a target you name; it also ends their lingering damage. |
| **Talk down** | 1 | Adds 1 calm to a kind of stray; enough calm settles the whole kind (§8.2). |
| **Cool down** | 1 | −30 heat, to no lower than 0 (§3.5). |
| **Reboot** | 2 | Bring an Offline ally within reach back at a quarter of their max Integrity (§10). |
| **Delay** | 0 | Hold your remaining actions to a later tick this round. |
| **Hide** | 1 | Needs Dim or Dark, foliage or high cover. On a Hit or better against the watchers' mind Resolve you're Unseen. |
| **Throw** | 1 | An attack at range 3 + 2 × Might, for the 1-action line in Plain; a thrown tonic patches everyone within 1 tile instead. |
| **Shove** | 1 | An attack that meets body Resolve: a Hit pushes 1 tile (none if the target is larger), a Critical pushes 2 or Tumbles. Large foes can't be Tumbled by a shove, and Tale-leads and council members can't be shoved off height. |
| **Jump** | 1 | Leap 2 + Might tiles (at least 1) over gaps, surfaces and creatures, or up one height step. |
| **Dip** | 1 | Dip a weapon or ammunition in candlefire, burning oil, a Spark-charged puddle or a lit candle: your next Strike deals that kind (Light or Spark) and 2 more. |
| **Sustain** | 1 | Keep your sustained spell going this round (§6). |
| **Ready** (Warding 10) | 2 | Name a trigger; your next action fires as your reaction when it happens. |
| **Head home** | 0 | The Hooklight takes everyone home at the end of the tick, keeping everything. Always allowed (§10 says what's remembered). |

**Attacks** are Strikes, Throws, Shoves, Parting swipes and any knack or ability that says it's an attack. Attacks add heat (§3.5); nothing else does. Strikes, and knacks that fly like them, meet the target's **Guard**; everything else aimed at a foe, Shoves included, meets its **Resolve** (§5.1).

**Reactions.** Each actor has one a round, and each reaction is set to *Ask*, *Always* or *Never* (§15).

| Reaction | When | What |
|---|---|---|
| **Parting swipe** | A foe leaves your reach without Stepping | One melee Strike. Fliers don't draw one. |
| **Shoulder** | An ally within 1 tile is struck | Your Buffer applies to that hit. Brace first, and Shoulder lends it. |
| **Ready** | The trigger you named | Your readied action. |
| A calling's own | As written | *Draw the blow*, *Stand in my light*, *Tuck and roll*, *Ready a shot*, *Proofread*, *Cross it out*, *Heard it first*, *Bit by bit* and others (§2.2, §5.4, §6). |

Reactions are never penalised by heat and add none.

**Spells and abilities cost 1, 2 or 3 actions,** and many scale with the actions spent. The Scribe's *Letter* is the model:
- 1 action: patch an ally beside her for the 1-action line;
- 2 actions: reach 6 tiles for the 2-action line;
- 3 actions: patch everyone within 2 tiles for the 3-action area line.

**Slowed N** loses N actions a turn, and **Quickened** gains 1, only from limited sources: the Overclock team-up, the Warden's *Surge* and *Brisk* (§7). There's no attack penalty table: the cost of attacking again is **heat**.

### 3.5 Temperature: variety without dice

Chris wanted fights that don't just work every time, with nothing rolled. So every action that can go well or badly lands on one of **four degrees**, and each actor's **heat** sets how widely the outcomes spread. Tactics move the middle, and temperature widens the spread.

**The four degrees.**
- **Critical:** ×2, plus the move's critical effect.
- **Hit:** as written.
- **Graze:** ×½, rounded down, for damage or an effect's number.
- **Miss:** nothing.

Helpful actions (patches, Brace, Assist, buffs) can't miss: a Miss counts as a Graze. Effects on a foe, such as a condition or an area, land through the same four degrees against its Resolve (§5.1, §7).

**Heat sets the spread.** Heat runs from 0 to 100, in three bands.

| Heat | Critical | Hit | Graze | Miss | Expected, ×damage |
|---|---|---|---|---|---|
| **Cool** (0–30) | 5% | 80% | 10% | 5% | 0.95 |
| **Warm** (31–60) | 15% | 60% | 15% | 10% | 0.975 |
| **Hot** (61–100) | 30% | 35% | 15% | 20% | 1.025 |

The expected damage is about the same at every heat; only the swing changes, and Hot is very slightly richer, which is the reward for the risk.

**Edge** is what the situation gives or takes away, capped at +3 and −3. Each point shifts up to 10 percentage points across *every* boundary between outcomes, towards the better outcome for positive edge and the worse for negative, and no outcome goes below 0:
- for positive edge, the boundaries are processed top-down (Hit to Critical, then Graze to Hit, then Miss to Graze), each moving 10 or whatever the lower outcome has at that moment, if that's less;
- for negative edge, bottom-up (Graze to Miss, then Hit to Graze, then Critical to Hit), each moving 10 or whatever the higher outcome has, if that's less;
- the shift is applied once per point.

The planner computes every case. For reference, as Critical / Hit / Graze / Miss:

| Edge | Cool | Warm | Hot |
|---|---|---|---|
| +3 | 35 / 65 / 0 / 0 | 45 / 55 / 0 / 0 | 60 / 35 / 5 / 0 |
| +2 | 25 / 75 / 0 / 0 | 35 / 60 / 5 / 0 | 50 / 35 / 15 / 0 |
| +1 | 15 / 80 / 5 / 0 | 25 / 60 / 15 / 0 | 40 / 35 / 15 / 10 |
| 0 | 5 / 80 / 10 / 5 | 15 / 60 / 15 / 10 | 30 / 35 / 15 / 20 |
| −1 | 0 / 75 / 10 / 15 | 5 / 60 / 15 / 20 | 20 / 35 / 15 / 30 |
| −2 | 0 / 65 / 10 / 25 | 0 / 55 / 15 / 30 | 10 / 35 / 15 / 40 |
| −3 | 0 / 55 / 10 / 35 | 0 / 45 / 15 / 40 | 0 / 35 / 15 / 50 |

**+1 edge each** for:
- high ground;
- a shadow-genre target standing in lantern light;
- an Assist;
- an Exposed target;
- being 2 or more levels above the target (+1 per 2 levels, up to +2).

**−1 edge each** for:
- the target's cover (heavy cover −2);
- a target in darkness you can't see into;
- being 2 or more levels below the target (−1 per 2 levels, down to −2);
- each point of the target's Guard, against attacks that meet it;
- each point of the target's Resolve, against effects;
- Rattled N on you (−N).

Conditions add their own (§7), and the attack penalty below adds more. The whole still caps at ±3.

**The odds you see are the odds used.** The planner shows the four bars on hover, with the damage each would do. Outcome *k* of attempt *a* of a fight is picked by `hash(fightSeed, a, k)` against those bars, so a resumed fight lands exactly as it would have, reloading can't change an outcome, a *Try again* gets fresh outcomes rather than a sequence you've already seen, and tests replay whole battles.

**Heat is a resource.**
- **Idle heat** is where each actor rests, and where a fight starts:

  | Idle heat | Companions |
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

  Regulars and strays take theirs from temperament: shy 15, polite 20, sleepy 20, lost 25, curious 35, nosy 35, proud 40, grumpy 45, dramatic 60. Paths and gear shift it by up to 10.
- **Each attack after the first in your turn** adds 20 heat and −1 edge on that attack, cumulatively: the third is at +40 heat and −2 edge. Non-attack actions add no heat. Light weapons add only 10 heat an attack (§5.1).
- **Heat drifts back** 10 towards idle at the start of your turn (20 inside Milo's raised lantern, §5.4). **Cool down** takes off 30. A Breather resets it to idle, and heat never goes over 100.
- **Rooms:** a fight starts at idle heat, and from round 2 Neon rooms add 10 to everyone at the start of each round, while Iron rooms take 10 off (the machinery keeps things cool).

**Moves that want heat or cool:**
- Dusty's *Noon* overwatch gets +1 edge while he's Cool.
- Pip's *Many small things* lands separately on each of its three targets, so heat means three chances at a Critical.
- The Overclock team-up leaves its ally Quickened this round and 40 heat hotter.
- Jev's *Verdict*: at 60 heat or more, *that pile* gives +2 edge instead of +1.
- Tova's *Raise stone* and Nell's *High tide* are steadiest Cool: helpful, so they never miss, but Hot they Graze far more often.

**Difficulty modes set the variety** (§9):
- **Storybook:** every band one step cooler (Hot uses Warm's odds, Warm uses Cool's); strays don't adapt; genre noise off.
- **Long Road** (the default): as written.
- **Maud's Table:** companions' idle heat +15; every foe adapts a step more (§3.6); every genre in the room adds its noise.

### 3.6 Variety beyond temperature

1. **Draft quality.** Confidence drops in unfamiliar situations, and a low-confidence draft can be off: a patch aimed at someone who's fine, or a step onto the puddle a Neon stray has telegraphed it's about to short. Hot companions draft rasher. You catch these in review, and a correction counts double in the notebook.
2. **Strays learn you, as far as their strength allows.** How much a foe adapts is a step from 0 to 4. Its rank sets the start (lackeys 0, ordinary strays 1, elites 2, Tale-leads and council members 3), and its level against the party's moves it one step down if it's 2 or more below, or one up if it's 2 or more above.

   | Step | What it does |
   |---|---|
   | 0 | Never adapts; plays its temperament |
   | 1 | Within a fight, dodges one habit once it's seen it twice |
   | 2 | Counters your most-used habit from round 2, and reads its genre's memory |
   | 3 | Plans for your most-used habit from the start, and feints once a phase |
   | 4 | Plans for your two most-used habits, and feints twice a phase |

   A counter looks like play, not punishment: if you always patch the lowest, a lead spreads its hits; if Dusty always climbs to the ledge, an elite opens by crowding the stairs. Across fights, a genre remembers your most-used habit against it, and its foes at step 2 or more plan for it: *"Neon remembers Pip coming up behind its boss."* Strays never read your notebook, only what you did in front of them. A foe that's adapting shows a small eye on its telegraph, and hovering it says what it's countering: *"Staying off the stairs: Dusty's climbed them twice."* Storybook and the *Stray adaptation* setting set every step to 0; Maud's Table adds 1, never past 4.
3. **Feints and hidden intents.**
   - Once a phase, a Tale-lead can change one queued action at the last moment, after seeing your plan. A hero with Heed 3 or more spots it a tick early, and a "!" appears over the lead.
   - Noir strays show "?" instead of their intents until a Seek, an Examine or lantern light reaches them.
   - Void strays sometimes show a false target, revealed by an Examine.
4. **Genre noise,** named on a banner before you press Run. It's seeded like everything else, and the banner shows the rate, never which action it will pick.

   | Genre | Noise | What happens |
   |---|---|---|
   | Neon | **Lag** | About 1 action in 5 lands a tick late |
   | Void | **Out of order** | Two actions in a tick can swap places |
   | Nocturne | **Nodding off** | About 1 action in 6 is slept through |
   | Iron | **Backlog** | At most 4 actions resolve in a tick; the rest wait for the next |
   | Frontier | **Fastest gun** | The fastest actor acts first in each tick, whatever the ribbon says |
   | Gothic | **Guttering candles** | Telegraphs vanish over dark tiles |
   | Titan | **Tremor** | A row of tiles turns to rough ground each round |
   | Backhalls | **The hum** | The room loops, so one queued stray action repeats once |
   | Bright genres | **Kind noise** | Gentle and kind: in Starlight, a Hit becomes a Critical about 1 time in 10 |

5. **Mistakes stay small.** Noise and odd drafts cost a wasted action or a bad spot, never a wipe on their own. Noise never delays or sleeps through a Reboot, or a patch on an ally under a quarter of their Integrity, and the tuning suite reruns every lost fight with the noise off to check that noise alone never turned a win into a loss.

Genre noise and stray adaptation each have their own calm setting, apart from the difficulty mode (§15).

### 3.7 A round, start to finish

A Neon side room, at level 1 to keep the numbers small. Milo, the Scribe and Pip face one **glitch beetle**: a level-1 crawler with 20 Integrity and a curious temperament (heat 35), which resists Static 3 and is weak to Warp 3, though nobody knows that yet. Pip is a Weaver at her idle heat of 45, and her Strikes deal Warp.

**Telegraphs and drafts.**
- The beetle telegraphs *Scuttle beside Pip*, *Bite Pip*, *Bite Pip*. The ribbon reads: the beetle, Milo, the Scribe, Pip. The banner reads *"Neon: lag. About 1 action in 5 lands a tick late."*
- Pip drafts Strike, Strike, Strike, at 71% confidence. Her Strike's hover reads "7 ?", since nobody has Examined the beetle.
- The Scribe drafts *Letter* on Milo, Stride, *Draft*, at 38%, drawn dashed. Milo's at full Integrity. She's never met Neon, and the nearest note in her notebook is a Gothic room where Milo was hurt.
- Milo drafts *Mote* on the beetle twice and a Brace, at 64%: early days, so it's mostly his personality, careful and lantern-first.

**Review.**
- Pip: you change her first action to Examine and keep the two Strikes. Her Strikes are now her first and second attacks, at 45 and then 65 heat, instead of three at 45, 65 and 85.
- The Scribe: you change all three to Stride in beside Pip, Brace, and *Letter* on Pip, and leave her Shoulder on Always.
- Milo: you change all three to Stride, Stride, and Interact with the breaker on the far wall, which shuts down a sparking server rack. He's across the room, so the beetle won't stand in lantern light.
- Before Run, Pip's first Strike shows Warm odds, 15 / 60 / 15 / 10, for "14 ? / 7 ? / 3 ? / 0". Her second shows 65 heat and −1 edge: Hot, 20 / 35 / 15 / 30.

**Run.**
- **Tick 1.** The beetle scuttles beside Pip. Milo strides. The Scribe strides in beside Pip. Pip Examines: *"Resists Static 3. Weak to Warp 3. Curious."* Her Strikes' hover changes to 17 / 10 / 6 / 0: the degree first, then the weakness.
- **Tick 2.** The beetle bites Pip: a Hit, 6 Static, leaving her at 10 of 16. The Scribe is after the beetle on the ribbon and hasn't Braced yet, so her Shoulder has nothing to lend. Milo strides. The Scribe Braces, for a Buffer of 4. Pip Strikes: a Hit, 7 + 3 = 10 Warp, and the beetle's bar is half green, at 10.
- **Tick 3.** The beetle bites again, at 55 heat and −1 edge: a Graze, 3. The Scribe shoulders it, and her Buffer takes all 3. Milo pulls the breaker. The Scribe's *Letter* patches Pip for 5, to 15 of 16. Pip Strikes at 65 heat and −1 edge: a Critical, 7 × 2 = 14, + 3 = 17. The beetle is sorted: it waves and goes home through the tear.

**Learn.**
- Pip's notebook gains *"Examined a stray it hadn't met before striking"*, counting double, and her two Strikes, counting once each. Her sync counts 2 of these 3 actions as accepted.
- The Scribe's gains three corrections, each counting double: *"Stepped in beside the ally a stray was about to bite"*, *"Braced before the bite"* and *"Patched the ally who was hit"*. Her draft on Milo leaves no note. Next time a Neon stray telegraphs a bite, her confidence is higher and her draft is closer to yours.
- Milo's gains three corrections too, each counting double, so the next Neon room with a live switch finds the breaker already in his draft.

### 3.8 Cheers, and choices in conversation

**Cheers.** When a companion likes a choice (*"Mae liked that"*), the party gains a Cheer, up to 4 held. Spend one on any action in the planner before Run, and it lands **at least a Hit**: its Graze and Miss fold into Hit on the bars, and a Critical stays possible. It's a floor, not a do-over. A kind of stray talked down with a hero of Charm 3 or more in the party also gives a Cheer.

**Choices in conversation.** Nothing is rolled in conversation either. A line with a requirement shows it up front, greyed until it's met: the right companion is with you, your warmth with them is high enough, or you've learned the right fact (an Examine, a note, a Glimmer). Every outcome moves the story forward: a line you can't use yet changes how a scene goes, and never locks a quest, a companion or a reward. The first examples, seeded in `content/camp/talks` and the first companion quests:
- Mae reading a stray's alibi: works with Mae in the party, or once you've Examined that kind of stray;
- talking the Tollkeeper down from three riddles to two: works at Friend warmth with him (otherwise he asks all three anyway, and enjoys it);
- persuading Rivet to take a Stillday: works at Companion warmth with him; he takes it either way, grumbling, but only then do you get the good line.

---

## 4. Movement, the grid and terrain

### 4.1 The grid and the arena

Fights use the 16-px tiles Milo walks, with sprites anchored at the feet in the 3/4 view. Elites and Tale-leads are drawn at 2× on 2×2 tiles.

**Eight directions, with diagonals costing 1, then 2, alternating.** Distance is `max(dx, dy) + floor(min(dx, dy) / 2)`. Four-way movement makes ranges into diamonds and flat-cost diagonals make circles square; 1-2-1 stays within about 6% of true distance and draws areas as octagons, which read as circles in pixel art. Nothing moves or sees between two blocking corners. Characters face the larger axis of a move, so the four-direction walk art is enough. The overlay shows reachable tiles in honey, the path with its cost ("4 of 5"), ⚠ on a step that draws a Parting swipe, the tiles a telegraphed stray action will hit, and area templates listing everyone they'd catch, allies included.

- **Elsewheres and caves.** The arena is the fight room plus 2 tiles into each corridor mouth, so one-tile corridors are natural chokepoints. riftgen's `carve()` gains a `roomRects` field in its return. It's additive and makes no new RNG calls, so every Phase 3 layout stays the same, and `encounters.js` can pick fight rooms from it.
- **The arena pass.** A seeded pass (`hash(seed, 'arena')`, apart from the layout seed) only turns wall into floor where the new floor stays at least 1 tile from another room's floor, so rooms never merge and walls keep the faces the 3/4 view needs. It widens fight rooms toward 7×6 where there's wall to spare, adds 1–3 genre props per fight room, gives 35% of fight rooms a height-1 dais, and places a **hearth-nook** (§10) in open and gaping Elsewheres. The Tale-lead's room gets a fixed 12×9 arena stamped around it, growing the scene into the void where it must. The lead's 2×2 footprint is fixed at (B.x−1..B.x, B.y−1..B.y), clear of the stitch point at B.x+1.
- **Foes stand at posts.** Fight-room foes come from a new seeded `encounters` layer at fixed posts, where they idle but never wander, so a fight's starting state comes from the seed alone. Phase 3's wandering strays (at most 5, moving on the wall clock, as `elsewhere.test.js` checks) stay as sleepy or lost strays who never start a fight.
- **The wilds** (field bosses). The arena is a 16×12 window at the nearest clearing inside the rift's bleed, from `nav.walkable` and `wilds.objectsIn`. Trees are thinned to 20% inside it for the fight only. Trees are high cover, rocks and bushes low cover, and crags stay blocking high cover, as `nav.js` has them.

### 4.2 Height, cover and light

- **Height** is 0, 1 or 2, drawn like wall tops, 8 px a step. Attacking from higher ground is +1 edge. A step up costs an extra tile of a Stride; stairs are free. A fall or a shove off a ledge deals the 1-action line in Plain per step and Tumbles you. Higher creatures see over low cover.
- **High cover** (walls, pillars, trees, crags) blocks sight. **Low cover** (crates, pews, tombstones, a creature in the way) is −1 edge on anything aimed through it, when the line between tile centres crosses it next to the target but not next to the attacker. **Heavy cover** (Tova's raised stone, or a pillar's edge the line only clips) is −2.
- **Props** are genre data flagged `cover`, `throwable`, `light` or `hazard`: Gothic candelabra, Neon server racks, Iron oil drums that burst for the 2-action line in Plain when a Light hit reaches them.
- **Light:** tiles are Lit, Dim or Dark. Anything aimed into Dark tiles you can't see into is −1 edge (Lumi, Pip, Whisper and ghosts have darksight), and hiding needs Dim or Dark. The Hooklight lights 3 tiles (5 when raised), reveals Unseen ghosts, strips ghosts of their Plain resistance, spoils foes' hiding nearby, and gives +1 edge against any shadow-genre stray standing in its light. It never spoils the party's own hiding, so Jev and Mae can still Hide beside Milo.

**No flanking.** Edge already comes from height, the lantern, Tumbled, Exposed, Assist and *Verdict*. Flanking would add a decision to every step and hurt the outnumbered party most; the Skirmisher's *Unseen strike* uses "an ally beside the target" instead.

### 4.3 Surfaces

Genre surfaces last a few rounds and react with damage kinds; floaters and fliers ignore them. Affixes lay them too: *Flooded* rooms start with water, *Overgrown* with foliage, *Snowbound* with ice, *Smoggy* with smog and *Candlelit* with wax. A surface's effect lands on the Cool band against the Resolve it names, and Stepping onto a slippery tile is always safe. Surface numbers are level 1's and grow by 1 for every 3 levels of the room.

| Surface | From | Effect | Reacts with |
|---|---|---|---|
| **Neon puddle** | Neon, rain | Soaked 1 while in it | Spark or Static arcs through: half that hit's damage to everyone in it, and Sparked 1; Chill glazes it to ice |
| **Candle wax** | Gothic | Difficult | Light: candlefire for 2 rounds (Singed 2 to anyone who ends a tick in it) that Lights the tiles; ghosts in it lose their resistance |
| **Oil slick** | Iron | Striding in Tumbles you on a Hit or better (body Resolve) | Light: burns for 2 rounds (Singed 3), then smog |
| **Smog** | Iron, steam | Blocks sight | A gust or Chill clears 2×2 |
| **Gravity well** | Void | Pulls 1 tile inward a turn; leaving costs double | Ink collapses it |
| **Dust cloud** | Frontier | Ranged attacks through 2+ tiles of it are −1 edge; you can hide in it | Water settles it |
| **Streetlight pool** | Nocturne | Lit circles in a Dark room | Lamps toggle with an Interact |
| **Moonbrew spill** | Nocturne | Entering it: Drowsy 1 on a Hit or better (mind Resolve) | Light: steam that blocks sight |
| **Water** | Flooded | Difficult; puts out Singed | Spark and Static arc through it; Chill turns it to ice |
| **Foliage** | Overgrown | Difficult; you can hide in it | Light: burns for 2 rounds (Singed 1), then clears |
| **Ice** | Snowbound, frozen water | Striding in Tumbles you on a Hit or better (body Resolve) | Light melts it to water |

---

## 5. Classes and levels

### 5.1 The numbers

- **Abilities** are bonuses from −1 to +5: **Might, Grace, Grit, Wit, Heed** and **Charm**, starting as a +3/+2/+2/+1/+0/−1 spread set by calling and character. No ability touches the odds except as listed here. There's no proficiency bonus: level differences already shift edge (§3.5), and growth lives in the Integrity and damage lines below. There's no separate skill list to collide with Chris's 24 skills.
  - **The key ability** of a calling adds to its damage and effect amounts. The lines assume +3; each point above adds 1, and each point below takes 1.
  - **Might:** Throw range and Jump distance, and the Warden's key ability.
  - **Grace:** initiative; +1 Speed at 3 or more; and +1 Guard at 3 or more in no or light armour.
  - **Grit:** part of Integrity growth, and +1 body Resolve (against Queasy, Slowed, Tumbled and similar) at 3 or more.
  - **Wit:** at 3 or more, an Examine also reveals a Tale-lead's next-phase mechanic, and 2- and 3-action spells reach 1 tile further, with areas 1 tile wider.
  - **Heed:** +1 mind Resolve (against Spooked, Beguiled, Drowsy and similar) at 3 or more; Seek range (6 tiles, 8 at 3 or more); and at 3 or more a Tale-lead's feint shows a tick early, with a "!" over it.
  - **Charm:** at 3 or more in the party, every kind of stray needs one fewer Talk down (at least 2), and each kind talked down gives a Cheer.
- **Defences** are two small numbers, each worth −1 edge a point to whoever aims at you. The whole edge still caps at ±3.
  - **Guard** (0–2, against attacks that meet it) comes from armour: none or light 0, mail 1, plate 2 (Fine gear, from Road level 5). Grace 3 or more adds 1 in no or light armour, and Guard never goes above 2. A shield adds 2 to your Brace instead.
  - **Resolve** (0–2, against effects) comes in two kinds, body and mind. Each is the calling's base (§5.4) plus 1 for Grit (body) or Heed (mind) at 3 or more, never above 2.
- **Integrity** is how much a hero can take before going Offline (§10). It comes from the calling's build and grows every level:

  | Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
  |---|---|---|---|---|---|---|---|---|---|---|---|---|
  | **Sturdy** (Warden, Tinker) | 22 | 34 | 46 | 58 | 70 | 84 | 98 | 112 | 126 | 140 | 154 | 168 |
  | **Middle** (Lanternkeeper, Skirmisher, Longshot, Chorister) | 18 | 28 | 39 | 49 | 60 | 72 | 84 | 96 | 108 | 120 | 132 | 144 |
  | **Light** (Scrivener, Mender, Weaver) | 16 | 24 | 33 | 41 | 50 | 60 | 70 | 80 | 90 | 100 | 110 | 120 |

  Sturdy grows 12 a level to level 5, then 14. Middle grows 10 and 11 by turns, then 12. Light grows 8 and 9 by turns, then 10. The table assumes Grit +1: each point of Grit above that adds 1 Integrity a level after the first, and each point below takes 1.
- **Damage lines.** Every damage and patch amount comes from four lines, set on a Hit and including a typical key ability:

  | Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
  |---|---|---|---|---|---|---|---|---|---|---|---|---|
  | A 1-action ability | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 13 | 14 | 15 | 16 | 17 |
  | A Strike | 7 | 9 | 10 | 12 | 13 | 15 | 17 | 18 | 20 | 22 | 24 | 26 |
  | A 2-action spell | 12 | 15 | 17 | 20 | 22 | 25 | 28 | 30 | 33 | 36 | 39 | 42 |
  | A 3-action spell | 18 | 22 | 26 | 29 | 33 | 37 | 41 | 46 | 50 | 54 | 58 | 62 |
  | The same, as an area (×0.75) | 13 | 16 | 19 | 21 | 24 | 27 | 30 | 34 | 37 | 40 | 43 | 46 |

  Patches use the same lines, so a 2-action *Letter* at level 5 patches 22. Healing is called **patching** everywhere in a fight.
- **Buffer.** Brace gives a Buffer of 3 + your level (4 at level 1, 8 at 5, 13 at 10), 2 more with a shield. It soaks damage first until your next turn, and Shoulder lends it to an ally beside you for one hit.
- **Damage order.** Flat additions (a Dip, a *Bead*, an elite's +2) join the amount first. Then the degree applies (×2 or ×½, rounded down), then a weakness adds or a resistance subtracts once, to no lower than 0, then Buffer soaks what's left, and the rest comes off Integrity.
- **Damage kinds:**
  - the eight genre kinds: **Static** (Neon), **Chill** (Nocturne), **Dread** (Gothic), **Grind** (Iron), **Warp** (Void), **Doubt** (Noir), **Dust** (Frontier) and **Quake** (Titan);
  - the party's kinds: **Light** (Milo, and any flame), **Ink** (the Scribe), **Spark** (the Artificer), and **Plain** for weapons.

  Residents deal their own genre's kind: Juno Static, Lumi Chill, Vesperine Dread, Rivet Grind, Pip Warp, Mae Doubt and Dusty Dust, and Hana's Colossus deals Quake. The Tollkeeper, Jev, Tova, Nell and Whisper deal Plain. A spell deals its caster's kind unless it says otherwise, and a regular deals its genre's.
- **Resistances and weaknesses** are flat numbers set by genre and archetype (§8.1) that grow with level: 3 at level 1, 6 at 5 and 9 at 10. An Examine reveals them. Until then they still apply, but the hover shows "?" beside the damage.
- **Lingering damage** (Static 3 from a Neon stray, Singed from a flame) ticks at the start of the holder's turn, and ends after 3 turns, when they spend an Interact to shake it off, or when an ally Assists them (§7).
- **Weapons:** standard weapons deal the Strike line; light ones deal 2 less, but each attack with them after the first adds only 10 heat; heavy two-handed ones deal 2 more. Bows, slings and cork-guns deal the Strike line at range 12. Ranged attacks and ranged knacks are −1 edge while a foe stands beside you.
- **Weapon arts:** each weapon kind has one, usable once per Breather: a 1-action Strike whose rider lands with the Strike's own degree. *Tripping cut* (light: Tumbled), *Pommel tap* (standard: Dazed 1), *Cleave* (heavy: a second foe beside the first takes half the damage) and *Pinning shot* (ranged: Tangled 1).
- **Boons** at levels 4, 8 and 12: +1 to an ability, or a boon card (*Early riser*: +2 initiative; *Good boots*: +1 Speed; *Steady hands*: tonics patch a third of your max Integrity instead of a quarter). Boons can be swapped for free at the campfire.

### 5.2 Road level and the Hearth's cap

Milo and every companion but the Wayfarers (the residents, the Tollkeeper, Tova, Nell and the regulars) share one **Road level**, 1 to 12; the Wayfarers follow their own work levels (§12). Road XP comes from play (fights, talking down, bows, stitches, story beats; §11) and from stitching real rifts (§12). Every recruit gets the same XP whether they went out or stayed at the fire, and joins at the current level, so nobody grinds a benched friend.

| Level | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Road XP | 200 | 1,000 | 3,800 | 11,500 | 24,000 | 46,000 | 84,000 | 147,000 | 250,000 | 380,000 | 550,000 |

At about one Elsewhere a day, XP alone would reach level 5 in about two weeks and level 10 in about three months, but **the Hearth sets the cap**, because its tiers need real progress:

| Hearth tier | Camp | Stockade | Hold | Keep | Castle | Citadel | Kingdom |
|---|---|---|---|---|---|---|---|
| Highest Road level | 3 | 5 | 7 | 8 | 10 | 11 | 12 |

XP past the cap is kept and counts the moment the cap rises: *"The Hold's up. Everyone feels it."* In practice the company stays at level 5 or below through Phases 4 and 5, since the Hold needs 25 finished quests (from the Notice Board in Phase 5) and a building level proven (from Phase 6), so it's raised in Phase 6. The cap never applies to the Wayfarers (§12).

**Warding** (Chris's 1–99 skill) gets the same XP one to one, uncapped, so Road level 10 is about Warding 59. It unlocks options, never power: the *Wedge* formation at 5, **Ready** at 10, more playbook rules at 15 (3 per companion, 6 at Warding 50: *"Nell: if anyone's under a third, patch them first"*), **Set the ambush** at 30 (while Unseen, place the party within 3 tiles of its formation before the first round), the Warden's Cloak outfit at 60, and at 99 the Mantle of the Ward, and tea.

### 5.3 What each level brings

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Every calling | Core features | Second feature | Path | Boon | Power jump | Path feature | Calling feature | Boon | Circle 5 | Capstone | Path feature; damage step | Boon; capstone twice per Campfire |

The **power jump** at 5 is a steadier second attack for Wardens and Longshots (it takes no −1 edge, though it still adds heat), circle 3 for full casters and circle 2 for half casters. The **damage step** at 11 is a steadier third attack for Wardens (−1 edge instead of −2), on top of the lines' own growth, so party damage keeps pace with foes at the top. Knacks grow with the lines. Levelling up lets a paper lantern rise; the choices can wait, though not during a fight.

### 5.4 The nine callings

| Calling | Role | Build | Key | Resolve | Armour | Charges | Who |
|---|---|---|---|---|---|---|---|
| **Lanternkeeper** | Leader, light, support | Middle | Heed | Mind 1 | light | ¾ | Milo only |
| **Warden** | Front line | Sturdy | Might | Body 1 | mail (plate from Road level 5), shield | none | Tollkeeper, Rivet |
| **Mender** | Patching, cleansing | Light | Heed | Mind 1 | mail, shield | full | Nell, Vesperine |
| **Scrivener** | Prepared magic, areas | Light | Wit | Mind 1 | none | full | The Scribe |
| **Tinker** | Devices, cover, repairs | Sturdy | Wit | Body 1 | mail, shield | half | The Artificer, Tova |
| **Skirmisher** | Mobility, big single hits | Middle | Grace | Body 1 | light | none | Jev, Mae |
| **Longshot** | Range, height, overwatch | Middle | Grace | Body 1 | mail | half | Dusty, Whisper |
| **Chorister** | Heartening, charm, sleep | Middle | Charm | Mind 1 | light | full | Lumi |
| **Weaver** | Genre magic | Light | Charm | Mind 1 | light | pact | Pip, Juno |

**Lanternkeeper.** Milo is Small (Speed 4), with Heed +3, Grace +2, Grit +2, Charm +1, Wit +0 and Might −1: Guard 0 in his raincoat, mind Resolve 2, body Resolve 0, and Integrity 18 at level 1 (64 at level 5, with his Grit).
- **Raise the lantern:** the Hooklight's light reaches 5 tiles, allies inside drift 20 heat towards idle at the start of each turn instead of 10, and Unseen foes inside are revealed. It's raised automatically when a fight starts and costs nothing to keep up (it isn't a sustained spell); raising it again after it drops costs 1 action.
- **Stand in my light** (reaction, twice per Campfire, three times from level 5 and four from 9): a hit on an ally within 4 tiles deals the 1-action line less (5 at level 1, 9 at 5, 15 at 10).
- **Scarf** (1 action, from level 2): Tamsin's too-long scarf pulls an ally, or a Small foe, 2 tiles toward him from up to 3 away, drawing no Parting swipes.
- **The lantern calls** (3 actions, once per Campfire): every Offline ally within 6 tiles who can still come back does, as if Rebooted.
- **Knacks:** *Mote* (an attack: the Strike line in Light, range 8) and *Flare* (an attack: the Strike line in Light at reach 1, a warm puff from the Hooklight that shoos a stray back 1 tile on a Hit or better).
- **Paths:** **Hearth** (allies in his light resist all damage by 2, 3 from level 5 and 4 from 10; *Salve* never lands below a Hit), **Wick** (*Mote* deals 2 more; *Hearthburst* joins his list) or **Wayward** (+1 Speed; once per Breather, for 1 action, send a mote of light up to 8 tiles and step into it).
- **Level 10, Second wick:** once per Campfire, when he'd go Offline he stays at 1 Integrity and every ally in his light is patched for the 2-action line.

**Warden.** *Draw the blow* (reaction: when a foe aims a Strike at an ally within 2 tiles, the Warden steps 1 tile in beside them if needed and becomes the target, meeting it with the Warden's own Guard and Buffer); *Hold here* (1 action, per Breather: foes within 2 spend their next attack on the Warden, on a Hit or better against their mind Resolve, and their telegraphs turn to show it); *Second breath* (1 action, per Breather: patch yourself for the 2-action line); *Surge* at 2 (once per Breather: Quickened for a turn). At 10, *Unbroken*: once per Campfire, drop to 1 Integrity instead of going Offline. At 11, the damage step (§5.3).

**Mender.** *Soothe* (1-action knack, in a fight only: touch patches an ally under half Integrity for the 1-action line, once per ally per round); *Reach out* (1 action, twice per Breather: Reboot an Offline ally within 6 from where you stand); *Still water* (2 actions, per Breather: strays within 4 are Spooked 2 on a Hit or better against their mind Resolve, and strays 4 or more levels below the party settle). At 10, *Tide turns*: once per Campfire, everyone within 6 is patched for the 3-action line, and Offline allies there come back.

**Scrivener.** *Pages*: prepare Wit + level spells at a lantern or camp; found scrolls copy into the book. *Proofread* (reaction, twice per Campfire, three times from level 5 and four from 9): when an outcome lands in sight, move it one degree, up for an ally's action or down for a foe's. *Turn back a page*: once per Campfire, a Breather restores half the level in charges. At 10, sustain two spells at once.

**Tinker.** *Bench drone*: a Tiny construct (Guard 1, Integrity 5 × level) that acts when the Tinker spends 1 action on it: it zaps (an attack at the Tinker's heat: the 1-action line in Spark), Assists or carries a tonic. *Pop-up cover* (1 action, twice per Breather: a low barrier with 10 + 2 × level Integrity); *Quick fix* (Wit times per Campfire: 1 action patches an ally beside you for the 1-action line, or 2 actions one within 6 for the 2-action line); *Tune-ups* at 2 (a small upgrade to two pieces of gear). At 10, two drones.

**Skirmisher.** *Unseen strike*: once a turn, a Strike with edge on its target, or with an ally beside the target, adds the 1-action line (5 at level 1, 9 at 5, 15 at 10). *Slip* (1 action): Stride without drawing Parting swipes, or Hide. At 5, *Tuck and roll* (reaction: halve a hit on you); at 10 the strike can land on a Parting swipe.

**Longshot.** *Ready a shot* (reaction: Strike a foe that moves in sight); *Bead* (1 action, until you draw another: the foe is **Singled out**, and your Strikes on it deal 2 more, 4 from level 5 and 6 from 10; the bead moves free when its foe is sorted); *Read the ground* (ignores natural difficult terrain, +2 initiative). At 7, *Volley* (2 actions, one attack for heat: a Strike on every foe within 1 tile of a point, each landing on its own); at 10, *Steady aim*: *Ready a shot* adds the 1-action line.

**Chorister.** *Heartening verse* (1 action, Charm times per Campfire): an ally within 6 cools by 20 and takes +1 edge on their next action (+2 from level 10). Knack *Hum off-key*; circle-1 *Lullaby*; *Hum along* at 2 (allies within 6 have +1 mind Resolve, never above 2). At 10, *Last verse*: once per Campfire, every ally gets a *Heartening verse* and a Stride that costs no action.

**Weaver.** *Loose thread* (knack, an attack in your genre's kind: the Strike line at range 10; from level 5 it fires two threads at two-thirds each, and from 11 three at half each, each landing on its own). *Burn an essence* (once per Campfire: a satchel essence for a pact charge). *Borrow a rule* (2 actions, per Breather, twice from 7, two at once from 10): for a round, the rule of a genre you've stitched. Neon, a decoy; Nocturne, a stray Beguiled 2 on a Hit or better; Gothic, step between Dim tiles; Iron, an ally goes Brisk; Void, swap two creatures; Noir, reveal the Unseen; Frontier, first in every tick next round; Titan, a stomp that Tumbles foes within 2 on a Hit or better.

---

## 6. Spells, abilities and resources

**Lantern charges.** Spell slots are one pool of charges, shown as flames by the portrait. A spell's **circle** (1–5) is its cost in charges and sets its reach, area and extras; its amount comes from its action cost and your level (§5.1). Each extra charge spent adds a quarter of its amount, up to as many extra charges as its circle.

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Full | 2 | 3 | 4 | 5 | 7 | 8 | 10 | 11 | 13 | 14 | 15 | 16 |
| ¾ (Milo) | 2 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
| Half | – | 2 | 2 | 3 | 3 | 4 | 4 | 5 | 5 | 6 | 6 | 7 |
| Pact | 1 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 3 | 3 | 3 |

**Highest circle:** full and pact casters reach circle 2 at level 3, 3 at 5, 4 at 7 and 5 at 9; Milo reaches 2 at 3, 3 at 6 and 4 at 9; half casters start at level 2 and reach 2 at 5 and 3 at 9. Pact charges always cast at the highest circle and return on a Breather; other charges return on a Campfire.

- **Knacks** are free and at will, 1 action each. The ones that hit are attacks and deal the Strike line.
- **Actions.** Quick spells cost 1 action, most cost 2, and big areas cost 3 (§3.4).
- **Sustained spells**, one at a time, need a Sustain (1 action) each round to keep going. One ends when you don't Sustain it, when you go Offline, when the fight ends, or after 10 rounds. Buffs and area effects can only be started once the fight begins, so nothing is cast before the first door and carried through a whole Elsewhere.
- **Features** say when they return: per turn, per Breather or per Campfire.

**The first spells** (`content/combat/spells.json`, about 29; Phase 4 ships about 10). Effects land against the Resolve named, and a spell deals its caster's kind unless it says otherwise.

| Circle | Spells |
|---|---|
| Knacks | *Mote* (Light, range 8) · *Flare* (Light, reach 1, shoos back 1) · *Loose thread* (range 10) · *Full stop* (Ink, range 8; a Hit or better also takes 2 off the target's next Stride) · *Hum off-key* (a Hit or better also Rattles 1) · *Ink blot* (Ink, pushes 1) · *Little light* · *Steady hand* (touch: ends Spooked, or makes an Offline ally's next Reboot cost 1 action) |
| 1 | *Salve* (2 actions, touch: patches the 2-action line) · *Kind word* (1 action, range 12: patches the 1-action line and ends Spooked) · *Take heart* (2 actions, sustained: 3 allies take +1 edge on their first action each turn) · *Inkdarts* (2 actions: three darts at a third of the 2-action line each, which can't miss: a Miss counts as a Graze) · *Sudden shelter* (reaction: when you're struck, you Brace before the hit lands) · *Lullaby* (2 actions, radius 2: foes turn Drowsy 2 on a Hit or better against mind Resolve, lowest Integrity first, up to twice the 2-action line of their Integrity) · *Tangleweed* (2 actions, sustained, 2×2: Tangled 1 on a Hit or better against body Resolve, each turn it's sustained) |
| 2 | *Hold still* (2 actions, sustained: Slowed 1 each turn on a Hit or better against mind Resolve) · *Step through the seam* (1 action, teleport 6) · *Quiet* (2 actions, sustained, radius 2: Hushed) · *Fogcloak* (2 actions, sustained, radius 1: Unseen) · *Clear morning* (1 action: end a condition) |
| 3 | *Hearthburst* (3 actions, radius 2: the 3-action area line in Light, against body Resolve) · *Neon line* (3 actions, a line of 8: the 3-action area line, against body Resolve) · *Tidesong* (3 actions: 4 allies within 6 patched for the 3-action area line) · *Brisk* (2 actions, sustained) · *Cross it out* (reaction: cancel a spell of circle 3 or lower) |
| 4–5 | *Send home* (2 actions: on a Hit or better against mind Resolve, a stray is gone for 3 rounds, and one no higher than the party's level settles instead; never an elite, Tale-lead or council member) · *Candle wall* (2 actions, sustained: a line of candlefire that Singes 3 whatever crosses it) · *The long song* (3 actions, sustained, radius 3: Drowsy 1 each turn on a Hit or better against mind Resolve) · *Rewrite the room* (3 actions: move every surface, raise or lower a dais) |

**Items:** *Hearthberry cordial* patches a quarter of your max Integrity and *Brew of clear morning* ends a condition (both Alchemy, LORE §12). Drinking one is 1 action, and giving one to an ally beside you is 2. **Spellcraft** gets 5 XP per knack and 40 × circle per spell cast in a fight. Real Mana never touches a fight.

---

## 7. Conditions

Every condition has an icon and a pattern as well as a colour, and shows its number.

- **Numbers.** Most conditions carry a number: its strength where the line says so, and always its length. It drops by 1 at the end of each of the holder's turns, and at 0 the condition ends. A condition counts down, or ends when someone spends an action on it (an Interact, or a calling's cure such as *Answer a letter* or *Clear morning*). Yes-or-no conditions have no number and end as their line says.
- **Degrees.** A condition landed by a Critical doubles its number and adds the move's critical effect. A Graze halves it, rounded down, and a yes-or-no condition, or one that halves to 0, doesn't land on a Graze.
- **Fights end them.** Every condition ends with the fight, except the Rattled a Reboot leaves (§10).

| Condition | Effect | Ends |
|---|---|---|
| **Tumbled** | Melee against it +1 edge, ranged −1; its next Stride only stands it up | When it stands |
| **Tangled N** | Can't Stride or Step; its attacks −1 edge; attacks on it +1 | Counts down, or an Interact frees it |
| **Drowsy N** | Asleep: no actions or reactions; attacks on it +1 edge | Counts down; ends when it takes damage, or when someone beside it spends an Interact |
| **Dazzled N** | Its attacks −1 edge; attacks on it +1 | Counts down |
| **Spooked N** | −1 edge on everything while it can see the source; can't move closer to it | Counts down |
| **Beguiled N** | Can't target the charmer; spends 1 action a turn drifting toward them | Counts down, or ends when the charmer's side strikes it |
| **Queasy N** | Its attacks and effects −1 edge | Counts down |
| **Rattled N** | −N edge on everything it does | Counts down; a Breather clears it |
| **Dazed N** | Loses its next N actions (a Tale-lead never loses more than 2 in a turn) | Drops by 1 for each action lost |
| **Slowed N** | Loses N actions at the start of each turn | Counts down |
| **Quickened** | A fourth action each turn, played in a fourth tick | As its source says: Overclock, *Surge* or Brisk |
| **Brisk** | Quickened (the fourth action can only Stride or Strike) and +1 Guard; when it ends, Winded | When the spell or mechanic ends |
| **Winded** | Loses 1 action on its next turn | After that turn |
| **Sparked N** | No reactions | Counts down |
| **Singed N** | Lingering Light N (a flame) at the start of each turn | After 3 turns; an Interact, an Assist, water or Soaked ends it |
| **Soaked N** | Spark and Static hit it as a weakness, and Light as a resistance, at the level's value; ends Singed | Counts down; 2 on leaving water |
| **Hushed N** | No spoken or sung spells | Counts down |
| **Unseen** | Attacks on it −2 edge; its first attack from hiding +1 edge | Revealed when it attacks, is lit, or is found by a Seek |
| **Exposed N** | +1 edge on everything aimed at it; its hidden trick is known | Counts down |
| **Singled out** | Chosen by a *Bead* or *Wanted*; see the feature | When the feature moves on |
| **Offline** | §10 | A Reboot, or the fight's end |

**Lingering damage** of any kind (Static 3 from a Neon stray, Singed from a flame) works the same way: it ticks at the start of the holder's turn, and ends after 3 turns, when they spend an Interact to shake it off, or when an ally Assists them. No outcome is picked for it.

Constructs ignore Queasy, Drowsy and Beguiled. Ghosts ignore Tangled and Tumbled.

---

## 8. Strays and Tale-leads

### 8.1 Strays by archetype

straygen's six body archetypes become roles; *n* is the foe's level (§9). A stray costs a room's budget by its level alone (§9), so the archetypes trade Integrity, Guard and Speed against each other rather than one being simply tougher.

| Archetype | Role | Integrity | Speed | Grace | Guard | Resolve (body / mind) | Strike | Special |
|---|---|---|---|---|---|---|---|---|
| Walker | Soldier | ×1 | 5 | +1 | 1 | 1 / 0 | Melee | none |
| Crawler | Skirmisher | ×1 | 6 | +3 | 0 | 0 / 1 | Melee | *Pounce* (2 actions: a Stride and a Strike; a Hit or better also Tumbles) |
| Floater | Artillery | ×0.8 | 4, hovers | +0 | 0 | 0 / 1 | Range 8 | Ignores surfaces |
| Flier | Harrier | ×0.8 | 6, flies | +3 | 0 | 0 / 1 | Melee | Draws no Parting swipes; ignores height |
| Ghost | Lurker | ×0.8 | 5, through walls | +1 | 0 | 0 / 1 | Melee, in its genre's kind; a Hit or better also Spooks 1 | Resists Plain, except inside the Hooklight's light and for a round after a Light hit; weak to Light; Unseen in the dark |
| Construct | Bulwark | ×1.25 | 4 | −1 | 1 | 2 / 0 | Melee | Weak to Spark; ignores Queasy, Drowsy and Beguiled |

**The stray lines.** Every stray's numbers come from its level, with the Integrity line scaled by its archetype:

| Level *n* | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Integrity | 15 | 20 | 34 | 48 | 61 | 75 | 92 | 109 | 126 | 143 | 160 | 177 | 194 |
| Strike | 5 | 6 | 8 | 9 | 11 | 12 | 14 | 15 | 17 | 18 | 20 | 22 | 23 |
| Resistance, weakness | 2 | 3 | 3 | 4 | 5 | 6 | 6 | 7 | 8 | 9 | 9 | 10 | 11 |

Past 12, each level adds 17 Integrity and about 1.5 to the Strike. Stray Strikes hit a little under the heroes' (6, 12 and 20 against 7, 13 and 22 at levels 1, 5 and 10), resistances and weaknesses follow 3 + ⌊3(*n* − 1)/4⌋, and a stray's heat comes from its temperament (§8.2). Every stray gets 3 actions and a reaction, like everyone else, and telegraphs them (§3.2). **Lackeys**, built two levels below the room (swarms like the Too-Many and red herrings, a posse's walkers), have half the room level's Integrity (10 at level 1, 38 at 5, 80 at 10) and three-quarters of its Strike (4, 9 and 15).

**A stray's bar** is split into **check segments**, one per tenth of its max, which turn green as damage lands, so you can read at a glance how close it is. At 0 the stray is **sorted**: it gives a little wave and goes home through the tear. Tale-leads have one bar per phase (§8.3).

| Genre | Neon | Nocturne | Gothic | Iron | Void | Noir | Frontier | Titan |
|---|---|---|---|---|---|---|---|---|
| Resists (its own kind) | Static | Chill | Dread | Grind | Warp | Doubt | Dust | Quake |
| Weak to | Warp | Dust | Light | Static | Ink | Light | Chill | Plain |

A fusion stray has both resistances but only its own weakness, and an archetype's resistance or weakness never stacks with its genre's: the same kind counts once. **Bright strays never fight**: in a fusion they stand aside and cheer (a star-rabbit gives one ally +1 edge on their first action each round, loudly). Bright and Backhalls Tale-leads stay puzzles.

### 8.2 Temperaments and talking down

riftgen gives every stray kind one of nine temperaments, which drive the AI and set its heat:

| Temperament | In a fight | Heat | Talk downs to settle |
|---|---|---|---|
| Shy | Keeps its distance; settles at half Integrity | 15 | 2 |
| Curious | Examines the nearest hero first | 35 | 3 |
| Grumpy | Strikes the nearest | 45 | 4, or 3 with Dusty or Mae in the party |
| Dramatic | Opens with its biggest move | 60 | Only after its big moment, then 2 |
| Sleepy | Starts Drowsy; can be crept past | 20 | 3 |
| Polite | Never touches an Offline hero | 20 | 2 |
| Lost | Idles one turn in three | 25 | 2 |
| Nosy | Goes for the lantern-bearer | 35 | 3 |
| Proud | Duels the strongest hero | 40 | 4, or 3 with Dusty or Mae in the party |

**Talking down** has no rolls. Each Talk down (1 action, §3.4) adds 1 calm to a kind of stray in sight, and when the kind's calm reaches its number, the whole kind settles, for **full XP and loot**. Striking any of that kind resets its calm to 0, so talking and fighting don't mix. With a hero of Charm 3 or more in the party every kind needs one fewer (never fewer than 2), and Dusty's Talk downs count double against proud and grumpy strays. A kind's calm shows as a row of small pips beside its telegraphs. You can start from the doorway before a fight: the fight then begins with that calm already counted, though the party gives up any surprise.

### 8.3 Elites and Tale-leads

**Elites** (the Chrome Hound, the Clock That Won't Chime, the Dust-Sheeted, the Quota Engine, the Staircase Sideways, the Alibi, the Posse of Tuesday, and generated ones elsewhere) are Large and are beefed up the way Pathfinder 2 does it: +10 Integrity at level 1 or below, +15 at levels 2–4 and +20 from level 5, +1 edge on their attacks and +2 damage. They cost the budget as a stray one level higher (§9). Each has one signature as data: the Clock freezes one hero's movement each round (*"stuck at 3:07"*). A level-5 elite walker has 95 Integrity and Strikes for 14 at +1 edge.

**Tale-leads** follow one recipe: an on-theme stray two levels below the room (one below at gaping, never below level 0), made elite, with a ranged option and exactly one signature, its mechanic (the table below). A lead never has a second trick. They're Large, and each phase has its own Integrity bar: the elite's Integrity divided by its mechanic's **effective-Integrity multiplier** from `leads.json`, so a mechanic that halves damage doesn't double the fight. At level 5, an open rift's lead is a level-3 stray made elite: 63 Integrity a bar before its multiplier, and Strikes for 11 at +1 edge.
- **Asides** are extra single actions the lead takes at the end of a tick: a Stride of half its Speed, a small Strike for half its Strike, or a push of its mechanic, each telegraphed like the rest. On Long Road it has 1 a round in the Opening and 2 from the Twist; Storybook keeps 1 throughout, and Maud's Table has 2, then 3.
- **Plot armour:** once per phase, an effect that lands on it lands one degree worse.
- **It reads you:** a lead adapts at step 3, or 4 when it's 2 or more levels above the party (§3.6): it plans for your most-used habit, or your two most-used, and feints once or twice a phase.
- **Phases,** each opening on a title card with the lead's generated quote: the *Opening* telegraphs the mechanic, the *Twist* begins when the Opening's bar empties and escalates it, and the *Last page* begins when the Twist's bar empties. Hairline leads have two phases and two bars: the Opening, then the Last page.
- **The bow.** Every mechanic has a way to win without emptying the lead's bars. It pays +25% loot, and a bowed wild Tale-lead can be invited to stay.
- ***The last page*** (a soft cap): at the end of round 8, a lead facing a party that's still standing yields. It's a win without the bow's bonus, and it's off at Maud's Table.
- **The first lead.** The first Tale-lead Chris ever meets uses Storybook's numbers whatever the mode, and the tuning suite checks it as a named case: a party of three at level 1.

**Names.** riftgen's name banks share names with the company: Juno, Lumi, Vesperine, Ashcombe, Maddox, Holloway, Dusty and Calloway. When a generated lead's name contains a companion's or resident's name, recruited or not, `encounters.js` shows the next name from the same bank instead, picked from the rift's seed, so the rift stays the same rift and `riftgen.json` stays untouched. Lumi herself never fights you: her invitations come as a note or a visit. A pairing tagged in `leads.json` as a planned hook keeps its name, the companion recognises them (*"That's someone from chapter two of my book."*), and a line waits in `content/camp/talks`.

Each riftgen mechanic has a rule (`content/combat/leads.json`, in `riftgen.json`'s order, so generated leads just work). The **×Int** column is a first estimate of the effective-Integrity multiplier, replaced by the sim's measurement. Phase 4 ships one mechanic per genre (Throttles speed, Streetlights out, Snuffs candles, Assembly lines, Too big to see, Alibis, Noon duel and Stomps); the others use a **generic fallback** until their phase, a plain lead with its quote. A percentage in a rule is of the lead's current bar.

| Genre | Mechanic | Rule | ×Int | The bow |
|---|---|---|---|---|
| Neon | Throttles speed | Party Slowed 1 until 3 junctions are rerouted (an Interact each); then the lead is Dazed 2 | 1.2 | All three in one phase |
| | Copies | At the Twist, two copies with 1 Integrity each; a hit or an Examine finds the real one | 1.3 | The real one picked first time, every phase |
| | Firewall | Takes half damage except on rounds 3, 6, 9…; Spark brings the drop forward a round | 1.5 | Its console switched off (two Interacts) |
| | Reboots once | Returns at half Integrity unless its console is used that round | 1.5 | The console used, then a Talk down |
| Nocturne | "No" weakens it | Beguiles a hero a round, on a Hit or better; **Say no** (1 action, by the Beguiled hero) takes 10% | 0.9 | Five noes |
| | Streetlights out | A lamp goes Dark each round; relight with an Interact | 1.1 | Every lamp lit in the Last page |
| | Clock skips back | Once a phase, undoes last round's damage to it, up to 15% | 1.3 | The Streetclock stopped (two Interacts, or one from a hero with Might or Wit 3+) |
| | Squeaky bicycle | Rides a 12-tile loop, clipping anyone on it; a Bracing hero Tumbles it | 1.1 | Tumbled three times |
| Gothic | Snuffs candles | Snuffs 2 a round; with 4+ lit it loses its resistance | 1.2 | Every candle lit at once |
| | Portrait swap | Teleports among 3–5 portraits (5 Integrity each) | 1.3 | Every portrait finished or forgiven (a Talk down each), not broken |
| | Old letters | Spooked 1 each round on a Hit or better; **Answer** (2 actions at the lectern) takes a third | 0.8 | Three answered |
| | Ravens | +1 Guard while 2 ravens circle | 1.2 | The ravens told the date (a Talk down) |
| Iron | Assembly lines | A line every 2 rounds makes a clerk; each lever pulled (2 actions) takes 15% | 1.2 | Every line shut |
| | Shift whistle | Everyone Brisk, then Winded, every third round | 1.0 | The whistle pocketed (an Interact from beside it while it's Winded) |
| | Stamped forms | Paper walls (6 Integrity, weak to Light) block doors and sight | 1.2 | Three forms filed at the desk (an Interact each) |
| | Steam vents | Smog each round; Chill makes it rain puddles | 1.1 | The main valve closed |
| Void | Too big to see | Half damage; **Name a step** (2 actions, after an Examine) shrinks it | 1.6 | Three steps named |
| | Sideways | A telegraphed 3-tile slide; Brace resists | 1.1 | The whole party Braced through two slides |
| | Splits | 4 Too-Many a phase | 1.3 | All settled, two phases running |
| | Hides unseen | Unseen wherever no hero sees it; light and Beads pin it | 1.3 | Pinned a whole round in the Last page |
| Noir | Alibis | Half damage while 3 alibis stand; evidence breaks one | 1.6 | All three broken |
| | Lights out | Once a phase, blackout, then everyone swaps places | 1.1 | Who's where, named (a Seek after each swap) |
| | Red herrings | On a Hit or better, your next attack targets a herring | 1.2 | Three herrings shown as false leads |
| | Questions | Answer (reaction) or be Spooked 1; an Examine Dazes it 1 | 1.1 | Every question answered for a phase |
| Frontier | Noon duel | Last page: a duel, where whoever is higher on the initiative ribbon strikes first, at +1 edge | 1.0 | The duel won, then holstered |
| | Circles | Moves 10; +1 edge against anyone who Strode this round; −1 edge against it unless you didn't | 1.3 | The whole party still for a round |
| | Posse | 1 walker a phase, at most 2 standing; +1 Aside while any stand | 1.3 | The posse rescheduled (a Talk down) |
| | Fair parley | Only talking works: each phase settles after 2 + its number Talk downs (3, 4, then 5) | 1.0 | The talk itself |
| Titan | Grows daily | +10% Integrity for each day its rift has been open (up to +30%), never levels; each Colossus piece takes a day off. Wild Titans close with the day, so they never grow | 1.0 | The last page before landfall |
| | Only the Colossus | Its last bar can't empty until the Crew Colossus lands a blow (§8.4); generic fallback until Hana joins in Phase 8 | 1.2 | The Colossus assembled |
| | Stomps | Telegraphed stomps over 60% of the room; the crew's plan tiles are safe | 1.1 | Nobody stomped for a phase |
| | Alarms | Brisk while 2 of 4 alarms ring; each switched off takes 10% | 1.0 | All four off |

### 8.4 Real rifts, Maelstroms and the Titan

**A fight never mends the real thing.** In a real rift's Elsewhere the seam still refuses the thread, and a settled or bowing Tale-lead yields and names the cause: *"Settle me all you like. The Habitack checks are still red."* The first win each episode pays XP and Marks; essences stay with the real stitch. If the real cause is fixed while a fight is paused, the fight ends as a win: *"The seam closed while you were away."*

**The card offers the real thing.** The victory or bow card in a real rift's Elsewhere names the cause in plain words and offers the rift's real actions, one click each: **Stitch** (opens the real cause: the quest, the session, the check), **Send the crew**, **Ward** and **Let go**.

**Maelstrom councils.** A Maelstrom's lead sits with one council member per other genre (each a stray of the room's level with twice the Integrity line), each with its own genre's mechanic. Each round one genre **has the floor** on a rotating banner: only its mechanic acts, only its surfaces spread and only its noise plays. Settling a member drops its genre from the rotation and takes 15% of the lead's current bar, and while two members stand the lead's Opening bar can't empty, the lead being too busy arguing. Councils have an effective-Integrity multiplier like any mechanic.

**The Crew Colossus** is a Huge guest on 3×3 tiles with one move per piece; with all six, Milo, the Scribe and the Artificer pilot it for a round while Hana calls the shots. It always arrives with at least 2 pieces (Hana's half-built frame), so every Titan mechanic can be won with no real-deadline work at all. In a **real** Titan rift, each focus session and crew run aimed at the big deadline adds a piece and also takes a day off *Grows daily*: real work, not play, shrinks it. It's still fiction there, and the real finish is the stitch. In a **wild** Titan, each focus session finished this week adds a piece (all 6 on Storybook). Hana brings it from Phase 8.

### 8.5 Canon foes: delves, caves and the Great Ones

Story delves and caves have no rift, so their foes come from LORE.md §10 (`content/combat/foes.json`). They use §8.1's archetype lines, settle rather than fall, and most have a bow of their own that pays like talking them down.

| Foe | Archetype | Where | The bow |
|---|---|---|---|
| **Hollow Sentries** (once LORE's *Hollow Knights*, renamed, since that's another game's title) | Construct | Delves; caves under old ruins | Reminded what they guard (three Talk downs): they lay down arms |
| **Unwritten** | Ghost | The Archive Peaks, the Blank Stacks | Read to (the Scribe's *Read*, or 2 actions at a lectern): they settle to listen |
| **Tollmen** | Walker | Bridges, the Last Bridge | A riddle answered (the Tollkeeper's *Riddle*, or a hero with Wit 3 or more at the riddle board) |
| **Cinder golems** | Construct | Cinderforge, the Cold Forges | Their forge stoked (an Interact at the forge, then a Light hit on it): they sit down, warm |
| **Hush hounds** | Crawler | The Greyreach, grey caves | Walked: a hero spends an Interact beside one two turns running |
| **Drowned bell-ringers** | Ghost | The Mistmere reef, the Drowned Bell | The meeting adjourned (three Talk downs, or the bell rung at the lectern) |

**Caves** fill their rooms from the nearest region's wild creatures and canon foes, with §9's budgets at the cave's tier: cinder beetles (crawler) and cinder golems at Cinderforge; glass eels (floater) and fen herons (flier) in the Glass Fen; inkwyrms (crawler) and Unwritten in the Archive Peaks; kite-crabs (crawler) and fog seals (walker) around Mistmere; Murmurs (a swarm) and fetchfoxes (Shy crawlers that pinch a tonic and run) in the Whisperwood; dicing frogs on the Downs; sky-rays (flier) over the Skyward Isles; Hush hounds in the Greyreach. **Mimics** turn up anywhere: a chest that joins the fight, whose bite tickles (1 damage), and which settles the moment someone opens it. Out in the unnamed wilds, a cave uses the nearest region's list.

**The Great Ones** are fight-puzzles whose only ending is the bow; there's no Integrity bar to empty, and the sim counts the bow as the win:
- the Tollkeeper, out-riddled at the Last Bridge, after which he joins (his three riddles are dialogue, not a fight);
- the Drowned Bell, calmed by Pell's lullaby played at the reef's bells;
- the Blank Sovereign, read a story;
- the Cinder Wyrm, warmed;
- the Mirror Heron, whose reflections are broken one pool at a time (a Seek at each) while it shows you your loops;
- the Grey Stag, walked beside rather than struck: every lantern in its clearing kept lit for three rounds while nobody attacks it;
- the Someday King, whose letters are finished or freed while masked guests bow out.

The **Cloud Leviathan** is tagged no-fight. It's a rescue, played on the map (cut the kite-lines, calm it), never as a fight.

---

## 9. Encounters and difficulty

| Tier | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Foe level n | 1 | 2 | 4 | 5 | 7 | 9 | 10 | 11 |

Real rifts always run at the party's Road level, because Chris doesn't choose them, and never at a Wayfarer's higher work level. Past tier 8, every three depths adds a **deep rank**: +10% Integrity, +1 damage and +10% loot. A wild rift's panel reads *"Runs at level 5. Your company is level 3 (4 on average, with the Scribe)."*

**Budgets.** Rooms are built with Pathfinder 2e's encounter maths (the GM Core values), counted as if the party stood at the room's level *n*, so a room is the same room whatever level you bring to it. Each stray costs the budget by its level:

| Stray level | n−4 | n−3 | n−2 | n−1 | n | n+1 | n+2 | n+3 | n+4 |
|---|---|---|---|---|---|---|---|---|---|
| Cost | 10 | 15 | 20 | 30 | 40 | 60 | 80 | 120 | 160 |

An elite costs as a stray one level higher, and a lackey as one two below. For four heroes a room is **Trivial** (40 or less), **Low** (60), **Moderate** (80) or **Severe** (120); each hero fewer takes 10, 15, 20 or 30 off. **Extreme** (160) is never used. A room's **weight**, which sets its rewards (§11), is its budget ÷ 20, so a Moderate room for four weighs 4.
- Ordinary rooms are Low to Moderate. Tale-lead fights are Severe at most.
- At party levels 1 and 2, nothing in a fight counts as more than 2 levels above the party; a higher rift's elites and leads are scaled down to that.
- Fights chained without a Breather play a tier harder, which is why Breathers matter.
- Staggered waves count a tier lower than their sum.
- Every ±2 levels roughly doubles or halves a stray's power.

| Stage | Fight rooms | Mix | Tale-lead's room | Lead phases | Hearth-nook |
|---|---|---|---|---|---|
| Hairline | 1 | Low | Lead from 2 below, with a lackey: Moderate | Two | none |
| Open | 2 | Moderate | Lead from 2 below, with a stray a level below: Severe | Three | one |
| Gaping | 3 | Moderate, two of them back to back | Lead from 1 below, alone: Severe | Three | one |

A Tale-lead counts as its elite level for each of its bars: 30 a bar from 2 below, 40 from 1 below. Helpers fill the rest of its room, and if the lead alone fills it, it comes alone. With fewer than four heroes, the lead's bars shrink by the same share as the budget (three heroes meet ¾-size bars in a Severe room). Strays its mechanic makes (clerks, posses, the Too-Many) are priced into its multiplier instead. Other rooms may hold a few sleepy or lost strays to creep past or talk to. **Depth** adds 2 per hero to a room's budget for each depth past 3, up to 10 per hero. **Affixes:** Crowded ×1.25, Lonely ×0.6, Colossal adds an elite, Sleepy starts the strays surprised, and Flooded, Overgrown, Snowbound, Smoggy and Candlelit lay their surfaces. **Caps:** 8 foes and 3 kinds a room, and one elite until depth 7.

**Pace comes from the sim, not formulas.** For each level and party size, the tuning sim (§16.4) measures *D*, the damage per round of a reference party: Milo on the Wick path, a sword-and-shield Warden, a Skirmisher and a Scrivener with *Full stop*, playing Guided at the Road level with notebooks trained against the scripted player. `rules.json` then stores an Integrity factor for strays per level and party size, so rooms last their target rounds: Low about 2, Moderate about 3 (95th percentile at most 6), and a Tale-lead 4–5 across its phases by median, at most 8. The lines are built so an ordinary on-level stray falls in about a round of the whole party's focused work, and a Middle hero survives 3 on-level Strikes at level 1, 5 at level 5 and 6 at level 10 (a Sturdy one about one more, a Light one about one fewer). First estimates of *D* for four are about 35 at level 1, 70 at 5, 115 at 10 and 135 at 12. The published pace table is the sim's output, never this paragraph's. Wayfarers above the Road level aren't part of *D*, so their real work shows as shorter, safer fights.

**Minutes.** The sim also reports minutes, using a stated model: in Command, writing a round's twelve actions takes about 60 s; in Guided, glancing over four drafts and changing a few takes about 30 s; playing the round's three ticks takes about 12 s at 1×; and walking and looting a hairline Elsewhere takes 90 s. So a round takes about 75 s in Command and 40 s Guided. A hairline Elsewhere (a Low room and a two-phase lead) must come in at a median of 12 minutes or less in Command and 6 or less Guided. Open and gaping Elsewheres carry over between rests.

**Modes.** Loot and XP are identical in all three, and *Try again* is free in all three. You can ease to Storybook at any moment, mid-fight included, and make things harder between fights. The calm settings for genre noise and stray adaptation (§15) work in any mode.

| | **Storybook** | **Long Road** (default) | **Maud's Table** |
|---|---|---|---|
| Foes | −1 level (at least 1), ×0.75 damage | As written | +1 level |
| Heat | Every band one step cooler | As written | Companions' idle heat +15 |
| AI | Plain and polite; never adapts to your habits | Uses cover, surfaces and swipes; adapts by rank and level (§3.6) | Focus fire, surface combos, crowds a hero who's Rebooting someone; every foe adapts a step more |
| Genre noise | Off | The room's own | Every genre in the room at once |
| Breathers per Campfire | 3 | 2 | 1 |
| Tale-lead Asides | 1 | 1, then 2 from the Twist | 2, then 3 |
| *The last page* | Round 8 | Round 8 | Off |

Maud's Table is named for Maud Pellinore, the Dungeon-Wright at Gamewright's Rest, who designs monsters for fun. **Target win rates** (auto-played fights per reachable level and mode, §16.4): Storybook 99% or more; Long Road 95% Moderate, 85% for chained or Crowded rooms, 80% Tale-leads; Maud's Table about 70%.

---

## 10. Going offline, rests and recovery

**Going Offline.** At 0 Integrity a hero goes **Offline**: they sit down and doze, drawn a sleepy blue with a small "z" drifting up. Another hero within reach can **Reboot** them (2 actions), and they come back at a quarter of their max Integrity and a little Rattled: Rattled 1, which doesn't count down and lasts until their next Breather. A hero who drops a second time in the same fight stays Offline until it ends. Nothing is rolled while Offline, in any mode: an Offline hero simply waits for a friend or for the fight to end. Moths never come near a fight; they belong to letting go.

**After every fight** everyone tops up to half Integrity, anyone Offline comes back at half, and heat returns to idle. Attrition lives in lantern charges and Breathers, not in limping from room to room.

**If the whole party is Offline**, the Hooklight flares, Toby Fennick arrives at a run with his handcart (*"Courier."*), and everyone wakes at the last lantern they rested at, with full Integrity and everything they found. The Elsewhere keeps its settled rooms and opened chests; rooms not yet settled reset. The wake card (*"Everyone went offline. Everyone's fine."*) offers **Try again**, free in every mode (back to the start of that fight with the Integrity you entered it with, on fresh outcomes), or **Go home**, after which going back into that rift is free once. Nothing is spent for going Offline.

**An outing is the adventuring day.** It runs from one Campfire to the next.

**Breather** (short rest): offered on the victory card when a fight ends, at most one per fight, and up to 3, 2 or 1 per Campfire by mode (§9): three seconds of sitting while Milo pours tea. A short rest at a lit lantern counts as one too. Each hero gets back half their max Integrity, their heat returns to idle, per-Breather features and pact charges return, and Rattled clears. Knacks are at will and never need refilling. When a real focus session ends while the party is out, they take a free Breather that doesn't count against the Campfire's: *"You worked. They sat down for a bit."*

**Campfire** (long rest): everything returns (Integrity, lantern charges, Breathers and features), and Rattled clears. It's free:
- at the muster, so every outing sets out rested;
- at home, by Hearthvale's fire;
- at a lit lantern outside any Elsewhere, once a real day;
- at an Elsewhere's hearth-nook, once per Elsewhere.

A cooked meal at a Campfire (Cooking, from Phase 5) adds a boon until the next, like *Nan's soup* (every fight starts with a Brace's Buffer already up): a treat, never a toll. Leaving an Elsewhere by choice (*Head home*) and going back costs its entry again; it remembers the rooms you settled and the chests you opened until the rift closes, and every other room resets, so nobody whittles a lead down across trips.

---

## 11. Rewards

| Foe level n | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Road XP per weight | 10 | 20 | 35 | 55 | 80 | 110 | 145 | 185 | 230 | 280 | 335 | 395 |

- **Road XP:** the room's weight (its budget ÷ 20, §9) × the table, +45 per weight per deep rank; a bow adds 25%. A Tale-lead's room pays as 8, 10 or 12 weights at hairline, open and gaping, whatever its budget. A wild stitch adds 4 weights' worth, story beats pay what their quest says, and a real stitch pays 8 weights at the party's level (§12). It goes to the whole roster, and the same amount to Warding.
- **Marks:** 4 × weight × n per fight.
- **Essences:** 30% per stray room, 2–4 from a Tale-lead, and a relic 20% of the time. A real rift's essences come only from its real stitch.
- **Gear:** 20% per stray room, 50% from an elite, always from a Tale-lead: Plain 60%, Fine 30%, Storied 9% (with a relic line; one that mentions a case gives Mae an extra clue) and Maelstrom 1% (Maelstroms only). Plain gear that isn't an upgrade for anyone salvages itself into materials, so there's nothing to sort.
- **Tonics and scrolls:** 25% per room.

**Gear** has four slots per companion: weapon or focus (Smithing, Crafting), garb (Crafting and Seamcraft genre outfits, which recolour the sprite), trinket (relics, fusion gear) and keepsake (one loved gift, for a small bonus). The muster's **Equip best** fills every slot at once.

**Once only.** A fight has an id and pays once, even after a restore or a Try again, and loot is seeded per room. Talking down, bows and every auto mode pay in full, so the calm choice is never the poorer one. Embers already pace play, so there's no daily cap on play rewards.

---

## 12. Real work

**Embers pay for the trip, not the swing.** This table lists only the spends combat touches. PLAN §6's other costs stand: 1 per chunk revealed, 10 per story chapter and 2 per market reroll.

| Spend | Embers |
|---|---|
| A wild rift's Elsewhere | 5, +1 per 3 depths (up to 10) |
| A real rift's Elsewhere; challenging a field boss | 5 |
| A cave | 3 |
| A story delve | 20 |
| Going back in after everyone went Offline | 0, once per rift |
| Fights, Try again, rests, the muster, party size, watching a commission | 0 |

The bank still caps at 100. A **lifetime** counter keeps counting past it, and a ledger of the newest 300 entries, shown in the Chronicle, says where every Ember came from and went.

| Real | In the company |
|---|---|
| A focus session finishes | A free Breather for a party that's out (§10) |
| A real rift stitched (the check passes, you went to bed, the quest is done) | Road XP worth 8 weights at the party's level, once per episode |
| The Hearth rises | The Road level cap rises; stray residents count toward the Castle's six |
| Claude or Codex sessions watched to the end, and commissions passing their check (+3 each) | That Wayfarer's work level, and one **Margin Note** (the Scribe) or **Spare Part** (the Artificer) per session: a one-use page or device for the next fight, up to 3 held |
| Judgebird's Glance casts in MILO (and the Jev skill's tally, if opted in); dictations Whisper finishes | Jev's and Whisper's work levels |
| A companion's real habit | That companion's warmth |
| Work aimed at a big deadline | Crew Colossus pieces for that Titan, each also taking a day off its growth |
| Focus sessions this week | Pieces for a wild Titan's Colossus (from Phase 8) |

**Wayfarers' work levels** (PLAN §4's crew levels) count finished pieces:

| Work level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Finished pieces | 0 | 5 | 15 | 30 | 50 | 80 | 120 | 170 | 230 | 300 | 400 | 520 |

A Wayfarer fights at their work level or at one below the Road level, whichever is higher. The floor lifts a Wayfarer you've rarely used. There's no ceiling, and the Hearth's cap doesn't apply to them, because their level is already real progress. So real work shows directly: a busy week with Claude puts a stronger Scribe in the party, and the same fights get easier. Encounters never rise to meet her: wild foes come from the tier, real rifts run at the Road level, and the tuning targets (§9) assume a party at the Road level. The Scribe's and the Artificer's title tracks (LORE §5) arrive at work levels 1, 4, 8 and 12, each with a signature feat. Nothing is paywalled or nerfed, levels never drop, and on upgrade the counts are seeded honestly from what MILO already knows.

**Jev's count is local and opt-in.** By default only Judgebird's Glance casts made inside MILO count. With the opt-in on, MILO also reads two numbers (runs and items sorted, never their text) from `~/.claude/skills/jev/tally.json`, which the Jev skill would write with a one-line change to `jev.py`. The map then marks the Isles of Sure Verdicts as a place data arrives from (PLAN §12).

**Commissions as watchable expeditions** (Phase 6): a running commission can open as a battle in the same renderer, where each finished real turn plays as one action and the final blow waits for the real check. A pass is victory and a failure a draw, never a defeat (*"The drone slipped back into the rift. Codex left notes."*). It costs nothing and shows titles and counts only.

**Privacy.** No game path calls Jev or any crew tool, nothing new leaves the PC, the notebooks stay in MILO's own save, and Mana never touches a fight.

---

## 13. Interface

The fight uses MILO's `px` pixel chrome; the minimap folds to its three orbs and the side tabs collapse. The planner below is §3.7's round, just before Run, with the pointer on Pip's second Strike.

```
┌ Round 1 · planning ─ [◆Glitch beetle] [●Milo] [●Scribe] [●Pip] ──────────────────┐ initiative
│ ◆Glitch beetle ▯▯▯▯▯▯▯▯▯▯ 20/20   1 Scuttle beside Pip  2 Bite Pip  3 Bite Pip    │ telegraphs
│ │Milo│ 18/18  ▮░░░░ 20 Cool   1 Stride    2 Stride   3 Interact: breaker changed  │
│ │Scr.│ 16/16  ▮░░░░ 25 Cool   1 Stride    2 Brace    3 Letter: Pip       changed  │ drafts
│ │Pip │ 16/16  ▮▮░░░ 45 Warm   1 Examine   2 Strike   3 Strike     71% · why?      │
│ Strike · 65 Hot, −1 edge   Critical 20% 14?   Hit 35% 7?   Graze 15% 3?   Miss 30% │ odds
│ Neon: lag. About 1 action in 5 lands a tick late.                   Cheers ✦✦    │ noise
└ Shoulder: Always   [Accept all] [Clear]   Playback 1× 2× 4×               [Run ▸] ┘
```

- **The initiative ribbon** runs along the top: allies on solid circles, foes on dashed diamonds and neutrals on squares. In playback, ◂ marks who's acting and the title reads *tick 2 of 3*.
- **Telegraph icons** sit over each stray, with arrows to their targets and the tiles they'll hit, in plain words on hover. A hidden intent shows "?".
- **The round planner** has three slots per hero. Each companion's draft shows its confidence (dashed under 50%), their sync, and **why?**. Hovering any slot shows the four odds bars and what each would do. Each hero has a heat gauge, a colour-blind-safe thermometer with its number. The noise banner sits above the **Run** button, and a Cheer can be dropped on any slot. Changing a slot is free and can be undone back to the start of the round.
- **Portraits** show Integrity (notched every 10, with numbers), Buffer, conditions with their numbers, charges as flames (✦), a sustained-spell flame, Cheers and the control badge. A stray's bar shows its check segments.
- **Playback** runs at 1×, 2× or 4×, tick by tick, with the Log narrating (*"Pip — Critical — 17 Warp"*) and each companion's thought bubble over their action.
- **Hover and right-click** work as everywhere in MILO: *"Strike Glitch beetle / 4 more options"*.
- **The Log** gains a **Combat** tab; any line expands to its full breakdown (the odds, the outcome, the degree and any weakness), and each fight's summary goes into the Chronicle. Setting out and Level up join the panel system, and the Gear tab becomes a character sheet per companion, with their **notebook page** (§3.3) and each reaction set to *Ask*, *Always* or *Never* (§15).

**Keyboard:** Tab cycles targets and slots, the arrow keys move a tile cursor, Enter confirms or accepts the selected draft, Shift+Enter accepts every draft, and Esc goes back. 1–9 and 0 are the bar; M moves, Backspace clears a slot, Y shows why, Space runs the round (and takes the company back from *Let them handle it*), P pauses, G toggles Guided, W wraps it up when offered, A hands the company over, and ? shows the keys.

---

## 14. The animation track

Animation is its own lane beside every build slice, with its own proofs, because a turn-based fight lives on how a swing feels. It's planned so a few hand-drawn key poses go a long way: most frames are derived by pose operations, and effects are procedural.

### 14.1 Sizes, rules and timing

- **Bodies keep their exploration size** (Milo 16×20, the robed crew 16×18, Jev 12×10, Whisper 12×14, strays 20×20), so the fight happens in the same world at the same scale and genre recolouring keeps working. **Frames get room to swing:** 32×28 for the party (feet at 16, 26), 28×28 for strays, 56×56 for Tale-leads and elites at 2×.
- **The camera keeps the exploration scale** (2× to 4×, 3× at 1280×820), and `world.frameArena(rect)` centres the arena; a 12×9 lead arena plus the HUD fits at 3×.
- **Key poses** are hand-authored string grids in palette keys only. Each carries anchors (head, both hands, back) and its own outfit mask or head-split row, because crouch, lean and jump frames move the head and `outfitGrid`'s fixed split would dress them wrong.
- **Derived frames** come from pose operations the sprites already use: row shifts (as `withLegs` does), `breathe`'s squash, `stamp`, leans and mirroring. Action clips face sideways and are mirrored; walking stays four-way; idle, cheer and Offline also get a front view.
- **Effects are procedural:** palette-keyed primitives (rings, sparks, beams, dithered fills) driven by per-spell data. Outcome flashes, heat shimmer and telegraph arrows are procedural too.
- **Playback:** 8–12 fps on the engine clock, never `setTimeout`. A hidden window holds playback, and with motion off every clip jumps to its final frame (the existing `t === null` rule).

| Beat | Time |
|---|---|
| A tile of movement | 140 ms |
| Melee | 600 ms |
| Cast | 800 ms + 400–700 ms of effect |
| Hit reaction | 250 ms |
| An outcome flash | 150 ms over the hit reaction: a Critical's star-sparkle, a Graze's scuff or a Miss's whiff |
| A stray beat | 1.5 s at most, halved by *Fast foe turns* (on by default) and again at 2× or 4× playback |
| A Critical | An 80 ms hit-stop and a 3-frame ink flash (neither with motion off) |

A tick plays its actions in initiative order, strays of one kind as one beat, so a round at 1× takes about 12 seconds.

### 14.2 The party

Two **rigs** hold every pose once: the **coat rig** (Milo's proportions, 16×20) and the **robe rig** (16×18). Characters are drawn on a rig with overlays.

| Clip | Hand + derived frames |
|---|---|
| Ready (combat idle loop) | 1 + 3 |
| Walk (new for the robe rig: 2 × 3 facings) | 3 + 3 |
| Melee (anticipation, wind-up, strike, hold, recover) | 3 + 2 |
| Ranged or throw | 2 + 2 |
| Cast + sustained-spell loop | 2 + 5 |
| Quick gesture (a tonic, a whistle, a verdict) | 1 + 2 |
| Hit; dodge; brace; jump | 1 + 1; 1 + 2; 1; 1 + 2 |
| Tumble and stand | 1 + 3 |
| Offline (wobble, sit, doze) + dozing loop | 2 + 4 |
| Reboot (the Offline one plays Offline backwards, with a blink of light); use an item | 0 + 3; 1 + 2 |
| Cheer (front) | 2 + 2 |
| Emotes: wave, think, laugh, shrug, sit, sleep | 6 + 6 |
| Camp: sit at the fire, talk, sleep; job loop | 3 + 3; 1 + 3 |
| **A rig's full set** | **32 + 48 = 80** |

Milo draws the coat rig's key poses plus *Scarf*, *Raise the lantern* and the Wayward step (2 each). The Scribe and the Artificer add about 8 hand frames each (pens, pages, tools) over the robe rig, and later residents about 6 each (a hat, a weapon, a bicycle). Rivet, Pip and Vesperine use the construct, floater and ghost stray poses with about 4 bespoke frames each. The Tollkeeper (20×26) needs about 15, Jev about 12 and Whisper about 10. Regulars use stray poses.

### 14.3 Strays: every generated creature can act

straygen stamps genre parts at named anchors (headTop, face, body, tail, left, right). A **pose** is a set of anchor offsets plus row operations (a swapped leg row, a squashed row, swapped eye keys), and `composeStray({ …, pose, size })` re-stamps the body and every part per frame, so any stray, with any fusion parts, animates with no new art. `composeStray` gains the `size` parameter (20 by default, 28 for fight frames) so a lunge or a raised part isn't clipped at the edge, and it's memoised by stray, pose and frame, so the painter's cache (keyed by rows identity) hits instead of building a canvas every frame.

| Archetype | Idle | Move | Attack | Hit | Settle |
|---|---|---|---|---|---|
| Floater | Bob (exists) | Drift | Squash, lunge 3 px, stretch | Flash, knockback | Pops into ink motes |
| Walker | Breathe | Leg rows swapped (like `withLegs`) | Lean, raise the right-anchor part | Flash | Waves, dissolves |
| Crawler | Twitch | Leg shimmer | Pounce arc | Flash | Rolls over, dissolves |
| Flier | Wings up and down | Flap | Dive swoop | Tumble | Flutters down |
| Ghost | Hem wave | Dithered drift | A "boo" swell | Flicker | Fades upward |
| Construct | Blink | A 1-px hop | Side part pistons out | Shake, spark | Settles, dissolves |

That's about 16 pose specs per archetype, **96 in all**, as data in `content/combat/anims.json`. On top: one **genre flourish** per shadow genre, 2 hand frames each with the rest procedural (a Neon glitch slash, a Nocturne nightwing swirl, a Gothic candle puff, an Iron steam burst, Void star specks, a thrown Noir red herring, a Frontier cork-gun pop, a Titan stomp ring); a procedural **dissolve**, with a wave from friendly temperaments; and for Tale-leads the same poses at 2×, a **bow**, and a **signature clip** for each mechanic, built from pose specs and effect data.

### 14.4 Effects and camp scenes

| Effect | How |
|---|---|
| Spells (the first 29) | Procedural from primitives and per-spell data, at 32×32 or 48×48 |
| Projectiles (mote, quill, bolt, feather, cork, rivet, star, glitch packet, flame, nightwing); impacts | One hand frame each, the rest derived; the 12 damage kinds' impacts procedural |
| Outcome flashes | A Critical's star-sparkle, a Graze's scuff and a Miss's whiff, all procedural (the rising paper lantern stays reserved for level-ups) |
| Heat shimmer | A subtle warm or cool outline tint on each hero, beside the gauge, procedural |
| Telegraphs | 16 intent icons at 8×8, with procedural arrows, and a "?" for a hidden intent |
| Surfaces; condition icons | 11 × 3 tiles with the bleeds' dithered edge; 21 icons at 8×8, each with room for its number |
| Markers | Active and target rings, side shapes, path dots, cover shields, height chevrons |
| Fight start | A "noticed you" swirl ("!" stays reserved for needs-you, like a spotted feint), then the grid fading in |
| Team-ups | A one-second duet each, from both characters' poses |
| Level up; the wake-up | A paper lantern rising; Toby's handcart arriving and wheeling the dozing party to the lantern |
| The notebook | The Scribe's pen writing a line on a companion's page (2 hand frames), after a round with changes and on the camp page |
| Camp | The night campfire loop with the party on the stumps; Breather tea steam; Milo setting the Hooklight by the Hook |

Damage numbers use 4×6 and 6×9 pixel fonts: cream damage, green patches, butter Criticals with a small star, a smaller cream number for a Graze, and a grey "miss".

### 14.5 Waves

| Wave | Slice | What | Hand frames |
|---|---|---|---|
| A0 | 4.1b | Placeholder ready, melee, hit and Offline for Milo and the robe rig; floater and walker poses (data); telegraph icons, outcome flashes and tick playback; markers | ~25 |
| A1 | 4.2 | Rig anchors and pose operations; the rest of the coat and robe rigs' key poses; the Scribe's and the Artificer's overlays; all 96 stray pose specs (data); 8 flourishes; effect primitives and the first spells as data; projectiles, impacts, numbers and surfaces; heat shimmer, the Reboot clip and the notebook's pen | ~90 |
| A2 | 4.3–4.4 | Jev and the Tollkeeper; camp scenes; level up; Toby's handcart; Breather tea; condition icons | ~40 |
| A3 | Phases 5–9 | Each resident's overlays, Whisper, team-up duets | ~200 |
| A4 | Phases 6–10 | Tale-lead signature clips (mostly data), the Colossus, commission playback, the Great Ones | ~150 |

That's about **150 hand-drawn frames in Phase 4** and about 350 more over Phases 5–10; derived and procedural frames make up the rest of about 1,300 in all. Each wave ends with a capture sheet looked at beside the vale's art and iterated until it sits right.

---

## 15. Accessibility and calm settings

- **Ways to play,** for the whole party:
  - **Guided** (the default): everyone's drafts are filled in, Milo's included; you review them and Run. Once they know you, most rounds are a glance and a key.
  - **Command:** every slot starts empty and you write everything; ghosted suggestions can be switched on. The notebooks still learn from what you write (§3.3).
  - **Let them choose:** companions' drafts lock in; you review Milo's and Run.
  - **Let them handle it:** everyone drafts, Milo included, and rounds run at 2× or 4× with no review; Space takes over.
  - **Tell me how it went:** the same seeded fight resolved instantly from drafts, then a campfire summary: *"Rivet held the door. Milo kept the lantern high."*

  Each hero can also be set on their own to *Mine* (empty slots), *Review* (as in Guided) or *Let them choose*, shown by the control badge; set Milo to *Mine* to keep writing his turns yourself. The old per-companion suggestion is simply a draft now. Auto never earns less, and nothing played on auto becomes a habit.
- **Wrap it up.** Once the foes' remaining Integrity is below one round of the party's damage, **Wrap it up** appears: the rest resolves instantly, as in *Tell me how it went*, and pays in full. Nobody chases the last Shy stray round the room.
- **Reactions** each have *Ask*, *Always* or *Never*. The defaults: Parting swipes Always; *Shoulder* and *Draw the blow* Always for an ally under half Integrity; *Stand in my light* Always when the ally is under half; *Cross it out* and *Proofread* Ask. An Ask prompt pauses only the playback, never times out, and stays out of the way of *Fast foe turns* by appearing only when its trigger happens. A companion's drafted reaction setting can be changed in review like any slot.
- **Pausing, with no clocks.** Nothing hurries you, and foes never move while paused, hidden or focusing. The fight saves after every action. Starting a focus session pauses at the next action boundary: *"The fight will keep. Back at your next rest."* The end of a rest does the same: a soft bell rings, the action in progress finishes, and the rest of the round waits, so play never runs into work time. The next rest opens on the board. After your evening bell, starting a fight asks once: *"It's late. Start anyway?"*
- **Odds:** *Bars* (the default: four bars, with numbers and damage on hover) or *Words* (*likely*, *about even* or *a long shot*, and *a Critical is in reach* at 20% or more). Either way the odds shown are the odds used.
- **Genre noise** and **Stray adaptation** each have their own switch, on by default and apart from the difficulty mode. With noise off every tick plays in ribbon order, with nothing lagging or slept through; with adaptation off, strays and genres never plan around your habits. Neither changes rewards.
- **Reduced motion:** every clip has a still final frame, outcome flashes show as a still badge, heat shimmer is off (the gauge stays), and there's no hit-stop or flash.
- **Screen readers:** the accessible entity list becomes the combatant list (*"Glitch drone, 6 of 16 Integrity, Spooked 1, telegraphing Bite Milo, Hit or better 85%"*), Log lines are `aria-live="polite"`, drafts are read out with their confidence and their why, and everything on the canvas is reachable by keyboard.
- **Colour-blind safe:** sides are shapes, conditions icons and patterns with numbers, areas hatching, damage kinds icons, heat a thermometer with a number, and odds numbers. Text scale covers the HUD, the planner and the Log.
- **Cosy:** Log copy passes `assertCalm`; strays "settle" and are "sorted", heroes "go offline" and "doze", nobody "dies", and nothing is "wiped" (*"Everyone went offline. Everyone's fine."*). The gentle-rifts setting softens stray attack clips (no teeth, more candles), and a genre switched off never appears in a fight.

---

## 16. How it's built

### 16.1 Modules

Rules are pure, Node-importable modules with unit tests; the engine only draws, animates and forwards input.

| File | Job |
|---|---|
| `src/combat/rules.js` | Actions and their costs, the four degrees, damage and its order, kinds, resistances, conditions and lingering damage, sustained spells, surfaces |
| `src/combat/heat.js` | Heat bands, idle heat and drift, the attack penalty, edge and the ladder shift, and the seeded outcome pick (`hash(fightSeed, attempt, k)`) |
| `src/combat/round.js` | The tick scheduler: initiative, multi-action activities, Delay, the Quickened tick, reactions and genre noise |
| `src/combat/notebook.js` | Situation features, notes, learning from accepts and changes, playbook rules, nearest-neighbour drafting, personality, confidence, sync and why? |
| `src/combat/strays.js` | Telegraphs, adaptation to your habits, feints and hidden intents |
| `src/combat/grid.js` | 1-2-1 distance, reach, movement with occupancy and costs, sight, cover, height, areas, threat |
| `src/combat/battle.js` | `createBattle(spec, party, seed, attempt)`, `legalActions(battle, unitId)`, `apply(battle, action) → { battle, events }`, pure and serialisable |
| `src/combat/driver.js` | The one round loop (plan → Run → ticks → events → save hook), pausing at action boundaries; shared by the HUD, every auto mode and the sim, with its own tests |
| `src/combat/ai.js` | The fast policy: strays' plans by temperament and role, and the scripted player the sim and the notebook tests use |
| `src/combat/bestiary.js`, `encounters.js` | Stat blocks from archetype × genre × level × deep rank, lackeys, elites, Tale-leads, councils and canon foes; budgets; rift spec + layout (with `roomRects`) → fight rooms, encounter posts, arenas, and lead display names clear of the company's |
| `src/combat/describe.js` | Events → calm Log lines, odds bars and words, why? lines, summaries |
| `src/party.js`, `src/camp.js`, `src/embers.js` | Roster, likenesses, Road and work levels, warmth, Cheers, rests and the notebooks' storage; the real-clock camp day, scenes, talks, teaching and jobs; the Ember wallet and ledger |
| `src/world/scene-combat.js`, `anim.js` | Overlays, markers, telegraphs, surfaces, numbers, heat shimmer and outcome flashes; `timeline(events, { motion })`, `poseFrame(sprite, pose)`, the pose operations and procedural effects |
| `src/world/sprites-party.js`, `follow.js`, `scene-camp.js` | Rigs with anchors and key poses (kept out of the 2,500-line `sprites.js`); following; the camp's idle life |
| `src/ui/combat-hud.js`, `src/ui/camp.js` | Thin DOM: the HUD and planner, Setting out, Level up and the notebook page |
| `scripts/sim.mjs`, `scripts/tune.mjs` | Headless fights from the command line; the tuning grid behind `npm run tune` |

### 16.2 Fit with the engine

**Combat is a mode, not a scene.** The engine already has exclusive scene changes, a tick that stops when paused or hidden, still frames at `t === null`, hit-testing, walk promises, `onMiloMove` and `floatText`. It gains:

```js
world.setParty(members)                     // followers outside fights
world.setMode('explore' | 'combat')         // combat routes clicks and keys to onCombatCommand; walkTo, walkToEntity,
                                            // travelTo, leaveElsewhere and chop resolve false, as they do while `changing`
world.frameArena(rect)                      // the camera centres the arena at the exploration scale
world.hideActors(ids)                       // the wandering stray and the lead object step aside while combatants stand in
world.startCombat({ arena, units }) → Promise
world.playEvents(events) → Promise          // resolves when the timeline ends (at once with motion off)
world.showOverlay({ reachable, path, areas, threats, cover, telegraphs })
world.endCombat() → Promise
opts.onCombatHover(tile), opts.onCombatCommand(cmd)
```

`driver.js` owns the round loop and the shell owns the save, so `app.js` (already 4,035 lines) only wires them together. A fight starts from a shell-side sight check on `onMiloMove` against the frozen encounter posts; nothing new runs in the engine's tick. A new entity kind, `combatant` (`cb:<id>`), comes first in hit-testing and in `nearbyEntities()`, so the accessible list works for free. The arena pass and the encounters layer live in `elsewhere.js`, and the reachability test treats props as blocking.

### 16.3 Data and state

Main reads `content/combat/`, `content/party/` and `content/camp/` alongside the existing files and serves them over IPC. The Grimoire keeps `content/spells.json` for real commands, so combat spells live apart. `riftgen.json` is untouched, so every existing seed makes the same rift; Titan is `kaiju` in the data.

| File | Holds |
|---|---|
| `content/combat/rules.json` | Abilities, defences, conditions, surfaces, damage kinds, archetypes (Integrity, Guard, Resolve, Speed), resistances, temperaments (heat, Talk downs), heat bands and the edge rule, genre noise, modes, weapon arts, curves (Road XP, the Hearth cap, foe levels, XP per weight, the hero and stray lines, the Integrity factor the sim publishes per level and party size), budgets |
| `content/combat/callings.json`, `spells.json` | The nine callings level by level, charge tables; knacks and spells with their action costs |
| `content/combat/leads.json`, `anims.json` | One rule per riftgen mechanic, in `riftgen.json`'s order, with its effective-Integrity multiplier, its phase and its fallback; council rules; planned name hooks; pose specs, effect data and clip timings |
| `content/combat/foes.json` | Canon foes and their bows, cave lists by region, the Great Ones |
| `content/party/companions/<id>.json` | Calling, paths, sprite, want, recruit condition, service, field skill, gifts, idle heat, personality, reaction defaults, quest steps |
| `content/party/teamups.json`, `banter.json` | Team-ups; banter pairs and fight barks |
| `content/camp/scenes.json`, `talks/*.md` | Camp scenes; campfire conversations in the dialogue script format, with their requirements |

```js
embers: { balance, lifetime, ledger /* ≤ 300 */, paid: { [sourceId]: at } },
road: { xp, banked /* past the cap */, warding, spellcraft, paidFights: { [fightId]: at } /* ≤ 500 */ },
party: { roster: { [id]: { joinedAt, warmth, warmthWeek, path, paths, gear, control, reactions, quest, notes,
                           notebook: { file /* notebooks/<id>.notes */, count, rules, struck, sync, previous /* until the next Campfire */ } } },
         chosen: [id, id, id], formation, cheers, regulars: [{ id, riftSeed, calling, name }],
         rests: { breathers, lanternDay, nooks: { [riftId]: at }, freeReentry: { [riftId]: at } }, mode,
         calm: { noise, adaptation, odds }, strayMemory: { [genre]: { habit, count } } },
tally: { ...existing, byCrew: { claude, codex, jev, whisper }, services: { [residentId]: n } },
expedition: null | { runId, riftId, seed, depth, embersPaid, roomsDone, loot, away, battle: null | Battle /* ≤ 24 KB */ }
```

A saved `Battle` holds the attempt number, the outcome counter, the round and tick, initiative, every unit's Integrity, Buffer, heat, resources, tile and conditions, the telegraphs and the round's plan, the surfaces, sustained spells and their rounds left, and the last 60 Log lines. Notebooks live in the roster, not the battle, and their notes live in append-only files of their own (`notebooks/<id>.notes`, beside `state.json`), written atomically after each round, so the save stays small however long you play. New sections are normalised, idempotent and prototype-safe, and `scheduleSave(150)` runs after each action.

### 16.4 Tests and budgets

- **Honesty:** replaying the commands equals the saved battle (a property test over 500 seeds); the odds shown equal the odds used, within 0.5% over 100,000 seeded samples; a Try again's outcomes differ from the first attempt's.
- **Heat and edge:** the band table; §3.5's reference table, cell for cell, from the edge rule; the attack penalty, drift, Cool down and room heat from round 2; and the expected multipliers (0.95, 0.975 and 1.025).
- **Notebooks:** they learn only from accepts and changes, never from improvisations or auto play; changes count double; sync after 20 scripted fights is at least 80% against the scripted player; confidence is low on unseen genres; the same notebook, seed and fight give the same drafts; guard rails hold over 500 seeds; nothing leaves a notebook except by strike-out or reset; a 50,000-note notebook drafts within budget.
- **Tuning** (`npm run tune`, kept out of `npm test`, 200 auto-played fights per cell with Wilson intervals): for every reachable Road level (1–5 in Phase 4), mode, room kind and party size, Low rooms have a median of about 2 rounds and Moderate rooms about 3 (95th percentile at most 6), Tale-leads a median of 4–5 and at most 8, the time-to-down targets per level hold (§9), budgets hold, win rates sit in §9's bands, noise alone never turns a win into a loss, and a hairline Elsewhere's median is at most 12 minutes in Command and 6 Guided under §9's minutes model. Named cases: the first lead with a party of three at level 1; a party with a Wayfarer above the Road level wins at least as often, in no more rounds. `npm test` runs a 200-fight smoke version.
- **Content:** every riftgen mechanic has a rule, a multiplier and either a phase or the fallback, or a no-fight tag; every Titan mechanic can be won with no real-deadline pieces; every generated fight room can be won on auto; caps hold; bright strays never fight; no fought lead shares a companion's or resident's name unless `leads.json` tags it as a planned hook; Jev has no spoken lines anywhere, thought bubbles included; every id resolves; every combat name is in LORE's name index and collides with no other unless the index marks it as a deliberate echo (the paths named for what they echo: Milo's *Hearth*, Tova's *Stonewright*, Dusty's *High Noon*, Mae's *Case File*, Lumi's *Afterhours* and Nell's *Quiet Order*); every string passes `assertCalm`; and a denylist kept with the content tests rejects other games' names and terms in any content string (Baldur, Faerûn, illithid, beholder, owlbear, githyanki, tiefling, Hollow Knight, Eldritch Blast, Sneak Attack, Bardic Inspiration, Karmic Dice, Tactician, Honour Mode, fifth edition, Pathfinder, Golarion, Hero Point, Raise a Shield, Recall Knowledge, Reactive Strike, Treat Wounds, Battle Medicine and similar). MILO's own action names (Brace, Examine, Parting swipe) pass, and so do plain words like Stride, Step, Strike, Seek and Delay.
- **Promises:** a fight id pays once; talking down, bows and auto pay in full; everyone going Offline spends 0 Embers and loses nothing; the Ember cost ignores party size; warmth never falls; levels never drop; a likeness has identical stats and the same notebook; a Wayfarer's fighting level is never below their work level; letting a rift go re-offers its invitation; Lumi can be recruited with no late-night signals at all (`MILO_NOW` across three nights of keeping the bell); field-skill doors never guard the stitch point; sight never starts a fight in the wilds; no game path imports a crew or cloud module, and nothing in a notebook leaves the save; one campfire conversation a night (`MILO_NOW` across midnight).
- **Fit:** arenas over 500 seeds keep every wall face, never merge rooms, and never put the lead's footprint on the stitch point; with `roomRects` added, every Phase 3 layout fixture is byte-identical.
- **Animation:** palette keys only; every clip has a still frame; nothing draws while paused or hidden (engine tests reuse `fakeDom`, moved into `tests/fakedom.js`); a posed stray's canvas is built once per pose and frame.
- **Electron checks** (`tests/ui.mjs`): fight and win; a keyboard-only round; relaunch mid-fight lands on the same tick; a focus session and a rest's end each pause at the action boundary; correct a draft and see the notebook page gain the habit; recruit a regular, pick them at the campfire over a Wayfarer, set out and follow through a gate. `scripts/capture-combat.mjs`, `capture-anims.mjs` and `capture-camp.mjs` write sheets to `test-results/`.

| Work | Budget |
|---|---|
| A combat frame at 1280×820 with 16 actors (4 heroes, 8 foes, a lead, a guest, 2 drones) | ≤ 12 ms |
| Reachable tiles for one unit | ≤ 2 ms |
| One `apply` | ≤ 1 ms |
| One fast-policy decision (a stray's plan, the sim's scripted player) | ≤ 0.3 ms |
| One companion's draft from their notebook (three actions and a reaction), even at 50,000 notes | ≤ 0.5 ms |
| *Tell me how it went*, a whole fight | ≤ 100 ms |
| The 200-fight smoke run in `npm test` | ≤ 5 s |
| `npm run tune`, every cell | ≤ 10 minutes |

---

## 17. Build slices

Phase 4 becomes **the gameplay phase**, with combat as its spine. Each slice ships useful and game features together, with tests and a visual review. The animation waves (§14.5) are sized on their own.

| Slice | What | Proof |
|---|---|---|
| **4.0 Groundwork** | Embers (wallet, lifetime, ledger, earned from signals MILO already sees); **the Chronicle** (daily and weekly history, where the Ember ledger and later every fight's summary live); **Kindle and Banked Coals brought forward from Phase 5**, because rests and the focus pause need the timer; the Log's command bar and right-click menus | Each payment once, the cap, lifetime past it; the Chronicle lists every Ember with its source; a 50/15 cycle under `MILO_NOW`, a relaunch mid-session, and one reward per session |
| **4.1a Rules on paper** | Headless: three actions and a reaction, the four degrees, heat and edge, Integrity, Buffer and damage; the grid, battle, the round driver with its ticks, the fast policy and `scripts/sim.mjs`; fixed level-1 blocks for Milo, the Scribe and the Artificer against three strays; Command mode only, with companions' drafts from personality alone; telegraphs, Strike, Stride, Step, Brace, Examine, Assist and Reboot, Parting swipes and Shoulder, three abilities each, Tumbled and Spooked, low cover, going Offline | 1,000 seeded 3v3 fights end within 10 rounds with no stuck state; replaying the commands equals the saved battle; the odds shown equal the odds used, within 0.5% over 100,000 samples; the heat and edge tests |
| **4.1b The board** | One room of a wild Elsewhere: `roomRects`, the encounters layer, `setMode`, `frameArena`, `hideActors`, the sight check, overlays, markers and telegraph icons; the planner and tick playback; placeholder frames (wave A0) | Fight and win, and a keyboard-only round, in `ui.mjs`; Phase 3's layout fixtures unchanged |
| **4.1c Keep and resume** | Save after every action; the minimal HUD; pausing at action boundaries when a focus session starts and when a rest ends | Relaunch mid-fight lands on the same tick; a focus session and a rest's end each pause at the boundary |
| **4.2a Callings and spells** | Charges and about 10 spells with their action costs; 8 conditions with their numbers; weapon arts; callings to level 5, and the Scrivener, Tinker and Skirmisher to 12, because a Wayfarer's real level can pass the cap (a high-level Scribe upcasts the spells that exist until circles 4 and 5 arrive); Road XP, Warding and Spellcraft; Breathers, Campfires and top-ups wired to real rests | Calling tables validate; the Integrity and damage lines match §5.1; every Wayfarer feature to level 12 has a unit test; the tuning suite passes at levels 1–5 |
| **4.2b Terrain** | Height, light and the Hooklight, the 11 surfaces, *Dip*, the arena pass over every fight room, the field-boss arena; genre noise and its banner | Arenas over 500 seeds keep every wall face and never merge rooms; the lead never covers the stitch point; noise alone never turns a win into a loss |
| **4.2c Foes** | The bestiary: the stray lines, archetypes, lackeys, resistances and weaknesses; temperaments, Sneak and talking down; elites; one Tale-lead mechanic per genre with its bow, and the generic fallback for the rest; *The last page*; the three modes; stray adaptation by rank and level, and feints | The tuning suite per reachable level and mode; every foe adapts at its step; budgets hold; every mechanic mapped or on the fallback; a real rift's lead yields while its seam refuses, and its card offers the real actions |
| **4.2d The notebook and ways to play** | The notebook: drafting, confidence, sync, why?, playbook rules and the notebook page; Guided, *Let them choose*, *Let them handle it*, *Tell me how it went* and *Wrap it up* on the shared driver; reactions' Ask, Always and Never; the calm settings | Notebooks learn only from accepts and changes and never drop a note on their own; a 50,000-note notebook drafts within 0.5 ms; sync after 20 scripted fights is at least 80%; confidence is low on unseen genres; the same notebook, seed and fight give the same drafts; auto modes pay the same as Command over 200 seeds; *Tell me how it went* resolves within 100 ms |
| **4.3 The party and the camp** | Jev; **regulars** from wild stitches and bows (the Stockade already has room for 2); the muster, likenesses and following; Light, Read, Pick and Sort; Road level and the Hearth cap; work levels and titles; Margin Notes and Spare Parts; Cheers and conversation choices; teaching at the campfire, strike-out and reset; wave A2 | `tests/party.test.js`; a working-Claude fixture shows the likeness, with the Scribe's notebook; recruit a regular, pick them at the campfire over a Wayfarer and take them out through a gate (`ui.mjs`); a lesson at the fire copies exactly one habit; a Wayfarer above the Road level only makes fights easier |
| **4.4 The wilds and the rest of the Kit** | Caves with canon foes; field bosses by *Challenge*; suggested levels on the rift panel and War Table; the Adventure HUD with **Quiet and Adventure modes**; the skills engine, Marks, 150 examine lines, day and night; Cartography and Wayfaring from exploring, and 1 Ember per chunk revealed; Milo's Arts renamed; the first Riddle Note trail, which ends at the Last Bridge, where the Tollkeeper can be out-riddled and joins; the validators | Phase 4's existing proofs; caves fightable over 200 seeds; sight never starts a wild fight; Quiet mode shows today's overlay and Adventure the full HUD; by the end of Phase 4 the muster can offer six companions (the Scribe, the Artificer, Jev, the Tollkeeper and two regulars) for three places |

| Phase | The company grows |
|---|---|
| **5, Notice Board** | Rivet, Pip and Dusty; warmth, gifts, banter and campfire conversations; the first quest parts; lean-tos; camp jobs with output; meal boons; Gothic, Iron, Void and Frontier's other mechanics, tuned against real task rifts; the Tollkeeper's Act I delve becomes the first part of his quest |
| **6, Commissions** | Juno, Mae, Lumi and Tova; the Hold raises the cap to 7, with the Barracks and room for 4 regulars, and levels 6–7 are tuned; second paths; team-ups; fusion fights and Maelstrom councils; Neon, Noir and Nocturne's other mechanics; watchable commissions; title feats |
| **7, Grimoire** | Whisper and the Listening Leaf; the Longshot to level 12, for Whisper; voice commands in a fight ("Milo, raise the lantern"); Judgebird's Glance starts counting toward Jev's work level |
| **8, Mistmere** | Nell; Hana and the Crew Colossus, with Titan's other mechanics and wild Titans' Colossus from this week's focus; the Drowned Bell as a fight-puzzle; forged and crafted gear and tonics; the Keep raises the cap to 8 |
| **9, Stacks and Forge** | Vesperine; the handmade Elsewheres' bosses (the Throttle, the Endless Assembly, the Dowager of Dust, the Man with No Clues, the Deadline's duel); the Cinder Wyrm, the Blank Sovereign and the Mirror Heron; heart feats; relic gear; little homes; the Castle raises the cap to 10 |
| **10, Far Shore** | Pip's and Jev's homeward quests; the Grey Stag, the Someday King and the Cloud Leviathan's rescue; the remaining guests; *The Company Again*; deep ranks; the Citadel and Kingdom caps; and Act VII's *Show Them Hearthvale* played with your own camp, the Beginner at the fire with the companions you really gathered |

**Doc changes when this lands:**
- **PLAN.md:** §2 pillar 3 (a party that's all Offline wakes at the last lantern it rested at, as WORLD.md §6 already says); §4 (the Company as track 7, with its couplings named: the Road level to the Hearth's cap and to Warding's XP, the Wayfarers' fighting level to crew levels with no cap, warmth to one real habit each); §6 (Ember spends: challenging a field boss, going back in after everyone went Offline); §9 (combat and the party: three actions, temperature, the notebook, likenesses and regulars); §13 (Phase 4's slices; Kindle and the Chronicle moving forward; the Tollkeeper and regulars in Phase 4); §14 Q3 (Habitack's combat, once Chris answers §18 Q9).
- **LORE.md:** §4 (the Hooklight); §5 (likenesses; Jev never speaks, in fights too); §9 (Tova and Nell; the Tollkeeper's service); §10 (Hollow Knights renamed Hollow Sentries; the delve foes' bows; which wild creatures turn up in caves; the Cloud Leviathan as a rescue); §12 (Warding: tactical fights with the Company); §14 Act I (the Tollkeeper met at the end of the first Riddle Note trail); and the name index, which gains every combat name so the validators catch collisions.
- **RIFTS.md:** §2.5 (fighting in a real rift's Elsewhere, and the card's real actions); §3 Nocturne (Lumi's invitations also come from the Night Shift and wild Nocturne rifts, and each "no" is going to bed on time); §5 (a *Sleeps* column beside *Lives*; Juno and Pip as Weavers).
- **WORLD.md:** §6 (field bosses are challenged, never started by sight).
- A Phase 4 build contract, with ownership split along §16.1.

---

## 18. Open questions for Chris

1. **The Hearth cap.** Should the Hearth tier cap the Road level (Stockade 5, Hold 7 and so on), or should play alone decide how far the party grows? Either way it never touches the Wayfarers.
2. **Strong Wayfarers.** With no band, a busy month with Claude and Codex can put a level-9 Scribe in a level-5 company, and fights get visibly easier. That's the plan's reward for real work. Happy with it, or do you want a band after all? (A band would mean changing "never nerfed" in PLAN §4, track 3.)
3. **Likenesses.** Do the Clay Likeness and the Slate Double feel right, or should a working Wayfarer simply stay home?
4. **Kindle early.** Is it all right to bring the focus timer into Phase 4, so a finished session gives a party that's out a Breather?
5. **Diagonals and flanking.** Are 1-2-1 diagonals right, and should flanking exist as a Maud's Table option?
6. **Walking out together.** It's out of the plan unless you ask for it. Do you want it at all?
7. **Warmth from real habits.** Lumi warming when you keep your bell, Dusty when deadlines land early: nice, or too nudgy?
8. **Order of arrival.** Regulars from slice 4.3, the Tollkeeper at the end of Phase 4's first Riddle Note trail (which moves his Act I meeting earlier), then Rivet, Pip and Dusty in Phase 5. Is there anyone you'd rather meet sooner?
9. **Habitack's combat.** This plan retires it into Warding and the Company when the board comes home in Phase 5 (PLAN §14 Q3). Or would you rather keep it as a small side game?
10. **Jev's count.** By default only Judgebird's Glance casts in MILO count toward Jev's level. Do you want the opt-in tally from the Jev skill as well? It needs a one-line change to `jev.py`.
**Settled on 2026-09-29:**
- **Temperatures:** the idle heats stand, from Rivet's steady 10 to Jev's 50; paths and gear still shift them by up to 10.
- **Milo drafts too.** His notebook learns like everyone's, so a round you agree with is one key, and *Mine* keeps his turns yours (§3.2, §15).
- **Adaptation scales with the foe:** its rank and its level against the party's set how much it adapts, from lackeys that never do to leads above your level that plan for your two favourite habits (§3.6).
- **Notebooks keep everything** until you strike a note out or reset them, in files of their own so the save stays small (§3.3, §16.3).
