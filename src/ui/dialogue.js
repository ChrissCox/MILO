// The dialogue box (CONTRACT-PHASE4.md §12.4 K2; PLAN §4; COMBAT.md §3.8, §2.6): a chat-head
// portrait, the lines of a camp scene or a talk, "Click to continue" while there's more, and a
// talk's choices, each greyed with its requirement in words until it's met. Camp scenes and the
// `talk:<id>` panels render through it. Jev never speaks: a line of Jev's is a gesture, drawn as a
// stage direction.
//
// Pure builders plus two small DOM helpers the company's modules share: `portraitCanvas` (the
// markup for a portrait the shell paints) and `paintPortraits` (paints them with panelart's
// portraitScene).
import { esc } from './panels.js';
import { portraitScene } from './panelart.js';

export const id = 'dialogue';

const LOOKS = Object.freeze({
  milo: { kind: 'rig', rig: 'coat', who: 'milo', likeness: null },
  claude: { kind: 'rig', rig: 'robe', who: 'claude', likeness: null },
  codex: { kind: 'rig', rig: 'robe', who: 'codex', likeness: null },
  jev: { kind: 'rig', rig: 'jev', who: 'jev', likeness: null },
  tollkeeper: { kind: 'rig', rig: 'toll', who: 'tollkeeper', likeness: null },
});

/** The Look a named companion's portrait uses when the caller has none (the four rigs). */
export const lookOf = (who) => (Object.hasOwn(LOOKS, who) ? LOOKS[who] : null);

const LOOK_KEYS = Object.freeze(['kind', 'rig', 'who', 'likeness', 'archetype', 'bodyKey', 'parts', 'eyeKey', 'genres', 'scale', 'template', 'name']);

/** A Look reduced to what a portrait needs, as compact JSON for a data attribute. */
export function lookData(look) {
  if (!look || typeof look !== 'object') return '';
  const out = {};
  for (const k of LOOK_KEYS) if (look[k] !== undefined && look[k] !== null) out[k] = look[k];
  return JSON.stringify(out);
}

/**
 * A portrait's markup: a canvas the shell (or paintPortraits) paints from the Look, with a text
 * label for screen readers. `size` is the CSS box in px (the picture scales to fit, pixelated).
 */
export function portraitCanvas(look, { label = '', size = 48, genre = null, cls = 'portrait' } = {}) {
  const data = lookData(look);
  if (!data) return `<span class="${esc(cls)} portrait-blank" role="img" aria-label="${esc(label)}" style="--size:${Math.max(16, Math.min(128, Math.round(Number(size) || 48)))}px"></span>`;
  return `<canvas class="${esc(cls)}" data-scene="portrait" data-look="${esc(data)}"${genre ? ` data-genre="${esc(genre)}"` : ''} role="img" aria-label="${esc(label)}"`
    + ` style="--size:${Math.max(16, Math.min(128, Math.round(Number(size) || 48)))}px" width="1" height="1"></canvas>`;
}

/**
 * Paints every portrait canvas under `root` (the DOM side; a no-op in Node). `genres` is the
 * content's genres list, for dressing in a genre and a stray's colours. Returns how many painted.
 */
export function paintPortraits(root, { genres = null } = {}) {
  let painted = 0;
  const list = root?.querySelectorAll ? root.querySelectorAll('canvas[data-scene="portrait"]') : [];
  for (const canvas of list) {
    try {
      const key = `${canvas.dataset.look}|${canvas.dataset.genre || ''}`;
      if (canvas.dataset.painted === key) continue;
      const img = portraitScene(JSON.parse(canvas.dataset.look || 'null'), { genre: canvas.dataset.genre || null, genres });
      const g = img && canvas.getContext ? canvas.getContext('2d') : null;
      if (!g || typeof ImageData !== 'function') continue;
      canvas.width = img.width;
      canvas.height = img.height;
      g.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
      canvas.dataset.painted = key;
      painted += 1;
    } catch (err) {
      console.error(err);
    }
  }
  return painted;
}

// ---------------------------------------------------------------------------
// The box

const NAMES = Object.freeze({ milo: 'Milo', claude: 'The Scribe', codex: 'The Artificer', jev: 'Jev', tollkeeper: 'The Tollkeeper' });

