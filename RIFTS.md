# The Rift Codex

Real problems in MILO arrive as **rifts**: tears in the Hushlands where other stories bleed through. A rift is a real problem wearing another genre's clothes. A failing build opens onto a neon city in the rain; a task you've avoided for three weeks lets in a gothic manor; working at 3 a.m. brings the night city, and someone lovely on a bicycle who thinks you should stay up a little longer.

Rifts are also how the Hushlands grows. Strays from other stories can **stay** once their rift is mended, and each one who stays brings a real service, a shop, a quest line, a music track and a new look you can give your buildings. Over time your vale becomes a patchwork of every genre you've faced: a ghost runs the letters desk, a vampire keeps the night watch, a tin sergeant blows the shift whistle, and a small starry blob unfolds big tasks into little ones. The world ends up as mixed as your taste.

The genres' colours, weather and signals live in [`content/genres.json`](content/genres.json). A working prototype that renders the real map in every genre is [`scripts/rift-preview.mjs`](scripts/rift-preview.mjs). Rifts are generated, so there's always another one (§10), and they open in the wilds beyond Hearthvale, never inside it ([`WORLD.md`](WORLD.md)). This file is canon alongside [`LORE.md`](LORE.md) and [`PLAN.md`](PLAN.md).

---

## 1. What a rift is

**The Shelf of Worlds.** The Hushlands is one book on a very long shelf. Every book on it was begun by the same hand (the Beginner, in the oldest stories), and none of them was ever finished, because finishing a book closes it. The books sit spine to spine: a neon city, a night that never ends, a manor on a moor, a factory front, a sky with wrong stars, a rain-soaked detective town, a frontier junction, a bay where giants walk, gardens on glass towers, a festival of magical victories, a mountain sect above the clouds, and hallways that go on forever.

**Where pages thin.** The Hush makes a page thin. Wherever something in the Hushlands is left unfinished, unattended or overfull, the page wears through, and the ink of the neighbouring book bleeds in. That's a rift. What bleeds through always matches the kind of trouble:
- A machine left broken attracts the **neon city**.
- A late night attracts the **night city**.
- An old promise attracts the **manor**.
- An overfull week attracts the **factory front**.
- A thing too big to see attracts the **wrong stars**.
- An unanswered question attracts **noir**.
- A deadline attracts the **frontier**.
- A great trial attracts a **Titan**.

Good seasons thin the page too, in a kinder way. Balance brings the **gardens**, triumph brings **starlight**, and long quiet focus brings the **summit**.

**This isn't new.** The Hushlands has always been a little mixed. The Maker machines of Cinderforge, like the Old Bellows, came through a rift a thousand years ago from a book of rivets and diesel, and the Cinderfolk adopted them. The Old Company met rifts on the Long Road, and the Great Lighthouse turns out to be a **bookmark**: its light holds the Hushlands' page open and bright. When Tamsin relit it, the seams quietened for three hundred years. Now the Hush is back, the lantern in Hearthvale is lit again, and the other books have noticed the light.

**The Bindery.** In a hidden wing of the Stacks, bookbinders mend the seams between stories. Oriel founded it after the Long Road, having watched Tamsin stitch the Seam at the End of the World with a candle-wick. It's run today by **Margaret "Mags" Quire**, a retired starship quartermaster from a space-opera book, who fell through a rift sixty years ago in the middle of an inventory count and decided the Hushlands had better tea. She mends seams with a laser-awl. She's the living proof that strays can stay.

---

## 2. How rifts work

### 2.1 Real signals choose the genre

| Genre | Kind | Opens when (defaults, all adjustable) |
|---|---|---|
| **Neon** (cyberpunk) | shadow | A check or build fails · an agent session loops or runs 2+ hours without progress · a crew member's capacity passes 85% · a sync or connection fails · the same work appears twice |
| **Nocturne** (night-city romance) | shadow | You work past your evening bell · a focus session or crew dispatch after midnight · two or more rests skipped in a day · the crew run unattended overnight (the *Night Shift*, a welcome Nocturne that seals itself at dawn) |
| **Gothic** (gothic horror) | shadow | A quest untouched 14+ days · a crew member left waiting 24+ hours · a building unvisited 30+ days · something overdue |
| **Iron** (dieselpunk) | shadow | More than 3 quests in Doing · a quest's steps keep growing · 5+ admin quests open · too many crew runs at once · merge conflicts or a pile of uncommitted changes |
| **Void** (cosmic horror) | shadow | A quest too big or vague to start (no steps, open 7+ days) · 10+ alerts in an hour · too many things open at once |
| **Noir** (detective noir) | shadow | A crew member is asking you a question · a failure nobody can explain · a quest missing information |
| **Frontier** (western) | shadow | A deadline within 48 hours with its quest not started · deadline day · a promise to someone ("for mom", "reply to", "send to") |
| **Titan** (kaiju and mecha) | shadow | A big deadline (exams, launches, or anything you flag) 7 days out; it walks closer each day |
| **Verdant** (solarpunk) | bright | A balanced week: focus done, rests honoured, the evening bell kept, no rift older than a week |
| **Starlight** (magical girl) | bright | A milestone: a building level proven, a project finished, a 99, a big deadline beaten |
| **Summit** (wuxia and cultivation) | bright | A focus streak (3+ full sessions a day, several days running) · a study streak · exam preparation |
| **Backhalls** (liminal spaces) | neutral | You search (Found Things): Milo steps through a door where every lost thing is filed |

