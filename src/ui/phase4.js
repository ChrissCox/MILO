// Phase 4's wiring (CONTRACT-PHASE4.md §12.2 and §12.4 "L2"): the shell object the Phase 4 modules
// mount against, its event bus, key stack and panel registry, and the setup that loads the modules
// the content bundle can run (content4.phase4Problem) and mounts them. app.js hands this file
// closures over its own state and stays small; nothing here imports app.js, model.js, hearth.js or
// rifts.js (CONTRACT-PHASE4.md §2), so a broken Phase 4 file never closes the vale.
//
//   const phase4 = await setupPhase4({ bundle, getState, setState, clockNow, ... });
//   phase4.passes        → runRiftLoop's `phase4` option (Embers, life XP, stitches)
//   phase4.panels        → { title(id), render(id), exists(id), action(button) } for app.js's panels
//   phase4.doors         → { stepThrough, goDeeper, enterCave, challenge, resume, onStep, ... }
//   phase4.onCombatHover / onCombatCommand / onSceneStep → the world's callbacks
//   phase4.emit(event, payload) · phase4.dispose()

const NOOP = Object.freeze({ dispose() {} });
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** A capture-phase key stack: the top handler sees a key first and returns true to consume it. */
export function createKeyStack(doc) {
  const stack = [];
  const onKey = (event) => {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      let used = false;
      try { used = stack[i](event) === true; } catch (error) { console.error('[MILO] a key handler', error); }
      if (used) { event.stopPropagation?.(); return; }
    }
  };
  doc?.addEventListener?.('keydown', onKey, true);
  return {
    push(handler) {
      if (typeof handler !== 'function') return () => {};
      stack.push(handler);
      return () => { const at = stack.lastIndexOf(handler); if (at >= 0) stack.splice(at, 1); };
    },
    get size() { return stack.length; },
    dispose() { doc?.removeEventListener?.('keydown', onKey, true); stack.length = 0; },
  };
}

/** The shell's events: 'state' | 'snapshot' | 'area' | 'second' | 'kindle' | 'combat' | 'hud'. */
export function createBus() {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (typeof fn !== 'function') return () => {};
      let set = listeners.get(event);
      if (!set) { set = new Set(); listeners.set(event, set); }
      set.add(fn);
      return () => set.delete(fn);
    },
    emit(event, payload) {
      for (const fn of [...(listeners.get(event) || [])]) {
        try { fn(payload); } catch (error) { console.error(`[MILO] a ${event} listener`, error); }
      }
    },
  };
}

/**
 * Panels the Phase 4 modules register (`registerPanel(prefix, { title, render, exists, action })`).
 * A prefix ending in ':' matches ids that start with it; any other matches itself and 'prefix:…'.
 * app.js consults it before its own switches.
 */
export function createPanelRegistry() {
  const entries = [];
  const match = (id) => {
    if (typeof id !== 'string') return null;
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const { prefix } = entries[i];
      if (id === prefix || (prefix.endsWith(':') ? id.startsWith(prefix) : id.startsWith(`${prefix}:`))) return entries[i].spec;
    }
    return null;
  };
  const call = (fn, fallback) => { try { return fn(); } catch (error) { console.error('[MILO] a panel', error); return fallback; } };
  return {
    register(prefix, spec) {
      if (typeof prefix !== 'string' || !isRecord(spec)) return () => {};
      const entry = { prefix, spec };
      entries.push(entry);
      return () => { const at = entries.indexOf(entry); if (at >= 0) entries.splice(at, 1); };
    },
    title: (id) => { const spec = match(id); return spec && typeof spec.title === 'function' ? call(() => spec.title(id), '') : ''; },
    render: (id) => { const spec = match(id); return spec && typeof spec.render === 'function' ? call(() => spec.render(id), '') : null; },
    exists: (id) => { const spec = match(id); return Boolean(spec) && (typeof spec.exists !== 'function' || call(() => spec.exists(id), false)); },
    action: (button, id) => { const spec = match(id); return spec && typeof spec.action === 'function' ? call(() => spec.action(button, id) === true, false) : false; },
    has: (id) => Boolean(match(id)),
  };
}

async function load(path) {
  try {
    return await import(path);
  } catch (error) {
    console.warn(`[MILO] ${path} is not available yet: ${error.message}`);
    return null;
  }
}

/**
 * Loads and mounts Phase 4. `env` is app.js's closures:
 *   bundle, getState(), setState(next, saveDelay), clockNow(), motionOn(), getSnapshot(), getArea(),
 *   worldCall(name, ...args), queueBubble(message), openPanel(id, opts), closePanel(), refreshPanel(opts),
 *   travel(target), leaveElsewhere(opts), openMap(), esc, bridge, setInset(name, rect),
 *   riftgen(), worldgen(), wilds(), wardRadius(), walkable(), sneaking(), where(), atCamp(), placeLabel(id)
 * → the handle above, or null when the bundle can't run Phase 4 at all.
 */
