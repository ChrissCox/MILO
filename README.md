# MILO

**Monitor and Interface Layer for Operations.** MILO is a calm pixel world where Milo, a small chibi companion, keeps watch over your AI crew: Claude Code, Codex, and helpers such as Jev, Whisper, and local models. It grows out of Habitack and shares its quiet tone.

You open MILO and Milo walks out of his camp, says hello, and tells you what happened while you were away. The world stays on screen. Everything else is a light overlay you can ignore.

MILO is growing into a point-and-click RPG set in the Hushlands, where real work fuels the game and every game system also does a real job. The design and roadmap are in [PLAN.md](PLAN.md), and the world bible (regions, story, characters, bestiary, spells, items, festivals) is in [LORE.md](LORE.md). Real problems arrive as **rifts** where other genres bleed into the world (cyberpunk, a night city, gothic horror, dieselpunk and more). Their codex is [RIFTS.md](RIFTS.md), with the genre data in `content/genres.json`, and `scripts/rift-preview.mjs` renders the real map in every genre (`test-results/rift-genre-sampler.png`, `test-results/rift-bleed-map.png`). Hearthvale stays a sanctuary no rift can enter, and it grows from a camp into a kingdom whose defences are real automations. Beyond its gates is an endless, seeded world that keeps to the story, and the rifts in it are generated, so there's always another one. That design is [WORLD.md](WORLD.md), and `scripts/worldgen-preview.mjs` renders it: the whole of the Hushlands (`test-results/world-atlas.png`), Hearthvale and its frontier with real rifts bleeding in (`test-results/world-frontier.png`), and a sheet of generated rifts (`test-results/rift-sampler.png`). Since Phase 3 they're in the app: see [The Hearth and the wilds](#the-hearth-and-the-wilds-phase-3) below. The app icon is drawn by `scripts/make-icon.mjs` from the world's own palette and Milo sprite.

## Open

1. Run `scripts\Create-Shortcut.ps1` once in PowerShell. It puts a **MILO** shortcut on your desktop and in this folder, using `assets\milo.ico`.
2. Double-click **MILO** on the desktop, or **Launch MILO.vbs** in this folder.

Keep this folder where it is so the shortcut can find the app. MILO allows one window at a time; opening it again brings the existing window forward.

To start it from a terminal instead:

```powershell
& 'C:\Users\chris\Projects\MILO\node_modules\electron\dist\electron.exe' 'C:\Users\chris\Projects\MILO'
```

## What's in MILO

- **The world.** A top-down pixel map with Milo's camp, the watchtower, five empty plots (Long meadow, Sunny rise, Birch hollow, Pondside plot, Old orchard), and a harbor under fog. Click to walk, or use the arrow keys or WASD when the map has focus. Click a place to visit it.
- **Milo's greeting.** On launch Milo recaps what your crew did since you last looked: what finished, what started, what's still working, and what's waiting on you. **Show me** opens the watchtower; **Later** lets it fade.
- **Watchkeeping.** The watchtower lists your Claude Code and Codex sessions, grouped into Needs you, Working now, Finished recently (24 hours), and Earlier. Each row shows the agent, title, project folder, how long ago, and a short snippet of the last reply. Sessions you deleted in the Claude desktop app are left out, and a Codex thread imported from a Claude session that's already listed isn't shown twice. A Helpers section shows Jev, Whisper, and Ollama.
- **Gentle alerts.** While MILO is open, it checks every 10 seconds. When a task finishes or an agent needs you, Milo says so in a small speech bubble. If MILO is in the background, you also get a quiet desktop note; clicking it brings MILO forward.
- **The crew strip.** Small chips in the top left show each crew member at a glance: working, waiting on you, all done, resting, or designing a building.
- **Milo's skills.** At camp, Milo's skills show what he can really do. Each level is proven by a live check: Watchkeeping by reading your sessions, Tinkering by a building designed from your idea, Dispatch by a building your crew designed. Everything else stays locked until it's built.
- **Settings** at camp: who designs your buildings, motion, desktop alerts, and the launch greeting. MILO also follows your system's reduced-motion setting.

The **Places** button in the bottom left lists every place for keyboard and screen reader use. Escape closes a panel or a speech bubble.

### Plots and buildings (step 2)

Every place except Milo's camp and the watchtower is an empty plot waiting for you to decide what goes there.

1. **Visit a plot.** Its panel shows three ideas Milo picked from your skills and projects, each with what it would do for you and why he thought of it.
2. **Ask for more.** Type into the box ("what should go here?", "something for my drawing streams") and press Enter or **Ask for ideas**. Your crew comes back with three fresh ones.
3. **Build one.** **Build this** on an idea, or type your own and choose **Build my idea**. Milo asks the crew to design it. The plot turns into a building site, the crew member walks over and works there, and **Cancel** stops it at any time.
4. **It goes up.** The scaffold comes down in a short reveal and Milo tells you ("The Clip studio is built"). If the crew doesn't answer, Milo draws it himself with his kit and says so.
5. **Look it over.** The building's panel shows it drawn large, what it's for, who designed it and when, and its **level tree**: five real features to build later, each with a proof check. They're all Planned for now; Dispatch builds them in a later step. You can **Rename** it, **Redesign** it (with an optional tweak such as "make it cozier"), or **Clear plot** (after a confirm).

**Designer** at camp chooses who draws up plans: **Automatic** (Claude Code when it's signed in, then Codex, then Milo's kit), **Claude Code**, **Codex**, or **Milo's kit** (nothing leaves your PC). It also shows whether each crew member is ready, for example "Sign in by running claude in a terminal once".

### The Hearth and the wilds (Phase 3)

Hearthvale stays exactly as it was: a handmade sanctuary no rift can enter. Around it the world goes on for ever.

- **Real rifts.** Things MILO already sees open as rifts on the frontier, each naming its real cause in plain words first: crew still working past your **evening bell** (a Nocturne), a session that has waited on you for a day (the Knocking), Codex over 85% of its allowance, and a new building (a bright rift, a gift that fades). The more urgent, the closer to the walls. Each one seals itself when the real thing is done, and leaves something in your satchel. The watchtower lists them all, at every tier, with **Ward for 3 days** and **Let go**; a rift's panel says **Why** and **To mend it**, and draws the tear and its strays. Its echo floats over the matching place in the vale (a moon over camp, a knocker at the watchtower).
- **The wilds.** Walk out of any of the vale's four gates into the endless, seeded Hushlands, drawn at the vale's own scale (in the vale, the **Places** list names each gate and walks Milo out through it, so the wilds never need the map). The title bar says where you are ("The Whisperwood · waiting in the Hush"), and out there the **Places** list shows what's nearby and **Travel home**. Light the sleeping **lanterns** on the old roads and travel between any you've lit; the one Milo last rested at comes right after home on every travel list. Open chests (a few are friendly mimics), search Maker ruins (some hold a map tablet), read notes from the Old Company, listen at Tamsin's unfinished statues, and chop trees for birch, ash and pine logs (a felled tree grows back by the next day). Wild rifts open every day; step through any rift into its **Elsewhere**, mend a wild one, and go deeper. A real rift's seam won't take the thread: only the real fix seals it.
- **The map.** **Map** in the title bar, or the **M** key, shows the land you've explored under a fog of war, with your lanterns, the rifts, and the regions you've found, and travels to any lit lantern or home.
- **The Hearth.** Its panel (in **Places**) shows the camp's tier, what it defends, and what **the Stockade** needs, counted from real things: crew sessions MILO watched finish, buildings designed, days with MILO, and the birch and ash you've gathered. **Raise the Stockade** puts a palisade round the vale, with a gatehouse at each gate and banners by the north gate. Then the **War Table** by the north gate lists every rift by how pressing it is, with a map of the frontier, and holds the defences: the **Gate Bell** (one quiet desktop note when a rift reaches the walls; its own switch decides it, so it rings even with desktop alerts off), the first **ward-post** (one of three rules you choose, and can take down again), and the evening bell (also at camp; moving it lets a Nocturne it no longer covers close quietly, with no seal).
- **The Prologue.** "The Lantern Wakes" walks you through all of this in seven steps, from the light on the Lantern Hook, through a letter by paper bird and a crack past the north gate, to raising the Stockade. A small card under the crew strip shows the step you're on; tuck it away with its **–** button.

### The Kit and the Company (Phase 4)

Real work is the fuel, and everything here is calm: nothing punishes.

- **Embers.** Earned from real signals (a finished focus session, a crew session done, a question answered, a building designed); each pays once. Stepping through a rift costs a few, a cave 3, a field boss's **Challenge** 5. The wallet sits in the title bar and the **Chronicle** lists every Ember with its source.
- **Kindle.** The 50/15 focus timer and its banked rest, with a quiet bell. Fights pause at the next action when a session starts or a rest ends.
- **The Adventure HUD.** Minimap, orbs and tabs, a **Log** that doubles as the command bar, and right-click menus on everything. **Quiet mode** brings back the plain world. **Skills**, **Quests**, **Satchel**, **Company**, **Grimoire**, **Crew** and **Chronicle** are panels on the right.
- **Fights.** No dice: you plan the turn (three actions and a reaction each), then press **Run**, and the odds shown are the odds used. Companions draft from their own notebooks, which learn only from the drafts you accept or change. Play it **Guided**, by **Command**, **Let them choose**, or **Let them handle it**; strays are settled, not slain. A fight saves after every action and a relaunch lands on the same tick.
- **The Company.** Open **Company** to **Set out**: pick who comes (the crew, Jev, the Tollkeeper and regulars from wild stitches), set the formation and how you play. The chosen follow Milo through the wilds; the rest sit by the camp fire, asleep at night.
- **The wilds.** Caves, field bosses (only by **Challenge**), suggested levels on rift panels, **Sneak** inside an Elsewhere, and day and night from the real clock.
- **Errands and Act I (Phase 5).** A person who has warmed to you may ask for something: stand somewhere, cook something, bring something. It ends with a keepsake and something they remember. Errands under way show on the Board. After the Prologue, **Act I** continues under it in the story panel, and Mags Quire of the Bindery turns up on the north road.
- **Camp life (Phase 5).** Pick what Milo does while you focus in Kindle (chop wood, fish, forage or mine). When a session completes, he brings the haul home, once. Cook it at the fire, from the camp panel, into the tonics and Cheers your fights use. Every quest you finish blooms in the Blossomfield, a meadow south of the camp.
- **People (Phase 5).** Wendell, Gorrin the Cabbage Man and Jonas of the second spoon stand on the north road. Talk to them: you learn what each cares about by trying a kind word, a joke, a favour, the plain truth or shared craft, and they approve, frown, or shrug. What matters, they will remember. Once someone is fond of you they can come to camp and sit by your fire.
- **Task rifts (Phase 5).** The Board's own trouble opens rifts over the Town hall: Gothic for quests that have waited, Iron for too much in progress, Void for a quest too vague to start, Frontier for a deadline. None names a quest, and each seals when you mend the Board. Quests can carry a due date, read from the words ("by Friday") or set by hand.
- **The Board (Phase 5).** The **Town hall** on the upper road, or the HUD's **Quests** tab, with **Projects** and a **Pocket** for loose thoughts. Quests that have waited a while are set apart, and you can keep them or let them go with no mark. The HUD's **Quests** tab: add a quest in one line, and it's sorted into a main or side quest (tap to change) and tagged with the skill it trains. Start it, tick off steps, add notes, finish it. Finishing pays Embers and XP once, and never again if you reopen it.
- **The first Riddle Note trail.** Tamsin's first note turns up in a wild chest once the Prologue's crack is mended. Each riddle sends you to try something (Kindle, a rest, the Chronicle, the north gate) and the last to the Last Bridge, where the Tollkeeper asks his three riddles and joins.

## Privacy

- MILO reads `~/.claude` and `~/.codex` on this PC, **read-only**. It never writes to, moves, or deletes anything in those folders.
- Transcripts stay in MILO's main process; the window only receives short summaries (title, project, status, times, and at most 200 characters of the last reply). The window itself has no network access at all: its content security policy blocks connections and every web request is cancelled.
- **Designing buildings is the one thing that asks your crew.** When you ask for ideas or build one, MILO's main process runs the Claude Code or Codex command line on this PC, in an empty temporary folder, with no saved session. Claude Code runs with no tools, and with your CLAUDE.md files and its auto memory switched off (so nothing from `~/.claude` rides along, and nothing is written there). Codex runs with its skills list, its environment notes, its shell and file tools, web search and plugins switched off (checked against codex-cli 0.158 with a capture of what it sends); its own base instructions still go along. Codex also always sends a `~/.codex/AGENTS.md` if one exists, so MILO doesn't ask Codex while that file is there (it only checks that the file exists). Only this is shared with them: the question or idea you typed or picked, the plot's name and size, the names of the buildings already standing, your project folder names (`C:\Users\chris\Projects\*`), and the names and first 160 characters of your skill descriptions (`~/.claude/skills/*/SKILL.md`). **Never** session titles, transcripts, snippets, memory files, or anything from `~/.codex`. Claude Code sends that to Anthropic and Codex to OpenAI, under your own sign-in; the plot panel says who is asked each time, and switches name if Automatic mode moves on from Claude Code to Codex mid-request. A crew call you cancel, or one still running when you close MILO, is stopped with everything it started, and its temporary folder is removed. Choose **Milo's kit** at camp and nothing leaves your PC at all.
- **Rifts, the wilds and the Hearth add nothing that leaves your PC.** They're worked out in the window from what Watchkeeping already reads. A rift's cause may quote a session's title, as the watchtower does, but never a snippet or transcript text. The game's words and tables come from `content/*.json`, which the main process reads once and hands to the window.
- Open rifts save the title of the session they stand for in MILO's saved state, and a closed one keeps it for three days, while the War Table lists it. After that it becomes “a waiting session”.
- Other than that, the only network call is a local check of `http://127.0.0.1:11434` to see whether Ollama is running on this PC. Once per launch MILO also runs `python` locally to see whether Whisper is installed. When a new Claude Code session shows up in `~/.claude/sessions`, MILO runs one local PowerShell query for that process's start time, so a file left behind by a closed session is never mistaken for a running one.
- **Jev is a cloud service.** It's TypeSafe's decision model, reached through your Jev skill and router. When the router is on, message text goes to TypeSafe. MILO never calls Jev. It only reads the local stats file `~/.claude/jev-router/state.json` to show whether the router is on and what it has cost.

## Saved data

MILO keeps its own small state in `%APPDATA%\milo\state.json`, with the previous good save in `state.json.backup`: when you last looked, settings (including the Designer), Milo's spot on the map, skill levels, and your plots (their three ideas, what you asked, and each building's blueprint, name, designer and date). On launch Milo steps out of his tent and walks back to where you left him. Writes are atomic. If the main file is damaged, or holds something that isn't MILO's state, MILO opens the backup, and if neither can be read it leaves both files alone. A design that was still underway when MILO closed comes back as an empty plot with **Try again**; a redesign comes back as the building it was. A saved state from step 1 opens as-is, with every plot empty. Since Phase 3 it also keeps the Hearth's tier and real counts, your satchel, what you've done in the wilds (the chunks you've explored, lanterns lit, chests opened, notes read, trees felled today, and where Milo last stood out there, in `wilds.at`), the rifts open, warded, let go and belled with a short history, and your place in the Prologue. MILO always opens in the vale. An older state gains these with honest starting counts (the days and designs it can prove). Set `MILO_DATA_DIR` to use another folder.

For testing:

| Variable | What it does |
| --- | --- |
| `MILO_CLAUDE_HOME`, `MILO_CODEX_HOME` | Point Watchkeeping at other folders |
| `MILO_TEST=1` | Skips the one-window lock and holds desktop notes back |
| `MILO_ARCHITECT` | How the architect runs: `auto` (the default, following the Designer setting), `kit` or `offline` (never asks the crew, whatever the setting), or `fake` (a canned crew for tests: ideas containing "fail" fall back to Milo's kit, and `MILO_FAKE_DELAY_MS` sets how long it takes) |
| `MILO_PROJECTS_DIR` | Where the architect reads project folder names. Skill names come from `skills` in `MILO_CLAUDE_HOME` (or `~/.claude`) |
| `MILO_CLAUDE_BIN`, `MILO_CODEX_BIN` | Use a specific Claude Code or Codex executable |
| `MILO_NOW` | With `MILO_TEST=1` only: MILO's clock starts at this time (an ISO time or ms) and runs on from there, for Watchkeeping, the saved state and the window alike. The UI test uses it to open a Nocturne at 03:00 |

## Verify

Node isn't on PATH, so use the bundled runtime from this folder:

```powershell
cd C:\Users\chris\Projects\MILO
$node = 'C:\Users\chris\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node --test tests/watch.test.js tests/core.test.js tests/world.test.js tests/kit.test.js tests/architect.test.js tests/genres.test.js tests/riftgen.test.js tests/worldgen.test.js tests/rifts.test.js tests/content.test.js tests/art.test.js tests/wilds.test.js tests/elsewhere.test.js tests/mapview.test.js tests/shell.test.js tests/scene.test.js
& $node tests/ui.mjs
& $node scripts/capture-kit.mjs
& $node scripts/walkthrough-step2.mjs
& $node scripts/worldgen-preview.mjs
```

The unit tests cover session reading, recaps, skills, saved plots, the map, the building kit, the architect (with fake crew programs, never the real ones), the genre palettes, and the world and rift generators. The generator tests check determinism, that Hearthvale stays untouched and no rift opens inside the ward or on the Far Shore, that the roads join every region, that urgent real rifts open closer, and that every generated Elsewhere can be walked end to end. `scripts/worldgen-preview.mjs [seed] [day]` renders another world or another day. `tests/ui.mjs` drives the real app with Playwright and `MILO_ARCHITECT=fake`, against synthetic Claude and Codex folders, skills and projects built in a temp directory: the greeting and recap, the watchtower groups, a live session flipping from working to finished, alerts that arrive back to back, camp and the Designer setting, every plot starting empty with three ideas, asking for new ones, building one through to its level tree, rename, redesign and clear, a design that falls back to Milo's kit, the place list and map tips, the 1000×700 layout, buildings and `lastSeenAt` across a restart, a launch through a lowercase drive letter with a damaged `state.json`, and that nothing leaves localhost. For Phase 3 it walks Milo out of the north gate and back with the keyboard, lights a lantern on the old road, chops a tree beside it for logs and travels home, opens real rifts from made-up signals (a Codex reading at 91% and a session left waiting for 25 hours by a sleeping child process), checks their causes and that none stands in the ward or the vale, wards one, steps through into its Elsewhere and out, reads the Hearth's real counts, watches both rifts seal when their signals clear, checks that Escape or Keep it in a row's Let go hands focus back to that row, then relaunches at 03:00 to open a Nocturne: at the Camp its bell is Milo's bubble alone, and with the Stockade up the Gate Bell rings exactly once, with desktop alerts off. It checks the War Table and its defences (a background snapshot leaves its dropdown in place), visits a bright rift, travels to the lit lantern from the map, opens a chest, ruin, note or statue nearby, steps into a wild rift, stitches it and goes deeper, and checks the Hearth, the rift list and panel, a lantern, a place, the Elsewhere banner beside a rift panel, the Prologue, the War Table and the map at 1000×700. In each of those it also tabs through every control from the keyboard and checks that each one shows its focus ring, uncut, and that keyboard focus never drops to the page when a move takes away what had it (a crew chip through snapshots, a gate, Travel home and Leave from the place list, a lantern's Travel home, the banner's Leave). It also lets a rift seal while Milo walks out to it (he never steps into it), and keeps Milo inside a wild rift's Elsewhere past midnight on a test clock (its chest and seam still answer). With every count met and the logs gathered, it raises the Stockade from the Hearth panel. Last, it asks MILO to close while its saved state is still on the way, and checks nothing was written over it. `tests/shell.test.js` covers the shell's own Phase 3 helpers in `src/ui/`: the rift loop against fixture snapshots, the words for every place in the wilds, loot rolls, and the panels' escaping and pictures. Screenshots land in `test-results/`, only ever of the synthetic folders. Don't screenshot MILO running on your real sessions into this folder: titles and reply snippets would end up in the images. `scripts/capture-kit.mjs` renders a gallery of buildings to `test-results/kit-gallery.png`. With `--blueprints <file or folder> --out <folder>` it draws saved blueprint JSON files instead (for example real designs from the crew, kept outside the repo): each design at its plot's size with its emblem enlarged, the designs standing on their plots, and close-ups of each plot beside the hand-made camp and watchtower. `scripts/walkthrough-step2.mjs` walks one plot from empty to built and back (ask, build, the building site and reveal, rename, redesign, clear) with the same synthetic setup and saves each step as `test-results/step2-*.png`. Set `WALK_PLOT=plot-meadow` (or another plot id) to walk a different plot.

`scripts/world-preview.html` shows the world on its own with a pretend crew.

## Layout

| Part | Files |
| --- | --- |
| Shell | `electron/main.cjs`, `electron/preload.cjs`, `index.html`, `src/app.js`, `src/styles.css`, and `src/ui/` (the rift loop, the wilds' words and loot, the Phase 3 panels and their pictures, and the map view) |
| Rifts, the Hearth, the story | `src/rifts.js`, `src/hearth.js`, `src/story.js` (pure; real signals to rifts, the tiers' real counts, the Prologue) |
| Watchkeeping | `src/watch/` (Node only, runs in the main process) |
| Architect | `src/architect/` (asks the crew for ideas and designs; main process only, except the shared blueprint checks) |
| Core | `src/model.js`, `src/recap.js`, `src/skills.js` |
| World | `src/world/` (canvas pixel art, no libraries; `kit.js` turns blueprints into buildings) |
| Generators | `src/world/rng.js`, `worldgen.js`, `riftgen.js`, `straygen.js`, `wildsart.js`, `genres.js` (pure and seeded; run in Node and the window) |
| Content | `content/genres.json`, `content/riftgen.json`, `content/fortress.json`, `content/wilds.json`, `content/story.json` |

Plain JavaScript modules, no build step. `CONTRACT.md`, `CONTRACT-STEP2.md` and `CONTRACT-PHASE3.md` describe the shared data shapes.
