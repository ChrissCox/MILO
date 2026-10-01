// The camp by the fire (CONTRACT-PHASE4.md §12.4 K2, §7.5, §9.10; COMBAT.md §2.6, §3.8): the panel
// `camp-fire`: who's at the fire on the real clock (camp.campDay), an arrival or camp scene played a
// line at a time (camp.nextScene, through the dialogue box), the evening's talks, teaching at the
// fire once a night, and Setting out. The `talk:<id>` panels play a talk (camp.talkView and
// camp.chooseLine): its choices greyed with their requirement until it's met, and never locked.
//
// Pure: `campView`, `buildCamp`, `talkPanelView` and `buildTalk`. `mount(shell)` registers both
// panels and keeps each one's place (the scene's line, the talk's node) in memory, never in state.
import { esc } from './panels.js';
import { buildDialogue, sceneStep, portraitCanvas, lookOf } from './dialogue.js';
import { regularLook } from './muster.js';
import { campDay, nextScene, sceneSeen, parseTalk, talkView, chooseLine, canTeach } from '../camp.js';

export const id = 'camp-view';

export const PART_WORDS = Object.freeze({
  dawn: 'Dawn at the camp', day: 'Daytime at the camp', dusk: 'Dusk at the camp', evening: 'Evening by the fire', night: 'Late evening by the fire', asleep: 'The camp is asleep',
});
const WHERE_WORDS = Object.freeze({
  fire: 'By the fire', bedroll: 'In a bedroll', tower: 'On the Watchtower roof', bridge: 'Keeping the Last Bridge', away: 'Away', roof: 'On the camp roof',
});
const POSE_WORDS = Object.freeze({ sit: 'sitting', sleep: 'asleep', talk: 'talking', stand: 'standing' });
const fkey = (...parts) => esc(parts.join('-'));

const TALKS = new Map(); // raw text → parsed Talk (or null)
/** A talk's parsed form from its raw text (content.camp.talks[id]), cached; null when it won't parse. */
export function talkOf(text) {
  if (typeof text !== 'string') return null;
  if (TALKS.has(text)) return TALKS.get(text);
  let talk = null;
  try {
    talk = parseTalk(text);
  } catch {
    talk = null;
  }
  if (TALKS.size > 64) TALKS.clear();
  TALKS.set(text, talk);
  return talk;
}

function nameOf(content, state, who) {
  if (who === 'milo') return 'Milo';
  const file = content?.party?.companions?.[who];
  if (file?.name) return file.name;
  return (state?.party?.regulars || []).find((r) => r?.id === who)?.name || who;
}

function lookFor(state, who) {
  const regular = (state?.party?.regulars || []).find((r) => r?.id === who);
  return regular ? regularLook(regular) : lookOf(who);
}

/**
 * The camp-fire panel's view. `sceneAt` is the scene's shown line (the shell's memory), `weather`
 * today's (rain scenes need 'rain'), `snapshot` the crew's (a working Wayfarer is away).
 */
export function campView(state, now, { content = {}, snapshot = null, weather = null, sceneAt = 0 } = {}) {
  const day = campDay(state, now, { content, snapshot });
  const places = day.places.map((p) => ({
    id: p.id, name: nameOf(content, state, p.id), where: p.where,
    words: `${WHERE_WORDS[p.where] || p.where}${p.where === 'fire' || p.where === 'bedroll' ? `, ${POSE_WORDS[p.pose] || p.pose}` : ''}`,
    look: lookFor(state, p.id),
  }));
  const scene = nextScene(state, now, { content, weather });
  const step = scene ? sceneStep(scene.lines, sceneAt) : null;
  const seen = state?.party?.seenScenes || {};
  const roster = Object.keys(state?.party?.roster || {});
  const talks = [];
  for (const [talkId, text] of Object.entries(content?.camp?.talks || {})) {
    const talk = talkOf(text);
    if (!talk) continue;
    if (talk.with !== 'none' && !roster.includes(talk.with)) continue;
    if (talk.once && Object.hasOwn(seen, `talk:${talkId}`)) continue;
    const here = talk.with === 'none' || places.some((p) => p.id === talk.with && p.where === 'fire');
    talks.push({ id: talkId, with: talk.with, name: talk.with === 'none' ? 'Everyone' : nameOf(content, state, talk.with), open: !day.bell && here, why: day.bell ? 'Past your bell. It waits for tomorrow.' : here ? null : 'Not at the fire just now.' });
  }
  return {
    part: day.part,
    words: PART_WORDS[day.part] || '',
    bell: day.bell,
    places,
    scene: scene ? { id: scene.id, who: scene.who, lines: step.lines, more: step.more, at: sceneAt, names: Object.fromEntries(places.map((p) => [p.id, p.name])) } : null,
    talks,
    teach: { open: canTeach(state, now), who: places.filter((p) => p.where === 'fire').map((p) => ({ id: p.id, name: p.name })) },
  };
}

