// One car per house. Round trip: house -> destination lot (park, dwell) -> house = 1 trip.
import { DIR, OPP, CAR_LEN, pointAt, roadPiece, roundPiece, houseOutPiece, houseInPiece, lotInPiece, lotOutPiece } from './lanes.js';
import { lightColor } from './signals.js';
import { lotTile, gateOf } from './buildings.js';
import { roadAt, roundAt, tidx, tileLanes, layerLanes, edgeLanes, overpassAxis, axisOf } from './network.js';
import { findPath } from './pathfind.js';
import { tuning } from './tuning.js';
import { junctionAt, pieceConflict, outranks } from './junction.js';

const TURN_RATE = 12;
const STOP_OFFSET = CAR_LEN / 2 + 0.12;       // where a held car's centre stops, back from the junction edge

// Target speed (tiles/s) for a piece: lane-count base speed x movement-type factor.
function pieceSpeed(p) {
  const sp = tuning.speed;
  if (p.kind === 'road') {
    const base = (p.lanes === 4 ? sp.fourLane : sp.twoLane) * (p.taper ? sp.taperFactor : 1);
    return base * (p.turn === 'right' ? sp.rightTurnFactor : p.turn === 'left' ? sp.leftTurnFactor : p.turn === 'round' ? sp.roundaboutFactor : 1);
  }
  return sp.twoLane * (p.kind.startsWith('house') ? sp.drivewayFactor : sp.parkingLotFactor);
}

export function createCar(house) {
  return {
    id: house.id, house, color: house.color, state: 'home', route: [], idx: 0, s: 0, v: 0,
    x: 0, y: 0, a: 0, dest: null, slot: -1, lot: null, dwell: 0, cooldown: 1 + Math.random() * 1.5,
    arrKey: null, arrT: 0, entry: null, commit: false, inJ: false, hold: false, force: 0, ignoreId: 0, ignoreT: 0, sigRed: false, needsStop: false, stopT: 0, why: null, stuck: 0,
  };
}

const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
// Route pieces for the road tiles of a path. `lane` (0 inner, 1 outer) is this trip's lane on 4-lane roads; on 2-lane edges it collapses to the one lane.
const roadPieces = (g, steps, lane) => steps.map(s => {
  if (roundAt(g, s.x, s.y)) return roundPiece(s.x, s.y, s.in, s.out);
  const ei = edgeLanes(g, s.x, s.y, s.in), eo = edgeLanes(g, s.x, s.y, s.out);
  const ov = overpassAxis(g, s.x, s.y), under = ov >= 0 && axisOf(s.in) !== ov;          // on an overpass tile, the street runs underneath
  return roadPiece(s.x, s.y, s.in, s.out, { tl: layerLanes(g, s.x, s.y, s.in), ei, eo, li: Math.min(lane, ei / 2 - 1), lo: Math.min(lane, eo / 2 - 1), under });
});

// The same road tile in the opposite direction (for a car's way home over the road it came by).
const reversePiece = p => (p.round ? roundPiece(p.tx, p.ty, p.out, p.in) : roadPiece(p.tx, p.ty, p.out, p.in, { tl: p.tl, ei: p.eo, eo: p.ei, li: p.lo, lo: p.li, under: p.under }));

function planOut(g, car) {
  const b = car.house, D = DIR[b.rot];
  const rx = b.x + D[0], ry = b.y + D[1];
  if (!roadAt(g, rx, ry)) return false;
  const dests = shuffle(g.buildings.filter(d => d.kind === 'dest' && d.color.id === b.color.id && d.slots.includes(null)));
  for (const d of dests) {
    const goals = [...g.ports.values()].filter(port => port.b === d);       // either entrance leads to every bay
    const res = findPath(g, rx, ry, OPP[b.rot], goals);
    if (!res) continue;
    const here = [res.port.lot * 2, res.port.lot * 2 + 1].filter(k => d.slots[k] === null);   // prefer a bay on the entrance's side
    const open = here.length ? here : d.slots.map((v, k) => (v === null ? k : -1)).filter(k => k >= 0);
    const k = open[(Math.random() * open.length) | 0];
    d.slots[k] = car;
    car.dest = d; car.slot = k;
    car.lot = { bx: d.x, by: d.y, rot: d.rot, ent: res.port.lot, k };
    const rp = roadPieces(g, res.steps, Math.random() < 0.5 ? 0 : 1);
    car.route = [houseOutPiece(b.x, b.y, b.rot), ...rp, lotInPiece(d.x, d.y, d.rot, res.port.lot, k)];
    // Ghost roads last until the whole round trip is done: remember the way home, so if the roads are changed while this
    // car is parked it can still drive back over the road it came by (instead of sitting in its bay forever).
    car.homeRoute = [lotOutPiece(d.x, d.y, d.rot, k, res.port.lot), ...rp.slice().reverse().map(reversePiece), houseInPiece(b.x, b.y, b.rot)];
    return true;
  }
  return false;
}

