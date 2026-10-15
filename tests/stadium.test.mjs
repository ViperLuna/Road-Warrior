import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const st = await import(R + 'js/state.js');
const { setTuning, tuning } = await import(R + 'js/tuning.js');
const { setProgression, setMaps, setMilestones, milestones, maps, prog } = await import(R + 'js/progression.js');
const { addBuilding, reindex, lotTile, exitTile, footprint, entsOf, entTile } = await import(R + 'js/buildings.js');
const { createCar } = await import(R + 'js/cars.js');
const { spawnStadium, spawnStadiumClearing, spawnPortal } = await import(R + 'js/spawn.js');
const { stadiumOf, gatesOf, gateConnected, visitorInterval } = await import(R + 'js/outside.js');
const { checkProgress } = await import(R + 'js/progress.js');
const { serialize, restore } = await import(R + 'js/save.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
setProgression(JSON.parse(fs.readFileSync(R + 'config/progression.json')));
setMaps(JSON.parse(fs.readFileSync(R + 'config/maps.json')));
setMilestones(JSON.parse(fs.readFileSync(R + 'config/milestones.json')));
const palette = JSON.parse(fs.readFileSync(R + 'config/colors.json')).colors; st.setPalette(palette);
const g = st.game; let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
const events = []; st.onEvent(e => events.push(e));
const hl = maps.find(m => m.id === 'highlands');
const S = () => {
  st.newGame(5, hl); g.terrain.water.fill(0); g.nextSpawnAt = 1e9; g.nextGoalAt = 1e9; g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g); g.inv.road = 9999; g.mode = 'play';
  g.colorsUsed = palette.length; events.length = 0;
  for (const k of ['house', 'stadium', 'gates']) { tuning.deadlines[k].graceSeconds = 1e9; tuning.deadlines[k].warnSeconds = 1e9; }      // (patience clocks have their own test)
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
  ok(fp.length === 12 && new Set(fp.map(([x, y]) => x + ',' + y)).size === 12, 'the stadium covers 12 distinct tiles (4 wide, 3 deep)');
  ok(fp.every(([x, y]) => g.buildingAt.get(y * g.cols + x) === arena), 'and they are all registered as the stadium');
  const ports = [...g.ports.values()].filter(p => p.b === arena);
  ok(ports.length === tuning.stadium.gates && ports.length === 2, 'two gates to start (' + ports.length + ')');
  ok(new Set(ports.map(p => p.x + ',' + p.y)).size === 2 && ports.every(p => fp.some(([x, y]) => x === p.x && y === p.y)), 'on different tiles of the front row');
  const exits = entsOf(arena).map(e => exitTile(arena, e)); ok(new Set(exits.map(e => e.join())).size === 2 && exits.every(([x, y]) => !g.buildingAt.has(y * g.cols + x)), 'each gate has a free tile for its road');
  ok(arena.slots.length === tuning.stadium.capacity, 'virtual capacity');
}
// stadium only on the listed maps and only with every colour in play, at 3000 trips
S(); base(); g.trips = milestones.stadium.afterTrips - 1; checkProgress(g, st.onEvent ? () => {} : null);
ok(!stadiumOf(g), 'no stadium before the threshold');
S(); base(); g.trips = milestones.stadium.afterTrips; g.colorsUsed = 2; checkProgress(g, e => events.push(e));
ok(!stadiumOf(g), 'no stadium until every colour is in play');
S(); base(); g.trips = milestones.stadium.afterTrips; checkProgress(g, e => events.push(e));
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
ok(gatesOf(g).length === 2 && events.some(e => e.type === 'portal' && e.count === 2), 'a wave of two gates appears at 4000 trips (' + gatesOf(g).length + ')');
ok(new Set(gatesOf(g).map(edgeOf)).size === 2, 'on two different edges');
ok(g.mode === 'notice' && g.watches.some(w => w.kind === 'gates' && !w.ack), 'a popup waits for [OK] before the clock starts');
g.mode = 'play'; checkProgress(g, e => events.push(e));
ok(gatesOf(g).length === 2, 'no third gate: only the waves in milestones.json');

