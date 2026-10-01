// The shell's side of the frontier (CONTRACT-PHASE3 §5, §8): the rift loop that turns a snapshot
// into rifts, echoes and Milo's bubbles, the wild state the engine draws from, the War Table's
// groups, and the plain words for where a rift stands and where Milo is. Pure ESM with no DOM, so
// it runs in Node for tests; the shell only applies what it returns.
import { deriveSignals, buildRealRifts, reconcileRifts, sealedSummary, bellText, dayNumber, dayText, whenText, WARD_POST_RULES } from '../rifts.js';
import { settleStory, prologueStatus } from '../story.js';
import { tallyFinished } from '../model.js';
import { hearthTier, wardRadius as hearthWardRadius } from '../hearth.js';
import { leadDisplayName } from '../world/leadname.js';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

export const STAGE_WORDS = Object.freeze({ hairline: 'Hairline', open: 'Open', gaping: 'Gaping' });
export const HEART_SIZE = Object.freeze({ w: 64, h: 44 });
export const CLOSED_DAYS = 3;
const GATE_WORDS = Object.freeze({ n: 'north', w: 'west', e: 'east', sw: 'south-west' });

/** A tile inside Hearthvale (world tiles [0,64) × [0,44)). */
export const inHeart = (x, y) => finite(x) && finite(y) && x >= 0 && y >= 0 && x < HEART_SIZE.w && y < HEART_SIZE.h;

/** A snapshot MILO can read rifts from: at least one source is ok. */
export function snapshotUsable(snapshot) {
  return isRecord(snapshot) && isRecord(snapshot.sources)
    && Object.values(snapshot.sources).some((source) => isRecord(source) && source.ok === true);
}

// ---------------------------------------------------------------------------
// Genres and places, from the content bundle.

/** genre id → { id, name, kind, rim (hex), ground (hex) } from content.genres. */
export function genreTable(genresContent) {
  const list = isRecord(genresContent) && Array.isArray(genresContent.genres) ? genresContent.genres : [];
  const out = new Map();
  for (const genre of list) {
    if (!isRecord(genre) || typeof genre.id !== 'string') continue;
    const roles = isRecord(genre.roles) ? genre.roles : {};
    const rimRole = isRecord(genre.rift) ? genre.rift.rim : null;
    const innerRole = isRecord(genre.rift) ? genre.rift.inner : null;
    out.set(genre.id, {
      id: genre.id,
      name: typeof genre.name === 'string' ? genre.name : genre.id,
      kind: genre.kind || 'shadow',
      rim: typeof roles[rimRole] === 'string' ? roles[rimRole] : '#9cbfdc',
      inner: typeof roles[innerRole] === 'string' ? roles[innerRole] : '#3d4038',
      ground: typeof roles.ground === 'string' ? roles.ground : '#aad48f',
    });
  }
  return out;
}

/** The genres of a rift as chips: [{ id, name, rim }]. */
export function genreChips(rift, genres) {
  const ids = Array.isArray(rift?.spec?.genres) ? rift.spec.genres : Array.isArray(rift?.genres) ? rift.genres : [];
  return ids.map((id) => genres.get(id) || { id, name: String(id).replace(/^./, (c) => c.toUpperCase()), rim: '#9cbfdc' });
}

/** anchor id → its name, from a worldgen's anchors. */
export function anchorNames(worldgen) {
  const out = new Map();
  for (const anchor of Array.isArray(worldgen?.anchors) ? worldgen.anchors : []) {
    if (anchor && typeof anchor.id === 'string') out.set(anchor.id, anchor.name || anchor.id);
  }
  return out;
}

/** 'The Whisperwood' reads 'the Whisperwood' mid-sentence; 'Cinderforge' stays. */
export const midName = (name) => String(name || '').replace(/^The /, 'the ');
const capFirst = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

/**
 * A name as it starts a title, a label or a sentence: 'the Keeper of Letters Wren' (a Tale-lead
 * named for the middle of a line) reads 'The Keeper of Letters Wren'. Anything else is left alone.
 */
export const startName = (name) => capFirst(String(name ?? ''));

// ---------------------------------------------------------------------------
// The rift loop: deriveSignals → buildRealRifts → reconcileRifts, with the counts and the story.

/**
 * One pass of the rift loop. Counts finished sessions, settles the Prologue steps that are
 * already true, then derives, builds and reconciles the real rifts.
 * → { state, rifts, opened, sealed, closed, bell, notify, completed, tier, wardRadius, hasSessions }
 * `closed`: Nocturnes the evening bell no longer covers (moved or switched off), which go quietly,
 * never as a seal. A redesign keeps its building's bright rift (rifts.js reads firstBuiltAt).
 * `state` is the same object when nothing changed.
 *
 * Phase 4 (CONTRACT-PHASE4.md §12.4 "L", §4.18, §4.20): with `phase4` (phase4Passes' object, made
 * from the modules the shell loaded for the areas phase4Problem passes), the loop also runs these
 * pure passes: tallyAnswered after tallyFinished; then, once the rifts are reconciled (so a seal
 * pays in the same pass), payFromSignals, payLifeFromSignals, topUpCrewGifts and payRealStitches;
 * and last it clears an expedition whose place has closed. It also returns { paid (the Ember ledger
 * entries paid), drops (life-XP drops), stitches (real stitches paid) }. Without `phase4` it's
 * Phase 3's loop exactly.
 */
