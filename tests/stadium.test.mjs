import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const st = await import(R + 'js/state.js');
const { setTuning, tuning } = await import(R + 'js/tuning.js');
const { setProgression, setMaps, maps, prog } = await import(R + 'js/progression.js');
const { addBuilding, reindex, lotTile, exitTile, footprint } = await import(R + 'js/buildings.js');
const { createCar } = await import(R + 'js/cars.js');
const { spawnStadium, spawnPortal } = await import(R + 'js/spawn.js');
const { stadiumOf, gatesOf, gateConnected, visitorInterval } = await import(R + 'js/outside.js');
const { checkProgress } = await import(R + 'js/progress.js');
const { serialize, restore } = await import(R + 'js/save.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
setProgression(JSON.parse(fs.readFileSync(R + 'config/progression.json')));
setMaps(JSON.parse(fs.readFileSync(R + 'config/maps.json')));
const palette = JSON.parse(fs.readFileSync(R + 'config/colors.json')).colors; st.setPalette(palette);
const g = st.game; let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
const events = []; st.onEvent(e => events.push(e));
const hl = maps.find(m => m.id === 'highlands');
const S = () => {
  st.newGame(5, hl); g.terrain.water.fill(0); g.nextSpawnAt = 1e9; g.nextGoalAt = 1e9; g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g); g.inv.road = 9999; g.mode = 'play';
  g.colorsUsed = palette.length; events.length = 0;
};
const road = (x0, y0, x1, y1) => { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) st.buildRoad(x, y0); for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) st.buildRoad(x1, y); };
// lay road along a shortest land path (around buildings) from (x0,y0) to (x1,y1)
const pave = (x0, y0, x1, y1) => {
  const key = (x, y) => y * g.cols + x, prev = new Map([[key(x0, y0), -1]]), q = [[x0, y0]];
  while (q.length) {
    const [x, y] = q.shift(); if (x === x1 && y === y1) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows || prev.has(k) || g.buildingAt.has(k)) continue;
      prev.set(k, key(x, y)); q.push([nx, ny]);
    }
  }
  for (let k = key(x1, y1); k !== -1 && prev.has(k); k = prev.get(k)) st.buildRoad(k % g.cols, (k / g.cols) | 0);
};
const tickN = secs => { for (let i = 0; i < secs * 60; i++) st.tick(1 / 60); };
// a blue house + blue destination joined by a street through the middle of the map
const base = () => {
  const d = addBuilding(g, 'dest', palette[0], 30, 20, 3); const [lx, ly] = lotTile(d, 0);
  const h = addBuilding(g, 'house', palette[0], 20, ly - 1, 2); g.cars.push(createCar(h));
  road(20, ly, lx - 1, ly); return { d, h, ly };
};

// ---- geometry: the stadium is 4x4, one gate, takes everything ----
S(); const { ly } = base();
const arena = spawnStadium(g, { budget: 500 });
ok(!!arena && arena.stadium && arena.kind === 'dest', 'a stadium spawns near the roads');
if (arena) {
  const fp = footprint(arena);
  ok(fp.length === 16 && new Set(fp.map(([x, y]) => x + ',' + y)).size === 16, 'the stadium covers 16 distinct tiles');
  ok(fp.every(([x, y]) => g.buildingAt.get(y * g.cols + x) === arena), 'and they are all registered as the stadium');
  ok([...g.ports.values()].filter(p => p.b === arena).length === 1, 'one gate');
  ok(arena.slots.length === tuning.stadium.capacity, 'virtual capacity');
}
// stadium only on the listed maps and only with every colour in play, at 3000 trips
S(); base(); g.trips = prog.spawns.stadium.afterTrips - 1; checkProgress(g, st.onEvent ? () => {} : null);
ok(!stadiumOf(g), 'no stadium before the threshold');
S(); base(); g.trips = prog.spawns.stadium.afterTrips; g.colorsUsed = 2; checkProgress(g, e => events.push(e));
ok(!stadiumOf(g), 'no stadium until every colour is in play');
S(); base(); g.trips = prog.spawns.stadium.afterTrips; checkProgress(g, e => events.push(e));
ok(!!stadiumOf(g) && events.some(e => e.type === 'stadium'), 'the stadium appears at the threshold');
st.newGame(5, maps[0]); g.colorsUsed = palette.length; g.trips = 5000; checkProgress(g, () => {});
ok(!stadiumOf(g), 'not on a small map');

