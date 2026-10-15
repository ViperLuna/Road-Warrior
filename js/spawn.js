// Placing a matching house + destination pair on free land at a sensible distance.
import { DIR } from './lanes.js';
import { addBuilding, lotTile, reindex, accepts, footprint, entOf, entsOf, entrancesOf, exitTile, SPECIAL_COLORS } from './buildings.js';
import { tuning } from './tuning.js';
import { clearRoadTile } from './network.js';
import { createCar, razeBuilding } from './cars.js';
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
    front: true,
  });
}

// opts: rng, region {x0,y0,x1,y1} for the destination's top-left | anchor {x,y,rMin,rMax}, roads [min,max], color2 (make it a two-colour destination), small (a one-building, 2-bay destination), front (use the front entrance only)
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
    const rot = ri(0, 3), small = !!opts.small, half = small ? ri(0, 1) : 0, fake = { x: ax, y: ay, rot, small, half };
    const tiles = small ? footprint(fake) : [[ax, ay], [ax + 1, ay], [ax, ay + 1], [ax + 1, ay + 1]];
    if (!tiles.every(([x, y]) => free(g, x, y))) continue;            // checks bounds per tile (no row wrap-around)
    const fp = new Set(tiles.map(([x, y]) => y * g.cols + x));

    // The entrance: any place round the lot that a road can reach (front first half the time, otherwise anywhere that is clear).
    const options = entrancesOf(fake).filter(e => { const [x, y] = exitTile(fake, e); return passable(g, x, y, fp); });
    if (!options.length) continue;
    const front = entrancesOf(fake)[0];
    if (opts.front && !options.includes(front)) continue;                           // (the very first destination of a game always uses the front)
    const ent = options.includes(front) && (opts.front || rng() < 0.5) ? front : options[Math.floor(rng() * options.length)];
    fake.ent = ent;
    const lotExits = [exitTile(fake, ent)];
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
      const dest = addBuilding(g, 'dest', color, ax, ay, rot);
      if (small) { dest.small = true; dest.half = half; }
      dest.ent = ent; reindex(g);
      if (opts.color2) dest.color2 = opts.color2;                          // a two-colour destination: either colour's cars may park here
      const house = addBuilding(g, 'house', color, hx, hy, hrot);
      g.cars.push(createCar(house));
      return { dest, house, roads: n };
    }
  }
  return null;
}