/** A speaker's shown name (a companion id, a regular's name, or the text's own). */
export const speakerName = (speaker, names = {}) => {
  if (!speaker) return '';
  if (Object.hasOwn(names || {}, speaker)) return names[speaker];
  return Object.hasOwn(NAMES, speaker) ? NAMES[speaker] : String(speaker);
};

// A gesture is shown as a stage direction in brackets, however the content wrote it.
const gestureText = (text) => {
  const t = String(text || '').trim().replace(/^\(|\)$/g, '').trim();
  return t ? `(${t})` : '';
};

/**
 * The dialogue box. view: { speaker: id | null, face: Look | null, lines: TalkLine[] (the shown
 * ones), choices: [{ id, text, met, why }] | null, more: boolean, reply: string | null, liked:
 * string | null, names: { [speaker]: shown name }, scope: 'talk' | 'scene', key: string (the talk or
 * scene id), done: boolean }. Buttons: `dialogue-next` (Click to continue), `dialogue-choose`
 * (data-choice), `dialogue-close`.
 */
export function buildDialogue(view) {
  const v = view || {};
  const names = v.names || {};
  const speaker = v.speaker || (v.lines || []).find((l) => l?.speaker)?.speaker || null;
  const shownName = speakerName(speaker, names);
  const look = v.face || lookOf(speaker);
  const key = String(v.key || 'talk');
  let html = `<section class="dialogue px" data-dialogue="${esc(key)}"${speaker ? ` data-speaker="${esc(speaker)}"` : ''} aria-label="${esc(shownName ? `Talking with ${shownName.replace(/^The /, 'the ')}` : 'A scene')}">`;
  html += `<div class="dialogue-head">${portraitCanvas(look, { label: shownName || 'Someone', size: 48, cls: 'chat-head' })}`
    + `${shownName ? `<p class="dialogue-name">${esc(shownName)}</p>` : ''}</div>`;
  html += '<div class="dialogue-lines" aria-live="polite">';
  for (const line of v.lines || []) {
    if (!line) continue;
    const who = line.speaker ? speakerName(line.speaker, names) : '';
    if (line.gesture) {
      html += `<p class="dialogue-line gesture"${line.speaker ? ` data-speaker="${esc(line.speaker)}"` : ''}>${esc(gestureText(line.gesture))}</p>`;
    } else if (line.text) {
      html += `<p class="dialogue-line"${line.speaker ? ` data-speaker="${esc(line.speaker)}"` : ''}>${who ? `<span class="dialogue-who">${esc(who)}</span> ` : ''}${esc(line.text)}</p>`;
    }
  }
  if (v.reply) html += `<p class="dialogue-line reply">${shownName ? `<span class="dialogue-who">${esc(shownName)}</span> ` : ''}${esc(v.reply)}</p>`;
  if (v.liked) html += `<p class="dialogue-liked">${esc(v.liked)}</p>`;
  html += '</div>';
  if (v.more) {
    html += `<button type="button" class="px-btn primary dialogue-next" data-action="dialogue-next" data-focus-key="dialogue-next-${esc(key)}">Click to continue</button>`;
  } else if (Array.isArray(v.choices) && v.choices.length && !v.done) {
    html += '<ol class="dialogue-choices">';
    for (const c of v.choices) {
      const why = !c.met && c.why ? `<span class="dialogue-why">${esc(c.why)}</span>` : '';
      html += `<li><button type="button" class="px-btn dialogue-choice" data-action="dialogue-choose" data-choice="${esc(c.id)}" data-focus-key="dialogue-choice-${esc(c.id)}"`
        + `${c.met ? '' : ' disabled aria-disabled="true"'}>${esc(c.text)}${why}</button></li>`;
    }
    html += '</ol>';
  } else {
    html += `<button type="button" class="px-btn dialogue-close" data-action="dialogue-close" data-focus-key="dialogue-close-${esc(key)}">Close</button>`;
  }
  return `${html}</section>`;
}

/**
 * The lines a scene shows at step `at` (one line at a time, "Click to continue" until the last):
 * → { lines, more }.
 */
export function sceneStep(lines, at = 0) {
  const list = Array.isArray(lines) ? lines.filter(Boolean) : [];
  const n = Math.max(1, Math.min(list.length, Math.floor(Number(at) || 0) + 1));
  return { lines: list.slice(0, n), more: n < list.length };
}

/** Nothing to mount: camp-view.js draws talks and scenes through buildDialogue (§12.3). */
export function mount() {
  return { dispose() {} };
}
