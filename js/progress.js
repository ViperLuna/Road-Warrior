// Spawn schedule, goals and rewards. Pure game logic: no DOM.
import { prog } from './progression.js';
import { spawnPair, spawnHouse } from './spawn.js';

export function initProgress(g) {
  g.spawnCount = 0; g.nextSpawnAt = prog.spawns.firstAtTrips;
  g.goalCount = 0; g.nextGoalAt = prog.goals.firstAtTrips; g.prevGoalAt = 0;
  g.colorsUsed = 1; g.reward = null;
}

const count = (g, kind, color) => g.buildings.filter(b => b.kind === kind && b.color.id === color.id).length;

function anchorNear(g) {
  const a = g.buildings[(Math.random() * g.buildings.length) | 0];
  return { x: a.x, y: a.y, rMin: 3, rMax: 8 };
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

  if (kind === 'houses') {
    let made = 0;
    for (let k = 0; k < Math.min(sp.housesPerSpawn, room); k++) if (spawnHouse(g, color, { roads: sp.roadsNeeded })) made++;
    return made ? { kind, color, n: made } : null;
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
function pickSpecial() {
  const list = prog.specials.filter(s => s.enabled);
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
    g.nextSpawnAt += sp.everyTrips + sp.everyTripsGrowth * (g.spawnCount - 1);
    notify({ type: 'spawn', ...r });
  }
  if (g.mode === 'play' && g.trips >= g.nextGoalAt) {
    const special = pickSpecial();
    g.goalCount++;
    g.prevGoalAt = g.nextGoalAt;
    g.nextGoalAt += prog.goals.increment + prog.goals.incrementGrowth * (g.goalCount - 1);
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
  if (opt.special) g.inv[opt.special.id] = (g.inv[opt.special.id] || 0) + 1;
  g.reward = null;
  g.mode = 'play';
  return true;
}