export function runRiftLoop({ state, snapshot = null, now, content = null, riftgen = null, worldgen = null, isFree = null, dryRun = false, phase4 = null }) {
  const tier = hearthTier(state);
  const ward = hearthWardRadius(state, content?.fortress ?? null);
  if (dryRun) {
    // Before the first look at the crew: the rifts the state already knows, placed, and nothing changed.
    const signals = deriveSignals({ snapshot: null, state, now, story: content?.story ?? null });
    const rifts = buildRealRifts({ signals, state, now, riftgen, worldgen, wardRadius: ward, isFree });
    return { state, rifts, opened: [], sealed: [], closed: [], bell: [], notify: false, completed: [], tier, wardRadius: ward, hasSessions: false, paid: [], drops: [], stitches: 0 };
  }
  let next = state;
  const usable = snapshotUsable(snapshot);
  if (usable) next = tallyFinished(next, snapshot, now);
  if (usable && typeof phase4?.tallyAnswered === 'function') next = pass('tallyAnswered', next, () => phase4.tallyAnswered(next, snapshot, now));
  const hasSessions = usable && Array.isArray(snapshot.sessions) && snapshot.sessions.length > 0;
  const settled = settleStory(next, content?.story ?? null, { hasSessions }, now);
  next = settled.state;
  const signals = deriveSignals({ snapshot, state: next, now, story: content?.story ?? null });
  const rifts = buildRealRifts({ signals, state: next, now, riftgen, worldgen, wardRadius: ward, isFree });
  const result = reconcileRifts(next, rifts, now, { tier });
  const extra = phase4 ? phase4Pass(result.state, { now, rifts, usable, phase4 }) : { state: result.state, paid: [], drops: [], stitches: 0 };
  return {
    state: extra.state,
    rifts,
    opened: result.opened,
    sealed: result.sealed,
    closed: Array.isArray(result.closed) ? result.closed : [],
    bell: result.bell,
    notify: result.notify,
    completed: settled.completed,
    tier,
    wardRadius: ward,
    hasSessions,
    paid: extra.paid,
    drops: extra.drops,
    stitches: extra.stitches,
  };
}

// A Phase 4 pass that throws leaves the state as it was (and says so in the console), never the loop.
function pass(name, state, fn) {
  try {
    return fn() ?? state;
  } catch (error) {
    console.error(`[MILO] ${name}`, error);
    return state;
  }
}

function phase4Pass(state, { now, rifts, usable, phase4 }) {
  let next = state;
  let paid = [];
  let drops = [];
  let stitches = 0;
  if (typeof phase4.payFromSignals === 'function') {
    const r = pass('payFromSignals', null, () => phase4.payFromSignals(next, now, phase4.economy ?? null));
    if (r) { next = r.state; paid = Array.isArray(r.paid) ? r.paid : []; }
  }
  if (typeof phase4.payLifeFromSignals === 'function') {
    const r = pass('payLifeFromSignals', null, () => phase4.payLifeFromSignals(next, now, phase4.xp ?? null));
    if (r) { next = r.state; drops = Array.isArray(r.drops) ? r.drops : []; }
  }
  if (typeof phase4.topUpCrewGifts === 'function') next = pass('topUpCrewGifts', next, () => phase4.topUpCrewGifts(next, now));
  if (typeof phase4.payRealStitches === 'function' && isRecord(phase4.rules)) {
    const r = pass('payRealStitches', null, () => phase4.payRealStitches(next, now, { rules: phase4.rules, xp: phase4.xp ?? null }));
    if (r) { next = r.state; stitches = finite(r.paid) ? r.paid : 0; }
  }
  // A real rift's episode is judged closed only on a real look at the crew (a watcher hiccup carries it).
  if (typeof phase4.clearClosed === 'function') next = pass('clearClosed', next, () => phase4.clearClosed(next, { now, rifts: usable ? rifts : null }));
  return { state: next, paid, drops, stitches };
}

/**
 * The Phase 4 passes for runRiftLoop, from the modules the shell loaded (state4, embers, lifeskills,
 * party, expedition) and phase4Problem's result: groundwork's (tallyAnswered, payFromSignals,
 * payLifeFromSignals) when that area is sound, and the party's (topUpCrewGifts, payRealStitches with
 * the loaded combat `rules`, and the expedition's clearClosed) when combat and party both are. A
 * missing module or a broken area leaves its passes out, so the loop never depends on a Phase 4
 * file to stand the wilds up. → the object runRiftLoop takes, or null.
 */
export function phase4Passes({ state4 = null, embers = null, lifeskills = null, party = null, expedition = null } = {}, { problem = null, content = null, rules = null } = {}) {
  const sound = (area) => !isRecord(problem) || problem[area] == null;
  const out = { economy: content?.economy ?? null, xp: content?.xp ?? null };
  if (sound('groundwork')) {
    if (typeof state4?.tallyAnswered === 'function') out.tallyAnswered = state4.tallyAnswered;
    if (typeof embers?.payFromSignals === 'function') out.payFromSignals = embers.payFromSignals;
    if (typeof lifeskills?.payLifeFromSignals === 'function') out.payLifeFromSignals = lifeskills.payLifeFromSignals;
  }
  if (sound('combat') && sound('party')) {
    if (typeof party?.topUpCrewGifts === 'function') out.topUpCrewGifts = party.topUpCrewGifts;
    if (typeof party?.payRealStitches === 'function' && isRecord(rules)) { out.payRealStitches = party.payRealStitches; out.rules = rules; }
    if (typeof expedition?.clearClosed === 'function') out.clearClosed = expedition.clearClosed;
  }
  return Object.values(out).some((v) => typeof v === 'function') ? out : null;
}