### 2.2 Where rifts open, and their stages

**Never inside Hearthvale.** The vale is sanctuary (WORLD.md). A real rift opens on the frontier beyond the Hearthward, on the side facing its genre's home region, and the more urgent the problem, the closer to the walls it opens. Inside the vale, a rift shows only as its **echo**: a harmless sign on the thing it's about, such as a portrait pinned to the notice board, a flicker on a building's sign or a wanted poster, pointing the way out through the gate. The War Table lists every rift with its real cause.

- **Hairline:** a crack out on the frontier, a hint of the genre around it, and its echo in the vale.
- **Open:** strays wander out and the bleed spreads a few tiles.
- **Gaping:** the bleed reaches about eight tiles, the region's music shifts, and the genre's **Tale-lead** steps through.

Rifts grow slowly (about a stage every few days) and stop at Gaping. As they grow more urgent they walk closer to the walls, but they never cross them: at the walls a rift rings the Gate Bell once and waits. They never destroy anything, never spread to other buildings, and never cost progress. A Titan instead approaches across the sea on a fixed schedule toward its date.

### 2.3 The bleed
- **Colour by role.** Each genre recolours the world by role (ground, foliage, path, water, wood, stone, roofs, flowers, glow, and so on). Every one of the world's 32 colours keeps its shading, so a neon cabin still looks like *your* cabin. Milo and the crew change "outfits" for free: in the Neon bleed Milo's honey raincoat goes cyan, in the Void it glows eldritch green, and in the Nocturne it becomes streetlight amber.
- **Pixel-art edges.** The fade is an ordered dither in 2×2 blocks, so each bleed has a deliberate pixel-art edge.
- **Overlaps fuse.** Where two bleeds overlap, their palettes interleave into a fusion (§4).
- **Weather:**

  | Genre | Weather |
  |---|---|
  | Neon | Pink rain |
  | Nocturne | Stars |
  | Gothic | Drifting fog |
  | Iron | Smog specks |
  | Void | Wrong stars |
  | Noir | Grey rain |
  | Frontier | Dust |
  | Titan | Siren sparkles |
  | Verdant | Petals |
  | Starlight | Sparkles |
  | Summit | Mist |
  | Backhalls | Nothing but the hum |

- **Music:** the ambient track takes on the genre, with synth bass, a slow organ, brass, guqin and so on.
- **Gentle rifts:** a setting keeps horror genres cosy (no eyes, no teeth, more candles). Any genre can be switched off entirely.

### 2.4 Strays
Every genre has **common strays** that wander inside the bleed, an **elite**, and a **Tale-lead** who appears at Gaping. Examining a stray always tells you the real cause in plain words:
- *"Portrait wraith: its eyes follow 'Email the landlord', untouched for 19 days."*
- *"Glitch drone: the Habitack checks have failed 3 times since Tuesday."*

### 2.5 What you can do

| Action | Real effect | In the world |
|---|---|---|
| **Stitch** | Fix the real thing: do the quest, answer the crew, pass the check, go to bed | The Bindery's thread runs through the tear and it closes with a soft snap; strays wave and go home; loot drops |
| **Send the crew** | A commission to fix it | The crew member walks into the rift and comes back with the spoils |
| **Ward** | Snooze it for a few days | A temporary binding stitch; the rift stops growing |
| **Let go** | Release the quest (archive it with thanks) | The Tale-lead bows, the tear becomes a moth, and the moth flies west |
| **Step through** | Nothing real; it's for fun (costs Embers) | Visit the genre's **Elsewhere** for a short adventure (§3) |
| **Invite to stay** | Unlocks that genre's resident and service | After a stitch, the stray or Tale-lead may settle in the Hushlands |

### 2.6 Bright rifts
Bright rifts are gifts. They open on good patterns, need no stitching, and close gently after a few days. While open they grow gardens, throw celebrations and bless your gathering. With Seamcraft you can **bottle** one and keep a small version as decor.

### 2.7 Honesty
- Every rift names its real cause.
- Thresholds are visible and editable.
- A rift never inflates a problem.
- Horror genres are cosy-spooky, never gory.
- Nothing is lost for leaving a rift alone.

---

## 3. The genres

Each entry covers the look, the strays, how to stitch it, loot, the resident who can stay (and the real service they bring), the **Elsewhere** behind the rift, and a few lines.

### Neon: cyberpunk (shadow)
- **Look:** rain-slick asphalt, magenta roofs, cyan light, violet highlights; pink rain; holo-signs flicker on your buildings; synth bass under the ambience.
- **Strays:**
  - *Glitch drones* buzz and repeat the last error.
  - *Loop daemons* circle a building humming the same three notes (a looping agent).
  - *Throttle agents* are grey-suited enforcers with meters for faces (crew capacity running high).
  - *Echo units* are two identical strays that insist they're the original (duplicated work).
  - **Elite:** the *Chrome Hound*.
  - **Tale-lead:** **Director Halvard Prism** of OmniLumen, a hologram executive who wants to acquire the Hushlands' Embers by the kilo.