// No live road leads home any more: use the remembered way back (ghost pieces), if there is one.
function ghostHome(car) {
  if (!car.homeRoute) return false;
  car.route = car.homeRoute.slice();
  return true;
}

// Leave through whichever connected entrance gives the cheapest way home.
function planBack(g, car) {
  const L = car.lot, D = DIR[L.rot];
  const home = g.ports.get(tidx(g, car.house.x, car.house.y));
  if (!home) return ghostHome(car);
  let best = null, bestEnt = 0;
  for (const ent of [L.ent]) {                                  // the lot's single gate
    const [lx, ly] = lotTile({ x: L.bx, y: L.by, rot: L.rot }, ent);
    const rx = lx + D[0], ry = ly + D[1];
    if (!roadAt(g, rx, ry)) continue;
    const res = findPath(g, rx, ry, OPP[L.rot], [home]);
    if (res && (!best || res.cost < best.cost - 1e-6)) { best = res; bestEnt = ent; }
  }
  if (!best) return ghostHome(car);
  car.route = [lotOutPiece(L.bx, L.by, L.rot, L.k, bestEnt), ...roadPieces(g, best.steps, Math.random() < 0.5 ? 0 : 1), houseInPiece(home.x, home.y, home.b.rot)];
  return true;
}

// A destination was rotated or its gate flipped: put its cars on the new lot. Parked cars sit in their bay on the new layout;
// cars still driving in finish their (ghost) route and are re-seated on arrival (see updateSim).
export function reseatCar(car, d) {
  car.homeRoute = null;                                          // the old way home no longer fits the new lot
  car.lot = { bx: d.x, by: d.y, rot: d.rot, ent: gateOf(d), k: car.slot };
  const p = lotInPiece(d.x, d.y, d.rot, gateOf(d), car.slot);
  car.route = [p]; car.idx = 0; car.s = p.len; car.v = 0; car.stuck = 0;
  pointAt(p, p.len, car);
}
export function reseatCarsOf(g, d) {
  for (const car of g.cars) if (car.dest === d && car.state === 'dwell') reseatCar(car, d);
}

function start(car, state) {
  car.state = state; car.idx = 0; car.s = 0; car.v = 0;
  pointAt(car.route[0], 0, car);
}

let lastLeader = null;
function leaderGap(car, occ) {
  let ahead = -car.s, best = Infinity;
  lastLeader = null;
  const last = Math.min(car.route.length, car.idx + 4);
  for (let j = car.idx; j < last; j++) {
    const p = car.route[j], list = occ.get(p.key);
    if (list) for (const o of list) {
      if (o === car) continue;
      if (j === car.idx && (o.s < car.s || (o.s === car.s && o.id < car.id))) continue;
      const gap = ahead + o.s - CAR_LEN;
      if (gap < best) { best = gap; lastLeader = o; }
    }
    ahead += p.len;
  }
  return best;
}

// Held cars form a "waits-for" graph (car -> the car it waits on). A closed loop of stopped cars is a
// deadlock no static rule can untangle, so one car in the loop gets a short priority override.
// Prefer a car held only by a rule-based "you outrank me" check: the other car hasn't entered yet, so releasing it is safe.
function breakDeadlocks(g, list) {
  const byId = new Map(list.map(c => [c.id, c]));
  const waitsOn = c => (c.hold && c.why && c.why.includes(':') ? byId.get(+c.why.split(':')[1]) : null) || null;
  const seen = new Set();
  for (const start of list) {
    if (seen.has(start)) continue;
    const path = [];
    let c = start;
    while (c && !seen.has(c) && !path.includes(c)) { path.push(c); c = waitsOn(c); }
    if (c && path.includes(c)) {
      const loop = path.slice(path.indexOf(c));
      if (loop.every(x => x.v < 0.05)) {
        const pick = loop.find(x => x.why.startsWith('outranked')) || loop.find(x => x.why.startsWith('chain'));
        if (pick) pick.force = 2;
        else if (loop.every(x => x.why.startsWith('inside') && x.stuck > 1.5)) {
          // Two cars each inside a different junction tile wanting the other's: they swap in opposite lanes.
          const lo = loop.reduce((a, b) => (a.id < b.id ? a : b));
          lo.ignoreAll = false; lo.ignoreId = +lo.why.split(':')[1]; lo.ignoreT = 2;
        }
      }
    }
    path.forEach(x => seen.add(x));
  }
}