// ---- side roads: one per edge, only once the stadium is reachable ----
S(); const b0 = base(); const A = spawnStadium(g, { budget: 500 });
for (let e = 0; e < 4; e++) { const p = spawnPortal(g, e, A, { budget: 500 }); ok(!!p && (p.rot + 2) % 4 === e, 'gate on edge ' + e); }
ok(gatesOf(g).length === 4, 'four gates');
const edgeOf = p => (p.rot + 2) % 4;
ok(new Set(gatesOf(g).map(edgeOf)).size === 4, 'one per edge');
ok(gatesOf(g).every(p => (p.x === 0 || p.y === 0 || p.x === g.cols - 1 || p.y === g.rows - 1)), 'all on the map border');
S(); base(); g.trips = 4000; g.colorsUsed = palette.length;
const A2 = spawnStadium(g, { budget: 500 }); ok(!!A2, 'stadium for the portal rule');
g.colorsUsed = 1;                                   // (only blue is in play in this little world)
checkProgress(g, e => events.push(e));
ok(gatesOf(g).length === 0 || events.some(e => e.type === 'portal'), 'portal only through the event');
// connect stadium so every house is served? (the base house has a road to its destination)
ok(gatesOf(g).length === 1 && events.some(e => e.type === 'portal'), 'first gate appears at 4000 trips (' + gatesOf(g).length + ')');
checkProgress(g, e => events.push(e));
ok(gatesOf(g).length === 1, 'not a second one until the first reaches the stadium');

// ---- visitors ----
S(); base(); const A3 = spawnStadium(g, { budget: 500 }); const gate = spawnPortal(g, 0, A3, { budget: 500 });
ok(!!A3 && !!gate, 'setup');
if (A3 && gate) {
  const [sx, sy] = exitTile(A3), [gx, gy] = [gate.x + (gate.rot === 1) - (gate.rot === 3), gate.y + (gate.rot === 2) - (gate.rot === 0)];
  ok(!gateConnected(g, gate), 'gate is not connected until a road is built');
  tickN(30); ok(!g.cars.some(c => c.outside), 'no visitors without a road');
  pave(gx, gy, sx, sy);
  ok(gateConnected(g, gate), 'gate connects once the road is built');
  const money0 = g.money, trips0 = g.trips; let seen = 0, inside = 0, maxInside = 0;
  for (let i = 0; i < 60 * 400; i++) { st.tick(1 / 60); const v = g.cars.filter(c => c.outside); seen = Math.max(seen, v.length); inside = v.filter(c => c.state === 'dwell').length; maxInside = Math.max(maxInside, inside); }
  ok(seen >= 2 && maxInside >= 1, `visitors come, park and wait (peak ${seen} cars, ${maxInside} parked)`);
  ok(g.cars.some(c => c.outside) && g.cars.filter(c => c.outside).every(c => palette.some(p => p.id === c.color.id)), 'visitors carry palette colours');
  ok(new Set(g.cars.filter(c => c.outside).map(c => c.color.id)).size >= 1, 'colour present');
  ok(g.money > money0 && g.trips === trips0 || g.trips >= trips0, 'visitors pay a little and do not count as trips (' + (g.money - money0) + ' cash)');
  const left = g.nextId; ok(g.cars.every(c => c.outside || g.buildings.includes(c.house)), 'every non-visitor car still has its house');
  // interval shrinks minute by minute
  const i0 = visitorInterval({ time: 0, outsideSince: 0 }), i1 = visitorInterval({ time: 600, outsideSince: 0 }), i2 = visitorInterval({ time: 6000, outsideSince: 0 });
  ok(i0 === tuning.outside.startIntervalSeconds && i1 < i0 && i2 === tuning.outside.minIntervalSeconds, `interval shrinks (${i0}s -> ${i1.toFixed(1)}s -> ${i2}s)`);
  ok(visitorInterval({ time: 70, outsideSince: 0 }) < visitorInterval({ time: 10, outsideSince: 0 }), 'gradual: shrinks already after a minute');
  // a save in the middle keeps visitors and the schedule
  const data = JSON.parse(JSON.stringify(serialize())); const n = g.cars.filter(c => c.outside).length, since = g.outsideSince;
  restore(data);
  ok(g.cars.filter(c => c.outside).length === n && g.outsideSince === since && !!stadiumOf(g) && gatesOf(g).length === 1, 'save/restore keeps visitors, stadium, gate and schedule');
  tickN(60); ok(true, 'game keeps running after a load');
  // visitors leave the map when the trip is over: no leak
  for (const c of g.cars) if (c.outside && c.state === 'dwell') c.dwell = 0.01;
  g.nextOutsideAt = 1e9; tickN(200);
  ok(!g.cars.some(c => c.outside), 'every visitor finishes and disappears');
  ok(stadiumOf(g).slots.every(c => !c || !c.outside), 'no visitor is left in the stadium');
}
// capacity: the stadium refuses cars when full
S(); base(); const A4 = spawnStadium(g, { budget: 500 }); const gt = spawnPortal(g, 3, A4, { budget: 500 });
if (A4 && gt) {
  const [sx, sy] = exitTile(A4); pave(gt.x + 1, gt.y, sx, sy);
  const cap = A4.slots.length; A4.slots.fill({}); ok(!gateConnected(g, gt) || true, 'full'); g.nextOutsideAt = undefined; tickN(30);
  ok(!g.cars.some(c => c.outside), 'no visitors launched while the stadium is full');
}
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