/** A short signature of what the engine draws for these rifts, so unchanged lists aren't resent. */
export function riftsSignature(rifts) {
  return (Array.isArray(rifts) ? rifts : [])
    .map((r) => `${r.id}@${r.x},${r.y}:${r.stage}:${r.warded ? r.warded.stage : ''}:${r.held ? 'h' : ''}:${r.bright ? 'b' : ''}`)
    .join('|');
}

/** Echoes of the rifts standing now, for world.setEchoes: [{ id, riftId, place, icon, genre, label }]. */
export function echoesFor(rifts) {
  const out = [];
  for (const rift of Array.isArray(rifts) ? rifts : []) {
    if (!rift || rift.held || !(rift.kind === 'real' || rift.kind === 'story') || !isRecord(rift.echo)) continue;
    if (typeof rift.echo.place !== 'string' || typeof rift.echo.icon !== 'string') continue;
    const name = rift.spec?.name || 'a rift';
    out.push({
      id: `echo:${rift.id}`,
      riftId: rift.id,
      place: rift.echo.place,
      icon: rift.echo.icon,
      genre: Array.isArray(rift.spec?.genres) ? rift.spec.genres[0] ?? null : null,
      label: rift.bright ? `A bright echo · ${name}` : `An echo · ${name}`,
    });
  }
  return out;
}

/**
 * What the engine needs about the wilds today:
 * { day, tier, wardRadius, closed, lit, opened, felled, notes, glimmers, visited } (visited: rift ids
 * whose Elsewhere chest was claimed, so it stands open).
 */
export function wildStateOf(state, now, { tier = hearthTier(state), wardRadius = 0 } = {}) {
  const day = dayNumber(now);
  const wilds = isRecord(state?.wilds) ? state.wilds : {};
  const closedWild = isRecord(state?.rifts?.closedWild) ? state.rifts.closedWild : {};
  const felled = isRecord(wilds.felled) ? wilds.felled : {};
  const keys = (map) => (isRecord(map) ? Object.keys(map) : []);
  return {
    day,
    tier,
    wardRadius,
    closed: Object.keys(closedWild).filter((id) => closedWild[id] === day),
    lit: keys(wilds.lanterns),
    opened: keys(wilds.opened),
    felled: Object.keys(felled).filter((id) => felled[id] === day),
    notes: keys(wilds.notes),
    glimmers: keys(wilds.glimmers),
    visited: keys(state?.rifts?.visited),
  };
}

// ---------------------------------------------------------------------------
// Where a rift stands, in plain words.

/** '10 tiles out, toward Cinderforge', '4 tiles past the north gate', 'The ward-post holds it, so it hasn’t opened'. */
export function riftWhere(rift, anchors = new Map()) {
  if (!rift) return '';
  if (rift.held) return 'The ward-post holds it, so it hasn’t opened';
  if (!finite(rift.x) || !finite(rift.y)) return '';
  const beyond = finite(rift.beyond) ? Math.max(0, Math.round(rift.beyond)) : null;
  const out = beyond === null ? 'Out on the frontier' : beyond === 0 ? 'At the edge of the ward' : `${beyond} ${beyond === 1 ? 'tile' : 'tiles'} out`;
  if (rift.kind === 'story') return beyond ? `${beyond} ${beyond === 1 ? 'tile' : 'tiles'} past the north gate` : 'Just past the north gate';
  const toward = typeof rift.towards === 'string' ? anchors.get(rift.towards) : null;
  return toward ? `${out}, toward ${midName(toward)}` : out;
}

/**
 * The rift's stage as a tag. A ward holds a rift at the stage it had, so a warded one reads as
 * that stage and the ward: 'Open', 'Gaping · warded'.
 */
export function stageWord(rift) {
  const stage = STAGE_WORDS[rift?.warded?.stage || rift?.stage] || 'Open';
  return rift?.warded ? `${stage} · warded` : stage;
}

/**
 * The stage tag a rift shows in its panel and its row. A held rift hasn't opened, and a bright one
 * is a gift that never grows, so both say that instead of a stage.
 */
export function stageTag(rift) {
  if (rift?.held) return 'Held back';
  if (rift?.bright) return 'Bright';
  return stageWord(rift);
}

// What kind of real thing a rift stands for, in the words of its cause (never a genre's name).
const REAL_KIND_TAGS = Object.freeze({ nocturne: 'Late night', knocking: 'Waiting on you', capacity: 'Crew capacity', built: 'New building', stale: 'Waiting quests', crowded: 'Too much at once', vague: 'Too vague', due: 'Due soon' });

/** The small outlined tag beside a rift's stage: 'Waiting on you', 'The Prologue', 'Wild'. */
export function kindTag(rift) {
  if (!rift) return '';
  if (rift.kind === 'story') return 'The Prologue';
  if (rift.kind === 'wild' || rift.kind === 'ladder') return 'Wild';
  if (rift.kind === 'real') return REAL_KIND_TAGS[rift.realKind] || 'Real';
  return '';
}

