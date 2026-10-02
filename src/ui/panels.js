// HTML for the shell's Phase 3 panels (CONTRACT-PHASE3 §8): rifts, the watchtower's Rifts
// section, the War Table, the Hearth, lanterns, points of interest, the Prologue, the story
// tracker and the Elsewhere banner. Pure string builders: every value that could come from a
// session, content or the crew goes through esc(), and the shell sets the result as innerHTML.
// Runs in Node for tests.

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

// Glyphs drawn at exactly 2× their pixel grids, as in app.js.
export const CHECK = '<svg class="tick tick-check" viewBox="0 0 7 6" width="14" height="12" aria-hidden="true" shape-rendering="crispEdges"><path d="M6 0h1v2H6zM5 2h1v1H5zM4 3h1v1H4zM3 4h1v1H3zM2 5h1v1H2zM1 4h1v1H1zM0 3h1v1H0z"/></svg>';
export const LOCK = '<svg class="tick tick-lock" viewBox="0 0 7 7" width="14" height="14" aria-hidden="true" shape-rendering="crispEdges"><path d="M2 0h3v1H2zM1 1h1v2H1zM5 1h1v2H5zM0 3h7v4H0z"/></svg>';
export const DOT = '<svg class="tick tick-dot" viewBox="0 0 7 7" width="14" height="14" aria-hidden="true" shape-rendering="crispEdges"><path d="M2 1h3v1h1v3H5v1H2V5H1V2h1z"/></svg>';

const HEX = /^#[0-9a-f]{6}$/i;
const colour = (value, fallback = '#9cbfdc') => (typeof value === 'string' && HEX.test(value) ? value : fallback);
const plainSays = (text) => `<div class="milo-says"><p>${esc(text)}</p></div>`;
const attr = (name, value) => (value === null || value === undefined || value === '' ? '' : ` ${name}="${esc(value)}"`);
const key = (text) => String(text).replace(/[^a-z0-9-]/gi, '-');
// A name mid-sentence: 'Let the Portrait of “Letters” go?' (as frontier.midName).
const midName = (name) => String(name || '').replace(/^The /, 'the ');

export function genreChips(chips = []) {
  if (!chips.length) return '';
  return `<ul class="genre-chips">${chips.map((g) => `<li class="genre-chip" data-genre="${esc(g.id)}" style="--rim:${colour(g.rim)}"><i aria-hidden="true"></i>${esc(g.name)}</li>`).join('')}</ul>`;
}

// ---------------------------------------------------------------------------
// Rift rows (the watchtower's Rifts section and the War Table).

// Phase 4 (CONTRACT-PHASE4.md §12.4 "L"): Challenge, a field boss's only way into its fight, and
// the cave's door ('enter-cave', poiPanel's action from wildtext.poiView with phase4World).
export const ACTION_WORDS = Object.freeze({
  step: 'Step through', show: 'Show me on the map', visit: 'Visit', ward: 'Ward for 3 days', unward: 'Take the ward down',
  'let-go': 'Let go', 'let-be': 'Let it be', stitch: 'Stitch', deeper: 'Go deeper', leave: 'Leave', 'war-table': 'Open the War Table',
  challenge: 'Challenge', 'enter-cave': 'Go in',
});
const PRIMARY = new Set(['step', 'show', 'visit', 'stitch', 'deeper']);
export const actionWord = (id) => ACTION_WORDS[id] || id;

/** An action's words with what it costs in Embers: 'Challenge · 5 Embers', 'Go deeper · 6 Embers', 'Step through' at 0. */
export function costWord(id, cost) {
  const n = Number.isFinite(cost) ? Math.max(0, Math.floor(cost)) : 0;
  return n > 0 ? `${actionWord(id)} · ${n} ${n === 1 ? 'Ember' : 'Embers'}` : actionWord(id);
}

