// The fight in the shell (CONTRACT-PHASE4.md §12.4 "L", §4.17, §4.18, §5.4, §7.1, §7.2, §10.2):
// the sight check and Sneak's odds (pure), the ctx a fight runs with, the notebooks' writer (each
// commit's notes appended once, across a relaunch, retried on `moved` and `blocked`), and the
// runtime that drives B's driver from K2's HUD: plans, commit, step → world.playEvents → a save
// after every action, pauses at action boundaries (a focus session starting, a rest ending), the
// cards, and what a fight's end pays and writes (Spellcraft, afterFight, payFight, the Chronicle,
// the strays' memory, a regular's invitation after a bow). Pure functions first, Node-tested;
// `createFight(shell, …)` is the thin part that reaches the world only through `shell`.
//   node --test tests/fight.test.js
import { isRecord, dayNumber } from '../clean.js';
import { createBattle, apply, saveBattle, restoreBattle, unitView, sneakCheck } from '../combat/battle.js';
import { roundView as roundViewOf, commit, step, answer } from '../combat/driver.js';
import { dist } from '../combat/grid.js';
import { makeMinds } from '../combat/ai.js';
import { createNotebook, withNotebookMeta, unframe, frame, learn, NOTE_BYTES } from '../combat/notebook.js';
import { genreMemory, rememberHabits } from '../combat/strays.js';
import { logLines } from '../combat/describe.js';
import { MECHANICS, FOE_BOWS } from '../combat/leads.js';
import { rewardsFor, tonicsTaken } from '../combat/encounters.js';
import {
  partySpecs, roadLevel, afterFight, payFight, breather, wake, inviteRegular, noteAccepts, noteGrowth, setPlay,
} from '../party.js';
import { addXp, levelForXp } from '../lifeskills.js';
import { noteFight } from '../chronicle.js';
import { campDay } from '../camp.js';
import { beatKey } from '../world/anim.js';
import { combatOf, settleRoom, leaveExpedition } from './expedition.js';

export const id = 'fight';

export const TERMINAL = Object.freeze(['won', 'talked', 'bowed', 'yielded', 'last-page', 'offline', 'home']);
const PAYING = new Set(['won', 'talked', 'bowed', 'yielded', 'last-page']);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const own = (record, key) => (isRecord(record) && Object.hasOwn(record, key) ? record[key] : undefined);

/** The pinned words (§12.5). */
export const WORDS = Object.freeze({
  keep: 'The fight will keep. Back at your next rest.',
  late: 'It’s late. Start anyway?',
  sat: 'You worked. They sat down for a bit.',
  seam: 'The seam closed while you were away.',
  courier: 'Courier.',
});

// ---------------------------------------------------------------------------
// Sight (§4.17)

const lightCode = (v) => {
  if (v === 'L' || v === 'lit') return 'L';
  if (v === 'd' || v === 'dim') return 'd';
  if (v === 'D' || v === 'dark') return 'D';
  return null;
};

/** Whether nothing that blocks sight stands between two tiles' centres (the end tiles themselves aside). */
export function clearLine(a, b, walls) {
  if (typeof walls !== 'function') return true;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const n = Math.max(Math.abs(dx), Math.abs(dy)) * 4;
  for (let i = 1; i < n; i += 1) {
    const x = Math.round(a.x + (dx * i) / n);
    const y = Math.round(a.y + (dy * i) / n);
    if ((x === a.x && y === a.y) || (x === b.x && y === b.y)) continue;
    if (walls(x, y)) return false;
  }
  return true;
}

/**
 * The sight check (§4.17): the first room (in the order given) one of whose foe posts sees a
 * party tile: 6 tiles if that tile is Lit, 3 in Dim or Dark (never past the room's own `sight`),
 * by 1-2-1 distance with a clear line. `rooms` are Encounters rooms ({ roomId, sight, posts, fight });
 * a field boss's is never among them (in the open wilds, sight never starts a fight). `lightAt(x, y)`
 * gives 'L' | 'd' | 'D' (or null where it isn't known); `walls(x, y)` true where sight is blocked.
 * → roomId or null.
 */
export function sightCheck(rooms, tiles, { lightAt = null, walls = null } = {}) {
  const party = (Array.isArray(tiles) ? tiles : []).filter((t) => isRecord(t) && finite(t.x) && finite(t.y));
  for (const room of Array.isArray(rooms) ? rooms : []) {
    if (!isRecord(room) || room.roomId === 'field' || room.fight?.kind === 'field') continue;
    const posts = Array.isArray(room.posts) ? room.posts : [];
    const own6 = finite(room.sight) ? room.sight : 6;
    for (const t of party) {
      const light = typeof lightAt === 'function' ? lightCode(lightAt(t.x, t.y)) : null;
      const range = Math.min(own6, light === null ? own6 : light === 'L' ? 6 : 3);
      for (const p of posts) if (dist(p, t) <= range && clearLine(p, t, walls)) return room.roomId;
    }
  }
  return null;
}

/** Sneak's odds for a room (§4.17, B's sneakCheck): the Cool band with the party's light and the sharpest watcher. */
export function sneakOdds(room, partyTiles, { lightAt = null, rules } = {}) {
  return sneakCheck(room.fight, partyTiles, { lightAt, rules }).odds;
}

/** Creeping past (§4.17, Decided): a room whose foes are all sleepy or lost, with no Tale-lead. */
export function creepable(room) {
  const foes = (room?.fight?.foes || []).filter((u) => u.side === 'foe');
  return foes.length > 0 && !room.fight.leadUnit && foes.every((u) => u.temperament === 'sleepy' || u.temperament === 'lost');
}

const besidePost = (room, tiles) => (room.posts || []).some((p) => tiles.some((t) => dist(p, t) <= 1));