export async function setupPhase4(env) {
  const doc = globalThis.document;
  const bundle = env.bundle;
  // The Riddle Note trails: declared first, because a Kindle step at start-up can reach trailEvent.
  const trails = bundle?.trails || null;
  const content4 = await load('../content4.js');
  if (!content4 || !isRecord(bundle)) return null;
  const problem = content4.phase4Problem(bundle);
  for (const [area, why] of Object.entries(problem || {})) if (why) console.warn(`[MILO] Phase 4’s ${area} stays closed: ${why}.`);
  const groundwork = !problem?.groundwork;
  const fights = !problem?.combat && !problem?.party;
  if (!groundwork && !fights) return null;

  const [state4, embers, lifeskills, party, fightMod, expeditionMod, hudMod, frontier, trailMod, skyMod, fieldMod, campMod, worldgenMod, questMod, peopleMod, blossomMod, errandMod, actsMod, folkMod, settlementMod, welcomeMod, sheetsMod, campsMod] = await Promise.all([
    load('../state4.js'), load('../embers.js'), load('../lifeskills.js'), load('../party.js'),
    load('./fight.js'), load('./expedition.js'), load('./combat-hud.js'), load('./frontier.js'),
    load('../world/trail.js'), load('../sky.js'), load('../world/fieldboss.js'), load('../camp.js'), load('../world/worldgen.js'), load('../quests.js'), load('../people.js'), load('../world/blossoms.js'), load('../errands.js'), load('../acts.js'), load('../world/folk.js'), load('../world/settlement.js'), load('../welcome.js'), load('../sheets.js'), load('../world/camps.js'),
  ]);

  const bus = createBus();
  let sneakOn = false;
  const keys = createKeyStack(doc);
  const registry = createPanelRegistry();
  const stage = doc?.getElementById?.('stage') || null;
  const lines = [];
  const statusLines = new Map();
  const offs = [];
  const handles = [];

  const shell = {
    get state() { return env.getState(); },
    set(next, { save = 150 } = {}) {
      if (!isRecord(next) || next === env.getState()) return false;
      env.setState(next, save);
      bus.emit('state', next);
      return true;
    },
    now: () => env.clockNow(),
    motion: () => env.motionOn(),
    content: () => bundle,
    snapshot: () => env.getSnapshot(),
    area: () => env.getArea(),
    phase4: problem,
    // Sneak is the HUD's toggle; the doors read it back from here.
    world: (name, ...args) => { if (name === 'setSneak') sneakOn = Boolean(args[0]); return env.worldCall(name, ...args); },
    bubble: (message) => env.queueBubble(message),
    // One sink for the Log; the Log module replaces it once mounted. Until then lines wait here.
    log: (entry) => { lines.push(entry); if (lines.length > 200) lines.shift(); },
    openPanel: (id, opts) => env.openPanel(id, opts),
    closePanel: () => env.closePanel(),
    refreshPanel: (opts) => env.refreshPanel(opts),
    registerPanel: (prefix, spec) => registry.register(prefix, spec),
    on: (event, fn) => bus.on(event, fn),
    emit: (event, payload) => emit(event, payload),
    keys: { push: (handler) => keys.push(handler) },
    insets: (name, rect) => env.setInset?.(name, rect),
    esc: env.esc,
    miloSays: (text) => env.queueBubble({ kind: 'note', title: 'Milo', lines: [String(text)], duration: 6000, actions: [{ id: 'later', label: 'Okay' }] }),
    travel: (target) => env.travel(target),
    leaveElsewhere: (opts) => env.leaveElsewhere(opts),
    openMap: () => env.openMap?.(),
    feature(featureId) {
      if (state4?.markFeature) {
        const next = state4.markFeature(env.getState(), featureId, env.clockNow());
        if (next !== env.getState()) shell.set(next, { save: 400 });
      }
      trailEvent({ kind: 'feature', target: featureId });
    },
    // Something happened in the world that a trail or an errand may be waiting on: { kind, target }.
    did(event) {
      trailEvent(event);
      errandHappened(event);
    },
    // A line for the title bar from one source ('kindle'); app.js shows it first.
    status(source, text) {
      if (text) statusLines.set(source, String(text)); else statusLines.delete(source);
      env.statusChanged?.();
    },
    bridge: {
      notebooks: env.bridge?.notebooks ?? null,
      alarm: env.bridge?.alarm ?? null,
      notify: env.bridge?.notify ?? null,
      commissions: env.bridge?.commissions ?? null,
    },
    settings: {
      get: (key) => env.getState()?.settings?.[key],
      set: (key, value) => {
        const state = env.getState();
        shell.set({ ...state, settings: { ...(state.settings || {}), [key]: value } }, { save: 150 });
      },
    },
  };

  function emit(event, payload) {
    // A fight on screen is a mode of the stage: it folds the minimap and the side tabs.
    if (event === 'combat' && stage) {
      if (payload?.live) stage.dataset.mode = 'combat'; else stage.dataset.mode = 'explore';
    }
    bus.emit(event, payload);
  }
  if (stage) stage.dataset.mode = 'explore';

  // ---- the modules, by area ----
  const mount = (name, mod, options) => {
    try {
      if (!mod || typeof mod.mount !== 'function') return null;
      const handle = mod.mount(shell, options);
      if (handle) handles.push({ name, handle });
      return handle || null;
    } catch (error) {
      console.error(`[MILO] ${name} did not mount`, error);
      return null;
    }
  };
  const unhide = (id) => { const el = doc?.getElementById?.(id); if (el) el.hidden = false; };

  const names = {};
  const modules = [
    ['wallet', './wallet.js'], ['chronicle', './chronicle-view.js'], ['kindle', './kindle-view.js'], ['skills', './skills-view.js'],
    ['trail', './trail-view.js'], ['board', './board-view.js'], ['people', './people-view.js'], ['fire', './fire-view.js'], ['commissions', './commissions-view.js'], ['satchel', './satchel-view.js'], ['examine', './examine.js'], ['hud', './hud.js'], ['log', './log.js'],
    ['menus', './menus.js'], ['muster', './muster.js'], ['camp', './camp-view.js'], ['company', './company-view.js'],
    ['notebook', './notebook-view.js'], ['levelup', './levelup.js'], ['dialogue', './dialogue.js'],
  ];
  await Promise.all(modules.map(async ([key, path]) => { names[key] = await load(path); }));

  let logHandle = null;
  let commissionsHandle = null;
  let menusHandle = null;
  let combatHandle = null;
  let fight = null;
  let doors = null;

  if (groundwork) {
    mount('wallet', names.wallet);
    mount('chronicle', names.chronicle);
    mount('kindle', names.kindle);
    mount('skills', names.skills);
    mount('trail', names.trail);
    mount('board', names.board);
    mount('people', names.people);
    mount('fire', names.fire);
    commissionsHandle = mount('commissions', names.commissions);
    mount('satchel', names.satchel);
    mount('examine', names.examine);
    mount('hud', names.hud);
    logHandle = mount('log', names.log, { act: () => false });
    if (logHandle && typeof logHandle.add === 'function') {
      for (const entry of lines.splice(0)) logHandle.add(entry);
      shell.log = (entry) => logHandle.add(entry);
    }
    if (logHandle) unhide('log');
    if (handles.some((h) => h.name === 'hud')) unhide('hud');
  }

  if (fights) {
    combatHandle = mount('combat-hud', hudMod);
    mount('muster', names.muster, { where: () => env.where?.() || 'camp', destination: () => null });
    mount('camp', names.camp, { weather: () => null });
    mount('company', names.company, { atCamp: () => env.atCamp?.() !== false });
    mount('notebook', names.notebook, { atCamp: () => env.atCamp?.() !== false });
    mount('levelup', names.levelup);
    mount('dialogue', names.dialogue);
    if (fightMod?.createFight) {
      try {
        fight = fightMod.createFight(shell, {});
      } catch (error) {
        console.error('[MILO] the fight did not start up', error);
      }
    }
    if (fight && expeditionMod?.createExpedition) {
      try {
        doors = expeditionMod.createExpedition(shell, {
          fight,
          riftgen: () => env.riftgen?.() ?? null,
          worldgen: () => env.worldgen?.() ?? null,
          wilds: () => env.wilds?.() ?? null,
          wardRadius: () => env.wardRadius?.() ?? 0,
          walkable: () => env.walkable?.() ?? null,
          sneaking: () => sneakOn || Boolean(env.sneaking?.()),
        });
      } catch (error) {
        console.error('[MILO] the doors did not open', error);
      }
    }
    // The menus choose through the same functions a click does.
    menusHandle = mount('menus', names.menus, {
      choose: (option, target) => env.choose?.(option, target, { fight, doors, combatHud: combatHandle }) === true,
      battle: () => (fight?.live?.() ? fight.battle?.() ?? null : null),
      actions: () => (fight?.live?.() ? combatHandle?.actions?.() ?? null : null),
      placeLabel: (id) => env.placeLabel?.(id) ?? id,
    });
  } else if (groundwork) {
    menusHandle = mount('menus', names.menus, {
      choose: (option, target) => env.choose?.(option, target, {}) === true,
      placeLabel: (id) => env.placeLabel?.(id) ?? id,
    });
  }

  doc?.documentElement?.classList.add('phase4');

  // ---- the Riddle Note trail and the Last Bridge ----
  // The Last Bridge is found once the world's worldgen stands (it isn't made before that).
  let bridgeMade = null;
  const getBridge = () => {
    if (bridgeMade) return bridgeMade;
    try { bridgeMade = trailMod?.lastBridge?.(env.worldgen?.()) ?? null; } catch (error) { console.error(error); }
    return bridgeMade;
  };

  function noteBubble(view, title) {
    const step = view?.step;
    if (!step) return;
    env.queueBubble({ kind: 'loot', title, lines: (step.riddle || []).slice(0, 2), duration: 14000, place: 'trail', actions: [{ id: 'show', label: 'Read it' }, { id: 'later', label: 'Later' }] });
  }
  function trailEvent(event) {
    if (!trailMod?.stepDone || !trails) return;
    try {
      const before = env.getState();
      const next = trailMod.stepDone(before, trails, event, env.clockNow());
      if (next === before) return;
      shell.set(next, { save: 400 });
      const view = trailMod.trailView(next, trails, env.clockNow());
      if (view.done) env.queueBubble({ kind: 'loot', title: 'The bridge that hums', lines: ['Someone very polite is waiting at its end.'], duration: 10000, actions: [{ id: 'later', label: 'Okay' }] });
      else noteBubble(view, 'Riddle solved');
    } catch (error) { console.error('[MILO] the trail', error); }
  }
  // A wild chest opened: the first one after the Prologue's crack holds the first Riddle Note.
  function onChest() {
    if (!trailMod?.handOut || !trails) return;
    try {
      const before = env.getState();
      const given = trailMod.handOut(before, trails, 'chest', env.clockNow());
      if (!given || given.state === before) return;
      shell.set(given.state, { save: 400 });
      noteBubble(trailMod.trailView(given.state, trails, env.clockNow()), 'A Riddle Note');
    } catch (error) { console.error('[MILO] a Riddle Note', error); }
  }
  // The Last Bridge or the Tollkeeper, clicked: his riddles once the trail is solved, else a look.
  // ---- the folk of the hamlets near Milo: the world's set pieces ----
  let folkKey = '';
  let folkWhen = '';
  let folkNow = [];
  let hamletsNow = [];
  let campsNow = []; // the camps beside lit lanterns near Milo (camps.js)
  // A hamlet's other buildings (settlement.js), as the wilds laid them out round its tile.
  function partsOf(hamlet) {
    try {
      const wilds = env.wilds?.();
      if (!wilds || typeof wilds.objectsIn !== 'function' || !Number.isInteger(hamlet?.x) || !Number.isInteger(hamlet?.y)) return [];
      return wilds.objectsIn(hamlet.x - 9, hamlet.y - 9, hamlet.x + 9, hamlet.y + 9).filter((o) => o.place === hamlet.id && typeof o.part === 'string');
    } catch { return []; }
  }
  const weatherNow = () => { try { return skyMod?.skyAt ? skyMod.skyAt(env.clockNow(), { seed: env.getState()?.wilds?.seed || 'hushlands', sky: bundle.sky ?? null })?.weather?.kind ?? null : null; } catch { return null; } };
  const welcomeOf = (hamlet) => { try { return welcomeMod?.welcomeAt ? welcomeMod.welcomeAt(env.getState(), hamlet, env.clockNow()) : 'plain'; } catch { return 'plain'; } };
  function nearFolk() {
    try {
      const words = bundle.people?.folk;
      if (!folkMod?.folkFor || !words || env.getArea?.()?.area === 'elsewhere') return folkNow;
      const wilds = env.wilds?.();
      const tile = env.worldCall('miloTile');
      if (!wilds || typeof wilds.entitiesIn !== 'function' || !tile || !Number.isFinite(tile.x)) return folkNow;
      const cx = Math.floor(tile.x / 32);
      const cy = Math.floor(tile.y / 32);
      const key = `${cx},${cy}`;
      // The folk keep a day: who is out depends on the hour and the rain.
      const part = sheetsMod?.partOfDay ? sheetsMod.partOfDay(env.clockNow()) : 'day';
      const rain = weatherNow() === 'rain';
      const saved = env.getState();
      const lit = isRecord(saved?.wilds?.lanterns) ? saved.wilds.lanterns : {};
      const when = `${part}|${rain}|${Object.keys(lit).length}|${JSON.stringify(saved?.camplife?.places ?? null)}|${Math.floor(env.clockNow() / 3600000)}`;
      if (key === folkKey && when === folkWhen) return folkNow;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) wilds.chunk?.(cx + dx, cy + dy);
      const around = wilds.entitiesIn({ x: (cx - 1) * 32, y: (cy - 1) * 32, w: 96, h: 96 }, { tier: 1, lit: [], opened: [], notes: [], glimmers: [], felled: [], day: 0 });
      const hamlets = around.filter((e) => (e.poiType ?? e.type) === 'hamlet');
      const walkable = env.walkable?.();
      // Folk stand beside the road, never on it: 16 and 20 are worldgen's road and bridge.
      const onRoad = (x, y) => { const t = wilds.terrainAt?.(x, y); return t === 16 || t === 20; };
      const free = (x, y) => (typeof walkable === 'function' ? walkable(x, y) === true && !onRoad(x, y) : false);
      hamletsNow = hamlets.map((h) => ({ id: h.id, x: h.x, y: h.y }));
      folkNow = hamlets.flatMap((h) => folkMod.folkFor(h, words, { free, parts: partsOf(h), part, rain }).map((p) => ({ ...p, hamlet: { id: h.id, x: h.x, y: h.y } })));
      // New places follow the light: a camp beside each lantern lit two days ago or more, a hamlet once Milo keeps coming by.
      campsNow = [];
      if (campsMod?.campFor && welcomeMod?.visitsTo) {
        for (const l of around.filter((e) => e.kind === 'lantern' && lit[e.id])) {
          const camp = campsMod.campFor(l, { litAt: lit[l.id], visits: welcomeMod.visitsTo(saved, campsMod.campId(l.id)), now: env.clockNow(), free: (x, y) => free(x, y) && !(x === l.x && y === l.y) });
          if (!camp) continue;
          campsNow.push(camp);
          hamletsNow.push({ id: camp.id, x: camp.x, y: camp.y });
          const under = new Set(camp.parts.flatMap((p) => { const t = []; for (let y = p.y; y < p.y + p.h; y += 1) for (let x = p.x; x < p.x + p.w; x += 1) t.push(`${x},${y}`); return t; }));
          const open = (x, y) => free(x, y) && !under.has(`${x},${y}`) && !(x === l.x && y === l.y);
          folkNow.push(...folkMod.folkFor({ id: camp.id, x: camp.x, y: camp.y }, words, { free: open, parts: camp.parts, part, rain, age: 'new', limit: camp.stage === 'camp' ? 2 : null })
            .map((p) => ({ ...p, hamlet: { id: camp.id, x: camp.x, y: camp.y } })));
        }
      }
      folkKey = key;
      folkWhen = when;
    } catch (error) { console.error('[MILO] the folk', error); }
    return folkNow;
  }
  function folkSays(id) {
    const p = folkNow.find((f) => f.id === id);
    if (!p) return false;
    const line = folkMod.folkLine(p, Math.floor(env.clockNow() / 86400000), welcomeOf(p.hamlet));
    if (line) env.queueBubble({ kind: 'note', title: `${p.name}, who ${p.title}`, lines: [line], duration: 9000 });
    return true;
  }
  // Milo is at a hamlet when he stands within a few tiles of its own tile: counted once a day.
  function visitHamlets(step) {
    try {
      if (!welcomeMod?.visitPlace) return;
      for (const h of hamletsNow) {
        if (Math.max(Math.abs(step.x - h.x), Math.abs(step.y - h.y)) > welcomeMod.VISIT_REACH) continue;
        const next = welcomeMod.visitPlace(env.getState(), h.id, env.clockNow());
        if (next !== env.getState()) shell.set(next, { save: 600 });
      }
    } catch (error) { console.error('[MILO] a visit', error); }
  }
  // A bed at a hamlet: the company's Campfire, as at a lit lantern (once a real day away from home).
  function restAtHamlet() {
    try {
      if (!party?.campfire) return { ok: false, lines: [] };
      const r = party.campfire(env.getState(), env.clockNow(), { where: 'lantern' });
      if (r.ok) { shell.set(r.state, { save: 300 }); return { ok: true, lines: ['Milo sleeps in the spare bed. The company’s ready again.'] }; }
      return { ok: false, lines: [r.reason || 'Not just now.'] };
    } catch (error) { console.error('[MILO] a rest', error); return { ok: false, lines: [] }; }
  }

  function landmarkClick(entity) {
    try {
      const mark = String(entity?.id || '').replace(/^landmark:/, '');
      if (/^folk-/.test(mark)) { folkSays(mark); return true; }
      if (/^camp:/.test(mark)) {
        const camp = campsNow.find((c) => mark.startsWith(`${c.id}#`));
        if (camp) {
          const words = campsMod.campWords(camp);
          const more = [settlementMod?.partsLine && camp.stage === 'hamlet' ? settlementMod.partsLine(camp.parts.filter((p) => p.part !== 'home').concat(camp.parts.filter((p) => p.part === 'home').slice(1))) : '', welcomeMod?.welcomeLine ? welcomeMod.welcomeLine(welcomeOf(camp)) : ''].filter(Boolean);
          env.queueBubble({ kind: 'note', title: words.title, lines: [...words.lines, ...more], duration: 9000 });
        }
        return true;
      }
      if (entity?.landmark === 'npc' || /^landmark:npc-/.test(String(entity?.id || ''))) {
        const pid = String(entity.id).replace(/^landmark:npc-/, '');
        if (/^[a-z][a-z0-9-]{1,39}$/.test(pid)) { env.openPanel(`person:${pid}`); return true; }
      }
      if (entity?.id === 'landmark:tollkeeper' && trailMod?.trailView && trails) {
        if (trailMod.trailView(env.getState(), trails, env.clockNow()).atBridge) { env.openPanel('talk:tollkeeper-riddles'); return true; }
      }
      names.examine?.examineEntity?.(shell, entity);
    } catch (error) { console.error(error); }
    return true;
  }

  // ---- the world, kept in step with the state: sky, landmarks, followers and the camp ----
  let lastJoined = null;
  let lastLandSig = '';
  let lastBlossoms = -1;
  let lastVisit = null;
  // Going out by a gate lands Milo a few tiles beyond it, so a gate is visited within four of its edge.
  const nearGate = (step) => {
    for (const [id, gate] of Object.entries(worldgenMod?.GATES || {})) {
      if (Math.max(Math.abs(step.x - gate.edge.x), Math.abs(step.y - gate.edge.y)) <= 4) return id;
    }
    return null;
  };
  let lastSky = '';
  let lastSig = '';
  function syncWorld(force = false) {
    try {
      const state = env.getState();
      const now = env.clockNow();
      const joined = Boolean(state?.party?.roster?.tollkeeper);
      const bridge = getBridge();
      // The Last Bridge, the Tollkeeper, and the people standing out in the world (those not yet at camp).
      const standing = peopleMod?.standing ? peopleMod.standing(state, bundle) : [];
      const folk = nearFolk();
      const landSig = `${joined}|${bridge ? 1 : 0}|${standing.map((p) => p.id).join(',')}|${folk.map((p) => `${p.id}@${p.x},${p.y}`).join(',')}|${campsNow.map((c) => `${c.id}:${c.stage}:${c.parts.length}`).join(',')}`;
      if (force || landSig !== lastLandSig) {
        lastLandSig = landSig;
        lastJoined = joined;
        env.worldCall('setLandmarks', [
          ...(bridge && trailMod?.bridgeLandmarks ? trailMod.bridgeLandmarks(bridge, { joined }) : []),
          ...standing.map((p) => ({ id: `landmark:npc-${p.id}`, kind: 'npc', x: p.x, y: p.y, label: p.name, look: { who: p.id } })),
          ...folk.map((p) => ({ id: `landmark:${p.id}`, kind: 'npc', x: p.x, y: p.y, label: `${p.name}, who ${p.title}`, look: { who: p.look.who } })),
          ...campsNow.flatMap((c) => c.parts.map((p) => ({ id: `landmark:${c.id}#${p.id}`, kind: 'prop', sprite: p.kind, x: p.x, y: p.y, w: p.w, h: p.h, label: campsMod.campWords(c).title }))),
        ]);
      }
      // The Blossomfield: a flower for every quest finished.
      const finished = (state?.board?.quests || []).filter((q) => q?.status === 'done').length;
      if (blossomMod?.blossomsFor && (force || finished !== lastBlossoms)) {
        lastBlossoms = finished;
        env.worldCall('setBlossoms', blossomMod.blossomsFor(finished));
      }
      if (skyMod?.skyAt && bundle.sky) {
        const sky = skyMod.skyAt(now, { seed: state?.wilds?.seed || 'hushlands', sky: bundle.sky });
        if (sky && sky.key !== lastSky) { lastSky = sky.key; env.worldCall('setSky', sky); }
      }
      if (!party?.heroSpec || !campMod?.campDay) return;
      const combat = expeditionMod?.combatOf?.(bundle) ?? null;
      const rules = combat?.rules ?? null;
      if (!rules) return;
      const area = env.getArea?.()?.area || 'vale';
      const day = campMod.campDay(state, now, { content: bundle, snapshot: env.getSnapshot?.() ?? null });
      const sig = JSON.stringify([state?.party?.chosen, Object.keys(state?.party?.roster || {}), (state?.party?.regulars || []).map((r) => r.id), state?.party?.formation, day.part, state?.expedition?.inside === true, area === 'vale', day.places.map((p) => p.where + p.pose), (peopleMod?.residents?.(state, bundle) || []).map((r) => r.id)]);
      if (!force && sig === lastSig) return;
      lastSig = sig;
      const specOf = (id) => party.heroSpec(state, id, { content: bundle, rules, abilities: combat.abilities, snapshot: env.getSnapshot?.() ?? null, now });
      // Out in the wilds or an Elsewhere, whoever was chosen follows Milo; in the vale they're at camp.
      const chosen = Array.isArray(state?.party?.chosen) ? state.party.chosen : [];
      const followers = area === 'vale' ? [] : chosen.map(specOf).filter(Boolean).map((s) => ({ id: s.id, look: s.look, name: s.name }));
      env.worldCall('setParty', followers);
      env.worldCall('setFormation', state?.party?.formation || 'line');
      // At camp: the regulars and anyone not already on the crew's seats sit by the fire.
      const crewIds = new Set(['claude', 'codex', 'jev']);
      let seat = 0;
      const members = [];
      for (const p of day.places) {
        if (crewIds.has(p.id) || (p.where !== 'fire' && p.where !== 'bedroll')) continue;
        const spec = specOf(p.id);
        if (!spec) continue;
        members.push({ id: p.id, look: spec.look, seat, pose: p.pose, bubble: false });
        seat += 1;
      }
      // The people who came to camp sit by the fire too, and sleep when the camp does.
      const pose = day.part === 'asleep' ? 'sleep' : day.part === 'evening' || day.part === 'night' ? 'talk' : 'sit';
      for (const r of peopleMod?.residents?.(state, bundle) || []) {
        if (seat >= 8) break;
        // Someone who has joined the company already has a seat with them.
        if (state?.party?.roster?.[r.id]) continue;
        members.push({ id: r.id, look: r.look, seat, pose, bubble: false });
        seat += 1;
      }
      env.worldCall('setCamp', { night: ['evening', 'night', 'asleep'].includes(day.part), members, props: [] });
    } catch (error) { console.error('[MILO] the world’s sync', error); }
  }
  // ---- the company grows (PLAN.md Phase 6): a companion who came to camp and can fight joins the roster ----
  let lastResidents = '';
  function joinResidents() {
    try {
      if (!party?.recruit || !peopleMod?.residents) return;
      const state = env.getState();
      const here = peopleMod.residents(state, bundle).map((r) => r.id);
      const sig = here.join(',');
      if (sig === lastResidents) return;
      lastResidents = sig;
      let next = state;
      for (const id of here) next = party.recruit(next, id, env.clockNow(), { content: bundle });
      if (next !== state) {
        shell.set(next, { save: 300 });
        for (const id of here) if (!state?.party?.roster?.[id] && next.party?.roster?.[id]) shell.log?.({ tab: 'milo', text: `${peopleMod.personOf(bundle, id)?.name?.split(' ')[0] || id} joined the company.`, at: env.clockNow(), detail: null, action: null });
      }
    } catch (error) { console.error('[MILO] joining', error); }
  }

  // ---- errands: a step that waits on a visit or on the fire is marked when it happens ----
  function errandHappened(event) {
    try {
      if (!errandMod?.errandEvent) return;
      const before = env.getState();
      const now = env.clockNow();
      const next = errandMod.errandEvent(before, bundle, event, now);
      if (next === before) return;
      shell.set(next, { save: 400 });
      const was = new Map(errandMod.errandList(before, bundle, now).map((e) => [e.personId, e]));
      for (const e of errandMod.errandList(next, bundle, now)) {
        const step = e.steps.find((s) => s.done && !was.get(e.personId)?.steps[s.index]?.done);
        if (step) shell.log({ tab: 'world', text: `Done · ${step.text}`, at: now, detail: null, action: null });
      }
    } catch (error) { console.error('[MILO] an errand', error); }
  }

  // ---- Act I: a chapter that came true is kept, and Milo says so ----
  function settleActs() {
    try {
      if (!actsMod?.settleAct) return;
      const now = env.clockNow();
      const r = actsMod.settleAct(env.getState(), bundle.story ?? null, now);
      if (!r.completed.length) return;
      shell.set(r.state, { save: 400 });
      const status = actsMod.actStatus(r.state, bundle.story ?? null);
      const titles = r.completed.map((id) => status.chapters.find((c) => c.id === id)?.title).filter(Boolean);
      const next = status.chapters.find((c) => c.current);
      env.queueBubble({
        kind: 'story', title: 'Act I moves on',
        lines: [`${titles.map((t) => `“${t}”`).join(' and ')} ${titles.length > 1 ? 'are' : 'is'} done.`, next ? `Next: ${next.hint}` : 'That’s the whole of Act I so far.'],
        place: 'story', duration: 10000, actions: [{ id: 'show', label: 'Show me' }, { id: 'later', label: 'Later' }],
      });
    } catch (error) { console.error('[MILO] Act I', error); }
  }
  offs.push(bus.on('state', () => settleActs()));
  offs.push(bus.on('state', () => joinResidents()));
  setTimeout(settleActs, 0);

  offs.push(bus.on('state', () => syncWorld()));
  offs.push(bus.on('area', () => { sneakOn = false; syncWorld(true); }));
  setTimeout(() => syncWorld(true), 0);

  // ---- what the panels and doors ask of Phase 4 ----
  const fieldBoss = (rift) => {
    try {
      const combat = expeditionMod?.combatOf?.(bundle);
      return Boolean(fieldMod?.isFieldBoss && combat && rift && fieldMod.isFieldBoss(rift, { leads: combat.leads ?? bundle.combat?.leads, rules: combat.rules }));
    } catch { return false; }
  };
  // A rift's price tags for its panel's buttons.
  const costsFor = (rift) => {
    try {
      const kind = rift?.kind === 'real' ? 'real' : rift?.kind === 'story' ? 'story' : 'wild';
      const out = { step: embers?.entryCost?.(kind, { depth: rift?.spec?.depth || 1, economy: bundle.economy }) ?? 0 };
      if (fieldBoss(rift)) out.challenge = embers?.entryCost?.('field', { economy: bundle.economy }) ?? 0;
      out.deeper = embers?.entryCost?.('wild', { depth: (rift?.spec?.depth || 1) + 1, economy: bundle.economy }) ?? 0;
      return out;
    } catch { return {}; }
  };

  // ---- the rift loop's Phase 4 passes (Embers, life XP, stitches) ----
  const passes = frontier?.phase4Passes
    ? frontier.phase4Passes({ state4, embers, lifeskills, party, expedition: expeditionMod }, {
      problem,
      content: bundle,
      rules: expeditionMod?.combatOf?.(bundle)?.rules ?? null,
    })
    : null;

  // ---- a gentle word about quests that have waited a while: once a day at most, never mid-fight ----
  function nudgeQuests() {
    try {
      const now = env.clockNow();
      if (!questMod?.shouldNudge || fight?.live?.() || !questMod.shouldNudge(env.getState(), now)) return;
      const n = questMod.staleQuests(env.getState(), now).length;
      shell.set(questMod.markNudged(env.getState(), now), { save: 400 });
      env.queueBubble({
        kind: 'note', title: n === 1 ? 'A quest has waited a while' : `${n} quests have waited a while`, lines: [], duration: 12000,
        place: 'townhall', actions: [{ id: 'show', label: 'Look' }, { id: 'later', label: 'Later' }],
      });
    } catch (error) { console.error('[MILO] the quest nudge', error); }
  }
  const nudgeTimer = setTimeout(nudgeQuests, 20000);
  let nudgeTicks = 0;
  offs.push(bus.on('second', () => { nudgeTicks += 1; if (nudgeTicks % 600 === 0) nudgeQuests(); }));

  // ---- a second's tick, while the window is visible ----
  const tick = setInterval(() => {
    if (doc?.visibilityState !== 'visible') return;
    emit('second', { now: env.clockNow() });
  }, 1000);

  return {
    shell,
    problem,
    passes,
    doors,
    fight,
    combatHud: combatHandle,
    menus: menusHandle,
    panels: {
      title: (id) => registry.title(id),
      render: (id) => registry.render(id),
      exists: (id) => registry.exists(id),
      action: (button, id) => registry.action(button, id),
      has: (id) => registry.has(id),
    },
    statusLine: () => statusLines.get('kindle') || null,
    onChest,
    // The named people who live inside the vale (Nan at her field, Hob at the tower), for the vale's Places list.
    valePeople: () => {
      try {
        const inHeart = env.worldgen?.()?.inHeart;
        if (typeof inHeart !== 'function' || !peopleMod?.standing) return [];
        return peopleMod.standing(env.getState(), bundle).filter((p) => inHeart(p.x, p.y)).map((p) => ({ id: `landmark:npc-${p.id}`, title: p.name, note: p.title }));
      } catch { return []; }
    },
    hamletAge: (poi) => { try { return folkMod?.ageLine ? folkMod.ageLine(poi, bundle.people?.folk) : ''; } catch { return ''; } },
    camps: () => campsNow.map((c) => ({ id: c.id, stage: c.stage, parts: c.parts.map((p) => p.part) })),
    // A building's own panel asks for a draft to take it to its next level.
    commissionFor: (plotId) => { try { return commissionsHandle?.draftFor?.(plotId) === true; } catch { return false; } },
    hamletWelcome: (poi) => { try { return welcomeMod?.welcomeLine ? welcomeMod.welcomeLine(welcomeOf(poi)) : ''; } catch { return ''; } },
    restAtHamlet,
    hamletParts: (poi) => { try { const parts = partsOf(poi); return parts.length && settlementMod?.partsLine ? settlementMod.partsLine(parts) : ''; } catch { return ''; } },
    actStatus: () => { try { return actsMod?.actStatus ? actsMod.actStatus(env.getState(), bundle.story ?? null) : null; } catch { return null; } },
    landmarkClick,
    isFieldBoss: fieldBoss,
    costsFor,
    suggestedLevel: (rift) => { try { return expeditionMod?.suggestedLevel?.(rift, env.getState(), { content: bundle })?.words ?? null; } catch { return null; } },
    // A wild stitch pays Road XP and Seamcraft once; the gentlest stray may ask to stay.
    payStitch(rift) {
      try {
        const r = expeditionMod.payWildStitch(env.getState(), rift, env.clockNow(), { content: bundle });
        if (r.state !== env.getState()) shell.set(r.state, { save: 150 });
        return r;
      } catch (error) { console.error(error); return { paid: false, xp: 0 }; }
    },
    invitation(rift) {
      try {
        const combat = expeditionMod?.combatOf?.(bundle);
        if (!combat || !party?.inviteRegular) return null;
        const r = party.inviteRegular(env.getState(), { rift }, env.clockNow(), { content: bundle, rules: combat.rules });
        if (!r.ok) return null;
        return {
          name: r.regular?.name || 'A stray',
          words: r.words,
          // Asked again at the moment of the yes, so what happened since (Embers, a fight) is kept.
          accept: () => {
            const again = party.inviteRegular(env.getState(), { rift }, env.clockNow(), { content: bundle, rules: combat.rules });
            if (!again.ok) return;
            shell.set(again.state, { save: 150 });
            env.queueBubble({ kind: 'loot', title: again.regular?.name || 'A new friend', lines: ['Pulls up a stump by the fire.'], duration: 6000, actions: [{ id: 'later', label: 'Okay' }] });
          },
        };
      } catch (error) { console.error(error); return null; }
    },
    // Paints the portrait canvases (Setting out, a companion's sheet, camp scenes) inside `root`.
    paintPortraits: (root) => { try { return names.dialogue?.paintPortraits?.(root, { genres: bundle.genres || null }) ?? 0; } catch (error) { console.error(error); return 0; } },
    emit,
    onSceneStep: (step) => {
      try {
        // A visit is Milo's own step (the followers' steps arrive here too).
        // A new chunk of the world may hold a hamlet, and its folk.
        if (step?.scene === 'world' && (step.who === 'milo' || !step.who) && `${Math.floor(step.x / 32)},${Math.floor(step.y / 32)}` !== folkKey) syncWorld();
        if (step?.scene === 'world' && (step.who === 'milo' || !step.who)) visitHamlets(step);
        if (step?.scene === 'world' && (step.who === 'milo' || !step.who) && trailMod?.placeAt) {
          const place = trailMod.placeAt({ x: step.x, y: step.y }, { bridge: getBridge() }) || nearGate(step);
          if (place && place !== lastVisit) { lastVisit = place; trailEvent({ kind: 'visit', target: place }); errandHappened({ kind: 'visit', target: place }); }
          else if (!place) lastVisit = null;
        }
        return doors?.onStep?.(step) ?? null;
      } catch (error) { console.error(error); return null; }
    },
    onCombatHover: (target) => { try { combatHandle?.hover?.(target); } catch (error) { console.error(error); } },
    onCombatCommand: (cmd) => { try { return combatHandle?.pointer?.(cmd); } catch (error) { console.error(error); return false; } },
    onContextMenu: (info) => { try { return menusHandle?.openHit?.(info); } catch (error) { console.error(error); return false; } },
    resume: () => (doors?.resume ? doors.resume() : Promise.resolve({ resumed: false })),
    dispose() {
      clearInterval(tick);
      clearTimeout(nudgeTimer);
      for (const off of offs) if (typeof off === 'function') off();
      for (const { handle } of handles) { try { handle.dispose?.(); } catch (error) { console.error(error); } }
      try { doors?.dispose?.(); } catch (error) { console.error(error); }
      keys.dispose();
    },
  };
}

export { NOOP };
