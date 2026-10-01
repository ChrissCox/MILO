// The sky: day and night from the real clock, seasons from the real date, and weather from a
// seeded daily roll (CONTRACT-PHASE4.md §7.6, §9.11). Pure clock maths; the drawing is
// src/world/scene-sky.js's. Every number comes from content/sky.json (DEFAULT_SKY mirrors it,
// and a test pins the two together).
//
// The sun table is local clock time per month, daylight saving included. Dawn runs `twilight`
// minutes either side of sunrise, dusk the same round sunset. `key` changes only when what's
// drawn changes: the daypart, a ten-minute step through dawn or dusk, the season or the weather.
import { hashInts, hashString, unit } from './world/rng.js';
import { dayNumber } from './clean.js';

export const DAYPARTS = Object.freeze(['dawn', 'day', 'dusk', 'night']);
export const SEASONS = Object.freeze(['spring', 'summer', 'autumn', 'winter']);
export const WEATHER_KINDS = Object.freeze(['clear', 'rain', 'snow', 'mist', 'wind', 'leaves']);
const STEP_MINUTES = 10;

export const DEFAULT_SKY = Object.freeze({
  sun: Object.freeze({
    1: { rise: '07:40', set: '17:10' }, 2: { rise: '07:15', set: '17:50' }, 3: { rise: '07:30', set: '19:25' },
    4: { rise: '06:50', set: '19:55' }, 5: { rise: '06:10', set: '20:25' }, 6: { rise: '05:50', set: '20:50' },
    7: { rise: '06:05', set: '20:50' }, 8: { rise: '06:35', set: '20:20' }, 9: { rise: '07:05', set: '19:30' },
    10: { rise: '07:35', set: '18:40' }, 11: { rise: '07:10', set: '17:05' }, 12: { rise: '07:35', set: '16:55' },
  }),
  twilight: 40,
  tints: Object.freeze({ dawn: [255, 214, 170, 0.12], dusk: [255, 170, 120, 0.16], night: [40, 50, 110, 0.38] }),
  seasons: Object.freeze({ spring: [3, 4, 5], summer: [6, 7, 8], autumn: [9, 10, 11], winter: [12, 1, 2] }),
  weather: Object.freeze({
    spring: { clear: 5, rain: 3, mist: 1, wind: 1 },
    summer: { clear: 7, rain: 2, wind: 1 },
    autumn: { clear: 4, rain: 3, mist: 1, wind: 1, leaves: 2 },
    winter: { clear: 4, snow: 3, mist: 2, wind: 1 },
  }),
  particles: Object.freeze({
    rain: { key: 'w', density: 0.004 }, snow: { key: 'c', density: 0.003 }, mist: { key: 'f', density: 0.002 },
    wind: { key: 'C', density: 0.0015 }, leaves: { key: 'U', density: 0.0015 },
  }),
});

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const TIME = /^(\d{1,2}):(\d{2})$/;
const minutesOf = (text, fallback) => {
  const m = TIME.exec(typeof text === 'string' ? text : '');
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : fallback;
};
const tintOk = (t) => Array.isArray(t) && t.length === 4 && t.every(finite);

/** content/sky.json with its defaults filled in. */
function tableOf(sky) {
  const src = isRecord(sky) ? sky : {};
  const pick = (name) => (isRecord(src[name]) ? src[name] : DEFAULT_SKY[name]);
  return {
    sun: pick('sun'),
    twilight: finite(src.twilight) && src.twilight > 0 && src.twilight <= 180 ? src.twilight : DEFAULT_SKY.twilight,
    tints: pick('tints'),
    seasons: pick('seasons'),
    weather: pick('weather'),
    particles: pick('particles'),
  };
}