// Add one house of `color` near an existing destination that takes that colour (reachable over land within `roads`).
// opts: near (use only this destination), apart {x, y, min} (stay at least `min` tiles from that spot), roads, budget, rng.
export function spawnHouse(g, color, opts = {}) {
  const rng = opts.rng || Math.random;
  const [minR, maxR] = opts.roads || [4, 14];
  const dests = opts.near ? [opts.near] : g.buildings.filter(b => b.kind === 'dest' && accepts(b, color.id));
  if (!dests.length) return null;
  for (let attempt = 0; attempt < 300; attempt++) {
    const d = dests[Math.floor(rng() * dests.length)];
    const r = 3 + Math.floor(rng() * 7), th = rng() * 6.283;
    const hx = Math.round(d.x + 1 + Math.cos(th) * r), hy = Math.round(d.y + 1 + Math.sin(th) * r);
    if (!free(g, hx, hy)) continue;
    if (opts.apart && Math.hypot(hx - opts.apart.x, hy - opts.apart.y) < opts.apart.min) continue;     // keep this house away from another one (so their routes have to merge)
    const hrot = Math.floor(rng() * 4), hex = hx + DIR[hrot][0], hey = hy + DIR[hrot][1];
    const blocked = new Set([hy * g.cols + hx]);
    if (!passable(g, hex, hey, blocked)) continue;
    const exits = new Set([exitTile(d)].map(([x, y]) => y * g.cols + x));
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
  const dests = g.buildings.filter(b => b.kind === 'dest' && accepts(b, color.id));
  if (!dests.length || budget < 8) return null;
  const spans = shuffled(findCrossings(g).filter(c => c.covered || (c.item === 'tunnel' ? (items.tunnel || 0) >= c.k : (items[c.item] || 0) > 0)), rng);       // (a tunnel is one piece per block)

  for (const d of shuffled(dests, rng)) {
    const exits = new Set([exitTile(d)].map(([x, y]) => y * g.cols + x));
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


// ---------------------------------------------------------------------------------------------------------
// The stadium and the side-road gates (see DESIGN.md, "Stadium and the outside").
// ---------------------------------------------------------------------------------------------------------

// The tiles a new stadium has gates on: the first `tuning.stadium.gates` of `gateTiles` (lot tiles -1, 0, 1, 2 along the front), in lot order.
export const stadiumGates = () => tuning.stadium.gateTiles.slice(0, Math.max(1, tuning.stadium.gates)).sort((a, b) => a - b);

// The area a stadium clears when it has to: its 4x3 footprint, the row of tiles in front of it (where the gates' roads arrive) and one extra
// column down one side: 5 wide x 4 deep. `side` -2 or 3 picks the extra column's side along the front.
function clearArea(fake, side) {
  const X = DIR[fake.rot], out = [];
  for (const i of [-1, 0, 1, 2, side]) for (let k = -1; k <= 2; k++) { const [lx, ly] = lotTile(fake, i); out.push([lx - X[0] * k, ly - X[1] * k]); }
  return out;
}

// Where a stadium could go. `clear` = nothing is free, so it may stand on plain road: it clears a 5x4 area (see clearArea) and the spot
// with the fewest road pieces in that area wins. Returns { fake, fp, area, exits, cost, roads } or null. opts: budget, roads [min, max].
function findStadiumSpot(g, opts, clear, raze = false) {
  const rng = opts.rng || Math.random, [minR, maxR] = opts.roads || [3, 14], budget = opts.budget ?? Infinity;
  const roadTiles = new Set(g.roads.keys());
  if (!roadTiles.size || !g.buildings.length) return null;
  const ground = (x, y) => x >= 0 && y >= 0 && x < g.cols && y < g.rows && g.terrain.water[y * g.cols + x] === LAND && (!g.buildingAt.has(y * g.cols + x) || (raze && g.buildingAt.get(y * g.cols + x).kind !== 'portal'));
  // What clearing the area would cost: road pieces, and (when razing) the buildings under it. A destination may only go if every colour it
  // serves keeps another destination, so nobody is left without one.
  const victims = area => {
    const set = new Set(area.map(([x, y]) => g.buildingAt.get(y * g.cols + x)).filter(Boolean));
    for (const d of set) {
      if (d.kind !== 'dest') continue;
      for (const c of [d.color, d.color2]) if (c && g.buildings.some(h => h.kind === 'house' && h.color.id === c.id && !set.has(h)) && !g.buildings.some(o => o.kind === 'dest' && !o.stadium && !set.has(o) && accepts(o, c.id))) return null;
    }
    return [...set];
  };
  const clearable = (x, y) => { const r = g.roads.get(y * g.cols + x); return !r || !(r.bridge || r.tunnel || r.overpass !== undefined); };
  let best = null;
  for (let attempt = 0; attempt < (clear ? 1500 : 600); attempt++) {
    const a = g.buildings[Math.floor(rng() * g.buildings.length)], r = 4 + Math.floor(rng() * 10), th = rng() * 6.283;
    const ax = Math.round(a.x + Math.cos(th) * r), ay = Math.round(a.y + Math.sin(th) * r);
    const rot = Math.floor(rng() * 4), fake = { kind: 'dest', x: ax, y: ay, rot, stadium: true, gates: stadiumGates() };
    const tiles = footprint(fake), fp = new Set(tiles.map(([x, y]) => y * g.cols + x)), exits = entsOf(fake).map(e => exitTile(fake, e));
    if (!clear) {
      if (!tiles.every(([x, y]) => free(g, x, y))) continue;
      if (!exits.every(([x, y]) => passable(g, x, y, fp))) continue;                   // every gate must have somewhere for a road to arrive
      const cost = Math.min(...exits.map(e => buildCost(g, e, roadTiles, fp, Math.min(budget, maxR))));
      if (!Number.isFinite(cost) || cost < minR) continue;
      best = { fake, fp, area: tiles, exits, cost, roads: 0 };
      break;
    }
    for (const side of [-2, 3]) {
      const area = clearArea(fake, side);
      if (!area.every(([x, y]) => ground(x, y) && clearable(x, y))) continue;
      const gone = raze ? victims(area) : [];
      if (!gone) continue;
      const roads = area.filter(([x, y]) => g.roads.has(y * g.cols + x)).length + gone.reduce((n, b) => n + (b.kind === 'house' ? 6 : 15), 0);
      if (best && roads >= best.roads) continue;
      const left = new Set([...roadTiles].filter(k => !area.some(([x, y]) => y * g.cols + x === k)));
      const cost = raze ? 0 : Math.min(...exits.map(e => buildCost(g, e, left, fp, maxR + 6)));       // (when razing, the buildings in the way are not gone yet: do not count them as walls)
      if (Number.isFinite(cost)) best = { fake, fp, area, exits, cost, roads, gone };
    }
    if (best && best.roads === 0) break;
  }
  return best;
}

function placeStadium(g, spot) {
  const d = addBuilding(g, 'dest', SPECIAL_COLORS.stadium, spot.fake.x, spot.fake.y, spot.fake.rot);
  d.stadium = true; d.gates = spot.fake.gates;
  d.slots = new Array(tuning.stadium.capacity).fill(null);
  reindex(g);
  return d;
}

// A stadium (a 4x3 destination that takes every colour, with several gates in its front row) on free land near the existing roads: close
// enough that the player can afford to connect it. opts: budget (road pieces they can spend), roads [min, max] new pieces to reach a road.
// Returns the stadium or null.
export function spawnStadium(g, opts = {}) {
  const spot = findStadiumSpot(g, opts, false);
  return spot ? placeStadium(g, spot) : null;
}

// The same, but when there is no free room anywhere (the map is covered in roads) it takes the spot with the fewest plain road pieces
// (never a bridge, tunnel or overpass; never a building) and clears the whole 5x4 area around it first: they go back to the player's stock. Returns { stadium, cleared, razed } or null. If even that finds nothing it knocks buildings down as well (houses first, never the last destination of a colour, never a side-road gate).
export function spawnStadiumClearing(g, opts = {}) {
  const free1 = spawnStadium(g, opts);
  if (free1) return { stadium: free1, cleared: 0 };
  let spot = findStadiumSpot(g, opts, true), razed = [];
  if (!spot) { spot = findStadiumSpot(g, opts, true, true); if (spot) razed = spot.gone; }       // really no room: knock buildings down too
  if (!spot) return null;
  for (const b of razed) razeBuilding(g, b);
  let cleared = 0;
  for (const [x, y] of spot.area) if (g.roads.has(y * g.cols + x) && clearRoadTile(g, x, y)) cleared++;
  return { stadium: placeStadium(g, spot), cleared, razed: razed.length };
}

// Map-edge sides: 0 north, 1 east, 2 south, 3 west (the same numbers as a building's rot). A gate faces inward.
export const EDGE_NAMES = ['north', 'east', 'south', 'west'];
export const edgeTile = (g, edge, t) => (edge === 0 ? [t, 0] : edge === 2 ? [t, g.rows - 1] : edge === 1 ? [g.cols - 1, t] : [0, t]);

// A side-road gate on one edge of the map, placed where the player could still lay a road from it to the stadium (existing roads are free).
// Returns the gate or null.
export function spawnPortal(g, edge, stadium, opts = {}) {
  const rng = opts.rng || Math.random, budget = opts.budget ?? Infinity, span = edge % 2 === 0 ? g.cols : g.rows, rot = (edge + 2) % 4;
  const target = new Set(entsOf(stadium).map(e => exitTile(stadium, e)).map(([x, y]) => y * g.cols + x));
  for (let attempt = 0; attempt < 80; attempt++) {
    const [x, y] = edgeTile(g, edge, 2 + Math.floor(rng() * (span - 4)));
    if (!free(g, x, y)) continue;
    const ex = x + DIR[rot][0], ey = y + DIR[rot][1], blocked = new Set([y * g.cols + x]);
    if (!passable(g, ex, ey, blocked)) continue;
    if (!Number.isFinite(buildCost(g, [ex, ey], target, blocked, budget))) continue;
    return addBuilding(g, 'portal', SPECIAL_COLORS.outside, x, y, rot);
  }
  return null;
}