function letGoConfirm(row, scope) {
  const wild = row.kind === 'wild';
  const idKey = key(row.id);
  return `<div class="confirm" role="alertdialog" aria-labelledby="${scope}-confirm-${idKey}" aria-describedby="${scope}-confirm-body-${idKey}">`
    + `<p class="confirm-title" id="${scope}-confirm-${idKey}">Let ${esc(midName(row.name) || 'this rift')} go?</p>`
    + `<p class="confirm-body" id="${scope}-confirm-body-${idKey}">${wild ? 'It closes for today. Nothing is lost for leaving it.' : 'It closes, and stays closed until the real thing starts again. Nothing is lost for leaving it.'}</p>`
    + `<div class="ask-actions"><button type="button" class="px-btn" data-action="rift-let-go-confirm" data-rift-id="${esc(row.id)}" data-focus-key="letgo-yes-${esc(row.id)}">Let it go</button>`
    + `<button type="button" class="px-btn primary" data-action="rift-let-go-cancel" data-rift-id="${esc(row.id)}" data-focus-key="letgo-no-${esc(row.id)}">Keep it</button></div></div>`;
}

/**
 * One rift in a list. `row`: { id, key, kind, realKind, name, genres, cause, where, stage, stageId,
 * x, y, warded, held, bright, atWalls, actions } (actions from frontier.rowActions).
 */
export function riftRow(row, { confirming = null } = {}) {
  const first = row.genres?.[0];
  const placed = Number.isFinite(row.x) && Number.isFinite(row.y);
  let html = `<li class="rift-row" data-rift-id="${esc(row.id)}"${attr('data-rift-key', row.key)} data-rift-kind="${esc(row.kind)}"${attr('data-real-kind', row.realKind)}`
    + `${attr('data-genre', first?.id)} data-stage="${esc(row.stageId)}"${placed ? ` data-x="${row.x}" data-y="${row.y}"` : ''}`
    + ` data-warded="${row.warded ? 'true' : 'false'}" data-held="${row.held ? 'true' : 'false'}"${row.atWalls ? ' data-walls="true"' : ''}`
    + ` style="--rim:${colour(first?.rim)}">`;
  html += '<div class="rift-row-head">'
    + `<button type="button" class="rift-name" data-action="rift-open" data-rift-id="${esc(row.id)}" data-focus-key="open-${esc(row.id)}">${esc(row.name)}</button>`
    + `<span class="stage-tag" data-stage="${esc(row.stageId)}">${esc(row.stage)}</span></div>`;
  html += genreChips(row.genres || []);
  if (row.cause) html += `<p class="rift-cause">${esc(row.cause)}</p>`;
  if (row.where) html += `<p class="rift-meta">${esc(row.where)}</p>`;
  if (row.level) html += `<p class="rift-meta rift-level">${esc(row.level)}</p>`;
  if (confirming === row.id) html += letGoConfirm(row, 'row');
  else if (row.actions?.length) {
    html += `<div class="rift-row-actions">${row.actions.map((id) => `<button type="button" class="px-btn small" data-action="rift-${esc(id)}" data-rift-id="${esc(row.id)}" data-focus-key="${esc(id)}-${esc(row.id)}">${esc(actionWord(id))}</button>`).join('')}</div>`;
  }
  return `${html}</li>`;
}

/** A closed rift from the history: { id, name, genres, how, text }. */
export function closedRow(entry) {
  const first = entry.genres?.[0];
  return `<li class="rift-row closed" data-rift-id="${esc(entry.id)}" data-how="${esc(entry.how)}" style="--rim:${colour(first?.rim, '#c9c6b3')}">`
    + `<div class="rift-row-head"><span class="rift-name">${esc(entry.name || 'A rift')}</span><span class="stage-tag">${esc(entry.text)}</span></div>`
    + `${genreChips(entry.genres || [])}</li>`;
}

/** The watchtower's Rifts section, at every tier. */
export function riftSection(rows, { confirming = null } = {}) {
  let html = `<section class="group rift-group" data-group="rifts"><h3>Rifts <span class="count">${rows.length}</span></h3>`;
  if (!rows.length) return `${html}<p class="quiet-note">No rifts on the frontier. It’s quiet out there.</p></section>`;
  html += '<p class="group-note">Each one stands for something real, and seals itself once that’s done.</p>';
  return `${html}<ul class="rift-list">${rows.map((row) => riftRow(row, { confirming })).join('')}</ul></section>`;
}

// ---------------------------------------------------------------------------
// The rift panel.