/** 'The ward holds until Tuesday at 14:20.' */
export function wardUntilText(rift, now) {
  if (!rift?.warded || !finite(rift.warded.until)) return '';
  return `The ward holds until ${whenText(rift.warded.until, now).replace(/^on /, '')}. It won’t grow or ring the Gate Bell until then.`;
}

/** The ward-post rule that holds a rift back: { id, name, text } or null. */
export function heldRule(rift) {
  if (!rift?.held) return null;
  return WARD_POST_RULES.find((rule) => rule.id === rift.held) || { id: rift.held, name: 'The ward-post', text: '' };
}

/**
 * What a rift's panel and rows offer, by kind and where Milo is. `inside`: Milo is in this rift's
 * Elsewhere. `away`: he's inside another rift's Elsewhere, so he has to leave it before he can set
 * off for this one (Leave stands in for Step through, Visit and Show me).
 * `field` (Phase 4, §12.4): the rift's Tale-lead is a field boss (fieldboss.isFieldBoss), so a wild
 * rift also offers Challenge, the only way its fight starts, until it's been `challenged` today.
 */
export function riftActions(rift, { via = 'list', inside = false, stitched = false, away = false, field = false, challenged = false } = {}) {
  if (!rift) return [];
  if (inside) {
    if (stitched) return rift.kind === 'wild' ? ['deeper', 'leave'] : ['leave'];
    if (rift.kind === 'real') return ['leave'];
    return ['stitch', 'leave'];
  }
  if (rift.held) return ['war-table'];
  const step = away ? 'leave' : via === 'echo' ? 'show' : 'step';
  if (rift.bright) return [away ? 'leave' : via === 'echo' ? 'show' : 'visit', 'let-be'];
  if (rift.kind === 'story') return [step];
  if (rift.kind === 'wild') return field && !challenged && !away ? [step, 'challenge', 'let-go'] : [step, 'let-go'];
  return [step, rift.warded ? 'unward' : 'ward', 'let-go'];
}

/**
 * Whether a rift Milo set off for still stands once he gets there. A real or story rift stands
 * while it's among the rifts standing now (`standing`); a wild one while the shell still holds it
 * for today (`known`, a Map or Set of ids; a new day drops yesterday's) and it wasn't stitched or
 * let go today (`closedWild`, id → day). A sealed, faded or let-go rift has no tear to step into.
 */
export function stillStanding(rift, { standing = [], known = null, closedWild = null, day = null } = {}) {
  if (!isRecord(rift) || typeof rift.id !== 'string') return false;
  if (rift.kind === 'wild' || rift.kind === 'ladder') {
    if (known && typeof known.has === 'function' && !known.has(rift.id)) return false;
    return !(isRecord(closedWild) && finite(day) && closedWild[rift.id] === day);
  }
  return (Array.isArray(standing) ? standing : []).some((r) => r?.id === rift.id);
}

/** What a row in a list offers (the panel has the rest): ward or unward, and let go. */
export function rowActions(rift) {
  if (!rift || rift.held || rift.kind !== 'real') return [];
  if (rift.bright) return ['let-be'];
  return [rift.warded ? 'unward' : 'ward', 'let-go'];
}

// ---------------------------------------------------------------------------
// The War Table.

// A rift "at the walls" is one pressing hard enough to ring the Gate Bell; it still stands a few
// tiles out past the ward, so its heading says close, and its row says how far.
const GROUPS = [
  ['walls', 'Close to the walls'],
  ['frontier', 'On the frontier'],
  ['bright', 'Bright'],
  ['held', 'Held by the ward-post'],
  ['warded', 'Warded'],
  ['closed', 'Recently closed'],
];

const HOW_WORDS = { sealed: 'Sealed', stitched: 'Stitched', 'let-go': 'Let go', closed: 'Closed' };

/**
 * How a closed rift went, as the start of its tag: 'Sealed', 'Let go'. A bright rift (a new
 * building's) was never a tear to mend, so however it went, it faded.
 */
export function closedWord(entry) {
  if (typeof entry?.key === 'string' && entry.key.startsWith('built:')) return 'Faded';
  return HOW_WORDS[entry?.how] || 'Closed';
}

/**
 * The War Table's groups, in order, with the empty ones left out:
 * [{ id, title, rifts: Rift[] }] plus the closed group as { id: 'closed', title, closed: [{ key, id, name, genres, kind, how, text }] }.
 * A rift standing again (a Nocturne back once the evening bell is on again) isn't also listed as closed.
 */