/** The camp-fire panel's HTML (§12.4). Deterministic. */
export function buildCamp(view) {
  const v = view;
  let html = `<section class="camp-fire" data-part="${esc(v.part)}"${v.bell ? ' data-bell="true"' : ''}>`;
  html += `<p class="panel-lede">${esc(v.words)}.</p>`;
  if (v.bell) html += '<p class="quiet-note">Everyone else went to bed. The talk waits for tomorrow.</p>';
  html += '<ul class="camp-places" aria-label="Who’s where">';
  for (const p of v.places) {
    html += `<li class="camp-place" data-member="${esc(p.id)}" data-where="${esc(p.where)}">${portraitCanvas(p.look, { label: p.name, size: 32 })}`
      + `<span class="camp-name">${esc(p.name)}</span><span class="camp-where">${esc(p.words)}</span>`
      + `<button type="button" class="link-btn" data-action="camp-sheet" data-member="${esc(p.id)}" data-focus-key="${fkey('camp-sheet', p.id)}">Sheet</button></li>`;
  }
  html += '</ul>';
  if (v.scene) {
    html += buildDialogue({ speaker: v.scene.who, lines: v.scene.lines, more: v.scene.more, names: v.scene.names, key: v.scene.id, scope: 'scene', done: !v.scene.more, choices: null });
  }
  if (v.talks.length) {
    html += `<section class="group camp-talks"><h3>Talk by the fire <span class="count">${v.talks.length}</span></h3><ul class="talk-list">`;
    for (const t of v.talks) {
      html += `<li><button type="button" class="px-btn small" data-action="camp-talk" data-talk="${esc(t.id)}" data-focus-key="${fkey('camp-talk', t.id)}"${t.open ? '' : ' disabled'}>`
        + `${esc(t.with === 'none' ? 'Sit with everyone' : `Talk with ${t.name.replace(/^The /, 'the ')}`)}</button>${t.why ? `<span class="talk-why">${esc(t.why)}</span>` : ''}</li>`;
    }
    html += '</ul></section>';
  }
  html += '<section class="group camp-teach"><h3>Teaching at the fire</h3>';
  if (!v.teach.open) html += '<p class="quiet-note">Tonight’s lesson has been taught. Another tomorrow night.</p>';
  else {
    html += '<p class="group-note">Once a night, one companion can show another a habit. Open a notebook to choose one.</p><ul class="teach-list">';
    for (const p of v.teach.who) {
      html += `<li><button type="button" class="link-btn" data-action="camp-notebook" data-member="${esc(p.id)}" data-focus-key="${fkey('camp-notebook', p.id)}">${esc(`${p.name}’s notebook`)}</button></li>`;
    }
    html += '</ul>';
  }
  html += '</section>';
  html += '<button type="button" class="px-btn primary" data-action="camp-muster" data-focus-key="camp-muster">Setting out</button>';
  return `${html}</section>`;
}

/**
 * A talk panel's view: the talk at `node`, with the choices answered there greyed ("You’ve said
 * that one."), the last reply and "liked" line, and whether it's over.
 */
export function talkPanelView(talk, state, { now = 0, node = null, picked = [], reply = null, liked = null, done = false, content = {}, party = null } = {}) {
  if (!talk) return null;
  const tv = talkView(talk, state, { now, node, picked, party });
  const names = {};
  for (const l of tv.lines) if (l.speaker) names[l.speaker] = nameOf(content, state, l.speaker);
  return {
    id: talk.id,
    speaker: talk.with === 'none' ? null : talk.with,
    face: talk.with === 'none' ? lookOf('milo') : lookFor(state, talk.with),
    lines: tv.lines,
    choices: tv.choices.map((c) => ({ id: c.id, text: c.text, met: c.met, why: c.why })),
    node: tv.node,
    reply,
    liked,
    done,
    names: { ...names, [talk.with]: nameOf(content, state, talk.with) },
  };
}

/** A talk panel's HTML, through the dialogue box. */
export function buildTalk(view) {
  if (!view) return '<p class="quiet-note">That talk isn’t here.</p>';
  return buildDialogue({ speaker: view.speaker, face: view.face, lines: view.lines, choices: view.done ? null : view.choices, more: false, reply: view.reply, liked: view.liked, names: view.names, key: view.id, scope: 'talk', done: view.done });
}

// ---------------------------------------------------------------------------
// mount(shell)

const NOOP = Object.freeze({ dispose() {}, refresh() {} });

