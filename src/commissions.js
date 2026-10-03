// Commissions (PLAN.md Phase 6): sending Claude or Codex to do a piece of work. A commission is a
// brief, who takes it, the one folder it happens in, and a ward: how much the crew may do there.
// Chris writes or picks it, sends it himself, and reads what came back before it counts.
//
// The rules MILO keeps (none of them can be switched off from the game):
//   - one folder a commission, picked by Chris, and never his home folder, a drive's root, MILO's
//     own folder, or anywhere under .claude or .codex;
//   - nothing is sent until he presses Send, every time;
//   - one commission runs at a time;
//   - MILO never commits, pushes or deletes on the crew's behalf.
//
// Pure: every step takes `now` and returns a new state (or the same one when nothing changed).
// The saved side is `state.commissions = { list, seq, folders, levels, checks, checked }`: the
// commissions, the next id, each building's folder and proven level, the check Chris set for it (a
// command he would type in a terminal there), and that check's last result.
import { isRecord, clip, cleanCount, toTime } from './clean.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;

export const CREW = Object.freeze(['claude', 'codex']);
export const CREW_WORDS = Object.freeze({ claude: 'Claude', codex: 'Codex' });

/** How much the crew may do in the folder, from least to most. */
export const WARDS = Object.freeze(['look', 'suggest', 'change']);
export const WARD_WORDS = Object.freeze({ look: 'Look only', suggest: 'Suggest', change: 'Change files' });
export const WARD_HINTS = Object.freeze({
  look: 'They read the folder and report back. Nothing is changed.',
  suggest: 'They read the folder and write up what they’d change. Nothing is changed.',
  change: 'They may add and edit files inside this folder, and nowhere else.',
});
/** Whether a ward lets the crew write. */
export const wardWrites = (ward) => ward === 'change';

export const STATUSES = Object.freeze(['draft', 'waiting', 'running', 'review', 'done', 'failed', 'stopped']);
export const LIMITS = Object.freeze({ list: 60, title: 80, brief: 1500, summary: 4000, files: 60, file: 200, folder: 400, folders: 40, why: 200, check: 200, tail: 3000 });
/** How long a check may run. */
export const CHECK_LIMIT_MS = 10 * 60 * 1000;
export const MAX_LEVEL = 5;

const ID = /^c\d{1,9}$/;
const PLOT_ID = /^plot-[a-z]{2,20}$/;
const QUEST_ID = /^q-[0-9a-z]{1,12}$/;

export function emptyCommissions() {
  return { list: [], seq: 0, folders: {}, levels: {}, checks: {}, checked: {} };
}

// ---------------------------------------------------------------------------
// Folders

const norm = (folder) => String(folder).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
const under = (folder, parent) => { const a = norm(folder); const b = norm(parent); return b.length > 0 && (a === b || a.startsWith(`${b}\\`)); };

/**
 * Why a folder can't hold a commission, in words, or '' when it can. `home` is Chris's home folder
 * and `own` MILO's (the caller knows them; the main process checks again against the real disk).
 */
export function folderProblem(folder, { home = '', own = '' } = {}) {
  if (!text(folder)) return 'Pick a folder first.';
  const f = folder.trim();
  if (f.length > LIMITS.folder) return 'That path is too long.';
  if (!/^[a-zA-Z]:[\\/]/.test(f) && !f.startsWith('/')) return 'That isn’t a full path.';
  if (/(^|[\\/])\.\.([\\/]|$)/.test(f)) return 'That path goes back on itself.';
  if (/^[a-zA-Z]:[\\/]*$/.test(f) || f === '/') return 'Not a whole drive. Pick the project’s own folder.';
  if (/(^|[\\/])\.(claude|codex)([\\/]|$)/i.test(f)) return 'Not there. That’s where the crew keep their own things.';
  if (text(home) && norm(f) === norm(home)) return 'Not your whole home folder. Pick the project’s own folder.';
  if (text(home) && under(home, f)) return 'That folder holds your whole home folder.';
  if (text(own) && (under(f, own) || under(own, f))) return 'Not MILO’s own folder.';
  return '';
}

// ---------------------------------------------------------------------------
// Cleaning