// A prepared place's light and walls, from its arenas and its layout.
function sceneLight(prepared) {
  const arenas = (prepared?.encounters?.rooms || []).map((r) => r.fight?.arena).filter(Boolean);
  return (x, y) => {
    for (const a of arenas) {
      const { rect } = a;
      if (x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h) return a.light[(y - rect.y) * rect.w + (x - rect.x)] || null;
    }
    return null;
  };
}
function sceneWalls(prepared) {
  const rows = Array.isArray(prepared?.layout?.rows) ? prepared.layout.rows : null;
  return (x, y) => {
    if (!rows) return false;
    if (y < 0 || y >= rows.length || x < 0 || x >= rows[y].length) return true;
    return rows[y][x] === '#';
  };
}

/**
 * The sight check with Sneak and creeping past (§4.17), for a prepared place and the party's tiles.
 * Settled rooms never look. Sneaking, the room's one outcome decides Unseen; Unseen beside a room of
 * only sleepy or lost strays creeps past (`crept` remembers it for this visit), unless a hero ends a
 * move beside one of them, which starts it with the foes surprised.
 * → null | { roomId, unseen: boolean, creep: boolean, odds }
 */
export function sightDecision(prepared, tiles, { settled = {}, crept = new Set(), sneaking = false, rules = null, lightAt = null, walls = null } = {}) {
  const rooms = (prepared?.encounters?.rooms || []).filter((r) => !own(settled, r.roomId));
  const party = (tiles || []).filter((t) => isRecord(t) && finite(t.x) && finite(t.y));
  const light = lightAt || sceneLight(prepared);
  const wall = walls || sceneWalls(prepared);
  for (const room of rooms) {
    if (crept.has(room.roomId) && besidePost(room, party)) return { roomId: room.roomId, unseen: true, creep: false, odds: null };
  }
  const roomId = sightCheck(rooms.filter((r) => !crept.has(r.roomId)), party, { lightAt: light, walls: wall });
  if (!roomId) return null;
  if (!sneaking || !rules) return { roomId, unseen: false, creep: false, odds: null };
  const room = rooms.find((r) => r.roomId === roomId);
  const { unseen, odds } = sneakCheck(room.fight, party, { lightAt: (x, y) => light(x, y) || 'L', rules });
  return { roomId, unseen, creep: unseen && creepable(room) && !besidePost(room, party), odds };
}

// ---------------------------------------------------------------------------
// The fight's ctx (§7.1)

/** ctx.party: each hero's personality, barks and voice, from the companion files and regulars.json. */
export function partyVoices(content, heroes) {
  const party = {};
  const regulars = content?.party?.regulars || {};
  for (const h of Array.isArray(heroes) ? heroes : []) {
    const file = content?.party?.companions?.[h.id];
    party[h.id] = file
      ? { personality: file.personality ?? null, barks: Array.isArray(file.barks) ? file.barks : [], voice: file.voice || 'words' }
      : { personality: regulars.personalityByTemperament?.[h.temperament] ?? null, barks: Array.isArray(regulars.barks) ? regulars.barks : [], voice: 'words' };
  }
  return party;
}

/**
 * A fight's ctx (§7.1): the loaded rules and ability index, the leads' mechanics and bows, the
 * genres in file order, ctx.party, and the minds (makeMinds over the live `notebooks` object, whose
 * entries are replaced as they learn). `minds` may be a Minds or a function of the ctx. Frozen.
 */
export function buildCtx(content, heroes, { notebooks = {}, minds = null } = {}) {
  const combat = combatOf(content);
  if (!combat) return null;
  const ctx = {
    rules: combat.rules, abilities: combat.abilities, minds: null, mechanics: MECHANICS, bows: FOE_BOWS,
    genres: (content.genres?.genres || []).map((g) => g.id), party: partyVoices(content, heroes),
  };
  ctx.minds = typeof minds === 'function' ? minds(ctx) : minds || makeMinds(ctx, { notebooks });
  return Object.freeze(ctx);
}

/** The world's view of a battle (§11.3): what startCombat and syncCombat take. */
export function boardView(battle, ctx) {
  return {
    arena: battle.arena, units: battle.units.map((u) => unitView(battle, u.id)), objects: battle.objects, surfaces: battle.surfaces,
    lights: battle.lights, telegraphs: battle.telegraphs, abilities: ctx?.abilities ?? null,
  };
}

/** Spellcraft from a step's `act` events (§4.21): a knack 5, a spell 40 × its circle, cast by the party. → [{ amount, text }] */
export function spellcraftFrom(events, battle, { abilities, xp = null } = {}) {
  const rate = (rid, fallback) => (Array.isArray(xp?.sources) ? xp.sources.find((s) => s?.id === rid)?.xp : null) ?? fallback;
  const out = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (e?.t !== 'act' || e.action?.id !== 'use' || typeof e.action.ability !== 'string') continue;
    const unit = (battle?.units || []).find((u) => u.id === e.unit);
    if (!unit || unit.side !== 'party') continue;
    const a = abilities?.get?.(e.action.ability);
    if (!a || a.stub) continue;
    if (a.kind === 'knack') out.push({ amount: rate('spell-knack', 5), text: `${a.name} in a fight` });
    else if (a.kind === 'spell' && finite(a.circle) && a.circle > 0) out.push({ amount: rate('spell-circle', 40) * a.circle, text: `${a.name} in a fight` });
  }
  return out;
}

/** After the evening bell (camp.campDay's `bell`): a fight asks once a night before it starts (§12.4). */
export function isLate(state, now, content) {
  try { return campDay(state, now, { content }).bell === true; } catch { return false; }
}
const nightOf = (now) => dayNumber(now - 6 * 3600 * 1000);
// How long an unanswered late-night ask holds the room's fight back before the next step asks again.
const LATE_WAIT_MS = 20_000;

// ---------------------------------------------------------------------------
// The notebooks' writer (§10.2)

const bytesOf = (b) => (b instanceof Uint8Array ? b : Array.isArray(b) || ArrayBuffer.isView(b) ? Uint8Array.from(b) : new Uint8Array(0));

