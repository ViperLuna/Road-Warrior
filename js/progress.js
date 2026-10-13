// Spawn schedule, goals and rewards. Pure game logic: no DOM.
import { prog, milestones, roadsAvailable } from './progression.js';
import { roadConns } from './network.js';
import { accepts, destWeight } from './buildings.js';
import { spawnPair, spawnHouse, spawnHouseAcross, spawnPairAcross, findCrossings, spawnStadium, spawnPortal, EDGE_NAMES } from './spawn.js';
import { stadiumOf, gatesOf, gateConnected } from './outside.js';
import { findPath } from './pathfind.js';
import { roadAt } from './network.js';
import { DIR, OPP } from './lanes.js';

export function initProgress(g) {
  g.spawnCount = 0; g.nextSpawnAt = prog.spawns.firstAtTrips;
  g.goalCount = 0; g.nextGoalAt = prog.goals.firstAtTrips; g.prevGoalAt = 0;
  g.colorsUsed = 1; g.reward = null; g.unlocks = {};
}

const houseCount = g => g.buildings.filter(b => b.kind === 'house').length;
// (a two-colour destination counts as a destination for each of its colours)
// (a small destination counts as half of one)
const count = (g, kind, color) => g.buildings.filter(b => b.kind === kind && (kind === 'dest' ? accepts(b, color.id) : b.color.id === color.id)).reduce((n, b) => n + (kind === 'dest' ? destWeight(b) : 1), 0);

function anchorNear(g) {
  const a = g.buildings[(Math.random() * g.buildings.length) | 0];
  return { x: a.x, y: a.y, rMin: 3, rMax: 8 };
}

// How likely a spawn is to land across the water. Only when the player could connect it: a bridge in hand or
// already built over a gap, plus enough roads to cover the land on both sides. More spare bridges = more separation.
export function crossChance(g) {
  const items = (g.inv.bridge || 0) + (g.inv.tunnel || 0), roads = roadsAvailable(g);
  if (roads < 30) return 0;
  if (items > 0) return Math.min(0.6, 0.3 + 0.15 * items);
  return findCrossings(g).some(c => c.covered) ? 0.35 : 0;
}

// Chance that a new destination serves two colours: none until `afterTrips`, then `startChance`, climbing to `maxChance`
// over the next `rampTrips`. (progression.json -> spawns.dual; chance 0 turns it off.)
export function dualChance(g) {
  const d = prog.spawns.dual;
  if (!d || g.colorsUsed < 2 || g.trips < milestones.dual.afterTrips) return 0;
  const k = Math.max(0, Math.min(1, (g.trips - milestones.dual.afterTrips) / Math.max(1, d.rampTrips)));
  return d.startChance + (d.maxChance - d.startChance) * k;
}

// A two-colour destination: `color` plus another colour already in play. Both colours get a house placed well apart from each other,
// so their routes have to come together on the way in. Returns a description of what spawned, or null (nothing was placed).
function spawnDual(g, color) {
  if (!(Math.random() < dualChance(g))) return null;
  const sp = prog.spawns;
  const others = g.palette.slice(0, g.colorsUsed).filter(c => c.id !== color.id);
  if (!others.length) return null;
  const color2 = others[(Math.random() * others.length) | 0];
  for (let widen = 0; widen < 3; widen++) {
    const anchor = anchorNear(g); anchor.rMax += widen * 3;
    const made = spawnPair(g, color, { anchor, roads: sp.roadsNeeded, budget: roadsAvailable(g), color2 });
    if (!made) continue;
    const h = made.house, second = spawnHouse(g, color2, { near: made.dest, apart: { x: h.x, y: h.y, min: 5 }, roads: sp.roadsNeeded, budget: roadsAvailable(g) })
      || spawnHouse(g, color2, { near: made.dest, roads: sp.roadsNeeded, budget: roadsAvailable(g) });
    return { kind: 'dual', color, color2, n: second ? 3 : 2 };
  }
  return null;
}

