// Road works. They share the accident schedule (accident.js): when the timer fires, either an accident or a work zone happens.
// One straight 2-lane tile gets a few cones down one lane. Cars on that side swing into the oncoming lane (the piece is built in
// lanes.js `workPiece`), so the tile becomes a one-lane bridge: one direction at a time, decided by the ordinary junction rules.
import { tuning } from './tuning.js';
import { OPP } from './lanes.js';
import { roadConns } from './network.js';
import { adoptWork, releaseWork } from './cars.js';

export function resetConstruction(g) { g.work = null; }

// A plain, straight, two-way, 2-lane road tile that nobody is driving on right now, taken from where cars are about to go
// (so a busy road is picked more often, and the coned side always has traffic coming).
function pickSpot(g) {
  const busy = new Set(g.cars.filter(c => (c.state === 'out' || c.state === 'back') && c.route[c.idx]).map(c => c.route[c.idx].tk));
  const spots = [];
  for (const c of g.cars) {
    if ((c.state !== 'out' && c.state !== 'back') || c.crash) continue;
    for (let j = c.idx + 2; j < Math.min(c.route.length, c.idx + 9); j++) {
      const p = c.route[j];
      if (!p || p.kind !== 'road' || p.round || p.under || p.turn !== 'straight' || p.tl !== 2 || p.ei !== 2 || p.eo !== 2 || busy.has(p.tk)) continue;
      const k = p.ty * g.cols + p.tx, road = g.roads.get(k);
      if (!road || road.tunnel || road.bridge || road.special || road.cone || road.overpass !== undefined || road.noExit) continue;
      const conns = roadConns(g, p.tx, p.ty);
      if (conns.length !== 2 || conns[0] !== OPP[conns[1]]) continue;
      spots.push({ x: p.tx, y: p.ty, k, closedIn: p.in });
    }
  }
  return spots.length ? spots[(Math.random() * spots.length) | 0] : null;
}

export function startConstruction(g, notify) {
  const s = pickSpot(g);
  if (!s) return false;
  const seconds = Math.min(tuning.construction.durationSeconds, tuning.gridlock.gameOverAfterSeconds - 1);      // (a queue behind it must never be able to reach game over)
  g.work = { x: s.x, y: s.y, k: s.k, closedIn: s.closedIn, left: seconds, age: 0 };
  adoptWork(g);
  notify({ type: 'construction', x: s.x + 0.5, y: s.y + 0.5 });
  return true;
}

// Returns true once the works are done and gone.
export function stepConstruction(g, dt, notify) {
  const w = g.work;
  if (!w) return false;
  w.age += dt; w.left -= dt;
  if (w.left > 0) return false;
  g.work = null;
  releaseWork(g);
  notify({ type: 'construction-cleared' });
  return true;
}
