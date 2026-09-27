// The Architect: suggests what to build on a plot and asks the crew to design it.
//
//   const architect = createArchitect();
//   await architect.status({ designer, refresh })
//     -> { designer: 'claude'|'codex'|'kit', mode, busy, share, fallsBack, crew: [{ id, found, ready, detail }] }
//     (a sign-in check that said "not signed in" is repeated after PROBE_TTL_MS, or at once with refresh)
//   architect.localSuggestions(plot, built, { question, exclude })   -> Suggestion[3], instant, offline
//   await architect.suggest({ plot, question, built, exclude, designer, onAsk })
//     -> { suggestions: Suggestion[3], by: 'claude'|'codex'|'kit', note, fallback, skipped, repairs, ms? }
//   await architect.design({ plot, idea, tweak, built, previous, designer, onAsk })
//     -> { blueprint, by: 'claude'|'codex'|'kit', idea: Suggestion, note, fallback, skipped, repairs, ms? }
//   architect.cancel();   architect.busy();
//
// plot = { id, name, w, h } (buildable size in tiles); built = names of existing buildings;
// idea = a Suggestion or the text Chris typed; exclude = suggestions already on screen (so an
// ask returns fresh ones); previous = the old blueprint when redesigning (only its name and style
// values are shared). `note` is a calm line for Chris when Milo fell back or moved on ('' if not);
// `fallback` says why Milo drew it himself ({ by: 'claude'|'codex'|null, code: 'missing'|'auth'|
// 'agents'|'invalid'|'failed'|'timeout'|'spawn' }, or null); `skipped` lists crew members Automatic
// mode moved past because they turned out not to be signed in. `onAsk(id)` is called just before
// each crew member is asked, so the UI can always say who has the brief right now.
// `repairs` lists what validation had to fix ([] means the crew's answer came in clean).
// Errors are thrown with a calm message and a `code`: 'busy' (another call is running),
// 'cancelled' (cancel() stopped it), 'no-idea' (empty idea) or 'crew-failed' (a redesign the crew
// couldn't finish: the building stays as it was, and the error carries `fallback`).
//
// Modes: 'auto' (Claude Code if signed in, else Codex, else Milo's kit), 'claude', 'codex',
// 'kit' / 'offline' (no crew calls), 'fake' (canned crew for tests: ~1.2 s design delay, set
// MILO_FAKE_DELAY_MS to change it; an idea, tweak or question containing "fail" falls back to the
// kit, or for a redesign fails with crew-failed). A call may pass `designer` ('auto' | 'claude' | 'codex' | 'kit', from settings.designer);
// it applies unless the architect was created in 'kit' mode (then nothing is ever sent).
// Options beyond the contract: env (default process.env), claudeHome (MILO_CLAUDE_HOME or
// ~/.claude), projectsDir (MILO_PROJECTS_DIR or C:\Users\chris\Projects), timeoutMs, fakeDelayMs.
//
// Only the idea or question, the plot's name and size, building names, project folder names and
// skill names with short descriptions ever reach a crew CLI (crew.js keeps each CLI's own extras out:
// Claude Code's CLAUDE.md files and auto memory, Codex's skills block and file tools). Main process only.

import os from 'node:os';
import path from 'node:path';
import {
  BLUEPRINT_SCHEMA, CREW_NAMES, DESIGNERS, LIMITS, SUGGESTIONS_SCHEMA, cleanText, ideaFromText, sameTitle, shareNote,
  validateBlueprint, validateSuggestions,
} from './blueprint.js';
import { createSignalReader } from './context.js';
import {
  CREW_TIMEOUT_MS, askClaude, askCodex, childEnv, codexAgentsFile, findClaude, findCodex, probeClaudeAuth, probeCodexLogin,
} from './crew.js';
import { kitBlueprint, localSuggestions, namedIdea } from './offline.js';
import { designPrompt, suggestPrompt } from './prompts.js';