// Returns a description of what spawned, or null if there was no room.
function doSpawn(g) {
  const sp = prog.spawns, i = g.spawnCount + 1;
  let color, kind;
  if (i <= sp.sameColorSpawns) color = g.palette[0];
  else if (g.colorsUsed < g.palette.length && (i - sp.sameColorSpawns - 1) % sp.newColorEverySpawns === 0) { color = g.palette[g.colorsUsed]; kind = 'newColor'; }
  if (!color) {                                           // existing colour with the fewest houses per destination
    const pool = g.palette.slice(0, g.colorsUsed);
    const load = c => count(g, 'house', c) / Math.max(1, count(g, 'dest', c));
    const best = Math.min(...pool.map(load));
    const low = pool.filter(c => load(c) === best);
    color = low[(Math.random() * low.length) | 0];
  }
  const dests = count(g, 'dest', color), houses = count(g, 'house', color);
  const room = sp.maxHousesPerDestination * dests - houses;
  if (kind !== 'newColor') kind = room >= 1 ? 'houses' : 'combo';

  const across = () => ({ items: { bridge: g.inv.bridge || 0, tunnel: g.inv.tunnel || 0 }, budget: roadsAvailable(g) - 10 });
  const p = crossChance(g);

  if (kind === 'houses') {
    let made = 0, over = null;
    for (let k = 0; k < Math.min(sp.housesPerSpawn, room); k++) {
      if (Math.random() < p) { const r = spawnHouseAcross(g, color, across()); if (r) { made++; over = over || r; continue; } }
      if (spawnHouse(g, color, { roads: sp.roadsNeeded, budget: roadsAvailable(g) })) made++;
    }
    return made ? { kind, color, n: made, across: !!over, needsBridge: !!(over && over.needsBridge) } : null;
  }
  if (kind === 'combo') { const r = spawnDual(g, color); if (r) return r; }       // sometimes the new destination serves two colours
  if (Math.random() < p) {                                   // new colour with its house on the far bank
    const r = spawnPairAcross(g, color, { anchor: anchorNear(g), ...across() });
    if (r) { if (kind === 'newColor') g.colorsUsed++; return { kind, color, n: 2, across: true, needsBridge: r.needsBridge }; }
  }
  for (let widen = 0; widen < 3; widen++) {
    const anchor = anchorNear(g); anchor.rMax += widen * 3;
    const smallFirst = Math.random() < ((sp.small && sp.small.chance) || 0);        // a small destination is tried first some of the time, and whenever a big one does not fit
    if ([smallFirst, !smallFirst].some(small => spawnPair(g, color, { anchor, roads: sp.roadsNeeded, budget: roadsAvailable(g), small }))) {
      if (kind === 'newColor') g.colorsUsed++;
      return { kind, color, n: 2 };
    }
  }
  return null;
}

// Weighted pick among enabled specials, or null if none are available.
// Is there a straight 4-way crossing an overpass could go on?
function hasCrossing(g) {
  for (const [k, r] of g.roads) {
    if (r.special || r.overpass !== undefined || r.bridge || r.tunnel) continue;
    const x = k % g.cols, y = (k / g.cols) | 0;
    if (roadConns(g, x, y).length === 4) return true;
  }
  return false;
}

function pickSpecial(g) {
  const hills = !!(g.terrain && g.terrain.hasHill);
  const list = prog.specials.filter(s => s.enabled && !(s.unlock && g.unlocks[s.id]) && !(s.requires === 'hill' && !hills) && !(s.requires === 'highway' && !((g.inv.highway || 0) > 0 || [...g.roads.values()].some(r => r.lanes === 4))) && !(s.requires === 'crossing' && !hasCrossing(g)));
  if (!list.length) return null;
  let r = Math.random() * list.reduce((a, s) => a + (s.weight || 1), 0);
  for (const s of list) if ((r -= s.weight || 1) <= 0) return s;
  return list[0];
}