/**
 * Appends notebook frames through the bridge (`read(id)`, `append(id, bytes, at)`), one at a time
 * in order, never dropping a note on its own (§10.2): `at` is the file's good length (from
 * `unframe`) plus what this writer has appended since; a frame whose key is the file's `lastKey` is
 * already there (a relaunch between the append and the state's save) and is skipped; on `moved` it
 * reads again and retries once; on `blocked` (or a second `moved`) it holds the frames, at most
 * `hold`, and sends them again on `retry()` before anything new. → { load(id), write(id, bytes, key),
 * retry(), lastKey(id), at(id), held() }
 */
export function createNotebookWriter({ read, append, hold = 20 } = {}) {
  const files = new Map();
  let held = [];
  let queue = Promise.resolve();
  const call = async (fn, ...args) => { try { return await fn(...args); } catch { return { ok: false, code: 'failed' }; } };
  async function load(nid) {
    const r = typeof read === 'function' ? await call(read, nid) : null;
    const u = unframe(r?.ok ? bytesOf(r.bytes) : new Uint8Array(0));
    files.set(nid, { at: u.good, lastKey: u.lastKey });
    return { ok: Boolean(r?.ok), notes: u.notes, lastKey: u.lastKey, good: u.good };
  }
  async function once(job) {
    if (!files.has(job.id)) await load(job.id);
    let f = files.get(job.id);
    if (f.lastKey === job.key) return { ok: true, skipped: true };
    let r = await call(append, job.id, job.bytes, f.at);
    if (r?.ok) { f.at = finite(r.size) ? r.size : f.at + job.bytes.length; f.lastKey = job.key; return r; }
    if (r?.code === 'moved') {
      await load(job.id);
      f = files.get(job.id);
      if (f.lastKey === job.key) return { ok: true, skipped: true };
      r = await call(append, job.id, job.bytes, f.at);
      if (r?.ok) { f.at = finite(r.size) ? r.size : f.at + job.bytes.length; f.lastKey = job.key; return r; }
      if (r?.code === 'moved') return { ok: false, code: 'blocked' };
    }
    return r || { ok: false, code: 'failed' };
  }
  // Sends what's held, then `jobs`, in order; a block keeps the rest (oldest first) for the next try.
  async function pump(jobs) {
    const list = [...held, ...jobs];
    held = [];
    const results = new Map();
    for (let i = 0; i < list.length; i += 1) {
      const r = await once(list[i]);
      if (!r.ok && r.code === 'blocked') {
        held = list.slice(i);
        if (held.length > hold) {
          console.warn(`[MILO] notebooks: ${held.length - hold} frames waiting past the limit`);
          held = held.slice(0, hold);
        }
        for (const job of held) results.set(job, { ok: false, code: 'blocked', held: true });
        break;
      }
      results.set(list[i], r);
    }
    return results;
  }
  return {
    load: (nid) => { const p = queue.then(() => load(nid)); queue = p.catch(() => {}); return p; },
    write(nid, bytes, key) {
      const job = { id: nid, bytes: bytesOf(bytes), key: key >>> 0 };
      const p = queue.then(async () => (await pump([job])).get(job) || { ok: false, code: 'blocked', held: true });
      queue = p.catch(() => {});
      return p;
    },
    retry() {
      if (!held.length) return queue;
      const p = queue.then(() => pump([]));
      queue = p.catch(() => {});
      return p;
    },
    lastKey: (nid) => files.get(nid)?.lastKey ?? null,
    at: (nid) => files.get(nid)?.at ?? null,
    held: () => held.length,
    idle: () => queue,
  };
}

// ---------------------------------------------------------------------------
// The fight's end (§4.13, §4.18, §12.4)

const CARD_OF = Object.freeze({ offline: 'offline', bowed: 'bow', yielded: 'yielded', won: 'victory', talked: 'victory', 'last-page': 'victory' });

function lootWords(loot, abilities) {
  const out = [];
  for (const e of loot?.essences || []) out.push(`${e.name} × ${e.qty}`);
  if (loot?.relic?.name) out.push(loot.relic.name);
  const tonic = (tid, fallback) => abilities?.get?.(tid)?.name || fallback;
  if (loot?.tonics?.cordial) out.push(`${tonic('cordial', 'Hearthberry cordial')} × ${loot.tonics.cordial}`);
  if (loot?.tonics?.brew) out.push(`${tonic('brew-of-clear-morning', 'Brew of clear morning')} × ${loot.tonics.brew}`);
  return out;
}

/**
 * What a fight's end writes (§4.18, §12.4), pure: for a paying outcome `afterFight` (on the state
 * the fight began from, before payFight), the room settled and `payFight` with the room's Rewards
 * (the tonics a fox pinched back in); then for every outcome the Chronicle's line and the strays'
 * memory. Offline and Head home pay nothing and spend nothing. The expedition's battle is cleared
 * and its card set. → { state, pay: { xp, marks, loot: string[], paid, levelUps } | null }
 */
export function finishFight(state, { battle, fight, roomId, result, taken = null, records = [], where = '', now, content }) {
  const combat = combatOf(content);
  const outcome = result?.outcome || battle?.status;
  let next = state;
  const paying = PAYING.has(outcome);
  if (paying && combat) next = afterFight(next, battle, result, now, { content, rules: combat.rules });
  const exp = next.expedition;
  if (isRecord(exp)) next = { ...next, expedition: { ...exp, battle: null, card: CARD_OF[outcome] ?? null } };
  let pay = null;
  if (paying && combat) {
    next = settleRoom(next, roomId, outcome);
    const r = payFight(next, fight.id, rewardsFor(fight, { rules: combat.rules, words: content.riftgen, taken }), result, now, { rules: combat.rules });
    next = r.state;
    pay = { xp: r.xp, marks: r.marks, loot: lootWords(r.loot, combat.abilities), paid: r.paid, levelUps: r.levelUps };
  }
  next = noteFight(next, now, {
    id: fight.id, at: Math.round(now), where: String(where || '').slice(0, 60), outcome, rounds: result?.rounds ?? battle?.round ?? 0,
    xp: pay?.xp ?? 0, marks: pay?.marks ?? 0, summary: String(result?.summary || '').slice(0, 200),
  });
  const genre = fight.genres?.[0];
  if (genre && isRecord(next.party)) {
    const party = rememberHabits(next.party, genre, records);
    if (party !== next.party) next = { ...next, party };
  }
  return { state: next, pay };
}