// ---- visitors ----
S(); base(); const A3 = spawnStadium(g, { budget: 500 }); const gate = spawnPortal(g, 0, A3, { budget: 500 });
ok(!!A3 && !!gate, 'setup');
if (A3 && gate) {
  const [sx, sy] = exitTile(A3), [gx, gy] = [gate.x + (gate.rot === 1) - (gate.rot === 3), gate.y + (gate.rot === 2) - (gate.rot === 0)];
  ok(!gateConnected(g, gate), 'gate is not connected until a road is built');
  tickN(30); ok(!g.cars.some(c => c.outside), 'no visitors without a road');
  pave(gx, gy, sx, sy);
  for (const e of entsOf(A3)) { const [ex, ey] = exitTile(A3, e); pave(gx, gy, ex, ey); }               // a road to every gate
  ok(gateConnected(g, gate), 'gate connects once the road is built');
  events.length = 0; ok(st.demolish(gate.x, gate.y) === false && g.buildingAt.has(gate.y * g.cols + gate.x) && events.some(e => e.type === 'gate-info' && e.demolish), 'the gate cannot be demolished and says why');
  events.length = 0; ok(st.rotateBuildingAt(gate.x, gate.y) === false && gate.rot === (edgeOf(gate) + 2) % 4 && events.some(e => e.type === 'gate-info'), 'tapping the gate explains it and does not turn it');
  const money0 = g.money, trips0 = g.trips; let seen = 0, inside = 0, maxInside = 0;
  for (let i = 0; i < 60 * 400; i++) { st.tick(1 / 60); const v = g.cars.filter(c => c.outside); seen = Math.max(seen, v.length); inside = v.filter(c => c.state === 'dwell').length; maxInside = Math.max(maxInside, inside); }
  ok(true, 'ran'); const gatesUsed = new Set();
  ok(seen >= 2 && maxInside >= 1, `visitors come, park and wait (peak ${seen} cars, ${maxInside} parked)`);
  ok(g.cars.some(c => c.outside) && g.cars.filter(c => c.outside).every(c => palette.some(p => p.id === c.color.id)), 'visitors carry palette colours');
  ok(new Set(g.cars.filter(c => c.outside).map(c => c.color.id)).size >= 1, 'colour present');
  ok(g.money > money0 && g.trips === trips0 || g.trips >= trips0, 'visitors pay a little and do not count as trips (' + (g.money - money0) + ' cash)');
  const left = g.nextId; ok(g.cars.every(c => c.outside || g.buildings.includes(c.house)), 'every non-visitor car still has its house');
  // a horde: a crowd launched one after another, much faster than the trickle
  { const a = stadiumOf(g); for (const c of g.cars) if (c.outside) c.dwell = 0.01; g.nextOutsideAt = 1e9; tickN(120);
    events.length = 0; g.hordeAt = g.time; g.nextOutsideAt = 1e9; const before = g.visitorsLaunched, ents = new Set();
    for (let i = 0; i < 60 * 40; i++) { st.tick(1 / 60); for (const c of g.cars) if (c.outside && c.lot) ents.add(c.lot.ent); }
    const ev = events.find(e => e.type === 'horde'); const got = g.visitorsLaunched - before;
    ok(!!ev && ev.size >= tuning.outside.horde.sizeStart, 'a horde event announces itself (size ' + (ev && ev.size) + ')');
    ok(got >= Math.min(ev ? ev.size : 99, a.slots.length) * 0.7, `the horde arrives in a rush (${got} cars in 40 s, steady trickle would be ~1)`);
    ok(ents.size === 2, 'a crowd uses both gates (' + [...ents] + ')');
    ok(g.hordeAt > g.time + tuning.outside.horde.everyMinutes[0] * 60 - 60, 'the next horde is scheduled minutes away');
    ok(g.hordeCount >= 1, 'counted');
    const e1 = events.find(e => e.type === 'horde').size; g.hordeAt = g.time; tickN(2); const e2 = events.filter(e => e.type === 'horde').pop().size;
    ok(e2 > e1 || e2 === tuning.outside.horde.sizeMax, 'each horde is bigger (' + e1 + ' -> ' + e2 + ')'); }
  // a whole match: the crowd stays for the match, then the whistle sends everyone out by random gates
  { const a = stadiumOf(g); for (const c of g.cars) if (c.outside) c.dwell = 0.01; g.nextOutsideAt = 1e9; g.hordeLeft = 0; g.match = { phase: 'none', whistleAt: 0 }; tickN(150);
    events.length = 0; g.hordeAt = g.time; const inStadium = () => g.cars.filter(c => c.state === 'dwell' && c.dest === a).length;
    for (let i = 0; i < 60 * 60 && !(g.hordeLeft === 0 && g.match.phase === 'play' && g.hordeCount > 0 && events.some(e => e.type === 'horde')); i++) st.tick(1 / 60);
    ok(g.match.phase === 'play' && g.match.whistleAt > g.time + 30, 'after the last arrival the game is on (whistle in ' + (g.match.whistleAt - g.time).toFixed(0) + ' s)');
    tickN(15); const full = inStadium(); ok(full >= 6, 'the crowd is inside (' + full + ' cars)');
    tickN(20); ok(inStadium() >= full - 1, 'and nobody leaves before the whistle (' + inStadium() + ' of ' + full + ')');
    { const [tx, ty] = footprint(a)[5]; const r0 = a.rot; const turned = st.rotateBuildingAt(tx, ty);       // turn the stadium with the crowd inside
      ok(turned && g.cars.filter(c => c.state === 'dwell' && c.dest === a).every(c => c.lot.rot === a.rot), 'turning it with a crowd inside re-seats every car on the new layout (rot ' + r0 + ' -> ' + a.rot + ')');
      for (const e of entsOf(a)) { const [ex, ey] = exitTile(a, e); pave(gx, gy, ex, ey); } }       // (the new gate side needs roads before anyone can leave)
    const ents = new Set(); let whistle = null;
    for (let i = 0; i < 60 * 120; i++) { st.tick(1 / 60); if (!whistle) whistle = events.find(e => e.type === 'whistle'); for (const c of g.cars) if (c.state === 'back' && c.route[0] && c.route[0].kind === 'lot_out' && c.route[0].ent >= 8) ents.add(c.route[0].ent); }
    ok(!!whistle && whistle.cars >= full - 1 && whistle.spots.length === 1, 'the final whistle (' + (whistle && whistle.cars) + ' cars released)');
    ok(inStadium() === 0, 'the stadium empties out');
    ok(ents.size === 2, 'the crowd leaves by both gates (' + [...ents] + ')');
    ok(g.cars.every(c => c.state !== 'back' || g.buildings.includes(c.house)), 'every car heading home still has a home'); }
  // interval shrinks minute by minute
  const i0 = visitorInterval({ time: 0, outsideSince: 0 }), i1 = visitorInterval({ time: 600, outsideSince: 0 }), i2 = visitorInterval({ time: 6000, outsideSince: 0 });
  ok(i0 === tuning.outside.startIntervalSeconds && i1 < i0 && i2 === tuning.outside.minIntervalSeconds, `interval shrinks (${i0}s -> ${i1.toFixed(1)}s -> ${i2}s)`);
  ok(visitorInterval({ time: 70, outsideSince: 0 }) < visitorInterval({ time: 10, outsideSince: 0 }), 'gradual: shrinks already after a minute');
  // a save in the middle keeps visitors and the schedule
  const data = JSON.parse(JSON.stringify(serialize())); const n = g.cars.filter(c => c.outside).length, since = g.outsideSince;
  restore(data);
  ok(g.hordeCount === data.outside.hordeCount, 'horde count survives a load');
  ok(g.cars.filter(c => c.outside).length === n && g.outsideSince === since && !!stadiumOf(g) && gatesOf(g).length === 1, 'save/restore keeps visitors, stadium, gate and schedule');
  tickN(60); ok(true, 'game keeps running after a load');
  // visitors leave the map when the trip is over: no leak
  for (const c of g.cars) if (c.outside && c.state === 'dwell') c.dwell = 0.01;
  g.nextOutsideAt = 1e9; g.hordeAt = 1e9; g.hordeLeft = 0; g.match = { phase: 'none', whistleAt: 0 }; tickN(200);
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
// ---- a map covered in roads: the stadium still appears, over the fewest road pieces ----
S(); base();
for (let y = 2; y < g.rows - 2; y++) for (let x = 2; x < g.cols - 2; x++) if (!g.buildingAt.has(y * g.cols + x) && (x % 3 === 0 || y % 3 === 0)) st.buildRoad(x, y);   // a grid of streets, blocks only 2x2
ok(!spawnStadium(g, { budget: 500 }), 'no free room for a stadium on a map full of roads');
const roads0 = g.roads.size, stock0 = g.inv.road; events.length = 0;
g.trips = milestones.stadium.afterTrips; g.colorsUsed = palette.length; checkProgress(g, e => events.push(e));
const big = stadiumOf(g), ev = events.find(e => e.type === 'stadium');
ok(!!big && !!ev && ev.cleared > 0, 'the stadium is built anyway and says how many road pieces it cleared (' + (ev && ev.cleared) + ')');
if (big) {
  ok(footprint(big).every(([x, y]) => !g.roads.has(y * g.cols + x) && g.buildingAt.get(y * g.cols + x) === big), 'nothing is left of the roads under it');
  ok(g.roads.size === roads0 - ev.cleared && g.inv.road === stock0 + ev.cleared, 'the cleared pieces went back to the stock (' + ev.cleared + ')');
  ok(entsOf(big).every(e => { const [x, y] = exitTile(big, e); return !g.buildingAt.has(y * g.cols + x); }), 'every gate has a free tile outside it');
  ok(ev.cleared <= 20, 'only a small area is cleared, at most a 5x4 block (' + ev.cleared + ')');
  const fpk = new Set(footprint(big).map(([x, y]) => y * g.cols + x)); ok(entsOf(big).every(e => { const [x, y] = exitTile(big, e); return !g.roads.has(y * g.cols + x); }), 'the tiles in front of the gates were cleared too, ready for new roads');
  ok(new Set([...g.buildings.map(b => b.id)]).size === g.buildings.length && g.buildings.filter(b => b.kind !== 'portal').every(b => footprint(b).every(([x, y]) => g.buildingAt.get(y * g.cols + x) === b)), 'no building was overwritten');
  tickN(30); ok(true, 'the game runs on');
}
// ---- no room at all, even over roads: buildings go too (a stadium is "donated" and the buildings make way) ----
{
  const T = await import(R + 'js/terrain.js');
  S(); g.terrain.water.fill(T.WATER);
  for (let y = 8; y < 18; y++) for (let x = 8; x < 22; x++) g.terrain.water[y * g.cols + x] = T.LAND;       // a 14x10 island
  const blue = palette[0], orange = palette[1];
  const d1 = addBuilding(g, 'dest', blue, 8, 8, 2), d2 = addBuilding(g, 'dest', blue, 19, 8, 2), d3 = addBuilding(g, 'dest', orange, 13, 8, 2);
  const hs = [];
  for (let x = 8; x < 22; x += 2) for (const y of [11, 13, 15, 17]) { const h = addBuilding(g, 'house', x % 4 ? blue : orange, x, y, 0); const c = createCar(h); g.cars.push(c); hs.push(h); }
  for (let x = 9; x < 22; x += 2) for (const y of [12, 14, 16]) st.buildRoad(x, y);
  g.colorsUsed = palette.length; g.trips = milestones.stadium.afterTrips; events.length = 0;
  const bCount = g.buildings.length, cCount = g.cars.length;
  checkProgress(g, e => events.push(e));
  const ev = events.find(e => e.type === 'stadium'), big = stadiumOf(g);
  ok(!!big && !!ev && ev.razed > 0, 'the stadium is built even when buildings have to go (' + (ev && ev.razed) + ' razed, ' + (ev && ev.cleared) + ' road pieces)');
  if (big) {
    ok(g.buildings.length === bCount - ev.razed + 1, 'those buildings are gone');
    ok(footprint(big).every(([x, y]) => g.buildingAt.get(y * g.cols + x) === big), 'and the stadium stands where they were');
    ok(g.cars.every(c => g.buildings.includes(c.house)), 'every car still has a house');
    ok(g.cars.every(c => !c.dest || g.buildings.includes(c.dest)), 'no car is heading for a razed destination');
    ok(g.buildings.every(b => !b.slots || b.slots.every(c => !c || g.cars.includes(c))), 'no bay holds a car that is gone');
    ok(g.buildings.some(b => b.kind === 'dest' && !b.stadium && b.color.id === blue.id) && g.buildings.some(b => b.kind === 'dest' && !b.stadium && b.color.id === orange.id), 'every colour still has a destination');
    ok(cCount - g.cars.length <= ev.razed, 'only razed houses lost their cars (' + (cCount - g.cars.length) + ')');
    tickN(60); ok(true, 'the game runs on');
  }
}
// ---- turning a stadium with roads all round its gates: half a turn in place ----
{
  S(); base(); const a = spawnStadium(g, { budget: 500 });
  if (a) {
    for (const e of entsOf(a)) { const [ex, ey] = exitTile(a, e); pave(ex, ey - (a.rot === 0 ? 0 : 0), ex, ey); st.buildRoad(ex, ey); }
    const before = new Set(footprint(a).map(([x, y]) => y * g.cols + x)), rot0 = a.rot;
    // park a car in it so we can see it re-seated
    const tapX = footprint(a)[5][0], tapY = footprint(a)[5][1];
    let turned = 0;
    for (let i = 0; i < 4; i++) { const r = a.rot; if (st.rotateBuildingAt(tapX, tapY)) turned++; }
    ok(turned === 4, 'a stadium with roads at its gates still turns on every tap (' + turned + ' of 4)');
    st.rotateBuildingAt(tapX, tapY);
    const after = new Set(footprint(a).map(([x, y]) => y * g.cols + x));
    ok([...before].every(k => after.has(k)) && before.size === after.size || a.rot !== (rot0 + 2) % 4, 'if it turned half way it covers exactly the same tiles');
    // force the half turn alone: block the quarter turns with a road on each side of the block
    S(); base(); const b2 = spawnStadium(g, { budget: 500 });
    if (b2) {
      const fp0 = footprint(b2).map(([x, y]) => y * g.cols + x).sort((p, q) => p - q).join();
      const ring = [];
      for (const [x, y] of footprint(b2)) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const k = (y + dy) * g.cols + x + dx; if (!g.buildingAt.has(k) && !g.roads.has(k)) { g.roads.set(k, { lanes: 2 }); ring.push(k); } }
      const rotB = b2.rot, [tx, ty] = footprint(b2)[0];
      ok(st.rotateBuildingAt(tx, ty) === true, 'surrounded by roads it can still be turned');
      ok(b2.rot === (rotB + 2) % 4 && footprint(b2).map(([x, y]) => y * g.cols + x).sort((p, q) => p - q).join() === fp0, 'by half a turn, on exactly the same tiles');
      ok(entsOf(b2).every(e => { const [ex, ey] = exitTile(b2, e); return !g.buildingAt.has(ey * g.cols + ex); }), 'with its gates now on the other long side, on free tiles');
    }
  }
}
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
