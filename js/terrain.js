// Random terrain: land + water (river / lake / ponds), guaranteed to leave a big connected
// stretch of open land, with a roomy start spot. Deterministic per seed.
import { mulberry32 } from './rng.js';

export const LAND = 0;
export const WATER = 1;
export const HILL = 2;          // raised rock: roads can't be built on it (a tunnel goes through)

const MIN_LAND_PATCH = 10;     // smaller land pockets get flooded
const START_RADIUS = 3;        // start spot needs (2r+1)^2 open land
const WATER_FRAC = [0.06, 0.30];
const MAIN_LAND_MIN = 0.45;    // biggest land mass vs. whole map

export function generateTerrain(seed, cols, rows) {
  let last = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    last = build((seed + attempt * 7919) >>> 0, cols, rows);
    if (last.ok) break;
  }
  last.seed = seed;
  return last;
}

export function isWater(t, x, y) {
  return x < 0 || y < 0 || x >= t.cols || y >= t.rows || t.water[y * t.cols + x] !== LAND;
}

function build(seed, cols, rows) {
  const rng = mulberry32(seed);
  const water = new Uint8Array(cols * rows);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const scale = Math.sqrt((cols * rows) / 704);          // features grow with the map (704 = the 32x22 start map)
  const set = (x, y, v = WATER) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    if (v === HILL && water[y * cols + x] !== LAND) return;               // hills never overwrite water
    water[y * cols + x] = v;
  };

  function river() {
    const horiz = rng() < 0.5;
    const len = horiz ? cols : rows, span = horiz ? rows : cols;
    const width = (rng() < 0.4 ? 3 : 2) + Math.floor((scale - 1) * 1.5);
    let pos = span * (0.25 + rng() * 0.5), vel = 0, prev = pos;
    for (let i = 0; i < len; i++) {
      vel = vel * 0.8 + (rng() - 0.5);
      pos = clamp(pos + vel, 2, span - 3);
      const lo = Math.floor(Math.min(prev, pos)), hi = Math.floor(Math.max(prev, pos));
      for (let p = lo; p <= hi + width - 1; p++) horiz ? set(i, p) : set(p, i);
      prev = pos;
    }
  }

  function blob(cx, cy, rx, ry, v = WATER) {
    const p1 = rng() * 6.283, p2 = rng() * 6.283;
    const a1 = 0.15 + rng() * 0.15, a2 = 0.08 + rng() * 0.1;
    const m = Math.ceil(Math.max(rx, ry) * 1.5);
    for (let y = Math.floor(cy - m); y <= cy + m; y++) {
      for (let x = Math.floor(cx - m); x <= cx + m; x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        const th = Math.atan2(dy, dx);
        if (Math.hypot(dx, dy) < 1 + a1 * Math.sin(2 * th + p1) + a2 * Math.sin(3 * th + p2)) set(x, y, v);
      }
    }
  }

  function lake() {
    const rx = (4 + rng() * 3) * scale, ry = (3 + rng() * 3) * scale;
    blob(rx + 2 + rng() * (cols - 2 * rx - 4), ry + 2 + rng() * (rows - 2 * ry - 4), rx, ry);
  }
  function pond() {
    blob(3 + rng() * (cols - 6), 3 + rng() * (rows - 6), (1.6 + rng() * 1.2) * Math.sqrt(scale), (1.4 + rng() * 1.2) * Math.sqrt(scale));
  }

  // Hills (so tunnels have a point): sometimes one or two rocky humps, never covering water.
  function hills() {
    const n = rng() < 0.45 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const rx = (2.2 + rng() * 1.6) * Math.sqrt(scale), ry = (2.4 + rng() * 2.6) * Math.sqrt(scale);
      blob(3 + rng() * (cols - 6), 3 + rng() * (rows - 6), rx, ry, HILL);
    }
  }

  const roll = rng();
  if (roll < 0.35) river();
  else if (roll < 0.65) lake();
  else if (roll < 0.85) { river(); pond(); }
  else { lake(); pond(); }
  if (rng() < 0.7) hills();

  // Label land components; flood the tiny pockets; relabel.
  let { comp, sizes } = label(water, cols, rows);
  for (let i = 0; i < comp.length; i++) if (comp[i] >= 0 && sizes[comp[i]] < MIN_LAND_PATCH) water[i] = WATER;
  ({ comp, sizes } = label(water, cols, rows));

  const total = cols * rows;
  let waterCount = 0, hillCount = 0;
  for (let i = 0; i < total; i++) { if (water[i] === WATER) waterCount++; else if (water[i] === HILL) hillCount++; }
  let mainId = -1;
  sizes.forEach((s, id) => { if (mainId < 0 || s > sizes[mainId]) mainId = id; });

  const terrain = { cols, rows, water, comp, mainId, start: null, seed, ok: false, hasHill: hillCount >= 6 };
  if (mainId < 0) return terrain;
  const wf = waterCount / total;
  if (wf < WATER_FRAC[0] || wf > WATER_FRAC[1] || sizes[mainId] / total < MAIN_LAND_MIN) return terrain;

  // Open start spot inside the main land mass, preferably near the middle.
  let best = null, bestScore = Infinity;
  const r = START_RADIUS;
  for (let y = r; y < rows - r; y++) {
    for (let x = r; x < cols - r; x++) {
      if (!openBlock(water, comp, mainId, cols, x, y, r)) continue;
      const score = Math.hypot(x - cols / 2, y - rows / 2) + rng() * 4;
      if (score < bestScore) { bestScore = score; best = { x, y }; }
    }
  }
  if (!best) return terrain;
  terrain.start = best;
  terrain.ok = true;
  return terrain;
}

// Rebuild a terrain object from a saved water grid (save games keep the grid itself, so a later change to the generator can't alter old maps).
export function terrainFromWater(seed, cols, rows, water, start) {
  const { comp, sizes } = label(water, cols, rows);
  let mainId = -1;
  sizes.forEach((s, id) => { if (mainId < 0 || s > sizes[mainId]) mainId = id; });
  let hills = 0;
  for (let i = 0; i < water.length; i++) if (water[i] === HILL) hills++;
  return { cols, rows, water, comp, mainId, start, seed, ok: true, hasHill: hills >= 6 };
}

function openBlock(water, comp, mainId, cols, cx, cy, r) {
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      const i = y * cols + x;
      if (water[i] !== LAND || comp[i] !== mainId) return false;
    }
  return true;
}

function label(water, cols, rows) {
  const comp = new Int16Array(cols * rows).fill(-1);
  const sizes = [];
  for (let s = 0; s < comp.length; s++) {
    if (water[s] !== LAND || comp[s] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [s];
    comp[s] = id;
    while (stack.length) {
      const i = stack.pop();
      size++;
      const x = i % cols, y = (i / cols) | 0;
      if (x > 0) push(i - 1);
      if (x < cols - 1) push(i + 1);
      if (y > 0) push(i - cols);
      if (y < rows - 1) push(i + cols);
    }
    sizes.push(size);
    function push(n) { if (water[n] === LAND && comp[n] === -1) { comp[n] = id; stack.push(n); } }
  }
  return { comp, sizes };
}
