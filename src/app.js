// MILO renderer. The world canvas comes first; everything else is a light
// overlay: Milo's speech bubble, the crew strip, a place list, and panels.
// Other modules are loaded defensively so the shell still opens if one of
// them is missing or throws.

const bridge = window.milo ?? null;
const architect = bridge?.architect ?? null;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const GREETING_MS = 12_000;
const ALERT_MS = 9_000;
const SEEN_TICK_MS = 60_000;
const SCAN_WAIT_MS = 20_000;
const EARLIER_STEP = 15;
const ART_TICK_MS = 300;
const ASK_MAX = 110;
const NAME_MAX = 28;

const $ = selector => document.querySelector(selector);
const els = {
  stage: $('#stage'),
  canvas: $('#world'),
  fallback: $('#world-fallback'),
  crew: $('#crew'),
  places: $('#places'),
  placesToggle: $('#places-toggle'),
  placeList: $('#place-list'),
  bubble: $('#bubble'),
  tip: $('#hover-tip'),
  panel: $('#panel'),
  panelTitle: $('#panel-title'),
  panelBody: $('#panel-body'),
  status: $('#titlebar-status'),
  wordmark: document.querySelector('.wordmark'),
  banner: $('#elsewhere-banner'),
  mapButton: $('#map-button'),
  mapRoot: $('#map-view'),
  tracker: $('#tracker'),
};

// ---------------------------------------------------------------------------
// Module loading with small, calm fallbacks.

async function load(path) {
  try {
    return await import(path);
  } catch (error) {
    console.warn(`[MILO] ${path} is not available yet: ${error.message}`);
    return null;
  }
}

function localDayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const PLOT_NAMES = {
  'plot-meadow': 'Long meadow',
  'plot-rise': 'Sunny rise',
  'plot-birch': 'Birch hollow',
  'plot-pond': 'Pondside plot',
  'plot-orchard': 'Old orchard',
};
const LEGACY_IDS = { workshop: 'plot-meadow', 'clip-studio': 'plot-rise', library: 'plot-birch', 'game-table': 'plot-pond', 'building-site': 'plot-orchard' };
const emptyPlotState = () => ({ status: 'empty', suggestions: [], asked: null, idea: null, blueprint: null, designedBy: null, builtAt: null, name: null });

const fallback = {
  createState: () => ({
    version: 1, user: { name: 'Chris' }, milo: { name: 'Milo', tile: null },
    lastSeenAt: null, lastGreetedDay: null,
    settings: { motion: true, notifications: true, greeting: true, designer: 'auto' }, skills: {}, panel: null,
    plots: Object.fromEntries(Object.keys(PLOT_NAMES).map(id => [id, emptyPlotState()])),
  }),
  normalizeState(input) {
    const base = fallback.createState();
    const value = input && typeof input === 'object' ? input : {};
    return { ...base, ...value, user: { ...base.user, ...value.user }, milo: { ...base.milo, ...value.milo }, settings: { ...base.settings, ...value.settings }, plots: { ...base.plots, ...value.plots } };
  },
  markSeen(state, now) { state.lastSeenAt = now; return state; },
  dayKey: localDayKey,
  buildRecap: (sessions = [], _lastSeenAt, now = Date.now()) => ({
    awayMs: 0, finished: [], started: [],
    working: sessions.filter(s => s.status === 'working'),
    needsYou: sessions.filter(s => s.status === 'needs-you'),
    quiet: true, now,
  }),
  greeting: (_recap, { name = 'Chris' } = {}) => ({ title: `Hi, ${name}`, lines: ["I'm still settling in. The watchtower will fill in soon."], hasNews: false }),
  diffSnapshots: () => [],
  alertText: event => ({ title: 'An update from your crew', body: event?.session?.title ? `“${event.session.title}” changed.` : 'Something changed.' }),
  builtText: plot => ({ title: `${plot?.name || plot?.blueprint?.name || 'A new building'} is built`, body: 'The plans came back.' }),
  SKILLS: [],
  evaluateSkills: () => ({}),
  PLACES: [
    { id: 'camp', kind: 'camp', name: "Milo's camp", blurb: 'Where Milo lives and keeps his notes.', built: true, fogged: false },
    { id: 'watchtower', kind: 'watchtower', name: 'Watchtower', blurb: 'Where Milo keeps an eye on your agents.', built: true, fogged: false },
    ...Object.entries(PLOT_NAMES).map(([id, name]) => ({ id, kind: 'plot', name, blurb: '', built: false, fogged: false })),
    { id: 'harbor', kind: 'fog', name: 'Harbor', blurb: 'Past the fog, by the water.', built: false, fogged: true },
  ],
};

const [modelModule, recapModule, skillsModule, mapModule, engineModule, kitModule, spritesModule] = await Promise.all([
  load('./model.js'), load('./recap.js'), load('./skills.js'), load('./world/map.js'), load('./world/engine.js'),
  load('./world/kit.js'), load('./world/sprites.js'),
]);
// Phase 3: the Hearth, the frontier and the wilds. If any of these can't load, the shell runs as
// before (vale only) and the Phase 3 chrome stays hidden.
const [riftsModule, hearthModule, storyModule, worldgenModule, riftgenModule, wildsModule, navModule, wildsartModule, frontierModule, wildtextModule, panelsModule, panelartModule, phase4Module] = await Promise.all([
  load('./rifts.js'), load('./hearth.js'), load('./story.js'), load('./world/worldgen.js'), load('./world/riftgen.js'),
  load('./world/wilds.js'), load('./world/nav.js'), load('./world/wildsart.js'), load('./ui/frontier.js'), load('./ui/wildtext.js'),
  load('./ui/panels.js'), load('./ui/panelart.js'), load('./ui/phase4.js'),
]);
const PHASE3_MODULES = [riftsModule, hearthModule, storyModule, worldgenModule, riftgenModule, wildsModule, navModule, frontierModule, wildtextModule, panelsModule];
// The map view is its own module (src/ui/mapview.js); it loads only when first opened.
let mapviewModule = null;

function pick(module, name) {
  const value = module?.[name];
  return value === undefined ? fallback[name] : value;
}

const createState = pick(modelModule, 'createState');
const normalizeState = pick(modelModule, 'normalizeState');
const markSeen = pick(modelModule, 'markSeen');
const dayKey = pick(modelModule, 'dayKey');
const buildRecap = pick(recapModule, 'buildRecap');
const greeting = pick(recapModule, 'greeting');
const diffSnapshots = pick(recapModule, 'diffSnapshots');
const alertText = pick(recapModule, 'alertText');
const builtText = pick(recapModule, 'builtText');
const SKILLS = Array.isArray(skillsModule?.SKILLS) ? skillsModule.SKILLS : fallback.SKILLS;
const evaluateSkills = pick(skillsModule, 'evaluateSkills');
const plots = modelModule && typeof modelModule.startDesign === 'function' ? modelModule : null;
const legacyIds = modelModule?.LEGACY_PLACE_IDS || LEGACY_IDS;
const canonicalId = id => (typeof id === 'string' && Object.hasOwn(legacyIds, id) ? legacyIds[id] : id);

// Places carry a kind from step 2 on. A map that doesn't say yet is read the step 2 way:
// camp and watchtower are Milo's, the fogged harbor stays fog, everything else is a plot.
function readPlaces(list) {
  return list.map(place => {
    const id = canonicalId(place.id);
    const kind = place.kind || (id === 'camp' ? 'camp' : id === 'watchtower' ? 'watchtower' : place.fogged ? 'fog' : 'plot');
    const renamed = id !== place.id;
    return {
      ...place,
      id,
      kind,
      name: renamed ? PLOT_NAMES[id] || place.name : place.name,
      blurb: renamed ? '' : place.blurb,
    };
  });
}
const PLACES = readPlaces(Array.isArray(mapModule?.PLACES) && mapModule.PLACES.length ? mapModule.PLACES : fallback.PLACES);

function safe(fn, fallbackValue, label) {
  try {
    return fn();
  } catch (error) {
    console.warn(`[MILO] ${label || 'call'} failed: ${error.message}`);
    return fallbackValue;
  }
}

// ---------------------------------------------------------------------------
// Small helpers.

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const AGENT_NAMES = { claude: 'Claude', codex: 'Codex' };
const CREW_NAMES = { claude: 'Claude Code', codex: 'Codex', jev: 'Jev', whisper: 'Whisper', ollama: 'Ollama' };
const DESIGNER_ORGS = { claude: 'Anthropic', codex: 'OpenAI' };
const DESIGNER_CHOICES = [
  ['auto', 'Automatic', 'Claude Code when it’s signed in, then Codex, then Milo’s own kit.'],
  ['claude', 'Claude Code', 'Ask Claude Code every time.'],
  ['codex', 'Codex', 'Ask Codex every time.'],
  ['kit', 'Milo’s kit', 'Milo draws plans himself. Nothing leaves your PC.'],
];
const placeById = id => PLACES.find(place => place.id === id) || null;
const isPlot = id => placeById(id)?.kind === 'plot';
const whoName = id => (id === 'claude' ? 'Claude Code' : id === 'codex' ? 'Codex' : 'Milo');
const isCrew = id => id === 'claude' || id === 'codex';

// MILO's clock: the real time, moved by the test clock's offset (MILO_NOW) in tests only.
let clockOffset = 0;
const clockNow = () => Date.now() + clockOffset;

