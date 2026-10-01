// Right-click menus on everything (CONTRACT-PHASE4.md §12.1, §12.4 K1, §3.1 "Field skills"; PLAN.md
// §2 and §7; COMBAT.md §13): the options for anything Chris can point at, with the left-click
// default first and Examine last, the hover tip's words, the menu's HTML and its keys. Pure but for
// runOption and mount.
//
// Field skills are named after whoever can do them, or greyed with who could: "Pick lock (the
// Artificer, at camp)". Phase 4 ships five (Light, Read, Pick, Sort, Riddle); the other ten are
// listed here as data only and never offered. Option 0 (`id: 'default'`) is always exactly what a
// left click on the same thing does, so the shell can dispatch it the same way.
import { esc } from './panels.js';
import { examineEntity, placeName, chestOpened } from './examine.js';
import { lineOf, toggleLine, actLine } from './log.js';

export const id = 'menus';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const str = (value) => (typeof value === 'string' ? value : '');

/**
 * Every companion's field skill (content/party/companions/*.json `fieldSkill`), by skill id:
 * { who, phase4 }. Only the phase4 ones are ever offered; L1's expedition.fieldSkill does them.
 */
export const FIELD_SKILLS = Object.freeze({
  light: Object.freeze({ who: 'milo', phase4: true }),
  read: Object.freeze({ who: 'claude', phase4: true }),
  pick: Object.freeze({ who: 'codex', phase4: true }),
  sort: Object.freeze({ who: 'jev', phase4: true }),
  riddle: Object.freeze({ who: 'tollkeeper', phase4: true }),
  // Data only in Phase 4.
  track: Object.freeze({ who: 'dusty', phase4: false }),
  unfold: Object.freeze({ who: 'pip', phase4: false }),
  heave: Object.freeze({ who: 'rivet', phase4: false }),
  'jack-in': Object.freeze({ who: 'juno', phase4: false }),
  nightsight: Object.freeze({ who: 'lumi', phase4: false }),
  investigate: Object.freeze({ who: 'mae', phase4: false }),
  stonespeak: Object.freeze({ who: 'tova', phase4: false }),
  tideread: Object.freeze({ who: 'nell', phase4: false }),
  hear: Object.freeze({ who: 'whisper', phase4: false }),
  'pass-through': Object.freeze({ who: 'vesperine', phase4: false }),
});

// Names and pronouns when the content bundle has none (the companion files' own).
const DEFAULT_PEOPLE = Object.freeze({
  milo: { name: 'Milo', pronoun: 'he' }, claude: { name: 'The Scribe', pronoun: 'she' }, codex: { name: 'The Artificer', pronoun: 'they' },
  jev: { name: 'Jev', pronoun: 'it' }, tollkeeper: { name: 'The Tollkeeper', pronoun: 'he' },
});
const FOUNDERS = Object.freeze(['milo', 'claude', 'codex', 'jev']);
const DEFAULT_CHOSEN = Object.freeze(['claude', 'codex', 'jev']);

/** 'The Scribe' → 'the Scribe' (a name mid-sentence). */
const midName = (name) => str(name).replace(/^The /, 'the ').replace(/^A /, 'a ').replace(/^An /, 'an ');
/** 'the Scribe' → 'The Scribe'. */
const startName = (name) => (name ? name.charAt(0).toUpperCase() + name.slice(1) : '');
const BE = Object.freeze({ he: 'he’s', she: 'she’s', they: 'they’re', it: 'it’s' });
const OBJECT = Object.freeze({ he: 'him', she: 'her', they: 'them', it: 'it' });
const HAS = Object.freeze({ he: 'hasn’t', she: 'hasn’t', they: 'haven’t', it: 'hasn’t' });

/**
 * What optionsFor needs to know, from the state and the content bundle: { party: { out, roster },
 * people: { [id]: { name, pronoun } }, combat, area, battle, actions }. `out` is who walks with
 * Milo (Milo and `party.chosen`); `roster` everyone who has joined. In a fight, `battle` is the
 * live Battle (combatants' names and sides) and `actions` the selected hero's legal actions for the
 * slot in hand: { hero: 'Pip', list: battle.legalActions(…) or planner.barOptions(…) }, or null
 * when no slot is in hand. `opened` is the wild chests opened (state.wilds.opened, by id; read,
 * never copied), so an opened chest offers nothing to open, as its Examine says.
 */