const sourceOf = (value) => {
  if (!isRecord(value)) return { kind: 'free' };
  if (value.kind === 'building' && typeof value.plotId === 'string' && PLOT_ID.test(value.plotId)) {
    const level = cleanCount(value.level, MAX_LEVEL);
    return { kind: 'building', plotId: value.plotId, level: Math.max(1, level) };
  }
  if (value.kind === 'quest' && typeof value.questId === 'string' && QUEST_ID.test(value.questId)) return { kind: 'quest', questId: value.questId };
  return { kind: 'free' };
};

function cleanResult(value) {
  if (!isRecord(value)) return null;
  const files = [];
  for (const f of Array.isArray(value.files) ? value.files : []) {
    if (typeof f === 'string' && f.trim() && files.length < LIMITS.files) files.push(clip(f.trim(), LIMITS.file));
  }
  return {
    summary: clip(String(value.summary ?? ''), LIMITS.summary),
    files,
    ms: cleanCount(value.ms, 24 * 60 * 60 * 1000),
    why: clip(String(value.why ?? ''), LIMITS.why),
  };
}

function cleanCommission(value, now) {
  if (!isRecord(value) || typeof value.id !== 'string' || !ID.test(value.id)) return null;
  const title = clip(String(value.title ?? '').replace(/\s+/g, ' ').trim(), LIMITS.title);
  if (!title) return null;
  let status = STATUSES.includes(value.status) ? value.status : 'draft';
  // A run can't outlive the app: whatever was running when MILO closed was stopped with it. Nor
  // can the Sally Port's queue: what was waiting goes back to the drafts, to be sent again.
  if (status === 'running') status = 'stopped';
  if (status === 'waiting') status = 'draft';
  return {
    id: value.id,
    title,
    brief: String(value.brief ?? '').slice(0, LIMITS.brief),
    who: CREW.includes(value.who) ? value.who : 'claude',
    ward: WARDS.includes(value.ward) ? value.ward : 'look',
    folder: typeof value.folder === 'string' ? value.folder.slice(0, LIMITS.folder) : '',
    source: sourceOf(value.source),
    status,
    createdAt: toTime(value.createdAt) ?? Math.round(now),
    queuedAt: toTime(value.queuedAt),
    sentAt: toTime(value.sentAt),
    endedAt: toTime(value.endedAt),
    result: cleanResult(value.result),
    proved: value.proved === true,
    // The building's check, run after this commission came back: { ok, at }.
    check: isRecord(value.check) && typeof value.check.ok === 'boolean' && toTime(value.check.at) ? { ok: value.check.ok, at: toTime(value.check.at) } : null,
  };
}

/** Any input → a valid commissions section. Newest entries win past the limit; ids are never reused. */
export function cleanCommissions(value, { now = Date.now() } = {}) {
  const src = isRecord(value) ? value : {};
  const seen = new Set();
  const list = [];
  for (const entry of Array.isArray(src.list) ? src.list : []) {
    const c = cleanCommission(entry, now);
    if (c && !seen.has(c.id)) { seen.add(c.id); list.push(c); }
  }
  const kept = list.slice(-LIMITS.list);
  const top = kept.reduce((n, c) => Math.max(n, Number(c.id.slice(1))), 0);
  const folders = {};
  if (isRecord(src.folders)) {
    for (const [plotId, folder] of Object.entries(src.folders).slice(-LIMITS.folders)) {
      if (PLOT_ID.test(plotId) && text(folder)) folders[plotId] = folder.slice(0, LIMITS.folder);
    }
  }
  const levels = {};
  if (isRecord(src.levels)) {
    for (const [plotId, n] of Object.entries(src.levels)) {
      const level = cleanCount(n, MAX_LEVEL);
      if (PLOT_ID.test(plotId) && level > 0) levels[plotId] = level;
    }
  }
  const checks = {};
  if (isRecord(src.checks)) {
    for (const [plotId, command] of Object.entries(src.checks)) {
      const c = typeof command === 'string' ? command.replace(/[\r\n]+/g, ' ').trim().slice(0, LIMITS.check) : '';
      if (PLOT_ID.test(plotId) && c) checks[plotId] = c;
    }
  }
  const checked = {};
  if (isRecord(src.checked)) {
    for (const [plotId, r] of Object.entries(src.checked)) {
      if (PLOT_ID.test(plotId) && isRecord(r) && typeof r.ok === 'boolean' && toTime(r.at)) checked[plotId] = { ok: r.ok, at: toTime(r.at), tail: String(r.tail ?? '').slice(-LIMITS.tail) };
    }
  }
  return { list: kept, seq: Math.max(cleanCount(src.seq, 999999999), top), folders, levels, checks, checked };
}