export const MODES = Object.freeze(['auto', 'claude', 'codex', 'kit', 'offline', 'fake']);
export const BUSY_MESSAGE = 'Milo is already asking the crew';
export const CANCELLED_MESSAGE = 'Milo stopped asking the crew';
export const DETAILS = Object.freeze({
  missing: 'Not found on this PC',
  claudeSignIn: 'Sign in by running claude in a terminal once',
  codexSignIn: 'Sign in by running codex in a terminal once',
  ready: 'Ready to draw up plans',
  found: 'Found on this PC',
  offline: 'Not asked while Milo works on his own',
  codexAgents: 'Not asked: Codex would also send the AGENTS.md in your .codex folder',
});
// A probe that said "not signed in" (or couldn't tell) is asked again after this long, so signing in
// while MILO is open counts. A real call that fails to sign in still counts for the whole launch.
export const PROBE_TTL_MS = 60 * 1000;
const CREW_IDS = ['claude', 'codex'];
const FAKE_FAIL = /\bfail/i;

// Canned answers for 'fake' mode (tests only).
const FAKE_IDEAS = [
  { title: 'Lantern library', pitch: 'Keeps notes and reading lists in one warm, well-lit place.', why: 'Picked by the test crew' },
  { title: 'Pebble post', pitch: 'Sorts incoming messages into tidy little piles.', why: 'Picked by the test crew' },
  { title: 'Tea house', pitch: 'A quiet spot for a daily check-in and a short plan.', why: 'Picked by the test crew' },
  { title: 'Kite workshop', pitch: 'Makes small tools and scripts on request.', why: 'Picked by the test crew' },
  { title: 'Moss garden', pitch: 'Tends small habits with a gentle streak.', why: 'Picked by the test crew' },
  { title: 'Star chart', pitch: 'A weekly look at what the crew did and what it cost.', why: 'Picked by the test crew' },
  { title: 'Harvest barn', pitch: 'Gathers files from around the PC into tidy folders.', why: 'Picked by the test crew' },
  { title: 'Dice den', pitch: 'Plans game nights: encounters, snacks and who is coming.', why: 'Picked by the test crew' },
  { title: 'Clock garden', pitch: 'Keeps deadlines in view and nudges you before each one.', why: 'Picked by the test crew' },
];

function calmError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const normalizeMode = (value) => {
  const mode = String(value || '').toLowerCase();
  if (mode === 'offline') return 'kit';
  return MODES.includes(mode) ? mode : 'auto';
};

/** A plot as the architect uses it: safe id, short name, whole-tile size within 1..64. */
export function cleanPlot(plot) {
  const source = plot && typeof plot === 'object' ? plot : {};
  const size = (value, fallback) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= 1 ? Math.min(n, 64) : fallback;
  };
  return {
    id: typeof source.id === 'string' && /^[a-z0-9-]{1,40}$/i.test(source.id) ? source.id : 'plot',
    name: cleanText(source.name, 40) || 'This plot',
    w: size(source.w, 8),
    h: size(source.h, 6),
  };
}

