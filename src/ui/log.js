// The Log and its command bar (CONTRACT-PHASE4.md §12.1, §12.2, §12.4 K1; PLAN.md §7; COMBAT.md
// §13): one feed for everything, in tabs (All, Crew, Milo, World, and Combat in a fight), the
// newest 200 lines in memory, a line that expands to its detail, and the command bar, where plain
// words or `::` spells run commands.parseCommand and each intent goes to the same function a
// button would call. Pure builders and tables, plus a thin mount for #log.
//
// Nothing a command does reaches the architect in Phase 4 (no `::send` yet), so no command needs
// the architect's gate; a later spell that does must go through it.
import { parseCommand, completions } from '../commands.js';
import { PLACES } from '../world/map.js';
import { esc } from './panels.js';
import { runKindle } from './kindle-view.js';
import { setHudMode } from './hud.js';

export const id = 'log';
/** The Log's tabs, in order; Combat shows only in a fight. */
export const LOG_TABS = Object.freeze(['all', 'crew', 'milo', 'world', 'combat']);
/** The tabs a line can be written to (LogEntry.tab). */
export const LINE_TABS = Object.freeze(['crew', 'milo', 'world', 'combat']);
export const TAB_LABELS = Object.freeze({ all: 'All', crew: 'Crew', milo: 'Milo', world: 'World', combat: 'Combat' });
/** Lines kept in memory. */
export const LOG_MAX = 200;
const TEXT_MAX = 120;
const DETAIL_MAX = 12;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const clipText = (text, max) => {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
};
const pad = (n) => String(n).padStart(2, '0');
/** '09:10' on the local clock. */
export const timeText = (ms) => {
  if (!finite(ms)) return '';
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/**
 * A LogEntry (§12.2) made safe: { tab, text (≤ 120), at, detail: string[] | null, action: null |
 * { id, label } }, or null when there's no text. A bad tab is Milo's; a missing time is `now`.
 */
export function cleanEntry(entry, now = null) {
  if (!isRecord(entry) || typeof entry.text !== 'string' || !entry.text.trim()) return null;
  const detail = Array.isArray(entry.detail)
    ? entry.detail.filter((line) => typeof line === 'string' && line.trim()).slice(0, DETAIL_MAX).map((line) => clipText(line, 240))
    : [];
  const action = isRecord(entry.action) && typeof entry.action.id === 'string' && entry.action.id && typeof entry.action.label === 'string' && entry.action.label.trim()
    ? { id: entry.action.id.slice(0, 80), label: clipText(entry.action.label, 40) } : null;
  return {
    tab: LINE_TABS.includes(entry.tab) ? entry.tab : 'milo',
    text: clipText(entry.text, TEXT_MAX),
    at: finite(entry.at) ? entry.at : finite(now) ? now : 0,
    detail: detail.length ? detail : null,
    action,
  };
}

/** The lines with one more (numbered `seq`), the newest LOG_MAX kept. → a new list. */
export function pushLine(lines, entry, seq, { max = LOG_MAX } = {}) {
  const list = Array.isArray(lines) ? lines : [];
  if (!isRecord(entry)) return list;
  const next = [...list, { ...entry, seq }];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** The lines a tab shows: every line on All, else that tab's. */
export function linesOn(lines, tab) {
  const list = Array.isArray(lines) ? lines : [];
  return tab === 'all' || !LOG_TABS.includes(tab) ? list : list.filter((line) => line.tab === tab);
}

/** The tabs shown: Combat only in a fight. */
export const tabsShown = (combat) => LOG_TABS.filter((tab) => tab !== 'combat' || combat === true);

/** The Log's view: { tab, tabs, lines (that tab's), open: seq[] } from its lines. */
export function logView({ lines = [], tab = 'all', open = [], combat = false } = {}) {
  const tabs = tabsShown(combat);
  const shown = tabs.includes(tab) ? tab : 'all';
  return { tab: shown, tabs, lines: linesOn(lines, shown), open: [...new Set(Array.isArray(open) ? open : [...(open || [])])] };
}

/** The tab row (role=tablist, roving focus). */
export function buildLogTabs(view) {
  const tabs = Array.isArray(view?.tabs) ? view.tabs.filter((tab) => LOG_TABS.includes(tab)) : tabsShown(false);
  const current = tabs.includes(view?.tab) ? view.tab : 'all';
  return tabs.map((tab) => {
    const selected = tab === current;
    return `<button type="button" role="tab" class="log-tab" id="log-tab-${tab}" data-action="log-tab" data-tab="${tab}" aria-selected="${selected}" aria-controls="log-panel"`
      + ` tabindex="${selected ? 0 : -1}" data-focus-key="log-tab-${tab}">${TAB_LABELS[tab]}</button>`;
  }).join('');
}

/** One line: its time, its words (a button when it has more to show), its action, and its detail when open. */
export function buildLogLine(line, { open = [] } = {}) {
  if (!isRecord(line)) return '';
  const seq = Number.isInteger(line.seq) ? line.seq : 0;
  const tab = LINE_TABS.includes(line.tab) ? line.tab : 'milo';
  const expanded = Array.isArray(line.detail) && line.detail.length > 0 && (Array.isArray(open) ? open.includes(seq) : Boolean(open?.has?.(seq)));
  let html = `<li class="log-line" data-line="${seq}" data-tab="${tab}"><span class="log-time">${esc(timeText(line.at))}</span>`;
  if (Array.isArray(line.detail) && line.detail.length) {
    html += `<button type="button" class="log-text log-toggle" data-action="log-expand" data-line="${seq}" aria-expanded="${expanded}" tabindex="-1" data-focus-key="log-line-${seq}">${esc(line.text)}</button>`;
  } else {
    html += `<span class="log-text">${esc(line.text)}</span>`;
  }
  if (isRecord(line.action)) {
    html += ` <button type="button" class="link-btn log-act" data-action="log-act" data-line="${seq}" tabindex="-1" data-focus-key="log-act-${seq}">${esc(line.action.label)}</button>`;
  }
  if (expanded) html += `<ul class="log-detail">${line.detail.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`;
  return `${html}</li>`;
}

export const EMPTY_LINE = 'Nothing yet.';

/** The lines of the tab shown, oldest first (the newest at the bottom, by the command bar). */
export function buildLogLines(view) {
  const lines = Array.isArray(view?.lines) ? view.lines : [];
  if (!lines.length) return `<li class="log-empty">${esc(EMPTY_LINE)}</li>`;
  return lines.map((line) => buildLogLine(line, { open: view.open || [] })).join('');
}

/** The completions under the command bar ('::k' → '::kindle'), or nothing. */
export function buildHint(list) {
  const items = Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x).slice(0, 6) : [];
  return items.length ? items.map((item) => `<span class="log-hint-item">${esc(item)}</span>`).join(' · ') : '';
}

/**
 * The whole Log inside section#log: tabs, the tab panel with the lines (ol[aria-live=polite]) and
 * input#command. The completions under the bar are for the eye only (aria-hidden, and nothing
 * points at them): they change with every key.
 */
export function buildLog(view) {
  const v = isRecord(view) ? view : logView();
  const tab = LOG_TABS.includes(v.tab) ? v.tab : 'all';
  return `<div class="log-tabs" role="tablist" aria-label="Log">${buildLogTabs(v)}</div>`
    + `<div class="log-panel" role="tabpanel" id="log-panel" aria-labelledby="log-tab-${tab}">`
    + `<ol class="log-lines" id="log-lines" aria-live="polite" aria-relevant="additions" aria-label="The Log" tabindex="0" data-focus-key="log-lines">${buildLogLines(v)}</ol></div>`
    + '<div class="log-command">'
    + '<label class="sr-only" for="command">Command bar: talk to Milo in plain words, or cast with ::</label>'
    + '<input type="text" id="command" class="log-input" autocomplete="off" spellcheck="false" maxlength="200" placeholder="Talk to Milo, or type ::help" data-focus-key="command">'
    + `<p class="log-hint" id="log-hint" aria-hidden="true">${buildHint(v.hint)}</p>`
    + '</div>';
}

// ---------------------------------------------------------------------------
// Keys, as tables. None of them takes Tab: focus moves as usual.

/** The command bar's keys (Escape is the key stack's, so it can clear before anything closes). */
export const COMMAND_KEYS = Object.freeze({ Enter: 'run', ArrowUp: 'older', ArrowDown: 'newer' });
/** The tab row's keys (a tablist's arrows). */
export const TAB_KEYS = Object.freeze({ ArrowLeft: 'prev', ArrowRight: 'next', Home: 'first', End: 'last' });
/** The lines' keys: the list moves focus between lines that have more to show. */
export const LINE_KEYS = Object.freeze({ ArrowUp: 'prev', ArrowDown: 'next', Home: 'first', End: 'last', Enter: 'toggle', ' ': 'toggle', Escape: 'out' });
const plainKey = (event) => Boolean(event) && !event.altKey && !event.ctrlKey && !event.metaKey;
/** The action a key has in a table, or null (modifier keys and anything else). */
export function keyAction(table, event) {
  if (!plainKey(event) || !isRecord(table)) return null;
  if (event.shiftKey && event.key !== ' ') return null;
  return Object.hasOwn(table, event.key) ? table[event.key] : null;
}
/** The index focus moves to, clamped (tabs and lines don't wrap). */
export function moveIndex(action, index, count) {
  if (count <= 0) return -1;
  if (action === 'first') return 0;
  if (action === 'last') return count - 1;
  if (action === 'next') return Math.min(count - 1, index + 1);
  if (action === 'prev') return Math.max(0, index - 1);
  return index;
}

// ---------------------------------------------------------------------------
// Commands.

/** What Wayfinding can reach: the vale's places, the Hearth and the War Table. */
export function commandPlaces() {
  const vale = PLACES.map((place) => ({ id: place.id, name: place.name.replace(/'/g, '’') }));
  return [...vale, { id: 'hearth', name: 'The Hearth', words: ['hearth'] }, { id: 'war-table', name: 'The War Table', words: ['war table'] }];
}

/** The spells the Grimoire names, by id: { name, from }. */
function spellNames(grimoire) {
  const file = isRecord(grimoire) && isRecord(grimoire.spells) ? grimoire.spells : grimoire;
  const list = isRecord(file) && Array.isArray(file.spells) ? file.spells : Array.isArray(file) ? file : [];
  const out = {};
  for (const spell of list) if (isRecord(spell) && typeof spell.id === 'string') out[spell.id] = { name: typeof spell.name === 'string' ? spell.name : spell.id, from: spell.from };
  return out;
}

/** The help the command bar gives: its line and the commands, one a line. */
export const HELP = Object.freeze({
  text: 'Here’s what I understand. Plain words work too.',
  detail: Object.freeze([
    'Type ::kindle to start a focus session, or say “kindle the lantern”.',
    'Type ::banked-coals to rest, and ::stop to put the lantern out.',
    'Type ::chronicle, or “open the chronicle”, to read back your day.',
    'Type ::skills for your skills, and ::muster to set out.',
    'Type ::map for the map, and ::wayfinding with a place to walk there.',
    'Type ::home, or “go home”, to take Milo home.',
    'Type ::quiet or ::adventure to switch the HUD.',
  ]),
});

/**
 * Milo's answer to an intent the command bar can't just do: help, a spell not here yet, or words
 * it didn't catch. → a LogEntry, or null when the intent is one a button does.
 */
export function commandReply(intent, { grimoire = null } = {}) {
  if (!isRecord(intent)) return null;
  switch (intent.kind) {
    case 'help': return { tab: 'milo', text: HELP.text, detail: [...HELP.detail], action: null };
    case 'not-yet': {
      const spell = spellNames(grimoire)[intent.spell];
      const name = spell?.name || 'That spell';
      const from = typeof intent.from === 'string' && /^Phase \d{1,2}$/.test(intent.from) ? intent.from : null;
      return { tab: 'milo', text: from ? `${name} arrives in ${from}.` : `${name} comes later on.`, detail: null, action: null };
    }
    case 'unknown': {
      if (!intent.text) return null;
      const suggest = typeof intent.suggest === 'string' && intent.suggest ? intent.suggest : null;
      return { tab: 'milo', text: suggest ? `I’m not sure what that means. Did you mean ${suggest}?` : 'I’m not sure what that means. Try ::help.', detail: null, action: null };
    }
    default: return null;
  }
}

const HUD_WORDS = Object.freeze({ quiet: 'Quiet mode. Type ::adventure to bring the HUD back.', adventure: 'Adventure mode. The HUD is back.' });

/** Milo's answers when a command can't be done where things stand (real causes first). */
export const CANT = Object.freeze({
  homeInFight: 'We’re in a fight, so nobody walks home from here. Head home in the planner brings everyone back with what they found.',
  goInFight: 'We’re in a fight, so walking anywhere waits until it’s over.',
  mapInFight: 'The map waits until the fight’s over.',
  noWarTable: 'There’s no War Table yet. It goes up with the Stockade.',
});
const cant = (text) => ({ tab: 'milo', text, detail: null, action: null });
/** The Hearth's tier, as hearth.hearthTier reads it (state.hearth.tier, at least 1). */
const hearthTier = (state) => Math.max(1, Math.floor(Number(isRecord(state) && isRecord(state.hearth) ? state.hearth.tier : 1) || 1));
/** Whether a fight is on: the caller says, or the stage does (#stage[data-mode="combat"]). */
const fightOn = (combat) => (typeof combat === 'boolean' ? combat : globalThis.document?.getElementById?.('stage')?.dataset?.mode === 'combat');

/**
 * Whether the shell's 'combat' message says a fight is on (§18.3 item 10): its `live` field. The
 * fight sends { live: true, battle, roundView, ctx, command, … } with every step and ends with
 * { live: false }. A message without `live` is on when it's `true` or carries a battle, as the
 * combat HUD reads it; null, or anything else, is no fight.
 */
export function combatLive(message) {
  if (typeof message === 'boolean') return message;
  if (!isRecord(message)) return false;
  return typeof message.live === 'boolean' ? message.live : isRecord(message.battle);
}

/**
 * Does an intent through the shell, with the same function a button would call: Kindle's verbs
 * (kindle-view.runKindle), panels (shell.openPanel), the map (shell.openMap, else the Map button),
 * going places (shell.travel home, shell.openPanel(place, { walk: true }) in the vale) and the HUD
 * (hud.setHudMode). In a fight nothing walks and the map stays shut, and the War Table waits for
 * the Stockade: each says why (CANT). `combat` defaults to the stage's mode.
 * → the LogEntry Milo answers with, or null.
 */
export function dispatchIntent(shell, intent, { grimoire = null, combat = null } = {}) {
  if (!shell || !isRecord(intent)) return null;
  switch (intent.kind) {
    case 'spell': {
      const verb = intent.spell === 'kindle' ? 'start' : intent.spell === 'banked-coals' ? 'rest' : intent.spell === 'stop' ? 'stop' : null;
      if (!verb) return commandReply({ kind: 'not-yet', spell: intent.spell, from: null }, { grimoire });
      const done = runKindle(shell, verb);
      return done.words ? { tab: 'milo', text: done.words, detail: null, action: null } : null;
    }
    case 'open': {
      if (intent.panel === 'map') {
        if (fightOn(combat)) return cant(CANT.mapInFight);
        if (typeof shell.openMap === 'function') shell.openMap();
        else globalThis.document?.getElementById?.('map-button')?.click?.();
        return null;
      }
      shell.openPanel(intent.panel);
      return null;
    }
    case 'go': {
      if (typeof intent.place !== 'string') return null;
      if (fightOn(combat)) return cant(intent.place === 'home' ? CANT.homeInFight : CANT.goInFight);
      if (intent.place === 'war-table' && hearthTier(shell.state) < 2) return cant(CANT.noWarTable);
      if (intent.place === 'home') shell.travel('home');
      else if (intent.place.startsWith('lantern:')) shell.travel(intent.place);
      else shell.openPanel(intent.place, { walk: true });
      return null;
    }
    case 'hud': {
      setHudMode(shell, intent.mode);
      return HUD_WORDS[intent.mode] ? { tab: 'milo', text: HUD_WORDS[intent.mode], detail: null, action: null } : null;
    }
    default: return commandReply(intent, { grimoire });
  }
}

/** Parses and does what the command bar says; `combat` as dispatchIntent's. → { intent, reply: LogEntry | null }. */
export function runCommand(shell, text, { combat = null } = {}) {
  const content = typeof shell?.content === 'function' ? shell.content() : null;
  const grimoire = content?.spells ?? null;
  const intent = parseCommand(text, { grimoire, places: commandPlaces() });
  if (intent.kind === 'unknown' && !intent.text) return { intent, reply: null };
  if (typeof shell?.feature === 'function') shell.feature('command');
  return { intent, reply: dispatchIntent(shell, intent, { grimoire, combat }) };
}

// ---------------------------------------------------------------------------
// The DOM.

let mounted = null;

/** Shows a tab of the mounted Log (the HUD's Crew tab opens the Crew tab here). → true when shown. */
export function showTab(tab) {
  return mounted ? mounted.showTab(tab) : false;
}
/** A line of the mounted Log by its number ({ …LogEntry, seq, open }), for its right-click menu. */
export function lineOf(seq) {
  return mounted ? mounted.line(seq) : null;
}
/** Opens or closes a line of the mounted Log (its menu's “Show more”). → true when it has more to show. */
export function toggleLine(seq) {
  return mounted ? mounted.toggle(seq) : false;
}
/** Runs a line's action on the mounted Log. → true when the line has one. */
export function actLine(seq) {
  return mounted ? mounted.act(seq) : false;
}

const NOOP = Object.freeze({
  dispose() {}, refresh() {}, add() { return null; }, showTab() { return false; }, line() { return null; }, toggle() { return false; }, act() { return false; }, focusCommand() {},
});

/**
 * Mounts section#log. The shell's one sink (shell.log) calls the handle's `add(entry)`. A line's
 * action runs `options.act(action, line)` when given (→ true when done), else an action id
 * `panel:<id>` opens that panel and `tab:<tab>` shows that tab. The shell's 'combat' messages
 * show the Combat tab while their `live` is true (combatLive). → { dispose(), refresh(reason),
 * add(entry), showTab(tab), line(seq), toggle(seq), act(seq), focusCommand() }.
 */
export function mount(shell, options = {}) {
  try {
    const doc = globalThis.document;
    const root = doc?.getElementById?.('log');
    if (!shell || !root) return NOOP;
    const opts = isRecord(options) ? options : {};
    let lines = [];
    let seq = 0;
    let tab = 'all';
    const open = new Set();
    // Whether a fight is on, from the shell's 'combat' messages (combatLive); `heard` once one came.
    let combat = false;
    let heard = false;
    const history = [];
    let back = -1;
    let popKeys = null;
    const offs = [];

    const view = () => logView({ lines, tab, open: [...open], combat });
    root.innerHTML = buildLog(view());
    const tabsEl = root.querySelector('.log-tabs');
    const list = root.querySelector('.log-lines');
    const input = root.querySelector('#command');
    const hint = root.querySelector('.log-hint');

    const atBottom = () => !list || list.scrollHeight - list.scrollTop - list.clientHeight < 24;
    const toBottom = () => { if (list) list.scrollTop = list.scrollHeight; };
    const panelEl = root.querySelector('.log-panel');
    const renderTabs = () => {
      if (tabsEl) tabsEl.innerHTML = buildLogTabs(view());
      panelEl?.setAttribute?.('aria-labelledby', `log-tab-${view().tab}`);
    };
    const renderLines = () => {
      if (!list) return;
      // A whole new list isn't news: the live region stays quiet while it's swapped.
      list.setAttribute('aria-live', 'off');
      list.innerHTML = buildLogLines(view());
      toBottom();
      setTimeout(() => list.setAttribute('aria-live', 'polite'), 0);
    };
    const insights = () => {
      if (typeof shell.insets !== 'function' || typeof root.getBoundingClientRect !== 'function') return;
      const r = root.getBoundingClientRect();
      shell.insets('log', root.hidden || !r.width ? null : { x: r.left, y: r.top, width: r.width, height: r.height });
    };

    function add(entry) {
      const clean = cleanEntry(entry, shell.now());
      if (!clean) return null;
      seq += 1;
      const line = { ...clean, seq };
      const dropped = lines.length >= LOG_MAX ? lines[0] : null;
      lines = pushLine(lines, clean, seq);
      if (dropped) open.delete(dropped.seq);
      if (dropped) list?.querySelector(`[data-line="${dropped.seq}"]`)?.remove();
      if (list && (tab === 'all' || tab === line.tab)) {
        const follow = atBottom();
        list.querySelector('.log-empty')?.remove();
        list.insertAdjacentHTML('beforeend', buildLogLine(line, { open: [...open] }));
        if (follow) toBottom();
      }
      return line;
    }

    function showTabHere(next) {
      if (!tabsShown(combat).includes(next)) return false;
      tab = next;
      renderTabs();
      renderLines();
      return true;
    }

    const lineBySeq = (n) => lines.find((line) => line.seq === n) || null;
    function toggle(n, { focus = true } = {}) {
      const line = lineBySeq(n);
      if (!line || !line.detail) return false;
      if (open.has(n)) open.delete(n);
      else open.add(n);
      const el = list?.querySelector(`[data-line="${n}"]`);
      if (el) el.outerHTML = buildLogLine(line, { open: [...open] });
      if (focus) list?.querySelector(`[data-line="${n}"] .log-toggle`)?.focus();
      return true;
    }
    function act(n) {
      const line = lineBySeq(n);
      if (!line?.action) return false;
      try {
        if (typeof opts.act === 'function' && opts.act(line.action, line) === true) return true;
      } catch (err) { console.error('[MILO] log action', err); }
      const [kind, ...rest] = line.action.id.split(':');
      const target = rest.join(':');
      if (kind === 'panel' && target) shell.openPanel(target);
      else if (kind === 'tab' && target) showTabHere(target);
      return true;
    }

    function runInput() {
      const text = input?.value ?? '';
      if (!text.trim()) return;
      history.push(text);
      if (history.length > 30) history.shift();
      back = -1;
      input.value = '';
      if (hint) hint.innerHTML = '';
      // Once the Log has heard a 'combat' message, its `live` says whether a fight is on (so
      // `{ live: false }` ends it, whatever the stage still says); until then, the stage's mode.
      const { reply } = runCommand(shell, text, { combat: heard ? combat : null });
      if (reply) add({ ...reply, at: shell.now() });
    }

    const onClick = (event) => {
      const button = event.target?.closest?.('[data-action]');
      if (!button || !root.contains(button)) return;
      const action = button.getAttribute('data-action');
      if (action === 'log-tab') showTabHere(button.getAttribute('data-tab')) && root.querySelector(`#log-tab-${tab}`)?.focus();
      else if (action === 'log-expand') toggle(Number(button.getAttribute('data-line')));
      else if (action === 'log-act') act(Number(button.getAttribute('data-line')));
    };
    const onKeyDown = (event) => {
      const target = event.target;
      if (target === input) {
        const action = keyAction(COMMAND_KEYS, event);
        if (action === 'run') { event.preventDefault(); runInput(); }
        else if (action === 'older' || action === 'newer') {
          if (!history.length) return;
          event.preventDefault();
          back = action === 'older' ? Math.min(history.length - 1, back + 1) : Math.max(-1, back - 1);
          input.value = back < 0 ? '' : history[history.length - 1 - back];
        }
        return;
      }
      if (target?.getAttribute?.('role') === 'tab') {
        const action = keyAction(TAB_KEYS, event);
        if (!action) return;
        event.preventDefault();
        const tabs = tabsShown(combat);
        const next = tabs[moveIndex(action, tabs.indexOf(tab), tabs.length)];
        if (next && showTabHere(next)) root.querySelector(`#log-tab-${next}`)?.focus();
        return;
      }
      if (list && list.contains(target)) {
        const action = keyAction(LINE_KEYS, event);
        if (!action) return;
        const buttons = [...list.querySelectorAll('button')];
        if (target === list) {
          if (action === 'toggle' && buttons.length) { event.preventDefault(); buttons[buttons.length - 1].focus(); }
          return;
        }
        event.preventDefault();
        if (action === 'out') list.focus();
        else if (action === 'toggle') target.click();
        else buttons[moveIndex(action, buttons.indexOf(target), buttons.length)]?.focus();
      }
    };
    const onInput = () => {
      if (!hint || !input) return;
      const text = input.value;
      const content = shell.content?.();
      hint.innerHTML = text.trim() ? buildHint(completions(text, { grimoire: content?.spells ?? null, places: commandPlaces() })) : '';
    };
    // While the command bar has focus, Escape is its own: it clears the words, then leaves.
    const escape = (event) => {
      if (event.key !== 'Escape' || doc.activeElement !== input) return false;
      event.preventDefault?.();
      if (input.value) { input.value = ''; onInput(); }
      else doc.getElementById('world')?.focus?.({ preventScroll: true });
      return true;
    };
    const onFocusIn = (event) => {
      if (event.target === input && !popKeys && shell.keys && typeof shell.keys.push === 'function') popKeys = shell.keys.push(escape);
    };
    const onFocusOut = (event) => {
      if (event.target === input && popKeys) { popKeys(); popKeys = null; }
    };

    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    input?.addEventListener('input', onInput);
    globalThis.addEventListener?.('resize', insights);
    if (typeof shell.on === 'function') {
      offs.push(shell.on('combat', (message) => {
        const live = combatLive(message);
        heard = true;
        if (live === combat) return;
        combat = live;
        if (!combat && tab === 'combat') tab = 'all';
        renderTabs();
        renderLines();
      }));
    }
    insights();

    const handle = {
      dispose() {
        for (const off of offs) if (typeof off === 'function') off();
        if (popKeys) { popKeys(); popKeys = null; }
        root.removeEventListener('click', onClick);
        root.removeEventListener('keydown', onKeyDown);
        root.removeEventListener('focusin', onFocusIn);
        root.removeEventListener('focusout', onFocusOut);
        input?.removeEventListener('input', onInput);
        globalThis.removeEventListener?.('resize', insights);
        if (mounted === handle) mounted = null;
      },
      refresh() { insights(); },
      add,
      showTab(next) {
        const shown = showTabHere(next);
        if (shown) root.querySelector(`#log-tab-${next}`)?.focus();
        return shown;
      },
      line: (n) => {
        const line = lineBySeq(n);
        return line ? { ...line, open: open.has(n) } : null;
      },
      toggle: (n) => toggle(n),
      act: (n) => act(n),
      focusCommand() { input?.focus(); },
    };
    mounted = handle;
    return handle;
  } catch (err) {
    console.error('[MILO] log mount', err);
    return NOOP;
  }
}
