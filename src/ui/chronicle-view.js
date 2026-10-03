// The Chronicle (CONTRACT-PHASE4.md §7.6, §8.3, §12.4 K1; COMBAT.md §12, §13; PLAN.md §3): the
// `chronicle` panel, with a day (today, or one picked from the week), this week in Starfall's
// shape (seven days side by side, then the week's totals), the ledger with every Ember's source,
// the fights' summaries, the day's XP lines ("Focus 1,000: focus session 09:10–10:00"), and "Show
// more". It reads chronicle.dayView and weekView and embers.walletView, and writes nothing.
import { dayView, weekView } from '../chronicle.js';
import { walletView } from '../embers.js';
import { skillName, commas } from '../lifeskills.js';
import { dayKey, dayKeyStart, cleanDayKey } from '../clean.js';
import { esc } from './panels.js';

export const id = 'chronicle';
export const PANEL = 'chronicle';
/** How many of each list show before "Show more", and how many more each press adds. */
export const LIMITS = Object.freeze({ ledger: 20, fights: 5, xp: 12 });
const LISTS = Object.freeze(['ledger', 'fights', 'xp']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const whole = (value) => (finite(value) ? Math.max(0, Math.floor(value)) : 0);
const plural = (n, one, many) => `${commas(n)} ${n === 1 ? one : many}`;
const pad = (n) => String(n).padStart(2, '0');

const WEEKDAYS = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
const SHORT = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
const MONTHS = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);

/** 'Today', 'Yesterday', or 'Monday 29 September', for a 'YYYY-MM-DD' key. */
export function dayLabel(key, todayKey) {
  const start = dayKeyStart(key);
  if (!finite(start)) return '';
  if (key === todayKey) return 'Today';
  const today = dayKeyStart(todayKey);
  if (finite(today) && dayKey(today - 12 * 3600 * 1000) === key) return 'Yesterday';
  const date = new Date(start);
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}
const shortDay = (key) => {
  const start = dayKeyStart(key);
  return finite(start) ? SHORT[new Date(start).getDay()] : '';
};
/** '09:10', or 'Mon 09:10' when it isn't today. */
export function whenText(at, todayKey) {
  if (!finite(at)) return '';
  const date = new Date(at);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return dayKey(at) === todayKey ? time : `${SHORT[date.getDay()]} ${time}`;
}

/** What each ledger source is, when an entry carries no words of its own. */
export const SOURCE_WORDS = Object.freeze({
  focus: 'A focus session', rest: 'An honoured rest', crew: 'Crew sessions watched to the end', answered: 'Needs-you answered',
  stitch: 'Real rifts stitched', design: 'First designs', backlog: 'From before the Kit', wild: 'Stepped into a wild rift',
  rung: 'Went a rung deeper', real: 'Stepped into a real rift', story: 'Stepped into the crack', field: 'Challenged a field boss',
  cave: 'Went into a cave', chunk: 'Charted new chunks', quest: 'Quests finished', commission: 'Commissions read',
});

/** What a fight came to. */
export const OUTCOME_WORDS = Object.freeze({
  won: 'Settled', talked: 'Talked down', bowed: 'Bowed out', yielded: 'Yielded', 'last-page': 'The last page', offline: 'Everyone went offline', home: 'Headed home',
});

/** A day's totals in words, the ones that aren't nothing: ['2 focus sessions', '15 Embers in', …]. */
export function totalsWords(totals) {
  const t = isRecord(totals) ? totals : {};
  const out = [];
  if (whole(t.focus)) out.push(plural(whole(t.focus), 'focus session', 'focus sessions'));
  if (whole(t.rests)) out.push(`${plural(whole(t.rests), 'rest', 'rests')} honoured`);
  if (whole(t.embersIn)) out.push(`${plural(whole(t.embersIn), 'Ember', 'Embers')} in`);
  if (whole(t.embersOut)) out.push(`${plural(whole(t.embersOut), 'Ember', 'Embers')} spent`);
  if (whole(t.crew)) out.push(`${plural(whole(t.crew), 'crew session', 'crew sessions')} watched to the end`);
  if (whole(t.answered)) out.push(`${plural(whole(t.answered), 'needs-you', 'needs-you')} answered`);
  if (whole(t.stitched)) out.push(`${plural(whole(t.stitched), 'real rift', 'real rifts')} stitched`);
  if (whole(t.fights)) out.push(plural(whole(t.fights), 'fight', 'fights'));
  return out;
}

