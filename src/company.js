// The company grows (PLAN.md Phase 6): which companions can fight. A companion's file marks a move
// that isn't written yet as a stub; one whose moves are all written, from a phase that has come,
// joins the roster by coming to camp (src/people.js, src/party.js recruit). Pure.

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The latest phase whose companions fight. Later ones (Nell, Vesperine, Whisper) still wait. */
export const FIGHTING_PHASE = 6;

/** Whether every one of a companion's moves is written (none is a stub). */
export const movesReady = (comp) => Array.isArray(comp?.moves)
  && comp.moves.every((m) => (Array.isArray(comp.abilityDefs) ? comp.abilityDefs : []).some((a) => isRecord(a) && a.id === m && a.stub !== true));