/** The daypart and how far through dawn or dusk (in whole ten-minute steps). */
function partOf(now, table) {
  const date = new Date(now);
  const month = date.getMonth() + 1;
  const sun = isRecord(table.sun[month]) ? table.sun[month] : DEFAULT_SKY.sun[month];
  const rise = minutesOf(sun.rise, minutesOf(DEFAULT_SKY.sun[month].rise, 420));
  const set = minutesOf(sun.set, minutesOf(DEFAULT_SKY.sun[month].set, 1140));
  const tw = table.twilight;
  const minute = date.getHours() * 60 + date.getMinutes();
  const span = 2 * tw;
  if (minute < rise - tw || minute >= set + tw) return { daypart: 'night', step: 0, steps: 0 };
  const steps = Math.ceil(span / STEP_MINUTES);
  if (minute < rise + tw) return { daypart: 'dawn', step: Math.floor((minute - (rise - tw)) / STEP_MINUTES), steps };
  if (minute < set - tw) return { daypart: 'day', step: 0, steps: 0 };
  return { daypart: 'dusk', step: Math.floor((minute - (set - tw)) / STEP_MINUTES), steps };
}

const mix = (a, b, p) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * p)).concat(Math.round((a[3] + (b[3] - a[3]) * p) * 1000) / 1000);

function seasonOf(month, table) {
  for (const season of SEASONS) if (Array.isArray(table.seasons[season]) && table.seasons[season].includes(month)) return season;
  return SEASONS.find((season) => DEFAULT_SKY.seasons[season].includes(month));
}

/**
 * The sky at `now`: { daypart, light (0–1), night, season, tint: [r, g, b, a],
 * weather: { kind, density, key (the particles' palette key) }, key }. Weather is
 * `hashInts(hashString(seed), dayNumber(now), 'weather')` against the season's weights.
 */
export function skyAt(now, { seed = 'hushlands', sky = null } = {}) {
  const t = finite(now) ? now : 0;
  const table = tableOf(sky);
  const { daypart, step, steps } = partOf(t, table);
  const p = steps ? Math.min(1, step / steps) : 0;
  const tints = table.tints;
  const night = tintOk(tints.night) ? tints.night : DEFAULT_SKY.tints.night;
  const dawn = tintOk(tints.dawn) ? tints.dawn : DEFAULT_SKY.tints.dawn;
  const dusk = tintOk(tints.dusk) ? tints.dusk : DEFAULT_SKY.tints.dusk;
  const clear = (c) => [c[0], c[1], c[2], 0];
  let tint;
  let light;
  if (daypart === 'night') { tint = [...night]; light = 0; }
  else if (daypart === 'day') { tint = [255, 255, 255, 0]; light = 1; }
  else if (daypart === 'dawn') { tint = p < 0.5 ? mix(night, dawn, p * 2) : mix(dawn, clear(dawn), (p - 0.5) * 2); light = p; }
  else { tint = p < 0.5 ? mix(clear(dusk), dusk, p * 2) : mix(dusk, night, (p - 0.5) * 2); light = 1 - p; }
  const month = new Date(t).getMonth() + 1;
  const season = seasonOf(month, table);
  const weights = isRecord(table.weather[season]) ? table.weather[season] : DEFAULT_SKY.weather[season];
  const entries = Object.entries(weights).filter(([kind, w]) => WEATHER_KINDS.includes(kind) && finite(w) && w > 0);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = unit(hashInts(hashString(typeof seed === 'string' ? seed : 'hushlands'), dayNumber(t), 'weather')) * total;
  let kind = 'clear';
  for (const [name, w] of entries) {
    roll -= w;
    if (roll < 0) { kind = name; break; }
  }
  const particle = kind !== 'clear' && isRecord(table.particles[kind]) ? table.particles[kind] : null;
  const weather = {
    kind,
    density: particle && finite(particle.density) ? particle.density : 0,
    key: particle && typeof particle.key === 'string' ? particle.key : '',
  };
  return {
    daypart,
    light: Math.round(light * 1000) / 1000,
    night: daypart === 'night',
    season,
    tint,
    weather,
    key: `${daypart}:${step}:${season}:${kind}`,
  };
}

/** True between dusk and dawn, from the same sun table as skyAt (it replaces the Westwatch's 20:00–06:00). */
export function isNight(now, { sky = null } = {}) {
  return partOf(finite(now) ? now : 0, tableOf(sky)).daypart === 'night';
}
