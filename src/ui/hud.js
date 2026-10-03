// The Adventure HUD and Quiet mode (CONTRACT-PHASE4.md §12.1, §12.4 K1; PLAN.md §7): a 96×96
// minimap painted from world.paintMapChunk (at most once a second, only while visible), the Embers,
// Mana and Focus orbs, and nav#side-tabs; in Quiet mode, only a button back. ::quiet and
// ::adventure (and the Settings row) switch it through setHudMode. Inside an Elsewhere or a cave
// it also shows a Sneak toggle (data-action="hud-sneak"), which calls world.setSneak.
import { walletView, touchesHeart } from '../embers.js';
import { orbView } from './kindle-view.js';
import { showTab } from './log.js';
import { esc } from './panels.js';

export const id = 'hud';
export const HUD_MODES = Object.freeze(['adventure', 'quiet']);
/** The minimap's size in CSS px, and in tiles at one pixel a tile. */
export const MINIMAP = 96;
const CHUNK = 32;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * The side tabs, in order, with what each opens (§12.4): Skills → `skills`; Quests → `board`;
 * Satchel → `satchel`; Company → `company:<first chosen, else milo>`; Grimoire → a line (it arrives
 * in Phase 5); Crew → the Log's Crew tab; Chronicle → `chronicle`; Settings → the camp panel's
 * Settings section.
 */
export const HUD_TABS = Object.freeze([
  { id: 'skills', label: 'Skills' }, { id: 'quests', label: 'Quests' }, { id: 'satchel', label: 'Satchel' }, { id: 'company', label: 'Company' },
  { id: 'grimoire', label: 'Grimoire' }, { id: 'crew', label: 'Crew' }, { id: 'chronicle', label: 'Chronicle' }, { id: 'settings', label: 'Settings' },
].map(Object.freeze));

export const GRIMOIRE_LINE = 'The Grimoire arrives in Phase 5. Until then, the Log’s command bar knows ::help.';

/**
 * What a side tab does: { kind: 'panel', panel, opts } | { kind: 'log', tab } | { kind: 'say',
 * title, lines }, or null for an unknown tab.
 */
export function hudTabTarget(tab, { state = null } = {}) {
  switch (tab) {
    case 'skills': return { kind: 'panel', panel: 'skills', opts: {} };
    case 'quests': return { kind: 'panel', panel: 'board', opts: {} };
    case 'satchel': return { kind: 'panel', panel: 'satchel', opts: {} };
    case 'company': {
      const chosen = isRecord(state?.party) && Array.isArray(state.party.chosen) ? state.party.chosen.filter((x) => typeof x === 'string' && /^[a-z0-9-]{1,40}$/.test(x)) : [];
      return { kind: 'panel', panel: `company:${chosen[0] || 'milo'}`, opts: {} };
    }
    case 'grimoire': return { kind: 'say', title: 'The Grimoire', lines: [GRIMOIRE_LINE] };
    case 'crew': return { kind: 'panel', panel: 'commissions', opts: {} };
    case 'chronicle': return { kind: 'panel', panel: 'chronicle', opts: {} };
    case 'settings': return { kind: 'panel', panel: 'camp', opts: { section: 'settings', focus: 'setting-motion' } };
    default: return null;
  }
}

