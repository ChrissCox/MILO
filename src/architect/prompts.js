// The briefs Milo hands the crew. Pure ESM: builds text, touches nothing.
//
// A brief carries only what the privacy rule allows: the question or idea Chris typed or picked
// (and an optional tweak), the plot's name and size, the names of existing buildings, project
// folder names, and skill names with the first 160 characters of their descriptions. A redesign
// also passes the old building's name and style values (both are MILO's own enums and names).

import {
  COLOURS, DOORS, LIMITS, PROP_KINDS, ROOFS, SHAPES, WALLS, WINDOWS, YARDS,
} from './blueprint.js';
import { EMBLEMS } from './offline.js';

/** One line of untrusted text, safe to quote inside a brief. */
export function quoteLine(value, max = 300) {
  const text = Array.from(String(value || '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim())
    .slice(0, max).join('').replace(/"/g, "'");
  return `"${text}"`;
}

function plotLine(plot) {
  const w = Math.max(1, Math.round(Number(plot && plot.w) || 8));
  const h = Math.max(1, Math.round(Number(plot && plot.h) || 6));
  const name = plot && plot.name ? String(plot.name).slice(0, 40) : 'An empty plot';
  const feel = w >= 2 * h ? 'wide and shallow' : h > w ? 'deep' : 'compact';
  return { w, h, name, feel, text: `${name}, ${w} x ${h} tiles of 16 px (${feel})` };
}

/** "About Chris" lines: skill names with short descriptions, project folders, existing buildings. */
export function describeSignals(signals = {}) {
  const lines = [];
  const skills = Array.isArray(signals.skills) ? signals.skills : [];
  if (skills.length) {
    lines.push('His Claude Code skills (name: start of description):');
    for (const skill of skills) {
      const desc = String(skill.description || '').replace(/\s+/g, ' ').slice(0, 160);
      lines.push(`- ${String(skill.name).slice(0, 64)}${desc ? `: ${desc}` : ''}`);
    }
  } else {
    lines.push('His Claude Code skills: none listed.');
  }
  const projects = Array.isArray(signals.projects) ? signals.projects : [];
  lines.push(`His project folders: ${projects.length ? projects.join(', ') : 'none listed'}.`);
  const built = Array.isArray(signals.built) ? signals.built : [];
  lines.push(`Buildings already in the village: Milo's camp, the Watchtower${built.length ? `, ${built.join(', ')}` : ''}.`);
  return lines.join('\n');
}

const VILLAGE = 'MILO is Chris\'s calm pixel-art village on his Windows PC. Milo, a small chibi character, looks after Chris\'s AI crew there: Claude Code and Codex, plus helper tools. Each building on a plot stands for a small app or tool the crew could build for Chris later, one level at a time.';

// Codex runs with its file and command tools switched off (crew.js); this says so to the model too.
const ANSWER = 'Answer from this brief alone, without running commands, opening files or using any tools. Reply with only the JSON object that matches the schema.';

const VOICE = 'Write for Chris and call him "you". Calm and plain: sentence case, contractions, no exclamation marks, no emoji, no "please", no "successfully".';

/** Brief for three building ideas on one plot. */
export function suggestPrompt({ plot, question = '', signals = {}, exclude = [] } = {}) {
  const p = plotLine(plot);
  const shown = (Array.isArray(exclude) ? exclude : []).map((item) => (item && typeof item === 'object' ? item.title : item))
    .filter((item) => typeof item === 'string' && item.trim()).slice(0, 12);
  const ask = String(question || '').trim()
    ? `Chris asked: ${quoteLine(question, 300)}. All 3 should answer that, each in a different way.`
    : "Chris hasn't asked for anything in particular, so pick what would help him most, starting from his skills and projects.";
  return [
    VILLAGE,
    '',
    `Suggest exactly 3 buildings for the plot ${p.text}.`,
    ask,
    shown.length ? `Already suggested here, so offer different ones: ${shown.join(', ')}.` : '',
    '',
    'About Chris (this is all you know about him):',
    describeSignals(signals),
    '',
    'For each suggestion:',
    `- title: a building name of at most ${LIMITS.title} characters, sentence case, that says what happens inside, like "Clip studio", "Draft room" or "Sorting office". Avoid vague words such as hub, nook, corner, space or cottage.`,
    `- pitch: at most ${LIMITS.pitch} characters. Start with a verb ending in s that says what the building does for him, like "Turns your drawing streams into short clips" or "Keeps your draft tiers and sleepers in one place".`,
    `- why: at most ${LIMITS.why} characters naming the evidence by name: one of his skills or project folders ("You have the video-expert skill and stream your drawing"), or the need behind his question in plain words ("Chat requests scroll past while you draw"). Don't quote or restate his question.`,
    'Make the 3 distinct from each other (different kinds of help, not three versions of one tool) and from existing buildings. Each should be specific to Chris and something he would really use every week, a small app or tool his crew could actually build on his PC. No generic notes, to-do or timer apps unless he asks for one.',
    VOICE,
    ANSWER,
  ].filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');
}

function ideaLines(idea, { named = true } = {}) {
  if (typeof idea === 'string') return [`Chris's idea: ${quoteLine(idea, 300)}.`];
  const out = [];
  const title = idea && idea.title ? String(idea.title) : '';
  const pitch = idea && idea.pitch ? String(idea.pitch) : '';
  if (!named || !title) out.push(`Chris's idea, in his words: ${quoteLine(pitch || title, 300)}. He didn't name it, so name it yourself.`);
  else out.push(`Chris's idea: ${quoteLine([title, pitch].filter(Boolean).join(': '), 300)}.`);
  if (idea && idea.why && idea.why !== 'Your own idea') out.push(`Why it fits him: ${quoteLine(idea.why, 140)}.`);
  return out;
}

// What a passer-by expects to see outside a building that does a kind of job. Only a guide: the
// crew picks the values, and any enum combination draws cleanly.
const LOOKS = [
  'making things (a studio, a workshop): a workshop or barn with big tall windows; easel, camera, filmreel, workbench or anvil outside',
  'games and stories: a warm hall or pavilion like a tavern, log or stone walls, lanterns; dicetable, scrollrack, lantern',
  'sport and competition: a clubhouse (barn or hall) in two bold team colours with a flag; trophy, chalkboard, bench',
  'reading and study: stone or brick walls, tall or round windows, a deep green or slate roof; bookcart, scrollrack, bench',
  'food and cooking: a shop with a shopfront, an awning and a chimney, warm colours; crates, barrels, kiln, signboard',
  'mail, sorting and messages: a shop or hall; mailbox, crates, handcart',
  'plans, habits and quests: a hall or town-square building with a flag; signboard or chalkboard out front, bench, lantern',
  'numbers, stats and watching: a tower or observatory; antenna, telescope, lantern',
  'growing and tending: a greenhouse; gardenbed, pottedplant, beehive, well',
];

/** Brief for designing one building from an idea. `named: false` when Chris typed an idea with no name. */
export function designPrompt({ plot, idea, tweak = '', signals = {}, previous = null, named = true } = {}) {
  const p = plotLine(plot);
  const lines = [
    VILLAGE,
    '',
    `Design one building for the plot ${p.text}.`,
    ...ideaLines(idea, { named }),
  ];
  if (previous && typeof previous === 'object' && previous.style) {
    const s = previous.style;
    lines.push(`This is a redesign of "${String(previous.name || '').slice(0, 40)}", which was a ${s.shape} with ${s.walls} walls in ${s.wallColor}, a ${s.roofColor} ${s.roof} roof and ${s.trim} trim.`);
  }
  if (String(tweak || '').trim()) lines.push(`Chris's change for this version: ${quoteLine(tweak, 200)}. Keep what works and make that change.`);
  lines.push(
    '',
    'About Chris (this is all you know about him):',
    describeSignals(signals),
    '',
    'Words:',
    `- name: at most ${LIMITS.name} characters, sentence case. Keep the name Chris gave his idea. If he gave none, name the building for its job in 1 to 3 words, like a place in a village ("Reading room", "Stream booth"). Never add the plot's name.`,
    `- tagline: at most ${LIMITS.tagline} characters, your own concrete, lightly playful line about this job, in the spirit of "Letters in, tidy piles out" or "One check-in a day, a streak that blooms". Not "A quiet place to..." or "A cozy spot for...".`,
    `- purpose: at most ${LIMITS.purpose} characters, one sentence starting with a verb ending in s ("Turns...", "Keeps..."), saying what it does for him.`,
    '',
    'The look: calm, cozy top-down pixel art at a slight 3/4 angle, soft pastel colours, soft dark outlines, like a gentle idle game. MILO\'s kit draws the building from your choices. Someone walking past should guess the job from the building alone, so picture a real building that does this job and choose everything to match it. Don\'t fall back on a cream plaster cottage with a slate gable roof: it says nothing about the job. Some looks that read at a glance:',
    ...LOOKS.map((look) => `- ${look}`),
    'Values:',
    `- shape (${SHAPES.join(', ')}): the ${p.feel} plot suits ${p.feel === 'wide and shallow' ? 'a hall, barn, shop, workshop, pavilion or mill' : 'a cottage, shop, tower, observatory, greenhouse, workshop or barn'}.`,
    `- walls (${WALLS.join(', ')}), roof (${ROOFS.join(', ')}), door (${DOORS.join(', ')}), windows (${WINDOWS.join(', ')}).`,
    `- colours (${COLOURS.join(', ')}): pick a palette that belongs to the job: warm (honey, butter, clay, wood) for food, crafts and cozy rooms; cool (slate, water, lavender, stone) for study and calm; a bold pair (clayDeep and cream, leafDeep and butter, slateDeep and honey) for sport. Walls and roof should clearly differ; trim a little darker than the walls.`,
    '- chimney: true for anything with an oven, a hearth or a cozy workroom. flag: a strong colour suits halls, clubhouses and towers. awning: suits shops, cafes and studios. "none" is fine when they don\'t fit.',
    `- props: 3 or 4 from (${PROP_KINDS.join(', ')}). They're the clearest clue to the job, so pick what you'd expect to see outside this kind of building, put the most telling one at the front, and use both sides.`,
    `- yard: ${YARDS.join(', ')}.`,
    '',
    'Emblem: the icon on the building\'s sign, as exactly 12 strings of exactly 12 characters each. "." is transparent. Colour keys: o ink (outline), c cream, r clay, u butter, U honey, e slate, l leaf, L leafDeep, k blossom, v lavender, b wood, B woodDeep, s stone, w water. Draw the single most recognisable object of the job: a die for games, a football for fantasy football, a loaf for a bakery, a play button or clapperboard for video, an open book for reading, a bell or a ticked list for quests. The sign behind it is cream, so:',
    '- draw the object\'s silhouette with a closed 1-pixel o outline, 9 to 12 pixels across and centred;',
    '- fill it with one or two main colours (cream suits paper, but then give it lines or a coloured edge) and add the telling details (pips, laces, page lines, a crust) in a contrasting key;',
    '- no letters, numbers or words, and no plain squares or grids: the outline shape itself should say what it is.',
    'Two emblems that read well, for the format:',
    ...EMBLEMS.d20,
    '',
    ...EMBLEMS.book,
    '',
    'Levels: exactly 5, numbered 1 to 5 in order. Each is a real feature Chris could build with his crew on his PC, and each builds on the one before. Level 1 is small but useful on its own: one agent run that does one job. Level 5 is the full version of the idea. Where one of his skills or projects already covers part of the job, build on it by name.',
    `- title: at most ${LIMITS.levelTitle} characters, a short verb phrase for what it can do at that level, like "Cuts one clip" or "Crops to vertical". Don't start with "Your".`,
    `- summary: at most ${LIMITS.levelSummary} characters, what that level adds.`,
    `- proof: at most ${LIMITS.levelProof} characters, one concrete check anyone could see, like "A clip file appears in the output folder and plays" or "The panel lists this week's five encounters".`,
    VOICE,
    ANSWER,
  );
  return lines.join('\n');
}
