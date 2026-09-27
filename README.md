# MILO

**Monitor and Interface Layer for Operations.** MILO is a calm pixel world where Milo, a small chibi companion, keeps watch over your AI crew: Claude Code, Codex, and helpers such as Jev, Whisper, and local models. It grows out of Habitack and shares its quiet tone.

You open MILO and Milo walks out of his camp, says hello, and tells you what happened while you were away. The world stays on screen. Everything else is a light overlay you can ignore.

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

## Privacy

- MILO reads `~/.claude` and `~/.codex` on this PC, **read-only**. It never writes to, moves, or deletes anything in those folders.
- Transcripts stay in MILO's main process; the window only receives short summaries (title, project, status, times, and at most 200 characters of the last reply). The window itself has no network access at all: its content security policy blocks connections and every web request is cancelled.
- **Designing buildings is the one thing that asks your crew.** When you ask for ideas or build one, MILO's main process runs the Claude Code or Codex command line on this PC, in an empty temporary folder, with no saved session. Claude Code runs with no tools, and with your CLAUDE.md files and its auto memory switched off (so nothing from `~/.claude` rides along, and nothing is written there). Codex runs with its skills list, its environment notes, its shell and file tools, web search and plugins switched off (checked against codex-cli 0.158 with a capture of what it sends); its own base instructions still go along. Codex also always sends a `~/.codex/AGENTS.md` if one exists, so MILO doesn't ask Codex while that file is there (it only checks that the file exists). Only this is shared with them: the question or idea you typed or picked, the plot's name and size, the names of the buildings already standing, your project folder names (`C:\Users\chris\Projects\*`), and the names and first 160 characters of your skill descriptions (`~/.claude/skills/*/SKILL.md`). **Never** session titles, transcripts, snippets, memory files, or anything from `~/.codex`. Claude Code sends that to Anthropic and Codex to OpenAI, under your own sign-in; the plot panel says who is asked each time, and switches name if Automatic mode moves on from Claude Code to Codex mid-request. A crew call you cancel, or one still running when you close MILO, is stopped with everything it started, and its temporary folder is removed. Choose **Milo's kit** at camp and nothing leaves your PC at all.
- Other than that, the only network call is a local check of `http://127.0.0.1:11434` to see whether Ollama is running on this PC. Once per launch MILO also runs `python` locally to see whether Whisper is installed. When a new Claude Code session shows up in `~/.claude/sessions`, MILO runs one local PowerShell query for that process's start time, so a file left behind by a closed session is never mistaken for a running one.
- **Jev is a cloud service.** It's TypeSafe's decision model, reached through your Jev skill and router. When the router is on, message text goes to TypeSafe. MILO never calls Jev. It only reads the local stats file `~/.claude/jev-router/state.json` to show whether the router is on and what it has cost.

## Saved data

MILO keeps its own small state in `%APPDATA%\milo\state.json`, with the previous good save in `state.json.backup`: when you last looked, settings (including the Designer), Milo's spot on the map, skill levels, and your plots (their three ideas, what you asked, and each building's blueprint, name, designer and date). On launch Milo steps out of his tent and walks back to where you left him. Writes are atomic. If the main file is damaged, or holds something that isn't MILO's state, MILO opens the backup, and if neither can be read it leaves both files alone. A design that was still underway when MILO closed comes back as an empty plot with **Try again**; a redesign comes back as the building it was. A saved state from step 1 opens as-is, with every plot empty. Set `MILO_DATA_DIR` to use another folder.

For testing:

| Variable | What it does |
| --- | --- |
| `MILO_CLAUDE_HOME`, `MILO_CODEX_HOME` | Point Watchkeeping at other folders |
| `MILO_TEST=1` | Skips the one-window lock and holds desktop notes back |
| `MILO_ARCHITECT` | How the architect runs: `auto` (the default, following the Designer setting), `kit` or `offline` (never asks the crew, whatever the setting), or `fake` (a canned crew for tests: ideas containing "fail" fall back to Milo's kit, and `MILO_FAKE_DELAY_MS` sets how long it takes) |
| `MILO_PROJECTS_DIR` | Where the architect reads project folder names. Skill names come from `skills` in `MILO_CLAUDE_HOME` (or `~/.claude`) |
| `MILO_CLAUDE_BIN`, `MILO_CODEX_BIN` | Use a specific Claude Code or Codex executable |

## Verify

Node isn't on PATH, so use the bundled runtime from this folder:

```powershell
cd C:\Users\chris\Projects\MILO
$node = 'C:\Users\chris\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node --test tests/watch.test.js tests/core.test.js tests/world.test.js tests/kit.test.js tests/architect.test.js
& $node tests/ui.mjs
& $node scripts/capture-kit.mjs
& $node scripts/walkthrough-step2.mjs
```

The unit tests cover session reading, recaps, skills, saved plots, the map, the building kit, and the architect (with fake crew programs, never the real ones). `tests/ui.mjs` drives the real app with Playwright and `MILO_ARCHITECT=fake`, against synthetic Claude and Codex folders, skills and projects built in a temp directory: the greeting and recap, the watchtower groups, a live session flipping from working to finished, alerts that arrive back to back, camp and the Designer setting, every plot starting empty with three ideas, asking for new ones, building one through to its level tree, rename, redesign and clear, a design that falls back to Milo's kit, the place list and map tips, the 1000×700 layout, buildings and `lastSeenAt` across a restart, a launch through a lowercase drive letter with a damaged `state.json`, and that nothing leaves localhost. Screenshots land in `test-results/`, only ever of the synthetic folders. Don't screenshot MILO running on your real sessions into this folder: titles and reply snippets would end up in the images. `scripts/capture-kit.mjs` renders a gallery of buildings to `test-results/kit-gallery.png`. With `--blueprints <file or folder> --out <folder>` it draws saved blueprint JSON files instead (for example real designs from the crew, kept outside the repo): each design at its plot's size with its emblem enlarged, the designs standing on their plots, and close-ups of each plot beside the hand-made camp and watchtower. `scripts/walkthrough-step2.mjs` walks one plot from empty to built and back (ask, build, the building site and reveal, rename, redesign, clear) with the same synthetic setup and saves each step as `test-results/step2-*.png`. Set `WALK_PLOT=plot-meadow` (or another plot id) to walk a different plot.

`scripts/world-preview.html` shows the world on its own with a pretend crew.

## Layout

| Part | Files |
| --- | --- |
| Shell | `electron/main.cjs`, `electron/preload.cjs`, `index.html`, `src/app.js`, `src/styles.css` |
| Watchkeeping | `src/watch/` (Node only, runs in the main process) |
| Architect | `src/architect/` (asks the crew for ideas and designs; main process only, except the shared blueprint checks) |
| Core | `src/model.js`, `src/recap.js`, `src/skills.js` |
| World | `src/world/` (canvas pixel art, no libraries; `kit.js` turns blueprints into buildings) |

Plain JavaScript modules, no build step. `CONTRACT.md` and `CONTRACT-STEP2.md` describe the shared data shapes.
