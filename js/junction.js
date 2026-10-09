// Intersection rules: which movements conflict, and who has priority.
import { CAR_LEN, DIR, OPP, rt } from './lanes.js';
import { roadConns } from './network.js';
import { tuning } from './tuning.js';

// Per-step cache of junction info: { n: connection count, stem: side of the T's stem or -1 }.
export function junctionAt(g, x, y, cache) {
  const k = y * g.cols + x;
  let j = cache.get(k);
  if (!j) {
    const c = roadConns(g, x, y);
    j = { kind: 'road', n: c.length, stem: -1 };
    if (c.length === 3) j.stem = c.find(d => !c.includes(OPP[d]));
    cache.set(k, j);
  }
  return j;
}

const turnRank = p => (p.turn === 'right' ? 1 : p.turn === 'left' ? 2 : 0);   // straight goes first

// Would piece `a` (about to start) collide with a car on piece `b` currently `sb` along it?
export function pieceConflict(a, b, sb) {
  if (a === b) return false;                                   // same lane: car-following handles it
  if (a.kind === 'road' && b.kind === 'road' && a.in === b.in) return sb < CAR_LEN + 0.12;   // same entry lane: wait until the car ahead pulls clear
  if (a.kind === 'lot_in' && b.kind === 'lot_in' && a.ent === b.ent && sb < CAR_LEN + 0.12) return true;   // two cars entering by the same gate
  // Parking-lot moves get a wider margin: cars there are swinging around, so their bodies stick out further.
  const thr = a.kind === 'road' && b.kind === 'road' ? tuning.cars.conflictDistance : tuning.cars.conflictDistance + 0.1;
  const t2 = thr * thr, from = sb - CAR_LEN / 2;
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
  if (b.commit !== a.commit) return b.commit;                  // already past the point of no return
  if (b.inJ !== a.inJ) return b.inJ;                           // already inside the previous junction: let it clear the tile it's blocking
  if (J.kind === 'lot') return before(b, a);
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