function delayFrom(value, fallback) {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Why the crew didn't come through, as a phrase: "Codex isn't signed in", "The crew isn't signed in". */
export function reasonPhrase(reason) {
  const who = CREW_NAMES[reason && reason.by] || null;
  const code = reason && reason.code;
  if (code === 'missing') return who ? `${who} isn't on this PC` : "Milo couldn't reach the crew";
  if (code === 'auth') return who ? `${who} isn't signed in` : "The crew isn't signed in";
  if (code === 'agents') return 'Codex would also send the AGENTS.md in your .codex folder';
  if (code === 'invalid') return `${who || 'The crew'}'s answer was hard to read`;
  return `${who || 'The crew'} didn't answer`;
}

function fallbackNote(attempt, kind) {
  if (attempt.code === 'missing' && !attempt.by) {
    return kind === 'suggest' ? "Milo couldn't reach the crew, so these are his own ideas." : "Milo couldn't reach the crew, so he drew this one himself.";
  }
  const tail = kind === 'suggest' ? "so these are Milo's own ideas." : 'so Milo drew this one himself.';
  return `${reasonPhrase(attempt)}, ${tail}`;
}

const fallbackOf = (attempt) => ({ by: attempt && CREW_IDS.includes(attempt.by) ? attempt.by : null, code: (attempt && attempt.code) || 'failed' });

function movedOnNote(attempt, kind) {
  if (!attempt.skipped || !attempt.skipped.length) return '';
  const skipped = CREW_NAMES[attempt.skipped[0]];
  const who = CREW_NAMES[attempt.by];
  return kind === 'suggest' ? `${skipped} isn't signed in, so ${who} suggested these.` : `${skipped} isn't signed in, so ${who} drew this one.`;
}

export function createArchitect({
  env = process.env,
  home = os.homedir(),
  projectsDir = env.MILO_PROJECTS_DIR || 'C:\\Users\\chris\\Projects',
  claudeHome = env.MILO_CLAUDE_HOME || path.join(home, '.claude'),
  mode = env.MILO_ARCHITECT || 'auto',
  spawnImpl,
  now = () => Date.now(),
  timeoutMs = CREW_TIMEOUT_MS,
  fakeDelayMs = delayFrom(env.MILO_FAKE_DELAY_MS, 1200),
} = {}) {
  const baseMode = normalizeMode(mode);
  const signals = createSignalReader({ claudeHome, projectsDir, now });
  const crewEnv = () => childEnv(env);
  const auth = {
    claude: { loggedIn: undefined, signedOut: false, probing: null, checkedAt: 0 },
    codex: { loggedIn: undefined, signedOut: false, probing: null, checkedAt: 0 },
  };
  // Codex sends $CODEX_HOME/AGENTS.md with every request and nothing turns that off, so Codex isn't
  // asked while that file exists (MILO only checks that it's there; it never opens it).
  const codexBlocked = () => Boolean(codexAgentsFile({ env, home }));
  let job = null;
  let fakeAsks = 0;

  const findBin = (id) => (id === 'claude' ? findClaude({ env, home }) : findCodex({ env, home }));

  /** The mode a call runs in, given the optional per-call designer setting. */
  function resolveMode(designer) {
    if (baseMode === 'kit') return 'kit';
    const wanted = designer === undefined || designer === null ? null : normalizeMode(designer);
    if (baseMode === 'fake') return wanted && wanted !== 'fake' ? wanted : 'auto';
    return wanted && wanted !== 'fake' ? wanted : baseMode;
  }

  async function probe(id, { refresh = false } = {}) {
    const state = auth[id];
    if (state.signedOut) return false;
    // "Signed in" holds until a real call says otherwise; "not signed in" or "can't tell" is checked
    // again after a minute, so Chris signing in while MILO is open is noticed.
    const fresh = state.loggedIn === true || now() - state.checkedAt < PROBE_TTL_MS;
    if (state.loggedIn !== undefined && !refresh && fresh) return state.loggedIn;
    if (!state.probing) {
      const bin = findBin(id);
      const run = id === 'claude' ? probeClaudeAuth : probeCodexLogin;
      state.probing = Promise.resolve()
        .then(() => run({ bin, env: crewEnv(), spawnImpl }))
        .catch(() => null)
        .then((value) => {
          if (!state.signedOut) state.loggedIn = value;
          state.checkedAt = now();
          state.probing = null;
          return state.signedOut ? false : value;
        });
    }
    return state.probing;
  }

  function crewEntry(id, bin, offline) {
    const state = auth[id];
    const found = Boolean(bin);
    if (!found) return { id, found, ready: false, detail: DETAILS.missing };
    if (offline) return { id, found, ready: false, detail: DETAILS.offline };
    if (id === 'codex' && codexBlocked()) return { id, found, ready: false, detail: DETAILS.codexAgents };
    const signedIn = !state.signedOut && state.loggedIn !== false;
    if (!signedIn) return { id, found, ready: false, detail: id === 'claude' ? DETAILS.claudeSignIn : DETAILS.codexSignIn };
    return { id, found, ready: true, detail: state.loggedIn === true ? DETAILS.ready : DETAILS.found };
  }

  /** Whether a crew member can be asked at all right now (found, not signed out, not blocked). */
  const askable = (id) => Boolean(findBin(id)) && !auth[id].signedOut && !(id === 'codex' && codexBlocked());

  function fakeStatus(runMode) {
    const designer = runMode === 'kit' ? 'kit' : runMode === 'claude' ? 'claude' : 'codex';
    return {
      designer,
      mode: runMode,
      busy: Boolean(job),
      share: shareNote(designer),
      crew: [
        { id: 'claude', found: true, ready: false, detail: DETAILS.claudeSignIn },
        { id: 'codex', found: true, ready: true, detail: DETAILS.ready },
      ],
    };
  }

  async function status({ designer, refresh = false } = {}) {
    const runMode = resolveMode(designer);
    if (baseMode === 'fake') return fakeStatus(runMode);
    const bins = { claude: findBin('claude'), codex: findBin('codex') };
    const offline = runMode === 'kit';
    if (!offline) await Promise.all(CREW_IDS.filter((id) => bins[id]).map((id) => probe(id, { refresh })));
    const crew = CREW_IDS.map((id) => crewEntry(id, bins[id], offline));
    let chosen = 'kit';
    // A chosen crew member that already failed to sign in this launch isn't asked again.
    if (runMode === 'claude' || runMode === 'codex') chosen = askable(runMode) ? runMode : 'kit';
    else if (runMode === 'auto') chosen = (crew.find((entry) => entry.ready) || { id: 'kit' }).id;
    // Automatic mode may still hand the brief to Codex if Claude Code turns out not to be signed in.
    const fallsBack = runMode === 'auto' && chosen === 'claude' && crew.some((entry) => entry.id === 'codex' && entry.ready);
    return { designer: chosen, mode: runMode, busy: Boolean(job), share: shareNote(chosen, { auto: fallsBack }), fallsBack, crew };
  }

  /**
   * Who to ask, in order, for a call in `runMode`, and why nobody is asked when the list is empty.
   * A chosen crew member is always tried once; after a sign-in failure it is skipped for this launch.
   */
  async function crewOrder(runMode) {
    if (runMode === 'claude' || runMode === 'codex') {
      if (!findBin(runMode)) return { order: [], reason: { by: runMode, code: 'missing' } };
      if (auth[runMode].signedOut) return { order: [], reason: { by: runMode, code: 'auth' } };
      if (runMode === 'codex' && codexBlocked()) return { order: [], reason: { by: 'codex', code: 'agents' } };
      return { order: [runMode], reason: null };
    }
    const order = [];
    const left = [];
    const found = CREW_IDS.filter((id) => findBin(id));
    // Both sign-in checks at once (a stale one is asked again, and Claude Code's takes a moment).
    const checks = await Promise.all(found.map((id) => (id === 'codex' && codexBlocked() ? 'blocked' : probe(id))));
    found.forEach((id, index) => {
      if (checks[index] === 'blocked') left.push({ by: id, code: 'agents' });
      else if (checks[index] !== false && !auth[id].signedOut) order.push(id);
      else left.push({ by: id, code: 'auth' });
    });
    // Nobody to ask: say why (who isn't signed in), not just that the crew couldn't be reached.
    let reason = { by: null, code: 'missing' };
    if (left.length === 1) reason = left[0];
    else if (left.length > 1) reason = left.every((item) => item.code === 'auth') ? { by: null, code: 'auth' } : left.find((item) => item.code === 'auth') || left[0];
    return { order, reason };
  }

  async function exclusive(work) {
    if (job) throw calmError(BUSY_MESSAGE, 'busy');
    const current = { cancelled: false, kills: new Set(), wake: null };
    job = current;
    try {
      return await work(current);
    } finally {
      if (job === current) job = null;
    }
  }

  async function askCrew(order, prompt, schema, current, autoMode, onAsk) {
    const skipped = [];
    let last = null;
    for (const id of order) {
      if (current.cancelled) return { cancelled: true };
      const bin = findBin(id);
      if (!bin) continue;
      const ask = id === 'claude' ? askClaude : askCodex;
      // Tell the UI who has the brief now (Automatic mode may have moved on from Claude Code).
      try {
        if (typeof onAsk === 'function') onAsk(id);
      } catch {
        // the UI's trouble, not the call's
      }
      const onKill = (kill) => {
        current.kills.add(kill);
        if (current.cancelled) kill('cancelled');   // cancel() arrived while the call was starting
      };
      const result = await ask({ bin, prompt, schema, env: crewEnv(), timeoutMs, spawnImpl, onKill });
      current.kills.clear();
      if (current.cancelled || result.code === 'cancelled') return { cancelled: true };
      if (result.ok) {
        auth[id].loggedIn = true;
        auth[id].checkedAt = now();
        return { ok: true, by: id, data: result.data, ms: result.ms, loose: result.loose, skipped };
      }
      last = { ok: false, by: id, code: result.code, ms: result.ms, skipped };
      if (result.code === 'auth') {
        auth[id].signedOut = true;
        auth[id].loggedIn = false;
        skipped.push(id);
        if (autoMode) continue;
      }
      return last;
    }
    return last || { ok: false, by: null, code: 'missing', skipped };
  }

  function fakeWait(current, ms) {
    return new Promise((resolve) => {
      if (current.cancelled) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, ms);
      current.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    }).then(() => {
      if (current.cancelled) throw calmError(CANCELLED_MESSAGE, 'cancelled');
    });
  }

  function localFor(plot, built, { question = '', exclude = [] } = {}) {
    return localSuggestions(cleanPlot(plot), signals.read(built), { question, exclude });
  }

  async function suggest({ plot, question = '', built = [], exclude = [], designer, onAsk } = {}) {
    const p = cleanPlot(plot);
    const q = cleanText(question, 300);
    return exclusive(async (current) => {
      const sig = signals.read(built);
      const local = (skip = []) => localSuggestions(p, sig, { question: q, exclude: [...exclude, ...skip] });
      const runMode = resolveMode(designer);
      const settled = { note: '', fallback: null, skipped: [], repairs: [] };
      const fellBack = (attempt, extra = {}) => ({ suggestions: local(), by: 'kit', ...settled, note: fallbackNote(attempt, 'suggest'), fallback: fallbackOf(attempt), ...extra });
      if (runMode === 'kit') return { suggestions: local(), by: 'kit', ...settled };

      if (baseMode === 'fake') {
        const who = runMode === 'claude' ? 'claude' : 'codex';
        if (typeof onAsk === 'function') onAsk(who);
        await fakeWait(current, Math.min(400, fakeDelayMs));
        if (FAKE_FAIL.test(q)) return fellBack({ by: who, code: 'failed' });
        const offset = (fakeAsks * 3) % FAKE_IDEAS.length;
        fakeAsks += 1;
        const rotated = [...FAKE_IDEAS.slice(offset), ...FAKE_IDEAS.slice(0, offset)];
        const suggestions = validateSuggestions(rotated, { source: who, built: sig.built, exclude });
        return { suggestions, by: who, ...settled };
      }

      const { order, reason } = await crewOrder(runMode);
      if (!order.length) return fellBack(reason);
      const prompt = suggestPrompt({ plot: p, question: q, signals: sig, exclude });
      const attempt = await askCrew(order, prompt, SUGGESTIONS_SCHEMA, current, runMode === 'auto', onAsk);
      if (attempt.cancelled) throw calmError(CANCELLED_MESSAGE, 'cancelled');
      const skipped = [...(attempt.skipped || [])];
      if (attempt.ok) {
        const raw = attempt.data && Array.isArray(attempt.data.suggestions) ? attempt.data.suggestions : [];
        const suggestions = validateSuggestions(attempt.data, { source: attempt.by, built: sig.built, exclude });
        const repairs = [];
        if (attempt.loose) repairs.push('read JSON from plain text');
        if (raw.length !== LIMITS.suggestions) repairs.push(`crew sent ${raw.length} suggestions`);
        if (suggestions.length < raw.length) repairs.push('dropped duplicates or existing buildings');
        raw.forEach((item) => {
          if (!item || typeof item !== 'object') return;
          if (typeof item.title === 'string' && Array.from(item.title.trim()).length > LIMITS.title) repairs.push('a title was shortened');
          if (typeof item.pitch === 'string' && Array.from(item.pitch.trim()).length > LIMITS.pitch) repairs.push('a pitch was shortened');
          if (typeof item.why === 'string' && Array.from(item.why.trim()).length > LIMITS.why) repairs.push('a why was shortened');
        });
        if (!suggestions.length) return fellBack({ by: attempt.by, code: 'invalid' }, { repairs, skipped, ms: attempt.ms });
        if (suggestions.length < LIMITS.suggestions) {
          for (const extra of local(suggestions.map((item) => item.title))) {
            if (suggestions.length >= LIMITS.suggestions) break;
            suggestions.push(extra);
          }
          repairs.push("topped up with Milo's own ideas");
        }
        return { suggestions, by: attempt.by, note: movedOnNote(attempt, 'suggest'), fallback: null, skipped, repairs: [...new Set(repairs)], ms: attempt.ms };
      }
      return fellBack(attempt, { skipped, ms: attempt.ms });
    });
  }

  /** A redesign the crew couldn't finish: the building that's standing stays, and Chris is told why. */
  function redesignFailed(attempt) {
    const reason = fallbackOf(attempt);
    const error = calmError(`${reasonPhrase(reason)}, so the building stays as it was.`, 'crew-failed');
    error.fallback = reason;
    return error;
  }

  async function design({ plot, idea, tweak = '', built = [], previous = null, designer, onAsk } = {}) {
    const p = cleanPlot(plot);
    const chosen = namedIdea(idea);
    // An idea Chris typed without a name ("something for my coursework reading") goes to the crew as
    // he wrote it, so the crew names it rather than keeping the kit's stand-in title.
    const typed = typeof idea === 'string' ? ideaFromText(idea) : idea;
    const named = Boolean(typed && typeof typed.title === 'string' && typed.title.trim() && !sameTitle(typed.title, 'Your idea'));
    if (!chosen) throw calmError('Tell Milo what to build first', 'no-idea');
    const change = cleanText(tweak, 200);
    const before = previous ? validateBlueprint(previous) : null;
    const old = before && before.ok ? before.blueprint : null;
    return exclusive(async (current) => {
      const sig = signals.read(built);
      const kit = () => kitBlueprint(chosen, { plot: p, tweak: change, previous: old });
      const runMode = resolveMode(designer);
      const settled = { note: '', fallback: null, skipped: [], repairs: [] };
      const fellBack = (attempt, extra = {}) => ({ blueprint: kit(), by: 'kit', idea: chosen, ...settled, note: fallbackNote(attempt, 'design'), fallback: fallbackOf(attempt), ...extra });
      if (runMode === 'kit') return { blueprint: kit(), by: 'kit', idea: chosen, ...settled };

      if (baseMode === 'fake') {
        const who = runMode === 'claude' ? 'claude' : 'codex';
        if (typeof onAsk === 'function') onAsk(who);
        await fakeWait(current, fakeDelayMs);
        if (FAKE_FAIL.test(`${chosen.title} ${chosen.pitch} ${change}`)) {
          if (old) throw redesignFailed({ by: who, code: 'failed' });
          return fellBack({ by: who, code: 'failed' });
        }
        return { blueprint: kit(), by: who, idea: chosen, ...settled };
      }

      // Nobody to ask (Milo's kit chosen, no crew, or signed out): Milo draws it, redesigns too.
      const { order, reason } = await crewOrder(runMode);
      if (!order.length) return fellBack(reason);
      const prompt = designPrompt({ plot: p, idea: chosen, tweak: change, signals: sig, previous: old, named });
      const attempt = await askCrew(order, prompt, BLUEPRINT_SCHEMA, current, runMode === 'auto', onAsk);
      if (attempt.cancelled) throw calmError(CANCELLED_MESSAGE, 'cancelled');
      const skipped = [...(attempt.skipped || [])];
      if (attempt.ok) {
        const fallback = kit();
        const checked = validateBlueprint(attempt.data, { fallback });
        const repairs = attempt.loose ? ['read JSON from plain text', ...checked.problems] : checked.problems;
        if (checked.ok) {
          return { blueprint: checked.blueprint, by: attempt.by, idea: chosen, note: movedOnNote(attempt, 'design'), fallback: null, skipped, repairs, ms: attempt.ms };
        }
        // A redesign keeps the crew's standing building rather than swapping in the kit's.
        if (old) throw redesignFailed({ by: attempt.by, code: 'invalid' });
        return { ...fellBack({ by: attempt.by, code: 'invalid' }, { repairs, skipped, ms: attempt.ms }), blueprint: fallback };
      }
      if (old) throw redesignFailed(attempt);
      return fellBack(attempt, { skipped, ms: attempt.ms });
    });
  }

  function cancel() {
    if (!job) return;
    job.cancelled = true;
    for (const kill of job.kills) kill('cancelled');
    if (job.wake) job.wake();
  }

  return {
    mode: baseMode,
    status,
    localSuggestions: localFor,
    suggest,
    design,
    cancel,
    busy: () => Boolean(job),
  };
}

export { DESIGNERS };
