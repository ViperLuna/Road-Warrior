// Traffic jams, for the message history: when a car has been stuck long enough to blink (tuning.gridlock.warnAfterSeconds) and no jam is
// already being tracked nearby, a new jam starts and a `jam` event is sent (with the place). One event per jam, not per car; a jam is over
// once nothing near it has blinked for jamForgetSeconds, after which the same spot can be reported again.
import { tuning } from './tuning.js';

// A jam also has a CLOCK: how long it has been alive. The per-car 40 s game-over timer resets whenever a car creeps forward, and the patience
// ladder lets a jammed pack push through one car at a time, so a creeping jam never loses the game by itself. The clock counts the AREA: if a
// jam keeps getting angry for endSeconds (it never goes quiet for forgetSeconds), the game is over, however much the pack shuffles about.
// tuning.jams: radiusTiles (blinking cars this close to a tracked jam are part of it), forgetSeconds (a jam is over after this long without a
// blinking car near it), relogSeconds (after it is over, the same spot is not reported again for this long, so a jam that flickers on and off
// does not fill the history).

// Returns { kind: 'jam', label, spots } if a jam has run out its clock (the game is lost), else null.
export function stepJams(g, dt, notify) {
  g.jamT = (g.jamT || 0) + dt;
  if (g.jamT < 0.5) return null;
  g.jamT = 0;
  const jams = g.jams || (g.jams = []), quiet = g.jamQuiet || (g.jamQuiet = []), warn = tuning.gridlock.warnAfterSeconds, T = tuning.jams;
  for (const c of g.cars) {
    if (c.stuck < warn || (c.state !== 'out' && c.state !== 'back')) continue;
    let j = jams.find(o => Math.hypot(o.x - c.x, o.y - c.y) <= T.radiusTiles);
    if (j) { j.seen = g.time; continue; }
    j = { x: c.x, y: c.y, seen: g.time, start: g.time, warned: false };
    jams.push(j);
    if (quiet.some(q => q.until > g.time && Math.hypot(q.x - c.x, q.y - c.y) <= T.radiusTiles)) continue;       // (this spot was reported a moment ago)
    const tx = Math.floor(c.x), ty = Math.floor(c.y);
    notify({ type: 'jam', x: c.x, y: c.y, spots: [{ x0: tx - 1, y0: ty - 1, x1: tx + 1, y1: ty + 1 }] });
  }
  for (const j of jams) if (g.time - j.seen >= T.forgetSeconds) quiet.push({ x: j.x, y: j.y, until: g.time + T.relogSeconds });
  g.jams = jams.filter(j => g.time - j.seen < T.forgetSeconds);
  g.jamQuiet = quiet.filter(q => q.until > g.time);
  for (const j of g.jams) {                                                  // the clock
    const age = g.time - j.start, box = () => { const tx = Math.floor(j.x), ty = Math.floor(j.y); return [{ x0: tx - 1, y0: ty - 1, x1: tx + 1, y1: ty + 1 }]; };
    g.worstJamAge = Math.max(g.worstJamAge || 0, age);
    if (!j.warned && age >= T.endSeconds - T.warnSeconds) { j.warned = true; notify({ type: 'jam-warn', seconds: T.warnSeconds, x: j.x, y: j.y, spots: box() }); }
    if (age >= T.endSeconds) return { kind: 'jam', label: 'A traffic jam', spots: box() };
  }
  return null;
}
