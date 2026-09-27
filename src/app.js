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

function ago(ms, now = Date.now()) {
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
let saveTimer = null;
let saveDue = 0;
let saveChain = Promise.resolve();
let snapshot = null;
let prevSessions = null;
let booted = false;
let pendingSnapshot = null;
let world = null;
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
  if (saveBlocked) return saveChain;
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
  if (saveBlocked) return;
  const due = Date.now() + delay;
  if (saveTimer && saveDue <= due) return;
  clearTimeout(saveTimer);
  saveDue = due;
  saveTimer = setTimeout(flushSave, delay);
}

function seenNow() {
  safe(() => markSeen(state, Date.now()), null, 'markSeen');
  if (!Number.isFinite(state.lastSeenAt)) state.lastSeenAt = Date.now();
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
  if (isPlot(id)) {
    // While a building is being redesigned it keeps its name; the scaffold is only around it.
    const name = buildingNameOf(plotOf(id)) || (job?.plotId === id && job.redesign ? job.name : '');
    if (name) return name;
  }
  return placeName(id);
}

// Hover tips name the plot and what's there.
function placeLabel(id) {
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
  if (typeof world?.setPaused === 'function') worldCall('setPaused', document.hidden);
  if (!els.panel.hidden) paintPanelArt();
}
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
  world = safe(() => createWorld(els.canvas, {
    onPlaceClick: id => openPanel(canonicalId(id), { walk: false }),
    onCrewClick: id => openCrew(id),
    onHover: info => showTip(info),
    onMiloMove: tile => {
      if (tile && Number.isFinite(tile.x) && Number.isFinite(tile.y)) {
        state.milo = { ...state.milo, tile: { x: tile.x, y: tile.y } };
        scheduleSave(1500);
      }
    },
    motion: motionOn,
    startTile: state.milo?.tile ?? null,
  }), null, 'createWorld');
  if (!world) els.fallback.hidden = false;
  syncPlots();
}

// Hands the plots to the world: empty, a building site while designing, or the built building.
// Plot objects are replaced, never edited, so the world can cache its art by identity.
function syncPlots() {
  worldCall('setPlots', state.plots || {});
}