export function menuContext({ state = null, content = null, combat = false, area = null, battle = null, actions = null } = {}) {
  const party = isRecord(state) && isRecord(state.party) ? state.party : {};
  const opened = isRecord(state) && isRecord(state.wilds) && isRecord(state.wilds.opened) ? state.wilds.opened : {};
  const roster = isRecord(party.roster) ? Object.keys(party.roster) : [...FOUNDERS];
  const chosen = Array.isArray(party.chosen) ? party.chosen.filter((x) => typeof x === 'string') : [...DEFAULT_CHOSEN];
  const people = {};
  const files = isRecord(content) && isRecord(content.party) && isRecord(content.party.companions) ? content.party.companions : {};
  for (const who of new Set(Object.values(FIELD_SKILLS).map((s) => s.who))) {
    const file = isRecord(files[who]) ? files[who] : {};
    const fallback = DEFAULT_PEOPLE[who] || { name: startName(who), pronoun: 'they' };
    people[who] = { name: str(file.name) || fallback.name, pronoun: Object.hasOwn(BE, file.pronoun) ? file.pronoun : fallback.pronoun };
  }
  return {
    party: { out: ['milo', ...chosen.filter((x) => x !== 'milo')], roster: [...new Set(['milo', ...roster])] }, people, combat: Boolean(combat), area,
    battle: isRecord(battle) ? battle : null, actions: isRecord(actions) || Array.isArray(actions) ? actions : null, opened,
  };
}

const EXAMINE = Object.freeze({ id: 'examine', label: 'Examine', disabled: false, why: null });
const option = (idOf, label, { disabled = false, why = null } = {}) => ({ id: idOf, label, disabled: Boolean(disabled), why: disabled ? why : null });

/**
 * A field skill's option: "Pick lock (the Artificer)" when they're out with Milo, else greyed
 * with who could: "Pick lock (the Artificer, at camp)", or "(…, not in the Company yet)".
 */
export function fieldOption(skill, verb, ctx) {
  const entry = FIELD_SKILLS[skill];
  const context = isRecord(ctx) && isRecord(ctx.party) ? ctx : menuContext();
  const who = entry ? entry.who : 'milo';
  const person = context.people?.[who] || DEFAULT_PEOPLE[who] || { name: startName(who), pronoun: 'they' };
  const name = midName(person.name);
  const idOf = `field-${skill}`;
  if (context.party.out.includes(who)) return option(idOf, `${verb} (${name})`);
  if (context.party.roster.includes(who)) {
    return option(idOf, `${verb} (${name}, at camp)`, {
      disabled: true, why: `${startName(name)} can do this, but ${BE[person.pronoun] || 'they’re'} at camp. Bring ${OBJECT[person.pronoun] || 'them'} along at the muster.`,
    });
  }
  return option(idOf, `${verb} (${name}, not in the Company yet)`, {
    disabled: true, why: `${startName(name)} could do this, but ${HAS[person.pronoun] || 'hasn’t'} joined the Company yet.`,
  });
}