- **Stitch:** pass the check (Mend the Forge), stop the looping run, wait for the refill (the rift shows when capacity resets), merge the duplicate.
- **Loot:** Neon shard, Glitch pearl, Chrome scrap.
- **Resident:** **Juno Glitchwright**, a netrunner who fell through a failing build and liked the tea. She opens *Juno's Fixit Kiosk* at Cinderforge, where she reads a failing check's output locally and explains it in one line. Unlocks neon signage skins and the track *Synth Rain*.
- **Elsewhere: Lumen Row.** A rain-soaked alley under the OmniLumen tower: a ramen stall run by a retired netrunner, a data-shrine, rooftop antennas like reeds.
  - **Arc:** *Terms of Service*.
  - **Boss:** *The Throttle*, a meter-headed enforcer who slows everyone down. You beat it by rerouting the power.
- **Lines:**
  - *Glitch drone (examine):* "It's buzzing an error code. The same one. Again."
  - *Juno:* "Your build didn't fail. It just had feelings about line forty."

### Nocturne: night-city romance (shadow, with a soft side)
- **Look:** midnight blue, sodium-amber lamps, pink accents, stars, a moon, the glow of a vending machine; lo-fi city pop at half tempo. It's the feeling of being out at 3 a.m. with nowhere to be: freedom with a little ache in it.
- **Strays:**
  - *Nightwings* are soft bat-moths that circle lamps.
  - *Insomniacs* are sleepwalking shadows holding cans of moonbrew, murmuring "just one more".
  - *Vending spirits* hum a lullaby and then sell you coffee.
  - **Elite:** *the Clock That Won't Chime*, stuck at 3:07.
  - **Tale-lead:** **Lumi Nightjar**, a vampire on a squeaky bicycle who thinks the night is the best part. Sometimes she's right.
- **Stitch:** end the session and ring the Evening Bell; take the rest you skipped. The Night Shift seals itself at dawn with the morning report.
- **Loot:** Moonlit coin, Nightwing scale, Canned moonbrew.
- **Resident:** **Lumi Nightjar.** Decline her invitation to stay up three times and she laughs and stays anyway. She becomes the **Night Watch**: while you sleep she watches the crew's overnight runs and tells you at breakfast what happened. The temptress turns out to be the night's guardian. Unlocks streetlamps that light your paths at real night, and the track *Afterhours*.
- **Elsewhere: Afterhours.** A city where it's always 3:07 a.m.: rooftops, a convenience store called Moon Mart, a footbridge over empty rails, cats.
  - **Arc:** *Just One More Hour*. You help Lumi face the one thing she avoids: the sunrise.
  - **Boss:** there's no boss. The chapter ends when you watch the sun come up together from the footbridge, and she complains, being a vampire. You win by going to bed.
- **Lines:**
  - *Lumi:* "The night's the only time nobody asks anything of you. Stay a bit?"
  - *Lumi, after you say no:* "Fine, fine. Go sleep. I'll keep an eye on your crew."

### Gothic: gothic horror (shadow)
- **Look:** grey-green grass, violet-grey paths, blood-rose roofs, candle-gold light; drifting fog; ravens on the fences; a distant organ.
- **Strays:**
  - *Portrait wraiths* are painted faces whose eyes follow the quest you forgot.
  - *Candle wraiths* are ghosts lighting the way back to it.
  - *Ravens of Overdue* caw a date.
  - *The Knocking* is a door that appears beside a crew member who's been waiting and knocks, politely.
  - **Elite:** *the Dust-Sheeted*, furniture under sheets that shuffles after you.
  - **Tale-lead:** **the Dowager Ashcombe**, who keeps every unanswered letter in her manor and reads them aloud, wistfully.
- **Stitch:** do the quest, answer the crew, visit or improve or retire the building, or let it go (the wraith smiles and the portrait goes blank).
- **Loot:** Grave wax, Raven quill, Portrait varnish.
- **Resident:** **Lady Vesperine Ashcombe**, the Dowager's niece, a ghost with excellent posture. She runs the *Unanswered Letters* desk in the Stacks: everything waiting on you, sorted by who's been waiting longest. Unlocks wrought-iron fences and candle lamps, and the track *Candlelight Waltz*.
- **Elsewhere: Hollowmoor.** A manor on a foggy moor with a conservatory, a gallery of portraits and a crypt of letters.
  - **Arc:** *The Dowager's Correspondence*. Each letter is one of your real stale quests; you choose to do it or release it.
  - **Boss:** *the Dowager of Dust*, resolved by releasing the last letter.
- **Lines:**
  - *Portrait wraith (examine):* "Its eyes follow 'Email the landlord'. Politely. Constantly."
  - *Raven:* "Caws a date. It's last Tuesday."

### Iron: dieselpunk (shadow)
- **Look:** olive-drab fields, dusty roads, rust roofs, tungsten light; smog; posters on the notice board; klaxons at shift change and a brass band somewhere.
- **Strays:**
  - *Tin clerks* are small riveted automatons stamping forms in triplicate.
  - *Smog golems* are slow and made of soot.
  - *Poster spirits* shout MORE; once stitched, they flip to REST IS PART OF THE ROAD.
  - *Jam gremlins* are tangles of gears (merge conflicts).
  - **Elite:** *the Quota Engine*.
  - **Tale-lead:** **Foreman Ottoline Vask** of the Endless Assembly, who has never seen a shift end.