// Where the Tale-lead is: waiting on the far side until the rift gapes, then out beside the tear.
const LEAD_WHERE = Object.freeze({
  waiting: 'Waiting in the farthest room of its Elsewhere. It steps out beside the tear if the rift gapes.',
  out: 'It has stepped out, and stands beside the tear.',
  inside: 'Waiting in the farthest room of this place.',
});

/**
 * view: { id, kind, realKind, name, genres, stage, stageId, kindWord, where, cause, stitch, mood,
 *   wardText, held: { name, text } | null, affixes, lead, loot, lootTaken, actions, confirming, says, artLabel, inside, busy }
 * An empty `stitch` leaves out "To mend it" (a rift stitched from inside has nothing left to mend);
 * `lootTaken`: its gifts are in the satchel already, so its loot reads as what it left.
 * Phase 4 (§12.4): `level` is the suggested-level line (expedition.suggestedLevel's words: "Runs at
 * level 5. Your company is level 3."), and `costs` ({ [actionId]: Embers }) adds each door's price to
 * its button ('Step through · 5 Embers', 'Challenge · 5 Embers').
 */
export function riftPanel(view, { miloSays = plainSays } = {}) {
  let html = `<div class="rift-view" data-rift-id="${esc(view.id)}" data-rift-kind="${esc(view.kind)}"${attr('data-real-kind', view.realKind)} data-stage="${esc(view.stageId)}"${view.inside ? ' data-inside="true"' : ''}>`;
  html += `<figure class="plot-art rift-art"><canvas class="plot-canvas" data-scene="rift" data-rift-id="${esc(view.id)}" role="img" aria-label="${esc(view.artLabel || view.name)}"></canvas></figure>`;
  html += `<div class="rift-tags">${genreChips(view.genres || [])}<span class="stage-tag" data-stage="${esc(view.stageId)}">${esc(view.stage)}</span>${view.kindWord ? `<span class="kind-tag">${esc(view.kindWord)}</span>` : ''}</div>`;
  if (view.where) html += `<p class="rift-where">${esc(view.where)}</p>`;
  if (view.level) html += `<p class="rift-where rift-level">${esc(view.level)}</p>`;
  if (view.says) html += miloSays(view.says);
  if (view.wardText) html += `<p class="plot-note" data-note="ward">${esc(view.wardText)}</p>`;
  if (view.held) html += `<p class="plot-note" data-note="held">The ward-post’s rule “${esc(view.held.name)}” holds it back. ${esc(view.held.text)}</p>`;
  html += `<section class="rift-section" data-section="why"><h3>Why</h3><p class="rift-text">${esc(view.cause)}</p></section>`;
  if (view.stitch) html += `<section class="rift-section" data-section="mend"><h3>To mend it</h3><p class="rift-text">${esc(view.stitch)}</p></section>`;
  if (view.mood) html += `<p class="rift-mood">${esc(view.mood)}</p>`;
  if (view.affixes?.length) {
    html += '<section class="rift-section" data-section="affixes"><h3>Affixes</h3><ul class="rift-facts">'
      + view.affixes.map((a) => `<li><strong>${esc(a.name)}</strong> ${esc(a.text)}</li>`).join('') + '</ul></section>';
  }
  if (view.lead) {
    html += `<section class="rift-section" data-section="lead"${attr('data-lead', view.lead.where)}><h3>The Tale-lead</h3>`
      + `<p class="rift-text"><strong>${esc(capital(view.lead.name))}</strong>${view.lead.mechanic ? ` ${esc(view.lead.mechanic)}.` : ''}</p>`
      + (view.lead.line ? `<p class="lead-line">“${esc(view.lead.line)}”</p>` : '')
      + (LEAD_WHERE[view.lead.where] ? `<p class="rift-meta lead-where">${LEAD_WHERE[view.lead.where]}</p>` : '') + '</section>';
  }
  if (view.loot?.length) {
    html += `<section class="rift-section" data-section="loot"${view.lootTaken ? ' data-taken="true"' : ''}><h3>${view.lootTaken ? 'What it left' : 'What it leaves'}</h3>`
      + (view.lootTaken ? '<p class="rift-meta">It’s in your satchel now.</p>' : '')
      + '<ul class="rift-facts">'
      + view.loot.map((item) => (item.relic
        ? `<li class="relic"><strong>${esc(item.item)}</strong> ${esc(item.text || '')}</li>`
        : `<li><strong>${esc(item.item)}</strong> <span class="qty">× ${esc(item.qty)}</span></li>`)).join('') + '</ul></section>';
  }
  html += '<section class="building-actions rift-actions" data-group="actions">';
  if (view.confirming) html += letGoConfirm(view, 'panel');
  else if (view.actions?.length) {
    const label = (id) => (view.costs && Object.hasOwn(view.costs, id) ? costWord(id, view.costs[id]) : actionWord(id));
    html += `<div class="ask-actions">${view.actions.map((id) => `<button type="button" class="px-btn${PRIMARY.has(id) ? ' primary' : ''}" data-action="rift-${esc(id)}" data-rift-id="${esc(view.id)}" data-focus-key="panel-${esc(id)}"${view.busy ? ' disabled' : ''}>${esc(label(id))}</button>`).join('')}</div>`;
  }
  return `${html}</section></div>`;
}

