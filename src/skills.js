// Milo's skills. Each level is a real capability, and a level only counts once a check
// against the live Snapshot proves it. Pure ESM with no DOM and no fs.

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const level = (n, title, proof) => ({ level: n, title, proof });

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
    place: 'workshop',
    summary: 'Sends your agents off to work from the workshop.',
    levels: [
      level(1, 'Launches one agent run', 'An agent run started from MILO finishes.'),
      level(2, 'Runs agents side by side', 'Two runs started from MILO overlap and both finish.'),
      level(3, 'Second agent reviews the first', 'A review run reads the first run’s changes and reports back.'),
      level(4, 'Chains research, build, test', 'A three-step chain runs from start to finish.'),
    ],
  },
  {
    id: 'timekeeping',
    name: 'Timekeeping',
    place: 'harbor',
    summary: 'Keeps track of your calendar and deadlines from the harbor.',
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
    place: 'library',
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
    place: 'building-site',
    summary: 'Builds new tools and apps at the building site.',
    levels: [
      level(1, 'Scaffolds a new app', 'A new app folder is created and its tests pass.'),
      level(2, 'Writes its level tree', 'A new skill’s levels and proofs are written and checked.'),
    ],
  },
]);

/** The skill that lives at a place, or null. */
export function skillForPlace(placeId) {
  return SKILLS.find((skill) => skill.place === placeId) || null;
}

const sourcesOf = (snapshot) => {
  const sources = snapshot && typeof snapshot === 'object' ? snapshot.sources : null;
  return sources && typeof sources === 'object' ? Object.values(sources).filter((s) => s && typeof s === 'object') : [];
};

// Only the proofs MILO can actually run today. Every other level stays locked.
const PROOFS = {
  watchkeeping: {
    1: (snapshot) => sourcesOf(snapshot).some((source) => source.ok === true),
    2: (snapshot) => sourcesOf(snapshot).some((source) => source.live === true),
  },
};

function passes(skillId, levelNumber, snapshot) {
  const check = PROOFS[skillId]?.[levelNumber];
  if (typeof check !== 'function') return false;
  try {
    return check(snapshot) === true;
  } catch {
    return false;
  }
}

/**
 * Current level per skill. Levels are earned in order: a level counts only when it and
 * every level below it are proven. Never throws; a missing snapshot leaves everything locked.
 */
export function evaluateSkills(snapshot) {
  const result = {};
  for (const skill of SKILLS) {
    const proven = [];
    let current = 0;
    for (const step of skill.levels) {
      if (!passes(skill.id, step.level, snapshot)) break;
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