function ago(ms, now = clockNow()) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const minutes = Math.round(Math.max(0, now - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Tiny pixel glyphs, drawn as SVG rects so the chrome stays crisp.
const GLYPHS = {
  M: ['10001', '11011', '10101', '10001', '10001'],
  I: ['111', '010', '010', '010', '111'],
  L: ['100', '100', '100', '100', '111'],
  O: ['0110', '1001', '1001', '1001', '0110'],
};

function pixelWord(word) {
  let x = 0;
  const rects = [];
  for (const letter of word) {
    const rows = GLYPHS[letter];
    rows.forEach((row, y) => [...row].forEach((bit, dx) => { if (bit === '1') rects.push(`<rect x="${x + dx}" y="${y}" width="1" height="1"/>`); }));
    x += rows[0].length + 1;
  }
  return `<svg viewBox="0 0 ${x - 1} 5" width="${(x - 1) * 2}" height="10" aria-hidden="true" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}

// 8×8 crew faces. Keys: o outline, f fill, e eye, a accent, m hair, . empty.
const FACES = {
  milo: { f: '#fde3cc', a: '#f5bacb', m: '#86654f', rows: ['..oooo..', '.ommmmo.', 'ommmmmmo', 'omffffmo', 'ofeffefo', 'ofaffafo', '.offffo.', '..oooo..'] },
  claude: { f: '#e0a07c', a: '#c97c58', rows: ['..oooo..', '.offffo.', 'offffffo', 'ofeffefo', 'offffffo', 'ofaaaafo', '.offffo.', '..oooo..'] },
  codex: { f: '#9fb3d1', a: '#6f86ad', rows: ['.oooooo.', 'offffffo', 'ofaffafo', 'ofeffefo', 'offffffo', 'offaaffo', 'offffffo', '.oooooo.'] },
  jev: { f: '#ecd08a', a: '#d99f5a', rows: ['...ooo..', '..offfo.', '.ofeffoa', '.offfffo', 'offffffo', 'ofaffffo', '.offffo.', '..o..o..'] },
  whisper: { f: '#c7ad8c', a: '#f1e6c8', rows: ['.o....o.', 'ooffffoo', 'ofaffafo', 'ofeffefo', 'offffffo', '.offffo.', '.offffo.', '..oooo..'] },
  ollama: { f: '#b9d1ac', a: '#8fb07e', rows: ['.o....o.', '.oo..oo.', '.offffo.', 'ofeffefo', 'offffffo', 'offaaffo', '.offffo.', '..oooo..'] },
  helper: { f: '#d6d0b8', a: '#b3ab8c', rows: ['..oooo..', '.offffo.', 'offffffo', 'ofeffefo', 'offffffo', 'offaaffo', '.offffo.', '..oooo..'] },
};

function face(id) {
  const spec = FACES[id] || FACES.helper;
  const colors = { o: '#3d4038', f: spec.f, e: '#3d4038', a: spec.a, m: spec.m };
  const rects = [];
  spec.rows.forEach((row, y) => [...row].forEach((key, x) => {
    if (colors[key]) rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${colors[key]}"/>`);
  }));
  return `<svg class="face" viewBox="0 0 8 8" aria-hidden="true" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}

// Glyphs are drawn at exactly 2x their grid so every pixel lands on whole screen pixels.
const CHECK = '<svg class="tick tick-check" viewBox="0 0 7 6" width="14" height="12" aria-hidden="true" shape-rendering="crispEdges"><path d="M6 0h1v2H6zM5 2h1v1H5zM4 3h1v1H4zM3 4h1v1H3zM2 5h1v1H2zM1 4h1v1H1zM0 3h1v1H0z"/></svg>';
const LOCK = '<svg class="tick tick-lock" viewBox="0 0 7 7" width="14" height="14" aria-hidden="true" shape-rendering="crispEdges"><path d="M2 0h3v1H2zM1 1h1v2H1zM5 1h1v2H5zM0 3h7v4H0z"/></svg>';
const BOX = '<svg class="tick tick-box" viewBox="0 0 7 7" width="14" height="14" aria-hidden="true" shape-rendering="crispEdges"><path d="M0 0h7v7H0zM1 1v5h5V1z" fill-rule="evenodd"/></svg>';
const FOLDER = '<svg class="folder" viewBox="0 0 7 6" width="14" height="12" aria-hidden="true" shape-rendering="crispEdges"><path d="M0 0h3v1h4v5H0zM1 2v3h5V2z" fill-rule="evenodd"/></svg>';

// ---------------------------------------------------------------------------
// State and saving.

let state = normalizeState(createState(Date.now()), Date.now());
let saveBlocked = !bridge;
// Until the saved state has come back, `state` is only createState's default: nothing saves it
// then, or a close in that moment would write the default over state.json and its backup.
let stateLoaded = false;
let saveTimer = null;
let saveDue = 0;
let saveChain = Promise.resolve();
let snapshot = null;
let prevSessions = null;
let booted = false;
let pendingSnapshot = null;
let world = null;
let phase4 = null;           // Phase 4's wiring (src/ui/phase4.js); null when its content can't run
let earlierLimit = EARLIER_STEP;
let lastPanelOpener = null;
let panelClosing = false;

function setStatus(text) {
  els.status.textContent = text || '';
}

function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  saveDue = 0;
  if (saveBlocked || !stateLoaded) return saveChain;
  const copy = JSON.parse(JSON.stringify(state));
  saveChain = saveChain
    .then(() => bridge.saveState(copy))
    .then(result => {
      if (result && result.ok === false) {
        console.warn('[MILO] save failed:', result.error);
        setStatus("Couldn't save just now");
      }
    })
    .catch(error => {
      console.warn('[MILO] save failed:', error.message);
      setStatus("Couldn't save just now");
    });
  return saveChain;
}

// A save already due sooner keeps its time: Milo's steps ask for a save every tile, and they
// must not keep pushing back the one a new building asked for.
function scheduleSave(delay = 400) {
  if (saveBlocked || !stateLoaded) return;
  const due = Date.now() + delay;
  if (saveTimer && saveDue <= due) return;
  clearTimeout(saveTimer);
  saveDue = due;
  saveTimer = setTimeout(flushSave, delay);
}

function seenNow() {
  safe(() => markSeen(state, clockNow()), null, 'markSeen');
  if (!Number.isFinite(state.lastSeenAt)) state.lastSeenAt = clockNow();
}

// ---------------------------------------------------------------------------
// Plots: small readers over state.plots. The rules themselves live in src/model.js.

function plotOf(id) {
  if (plots) return plots.plotOf(state, id);
  const plot = state.plots?.[id];
  return plot && typeof plot === 'object' ? plot : emptyPlotState();
}

function buildingNameOf(plot) {
  if (plots) return plots.buildingName(plot);
  return plot?.status === 'built' ? String(plot.name || plot.blueprint?.name || '') : '';
}

function placeName(id) {
  return placeById(id)?.name || PLOT_NAMES[id] || id;
}

// What a place is called right now: a built plot goes by its building's name.
function placeTitle(id) {
  const registered = phase4?.panels.title(id);
  if (registered) return registered;
  const special = phase3Title(id);
  if (special) return special;
  if (isPlot(id)) {
    // While a building is being redesigned it keeps its name; the scaffold is only around it.
    const name = buildingNameOf(plotOf(id)) || (job?.plotId === id && job.redesign ? job.name : '');
    if (name) return name;
  }
  return placeName(id);
}

// Hover tips name the plot and what's there.
function placeLabel(id) {
  const registered = phase4?.panels.title(id);
  if (registered) return registered;
  const special = phase3Title(id);
  if (special) return special;
  if (!isPlot(id)) return placeName(id);
  const plot = plotOf(id);
  const name = buildingNameOf(plot);
  if (plot.status === 'designing' || job?.plotId === id && job.kind === 'design') return `${placeName(id)} · being designed`;
  if (name) return name;
  return `${placeName(id)} · empty plot`;
}

// The plot's buildable area in tiles, from the map when it knows, else from the plot's area.
function plotSize(id) {
  const area = safe(() => mapModule?.buildableArea?.(id), null, 'buildableArea');
  const valid = value => value && Number(value.w) > 0 && Number(value.h) > 0;
  if (valid(area)) {
    const size = { x: Number(area.x) || 0, y: Number(area.y) || 0, w: Math.floor(area.w), h: Math.floor(area.h) };
    // Which side the plot's gate is on, when the map says, so the panel art matches the world.
    const gate = area.gate || safe(() => mapModule?.plotGate?.(id), null, 'plotGate');
    if (gate && typeof gate === 'object') size.gate = { ...gate };
    return size;
  }
  const place = placeById(id);
  if (valid(place?.area)) return { x: place.area.x + 1, y: place.area.y + 1, w: Math.max(3, place.area.w - 2), h: Math.max(3, place.area.h - 2) };
  return { x: 0, y: 0, w: 7, h: 5 };
}

// ---------------------------------------------------------------------------
// Motion.

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const motionOn = () => state.settings?.motion !== false && !reducedMotion.matches;

function applyMotion() {
  document.documentElement.classList.toggle('still', !motionOn());
  // Nudge the world so its loop notices the change right away.
  if (typeof world?.setPaused === 'function') worldCall('setPaused', worldShouldPause());
  if (!els.panel.hidden) paintPanelArt();
}

// The world rests while the window is hidden and while the map covers it.
const worldShouldPause = () => document.hidden || mapIsOpen();
reducedMotion.addEventListener?.('change', applyMotion);

// ---------------------------------------------------------------------------
// World.

function worldCall(name, ...args) {
  if (!world || typeof world[name] !== 'function') return undefined;
  return safe(() => world[name](...args), undefined, `world.${name}`);
}

function startWorld() {
  const createWorld = engineModule?.createWorld;
  if (typeof createWorld !== 'function') {
    els.fallback.hidden = false;
    return;
  }
  const options = {
    onPlaceClick: id => openPanel(canonicalId(id), { walk: false }),
    onCrewClick: id => openCrew(id),
    onHover: info => showTip(info),
    onMiloMove: tile => miloMoved(tile),
    // MILO's own setting only: the engine reads the system's reduced-motion wish itself, and keeps
    // walks walking under it while everything decorative holds still.
    motion: () => state.settings?.motion !== false,
    // Launch always begins in the vale: milo.tile is only ever a vale tile.
    startTile: state.milo?.tile ?? null,
    // Phase 4 (late-bound: its wiring is made once the world stands).
    onSceneStep: step => phase4?.onSceneStep(step),
    onCombatHover: target => phase4?.onCombatHover(target),
    onCombatCommand: cmd => phase4?.onCombatCommand(cmd),
    onContextMenu: info => phase4?.onContextMenu(info),
  };
  if (phase3) {
    Object.assign(options, {
      content,
      seed: state.wilds?.seed || 'hushlands',
      onEntityClick: entity => handleEntity(entity),
      onAreaChange: info => applyArea(info),
      onExplore: keys => explore(keys),
    });
  }
  world = safe(() => createWorld(els.canvas, options), null, 'createWorld');
  if (!world) els.fallback.hidden = false;
  bindWilds();
  syncPlots();
}

// Milo's steps: a vale tile goes to milo.tile, a tile in the wilds to wilds.at (never milo.tile),
// and nothing inside an Elsewhere (its tiles are the pocket world's own).
function miloMoved(tile) {
  if (!tile || !Number.isFinite(tile.x) || !Number.isFinite(tile.y)) return;
  if (areaInfo.area === 'elsewhere') return;
  const at = { x: Math.round(tile.x), y: Math.round(tile.y) };
  if (!phase3 || inValeTile(at.x, at.y)) {
    state.milo = { ...state.milo, tile: at };
  } else {
    state.wilds = { ...state.wilds, at };
    placesDirty();
  }
  scheduleSave(1500);
}

const inValeTile = (x, y) => x >= 0 && y >= 0 && x < 64 && y < 44;

// Hands the plots to the world: empty, a building site while designing, or the built building.
// Plot objects are replaced, never edited, so the world can cache its art by identity.
function syncPlots() {
  worldCall('setPlots', state.plots || {});
  // The map's picture of the vale is redrawn the next time it's asked for.
  valeImage = null;
  valeVersion += 1;
  if (mapIsOpen()) safe(() => mapView.refresh({ vale: true }), null, 'map refresh');
}

// The vale as the map and the War Table show it: drawn once without Milo (the map marks where he
// is itself), and kept until the plots change (syncPlots drops it), however far he walks.
function valePicture() {
  if (!valeImage) valeImage = worldCall('renderMap', 1, { milo: false }) || null;
  return valeImage;
}

// Tell the world which screen edges the overlays cover, so its camera keeps Milo and his camp in
// the open part: below the crew strip, and left of an open panel. Uses layout positions, so a
// panel still sliding in counts at its resting place.
// Named screen rectangles the Phase 4 overlays report (shell.insets): the combat HUD's bands feed
// the camera, and the HUD and the Log keep Milo's bubbles and the hover tip off them.
const insetRects = new Map();
function setInset(name, rect) {
  const ok = rect && typeof rect === 'object' && Number.isFinite(rect.width) && rect.width > 0 && Number.isFinite(rect.height);
  if (ok) {
    const left = Number.isFinite(rect.left) ? rect.left : rect.x;
    const topEdge = Number.isFinite(rect.top) ? rect.top : rect.y;
    insetRects.set(name, { left, top: topEdge, right: left + rect.width, bottom: topEdge + rect.height, width: rect.width, height: rect.height });
  } else insetRects.delete(name);
  if (name.startsWith('combat-')) updateWorldInsets();
}

function updateWorldInsets() {
  const stage = els.stage.getBoundingClientRect();
  const crew = els.crew.getBoundingClientRect();
  // The story card sits just under the crew strip, however many rows the strip wraps to.
  els.tracker?.style.setProperty('--tracker-top', `${Math.round(Math.max(0, crew.bottom - stage.top) + 14)}px`);
  if (!world) return;
  let top = crew.height > 1 ? Math.max(0, crew.bottom - stage.top + 8) : 0;
  let right = els.panel.hidden || panelClosing ? 0 : Math.max(0, els.stage.clientWidth - els.panel.offsetLeft + 8);
  let left = 0;
  let bottom = 0;
  // A fight frames its arena in the space the combat HUD leaves: below its ribbon, between the
  // hero column and the foe column, above the planner (src/ui/combat-hud.js).
  const hud = els.stage.dataset.mode === 'combat' ? document.getElementById('combat-hud') : null;
  if (hud && !hud.hidden) {
    const box = selector => {
      const part = hud.querySelector(selector);
      const rect = part && !part.hidden ? part.getBoundingClientRect() : null;
      return rect && rect.width > 1 && rect.height > 1 ? rect : null;
    };
    const ribbon = box('.hud-ribbon');
    const party = box('.hud-party');
    const foes = box('.hud-foes');
    const lower = [box('.hud-odds'), box('.planner')].filter(Boolean);
    if (ribbon) top = Math.max(top, Math.round(ribbon.bottom - stage.top + 8));
    if (party) left = Math.max(0, Math.round(party.right - stage.left + 8));
    if (foes) right = Math.max(right, Math.round(stage.right - foes.left + 8));
    if (lower.length) bottom = Math.max(0, Math.round(stage.bottom - Math.min(...lower.map(rect => rect.top)) + 8));
  }
  worldCall('setInsets', { top, right, bottom, left });
}

function miloPoint() {
  const rect = els.canvas.getBoundingClientRect();
  const pos = worldCall('miloScreenPos');
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    return { x: rect.left + pos.x, y: rect.top + pos.y };
  }
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.58 };
}

// Never lets a slow or failing step hold up Milo's greeting.
function withTimeout(promise, ms) {
  const settled = Promise.resolve(promise).catch(error => {
    console.warn('[MILO] step failed:', error?.message || error);
    return null;
  });
  return Promise.race([settled, new Promise(resolve => setTimeout(() => resolve(null), ms))]);
}

function walkTo(target) {
  const walking = worldCall('walkTo', target);
  if (walking && typeof walking.catch === 'function') walking.catch(error => console.warn('[MILO] walk failed:', error.message));
}

function hideTip() {
  els.tip.hidden = true;
}

// A name as it starts a label or a title ('the Keeper of Letters Wren' → 'The Keeper …').
const startName = text => (frontierModule?.startName ? frontierModule.startName(text) : String(text ?? ''));

function showTip(info) {
  if (!info || !info.id) { hideTip(); return; }
  const rect = els.canvas.getBoundingClientRect();
  const px = rect.left + (Number(info.x) || 0);
  // The canvas still sees the pointer under an open panel; no tip there.
  if (!els.panel.hidden && px >= els.panel.getBoundingClientRect().left - 4) { hideTip(); return; }
  // Crew and places are named by the shell; everything else in the world (rifts, lanterns, trees,
  // strays) brings its own label.
  const text = info.kind === 'crew' ? (crewLabels.get(info.id) || CREW_NAMES[info.id] || 'A helper')
    : (!info.kind || info.kind === 'place') ? placeLabel(canonicalId(info.id))
      : startName(String(info.label || phase3Title(info.id) || '').trim());
  if (!text) { hideTip(); return; }
  els.tip.textContent = text;
  els.tip.hidden = false;
  const width = els.tip.offsetWidth;
  const height = els.tip.offsetHeight;
  const rightLimit = (els.panel.hidden ? innerWidth : els.panel.getBoundingClientRect().left) - 8;
  const pointerY = rect.top + (Number(info.y) || 0);
  let x = clamp(px - width / 2, 8, Math.max(8, rightLimit - width));
  let y = clamp(pointerY - 34, 40, innerHeight - 30);
  // Never over the crew strip, the story card or the place list: flip below the pointer, or slide clear.
  const keepOut = [els.crew, els.places, els.tracker, els.banner, ...phase4Overlays()]
    .filter(overlay => overlay && !overlay.hidden)
    .map(overlay => overlay.getBoundingClientRect())
    .filter(box => box.width > 1 && box.height > 1)
    .map(box => ({ x: box.left, y: box.top, w: box.width, h: box.height }));
  const blocked = (tx, ty) => keepOut.filter(box => intersectArea({ x: tx, y: ty, w: width, h: height }, box, 4) > 0);
  if (blocked(x, y).length) {
    const below = clamp(pointerY + 22, 40, innerHeight - 30);
    if (!blocked(x, below).length) y = below;
    else {
      for (const box of blocked(x, y)) x = Math.max(x, box.x + box.w + 8);
      if (x + width > rightLimit || blocked(x, y).length) { hideTip(); return; }
    }
  }
  els.tip.style.left = `${Math.round(x)}px`;
  els.tip.style.top = `${Math.round(y)}px`;
}

// A tip belongs to the spot under the pointer right now. Overlays, a click
// (Milo sets off and the view moves), or a panel opening all clear it.
for (const overlay of [els.panel, els.bubble, els.crew, els.places, els.tracker, els.banner, els.mapRoot]) overlay?.addEventListener('pointerenter', hideTip);
els.canvas.addEventListener('pointerdown', hideTip);
els.canvas.addEventListener('pointerleave', hideTip);

// ---------------------------------------------------------------------------
// Crew.

const crewLabels = new Map();

function agentCrew(id, now) {
  // Before the first look, nobody is placed in the world, so no one walks off
  // from the campfire once their real state arrives.
  if (!snapshot) return { id, state: 'offline', label: 'Checking in', count: 0 };
  const source = snapshot.sources?.[id];
  const sessions = (snapshot?.sessions || []).filter(s => s.agent === id && !s.archived);
  const working = sessions.filter(s => s.status === 'working').length;
  const waiting = sessions.filter(s => s.status === 'needs-you').length;
  const finishedToday = sessions.filter(s => s.status === 'done' && now - s.lastActivityAt < DAY).length;
  let crewState = 'idle';
  let label = 'Resting';
  let count = 0;
  if (working) {
    crewState = 'working'; count = working;
    label = waiting ? `${working} working · ${waiting} waiting` : `${working} working`;
  } else if (waiting) {
    crewState = 'needs-you'; count = waiting;
    label = waiting === 1 ? 'Waiting on you' : `${waiting} waiting on you`;
  } else if (finishedToday) {
    crewState = 'done'; count = finishedToday;
    label = 'All done';
  } else if (!sessions.length && source && source.ok === false) {
    crewState = 'offline';
    label = 'Nothing yet';
  }
  return { id, state: crewState, label, count };
}

function toolCrew(tool) {
  const labels = {
    jev: tool.active ? 'Router on' : 'Router off',
    whisper: 'Ready',
    ollama: tool.active ? 'Running' : 'Asleep',
  };
  return {
    id: tool.id,
    state: tool.installed ? 'idle' : 'offline',
    label: tool.installed ? (labels[tool.id] || (tool.active ? 'Ready' : 'Resting')) : 'Not installed',
    count: 0,
  };
}

function buildCrew(now = clockNow()) {
  const crew = [agentCrew('claude', now), agentCrew('codex', now)];
  for (const tool of snapshot?.tools || []) crew.push(toolCrew(tool));
  // The crew member drawing up plans walks over to that plot and works there.
  if (job && job.kind === 'design' && isCrew(job.who)) {
    const index = crew.findIndex(member => member.id === job.who);
    if (index !== -1) crew[index] = { ...crew[index], state: 'designing', plotId: job.plotId, label: `Designing at ${placeName(job.plotId)}` };
  }
  return crew;
}

let crewHtml = '';
function renderCrew() {
  const crew = buildCrew();
  crewLabels.clear();
  const chips = crew.filter(member => member.id === 'claude' || member.id === 'codex' || member.state !== 'offline');
  const html = chips.map(member => {
    const name = CREW_NAMES[member.id] || member.id;
    crewLabels.set(member.id, `${name} · ${member.label}`);
    return `<button type="button" class="crew-chip px" data-crew="${esc(member.id)}" data-state="${esc(member.state)}" aria-label="${esc(`${name}, ${member.label}`)}">`
      + `${face(member.id)}<span class="crew-text"><strong>${esc(name)}</strong><small><i class="dot" aria-hidden="true"></i>${esc(member.label)}</small></span></button>`;
  }).join('');
  // The strip is left as it is when nothing on it changed (every snapshot and the minute's tick
  // ask), so a chip under the pointer or holding keyboard focus stays put. When it does change,
  // focus follows its chip.
  if (html !== crewHtml) {
    const focused = els.crew.contains(document.activeElement) ? document.activeElement.dataset.crew : null;
    els.crew.innerHTML = html;
    crewHtml = html;
    if (focused) {
      const again = els.crew.querySelector(`[data-crew="${CSS.escape(focused)}"]`) || els.crew.querySelector('button');
      (again || els.canvas).focus({ preventScroll: true });
    }
  }
  worldCall('setCrew', crew.map(member => ({ ...member, label: CREW_NAMES[member.id] || member.id })));
  updateWorldInsets();
}

function openCrew(id) {
  if (job && job.kind === 'design' && job.who === id) {
    openPanel(job.plotId, { walk: false });
    return;
  }
  openPanel('watchtower', { walk: false });
  const target = ['claude', 'codex'].includes(id) ? null : els.panelBody.querySelector('.helpers');
  target?.scrollIntoView({ block: 'nearest' });
}

// ---------------------------------------------------------------------------
// Speech bubble: one at a time, anchored above Milo.

const bubbleQueue = [];
let bubbleCurrent = null;
let bubbleTimer = null;
let bubbleFrame = 0;
let bubbleLast = '';

function queueBubble(message) {
  if (message.kind === 'alert' && bubbleQueue.filter(item => item.kind === 'alert').length >= 4) return;
  bubbleQueue.push(message);
  // Every bubble is also a line in the Log (Phase 4), so what Milo said is never lost.
  phase4?.shell.log({
    tab: message.kind === 'alert' || message.kind === 'progress' ? 'crew' : 'milo',
    text: [message.lines?.[0]?.startsWith(message.title) ? '' : message.title, ...(message.lines || [])].filter(Boolean).join(' · ').slice(0, 120),
    at: clockNow(), detail: (message.lines || []).filter(Boolean).length > 1 ? (message.lines || []).filter(Boolean) : null, action: null,
  });
  if (!bubbleCurrent) nextBubble();
}

// Drops Milo's passing remarks ("Codex is drawing up plans…") once there's news, so the news shows at once.
const PASSING = new Set(['progress', 'note']);
function clearProgressBubbles() {
  for (let i = bubbleQueue.length - 1; i >= 0; i -= 1) if (PASSING.has(bubbleQueue[i].kind)) bubbleQueue.splice(i, 1);
  if (PASSING.has(bubbleCurrent?.kind)) dismissBubble();
}

// A fight on screen holds Milo's bubbles until it ends, so none sits on the arena (the Log has them).
const fightIsLive = () => els.stage.dataset.mode === 'combat';

function nextBubble() {
  if (fightIsLive()) return;
  const message = bubbleQueue.shift();
  if (!message) return;
  bubbleCurrent = { ...message, touched: false };
  const lines = (message.lines || []).filter(Boolean);
  const actions = message.actions || [];
  els.bubble.dataset.kind = message.kind;
  els.bubble.innerHTML = `<p class="bubble-title">${esc(message.title)}</p>`
    + lines.map(line => `<p class="bubble-line">${esc(line)}</p>`).join('')
    + (actions.length ? `<div class="bubble-actions">${actions.map((action, index) => `<button type="button" class="px-btn${index === 0 ? ' primary' : ''}" data-bubble-action="${esc(action.id)}">${esc(action.label)}</button>`).join('')}</div>` : '')
    + '<span class="bubble-tail" aria-hidden="true"></span>';
  els.bubble.classList.remove('leaving');
  els.bubble.hidden = false;
  bubbleLast = '';
  bubbleSide = null;
  positionBubble();
  requestAnimationFrame(() => els.bubble.classList.add('shown'));
  trackBubble();
  armBubbleTimer();
}

function armBubbleTimer() {
  clearTimeout(bubbleTimer);
  bubbleTimer = null;
  if (!bubbleCurrent || bubbleCurrent.touched || !document.hasFocus()) return;
  bubbleTimer = setTimeout(() => dismissBubble(), bubbleCurrent.duration || ALERT_MS);
}

function touchBubble() {
  if (!bubbleCurrent) return;
  bubbleCurrent.touched = true;
  clearTimeout(bubbleTimer);
  bubbleTimer = null;
}

function dismissBubble() {
  if (!bubbleCurrent) return;
  clearTimeout(bubbleTimer);
  bubbleTimer = null;
  const hadFocus = els.bubble.contains(document.activeElement);
  bubbleCurrent = null;
  els.bubble.classList.remove('shown');
  els.bubble.classList.add('leaving');
  const finish = () => {
    if (bubbleCurrent) return;
    els.bubble.hidden = true;
    els.bubble.classList.remove('leaving');
    els.bubble.removeAttribute('data-kind');
    els.bubble.innerHTML = '';
    cancelAnimationFrame(bubbleFrame);
    if (hadFocus) els.canvas.focus({ preventScroll: true });
    // A message that arrives during the pause shows at once; the pause must not then replace it.
    if (bubbleQueue.length) setTimeout(() => { if (!bubbleCurrent) nextBubble(); }, motionOn() ? 500 : 0);
  };
  if (motionOn()) setTimeout(finish, 420);
  else finish();
}

// Where the bubble can sit around Milo. It prefers above him, but not over the campfire circle,
// the crew or the overlays: then it goes beside him (tail pointing at his face), then below.
// A side that still fits is kept, so the bubble doesn't hop about as Milo walks.
const BUBBLE_SIDES = ['above', 'right', 'left', 'below'];
const TAIL = 12; // how far the pixel tail reaches out of the bubble
let bubbleSide = null;

function intersectArea(a, b, pad = 0) {
  const w = Math.min(a.x + a.w, b.x + b.w + pad) - Math.max(a.x, b.x - pad);
  const h = Math.min(a.y + a.h, b.y + b.h + pad) - Math.max(a.y, b.y - pad);
  return w > 0 && h > 0 ? w * h : 0;
}

function bubbleAvoid() {
  const canvas = els.canvas.getBoundingClientRect();
  const avoid = (worldCall('keepClear') || []).map(rect => ({
    x: canvas.left + rect.x, y: canvas.top + rect.y, w: rect.w, h: rect.h,
    weight: rect.kind === 'crew' || rect.kind === 'milo' ? 3 : 1, pad: rect.kind === 'milo' ? 0 : 4,
  }));
  for (const overlay of [els.crew, els.places, els.tracker, els.banner, ...phase4Overlays()]) {
    if (!overlay || overlay.hidden) continue;
    const rect = overlay.getBoundingClientRect();
    if (rect.width > 1 && rect.height > 1) avoid.push({ x: rect.left, y: rect.top, w: rect.width, h: rect.height, weight: 2, pad: 6 });
  }
  return avoid;
}

function bubbleCandidate(side, point, width, height, bounds) {
  const unit = Number(world?.scale) > 0 ? Number(world.scale) : 3; // CSS px per world px
  const halfHead = 8 * unit;
  const faceY = point.y + 6 * unit;
  let x;
  let y;
  if (side === 'above' || side === 'below') {
    x = clamp(point.x - width / 2, bounds.left, Math.max(bounds.left, bounds.right - width));
    y = side === 'above' ? point.y - height - TAIL - 4 : point.y + 20 * unit + TAIL + 4;
    const fits = y >= bounds.top && y + height <= bounds.bottom;
    return { side, x, y, fits, tail: clamp(point.x - x, 16, width - 16) };
  }
  x = side === 'right' ? point.x + halfHead + TAIL + 2 : point.x - halfHead - TAIL - 2 - width;
  y = clamp(point.y - 6, bounds.top, Math.max(bounds.top, bounds.bottom - height));
  const tail = faceY - y;
  const fits = x >= bounds.left && x + width <= bounds.right && tail >= 8 && tail <= height - 22;
  return { side, x, y, fits, tail: clamp(tail, 8, height - 22) };
}

function bubbleCost(candidate, width, height, avoid) {
  const box = { x: candidate.x, y: candidate.y, w: width, h: height };
  return avoid.reduce((sum, rect) => sum + intersectArea(box, rect, rect.pad) * rect.weight, 0);
}

function positionBubble() {
  if (els.bubble.hidden) return;
  const point = miloPoint();
  const width = els.bubble.offsetWidth;
  const height = els.bubble.offsetHeight;
  const panelOpen = !els.panel.hidden;
  const bounds = { left: 12, top: 44, right: (panelOpen ? els.panel.getBoundingClientRect().left : innerWidth) - 12, bottom: innerHeight - 12 };
  const avoid = bubbleAvoid();
  const options = BUBBLE_SIDES.map(side => {
    const candidate = bubbleCandidate(side, point, width, height, bounds);
    return { ...candidate, cost: candidate.fits ? bubbleCost(candidate, width, height, avoid) : Infinity };
  });
  const current = options.find(option => option.side === bubbleSide);
  let pick = options.find(option => option.cost === 0);
  if (current && current.cost === 0) pick = current;
  if (!pick) {
    const cheapest = options.reduce((best, option) => (option.cost < best.cost ? option : best));
    pick = current && current.cost < Infinity && current.cost <= cheapest.cost * 2 ? current : cheapest;
  }
  if (pick.cost === Infinity) {
    // Nothing fits cleanly (a tiny window): above, held inside the window.
    pick = { ...options[0], y: clamp(options[0].y, bounds.top, Math.max(bounds.top, bounds.bottom - height)) };
  }
  bubbleSide = pick.side;
  els.bubble.dataset.clear = String(pick.cost === 0);
  const key = `${pick.side}|${Math.round(pick.x)}|${Math.round(pick.y)}|${Math.round(pick.tail)}`;
  if (key === bubbleLast) return;
  bubbleLast = key;
  els.bubble.style.left = `${Math.round(pick.x)}px`;
  els.bubble.style.top = `${Math.round(pick.y)}px`;
  els.bubble.dataset.side = pick.side;
  const vertical = pick.side === 'above' || pick.side === 'below';
  els.bubble.style.setProperty(vertical ? '--tail-x' : '--tail-y', `${Math.round(pick.tail / 2) * 2}px`);
}

function trackBubble() {
  cancelAnimationFrame(bubbleFrame);
  const step = () => {
    if (els.bubble.hidden) return;
    positionBubble();
    bubbleFrame = requestAnimationFrame(step);
  };
  bubbleFrame = requestAnimationFrame(step);
}

els.bubble.addEventListener('pointerenter', touchBubble);
els.bubble.addEventListener('focusin', touchBubble);
els.bubble.addEventListener('click', event => {
  const button = event.target.closest('[data-bubble-action]');
  if (!button || !bubbleCurrent) return;
  const action = button.dataset.bubbleAction;
  const message = bubbleCurrent;
  dismissBubble();
  if (action === 'show') {
    openPanel(message.place || 'watchtower', { walk: true, focus: true });
  } else if (action === 'challenge' && message.challenge) {
    const rift = riftFor(message.challenge);
    if (rift) challengeRift(rift);
  } else if (typeof message.onAction === 'function') {
    safe(() => message.onAction(action), null, 'a bubble action');
  }
});
window.addEventListener('focus', () => armBubbleTimer());

// ---------------------------------------------------------------------------
// Panels.

// The meta line: the project folder (marked as a folder, so 'Claude' reads as Z:\Claude and not
// as the agent), then status and time. A working row says when it last wrote something rather
// than repeating 'Working now' next to an old time.
function sessionMeta(session, now) {
  const parts = [];
  if (session.project) {
    parts.push(`<span class="session-project" title="${esc(session.cwd || session.project)}">${FOLDER}<span class="sr-only">Folder </span>${esc(session.project)}</span>`);
  }
  const when = ago(session.lastActivityAt, now);
  if (session.status === 'working' && !session.archived) {
    parts.push(esc(when === 'just now' ? 'Updated just now' : when ? `Last update ${when}` : 'Working now'));
  } else {
    if (session.statusDetail) parts.push(esc(session.statusDetail));
    if (when) parts.push(esc(when));
  }
  if (session.archived) parts.push('Archived');
  return parts.join('<span class="sep" aria-hidden="true"> · </span>');
}

function sessionRow(session, now) {
  return `<li class="session" data-session-id="${esc(session.id)}" data-status="${esc(session.status)}">`
    + `<span class="agent-badge" data-agent="${esc(session.agent)}">${face(session.agent)}<span>${esc(AGENT_NAMES[session.agent] || session.agent)}</span></span>`
    + '<div class="session-main">'
    + `<p class="session-title">${esc(session.title || 'Untitled session')}</p>`
    + `<p class="session-meta">${sessionMeta(session, now)}</p>`
    + (session.lastMessage ? `<p class="session-snippet">${esc(session.lastMessage)}</p>` : '')
    + '</div></li>';
}

function groupSessions(sessions, now) {
  const groups = { 'needs-you': [], working: [], recent: [], earlier: [] };
  for (const session of sessions) {
    if (!session.archived && session.status === 'needs-you') groups['needs-you'].push(session);
    else if (!session.archived && session.status === 'working') groups.working.push(session);
    else if (!session.archived && session.status === 'done' && now - session.lastActivityAt < DAY) groups.recent.push(session);
    else groups.earlier.push(session);
  }
  return groups;
}

const emptySnapshot = () => ({ sessions: [], tools: [], sources: {} });
const evaluations = () => safe(() => evaluateSkills(snapshot || emptySnapshot(), state), {}, 'evaluateSkills') || {};

function renderWatchtower() {
  const now = clockNow();
  const sessions = snapshot?.sessions || [];
  const groups = groupSessions(sessions, now);
  const titles = { 'needs-you': 'Needs you', working: 'Working now', recent: 'Finished recently', earlier: 'Earlier' };
  const skill = evaluations().watchkeeping || null;
  const skillInfo = SKILLS.find(entry => entry.id === 'watchkeeping');
  const provenTitle = skill?.proven?.length ? skill.proven[skill.proven.length - 1].title : '';
  let html = '';
  if (skill && skill.level > 0) {
    html += `<p class="panel-lede">Watchkeeping, level ${esc(skill.level)}${provenTitle ? `. ${esc(provenTitle)}.` : '.'}</p>`;
  } else {
    html += `<p class="panel-lede">${esc(skillInfo?.summary || 'Milo keeps an eye on your agent sessions from up here.')}</p>`;
  }
  const sourceNotes = ['claude', 'codex'].map(id => {
    const source = snapshot?.sources?.[id];
    if (!source || source.ok !== false) return '';
    const name = AGENT_NAMES[id];
    const error = String(source.error || '').trim();
    const text = !error ? `${name}: couldn't read its folder yet.` : error.toLowerCase().includes(name.toLowerCase()) ? error : `${name}: ${error}`;
    return `<li>${esc(text)}</li>`;
  }).filter(Boolean);
  if (!snapshot) html += '<p class="quiet-note">Milo is taking his first look around.</p>';
  if (sourceNotes.length) html += `<ul class="source-notes">${sourceNotes.join('')}</ul>`;
  // The rift list lives here at every tier: real and story rifts, each with its real cause.
  if (phase3) html += renderRiftSection();
  let any = false;
  for (const key of ['needs-you', 'working', 'recent', 'earlier']) {
    const list = groups[key];
    if (!list.length) continue;
    any = true;
    const shown = key === 'earlier' ? list.slice(0, earlierLimit) : list;
    html += `<section class="group" data-group="${key}"><h3>${titles[key]} <span class="count">${list.length}</span></h3>`
      + `<ul class="session-list">${shown.map(session => sessionRow(session, now)).join('')}</ul>`;
    if (key === 'earlier' && list.length > shown.length) {
      const more = Math.min(EARLIER_STEP, list.length - shown.length);
      html += `<button type="button" class="px-btn more" data-action="more" data-focus-key="more">Show ${more} more</button>`;
    }
    html += '</section>';
  }
  if (snapshot && !any) html += '<p class="quiet-note">No sessions yet. Milo will keep watch.</p>';
  const tools = snapshot?.tools || [];
  if (tools.length) {
    html += '<section class="helpers" data-group="helpers"><h3>Helpers</h3><ul class="tool-list">'
      + tools.map(tool => `<li class="tool" data-tool="${esc(tool.id)}" data-installed="${tool.installed ? 'true' : 'false'}">`
        + `${face(tool.id)}<div><p class="tool-name">${esc(tool.name || CREW_NAMES[tool.id] || tool.id)} <span class="tag">${tool.kind === 'cloud' ? 'Cloud' : 'Local'}</span></p>`
        + `<p class="tool-detail">${esc(tool.detail)}</p>`
        + (tool.note ? `<p class="tool-note">${esc(tool.note)}</p>` : '')
        + '</div></li>').join('')
      + '</ul></section>';
  }
  html += '<p class="privacy-note">Read-only. Milo reads your Claude and Codex folders on this PC and sends nothing anywhere.</p>';
  return html;
}

function levelList(skill, evaluation) {
  const proven = new Set((evaluation?.proven || []).map(entry => entry.level));
  const next = evaluation?.next?.level;
  return `<ol class="levels">${(skill.levels || []).map(level => {
    const status = proven.has(level.level) ? 'proven' : level.level === next ? 'next' : 'locked';
    const label = status === 'proven' ? 'Learned' : status === 'next' ? 'Next' : 'Later';
    return `<li data-level-state="${status}">${status === 'proven' ? CHECK : LOCK}<span class="level-name">Level ${esc(level.level)}: ${esc(level.title)}</span><span class="level-tag">${label}</span></li>`;
  }).join('')}</ol>`;
}

// Who draws up plans, and what that shares. Plain words, shown wherever Milo asks the crew. Keep
// in step with src/architect/prompts.js (what a brief carries) and blueprint.js shareNote.
const SHARED = 'your idea, this plot’s name and size, the names of your buildings and projects, and your skills’ names with the start of each description';
function sharesText(designer = architectStatus?.designer, { handOver = architectStatus?.fallsBack === true } = {}) {
  if (isCrew(designer)) {
    const text = `Milo asks ${whoName(designer)} (${DESIGNER_ORGS[designer]}) to draw up plans. It shares ${SHARED}. Never your sessions, and it can’t open your files.`;
    // Automatic mode may still hand the brief to Codex if Claude Code turns out not to be signed in.
    return designer === 'claude' && handOver ? `${text} If Claude Code turns out not to be signed in, Milo asks Codex (OpenAI) instead.` : text;
  }
  if (designer === 'kit') return 'Milo draws up plans himself with his kit. Nothing leaves your PC.';
  return `Milo asks your crew to draw up plans. It shares ${SHARED}. Never your sessions.`;
}

function crewReadiness(member) {
  const detail = String(member.detail || '').trim();
  if (detail) return detail;
  if (member.found && member.ready) return 'Ready';
  if (member.found) return 'Found, not ready yet';
  return 'Not found on this PC';
}

function renderDesigner() {
  const setting = state.settings?.designer || 'auto';
  const status = architectStatus;
  let html = '<section class="designer" data-group="designer"><h3 id="designer-label">Designer</h3>'
    + '<p class="setting-hint">Who draws up plans when you build on a plot.</p>'
    + '<div class="designer-options" role="radiogroup" aria-labelledby="designer-label">';
  for (const [value, label, hint] of DESIGNER_CHOICES) {
    const id = `designer-${value}`;
    html += `<label class="designer-option" for="${id}"><input type="radio" name="designer" id="${id}" value="${value}" data-designer="${value}" data-focus-key="${id}"${setting === value ? ' checked' : ''}>`
      + `<span class="designer-text"><span class="designer-name">${esc(label)}</span><span class="designer-hint">${esc(hint)}</span></span></label>`;
  }
  html += '</div>';
  const crew = Array.isArray(status?.crew) ? status.crew : [];
  if (crew.length) {
    html += `<ul class="crew-ready">${crew.map(member => `<li data-crew-ready="${esc(member.id)}" data-ready="${member.ready ? 'true' : 'false'}">`
      + `${face(member.id)}<span><strong>${esc(whoName(member.id))}</strong> <span class="ready-detail">${esc(crewReadiness(member))}</span></span></li>`).join('')}</ul>`;
  } else if (status && status.available === false) {
    html += `<p class="quiet-note">${esc(status.error || 'Milo’s drafting kit isn’t unpacked yet.')}</p>`;
  } else if (!status) {
    html += '<p class="quiet-note">Checking who’s around…</p>';
  }
  if (status?.designer && status.available !== false) html += `<p class="shares-note">${esc(sharesText(status.designer))}</p>`;
  return `${html}</section>`;
}

