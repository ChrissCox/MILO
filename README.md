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

## What step 1 includes

- **The world.** A top-down pixel map with Milo's camp, the watchtower, empty plots for places still to come (Workshop row, Clip studio, Library, Game table, a building site), and a harbor under fog. Click to walk, or use the arrow keys or WASD when the map has focus. Click a place to visit it.
- **Milo's greeting.** On launch Milo recaps what your crew did since you last looked: what finished, what started, what's still working, and what's waiting on you. **Show me** opens the watchtower; **Later** lets it fade.
- **Watchkeeping.** The watchtower lists your Claude Code and Codex sessions, grouped into Needs you, Working now, Finished recently (24 hours), and Earlier. Each row shows the agent, title, project folder, how long ago, and a short snippet of the last reply. Sessions you deleted in the Claude desktop app are left out, and a Codex thread imported from a Claude session that's already listed isn't shown twice. A Helpers section shows Jev, Whisper, and Ollama.
- **Gentle alerts.** While MILO is open, it checks every 10 seconds. When a task finishes or an agent needs you, Milo says so in a small speech bubble. If MILO is in the background, you also get a quiet desktop note; clicking it brings MILO forward.
- **The crew strip.** Small chips in the top left show each crew member at a glance: working, waiting on you, all done, or resting.
- **Milo's skills.** At camp, Milo's skills show what he can really do. Watchkeeping levels are proven by live checks. Everything else is planned and stays locked until it's built.
- **Settings** at camp: motion, desktop alerts, and the launch greeting. MILO also follows your system's reduced-motion setting.

The **Places** button in the bottom left lists every place for keyboard and screen reader use. Escape closes a panel or a speech bubble.

## Privacy

- MILO reads `~/.claude` and `~/.codex` on this PC, **read-only**. It never writes to, moves, or deletes anything in those folders.
- Nothing is sent anywhere. Transcripts stay in MILO's main process; the window only receives short summaries (title, project, status, times, and at most 200 characters of the last reply). The window itself has no network access at all: its content security policy blocks connections and every web request is cancelled.
- The only network call is a local check of `http://127.0.0.1:11434` to see whether Ollama is running on this PC. Once per launch MILO also runs `python` locally to see whether Whisper is installed. When a new Claude Code session shows up in `~/.claude/sessions`, MILO runs one local PowerShell query for that process's start time, so a file left behind by a closed session is never mistaken for a running one.
- **Jev is a cloud service.** It's TypeSafe's decision model, reached through your Jev skill and router. When the router is on, message text goes to TypeSafe. MILO never calls Jev. It only reads the local stats file `~/.claude/jev-router/state.json` to show whether the router is on and what it has cost.

## Saved data

MILO keeps its own small state (when you last looked, settings, Milo's spot on the map, and skill levels) in `%APPDATA%\milo\state.json`, with the previous good save in `state.json.backup`. On launch Milo steps out of his tent and walks back to where you left him. Writes are atomic. If the main file is damaged, or holds something that isn't MILO's state, MILO opens the backup, and if neither can be read it leaves both files alone. Set `MILO_DATA_DIR` to use another folder.

For testing, `MILO_CLAUDE_HOME` and `MILO_CODEX_HOME` point Watchkeeping at other folders, and `MILO_TEST=1` skips the one-window lock and holds desktop notes back.

## Verify

Node isn't on PATH, so use the bundled runtime from this folder:

```powershell
cd C:\Users\chris\Projects\MILO
& 'C:\Users\chris\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests/watch.test.js tests/core.test.js tests/world.test.js
& 'C:\Users\chris\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tests/ui.mjs
```

The unit tests cover session reading, recaps, skills, and the map. `tests/ui.mjs` drives the real app with Playwright against synthetic Claude and Codex folders built from `tests/fixtures` in a temp directory: the greeting and recap, the watchtower groups, a live session flipping from working to finished, alerts that arrive back to back, camp and settings, the place list and map tips, the 1000×700 layout, `lastSeenAt` across a restart, a launch through a lowercase drive letter with a damaged `state.json`, and that nothing leaves localhost. Screenshots land in `test-results/`, only ever of the synthetic folders. Don't screenshot MILO running on your real sessions into this folder: titles and reply snippets would end up in the images.

`scripts/world-preview.html` shows the world on its own with a pretend crew.

## Layout

| Part | Files |
| --- | --- |
| Shell | `electron/main.cjs`, `electron/preload.cjs`, `index.html`, `src/app.js`, `src/styles.css` |
| Watchkeeping | `src/watch/` (Node only, runs in the main process) |
| Core | `src/model.js`, `src/recap.js`, `src/skills.js` |
| World | `src/world/` (canvas pixel art, no libraries) |

Plain JavaScript modules, no build step. `CONTRACT.md` describes the shared data shapes.