const newestFirst = (list) => (Array.isArray(list) ? list.filter((x) => isRecord(x) && finite(x.at)).slice().sort((a, b) => b.at - a.at) : []);
const page = (list, limit) => ({ entries: list.slice(0, limit), total: list.length, more: list.length > limit });

/**
 * The panel's view. `day` is the day picked ('YYYY-MM-DD'; today when missing or not a day);
 * `limits` how many of each list show. → { today, day, isToday, label, totals, xp, xpLines, week,
 * wallet, ledger, fights } where each list is { entries, total, more }.
 */
export function chronicleView(state, now, { day = null, limits = {}, economy = null } = {}) {
  const todayKey = finite(now) ? dayKey(now) : '';
  const picked = typeof day === 'string' && cleanDayKey(day) ? cleanDayKey(day) : todayKey;
  const lim = { ...LIMITS, ...(isRecord(limits) ? limits : {}) };
  const seen = dayView(state, picked, { now });
  const week = weekView(state, picked, { now });
  const embers = isRecord(state) && isRecord(state.embers) ? state.embers : {};
  const chronicle = isRecord(state) && isRecord(state.chronicle) ? state.chronicle : {};
  return {
    today: todayKey,
    day: picked,
    isToday: picked === todayKey,
    label: dayLabel(picked, todayKey),
    totals: seen.totals,
    xp: seen.xp.map((row) => ({ skill: row.skill, name: skillName(row.skill), n: row.n })),
    xpLines: page(seen.xpLines, whole(lim.xp) || LIMITS.xp),
    fightsToday: seen.fights.length,
    week: {
      start: week.start,
      days: week.days.map((d) => ({ ...d, label: shortDay(d.day), name: dayLabel(d.day, todayKey), today: d.day === todayKey, selected: d.day === picked })),
      totals: week.totals,
      xp: week.xp.slice(0, 4).map((row) => ({ skill: row.skill, name: skillName(row.skill), n: row.n })),
    },
    wallet: walletView(state, now, { economy }),
    ledger: page(newestFirst(embers.ledger), whole(lim.ledger) || LIMITS.ledger),
    fights: page(newestFirst(chronicle.fights), whole(lim.fights) || LIMITS.fights),
  };
}

const more = (list, key) => (list?.more
  ? `<div class="ask-actions chronicle-more"><button type="button" class="link-btn" data-action="chronicle-more" data-list="${key}" data-focus-key="chronicle-more-${key}">Show more</button></div>` : '');

/** One ledger entry: when, what, how many (+10 or −5), and what the cap kept back. */
export function ledgerRow(entry, todayKey) {
  const n = finite(entry?.n) ? Math.round(entry.n) : 0;
  const banked = whole(entry?.banked);
  const source = typeof entry?.source === 'string' ? entry.source : '';
  const text = (typeof entry?.text === 'string' && entry.text.trim()) || SOURCE_WORDS[source] || 'Embers';
  const sign = n >= 0 ? 'in' : 'out';
  const amount = n >= 0 ? `+${commas(n)}` : `−${commas(-n)}`;
  const note = n > 0 && banked < n ? `<span class="ledger-note">${esc(`${commas(banked)} banked, ${commas(n - banked)} past the cap`)}</span>` : '';
  return `<li class="ledger-row" data-source="${esc(source)}" data-sign="${sign}"><span class="ledger-when">${esc(whenText(entry?.at, todayKey))}</span>`
    + `<span class="ledger-text">${esc(text)}${note}</span><strong class="ledger-n">${esc(amount)}</strong></li>`;
}