function renderCamp() {
  const all = evaluations();
  let html = renderCompanyLinks();
  if (SKILLS.length) {
    html += `<section class="skills"><h3>${phase4 ? 'Milo’s Arts' : 'Skills'}</h3>`;
    for (const skill of SKILLS) {
      const evaluation = all[skill.id] || { level: 0, next: skill.levels?.[0] || null, proven: [] };
      const level = Number(evaluation.level) || 0;
      html += `<article class="skill" data-skill="${esc(skill.id)}" data-level="${level}"><header><h4>${esc(skill.name)}</h4>`
        + `<span class="skill-level">${level ? `Level ${level}` : 'Not yet'}</span></header>`
        + `<p class="skill-summary">${esc(skill.summary)}${skill.place && skill.place !== 'camp' ? ` <span class="skill-place">${esc(placeName(skill.place))}</span>` : ''}</p>`
        + levelList(skill, evaluation) + '</article>';
    }
    html += '</section>';
  } else {
    html += '<p class="quiet-note">Milo\'s skill notes aren\'t unpacked yet.</p>';
  }
  html += renderDesigner();
  const settings = [
    ['motion', 'Motion', 'Gentle movement in the world.'],
    ['notifications', 'Alerts', 'A quiet note when a task finishes.'],
    ['greeting', 'Greeting', 'Milo says hello when you open MILO.'],
  ];
  html += '<section class="settings"><h3>Settings</h3>' + settings.map(([key, label, hint]) => {
    const on = state.settings?.[key] !== false;
    return `<div class="setting"><div><p class="setting-name" id="setting-${key}">${label}</p><p class="setting-hint">${esc(hint)}</p></div>`
      + `<button type="button" class="switch" role="switch" aria-checked="${on}" aria-labelledby="setting-${key}" data-setting="${key}" data-focus-key="setting-${key}"><span class="switch-knob" aria-hidden="true"></span><span class="switch-text">${on ? 'On' : 'Off'}</span></button></div>`;
  }).join('')
    // The evening bell is a threshold a rift reads, so it's visible and editable at every tier.
    + (phase3 ? panelsModule.eveningBellSetting(bellSettings()) : '')
    + (reducedMotion.matches ? '<p class="setting-hint">Your system asks for reduced motion, so only walking moves.</p>' : '') + '</section>';
  return html;
}

// Phase 4: the way into Setting out, the company's sheets and their notebooks, from the camp.
function renderCompanyLinks() {
  if (!phase4?.fight) return '';
  const names = { claude: 'The Scribe', codex: 'The Artificer', jev: 'Jev', tollkeeper: 'The Tollkeeper' };
  const roster = Object.keys(state.party?.roster || {}).filter(id => id !== 'milo');
  const sheet = id => `<button type="button" class="px-btn" data-action="phase4-open" data-panel="company:${esc(id)}" data-focus-key="company-${esc(id)}">${esc(names[id] || state.party?.roster?.[id]?.name || id)}</button>`;
  return '<section class="company-links"><h3>The company</h3>'
    + '<div class="notebook-actions"><button type="button" class="px-btn primary" data-action="phase4-open" data-panel="muster" data-focus-key="company-muster">Setting out</button>'
    + '<button type="button" class="px-btn" data-action="phase4-open" data-panel="company:milo" data-focus-key="company-milo">Milo’s sheet</button>'
    + '<button type="button" class="px-btn" data-action="phase4-open" data-panel="fire" data-focus-key="company-fire">The fire</button></div>'
    + (roster.length ? `<div class="notebook-actions">${roster.slice(0, 6).map(sheet).join('')}</div>` : '')
    + '</section>';
}

// The harbor: still in the fog until a calendar is connected.
function renderFog(place) {
  const FOG = 'Connect a calendar to clear the fog.';
  const blurb = String(place.blurb || '').replace(FOG, '').trim();
  let html = `<p class="fog-note">${FOG}</p>`;
  html += `<p class="panel-lede">${esc(blurb || 'Past the fog, by the water.')}</p>`;
  html += '<p class="coming">Coming in a later step</p>';
  const skill = SKILLS.find(entry => entry.id === 'timekeeping');
  if (skill) {
    html += `<article class="skill" data-skill="${esc(skill.id)}" data-level="0"><header><h4>${esc(skill.name)}</h4><span class="skill-level">Planned</span></header>`
      + `<p class="skill-summary">${esc(skill.summary)}</p>`
      + `<ol class="levels">${(skill.levels || []).map(level => `<li data-level-state="locked">${LOCK}<span class="level-name">Level ${esc(level.level)}: ${esc(level.title)}</span></li>`).join('')}</ol></article>`;
  }
  return html;
}

// ---------------------------------------------------------------------------
// Plots: an empty plot to chat about, a building site while the crew designs, a building after.

let job = null; // { kind: 'suggest' | 'design', plotId, who, idea, tweak, question, redesign, name, startedAt, cancelling }
let architectStatus = null;
let artTimer = null;
// The world's pace for a building site (stakes, frame, scaffold, nearly done): quick for Milo's
// kit, slower while Claude Code or Codex draws, since they take half a minute or more.
const SITE_PACE = engineModule?.SITE_PACE || { kit: 2400, crew: 11_000 };
const STILL_DRAWING_MS = 25_000;

// How far the building site in the panel has got: it goes up with the job, like the one in the
// world, and waits at 'nearly done' until the plans land. Still frames show the scaffold.
function siteStage() {
  if (!motionOn()) return 2;
  const since = job?.kind === 'design' && Number.isFinite(job.startedAt) ? job.startedAt : null;
  if (since === null) return 3;
  const step = isCrew(job.who) ? SITE_PACE.crew : SITE_PACE.kit;
  return clamp(Math.floor((Date.now() - since) / step), 0, 3);
}
const drafts = new Map();          // `${plotId}:${field}` → what Chris has typed so far
const plotNotes = new Map();       // plotId → Milo's line after something happened there
const plotErrors = new Map();      // plotId → a calm note when asking didn't work
const fetchingLocal = new Set();
let plotUi = { plotId: null, renaming: false, redesigning: false, confirming: false };

// Milo's drafting kit (the architect, in the main process) is there to ask.
const canAsk = () => Boolean(architect) && architectStatus?.available !== false;

function resetPlotUi(plotId) {
  plotUi = { plotId, renaming: false, redesigning: false, confirming: false };
}

// { refresh: true } has the crew's sign-in checked again (the camp panel asks for that).
function refreshArchitectStatus(options) {
  if (!architect) return Promise.resolve(null);
  return Promise.resolve()
    .then(() => architect.status(options))
    .then(status => {
      architectStatus = status && typeof status === 'object' ? status : null;
      const open = els.panel.hidden ? null : els.panel.dataset.place;
      if (open === 'camp' || (isPlot(open) && !job)) refreshPanel({ passive: true });
      return architectStatus;
    })
    .catch(error => {
      console.warn('[MILO] designer status failed:', error.message);
      return architectStatus;
    });
}

function jobText(current = job) {
  if (!current) return '';
  if (current.cancelling) return 'Stopping…';
  const who = whoName(current.who);
  return current.kind === 'suggest' ? `${who} is thinking of ideas…` : `${who} is drawing up plans…`;
}

const draft = (plotId, field) => drafts.get(`${plotId}:${field}`) || '';
// 'the Clip studio', but 'The sorting office' and 'Chris’s draft room' keep their own words.
const theName = name => (/^(the|a|an)\s/i.test(name) || /^\S+['’]s\s/.test(name) ? name : `the ${name}`);
const TheName = name => { const text = theName(name); return text.charAt(0).toUpperCase() + text.slice(1); };
const quoted = text => `“${text}”`;
// Ends a sentence once: 'About “what should go here?”' needs no extra full stop.
const endSentence = text => (/[.?!…]["”’]?$/.test(text) ? text : `${text}.`);
const STAND_IN = 'Your idea';

function clipWords(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

// How Milo refers to an idea mid-sentence: its name in quotes, or, when Chris typed it without a
// name (the kit's stand-in title is 'Your idea'), his own words.
function ideaLabel(idea) {
  const title = String(idea?.title || '').trim();
  const pitch = String(idea?.pitch || '').trim();
  if ((!title || title === STAND_IN) && pitch) return `your idea, ${quoted(clipWords(pitch, 60))}`;
  return title && title !== STAND_IN ? quoted(title) : 'your idea';
}

function miloSays(text) {
  return `<div class="milo-says">${face('milo')}<p>${esc(text)}</p></div>`;
}

function progressBlock() {
  // The status takes keyboard focus when a request starts, not Cancel: a habitual double Enter or
  // a held key must never cancel what was just asked. Tab reaches Cancel next.
  return '<div class="progress" role="status" tabindex="-1" data-focus-key="progress">'
    + '<span class="progress-dots" aria-hidden="true"><i></i><i></i><i></i></span>'
    + `<p class="progress-text">${esc(jobText())}</p>`
    + `<button type="button" class="px-btn" data-action="cancel" data-focus-key="cancel"${job?.cancelling ? ' disabled' : ''}>Cancel</button>`
    + '</div>';
}

function artFigure(mode, plotId, label) {
  const draw = { building: 'drawBuilding', redesign: 'drawRedesign', site: 'drawConstruction', empty: 'drawEmptyPlot' }[mode];
  if (typeof kitModule?.[draw] !== 'function' || typeof spritesModule?.rgbaOf !== 'function') return '';
  const aria = label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"';
  return `<figure class="plot-art" data-art-mode="${mode}"><canvas class="plot-canvas" data-art="${mode}" data-plot="${esc(plotId)}"${aria}></canvas></figure>`;
}

function ideaCard(idea, index, locked) {
  return `<li class="idea" data-idea-id="${esc(idea.id)}" data-source="${esc(idea.source)}">`
    + `<div class="idea-head"><h4 class="idea-title">${esc(idea.title)}</h4>`
    + `<button type="button" class="px-btn" data-action="build" data-index="${index}" data-focus-key="build-${index}" aria-label="${esc(`Build this: ${idea.title}`)}"${locked ? ' disabled' : ''}>Build this</button></div>`
    + (idea.pitch ? `<p class="idea-pitch">${esc(idea.pitch)}</p>` : '')
    + (idea.why ? `<p class="idea-why"><span class="sr-only">Why: </span>${esc(idea.why)}</p>` : '')
    + '</li>';
}

function busyElsewhereNote(plotId) {
  if (!job || job.plotId === plotId) return '';
  const what = job.kind === 'design' ? 'drawing up plans' : 'thinking of ideas';
  return `<p class="plot-note" data-note="busy">${esc(whoName(job.who))} is ${what} at ${esc(placeTitle(job.plotId))} right now. You can do more here once that’s done.</p>`;
}

function renderEmptyPlot(place, plot) {
  const id = place.id;
  const here = job && job.plotId === id;
  const locked = Boolean(job) || !canAsk();
  const suggestions = Array.isArray(plot.suggestions) ? plot.suggestions : [];
  const source = suggestions[0]?.source;
  let html = artFigure('empty', id, '');
  html += `<p class="panel-lede">${esc(place.blurb || 'An empty plot, ready for something new.')}</p>`;
  const note = plotNotes.get(id);
  let line;
  if (!canAsk()) line = 'My drafting kit isn’t unpacked yet, so I can’t suggest anything just now.';
  else if (note) line = note;
  else if (!suggestions.length) line = 'Let me think about what would suit this spot.';
  else if (plot.asked) line = `${endSentence(`You asked ${quoted(plot.asked)}`)} Here’s what ${isCrew(source) ? whoName(source) : 'I'} came up with.`;
  else if (isCrew(source)) line = `Here are three ideas from ${whoName(source)}. Or ask me for something else.`;
  else line = 'Here are three ideas for this spot. Or ask me for something else.';
  html += miloSays(line);
  if (plot.idea && !here) {
    html += `<div class="plot-note" data-note="retry"><p>Milo was drawing up ${esc(ideaLabel(plot.idea))} here when things stopped.</p>`
      + `<button type="button" class="px-btn" data-action="retry" data-focus-key="retry"${locked ? ' disabled' : ''}>Try again</button></div>`;
  }
  const error = plotErrors.get(id);
  if (error) html += `<p class="plot-note" data-note="error">${esc(error)}</p>`;
  if (suggestions.length) {
    html += `<ul class="ideas" aria-label="${esc(`Ideas for ${place.name}`)}"${here && job.kind === 'suggest' ? ' aria-busy="true"' : ''}>${suggestions.map((idea, index) => ideaCard(idea, index, locked)).join('')}</ul>`;
  }
  const inputId = `ask-${id}`;
  html += '<form class="ask" data-form="ask" novalidate>'
    + `<label class="ask-label" for="${inputId}">Ask Milo what should go here, or describe your own idea</label>`
    + `<input class="px-input" id="${inputId}" name="ask" type="text" maxlength="${ASK_MAX}" autocomplete="off" placeholder="Something for my drawing streams" value="${esc(draft(id, 'ask'))}" data-field="ask" data-focus-key="ask"${locked ? ' disabled' : ''}>`
    + '<div class="ask-actions">'
    + `<button type="submit" class="px-btn primary" data-action="ask" data-focus-key="ask-button"${locked ? ' disabled' : ''}>Ask for ideas</button>`
    + `<button type="button" class="px-btn" data-action="build-mine" data-focus-key="build-mine"${locked ? ' disabled' : ''}>Build my idea</button>`
    + '</div><p class="ask-hint" data-hint aria-live="polite"></p></form>';
  if (here) html += progressBlock();
  html += busyElsewhereNote(id);
  if (canAsk()) html += `<p class="shares-note" data-shares>${esc(sharesText(here ? job.who : undefined))}</p>`;
  return html;
}

function renderSite(place, plot) {
  const id = place.id;
  const idea = job?.idea || plot.idea;
  const redesign = Boolean(job?.plotId === id && job.redesign) || (plot.status === 'designing' && Boolean(plot.blueprint));
  const name = (job?.plotId === id && job.redesign ? job.name : '') || buildingNameOf({ ...plot, status: 'built' });
  // A building being redesigned stays standing, with a scaffold round it, until the new plans land.
  let html = redesign && plot.blueprint
    ? artFigure('redesign', id, `Pixel drawing of ${theName(name || 'the building')} with a scaffold round it`)
    : artFigure('site', id, `Pixel drawing of a building site on ${place.name}`);
  if (job && job.plotId === id) {
    const crew = isCrew(job.who);
    const line = job.redesign
      ? `${endSentence(`${crew ? `I’ve asked ${whoName(job.who)}` : 'I’m working out how'} to redesign ${theName(name || 'it')}${job.tweak ? `: ${quoted(job.tweak)}` : ''}`)} It stays as it is until the new plans come back.`
      : `${endSentence(`${crew ? `I’ve asked ${whoName(job.who)} to design` : 'I’m drawing up'} ${ideaLabel(idea)}`)} The scaffold stays up until the plans come back.`;
    html += miloSays(line);
    html += progressBlock();
    html += `<p class="shares-note" data-shares>${esc(sharesText(job.who))}</p>`;
  } else {
    html += miloSays(endSentence(`The crew is drawing up ${ideaLabel(idea)}`));
  }
  return html;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// '26 Sep'
function builtOn(plot) {
  const at = Number(plot.builtAt);
  if (!Number.isFinite(at) || at <= 0) return '';
  const date = new Date(at);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function renderLevels(blueprint) {
  const levels = Array.isArray(blueprint.levels) ? blueprint.levels : [];
  return '<section class="level-tree" data-group="levels"><h3>Level tree</h3>'
    + '<p class="tree-note">All planned for now. Dispatch builds these in a later step.</p>'
    + `<ol class="plan-levels">${levels.map(level => `<li class="plan-level" data-level="${esc(level.level)}" data-level-state="planned">`
      + `<div class="plan-head"><span class="plan-num" aria-hidden="true">${esc(level.level)}</span>`
      + `<span class="plan-title"><span class="sr-only">Level ${esc(level.level)}: </span>${esc(level.title)}</span><span class="level-tag">Planned</span></div>`
      + (level.summary ? `<p class="plan-summary">${esc(level.summary)}</p>` : '')
      + (level.proof ? `<p class="plan-proof">${BOX}<span><span class="sr-only">Proof check: </span>${esc(level.proof)}</span></p>` : '')
      + '</li>').join('')}</ol></section>`;
}

function renderBuilding(place, plot) {
  const id = place.id;
  const blueprint = plot.blueprint || {};
  const name = buildingNameOf(plot) || blueprint.name || 'Your building';
  const locked = Boolean(job) || !canAsk();
  let html = artFigure('building', id, `Pixel drawing of ${theName(name)}`);
  const note = plotNotes.get(id);
  if (note) html += miloSays(note);
  const error = plotErrors.get(id);
  if (error) html += `<p class="plot-note" data-note="error">${esc(error)}</p>`;
  // The name itself sits in the panel's title; the body starts with what the building is for.
  if (blueprint.tagline) html += `<p class="building-tagline">${esc(blueprint.tagline)}</p>`;
  if (blueprint.purpose) html += `<p class="building-purpose">${esc(blueprint.purpose)}</p>`;
  const meta = [`Designed by ${whoName(plot.designedBy)}`, builtOn(plot), place.name].filter(Boolean);
  if (plotUi.renaming) {
    html += '<form class="rename" data-form="rename" novalidate>'
      + `<label class="ask-label" for="rename-${id}">A new name for ${esc(theName(name))}</label>`
      + `<input class="px-input" id="rename-${id}" type="text" maxlength="${NAME_MAX}" autocomplete="off" value="${esc(draft(id, 'rename') || name)}" data-field="rename" data-focus-key="rename-input">`
      + '<div class="ask-actions"><button type="submit" class="px-btn primary" data-focus-key="rename-save">Save name</button>'
      + '<button type="button" class="px-btn" data-action="rename-cancel">Never mind</button></div></form>';
  } else {
    html += `<div class="building-head"><p class="building-meta">${meta.map(esc).join('<span class="sep" aria-hidden="true"> · </span>')}</p>`
      + `<button type="button" class="link-btn" data-action="rename" data-focus-key="rename" aria-label="${esc(`Rename ${theName(name)}`)}">Rename</button></div>`;
  }
  html += renderLevels(blueprint);
  html += '<section class="building-actions" data-group="actions">';
  if (plotUi.confirming) {
    html += '<div class="confirm" role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-body">'
      + `<p class="confirm-title" id="confirm-title">Clear ${esc(place.name)}?</p>`
      + `<p class="confirm-body" id="confirm-body">${esc(TheName(name))} and its level tree come down, and the plot is empty again.</p>`
      + '<div class="ask-actions"><button type="button" class="px-btn" data-action="clear-confirm" data-focus-key="clear-confirm">Clear plot</button>'
      + '<button type="button" class="px-btn primary" data-action="clear-cancel" data-focus-key="clear-cancel">Keep it</button></div></div>';
  } else if (plotUi.redesigning) {
    html += '<form class="redesign" data-form="redesign" novalidate>'
      + `<label class="ask-label" for="tweak-${id}">Anything to change? This part is optional.</label>`
      + `<input class="px-input" id="tweak-${id}" type="text" maxlength="${ASK_MAX}" autocomplete="off" placeholder="Make it cozier" value="${esc(draft(id, 'tweak'))}" data-field="tweak" data-focus-key="tweak">`
      // A redesign is a new look; the level tree stays unless Chris asks for new levels too.
      + `<label class="rethink" for="rethink-${id}"><input type="checkbox" id="rethink-${id}" data-field="rethink" data-focus-key="rethink"${draft(id, 'rethink') ? ' checked' : ''}>`
      + '<span>Rethink its levels too<span class="rethink-hint">Otherwise only the look changes and the level tree stays.</span></span></label>'
      + `<div class="ask-actions"><button type="submit" class="px-btn primary" data-focus-key="redesign-go"${locked ? ' disabled' : ''}>Redesign</button>`
      + '<button type="button" class="px-btn" data-action="redesign-cancel">Never mind</button></div></form>';
    if (canAsk()) html += `<p class="shares-note" data-shares>${esc(sharesText())}</p>`;
  } else {
    html += '<div class="ask-actions">'
      + `<button type="button" class="px-btn" data-action="redesign" data-focus-key="redesign"${locked ? ' disabled' : ''}>Redesign</button>`
      + `<button type="button" class="px-btn" data-action="clear" data-focus-key="clear"${job?.plotId === id ? ' disabled' : ''}>Clear plot</button></div>`;
  }
  html += '</section>';
  html += busyElsewhereNote(id);
  return html;
}

function renderPlot(place) {
  const plot = plotOf(place.id);
  const designingHere = plot.status === 'designing' || (job && job.kind === 'design' && job.plotId === place.id);
  let html;
  if (!plots) html = '<p class="quiet-note">Milo’s plot notes aren’t unpacked yet.</p>';
  // (A plot being redesigned is 'designing' but still has its building: renderSite draws it.)
  else if (designingHere) html = renderSite(place, plot);
  else if (plot.status === 'built' && plot.blueprint) html = renderBuilding(place, plot);
  else html = renderEmptyPlot(place, plot);
  const status = designingHere ? 'designing' : plot.status === 'built' ? 'built' : 'empty';
  return `<div class="plot-view" data-plot="${esc(place.id)}" data-plot-status="${status}">${html}</div>`;
}

function renderPanelBody(id) {
  const registered = phase4?.panels.render(id);
  if (typeof registered === 'string') return registered;
  const special = phase3 ? renderPhase3Panel(id) : null;
  if (special !== null) return special;
  const place = placeById(id) || { id, name: id, blurb: '', kind: 'plot' };
  if (id === 'watchtower') return renderWatchtower();
  if (id === 'camp') return renderCamp();
  if (place.kind === 'fog') return renderFog(place);
  return renderPlot(place);
}

// ---------------------------------------------------------------------------
// Pixel art in the plot panel, painted from the kit's palette rows at whole-pixel scales.

function validRows(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 1024) return false;
  const width = typeof rows[0] === 'string' ? rows[0].length : 0;
  return width > 0 && width <= 1024 && rows.every(row => typeof row === 'string' && row.length === width);
}

// Trims transparent margins so the building itself gets the room.
function cropRows(rows, margin) {
  let top = rows.length;
  let bottom = -1;
  let left = rows[0].length;
  let right = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === '.' || !spritesModule.rgbaOf(row[x])) continue;
      top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x);
    }
  });
  if (bottom < 0) return rows;
  const pad = (row, before, after) => '.'.repeat(before) + row + '.'.repeat(after);
  const cut = rows.slice(top, bottom + 1).map(row => pad(row.slice(left, right + 1), margin, margin));
  const blank = '.'.repeat(cut[0].length);
  return [...Array(margin).fill(blank), ...cut, ...Array(margin).fill(blank)];
}

// Keeps the part of the picture around what's drawn (the kit reports its box), plus some yard.
// A negative margin trims into the box's bare edges (only ever used for soil and scaffold).
function cropToBox(rows, box, mx, my = mx) {
  const width = rows[0].length;
  const x0 = clamp(Math.floor(box.x) - mx, 0, width - 1);
  const y0 = clamp(Math.floor(box.y) - my, 0, rows.length - 1);
  const x1 = clamp(Math.ceil(box.x + box.w) + mx, x0 + 1, width);
  const y1 = clamp(Math.ceil(box.y + box.h) + my, y0 + 1, rows.length);
  return rows.slice(y0, y1).map(row => row.slice(x0, x1));
}

// How much room a panel picture has, in device pixels, and how far it may be scaled up.
function artRoom(canvas, mode) {
  const dpr = window.devicePixelRatio || 1;
  const standing = mode === 'building' || mode === 'redesign';
  return {
    dpr,
    wide: Math.max(64, (canvas.parentElement?.clientWidth || 320) - 16) * dpr,
    tall: (standing ? 300 : 170) * dpr,
    most: Math.max(1, Math.round((standing ? 5 : 3) * dpr)),
  };
}

// Whole device pixels per art pixel keeps every edge crisp at any display scale.
const pixelScale = (room, w, h) => clamp(Math.floor(Math.min(room.wide / w, room.tall / h)), 1, room.most);

// The picture for a plot panel: { rows, k }. The scale is picked for the drawing itself, then the
// yard around it fills what that scale leaves. A wide empty plot or building site (the Long
// meadow) may lose a little of its bare soil at the sides so it can be drawn a size up.
function artRows(mode, plotId, room) {
  const size = plotSize(plotId);
  const plot = plotOf(plotId);
  const where = { id: plotId, name: placeName(plotId), ...size };
  const out = safe(() => {
    if (mode === 'building') return kitModule.drawBuilding(plot.blueprint, where);
    if (mode === 'redesign') return (kitModule.drawRedesign || kitModule.drawBuilding)(plot.blueprint, where);
    if (mode === 'site') return kitModule.drawConstruction(where, siteStage());
    return kitModule.drawEmptyPlot(where);
  }, null, `kit ${mode}`);
  const rows = Array.isArray(out) ? out : out?.rows;
  if (!validRows(rows)) return null;
  // A building site keeps one frame for all its stages, so the picture doesn't jump as it goes up.
  const box = mode === 'site' ? siteBox(where) : out && !Array.isArray(out) ? out.box : null;
  if (!isBox(box)) {
    const cropped = cropRows(rows, 3);
    return { rows: cropped, k: pixelScale(room, cropped[0].length, cropped.length) };
  }
  const standing = mode === 'building' || mode === 'redesign';
  const margin = standing ? 8 : 6;
  let k = pixelScale(room, box.w + 4, box.h + 4);
  if (!standing) k = Math.max(k, pixelScale(room, Math.ceil(box.w * 0.86), box.h + 4));
  // Never trims the building itself, and never more than a sliver of soil.
  const mx = clamp(Math.floor((room.wide / k - box.w) / 2), standing ? 2 : -Math.floor(box.w * 0.07), margin);
  const my = clamp(Math.floor((room.tall / k - box.h) / 2), 0, margin);
  return { rows: cropToBox(rows, box, mx, my), k };
}

const isBox = box => Boolean(box) && [box.x, box.y, box.w, box.h].every(Number.isFinite) && box.w > 0 && box.h > 0;
const siteBoxes = new Map();

// Everything any stage of this plot's building site draws.
function siteBox(where) {
  const key = `${where.id}:${where.w}x${where.h}`;
  if (siteBoxes.has(key)) return siteBoxes.get(key);
  let union = null;
  for (let stage = 0; stage < 4; stage += 1) {
    const box = safe(() => kitModule.drawConstruction(where, stage)?.box, null, 'kit site');
    if (!isBox(box)) continue;
    union = union
      ? { x: Math.min(union.x, box.x), y: Math.min(union.y, box.y), w: Math.max(union.x + union.w, box.x + box.w) - Math.min(union.x, box.x), h: Math.max(union.y + union.h, box.y + box.h) - Math.min(union.y, box.y) }
      : { ...box };
  }
  siteBoxes.set(key, union);
  return union;
}

function drawRows(canvas, { rows, k }, room) {
  const w = rows[0].length;
  const h = rows.length;
  canvas.width = w * k;
  canvas.height = h * k;
  canvas.style.width = `${(w * k) / room.dpr}px`;
  canvas.style.height = `${(h * k) / room.dpr}px`;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(w, h);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x += 1) {
      const rgba = row[x] === '.' ? null : spritesModule.rgbaOf(row[x]);
      if (rgba) image.data.set(rgba, (y * w + x) * 4);
    }
  });
  const source = document.createElement('canvas');
  source.width = w;
  source.height = h;
  source.getContext('2d').putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, w * k, h * k);
  canvas.dataset.pixel = String(k);
}