const CREW_NAMES = Object.freeze({ claude: 'Claude', codex: 'Codex', ollama: 'the hearth-sprite', jev: 'Jev', whisper: 'Whisper' });
const labelOf = (target, fallback) => midName(str(target.label).trim()) || fallback;
/** A combatant's name mid-sentence, as describe.nameIn has it: 'Glitch beetle' → 'glitch beetle'; 'Milo' and 'Rivet Pike' stay. */
const creatureOf = (target, fallback) => {
  const name = labelOf(target, fallback);
  return /^[A-Z][a-z’'-]+ [a-z]/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
};
/** The member id in 'party:claude', 'cb:…', or a bare id. */
const memberOf = (target) => str(target.member) || str(target.id).replace(/^party:/, '');

/** A unit of the battle by id, or null. */
const unitOf = (battle, unitId) => (isRecord(battle) && Array.isArray(battle.units) ? battle.units.find((u) => isRecord(u) && u.id === unitId) || null : null);
/** A unit's name mid-sentence, cased as creatureOf cases a label. */
const unitName = (battle, unitId) => creatureOf({ label: unitOf(battle, unitId)?.name || '' }, 'them');
const sentence = (text) => (/[.?…]$/.test(text) ? text : `${text}.`);

/**
 * The selected hero's legal actions that land on one combatant, as menu options between the
 * default and Examine (COMBAT §13: "Strike Glitch beetle / 4 more options"). `actions` is
 * menuContext's ({ hero, list }); each legal action (battle.legalActions or planner.barOptions:
 * { action, words, why, targets, index? }) whose targets name `unitId` gives
 * { id: 'act:<index>', label, disabled, why, group: 'For <hero>', act: { index, unit, action } },
 * with `action` carrying that target. Enabled first. The shell plans it (the planner's
 * { t: 'option', index } then { t: 'pointer', unitId }); runOption leaves it alone.
 */
export function actionOptions(actions, unitId, { battle = null, name = null } = {}) {
  const list = isRecord(actions) && Array.isArray(actions.list) ? actions.list : Array.isArray(actions) ? actions : [];
  const hero = isRecord(actions) ? str(actions.hero).trim() : '';
  const group = hero ? `For ${midName(hero)}` : 'For your hero';
  const who = name || unitName(battle, unitId);
  const out = [];
  list.forEach((entry, i) => {
    if (!isRecord(entry) || !isRecord(entry.action) || !Array.isArray(entry.targets)) return;
    const target = entry.targets.find((t) => isRecord(t) && (t.unit === unitId || (Array.isArray(t.units) && t.units.includes(unitId))));
    if (!target) return;
    const index = Number.isInteger(entry.index) ? entry.index : i;
    const words = str(entry.words) || str(entry.action.id);
    const label = entry.action.id === 'assist' && Array.isArray(target.units) && target.units.length >= 2
      ? `${words} ${unitName(battle, target.units[0])} on ${unitName(battle, target.units[1])}` : `${words} ${who}`;
    const why = str(entry.why) ? sentence(str(entry.why)) : null;
    out.push({ ...option(`act:${index}`, label, { disabled: Boolean(why), why }), group, act: { index, unit: unitId, action: { ...entry.action, target } } });
  });
  return [...out.filter((o) => !o.disabled), ...out.filter((o) => o.disabled)];
}

/** The poi's type: 'poi:chest:1,2' → 'chest'. */
const poiType = (target) => str(target.poiType) || str(target.type) || (/^poi:([a-z]+):/.exec(str(target.id)) || [])[1] || '';
const foeOf = (target) => str(target.foe) || str(target.foeId) || (isRecord(target.stray) ? str(target.stray.foe) : '');
/**
 * A cave's locked chest: its `locked` flag, or, since scene-elsewhere.js's objectEntity passes on
 * the label but not the flag, elsewhere.js's label for one ("A locked chest"). An explicit
 * `locked: false` wins over the label.
 */
const chestLocked = (target) => target.locked === true || (target.locked !== false && /^a locked chest\b/i.test(str(target.label).trim()));

/**
 * The options for anything Chris can point at: [{ id, label, disabled, why }], the left-click
 * default first (id 'default') and Examine last. `target` is an engine entity ({ kind, id, label,
 * … }) or one of the shell's own: { kind: 'crew' } (a crew chip), 'place' (a place-list button),
 * 'rift-row', 'log-line' ({ detail, action }), 'ground' ({ tile }), 'home', 'leave'. `ctx` is
 * menuContext's. An empty list means there's nothing to offer (no menu opens).
 */
export function optionsFor(target, ctx = null) {
  if (!isRecord(target)) return [];
  const context = isRecord(ctx) && isRecord(ctx.party) ? ctx : menuContext();
  const kind = str(target.kind);
  const targetId = str(target.id);
  const out = [];
  const add = (item) => { if (item) out.push(item); };
  const withExamine = () => [...out, { ...EXAMINE }];
  const inFight = context.combat === true;

  switch (kind) {
    case 'log-line': {
      const detail = Array.isArray(target.detail) && target.detail.length > 0;
      if (detail) add(option('default', target.open ? 'Show less' : 'Show more'));
      if (isRecord(target.action) && str(target.action.label)) add(option(detail ? 'log-action' : 'default', str(target.action.label)));
      return out; // A line has nothing to examine.
    }
    case 'home': return [option('default', 'Travel home')];
    case 'leave': return [option('default', 'Leave')];
    case 'combatant': {
      // A left click in a fight: a hero is selected; a foe is Struck when the slot in hand can
      // Strike it (the planner's pointer), else it becomes the target.
      const unitId = targetId.replace(/^cb:/, '');
      const unit = unitOf(context.battle, unitId);
      const name = creatureOf({ label: str(target.label) || unit?.name || '' }, 'them');
      const side = str(target.side) || str(unit?.side);
      const acts = actionOptions(context.actions, unitId, { battle: context.battle, name });
      const strike = side === 'party' ? null : acts.find((o) => !o.disabled && o.act.action.id === 'strike' && !o.act.action.choice) || null;
      const hero = side === 'party' && (!unit || unit.rank === 'hero');
      add(option('default', strike ? strike.label : hero ? `Select ${name}` : `Target ${name}`));
      for (const item of acts) if (item !== strike) out.push(item);
      return withExamine();
    }
    case 'milo':
      add(option('default', 'Milo’s sheet'));
      return withExamine();
    case 'crew': {
      const who = targetId.replace(/^crew:/, '');
      add(option('default', `Check on ${CREW_NAMES[who] || labelOf(target, 'them')}`));
      if (context.party.roster.includes(who)) add(option('company', `${startName(midName(context.people[who]?.name || CREW_NAMES[who] || who))}’s sheet`));
      return withExamine();
    }
    case 'party':
    case 'follower': {
      const who = memberOf(target);
      const name = midName(context.people[who]?.name || target.label || who);
      add(option('default', `Select ${name}`));
      add(target.unchained ? option('chain', `Bring ${name} back into line`) : option('unchain', `Ask ${name} to wait here`));
      add(option('company', `${startName(name)}’s sheet`));
      return withExamine();
    }
    case 'place':
      add(option('default', `Go to ${labelOf(target, midName(placeName(targetId)) || 'that place')}`));
      return withExamine();
    case 'rift-row':
      // A closed rift's row has nothing to click: only its Examine.
      if (target.closed !== true) add(option('default', `Look at ${labelOf(target, 'the rift')}`));
      return withExamine();
    case 'gate':
      add(option('default', 'Look at the gate'));
      return withExamine();
    case 'war-table':
      add(option('default', 'Open the War Table'));
      return withExamine();
    case 'rift':
      add(option('default', 'Look at the rift'));
      if (target.fieldBoss === true && !inFight) add(option('challenge', 'Challenge'));
      return withExamine();
    case 'echo':
      add(option('default', 'Look at the rift it echoes'));
      return withExamine();
    case 'lantern': {
      add(option('default', 'Go to the lantern'));
      if (target.lit !== true && !inFight) add(fieldOption('light', 'Light it', context));
      return withExamine();
    }
    case 'poi': {
      // A wild place's click walks there and opens its panel, so its default is "Go to …" by its
      // label (wilds.js calls an opened chest "An open chest").
      const type = poiType(target);
      add(option('default', `Go to ${labelOf(target, 'it')}`));
      if (!inFight) {
        if (type === 'ruin') add(fieldOption('read', 'Read the glyphs', context));
        if (type === 'statue') add(fieldOption('read', 'Read the plinth', context));
        if (type === 'chest' && !chestOpened(target, context.opened)) add(fieldOption('sort', 'Check for a Mimic', context));
      }
      return withExamine();
    }
    case 'tree':
      // A felled tree's click shows its stump line (app.js chopTree).
      add(option('default', target.felled === true || /stump/i.test(str(target.label)) ? 'Look at the stump' : 'Chop the tree'));
      return withExamine();
    case 'rock':
    case 'bush':
      add(option('default', 'Walk over'));
      return withExamine();
    case 'tale-lead':
    case 'field-boss':
      add(option('default', 'Look at the Tale-lead'));
      if (target.fieldBoss === true && !inFight) add(option('challenge', 'Challenge'));
      return withExamine();
    case 'stray':
    case 'encounter':
    case 'post':
    case 'foe': {
      const lead = /:lead$/.test(targetId);
      add(option('default', lead ? 'Look at the Tale-lead' : 'Go and say hello'));
      if (lead && target.fieldBoss === true && !inFight) add(option('challenge', 'Challenge'));
      const foe = foeOf(target);
      if (!inFight && foe === 'unwritten') add(fieldOption('read', 'Listen', context));
      if (!inFight && foe === 'tollmen') add(fieldOption('riddle', 'Trade riddles', context));
      return withExamine();
    }
    case 'exit':
      add(option('default', 'Leave'));
      return withExamine();
    case 'stitch':
      add(option('default', 'Look at the tear'));
      return withExamine();
    case 'loot':
    case 'chest': {
      // An opened chest's click says it's open and emptied (app.js claimElsewhereLoot): nothing to
      // open, pick or check.
      const opened = chestOpened(target, context.opened);
      add(option('default', opened ? 'Look in the chest' : 'Open the chest'));
      if (!inFight && !opened) {
        if (chestLocked(target)) add(fieldOption('pick', 'Pick lock', context));
        add(fieldOption('sort', 'Check for a Mimic', context));
      }
      return withExamine();
    }
    case 'curio':
      add(option('default', 'Look at the curio'));
      return withExamine();
    case 'nook':
      add(option('default', 'Rest in the nook'));
      return withExamine();
    case 'landmark':
    case 'last-bridge':
    case 'tollkeeper': {
      const toll = kind === 'tollkeeper' || targetId === 'landmark:tollkeeper';
      add(option('default', toll ? 'Talk to the Tollkeeper' : 'Walk to the bridge'));
      return withExamine();
    }
    case 'ground':
    case 'sky':
    case 'tile':
      // In a fight nobody walks: a click there moves the planner's tile cursor (or picks the tile).
      add(option('default', inFight ? 'Choose this tile' : 'Walk here'));
      return withExamine();
    default:
      add(option('default', `Go to ${labelOf(target, 'it')}`));
      return withExamine();
  }
}

/** The hover tip: 'Chop the tree / 1 more option', 'Go to the lantern / 2 more options', or the label alone. */
export function tipText(options) {
  const list = Array.isArray(options) ? options.filter((o) => isRecord(o) && str(o.label)) : [];
  if (!list.length) return '';
  const more = list.length - 1;
  if (!more) return list[0].label;
  return `${list[0].label} / ${more} more ${more === 1 ? 'option' : 'options'}`;
}

/** optionsFor then tipText, for the shell's hover tip. */
export const hoverTip = (target, ctx) => tipText(optionsFor(target, ctx));

/** The menu's name when it has no title of its own. */
export const MENU_NAME = 'Options';

/**
 * The menu's HTML for #context-menu (a plain div.px): { title, options }. The title sits above
 * the menu (`div.menu-items[role=menu]`, named by it), and the menu holds only menuitems and their
 * role=group wrappers, so a screen reader finds nothing else inside. Each option is a menuitem
 * button (roving focus: tabindex -1, the menu moves focus itself); a greyed one is aria-disabled
 * and says why through aria-describedby, pointing at words kept after the menu. Options that
 * share a `group` (a hero's planned actions) sit in a role=group under its name.
 */
export function buildMenu(view) {
  const options = Array.isArray(view?.options) ? view.options.filter(isRecord) : [];
  const title = str(view?.title);
  let html = title ? `<p class="menu-title" id="context-menu-title">${esc(title)}</p>` : '';
  html += `<div class="menu-items" role="menu" ${title ? 'aria-labelledby="context-menu-title"' : `aria-label="${esc(MENU_NAME)}"`}>`;
  let group = '';
  let whys = '';
  options.forEach((item, i) => {
    const next = str(item.group);
    if (next !== group) {
      if (group) html += '</div>';
      if (next) html += `<div class="menu-group" role="group" aria-labelledby="menu-group-${i}"><p class="menu-group-title" id="menu-group-${i}" aria-hidden="true">${esc(next)}</p>`;
      group = next;
    }
    const whyId = item.disabled && item.why ? ` aria-describedby="menu-why-${i}"` : '';
    html += `<button type="button" role="menuitem" class="menu-item" data-action="menu-choose" data-option="${esc(item.id)}" data-index="${i}"`
      + ` data-focus-key="menu-${i}" tabindex="-1"${item.disabled ? ' aria-disabled="true"' : ''}${whyId}>${esc(item.label)}</button>`;
    if (item.disabled && item.why) whys += `<span id="menu-why-${i}">${esc(item.why)}</span>`;
  });
  if (group) html += '</div>';
  html += '</div>';
  return whys ? `${html}<div class="sr-only menu-whys">${whys}</div>` : html;
}

/** The menu's keys, as a table: key → what it does. Tab isn't here: it leaves the menu, which closes it. */
export const MENU_KEYS = Object.freeze({
  ArrowDown: 'next', ArrowUp: 'prev', Home: 'first', End: 'last', Enter: 'choose', ' ': 'choose', Escape: 'close', ContextMenu: 'close',
});
/** What opens a menu from the keyboard, on anything that has one: the ContextMenu key, or Shift+F10. */
export function opensMenu(event) {
  if (!event || typeof event !== 'object') return false;
  return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey === true && !event.altKey && !event.ctrlKey && !event.metaKey);
}
/** The menu action for a key event, or null. */
export function menuKey(event) {
  if (!event || event.altKey || event.ctrlKey || event.metaKey) return null;
  return Object.hasOwn(MENU_KEYS, event.key) ? MENU_KEYS[event.key] : null;
}
/** The index focus moves to for a menu action, wrapping round. */
export function stepIndex(action, index, count) {
  if (count <= 0) return -1;
  const i = Number.isInteger(index) && index >= 0 ? index : -1;
  if (action === 'next') return (i + 1) % count;
  if (action === 'prev') return i <= 0 ? count - 1 : i - 1;
  if (action === 'first') return 0;
  if (action === 'last') return count - 1;
  return i;
}