- **Stitch:** finish or park quests until Doing is under your limit; split the growing quest; batch the admin in one clean focus session; resolve the merge.
- **Loot:** Diesel cog, Rivet plate, Poster ink.
- **Resident:** **Sergeant Rivet Maddox**, a tin foreman who fell through an overfull week and decided he'd rather run a tidy yard. He runs the *Dispatch Office*: it holds your in-progress limit, queues crew runs so they don't pile up, and blows a friendly whistle at the end of the day. Unlocks riveted walls, smokestacks and airship moorings, and the track *Shift Change Swing*.
- **Elsewhere: Ironvale Front.** A smog city of factories and airship docks where the quota rises every hour.
  - **Arc:** *Quota*.
  - **Boss:** *the Endless Assembly*. Shut its lines down one at a time; it's a puzzle about limiting work in progress.
- **Lines:**
  - *Tin clerk:* "Form 27-B, in triplicate. Then the form for the form."
  - *Poster (examine):* "It says MORE. It has always said more."

### Void: cosmic horror (shadow)
- **Look:** near-black ground, violet foliage, eldritch-green glow, pink specks like stars in the wrong places. Sounds come from the wrong direction.
- **Strays:**
  - *Watchers* are floating eyes: questions you haven't asked yet.
  - *Fractal hounds* are dogs whose outlines repeat inward forever.
  - *The Too-Many* is a swarm of tiny identical things (an alert flood).
  - **Elite:** *the Staircase Sideways*.
  - **Tale-lead:** **the Unbounded**, something far too big to see all at once. It isn't hostile. It's just too much.
- **Stitch:** break it down (Split the Scope turns the Unbounded into a staircase of small steps you can walk out on); quiet the flood (Quiet Hours); close what isn't needed.
- **Loot:** Folded star, Non-Euclidean nail, Void pearl.
- **Resident:** **Pip**, a small friendly voidling: round, starry, with too many eyes, all kind. It unfolds any big quest into small steps you can accept or edit. Unlocks starry roofs and impossible windows, and the track *Wrong Stars*.
- **Elsewhere: The Unmeasured Deep.** Stairs, stars, and doors that open onto sky.
  - **Arc:** *Counting the Uncountable*.
  - **Boss:** the Unbounded, resolved by naming its first small step.
- **Lines:**
  - *Watcher (examine):* "It's the question 'where do I even start'. It's looking at you."
  - *Pip:* "Big thing. Small things. Many small things. Better."

### Noir: detective noir (shadow)
- **Look:** a grey world with one red accent (roofs, scarves, a single umbrella); rain; streetlamp white; slow saxophone.
- **Strays:**
  - *Gumshoe shades* are silhouettes in long coats, looking for clues.
  - *Informants* whisper the crew's pending question.
  - *Red herrings* are actual red fish flopping near false leads.
  - **Elite:** *the Alibi*.
  - **Tale-lead:** **the Man with No Clues**, a very confused villain who doesn't know what he did.
- **Stitch:** answer the question; send the crew to read the logs; fill in the missing detail.
- **Loot:** Case file, Rain in a bottle, Smoky lens.
- **Resident:** **Detective Mae Holloway**: trench coat, red scarf, never without a notebook. She runs *Holloway Investigations* in Mistmere, a board of open questions and unexplained failures, each with its evidence. Unlocks rain-streaked windows and red awnings, and the track *Rain on Glass*.
- **Elsewhere: Grayrain.** A black-and-white city with one red umbrella.
  - **Arc:** *The Case of the Missing Reason*.
  - **Boss:** the Man with No Clues, solved by presenting three pieces of evidence.
- **Lines:**
  - *Informant:* "Word is, the Scribe's been asking which config you meant."
  - *Red herring (examine):* "Suspiciously red. Suspiciously herring."

### Frontier: western (shadow)
- **Look:** dry gold grass, dusty roads, terracotta roofs, a big sky; drifting dust; a slow guitar and a train far off.
- **Strays:**
  - *Tumbleweed imps* roll about.
  - *Outlaw crows* carry wanted posters with the quest's name.
  - *The clock-tower cuckoo* counts down.
  - **Elite:** *the Posse of Tuesday* (meetings).
  - **Tale-lead:** **the Deadline**, a masked outlaw who rides in at noon. He's fair. He just won't wait.
- **Stitch:**
  - Kindle a focus session for it: you ride out to meet him.
  - Reschedule honestly with the person. A parley ends the duel peacefully.
  - Or let it go.
- **Loot:** Sheriff's star, Tumbleweed twine, Dust of noon.
- **Resident:** **Sheriff Dolores "Dusty" Calloway** keeps the *Bounty Board*: every deadline as a bounty, sorted by who rides in first, each with a button to Kindle for it. Unlocks false fronts, hitching posts and a water tower, and the track *High Noon, Low Stakes*.
- **Elsewhere: Dustwater Junction.** A railroad town with a saloon that serves tea.
  - **Arc:** *High Noon*.
  - **Boss:** the Deadline, met with a short timing duel or a parley.