// Is the player's network really serving every colour? Each colour in play needs a house with a road to a destination that takes it
// (the stadium does not count), and nearly all houses overall (a brand-new house still waiting for its road is fine).
export function coloursConnected(g, share = 0.9) {
  let total = 0, ok = 0;
  const served = new Set();
  for (const h of g.buildings) {
    if (h.kind !== 'house') continue;
    total++;
    const rx = h.x + DIR[h.rot][0], ry = h.y + DIR[h.rot][1];
    if (!roadAt(g, rx, ry)) continue;
    const goals = [...g.ports.values()].filter(p => p.b.kind === 'dest' && !p.b.stadium && accepts(p.b, h.color.id));
    if (goals.length && findPath(g, rx, ry, OPP[h.rot], goals)) { ok++; served.add(h.color.id); }
  }
  return g.palette.slice(0, g.colorsUsed).every(c => served.has(c.id)) && ok >= share * total;
}

// The stadium (3k trips, big maps, once every colour is in play), then the side-road gates (4k trips, one at a time, one per edge,
// each only once the last one reaches the stadium and every house is connected). Returns nothing; reports through notify.
function spawnOutsideThings(g, notify) {
  const st = milestones.stadium, po = { ...prog.spawns.portals, ...milestones.portals };
  if (st && !stadiumOf(g)) {
    if (g.trips >= st.afterTrips && st.maps.includes(g.map.id) && g.colorsUsed >= g.palette.length && !(g.nextStadiumTry > g.trips)) {
      const d = spawnStadium(g, { budget: roadsAvailable(g) });
      if (d) notify({ type: 'stadium', x: d.x, y: d.y });
      else g.nextStadiumTry = g.trips + 10;
    }
    return;
  }
  const arena = stadiumOf(g), gates = gatesOf(g);
  if (!po || !arena || g.trips < po.afterTrips || gates.length >= Math.min(4, po.maxCount) || g.trips < (g.nextPortalAt ?? 0)) return;
  g.nextPortalAt = g.trips + 5;                                                   // (checking costs a few path searches: not every trip)
  if (!gates.every(p => gateConnected(g, p, arena)) || !coloursConnected(g)) return;
  const used = new Set(gates.map(p => (p.rot + 2) % 4)), free = [0, 1, 2, 3].filter(e => !used.has(e));
  for (let i = free.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [free[i], free[j]] = [free[j], free[i]]; }
  for (const edge of free) {
    const p = spawnPortal(g, edge, arena, { budget: roadsAvailable(g) });
    if (p) { g.nextPortalAt = g.trips + po.everyTrips; notify({ type: 'portal', edge, name: EDGE_NAMES[edge], first: gates.length === 0 }); return; }
  }
}

// Call after trips change. Spawns anything that's due; opens the reward menu if a goal was reached.
export function checkProgress(g, notify) {
  const sp = prog.spawns;
  while (g.trips >= g.nextSpawnAt) {
    const r = doSpawn(g);
    if (!r) { g.nextSpawnAt += 2; break; }                // no room right now; try again soon
    g.spawnCount++;
    g.nextSpawnAt = g.trips + Math.max(sp.minEveryTrips, Math.round(houseCount(g) * sp.tripsPerHouse));
    notify({ type: 'spawn', ...r });
  }
  spawnOutsideThings(g, notify);
  if (g.mode === 'play' && g.trips >= g.nextGoalAt) {
    const special = pickSpecial(g);
    g.goalCount++;
    g.prevGoalAt = g.trips;
    g.nextGoalAt = g.trips + Math.max(prog.goals.minIncrement, Math.round(houseCount(g) * prog.goals.tripsPerHouse));
    if (!special) { g.money += prog.goals.cashPlain; notify({ type: 'cash', n: prog.goals.cashPlain }); return; }
    g.reward = {
      goal: g.goalCount,
      options: [
        { id: 'plain', cash: prog.goals.cashPlain },
        { id: 'special', cash: prog.goals.cashWithSpecial, special },
      ],
    };
    g.mode = 'reward';
  }
}

export function chooseReward(g, optionId) {
  const opt = g.reward && g.reward.options.find(o => o.id === optionId);
  if (!opt) return false;
  g.money += opt.cash;
  if (opt.special) {
    if (opt.special.unlock) g.unlocks[opt.special.id] = true;                 // permanent unlock (e.g. one-way streets)
    else g.inv[opt.special.id] = (g.inv[opt.special.id] || 0) + (opt.special.grant || 1);
  }
  g.reward = null;
  g.mode = 'play';
  return true;
}
