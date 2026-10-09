// One car per house. Round trip: house -> destination lot (park, dwell) -> house = 1 trip.
import { DIR, OPP, CAR_LEN, pointAt, roadPiece, houseOutPiece, houseInPiece, lotInPiece, lotOutPiece } from './lanes.js';
import { roadAt, tidx } from './network.js';
import { findPath } from './pathfind.js';
import { tuning } from './tuning.js';
import { junctionAt, pieceConflict, outranks } from './junction.js';

const TURN_RATE = 12;
const STOP_OFFSET = CAR_LEN / 2 + 0.06;       // where a held car's centre stops, back from the junction edge

// Target speed (tiles/s) for a piece: lane-count base speed x movement-type factor.
function pieceSpeed(p) {
  const sp = tuning.speed;
  if (p.kind === 'road') {
    const base = p.lanes === 4 ? sp.fourLane : sp.twoLane;
    return base * (p.turn === 'right' ? sp.rightTurnFactor : p.turn === 'left' ? sp.leftTurnFactor : 1);
  }
  return sp.twoLane * (p.kind.startsWith('house') ? sp.drivewayFactor : sp.parkingLotFactor);
}

export function createCar(house) {
  return {
    id: house.id, house, color: house.color, state: 'home', route: [], idx: 0, s: 0, v: 0,
    x: 0, y: 0, a: 0, dest: null, slot: -1, lot: null, dwell: 0, cooldown: 1 + Math.random() * 1.5,
    arrKey: null, arrT: 0, entry: null, commit: false, inJ: false, hold: false, force: 0, ignoreId: 0, ignoreT: 0, why: null, stuck: 0,
  };
}

const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const roadPieces = steps => steps.map(s => roadPiece(s.x, s.y, s.in, s.out));

function planOut(g, car) {
  const b = car.house, D = DIR[b.rot];
  const rx = b.x + D[0], ry = b.y + D[1];
  if (!roadAt(g, rx, ry)) return false;
  const dests = shuffle(g.buildings.filter(d => d.kind === 'dest' && d.color.id === b.color.id && d.slots.includes(null)));
  for (const d of dests) {
    const goals = [];
    for (const port of g.ports.values()) {
      if (port.b !== d) continue;
      if (d.slots[port.lot * 2] === null || d.slots[port.lot * 2 + 1] === null) goals.push(port);
    }
    const res = findPath(g, rx, ry, OPP[b.rot], goals);
    if (!res) continue;
    const base = res.port.lot * 2;
    const free = [0, 1].filter(p => d.slots[base + p] === null);
    const par = free[(Math.random() * free.length) | 0];
    d.slots[base + par] = car;
    car.dest = d; car.slot = base + par; car.lot = { x: res.port.x, y: res.port.y, rot: d.rot, par };
    car.route = [houseOutPiece(b.x, b.y, b.rot), ...roadPieces(res.steps), lotInPiece(res.port.x, res.port.y, d.rot, par)];
    return true;
  }
  return false;
}

function planBack(g, car) {
  const L = car.lot, D = DIR[L.rot];
  const rx = L.x + D[0], ry = L.y + D[1];
  const home = g.ports.get(tidx(g, car.house.x, car.house.y));
  if (!home || !roadAt(g, rx, ry)) return false;
  const res = findPath(g, rx, ry, OPP[L.rot], [home]);
  if (!res) return false;
  car.route = [lotOutPiece(L.x, L.y, L.rot, L.par), ...roadPieces(res.steps), houseInPiece(home.x, home.y, home.b.rot)];
  return true;
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
          lo.ignoreId = +lo.why.split(':')[1]; lo.ignoreT = 2;
        }
      }
    }
    path.forEach(x => seen.add(x));
  }
}

