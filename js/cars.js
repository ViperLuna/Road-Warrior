// One car per house. Round trip: house -> destination lot (park, dwell) -> house = 1 trip.
import { DIR, OPP, CAR_LEN, pointAt, roadPiece, houseOutPiece, houseInPiece, lotInPiece, lotOutPiece } from './lanes.js';
import { roadAt, tidx } from './network.js';
import { findPath } from './pathfind.js';
import { tuning } from './tuning.js';

const TURN_RATE = 12;

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

function leaderGap(car, occ) {
  let ahead = -car.s, best = Infinity;
  const last = Math.min(car.route.length, car.idx + 4);
  for (let j = car.idx; j < last; j++) {
    const p = car.route[j], list = occ.get(p.key);
    if (list) for (const o of list) {
      if (o === car) continue;
      if (j === car.idx && (o.s < car.s || (o.s === car.s && o.id < car.id))) continue;
      best = Math.min(best, ahead + o.s - CAR_LEN);
    }
    ahead += p.len;
  }
  return best;
}

// Advance the sim by dt seconds. Returns true if something the HUD shows changed.
export function updateSim(g, dt) {
  g.time += dt;
  let changed = false;
  const occ = new Map();
  for (const car of g.cars) {
    if (car.state !== 'out' && car.state !== 'back') continue;
    const k = car.route[car.idx].key;
    (occ.get(k) || occ.set(k, []).get(k)).push(car);
  }

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
        if (planBack(g, car)) { car.dest.slots[car.slot] = null; car.dest = null; start(car, 'back'); }
        else car.dwell = 0.5;
      }
    } else {
      let p = car.route[car.idx];
      const { acceleration, braking, minGapTiles } = tuning.cars;
      const gap = leaderGap(car, occ);
      const target = Math.min(pieceSpeed(p), Math.sqrt(2 * braking * Math.max(0, gap - minGapTiles)));
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
        car.v = 0; car.route = [last]; car.idx = 0; car.s = last.len;
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
      }
    }
  }
  return changed;
}