// Tell the world which screen edges the overlays cover, so its camera keeps Milo and his camp in
// the open part: below the crew strip, and left of an open panel. Uses layout positions, so a
// panel still sliding in counts at its resting place.
function updateWorldInsets() {
  if (!world) return;
  const stage = els.stage.getBoundingClientRect();
  const crew = els.crew.getBoundingClientRect();
  const top = crew.height > 1 ? Math.max(0, crew.bottom - stage.top + 8) : 0;
  const right = els.panel.hidden || panelClosing ? 0 : Math.max(0, els.stage.clientWidth - els.panel.offsetLeft + 8);
  worldCall('setInsets', { top, right });
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

function showTip(info) {
  if (!info || !info.id) { hideTip(); return; }
  const rect = els.canvas.getBoundingClientRect();
  const px = rect.left + (Number(info.x) || 0);
  // The canvas still sees the pointer under an open panel; no tip there.
  if (!els.panel.hidden && px >= els.panel.getBoundingClientRect().left - 4) { hideTip(); return; }
  const text = info.kind === 'crew' ? (crewLabels.get(info.id) || CREW_NAMES[info.id] || 'A helper') : placeLabel(canonicalId(info.id));
  els.tip.textContent = text;
  els.tip.hidden = false;
  const width = els.tip.offsetWidth;
  const height = els.tip.offsetHeight;
  const rightLimit = (els.panel.hidden ? innerWidth : els.panel.getBoundingClientRect().left) - 8;
  const pointerY = rect.top + (Number(info.y) || 0);
  let x = clamp(px - width / 2, 8, Math.max(8, rightLimit - width));
  let y = clamp(pointerY - 34, 40, innerHeight - 30);
  // Never over the crew strip or the place list: flip below the pointer, or slide clear.
  const keepOut = [els.crew, els.places]
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
for (const overlay of [els.panel, els.bubble, els.crew, els.places]) overlay.addEventListener('pointerenter', hideTip);
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

function buildCrew(now = Date.now()) {
  const crew = [agentCrew('claude', now), agentCrew('codex', now)];
  for (const tool of snapshot?.tools || []) crew.push(toolCrew(tool));
  // The crew member drawing up plans walks over to that plot and works there.
  if (job && job.kind === 'design' && isCrew(job.who)) {
    const index = crew.findIndex(member => member.id === job.who);
    if (index !== -1) crew[index] = { ...crew[index], state: 'designing', plotId: job.plotId, label: `Designing at ${placeName(job.plotId)}` };
  }
  return crew;
}

function renderCrew() {
  const crew = buildCrew();
  crewLabels.clear();
  const chips = crew.filter(member => member.id === 'claude' || member.id === 'codex' || member.state !== 'offline');
  els.crew.innerHTML = chips.map(member => {
    const name = CREW_NAMES[member.id] || member.id;
    crewLabels.set(member.id, `${name} · ${member.label}`);
    return `<button type="button" class="crew-chip px" data-crew="${esc(member.id)}" data-state="${esc(member.state)}" aria-label="${esc(`${name}, ${member.label}`)}">`
      + `${face(member.id)}<span class="crew-text"><strong>${esc(name)}</strong><small><i class="dot" aria-hidden="true"></i>${esc(member.label)}</small></span></button>`;
  }).join('');
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
  if (!bubbleCurrent) nextBubble();
}

// Drops Milo's passing remarks ("Codex is drawing up plans…") once there's news, so the news shows at once.
const PASSING = new Set(['progress', 'note']);
function clearProgressBubbles() {
  for (let i = bubbleQueue.length - 1; i >= 0; i -= 1) if (PASSING.has(bubbleQueue[i].kind)) bubbleQueue.splice(i, 1);
  if (PASSING.has(bubbleCurrent?.kind)) dismissBubble();
}

function nextBubble() {
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
  for (const overlay of [els.crew, els.places]) {
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
  const now = Date.now();
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
  let html = '<p class="panel-lede">Milo\'s home base. His skills grow only when he can really do something new for you.</p>';
  if (SKILLS.length) {
    html += '<section class="skills"><h3>Skills</h3>';
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
    ['motion', 'Motion', 'Gentle movement in the world and the panels.'],
    ['notifications', 'Alerts', 'A quiet desktop note when a task finishes while MILO is in the background.'],
    ['greeting', 'Greeting', 'Milo says hello and recaps when you open MILO.'],
  ];
  html += '<section class="settings"><h3>Settings</h3>' + settings.map(([key, label, hint]) => {
    const on = state.settings?.[key] !== false;
    return `<div class="setting"><div><p class="setting-name" id="setting-${key}">${label}</p><p class="setting-hint">${esc(hint)}</p></div>`
      + `<button type="button" class="switch" role="switch" aria-checked="${on}" aria-labelledby="setting-${key}" data-setting="${key}" data-focus-key="setting-${key}"><span class="switch-knob" aria-hidden="true"></span><span class="switch-text">${on ? 'On' : 'Off'}</span></button></div>`;
  }).join('') + (reducedMotion.matches ? '<p class="setting-hint">Your system asks for reduced motion, so the world stays still.</p>' : '') + '</section>';
  return html;
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
      if (open === 'camp' || (isPlot(open) && !job)) refreshPanel();
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
}

// ---------------------------------------------------------------------------
// Opening, refreshing and closing panels.

function refreshPanel({ focus = null } = {}) {
  if (els.panel.hidden) return;
  const id = els.panel.dataset.place;
  const scroll = els.panelBody.scrollTop;
  const active = document.activeElement;
  const inside = els.panel.contains(active);
  const focusKey = els.panelBody.contains(active) ? active.dataset.focusKey : null;
  const selection = inside && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  els.panelTitle.textContent = placeTitle(id);
  els.panelBody.innerHTML = renderPanelBody(id);
  els.panelBody.scrollTop = scroll;
  paintPanelArt();
  const target = (focus && els.panelBody.querySelector(`[data-focus-key="${focus}"]`))
    || (focusKey && els.panelBody.querySelector(`[data-focus-key="${focusKey}"]`));
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
  for (const button of els.placeList.querySelectorAll('[data-place]')) {
    if (button.dataset.place === id) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
}

function openPanel(rawId, { walk = false, focus = true, save = true } = {}) {
  const id = canonicalId(rawId);
  if (!id) return;
  hideTip();
  if (!els.panel.hidden && !panelClosing && els.panel.dataset.place === id) {
    if (focus) els.panelTitle.focus({ preventScroll: true });
    return;
  }
  if (document.activeElement && !els.panel.contains(document.activeElement)) lastPanelOpener = document.activeElement;
  if (id !== 'watchtower') earlierLimit = EARLIER_STEP;
  if (plotUi.plotId !== id) resetPlotUi(id);
  for (const plotId of [...plotNotes.keys()]) if (plotId !== id) plotNotes.delete(plotId);
  els.panel.dataset.place = id;
  els.panelTitle.textContent = placeTitle(id);
  els.panelBody.innerHTML = renderPanelBody(id);
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
  if (walk) walkTo(id);
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
    updateWorldInsets();
  };
  if (motionOn()) setTimeout(finish, 220);
  else finish();
  markCurrentPlace(null);
  const opener = lastPanelOpener && document.contains(lastPanelOpener) ? lastPanelOpener : els.canvas;
  opener.focus({ preventScroll: true });
  lastPanelOpener = null;
  plotNotes.clear();
  resetPlotUi(null);
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
    const next = plots.finishDesign(state, plotId, result, Date.now(), { keepPlan });
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
  const choice = event.target.closest('[data-designer]');
  if (!choice || !choice.checked) return;
  state.settings = { ...state.settings, designer: choice.value };
  flushSave().then(() => refreshArchitectStatus());
});

// Escape steps back out of a rename, redesign or clear before it closes the panel.
els.panel.addEventListener('keydown', event => {
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

function renderPlaces() {
  const focused = els.placeList.contains(document.activeElement) ? document.activeElement.dataset.place : null;
  els.placeList.innerHTML = PLACES.map(place => {
    const note = placeNote(place);
    return `<li><button type="button" data-place="${esc(place.id)}" data-kind="${esc(place.kind)}">${esc(placeTitle(place.id))}${note ? ` <span class="place-note">${esc(note)}</span>` : ''}</button></li>`;
  }).join('');
  if (!els.panel.hidden) markCurrentPlace(els.panel.dataset.place);
  if (focused) els.placeList.querySelector(`[data-place="${focused}"]`)?.focus({ preventScroll: true });
}

els.placesToggle.addEventListener('click', () => {
  const open = els.placesToggle.getAttribute('aria-expanded') !== 'true';
  els.placesToggle.setAttribute('aria-expanded', String(open));
  els.places.dataset.open = String(open);
});
els.placeList.addEventListener('click', event => {
  const button = event.target.closest('[data-place]');
  if (!button) return;
  // Tuck the list away again once a place is chosen; focus moves to the panel.
  els.placesToggle.setAttribute('aria-expanded', 'false');
  els.places.dataset.open = 'false';
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
  if (event.key !== 'Escape') return;
  if (!els.bubble.hidden && (els.bubble.contains(document.activeElement) || els.panel.hidden)) { dismissBubble(); return; }
  if (!els.panel.hidden) closePanel();
});

// ---------------------------------------------------------------------------
// Snapshots and live alerts.

function summarizeStatus() {
  if (job) { setStatus(jobText().replace(/…$/, '')); return; }
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
      skills[id] = { level, provenAt: Date.now() };
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
  if (!els.panel.hidden && els.panel.dataset.place === 'camp') refreshPanel();
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
  if (!els.panel.hidden && els.panel.dataset.place === 'watchtower') refreshPanel();
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
  if (bridge) {
    try {
      const loaded = await bridge.loadState();
      state = normalizeState(loaded || createState(Date.now()), Date.now());
    } catch (error) {
      console.warn('[MILO] state could not be loaded:', error.message);
      saveBlocked = true;
      queueBubble({ kind: 'notice', title: "I couldn't open my notes", lines: ['Your saved files were left as they are. Changes here won\'t be saved this time.'], duration: GREETING_MS, actions: [{ id: 'later', label: 'Okay' }] });
    }
  }
  applyMotion();
  renderPlaces();
  startWorld();
  renderCrew();
  refreshArchitectStatus();
  for (const place of PLACES) if (place.kind === 'plot') ensureSuggestions(place.id);

  const scanning = bridge
    ? withTimeout(bridge.scan().then(result => { previewSnapshot(result); return result; })
      .catch(error => { console.warn('[MILO] scan failed:', error.message); return null; }), SCAN_WAIT_MS)
    : Promise.resolve(null);
  const [first] = await Promise.all([scanning, withTimeout(worldCall('entrance'), 8000)]);
  booted = true;
  const initial = pendingSnapshot && (!first || pendingSnapshot.scannedAt >= first.scannedAt) ? pendingSnapshot : first;
  pendingSnapshot = null;
  if (initial) applySnapshot(initial);
  else summarizeStatus();

  const now = Date.now();
  const words = greet(now);
  seenNow();
  if (state.settings?.greeting !== false) {
    state.lastGreetedDay = safe(() => dayKey(now), localDayKey(now), 'dayKey');
    queueBubble({
      kind: 'greeting', title: words.title, lines: (words.lines || []).slice(0, 4), duration: GREETING_MS, place: 'watchtower',
      actions: [{ id: 'show', label: 'Show me' }, { id: 'later', label: 'Later' }],
    });
  }
  scheduleSave(0);
  if (state.panel && placeById(state.panel)) openPanel(state.panel, { focus: false, save: false });

  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    seenNow();
    scheduleSave();
    // Keep relative times and the 24-hour grouping honest when nothing else changes.
    renderCrew();
    if (!els.panel.hidden && els.panel.dataset.place === 'watchtower') refreshPanel();
  }, SEEN_TICK_MS);
  document.body.dataset.ready = 'true';
}

document.addEventListener('visibilitychange', () => worldCall('setPaused', document.hidden));
window.addEventListener('resize', () => {
  worldCall('resize');
  updateWorldInsets();
  bubbleLast = '';
  positionBubble();
  if (!els.panel.hidden) paintPanelArt();
});

bridge?.onBeforeClose(async () => {
  try {
    seenNow();
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