export function warGroups(rifts, state, now, { closedDays = CLOSED_DAYS, closedMax = 6 } = {}) {
  const lists = { walls: [], frontier: [], bright: [], held: [], warded: [] };
  const standing = new Set();
  for (const rift of Array.isArray(rifts) ? rifts : []) {
    if (!rift || (rift.kind !== 'real' && rift.kind !== 'story')) continue;
    if (typeof rift.key === 'string') standing.add(rift.key);
    if (rift.held) lists.held.push(rift);
    else if (rift.bright) lists.bright.push(rift);
    else if (rift.warded) lists.warded.push(rift);
    else if (rift.atWalls) lists.walls.push(rift);
    else lists.frontier.push(rift);
  }
  const byUrgency = (a, b) => (b.urgency || 0) - (a.urgency || 0);
  const history = Array.isArray(state?.rifts?.history) ? state.rifts.history : [];
  const since = now - closedDays * 24 * 3600 * 1000;
  const closed = history
    .filter((entry) => isRecord(entry) && finite(entry.closedAt) && entry.closedAt >= since && entry.kind !== 'wild' && !standing.has(entry.key))
    .slice(0, closedMax)
    .map((entry) => ({ ...entry, text: `${closedWord(entry)} ${dayText(entry.closedAt, now)}` }));
  const out = [];
  for (const [id, title] of GROUPS) {
    if (id === 'closed') {
      if (closed.length) out.push({ id, title, closed });
    } else if (lists[id].length) {
      out.push({ id, title, rifts: lists[id].sort(byUrgency) });
    }
  }
  return out;
}

/** The evening bell's choices: Off, then 20:00 to 01:00 in half hours (and the saved time if it's another). */
export function eveningBellOptions(current = '22:00') {
  const out = [{ value: '', label: 'Off' }];
  for (let minutes = 20 * 60; minutes <= 25 * 60; minutes += 30) {
    const h = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    out.push({ value, label: value });
  }
  if (typeof current === 'string' && current && !out.some((option) => option.value === current)) out.push({ value: current, label: current });
  return out;
}

// ---------------------------------------------------------------------------
// Where Milo is.

/** Title bar words for an area: 'The Whisperwood · waiting in the Hush', 'Inside the Crowded Crypt · depth 4'. */
export function areaStatus(info) {
  if (!isRecord(info)) return '';
  if (info.area === 'elsewhere') {
    const name = midName(info.rift?.name || 'an Elsewhere');
    return finite(info.depth) ? `Inside ${name} · depth ${info.depth}` : `Inside ${name}`;
  }
  if (info.area === 'wilds') {
    const name = capFirst(String(info.regionName || 'The wilds'));
    return info.hush ? `${name} · waiting in the Hush` : name;
  }
  return '';
}

const VALE_LABEL = "Milo's world. A pixel map with Milo's camp, the watchtower, and plots where your buildings go. Use the arrow keys to walk, or the place list to visit a spot.";
// Only with the wilds open (the shell sets area labels only then).
const VALE_GATES = ' Four gates in the tree line, north, west, east and south-west, lead out to the wilds. The place list walks Milo to each.';

/** The canvas's aria-label for an area. */
export function areaLabel(info) {
  if (isRecord(info) && info.area === 'elsewhere') {
    return `Milo's world, inside ${midName(info.rift?.name || 'an Elsewhere')}, a pocket world through a rift. Use the arrow keys to walk. The Leave button at the top takes Milo back out.`;
  }
  if (isRecord(info) && info.area === 'wilds') {
    const where = midName(info.regionName || 'the wilds');
    const hush = info.hush ? ' It waits in the Hush.' : '';
    return `Milo's world, out in ${where} beyond Hearthvale.${hush} Use the arrow keys to walk, or the place list to see what's nearby.`;
  }
  return VALE_LABEL + VALE_GATES;
}

export const GATE_NAMES = Object.freeze(Object.fromEntries(Object.entries(GATE_WORDS).map(([id, word]) => [id, `The ${word} gate`])));

// Where each gate's road leads first (worldgen's Long Road: the north gate to the Whisperwood…).
const GATE_ROADS = Object.freeze({ n: 'whisperwood', w: 'cinderforge', e: 'mistmere', sw: 'dicing-downs' });
const GATE_ORDER = ['n', 'w', 'e', 'sw'];

/**
 * The vale's gates for the place list, so the wilds can be reached without seeing the map:
 * [{ id: 'gate:n', short: 'n', title: 'North gate', note: 'To the Whisperwood' }], `anchors` giving
 * the regions' names. Each is walked out through (`gates`: worldgen's GATES, edge and way out) to
 * `out`, the first tile of its road past the tree line.
 */
export function gateEntries(anchors = new Map(), gates = null) {
  return GATE_ORDER.map((short) => {
    const word = GATE_WORDS[short];
    const land = anchors.get(GATE_ROADS[short]);
    const gate = isRecord(gates) ? gates[`gate:${short}`] : null;
    const out = gate && isRecord(gate.edge) && isRecord(gate.dir)
      ? { x: gate.edge.x + gate.dir.x * 3, y: gate.edge.y + gate.dir.y * 3 }
      : null;
    return { id: `gate:${short}`, short, title: `${capFirst(word)} gate`, note: land ? `To ${midName(land)}` : 'To the wilds', out };
  });
}

// ---------------------------------------------------------------------------
// Milo's words about rifts. Calm, the real cause first.

const listWords = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** One line about rifts for the greeting at launch: seals first, else what opened while MILO was closed. */
export function bootRiftLine({ sealed = [], opened = [] } = {}) {
  const seals = sealedSummary(sealed);
  if (seals) return seals;
  const fresh = (Array.isArray(opened) ? opened : []).filter((r) => r && !r.bright && !r.held);
  if (!fresh.length) return null;
  if (fresh.length > 1) return `${fresh.length} rifts are open on the frontier. The watchtower lists them.`;
  return openedLine(fresh[0]);
}