/** One fight's summary (§8.3's FightSummary). */
export function fightRow(fight, todayKey) {
  const f = isRecord(fight) ? fight : {};
  const outcome = typeof f.outcome === 'string' ? f.outcome : '';
  const meta = [whenText(f.at, todayKey)];
  if (whole(f.rounds)) meta.push(plural(whole(f.rounds), 'round', 'rounds'));
  if (whole(f.xp)) meta.push(`${commas(whole(f.xp))} Road XP`);
  if (whole(f.marks)) meta.push(plural(whole(f.marks), 'Mark', 'Marks'));
  return `<li class="fight-row" data-outcome="${esc(outcome)}"><p class="fight-head"><strong>${esc(f.where || 'A fight')}</strong>`
    + ` <span class="stage-tag">${esc(OUTCOME_WORDS[outcome] || 'Done')}</span></p>`
    + `<p class="fight-meta">${esc(meta.filter(Boolean).join(' · '))}</p>`
    + (typeof f.summary === 'string' && f.summary.trim() ? `<p class="fight-summary">${esc(f.summary)}</p>` : '') + '</li>';
}

/** The week in Starfall's shape: seven days side by side, each one a button that shows that day. */
function weekSection(week) {
  const days = Array.isArray(week?.days) ? week.days : [];
  const peak = Math.max(1, ...days.map((d) => whole(d.focus)));
  let html = '<section class="group chronicle-week" data-group="week"><h3>This week</h3><ol class="week-days">';
  for (const d of days) {
    const focus = whole(d.focus);
    const label = `${d.name || d.label}: ${totalsWords({ focus, embersIn: d.embersIn, embersOut: d.embersOut, fights: d.fights }).join(', ') || 'nothing'}.`;
    html += `<li><button type="button" class="week-day" data-action="chronicle-day" data-day="${esc(d.day)}" data-focus-key="chronicle-day-${esc(d.day)}"`
      + ` aria-pressed="${d.selected ? 'true' : 'false'}"${d.today ? ' data-today="true"' : ''} aria-label="${esc(label)}">`
      + `<span class="week-bar" aria-hidden="true"><i style="height:${Math.round((focus / peak) * 100)}%"></i></span>`
      + `<span class="week-n" aria-hidden="true">${esc(focus)}</span><span class="week-label" aria-hidden="true">${esc(d.label)}</span></button></li>`;
  }
  html += '</ol>';
  const words = totalsWords(week?.totals);
  html += `<p class="chronicle-line">${words.length ? `${esc(words.join(', '))}.` : 'Nothing yet.'}</p>`;
  if (Array.isArray(week?.xp) && week.xp.length) {
    html += `<p class="chronicle-line">Most XP: ${esc(week.xp.map((row) => `${row.name} ${commas(row.n)}`).join(', '))}.</p>`;
  }
  return `${html}</section>`;
}