- **Lines:**
  - *Outlaw crow (examine):* "Caws 'DUE THURSDAY'. It has a tiny hat."
  - *Dusty:* "Nobody's in trouble yet. That's what the board's for."

### Titan: kaiju and mecha (shadow, seasonal)
- **Look:** concrete greys, hazard-yellow roofs, primary red and blue, siren sparkles, a brass fanfare.
- **Stages:**
  - **Horizon** (7 days out): a silhouette far off.
  - **Approach** (3 days out): footsteps, and the ground shakes gently.
  - **Landfall:** the day itself.
- **Strays:** *siren gulls* (screeching in tune with the siren) and *hazard-tape sprites*.
  - **Tale-lead:** **the Titan of [the event]**, named after the real thing ("the Titan of RT 2105 Finals"), with its own title card.
- **Stitch:** finish the deliverable. Every crew run and focus session aimed at it adds a piece to the **Crew Colossus**, a mecha assembled from Milo, the Scribe and the Artificer. The final battle is the real finish.
- **Loot:** Titan scale, Colossus bolt.
- **Resident:** **Chief Engineer Hana Kurogane** of the Titan Defense Hangar. She keeps a countdown for your big deadlines, with a plan broken into crew runs and focus sessions. Unlocks hangar doors and hazard stripes, a Colossus figurine for your cabin, and the track *Assemble*.
- **Elsewhere: Titan Bay.** A coastal city with a hangar under the harbour.
  - **Arc:** *Assemble*.
  - **Boss:** your season's Titan.
- **Lines:**
  - *Titan, far off (examine):* "It's very big and very far away. For now."
  - *Hana:* "Seven days. We've built bigger things in less. Coffee?"

### Verdant: solarpunk (bright)
- **Look:** vivid greens, sky-blue water, terracotta and solar gold, drifting petals, wind chimes.
- **Gifts:** gardens grow twice as fast inside it; roof gardens sprout on your buildings; better gathering; Sunleaf.
- **Visitors:** pollinator drones, solar sprites.
  - **Tale-lead:** **Juniper Sol**, a garden architect who plants on roofs.
- **Resident:** Juniper keeps the *Balance Report*: a weekly look at work, rest and evening bells. Unlocks green roofs and solar skins, and the track *Wind Chime Morning*.
- **Elsewhere: Solace Gardens.** Terraces, turbines, and a library inside a greenhouse. There's no boss, only seed quests.

### Starlight: magical girl (bright)
- **Look:** pink meadows, butter paths, lilac trees, sparkles, a bright theme tune.
- **Gifts:** a transformation for Milo (for a day his raincoat becomes a ribboned magical coat), confetti, Star ribbons, and a statue for your garden.
- **Visitors:** star-rabbits (mascots who believe in you, loudly), heart-shaped kites.
  - **Tale-lead:** **Sera Starling**, a magical girl who turns up to celebrate other people's wins.
- **Resident:** Sera keeps the *Book of Deeds* (milestones and achievements) and throws your celebrations. Unlocks magical skins and the track *Transformation (Calm Version)*.
- **Elsewhere: Starfall Plaza.** A festival square where every day is somebody's victory party. There's no boss, only celebration quests.

### Summit: wuxia and cultivation (bright)
- **Look:** misty jade meadows, stone paths, vermilion roofs, drifting mist, a guqin melody.
- **Gifts:**
  - **Cultivation stages** as Focus milestones: Condensing Qi → Foundation → Golden Core → Nascent Soul → Spirit Severing.
  - A **breakthrough** celebration at each.
  - Doubled idle gathering during focus while it's open.
  - Qi jade.
- **Visitors:** crane messengers, disciples sweeping the steps.
  - **Tale-lead:** **Master Qinglan of the Cloudgate Sect**, who drinks too much tea and speaks in short sayings.
- **Resident:** Master Qinglan runs *Closed-door Cultivation*, deep-work plans made of chains of focus sessions and rests, and study sprints before exams. Unlocks tiled roofs and moon gates, and the track *Cloudgate Morning*.
- **Elsewhere: Cloudgate Peak.** A sect above the clouds.
  - **Arc:** *The Breakthrough*, trials of stillness rather than fists.
  - **Boss:** *the Heart Demon*, the voice that says you can't. You beat it by finishing a real focus session.
- **Note:** Summit plus Nocturne makes **Moon Cultivation**, a night of study before an exam. One night is fine. A second night in a row flips it fully to Nocturne.

### Backhalls: liminal spaces (neutral)
- **Look:** yellowed carpet, fluorescent light, identical doors, a humming silence. It's calm, not scary.
- **Opens:** whenever you search. Milo steps through a door, and every lost thing is filed in a room.
- **Visitors:** exit signs that point at each other.
  - **Tale-lead:** **the Night Janitor**, a quiet custodian who knows where everything is.
- **Resident:** the Night Janitor runs the *Lost and Found*: search results as rooms, recent items, and "you left this open". Unlocks liminal skins (for a laugh) and the track *Fluorescent Hum*.
- **Elsewhere: The Backhalls.** Endless and soft; every room holds something you once put down.

---

## 4. Fusions: combining genres

