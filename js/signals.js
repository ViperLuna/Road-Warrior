// Fixed-timer traffic lights. Two phases by compass axis: north/south, then east/west. Each runs
// green -> yellow -> all-red before the other axis goes. Every light shares one clock, so adjacent
// lights always agree on who has green (no starving a turn between two lights).
// Timings come from config/tuning.json.
import { tuning } from './tuning.js';

// Approach groups for a light: [north/south sides present, east/west sides present].
export function lightGroups(conns) {
  return [conns.filter(d => d === 0 || d === 2), conns.filter(d => d === 1 || d === 3)];
}

export function lightPeriod() {
  const { greenSeconds: G, yellowSeconds: Y, allRedSeconds: R } = tuning.trafficLight;
  return 2 * (G + Y + R);
}

// 'green' | 'yellow' | 'red' for traffic arriving from `side` at time `time`.
export function lightColor(time, groups, side) {
  const { greenSeconds: G, yellowSeconds: Y, allRedSeconds: R } = tuning.trafficLight;
  const cycle = G + Y + R, t = time % (2 * cycle);
  const grp = groups[0].includes(side) ? 0 : groups[1].includes(side) ? 1 : -1;
  if (grp < 0) return 'red';
  const u = t - grp * cycle;
  if (u < 0 || u >= cycle) return 'red';
  return u < G ? 'green' : u < G + Y ? 'yellow' : 'red';
}