/** The invitation a bowed Tale-lead makes (§12.4: party.inviteRegular with the lead): { name, words } or null. */
export function inviteAfterBow(state, { fight, rift, result, now, content }) {
  const combat = combatOf(content);
  if (!combat || result?.outcome !== 'bowed' || !(fight?.kind === 'lead' || fight?.kind === 'field') || !isRecord(rift?.spec || rift)) return null;
  const r = inviteRegular(state, { rift, lead: true }, now, { content, rules: combat.rules });
  return r.ok ? { name: r.regular?.name || null, words: r.words, regular: r.regular?.id ?? null } : null;
}

// ---------------------------------------------------------------------------
// The runtime

const roomOfId = (fightId) => String(fightId || '').split(':').pop() || null;

/**
 * The fight's thin part (§12.3): `createFight(shell, { ctx, loadNotebook, onRiftAction })` →
 * { start(entry), resume(expedition), pause(reason), command(cmd), dispose(), live(), battle(),
 * use(hooks), goHome(), idle(), sightDecision }. `ctx` overrides pieces of the built ctx (a test's
 * `minds`); `loadNotebook(id)` reads a notebook file (default `shell.bridge.notebooks.read`);
 * `onRiftAction(action, riftId)` takes a real rift's yield card's Ward and Let go (default: its panel).
 * `use({ fightFor(roomId), hidden(), cover(roomId), rift(), where() })` is how the expedition hands over its
 * place (`cover`: what a room's fight hides beyond its posts, a field boss's thinned trees and roaming lead).
 */