function openedLine(rift) {
  if (rift.kind === 'story') return 'Something is pressing on the page, just past the north gate.';
  switch (rift.realKind) {
    case 'knocking': return rift.subject ? `A rift has opened over ${rift.subject}, which is waiting on you.` : 'A rift has opened over a session that’s waiting on you.';
    case 'capacity': return 'A rift has opened over Codex’s allowance.';
    case 'nocturne': return 'A rift opened past your evening bell.';
    case 'stale': return 'A rift has opened over the quests that have waited a while.';
    case 'crowded': return 'A rift has opened over too much in progress.';
    case 'vague': return 'A rift has opened over a quest too vague to start.';
    case 'due': return 'A rift has opened over a deadline.';
    default: return 'A rift has opened on the frontier.';
  }
}

const lootLine = (loot) => {
  const items = (Array.isArray(loot) ? loot : []).filter((item) => item && !item.relic && typeof item.item === 'string').slice(0, 2).map((item) => `${item.item.charAt(0).toLowerCase()}${item.item.slice(1)} × ${item.qty}`);
  return items.length ? `It left ${listWords(items)} in your satchel.` : '';
};

/** Bubbles for a loop pass after launch: at most one each for opened, sealed and story, one per bell. */
export function loopBubbles({ opened = [], sealed = [], bell = [], completed = [], story = null, state = null, warTable = false } = {}) {
  const out = [];
  for (const rift of bell) {
    const words = bellText(rift);
    out.push({
      kind: 'bell', title: words.title, lines: [words.body], place: warTable ? 'war-table' : rift.id,
      actions: [{ id: 'show', label: 'Show me' }, { id: 'later', label: 'Later' }],
    });
  }
  const fresh = opened.filter((r) => r && !r.bright && !r.held && !bell.includes(r));
  if (fresh.length) {
    const [first] = fresh;
    out.push({
      kind: 'rift',
      title: fresh.length > 1 ? `${fresh.length} rifts opened on the frontier` : first.kind === 'story' ? 'A crack past the north gate' : 'A rift opened on the frontier',
      lines: [first.cause].filter(Boolean),
      place: first.id,
      actions: [{ id: 'show', label: 'Show me' }, { id: 'later', label: 'Later' }],
    });
  }
  const seals = sealed.filter((s) => s && !s.bright);
  if (seals.length) {
    const [first] = seals;
    const lines = seals.length > 1
      ? [`${listWords(seals.slice(0, 3).map((s) => s.name || 'a rift'))} closed now the real things are done.`]
      : [`${first.name || 'The rift'} closed now the real thing is done.`, lootLine(first.loot)].filter(Boolean);
    out.push({ kind: 'sealed', title: seals.length > 1 ? `${seals.length} rifts sealed themselves` : 'A rift sealed itself', lines, actions: [{ id: 'later', label: 'Nice' }] });
  }
  if (completed.length && state) {
    const status = prologueStatus(state, story, {});
    const titles = completed.map((id) => status.steps.find((step) => step.id === id)?.title).filter(Boolean);
    const next = status.steps.find((step) => step.current);
    if (titles.length) {
      out.push({
        kind: 'story',
        title: 'The Prologue moves on',
        lines: [`${listWords(titles.map((t) => `“${t}”`))} ${titles.length > 1 ? 'are' : 'is'} done.`, next ? `Next: ${next.hint}` : 'That’s the whole Prologue. The Lantern is awake.'],
        place: 'story',
        actions: [{ id: 'show', label: 'Show me' }, { id: 'later', label: 'Later' }],
      });
    }
  }
  return out;
}

/** Where to go for a place list entry, and the gate words: 'the north gate'. */
export const gateWord = (short) => GATE_WORDS[short] || 'north';

// ---------------------------------------------------------------------------
// Inside an Elsewhere.

/**
 * The places in an Elsewhere worth listing wherever Milo stands in it, from riftgen's layout: the
 * tear, the Tale-lead, the chests, the curio and the way home, with the ids the engine gives them
 * (so world.walkToEntity(id) finds each one even out of view).
 * → [{ id, kind, x, y, label }] in that order. A mended tear isn't listed.
 * `refused`: a real rift's seam, which won't take the thread. `opened`: its chests were claimed.
 * Phase 4 (§12.4): with `plan` (a fight-ready place's ArenaPlan) it also lists a cave's added
 * chests (`loot:<n>` after the layout's own) and the hearth-nook, before the way home; with
 * `encounters` a cave's locked chest reads "A locked chest"; `chests` (expedition.chests) marks
 * the ones opened. A cave (`spec.kind === 'cave'`) has no seam and no Tale-lead. The Tale-lead's name
 * is leadDisplayName's (`words` riftgen.json and `hooks` leads.json's names), as the scene shows it.
 */