function paintArt(canvas) {
  const mode = canvas.dataset.art;
  const room = artRoom(canvas, mode);
  const art = artRows(mode, canvas.dataset.plot, room);
  if (art) drawRows(canvas, art, room);
  return Boolean(art);
}

function paintPanelArt() {
  clearInterval(artTimer);
  artTimer = null;
  const canvases = [...els.panelBody.querySelectorAll('canvas[data-art]')];
  for (const canvas of canvases) {
    if (!paintArt(canvas)) canvas.closest('figure')?.remove();
  }
  const site = canvases.find(canvas => canvas.dataset.art === 'site' && canvas.isConnected);
  if (site && motionOn() && siteStage() < 3) {
    let shown = siteStage();
    artTimer = setInterval(() => {
      const stage = siteStage();
      if (!site.isConnected || stage === shown) {
        if (!site.isConnected) { clearInterval(artTimer); artTimer = null; }
        return;
      }
      shown = stage;
      paintArt(site);
      if (stage >= 3) { clearInterval(artTimer); artTimer = null; }
    }, ART_TICK_MS);
  }
  if (phase3) paintScenes();
  phase4?.paintPortraits(els.panelBody);
}

// ---------------------------------------------------------------------------
// Opening, refreshing and closing panels.

// What the panel body shows now, as built (so a refresh with nothing new can leave the DOM alone).
let panelShown = { id: null, html: null };
let panelDeferred = false;

/**
 * Redraws the open panel. `passive`: a background refresh (a snapshot, the rift loop's tick, a
 * status check), which leaves the panel alone when nothing it shows has changed, and waits while
 * Chris has one of its dropdowns in hand, so an open list never closes under him.
 */