/**
 * Where the menu goes: beside the pointer (or the element it opened from), flipped to stay inside
 * the window and below the title bar. at: { x, y } CSS px; size: { width, height }; view: { width, height }.
 */
export function placeMenu(at, size, view, { top = 36, margin = 8 } = {}) {
  const w = Math.max(0, Number(size?.width) || 0);
  const h = Math.max(0, Number(size?.height) || 0);
  const vw = Math.max(0, Number(view?.width) || 0);
  const vh = Math.max(0, Number(view?.height) || 0);
  let x = Number.isFinite(at?.x) ? at.x + 2 : margin;
  let y = Number.isFinite(at?.y) ? at.y + 2 : top;
  if (x + w > vw - margin) x = Math.max(margin, (Number.isFinite(at?.x) ? at.x - 2 : vw) - w);
  if (y + h > vh - margin) y = Math.max(top, (Number.isFinite(at?.y) ? at.y - 2 : vh) - h);
  x = Math.min(Math.max(margin, x), Math.max(margin, vw - margin - w));
  y = Math.min(Math.max(top, y), Math.max(top, vh - margin - h));
  return { left: Math.round(x), top: Math.round(y) };
}

// ---------------------------------------------------------------------------
// The shell's own things a menu opens on, as targets.

/** The DOM things with a menu: crew chips, place-list buttons, rift rows, Log lines and combatants. */
export const MENU_SOURCES = '.crew-chip[data-crew], #place-list [data-place], #place-list [data-entity], .rift-row[data-rift-id] .rift-name, .rift-row[data-rift-id], #log [data-line]';