// A parking lot is one space shared by both entrances, so its pieces key on the building, not the tile.
const tileKey = p => (p.kind === 'road' ? p.tx + ',' + p.ty : p.kind === 'lot_in' || p.kind === 'lot_out' ? 'L' + p.bx + ',' + p.by : null);
const moving = car => car.state === 'out' || car.state === 'back';

// Work out, for every car about to enter a junction/lot, whether it must hold at the stop line.
function analyse(g, occ) {
  const jc = new Map(), inside = new Map(), waiting = new Map(), claims = new Set(), list = [];
  const { braking } = tuning.cars;
  for (const car of g.cars) {
    if (!moving(car)) continue;
    const k = tileKey(car.route[car.idx]);
    if (k) (inside.get(k) || inside.set(k, []).get(k)).push(car);
    for (let j = 1; j <= 2; j++) {                              // a car two pieces from a lot has claimed it
      const p = car.route[car.idx + j];
      if (p && p.kind === 'lot_in') claims.add(tileKey(p));
    }
  }
  for (const car of g.cars) {
    car.entry = null; car.hold = false; car.inJ = false;
    car.holdT = Math.max(0, (car.holdT || 0) - 2 / 60);                // patience clock: runs while held, even if the car creeps
    if (car.force > 0) car.force -= 1 / 60;
    if (car.ignoreT > 0) car.ignoreT -= 1 / 60;
    if (!moving(car)) { car.arrKey = null; continue; }
    const cur = car.route[car.idx], nxt = car.route[car.idx + 1];
    car.inJ = cur.kind === 'road' && junctionAt(g, cur.tx, cur.ty, jc).junction;
    let J = null;
    if (nxt && nxt.kind === 'road') { const j = junctionAt(g, nxt.tx, nxt.ty, jc); if (j.junction) J = j; }
    else if (nxt && nxt.kind === 'lot_in') J = { kind: 'lot', n: 0 };
    if (!J) { car.arrKey = null; continue; }
    const dist = cur.len - car.s, stopDist = car.v * car.v / (2 * braking);
    if (dist > Math.max(0.7, stopDist + 0.45)) { car.arrKey = null; continue; }
    if (car.arrKey !== nxt.key) { car.arrKey = nxt.key; car.arrT = g.time; car.stopT = 0; }
    const stopAt = dist - STOP_OFFSET;
    car.commit = stopAt < -0.05 || stopDist > stopAt + 0.05;      // too close/fast to stop: it goes
    car.entry = { J, q: nxt, dist, key: tileKey(nxt) };
    // A signal: stop on red, and on yellow if there's room to stop. A car stopped at a red must not outrank cars that have green.
    car.sigRed = false;
    if (J.light) {
      const col = lightColor(g.time, J.groups, nxt.in);
      // US rules: a right turn may go on red when nothing conflicts (the normal conflict logic still applies to it).
      car.sigRed = (col === 'red' || (col === 'yellow' && !car.commit)) && nxt.turn !== 'right';
    }
    // Stop-sign junctions: come to a full stop at the line first (4-way, or the stem of a T).
    car.needsStop = J.kind === 'road' && !J.light && !J.round && (J.n === 4 || (J.n === 3 && nxt.in === J.stem)) && !(J.houseSides && J.houseSides.includes(nxt.in)) && !car.commit;
    if (!car.sigRed) (waiting.get(car.entry.key) || waiting.set(car.entry.key, []).get(car.entry.key)).push(car);
    list.push(car);
  }
  for (const car of list) {
    const { J, q, dist, key } = car.entry;
    let blocked = false;
    car.why = null;
    if (car.sigRed) { blocked = true; car.why = 'light'; }
    else if (car.needsStop && car.stopT < tuning.junctions.stopSeconds) { blocked = true; car.why = 'stop'; }
    if (!blocked) for (const o of inside.get(key) || []) {
      if (o !== car && !(car.ignoreT > 0 && (car.ignoreAll || o.id === car.ignoreId)) && pieceConflict(q, o.route[o.idx], o.s)) { blocked = true; car.why = 'inside:' + o.id; break; }
    }
    if (!blocked) for (const o of waiting.get(key) || []) {
      // A roundabout only yields to traffic already circulating (the 'inside' check above) or about to enter right now,
      // never to a car that is merely on its way: that would make it behave like a stop sign.
      if (J.round && !o.commit && o.entry.dist - STOP_OFFSET > 0.3) continue;
      if (o !== car && (!(car.force > 0) || (o.commit && !(o.v < 0.3 && Math.max(car.stuck, car.holdT || 0) > tuning.gridlock.warnAfterSeconds * 1.3))) && pieceConflict(q, o.entry.q, 0) && outranks(o, car, J)) { blocked = true; car.why = 'outranked:' + o.id; break; }
    }
    // Never end up waiting *inside* a junction: the whole chain of junction/lot pieces ahead must be
    // clear too (cars already inside, or earlier arrivals), plus room for the car beyond the last one.
    if (!blocked && J.kind === 'road') {
      let total = dist + q.len;
      for (let j = 2; j <= 4 && !blocked && !(car.force > 0); j++) {
        const X = car.route[car.idx + j];
        if (!X) break;
        let XJ = X.kind === 'lot_in', lit = null;
        if (X.kind === 'road') { const jx = junctionAt(g, X.tx, X.ty, jc); XJ = jx.junction; if (jx.light) lit = jx; }
        if (!XJ) break;
        // A signal further on: don't enter this tile unless that light will still be green when we reach it,
        // otherwise we'd end up parked inside this junction waiting on it and block the cross traffic.
        // Only the very next tile, and only if this tile has no light of its own: with one shared clock, a light two tiles on
        // (or one beyond another light) can be red exactly when ours is green, which would make the car wait for the impossible.
        if (lit && j === 2 && !J.light && X.turn !== 'right' && !car.inJ) {                      // (a car already inside can't un-enter, so only outside cars wait)
          const { greenSeconds } = tuning.trafficLight, margin = Math.min(3.5, greenSeconds * 0.6);
          if (lightColor(g.time, lit.groups, X.in) !== 'green' || lightColor(g.time + margin, lit.groups, X.in) !== 'green') { blocked = true; car.why = 'chain-light'; break; }
        }
        const xk = tileKey(X);
        for (const o of inside.get(xk) || []) if (pieceConflict(X, o.route[o.idx], o.s)) { blocked = true; car.why = 'chain-inside:' + o.id; break; }
        if (!blocked) for (const o of waiting.get(xk) || []) {
          if (o !== car && !(car.inJ && !o.inJ) && (o.inJ !== car.inJ || o.arrT < car.arrT) && pieceConflict(X, o.entry.q, 0)) { blocked = true; car.why = 'chain-earlier:' + o.id; break; }
        }
        total += X.len;
      }
      // Room beyond the junction? A leader that is rolling will clear the space by the time we get there, so only a
      // (nearly) stopped one counts as real spillback. Otherwise a platoon would creep through a green one car at a time.
      if (!blocked) {
        const gap = leaderGap(car, occ);
        const rolling = lastLeader && lastLeader.v > 1.0 && gap > 0.22;
        if (gap < total + 0.08 && !rolling && !(car.force > 0)) { blocked = true; car.why = 'box:' + (lastLeader ? lastLeader.id : 0); }
      }
    }
    car.hold = blocked && !car.commit;
    if (car.hold) car.holdT += 3 / 60;
    const patience = Math.max(car.stuck, car.holdT);
    // Patience: stuck a long time purely because waiting for a downstream light (nothing physical in the way)? Stop deferring to it for a moment.
    // Patience ladder. Cars that have been stuck for a long time waiting on other cars (never on a red light or their stop-sign timer)
    // stop deferring: first to the junction-chain / room-beyond / priority rules, then to a car that is physically inside. A brief
    // overlap in a jam is better than a permanent gridlock that snowballs across the map.
    if (car.hold && patience > tuning.gridlock.warnAfterSeconds * 0.8) {
      const w = (car.why || '').split(':')[0];
      if (w === 'chain-light' || w === 'chain-inside' || w === 'chain-earlier' || w === 'box' || w === 'outranked') car.force = 2;
      else if (w === 'inside' && patience > tuning.gridlock.warnAfterSeconds * 1.3) { car.ignoreAll = true; car.ignoreT = 2; }      // (one blocker at a time just swaps it for the next car in the box)
    }
  }
  breakDeadlocks(g, list);
  return { inside, claims };
}

