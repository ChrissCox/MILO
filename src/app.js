// MILO renderer. The world canvas comes first; everything else is a light
// overlay: Milo's speech bubble, the crew strip, a place list, and panels.
// Other modules are loaded defensively so the shell still opens if one of
// them is missing or throws.

const bridge = window.milo ?? null;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const GREETING_MS = 12_000;
const ALERT_MS = 9_000;
const SEEN_TICK_MS = 60_000;
const SCAN_WAIT_MS = 20_000;
const EARLIER_STEP = 15;

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

const fallback = {
  createState: () => ({
    version: 1, user: { name: 'Chris' }, milo: { name: 'Milo', tile: null },
    lastSeenAt: null, lastGreetedDay: null,
    settings: { motion: true, notifications: true, greeting: true }, skills: {}, panel: null,
  }),
  normalizeState(input) {
    const base = fallback.createState();
    const value = input && typeof input === 'object' ? input : {};
    return { ...base, ...value, user: { ...base.user, ...value.user }, milo: { ...base.milo, ...value.milo }, settings: { ...base.settings, ...value.settings } };
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
  SKILLS: [],
  evaluateSkills: () => ({}),
  PLACES: [
    { id: 'camp', name: "Milo's camp", blurb: 'Where Milo lives and keeps his notes.', built: true, fogged: false },
    { id: 'watchtower', name: 'Watchtower', blurb: 'Where Milo keeps an eye on your agents.', built: true, fogged: false },
    { id: 'workshop', name: 'Workshop row', blurb: 'Agents will be sent out to work from here.', built: false, fogged: false },
    { id: 'clip-studio', name: 'Clip studio', blurb: 'A future spot for cutting stream clips.', built: false, fogged: false },
    { id: 'library', name: 'Library', blurb: 'A future home for project memory.', built: false, fogged: false },
    { id: 'game-table', name: 'Game table', blurb: 'A future corner for campaign prep.', built: false, fogged: false },
    { id: 'building-site', name: 'Building site', blurb: 'Where new tools will be put together.', built: false, fogged: false },
    { id: 'harbor', name: 'Harbor', blurb: 'Past the fog, by the water.', built: false, fogged: true },
  ],
};

const [modelModule, recapModule, skillsModule, mapModule, engineModule] = await Promise.all([
  load('./model.js'), load('./recap.js'), load('./skills.js'), load('./world/map.js'), load('./world/engine.js'),
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
const SKILLS = Array.isArray(skillsModule?.SKILLS) ? skillsModule.SKILLS : fallback.SKILLS;
const evaluateSkills = pick(skillsModule, 'evaluateSkills');
const PLACES = Array.isArray(mapModule?.PLACES) && mapModule.PLACES.length ? mapModule.PLACES : fallback.PLACES;

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
const placeById = id => PLACES.find(place => place.id === id) || null;
const placeName = id => placeById(id)?.name || id;

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

// 8×8 crew faces. Keys: o outline, f fill, e eye, a accent, . empty.
const FACES = {
  claude: { f: '#e0a07c', a: '#c97c58', rows: ['..oooo..', '.offffo.', 'offffffo', 'ofeffefo', 'offffffo', 'ofaaaafo', '.offffo.', '..oooo..'] },
  codex: { f: '#9fb3d1', a: '#6f86ad', rows: ['.oooooo.', 'offffffo', 'ofaffafo', 'ofeffefo', 'offffffo', 'offaaffo', 'offffffo', '.oooooo.'] },
  jev: { f: '#ecd08a', a: '#d99f5a', rows: ['...ooo..', '..offfo.', '.ofeffoa', '.offfffo', 'offffffo', 'ofaffffo', '.offffo.', '..o..o..'] },
  whisper: { f: '#c7ad8c', a: '#f1e6c8', rows: ['.o....o.', 'ooffffoo', 'ofaffafo', 'ofeffefo', 'offffffo', '.offffo.', '.offffo.', '..oooo..'] },
  ollama: { f: '#b9d1ac', a: '#8fb07e', rows: ['.o....o.', '.oo..oo.', '.offffo.', 'ofeffefo', 'offffffo', 'offaaffo', '.offffo.', '..oooo..'] },
  helper: { f: '#d6d0b8', a: '#b3ab8c', rows: ['..oooo..', '.offffo.', 'offffffo', 'ofeffefo', 'offffffo', 'offaaffo', '.offffo.', '..oooo..'] },
};

function face(id) {
  const spec = FACES[id] || FACES.helper;
  const colors = { o: '#3d4038', f: spec.f, e: '#3d4038', a: spec.a };
  const rects = [];
  spec.rows.forEach((row, y) => [...row].forEach((key, x) => {
    if (colors[key]) rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${colors[key]}"/>`);
  }));
  return `<svg class="face" viewBox="0 0 8 8" aria-hidden="true" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}

// Glyphs are drawn at exactly 2x their grid so every pixel lands on whole screen pixels.
const CHECK = '<svg class="tick tick-check" viewBox="0 0 7 6" width="14" height="12" aria-hidden="true" shape-rendering="crispEdges"><path d="M6 0h1v2H6zM5 2h1v1H5zM4 3h1v1H4zM3 4h1v1H3zM2 5h1v1H2zM1 4h1v1H1zM0 3h1v1H0z"/></svg>';
const LOCK = '<svg class="tick tick-lock" viewBox="0 0 7 7" width="14" height="14" aria-hidden="true" shape-rendering="crispEdges"><path d="M2 0h3v1H2zM1 1h1v2H1zM5 1h1v2H5zM0 3h7v4H0z"/></svg>';
const FOLDER = '<svg class="folder" viewBox="0 0 7 6" width="14" height="12" aria-hidden="true" shape-rendering="crispEdges"><path d="M0 0h3v1h4v5H0zM1 2v3h5V2z" fill-rule="evenodd"/></svg>';

// ---------------------------------------------------------------------------
// State and saving.

let state = normalizeState(createState(Date.now()), Date.now());
let saveBlocked = !bridge;
let saveTimer = null;
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

function scheduleSave(delay = 400) {
  if (saveBlocked) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, delay);
}

function seenNow() {
  safe(() => markSeen(state, Date.now()), null, 'markSeen');
  if (!Number.isFinite(state.lastSeenAt)) state.lastSeenAt = Date.now();
}

// ---------------------------------------------------------------------------
// Motion.

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const motionOn = () => state.settings?.motion !== false && !reducedMotion.matches;

function applyMotion() {
  document.documentElement.classList.toggle('still', !motionOn());
  // Nudge the world so its loop notices the change right away.
  if (typeof world?.setPaused === 'function') worldCall('setPaused', document.hidden);
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
    onPlaceClick: id => openPanel(id, { walk: false }),
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
  const text = info.kind === 'crew' ? (crewLabels.get(info.id) || CREW_NAMES[info.id] || 'A helper') : placeName(info.id);
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

function renderWatchtower() {
  const now = Date.now();
  const sessions = snapshot?.sessions || [];
  const groups = groupSessions(sessions, now);
  const titles = { 'needs-you': 'Needs you', working: 'Working now', recent: 'Finished recently', earlier: 'Earlier' };
  const skill = safe(() => evaluateSkills(snapshot || { sessions: [], tools: [], sources: {} })?.watchkeeping, null, 'evaluateSkills');
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

function renderCamp() {
  const evaluations = safe(() => evaluateSkills(snapshot || { sessions: [], tools: [], sources: {} }), {}, 'evaluateSkills') || {};
  let html = '<p class="panel-lede">Milo\'s home base. His skills grow only when he can really do something new for you.</p>';
  if (SKILLS.length) {
    html += '<section class="skills"><h3>Skills</h3>';
    for (const skill of SKILLS) {
      const evaluation = evaluations[skill.id] || { level: 0, next: skill.levels?.[0] || null, proven: [] };
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

function renderPlanned(place) {
  const skills = SKILLS.filter(skill => skill.place === place.id);
  let html = '';
  const FOG = 'Connect a calendar to clear the fog.';
  let blurb = String(place.blurb || '');
  if (place.fogged) {
    html += `<p class="fog-note">${FOG}</p>`;
    blurb = blurb.replace(FOG, '').trim();
  }
  html += `<p class="panel-lede">${esc(blurb || 'An empty plot, waiting for its turn.')}</p>`;
  html += '<p class="coming">Coming in a later step</p>';
  for (const skill of skills) {
    html += `<article class="skill" data-skill="${esc(skill.id)}" data-level="0"><header><h4>${esc(skill.name)}</h4><span class="skill-level">Planned</span></header>`
      + `<p class="skill-summary">${esc(skill.summary)}</p>`
      + `<ol class="levels">${(skill.levels || []).map(level => `<li data-level-state="locked">${LOCK}<span class="level-name">Level ${esc(level.level)}: ${esc(level.title)}</span></li>`).join('')}</ol></article>`;
  }
  return html;
}

function renderPanelBody(id) {
  const place = placeById(id) || { id, name: id, blurb: '' };
  if (id === 'watchtower') return renderWatchtower();
  if (id === 'camp') return renderCamp();
  return renderPlanned(place);
}

function refreshPanel() {
  if (els.panel.hidden) return;
  const id = els.panel.dataset.place;
  const scroll = els.panelBody.scrollTop;
  const focusKey = els.panelBody.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
  els.panelBody.innerHTML = renderPanelBody(id);
  els.panelBody.scrollTop = scroll;
  if (focusKey) els.panelBody.querySelector(`[data-focus-key="${focusKey}"]`)?.focus({ preventScroll: true });
}

function markCurrentPlace(id) {
  for (const button of els.placeList.querySelectorAll('[data-place]')) {
    if (button.dataset.place === id) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
}

function openPanel(id, { walk = false, focus = true, save = true } = {}) {
  if (!id) return;
  hideTip();
  const place = placeById(id);
  if (!els.panel.hidden && !panelClosing && els.panel.dataset.place === id) {
    if (focus) els.panelTitle.focus({ preventScroll: true });
    return;
  }
  if (document.activeElement && !els.panel.contains(document.activeElement)) lastPanelOpener = document.activeElement;
  if (id !== 'watchtower') earlierLimit = EARLIER_STEP;
  els.panel.dataset.place = id;
  els.panelTitle.textContent = place?.name || id;
  els.panelBody.innerHTML = renderPanelBody(id);
  els.panelBody.scrollTop = 0;
  const wasHidden = els.panel.hidden;
  panelClosing = false;
  els.panel.hidden = false;
  els.stage.dataset.panel = 'open';
  if (wasHidden) requestAnimationFrame(() => els.panel.classList.add('open'));
  else els.panel.classList.add('open'); // reopened while sliding out
  updateWorldInsets();
  markCurrentPlace(id);
  if (walk) walkTo(id);
  if (focus) els.panelTitle.focus({ preventScroll: true });
  if (save && state.panel !== id) { state.panel = id; scheduleSave(); }
}

function closePanel() {
  if (els.panel.hidden) return;
  els.panel.classList.remove('open');
  panelClosing = true;
  updateWorldInsets();
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
  state.panel = null;
  scheduleSave();
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
  }
});

// ---------------------------------------------------------------------------
// Place list (mirrors the canvas for keyboard and screen reader users).

function renderPlaces() {
  els.placeList.innerHTML = PLACES.map(place => {
    const note = place.fogged ? 'In the fog' : place.built ? '' : 'Empty plot';
    return `<li><button type="button" data-place="${esc(place.id)}">${esc(place.name)}${note ? ` <span class="place-note">${note}</span>` : ''}</button></li>`;
  }).join('');
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
  const focused = document.hasFocus();
  worth.slice(0, 4).forEach(event => {
    const text = safe(() => alertText(event), null, 'alertText') || fallback.alertText(event);
    queueBubble({
      kind: 'alert', title: text.title, lines: [text.body], duration: ALERT_MS, place: 'watchtower',
      actions: [{ id: 'show', label: 'Show me' }, { id: 'later', label: 'Got it' }],
    });
    if (!focused && state.settings?.notifications !== false) {
      Promise.resolve(bridge?.notify({ title: text.title, body: text.body })).catch(() => {});
    }
  });
}

// Remember when each skill level was first proven. Quiet at launch; a level
// learned while MILO is open gets a short note from Milo.
function recordSkills(announce) {
  const evaluations = safe(() => evaluateSkills(snapshot), {}, 'evaluateSkills') || {};
  const skills = { ...(state.skills || {}) };
  let changed = false;
  for (const [id, evaluation] of Object.entries(evaluations)) {
    const level = Number(evaluation?.level) || 0;
    const known = Number(skills[id]?.level) || 0;
    if (level > known) {
      skills[id] = { level, provenAt: Date.now() };
      changed = true;
      const skill = SKILLS.find(entry => entry.id === id);
      const title = evaluation.proven?.[evaluation.proven.length - 1]?.title;
      if (announce && skill) {
        queueBubble({ kind: 'skill', title: `I learned ${skill.name} level ${level}`, lines: title ? [`${title}.`] : [], duration: ALERT_MS, place: 'camp', actions: [{ id: 'show', label: 'Show me' }, { id: 'later', label: 'Nice' }] });
      }
    }
  }
  if (changed) { state.skills = skills; scheduleSave(); }
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
  if (!els.panel.hidden && ['watchtower', 'camp'].includes(els.panel.dataset.place)) refreshPanel();
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