function refreshPanel({ focus = null, passive = false } = {}) {
  if (els.panel.hidden) return;
  const id = els.panel.dataset.place;
  const html = renderPanelBody(id);
  if (passive) {
    if (panelShown.id === id && panelShown.html === html) {
      const title = placeTitle(id);
      if (els.panelTitle.textContent !== title) els.panelTitle.textContent = title;
      return;
    }
    const holding = document.activeElement;
    if (holding?.tagName === 'SELECT' && els.panelBody.contains(holding)) { panelDeferred = true; return; }
  }
  panelDeferred = false;
  const scroll = els.panelBody.scrollTop;
  const active = document.activeElement;
  const inside = els.panel.contains(active);
  const focusKey = els.panelBody.contains(active) ? active.dataset.focusKey : null;
  const selection = inside && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  els.panelTitle.textContent = placeTitle(id);
  els.panelBody.innerHTML = html;
  panelShown = { id, html };
  els.panelBody.scrollTop = scroll;
  paintPanelArt();
  const target = (focus && els.panelBody.querySelector(`[data-focus-key="${CSS.escape(focus)}"]`))
    || (focusKey && els.panelBody.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`));
  if (target && !target.disabled && (focus || inside)) {
    target.focus({ preventScroll: !focus });
    // Bring the whole little form into view (its buttons too), not just the field that has focus.
    if (focus) target.closest('form, .confirm, .progress')?.scrollIntoView({ block: 'nearest' });
    if (selection && focusKey === target.dataset.focusKey && typeof target.setSelectionRange === 'function') {
      try { target.setSelectionRange(...selection); } catch { /* not a text field */ }
    }
  } else if (inside && !els.panel.contains(document.activeElement)) {
    // What had focus is gone (a card became a building site): keep keyboard users in the panel.
    els.panelTitle.focus({ preventScroll: true });
  }
}

function refreshPlot(plotId, options) {
  if (!els.panel.hidden && els.panel.dataset.place === plotId) refreshPanel(options);
}

function markCurrentPlace(id) {
  for (const button of els.placeList.querySelectorAll('[data-place], [data-entity]')) {
    if ((button.dataset.place || button.dataset.entity) === id) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
}

function openPanel(rawId, { walk = false, focus = true, save = true, via = null } = {}) {
  const id = canonicalId(rawId);
  if (!id) return;
  hideTip();
  if (!els.panel.hidden && !panelClosing && els.panel.dataset.place === id) {
    // The same rift seen another way (its echo, or up close) shows that way's actions.
    if (via && riftUi.panelId === id && riftUi.via !== via) { riftUi.via = via; refreshPanel(); }
    if (focus) els.panelTitle.focus({ preventScroll: true });
    return;
  }
  if (document.activeElement && !els.panel.contains(document.activeElement)) lastPanelOpener = document.activeElement;
  if (id !== 'watchtower') earlierLimit = EARLIER_STEP;
  if (plotUi.plotId !== id) resetPlotUi(id);
  if (riftUi.panelId !== id) resetRiftUi(id, via);
  for (const plotId of [...plotNotes.keys()]) if (plotId !== id) plotNotes.delete(plotId);
  // What just happened at a place in the wilds is news only until Milo looks elsewhere.
  for (const placeId of [...poiResults.keys()]) if (placeId !== id) poiResults.delete(placeId);
  els.panel.dataset.place = id;
  els.panelTitle.textContent = placeTitle(id);
  const html = renderPanelBody(id);
  els.panelBody.innerHTML = html;
  panelShown = { id, html };
  panelDeferred = false;
  const wasHidden = els.panel.hidden;
  panelClosing = false;
  els.panel.hidden = false;
  // Only once shown: a hidden panel ignores scrollTop and would reopen at the last panel's scroll.
  els.panelBody.scrollTop = 0;
  els.stage.dataset.panel = 'open';
  if (wasHidden) requestAnimationFrame(() => els.panel.classList.add('open'));
  else els.panel.classList.add('open'); // reopened while sliding out
  paintPanelArt();
  updateWorldInsets();
  markCurrentPlace(id);
  if (walk) walkToPlace(id);
  if (focus) els.panelTitle.focus({ preventScroll: true });
  if (save && state.panel !== id) { state.panel = id; scheduleSave(); }
  if (isPlot(id)) {
    ensureSuggestions(id);
    if (!architectStatus) refreshArchitectStatus();
  }
  if (id === 'camp') refreshArchitectStatus({ refresh: true });
}

function closePanel() {
  if (els.panel.hidden) return;
  els.panel.classList.remove('open');
  panelClosing = true;
  updateWorldInsets();
  clearInterval(artTimer);
  artTimer = null;
  const finish = () => {
    if (els.panel.classList.contains('open')) return;
    panelClosing = false;
    els.panel.hidden = true;
    els.panel.removeAttribute('data-place');
    delete els.stage.dataset.panel;
    els.panelBody.innerHTML = '';
    panelShown = { id: null, html: null };
    panelDeferred = false;
    updateWorldInsets();
  };
  if (motionOn()) setTimeout(finish, 220);
  else finish();
  markCurrentPlace(null);
  const opener = lastPanelOpener && document.contains(lastPanelOpener) ? lastPanelOpener : els.canvas;
  opener.focus({ preventScroll: true });
  lastPanelOpener = null;
  plotNotes.clear();
  poiResults.clear();
  resetPlotUi(null);
  resetRiftUi(null);
  stopSceneTimer();
  state.panel = null;
  scheduleSave();
}

// ---------------------------------------------------------------------------
// Asking the crew. One request at a time; the main process holds the same rule.

function afterPlotsChanged(plotId) {
  syncPlots();
  renderPlaces();
  renderCrew();
  summarizeStatus();
  if (plotId) refreshPlot(plotId);
  scheduleSave(150);
  // A new building opens a bright rift (and counts for the Hearth and the Prologue).
  if (phase3) queueRiftLoop();
}

// An empty plot always has its three ideas ready: Milo's own picks, instant and offline.
async function ensureSuggestions(plotId) {
  if (!architect || !plots || fetchingLocal.has(plotId)) return;
  const plot = plotOf(plotId);
  if (plot.status !== 'empty' || (plot.suggestions || []).length >= 3) return;
  fetchingLocal.add(plotId);
  try {
    const result = await architect.localSuggestions(plotId);
    const current = plotOf(plotId);
    if (result?.ok && Array.isArray(result.suggestions) && result.suggestions.length
      && current.status === 'empty' && (current.suggestions || []).length < 3) {
      state = plots.setSuggestions(state, plotId, result.suggestions, null);
      plotErrors.delete(plotId);
      scheduleSave();
      refreshPlot(plotId);
    } else if (result?.code === 'unavailable') {
      architectStatus = { ...(architectStatus || {}), available: false, error: result.error };
      refreshPlot(plotId);
    } else if (result && result.ok === false && result.error) {
      plotErrors.set(plotId, result.error);
      refreshPlot(plotId);
    }
  } catch (error) {
    console.warn('[MILO] local ideas failed:', error.message);
  } finally {
    fetchingLocal.delete(plotId);
  }
}

function progressBubble() {
  if (!job) return;
  const where = placeName(job.plotId);
  const lines = job.kind === 'design'
    ? [endSentence(`For ${job.name ? quoted(job.name) : ideaLabel(job.idea)} on ${where}`)]
    : [job.question ? endSentence(`About ${quoted(job.question)}`) : `For ${where}.`];
  queueBubble({ kind: 'progress', title: jobText(), lines, duration: ALERT_MS, place: job.plotId });
}

// The progress bubble again, after Automatic mode handed the brief on to someone else.
function replaceProgressBubble() {
  for (let i = bubbleQueue.length - 1; i >= 0; i -= 1) if (bubbleQueue[i].kind === 'progress') bubbleQueue.splice(i, 1);
  if (bubbleCurrent?.kind === 'progress') dismissBubble();
  progressBubble();
}

// Main says who has the brief each time the architect asks a crew member. In Automatic mode that
// can change mid-request (Claude Code turned out not to be signed in, so Codex was asked).
architect?.onAsking?.(id => {
  if (!job || !isCrew(id) || job.who === id) return;
  job.who = id;
  renderCrew();
  summarizeStatus();
  refreshPlot(job.plotId);
  replaceProgressBubble();
});

// Why the crew didn't come through, from the architect's reason (by, code), in Milo's words.
function reasonWords(reason, asked) {
  const by = isCrew(reason?.by) ? reason.by : null;
  const who = whoName(by || asked);
  switch (reason?.code) {
    case 'auth': return by ? `${who} isn’t signed in` : 'The crew isn’t signed in';
    case 'missing': return by ? `${who} isn’t on this PC` : 'I couldn’t reach the crew';
    case 'agents': return 'Codex would also send the AGENTS.md in your .codex folder';
    case 'invalid': return `${who}’s answer was hard to read`;
    default: return `${who} didn’t answer`;
  }
}

// Starts a request: the panel shows progress at once, then learns who is actually being asked
// (that depends on the Designer setting and who's signed in).
async function beginJob(next) {
  job = { ...next, who: architectStatus?.designer || 'kit', startedAt: Date.now(), cancelling: false };
  plotErrors.delete(next.plotId);
  plotNotes.delete(next.plotId);
  if (plotUi.plotId === next.plotId) resetPlotUi(next.plotId);
  afterPlotsChanged(null);
  refreshPlot(next.plotId, { focus: 'progress' });
  await flushSave();
  const status = await refreshArchitectStatus();
  if (job && status?.designer && status.designer !== job.who) {
    job.who = status.designer;
    renderCrew();
    summarizeStatus();
    refreshPlot(next.plotId);
  }
}

const TROUBLE = 'Milo couldn’t hear back from the crew just now.';

async function askForIdeas(plotId, question) {
  if (job || !canAsk() || !plots) return;
  const asked = String(question || '').replace(/\s+/g, ' ').trim().slice(0, ASK_MAX);
  await beginJob({ kind: 'suggest', plotId, question: asked });
  progressBubble();
  let result;
  try {
    // Cancelled before the request even left: nothing to ask.
    result = job?.cancelling ? { ok: false, code: 'cancelled' } : await architect.suggest(plotId, asked);
  } catch (error) {
    result = { ok: false, code: 'failed', error: TROUBLE };
    console.warn('[MILO] asking for ideas failed:', error.message);
  }
  const current = job;
  job = null;
  clearProgressBubbles();
  if (result?.ok && Array.isArray(result.suggestions) && result.suggestions.length && !current?.cancelling) {
    state = plots.setSuggestions(state, plotId, result.suggestions, asked || null);
    drafts.delete(`${plotId}:ask`);
    const by = result.suggestions[0]?.source;
    const skipped = Array.isArray(result.skipped) ? result.skipped.filter(isCrew) : [];
    // The crew didn't come through, so these are Milo's own picks: say so kindly, and why.
    let said = '';
    if (isCrew(current?.who) && !isCrew(by)) said = `${reasonWords(result.fallback, current.who)}, so these are my own ideas.`;
    else if (isCrew(by) && skipped.length && skipped[0] !== by) said = `${whoName(skipped[0])} isn’t signed in, so ${whoName(by)} came up with these.`;
    if (said) plotNotes.set(plotId, asked ? `${endSentence(`You asked ${quoted(asked)}`)} ${said}` : said);
    // The panel already shows them when Chris is looking at this plot.
    if (els.panel.hidden || els.panel.dataset.place !== plotId) {
      queueBubble({
        kind: 'note', title: 'Here are three new ideas',
        lines: [isCrew(by) ? `${whoName(by)} came up with them for ${placeName(plotId)}.` : `For ${placeName(plotId)}.`],
        duration: ALERT_MS, place: plotId, actions: [{ id: 'show', label: 'Show me' }, { id: 'later', label: 'Later' }],
      });
    }
  } else if (result?.code === 'cancelled' || current?.cancelling) {
    queueBubble({ kind: 'note', title: 'Okay, I stopped asking', lines: [], duration: 4000, actions: [{ id: 'later', label: 'Okay' }] });
  } else {
    plotErrors.set(plotId, result?.error || TROUBLE);
  }
  afterPlotsChanged(null);
  refreshPlot(plotId, { focus: 'ask' });
}

async function buildIdea(plotId, idea, { tweak = '', redesign = false, rethink = false } = {}) {
  if (job || !canAsk() || !plots) return;
  const clean = modelModule.cleanSuggestion(idea);
  if (!clean) return;
  const change = String(tweak || '').replace(/\s+/g, ' ').trim().slice(0, ASK_MAX);
  // A redesign goes by the building's current name (Chris may have renamed it), not the old idea's.
  const name = redesign ? buildingNameOf(plotOf(plotId)) : '';
  const before = redesign ? plotOf(plotId).blueprint : null;
  state = plots.startDesign(state, plotId, clean);
  await beginJob({ kind: 'design', plotId, idea: clean, tweak: change, redesign, name });
  const started = job;
  progressBubble();
  // A real crew design takes a while: one calm word from Milo if it's still going.
  const stillTimer = setTimeout(() => {
    if (job !== started || !job || job.cancelling || !isCrew(job.who)) return;
    queueBubble({ kind: 'progress', title: `${whoName(job.who)} is still drawing`, lines: ['Good plans take a minute.'], duration: ALERT_MS, place: plotId });
  }, STILL_DRAWING_MS);
  let result;
  try {
    result = job?.cancelling ? { ok: false, code: 'cancelled' } : await architect.design(plotId, clean, change);
  } catch (error) {
    result = { ok: false, code: 'failed', error: TROUBLE };
    console.warn('[MILO] design failed:', error.message);
  }
  clearTimeout(stillTimer);
  const current = job;
  job = null;
  clearProgressBubbles();
  let built = false;
  let levels = null;
  if (result?.ok && !current?.cancelling) {
    // A redesign changes the look; the level tree (and what the building is for) stays unless
    // Chris asked to rethink its levels too.
    const keepPlan = redesign && !rethink && Boolean(before);
    const next = plots.finishDesign(state, plotId, result, clockNow(), { keepPlan });
    if (next.plots?.[plotId]?.status === 'built') {
      state = next;
      built = true;
      if (redesign && before) {
        const titles = bp => (bp?.levels || []).map(level => level.title).join('|');
        levels = titles(before) === titles(next.plots[plotId].blueprint) ? 'kept' : 'changed';
      }
    } else {
      state = plots.stopDesign(state, plotId);
      plotErrors.set(plotId, 'The plans came back smudged, so nothing was built. Try again when you like.');
    }
  } else if (result?.code === 'cancelled' || current?.cancelling) {
    state = plots.stopDesign(state, plotId, { keepIdea: false });
    queueBubble({ kind: 'note', title: 'Okay, I stopped the plans', lines: redesign ? ['The building stays as it was.'] : [], duration: 4000, actions: [{ id: 'later', label: 'Okay' }] });
  } else {
    // Didn't work out. A redesign the crew couldn't finish keeps the building that's there.
    state = plots.stopDesign(state, plotId);
    const trouble = String(result?.error || TROUBLE).replace(/'/g, '’');
    plotErrors.set(plotId, result?.code === 'crew' ? `${trouble} Try again when you like.` : trouble);
    if (result?.code === 'crew' && (els.panel.hidden || els.panel.dataset.place !== plotId)) {
      queueBubble({ kind: 'note', title: 'The new plans didn’t come back', lines: [trouble], duration: ALERT_MS, place: plotId, actions: [{ id: 'show', label: 'Show me' }, { id: 'later', label: 'Okay' }] });
    }
  }
  if (built) {
    for (const field of ['ask', 'tweak', 'rename', 'rethink']) drafts.delete(`${plotId}:${field}`);
    const words = safe(() => builtText(plotOf(plotId), {
      asked: current?.who, placeName: placeName(plotId), fallback: result.fallback || null,
      skipped: Array.isArray(result.skipped) ? result.skipped : [], redesign, levels,
    }), null, 'builtText') || fallback.builtText(plotOf(plotId));
    const says = words.says || words.body;
    plotNotes.set(plotId, says);
    // What this build taught Milo goes in the same bubble, rather than two more after it.
    const learned = recordSkills(false);
    const lines = [says];
    if (learned.length) lines.push(`I learned ${listWords(learned.map(item => `${item.name} level ${item.level}`))} along the way.`);
    queueBubble({
      kind: 'built', title: words.title, lines, duration: GREETING_MS, place: plotId,
      actions: [{ id: 'show', label: 'Show me' }, { id: 'later', label: 'Nice' }],
    });
    // Main decides from the window's real focus; it sends nothing while MILO is in front.
    if (state.settings?.notifications !== false) {
      Promise.resolve(bridge?.notify({ title: words.title, body: words.body })).catch(() => {});
    }
  }
  afterPlotsChanged(null);
  // The world has the finished building now; the scaffold comes down over it.
  if (built) worldCall('celebrate', plotId);
  refreshPlot(plotId);
}

const listWords = items => (items.length <= 1 ? items[0] || '' : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

async function cancelJob() {
  if (!job || job.cancelling) return;
  job.cancelling = true;
  refreshPlot(job.plotId);
  summarizeStatus();
  try {
    await architect?.cancel();
  } catch (error) {
    console.warn('[MILO] cancel failed:', error.message);
  }
}

function ideaForRedesign(plot) {
  if (plot.idea) return plot.idea;
  const blueprint = plot.blueprint || {};
  return { id: 'redesign', title: buildingNameOf(plot) || blueprint.name || 'Building', pitch: blueprint.purpose || blueprint.tagline || '', why: '', source: 'local' };
}

function panelPlotId() {
  const id = els.panel.dataset.place;
  return isPlot(id) ? id : null;
}

function hint(text) {
  const node = els.panelBody.querySelector('[data-hint]');
  if (node) node.textContent = text;
}

els.panel.addEventListener('click', event => {
  if (event.target.closest('[data-action="close-panel"]')) { closePanel(); return; }
  if (event.target.closest('[data-action="more"]')) {
    earlierLimit += EARLIER_STEP;
    refreshPanel();
    return;
  }
  const toggle = event.target.closest('[data-setting]');
  if (toggle) {
    const key = toggle.dataset.setting;
    state.settings = { ...state.settings, [key]: state.settings?.[key] === false };
    if (key === 'motion') applyMotion();
    refreshPanel();
    scheduleSave(150);
    return;
  }
  const button = event.target.closest('button[data-action]');
  if (button?.dataset.action === 'phase4-open' && button.dataset.panel) { openPanel(button.dataset.panel); return; }
  // Phase 4's panels (the Chronicle, Setting out, a companion's sheet …) take their own buttons first.
  if (button && !button.disabled && phase4?.panels.action(button, els.panel.dataset.place)) return;
  // The Hearth, the frontier and the wilds have their own actions.
  if (button && !button.disabled && phase3 && handlePhase3Action(button)) return;
  const plotId = panelPlotId();
  if (!button || !plotId || button.disabled || button.type === 'submit') return;
  const plot = plotOf(plotId);
  switch (button.dataset.action) {
    case 'build': {
      const idea = plot.suggestions?.[Number(button.dataset.index)];
      if (idea) buildIdea(plotId, idea);
      break;
    }
    case 'build-mine': {
      const text = draft(plotId, 'ask').trim();
      const idea = text ? modelModule?.ideaFromText?.(text) : null;
      if (!idea) {
        hint('Describe your idea first, then Milo asks the crew to design it.');
        els.panelBody.querySelector('[data-field="ask"]')?.focus();
        return;
      }
      buildIdea(plotId, idea);
      break;
    }
    case 'retry':
      if (plot.idea) buildIdea(plotId, plot.idea);
      break;
    case 'cancel':
      cancelJob();
      break;
    case 'rename':
      plotUi.renaming = true;
      drafts.set(`${plotId}:rename`, buildingNameOf(plot));
      refreshPanel({ focus: 'rename-input' });
      els.panelBody.querySelector('[data-field="rename"]')?.select();
      break;
    case 'rename-cancel':
      plotUi.renaming = false;
      drafts.delete(`${plotId}:rename`);
      refreshPanel({ focus: 'rename' });
      break;
    case 'redesign':
      plotUi.redesigning = true;
      plotUi.confirming = false;
      refreshPanel({ focus: 'tweak' });
      break;
    case 'redesign-cancel':
      plotUi.redesigning = false;
      refreshPanel({ focus: 'redesign' });
      break;
    case 'clear':
      plotUi.confirming = true;
      plotUi.redesigning = false;
      refreshPanel({ focus: 'clear-cancel' });
      break;
    case 'clear-cancel':
      plotUi.confirming = false;
      refreshPanel({ focus: 'clear' });
      break;
    case 'clear-confirm': {
      const name = buildingNameOf(plot);
      state = plots.clearPlot(state, plotId);
      resetPlotUi(plotId);
      plotErrors.delete(plotId);
      plotNotes.set(plotId, name ? `${TheName(name)} is down. The plot is ready for something new.` : 'The plot is ready for something new.');
      afterPlotsChanged(plotId);
      els.panelTitle.focus({ preventScroll: true });
      ensureSuggestions(plotId);
      recordSkills(false);
      break;
    }
    default:
      break;
  }
});

els.panel.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target.closest('[data-form]');
  const plotId = panelPlotId();
  if (!form || !plotId) return;
  const plot = plotOf(plotId);
  if (form.dataset.form === 'ask') {
    askForIdeas(plotId, draft(plotId, 'ask'));
  } else if (form.dataset.form === 'rename') {
    state = plots.renamePlot(state, plotId, draft(plotId, 'rename'));
    plotUi.renaming = false;
    drafts.delete(`${plotId}:rename`);
    afterPlotsChanged(null);
    refreshPanel({ focus: 'rename' });
  } else if (form.dataset.form === 'redesign') {
    buildIdea(plotId, ideaForRedesign(plot), { tweak: draft(plotId, 'tweak'), redesign: true, rethink: Boolean(draft(plotId, 'rethink')) });
  }
});

els.panel.addEventListener('input', event => {
  const field = event.target.dataset?.field;
  const plotId = panelPlotId();
  if (field && plotId) {
    drafts.set(`${plotId}:${field}`, event.target.type === 'checkbox' ? event.target.checked : event.target.value);
    if (field === 'ask') hint('');
  }
});

els.panel.addEventListener('change', event => {
  const picked = event.target.closest('select[data-action]');
  if (picked && phase4?.panels.action(picked, els.panel.dataset.place)) return;
  // The ward-post rule and the evening bell (the War Table, and the bell at camp too).
  const post = event.target.closest('[data-ward-post]');
  if (post && post.checked) { setWardPost(post.value); return; }
  const bell = event.target.closest('[data-evening-bell]');
  if (bell) { setEveningBell(bell.value); return; }
  const choice = event.target.closest('[data-designer]');
  if (!choice || !choice.checked) return;
  state.settings = { ...state.settings, designer: choice.value };
  flushSave().then(() => refreshArchitectStatus());
});

// A background refresh that waited on a dropdown catches up once Chris is done with it.
els.panel.addEventListener('focusout', event => {
  if (!panelDeferred || event.target?.tagName !== 'SELECT') return;
  setTimeout(() => { if (panelDeferred) refreshPanel({ passive: true }); }, 0);
});

// Escape steps back out of a rename, redesign, clear or let go before it closes the panel.
els.panel.addEventListener('keydown', event => {
  if (event.key === 'Escape' && riftUi.confirming) {
    event.stopPropagation();
    // Back to the Let go it came from: the rift panel's own, or the row's in a list (the same
    // choice Keep it makes).
    const id = riftUi.confirming;
    riftUi.confirming = null;
    refreshPanel({ focus: (els.panel.dataset.place || '').startsWith('rift:') ? 'panel-let-go' : `let-go-${id}` });
    return;
  }
  if (event.key !== 'Escape' || !(plotUi.renaming || plotUi.redesigning || plotUi.confirming)) return;
  event.stopPropagation();
  const focus = plotUi.renaming ? 'rename' : plotUi.redesigning ? 'redesign' : 'clear';
  resetPlotUi(plotUi.plotId);
  refreshPanel({ focus });
});

// ---------------------------------------------------------------------------
// Place list (mirrors the canvas for keyboard and screen reader users).

function placeNote(place) {
  if (place.kind === 'fog') return 'In the fog';
  if (place.kind !== 'plot') return '';
  const plot = plotOf(place.id);
  if (plot.status === 'designing' || (job?.kind === 'design' && job.plotId === place.id)) return 'Being designed';
  if (buildingNameOf(plot)) return place.name;
  return 'Empty plot';
}

// The vale's places, plus the Hearth, and the War Table once the Stockade stands.
function placeEntries() {
  const list = PLACES.map(place => ({ id: place.id, kind: place.kind, title: placeTitle(place.id), note: placeNote(place) }));
  if (!phase3) return list;
  list.push({ id: 'hearth', kind: 'hearth', title: 'The Hearth', note: hearthTierName() });
  if (hearthTierNow() >= 2) list.push({ id: 'war-table', kind: 'war-table', title: 'War Table', note: 'By the north gate' });
  return list;
}

let placesHtml = '';
function renderPlaces() {
  placesStale = false;
  const active = els.placeList.contains(document.activeElement) ? document.activeElement : null;
  const focused = active ? (active.dataset.place || active.dataset.entity) : null;
  // Out in the wilds (or an Elsewhere) the list is what's nearby, and the way home.
  const placeButton = place => `<li><button type="button" data-place="${esc(place.id)}" data-kind="${esc(place.kind)}">${esc(place.title)}${place.note ? ` <span class="place-note">${esc(place.note)}</span>` : ''}</button></li>`;
  let html;
  if (phase3 && areaInfo.area !== 'vale') {
    // The Hearth and the War Table's panels open from anywhere, so they follow Milo out.
    const dashboards = placeEntries().filter(place => place.id === 'hearth' || place.id === 'war-table');
    html = panelsModule.entityList(nearbyEntries(), { home: areaInfo.area === 'elsewhere' ? 'leave' : 'travel-home' })
      + dashboards.map(placeButton).join('');
  } else {
    html = placeEntries().map(placeButton).join('');
    // The gates out to the wilds, so they can be reached without seeing the map.
    if (phase3) {
      html += frontierModule.gateEntries(anchors, worldgenModule.GATES).map(gate => `<li><button type="button" data-entity="${esc(gate.id)}" data-kind="gate">${esc(gate.title)} <span class="place-note">${esc(gate.note)}</span></button></li>`).join('');
    }
  }
  // The same list is left as it is: a button replaced under the pointer would swallow its click.
  if (html === placesHtml) return;
  placesHtml = html;
  els.placeList.innerHTML = html;
  if (!els.panel.hidden) markCurrentPlace(els.panel.dataset.place);
  if (focused) {
    const escaped = CSS.escape(focused);
    els.placeList.querySelector(`[data-place="${escaped}"], [data-entity="${escaped}"]`)?.focus({ preventScroll: true });
    // Gone with the change (Leave or Home took Milo elsewhere, a place fell out of view): the
    // keyboard lands on the world, where the arrow keys walk him, never on the page's body.
    if (!els.placeList.contains(document.activeElement)) els.canvas.focus({ preventScroll: true });
  }
}

els.placesToggle.addEventListener('click', () => {
  const open = els.placesToggle.getAttribute('aria-expanded') !== 'true';
  // Opened, it's brought up to date: out in the wilds the world fills in what's near (today's
  // wild rifts, strays wandering into view) in idle time, not only when Milo moves.
  if (open) renderPlaces();
  els.placesToggle.setAttribute('aria-expanded', String(open));
  els.places.dataset.open = String(open);
});
// Keyboard users see the list whenever focus is in it, so it's brought up to date on the way in.
els.places.addEventListener('focusin', () => { if (placesStale) renderPlaces(); });
els.placeList.addEventListener('click', event => {
  const button = event.target.closest('[data-place], [data-entity]');
  if (!button) return;
  // Tuck the list away again once a place is chosen; focus moves to the panel.
  els.placesToggle.setAttribute('aria-expanded', 'false');
  els.places.dataset.open = 'false';
  if (button.dataset.entity) { goToEntity(button.dataset.entity); return; }
  openPanel(button.dataset.place, { walk: true });
});

els.crew.addEventListener('click', event => {
  const chip = event.target.closest('[data-crew]');
  if (chip) openCrew(chip.dataset.crew);
});

document.addEventListener('click', event => {
  const button = event.target.closest('[data-window]');
  if (button) bridge?.windowAction(button.dataset.window);
});

document.addEventListener('keydown', event => {
  if (phase3 && (event.key === 'm' || event.key === 'M') && !event.ctrlKey && !event.metaKey && !event.altKey) {
    mapKey(event);
    return;
  }
  if (event.key !== 'Escape') return;
  // Escape closes the map first (the map view may already have closed itself on this key).
  if (mapIsOpen()) { if (!event.defaultPrevented) closeMap(); return; }
  if (performance.now() - mapClosedAt < 120) return;
  if (!els.bubble.hidden && (els.bubble.contains(document.activeElement) || els.panel.hidden)) { dismissBubble(); return; }
  if (!els.panel.hidden) closePanel();
});

// ---------------------------------------------------------------------------
// Phase 3: the Hearth, the frontier and the wilds (CONTRACT-PHASE3 §8). The rules live in
// src/rifts.js, src/hearth.js, src/story.js and src/model.js; the words, loot and pictures in
// src/ui/*.js. This part only wires them to the world and the panels.

const RIFT_TICK_MS = 30_000;
const EXPLORE_SAVE_MS = 1500;
const PLACES_THROTTLE_MS = 400;
const NEARBY_MAX = 12;
const isObj = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const idle = fn => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 60));

let phase3 = false;
let content = null;
let worldgen = null;
let riftgen = null;
let shellWilds = null;       // the shell's own wilds, for looking places up (the engine draws its own)
let shellNav = null;
let genres = new Map();
let anchors = new Map();
let fixedById = null;
let rifts = [];              // real and story rifts standing now (held ones included)
const riftIndex = new Map(); // every rift met: real, story, wild and the ladder's, by id
let riftSig = '';
let echoSig = '';
let wildSig = '';
let riftLoopLive = false;
let riftLoopTimer = null;
let lastDay = null;
let areaInfo = { area: 'vale' };
let placesStale = false;
let placesTimer = null;
let mapView = null;
let mapClosedAt = -Infinity;
let mapLoading = null;
let valeImage = null;
let valeVersion = 0; // bumped whenever the plots change, for the War Table map's key
let riftUi = { panelId: null, via: 'list', confirming: null, busy: false, note: null };
let storyUi = { showLetter: false };
let hearthNote = null;
let trackerHtml = '';
let sceneTimer = null;
let warMapCache = null;
let chopping = null;
const stitchedHere = new Set();  // rifts mended on this visit to their Elsewhere
let hereRift = null;             // the rift whose Elsewhere Milo is in (kept through midnight)
const poiResults = new Map();    // place id → what just happened there, in words
const choppedWoods = new Set();  // woods chopped this session (the first of each gets a line)
const poiCache = new Map();

function setupPhase3(bundle) {
  phase3 = false;
  document.documentElement.classList.remove('phase3');
  if (!isObj(bundle) || !isObj(bundle.genres) || !isObj(bundle.riftgen)) return;
  if (PHASE3_MODULES.some(module => !module)) return;
  // A worldgen is only made on first use (its roads are the costly part), so trying one here
  // costs nothing, and a bundle it can't read turns the wilds off before the world is made.
  const made = safe(() => {
    worldgenModule.createWorldgen({ seed: state.wilds?.seed || 'hushlands', regionWords: bundle.riftgen.regionWords });
    return { rg: riftgenModule.createRiftgen({ words: bundle.riftgen, genres: bundle.genres }) };
  }, null, 'setting up the wilds');
  if (!made) return;
  // A damaged fortress.json or riftgen.json would leave the Hearth stuck at the Camp, or no rift
  // ever opening, with nothing said. Then the vale runs on its own, as with no content at all.
  const problem = safe(() => frontierModule.contentProblem(bundle, made.rg), 'the content check', 'checking the content');
  if (problem) {
    console.warn(`[MILO] The wilds stay closed: ${problem} can’t be used.`);
    return;
  }
  content = bundle;
  riftgen = made.rg;
  genres = frontierModule.genreTable(bundle.genres);
  lastDay = riftsModule.dayNumber(clockNow());
  phase3 = true;
  document.documentElement.classList.add('phase3');
}

// ---------------------------------------------------------------------------
// Phase 4 (CONTRACT-PHASE4.md §12): the Kit and the Company. src/ui/phase4.js builds the shell the
// Phase 4 modules mount against and loads what the content bundle can run; this hands it closures
// over the shell's own state, and consults it from the panels, the doors and the rift loop.

// The corner overlays Phase 4 adds, so bubbles and the hover tip keep off them.
const phase4Overlays = () => ['hud', 'log', 'context-menu'].map(id => document.getElementById(id)).filter(Boolean);

// What a menu choice does when it isn't the plain default (K1's menus run the default themselves
// when this returns false).
function chooseOption(option, target, { doors, combatHud } = {}) {
  const id = option?.id || '';
  if (id.startsWith('field-') && doors) { doors.fieldSkill(id.slice(6), target); return true; }
  if (id === 'challenge' && doors) {
    const rift = riftIndex.get(target?.riftId || target?.id) || rifts.find(r => r.id === (target?.riftId || target?.id));
    if (rift) { doors.challenge(rift); return true; }
    return false;
  }
  if (id.startsWith('act:') && combatHud?.act) return combatHud.act(option);
  if (id === 'default' && target?.kind === 'combatant' && combatHud) { combatHud.select(String(target.id).replace(/^cb:/, '')); return true; }
  return false;
}

async function startPhase4(bundle) {
  if (!phase3 || !phase4Module?.setupPhase4) return;
  try {
    phase4 = await phase4Module.setupPhase4({
      bundle,
      getState: () => state,
      setState: (next, delay) => { state = next; scheduleSave(delay); },
      clockNow, motionOn,
      getSnapshot: () => snapshot,
      getArea: () => areaInfo,
      worldCall, queueBubble, openPanel, closePanel, refreshPanel,
      travel, leaveElsewhere,
      openMap: () => { if (!mapIsOpen()) openMap(); },
      esc, bridge,
      setInset,
      riftgen: () => riftgen,
      worldgen: () => worldgen,
      wilds: () => shellWilds,
      wardRadius: () => wardRadiusNow(),
      walkable: () => (x, y) => Boolean(worldCall('isWalkable', x, y)),
      sneaking: () => false,
      where: () => (areaInfo.area === 'vale' ? 'camp' : 'away'),
      atCamp: () => areaInfo.area === 'vale',
      placeLabel,
      choose: chooseOption,
      statusChanged: () => summarizeStatus(),
    });
    // When a fight ends, the bubbles it held come out one by one.
    phase4?.shell.on('combat', message => { if (!message?.live && !bubbleCurrent) setTimeout(nextBubble, 600); });
    // The task rifts rest on the Board, so a change to it asks the rift loop for a fresh look.
    let lastBoard = state.board;
    phase4?.shell.on('state', () => { if (state.board !== lastBoard) { lastBoard = state.board; queueRiftLoop(); } });
  } catch (error) {
    console.warn('[MILO] Phase 4 did not start: ' + error.message);
    phase4 = null;
  }
}

// Once the world stands, the shell looks places up in it: the engine's own worldgen when it shares
// one (world.worldgen), so the roads are laid out once rather than twice, else one of the shell's
// own from the same seed. Its terrain comes from the engine too (world.terrainAt) when it can.
let sharedWorld = false;
let wildTerrain = () => null;
function bindWilds() {
  if (!phase3) return;
  const shared = frontierModule.sharedWorldgen(world);
  const made = safe(() => {
    const wg = shared || worldgenModule.createWorldgen({ seed: state.wilds?.seed || 'hushlands', regionWords: content.riftgen.regionWords });
    const wilds = wildsModule.createWilds({ worldgen: wg, maxChunks: 24 });
    const nav = navModule.createNav({ worldgen: wg, wildBlocked: (x, y) => wilds.blocked(x, y), extraBlocked: (x, y) => wilds.ringBlocked(x, y, hearthTierNow()) });
    return { wg, wilds, nav };
  }, null, 'setting up the wilds');
  if (!made) {
    // Only a broken module gets here (setupPhase3 already made a worldgen from this bundle).
    phase3 = false;
    document.documentElement.classList.remove('phase3');
    return;
  }
  worldgen = made.wg;
  shellWilds = made.wilds;
  shellNav = made.nav;
  sharedWorld = Boolean(shared);
  wildTerrain = frontierModule.terrainSource(world, shellWilds, { heart: worldgenModule.TERRAIN?.HEART ?? 17 }) || (() => null);
  anchors = frontierModule.anchorNames(worldgen);
  document.documentElement.dataset.wilds = sharedWorld ? 'shared' : 'own';
  renderPlaces(); // the gates now name the lands their roads lead to
}

// Launch never places a rift on its own task. Placing one reads the roads (about a tenth of a
// second when a worldgen first lays them out) through world.isWalkable and the reach test. So the
// engine's roads are laid out in an idle slice after the first frame (and the shell's own in a
// slice of their own, only when it had to make its own worldgen), then the rifts the state already
// knows are stood up (quietly: nothing seals before a real look at the crew). `wildsWarm` resolves
// when that's done; launch's own pass waits on it.
let wildsWarm = Promise.resolve();
let bootPassRan = false;
const WARM_WAIT_MS = 4000;
function warmWilds() {
  if (!phase3) return wildsWarm;
  const slice = fn => new Promise(resolve => idle(() => { try { fn(); } finally { resolve(); } }));
  const own = sharedWorld ? Promise.resolve() : slice(() => safe(() => {
    worldgen.roads();
    shellWilds.terrainAt(worldgenModule.HEART?.w ?? 64, -2); // the ring's road detours, from those roads
  }, null, 'roads'));
  wildsWarm = own
    .then(() => slice(() => safe(() => { world?.isWalkable?.(-24, -24); wildTerrain(worldgenModule.HEART?.w ?? 64, -2); }, null, 'the world’s roads')))
    .then(() => slice(() => { if (!bootPassRan && !riftLoopLive) riftLoop({ quiet: true }); }));
  return wildsWarm;
}

const hearthTierNow = () => (phase3 ? safe(() => hearthModule.hearthTier(state), 1, 'hearthTier') : 1);
const wardRadiusNow = () => (phase3 ? safe(() => hearthModule.wardRadius(state, content?.fortress), 0, 'wardRadius') : 0);
const hearthStatusNow = () => safe(() => hearthModule.hearthStatus(state, content?.fortress), null, 'hearthStatus');
const hearthTierName = () => hearthStatusNow()?.def?.name || (hearthTierNow() >= 2 ? 'The Stockade' : 'The Camp');
const snapshotHasSessions = () => Array.isArray(snapshot?.sessions) && snapshot.sessions.length > 0;
const storyStatus = () => safe(() => storyModule.prologueStatus(state, content?.story, { hasSessions: snapshotHasSessions() }), null, 'prologueStatus');

// ---------------------------------------------------------------------------
// The wilds the engine draws: today's day, the tier and what Chris has done out there.

function syncWildState(force = false) {
  if (!phase3) return;
  const wild = frontierModule.wildStateOf(state, clockNow(), { tier: hearthTierNow(), wardRadius: wardRadiusNow() });
  const sig = JSON.stringify(wild);
  if (!force && sig === wildSig) return;
  wildSig = sig;
  worldCall('setWildState', wild);
}

// Walkable in the wilds: the engine's own rule (objects ruled out). Inside an Elsewhere the engine
// answers for the pocket world, so the shell's own copy of the same rules stands in. Wild rifts are
// placed with this, exactly as the engine places them.
// The answers are kept per tier (the land and its objects are fixed by the seed, and a felled
// tree still blocks), so a loop pass while MILO is hidden never regenerates a chunk it has seen.
const freeTiles = { tier: 0, map: new Map(), reach: null };
function checkTier() {
  const tier = hearthTierNow();
  if (freeTiles.tier === tier && freeTiles.map.size <= 16384) return;
  freeTiles.tier = tier;
  freeTiles.map.clear();
  freeTiles.reach?.clear();
}
function isWalkableTile(x, y) {
  checkTier();
  const key = `${x},${y}`;
  const known = freeTiles.map.get(key);
  if (known !== undefined) return known;
  let free = false;
  if (areaInfo.area !== 'elsewhere' && typeof world?.isWalkable === 'function') {
    try { free = world.isWalkable(x, y) === true; } catch { free = false; }
  } else {
    try { free = shellNav.walkable(x, y) === true; } catch { free = false; }
  }
  freeTiles.map.set(key, free);
  return free;
}

// Free for a real rift: walkable, and not in a pocket closed off by trees, water or rock, so
// Step through can always walk Milo there.
const ROAD_TERRAIN = new Set([16, 20]); // worldgen TERRAIN.ROAD and BRIDGE
function isFreeTile(x, y) {
  checkTier();
  if (!isWalkableTile(x, y)) return false;
  if (!freeTiles.reach) {
    const roads = worldgenModule?.TERRAIN ? new Set([worldgenModule.TERRAIN.ROAD, worldgenModule.TERRAIN.BRIDGE]) : ROAD_TERRAIN;
    freeTiles.reach = frontierModule.createReachTest({
      walkable: isWalkableTile,
      isRoad: (tx, ty) => roads.has(wildTerrain(tx, ty)),
      inHeart: (tx, ty) => worldgen.inHeart(tx, ty),
    });
  }
  return freeTiles.reach(x, y);
}

// ---------------------------------------------------------------------------
// The rift loop: every snapshot, every 30 s (hidden or not) and after the changes that matter.

function queueRiftLoop() {
  if (!riftLoopLive) return;
  clearTimeout(riftLoopTimer);
  riftLoopTimer = setTimeout(() => riftLoop(), 0);
}

// Half a second past MILO's next local midnight, a tick of its own.
function atMidnight() {
  const now = clockNow();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  setTimeout(() => {
    riftTick();
    atMidnight();
  }, Math.max(1000, midnight.getTime() - now + 500));
}

function riftTick() {
  const day = riftsModule.dayNumber(clockNow());
  if (day !== lastDay) {
    // A new day: yesterday's stumps grow back and new wild rifts open. The one Milo is inside
    // (and the rungs above it) stays until he leaves, so its seam and chest still answer.
    lastDay = day;
    const keep = new Set();
    for (let r = hereRift; r && !keep.has(r.id); r = r.parent ? riftIndex.get(r.parent) : null) keep.add(r.id);
    for (const [id, rift] of riftIndex) if (rift.kind === 'wild' && !keep.has(id)) riftIndex.delete(id);
    syncWildState();
    placesDirty();
  }
  riftLoop();
}

/**
 * One pass. `quiet`: before the first look at the crew (no snapshot yet), only draws the rifts the
 * state already knows. `boot`: launch's own pass; its news comes back as one line for the greeting.
 * Otherwise news becomes Milo's bubbles and the Gate Bell.
 */
function riftLoop({ boot = false, quiet = false } = {}) {
  if (!phase3) return null;
  clearTimeout(riftLoopTimer);
  riftLoopTimer = null;
  const before = state;
  const tierBefore = hearthTierNow();
  const result = safe(() => frontierModule.runRiftLoop({
    state, snapshot: quiet ? null : snapshot, now: clockNow(), content, riftgen, worldgen, isFree: isFreeTile, dryRun: quiet,
    phase4: phase4?.passes ?? null,
  }), null, 'rift loop');
  if (!result) return null;
  state = result.state;
  const previousIds = new Set(rifts.map(rift => rift.id));
  rifts = result.rifts;
  for (const rift of rifts) riftIndex.set(rift.id, rift);
  for (const seal of result.sealed) if (previousIds.has(seal.id)) worldCall('closeRift', seal.id, 'sealed');
  // A Nocturne the evening bell no longer covers wasn't mended: it drifts off like one let go.
  for (const gone of result.closed || []) if (previousIds.has(gone.id)) worldCall('closeRift', gone.id, 'let-go');
  pushRifts();
  const changed = state !== before;
  if (changed) scheduleSave();
  let line = null;
  // A rift that rings the bell is news enough: it isn't also announced as newly open.
  const bell = Array.isArray(result.bell) ? result.bell : [];
  if (boot) line = frontierModule.bootRiftLine({ sealed: result.sealed, opened: result.opened.filter(rift => !bell.includes(rift)) });
  else if (!quiet) {
    const messages = frontierModule.loopBubbles({
      opened: result.opened, sealed: result.sealed, bell, completed: result.completed, story: content?.story, state, warTable: hearthTierNow() >= 2,
    });
    for (const message of messages) queueBubble({ duration: ALERT_MS, ...message });
    ringBells(bell, result.notify, { bubble: false });
  }
  afterRiftLoop({ changed, tierChanged: hearthTierNow() !== tierBefore });
  return { line, bell: result.bell, notify: result.notify, closed: result.closed || [] };
}

// Hands the rifts and their echoes to the world, only when what it draws has changed.
function pushRifts() {
  const sig = frontierModule.riftsSignature(rifts);
  if (sig !== riftSig) {
    riftSig = sig;
    worldCall('setRifts', rifts);
    warMapCache = warMapCache ? { ...warMapCache, stale: true } : null;
  }
  const echoes = frontierModule.echoesFor(rifts);
  const esig = JSON.stringify(echoes);
  if (esig !== echoSig) {
    echoSig = esig;
    worldCall('setEchoes', echoes);
  }
}

// The Gate Bell: a bubble always (it's the bell at tier 1), and at tier 2 and up, with the bell on,
// one desktop note. The Gate Bell switch alone decides that note (Alerts is for finished tasks);
// main still sends nothing while MILO is in front. `bubble: false` when the loop's own bubbles
// already carry it.
function ringBells(bell = [], notify = false, { bubble = true } = {}) {
  for (const rift of bell || []) {
    const words = safe(() => riftsModule.bellText(rift), null, 'bellText') || { title: 'A rift is at the walls', body: rift.cause || '' };
    if (bubble) {
      queueBubble({
        kind: 'bell', title: words.title, lines: [words.body].filter(Boolean), duration: ALERT_MS,
        place: hearthTierNow() >= 2 ? 'war-table' : rift.id,
        actions: [{ id: 'show', label: 'Show me' }, { id: 'later', label: 'Later' }],
      });
    }
    if (notify && state.settings?.gateBell !== false) {
      Promise.resolve(bridge?.notify({ title: words.title, body: words.body, kind: 'gate-bell' })).catch(() => {});
    }
  }
}

function afterRiftLoop({ changed, tierChanged }) {
  if (tierChanged) { syncWildState(); renderPlaces(); }
  renderTracker();
  summarizeStatus();
  if (els.panel.hidden) return;
  const open = els.panel.dataset.place || '';
  if (open === 'watchtower' || open === 'war-table' || open.startsWith('rift:')
    || (changed && (open === 'hearth' || open === 'story'))) refreshPanel({ passive: true });
}

// ---------------------------------------------------------------------------
// Where Milo is.

function applyArea(info) {
  if (!isObj(info)) return;
  const previous = areaInfo.area;
  areaInfo = { ...info, area: ['vale', 'wilds', 'elsewhere'].includes(info.area) ? info.area : 'vale' };
  els.stage.dataset.area = areaInfo.area;
  if (areaInfo.regionId) els.stage.dataset.region = String(areaInfo.regionId);
  else delete els.stage.dataset.region;
  els.canvas.setAttribute('aria-label', frontierModule.areaLabel(areaInfo));
  renderBanner();
  if (previous !== areaInfo.area) {
    if (previous === 'elsewhere') {
      stitchedHere.clear();
      hereRift = null;
    }
    renderPlaces();
    requestAnimationFrame(() => updateWorldInsets());
    const open = els.panel.hidden ? '' : els.panel.dataset.place || '';
    // A place's panel belongs to where Milo stood; the rift he just stepped into keeps its own.
    if (open.startsWith('lantern:') || open.startsWith('poi:')) closePanel();
    else if (open.startsWith('rift:')) refreshPanel();
  } else {
    placesDirty();
  }
  summarizeStatus();
  phase4?.emit('area', areaInfo);
}

// Chunks newly seen go on the map (the fog lifts), saved on the slow debounce.
function explore(keys) {
  if (!phase3 || !Array.isArray(keys) || !keys.length) return;
  const next = safe(() => modelModule.markExplored(state, keys), state, 'markExplored');
  if (next === state) return;
  state = next;
  scheduleSave(EXPLORE_SAVE_MS);
  if (mapIsOpen()) safe(() => mapView.refresh(), null, 'map refresh');
}

// ---------------------------------------------------------------------------
// The place list out in the wilds: what's in view, nearest first, and the way home.

const KIND_WORDS = { rift: 'Rift', stray: 'Stray', lantern: 'Lantern', poi: 'Nearby', tree: 'Tree', gate: 'Gate', echo: 'Echo', 'war-table': 'Defence', exit: 'Way out', stitch: 'The tear', 'tale-lead': 'Tale-lead', loot: 'Chest', curio: 'Curio' };

// An Elsewhere's layout, by its spec's id: riftgen lays it out the same way every time.
const layouts = new Map();
function elsewhereLayout(spec) {
  if (!spec?.id) return null;
  if (!layouts.has(spec.id)) {
    if (layouts.size > 12) layouts.clear();
    layouts.set(spec.id, safe(() => riftgen.layout(spec), null, 'layout'));
  }
  return layouts.get(spec.id);
}

function nearbyEntries() {
  const list = worldCall('nearbyEntities');
  const tile = worldCall('miloTile');
  let entities = (Array.isArray(list) ? list : []).filter(entity => entity && typeof entity.id === 'string');
  if (areaInfo.area === 'elsewhere') {
    // A pocket world is small: the tear, the chests and the way home are listed wherever they are.
    // The engine lists its own things (world.elsewhereEntities); without that list, riftgen's
    // layout of the same Elsewhere stands in.
    let marks = typeof world?.elsewhereEntities === 'function' ? frontierModule.engineLandmarks(worldCall('elsewhereEntities')) : null;
    if (!marks) {
      const rift = currentElsewhereRift();
      const spec = rift?.spec;
      const stitched = Boolean(rift) && (stitchedHere.has(rift.id) || (rift.kind === 'wild' && state.rifts?.closedWild?.[rift.id] === riftsModule.dayNumber(clockNow())));
      marks = spec ? frontierModule.elsewhereLandmarks(spec, elsewhereLayout(spec), { stitched, refused: rift.kind === 'real', opened: Boolean(state.rifts?.visited?.[spec.id]) }) : [];
    }
    entities = frontierModule.elsewhereEntries(marks, entities, tile);
  }
  return entities.slice(0, NEARBY_MAX).map(entity => {
    const steps = tile && Number.isFinite(entity.x) ? Math.max(Math.abs(entity.x - tile.x), Math.abs(entity.y - tile.y)) : null;
    const note = steps === null ? KIND_WORDS[entity.kind] || '' : steps <= 1 ? 'Here' : `${steps} tiles`;
    return { id: entity.id, kind: entity.kind, label: startName(entity.label || KIND_WORDS[entity.kind] || 'Something'), note };
  });
}

const placesVisible = () => els.places.dataset.open === 'true' || els.places.contains(document.activeElement);

// A press on the list holds its buttons still until the click lands.
let placesPressed = false;
els.placeList.addEventListener('pointerdown', () => { placesPressed = true; });
window.addEventListener('pointerup', () => setTimeout(() => { placesPressed = false; }, 0), true);

function placesDirty() {
  placesStale = true;
  if (placesTimer) return;
  placesTimer = setTimeout(() => {
    placesTimer = null;
    if (placesPressed) { placesDirty(); return; }
    if (placesStale && placesVisible()) renderPlaces();
  }, PLACES_THROTTLE_MS);
}

async function goToEntity(id) {
  if (id === 'home') { travel('home'); return; }
  if (id === 'leave') { leaveElsewhere(); return; }
  if (id.startsWith('gate:') && areaInfo.area === 'vale') { walkOutGate(id); return; }
  const walking = await Promise.resolve(worldCall('walkToEntity', id)).catch(() => false);
  if (walking === false) {
    queueBubble({ kind: 'note', title: 'I can’t find a way there', lines: ['Something’s in the way. Try another path.'], duration: 4000, actions: [{ id: 'later', label: 'Okay' }] });
  }
}

// From the vale's place list: Milo walks out through a gate to the first tile of its road.
async function walkOutGate(id) {
  const gate = frontierModule.gateEntries(anchors, worldgenModule.GATES).find(entry => entry.id === id);
  if (!gate?.out) return;
  const walking = await Promise.resolve(worldCall('walkTo', gate.out)).catch(() => false);
  if (walking === false) {
    queueBubble({ kind: 'note', title: 'I can’t find a way there', lines: ['Something’s in the way. Try another path.'], duration: 4000, actions: [{ id: 'later', label: 'Okay' }] });
    return;
  }
  // Out past the gate, the arrow keys walk him on (focus left in the list lands on the world).
  const active = document.activeElement;
  if (!active || active === document.body || els.placeList.contains(active)) els.canvas.focus({ preventScroll: true });
}

// After a move that took away what had keyboard focus (a place-list entry, the banner's Leave),
// focus rests on the world rather than the page's body.
function keepFocusInWorld() {
  const active = document.activeElement;
  if (!active || active === document.body || !active.isConnected) els.canvas.focus({ preventScroll: true });
}

async function travel(target) {
  if (mapIsOpen()) closeMap();
  if (!els.panel.hidden && /^(lantern|poi):/.test(els.panel.dataset.place || '')) closePanel();
  try {
    // The lanterns are in the world: from inside an Elsewhere (the map is open there too), Milo
    // steps back out first.
    if (areaInfo.area === 'elsewhere') await leaveElsewhere();
    await Promise.resolve(worldCall('travelTo', target));
  } catch (error) {
    console.warn('[MILO] travel failed:', error.message);
  }
  renderPlaces();
  keepFocusInWorld();
}

// `keep`: the open panel stays (another rift's, which Milo can set off for once he's out).
async function leaveElsewhere({ keep = false } = {}) {
  // Mid-fight, Leave is Head home: the Hooklight takes everyone out at the end of the tick, and nothing is lost.
  if (phase4?.fight?.live?.()) { await Promise.resolve(phase4.fight.command({ t: 'head-home' })); return; }
  if (!keep && !els.panel.hidden && (els.panel.dataset.place || '').startsWith('rift:')) closePanel();
  try {
    await Promise.resolve(worldCall('leaveElsewhere'));
  } catch (error) {
    console.warn('[MILO] leaving failed:', error.message);
  }
  await outOfPocket();
  if (keep && !els.panel.hidden) {
    // Keyboard focus that was on Leave moves on to the way in.
    const within = els.panel.contains(document.activeElement);
    const kept = riftFor(els.panel.dataset.place || '');
    refreshPanel({ focus: within && kept ? (kept.bright ? 'panel-visit' : 'panel-step') : null });
  }
  keepFocusInWorld();
}

// Is the ground round a rift closed in (a meadow walled by water or rock that no road reaches)?
// Then no walk gets there, and the tear reaches for Milo instead.
const STEPS = [[0, 1], [-1, 0], [1, 0], [0, -1]];
const closedIn = rift => Number.isFinite(rift?.x) && !STEPS.some(([dx, dy]) => isFreeTile(rift.x + dx, rift.y + dy));

// Back out of an Elsewhere by a rift whose ground is closed in: Milo comes out on the nearest open
// ground instead (a calm fade), so he's never left somewhere no road reaches.
async function outOfPocket() {
  if (!phase3 || worldCall('area')?.area !== 'wilds') return;
  const tile = worldCall('miloTile');
  if (!tile || !Number.isFinite(tile.x) || isFreeTile(tile.x, tile.y)) return;
  for (let r = 1; r <= 24; r += 1) {
    const ring = [];
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) ring.push({ x: tile.x + dx, y: tile.y + dy });
    }
    ring.sort((a, b) => Math.hypot(a.x - tile.x, a.y - tile.y) - Math.hypot(b.x - tile.x, b.y - tile.y));
    const open = ring.find(spot => isFreeTile(spot.x, spot.y));
    if (open) {
      await travel(open);
      return;
    }
  }
  await travel('home');
}

// ---------------------------------------------------------------------------
// What happens when Milo arrives at something in the world.

function handleEntity(entity) {
  if (!phase3 || !isObj(entity) || typeof entity.id !== 'string') return;
  switch (entity.kind) {
    case 'rift': {
      const rift = riftFromEntity(entity);
      if (rift) openPanel(rift.id, { via: areaInfo.area === 'elsewhere' ? 'inside' : 'world' });
      break;
    }
    case 'echo': {
      const riftId = entity.riftId || entity.id.replace(/^echo:/, '');
      if (riftFor(riftId)) openPanel(riftId, { via: 'echo' });
      break;
    }
    case 'stray': strayBubble(entity); break;
    case 'lantern': openPanel(entity.id); break;
    case 'poi': openPanel(entity.id); break;
    case 'tree': chopTree(entity); break;
    case 'gate': gateBubble(entity); break;
    case 'war-table': if (hearthTierNow() >= 2) openPanel('war-table'); break;
    case 'exit': leaveElsewhere(); break;
    case 'stitch': {
      const rift = currentElsewhereRift();
      if (rift) openPanel(rift.id, { via: 'inside' });
      break;
    }
    case 'landmark': phase4?.landmarkClick(entity); break;
    case 'tale-lead': leadBubble(); break;
    case 'loot': claimElsewhereLoot(); break;
    case 'curio': curioBubble(); break;
    default: break;
  }
}

function riftFor(id) {
  if (typeof id !== 'string') return null;
  return rifts.find(rift => rift.id === id) || riftIndex.get(id) || (hereRift?.id === id ? hereRift : null);
}

// A rift the world knows by id: a real one, one met before, or today's wild rifts round the tile.
function riftFromEntity(entity) {
  const id = entity.riftId || entity.id;
  if (isObj(entity.rift) && entity.rift.spec) riftIndex.set(id, entity.rift);
  const known = riftFor(id);
  if (known) return known;
  if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y)) return null;
  const cx = Math.floor(entity.x / 32);
  const cy = Math.floor(entity.y / 32);
  const day = riftsModule.dayNumber(clockNow());
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const list = safe(() => riftsModule.wildRiftsForChunk({
      worldgen, riftgen, cx: cx + dx, cy: cy + dy, day, wardRadius: wardRadiusNow(), closed: state.rifts?.closedWild, isFree: isWalkableTile,
    }), [], 'wild rifts') || [];
    for (const rift of list) riftIndex.set(rift.id, rift);
    if (riftIndex.has(id)) return riftIndex.get(id);
  }
  return null;
}

function currentElsewhereRift() {
  const info = worldCall('elsewhere');
  return riftFor(info?.riftId || areaInfo.rift?.id || null);
}

function strayBubble(entity) {
  const match = /^stray:(rift:[0-9a-z]+):(\w+)$/.exec(entity.id);
  const rift = riftFor(entity.riftId || match?.[1]);
  const spec = rift?.spec;
  const lead = match?.[2] === 'lead';
  const kind = lead ? { name: spec?.taleLead?.name, temperament: 'proud' } : wildtextModule.strayOf(spec, Number(match?.[2]));
  const name = startName(kind?.name || entity.label || 'A stray');
  const line = wildtextModule.strayLine(kind, entity.id, content?.wilds) || 'It looks at you, then back at the tear.';
  const lines = [line];
  // Examining a stray always tells you the real cause.
  if (rift && rift.kind !== 'wild' && rift.cause) lines.push(rift.cause);
  queueBubble({
    kind: 'note', title: name, lines, duration: ALERT_MS, place: rift?.id,
    actions: rift ? [{ id: 'show', label: 'The rift' }, { id: 'later', label: 'Later' }] : [{ id: 'later', label: 'Okay' }],
  });
}

function gateBubble(entity) {
  const short = entity.gate || String(entity.id).replace(/^gate:/, '');
  const line = wildtextModule.pickLine(content?.wilds?.examine?.gate, entity.id);
  queueBubble({ kind: 'note', title: frontierModule.GATE_NAMES[short] || 'A gate', lines: [line].filter(Boolean), duration: ALERT_MS, actions: [{ id: 'later', label: 'Okay' }] });
}

function leadBubble() {
  const lead = currentElsewhereRift()?.spec?.taleLead;
  if (!lead) return;
  queueBubble({
    kind: 'note', title: startName(lead.name || 'The Tale-lead'),
    lines: [lead.line ? `“${lead.line}”` : '', lead.mechanic ? `It ${lead.mechanic}.` : ''].filter(Boolean),
    duration: ALERT_MS, actions: [{ id: 'later', label: 'Okay' }],
  });
}

function curioBubble() {
  const spec = currentElsewhereRift()?.spec;
  queueBubble({
    kind: 'note', title: 'A curio', lines: ['It hums quietly on its stand.', spec?.mood || ''].filter(Boolean),
    duration: ALERT_MS, actions: [{ id: 'later', label: 'Okay' }],
  });
}

const lootWords = loot => wildtextModule.lootItems(loot);

// What an Elsewhere's chests hold: logs seeded by the rift, the same whichever chest is opened.
const chestMaterials = spec => wildtextModule.lootFor(`${spec.id}:loot`, content?.wilds?.loot?.chest, 'elsewhere');
const hasChest = spec => (elsewhereLayout(spec)?.loot || []).length > 0;

/**
 * Claims an Elsewhere's gifts, once per rift (rifts.visited): the chest's logs, and a wild or story
 * rift's own loot with them (a real rift's own loot waits for the real thing to seal).
 * → the words for what was found, or null when it was claimed already.
 */
function claimElsewhere(rift, { chest = true } = {}) {
  const spec = rift?.spec;
  if (!spec?.id || state.rifts?.visited?.[spec.id]) return null;
  const materials = chest && hasChest(spec) ? chestMaterials(spec) : null;
  const lootSpec = rift.kind === 'real' ? { id: spec.id, loot: [] } : spec;
  const next = safe(() => riftsModule.claimLoot(state, lootSpec, clockNow(), { riftId: spec.id, materials }), state, 'claimLoot');
  if (next === state) return null;
  state = next;
  syncWildState();
  placesDirty();
  scheduleSave(400);
  if (!els.panel.hidden && els.panel.dataset.place === 'hearth') refreshPanel();
  return [...wildtextModule.materialItems(materials || {}), ...lootWords(lootSpec.loot)];
}

// A chest in an Elsewhere.
function claimElsewhereLoot() {
  const rift = currentElsewhereRift();
  if (!rift?.spec?.id) return;
  const found = claimElsewhere(rift);
  if (!found) {
    queueBubble({ kind: 'loot', title: 'An open chest', lines: ['What it held is already in your satchel.'], duration: 4000, actions: [{ id: 'later', label: 'Okay' }] });
    return;
  }
  queueBubble({ kind: 'loot', title: 'A chest in the Elsewhere', lines: [found.length ? `Inside: ${listWords(found)}.` : 'It was empty, but it’s a nice chest.'], duration: ALERT_MS, actions: [{ id: 'later', label: 'Nice' }] });
}

// Chopping: Milo walks over, faces the tree and swings; the logs go in the satchel.
async function chopTree(entity) {
  if (entity.felled || /stump/i.test(entity.label || '')) {
    const line = wildtextModule.pickLine(content?.wilds?.examine?.stump, entity.id);
    if (line) queueBubble({ kind: 'note', title: 'A stump', lines: [line], duration: 4000, actions: [{ id: 'later', label: 'Okay' }] });
    return;
  }
  if (chopping) return;
  chopping = entity.id;
  let result = null;
  try {
    result = await Promise.resolve(worldCall('chop', entity.id));
  } catch (error) {
    console.warn('[MILO] chopping failed:', error.message);
  } finally {
    chopping = null;
  }
  if (!result?.ok) return;
  const day = riftsModule.dayNumber(clockNow());
  const logs = wildtextModule.chopLogs(entity.id, result.kind || entity.wood || entity.kind, day);
  state = modelModule.addMaterials(state, { [logs.kind]: logs.amount });
  state = modelModule.markFelled(state, entity.id, day);
  worldCall('floatText', `+${logs.amount} ${logs.kind}`, { x: entity.x, y: entity.y });
  syncWildState();
  scheduleSave(400);
  if (!choppedWoods.has(logs.kind)) {
    choppedWoods.add(logs.kind);
    const line = wildtextModule.chopLine(logs.kind, entity.id, content?.wilds);
    queueBubble({ kind: 'loot', title: `${logs.amount} ${logs.kind} logs`, lines: [line].filter(Boolean), duration: 5000, actions: [{ id: 'later', label: 'Nice' }] });
  }
  if (!els.panel.hidden && els.panel.dataset.place === 'hearth') refreshPanel();
}

// ---------------------------------------------------------------------------
// Places in the wilds, looked up by id.

function fixedPoi(id) {
  if (!fixedById) {
    fixedById = new Map();
    for (const poi of safe(() => shellWilds.fixedPois(), [], 'fixedPois') || []) fixedById.set(poi.id, poi);
  }
  return fixedById.get(id) || null;
}

function poiInfo(id) {
  if (poiCache.has(id)) return poiCache.get(id);
  const parsed = wildtextModule.parseId(id);
  if (!parsed || parsed.kind === 'tree') return null;
  const poi = fixedPoi(id) || safe(() => shellWilds.poiAt(parsed.x, parsed.y), null, 'poiAt')
    || { id, type: parsed.type, x: parsed.x, y: parsed.y, name: parsed.type === 'lantern' ? 'A sleeping lantern' : 'Something in the wilds' };
  if (poiCache.size > 200) poiCache.clear();
  poiCache.set(id, poi);
  return poi;
}

const regionName = (x, y) => safe(() => worldgen.regionAt(x, y), '', 'regionAt') || '';

function lanternTitle(id) {
  const poi = poiInfo(id);
  const lit = Boolean(state.wilds?.lanterns?.[id]);
  if (poi?.region) return poi.name;
  return lit ? 'A lit lantern' : 'A sleeping lantern';
}

// Where a lit lantern is, for the travel list: its own name, or the land it stands in.
function lanternPlace(id) {
  const poi = poiInfo(id);
  if (!poi) return { name: 'A lantern', note: '' };
  if (poi.region) return { name: poi.name, note: 'Lit' };
  const land = regionName(poi.x, poi.y);
  return { name: land ? `A lantern in ${frontierModule.midName(land)}` : 'A lantern by the road', note: `${Math.round(Math.hypot(poi.x - 31.5, poi.y - 22))} tiles from home` };
}

// ---------------------------------------------------------------------------
// Panels: titles, bodies and pictures.

function phase3Title(id) {
  if (!phase3 || typeof id !== 'string') return '';
  if (id === 'hearth') return 'The Hearth';
  if (id === 'war-table') return 'War Table';
  if (id === 'story') return storyStatus()?.title || 'The Lantern Wakes';
  if (id.startsWith('rift:')) return riftFor(id)?.spec?.name || 'A rift';
  if (id.startsWith('lantern:')) return lanternTitle(id);
  if (id.startsWith('poi:')) {
    // The place's own words for itself, so an opened chest is called one.
    const poi = poiInfo(id);
    if (!poi) return 'Something in the wilds';
    return safe(() => wildtextModule.poiView(poi, content?.wilds, state).title, null, 'poiView') || poi.name || 'Something in the wilds';
  }
  return '';
}

function panelExists(id) {
  if (placeById(id)) return true;
  if (phase4?.panels.exists(id)) return true;
  if (!phase3 || typeof id !== 'string') return false;
  if (id === 'hearth' || id === 'story') return true;
  if (id === 'war-table') return hearthTierNow() >= 2;
  // A rift that's still standing; places in the wilds wait for Milo to walk back to them.
  if (id.startsWith('rift:')) return rifts.some(rift => rift.id === id);
  return false;
}

// Walking to a place is a vale thing. The War Table's dashboard opens from anywhere, no trek needed.
function walkToPlace(id) {
  if (phase3 && areaInfo.area !== 'vale') return;
  if (id === 'hearth') walkTo('camp');
  else if (placeById(id)) walkTo(id);
}

function resetRiftUi(id, via = null) {
  riftUi = { panelId: id, via: via || 'list', confirming: null, busy: false, note: null };
  if (id !== 'story') storyUi = { showLetter: false };
  if (id !== 'hearth') hearthNote = null;
}

function renderPhase3Panel(id) {
  if (typeof id !== 'string') return null;
  if (id === 'hearth') return renderHearth();
  if (id === 'war-table') return renderWarTable();
  if (id === 'story') return renderStory();
  if (id.startsWith('rift:')) return renderRift(id);
  if (id.startsWith('lantern:')) return renderLantern(id);
  if (id.startsWith('poi:')) return renderPoi(id);
  return null;
}

const milosLine = text => miloSays(text);

// A rift as a row in a list.
function riftRowView(rift) {
  return {
    id: rift.id, key: rift.key, kind: rift.kind, realKind: rift.realKind || null,
    name: rift.spec?.name || 'A rift', genres: frontierModule.genreChips(rift, genres),
    cause: rift.cause, where: frontierModule.riftWhere(rift, anchors),
    // A bright rift is a gift and a held one hasn't opened: their tags say so rather than a stage.
    stage: frontierModule.stageTag(rift), stageId: rift.warded?.stage || rift.stage,
    x: rift.held ? null : rift.x, y: rift.held ? null : rift.y,
    warded: Boolean(rift.warded), held: Boolean(rift.held), bright: Boolean(rift.bright), atWalls: Boolean(rift.atWalls),
    actions: frontierModule.rowActions(rift),
  };
}

function renderRiftSection() {
  const shown = rifts.filter(rift => rift.kind === 'real' || rift.kind === 'story');
  return panelsModule.riftSection(shown.map(riftRowView), { confirming: riftUi.panelId === 'watchtower' ? riftUi.confirming : null });
}

function renderRift(id) {
  const rift = riftFor(id);
  if (!rift) return '<p class="quiet-note">This rift has closed. The frontier is quieter for it.</p>';
  const spec = rift.spec || {};
  const inside = areaInfo.area === 'elsewhere' && currentElsewhereRift()?.id === rift.id;
  // Inside another rift's Elsewhere, Milo has to come out before he can set off for this one.
  const away = areaInfo.area === 'elsewhere' && !inside;
  const current = rift.kind === 'wild' || rift.kind === 'ladder' || rifts.some(r => r.id === rift.id);
  const stitched = stitchedHere.has(rift.id) || (rift.kind === 'wild' && state.rifts?.closedWild?.[rift.id] === riftsModule.dayNumber(clockNow()));
  const field = Boolean(phase4?.isFieldBoss(rift));
  let actions = current || inside ? frontierModule.riftActions(rift, { via: riftUi.via, inside, stitched, away, field }) : [];
  if (hearthTierNow() < 2) actions = actions.filter(action => action !== 'war-table');
  // A note from a walk out ("Milo sets off…") is for a rift still there: one that sealed on the
  // way says it closed.
  let says = current || inside ? riftUi.note : null;
  if (!says && away && current && !rift.held) says = awayWords();
  else if (!says && inside && rift.kind === 'real') says = `The seam won’t take the thread. ${rift.stitch}`;
  else if (!says && inside && stitched) says = rift.kind === 'story' ? 'Mended. The page lies flat again past the north gate.' : 'Mended. There’s another rift beneath this one, deeper, if you want to go on.';
  else if (!says && riftUi.via === 'echo' && current) says = 'This is its echo in the vale. The rift itself is out past the walls.';
  else if (!says && !current && !inside) says = 'This rift has closed.';
  // The Tale-lead steps out beside the tear once the rift gapes (the stage it shows, so a ward
  // holds it back too), and waits in the farthest room of its Elsewhere either way.
  const shownStage = rift.warded?.stage || rift.stage;
  const lead = isObj(spec.taleLead) && spec.taleLead.name
    ? { name: spec.taleLead.name, mechanic: spec.taleLead.mechanic, line: spec.taleLead.line, where: inside ? 'inside' : shownStage === 'gaping' ? 'out' : 'waiting' }
    : null;
  // Inside a wild or story rift, Milo has already stepped through: the seam is what's left, and
  // once it's stitched there's nothing more to mend. A real rift mends out in the real world.
  const stitch = inside && rift.kind !== 'real' ? (stitched ? '' : 'Stitch the seam from in here.') : rift.stitch;
  // A wild or story rift gives its gifts from its chest or its seam, and a bright one on a visit;
  // a real one's wait for the real thing to be done.
  const visited = state.rifts?.visited || {};
  const lootTaken = (rift.kind !== 'real' || Boolean(rift.bright)) && Boolean(visited[spec.id] || visited[rift.id]);
  return panelsModule.riftPanel({
    id: rift.id, kind: rift.kind, realKind: rift.realKind || null, name: spec.name || 'A rift',
    genres: frontierModule.genreChips(rift, genres), stage: frontierModule.stageTag(rift), stageId: rift.warded?.stage || rift.stage,
    kindWord: frontierModule.kindTag(rift),
    where: inside || rift.held ? '' : frontierModule.riftWhere(rift, anchors), cause: rift.cause, stitch, mood: spec.mood,
    wardText: frontierModule.wardUntilText(rift, clockNow()), held: frontierModule.heldRule(rift),
    affixes: Array.isArray(spec.affixes) ? spec.affixes : [], lead, loot: Array.isArray(spec.loot) ? spec.loot : [], lootTaken,
    actions, confirming: riftUi.confirming === rift.id, says, inside, busy: riftUi.busy,
    level: inside ? null : phase4?.suggestedLevel(rift) || null, costs: phase4?.costsFor(rift) || null,
    artLabel: `Pixel drawing of ${spec.name ? frontierModule.midName(spec.name) : 'the rift'}, a ${String(rift.stage || 'open')} tear${spec.strays?.length && rift.stage !== 'hairline' ? ' with its strays' : ''}`,
  }, { miloSays: milosLine });
}

function bellSettings() {
  const bell = Object.hasOwn(state.settings || {}, 'eveningBell') ? state.settings.eveningBell : '22:00';
  return {
    gateBell: state.settings?.gateBell !== false,
    wardPost: state.settings?.wardPost || '',
    eveningBell: bell || '',
    bellOptions: frontierModule.eveningBellOptions(bell || ''),
    rules: riftsModule.WARD_POST_RULES.map(rule => ({ id: rule.id, name: rule.name, text: rule.text })),
  };
}

function renderWarTable() {
  if (hearthTierNow() < 2) return '<p class="quiet-note">The War Table comes with the Stockade.</p>';
  const groups = frontierModule.warGroups(rifts, state, clockNow()).map(group => (group.rifts
    ? { id: group.id, title: group.title, rows: group.rifts.map(riftRowView) }
    : { id: group.id, title: group.title, closed: group.closed.map(entry => ({ ...entry, genres: (entry.genres || []).map(g => genres.get(g) || { id: g, name: g, rim: '#9cbfdc' }) })) }));
  const placed = rifts.filter(rift => !rift.held && Number.isFinite(rift.x));
  return panelsModule.warTablePanel({
    groups,
    // Everything the frontier map draws, so a background refresh repaints it only when it changes.
    mapKey: `${wardRadiusNow()}:${valeVersion}:${frontierModule.riftsSignature(placed)}`,
    confirming: riftUi.panelId === 'war-table' ? riftUi.confirming : null,
    mapLabel: placed.length ? `The frontier round the vale, with ${placed.length} ${placed.length === 1 ? 'rift' : 'rifts'} on it` : 'The frontier round the vale, with no rifts on it',
    settings: bellSettings(),
  });
}

function satchelView() {
  const satchel = isObj(state.satchel) ? state.satchel : {};
  const essences = Object.entries(isObj(satchel.essences) ? satchel.essences : {}).map(([name, qty]) => ({ name, qty, genre: satchel.essenceGenres?.[name] || null }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name)).slice(0, 24);
  const relics = (Array.isArray(satchel.relics) ? satchel.relics : []).slice(-6).reverse();
  return { materials: satchel.materials || {}, essences, relics };
}

function renderHearth() {
  const status = hearthStatusNow();
  // No plans for this tier: never "as high as it goes" when the plans are what's missing.
  if (!status?.def) return '<p class="quiet-note">The Hearth’s plans aren’t unpacked yet.</p>';
  const def = status.def || {};
  let reason = hearthNote;
  if (!reason && status.next && !status.next.ready) {
    reason = safe(() => hearthModule.raiseHearth(state, content?.fortress, clockNow()).reason, '', 'raiseHearth');
  }
  let html = panelsModule.hearthPanel({
    tier: status.tier, name: def.name || 'The Camp', look: def.look || '', ward: status.wardRadius,
    defences: Array.isArray(def.defences) ? def.defences : [], next: status.next, satchel: satchelView(), reason,
  });
  // Every count MILO can keep is a real one; when the next tier asks only for what arrives later,
  // there's nothing counted to vouch for.
  const counted = (status.next?.requirements || []).some(r => !r.future);
  html += `<p class="privacy-note"><button type="button" class="link-btn" data-action="story-open">The story so far</button>${counted ? ' · Every count here is real: sessions MILO watched finish, buildings designed and days you’ve spent with MILO.' : ''}</p>`;
  return html;
}

function renderStory() {
  const status = storyStatus();
  if (!status) return '<p class="quiet-note">The story isn’t unpacked yet.</p>';
  const letter = content?.story?.letters?.oriel || null;
  const letterStep = status.steps.find(step => step.id === 'letter');
  return panelsModule.storyPanel({
    title: status.title, steps: status.steps, doneCount: status.steps.filter(step => step.done).length,
    letter: letter && Array.isArray(letter.lines) ? letter : null,
    showLetter: storyUi.showLetter, letterRead: Boolean(letterStep?.done),
  });
}

function renderLantern(id) {
  const poi = poiInfo(id);
  if (!poi) return '<p class="quiet-note">Milo can’t find that lantern.</p>';
  const view = wildtextModule.lanternView(poi, content?.wilds, state);
  const travelTo = wildtextModule.travelChoices(state.wilds?.lanterns, { here: id, wake: state.wilds?.wake, place: lanternPlace });
  const says = poiResults.get(id)?.[0] || '';
  // Never the same sentence twice, one under the other.
  const lines = view.lines.filter(line => line !== says);
  return panelsModule.lanternPanel({ id, title: view.title, lines, lit: view.lit, wake: view.wake, travel: travelTo, says }, { miloSays: milosLine });
}

function renderPoi(id) {
  const poi = poiInfo(id);
  if (!poi) return '<p class="quiet-note">Milo can’t find that place.</p>';
  const hour = new Date(clockNow()).getHours();
  const region = poi.region || safe(() => shellWilds.hushRegion(poi.x, poi.y)?.id, null, 'hushRegion');
  const result = poiResults.get(id) || [];
  const view = wildtextModule.poiView(poi, content?.wilds, state, { regionId: region, night: hour >= 20 || hour < 6, fresh: result.length > 0, phase4World: Boolean(phase4?.doors), economy: content?.economy });
  return panelsModule.poiPanel({ id, type: poi.type, title: view.title, lines: view.lines, body: view.body, action: view.action, done: view.done, later: view.later, says: result[0] || '', result: result.slice(1) }, { miloSays: milosLine });
}

// ---------------------------------------------------------------------------
// Panel pictures: rifts, lanterns and places, the Hearth, and the War Table's map.

// The whole-pixel scale a picture is drawn at to fit its frame (`inset`: the frame's padding).
function artScale(canvas, img, { tall = 160, most = 4, inset = 16 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const wide = Math.max(64, (canvas.parentElement?.clientWidth || 320) - inset) * dpr;
  return clamp(Math.floor(Math.min(wide / img.width, (tall * dpr) / img.height)), 1, Math.max(1, Math.round(most * dpr)));
}

function drawImage(canvas, img, { tall = 160, most = 4, scale = null } = {}) {
  if (!img || !img.width || !img.height) return false;
  const dpr = window.devicePixelRatio || 1;
  const k = scale || artScale(canvas, img, { tall, most });
  canvas.width = img.width * k;
  canvas.height = img.height * k;
  canvas.style.width = `${(img.width * k) / dpr}px`;
  canvas.style.height = `${(img.height * k) / dpr}px`;
  const source = document.createElement('canvas');
  source.width = img.width;
  source.height = img.height;
  source.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  canvas.dataset.pixel = String(k);
  return true;
}

// A rift's picture has only four shimmer frames, so each is composed once and kept.
const riftScenes = new Map();
function paintRiftCanvas(canvas, t = null) {
  const rift = riftFor(canvas.dataset.riftId);
  if (!rift) return false;
  const frame = t === null ? 0 : panelartModule.riftFrame(t, rift);
  const key = `${rift.id}:${rift.warded?.stage || rift.stage}:${rift.warded ? 1 : 0}:${frame}`;
  let img = riftScenes.get(key);
  if (!img) {
    img = safe(() => panelartModule.riftScene(rift, { genres: content?.genres, words: content?.riftgen, frame }), null, 'rift picture');
    if (riftScenes.size > 48) riftScenes.clear();
    if (img) riftScenes.set(key, img);
  }
  return drawImage(canvas, img, { tall: 170 });
}

function paintScenes() {
  stopSceneTimer();
  if (!panelartModule) return;
  for (const canvas of els.panelBody.querySelectorAll('canvas[data-scene]')) {
    let ok = false;
    const scene = canvas.dataset.scene;
    if (scene === 'rift') ok = paintRiftCanvas(canvas, motionOn() ? performance.now() : null);
    else if (scene === 'poi') {
      const poi = poiInfo(canvas.dataset.poi);
      const opened = Boolean(state.wilds?.opened?.[canvas.dataset.poi]);
      const lit = Boolean(state.wilds?.lanterns?.[canvas.dataset.poi]);
      // Painted on the ground it stands on, as the world draws it (a bleed's, the Hush's, grass or
      // water), and as wide as its frame, so the frame shows that ground edge to edge.
      const ground = poiGround(poi);
      const scene = safe(() => panelartModule.poiScene(poi, { opened, lit, ...ground }), null, 'place picture');
      if (scene) {
        const k = artScale(canvas, scene, { tall: 130, inset: 0 });
        const frame = (canvas.parentElement?.clientWidth || 320) * (window.devicePixelRatio || 1);
        const wide = safe(() => panelartModule.poiScene(poi, { opened, lit, ...ground, w: Math.ceil(frame / k) }), null, 'place picture');
        ok = drawImage(canvas, wide || scene, { scale: k });
      }
    } else if (scene === 'hearth') ok = drawImage(canvas, safe(() => panelartModule.hearthScene(hearthTierNow()), null, 'hearth picture'), { tall: 180 });
    else if (scene === 'war-map') ok = paintWarMap(canvas);
    if (!ok) canvas.closest('figure')?.remove();
  }
  // A rift's tear shimmers slowly while its panel is open (still with motion off).
  const tear = els.panelBody.querySelector('canvas[data-scene="rift"]');
  if (tear && motionOn()) {
    sceneTimer = setInterval(() => {
      if (!tear.isConnected) { stopSceneTimer(); return; }
      if (!document.hidden) paintRiftCanvas(tear, performance.now());
    }, 280);
  }
}

function stopSceneTimer() {
  clearInterval(sceneTimer);
  sceneTimer = null;
}

// What a place in the wilds stands on: the Hush there (0 to 255), and the genre of a rift's bleed
// over it (the rifts standing near it, real ones first and then today's wild ones, as the world
// lists them). → { hush, genre, genres }
function poiGround(poi) {
  if (!poi || !Number.isFinite(poi.x) || !Number.isFinite(poi.y)) return {};
  const hush = safe(() => shellWilds?.hushAt(poi.x, poi.y), 0, 'hushAt') || 0;
  const near = rift => !rift.held && Number.isFinite(rift.x) && Math.abs(rift.x - poi.x) <= 24 && Math.abs(rift.y - poi.y) <= 24;
  const nearby = rifts.filter(near);
  const day = riftsModule.dayNumber(clockNow());
  const cx = Math.floor(poi.x / 32);
  const cy = Math.floor(poi.y / 32);
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const wild = safe(() => riftsModule.wildRiftsForChunk({
        worldgen, riftgen, cx: cx + dx, cy: cy + dy, day, wardRadius: wardRadiusNow(), closed: state.rifts?.closedWild, isFree: isWalkableTile,
      }), [], 'wild rifts') || [];
      nearby.push(...wild.filter(near));
    }
  }
  const genre = panelartModule.bleedGenreAt ? safe(() => panelartModule.bleedGenreAt(nearby, poi.x, poi.y, { genres: content?.genres }), null, 'bleed') : null;
  return { hush, genre, genres: content?.genres };
}

// The frontier map: the land round the vale (painted once, in idle time), the vale itself, the
// Hearthward's ring and the rifts. `s` px a tile (1, 2 or 4, so the vale's 16 px tiles reduce
// evenly); the land painted is as wide as the frame, so the map fills it edge to edge with land
// and water rather than a flat fill either side.
function paintWarMap(canvas) {
  if (!wildsartModule || !shellWilds) return false;
  const dpr = window.devicePixelRatio || 1;
  const k = Math.max(1, Math.round(dpr));
  const frame = Math.max(160, canvas.parentElement?.clientWidth || 340) * dpr; // device px across
  const ward = wardRadiusNow();
  const nextWard = hearthStatusNow()?.next ? (content?.fortress?.tiers || []).find(t => t.tier === hearthTierNow() + 1)?.wardRadius ?? null : null;
  const reach = Math.max(ward + 14, ...rifts.filter(r => !r.held && Number.isFinite(r.x)).map(r => worldgen.heartDistance(r.x, r.y) + 5));
  const R = clamp(Math.ceil(reach), 18, 80);
  const fit = Math.floor(frame / ((64 + 2 * R) * k));
  const s = fit >= 4 ? 4 : fit >= 2 ? 2 : 1;
  const w = Math.max(64 + 2 * R, Math.ceil(frame / (s * k)));
  const h = 44 + 2 * R;
  const x0 = -Math.floor((w - 64) / 2);
  const y0 = -R;
  const key = `${x0},${y0},${w},${h},${s},${state.wilds?.seed}`;
  canvas.width = w * s * k;
  canvas.height = h * s * k;
  canvas.style.width = `${(w * s * k) / dpr}px`;
  canvas.style.height = `${(h * s * k) / dpr}px`;
  const draw = () => {
    if (!canvas.isConnected || !warMapCache || warMapCache.key !== key) return;
    const img = { width: warMapCache.width, height: warMapCache.height, data: new Uint8ClampedArray(warMapCache.rgba) };
    panelartModule.frontierOverlay(img, { x0, y0, s, ward, nextWard, rifts, genres, heartDistance: worldgen.heartDistance });
    const source = document.createElement('canvas');
    source.width = img.width;
    source.height = img.height;
    const sctx = source.getContext('2d');
    sctx.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    // The vale itself, from its own map: each block its most common colour, crisp like the land
    // round it (the map view reduces it the same way).
    const vale = warVale(s);
    if (vale) {
      sctx.imageSmoothingEnabled = false;
      sctx.drawImage(vale, -x0 * s, -y0 * s);
    }
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    canvas.dataset.pixel = String(s * k);
  };
  if (warMapCache && warMapCache.key === key) draw();
  else {
    idle(() => {
      if (!canvas.isConnected) return;
      const painted = safe(() => {
        const region = wildsartModule.paintRegion({ terrainAt: wildTerrain }, x0, y0, w, h, s);
        calmRivers(region.keys, region.width, { x0, y0, w, h, s });
        return { key, width: region.width, height: region.height, rgba: wildsartModule.colourise(region.keys, region.width, region.height, wildsartModule.basePaletteByCode()) };
      }, null, 'frontier map');
      if (painted) { warMapCache = painted; draw(); }
    });
  }
  return true;
}

// A few pixels a tile is too few for a river's foam glints: they read as white static, so here
// rivers are plain water.
function calmRivers(keys, width, { x0, y0, w, h, s }) {
  const river = worldgenModule.TERRAIN?.RIVER;
  if (river === undefined) return;
  const foam = 'f'.charCodeAt(0);
  const water = 'w'.charCodeAt(0);
  for (let j = 0; j < h; j += 1) {
    for (let i = 0; i < w; i += 1) {
      if (wildTerrain(x0 + i, y0 + j) !== river) continue;
      for (let sy = 0; sy < s; sy += 1) {
        for (let sx = 0; sx < s; sx += 1) {
          const p = (j * s + sy) * width + i * s + sx;
          if (keys[p] === foam) keys[p] = water;
        }
      }
    }
  }
}

// The vale at s px a tile for the War Table, reduced from its 16 px map by each block's most
// common colour (never smoothed into a blur), kept until the vale is redrawn.
let warValeCache = null;
function warVale(s) {
  const source = valePicture();
  if (!source || !source.width) return null;
  if (warValeCache && warValeCache.source === source && warValeCache.s === s) return warValeCache.image;
  const image = safe(() => {
    const factor = Math.max(1, Math.round(source.width / (64 * s)));
    const data = source.getContext('2d').getImageData(0, 0, source.width, source.height).data;
    let reduced = mapviewModule?.downscaleMode ? mapviewModule.downscaleMode(data, source.width, source.height, factor) : null;
    if (!reduced) {
      // Without the map view's reducer, the centre pixel of each block (still crisp).
      const w = Math.floor(source.width / factor);
      const h = Math.floor(source.height / factor);
      const out = new Uint8ClampedArray(w * h * 4);
      const half = Math.floor(factor / 2);
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const from = ((y * factor + half) * source.width + x * factor + half) * 4;
          out.set(data.subarray(from, from + 4), (y * w + x) * 4);
        }
      }
      reduced = { data: out, width: w, height: h };
    }
    const small = document.createElement('canvas');
    small.width = reduced.width;
    small.height = reduced.height;
    small.getContext('2d').putImageData(new ImageData(reduced.data, reduced.width, reduced.height), 0, 0);
    return small;
  }, null, 'the vale for the War Table');
  warValeCache = image ? { source, s, image } : null;
  return image;
}

// ---------------------------------------------------------------------------
// Actions in the Phase 3 panels. Returns true when the button was one of these.

function handlePhase3Action(button) {
  const action = button.dataset.action;
  const riftId = button.dataset.riftId;
  const rift = riftId ? riftFor(riftId) : null;
  const open = els.panel.dataset.place || '';
  switch (action) {
    case 'rift-open': if (rift) openPanel(rift.id, { via: 'list' }); return true;
    case 'rift-step': if (rift) stepThrough(rift); return true;
    case 'rift-visit': if (rift) visitBright(rift); return true;
    case 'rift-challenge': if (rift) challengeRift(rift); return true;
    case 'rift-show': if (rift) openMap({ x: rift.x, y: rift.y }, rift.id); return true;
    case 'rift-ward': if (rift) wardAction(rift, true); return true;
    case 'rift-unward': if (rift) wardAction(rift, false); return true;
    case 'rift-let-go':
      if (rift) { riftUi.confirming = rift.id; refreshPanel({ focus: `letgo-no-${rift.id}` }); }
      return true;
    case 'rift-let-go-cancel':
      riftUi.confirming = null;
      refreshPanel({ focus: open.startsWith('rift:') ? 'panel-let-go' : `let-go-${riftId}` });
      return true;
    case 'rift-let-go-confirm': if (rift) letGoAction(rift); return true;
    case 'rift-let-be': if (rift) letBeAction(rift); return true;
    case 'rift-stitch': if (rift) stitchInside(rift); return true;
    case 'rift-deeper': if (rift) goDeeper(rift); return true;
    // From another rift's panel, Leave keeps that panel open, so Step through is one click away.
    case 'rift-leave': leaveElsewhere({ keep: Boolean(rift) && awayFrom(rift) }); return true;
    case 'rift-war-table': openPanel('war-table'); return true;
    case 'raise': raiseAction(); return true;
    case 'light': lightAction(open); return true;
    case 'rest': restAction(open); return true;
    case 'travel': travel(button.dataset.target === 'home' ? 'home' : button.dataset.target); return true;
    case 'poi-open': chestAction(open); return true;
    case 'poi-enter-cave': enterCaveAction(open); return true;
    case 'poi-search': ruinAction(open); return true;
    case 'poi-read': noteAction(open); return true;
    case 'poi-listen': statueAction(open); return true;
    case 'letter-read': readLetterAction(); return true;
    case 'story-open': openPanel('story'); return true;
    default: return false;
  }
}

// A rift as the world's entity, so Milo can set off for one far outside the view.
const riftEntity = rift => ({ kind: 'rift', id: rift.id, riftId: rift.id, x: rift.x, y: rift.y, label: rift.spec?.name || 'A rift' });

function nearTile(target) {
  const tile = worldCall('miloTile');
  return Boolean(tile) && Number.isFinite(target?.x) && Math.max(Math.abs(tile.x - target.x), Math.abs(tile.y - target.y)) <= 1;
}

// Milo is inside one rift's Elsewhere and the panel is another rift's.
const awayFrom = rift => areaInfo.area === 'elsewhere' && currentElsewhereRift()?.id !== rift?.id;

// Still there once Milo has walked out to it: not sealed, faded, let go, or yesterday's.
const stillStanding = rift => frontierModule.stillStanding(rift, {
  standing: rifts, known: riftIndex, closedWild: state.rifts?.closedWild, day: riftsModule.dayNumber(clockNow()),
});
function awayWords() {
  const here = currentElsewhereRift()?.spec?.name;
  return `Milo is inside ${here ? frontierModule.midName(here) : 'another rift’s Elsewhere'} just now. Leave it first, then he can set off for this one.`;
}

// Step through: walk out to the rift if Milo isn't beside it, then into its Elsewhere.
async function stepThrough(rift) {
  if (riftUi.busy || !Number.isFinite(rift.x)) return;
  // The world's tiles aren't the pocket's: from inside another Elsewhere no walk reaches it.
  if (awayFrom(rift)) { riftUi.note = awayWords(); refreshPanel(); return; }
  const panelId = els.panel.dataset.place;
  riftUi.busy = true;
  const walled = !nearTile(rift) && closedIn(rift);
  riftUi.note = nearTile(rift) || walled ? null : 'Milo sets off for the rift.';
  refreshPanel({ focus: null });
  try {
    if (walled) {
      queueBubble({
        kind: 'note', title: 'No road reaches it', lines: ['The ground round this rift is closed in, so the tear reaches out for Milo instead.'],
        duration: 5000, actions: [{ id: 'later', label: 'Okay' }],
      });
    } else if (!nearTile(rift)) {
      const arrived = await Promise.resolve(worldCall('walkToEntity', riftEntity(rift)));
      if (arrived === false) {
        riftUi.note = 'Milo couldn’t find a way to it just now.';
        return;
      }
    }
    // It may have closed while he walked (sealed, let go, or a new day's wilds): then there's no
    // tear to step into, and the panel says it closed.
    if (!stillStanding(rift)) {
      riftUi.note = null;
      return;
    }
    riftIndex.set(rift.id, rift);
    riftUi.note = null;
    hereRift = rift;
    // With Phase 4 the door spends its Embers first, then opens the fight-ready Elsewhere.
    const entered = phase4?.doors
      ? (await phase4.doors.stepThrough(rift, { standing: () => stillStanding(rift) })).ok
      : await Promise.resolve(worldCall('enterElsewhere', rift));
    if (entered === false && areaInfo.area !== 'elsewhere') hereRift = null;
    if (areaInfo.area === 'elsewhere' && !els.panel.hidden && els.panel.dataset.place === panelId) closePanel();
  } catch (error) {
    console.warn('[MILO] stepping through failed:', error.message);
    if (areaInfo.area !== 'elsewhere') hereRift = null;
    riftUi.note = 'The tear wouldn’t open for Milo just now.';
  } finally {
    riftUi.busy = false;
    if (!els.panel.hidden && els.panel.dataset.place === panelId) refreshPanel();
  }
}

// Challenge a field boss: walk out beside its rift, then the door spends the Embers and the fight starts.
async function challengeRift(rift) {
  if (riftUi.busy || !phase4?.doors || !Number.isFinite(rift.x)) return;
  if (areaInfo.area !== 'vale' && areaInfo.area !== 'wilds') { riftUi.note = awayWords(); refreshPanel(); return; }
  const panelId = els.panel.dataset.place;
  riftUi.busy = true;
  refreshPanel({ focus: null });
  try {
    if (!nearTile(rift)) {
      const arrived = await Promise.resolve(worldCall('walkToEntity', riftEntity(rift)));
      if (arrived === false) { riftUi.note = 'Milo couldn’t find a way to it just now.'; return; }
    }
    if (!stillStanding(rift)) { riftUi.note = null; return; }
    riftIndex.set(rift.id, rift);
    riftUi.note = null;
    const r = await phase4.doors.challenge(rift);
    if (r?.ok && !els.panel.hidden && els.panel.dataset.place === panelId) closePanel();
  } catch (error) {
    console.warn('[MILO] a challenge failed:', error.message);
    riftUi.note = 'The challenge wouldn’t start just now.';
  } finally {
    riftUi.busy = false;
    if (!els.panel.hidden && els.panel.dataset.place === panelId) refreshPanel();
  }
}

// A cave's mouth: walk to it, then the door spends its Embers and the cave opens.
async function enterCaveAction(id) {
  const poi = poiInfo(id);
  if (!poi || riftUi.busy || !phase4?.doors) return;
  riftUi.busy = true;
  try {
    if (!nearTile(poi)) {
      const arrived = await Promise.resolve(worldCall('walkToEntity', { kind: 'poi', id: poi.id || id, x: poi.x, y: poi.y, label: poi.name || 'a cave' }));
      if (arrived === false) { poiResults.set(id, ['Milo couldn’t find a way to it just now.']); return; }
    }
    const r = await phase4.doors.enterCave(poi);
    if (r?.ok && !els.panel.hidden && els.panel.dataset.place === id) closePanel();
  } catch (error) {
    console.warn('[MILO] a cave failed:', error.message);
  } finally {
    riftUi.busy = false;
    if (!els.panel.hidden && els.panel.dataset.place === id) refreshPanel();
  }
}

async function visitBright(rift) {
  if (riftUi.busy) return;
  if (awayFrom(rift)) { riftUi.note = awayWords(); refreshPanel(); return; }
  riftUi.busy = true;
  refreshPanel();
  try {
    if (!nearTile(rift)) {
      const arrived = await Promise.resolve(worldCall('walkToEntity', riftEntity(rift)));
      if (arrived === false) { riftUi.note = 'Milo couldn’t find a way to it just now.'; return; }
    }
    // It faded while he walked: nothing to visit, and the panel says it closed.
    if (!stillStanding(rift)) { riftUi.note = null; return; }
    const next = safe(() => riftsModule.claimLoot(state, rift.spec, clockNow(), { riftId: rift.id }), state, 'claimLoot');
    if (next === state) {
      riftUi.note = 'You’ve visited already. It’s glad you came back.';
    } else {
      state = next;
      scheduleSave(400);
      const found = lootWords(rift.spec?.loot);
      riftUi.note = found.length ? `It left ${listWords(found)} in your satchel.` : 'It glows a little brighter for the visit.';
    }
  } finally {
    riftUi.busy = false;
    refreshPanel();
  }
}

function wardAction(rift, on) {
  const next = on ? riftsModule.wardRift(state, rift, clockNow()) : riftsModule.unwardRift(state, rift.key);
  if (next === state) return;
  state = next;
  scheduleSave(150);
  const inPanel = (els.panel.dataset.place || '').startsWith('rift:');
  riftLoop();
  refreshPanel({ focus: inPanel ? (on ? 'panel-unward' : 'panel-ward') : `${on ? 'unward' : 'ward'}-${rift.id}` });
}

function letGoAction(rift) {
  riftUi.confirming = null;
  const next = rift.kind === 'wild' ? riftsModule.letGoWild(state, rift, clockNow()) : riftsModule.letGoRift(state, rift, clockNow());
  if (next === state) { refreshPanel(); return; }
  state = next;
  worldCall('closeRift', rift.id, 'let-go');
  scheduleSave(150);
  syncWildState();
  riftLoop();
  if ((els.panel.dataset.place || '') === rift.id) closePanel();
  else refreshPanel();
  queueBubble({ kind: 'rift', title: 'Let go', lines: ['It flies off west as a pale moth. Nothing is lost for leaving it.'], duration: 5000, actions: [{ id: 'later', label: 'Okay' }] });
}

function letBeAction(rift) {
  const next = riftsModule.letItBe(state, rift, clockNow());
  if (next === state) return;
  state = next;
  worldCall('closeRift', rift.id, 'let-go');
  scheduleSave(150);
  riftLoop();
  if ((els.panel.dataset.place || '') === rift.id) closePanel();
  else refreshPanel();
}

// Stitching a wild rift (or the story's crack) from inside its Elsewhere.
function stitchInside(rift) {
  if (rift.kind === 'real') return;
  const before = state;
  // Mending it gives its gifts, the chest's logs among them, unless the chest was opened first.
  const found = claimElsewhere(rift) || [];
  const next = safe(() => riftsModule.stitchWild(state, rift, clockNow()), state, 'stitchWild');
  if (next === state) { state = before; syncWildState(); return; }
  state = next;
  stitchedHere.add(rift.id);
  placesDirty();
  worldCall('closeRift', rift.id, 'stitched');
  syncWildState();
  scheduleSave(150);
  // A wild stitch pays Road XP once; the Elsewhere's gentlest stray may ask to join the regulars.
  const paid = rift.kind === 'wild' ? phase4?.payStitch(rift) : null;
  queueBubble({
    kind: 'loot', title: 'Mended',
    lines: [rift.kind === 'story' ? 'That’s “A Crack Past the Gate” done.' : 'The seam holds, and the strays wave you off.', found.length ? `It left ${listWords(found)}.` : '', paid?.xp ? `Road XP +${paid.xp}.` : ''].filter(Boolean),
    duration: ALERT_MS, actions: [{ id: 'later', label: 'Nice' }],
  });
  const invite = rift.kind === 'wild' ? phase4?.invitation(rift) : null;
  if (invite) {
    queueBubble({
      kind: 'loot', title: `${invite.name} wants to stay`, lines: [invite.words].filter(Boolean), duration: 20000,
      actions: [{ id: 'welcome', label: 'Welcome them' }, { id: 'later', label: 'Not this time' }],
      onAction: action => { if (action === 'welcome') invite.accept(); },
    });
  }
  riftLoop();
  refreshPanel({ focus: 'panel-deeper' });
}

// The ladder: every stitched wild rift has a deeper one beneath it.
async function goDeeper(rift) {
  const spec = safe(() => riftgen.deeper(rift.spec), null, 'deeper');
  if (!spec?.id) return;
  const deeper = {
    id: spec.id, key: null, kind: 'wild', spec, x: rift.x, y: rift.y, beyond: rift.beyond, towards: null, stage: spec.stage,
    urgency: 0, bright: false, warded: null, held: null, atWalls: false, cause: riftsModule.WILD_CAUSE, stitch: riftsModule.WILD_STITCH,
    since: rift.since, echo: null, subject: null, parent: rift.id,
  };
  riftIndex.set(deeper.id, deeper);
  closePanel();
  const above = hereRift;
  hereRift = deeper;
  try {
    const entered = phase4?.doors
      ? (await phase4.doors.goDeeper(rift)).ok
      : await Promise.resolve(worldCall('enterElsewhere', deeper));
    // Refused (mid-fade, say): Milo is still in the rift above.
    if (entered === false) hereRift = areaInfo.area === 'elsewhere' ? above : null;
  } catch (error) {
    console.warn('[MILO] going deeper failed:', error.message);
    hereRift = areaInfo.area === 'elsewhere' ? above : null;
  }
  renderBanner();
  summarizeStatus();
}

function raiseAction() {
  const result = safe(() => hearthModule.raiseHearth(state, content?.fortress, clockNow()), null, 'raiseHearth');
  if (!result) return;
  if (!result.ok) { hearthNote = result.reason; refreshPanel(); return; }
  state = result.state;
  hearthNote = null;
  const tier = hearthTierNow();
  const name = hearthTierName();
  syncWildState(true);
  worldCall('raiseReveal', tier);
  scheduleSave(150);
  queueBubble({
    kind: 'hearth', title: `${name} is raised`,
    lines: tier === 2
      ? ['A palisade rings the vale now, with a gatehouse at each gate. The War Table, the Gate Bell and the banners stand by the north gate.']
      : [result.reason || 'The Hearth stands taller, and its ward reaches further.'],
    duration: GREETING_MS, place: tier >= 2 ? 'war-table' : 'hearth',
    actions: [{ id: 'show', label: tier >= 2 ? 'The War Table' : 'Show me' }, { id: 'later', label: 'Lovely' }],
  });
  renderPlaces();
  riftLoop();
  // The panel starts again from the top: the new tier, its look, and what the next one needs.
  refreshPanel();
  els.panelBody.scrollTop = 0;
  els.panelTitle.focus({ preventScroll: true });
}

function lightAction(id) {
  if (!id.startsWith('lantern:')) return;
  const next = modelModule.lightLantern(state, id, clockNow());
  if (next === state) return;
  state = next;
  // Milo's words as it catches, never the line the lantern's description then shows.
  poiResults.set(id, [wildtextModule.lightingLine(poiInfo(id) || { id }, content?.wilds) || 'The wick catches, and the old glass warms.']);
  syncWildState();
  scheduleSave(150);
  riftLoop();
  refreshPanel({ focus: 'rest' });
}

function restAction(id) {
  if (!id.startsWith('lantern:') || !state.wilds?.lanterns?.[id]) return;
  state = { ...state, wilds: { ...state.wilds, wake: id } };
  poiResults.set(id, ['Milo sits by the lantern a while and warms his hands.']);
  scheduleSave(150);
  refreshPanel({ focus: 'travel-home' });
}

function poiDone(id, list, materials, lines) {
  let next = modelModule.markPoi(state, list, id, clockNow());
  if (materials && Object.keys(materials).length) next = modelModule.addMaterials(next, materials);
  state = next;
  poiResults.set(id, lines.filter(Boolean));
  const poi = poiInfo(id);
  if (materials && Object.keys(materials).length && poi) worldCall('floatText', wildtextModule.floatWords(materials), { x: poi.x, y: poi.y });
  syncWildState();
  scheduleSave(400);
  refreshPanel();
}

function chestAction(id) {
  const poi = poiInfo(id);
  if (!poi || state.wilds?.opened?.[id]) return;
  const found = wildtextModule.openChest(poi, content?.wilds);
  const words = wildtextModule.materialsText(found.materials);
  // A friendly mimic has its say first; either way, what was inside.
  poiDone(id, 'opened', found.materials, [found.line, words ? `Inside: ${words}.` : 'It was empty, but it’s a nice chest.']);
  phase4?.onChest();
}

function ruinAction(id) {
  const poi = poiInfo(id);
  if (!poi || state.wilds?.opened?.[id]) return;
  const found = wildtextModule.searchRuin(poi, content?.wilds);
  const words = wildtextModule.materialsText(found.materials);
  const lines = [words ? `Milo looks round the old stones and finds ${words}.` : 'Nothing to carry, but a good look round.'];
  if (found.tablet) {
    state = modelModule.markExplored(state, found.keys);
    lines.push('Under a fallen stone, a map tablet. The land round here is on your map now.');
    if (mapIsOpen()) safe(() => mapView.refresh(), null, 'map refresh');
  }
  poiDone(id, 'opened', found.materials, lines);
}

function noteAction(id) {
  if (state.wilds?.notes?.[id]) return;
  const count = Object.keys(state.wilds?.notes || {}).length + 1;
  poiDone(id, 'notes', null, ['', `Notes from the Old Company found: ${count}.`]);
}

function statueAction(id) {
  if (state.wilds?.glimmers?.[id]) return;
  poiDone(id, 'glimmers', null, ['Milo stands very still, and remembers something.']);
}

function readLetterAction() {
  const next = safe(() => storyModule.readLetter(state, clockNow()), state, 'readLetter');
  state = next;
  storyUi = { showLetter: true };
  scheduleSave(150);
  if (els.panel.hidden || els.panel.dataset.place !== 'story') openPanel('story');
  storyUi = { showLetter: true };
  refreshPanel();
  els.panelBody.querySelector('.letter-section')?.scrollIntoView({ block: 'start' });
  riftLoop();
}

function setWardPost(value) {
  const rule = riftsModule.WARD_POST_RULES.some(r => r.id === value) ? value : null;
  state.settings = { ...state.settings, wardPost: rule };
  scheduleSave(150);
  riftLoop();
  refreshPanel({ focus: `ward-post-${rule || 'none'}` });
}

function setEveningBell(value) {
  state.settings = { ...state.settings, eveningBell: /^\d{2}:\d{2}$/.test(value) ? value : null };
  scheduleSave(150);
  // Tonight's Nocturne, if the new bell no longer covers it, goes quietly in this pass (rifts.js
  // closes it without a seal or loot).
  const pass = riftLoop();
  refreshPanel({ focus: 'evening-bell' });
  if (pass?.closed?.length) {
    queueBubble({
      kind: 'rift', title: 'The evening bell moved',
      lines: [state.settings.eveningBell ? 'Tonight’s Nocturne closes quietly. It opens again if the crew works past the new bell.' : 'With the bell off, tonight’s Nocturne closes quietly.'],
      duration: 5000, actions: [{ id: 'later', label: 'Okay' }],
    });
  }
}

// ---------------------------------------------------------------------------
// The story card and the Elsewhere banner.

function renderTracker() {
  if (!phase3) { els.tracker.hidden = true; return; }
  const status = storyStatus();
  const current = status?.steps.find(step => step.current);
  if (!status || status.complete || !current) {
    els.tracker.hidden = true;
    return;
  }
  const hidden = state.story?.trackerHidden === true;
  const html = panelsModule.trackerCard({
    hidden, title: current.title, hint: current.hint, doneCount: status.steps.filter(step => step.done).length,
    total: status.steps.length, canRead: current.id === 'letter',
  });
  if (html !== trackerHtml) {
    const focusedAction = els.tracker.contains(document.activeElement) ? document.activeElement.dataset.action : null;
    els.tracker.innerHTML = html;
    trackerHtml = html;
    const again = focusedAction && (els.tracker.querySelector(`[data-action="${CSS.escape(focusedAction)}"]`) || els.tracker.querySelector('button'));
    again?.focus({ preventScroll: true });
  }
  els.tracker.dataset.collapsed = String(hidden);
  els.tracker.classList.toggle('px', !hidden);
  els.tracker.hidden = false;
}

els.tracker?.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  switch (button.dataset.action) {
    case 'letter-read': readLetterAction(); break;
    case 'tracker-open': openPanel('story'); break;
    case 'tracker-hide':
    case 'tracker-show':
      state = storyModule.setTrackerHidden(state, button.dataset.action === 'tracker-hide');
      scheduleSave(150);
      renderTracker();
      els.tracker.querySelector('button')?.focus({ preventScroll: true });
      break;
    default: break;
  }
});

function renderBanner() {
  if (!phase3 || areaInfo.area !== 'elsewhere') {
    // Leave had focus: it goes with the banner, so the keyboard lands on the world.
    const hadFocus = els.banner.contains(document.activeElement);
    els.banner.hidden = true;
    els.banner.replaceChildren();
    if (hadFocus) els.canvas.focus({ preventScroll: true });
    return;
  }
  const info = worldCall('elsewhere') || {};
  const rift = riftFor(info.riftId || areaInfo.rift?.id);
  els.banner.innerHTML = panelsModule.elsewhereBanner({
    name: info.name || areaInfo.rift?.name || rift?.spec?.name || 'an Elsewhere',
    depth: Number.isFinite(info.depth) ? info.depth : areaInfo.depth,
    genres: rift ? frontierModule.genreChips(rift, genres) : [],
  });
  els.banner.hidden = false;
}

els.banner?.addEventListener('click', event => {
  if (event.target.closest('[data-action="leave-elsewhere"]')) leaveElsewhere();
});

// ---------------------------------------------------------------------------
// The map view (src/ui/mapview.js, its own module).

function loadMapView() {
  if (!mapLoading) {
    mapLoading = load('./ui/mapview.js').then(module => {
      mapviewModule = module && typeof module.createMapView === 'function' ? module : null;
      els.mapButton.hidden = !mapviewModule || !phase3;
      return mapviewModule;
    });
  }
  return mapLoading;
}

function miloWorldTile() {
  if (areaInfo.area === 'elsewhere') return state.wilds?.at || null;
  const tile = worldCall('miloTile');
  return tile && Number.isFinite(tile.x) ? { x: tile.x, y: tile.y } : null;
}

// What the map marks: Milo, lanterns lit or seen, the real rifts, today's wild rifts near Milo in
// explored land, and the regions whose landmark has been found.
const HOME_TILE = { x: 31, y: 22 };

function mapMarkers() {
  const out = [{ kind: 'home', id: 'home', x: HOME_TILE.x, y: HOME_TILE.y, label: 'Hearthvale', travel: true }];
  const explored = new Set(state.wilds?.explored || []);
  const seen = (x, y) => explored.has(wildtextModule.chunkKeyOf(x, y));
  const milo = miloWorldTile();
  if (milo) out.push({ kind: 'milo', id: 'milo', x: milo.x, y: milo.y, label: 'Milo' });
  const lit = state.wilds?.lanterns || {};
  for (const poi of safe(() => shellWilds.fixedPois(), [], 'fixedPois') || []) {
    const isLit = Boolean(lit[poi.id]);
    if (poi.type === 'lantern' && (isLit || seen(poi.x, poi.y))) {
      out.push({ kind: 'lantern', id: poi.id, x: poi.x, y: poi.y, lit: isLit, travel: isLit, rest: isLit && state.wilds?.wake === poi.id, label: isLit ? lanternPlace(poi.id).name : 'A sleeping lantern' });
    }
    if (poi.type === 'landmark' && poi.region && seen(poi.x, poi.y)) {
      const anchor = worldgen.anchors.find(a => a.id === poi.region);
      out.push({ kind: 'region', id: `region:${poi.region}`, x: anchor?.x ?? poi.x, y: anchor?.y ?? poi.y, label: anchors.get(poi.region) || poi.name });
    }
  }
  for (const rift of rifts) {
    if (rift.held || !Number.isFinite(rift.x)) continue;
    out.push({ kind: 'rift', id: rift.id, x: rift.x, y: rift.y, label: rift.spec?.name || 'A rift', genres: rift.spec?.genres || [], colour: riftColour(rift), stage: rift.warded?.stage || rift.stage, bright: Boolean(rift.bright) });
  }
  // Today's wild rifts, in land already explored near Milo.
  if (milo) {
    const day = riftsModule.dayNumber(clockNow());
    const mcx = Math.floor(milo.x / 32);
    const mcy = Math.floor(milo.y / 32);
    for (let dy = -3; dy <= 3; dy += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        if (!explored.has(`${mcx + dx},${mcy + dy}`)) continue;
        const wild = safe(() => riftsModule.wildRiftsForChunk({ worldgen, riftgen, cx: mcx + dx, cy: mcy + dy, day, wardRadius: wardRadiusNow(), closed: state.rifts?.closedWild, isFree: isWalkableTile }), [], 'wild rifts') || [];
        for (const rift of wild) out.push({ kind: 'rift', id: rift.id, x: rift.x, y: rift.y, label: `${rift.spec?.name || 'A rift'} · wild`, genres: rift.spec?.genres || [], colour: riftColour(rift), stage: rift.stage, wild: true });
      }
    }
  }
  return out;
}

// A rift's tear colours on the map, from its first genre in the content.
function riftColour(rift) {
  const genre = genres.get(rift.spec?.genres?.[0]);
  return genre ? { rim: genre.rim, inner: genre.inner } : null;
}

function ensureMapView() {
  if (mapView || !mapviewModule || !phase3) return mapView;
  mapView = safe(() => mapviewModule.createMapView(els.mapRoot, {
    paintChunk: (cx, cy, pxPerTile) => worldCall('paintMapChunk', cx, cy, pxPerTile) || null,
    valeImage: () => valePicture(),
    explored: () => state.wilds?.explored || [],
    markers: () => mapMarkers(),
    // The map has closed itself by now: home, a lit lantern, or a spot on the map.
    onTravel: (id, marker) => travel(id === 'home' ? 'home' : marker?.kind === 'lantern' ? id : { x: marker?.x, y: marker?.y }),
    onClose: () => {
      mapClosedAt = performance.now();
      delete els.stage.dataset.map;
      els.mapButton.setAttribute('aria-pressed', 'false');
      worldCall('setPaused', worldShouldPause());
    },
    now: clockNow,
    motion: motionOn,
  }), null, 'createMapView');
  return mapView;
}

function mapIsOpen() {
  if (!mapView) return false;
  try { return Boolean(mapView.isOpen()); } catch { return false; }
}

// Opens the map on Milo, or on a spot; `focus` is a marker id to point out (a rift's Show me).
async function openMap(center = null, focus = null) {
  await loadMapView();
  const view = ensureMapView();
  if (!view) return;
  hideTip();
  els.stage.dataset.map = 'open';
  els.mapButton.setAttribute('aria-pressed', 'true');
  safe(() => view.open({ center: center && Number.isFinite(center.x) ? center : miloWorldTile(), focus }), null, 'map open');
  worldCall('setPaused', true);
}

function closeMap() {
  if (!mapIsOpen()) return;
  safe(() => mapView.close(), null, 'map close');
  mapClosedAt = performance.now();
  delete els.stage.dataset.map;
  els.mapButton.setAttribute('aria-pressed', 'false');
  worldCall('setPaused', worldShouldPause());
}

const isTyping = target => Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));

function mapKey(event) {
  if (isTyping(event.target) || event.defaultPrevented) return;
  // The map view may have closed itself on this very key.
  if (performance.now() - mapClosedAt < 150) return;
  event.preventDefault();
  if (mapIsOpen()) closeMap();
  else openMap();
}

els.mapButton?.addEventListener('click', () => {
  if (mapIsOpen()) closeMap();
  else openMap();
});

// ---------------------------------------------------------------------------
// Snapshots and live alerts.

function summarizeStatus() {
  if (job) { setStatus(jobText().replace(/…$/, '')); return; }
  // Out in the wilds or inside an Elsewhere, the title bar says where Milo is.
  const where = phase3 ? safe(() => frontierModule.areaStatus(areaInfo), '', 'areaStatus') : '';
  if (where) { setStatus(where); return; }
  if (!snapshot) { setStatus('Looking around'); return; }
  const sources = snapshot.sources || {};
  const ok = ['claude', 'codex'].filter(id => sources[id]?.ok);
  if (!ok.length) { setStatus("Can't see your crew yet"); return; }
  const working = (snapshot.sessions || []).filter(s => s.status === 'working').length;
  setStatus(working ? `Keeping watch · ${working} working` : 'Keeping watch');
}

function handleEvents(events) {
  const worth = events.filter(event => event && (event.type === 'finished' || event.type === 'needs-you') && event.session);
  if (!worth.length) return;
  worth.slice(0, 4).forEach(event => {
    const text = safe(() => alertText(event), null, 'alertText') || fallback.alertText(event);
    queueBubble({
      kind: 'alert', title: text.title, lines: [text.body], duration: ALERT_MS, place: 'watchtower',
      actions: [{ id: 'show', label: 'Show me' }, { id: 'later', label: 'Got it' }],
    });
    // Main decides from the window's real focus; it sends nothing while MILO is in front.
    if (state.settings?.notifications !== false) {
      Promise.resolve(bridge?.notify({ title: text.title, body: text.body })).catch(() => {});
    }
  });
}

// Remember when each skill level was first proven. Quiet at launch; a level
// learned while MILO is open gets a short note from Milo (`announce`), unless the caller folds
// it into its own words (a build does). Returns the levels learned just now.
function recordSkills(announce) {
  const all = evaluations();
  const skills = { ...(state.skills || {}) };
  const learned = [];
  let changed = false;
  for (const [id, evaluation] of Object.entries(all)) {
    const level = Number(evaluation?.level) || 0;
    const known = Number(skills[id]?.level) || 0;
    if (level > known) {
      skills[id] = { level, provenAt: clockNow() };
      changed = true;
      const skill = SKILLS.find(entry => entry.id === id);
      const title = evaluation.proven?.[evaluation.proven.length - 1]?.title;
      if (skill) learned.push({ id, name: skill.name, level, title });
      if (announce && skill) {
        queueBubble({ kind: 'skill', title: `I learned ${skill.name} level ${level}`, lines: title ? [`${title}.`] : [], duration: ALERT_MS, place: 'camp', actions: [{ id: 'show', label: 'Show me' }, { id: 'later', label: 'Nice' }] });
      }
    }
  }
  if (changed) { state.skills = skills; scheduleSave(); }
  if (!els.panel.hidden && els.panel.dataset.place === 'camp') refreshPanel({ passive: true });
  return learned;
}

// While Milo is still walking out, the first look already places the crew and
// fills the strip. Alerts and skills wait for boot.
function previewSnapshot(next) {
  if (booted || !next || typeof next !== 'object' || !Array.isArray(next.sessions)) return;
  if (snapshot && Number(snapshot.scannedAt) > Number(next.scannedAt)) return;
  snapshot = next;
  renderCrew();
  summarizeStatus();
}

function applySnapshot(next) {
  if (!next || typeof next !== 'object' || !Array.isArray(next.sessions)) return;
  if (!booted) { pendingSnapshot = next; previewSnapshot(next); return; }
  const previous = prevSessions;
  snapshot = next;
  prevSessions = next.sessions;
  recordSkills(Boolean(previous));
  if (previous) handleEvents(safe(() => diffSnapshots(previous, next.sessions), [], 'diffSnapshots') || []);
  renderCrew();
  summarizeStatus();
  if (!els.panel.hidden && els.panel.dataset.place === 'watchtower') refreshPanel({ passive: true });
  // Every snapshot runs the rift loop (after launch; launch runs its own pass after the greeting).
  if (phase3 && riftLoopLive) riftLoop();
  phase4?.emit('snapshot', snapshot);
}

bridge?.onSnapshot(applySnapshot);

// ---------------------------------------------------------------------------
// Boot.

function greet(now) {
  const firstToday = state.lastGreetedDay !== safe(() => dayKey(now), localDayKey(now), 'dayKey');
  const recap = safe(() => buildRecap(snapshot?.sessions || [], state.lastSeenAt ?? null, now), null, 'buildRecap')
    || fallback.buildRecap(snapshot?.sessions || [], null, now);
  const words = safe(() => greeting(recap, { name: state.user?.name || 'Chris', now, firstToday }), null, 'greeting')
    || fallback.greeting(recap, { name: state.user?.name || 'Chris' });
  return words;
}

async function boot() {
  els.wordmark.innerHTML = pixelWord('MILO');
  setStatus('Looking around');
  let bundle = null;
  if (bridge) {
    // MILO's clock (the test clock under MILO_NOW) and the game's content come first: the state is
    // read on that clock, and the world is made from that content.
    const [clock, loadedContent] = await Promise.all([
      withTimeout(Promise.resolve().then(() => bridge.clock?.()), 4000),
      withTimeout(Promise.resolve().then(() => bridge.content?.()), 8000),
    ]);
    clockOffset = Number.isFinite(clock?.offset) ? clock.offset : 0;
    bundle = loadedContent && typeof loadedContent === 'object' ? loadedContent : null;
    try {
      const loaded = await bridge.loadState();
      state = normalizeState(loaded || createState(clockNow()), clockNow());
      stateLoaded = true;
    } catch (error) {
      console.warn('[MILO] state could not be loaded:', error.message);
      saveBlocked = true;
      queueBubble({ kind: 'notice', title: "I couldn't open my notes", lines: ['Your saved files were left as they are. Changes here won\'t be saved this time.'], duration: GREETING_MS, actions: [{ id: 'later', label: 'Okay' }] });
    }
  }
  setupPhase3(bundle);
  applyMotion();
  renderPlaces();
  startWorld();
  renderCrew();
  refreshArchitectStatus();
  for (const place of PLACES) if (place.kind === 'plot') ensureSuggestions(place.id);
  if (phase3) {
    syncWildState();
    renderTracker();
    loadMapView();
    // The rifts MILO already knows stand as soon as the roads are warm, in idle time.
    warmWilds();
  }

  const phase4Ready = startPhase4(bundle);
  const scanning = bridge
    ? withTimeout(bridge.scan().then(result => { previewSnapshot(result); return result; })
      .catch(error => { console.warn('[MILO] scan failed:', error.message); return null; }), SCAN_WAIT_MS)
    : Promise.resolve(null);
  const [first] = await Promise.all([scanning, withTimeout(worldCall('entrance'), 8000)]);
  await phase4Ready;
  booted = true;
  const initial = pendingSnapshot && (!first || pendingSnapshot.scannedAt >= first.scannedAt) ? pendingSnapshot : first;
  pendingSnapshot = null;
  if (initial) applySnapshot(initial);
  else summarizeStatus();

  const now = clockNow();
  const words = greet(now);
  seenNow();
  // Launch's own pass of the rift loop: what sealed while MILO was closed, and what opened, goes
  // into the greeting as one quiet line; a rift at the walls still rings its bell after it. It
  // waits for the roads (usually long since warm by now), so it never lays them out itself.
  if (phase3) await withTimeout(wildsWarm, WARM_WAIT_MS);
  bootPassRan = true;
  const launch = phase3 ? riftLoop({ boot: true }) : null;
  const lines = (words.lines || []).slice(0, 4);
  if (launch?.line && lines.length < 4) lines.push(launch.line);
  if (state.settings?.greeting !== false) {
    state.lastGreetedDay = safe(() => dayKey(now), localDayKey(now), 'dayKey');
    queueBubble({
      kind: 'greeting', title: words.title, lines, duration: GREETING_MS, place: 'watchtower',
      actions: [{ id: 'show', label: 'Show me' }, { id: 'later', label: 'Later' }],
    });
  } else if (launch?.line) {
    queueBubble({ kind: 'sealed', title: 'While you were away', lines: [launch.line], duration: ALERT_MS, place: 'watchtower', actions: [{ id: 'show', label: 'Show me' }, { id: 'later', label: 'Later' }] });
  }
  if (launch) ringBells(launch.bell, launch.notify);
  riftLoopLive = phase3;
  scheduleSave(0);
  // A fight that was running when MILO closed picks up on the same tick (Phase 4).
  if (phase4) phase4.resume().catch(error => console.warn('[MILO] resuming a fight failed: ' + error.message));
  if (state.panel && panelExists(state.panel)) openPanel(state.panel, { focus: false, save: false });

  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    seenNow();
    scheduleSave();
    // Keep relative times and the 24-hour grouping honest when nothing else changes.
    renderCrew();
    if (!els.panel.hidden && els.panel.dataset.place === 'watchtower') refreshPanel({ passive: true });
  }, SEEN_TICK_MS);
  // The rift loop also runs on its own clock, hidden or not: it draws nothing, and time alone
  // opens a Nocturne, ages a Knocking and ends a capacity window. A new day refreshes the wilds,
  // right as the day turns (the tick catches it anyway after a sleep).
  if (phase3) {
    setInterval(() => riftTick(), RIFT_TICK_MS);
    atMidnight();
  }
  document.body.dataset.ready = 'true';
}

document.addEventListener('visibilitychange', () => worldCall('setPaused', worldShouldPause()));
window.addEventListener('resize', () => {
  worldCall('resize');
  updateWorldInsets();
  bubbleLast = '';
  positionBubble();
  if (!els.panel.hidden) paintPanelArt();
});

bridge?.onBeforeClose(async () => {
  try {
    // Before the saved state is back there's nothing of Chris's to save (flushSave holds off).
    if (stateLoaded) seenNow();
    await flushSave();
  } finally {
    bridge.finishClose();
  }
});

boot().catch(error => {
  console.warn('[MILO] boot trouble:', error.message);
  booted = true;
  document.body.dataset.ready = 'true';
});