When one real thing carries more than one signal (a failing build nobody has touched for weeks, or a deadline tomorrow while you're up at 2 a.m.), its rift is a **fusion**: both genres at once, interleaved, with their own strays and loot.

| Fusion | Genres | When | Looks like | Fusion stray |
|---|---|---|---|---|
| **Neon Nocturne** | Neon + Nocturne | A build or agent failing late at night | Synthwave rooftops at 3 a.m., glitching vending machines | *Static Nightwing* |
| **Haunted Machine** | Neon + Gothic | A failing check nobody's looked at for weeks | A server crypt, neon candles | *the Ghost in the Stack* |
| **Midnight Manor** | Gothic + Nocturne | Old unanswered things, and you're up late | A candlelit ballroom at midnight | *the Count of Unsent Letters* |
| **Chrome and Diesel** | Iron + Neon | Too many crew runs at once, some failing | A factory of glitching automatons | *Rust-chrome clerk* |
| **Soot and Shadow** | Iron + Gothic | A stale pile of admin | A soot-black workhouse | *the Ledger Ghost* |
| **Eldritch Case** | Void + Noir | A vague task that's also a mystery | A case in streets that don't add up | *the Detective Who Saw Too Much* |
| **Starless Moor** | Void + Gothic | A huge vague task left for weeks | Wrong stars over a ruined chapel | *the Moor Watcher* |
| **Tech Noir** | Noir + Neon | Checks failing for no clear reason | Rain, holograms, a trench coat at a terminal | *the Replicant Informant* |
| **Midnight Showdown** | Frontier + Nocturne | A deadline tomorrow and you're up late | A moonlit duel at the edge of town | *the Night Rider* |
| **Titan Western** | Frontier + Titan | A big deadline arriving | A giant striding across the desert | *the Tumble-Titan* |
| **Diesel Mecha** | Titan + Iron | Many crew runs aimed at one big deadline | The Colossus as a riveted walker | *Hangar clerks* |
| **Magical Colossus** | Titan + Starlight | The big deadline, beaten | The Colossus transforms; ribbons everywhere | *star-rabbit pilots* |
| **The Haunting Ends** | Gothic + Starlight | Finally finishing a long-stale task | A dark magical transformation, then dawn | *the Freed Portrait* |
| **Solar Circuit** | Verdant + Neon | A balanced week with tech wins | Green neon gardens on glass towers | *Circuit bees* |
| **Moon Cultivation** | Summit + Nocturne | A night of study before an exam (once) | Meditating on a moonlit peak | *the Moon Crane* |

**Maelstroms.** Three or more genres at once make a **Maelstrom**, a patchwork storm where every genre bleeds together. It's the real worst case, played for drama: a failing build (Neon), weeks untouched (Gothic), due tomorrow (Frontier), and you're up at 2 a.m. (Nocturne). The Tale-leads argue in the middle of it. Fixing the real thing collapses the whole storm at once and drops **Maelstrom glass**, the rarest essence.

---

## 5. Residents

Strays who stay make Hearthvale a crossover town. Each resident brings one real service, one stall or home, a quest line, a music track and a set of genre skins.

| Resident | From | Lives | Real service |
|---|---|---|---|
| **Juno Glitchwright** | Neon | Cinderforge | Explains failing checks in one line (read locally) |
| **Lumi Nightjar** | Nocturne | the camp roof, at night | The Night Watch: overnight crew report at breakfast |
| **Lady Vesperine Ashcombe** | Gothic | the Stacks | The Unanswered Letters desk: everything waiting on you |
| **Sergeant Rivet Maddox** | Iron | the Dispatch Office, Hearthvale | Your in-progress limit, the crew queue, the evening whistle |
| **Pip** | Void | anywhere it likes | Unfolds big quests into small steps |
| **Detective Mae Holloway** | Noir | Mistmere | The board of open questions and unexplained failures |
| **Sheriff Dusty Calloway** | Frontier | the notice board | The Bounty Board: deadlines ranked |
| **Chief Hana Kurogane** | Titan | the Hangar, Mistmere cliffs | Big-deadline countdown and plan |
| **Juniper Sol** | Verdant | the Old orchard | The weekly Balance Report |
| **Sera Starling** | Starlight | the Garden of Statues | The Book of Deeds; your celebrations |
| **Master Qinglan** | Summit | a tea house on Sunny rise | Deep-work and study-sprint plans |
| **The Night Janitor** | Backhalls | behind any door | The Lost and Found (search) |
| **Mags Quire** | a space opera | the Bindery, the Stacks | Leads the Bindery; teaches Seamcraft |

---

## 6. Essences and fusion crafting

Stitching a rift drops its genre's **essences**. **Seamcraft**, the new skill, weaves them with Hushlands materials into things no single book could make.

| Essence | Genre |
|---|---|
| Neon shard · Glitch pearl · Chrome scrap | Neon |
| Moonlit coin · Nightwing scale · Canned moonbrew | Nocturne |
| Grave wax · Raven quill · Portrait varnish | Gothic |
| Diesel cog · Rivet plate · Poster ink | Iron |
| Folded star · Non-Euclidean nail · Void pearl | Void |
| Case file · Rain in a bottle · Smoky lens | Noir |
| Sheriff's star · Tumbleweed twine · Dust of noon | Frontier |
| Titan scale · Colossus bolt | Titan |
| Sunleaf · Solar glass | Verdant |
| Star ribbon · Wishing sparkle | Starlight |
| Qi jade · Cloud silk | Summit |
| Fluorescent hum · Lost key | Backhalls |
| **Maelstrom glass** | any Maelstrom |

**Fusion recipes (a first dozen):**
- **Neon lantern** (lantern + Neon shard): Milo's lantern glows cyan.
- **Gothic conservatory** (Construction + Grave wax + Sunleaf): a building skin, ivy and candles under glass.
- **Diesel mill** (Construction + Diesel cog): a riveted skin for any workshop.
- **3 a.m. streetlamp** (Moonlit coin + ironroot): path lamps that light at real night.
- **Noir trench coat** (Case file + cloth): an outfit for Milo.
- **Frontier poncho** (Tumbleweed twine + wool): an outfit for Milo.
- **Starlit ward-wand** (Star ribbon + ash): a Warding weapon.
- **Qi jade pendant** (Qi jade + silverstone): more idle gathering during focus.
- **Titan-scale shield** (Titan scale + tidesteel).
- **Pip's pocket** (Folded star + satchel): a bigger satchel.
- **Mixtape of Worlds** (any three essences): unlocks a fusion music track, such as *Neon Nocturne* or *Organ and Brass*.
- **Bottled rift** (Maelstrom glass + a bright-rift essence): keep a tiny living rift as decor.

**Genre skins for buildings.** The step 2 kit gains a `genre` in each blueprint's style, so any building can be drawn in any genre you've befriended, or asked for directly: "make the Clip studio dieselpunk with a neon sign." Skins combine too. A Gothic conservatory with Neon signage is allowed, and encouraged.

---

## 7. The far shelf (genres to come)

New genres arrive as content packs. Each needs a palette, strays, a resident, an Elsewhere and a real signal:

| Genre | Name on the shelf | A possible real signal |
|---|---|---|
| Space opera | **Starward** | Long voyages: projects running 3+ months |
| Pirate | **Brine** | Money matters: budgets, bills, subscriptions |
| Post-apocalyptic | **Rustlands** | Abandoned repos and dead code |
| Steampunk | **Brasswork** | Your own inscribed spells misfiring |
| Dark fairy tale | **Thornwood** | Promises and bargains: renewals, trials ending |
| Mythic | **Pantheon** | Yearly goals and grand ambitions |
| Samurai | **Ronin** | Habits and discipline streaks |
| Cosy mystery | **Teacup** | Small puzzles, lost things in notes |
| Office surreal | **The Mundane** | Email and paperwork (the Great Post) |
| Sports anime | **Arena** | Game days and fantasy drafts |
| Heist | **The Job** | A plan needing the whole crew at once |
| Isekai | **The Other Side** | Importing another app's data into MILO |

---

## 8. The rift story

- **Prologue.** As the lantern catches, a hairline crack opens just past the north gate, and its echo flickers on the notice board. Milo stares at it. "That's new. That's… not ours." Then, looking at the ring of lantern-light: "It can't come in. Not while the lantern's lit."
- **Act I: The First Rift.** Your first stray, your first stitch. Mags Quire arrives by paper bird with a laser-awl and strong opinions. *An Invitation to Stay* brings your first resident.
- **Act III: The Index of Tales.** In the Stacks, Oriel shows you the Index: the catalogue of the shelf, with the Hushlands on it as one entry among many. She tells you about the Beginner.
- **Act V: The Greyreach Maelstrom.** The backlog wilderness turns out to be where every kind of bleed pools: a patchwork land where a neon alley opens onto a gothic moor beside a dieselpunk railway. The Someday King's court is a masquerade attended by strays of every genre.
- **Act VI: The Bookmark.** At the Far Shore the Lightkeeper tells you what the Lighthouse really is.
- **Act VII: The Margin (new).** You walk through a Maelstrom to the white space at the edge of the page and meet **the Beginner**: an ink-stained figure made of crossed-out lines, kind and tired, who began every book on the shelf and has been rereading them, restless, because they can't decide what kind of story any of them should be.
  - You show them the Hearthvale you've made: a ghost running the letters desk, a vampire keeping the night watch, a tin sergeant blowing the shift whistle, a voidling unfolding tasks, a magical girl throwing parties for small wins.
  - The Beginner understands. A world doesn't need to be one genre, or finished. It needs people living in it.
  - They leave a bookmark in every book, and the **Age of Doors** begins. Rifts still open when something needs you, but now you can visit any Elsewhere you've befriended, whenever you like.

**Festival: the Night of Many Tales (31 October).** Every befriended Elsewhere opens safely for one night. The crew wear genre costumes: the Scribe as a gothic night-librarian, the Artificer as a netrunner, Jev as a courier drone, Whisper as a raven of record. Strays from every genre come to a party at the camp.

---

## 9. Writing the genres

- **Cosy first.** Every genre passes through the Hushlands' calm. Horror is spooky, not scary; noir is moody, not cruel; cyberpunk is neon and rain, not violence; the Nocturne is wistful, not dangerous.
- **Each genre has a lexicon.**
  - **Neon:** error codes, throttles, "acquire".
  - **Nocturne:** "just one more", streetlights, 3:07.
  - **Gothic:** letters, portraits, candles, the moor.
  - **Iron:** forms, quotas, shifts, whistles.
  - **Void:** too many, sideways, first step.
  - **Noir:** the case, evidence, rain.
  - **Frontier:** noon, bounty, parley.
  - **Titan:** assemble, landfall, hangar.
  - **Verdant:** seeds, balance.
  - **Starlight:** believe, celebrate.
  - **Summit:** stillness, breakthrough.
  - **Backhalls:** hum, filed, found.
- **Strays are people too, mostly.** Give each a small want. The Glitch drone wants its error read. The portrait wants to be finished or forgiven. The Deadline wants a fair duel.
- **Never mock the real problem.** The joke is always on the genre, never on Chris.
- **Always name the real cause** in the examine line, in plain words, before the flavour.

---

## 10. Procedural rifts: there's always another one

Every rift is built entirely from a seed by [`src/world/riftgen.js`](src/world/riftgen.js), with its words in [`content/riftgen.json`](content/riftgen.json), and every stray by [`src/world/straygen.js`](src/world/straygen.js). The world side (where rifts open, and the frontier) is in [`WORLD.md`](WORLD.md).

### 10.1 Three kinds of seed

- **Real rifts.** The seed is a hash of the real cause: the thing's key (a repo, a quest) plus its signals. The same problem is always the same rift, with the same name, strays, Tale-lead, loot and Elsewhere. Only its stage changes, as urgency grows from hairline to open to gaping. If the problem changes (a failing check that has now also gone stale), it becomes a different rift, a fusion.
- **Wild rifts.** The seed is the world seed, the chunk, the day and a counter. The wilds hold new rifts every day, and their genres follow the region's affinity (WORLD.md §5). They have no real cause and say so.
- **The ladder.** Stitch a wild rift and a deeper one opens beneath it:
  - depth goes up by one;
  - the tier rises every three depths, to 8;
  - the genres lean toward the parent's;
  - the Elsewhere grows, up to 1.6× its size.

  There's no bottom, and the loot keeps pace.

### 10.2 What's generated

| Part | How |
|---|---|
| **Genres** | Real: from the signals (one, two for a fusion, three or more for a Maelstrom). Wild: weighted by the region. A second genre joins with a chance of `16% + 2.5%` per tier (to 50%), and a third, making a Maelstrom, with `4% + 1.2%` per tier (to 30%). |
| **Name** | Patterns and word banks per genre ("The {noun} of {name}", "{adj} {noun} of {place}", "Level {num}: {adj} {noun}"), with real rifts naming their cause ("The Portrait of {subject}", "{subject}, Error {num}"). A named fusion titles its real rifts ("Haunted Machine: Habitack"), a Maelstrom is "The Maelstrom of the MILO plan", and wild rifts wear their first affix ("The Crowded Grinding Crypt"). |
| **Affixes** | Real rifts have none or one; wild rifts have one to three, from 38 (Flooded, Overgrown, Mirrored, Labyrinthine, Candlelit, Rainbound, Clockwork, Upside-down, Bookmarked and more). Each changes the Elsewhere's shape, the loot, the number of strays, or brings a guest genre. |
| **Strays** | Three kinds (four in a fusion, plus any guest genre). Each is a body archetype (floater, walker, crawler, flier, ghost, construct) with one or two of its genre's 48 parts: visors, bat wings, candles, smokestacks, extra eyes, a fedora, a cowboy hat, hazard stripes, a leaf crown, a bow, a topknot, a mop. In a fusion a stray often wears a part from the other genre, coloured by that genre's palette, so a Haunted Machine's candle wraith has a neon visor. Each has a name, a temperament and a count. |
| **Tale-lead** | A title from the genre's boss patterns ("Chief Architect Lux of the Rainline"), a mechanic (sometimes borrowed from the second genre), and a line. A Maelstrom's Tale-lead sits with a council, one from each other genre. |
| **Loot** | Essences of each genre (more for deeper stages, higher tiers and lucky affixes), Maelstrom glass from a Maelstrom, and sometimes a relic with a story: *"Once belonged to Kiro, who filed everything, including themselves."* |
| **The Elsewhere** | Rooms joined by a minimum spanning tree, plus a few loops. Labyrinthine adds winding corridors; Mirrored reflects the left half onto the right. The entrance is leftmost, the Tale-lead is in the room farthest away, loot is in dead ends, and a puzzle room is halfway. Water and growth come from affixes. Size grows with stage and depth. |

### 10.3 Promises the generator keeps (tested)

- The same seed makes the same rift, every time, and a real rift never changes except by stage.
- Every Elsewhere can be walked from the entrance to the Tale-lead, the stitch point, the puzzle and every loot room, including the mirrored and labyrinthine ones.
- Names never show a stray `{token}`, an exclamation mark or a doubled space, and over 3,000 wild rifts more than 80% of names are unique.
- Every genre turns up in the wilds; fusions are common and Maelstroms rare.
- Every stray is a 20×20 grid of real palette keys, and a crossed stray's second-genre pixels are marked so the right palette colours them.
- A real rift always states its real cause in plain words, and a wild rift is always labelled wild.

`scripts/worldgen-preview.mjs` renders a sampler of generated rifts (real ones from example causes, and wild ones from four regions, the far lands and eight rungs down the ladder), the frontier around Hearthvale with real rifts bleeding into the wilds, and an atlas of the whole of the Hushlands.
