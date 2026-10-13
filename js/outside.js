// The outside world: side-road gates on the map edge send visitors of any colour to the stadium, faster and faster.
// A visitor is a car with no house (`car.outside`): it drives gate -> stadium gate, stays a while, drives back to its gate and is gone.
import { tuning } from './tuning.js';
import { launchOutside } from './cars.js';
import { findPath } from './pathfind.js';
import { roadAt } from './network.js';
import { DIR, OPP } from './lanes.js';
import { exitTile } from './buildings.js';

export const stadiumOf = g => g.buildings.find(b => b.stadium) || null;
export const gatesOf = g => g.buildings.filter(b => b.kind === 'portal');

// Can a car leave `gate` for the stadium over the roads that exist now?
export function gateConnected(g, gate, stadium = stadiumOf(g)) {
  if (!stadium) return false;
  const rx = gate.x + DIR[gate.rot][0], ry = gate.y + DIR[gate.rot][1];
  if (!roadAt(g, rx, ry)) return false;
  return !!findPath(g, rx, ry, OPP[gate.rot], [...g.ports.values()].filter(p => p.b === stadium));
}

// Seconds between visitors now: starts at startIntervalSeconds and shrinks by decayPerMinute every minute since the first one came.
export function visitorInterval(g) {
  const o = tuning.outside, minutes = g.outsideSince === undefined ? 0 : Math.max(0, (g.time - g.outsideSince) / 60);
  return Math.max(o.minIntervalSeconds, o.startIntervalSeconds * Math.pow(o.decayPerMinute, minutes));
}

export function resetOutside(g) {
  g.outsideSince = undefined; g.nextOutsideAt = undefined;
  g.hordeAt = undefined; g.hordeLeft = 0; g.hordeCount = 0; g.hordeNextCar = 0; g.hordeDeadline = 0;
}

const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const rand = (a, b) => a + Math.random() * (b - a);

// Send one visitor out of a random gate that has a road to the stadium and a clear driveway. Returns the car or null.
function launchOne(g, gates) {
  const colors = g.palette.slice(0, Math.max(1, g.colorsUsed));
  for (const gate of shuffle(gates.slice())) {
    if (g.cars.some(c => c.house === gate && c.state === 'out' && c.idx === 0 && c.s < 0.7)) continue;      // the previous visitor is still pulling out
    const car = launchOutside(g, gate, colors[(Math.random() * colors.length) | 0]);
    if (car) return car;
  }
  return null;
}

// A horde (an "event"): every so often a crowd of visitors comes out of the gates one after another, far faster than the steady trickle,
// and fills the stadium. Each one is bigger than the last. Timing and size: tuning.outside.horde.
function stepHorde(g, gates, notify) {
  const h = tuning.outside.horde;
  if (g.hordeLeft > 0) {
    if (g.time >= g.hordeDeadline) { g.hordeLeft = 0; }                                    // the stadium filled up or the roads would not take them: the rest turn back
    else if (g.time >= g.hordeNextCar) {
      if (launchOne(g, gates)) { g.hordeLeft--; g.hordeNextCar = g.time + h.spacingSeconds * (0.7 + Math.random() * 0.6); }
      else g.hordeNextCar = g.time + 0.5;
    }
    if (g.hordeLeft <= 0) g.hordeAt = g.time + rand(h.everyMinutes[0], h.everyMinutes[1]) * 60;
    return;
  }
  if (g.hordeAt === undefined || g.time < g.hordeAt) return;
  const size = Math.min(h.sizeMax, Math.round(h.sizeStart + h.sizeGrowth * g.hordeCount));
  g.hordeLeft = size; g.hordeCount++; g.hordeNextCar = g.time; g.hordeDeadline = g.time + size * h.spacingSeconds * 1.5 + h.giveUpSeconds;
  notify({ type: 'horde', size });
}

// Called every tick while playing.
export function stepOutside(g, dt, notify = () => {}) {
  const arena = stadiumOf(g), gates = gatesOf(g);
  if (!arena || !gates.length) return;
  if (g.hordeLeft > 0 || g.hordeAt !== undefined) stepHorde(g, gates, notify);
  if (g.nextOutsideAt !== undefined && g.time < g.nextOutsideAt) return;
  if (g.cars.reduce((n, c) => n + (c.outside ? 1 : 0), 0) >= tuning.outside.maxVisitors) { g.nextOutsideAt = g.time + 1; return; }
  const car = launchOne(g, gates);
  if (!car) { g.nextOutsideAt = g.time + 1; return; }                    // no gate has a road to the stadium (or it is full): look again soon
  if (g.outsideSince === undefined) {                                       // the first visitor starts both clocks
    g.outsideSince = g.time;
    g.hordeAt = g.time + tuning.outside.horde.firstAfterMinutes * 60;
  }
  g.nextOutsideAt = g.time + visitorInterval(g) * (0.7 + Math.random() * 0.6);
}
