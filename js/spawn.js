// Placing a matching house + destination pair on free land at a sensible distance.
import { DIR } from './lanes.js';
import { addBuilding, lotTile, reindex } from './buildings.js';
import { createCar } from './cars.js';
import { mulberry32 } from './rng.js';
import { WATER, HILL, LAND } from './terrain.js';

const free = (g, x, y, blocked) =>
  x >= 0 && y >= 0 && x < g.cols && y < g.rows && g.terrain.water[y * g.cols + x] === LAND &&
  !g.buildingAt.has(y * g.cols + x) && !g.roads.has(y * g.cols + x) && !(blocked && blocked.has(y * g.cols + x));

// Land that isn't covered by a building (existing roads are fine to route over).
const passable = (g, x, y, blocked) =>
  x >= 0 && y >= 0 && x < g.cols && y < g.rows && g.terrain.water[y * g.cols + x] === LAND &&
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

// How many NEW road pieces it takes to connect `from` to any tile in `targets` over land: existing roads are free,
// other land costs one piece each. (0-1 breadth-first search.) Infinity if it needs more than `limit`.
export function buildCost(g, from, targets, blocked, limit = Infinity) {
  const start = from[1] * g.cols + from[0];
  const best = new Map([[start, g.roads.has(start) ? 0 : 1]]);
  const dq = [start];
  while (dq.length) {
    const k = dq.shift(), c = best.get(k);
    if (targets.has(k)) return c <= limit ? c : Infinity;
    if (c > limit) continue;
    const x = k % g.cols, y = (k / g.cols) | 0;
    for (const [dx, dy] of DIR) {
      const nx = x + dx, ny = y + dy, nk = ny * g.cols + nx;
      if (!passable(g, nx, ny, blocked)) continue;
      const nc = c + (g.roads.has(nk) ? 0 : 1);
      if (nc < (best.get(nk) ?? Infinity)) { best.set(nk, nc); if (nc === c) dq.unshift(nk); else dq.push(nk); }
    }
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
    const tiles = [[ax, ay], [ax + 1, ay], [ax, ay + 1], [ax + 1, ay + 1]];
    if (!tiles.every(([x, y]) => free(g, x, y))) continue;            // checks bounds per tile (no row wrap-around)
    const fp = new Set(tiles.map(([x, y]) => y * g.cols + x));

    const rot = ri(0, 3), fake = { x: ax, y: ay, rot };
    const lotExits = [0].map(i => { const [x, y] = lotTile(fake, i); return [x + DIR[rot][0], y + DIR[rot][1]]; });
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
      if (opts.budget !== undefined && buildCost(g, [hex, hey], exitSet, blocked, opts.budget) > opts.budget) continue;   // can the player afford the road?
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
    const exits = new Set([d.gate ? 1 : 0].map(i => { const [x, y] = lotTile(d, i); return (y + DIR[d.rot][1]) * g.cols + x + DIR[d.rot][0]; }));
    const n = roadsNeeded(g, [hex, hey], exits, blocked, maxR);
    if (n < minR || n > maxR) continue;
    if (opts.budget !== undefined && buildCost(g, [hex, hey], exits, blocked, opts.budget) > opts.budget) continue;       // can the player afford the road?
    const house = addBuilding(g, 'house', color, hx, hy, hrot);
    g.cars.push(createCar(house));
    return house;
  }
  return null;
}


// ---------------------------------------------------------------------------------------------------------
// Spawning across water. Only ever offered when the player could actually connect it (see progress.js).
// ---------------------------------------------------------------------------------------------------------

// Straight runs of water (bridge) or hill (tunnel) between two land tiles: every place a span could go.
// `item` is what it costs the player ('bridge' | 'tunnel'); `covered` = a span already exists there.
export function findCrossings(g, maxSpan = 10) {
  const out = [];
  const kindAt = (x, y) => (x >= 0 && y >= 0 && x < g.cols && y < g.rows ? g.terrain.water[y * g.cols + x] : -1);
  const landOK = (x, y) => kindAt(x, y) === LAND && !g.buildingAt.has(y * g.cols + x);
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) {
      if (!landOK(x, y)) continue;
      const kind = kindAt(x + dx, y + dy);
      if (kind !== WATER && kind !== HILL) continue;
      let k = 0;
      while (k <= maxSpan && kindAt(x + dx * (k + 1), y + dy * (k + 1)) === kind) k++;
      if (k < 1 || k > maxSpan) continue;
      const bx = x + dx * (k + 1), by = y + dy * (k + 1);
      if (!landOK(bx, by)) continue;
      let covered = true;
      for (let i = 1; i <= k; i++) { const r = g.roads.get((y + dy * i) * g.cols + x + dx * i); if (!r || !(r.bridge || r.tunnel)) { covered = false; break; } }
      out.push({ ax: x, ay: y, bx, by, k, covered, item: kind === WATER ? 'bridge' : 'tunnel' });
    }
  }
  return out;
}