// Advance the sim by dt seconds. Returns true if something the HUD shows changed.
export function updateSim(g, dt) {
  g.time += dt;
  let changed = false;
  const occ = new Map();
  for (const car of g.cars) {
    if (!moving(car)) continue;
    const k = car.route[car.idx].key;
    (occ.get(k) || occ.set(k, []).get(k)).push(car);
  }
  const { inside, claims } = analyse(g, occ);
  const { acceleration, braking, minGapTiles } = tuning.cars;

  for (const car of g.cars) {
    if (car.state === 'home') {
      car.cooldown -= dt;
      if (car.cooldown <= 0) {
        if (planOut(g, car)) start(car, 'out');
        else car.cooldown = 0.5;
      }
    } else if (car.state === 'dwell') {
      car.dwell -= dt;
      if (car.dwell <= 0) {
        const lk = 'L' + car.lot.bx + ',' + car.lot.by;
        if ((inside.get(lk) || []).length || claims.has(lk)) car.dwell = 0.1;          // lot is busy or claimed
        else if (planBack(g, car)) {
          car.dest.slots[car.slot] = null; car.dest = null; start(car, 'back');
          (inside.get(lk) || inside.set(lk, []).get(lk)).push(car);          // lot is busy for the next car this very tick
        }
        else car.dwell = 0.5;
      }
    } else {
      let p = car.route[car.idx];
      const gap = leaderGap(car, occ);
      let target = Math.min(pieceSpeed(p), Math.sqrt(2 * braking * Math.max(0, gap - minGapTiles)));
      if (car.entry) target = Math.min(target, tuning.speed.junctionApproach);     // everyone slows for a junction, so a fast road never outruns its stopping distance
      if (car.hold && car.entry) target = Math.min(target, Math.sqrt(2 * braking * Math.max(0, car.entry.dist - STOP_OFFSET)));
      if (car.needsStop && car.entry && car.v < 0.15 && car.entry.dist - STOP_OFFSET < 0.12) car.stopT += dt;   // standing at the line
      car.v += Math.max(-braking * dt, Math.min(acceleration * dt, target - car.v));
      car.s += car.v * dt;
      let arrived = false;
      while (car.s >= p.len) {
        car.s -= p.len; car.idx++;
        if (car.idx >= car.route.length) { arrived = true; break; }
        p = car.route[car.idx];
      }
      if (arrived) {
        if (car.state === 'out' && car.dest && (car.lot.rot !== car.dest.rot || car.lot.ent !== gateOf(car.dest))) reseatCar(car, car.dest);     // the lot was rotated while we drove in
        const last = car.route[car.route.length - 1];
        pointAt(last, last.len, car);
        car.v = 0; car.route = [last]; car.idx = 0; car.s = last.len; car.stuck = 0; car.hold = false; car.entry = null;
        if (car.state === 'out') { car.state = 'dwell'; car.dwell = tuning.trips.parkedSeconds; }
        else {
          const t = tuning.trips;
          car.state = 'home'; car.homeRoute = null; car.cooldown = t.homeCooldownMinSeconds + Math.random() * (t.homeCooldownMaxSeconds - t.homeCooldownMinSeconds);
          g.trips++; g.money += t.rewardPerTrip; changed = true;
        }
      } else {
        const pt = pointAt(p, car.s, { x: 0, y: 0, a: 0 });
        car.x = pt.x; car.y = pt.y;
        let da = pt.a - car.a; da = Math.atan2(Math.sin(da), Math.cos(da));
        const m = TURN_RATE * dt;
        car.a += Math.max(-m, Math.min(m, da));
        car.stuck = car.v < 0.05 ? car.stuck + dt : 0;
      }
    }
  }
  return changed;
}