// ---------------------------------------------------------------------------
// The War Table.

/**
 * view: { groups: [{ id, title, rows?: row[], closed?: entry[] }], confirming, mapLabel, mapKey,
 *   settings: { gateBell, wardPost, eveningBell, bellOptions: [{ value, label }], rules: [{ id, name, text }] } }
 */
export function warTablePanel(view) {
  let html = `<figure class="plot-art war-map"><canvas class="plot-canvas" data-scene="war-map"${attr('data-map-key', view.mapKey)} role="img" aria-label="${esc(view.mapLabel || 'The frontier around the vale')}"></canvas></figure>`;
  html += '<p class="panel-lede">Every rift on the frontier, with its real cause. The nearer the walls, the more it matters.</p>';
  const open = view.groups.filter((g) => g.id !== 'closed');
  if (!open.length) html += '<p class="quiet-note">No rifts are open. The frontier is quiet.</p>';
  for (const group of view.groups) {
    const count = group.rows ? group.rows.length : group.closed.length;
    html += `<section class="group rift-group" data-group="${esc(group.id)}"><h3>${esc(group.title)} <span class="count">${count}</span></h3><ul class="rift-list">`;
    html += group.rows ? group.rows.map((row) => riftRow(row, { confirming: view.confirming })).join('') : group.closed.map(closedRow).join('');
    html += '</ul></section>';
  }
  const s = view.settings;
  html += '<section class="settings defences" data-group="defences"><h3>Defences</h3>';
  html += `<div class="setting"><div><p class="setting-name" id="setting-gateBell">The Gate Bell</p><p class="setting-hint">When a rift reaches the walls, one quiet note on your desktop while MILO is in the background, even with Alerts off.</p></div>`
    + `<button type="button" class="switch" role="switch" aria-checked="${s.gateBell}" aria-labelledby="setting-gateBell" data-setting="gateBell" data-focus-key="setting-gateBell"><span class="switch-knob" aria-hidden="true"></span><span class="switch-text">${s.gateBell ? 'On' : 'Off'}</span></button></div>`;
  html += '<div class="setting setting-block"><p class="setting-name" id="ward-post-label">The first ward-post</p><p class="setting-hint">Choose one rule to hold a kind of rift back before it opens. You can take it down again.</p>'
    + '<div class="designer-options ward-options" role="radiogroup" aria-labelledby="ward-post-label">';
  const choices = [{ id: '', name: 'No rule', text: 'Every rift opens as it comes.' }, ...s.rules];
  for (const rule of choices) {
    const id = `ward-post-${rule.id || 'none'}`;
    html += `<label class="designer-option" for="${id}"><input type="radio" name="ward-post" id="${id}" value="${esc(rule.id)}" data-ward-post="${esc(rule.id)}" data-focus-key="${id}"${(s.wardPost || '') === rule.id ? ' checked' : ''}>`
      + `<span class="designer-text"><span class="designer-name">${esc(rule.name)}</span><span class="designer-hint">${esc(rule.text)}</span></span></label>`;
  }
  html += '</div></div>';
  html += eveningBellSetting(s);
  return `${html}</section>`;
}

