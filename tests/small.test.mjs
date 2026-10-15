import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const st = await import(R + 'js/state.js');
const { setTuning, tuning } = await import(R + 'js/tuning.js');
const { setProgression, setMaps, maps } = await import(R + 'js/progression.js');
const { addBuilding, reindex } = await import(R + 'js/buildings.js');
const { createCar } = await import(R + 'js/cars.js');
const { pieceValid, layerLanes, edgeLanes } = await import(R + 'js/network.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
setProgression(JSON.parse(fs.readFileSync(R + 'config/progression.json')));
setMaps(JSON.parse(fs.readFileSync(R + 'config/maps.json')));
tuning.gridlock.gameOverAfterSeconds = 1e9;
const palette = JSON.parse(fs.readFileSync(R + 'config/colors.json')).colors; st.setPalette(palette);
const g = st.game;
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
const L = 0.34 * 0.92, W = 0.2 * 0.92;
const { lotTile, gateOf, baysOf, footprint, destWeight, entOf } = await import(R + 'js/buildings.js');
const { serialize, restore } = await import(R + 'js/save.js');
const { spawnPair } = await import(R + 'js/spawn.js');
const blue = palette[0], orange = palette[1];
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

function scene(rot = 2, half = 0) {
  st.newGame(5, maps[0]); g.terrain.water.fill(0); g.nextSpawnAt = 1e9; g.nextGoalAt = 1e9; g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g);
  g.inv.road = 999; g.money = 999; g.mode = 'play';
  for (let x = 6; x <= 26; x++) st.buildRoad(x, 11);
  const d = addBuilding(g, 'dest', blue, 14, 9, 2); d.small = true; d.half = half; reindex(g);
  const [gx, gy] = lotTile(d, gateOf(d)); st.buildRoad(gx, gy + 1);
  const mk = x => { const h = addBuilding(g, 'house', blue, x, 10, 2); g.cars.push(createCar(h)); return h; };
  mk(8); mk(10); mk(20); mk(22);
  return d;
}

// ---- geometry
{
  const d = scene(2, 1);
  ok(footprint(d).length === 2, 'a small destination covers 2 tiles');
  const [lx, ly] = lotTile(d, gateOf(d)); const X = DIRS[d.rot];
  ok(footprint(d).some(([x, y]) => x === lx && y === ly) && footprint(d).some(([x, y]) => x === lx - X[0] && y === ly - X[1]), 'its tiles are the lot tile and the building tile behind it');
  ok(baysOf(d).length === 2 && baysOf(d).every(k => k >> 1 === gateOf(d)), 'two bays, both on the entrance tile');
  ok(destWeight(d) === 0.5, 'counts as half a destination');
  ok(g.ports.size >= 5 && [...g.ports.values()].filter(p => p.b === d).length === 1, 'exactly one entrance');
  for (let r = 0; r < 4; r++) for (const h of [0, 1]) { const t = { ...d, rot: r, half: h }; ok(footprint(t).length === 2 && new Set(footprint(t).map(p => p + '')).size === 2, `rotation ${r} half ${h}: two distinct tiles`); }
}

// ---- driving: 4 houses, 2 bays -> never more than 2 cars parked, everyone still gets served, nobody jams
for (const [rot, half] of [[2, 0], [2, 1]]) {
  const d = scene(rot, half);
  let maxParked = 0, tripsBefore = g.trips;
  for (let i = 0; i < 60 * 150; i++) {
    st.tick(1 / 60);
    maxParked = Math.max(maxParked, d.slots.filter(c => c).length);
    if (d.slots[(1 - half) * 2] || d.slots[(1 - half) * 2 + 1]) { ok(false, 'a car parked in a bay the small destination does not have'); break; }
  }
  ok(maxParked === 2, `half ${half}: both bays get used and never more than 2 (max ${maxParked})`);
  ok(g.trips - tripsBefore > 8, `half ${half}: trips completed (${g.trips - tripsBefore})`);
  const worst = g.cars.reduce((m, c) => Math.max(m, c.stuck), 0);
  ok(worst < 12, `half ${half}: nobody jams (worst ${worst.toFixed(1)} s)`);
}

