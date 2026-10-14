// Traffic jams, for the message history: when a car has been stuck long enough to blink (tuning.gridlock.warnAfterSeconds) and no jam is
// already being tracked nearby, a new jam starts and a `jam` event is sent (with the place). One event per jam, not per car; a jam is over
// once nothing near it has blinked for jamForgetSeconds, after which the same spot can be reported again.
import { tuning } from './tuning.js';

const RADIUS = 4;                  // tiles: blinking cars this close to a tracked jam belong to it
const FORGET = 15;                 // seconds without a blinking car near it and a jam is over

export function stepJams(g, dt, notify) {
  g.jamT = (g.jamT || 0) + dt;
  if (g.jamT < 0.5) return;
  g.jamT = 0;
  const jams = g.jams || (g.jams = []), warn = tuning.gridlock.warnAfterSeconds;
  for (const c of g.cars) {
    if (c.stuck < warn || (c.state !== 'out' && c.state !== 'back')) continue;
    let j = jams.find(o => Math.hypot(o.x - c.x, o.y - c.y) <= RADIUS);
    if (j) { j.seen = g.time; continue; }
    j = { x: c.x, y: c.y, seen: g.time };
    jams.push(j);
    const tx = Math.floor(c.x), ty = Math.floor(c.y);
    notify({ type: 'jam', x: c.x, y: c.y, spots: [{ x0: tx - 1, y0: ty - 1, x1: tx + 1, y1: ty + 1 }] });
  }
  g.jams = jams.filter(j => g.time - j.seen < FORGET);
}