const CREW_TITLES = Object.freeze({ claude: 'Claude', codex: 'Codex', ollama: 'The hearth-sprite', jev: 'Jev', whisper: 'Whisper' });

/**
 * A target from the engine's onContextMenu(info) ({ kind, id, entity, x, y, tile }): the entity
 * itself, or a place, a crew member or the ground, labelled so the menu and Examine can name it.
 * `placeLabel(id)` is the shell's name for a place (a built plot goes by its building's); the
 * vale's own names otherwise.
 */
export function targetOfHit(info, { placeLabel = null } = {}) {
  if (!isRecord(info)) return null;
  const nameOf = (placeId) => {
    try { return str(typeof placeLabel === 'function' ? placeLabel(placeId) : '') || placeName(placeId); } catch { return placeName(placeId); }
  };
  if (isRecord(info.entity)) {
    const entity = info.entity;
    return str(entity.label) || entity.kind !== 'place' ? { ...entity } : { ...entity, label: nameOf(entity.id) };
  }
  const kind = str(info.kind) || 'ground';
  const hitId = str(info.id);
  if (kind === 'place') return { kind, id: hitId, label: nameOf(hitId) };
  if (kind === 'crew') return { kind, id: hitId, label: CREW_TITLES[hitId] || startName(hitId) };
  return { kind: kind === 'entity' ? 'ground' : kind, id: hitId || null, tile: isRecord(info.tile) ? { x: info.tile.x, y: info.tile.y } : null };
}