const pad = (n) => String(n).padStart(2, '0');
const clock = (ms) => {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/**
 * The Mana orb: Codex's allowance left, from the snapshot's capacity reading (Phase 3's
 * snapshot.capacity.codex). → { pct: number | null, text, label, line }.
 */
export function manaView(snapshot, now) {
  const reading = isRecord(snapshot) && isRecord(snapshot.capacity) && isRecord(snapshot.capacity.codex) ? snapshot.capacity.codex : null;
  if (!reading || !finite(reading.usedPercent)) {
    return { pct: null, text: '–', label: 'Mana: no reading from Codex yet.', line: 'No reading from Codex yet. Mana shows how much of its allowance is left.' };
  }
  const pct = Math.max(0, Math.min(100, Math.round(100 - reading.usedPercent)));
  const refills = finite(reading.resetsAt) && (!finite(now) || reading.resetsAt > now) ? ` It refills at ${clock(reading.resetsAt)}.` : '';
  return { pct, text: `${pct}%`, label: `Mana: ${pct}% of Codex’s allowance left.${refills}`, line: `Codex has ${pct}% of its allowance left.${refills}` };
}

/** The Embers orb: { n, cap, text, label }. */
export function emberOrb(state, now, economy = null) {
  const view = walletView(state, now, { economy });
  return { n: view.balance, cap: view.cap, text: String(view.balance), label: `Embers: ${view.balance} of ${view.cap}. Open the Chronicle.` };
}

/**
 * The HUD's view: { mode: 'adventure' | 'quiet', inside, sneaking, orbs: { ember, mana, focus }, tabs }.
 * `area` is the shell's area() ({ area: 'vale' | 'wilds' | 'elsewhere', cave? }).
 */
export function hudView({ state = null, now = null, snapshot = null, area = null, sneaking = false, economy = null } = {}) {
  const mode = HUD_MODES.includes(state?.settings?.hud) ? state.settings.hud : 'adventure';
  const inside = isRecord(area) && (area.area === 'elsewhere' || area.cave === true);
  return {
    mode,
    inside,
    sneaking: inside && sneaking === true,
    orbs: { ember: emberOrb(state, now, economy), mana: manaView(snapshot, now), focus: orbView(state, now) },
    tabs: HUD_TABS.map((tab) => ({ ...tab })),
  };
}

const ORB_GLYPHS = Object.freeze({
  ember: '<svg viewBox="0 0 7 7" width="14" height="14" aria-hidden="true" shape-rendering="crispEdges"><path d="M3 0h1v1h1v1h1v4H5v1H2V6H1V2h1V1h1z"/></svg>',
  mana: '<svg viewBox="0 0 7 7" width="14" height="14" aria-hidden="true" shape-rendering="crispEdges"><path d="M3 0h1v2h1v1h1v3H5v1H2V6H1V3h1V2h1z"/></svg>',
  focus: '<svg viewBox="0 0 7 7" width="14" height="14" aria-hidden="true" shape-rendering="crispEdges"><path d="M3 0h1v1h1v2h1v3H5v1H2V6H1V3h1V1h1z"/></svg>',
});

/** One orb: a button with its glyph and its number, updated in place by the mount. */
function orb(kind, value, action) {
  const v = isRecord(value) ? value : {};
  return `<button type="button" class="hud-orb" data-orb="${kind}" data-action="${action}" data-focus-key="hud-orb-${kind}" aria-label="${esc(v.label || '')}">`
    + `${ORB_GLYPHS[kind]}<span class="orb-value">${esc(v.text ?? '')}</span></button>`;
}

/** The Sneak toggle, inside an Elsewhere or a cave. */
export function buildSneak(on) {
  return `<button type="button" class="px-btn small hud-sneak" data-action="hud-sneak" aria-pressed="${on ? 'true' : 'false'}" data-focus-key="hud-sneak">${on ? 'Sneaking' : 'Sneak'}</button>`;
}

/** The HUD inside #hud. Quiet mode is one button back to Adventure. */
export function buildHud(view) {
  const v = isRecord(view) ? view : hudView();
  if (v.mode === 'quiet') {
    return '<button type="button" class="px-btn small hud-adventure" data-action="hud-mode" data-mode="adventure" data-focus-key="hud-adventure">Adventure</button>';
  }
  const orbs = isRecord(v.orbs) ? v.orbs : {};
  let html = '<div class="hud-top">';
  html += `<div class="hud-orbs">${orb('ember', orbs.ember, 'hud-orb-ember')}${orb('mana', orbs.mana, 'hud-orb-mana')}${orb('focus', orbs.focus, 'hud-orb-focus')}</div>`;
  html += `<canvas class="hud-minimap px" width="${MINIMAP}" height="${MINIMAP}" role="img" aria-label="Minimap: the land round Milo. The place list and the map say what’s here."></canvas>`;
  html += '</div>';
  html += '<nav id="side-tabs" class="side-tabs" aria-label="Adventure tabs">';
  for (const tab of Array.isArray(v.tabs) ? v.tabs : HUD_TABS) {
    html += `<button type="button" class="side-tab" data-action="hud-tab" data-tab="${esc(tab.id)}" data-focus-key="hud-tab-${esc(tab.id)}">${esc(tab.label)}</button>`;
  }
  html += '</nav>';
  html += '<div class="hud-foot">';
  if (v.inside) html += buildSneak(v.sneaking);
  html += '<button type="button" class="link-btn hud-quiet" data-action="hud-mode" data-mode="quiet" data-focus-key="hud-quiet">Quiet mode</button>';
  return `${html}</div>`;
}

/**
 * Kindle's bell and the HUD's mode, for the camp panel's Settings section (L2 adds them there).
 * The bell is a `data-setting="kindleBell"` switch (it's in DEFAULT_SETTINGS); the mode is a
 * `data-action="hud-mode"` switch, which the shell hands to setHudMode.
 */
export function buildHudSettings(settings = {}) {
  const bell = settings?.kindleBell !== false;
  const adventure = settings?.hud !== 'quiet';
  return `<div class="setting"><div><p class="setting-name" id="setting-kindleBell">Kindle’s bell</p><p class="setting-hint">A quiet note when a session or rest ends.</p></div>`
    + `<button type="button" class="switch" role="switch" aria-checked="${bell}" aria-labelledby="setting-kindleBell" data-setting="kindleBell" data-focus-key="setting-kindleBell"><span class="switch-knob" aria-hidden="true"></span><span class="switch-text">${bell ? 'On' : 'Off'}</span></button></div>`
    + `<div class="setting"><div><p class="setting-name" id="setting-hud">Adventure HUD</p><p class="setting-hint">The minimap, the orbs and the tabs. Off is Quiet mode: the world as it was, with less on screen.</p></div>`
    + `<button type="button" class="switch" role="switch" aria-checked="${adventure}" aria-labelledby="setting-hud" data-action="hud-mode" data-mode="${adventure ? 'quiet' : 'adventure'}" data-focus-key="setting-hud"><span class="switch-knob" aria-hidden="true"></span><span class="switch-text">${adventure ? 'On' : 'Off'}</span></button></div>`;
}

/**
 * The minimap's chunks round a tile: { chunks: [{ cx, cy, key, dx, dy, fog }], milo: { x, y } },
 * at one pixel a tile with Milo at the centre. A chunk is under fog unless it's explored or
 * touches the vale.
 */
export function minimapPlan(tile, { size = MINIMAP, explored = [] } = {}) {
  if (!isRecord(tile) || !finite(tile.x) || !finite(tile.y)) return { chunks: [], milo: null };
  const seen = new Set(Array.isArray(explored) ? explored : []);
  const x0 = Math.round(tile.x) - Math.floor(size / 2);
  const y0 = Math.round(tile.y) - Math.floor(size / 2);
  const chunks = [];
  for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor((y0 + size - 1) / CHUNK); cy += 1) {
    for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor((x0 + size - 1) / CHUNK); cx += 1) {
      const key = `${cx},${cy}`;
      chunks.push({ cx, cy, key, dx: cx * CHUNK - x0, dy: cy * CHUNK - y0, fog: !seen.has(key) && !touchesHeart(key) });
    }
  }
  return { chunks, milo: { x: Math.round(tile.x) - x0, y: Math.round(tile.y) - y0 } };
}