const sectionOf = (state) => (isRecord(state?.commissions) ? state.commissions : emptyCommissions());
const withSection = (state, section) => ({ ...state, commissions: section });
const find = (state, id) => sectionOf(state).list.find((c) => c.id === id) || null;
const replace = (state, id, patch) => {
  const section = sectionOf(state);
  return withSection(state, { ...section, list: section.list.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
};

// ---------------------------------------------------------------------------
// Buildings and their levels

const plotOf = (state, plotId) => (isRecord(state?.plots) && isRecord(state.plots[plotId]) ? state.plots[plotId] : null);

/** A building's proven level, 0 to 5. A level is proven when Chris has seen its commission's work do what the level asks. */
export function levelOf(state, plotId) {
  return cleanCount(sectionOf(state).levels?.[plotId], MAX_LEVEL);
}

/** The next level a building could be taken to: { level, title, summary, proof }, or null (not built, or at its last). */
export function nextLevel(state, plotId) {
  const plot = plotOf(state, plotId);
  const levels = Array.isArray(plot?.blueprint?.levels) ? plot.blueprint.levels : null;
  if (!plot || plot.status !== 'built' || !levels) return null;
  const want = levelOf(state, plotId) + 1;
  const found = levels.find((l) => isRecord(l) && l.level === want);
  return found ? { level: want, title: String(found.title || ''), summary: String(found.summary || ''), proof: String(found.proof || '') } : null;
}

const buildingName = (plot) => (text(plot?.name) ? plot.name : text(plot?.blueprint?.name) ? plot.blueprint.name : 'the building');

/** The buildings that have a next level to commission: [{ plotId, name, level, title }]. */
export function buildable(state) {
  const plots = isRecord(state?.plots) ? state.plots : {};
  return Object.keys(plots).map((plotId) => ({ plotId, next: nextLevel(state, plotId) }))
    .filter((b) => b.next)
    .map((b) => ({ plotId: b.plotId, name: buildingName(plots[b.plotId]), level: b.next.level, title: b.next.title }));
}

// ---------------------------------------------------------------------------
// Checks: the command that shows a building works (`npm test`, say), set by Chris and run by MILO
// in the building's folder. The crew can't set or change one.

/** A building's check, or ''. */
export const checkFor = (state, plotId) => (typeof sectionOf(state).checks?.[plotId] === 'string' ? sectionOf(state).checks[plotId] : '');

/** A building's last check result: { ok, at, tail } or null. */
export const lastCheck = (state, plotId) => (isRecord(sectionOf(state).checked?.[plotId]) ? sectionOf(state).checked[plotId] : null);

/** Sets (or, with '', clears) a building's check. Clearing it forgets its last result too. */
export function setCheck(state, plotId, command) {
  if (!isRecord(state) || typeof plotId !== 'string' || !PLOT_ID.test(plotId) || typeof command !== 'string') return state;
  const c = command.replace(/[\r\n]+/g, ' ').trim().slice(0, LIMITS.check);
  const section = sectionOf(state);
  if ((section.checks?.[plotId] || '') === c) return state;
  const checks = { ...section.checks };
  const checked = { ...section.checked };
  if (c) checks[plotId] = c; else { delete checks[plotId]; delete checked[plotId]; }
  return withSection(state, { ...section, checks, checked });
}

/**
 * A check has run: { ok, tail }. Kept as the building's last result, and, when it was run for a
 * commission that came back for that building, on the commission too.
 */
export function recordCheck(state, plotId, outcome, now, commissionId = null) {
  if (!isRecord(state) || typeof plotId !== 'string' || !PLOT_ID.test(plotId) || !isRecord(outcome) || typeof outcome.ok !== 'boolean' || !finite(now)) return state;
  const section = sectionOf(state);
  const at = Math.round(now);
  let next = withSection(state, { ...section, checked: { ...section.checked, [plotId]: { ok: outcome.ok, at, tail: String(outcome.tail ?? '').slice(-LIMITS.tail) } } });
  const c = commissionId ? find(next, commissionId) : null;
  if (c && c.status === 'review' && c.source.kind === 'building' && c.source.plotId === plotId) next = replace(next, commissionId, { check: { ok: outcome.ok, at } });
  return next;
}

/** Whether a commission can prove its building's level now: files could change, it's the next level, and the check (if there is one) has passed since it came back. */
export function canProve(state, commission) {
  const c = isRecord(commission) ? commission : null;
  if (!c || c.status !== 'review' || c.source?.kind !== 'building' || !wardWrites(c.ward)) return false;
  if (c.source.level !== levelOf(state, c.source.plotId) + 1) return false;
  return !checkFor(state, c.source.plotId) || c.check?.ok === true;
}

// ---------------------------------------------------------------------------
// What the rifts read (src/rifts.js): a building whose check is failing (Neon), and commissions
// that came back without finishing and haven't been read (Noir).

export function commissionFacts(state) {
  const section = sectionOf(state);
  const plots = isRecord(state?.plots) ? state.plots : {};
  const failing = Object.entries(section.checked || {})
    .filter(([plotId, r]) => r && r.ok === false && checkFor(state, plotId) && plots[plotId]?.status === 'built')
    .map(([plotId, r]) => ({ plotId, name: buildingName(plots[plotId]), at: r.at }))
    .sort((a, b) => a.at - b.at);
  const failed = section.list.filter((c) => c.status === 'failed').sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
  return { failing, failed };
}

// ---------------------------------------------------------------------------
// Drafting

const add = (state, fields, now) => {
  const section = sectionOf(state);
  const seq = section.seq + 1;
  const id = `c${seq}`;
  const made = cleanCommission({ id, status: 'draft', createdAt: now, ...fields }, now);
  if (!made) return { state, id: null };
  return { state: withSection(state, { ...section, seq, list: [...section.list, made].slice(-LIMITS.list) }), id };
};

/** A draft to take a building to its next level, with its brief written from the blueprint. → { state, id } */
export function draftForBuilding(state, plotId, now) {
  const next = nextLevel(state, plotId);
  if (!isRecord(state) || !next || !finite(now)) return { state, id: null };
  const plot = plotOf(state, plotId);
  const name = buildingName(plot);
  const brief = [
    `Build level ${next.level} of ${name}: ${next.title}.`,
    next.summary,
    next.proof ? `It is done when: ${next.proof}` : '',
  ].filter(Boolean).join('\n');
  return add(state, { title: `${name}, level ${next.level}: ${next.title}`, brief, ward: 'look', folder: sectionOf(state).folders[plotId] || '', source: { kind: 'building', plotId, level: next.level } }, now);
}

/** A draft from a quest on the Board. → { state, id } */
export function draftForQuest(state, questId, now) {
  const quest = (Array.isArray(state?.board?.quests) ? state.board.quests : []).find((q) => isRecord(q) && q.id === questId);
  if (!isRecord(state) || !quest || !finite(now)) return { state, id: null };
  const steps = (Array.isArray(quest.steps) ? quest.steps : []).filter((s) => isRecord(s) && !s.done && text(s.text)).map((s) => `- ${s.text}`);
  const brief = [String(quest.title || ''), text(quest.notes) ? quest.notes : '', ...steps].filter(Boolean).join('\n');
  return add(state, { title: String(quest.title || 'A quest'), brief, source: { kind: 'quest', questId } }, now);
}

/** A draft from a line Chris typed. → { state, id } */
export function draftFree(state, title, now) {
  if (!isRecord(state) || !text(title) || !finite(now)) return { state, id: null };
  return add(state, { title, brief: title.trim(), source: { kind: 'free' } }, now);
}

/** Changes a draft (title, brief, who, ward, folder). A commission already sent is left as it was. */
export function updateDraft(state, id, patch) {
  const c = find(state, id);
  if (!c || c.status !== 'draft' || !isRecord(patch)) return state;
  const next = {};
  if (typeof patch.title === 'string') { const t = clip(patch.title.replace(/\s+/g, ' ').trim(), LIMITS.title); if (t) next.title = t; }
  if (typeof patch.brief === 'string') next.brief = patch.brief.slice(0, LIMITS.brief);
  if (CREW.includes(patch.who)) next.who = patch.who;
  if (WARDS.includes(patch.ward)) next.ward = patch.ward;
  if (typeof patch.folder === 'string') next.folder = patch.folder.slice(0, LIMITS.folder);
  if (!Object.keys(next).length) return state;
  let out = replace(state, id, next);
  // A building's folder is remembered for its next commission.
  if (next.folder && c.source.kind === 'building') {
    const section = sectionOf(out);
    out = withSection(out, { ...section, folders: { ...section.folders, [c.source.plotId]: next.folder } });
  }
  return out;
}

/** Drops a commission that isn't running. */
export function remove(state, id) {
  const c = find(state, id);
  if (!c || c.status === 'running') return state;
  const section = sectionOf(state);
  return withSection(state, { ...section, list: section.list.filter((x) => x.id !== id) });
}

// ---------------------------------------------------------------------------
// Sending, and what comes back

/** Whether anything is out right now. */
export const running = (state) => sectionOf(state).list.find((c) => c.status === 'running') || null;

// ---------------------------------------------------------------------------
// The Sally Port (the Hold, Hearth tier 3): a queue for commissions, so they never pile up. One is
// out at a time still; up to three more wait their turn and set out one after another, each as
// sent (and, for Change files, confirmed) by Chris. It lasts while MILO is open, and if one comes
// back unfinished or is called back, what is waiting goes back to the drafts.

/** The Hearth tier that opens the Sally Port. */
export const QUEUE_FROM_TIER = 3;
/** How many may wait. */
export const QUEUE_ROOM = 3;

/** How many commissions may wait at the Hearth's tier (none before the Hold). */
export const queueRoom = (state) => (Number.isFinite(state?.hearth?.tier) && state.hearth.tier >= QUEUE_FROM_TIER ? QUEUE_ROOM : 0);

/** The commissions waiting their turn, the one that has waited longest first. */
export const waiting = (state) => sectionOf(state).list.filter((c) => c.status === 'waiting').sort((a, b) => (a.queuedAt ?? 0) - (b.queuedAt ?? 0));

/** Why a draft can't be sent yet, in words, or '' when it can (it may wait its turn, at the Hold). */
export function sendProblem(state, id, env = {}) {
  const c = find(state, id);
  if (!c) return 'That commission is gone.';
  if (c.status === 'waiting') return 'It is in the queue.';
  if (c.status !== 'draft') return 'It has already been sent.';
  if (!text(c.brief)) return 'Say what you want done.';
  const folder = folderProblem(c.folder, env);
  if (folder) return folder;
  if (running(state)) {
    if (!queueRoom(state)) return 'One at a time. Another commission is still out.';
    if (waiting(state).length >= queueRoom(state)) return 'The queue is full.';
  }
  return '';
}

const start = (state, id, now) => replace(state, id, { status: 'running', sentAt: Math.round(now), endedAt: null, queuedAt: null, result: null, proved: false });

/** The crew member sets out, or, with someone already out and the Sally Port open, waits. → { state, ok, queued, why } */
export function send(state, id, now, env = {}) {
  const why = sendProblem(state, id, env);
  if (why || !finite(now)) return { state, ok: false, queued: false, why: why || 'Not now.' };
  if (running(state)) return { state: replace(state, id, { status: 'waiting', queuedAt: Math.round(now) }), ok: true, queued: true, why: '' };
  return { state: start(state, id, now), ok: true, queued: false, why: '' };
}

/** Takes a commission out of the queue, back to the drafts. */
export function unqueue(state, id) {
  const c = find(state, id);
  return c && c.status === 'waiting' ? replace(state, id, { status: 'draft', queuedAt: null }) : state;
}

/** Nobody is out: the commission that has waited longest sets out, if it can still go. → { state, id } */
export function startNext(state, now, env = {}) {
  if (running(state) || !finite(now)) return { state, id: null };
  for (const c of waiting(state)) {
    const draft = replace(state, c.id, { status: 'draft', queuedAt: null });
    if (sendProblem(draft, c.id, env)) { state = draft; continue; }
    return { state: start(draft, c.id, now), id: c.id };
  }
  return { state, id: null };
}

/**
 * They're back. `outcome`: { ok, summary, files, ms, why }. A finished run waits for Chris to read
 * it ('review'); one that didn't finish is 'failed', and one he stopped is 'stopped'.
 */
export function comeBack(state, id, outcome, now) {
  const c = find(state, id);
  if (!c || c.status !== 'running' || !finite(now)) return state;
  const o = isRecord(outcome) ? outcome : {};
  const status = o.stopped === true ? 'stopped' : o.ok === true ? 'review' : 'failed';
  let next = replace(state, id, { status, endedAt: Math.round(now), result: cleanResult(o) });
  // One that didn't finish stops the queue behind it: they go back to the drafts, to be sent again.
  if (status !== 'review') for (const w of waiting(next)) next = replace(next, w.id, { status: 'draft', queuedAt: null });
  return next;
}

/**
 * Chris has read it. For a building's level, `proved` says he has seen it do what the level asks:
 * only then does the building go up a level. → { state, ok, levelled: { plotId, level } | null }
 */
export function accept(state, id, now, { proved = false } = {}) {
  const c = find(state, id);
  if (!c || !finite(now)) return { state, ok: false, levelled: null };
  // One that didn't finish is read and put away; it proves nothing.
  if (c.status === 'failed' || c.status === 'stopped') return { state: replace(state, id, { status: 'done', proved: false }), ok: true, levelled: null };
  if (c.status !== 'review') return { state, ok: false, levelled: null };
  const proves = proved === true && canProve(state, c);
  let next = replace(state, id, { status: 'done', proved: proves });
  let levelled = null;
  if (proves) {
    const section = sectionOf(next);
    next = withSection(next, { ...section, levels: { ...section.levels, [c.source.plotId]: c.source.level } });
    levelled = { plotId: c.source.plotId, level: c.source.level };
  }
  return { state: next, ok: true, levelled };
}

/** Sends it again as a fresh draft with the same brief, folder and ward. → { state, id } */
export function again(state, id, now) {
  const c = find(state, id);
  if (!c || !['failed', 'stopped', 'done', 'review'].includes(c.status) || !finite(now)) return { state, id: null };
  return add(state, { title: c.title, brief: c.brief, who: c.who, ward: c.ward, folder: c.folder, source: c.source }, now);
}

// ---------------------------------------------------------------------------
// What the panel shows

const ORDER = Object.freeze({ running: 0, waiting: 1, review: 2, draft: 3, failed: 4, stopped: 4, done: 5 });

/** Everything, grouped for the panel: running first, then what's waiting to be read, drafts, and the rest newest first. */
export function view(state, env = {}) {
  const section = sectionOf(state);
  const rows = section.list.map((c) => ({
    ...c,
    whoWord: CREW_WORDS[c.who],
    wardWord: WARD_WORDS[c.ward],
    canSend: c.status === 'draft' && !sendProblem(state, c.id, env),
    problem: c.status === 'draft' ? sendProblem(state, c.id, env) : '',
    // With someone out and the Sally Port open, Send puts it in the queue.
    queues: c.status === 'draft' && Boolean(running(state)) && queueRoom(state) > 0 && !sendProblem(state, c.id, env),
    // A level only counts when files could change: a look or a suggestion builds nothing.
    canProve: canProve(state, c),
    // A building's check, when this commission is for one: what it is and how it last went.
    checkCmd: c.source.kind === 'building' ? checkFor(state, c.source.plotId) : '',
    lastCheck: c.source.kind === 'building' ? lastCheck(state, c.source.plotId) : null,
    levelAtStake: c.status === 'review' && c.source.kind === 'building' && wardWrites(c.ward) && c.source.level === levelOf(state, c.source.plotId) + 1,
  })).sort((a, b) => ORDER[a.status] - ORDER[b.status] || (b.endedAt ?? b.sentAt ?? b.createdAt) - (a.endedAt ?? a.sentAt ?? a.createdAt));
  return { rows, out: rows.find((r) => r.status === 'running') || null, buildable: buildable(state), any: rows.length > 0, queueRoom: queueRoom(state) };
}

/** The brief as it is handed over: what to do, the ward in plain words, and how to answer. */
export function briefFor(commission) {
  const c = isRecord(commission) ? commission : {};
  const rules = {
    look: 'Read what you need in this folder. Do not change, create or delete any file. Do not run commands that change anything.',
    suggest: 'Read what you need in this folder. Do not change, create or delete any file. Write up the changes you would make, file by file.',
    change: 'You may add and edit files inside this folder only. Do not touch anything outside it. Do not delete files you did not create. Do not commit, push, install anything or change settings.',
  };
  return [
    String(c.brief || '').trim(),
    '',
    rules[WARDS.includes(c.ward) ? c.ward : 'look'],
    'When you are done, answer with a short plain summary of what you found or did, then a list of the files that matter, one per line.',
  ].join('\n');
}