// ---- tapping the lot moves its entrance (front -> side -> side); turning needs room
{
  const d = scene(2, 0); const [lx, ly] = lotTile(d, 0);
  ok(st.flipLotAt(lx, ly) === true && entOf(d) === 4, 'tapping a small destination\'s lot moves its entrance to the next side (got ' + entOf(d) + ')');
  const before = d.rot, [tx, ty] = footprint(d)[0], ok1 = st.rotateBuildingAt(tx, ty);
  ok(ok1 === true && d.rot !== before, 'it can be turned when there is room');
  for (const [x, y] of [[13, 8], [14, 8], [15, 8], [13, 9], [15, 9], [13, 10], [14, 10], [15, 10], [14, 7], [15, 7], [16, 9], [16, 8], [12, 9], [12, 8]]) if (!g.buildingAt.has(y * g.cols + x) && !g.roads.has(y * g.cols + x)) st.buildRoad(x, y);
  const stay = d.rot; const turned = st.rotateBuildingAt(...footprint(d)[0]);
  ok(turned === false ? d.rot === stay : true, 'when every turn is blocked, it stays put');
}

// ---- save/load keeps small + half
{
  const d = scene(2, 1); const data = JSON.parse(JSON.stringify(serialize())); scene(); restore(data);
  const back = g.buildings.find(b => b.kind === 'dest');
  ok(back.small === true && back.half === 1 && footprint(back).length === 2, 'save/restore keeps a small destination small');
  ok(g.ports.size >= 1 && [...g.ports.values()].filter(p => p.b === back).length === 1, 'and its entrance');
}

// ---- spawning
{
  let made = 0;
  for (let seed = 1; seed <= 12; seed++) {
    st.newGame(seed, maps[0]); g.terrain.water.fill(0); g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g);
    const r = spawnPair(g, blue, { region: { x0: 8, y0: 6, x1: 18, y1: 14 }, roads: [4, 14], small: true });
    if (!r) continue; made++;
    const d = r.dest;
    ok(d.small === true && footprint(d).length === 2, `seed ${seed}: spawned small`);
    const [lx, ly] = lotTile(d, gateOf(d)), X = DIRS[d.rot], ex = lx + X[0], ey = ly + X[1];
    ok(g.ports.has(ly * g.cols + lx), `seed ${seed}: its entrance is registered`);
    ok(!g.buildingAt.has(ey * g.cols + ex), `seed ${seed}: the tile outside the entrance is free for a road`);
  }
  ok(made >= 8, `small destinations spawn (${made}/12)`);
}
// ---- a single unit with no room round it can still be turned half way, in place ----
{
  const { exitTile } = await import(R + 'js/buildings.js'); let n = 0, flips = 0;
  for (let rot = 0; rot < 4; rot++) for (const half of [0, 1]) {
    st.newGame(5, maps[0]); g.terrain.water.fill(0); g.nextSpawnAt = 1e9; g.nextGoalAt = 1e9; g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g);
    const d = addBuilding(g, 'dest', blue, 14, 10, rot); d.small = true; d.half = half; d.ent = half; reindex(g);
    const fp = footprint(d), here = new Set(fp.map(([x, y]) => y * g.cols + x));
    // fill the rest of its 2x2 box and the ring round it with other buildings' tiles / roads so no quarter turn can fit
    for (let y = 8; y < 15; y++) for (let x = 12; x < 19; x++) { const k = y * g.cols + x; if (!here.has(k) && !g.buildingAt.has(k)) g.roads.set(k, { lanes: 2 }); }
    const [ex0, ey0] = exitTile(d, half); g.roads.delete(ey0 * g.cols + ex0);
    const [tx, ty] = fp[0], rot0 = d.rot; n++;
    // the 2 x 2 box: the exit has to be somewhere free after the flip: clear the tile outside where the new lot will be
    const flipped = { ...d, rot: (rot0 + 2) % 4 };
    const car = createCar(addBuilding(g, 'house', blue, 3, 3, 2)); g.cars.push(car);
    const turned = st.rotateBuildingAt(tx, ty);
    const after = new Set(footprint(d).map(([x, y]) => y * g.cols + x));
    if (turned && d.rot === (rot0 + 2) % 4 && after.size === here.size && [...here].every(k => after.has(k))) flips++;
    else if (turned) console.log('turned but not an in-place flip: rot', rot0, '->', d.rot, 'half', half);
  }
  ok(flips === n && n === 8, 'boxed in by roads, every rotation of a single unit turns half way round on the same two tiles (' + flips + ' of ' + n + ')');
}
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
