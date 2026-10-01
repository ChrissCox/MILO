// Shared copy checks for Phase 4's tests (CONTRACT-PHASE4.md §2 "Calm copy", §13 wave 0, §16.3).
// Not a test file: it has no test() calls. New suites import it instead of copying assertCalm.
//
//   import { assertCalm, lines, strings, DENYLIST, COSY, loreIndex } from './calm.js';
//
// assertCalm is tests/content.test.js's strict version: sentence case (a capital only at a
// sentence's start or on a known name), no exclamation marks, no "please" or "successfully", no
// emoji, curly quotes and apostrophes only, no doubled spaces or stray spaces at the ends. Known
// names are PROPER: every capitalised word in LORE.md §21's name index (but for the little words a
// title starts with: The, It, What…), plus Chris, Milo, MILO, Claude, Codex, the days and months,
// "I" and its contractions, and Phase 4's UI words. A test
// that meets a name LORE §21 doesn't have yet passes it in { proper } (keep it in the file's
// PENDING_NAMES list), rather than editing this file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------- names ----------

/** The paths named for what they echo (COMBAT.md §16.4): a combat name may share one of these. */
export const ECHOES = Object.freeze(['Hearth', 'Stonewright', 'High Noon', 'Case File', 'Afterhours', 'Quiet Order']);

/** Other games' names and terms (COMBAT.md §16.4), never in a content string. */
export const DENYLIST = Object.freeze([
  'Baldur', 'Faerûn', 'Faerun', 'illithid', 'beholder', 'owlbear', 'githyanki', 'tiefling', 'Hollow Knight',
  'Eldritch Blast', 'Sneak Attack', 'Bardic Inspiration', 'Karmic Dice', 'Tactician', 'Honour Mode', 'Honor Mode',
  'fifth edition', 'Pathfinder', 'Golarion', 'Hero Point', 'Raise a Shield', 'Recall Knowledge', 'Reactive Strike',
  'Treat Wounds', 'Battle Medicine',
  // and similar
  'Dungeons & Dragons', 'D&D', 'Forgotten Realms', 'mind flayer', 'Larian', 'Paizo', 'Wizards of the Coast',
]);

/** Words a fight never uses (COMBAT.md §16.4): strays settle and are sorted, heroes go offline and doze. */
export const COSY = Object.freeze(['die', 'dies', 'died', 'dead', 'death', 'kill', 'killed', 'slain', 'slay', 'wiped', 'blood', 'murder']);

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Phase 4's UI words, and the MILO names Phase 3 already shows that LORE §21 doesn't list
// (the Prologue, the War Table, the Adventurer’s Kit, the Notice Board).
const UI_WORDS = ['Embers', 'Kindle', 'Chronicle', 'Road', 'Log', 'Adventure', 'Quiet', 'Command', 'Guided', 'Storybook',
  'Prologue', 'War', 'Table', 'Adventurer', 'Kit', 'Notice', 'Board'];
// The crew as Chris names them ("Claude Code", "the PC"), "I", and what an `about` string cites.
const ALWAYS = ['Chris', 'Milo', 'MILO', 'Claude', 'Codex', 'Code', 'PC', 'I', 'I’m', 'I’ve', 'I’ll', 'I’d', 'Phase',
  'README.md', 'PLAN.md', 'COMBAT.md', 'LORE.md', 'RIFTS.md', 'WORLD.md'];

const LORE_FILE = new URL('../LORE.md', import.meta.url);

/**
 * A name as the index compares it: no `*`, no trailing parenthetical, no leading "the", "a" or
 * "an", no apostrophes (curly or straight), lower case, single spaces.
 * "The Scribe in Clay (Claude)" → "scribe in clay"; "Brannoch’s tea stall" → "brannochs tea stall".
 */
