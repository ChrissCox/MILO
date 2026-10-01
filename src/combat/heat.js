// Heat, edge and the outcome pick (CONTRACT-PHASE4.md §4.1–§4.3, §5.7; COMBAT.md §3.5).
// Pure: nothing here reads a clock or Math.random. Bars are whole percents, listed
// Critical / Hit / Graze / Miss, and always sum to 100.
import { hashInts, unit } from '../world/rng.js';

const freezeBars = (bars) => Object.freeze([...bars]);

/** The three bands' bars (rules.json `bands` holds the same numbers; a content test checks them). */
export const BANDS = Object.freeze({
  cool: freezeBars([5, 80, 10, 5]),
  warm: freezeBars([15, 60, 15, 10]),
  hot: freezeBars([30, 35, 15, 20]),
});

export const DEGREES = Object.freeze(['crit', 'hit', 'graze', 'miss']);
const COOLER = Object.freeze({ cool: 'cool', warm: 'cool', hot: 'warm' });

/** Heat 0–30 is Cool, 31–60 Warm, 61–100 Hot. */
export function bandOf(heat) {
  const h = Number(heat) || 0;
  if (h <= 30) return 'cool';
  if (h <= 60) return 'warm';
  return 'hot';
}

/** A band one step cooler (Storybook): Hot uses Warm's bars, Warm uses Cool's. */
export function coolerBand(band) {
  return COOLER[band] || 'cool';
}

const clampEdge = (edge) => Math.max(-3, Math.min(3, Math.trunc(Number(edge) || 0)));

/**
 * §4.2's ladder. Positive edge, top-down: Hit→Critical, Graze→Hit, Miss→Graze, each moving
 * min(10, what the lower outcome has at that moment). Negative edge, bottom-up: Graze→Miss,
 * Hit→Graze, Critical→Hit, each moving min(10, what the higher outcome has). Once per point.
 */
export function shiftBars(bars, edge) {
  const b = [bars[0], bars[1], bars[2], bars[3]];
  const e = clampEdge(edge);
  for (let i = 0; i < Math.abs(e); i += 1) {
    if (e > 0) {
      for (const from of [1, 2, 3]) {
        const move = Math.min(10, b[from]);
        b[from] -= move;
        b[from - 1] += move;
      }
    } else {
      for (const from of [2, 1, 0]) {
        const move = Math.min(10, b[from]);
        b[from] -= move;
        b[from + 1] += move;
      }
    }
  }
  return b;
}

/**
 * The bars after the settled modifiers, in §5.7's order: Kind noise (a tenth of the Hit bar,
 * rounded down, moves to Critical), the helpful floor (Miss into Graze), a Cheer (Graze and Miss
 * into Hit), Being sure (one degree better), plot armour (one degree worse).
 */
export function foldBars(bars, { kind = false, helpful = false, cheer = false, sure = false, armour = false } = {}) {
  let [c, h, g, m] = bars;
  if (kind) {
    const move = Math.floor(h / 10);
    h -= move;
    c += move;
  }
  if (helpful) {
    g += m;
    m = 0;
  }
  if (cheer) {
    h += g + m;
    g = 0;
    m = 0;
  }
  if (sure) {
    [c, h, g, m] = [c + h, g, m, 0];
  }
  if (armour) {
    [c, h, g, m] = [0, c, h, g + m];
  }
  return [c, h, g, m];
}

/** The bars for an action at this heat and edge. */
export function barsFor(heat, edge, { storybook = false, helpful = false, cheer = false } = {}) {
  const band = storybook ? coolerBand(bandOf(heat)) : bandOf(heat);
  return foldBars(shiftBars(BANDS[band], edge), { helpful, cheer });
}

/** The expected damage multiplier: (2c + h + 0.5g) / 100. */
export function expected(bars) {
  return (2 * bars[0] + bars[1] + 0.5 * bars[2]) / 100;
}

/**
 * The attack penalty for attack `attackIndex` in a turn (0 = the first): this attack's heat
 * increment (20, or 10 with a light weapon; none for the first) and its edge (−index, cumulative).
 */
export function attackPenalty(attackIndex, { light = false } = {}) {
  const i = Math.max(0, Math.trunc(Number(attackIndex) || 0));
  if (i === 0) return { heat: 0, edge: 0 };
  return { heat: light ? 10 : 20, edge: -i };
}

/** Heat moves `amount` toward idle, never past it. */
export function drift(heat, idle, amount = 10) {
  const h = Number(heat) || 0;
  const target = Number(idle) || 0;
  if (h > target) return Math.max(target, h - amount);
  if (h < target) return Math.min(target, h + amount);
  return h;
}

/** Heat clamped to 0–100. */
export function clampHeat(heat) {
  return Math.max(0, Math.min(100, Math.round(Number(heat) || 0)));
}

/** The draw for outcome k of attempt a, as a number in [0, 100). */
export function draw(seed, attempt, k) {
  return unit(hashInts(seed >>> 0, attempt | 0, k | 0)) * 100;
}

/** The degree a draw lands on against the bars (Critical first, then Hit, Graze, Miss). */
export function degreeAt(u, bars) {
  let edge = 0;
  for (let i = 0; i < 3; i += 1) {
    edge += bars[i];
    if (u < edge) return DEGREES[i];
  }
  return 'miss';
}

/** Outcome k of attempt a: unit(hashInts(seed, a, k)) against the bars. */
export function pick(seed, attempt, k, bars) {
  return degreeAt(draw(seed, attempt, k), bars);
}

/** Moves a degree by `by` steps (+1 better, −1 worse), clamped to Critical…Miss. */
export function shiftDegree(degree, by) {
  const i = DEGREES.indexOf(degree);
  return DEGREES[Math.max(0, Math.min(3, (i < 0 ? 3 : i) - by))];
}

/** Odds as words: Hit or better ≥ 70% likely, 40–69% about even, below 40% a long shot. */
export function oddsWords(bars, { likely = 70, even = 40, crit = 20 } = {}) {
  const good = bars[0] + bars[1];
  const words = good >= likely ? 'likely' : good >= even ? 'about even' : 'a long shot';
  return { words, critInReach: bars[0] >= crit };
}
