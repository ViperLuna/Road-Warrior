// Placing a matching house + destination pair on free land at a sensible distance.
import { DIR } from './lanes.js';
import { addBuilding, lotTile } from './buildings.js';
import { createCar } from './cars.js';
import { mulberry32 } from './rng.js';
import { WATER } from './terrain.js';

const free = (g, x, y, blocked) =>
  x >= 0 && y >= 0 && x < g.cols && y < g.rows && g.terrain.water[y * g.cols + x] !== WATER &&
  !g.buildingAt.has(y * g.cols + x) && !g.roads.has(y * g.cols + x) && !(blocked && blocked.has(y * g.cols + x));

// Land that isn't covered by a building (existing roads are fine to route over).
const passable = (g, x, y, blocked) =>
  x >= 0 && y >= 0 && x < g.cols && y < g.rows && g.terrain.water[y * g.cols + x] !== WATER &&
  !g.buildingAt.has(y * g.cols + x) && !(blocked && blocked.has(y * g.cols + x));

// Shortest land path (in road tiles) from `from` to any tile in `targets`, or Infinity.
function roadsNeeded(g, from, targets, blocked, limit) {
  const seen = new Set([from[1] * g.cols + from[0]]);
  let frontier = [from];
  for (let d = 0; d <= limit; d++) {
    const next = [];
    for (const [x, y] of frontier) {
      if (targets.has(y * g.cols + x)) return d + 1;
      for (const [dx, dy] of DIR) {
        const nx = x + dx, ny = y + dy, k = ny * g.cols + nx;
        if (!seen.has(k) && passable(g, nx, ny, blocked)) { seen.add(k); next.push([nx, ny]); }
      }
    }
    frontier = next;
  }
  return Infinity;
}

export function spawnInitial(g, color) {
  const st = g.terrain.start;
  return spawnPair(g, color, {
    rng: mulberry32((g.seed ^ 0x9e3779b9) >>> 0),
    region: { x0: st.x - 3, y0: st.y - 3, x1: st.x + 2, y1: st.y + 2 },
    roads: [7, 14],
  });
}

// opts: rng, region {x0,y0,x1,y1} for the destination's top-left | anchor {x,y,rMin,rMax}, roads [min,max]
export function spawnPair(g, color, opts = {}) {
  const rng = opts.rng || Math.random;
  const [minR, maxR] = opts.roads || [5, 13];
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));

  for (let attempt = 0; attempt < 800; attempt++) {
    let ax, ay;
    if (opts.region) { ax = ri(opts.region.x0, opts.region.x1 - 1); ay = ri(opts.region.y0, opts.region.y1 - 1); }
    else {
      const a = opts.anchor, r = ri(opts.anchor.rMin || 3, opts.anchor.rMax || 8), th = rng() * 6.283;
      ax = Math.round(a.x + Math.cos(th) * r); ay = Math.round(a.y + Math.sin(th) * r);
    }
    const fp = new Set([[ax, ay], [ax + 1, ay], [ax, ay + 1], [ax + 1, ay + 1]].map(([x, y]) => y * g.cols + x));
    if (![...fp].every(k => free(g, k % g.cols, (k / g.cols) | 0))) continue;

    const rot = ri(0, 3), fake = { x: ax, y: ay, rot };
    const lotExits = [0, 1].map(i => { const [x, y] = lotTile(fake, i); return [x + DIR[rot][0], y + DIR[rot][1]]; });
    if (!lotExits.every(([x, y]) => passable(g, x, y, fp))) continue;
    const exitSet = new Set(lotExits.map(([x, y]) => y * g.cols + x));

    for (let h = 0; h < 40; h++) {
      const hx = ri(0, g.cols - 1), hy = ri(0, g.rows - 1), hk = hy * g.cols + hx;
      if (!free(g, hx, hy, fp)) continue;
      const hrot = ri(0, 3), hex = hx + DIR[hrot][0], hey = hy + DIR[hrot][1];
      const blocked = new Set([...fp, hk]);
      if (!passable(g, hex, hey, blocked)) continue;
      const n = roadsNeeded(g, [hex, hey], exitSet, blocked, maxR);
      if (n < minR || n > maxR) continue;
      addBuilding(g, 'dest', color, ax, ay, rot);
      const house = addBuilding(g, 'house', color, hx, hy, hrot);
      g.cars.push(createCar(house));
      return { dest: g.buildings[g.buildings.length - 2], house, roads: n };
    }
  }
  return null;
}

// Add one house of `color` near an existing destination of that colour (reachable over land within `roads`).
export function spawnHouse(g, color, opts = {}) {
  const rng = opts.rng || Math.random;
  const [minR, maxR] = opts.roads || [4, 14];
  const dests = g.buildings.filter(b => b.kind === 'dest' && b.color.id === color.id);
  if (!dests.length) return null;
  for (let attempt = 0; attempt < 300; attempt++) {
    const d = dests[Math.floor(rng() * dests.length)];
    const r = 3 + Math.floor(rng() * 7), th = rng() * 6.283;
    const hx = Math.round(d.x + 1 + Math.cos(th) * r), hy = Math.round(d.y + 1 + Math.sin(th) * r);
    if (!free(g, hx, hy)) continue;
    const hrot = Math.floor(rng() * 4), hex = hx + DIR[hrot][0], hey = hy + DIR[hrot][1];
    const blocked = new Set([hy * g.cols + hx]);
    if (!passable(g, hex, hey, blocked)) continue;
    const exits = new Set([0, 1].map(i => { const [x, y] = lotTile(d, i); return (y + DIR[d.rot][1]) * g.cols + x + DIR[d.rot][0]; }));
    const n = roadsNeeded(g, [hex, hey], exits, blocked, maxR);
    if (n < minR || n > maxR) continue;
    const house = addBuilding(g, 'house', color, hx, hy, hrot);
    g.cars.push(createCar(house));
    return house;
  }
  return null;
}