export function elsewhereLandmarks(spec, layout, { stitched = false, refused = false, opened = false, plan = null, encounters = null, chests = null, words = null, hooks = [] } = {}) {
  if (!isRecord(layout)) return [];
  const at = (spot) => isRecord(spot) && finite(spot.x) && finite(spot.y);
  const cave = spec?.kind === 'cave';
  const locked = new Set((Array.isArray(encounters?.chests) ? encounters.chests : []).filter((c) => c?.locked).map((c) => c.id));
  const open = (id) => opened || (isRecord(chests) && Object.hasOwn(chests, id));
  const chestLabel = (id) => (open(id) ? 'An open chest' : locked.has(id) ? 'A locked chest' : 'A chest');
  const out = [];
  if (!cave && !stitched && at(layout.stitch)) {
    out.push({ id: 'stitch', kind: 'stitch', x: layout.stitch.x, y: layout.stitch.y, label: refused ? 'The seam, holding for now' : 'The seam · stitch it' });
  }
  if (!cave && isRecord(spec?.taleLead) && at(layout.boss)) {
    out.push({ id: 'tale-lead', kind: 'tale-lead', x: layout.boss.x, y: layout.boss.y, label: leadDisplayName(spec, words, { hooks }) || 'The Tale-lead' });
  }
  const loot = Array.isArray(layout.loot) ? layout.loot : [];
  loot.forEach((spot, n) => {
    if (at(spot)) out.push({ id: `loot:${n}`, kind: 'loot', x: spot.x, y: spot.y, label: chestLabel(`loot:${n}`) });
  });
  (Array.isArray(plan?.chests) ? plan.chests : []).forEach((spot, i) => {
    const lid = `loot:${loot.length + i}`;
    if (at(spot)) out.push({ id: lid, kind: 'loot', x: spot.x, y: spot.y, label: chestLabel(lid) });
  });
  if (at(layout.puzzle)) out.push({ id: 'curio', kind: 'curio', x: layout.puzzle.x, y: layout.puzzle.y, label: 'A curio' });
  if (at(plan?.nook)) out.push({ id: 'nook', kind: 'nook', x: plan.nook.x, y: plan.nook.y, label: 'Hearth-nook · rest here' });
  if (at(layout.entrance)) out.push({ id: 'exit', kind: 'exit', x: layout.entrance.x, y: layout.entrance.y, label: 'The way home' });
  return out;
}

/**
 * The place list inside an Elsewhere: in a fight its combatants first (`kind: 'combatant'`, in the
 * engine's order), then its landmarks (wherever they are), then whatever else is in view (strays),
 * nearest first, each once.
 */