/**
 * Registers `camp-fire` and the `talk:<id>` panels (§12.3). `options.weather()` gives today's
 * weather id for rain scenes (sky.js, through the shell).
 */
export function mount(shell, { weather = () => null } = {}) {
  try {
    if (!shell?.registerPanel) return NOOP;
    let sceneAt = 0;
    let sceneId = null;
    const talks = new Map(); // talk id → { node, picked, reply, liked, done }
    const content = () => shell.content?.() || {};
    const now = () => shell.now?.() ?? 0;
    const view = () => {
      const v = campView(shell.state, now(), { content: content(), snapshot: shell.snapshot?.() || null, weather: weather(), sceneAt });
      if (v.scene?.id !== sceneId) { sceneId = v.scene?.id || null; sceneAt = 0; return campView(shell.state, now(), { content: content(), snapshot: shell.snapshot?.() || null, weather: weather(), sceneAt }); }
      return v;
    };
    const offs = [];
    offs.push(shell.registerPanel('camp-fire', {
      title: () => 'By the fire',
      exists: (panelId) => panelId === 'camp-fire',
      render: () => {
        try { return buildCamp(view()); } catch (err) { console.error(err); return '<p class="quiet-note">The fire’s low just now.</p>'; }
      },
      action: (button, panelId) => {
        if (panelId !== 'camp-fire') return false;
        const act = button?.dataset?.action || '';
        const focus = button.dataset.focusKey || null;
        switch (act) {
          case 'dialogue-next': sceneAt += 1; shell.refreshPanel?.({ focus }); return true;
          case 'dialogue-close': {
            if (sceneId) {
              const next = sceneSeen(shell.state, sceneId, now());
              if (next !== shell.state) shell.set(next);
            }
            sceneId = null;
            sceneAt = 0;
            shell.refreshPanel?.({ focus: 'camp-muster' });
            return true;
          }
          case 'camp-talk': talks.delete(button.dataset.talk); shell.openPanel?.(`talk:${button.dataset.talk}`); return true;
          case 'camp-notebook': shell.openPanel?.(`notebook:${button.dataset.member}`); return true;
          case 'camp-sheet': shell.openPanel?.(`company:${button.dataset.member}`); return true;
          case 'camp-muster': shell.feature?.('muster'); shell.openPanel?.('muster'); return true;
          default: return false;
        }
      },
    }));
    const talkIdOf = (panelId) => (typeof panelId === 'string' && panelId.startsWith('talk:') ? panelId.slice(5) : null);
    const talkFor = (tid) => talkOf(content()?.camp?.talks?.[tid]);
    const memory = (tid) => {
      if (!talks.has(tid)) talks.set(tid, { node: null, picked: [], reply: null, liked: null, done: false });
      return talks.get(tid);
    };
    offs.push(shell.registerPanel('talk:', {
      title: (panelId) => {
        const talk = talkFor(talkIdOf(panelId));
        return talk && talk.with !== 'none' ? `Talking with ${nameOf(content(), shell.state, talk.with).replace(/^The /, 'the ')}` : 'By the fire';
      },
      exists: (panelId) => !!talkFor(talkIdOf(panelId)),
      render: (panelId) => {
        const tid = talkIdOf(panelId);
        try {
          const m = memory(tid);
          return buildTalk(talkPanelView(talkFor(tid), shell.state, { now: now(), ...m, content: content() }));
        } catch (err) {
          console.error(err);
          return '<p class="quiet-note">That talk isn’t here.</p>';
        }
      },
      action: (button, panelId) => {
        const tid = talkIdOf(panelId);
        const talk = tid ? talkFor(tid) : null;
        const act = button?.dataset?.action || '';
        if (!talk || !act.startsWith('dialogue-')) return false;
        const m = memory(tid);
        if (act === 'dialogue-close') { talks.delete(tid); shell.closePanel?.(); return true; }
        if (act !== 'dialogue-choose') return false;
        const choiceId = button.dataset.choice;
        const r = chooseLine(talk, shell.state, choiceId, now(), { content: content() });
        if (r.state !== shell.state) shell.set(r.state);
        const moved = r.next !== (m.node || talk.start);
        talks.set(tid, {
          node: r.done ? m.node : r.next,
          picked: r.done || moved ? [] : [...m.picked, choiceId],
          reply: r.reply || null,
          liked: r.liked || null,
          done: !!r.done,
        });
        shell.refreshPanel?.({ focus: null });
        return true;
      },
    }));
    return {
      dispose() { for (const off of offs) if (typeof off === 'function') off(); },
      refresh() { talks.clear(); sceneAt = 0; },
    };
  } catch (err) {
    console.error(err);
    return NOOP;
  }
}