export function createFight(shell, { ctx: override = null, loadNotebook = null, onRiftAction = null } = {}) {
  let hooks = { fightFor: () => null, hidden: () => [], cover: () => [], rift: () => null, where: () => '' };
  let battle = null;
  let spec = null;
  let roomId = null;
  let ctx = null;
  let records = [];
  let taught = new Set();
  let taken = { cordial: 0, brew: 0 };
  let paused = null;
  let handed = false;
  let running = null;
  let end = null;
  let view = null;
  let viewFor = null;
  let lastAsk = null;
  let pendingLate = null;
  let askedNight = null;
  const declined = new Set();
  let extraHidden = [];
  let speed = null;
  const notebooks = {};
  const metaKeys = {};
  const offs = [];
  const bridge = shell?.bridge?.notebooks || {};
  const writer = createNotebookWriter({
    read: loadNotebook || ((nid) => bridge.read?.(nid) ?? Promise.resolve({ ok: false, code: 'not-loaded' })),
    append: (nid, bytes, at) => bridge.append?.(nid, bytes, at) ?? Promise.resolve({ ok: false, code: 'not-loaded' }),
  });
  let chain = Promise.resolve();

  const contentNow = () => (typeof shell?.content === 'function' ? shell.content() : null);
  const nowOf = () => shell.now();
  const calm = () => shell.state?.party?.calm || {};
  const log = (text, tab = 'combat') => { if (text) { try { shell.log?.({ tab, text, at: nowOf(), detail: null, action: null }); } catch (error) { console.error(error); } } };
  const tell = (title, line) => { try { shell.bubble?.({ kind: 'note', title, lines: line ? [line] : [], duration: 6000, actions: [{ id: 'later', label: 'Okay' }] }); } catch (error) { console.error(error); } };
  const world = (name, ...args) => { try { return shell.world?.(name, ...args); } catch (error) { console.error(error); return undefined; } };

  async function ensureNotebooks(ids) {
    const roster = shell.state?.party?.roster || {};
    for (const nid of ids) {
      if (notebooks[nid] || !Object.hasOwn(roster, nid)) continue;
      const u = await writer.load(nid);
      const meta = roster[nid]?.notebook || {};
      notebooks[nid] = createNotebook(nid, u.notes, { struck: meta.struck || [], rules: meta.rules || [] });
      metaKeys[nid] = JSON.stringify([meta.struck || [], meta.rules || []]);
    }
  }
  // K2's Playbook and the notebook page change struck habits and rules between rounds.
  function refreshMeta() {
    const roster = shell.state?.party?.roster || {};
    for (const nid of Object.keys(notebooks)) {
      const meta = roster[nid]?.notebook || {};
      const key = JSON.stringify([meta.struck || [], meta.rules || []]);
      if (key === metaKeys[nid]) continue;
      metaKeys[nid] = key;
      notebooks[nid] = withNotebookMeta(notebooks[nid], { struck: meta.struck || [], rules: meta.rules || [] });
    }
  }

  function makeCtx(heroes) {
    const content = contentNow();
    const minds = override?.minds ?? null;
    const built = buildCtx(content, heroes, { notebooks, minds });
    if (!built || !override) return built;
    const { minds: _ignored, ...rest } = override;
    return Object.freeze({ ...built, ...rest });
  }
  function heroesFor(state, levels = null) {
    const content = contentNow();
    const combat = combatOf(content);
    return partySpecs(state, { content, rules: combat.rules, abilities: combat.abilities, snapshot: shell.snapshot?.() ?? null, now: nowOf(), levels });
  }

  function payload() {
    if (!battle) return { live: false };
    if (battle.status === 'planning' && viewFor !== battle) {
      refreshMeta();
      view = roundViewOf(battle, ctx);
      viewFor = battle;
    }
    return {
      live: true, battle, roundView: view, ctx, command: (cmd) => command(cmd), end, paused: Boolean(paused),
      guided: shell.state?.party?.play !== 'command',
    };
  }
  const emit = () => { try { shell.emit?.('combat', payload()); } catch (error) { console.error(error); } };

  function save() {
    const state = shell.state;
    const exp = state?.expedition;
    if (!isRecord(exp) || !battle) return;
    shell.set({ ...state, expedition: { ...exp, battle: saveBattle(battle), room: roomId, taken: { ...taken } } }, { save: 150 });
  }

  function afterStep(events) {
    const lines = logLines(events, battle, { odds: calm().odds === 'words' ? 'words' : 'bars' });
    for (const line of lines) log(line);
    const content = contentNow();
    const casts = spellcraftFrom(events, battle, { abilities: ctx?.abilities, xp: content?.xp });
    if (casts.length) {
      let state = shell.state;
      for (const c of casts) state = addXp(state, 'spellcraft', c.amount, nowOf(), { source: 'spell', text: c.text }).state;
      shell.set(state, { save: 150 });
    }
    const pinched = tonicsTaken(events, spec);
    taken = { cordial: taken.cordial + pinched.cordial, brew: taken.brew + pinched.brew };
    save();
  }

  // Learning at commit (§7.2, §10.2): one note per drafted or written slot, appended once.
  function learnFrom(record) {
    const now = nowOf();
    const command = shell.state?.party?.play === 'command';
    let state = shell.state;
    const writes = [];
    for (const [hid, unit] of Object.entries(record?.units || {})) {
      const nb = notebooks[hid];
      if (nb) {
        const { notebook, added } = learn(nb, record, hid, { command });
        if (added?.length) {
          // Already in the file: a relaunch came between the append and the state's save.
          if (writer.lastKey(hid) !== record.key) {
            notebooks[hid] = notebook;
            writes.push(writer.write(hid, frame(added, record.key), record.key));
          }
          state = noteGrowth(state, hid, added.length / NOTE_BYTES, now, { fight: !taught.has(hid) });
          taught.add(hid);
        }
      }
      if (unit?.draft && !unit.auto) state = noteAccepts(state, hid, unit.accepted, now);
    }
    if (state !== shell.state) shell.set(state, { save: 150 });
    if (writes.length) chain = chain.then(() => Promise.all(writes)).catch((error) => console.error(error));
  }

  async function doCommit({ auto = false } = {}) {
    writer.retry();
    const c = commit(battle, battle.plans, ctx, { auto });
    if (c.battle === battle) return false;
    battle = c.battle;
    if (c.record) {
      records.push(c.record);
      learnFrom(c.record);
    }
    save();
    if (c.events?.length) await Promise.resolve(world('playEvents', c.events, playOpts()));
    return true;
  }
  const playOpts = () => ({ speed: speed ?? calm().playback ?? 1, fastFoes: calm().fastFoes !== false });

  // The loop: one action at a time; a kind's strays play as one beat; a pause waits for a boundary.
  async function drive() {
    if (running) return running;
    running = (async () => {
      let pending = null;
      let pendingKey = null;
      const flush = async () => { if (pending) { const p = pending; pending = null; pendingKey = null; await p; } };
      while (battle && !end) {
        if (TERMINAL.includes(battle.status)) { await flush(); await finish(); break; }
        if (battle.status === 'asking') {
          await flush();
          const ask = battle.ask || {};
          const key = `${battle.round}:${battle.tick}:${battle.cursor}:${ask.unitId}:${ask.reactionId}`;
          if (lastAsk && lastAsk.key === key) {
            // The same Ask back after it was answered: it stays answered as it was, and the fight goes on.
            lastAsk.n = (lastAsk.n || 0) + 1;
            if (lastAsk.n > 3) { emit(); break; }
            const r = answer(battle, lastAsk.yes, ctx);
            if (r.battle === battle) break;
            battle = r.battle;
            log('That question came back, so the answer stands.');
            afterStep(r.events);
            continue;
          }
          emit();
          break;
        }
        if (battle.status === 'planning') {
          await flush();
          world('syncCombat', boardView(battle, ctx));
          if (handed && !paused) { if (!(await doCommit({ auto: true }))) break; continue; }
          emit();
          break;
        }
        if (paused) { await flush(); emit(); break; }
        const before = battle;
        const units = before.units.map((u) => ({ id: u.id, side: u.side, talkKind: u.talkKind }));
        const s = step(battle, ctx);
        if (s.battle === before) { emit(); break; }
        battle = s.battle;
        afterStep(s.events);
        const key = beatKey(s.events, units);
        if (pending && (key === null || key !== pendingKey)) await flush();
        const p = Promise.resolve(world('playEvents', s.events, playOpts()));
        if (key !== null && !s.ask && !s.roundOver && !s.result) {
          pending = pending ? Promise.all([pending, p]) : p;
          pendingKey = key;
        } else {
          await flush();
          await p;
        }
        emit();
      }
    })().catch((error) => console.error('[MILO] the fight', error)).finally(() => { running = null; });
    return running;
  }

  async function finish() {
    if (!battle || end) return;
    const content = contentNow();
    const combat = combatOf(content);
    const now = nowOf();
    const result = battle.result || { outcome: battle.status, rounds: battle.round, summary: '' };
    const state0 = shell.state;
    const done = finishFight(state0, { battle, fight: spec, roomId, result, taken, records, where: hooks.where?.() || '', now, content });
    let state = done.state;
    const invite = inviteAfterBow(state, { fight: spec, rift: hooks.rift?.(), result, now, content });
    let rest = null;
    if (PAYING.has(result.outcome) && combat) {
      const b = breather(state, now, { rules: combat.rules, content, fightId: spec.id, where: 'victory' });
      rest = b.ok ? true : b.reason;
    }
    const realRift = result.real && hooks.rift?.() ? { id: hooks.rift().id, name: hooks.rift().spec?.name || null } : null;
    end = { pay: done.pay ? { xp: done.pay.xp, marks: done.pay.marks, loot: done.pay.loot } : null, breather: rest, invite: invite ? { name: invite.name, words: invite.words } : null, rift: realRift };
    shell.set(state, { save: 150 });
    if (done.pay?.paid) log(`Road XP +${done.pay.xp}, ${done.pay.marks} Marks.`);
    if (result.summary) log(result.summary);
    emit();
  }

  async function close({ leave = false, travel = null } = {}) {
    const b = battle;
    const place = {};
    for (const u of b?.units || []) if (u.side === 'party' && u.rank === 'hero') place[u.id] = { x: u.x, y: u.y };
    await Promise.resolve(world('endCombat', { place }));
    battle = null;
    end = null;
    view = null;
    paused = null;
    handed = false;
    lastAsk = null;
    world('hideActors', hooks.hidden?.() || []);
    try { shell.emit?.('combat', { live: false }); } catch (error) { console.error(error); }
    let state = shell.state;
    const exp = state?.expedition;
    if (isRecord(exp)) {
      if (exp.closing === true) state = { ...state, expedition: null };
      else if (leave || exp.kind === 'field') state = leaveExpedition(state);
      else if (exp.card != null) state = { ...state, expedition: { ...exp, card: null } };
      if (state !== shell.state) shell.set(state, { save: 150 });
    }
    if (leave || exp?.closing === true) {
      if (exp?.kind !== 'field') await Promise.resolve(shell.leaveElsewhere?.());
      if (travel) await Promise.resolve(shell.travel?.(travel));
    }
  }

  // A start in progress (notebooks loading, the board coming up), so idle() waits for it too.
  let starting = null;
  function start(entry = {}) {
    // One at a time: a second sight check while the first fight comes up starts nothing.
    if (starting) return Promise.resolve({ started: false, busy: true });
    const p = startNow(entry);
    const mine = p.catch(() => {}).finally(() => { if (starting === mine) starting = null; });
    starting = mine;
    return p;
  }

  async function startNow(entry = {}) {
    const fightSpec = entry.fight;
    if (battle || !isRecord(fightSpec)) return { started: false };
    const content = contentNow();
    const combat = combatOf(content);
    if (!combat) return { started: false };
    const state = shell.state;
    const now = nowOf();
    const rid = entry.roomId || fightSpec.room;
    if (!entry.late && isLate(state, now, content) && askedNight !== nightOf(now)) {
      if (declined.has(rid)) return { started: false, declined: true };
      // Asked already, and waiting on the answer: the next step doesn't ask again (until the bubble's gone unanswered).
      if (pendingLate && now - pendingLate.askedAt < LATE_WAIT_MS) return { started: false, asked: true };
      pendingLate = { ...entry, askedAt: now };
      try {
        shell.bubble?.({ kind: 'note', title: WORDS.late, lines: [], duration: 15000, actions: [{ id: 'fight-late', label: 'Start anyway' }, { id: 'later', label: 'Another night' }] });
      } catch (error) { console.error(error); }
      log(WORDS.late);
      return { started: false, asked: true };
    }
    const heroes = heroesFor(state);
    await ensureNotebooks(heroes.map((h) => h.id));
    ctx = makeCtx(heroes);
    const party = state.party || {};
    const tries = isRecord(state.expedition?.tries) ? state.expedition.tries : {};
    const attempt = finite(entry.attempt) ? entry.attempt : Object.hasOwn(tries, rid) ? tries[rid] + 1 : 0;
    battle = createBattle(fightSpec, heroes, {
      attempt, mode: party.mode || 'long-road',
      calm: { noise: party.calm?.noise !== false, adaptation: party.calm?.adaptation !== false },
      cheers: party.cheers || 0, firstLead: (fightSpec.kind === 'lead' || fightSpec.kind === 'field') && party.firstLeadMet !== true,
      sneak: entry.sneak === 'unseen' ? 'unseen' : null, roadLevel: roadLevel(state, combat.rules).level,
      warding: levelForXp(state.xp?.skills?.warding || 0), memory: genreMemory(party, fightSpec.genres?.[0]),
      talk: isRecord(entry.talk) ? entry.talk : {}, placement: entry.placement || null,
    }, ctx);
    spec = fightSpec;
    roomId = rid;
    records = [];
    taught = new Set();
    taken = { cordial: 0, brew: 0 };
    end = null;
    paused = null;
    view = null;
    lastAsk = null;
    handed = party.play === 'handle';
    const integrity = {};
    for (const h of heroes) integrity[h.id] = h.integrity;
    const exp = shell.state?.expedition;
    if (isRecord(exp)) {
      shell.set({ ...shell.state, expedition: { ...exp, battle: saveBattle(battle), entry: integrity, room: rid, card: null, tries: { ...tries, [rid]: attempt }, taken } }, { save: 150 });
    }
    shell.feature?.('fight');
    extraHidden = [...new Set([...(Array.isArray(entry.hidden) ? entry.hidden : []), ...(hooks.cover?.(rid) || []), ...coverHidden(fightSpec, rid)])];
    world('hideActors', [...(hooks.hidden?.() || []), ...extraHidden]);
    await Promise.resolve(world('startCombat', boardView(battle, ctx)));
    log(hooks.where?.() ? `A fight begins in ${String(hooks.where()).replace(/^(The|A|An) /, (w) => w.toLowerCase())}.` : 'A fight begins.');
    emit();
    if (handed) await drive();
    return { started: true, battle };
  }

  // What the board hides while a room's fight is on: its posts, a lead room's Tale-lead, and the
  // wanderers the arena covers (J's hideActors).
  function coverHidden(fightSpec, rid) {
    const out = [];
    if (rid && rid !== 'field' && rid !== 'mimic') out.push(`enc:${rid}`);
    if (fightSpec.kind === 'lead') out.push('tale-lead');
    const rect = fightSpec.arena?.rect;
    const list = rect ? world('elsewhereEntities') : null;
    for (const e of Array.isArray(list) ? list : []) {
      if (e?.kind !== 'stray' || e.post || typeof e.id !== 'string' || !e.id.startsWith('stray:')) continue;
      if (e.x >= rect.x && e.y >= rect.y && e.x < rect.x + rect.w && e.y < rect.y + rect.h) out.push(e.id);
    }
    return out;
  }

  async function resume(expedition = shell.state?.expedition) {
    const save0 = expedition?.battle;
    if (battle || !isRecord(save0) || !combatOf(contentNow())) return { resumed: false };
    const rid = expedition.room || roomOfId(save0.id);
    const fightSpec = hooks.fightFor?.(rid);
    const state = shell.state;
    if (!fightSpec) {
      if (isRecord(state.expedition)) shell.set({ ...state, expedition: { ...state.expedition, battle: null } }, { save: 150 });
      return { resumed: false };
    }
    const heroes = heroesFor(state, isRecord(save0.levels) ? save0.levels : null);
    await ensureNotebooks(heroes.map((h) => h.id));
    ctx = makeCtx(heroes);
    const restored = restoreBattle(save0, ctx, { fight: fightSpec, heroes });
    if (!restored) {
      // Nothing to trust: the same room again from attempt 0.
      if (isRecord(state.expedition)) shell.set({ ...state, expedition: { ...state.expedition, battle: null } }, { save: 150 });
      return { resumed: false, ...(await start({ fight: fightSpec, roomId: rid, attempt: 0, late: true })) };
    }
    battle = restored;
    spec = fightSpec;
    roomId = rid;
    records = [];
    taught = new Set();
    taken = { cordial: expedition.taken?.cordial || 0, brew: expedition.taken?.brew || 0 };
    end = null;
    view = null;
    lastAsk = null;
    handed = false;
    paused = TERMINAL.includes(battle.status) || battle.status === 'planning' ? null : 'resume';
    extraHidden = [...new Set([...(hooks.cover?.(rid) || []), ...coverHidden(fightSpec, rid)])];
    world('hideActors', [...(hooks.hidden?.() || []), ...extraHidden]);
    world('syncCombat', boardView(battle, ctx));
    emit();
    if (expedition.closing === true && (expedition.kind === 'real' || expedition.kind === 'story')) await seamClosed();
    else if (TERMINAL.includes(battle.status)) await drive();
    return { resumed: true, battle, tick: battle.tick, round: battle.round };
  }

  // A real rift whose cause was fixed while its fight waited: a win that pays the room.
  let sealing = false;
  async function seamClosed() {
    if (!battle || end || sealing) return;
    sealing = true;
    try { await sealNow(); } finally { sealing = false; }
  }
  async function sealNow() {
    const r = apply(battle, { t: 'end', outcome: 'won', why: 'seam-closed' }, ctx);
    if (r.battle === battle) return;
    battle = r.battle;
    tell('The rift sealed itself', WORDS.seam);
    afterStep(r.events);
    paused = null;
    await drive();
  }

  function pause(reason = 'you') {
    if (!battle || end) return false;
    if (!paused) {
      paused = reason;
      if (reason === 'focus' || reason === 'rest') { tell('Paused', WORDS.keep); log(WORDS.keep); }
    }
    if (!running) emit();
    return true;
  }

  async function goHome() {
    const content = contentNow();
    const combat = combatOf(content);
    let state = shell.state;
    if (combat) state = wake(state, nowOf(), { content, rules: combat.rules });
    state = leaveExpedition(state);
    shell.set(state, { save: 150 });
    const tile = battle?.units?.find((u) => u.id === 'milo');
    if (tile) world('playMoment', 'handcart', { x: tile.x, y: tile.y });
    tell('Toby’s handcart', `“${WORDS.courier}”`);
    log(`Toby: “${WORDS.courier}”`, 'world');
    const exp = shell.state?.expedition;
    await close({ leave: true, travel: shell.state?.wilds?.wake || 'home' });
    return { ok: true, kind: exp?.kind ?? null };
  }

  async function tryAgain() {
    const fightSpec = spec;
    const rid = roomId;
    const attempt = (battle?.attempt ?? 0) + 1;
    const hidden = extraHidden;
    // Back to the start of that fight with the Integrity it was entered with (§4.18).
    let state = shell.state;
    const entryInt = state?.expedition?.entry;
    const outing = state?.party?.outing;
    if (isRecord(entryInt) && isRecord(outing?.heroes)) {
      const heroes = { ...outing.heroes };
      let changed = false;
      for (const [hid, n] of Object.entries(entryInt)) {
        if (isRecord(heroes[hid]) && heroes[hid].integrity !== n) { heroes[hid] = { ...heroes[hid], integrity: n }; changed = true; }
      }
      if (changed) state = { ...state, party: { ...state.party, outing: { ...outing, heroes } } };
    }
    if (isRecord(state?.expedition)) state = { ...state, expedition: { ...state.expedition, card: null, battle: null } };
    if (state !== shell.state) shell.set(state, { save: 150 });
    await Promise.resolve(world('endCombat', {}));
    battle = null;
    end = null;
    return start({ fight: fightSpec, roomId: rid, attempt, late: true, hidden });
  }

  async function card(action) {
    if (!battle || !end) return false;
    const content = contentNow();
    const combat = combatOf(content);
    const now = nowOf();
    const outcome = battle.result?.outcome || battle.status;
    switch (action) {
      case 'breather': {
        if (!combat) return false;
        const r = breather(shell.state, now, { rules: combat.rules, content, fightId: spec.id, where: 'victory' });
        if (r.ok && r.state !== shell.state) shell.set(r.state, { save: 150 });
        end = { ...end, breather: r.ok ? null : r.reason };
        log(r.ok ? 'Everyone sits down for a Breather.' : r.reason);
        emit();
        return true;
      }
      case 'invite-yes': {
        const offer = combat ? inviteRegular(shell.state, { rift: hooks.rift?.(), lead: true }, now, { content, rules: combat.rules }) : null;
        if (offer?.ok) { shell.set(offer.state, { save: 150 }); log(`${offer.regular?.name || 'They'} will be by the fire at camp.`); }
        else if (offer?.words) log(offer.words);
        end = { ...end, invite: null };
        emit();
        return true;
      }
      case 'invite-no':
        end = { ...end, invite: null };
        emit();
        return true;
      case 'try-again':
        if (outcome !== 'offline') return false;
        await tryAgain();
        return true;
      case 'go-home':
        if (outcome !== 'offline') return false;
        await goHome();
        return true;
      case 'stitch':
      case 'ward':
      case 'let-go': {
        const riftId = end.rift?.id || hooks.rift?.()?.id || null;
        await close();
        if (riftId) {
          if (typeof onRiftAction === 'function' && action !== 'stitch') onRiftAction(action, riftId);
          else shell.openPanel?.(riftId, { focus: action === 'stitch' ? 'panel-leave' : `panel-${action}` });
        }
        return true;
      }
      case 'continue':
      default:
        await close(outcome === 'home' ? { leave: true, travel: 'home' } : {});
        return true;
    }
  }

  async function command(cmd) {
    if (!isRecord(cmd)) return false;
    try {
      if (cmd.t === 'late') {
        const entry = pendingLate;
        pendingLate = null;
        if (!entry) return false;
        if (cmd.yes) { askedNight = nightOf(nowOf()); const { askedAt: _at, ...rest } = entry; return (await start({ ...rest, late: true })).started === true; }
        declined.add(entry.roomId || entry.fight?.room);
        return false;
      }
      if (cmd.t === 'card') return card(cmd.action);
      if (!battle) return false;
      switch (cmd.t) {
        case 'plan':
        case 'cheer':
        case 'mode': {
          const r = apply(battle, cmd.t === 'mode' ? { t: 'mode', mode: 'storybook' } : cmd, ctx);
          if (r.battle !== battle) { battle = r.battle; viewFor = null; }
          emit();
          return true;
        }
        case 'run': {
          if (end) return false;
          paused = null;
          if (battle.status === 'planning') { if (!(await doCommit())) { emit(); return false; } }
          await drive();
          return true;
        }
        case 'hand-over': {
          handed = true;
          paused = null;
          if (battle.status === 'planning') await doCommit({ auto: true });
          await drive();
          return true;
        }
        case 'take-back':
          handed = false;
          emit();
          return true;
        case 'answer': {
          if (battle.status !== 'asking') return false;
          const ask = battle.ask || {};
          lastAsk = { key: `${battle.round}:${battle.tick}:${battle.cursor}:${ask.unitId}:${ask.reactionId}`, yes: Boolean(cmd.yes) };
          const r = answer(battle, Boolean(cmd.yes), ctx);
          battle = r.battle;
          afterStep(r.events);
          await drive();
          return true;
        }
        case 'wrap': {
          const r = apply(battle, { t: 'wrap' }, ctx);
          if (r.battle === battle) return false;
          battle = r.battle;
          afterStep(r.events);
          await Promise.resolve(world('playEvents', r.events, playOpts()));
          await drive();
          return true;
        }
        case 'head-home': {
          const r = apply(battle, { t: 'head-home' }, ctx);
          if (r.battle !== battle) { battle = r.battle; afterStep(r.events); }
          await drive();
          return true;
        }
        case 'pause':
          if (paused) { paused = null; if (battle.status !== 'planning') await drive(); else emit(); return true; }
          return pause('you');
        case 'guided': {
          const play = shell.state?.party?.play === 'command' ? 'guided' : 'command';
          const next = setPlay(shell.state, play, nowOf());
          if (next !== shell.state) shell.set(next, { save: 150 });
          emit();
          return true;
        }
        case 'playback':
          speed = [1, 2, 4].includes(cmd.speed) ? cmd.speed : speed;
          world('playEvents', [], { speed: speed ?? 1 });
          return true;
        default:
          return false;
      }
    } catch (error) {
      console.error('[MILO] a fight command', error);
      return false;
    }
  }

  // A focus session starting or a rest ending pauses at the next action; a finished focus session
  // while the party's out gives a free Breather, which waits for afterFight while a fight is live.
  function onKindle(message) {
    const events = Array.isArray(message?.events) ? message.events : [];
    for (const e of events) {
      if (e?.t === 'focus-started' || e?.t === 'rest-done' || e?.t === 'rest-broken') pause(e.t === 'focus-started' ? 'focus' : 'rest');
      if (e?.t === 'focus-done') freeBreather();
    }
  }
  function freeBreather() {
    const content = contentNow();
    const combat = combatOf(content);
    const state = shell.state;
    if (!combat || !(state?.expedition?.inside || battle)) return false;
    const r = breather(state, nowOf(), { rules: combat.rules, content, free: true, where: 'focus' });
    if (!r.ok) return false;
    if (r.state !== state) shell.set(r.state, { save: 150 });
    const words = battle && !end ? r.reason : WORDS.sat;
    if (words) { tell('A Breather', words); log(words, 'world'); }
    return true;
  }
  function onState() {
    if (writer.held()) writer.retry();
    const exp = shell.state?.expedition;
    if (battle && !end && !running && exp?.closing === true && (exp.kind === 'real' || exp.kind === 'story')) seamClosed();
  }
  try {
    offs.push(shell.on?.('kindle', onKindle));
    offs.push(shell.on?.('state', onState));
  } catch (error) { console.error(error); }

  return {
    start,
    resume,
    pause,
    command,
    goHome,
    freeBreather,
    sightDecision,
    use(next) { hooks = { ...hooks, ...(isRecord(next) ? next : {}) }; },
    live: () => battle !== null,
    battle: () => battle,
    ctx: () => ctx,
    notebook: (nid) => notebooks[nid] ?? null,
    writer: () => writer,
    async idle() {
      for (let i = 0; i < 8; i += 1) await Promise.all([starting || Promise.resolve(), running || Promise.resolve(), chain, writer.idle()]);
    },
    dispose() { for (const off of offs) if (typeof off === 'function') off(); },
  };
}