export function elsewhereEntries(landmarks, inView, tile = null) {
  const seen = new Set();
  const out = [];
  for (const e of Array.isArray(inView) ? inView : []) {
    if (!isRecord(e) || e.kind !== 'combatant' || typeof e.id !== 'string' || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  for (const mark of Array.isArray(landmarks) ? landmarks : []) {
    if (!mark || seen.has(mark.id)) continue;
    seen.add(mark.id);
    out.push(mark);
  }
  const d = (e) => (tile && finite(e.x) ? Math.hypot(e.x - tile.x, e.y - tile.y) : 0);
  const rest = (Array.isArray(inView) ? inView : []).filter((e) => e && typeof e.id === 'string' && !seen.has(e.id));
  // An in-view entity the landmarks also name keeps the engine's words for it (an open chest).
  for (const e of inView || []) {
    if (!e || !seen.has(e.id)) continue;
    const i = out.findIndex((m) => m.id === e.id);
    if (i >= 0 && typeof e.label === 'string' && e.label) out[i] = { ...out[i], label: e.label };
  }
  rest.sort((a, b) => d(a) - d(b));
  for (const e of rest) {
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

/**
 * The landmarks of the Elsewhere Milo is in, from the engine's own list of its things
 * (world.elsewhereEntities()): the tear, the Tale-lead, the chests, the curio, the hearth-nook and
 * the way home, in that order, each once. Strays wander, so they come from what's in view instead.
 * → the same shape as elsewhereLandmarks, or null when the engine gave no list (the shell falls back
 * to the layout).
 */
export const LANDMARK_ORDER = Object.freeze(['stitch', 'tale-lead', 'loot', 'curio', 'nook', 'exit']);
export function engineLandmarks(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const out = [];
  for (const e of list) {
    if (!isRecord(e) || typeof e.id !== 'string' || seen.has(e.id) || !LANDMARK_ORDER.includes(e.kind)) continue;
    if (!finite(e.x) || !finite(e.y)) continue;
    seen.add(e.id);
    out.push({ id: e.id, kind: e.kind, x: e.x, y: e.y, label: typeof e.label === 'string' && e.label ? e.label : '' });
  }
  const rank = (e) => LANDMARK_ORDER.indexOf(e.kind);
  return out.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id, 'en', { numeric: true }));
}

// ---------------------------------------------------------------------------
// The content bundle, checked before the wilds open.

/**
 * Whether a content bundle can carry the Hearth and the wilds: genres and riftgen as objects, a
 * fortress with the Camp and the Stockade (tiers 1 and 2), and a riftgen made from it that can
 * make a real rift for every genre's signal and a wild one. A damaged file would otherwise leave
 * the Hearth saying it's as high as it goes, or no real rift ever opening, with nothing said.
 * → null when it can, else the file at fault (for the console, never shown to Chris).
 */
export function contentProblem(bundle, riftgen) {
  if (!isRecord(bundle)) return 'the content';
  const genreList = isRecord(bundle.genres) && Array.isArray(bundle.genres.genres) ? bundle.genres.genres.filter(isRecord) : [];
  if (!genreList.length) return 'genres.json';
  if (!isRecord(bundle.riftgen) || !isRecord(bundle.riftgen.genres)) return 'riftgen.json';
  const tiers = isRecord(bundle.fortress) && Array.isArray(bundle.fortress.tiers) ? bundle.fortress.tiers : [];
  if (![1, 2].every((tier) => tiers.some((def) => isRecord(def) && def.tier === tier))) return 'fortress.json';
  if (!riftgen || typeof riftgen.realRift !== 'function' || typeof riftgen.wildRift !== 'function') return 'riftgen.json';
  try {
    let real = 0;
    for (const genre of genreList) {
      const signal = Array.isArray(genre.signals) ? genre.signals.find((s) => typeof s === 'string') : null;
      if (!signal) continue;
      const spec = riftgen.realRift({ key: `check:${genre.id}`, subject: 'a check', signals: [signal], urgency: 0.9, tier: 1, cause: '' });
      if (!isRecord(spec) || typeof spec.id !== 'string' || typeof spec.name !== 'string') return 'riftgen.json';
      real += 1;
    }
    if (!real) return 'genres.json';
    const wild = riftgen.wildRift({ seed: 1, tier: 1, depth: 1 });
    if (!isRecord(wild) || typeof wild.id !== 'string') return 'riftgen.json';
  } catch {
    return 'riftgen.json';
  }
  return null;
}

// ---------------------------------------------------------------------------
// The engine's world, shared with the shell.

const WORLDGEN_CALLS = ['roads', 'terrainAt', 'walkable', 'naturalTerrain', 'inHeart', 'heartDistance', 'regionAt', 'fixedPois', 'placeRealRift', 'wildRiftSpawns', 'depthAt', 'chunk'];

/**
 * The engine's own worldgen (world.worldgen), when it shares a whole one. The shell then looks
 * places up in the very world the engine draws, and the roads (a tenth of a second to lay out) are
 * laid out once, not twice. null when there's none, and the shell makes its own from the seed.
 */
export function sharedWorldgen(world) {
  let wg = null;
  try {
    wg = world?.worldgen ?? null;
  } catch {
    return null;
  }
  if (!wg || typeof wg !== 'object' || !Array.isArray(wg.anchors)) return null;
  return WORLDGEN_CALLS.every((name) => typeof wg[name] === 'function') ? wg : null;
}

/**
 * The terrain the shell reads (for the reach test and the War Table's map): the engine's
 * (world.terrainAt, with the roads kept off the ring) when it has the wilds (world.worldgen), else
 * `fallback`'s (a wilds). A vale-only engine still has terrainAt, but it answers null beyond the
 * vale, so it's only read when its worldgen is there too. The engine answers the vale's own tiles
 * in the vale's own letters, so inside the heart it reads as `heart` (worldgen's TERRAIN.HEART),
 * exactly as a wilds answers there.
 * → (x, y) → terrain code, or null when neither can answer.
 */
export function terrainSource(world, fallback = null, { heart = 17 } = {}) {
  let hasWilds = false;
  try {
    hasWilds = Boolean(world?.worldgen);
  } catch {
    hasWilds = false;
  }
  if (hasWilds && typeof world.terrainAt === 'function') return (x, y) => (inHeart(x, y) ? heart : world.terrainAt(x, y));
  if (typeof fallback?.terrainAt === 'function') return (x, y) => fallback.terrainAt(x, y);
  return null;
}

// ---------------------------------------------------------------------------
// Where a real rift may stand: ground Milo can walk to.

const STEPS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * A test for "Milo can walk here from the vale", for placing real rifts: a walkable tile can still
 * sit in a pocket closed in by trees, water or rock. From the tile it searches outward over
 * `walkable` until it meets a road or bridge (`isRoad`; the roads join every region to the vale's
 * gates) or the vale itself (`inHeart`). A search that runs out of tiles found a pocket; one that
 * runs past `budget` tiles is too wide to be one. Every tile a search saw shares its answer, so
 * each pocket or open stretch is searched once.
 * → reach(x, y) → boolean, with reach.size() and reach.clear().
 */
export function createReachTest({ walkable, isRoad, inHeart = () => false, budget = 3000, keep = 60000 } = {}) {
  const known = new Map();
  const ok = (fn, x, y) => {
    try {
      return fn(x, y) === true;
    } catch {
      return false;
    }
  };
  function reach(x, y) {
    if (!finite(x) || !finite(y)) return false;
    const start = `${x},${y}`;
    if (known.has(start)) return known.get(start);
    if (ok(inHeart, x, y)) return true;
    if (!ok(walkable, x, y)) return false;
    if (known.size > keep) known.clear();
    const seen = new Set([start]);
    const queue = [[x, y]];
    let found = null;
    for (let i = 0; i < queue.length && found === null; i += 1) {
      const [cx, cy] = queue[i];
      const was = known.get(`${cx},${cy}`);
      if (was !== undefined) found = was;
      else if (ok(isRoad, cx, cy) || ok(inHeart, cx, cy)) found = true;
      else if (seen.size >= budget) found = true;
      else {
        for (const [dx, dy] of STEPS4) {
          const nx = cx + dx;
          const ny = cy + dy;
          const key = `${nx},${ny}`;
          if (seen.has(key)) continue;
          if (!ok(inHeart, nx, ny) && !ok(walkable, nx, ny)) continue;
          seen.add(key);
          queue.push([nx, ny]);
        }
      }
    }
    const answer = found === null ? false : found;
    for (const key of seen) known.set(key, answer);
    return answer;
  }
  reach.size = () => known.size;
  reach.clear = () => known.clear();
  return reach;
}
