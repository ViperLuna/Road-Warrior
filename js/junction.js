// Intersection rules: which movements conflict, and who has priority.
import { CAR_LEN, DIR, OPP, rt } from './lanes.js';
import { roadConns, tileLanes, edgeLanes } from './network.js';
import { tuning } from './tuning.js';
import { lightGroups } from './signals.js';

// Per-step cache of junction info: { n: connection count, stem: side of the T's stem or -1 }.
export function junctionAt(g, x, y, cache) {
  const k = y * g.cols + x;
  let j = cache.get(k);
  if (!j) {
    const c = roadConns(g, x, y), special = (g.roads.get(k) || {}).special;
    const tl = tileLanes(g, x, y), edges = c.map(d => edgeLanes(g, x, y, d));
    const taper = c.length >= 2 && Math.min(...edges) !== Math.max(...edges);      // lanes merge / split inside this tile
    const overpass = (g.roads.get(k) || {}).overpass !== undefined;
    j = { kind: 'road', n: overpass ? 2 : c.length, stem: -1, round: false, light: false, x, y, taper: overpass ? false : taper, junction: overpass ? false : c.length >= 3 || taper, overpass };
    if (c.length === 3) j.stem = c.find(d => !c.includes(OPP[d]));
    if (c.length >= 3 && special === 'roundabout') j.round = true;
    if (c.length >= 3 && special === 'light') { j.light = true; j.groups = lightGroups(c); }
    cache.set(k, j);
  }
  return j;
}

const turnRank = p => (p.turn === 'right' ? 1 : p.turn === 'left' ? 2 : 0);   // straight goes first

// Would piece `a` (about to start) collide with a car on piece `b` currently `sb` along it?
export function pieceConflict(a, b, sb) {
  if (a === b) return false;                                   // same lane: car-following handles it
  if (!!a.under !== !!b.under) return false;                   // one passes over the other: different layers never meet
  if (a.kind === 'road' && b.kind === 'road' && a.in === b.in && (a.li ?? 0) === (b.li ?? 0)) {   // (parallel lanes don't wait on each other)
    if (sb < CAR_LEN + 0.12) return true;                        // same entry lane: wait until the car ahead pulls clear
    if (!a.round && !a.taper && !b.taper) return false;          // (plain paths split at once; ring paths and tapers separate slowly, so use the geometry)
  }
  if (a.kind === 'lot_in' && b.kind === 'lot_in' && a.ent === b.ent && sb < CAR_LEN + 0.12) return true;   // two cars entering by the same gate
  // Two ring paths share an arc. If the car already circulating has cleared my merge point, I simply fall in behind it.
  if (a.round && b.round && a.xy.length > 7) {
    const E = a.xy[7];
    let jBest = -1, dBest = 1e9;
    for (let j = 0; j < b.xy.length; j++) { const d = Math.hypot(b.xy[j][0] - E[0], b.xy[j][1] - E[1]); if (d < dBest) { dBest = d; jBest = j; } }
    if (dBest < 0.15 && sb - CAR_LEN / 2 > b.lut[jBest] + 0.12) return false;
  }
  // Parking-lot moves get a wider margin (cars there are swinging around); so do highway lanes, where cars cut diagonally
  // across a neighbouring lane. Two cars making the *same* movement in side-by-side lanes simply travel together.
  const lot = a.kind !== 'road' || b.kind !== 'road';
  if (!lot && a.in === b.in && a.out === b.out && (a.li ?? 0) !== (b.li ?? 0) && (a.lo ?? 0) !== (b.lo ?? 0) && a.tl === b.tl) return false;
  const wide = !lot && (a.tl === 4 || b.tl === 4);
  const thr = tuning.cars.conflictDistance + (lot ? 0.1 : wide ? 0.05 : 0), t2 = thr * thr, from = sb - CAR_LEN / 2;
  for (let j = 0; j < b.xy.length; j++) {
    if (b.lut[j] < from) continue;
    const bx = b.xy[j][0], by = b.xy[j][1];
    for (let i = 0; i < a.xy.length; i++) {
      const dx = a.xy[i][0] - bx, dy = a.xy[i][1] - by;
      if (dx * dx + dy * dy < t2) return true;
    }
  }
  return false;
}

// Does waiting car `b` have right of way over waiting car `a` at junction `J`?
export function outranks(b, a, J) {
  const qa = a.entry.q, qb = b.entry.q;
  // Same lane approaching the same junction: the car in front goes first, whatever the timestamps say.
  if (a.route[a.idx] === b.route[b.idx]) return b.s > a.s;
  if (b.commit !== a.commit) return b.commit;                  // already past the point of no return
  if (b.inJ !== a.inJ) return b.inJ;                           // already inside the previous junction: let it clear the tile it's blocking
  if (J.kind === 'lot') return before(b, a);
  if (J.round) return before(b, a);                            // roundabout: cars already circulating win (handled as 'inside'); entrants go in arrival order
  if (J.light) {                                               // both are on green: straight beats right beats left, then arrival
    const ra = turnRank(qa), rb = turnRank(qb);
    return ra !== rb ? rb < ra : before(b, a);
  }
  if (J.n === 3) {                                             // T: through road beats the stem
    const ca = qa.in === J.stem ? 1 : 0, cb = qb.in === J.stem ? 1 : 0;
    if (ca !== cb) return cb < ca;
    const ra = turnRank(qa), rb = turnRank(qb);
    if (ra !== rb) return rb < ra;                             // left turns yield to oncoming
    return before(b, a);
  }
  if (Math.abs(b.arrT - a.arrT) > 0.15) return b.arrT < a.arrT;   // 4-way: first come, first served
  const ra = turnRank(qa), rb = turnRank(qb);
  if (ra !== rb) return rb < ra;
  const rightOf = p => rt([-DIR[p.in][0], -DIR[p.in][1]]);       // side of the road a car on piece p has on its right
  const same = (u, v) => u[0] === v[0] && u[1] === v[1];
  if (same(DIR[qb.in], rightOf(qa))) return true;               // tie: yield to the car on your right
  if (same(DIR[qa.in], rightOf(qb))) return false;
  return before(b, a);
}

const before = (b, a) => b.arrT < a.arrT || (b.arrT === a.arrT && b.id < a.id);