/** The `chronicle` panel. view: chronicleView's. */
export function buildChronicle(view) {
  const v = isRecord(view) ? view : {};
  const wallet = isRecord(v.wallet) ? v.wallet : {};
  let html = `<div class="chronicle-view" data-day="${esc(v.day || '')}">`;
  html += '<section class="group chronicle-wallet" data-group="wallet"><h3>Embers</h3>'
    + `<p class="chronicle-line"><strong class="wallet-big">${esc(whole(wallet.balance))}</strong> of ${esc(whole(wallet.cap) || 100)} · ${esc(commas(whole(wallet.lifetime)))} earned</p></section>`;

  html += `<section class="group chronicle-day" data-group="day"><h3>${esc(v.label || 'Today')}</h3>`;
  if (!v.isToday) html += '<div class="ask-actions"><button type="button" class="link-btn" data-action="chronicle-today" data-focus-key="chronicle-today">Back to today</button></div>';
  const words = totalsWords(v.totals);
  html += words.length ? `<p class="chronicle-line">${esc(words.join(', '))}.</p>` : `<p class="quiet-note">${v.isToday ? 'Nothing yet today.' : 'Nothing that day.'}</p>`;
  const xpLines = isRecord(v.xpLines) ? v.xpLines : { entries: [] };
  if (xpLines.entries?.length) {
    html += '<h4 class="hearth-h4">Skills</h4><ol class="xp-lines">'
      + xpLines.entries.map((line) => `<li data-skill-id="${esc(line.skill)}"><span class="ledger-when">${esc(whenText(line.at, v.today))}</span><span class="ledger-text">${esc(line.text)}</span></li>`).join('')
      + `</ol>${more(xpLines, 'xp')}`;
  }
  html += '</section>';

  html += weekSection(v.week);

  const ledger = isRecord(v.ledger) ? v.ledger : { entries: [], total: 0 };
  html += `<section class="group chronicle-ledger" data-group="ledger"><h3>Ledger <span class="count">${esc(whole(ledger.total))}</span></h3>`;
  html += ledger.entries?.length
    ? `<ol class="ledger">${ledger.entries.map((entry) => ledgerRow(entry, v.today)).join('')}</ol>${more(ledger, 'ledger')}`
    : '<p class="quiet-note">No Embers yet.</p>';
  html += '</section>';

  const fights = isRecord(v.fights) ? v.fights : { entries: [], total: 0 };
  html += `<section class="group chronicle-fights" data-group="fights"><h3>Fights <span class="count">${esc(whole(fights.total))}</span></h3>`;
  html += fights.entries?.length
    ? `<ol class="fight-list">${fights.entries.map((fight) => fightRow(fight, v.today)).join('')}</ol>${more(fights, 'fights')}`
    : '<p class="quiet-note">No fights yet.</p>';
  html += '</section>';
  return `${html}</div>`;
}

const NOOP = Object.freeze({ dispose() {}, refresh() {} });

/** Registers the `chronicle` panel (the wallet, the Embers orb, ::chronicle and its side tab open it). */
export function mount(shell) {
  try {
    if (!shell || typeof shell.registerPanel !== 'function') return NOOP;
    const offs = [];
    let day = null;
    let limits = { ...LIMITS };
    let wasOpen = false;
    const render = () => {
      if (!shell.state?.tally?.features?.chronicle) Promise.resolve().then(() => shell.feature?.('chronicle'));
      return buildChronicle(chronicleView(shell.state, shell.now(), { day, limits, economy: shell.content?.()?.economy ?? null }));
    };
    const action = (button) => {
      const act = button?.getAttribute?.('data-action') || '';
      if (act === 'chronicle-more') {
        const list = button.getAttribute('data-list');
        if (!LISTS.includes(list)) return false;
        limits = { ...limits, [list]: limits[list] + LIMITS[list] };
        shell.refreshPanel({ focus: `chronicle-more-${list}` });
        return true;
      }
      if (act === 'chronicle-day') {
        const picked = cleanDayKey(button.getAttribute('data-day'));
        if (!picked) return false;
        day = picked;
        limits = { ...limits, xp: LIMITS.xp };
        shell.refreshPanel({ focus: `chronicle-day-${picked}` });
        return true;
      }
      if (act === 'chronicle-today') {
        day = null;
        shell.refreshPanel({ focus: `chronicle-day-${dayKey(shell.now())}` });
        return true;
      }
      return false;
    };
    const off = shell.registerPanel(PANEL, { title: () => 'The Chronicle', render: () => render(), exists: () => true, action: (button) => action(button) });
    if (typeof off === 'function') offs.push(off);
    if (typeof shell.on === 'function') {
      offs.push(shell.on('state', () => {
        const open = shell.state?.panel === PANEL;
        if (open && !wasOpen) { day = null; limits = { ...LIMITS }; }
        wasOpen = open;
        if (open) shell.refreshPanel({ passive: true });
      }));
    }
    return {
      dispose() { for (const fn of offs) if (typeof fn === 'function') fn(); },
      refresh() { if (shell.state?.panel === PANEL) shell.refreshPanel({ passive: true }); },
    };
  } catch (err) {
    console.error('[MILO] chronicle mount', err);
    return NOOP;
  }
}