const shuffled = (arr, rng) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// One house of `color` on the OTHER bank of a river from a destination of that colour.
// opts: items ({bridge, tunnel} counts the player holds), budget (road pieces they can spend), rng.
// Both land stretches are sized so the player's roads cover them. Returns the house or null.
export function spawnHouseAcross(g, color, opts = {}) {
  const rng = opts.rng || Math.random, budget = opts.budget ?? 0, items = opts.items || { bridge: opts.bridgeItems ?? 0, tunnel: 0 };
  const dests = g.buildings.filter(b => b.kind === 'dest' && b.color.id === color.id);
  if (!dests.length || budget < 8) return null;
  const spans = shuffled(findCrossings(g).filter(c => c.covered || (items[c.item] || 0) > 0), rng);

  for (const d of shuffled(dests, rng)) {
    const exits = new Set([d.gate ? 1 : 0].map(i => { const [x, y] = lotTile(d, i); return (y + DIR[d.rot][1]) * g.cols + x + DIR[d.rot][0]; }));
    for (const c of spans.slice(0, 40)) {
      for (const [near, far] of [[[c.ax, c.ay], [c.bx, c.by]], [[c.bx, c.by], [c.ax, c.ay]]]) {
        const dNear = roadsNeeded(g, near, exits, null, 14);                // dest -> its shore
        if (!Number.isFinite(dNear) || dNear >= budget) continue;
        const farIdx = far[1] * g.cols + far[0];
        for (let t = 0; t < 40; t++) {
          const hx = far[0] + Math.round((rng() - 0.5) * 12), hy = far[1] + Math.round((rng() - 0.5) * 12);
          if (!free(g, hx, hy)) continue;
          const hrot = Math.floor(rng() * 4), hex = hx + DIR[hrot][0], hey = hy + DIR[hrot][1];
          const blocked = new Set([hy * g.cols + hx]);
          if (!passable(g, hex, hey, blocked)) continue;
          const dFar = roadsNeeded(g, [hex, hey], new Set([farIdx]), blocked, 10);   // far shore -> house
          if (!Number.isFinite(dFar) || dNear + dFar + 2 > budget) continue;
          const house = addBuilding(g, 'house', color, hx, hy, hrot);
          g.cars.push(createCar(house));
          return { house, span: c, roads: dNear + dFar, needsBridge: !c.covered, item: c.item };
        }
      }
    }
  }
  return null;
}

// A new colour whose house and destination sit on opposite banks. Falls back to nothing (caller uses a normal pair).
export function spawnPairAcross(g, color, opts = {}) {
  const rng = opts.rng || Math.random;
  for (let attempt = 0; attempt < 60; attempt++) {
    const a = opts.anchor, r = 2 + Math.floor(rng() * 7), th = rng() * 6.283;
    const ax = Math.round(a.x + Math.cos(th) * r), ay = Math.round(a.y + Math.sin(th) * r);
    const tiles = [[ax, ay], [ax + 1, ay], [ax, ay + 1], [ax + 1, ay + 1]];
    if (!tiles.every(([x, y]) => free(g, x, y))) continue;
    const fp = new Set(tiles.map(([x, y]) => y * g.cols + x)), rot = Math.floor(rng() * 4), fake = { x: ax, y: ay, rot };
    if (![0].every(i => { const [x, y] = lotTile(fake, i); return passable(g, x + DIR[rot][0], y + DIR[rot][1], fp); })) continue;
    const dest = addBuilding(g, 'dest', color, ax, ay, rot);
    const res = spawnHouseAcross(g, color, opts);
    if (res) return { dest, ...res };
    g.buildings.splice(g.buildings.indexOf(dest), 1);                   // no room across the water: undo
    reindex(g);
  }
  return null;
}