export function normaliseName(name) {
  return String(name)
    .replace(/\*/g, '')
    .replace(/\s*\([^()]*\)\s*$/, '')
    .replace(/['’‘]/g, '')
    .trim()
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

let parsed = null;

/** LORE.md §21 as { [group]: raw name[] }, in the file's order. */
function parseIndex() {
  if (parsed) return parsed;
  const text = readFileSync(LORE_FILE, 'utf8').replace(/\r\n/g, '\n');
  const start = text.indexOf('\n## 21. Name index');
  assert.ok(start >= 0, 'LORE.md has §21, the name index');
  const rest = text.slice(start + 1);
  const next = rest.indexOf('\n## ', 3);
  const section = next < 0 ? rest : rest.slice(0, next);
  const groups = {};
  for (const line of section.split('\n')) {
    const m = line.match(/^- \*\*(.+?)\*\*[^:]*:\s*(.+)$/);
    if (!m) continue;
    const names = m[2].split(' · ').map((n) => n.trim()).filter(Boolean);
    groups[m[1]] = [...(groups[m[1]] || []), ...names];
  }
  parsed = groups;
  return parsed;
}

/**
 * LORE.md §21 parsed into normalised names by group: { People: ['adelind rue', …], Callings: […], … }
 * (the group is the bold label of its line). With { raw: true } the names are as written.
 */
export function loreIndex({ raw = false } = {}) {
  const groups = parseIndex();
  return Object.fromEntries(Object.entries(groups).map(([group, names]) => [group, raw ? [...names] : names.map(normaliseName)]));
}

// Words the index capitalises only because a title or a move's name starts with them ("The Far
// Shore", "It just had feelings", "What Oriel Forgot"). They never count as names, or a stray
// capital "The" or "It" mid-sentence would pass; a line that really needs one passes { proper }.
const FUNCTION_WORDS = new Set(['The', 'A', 'An', 'And', 'Or', 'But', 'Nor', 'Of', 'To', 'In', 'On', 'At', 'For', 'By', 'With',
  'From', 'Into', 'Through', 'Up', 'Out', 'Over', 'Off', 'As', 'If', 'So', 'Then', 'Than', 'Yet', 'What', 'Why', 'How', 'Who',
  'When', 'Where', 'Which', 'It', 'Its', 'That', 'This', 'These', 'Those', 'Them', 'They', 'We', 'You', 'Your', 'Our', 'Their',
  'His', 'Her', 'He', 'She', 'Is', 'Are', 'Was', 'Were', 'Be', 'Been', 'Every', 'Each', 'Some', 'Any', 'All', 'No', 'Not',
  'Here', 'There', 'Just', 'One', 'More', 'Most', 'Many', 'Few', 'Other', 'Another']);

/** Every capitalised word in a list of names, whole and split at hyphens, with both apostrophes. */
function capitalised(names) {
  const out = new Set();
  for (const name of names) {
    for (const token of name.replace(/\*/g, '').split(/[\s/]+/)) {
      const word = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}’']+$/gu, '').replace(/['’]s$/, '');
      if (!word || !/^\p{Lu}/u.test(word) || FUNCTION_WORDS.has(word.replace(/['’].*$/, ''))) continue;
      for (const w of [word, ...word.split('-').filter((p) => /^\p{Lu}/u.test(p))]) {
        out.add(w.replace(/'/g, '’'));
        out.add(w.replace(/’/g, '\''));
      }
    }
  }
  return out;
}

/** Words allowed a capital mid-sentence. */
export const PROPER = Object.freeze(new Set([
  ...capitalised(Object.values(parseIndex()).flat()),
  ...ALWAYS, ...DAYS, ...MONTHS, ...UI_WORDS,
]));

// ---------- copy ----------

const SENTENCE_END = /[.?…]$/;
const properOf = (proper) => (proper ? new Set(proper) : null);
const isProper = (word, extra) => PROPER.has(word) || Boolean(extra && extra.has(word));

function sentenceCase(text, where, extra) {
  // Quoted speech keeps its own casing; a quote that ends a sentence ends the sentence around it too.
  const quoted = (m) => (/[.?…][”’]$/.test(m) ? 'x.' : 'x');
  const unquoted = text
    .replace(/“[^”]*”/g, quoted)
    .replace(/‘[^‘]*?’(?!\p{L})/gu, quoted);
  const tokens = unquoted.split(/\s+/);
  for (let i = 1; i < tokens.length; i += 1) {
    const before = tokens[i - 1].replace(/[)”’]+$/, '');
    if (SENTENCE_END.test(before) || /^[—–]$/.test(before)) continue;
    const word = tokens[i].replace(/^[^\p{L}]+|[^\p{L}’]+$/gu, '');
    if (!word) continue;
    const base = word.replace(/’s$/, '').replace(/s’$/, 's');
    // A plural of a name ("Glimmers", "Mimics") is a name too.
    const single = base.length > 3 && base.endsWith('s') ? base.slice(0, -1) : null;
    if (isProper(word, extra) || isProper(base, extra) || (single && isProper(single, extra))) continue;
    assert.ok(word[0] === word[0].toLowerCase(), `${where} is sentence case, “${word}” in: ${text}`);
  }
}

function basics(text, where) {
  assert.equal(typeof text, 'string', `${where} is a string`);
  assert.ok(text.trim().length > 0, `${where} is not empty`);
  assert.equal(text, text.trim(), `${where} has no stray spaces at the ends`);
  assert.ok(!/ {2}/.test(text), `${where} has no doubled spaces: ${text}`);
  assert.ok(!text.includes('!'), `${where} has no exclamation mark: ${text}`);
  assert.ok(!/\bplease\b|successfully/i.test(text), `${where} avoids please/successfully: ${text}`);
  assert.ok(!/\p{Extended_Pictographic}/u.test(text), `${where} has no emoji: ${text}`);
  assert.ok(!text.includes('"'), `${where} uses curly quotes only: ${text}`);
  assert.ok(!text.includes('\''), `${where} uses curly apostrophes only: ${text}`);
}

/**
 * Calm copy (tests/content.test.js's strict rules). { proper }: extra names allowed a capital
 * (an array or Set), for names LORE §21 doesn't have yet.
 */
export function assertCalm(text, where = '', { proper } = {}) {
  basics(text, where);
  const firstLetter = text.match(/\p{L}/u);
  if (firstLetter) assert.equal(firstLetter[0], firstLetter[0].toUpperCase(), `${where} starts with a capital: ${text}`);
  sentenceCase(text, where, properOf(proper));
}

/** A proper name or a chapter title ("The Stockade", "A Light on the Hook"): title case allowed, still calm. */
export function assertTitle(text, where = '') {
  assert.equal(typeof text, 'string', `${where} is a string`);
  assert.match(text, /^\p{Lu}/u, `${where} starts with a capital`);
  assert.ok(text.length <= 40, `${where} is short: ${text}`);
  assert.ok(!/[!"'.]/.test(text), `${where} is calm, curly and has no full stop: ${text}`);
  assert.ok(!/\p{Extended_Pictographic}/u.test(text), `${where} has no emoji`);
}

/**
 * A name for a move, feature or spell ("Parting swipe", "Built. Tests pass.", "None shall pass
 * (politely)"): like a title, but full stops inside it are allowed.
 */
export function assertName(text, where = '') {
  basics(text, where);
  assert.match(text, /^\p{Lu}/u, `${where} starts with a capital: ${text}`);
  assert.ok(text.length <= 40, `${where} is short: ${text}`);
}

/** A fragment that finishes someone else's sentence ("It’s missing …"): calm, lowercase, no full stop. */
export function assertFragment(text, where = '', { proper } = {}) {
  assertCalm(`It’s missing ${text}.`, where, { proper });
  assert.equal(text[0], text[0].toLowerCase(), `${where} starts lowercase: ${text}`);
  assert.ok(!/[.?…]$/.test(text), `${where} has no full stop: ${text}`);
}

/**
 * A stage direction in brackets ("(tilts its head)", "(Jev fluffs up)"): calm inside, starting
 * lowercase or with a known name, no full stop at the end and no brackets inside.
 */
export function assertGesture(text, where = '', { proper } = {}) {
  basics(text, where);
  const m = text.match(/^\(([^()]+)\)$/);
  assert.ok(m, `${where} is one bracketed stage direction: ${text}`);
  const inner = m[1];
  assert.equal(inner, inner.trim(), `${where} has no spaces inside its brackets: ${text}`);
  assert.ok(!/[.?…]$/.test(inner), `${where} has no full stop: ${text}`);
  const extra = properOf(proper);
  const first = inner.split(/\s+/)[0].replace(/^[^\p{L}]+|[^\p{L}’]+$/gu, '').replace(/’s$/, '');
  assert.ok(first[0] === first[0]?.toLowerCase() || isProper(first, extra), `${where} starts lowercase or with a name: ${text}`);
  sentenceCase(inner, where, extra);
}

/** Every string inside a value, as [path, text], with a path for messages. */
export function* strings(value, path = '') {
  if (typeof value === 'string') yield [path, value];
  else if (Array.isArray(value)) for (const [i, v] of value.entries()) yield* strings(v, `${path}[${i}]`);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) yield* strings(v, path ? `${path}.${k}` : k);
}

/** A list of at least `min` calm lines, each at most `max` characters. */
export function lines(list, where, { min = 3, max = 140, proper } = {}) {
  assert.ok(Array.isArray(list), `${where} is a list`);
  assert.ok(list.length >= min, `${where} has at least ${min} lines (${list.length})`);
  list.forEach((line, i) => {
    assertCalm(line, `${where}[${i}]`, { proper });
    assert.ok(line.length <= max, `${where}[${i}] is at most ${max} chars (${line.length}): ${line}`);
  });
}

// ---------- other games' words and the cosy words ----------

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (term, plural) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(term).replace(/\s+/g, '\\s+')}${plural ? '(?:e?s)?' : ''}(?![\\p{L}\\p{N}])`, 'iu');
const DENIED = DENYLIST.map((term) => [term, wordRe(term, true)]);
const UNCOSY = COSY.map((word) => [word, wordRe(word, false)]);

/** The DENYLIST terms in a text (any case, plurals too). */
export function deniedIn(text) {
  return DENIED.filter(([, re]) => re.test(String(text))).map(([term]) => term);
}

/** The COSY words in a text, as whole words in any case ("dice" and "deadline" are fine). */
export function uncosyIn(text) {
  return UNCOSY.filter(([, re]) => re.test(String(text))).map(([word]) => word);
}

/** No other game's names or terms. */
export function assertOwnWords(text, where = '') {
  const found = deniedIn(text);
  assert.equal(found.length, 0, `${where} uses another game’s words (${found.join(', ')}): ${text}`);
}

/** No word a fight never uses. */
export function assertCosy(text, where = '') {
  const found = uncosyIn(text);
  assert.equal(found.length, 0, `${where} uses words fights never use (${found.join(', ')}): ${text}`);
}