/**
 * Switches the HUD (settings.hud) and html[data-hud]: the same function ::quiet, ::adventure, the
 * HUD's own buttons and the Settings row call. → true when `mode` is one of HUD_MODES.
 */
export function setHudMode(shell, mode) {
  if (!HUD_MODES.includes(mode) || !shell) return false;
  try {
    if (shell.settings && typeof shell.settings.set === 'function') shell.settings.set('hud', mode);
    const html = globalThis.document?.documentElement;
    if (html?.dataset) html.dataset.hud = mode;
    if (typeof shell.emit === 'function') shell.emit('hud', { mode });
    if (mounted?.shell === shell) mounted.render();
    return true;
  } catch (err) {
    console.error('[MILO] hud mode', err);
    return false;
  }
}

let mounted = null;
const NOOP = Object.freeze({ dispose() {}, refresh() {} });
const FOG = '#e6e0c8';
const INK = '#3d4038';

/**
 * Mounts #hud: builds it on a mode or area change, updates the orbs in place on 'state' and
 * 'second', repaints the minimap at most once a second while visible, reports its rect through
 * shell.insets('hud', …) and keeps html[data-hud]. → { dispose(), refresh(reason) }.
 */
export function mount(shell) {
  try {
    const doc = globalThis.document;
    const root = doc?.getElementById?.('hud');
    if (!shell || !root) return NOOP;
    const offs = [];
    const chunkCanvases = new Map();
    let sneaking = false;
    let shape = '';
    let painted = '';

    const view = () => hudView({
      state: shell.state, now: shell.now(), snapshot: shell.snapshot?.(), area: shell.area?.(), sneaking, economy: shell.content?.()?.economy ?? null,
    });
    const report = () => {
      if (typeof shell.insets !== 'function' || typeof root.getBoundingClientRect !== 'function') return;
      const r = root.getBoundingClientRect();
      shell.insets('hud', !r.width || root.hidden ? null : { x: r.left, y: r.top, width: r.width, height: r.height });
    };
    const orbsInPlace = (v) => {
      for (const [kind, value] of Object.entries(v.orbs)) {
        const el = root.querySelector(`[data-orb="${kind}"]`);
        if (!el) continue;
        const text = el.querySelector('.orb-value');
        if (text && text.textContent !== String(value.text)) text.textContent = String(value.text);
        if (el.getAttribute('aria-label') !== value.label) el.setAttribute('aria-label', value.label);
      }
    };
    function paintMinimap(force = false) {
      const canvas = root.querySelector('.hud-minimap');
      if (!canvas || typeof canvas.getContext !== 'function') return;
      const area = shell.area?.() || {};
      const tile = area.area === 'elsewhere' ? null : shell.world('miloTile');
      const explored = Array.isArray(shell.state?.wilds?.explored) ? shell.state.wilds.explored : [];
      const signature = tile ? `${tile.x},${tile.y}:${explored.length}` : `inside:${area.area}`;
      if (!force && signature === painted) return;
      painted = signature;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = FOG;
      ctx.fillRect(0, 0, MINIMAP, MINIMAP);
      const plan = minimapPlan(tile, { explored });
      let missing = false;
      for (const chunk of plan.chunks) {
        if (chunk.fog) continue;
        let image = chunkCanvases.get(chunk.key) || null;
        if (!image) {
          // Only a painted chunk is kept: one the world couldn't paint yet (not ready, or the
          // chunk not made yet) is asked for again on the next second.
          image = shell.world('paintMapChunk', chunk.cx, chunk.cy, 1) || null;
          if (image) {
            if (chunkCanvases.size >= 36) chunkCanvases.delete(chunkCanvases.keys().next().value);
            chunkCanvases.set(chunk.key, image);
          } else {
            missing = true;
          }
        }
        if (image) ctx.drawImage(image, chunk.dx, chunk.dy);
      }
      // Something is still blank: forget this paint, so the next 'second' tries again.
      if (missing) painted = '';
      if (plan.milo) {
        ctx.fillStyle = INK;
        ctx.fillRect(plan.milo.x - 1, plan.milo.y - 1, 3, 3);
      }
    }
    // The minimap repaints on 'second' only (once a second, and only while visible), and once
    // straight away when the HUD is built.
    function render() {
      const v = view();
      const next = `${v.mode}:${v.inside}:${v.sneaking}`;
      const html = doc.documentElement;
      if (html?.dataset && html.dataset.hud !== v.mode) html.dataset.hud = v.mode;
      if (next !== shape) {
        const active = doc.activeElement;
        const focusKey = active && root.contains(active) ? active.getAttribute?.('data-focus-key') : null;
        shape = next;
        root.innerHTML = buildHud(v);
        root.setAttribute('data-mode', v.mode);
        painted = '';
        if (focusKey) root.querySelector(`[data-focus-key="${focusKey}"]`)?.focus?.({ preventScroll: true });
        report();
        if (v.mode === 'adventure') paintMinimap(true);
      } else {
        orbsInPlace(v);
      }
    }

    const onClick = (event) => {
      const button = event.target?.closest?.('[data-action]');
      if (!button || !root.contains(button)) return;
      const action = button.getAttribute('data-action');
      if (action === 'hud-mode') setHudMode(shell, button.getAttribute('data-mode'));
      else if (action === 'hud-orb-ember') shell.openPanel('chronicle');
      else if (action === 'hud-orb-focus') shell.openPanel('kindle');
      else if (action === 'hud-orb-mana') {
        const mana = manaView(shell.snapshot?.(), shell.now());
        shell.bubble({ kind: 'note', title: 'Mana', lines: [mana.line], duration: 6000 });
      } else if (action === 'hud-sneak') {
        sneaking = !sneaking;
        shell.world('setSneak', sneaking);
        render();
      } else if (action === 'hud-tab') {
        const target = hudTabTarget(button.getAttribute('data-tab'), { state: shell.state });
        if (!target) return;
        if (target.kind === 'panel') shell.openPanel(target.panel, target.opts);
        else if (target.kind === 'log') showTab(target.tab);
        else if (target.kind === 'say') shell.bubble({ kind: 'note', title: target.title, lines: target.lines, duration: 6000 });
      }
    };

    root.addEventListener('click', onClick);
    globalThis.addEventListener?.('resize', report);
    if (typeof shell.on === 'function') {
      offs.push(shell.on('state', () => render()));
      offs.push(shell.on('snapshot', () => render()));
      offs.push(shell.on('hud', () => render()));
      offs.push(shell.on('area', () => { sneaking = false; chunkCanvases.clear(); render(); }));
      offs.push(shell.on('second', () => {
        const v = view();
        orbsInPlace(v);
        if (v.mode === 'adventure') paintMinimap();
      }));
    }
    mounted = { shell, render };
    render();
    return {
      dispose() {
        for (const off of offs) if (typeof off === 'function') off();
        root.removeEventListener('click', onClick);
        globalThis.removeEventListener?.('resize', report);
        if (mounted?.shell === shell) mounted = null;
        chunkCanvases.clear();
      },
      refresh() { shape = ''; render(); },
    };
  } catch (err) {
    console.error('[MILO] hud mount', err);
    return NOOP;
  }
}