/** The evening bell's setting row (the War Table and the camp both show it). */
export function eveningBellSetting(s) {
  return `<div class="setting"><div><label class="setting-name" for="evening-bell">Evening bell</label><p class="setting-hint">If the crew are still working after it, a Nocturne rift opens. Off means no Nocturne rifts.</p></div>`
    + `<select class="px-select" id="evening-bell" data-evening-bell data-focus-key="evening-bell">${s.bellOptions.map((o) => `<option value="${esc(o.value)}"${(s.eveningBell || '') === o.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>`;
}

// ---------------------------------------------------------------------------
// The Hearth.

const tick = (met, future) => (met ? CHECK : future ? DOT : LOCK);
// Have and need, for a row still in progress: '5 of 20'.
const tally = (have, need) => `<span class="have">${esc(have)}</span> of <span class="need">${esc(need)}</span>`;

/**
 * The tag at the end of a requirement's row: 'Later' for one MILO can't count yet, 'Done' once
 * it's met (never '4 of 1'), else have and need.
 */
export function requirementTag(r) {
  if (r.future) return 'Later';
  if (r.met) return 'Done';
  return tally(r.have, r.count);
}

/** A material's tag: have and need, with have capped at need once there's enough ('80 of 80'). */
export function materialTag(m) {
  const need = Number.isFinite(m.need) ? m.need : 0;
  return tally(m.met ? need : m.have, need);
}

/**
 * view: { tier, name, look, ward, defences: [{ name, real }], next: hearthStatus().next | null,
 *   satchel: { materials: { birch, ash, pine }, essences: [{ name, qty, genre }], relics: [{ name, text }] },
 *   ready, reason, raising }
 */
export function hearthPanel(view) {
  let html = `<figure class="plot-art hearth-art"><canvas class="plot-canvas" data-scene="hearth" data-tier="${esc(view.tier)}" role="img" aria-label="${esc(`Pixel drawing of ${midName(view.name)}`)}"></canvas></figure>`;
  html += `<p class="hearth-tier">Tier ${esc(view.tier)} · <strong>${esc(view.name)}</strong></p>`;
  if (view.look) html += `<p class="panel-lede">${esc(view.look)}</p>`;
  html += `<p class="hearth-ward">${view.ward > 0 ? `The Hearthward reaches ${esc(view.ward)} tiles past the walls. No rift opens inside it.` : 'The Hearthward is the vale itself. No rift ever opens inside it.'}</p>`;
  if (view.defences?.length) {
    html += '<section class="skills hearth-defences" data-group="defences-now"><h3>Standing now</h3><ul class="defence-list">'
      + view.defences.map((d) => `<li><strong>${esc(d.name)}</strong> ${esc(d.real)}</li>`).join('') + '</ul></section>';
  }
  const next = view.next;
  if (next) {
    html += `<section class="skills hearth-next" data-group="next" data-next="${esc(next.id)}"><h3>Next: ${esc(next.name)}</h3>`;
    html += `<article class="skill"${next.ready ? ' data-ready="true"' : ''}>`;
    if (next.look) html += `<p class="skill-summary">${esc(next.look)}</p>`;
    html += '<h4 class="hearth-h4">What it needs</h4><ol class="levels reqs">'
      + next.requirements.map((r) => `<li data-req="${esc(r.kind)}" data-level-state="${r.met ? 'proven' : r.future ? 'future' : 'locked'}" data-have="${esc(r.have)}" data-need="${esc(r.count)}">${tick(r.met, r.future)}`
        + `<span class="level-name">${esc(r.text)}${r.future && r.note ? `<span class="req-note">${esc(r.note)}</span>` : ''}</span>`
        + `<span class="level-tag">${requirementTag(r)}</span></li>`).join('')
      + '</ol>';
    if (next.materials.length) {
      html += '<h4 class="hearth-h4">Materials</h4><ol class="levels mats">'
        + next.materials.map((m) => `<li data-material="${esc(m.id)}" data-level-state="${m.met ? 'proven' : m.future ? 'future' : 'locked'}" data-have="${esc(m.have)}" data-need="${esc(m.need)}">${tick(m.met, m.future)}`
          + `<span class="level-name">${esc(capital(m.name))}${m.future && m.note ? `<span class="req-note">${esc(m.note)}</span>` : ''}</span><span class="level-tag">${m.future ? 'Later' : materialTag(m)}</span></li>`).join('')
        + '</ol>';
    }
    // Construction is a skill MILO can't measure yet: it's named, and plainly not asked for.
    if (Number.isFinite(next.construction)) {
      html += `<p class="setting-hint hearth-note">It will want Construction level ${esc(next.construction)} one day. That isn’t asked for yet.</p>`;
    }
    if (next.defences?.length) {
      html += '<h4 class="hearth-h4">What it brings</h4><ul class="defence-list">'
        + next.defences.map((d) => `<li><strong>${esc(d.name)}</strong> ${esc(d.real)}</li>`).join('') + '</ul>';
    }
    html += '</article>';
    html += '<div class="hearth-raise">';
    if (next.ready) html += `<button type="button" class="px-btn primary" data-action="raise" data-focus-key="raise"${view.raising ? ' disabled' : ''}>Raise ${esc(lowerThe(next.name))}</button>`;
    else if (view.reason) html += `<p class="plot-note" data-note="not-ready">${esc(view.reason)}</p>`;
    html += '</div></section>';
  } else {
    html += '<p class="quiet-note">The Hearth is as high as it goes.</p>';
  }
  html += satchelSection(view.satchel);
  return html;
}

const capital = (text) => (text ? String(text).charAt(0).toUpperCase() + String(text).slice(1) : '');
const lowerThe = (name) => String(name || 'the next tier').replace(/^The /, 'the ');

export function satchelSection(satchel = {}) {
  const materials = satchel.materials || {};
  let html = '<section class="skills satchel" data-group="satchel"><h3>Satchel</h3><ul class="satchel-materials">';
  html += ['birch', 'ash', 'pine'].map((id) => `<li data-material="${id}"><span class="log log-${id}" aria-hidden="true"></span><span class="satchel-name">${capital(id)}</span><strong class="satchel-count">${esc(materials[id] || 0)}</strong></li>`).join('');
  html += '</ul>';
  const essences = satchel.essences || [];
  if (essences.length) {
    html += `<h4 class="hearth-h4">Essences</h4><ul class="essence-list">${essences.map((e) => `<li${attr('data-genre', e.genre)}>${esc(e.name)} <span class="qty">× ${esc(e.qty)}</span></li>`).join('')}</ul>`;
  }
  const relics = satchel.relics || [];
  if (relics.length) {
    html += `<h4 class="hearth-h4">Relics</h4><ul class="defence-list relic-list">${relics.map((r) => `<li><strong>${esc(r.name)}</strong> ${esc(r.text || '')}</li>`).join('')}</ul>`;
  }
  if (!essences.length && !relics.length && !(materials.birch || materials.ash || materials.pine)) {
    html += '<p class="setting-hint">Empty for now.</p>';
  }
  return `${html}</section>`;
}

// ---------------------------------------------------------------------------
// Lanterns and points of interest.

/** view: { id, title, lines, lit, wake, travel: [{ id, name, note }], says } */
export function lanternPanel(view, { miloSays = plainSays } = {}) {
  let html = `<div class="wild-view" data-lantern="${esc(view.id)}" data-lit="${view.lit ? 'true' : 'false'}">`;
  html += `<figure class="plot-art poi-art"><canvas class="plot-canvas" data-scene="poi" data-poi="${esc(view.id)}" data-lit="${view.lit ? 'true' : 'false'}" role="img" aria-label="${esc(view.lit ? 'Pixel drawing of a lit lantern on its post' : 'Pixel drawing of a sleeping lantern on its post')}"></canvas></figure>`;
  if (view.says) html += miloSays(view.says);
  html += view.lines.map((line) => `<p class="wild-line">${esc(line)}</p>`).join('');
  html += '<section class="building-actions" data-group="actions"><div class="ask-actions">';
  if (!view.lit) html += '<button type="button" class="px-btn primary" data-action="light" data-focus-key="light">Light it</button>';
  else html += `<button type="button" class="px-btn${view.wake ? '' : ' primary'}" data-action="rest" data-focus-key="rest"${view.wake ? ' disabled' : ''}>${view.wake ? 'Resting here' : 'Rest here'}</button>`;
  html += '</div>';
  if (view.lit) html += `<p class="setting-hint">${view.wake ? 'Milo rested here last. It’s right after home on his travel lists.' : 'Sit a while by its light. The lantern Milo rests at comes right after home on his travel lists.'}</p>`;
  html += '</section>';
  if (view.lit && view.travel?.length) {
    html += `<section class="group travel" data-group="travel"><h3>Travel <span class="count">${view.travel.length}</span></h3><ul class="travel-list">`
      + view.travel.map((t) => `<li><button type="button" class="travel-btn" data-action="travel" data-target="${esc(t.id)}" data-focus-key="travel-${esc(t.id)}">${esc(t.name)}${t.note ? ` <span class="place-note">${esc(t.note)}</span>` : ''}</button></li>`).join('')
      + '</ul></section>';
  }
  return `${html}</div>`;
}

/** A note signs itself ('… — Tamsin'): its words, and the signature for the foot of the page. */
export function splitSignature(text, from = '') {
  const words = String(text ?? '');
  const match = /\s*(—\s*[^—\n]{1,40})$/.exec(words);
  if (match && match.index > 0) return { text: words.slice(0, match.index), sign: match[1].trim() };
  return { text: words, sign: from ? `— ${from}` : '' };
}

/** view: { id, type, title, lines, body, action, done, later, says, result: string[] } */
export function poiPanel(view, { miloSays = plainSays } = {}) {
  let html = `<div class="wild-view" data-poi="${esc(view.id)}" data-poi-type="${esc(view.type)}" data-done="${view.done ? 'true' : 'false'}">`;
  html += `<figure class="plot-art poi-art"><canvas class="plot-canvas" data-scene="poi" data-poi="${esc(view.id)}" role="img" aria-label="${esc(`Pixel drawing of ${String(view.title || 'a place').replace(/^(The|A|An) /, (word) => word.toLowerCase())}`)}"></canvas></figure>`;
  if (view.says) html += miloSays(view.says);
  html += view.lines.map((line) => `<p class="wild-line">${esc(line)}</p>`).join('');
  if (view.body) {
    if (view.body.kind === 'note') {
      const note = splitSignature(view.body.text, view.body.from);
      html += `<blockquote class="letter note-text"><p>${esc(note.text)}</p>${note.sign ? `<footer>${esc(note.sign)}</footer>` : ''}</blockquote>`;
    }
    else html += `<blockquote class="letter ${view.body.kind === 'glimmer' ? 'glimmer' : 'greeting'}"><p>${esc(view.body.text)}</p></blockquote>`;
  }
  if (view.result?.length) html += `<div class="plot-note" data-note="result"><p>${view.result.map(esc).join('<br>')}</p></div>`;
  if (view.action) html += `<section class="building-actions" data-group="actions"><div class="ask-actions"><button type="button" class="px-btn primary" data-action="poi-${esc(view.action.id)}" data-focus-key="poi-action">${esc(view.action.label)}</button></div></section>`;
  if (view.later) html += `<p class="coming">${esc(view.later)}</p>`;
  return `${html}</div>`;
}

// ---------------------------------------------------------------------------
// The Prologue.

/** view: { title, steps: [{ id, title, text, hint, done, current }], doneCount, letter: { from, title, lines, sign } | null, showLetter, letterRead } */
export function storyPanel(view) {
  let html = `<p class="panel-lede">${esc(view.title)}. ${esc(view.doneCount)} of ${esc(view.steps.length)} done.</p>`;
  html += '<ol class="levels story-steps">';
  for (const step of view.steps) {
    const state = step.done ? 'proven' : step.current ? 'next' : 'locked';
    html += `<li data-step="${esc(step.id)}" data-level-state="${state}">${step.done ? CHECK : step.current ? DOT : LOCK}`
      + `<span class="level-name">${esc(step.title)}</span><span class="level-tag">${step.done ? 'Done' : step.current ? 'Now' : 'Later'}</span>`
      + (step.current ? `<p class="step-text">${esc(step.text)}</p><p class="step-hint">${esc(step.hint)}</p>` : '')
      + '</li>';
  }
  html += '</ol>';
  if (view.letter && (view.showLetter || view.letterRead)) {
    html += `<section class="letter-section" data-group="letter"><h3>${esc(view.letter.title)}</h3><blockquote class="letter">`
      + view.letter.lines.map((line) => `<p>${esc(line)}</p>`).join('')
      + `<footer>${esc(view.letter.sign || '')}</footer></blockquote></section>`;
  } else if (view.letter) {
    html += '<div class="ask-actions"><button type="button" class="px-btn primary" data-action="letter-read" data-focus-key="letter-read">Read Oriel’s letter</button></div>';
  }
  return html;
}

/** Act I under the Prologue in the story panel. act: acts.actStatus's. '' until it opens. */
export function actSection(act) {
  if (!act || !act.open || !Array.isArray(act.chapters)) return '';
  let html = `<section class="group act-section" data-group="${esc(act.id)}"><h3>${esc(act.title)}</h3><ol class="levels story-steps">`;
  for (const c of act.chapters) {
    const state = c.done ? 'proven' : c.current ? 'next' : 'locked';
    html += `<li data-step="${esc(c.id)}" data-level-state="${state}">${c.done ? CHECK : c.current ? DOT : LOCK}`
      + `<span class="level-name">${esc(c.title)}</span><span class="level-tag">${c.done ? 'Done' : c.current ? 'Now' : 'Later'}</span>`
      + (c.current ? `<p class="step-text">${esc(c.text)}</p><p class="step-hint">${esc(c.hint)}</p>` : '')
      + '</li>';
  }
  return `${html}</ol></section>`;
}

/** The small story card under the crew strip. view: { hidden, title, hint, doneCount, total, canRead, kicker ('The Prologue' unless given) } */
export function trackerCard(view) {
  const kicker = typeof view.kicker === 'string' && view.kicker ? view.kicker : 'The Prologue';
  if (view.hidden) {
    return `<button type="button" class="tracker-pill" data-action="tracker-show" aria-label="${esc(`Show the story card. ${kicker}, ${view.doneCount} of ${view.total} done`)}">${esc(kicker)} · ${esc(view.doneCount)} of ${esc(view.total)}</button>`;
  }
  return `<p class="tracker-kicker">${esc(kicker)} · ${esc(view.doneCount)} of ${esc(view.total)}</p>`
    + `<p class="tracker-title">${esc(view.title)}</p>`
    + `<p class="tracker-hint">${esc(view.hint)}</p>`
    + '<div class="tracker-actions">'
    + (view.canRead ? '<button type="button" class="px-btn primary small" data-action="letter-read">Read</button>' : '')
    + '<button type="button" class="link-btn" data-action="tracker-open">The story</button>'
    + '<button type="button" class="tracker-hide" data-action="tracker-hide" aria-label="Tuck the story card away"><svg viewBox="0 0 7 7" width="14" height="14" aria-hidden="true" shape-rendering="crispEdges"><path d="M0 3h7v1H0z"/></svg></button>'
    + '</div>';
}

/** The slim banner along the top inside an Elsewhere. view: { name, depth, genres } */
export function elsewhereBanner(view) {
  return '<div class="banner-text">'
    + `<span class="banner-kicker">Inside</span><strong class="banner-name">${esc(view.name)}</strong>`
    + (Number.isFinite(view.depth) ? `<span class="banner-depth">Depth ${esc(view.depth)}</span>` : '')
    + genreChips(view.genres || [])
    + '</div><button type="button" class="px-btn" data-action="leave-elsewhere">Leave</button>';
}

// ---------------------------------------------------------------------------
// The place list out in the wilds.

/** entries: [{ id, kind, label, note }] plus Travel home (or Leave inside an Elsewhere). */
export function entityList(entries, { home = 'travel-home' } = {}) {
  const items = entries.map((e) => `<li><button type="button" data-entity="${esc(e.id)}" data-kind="${esc(e.kind)}">${esc(e.label)}${e.note ? ` <span class="place-note">${esc(e.note)}</span>` : ''}</button></li>`);
  if (home === 'travel-home') items.push('<li><button type="button" data-entity="home" data-kind="home">Travel home <span class="place-note">Hearthvale</span></button></li>');
  if (home === 'leave') items.push('<li><button type="button" data-entity="leave" data-kind="leave">Leave <span class="place-note">Back to the wilds</span></button></li>');
  if (!entries.length && !home) return '<li><p class="quiet-note">Nothing nearby.</p></li>';
  return items.join('');
}