/** A target from a DOM element (its data attributes), or null. `lines` finds a Log line by seq. */
export function targetOfElement(el, { lines = null } = {}) {
  if (!el || typeof el.getAttribute !== 'function') return null;
  const get = (name) => el.getAttribute(name);
  const label = str(el.textContent).replace(/\s+/g, ' ').trim();
  if (get('data-crew')) return { kind: 'crew', id: get('data-crew'), label };
  if (get('data-place')) return { kind: 'place', id: get('data-place'), label };
  if (get('data-entity')) {
    const entity = get('data-entity');
    const kind = get('data-kind') || (entity.startsWith('cb:') ? 'combatant' : '');
    if (entity === 'home' || entity === 'leave') return { kind: entity, id: entity, label };
    return { kind: entity.startsWith('cb:') ? 'combatant' : kind, id: entity, label: str(el.firstChild?.textContent || label).trim() || label };
  }
  if (get('data-line')) {
    const line = typeof lines === 'function' ? lines(Number(get('data-line'))) : null;
    return line ? { kind: 'log-line', id: `line:${get('data-line')}`, detail: line.detail, action: line.action, open: line.open === true, label: line.text } : null;
  }
  const row = typeof el.closest === 'function' ? el.closest('.rift-row[data-rift-id]') : null;
  if (row) {
    const name = row.querySelector ? row.querySelector('.rift-name') : null;
    const closed = typeof row.classList?.contains === 'function' && row.classList.contains('closed');
    return { kind: 'rift-row', id: row.getAttribute('data-rift-id'), label: str(name?.textContent).trim(), riftKind: row.getAttribute('data-rift-kind'), ...(closed ? { closed: true } : {}) };
  }
  return null;
}

/** What a target is as an entity, for Examine: a rift row is its rift, a crew chip its crew member. */
export function entityOfTarget(target) {
  if (!isRecord(target)) return null;
  if (target.kind === 'rift-row') return { kind: 'rift', id: target.id, label: target.label };
  return target;
}

const seqOf = (target) => Number(str(target.id).replace(/^line:/, ''));

/**
 * The options the menu can do without the shell's own wiring: 'examine' (a note bubble),
 * 'default' on one of the shell's buttons (it clicks it, so it does exactly what a click does), on
 * a Log line (it shows more, or runs the line's action), on a vale place (shell.openPanel(id,
 * { walk: true }), as the place list does) or on a world entity (world.walkToEntity, which acts on
 * arrival as a click does), 'log-action', 'company' (the character sheet), and a follower's
 * 'unchain' and 'chain'. → true when it did something; false leaves the option to the shell
 * ('challenge', 'field-*', 'act:*', a combatant's default, a tile in a fight, selecting a
 * follower, a canvas crew member's card, Milo's sheet). `battle` is the live Battle (a
 * combatant's Examine), `combat` whether a fight is on (nothing walks then).
 */
