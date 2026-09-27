// Milo's skills. Each level is a real capability, and a level only counts once a check
// against the live Snapshot (and, from step 2, Milo's own saved state) proves it.
// Pure ESM with no DOM and no fs.

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const level = (n, title, proof) => ({ level: n, title, proof });

// Skills no longer live at plots: the plots belong to Chris's buildings now. Watchkeeping stays
// at the watchtower and everything else is kept at Milo's camp.
export const SKILLS = deepFreeze([
  {
    id: 'watchkeeping',
    name: 'Watchkeeping',
    place: 'watchtower',
    summary: 'Keeps an eye on your agent sessions from the watchtower.',
    levels: [
      level(1, 'Reads your agent sessions', 'At least one agent source can be read.'),
      level(2, 'Live status and task alerts', 'At least one agent source reports live status.'),
      level(3, 'Watches GitHub PRs and CI', 'Pull request and CI status show up for a project.'),
      level(4, 'Notices an agent stuck in a loop', 'A session repeating the same step gets flagged.'),
    ],
  },
  {
    id: 'dispatch',
    name: 'Dispatch',
    place: 'camp',
    summary: 'Sends tasks to your crew and brings the results back.',
    levels: [
      level(1, 'Sends one task to the crew', 'A building on one of your plots was designed by Claude Code or Codex.'),
      level(2, 'Runs agents side by side', 'Two runs started from MILO overlap and both finish.'),
      level(3, 'Second agent reviews the first', 'A review run reads the first run’s changes and reports back.'),
      level(4, 'Chains research, build, test', 'A three-step chain runs from start to finish.'),
    ],
  },
  {
    id: 'timekeeping',
    name: 'Timekeeping',
    place: 'camp',
    summary: 'Keeps track of your calendar and deadlines, and clears the fog over the harbor.',
    levels: [
      level(1, 'Reads your calendar', 'Events from a connected calendar show up.'),
      level(2, 'Deadline warnings', 'A deadline within the next day gets a gentle heads-up.'),
      level(3, 'Agent runs on a timetable', 'A scheduled agent run starts on time.'),
      level(4, 'Morning briefing', 'A briefing is ready when you open MILO in the morning.'),
    ],
  },
  {
    id: 'lore',
    name: 'Lore',
    place: 'camp',
    summary: 'Remembers what you decided and why.',
    levels: [
      level(1, 'Remembers decisions per project', 'A decision saved for a project comes back when you open it.'),
      level(2, 'Recall across projects', 'A search finds a decision made in another project.'),
    ],
  },
  {
    id: 'voice',
    name: 'Voice',
    place: 'camp',
    summary: 'Talks things through with you out loud.',
    levels: [
      level(1, 'Push to talk', 'Speech turns into text on your PC.'),
      level(2, 'Spoken briefings', 'Milo reads a briefing aloud.'),
    ],
  },
  {
    id: 'tinkering',
    name: 'Tinkering',
    place: 'camp',
    summary: 'Turns your ideas into buildings, and later into working tools.',
    levels: [
      level(1, 'Designs a building from your idea', 'One of your plots holds a building with a valid blueprint and level tree.'),
      level(2, 'Scaffolds its project folder', 'A building’s project folder is created and its first test passes.'),
      level(3, 'Builds level 1 with the crew', 'A building’s level 1 proof check passes.'),
    ],
  },
]);

/** The skill that lives at a place, or null. Only the watchtower has its own skill now. */
export function skillForPlace(placeId) {
  if (placeId === 'camp') return null;
  return SKILLS.find((skill) => skill.place === placeId) || null;
}

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;

const sourcesOf = (snapshot) => {
  const sources = isRecord(snapshot) ? snapshot.sources : null;
  return isRecord(sources) ? Object.values(sources).filter(isRecord) : [];
};

/**
 * Buildings standing in a saved state: built plots, and plots being redesigned (their building
 * stays up, and comes back as it was if the redesign is cancelled or fails).
 */
function buildingsOf(state) {
  const plots = isRecord(state) && isRecord(state.plots) ? state.plots : {};
  return Object.values(plots).filter((plot) => isRecord(plot) && (plot.status === 'built' || plot.status === 'designing') && isRecord(plot.blueprint));
}

const EMBLEM_SIZE = 12;

/**
 * A blueprint the kit can draw, with its level tree: a name, a style, a 12×12 emblem, and
 * exactly five levels numbered 1 to 5, each with a title and a proof check. Saved blueprints
 * were already repaired by the architect's validator when the state was loaded.
 */
export function hasLevelTree(blueprint) {
  if (!isRecord(blueprint) || !text(blueprint.name) || !isRecord(blueprint.style)) return false;
  const { emblem, levels } = blueprint;
  if (!Array.isArray(emblem) || emblem.length !== EMBLEM_SIZE
    || !emblem.every((row) => typeof row === 'string' && row.length === EMBLEM_SIZE)) return false;
  if (!Array.isArray(levels) || levels.length !== 5) return false;
  return levels.every((entry, index) => isRecord(entry) && entry.level === index + 1 && text(entry.title) && text(entry.proof));
}

// Only the proofs MILO can actually run today. Every other level stays locked.
const PROOFS = {
  watchkeeping: {
    1: (snapshot) => sourcesOf(snapshot).some((source) => source.ok === true),
    2: (snapshot) => sourcesOf(snapshot).some((source) => source.live === true),
  },
  dispatch: {
    1: (_snapshot, state) => buildingsOf(state).some((plot) => (plot.designedBy === 'claude' || plot.designedBy === 'codex') && hasLevelTree(plot.blueprint)),
  },
  tinkering: {
    1: (_snapshot, state) => buildingsOf(state).some((plot) => hasLevelTree(plot.blueprint)),
  },
};

function passes(skillId, levelNumber, snapshot, state) {
  const check = PROOFS[skillId]?.[levelNumber];
  if (typeof check !== 'function') return false;
  try {
    return check(snapshot, state) === true;
  } catch {
    return false;
  }
}

/**
 * Current level per skill. Levels are earned in order: a level counts only when it and
 * every level below it are proven. Never throws; a missing snapshot or state leaves those
 * proofs locked.
 */
export function evaluateSkills(snapshot, state = null) {
  const result = {};
  for (const skill of SKILLS) {
    const proven = [];
    let current = 0;
    for (const step of skill.levels) {
      if (!passes(skill.id, step.level, snapshot, state)) break;
      current = step.level;
      proven.push({ level: step.level, title: step.title });
    }
    const upcoming = skill.levels.find((step) => step.level === current + 1);
    result[skill.id] = {
      level: current,
      next: upcoming ? { level: upcoming.level, title: upcoming.title } : null,
      proven,
    };
  }
  return result;
}