const tileKey = p => (p.kind === 'road' || p.kind === 'lot_in' || p.kind === 'lot_out' ? p.tx + ',' + p.ty : null);
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
    if (car.force > 0) car.force -= 1 / 60;
    if (car.ignoreT > 0) car.ignoreT -= 1 / 60;
    if (!moving(car)) { car.arrKey = null; continue; }
    const cur = car.route[car.idx], nxt = car.route[car.idx + 1];
    car.inJ = cur.kind === 'road' && junctionAt(g, cur.tx, cur.ty, jc).n >= 3;
    let J = null;
    if (nxt && nxt.kind === 'road') { const j = junctionAt(g, nxt.tx, nxt.ty, jc); if (j.n >= 3) J = j; }
    else if (nxt && nxt.kind === 'lot_in') J = { kind: 'lot', n: 0 };
    if (!J) { car.arrKey = null; continue; }
    const dist = cur.len - car.s, stopDist = car.v * car.v / (2 * braking);
    if (dist > Math.max(0.7, stopDist + 0.45)) { car.arrKey = null; continue; }
    if (car.arrKey !== nxt.key) { car.arrKey = nxt.key; car.arrT = g.time; }
    const stopAt = dist - STOP_OFFSET;
    car.commit = stopAt < -0.05 || stopDist > stopAt + 0.05;      // too close/fast to stop: it goes
    car.entry = { J, q: nxt, dist, key: tileKey(nxt) };
    (waiting.get(car.entry.key) || waiting.set(car.entry.key, []).get(car.entry.key)).push(car);
    list.push(car);
  }
  for (const car of list) {
    const { J, q, dist, key } = car.entry;
    let blocked = false;
    car.why = null;
    for (const o of inside.get(key) || []) {
      if (o !== car && !(car.ignoreT > 0 && o.id === car.ignoreId) && pieceConflict(q, o.route[o.idx], o.s)) { blocked = true; car.why = 'inside:' + o.id; break; }
    }
    if (!blocked) for (const o of waiting.get(key) || []) {
      if (o !== car && (!(car.force > 0) || o.commit) && pieceConflict(q, o.entry.q, 0) && outranks(o, car, J)) { blocked = true; car.why = 'outranked:' + o.id; break; }
    }
    // Never end up waiting *inside* a junction: the whole chain of junction/lot pieces ahead must be
    // clear too (cars already inside, or earlier arrivals), plus room for the car beyond the last one.
    if (!blocked && J.kind === 'road') {
      let total = dist + q.len;
      for (let j = 2; j <= 4 && !blocked && !(car.force > 0); j++) {
        const X = car.route[car.idx + j];
        if (!X) break;
        let XJ = X.kind === 'lot_in';
        if (X.kind === 'road') XJ = junctionAt(g, X.tx, X.ty, jc).n >= 3;
        if (!XJ) break;
        const xk = tileKey(X);
        for (const o of inside.get(xk) || []) if (pieceConflict(X, o.route[o.idx], o.s)) { blocked = true; car.why = 'chain-inside:' + o.id; break; }
        if (!blocked) for (const o of waiting.get(xk) || []) {
          if (o !== car && !(car.inJ && !o.inJ) && (o.inJ !== car.inJ || o.arrT < car.arrT) && pieceConflict(X, o.entry.q, 0)) { blocked = true; car.why = 'chain-earlier:' + o.id; break; }
        }
        total += X.len;
      }
      if (!blocked && leaderGap(car, occ) < total + 0.08) { blocked = true; car.why = 'box:' + (lastLeader ? lastLeader.id : 0); }
    }
    car.hold = blocked && !car.commit;
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
        const lk = car.lot.x + ',' + car.lot.y;
        if ((inside.get(lk) || []).length || claims.has(lk)) car.dwell = 0.1;          // lot is busy or claimed
        else if (planBack(g, car)) { car.dest.slots[car.slot] = null; car.dest = null; start(car, 'back'); }
        else car.dwell = 0.5;
      }
    } else {
      let p = car.route[car.idx];
      const gap = leaderGap(car, occ);
      let target = Math.min(pieceSpeed(p), Math.sqrt(2 * braking * Math.max(0, gap - minGapTiles)));
      if (car.hold && car.entry) target = Math.min(target, Math.sqrt(2 * braking * Math.max(0, car.entry.dist - STOP_OFFSET)));
      car.v += Math.max(-braking * dt, Math.min(acceleration * dt, target - car.v));
      car.s += car.v * dt;
      let arrived = false;
      while (car.s >= p.len) {
        car.s -= p.len; car.idx++;
        if (car.idx >= car.route.length) { arrived = true; break; }
        p = car.route[car.idx];
      }
      if (arrived) {
        const last = car.route[car.route.length - 1];
        pointAt(last, last.len, car);
        car.v = 0; car.route = [last]; car.idx = 0; car.s = last.len; car.stuck = 0; car.hold = false; car.entry = null;
        if (car.state === 'out') { car.state = 'dwell'; car.dwell = tuning.trips.parkedSeconds; }
        else {
          const t = tuning.trips;
          car.state = 'home'; car.cooldown = t.homeCooldownMinSeconds + Math.random() * (t.homeCooldownMaxSeconds - t.homeCooldownMinSeconds);
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