export function runOption(shell, choice, target, { source = null, battle = null, combat = false } = {}) {
  try {
    if (!shell || !isRecord(choice) || !isRecord(target) || choice.disabled) return false;
    switch (choice.id) {
      case 'examine': return Boolean(examineEntity(shell, entityOfTarget(target), { battle, combat: combat === true }));
      case 'log-action': return target.kind === 'log-line' ? actLine(seqOf(target)) : false;
      case 'default': {
        if (target.kind === 'log-line') return toggleLine(seqOf(target)) || actLine(seqOf(target));
        if (source && typeof source.click === 'function') { source.click(); return true; }
        // A crew member on the canvas opens their card (app.js openCrew), which only the shell can.
        if (combat === true || ['combatant', 'milo', 'party', 'follower', 'crew'].includes(target.kind)) return false;
        if ((target.kind === 'ground' || target.kind === 'tile') && isRecord(target.tile)) { shell.world('walkTo', target.tile); return true; }
        // A vale place: its panel, and Milo walks there, as its place-list button does (the
        // engine's walkToEntity resolves wild things, never the vale's places).
        if (target.kind === 'place' && str(target.id)) { shell.openPanel(target.id, { walk: true }); return true; }
        // An engine entity with its tile (a canvas target) walks as the canvas's own click does;
        // one known only by id is looked up by the engine.
        if (str(target.id) && Number.isFinite(target.x) && Number.isFinite(target.y)) { shell.world('walkToEntity', { ...target }); return true; }
        if (str(target.id)) { shell.world('walkToEntity', target.id); return true; }
        return false;
      }
      case 'company': {
        const who = target.kind === 'milo' ? 'milo' : memberOf(target).replace(/^crew:/, '');
        if (!who) return false;
        shell.openPanel(`company:${who}`);
        return true;
      }
      case 'unchain':
      case 'chain': shell.world('chain', memberOf(target), choice.id === 'chain'); return true;
      default: return false;
    }
  } catch (err) {
    console.error('[MILO] menu option', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// The DOM.

const NOOP = Object.freeze({ dispose() {}, refresh() {}, open() { return false; }, openHit() { return false; }, close() {}, isOpen() { return false; } });

function typing(doc) {
  const el = doc?.activeElement;
  if (!el) return false;
  const tag = str(el.tagName).toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}

/**
 * Mounts #context-menu. Options, all optional:
 * - `choose(option, target, { source, battle, combat })` → true when the shell did the option
 *   itself (the canvas's defaults, field skills, Challenge, a combatant's default and `act:*`);
 *   anything it leaves goes to runOption.
 * - `battle()` → the live Battle in a fight, else null: combatants' names, sides and Examine
 *   lines, however the menu was opened (the canvas, the place list, the keyboard).
 * - `actions()` → the selected hero's legal actions for the slot in hand ({ hero, list }), or null.
 * - `context()` → menuContext's whole shape, instead of building one from shell.state, `battle()`
 *   and `actions()`.
 * - `lines(seq)` → a Log line, for Log lines' menus (the mounted Log's by default).
 * - `placeLabel(id)` → the shell's name for a place, for openHit.
 * → { dispose(), refresh(), open(target, at, { source, battle, within }), openHit(info, { within }),
 * close(), isOpen() }. `at` is in the window's CSS px, or relative to `within` (an element or a
 * { left, top } rect) when that's given. The engine's onContextMenu(info) gives canvas-relative
 * px, so the shell calls openHit(info), which reads its target with targetOfHit and places it
 * relative to canvas#world.
 */
export function mount(shell, options = {}) {
  try {
    const doc = globalThis.document;
    const root = doc?.getElementById?.('context-menu');
    if (!shell || !root) return NOOP;
    const opts = isRecord(options) ? options : {};
    let current = null; // { target, options, ctx, source, battle, opener, pop }
    const ask = (fn, label) => {
      try { return typeof fn === 'function' ? fn() ?? null : null; } catch (err) { console.error(`[MILO] menu ${label}`, err); return null; }
    };
    const battleNow = () => ask(opts.battle, 'battle');
    const context = () => {
      try {
        if (typeof opts.context === 'function') return opts.context();
        const mode = doc.getElementById('stage')?.dataset?.mode;
        return menuContext({
          state: shell.state, content: shell.content?.(), combat: mode === 'combat', area: shell.area?.()?.area ?? null,
          battle: battleNow(), actions: ask(opts.actions, 'actions'),
        });
      } catch (err) {
        console.error('[MILO] menu context', err);
        return menuContext();
      }
    };
    const items = () => [...root.querySelectorAll('[data-action="menu-choose"]')];

    function close({ restore = true } = {}) {
      if (!current) return;
      const { opener, pop } = current;
      current = null;
      root.hidden = true;
      root.innerHTML = '';
      if (typeof pop === 'function') pop();
      if (restore && opener && typeof opener.focus === 'function' && opener.isConnected !== false) opener.focus({ preventScroll: true });
    }

    function choose(index) {
      if (!current) return;
      const item = current.options[index];
      if (!item || item.disabled) return;
      const { target, source, ctx } = current;
      // The battle as it is now, so a combatant's Examine reads what's true at the choice.
      const battle = current.battle || battleNow() || ctx?.battle || null;
      const combat = ctx?.combat === true;
      close({ restore: true });
      let done = false;
      try { done = typeof opts.choose === 'function' && opts.choose(item, target, { source, battle, combat }) === true; } catch (err) { console.error('[MILO] menu choose', err); }
      if (!done) runOption(shell, item, target, { source, battle, combat });
    }

    function keyHandler(event) {
      if (!current) return false;
      if (typing(doc) && !root.contains(doc.activeElement)) return false;
      const action = menuKey(event);
      if (!action) return false;
      event.preventDefault?.();
      const list = items();
      const index = list.indexOf(doc.activeElement);
      if (action === 'close') close();
      else if (action === 'choose') choose(index >= 0 ? index : 0);
      else list[stepIndex(action, index, list.length)]?.focus();
      return true;
    }

    function open(target, at = null, { source = null, battle = null, within = null } = {}) {
      try {
        close({ restore: false });
        const base = context();
        const ctx = battle && isRecord(base) ? { ...base, battle } : base;
        const list = optionsFor(target, ctx);
        if (!list.length) return false;
        const opener = source || doc.activeElement;
        // The role=menu is buildMenu's inner div (named by the title above it); the container
        // itself is plain, so its title and the greyed options' reasons sit outside the menu.
        root.innerHTML = buildMenu({ title: str(target?.label) || '', options: list });
        root.removeAttribute('role');
        root.removeAttribute('aria-labelledby');
        root.hidden = false;
        let point = Number.isFinite(at?.x) && Number.isFinite(at?.y) ? { x: at.x, y: at.y } : null;
        if (point && within) {
          // A point relative to an element (the canvas): add where that element sits in the window.
          const r = typeof within.getBoundingClientRect === 'function' ? within.getBoundingClientRect() : within;
          point = { x: point.x + (Number(r?.left) || 0), y: point.y + (Number(r?.top) || 0) };
        }
        if (!point && source && typeof source.getBoundingClientRect === 'function') {
          const r = source.getBoundingClientRect();
          point = { x: r.left, y: r.bottom };
        }
        const rect = typeof root.getBoundingClientRect === 'function' ? root.getBoundingClientRect() : { width: 200, height: 120 };
        const view = { width: globalThis.innerWidth || 1000, height: globalThis.innerHeight || 700 };
        const place = placeMenu(point, rect, view);
        root.style.left = `${place.left}px`;
        root.style.top = `${place.top}px`;
        const pop = shell.keys && typeof shell.keys.push === 'function' ? shell.keys.push(keyHandler) : null;
        current = { target, options: list, ctx, source, battle, opener, pop };
        items()[0]?.focus({ preventScroll: true });
        return true;
      } catch (err) {
        console.error('[MILO] menu open', err);
        close({ restore: false });
        return false;
      }
    }

    const onClick = (event) => {
      const button = event.target?.closest?.('[data-action="menu-choose"]');
      if (!button || !root.contains(button)) return;
      event.preventDefault?.();
      choose(Number(button.getAttribute('data-index')));
    };
    const onPointerDown = (event) => { if (current && !root.contains(event.target)) close({ restore: false }); };
    const onFocusOut = (event) => { if (current && event.relatedTarget && !root.contains(event.relatedTarget)) close({ restore: false }); };
    const sourceOf = (el) => el?.closest?.(MENU_SOURCES) || null;
    // A rift row's left click is its name's button (the row itself does nothing when clicked).
    const clickable = (el, target) => (target.kind === 'rift-row' ? el.closest?.('.rift-row')?.querySelector?.('.rift-name') || el : el);
    const lines = typeof opts.lines === 'function' ? opts.lines : lineOf;
    const onContextMenu = (event) => {
      const el = sourceOf(event.target);
      if (!el || root.contains(el)) return;
      const target = targetOfElement(el, { lines });
      if (!target) return;
      event.preventDefault?.();
      open(target, { x: event.clientX, y: event.clientY }, { source: clickable(el, target) });
    };
    const onKeyDown = (event) => {
      if (current || !opensMenu(event)) return;
      const el = sourceOf(doc.activeElement);
      if (!el) return;
      const target = targetOfElement(el, { lines });
      if (!target) return;
      event.preventDefault?.();
      open(target, null, { source: clickable(el, target) });
    };
    const onBlur = () => close({ restore: false });

    root.hidden = true;
    root.addEventListener('click', onClick);
    root.addEventListener('focusout', onFocusOut);
    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('contextmenu', onContextMenu);
    doc.addEventListener('keydown', onKeyDown);
    globalThis.addEventListener?.('blur', onBlur);
    return {
      dispose() {
        close({ restore: false });
        root.removeEventListener('click', onClick);
        root.removeEventListener('focusout', onFocusOut);
        doc.removeEventListener('pointerdown', onPointerDown, true);
        doc.removeEventListener('contextmenu', onContextMenu);
        doc.removeEventListener('keydown', onKeyDown);
        globalThis.removeEventListener?.('blur', onBlur);
      },
      refresh() { if (current) close({ restore: false }); },
      open,
      openHit(info, { within = null } = {}) {
        const target = targetOfHit(info, { placeLabel: opts.placeLabel });
        if (!target) return false;
        return open(target, { x: info.x, y: info.y }, { within: within || doc.getElementById('world') || null });
      },
      close: () => close(),
      isOpen: () => Boolean(current),
    };
  } catch (err) {
    console.error('[MILO] menus mount', err);
    return NOOP;
  }
}
