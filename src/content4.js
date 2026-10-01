// Which of Phase 4's areas the content bundle can run (CONTRACT-PHASE4.md §9.1). Pure: it reads
// the bundle main serves (electron/content.cjs) and nothing else, and never touches Phase 3's
// contentProblem (src/ui/frontier.js), so a missing Phase 4 file never turns the wilds off.
//
// phase4Problem(bundle) → { groundwork, combat, party, world }: null for an area that can run, or
// a string naming its first missing or malformed file. The shell switches off only the broken area:
//   groundwork  Embers, Kindle, the Chronicle, skills
//   combat and party together: fights (Elsewheres stay Phase 3 walks)
//   world       the trail, caves, field bosses, examine.json
//
// A file is malformed when it isn't version 1 or lacks a top-level key its §9 section names (each
// key present and not null). `about` isn't required here: it's documentation, which each module's
// content test checks for calm copy, and a missing one breaks nothing. Deeper checks (tables cell
// for cell, ids that resolve) belong to the content tests. The words are for a `[MILO]` warning:
//   'content/combat/rules.json is missing' · 'content/skills.json isn’t version 1'
//   'content/sky.json has no “tints”' · 'content/party/companions/pip.json can’t be read'

/** Each flat or grouped file's top-level keys (§9.2–§9.12), by its path in content/. */
export const FILE_KEYS = Object.freeze({
  'skills.json': ['curve', 'families', 'skills'],
  'xp.json': ['sources'],
  'economy.json': ['cap', 'ledger', 'earn', 'spend'],
  'spells.json': ['spells'],
  'sky.json': ['sun', 'twilight', 'tints', 'seasons', 'weather', 'particles'],
  'combat/rules.json': [
    'bands', 'edge', 'heat', 'actions', 'lights', 'lines', 'integrity', 'strays', 'archetypes', 'lackey', 'elite', 'lead',
    'genres', 'hidden', 'temperaments', 'gentle', 'conditions', 'surfaces', 'surfaceGrowth', 'hazard', 'budgets', 'tiers',
    'deepRank', 'road', 'rewards', 'work', 'workPast12', 'adapt', 'modes', 'rests', 'cheers', 'warmth', 'warding', 'tuning',
    'sight', 'weapons', 'armour', 'cover', 'timing', 'odds',
  ],
  'combat/callings.json': ['charges', 'circles', 'callings', 'paths', 'abilities', 'weaponArts', 'boons', 'items', 'gifts'],
  'combat/spells.json': ['spells'],
  'combat/leads.json': ['mechanics', 'fallback', 'hooks'],
  'combat/foes.json': ['canon', 'creatures', 'caves', 'mimic', 'abilities', 'greatOnes'],
  'combat/anims.json': ['poses', 'flourishes', 'effects', 'spells', 'clipPoses'],
  'combat/tuning.json': ['integrityFactor', 'xInt'],
  'party/regulars.json': ['callingByArchetype', 'personalityByTemperament', 'ask', 'noRoom', 'signatures', 'tricks', 'abilityDefs', 'barks'],
  'party/teamups.json': [],
  'party/banter.json': [],
  'camp/scenes.json': ['scenes'],
  'examine.json': ['groups'],
  'trails.json': ['tiers', 'trails'],
});

/** The keys every companion file has, the ten data-only ones included (§9.6). */
export const COMPANION_KEYS = Object.freeze(['id', 'name', 'pronoun', 'calling', 'paths', 'joins', 'service', 'fieldSkill', 'damageKind', 'examine']);
/**
 * The fifteen companion files §9.6 says exist, in §5.1's order: Milo (his file is his UnitSpec's,
 * so a fight can't start without it), the four who join in Phase 4 (party.js's PHASE4_COMPANIONS),
 * then the data-only ten. The first one missing names the party area's problem.
 */
export const REQUIRED_COMPANIONS = Object.freeze([
  'milo', 'claude', 'codex', 'jev', 'tollkeeper',
  'rivet', 'pip', 'dusty', 'juno', 'mae', 'lumi', 'tova', 'nell', 'whisper', 'vesperine',
]);
/** The camp talks Phase 4 plays (§9.10). */
export const PHASE4_TALKS = Object.freeze(['first-night', 'tollkeeper-riddles']);

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

// The problem with one JSON file, or null. An `optional` file may be absent, but not malformed;
// an entry of a folder that's listed but null `can’t be read` rather than being missing.
function fileProblem(where, value, keys, { optional = false, listed = false } = {}) {
  if (value == null) return optional ? null : `content/${where} ${listed ? 'can’t be read' : 'is missing'}`;
  if (!isRecord(value)) return `content/${where} can’t be read`;
  if (value.version !== 1) return `content/${where} isn’t version 1`;
  const lacking = keys.find((key) => !owns(value, key) || value[key] == null);
  return lacking ? `content/${where} has no “${lacking}”` : null;
}

// The problem with a folder of files keyed by file name (companions/, talks/), or null: it must
// hold files, the ones Phase 4 needs among them, and every file in it must pass `check`.
function folderProblem(where, extension, folder, required, check) {
  if (!isRecord(folder) || !Object.keys(folder).length) return `content/${where}/ is missing`;
  const needed = required.find((name) => !owns(folder, name));
  if (needed) return `content/${where}/${needed}.${extension} is missing`;
  for (const name of Object.keys(folder)) {
    const problem = check(name, folder[name]);
    if (problem) return problem;
  }
  return null;
}

function companionProblem(name, value) {
  const where = `party/companions/${name}.json`;
  const problem = fileProblem(where, value, COMPANION_KEYS, { listed: true });
  if (problem) return problem;
  return value.id === name ? null : `content/${where} names another id`;
}

function talkProblem(name, value) {
  if (typeof value !== 'string') return `content/camp/talks/${name}.md can’t be read`;
  return value.trim() ? null : `content/camp/talks/${name}.md is empty`;
}

const grouped = (group, name) => (c) => fileProblem(`${group}/${name}.json`, c[group]?.[name], FILE_KEYS[`${group}/${name}.json`]);
const flat = (name) => (c) => fileProblem(`${name}.json`, c[name], FILE_KEYS[`${name}.json`]);

// Each area's checks in order; the first problem names the area's trouble.
const AREAS = {
  groundwork: ['skills', 'xp', 'economy', 'spells', 'sky'].map(flat),
  combat: [
    ...['rules', 'callings', 'spells', 'leads', 'foes', 'anims'].map((name) => grouped('combat', name)),
    // tuning.json may be absent (until H's first tune.mjs run), but a broken one is still broken.
    (c) => fileProblem('combat/tuning.json', c.combat?.tuning, FILE_KEYS['combat/tuning.json'], { optional: true }),
  ],
  party: [
    (c) => folderProblem('party/companions', 'json', c.party?.companions, REQUIRED_COMPANIONS, companionProblem),
    ...['regulars', 'teamups', 'banter'].map((name) => grouped('party', name)),
    grouped('camp', 'scenes'),
    (c) => folderProblem('camp/talks', 'md', c.camp?.talks, PHASE4_TALKS, talkProblem),
  ],
  world: ['examine', 'trails'].map(flat),
};

export function phase4Problem(bundle) {
  const content = isRecord(bundle) ? bundle : {};
  const out = {};
  for (const [area, checks] of Object.entries(AREAS)) {
    let problem = null;
    for (const check of checks) {
      try {
        problem = check(content);
      } catch {
        problem = 'the content';
      }
      if (problem) break;
    }
    out[area] = problem;
  }
  return out;
}
