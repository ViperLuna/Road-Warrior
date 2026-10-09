// Spawn schedule, goals and rewards. Pure game logic: no DOM.
import { prog } from './progression.js';
import { spawnPair, spawnHouse, spawnHouseAcross, spawnPairAcross, findCrossings } from './spawn.js';

export function initProgress(g) {
  g.spawnCount = 0; g.nextSpawnAt = prog.spawns.firstAtTrips;
  g.goalCount = 0; g.nextGoalAt = prog.goals.firstAtTrips; g.prevGoalAt = 0;
  g.colorsUsed = 1; g.reward = null; g.unlocks = {};
}

const houseCount = g => g.buildings.filter(b => b.kind === 'house').length;
const count = (g, kind, color) => g.buildings.filter(b => b.kind === kind && b.color.id === color.id).length;

function anchorNear(g) {
  const a = g.buildings[(Math.random() * g.buildings.length) | 0];
  return { x: a.x, y: a.y, rMin: 3, rMax: 8 };
}

// How likely a spawn is to land across the water. Only when the player could connect it: a bridge in hand or
// already built over a gap, plus enough roads to cover the land on both sides. More spare bridges = more separation.
export function crossChance(g) {
  const items = (g.inv.bridge || 0) + (g.inv.tunnel || 0), roads = g.inv.road || 0;
  if (roads < 30) return 0;
  if (items > 0) return Math.min(0.6, 0.3 + 0.15 * items);
  return findCrossings(g).some(c => c.covered) ? 0.35 : 0;
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

  const across = () => ({ items: { bridge: g.inv.bridge || 0, tunnel: g.inv.tunnel || 0 }, budget: (g.inv.road || 0) - 10 });
  const p = crossChance(g);

  if (kind === 'houses') {
    let made = 0, over = null;
    for (let k = 0; k < Math.min(sp.housesPerSpawn, room); k++) {
      if (Math.random() < p) { const r = spawnHouseAcross(g, color, across()); if (r) { made++; over = over || r; continue; } }
      if (spawnHouse(g, color, { roads: sp.roadsNeeded })) made++;
    }
    return made ? { kind, color, n: made, across: !!over, needsBridge: !!(over && over.needsBridge) } : null;
  }
  if (Math.random() < p) {                                   // new colour with its house on the far bank
    const r = spawnPairAcross(g, color, { anchor: anchorNear(g), ...across() });
    if (r) { if (kind === 'newColor') g.colorsUsed++; return { kind, color, n: 2, across: true, needsBridge: r.needsBridge }; }
  }
  for (let widen = 0; widen < 3; widen++) {
    const anchor = anchorNear(g); anchor.rMax += widen * 3;
    if (spawnPair(g, color, { anchor, roads: sp.roadsNeeded })) {
      if (kind === 'newColor') g.colorsUsed++;
      return { kind, color, n: 2 };
    }
  }
  return null;
}

// Weighted pick among enabled specials, or null if none are available.
function pickSpecial(g) {
  const hills = !!(g.terrain && g.terrain.hasHill);
  const list = prog.specials.filter(s => s.enabled && !(s.unlock && g.unlocks[s.id]) && !(s.requires === 'hill' && !hills) && !(s.requires === 'highway' && !((g.inv.highway || 0) > 0 || [...g.roads.values()].some(r => r.lanes === 4))));
  if (!list.length) return null;
  let r = Math.random() * list.reduce((a, s) => a + (s.weight || 1), 0);
  for (const s of list) if ((r -= s.weight || 1) <= 0) return s;
  return list[0];
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
  if (g.mode === 'play' && g.trips >= g.nextGoalAt) {
    const special = pickSpecial(g);
    g.goalCount++;
    g.prevGoalAt = g.trips;
    g.nextGoalAt = g.trips + Math.max(prog.goals.minIncrement, Math.round(houseCount(g) * prog.goals.tripsPerHouse));
    if (!special) { g.inv.road += prog.goals.roadsPlain; notify({ type: 'roads', n: prog.goals.roadsPlain }); return; }
    g.reward = {
      goal: g.goalCount,
      options: [
        { id: 'plain', roads: prog.goals.roadsPlain },
        { id: 'special', roads: prog.goals.roadsWithSpecial, special },
      ],
    };
    g.mode = 'reward';
  }
}

export function chooseReward(g, optionId) {
  const opt = g.reward && g.reward.options.find(o => o.id === optionId);
  if (!opt) return false;
  g.inv.road += opt.roads;
  if (opt.special) {
    if (opt.special.unlock) g.unlocks[opt.special.id] = true;                 // permanent unlock (e.g. one-way streets)
    else g.inv[opt.special.id] = (g.inv[opt.special.id] || 0) + (opt.special.grant || 1);
  }
  g.reward = null;
  g.mode = 'play';
  return true;
}
