// Canned crew answers shared by the fake Claude Code and Codex binaries. Made-up text only.

const EMBLEM = [
  '............',
  '.oooooooooo.',
  'oeeeeeeeeeeo',
  'oeeeceeeeeeo',
  'oeeecceeeeeo',
  'oeeeccceeeeo',
  'oeeecccceeeo',
  'oeeeccceeeeo',
  'oeeecceeeeeo',
  'oeeeceeeeeeo',
  'oeeeeeeeeeeo',
  '.oooooooooo.',
];

export const GOOD_BLUEPRINT = {
  version: 1,
  name: 'Clip studio',
  tagline: 'Long streams in, short clips out',
  purpose: 'Finds the best moments in your drawing streams and cuts them into short vertical clips.',
  style: {
    shape: 'workshop', walls: 'plank', wallColor: 'lavender', roof: 'gable', roofColor: 'slateDeep', trim: 'woodDeep',
    door: 'double', windows: 'tall', chimney: false, flag: 'blossom', awning: 'none',
  },
  emblem: EMBLEM,
  props: [{ kind: 'camera', side: 'left' }, { kind: 'filmreel', side: 'right' }],
  yard: 'path',
  levels: [
    { level: 1, title: 'Finds good moments', summary: 'Lists moments worth a clip in one recording.', proof: 'A list of timestamps appears in the clips folder.' },
    { level: 2, title: 'Cuts a clip', summary: 'Cuts one moment into a short clip.', proof: 'A clip file appears in the output folder.' },
    { level: 3, title: 'Vertical crop', summary: 'Crops each clip to 9:16 around the canvas.', proof: 'A 1080x1920 clip plays.' },
    { level: 4, title: 'Captions', summary: 'Adds captions made on the PC.', proof: 'A clip with readable captions plays.' },
    { level: 5, title: 'Whole stream', summary: 'Turns a full stream into a batch of clips.', proof: 'Five clips from one stream appear, each under 60 seconds.' },
  ],
};

export const PARTIAL_BLUEPRINT = {
  version: 2,
  name: 'The Grand Clip Studio For Streams And More!',
  tagline: 'Long streams in, short clips out, every single day of the week, forever and ever',
  purpose: 'Makes clips.',
  style: {
    shape: 'castle', walls: 'wooden', wallColor: 'purple', roof: 'domed', roofColor: 'navy', trim: 'woodDeep',
    door: 'portal', windows: 'many', chimney: 'yes', flag: false, awning: 'red',
  },
  emblem: ['oooooooooo', ...Array(8).fill('occcccccco'), 'oooooooooo'],
  props: [
    { kind: 'camera', side: 'left' }, { kind: 'dragon', side: 'right' }, { kind: 'tripod', side: 'front' },
    { kind: 'easel', side: 'middle' }, { kind: 'lantern', side: 'left' }, { kind: 'bench', side: 'right' },
  ],
  yard: 'lawn',
  levels: [
    { level: 2, title: 'Cuts A Clip', summary: 'Cuts one moment into a short clip.', proof: 'A clip file appears.' },
    { level: 1, title: 'Finds Good Moments', summary: 'Lists moments worth a clip.', proof: 'A list appears.' },
    { level: 3, title: 'Vertical crop', summary: 'Crops to 9:16.', proof: 'A tall clip plays.' },
    { level: 4, title: 'Captions', summary: 'Adds captions.', proof: 'Captions show.' },
    { level: 5, title: 'Whole stream', summary: 'Batch of clips.', proof: 'Five clips appear.' },
    { level: 6, title: 'Extra', summary: 'One too many.', proof: 'Never shown.' },
  ],
};

export const THIN_BLUEPRINT = {
  version: 1,
  name: 'Half a plan',
  tagline: 'Not much here',
  purpose: 'Only two levels.',
  style: GOOD_BLUEPRINT.style,
  emblem: EMBLEM,
  props: [],
  yard: 'grass',
  levels: GOOD_BLUEPRINT.levels.slice(0, 2),
};

export const GOOD_SUGGESTIONS = {
  suggestions: [
    { title: 'Kiln room', pitch: 'Fires off small batch jobs overnight.', why: 'Made-up reason one' },
    { title: 'Map room', pitch: 'Keeps a map of every project folder.', why: 'Made-up reason two' },
    { title: 'Seed library', pitch: 'Saves prompts that worked well.', why: 'Made-up reason three' },
  ],
};

export const PARTIAL_SUGGESTIONS = {
  suggestions: [
    { title: 'Kiln Room', pitch: 'Fires off small batch jobs overnight!', why: 'Made-up reason one' },
    { title: 'kiln room', pitch: 'A duplicate.', why: 'Duplicate' },
    { title: 'Map room', pitch: `${'A very long pitch that keeps going '.repeat(8)}end.`, why: 'Made-up reason two' },
    { title: 'Seed library', pitch: 'Saves prompts that worked well.', why: 'Made-up reason three' },
    { title: 'Fourth one', pitch: 'One too many.', why: 'Extra' },
  ],
};

export const THIN_SUGGESTIONS = { suggestions: [{ title: 'Kiln room', pitch: 'Fires off small batch jobs overnight.', why: 'Made-up reason one' }] };

export function payload(kind, behaviour) {
  if (kind === 'suggest') {
    if (behaviour === 'partial') return PARTIAL_SUGGESTIONS;
    if (behaviour === 'thin') return THIN_SUGGESTIONS;
    return GOOD_SUGGESTIONS;
  }
  if (behaviour === 'partial') return PARTIAL_BLUEPRINT;
  if (behaviour === 'thin') return THIN_BLUEPRINT;
  return GOOD_BLUEPRINT;
}

/** Appends one JSON line describing this run to MILO_FAKE_CREW_LOG, when set. */
export async function logRun(fs, entry) {
  const file = process.env.MILO_FAKE_CREW_LOG;
  if (!file) return;
  // Which of MILO's switches for Claude Code reached this run (never the rest of the environment).
  const switches = {};
  for (const key of ['CLAUDE_CODE_DISABLE_CLAUDE_MDS', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY']) {
    if (process.env[key] !== undefined) switches[key] = process.env[key];
  }
  fs.appendFileSync(file, `${JSON.stringify({ ...entry, switches })}\n`);
}

export function readStdin() {
  return new Promise((resolve) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { text += chunk; });
    process.stdin.on('end', () => resolve(text));
    process.stdin.on('error', () => resolve(text));
  });
}

/** Waits `ms` (a number or numeric string), if any: a crew member taking its time. */
export function thinkFor(ms) {
  const wait = Number(ms);
  return Number.isFinite(wait) && wait > 0 ? new Promise((resolve) => setTimeout(resolve, wait)) : Promise.resolve();
}

export function hangForever() {
  setInterval(() => {}, 60 * 1000);
}
