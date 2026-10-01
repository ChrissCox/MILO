// The Log's command bar: plain words or `::` spells, read into one Intent the shell dispatches to
// the same function a button would call (CONTRACT-PHASE4.md §7.6; PLAN.md §7, §10; LORE.md §11).
// Pure and deterministic. Phase 4 understands ::kindle, ::banked-coals (and "rest"), ::stop,
// ::muster, ::chronicle (Recall the Road), ::wayfinding <place>, ::map, ::skills, ::home, ::quiet,
// ::adventure and ::help, and the plain words for each. Every other Grimoire spell answers
// { kind: 'not-yet', spell, from }.
//
// Intent = { kind: 'spell', spell, arg } | { kind: 'open', panel } | { kind: 'go', place }
//        | { kind: 'hud', mode } | { kind: 'help' } | { kind: 'not-yet', spell, from }
//        | { kind: 'unknown', text, suggest: string | null }

const COMMANDS = Object.freeze([
  { id: 'kindle', intent: 'kindle', does: { kind: 'spell', spell: 'kindle' },
    words: ['kindle', 'kindle the lantern', 'light the lantern', 'focus', 'start focus', 'start focusing', 'start a focus session'] },
  { id: 'banked-coals', intent: 'banked-coals', aliases: ['rest'], does: { kind: 'spell', spell: 'banked-coals' },
    words: ['banked coals', 'bank the coals', 'rest', 'take a rest', 'start a rest', 'have a rest'] },
  { id: 'stop', does: { kind: 'spell', spell: 'stop' },
    words: ['stop', 'stop focusing', 'stop resting', 'stop the timer', 'put the lantern out'] },
  { id: 'muster', does: { kind: 'open', panel: 'muster' },
    words: ['muster', 'set out', 'setting out', 'open the muster', 'gather the company'] },
  { id: 'chronicle', intent: 'chronicle', aliases: ['recall-the-road'], does: { kind: 'open', panel: 'chronicle' },
    words: ['chronicle', 'the chronicle', 'open the chronicle', 'show the chronicle', 'recall the road', 'what did i do', 'what did i do last week'] },
  { id: 'wayfinding', intent: 'wayfinding', does: { kind: 'go' }, words: ['wayfinding', 'where can i go'] },
  { id: 'map', does: { kind: 'open', panel: 'map' }, words: ['map', 'the map', 'open the map', 'show the map', 'show me the map'] },
  { id: 'skills', does: { kind: 'open', panel: 'skills' }, words: ['skills', 'my skills', 'open skills', 'open the skills', 'show my skills'] },
  { id: 'home', does: { kind: 'go', place: 'home' }, words: ['home', 'go home', 'take me home', 'back home', 'head home'] },
  { id: 'quiet', does: { kind: 'hud', mode: 'quiet' }, words: ['quiet', 'quiet mode', 'go quiet', 'quiet hud'] },
  { id: 'adventure', does: { kind: 'hud', mode: 'adventure' }, words: ['adventure', 'adventure mode', 'adventure hud'] },
  { id: 'help', does: { kind: 'help' }, words: ['help', '?', 'what can i say', 'what can i do', 'commands'] },
]);
const BY_NAME = new Map(COMMANDS.flatMap((cmd) => [cmd.id, ...(cmd.aliases || [])].map((name) => [name, cmd])));
const BY_INTENT = new Map(COMMANDS.filter((cmd) => cmd.intent).map((cmd) => [cmd.intent, cmd]));
// "go to the Watchtower", "take me to the pond": the place is what follows.
const GO_PHRASES = Object.freeze(['wayfinding', 'go to', 'take me to', 'walk to', 'travel to', 'head to', 'find the way to']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Lower case, curly apostrophes plain, punctuation gone (a lone '?' kept), single spaces, no "Milo," or "please". */
function words(text) {
  let out = String(text).toLowerCase().replace(/[’‘]/g, '\'').trim();
  if (out === '?') return out;
  out = out.replace(/[^a-z0-9' -]+/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim();
  out = out.replace(/^milo\s+/, '').replace(/^(?:please|can you|could you)\s+/, '').replace(/\s+please$/, '').trim();
  return out;
}
const slug = (text) => words(text).replace(/\s+/g, '-');
/** A place's name as it's matched: no leading "the", no apostrophes. */
const placeWords = (text) => words(text).replace(/^the\s+/, '');

/** The Grimoire's spells ({ id, name, words, intent, from }) from content/spells.json, the bundle or a list. */
function spellsOf(grimoire) {
  const file = isRecord(grimoire) && isRecord(grimoire.spells) ? grimoire.spells : grimoire;
  const list = Array.isArray(file) ? file : (isRecord(file) && Array.isArray(file.spells) ? file.spells : []);
  return list.filter((s) => isRecord(s) && typeof s.id === 'string' && s.id).map((s) => ({
    id: s.id,
    name: typeof s.name === 'string' ? s.name : s.id,
    words: Array.isArray(s.words) ? s.words.filter((w) => typeof w === 'string').map(words).filter(Boolean) : [],
    intent: typeof s.intent === 'string' ? s.intent : null,
    from: typeof s.from === 'string' ? s.from : 'Later',
  }));
}

/** Places as [{ id, names: string[] }] from ids, names or { id, name, words }. */
function placesOf(places) {
  const list = Array.isArray(places) ? places : [];
  return list.map((place) => {
    if (typeof place === 'string') return { id: place, names: [...new Set([placeWords(place), words(place)])] };
    if (!isRecord(place) || typeof place.id !== 'string') return null;
    const names = [place.id, place.name, ...(Array.isArray(place.words) ? place.words : [])]
      .filter((n) => typeof n === 'string').flatMap((n) => [placeWords(n), words(n)]).filter(Boolean);
    return { id: place.id, label: typeof place.name === 'string' ? place.name : place.id, names: [...new Set(names)] };
  }).filter(Boolean);
}

/** Edit distance, for "did you mean". */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}
function nearest(text, candidates) {
  let best = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const d = distance(text, candidate);
    if (d < bestScore) { best = candidate; bestScore = d; }
  }
  return best !== null && bestScore <= Math.max(1, Math.min(3, Math.floor(text.length / 3))) ? best : null;
}

function goTo(arg, places, text) {
  const wanted = placeWords(arg || '');
  if (!wanted) return { kind: 'open', panel: 'map' };
  if (['home', 'hearthvale', 'camp', 'the camp'].includes(wanted)) return { kind: 'go', place: 'home' };
  const list = placesOf(places);
  const found = list.find((p) => p.names.includes(wanted))
    || list.find((p) => p.names.some((n) => n.startsWith(wanted) || (wanted.length >= 4 && n.includes(wanted))));
  if (found) return { kind: 'go', place: found.id };
  const close = nearest(wanted, list.flatMap((p) => p.names));
  const place = close ? list.find((p) => p.names.includes(close)) : null;
  return { kind: 'unknown', text, suggest: place ? `::wayfinding ${place.label || place.id}` : null };
}

function run(cmd, arg, places, text) {
  if (cmd.id === 'wayfinding') return goTo(arg, places, text);
  if (cmd.does.kind === 'spell') return { kind: 'spell', spell: cmd.does.spell, arg: null };
  return { ...cmd.does };
}

function fromSpell(spell, arg, places, text) {
  const cmd = spell.intent ? BY_INTENT.get(spell.intent) : null;
  return cmd ? run(cmd, arg, places, text) : { kind: 'not-yet', spell: spell.id, from: spell.from };
}

/** What the command bar's text asks for. `grimoire` is content/spells.json; `places` names what Wayfinding can reach. */
export function parseCommand(text, { grimoire = null, places = [] } = {}) {
  const raw = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (!raw) return { kind: 'unknown', text: '', suggest: '::help' };
  const spells = spellsOf(grimoire);
  if (raw.startsWith('::')) {
    const body = raw.slice(2).trim();
    const [head = '', ...rest] = body.split(' ');
    const name = slug(head);
    const arg = rest.join(' ').trim() || null;
    const cmd = BY_NAME.get(name);
    if (cmd) return run(cmd, arg, places, raw);
    const spell = spells.find((s) => s.id === name || slug(s.name) === name)
      || spells.find((s) => s.id === slug(body) || slug(s.name) === slug(body));
    if (spell) return fromSpell(spell, spell.id === name || slug(spell.name) === name ? arg : null, places, raw);
    const suggest = nearest(`::${name}`, [...COMMANDS.map((c) => `::${c.id}`), ...spells.map((s) => `::${s.id}`)]);
    return { kind: 'unknown', text: raw, suggest };
  }
  const said = words(raw);
  for (const cmd of COMMANDS) if (cmd.words.includes(said)) return run(cmd, null, places, raw);
  for (const phrase of GO_PHRASES) {
    if (said.startsWith(`${phrase} `)) return goTo(said.slice(phrase.length + 1), places, raw);
  }
  const cast = said.replace(/^cast\s+/, '');
  const spell = spells.find((s) => s.words.includes(said) || s.words.includes(cast) || words(s.name) === cast);
  if (spell) return fromSpell(spell, null, places, raw);
  const phrases = [...COMMANDS.flatMap((c) => c.words.map((w) => [w, c.id])), ...spells.flatMap((s) => [words(s.name), ...s.words].map((w) => [w, s.id]))];
  const close = nearest(said, phrases.map(([w]) => w));
  const id = close ? phrases.find(([w]) => w === close)[1] : null;
  return { kind: 'unknown', text: raw, suggest: id ? `::${id}` : null };
}

/** What the command bar can complete `prefix` to (at most 8): '::k' → ['::kindle'], '::wayfinding wa' → places. */
export function completions(prefix, { grimoire = null, places = [] } = {}) {
  const text = typeof prefix === 'string' ? prefix.replace(/\s+/g, ' ').replace(/^\s+/, '') : '';
  if (!text) return [];
  const spells = spellsOf(grimoire);
  if (text.startsWith('::')) {
    const body = text.slice(2);
    const space = body.indexOf(' ');
    if (space >= 0) {
      if (slug(body.slice(0, space)) !== 'wayfinding') return [];
      const wanted = placeWords(body.slice(space + 1));
      return placesOf(places).filter((p) => p.names.some((n) => n.startsWith(wanted)))
        .map((p) => `::wayfinding ${p.label || p.id}`).slice(0, 8);
    }
    const head = body.toLowerCase();
    const names = [...COMMANDS.map((c) => c.id), ...spells.map((s) => s.id)];
    return [...new Set(names.filter((n) => n.startsWith(head)))].map((n) => `::${n}`).slice(0, 8);
  }
  const said = words(text);
  if (!said) return [];
  const phrases = [...COMMANDS.flatMap((c) => c.words), ...spells.flatMap((s) => s.words)].filter((w) => w !== '?');
  return [...new Set(phrases.filter((w) => w.startsWith(said) && w !== said))].slice(0, 8);
}
