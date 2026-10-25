// Two cars side by side on a 4-lane approach to a green light: a car that cannot enter because the road beyond is full must not hold up the
// other lane's car whose own way is clear (a right turn next to a straight-on car stuck in the queue, or the other way round).
import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const st = await import(R + 'js/state.js');
const { setTuning, tuning } = await import(R + 'js/tuning.js');
const { setProgression, setMaps, maps } = await import(R + 'js/progression.js');
const { addBuilding, reindex } = await import(R + 'js/buildings.js');
const { createCar } = await import(R + 'js/cars.js');
const L = await import(R + 'js/lanes.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
setProgression(JSON.parse(fs.readFileSync(R + 'config/progression.json')));
setMaps(JSON.parse(fs.readFileSync(R + 'config/maps.json')));
const palette = JSON.parse(fs.readFileSync(R + 'config/colors.json')).colors; st.setPalette(palette);
const g = st.game; let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
const T4 = (x, y, i, o, li, lo) => L.roadPiece(x, y, i, o, { tl: 4, ei: 4, eo: 4, li, lo });
const setup = special => {
  st.newGame(5, maps[0]); g.terrain.water.fill(0); g.nextSpawnAt = 1e9; g.nextGoalAt = 1e9; g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g);
  g.inv.road = 999; g.inv.highway = 999; g.inv.light = 9; g.mode = 'play'; tuning.gridlock.gameOverAfterSeconds = 1e9;
  g.build4 = true; for (let d = -5; d <= 5; d++) { st.buildRoad(10 + d, 10); if (d) st.buildRoad(10, 10 + d); } g.build4 = false;
  if (special) { st.placeSpecial(special, 10, 10); const r = g.roads.get(10 * g.cols + 10); if (special === 'light') r.sig = { axis: 1, stage: 'green', t: 0, dem: [0, 0] }; }
  reindex(g);
};
let n = 0;
const car = (route, s) => { const h = addBuilding(g, 'house', palette[0], 1 + (n++) * 2, 1, 2); const c = createCar(h); c.id = 1000 + n; c.state = 'out'; c.route = route; c.idx = 0; c.s = s; c.v = 0; g.cars.push(c); L.pointAt(route[0], s, c); return c; };
const straight = lane => [T4(12, 10, 1, 3, lane, lane), T4(11, 10, 1, 3, lane, lane), T4(10, 10, 1, 3, lane, lane), T4(9, 10, 1, 3, lane, lane), T4(8, 10, 1, 3, lane, lane)];
const rightTurn = [T4(12, 10, 1, 3, 1, 1), T4(11, 10, 1, 3, 1, 1), T4(10, 10, 1, 0, 1, 1), T4(10, 9, 2, 0, 1, 1), T4(10, 8, 2, 0, 1, 1)];
const leftTurn = [T4(12, 10, 1, 3, 0, 0), T4(11, 10, 1, 3, 0, 0), T4(10, 10, 1, 2, 0, 0), T4(10, 11, 0, 2, 0, 0), T4(10, 12, 0, 2, 0, 0)];
const timeThrough = (a, b, plug) => {
  const A = car(a.route, 0.35), B = car(b.route, 0.35);
  const C = car(plug, 0.12); C.crash = true;                                                        // a stopped car just beyond the junction, in A's lane
  let tB = null, overlap = 0;
  for (let i = 0; i < 60 * 30 && tB === null; i++) {
    st.tick(1 / 60); if (B.idx >= 3) tB = i / 60;
    if (A.idx === 2 && B.idx === 2 && Math.hypot(A.x - B.x, A.y - B.y) < 0.12) overlap++;           // both inside the junction on top of each other
  }
  return { tB, overlap };
};
// inner-lane straight car stuck behind a plug; the outer-lane car turns right
setup('light'); let r = timeThrough({ route: straight(0) }, { route: rightTurn }, [T4(9, 10, 1, 3, 0, 0), T4(8, 10, 1, 3, 0, 0)]);
ok(r.tB !== null && r.tB < 3, 'a right turn is not held up by a stuck straight-on car in the next lane (through in ' + (r.tB && r.tB.toFixed(1)) + ' s)');
ok(r.overlap === 0, 'and they do not sit on top of each other in the junction');
// outer-lane straight car stuck behind a plug; the inner-lane car turns left
setup('light'); r = timeThrough({ route: straight(1) }, { route: leftTurn }, [T4(9, 10, 1, 3, 1, 1), T4(8, 10, 1, 3, 1, 1)]);
ok(r.tB !== null && r.tB < 3, 'a left turn is not held up by a stuck straight-on car in the next lane (through in ' + (r.tB && r.tB.toFixed(1)) + ' s)');
// the same at a plain stop-sign junction
setup(null); r = timeThrough({ route: straight(0) }, { route: rightTurn }, [T4(9, 10, 1, 3, 0, 0), T4(8, 10, 1, 3, 0, 0)]);
ok(r.tB !== null && r.tB < 4, 'and at a stop-sign junction (through in ' + (r.tB && r.tB.toFixed(1)) + ' s)');

// ---- a left-turner in the inner lane goes with the queue of straight-on cars in the outer lane (heading north through the junction)
{
  const { pieceConflict } = await import(R + 'js/junction.js');
  ok(!pieceConflict(T4(10, 10, 2, 3, 0, 0), T4(10, 10, 2, 0, 1, 1), 0) && !pieceConflict(T4(10, 10, 2, 0, 1, 1), T4(10, 10, 2, 3, 0, 0), 0), 'an inner-lane left turn and an outer-lane straight car of the same approach do not conflict');
  ok(!pieceConflict(T4(10, 10, 2, 1, 1, 1), T4(10, 10, 2, 0, 0, 0), 0), 'nor an outer-lane right turn and an inner-lane straight car');
  ok(pieceConflict(T4(10, 10, 1, 3, 0, 0), T4(10, 10, 2, 0, 1, 1), 0), 'and crossing streets keep their wider margin');
  setup('light'); const r = g.roads.get(10 * g.cols + 10); r.sig = { axis: 0, stage: 'green', t: 0, dem: [0, 0] };
  for (let d = -7; d <= 7; d++) { if (d && !g.roads.has((10 + d) * g.cols + 10)) { g.build4 = true; st.buildRoad(10, 10 + d); g.build4 = false; } }
  reindex(g);
  const north = (y0, lane) => { const rt = []; for (let y = y0; y >= 5; y--) rt.push(T4(10, y, 2, 0, lane, lane)); return rt; };
  const lt = [T4(10, 11, 2, 0, 0, 0), T4(10, 10, 2, 3, 0, 0), T4(9, 10, 1, 3, 0, 0), T4(8, 10, 1, 3, 0, 0), T4(7, 10, 1, 3, 0, 0)];
  const left = car(lt, 0.5), line = [0.5, 0.2, 0.9, 0.6, 0.3].map((s, i) => car(north(i < 1 ? 11 : 12 + Math.floor(i / 2), 1), s));
  let tLeft = null, tLast = null;
  for (let i = 0; i < 60 * 30 && (tLeft === null || tLast === null); i++) { st.tick(1 / 60); const inJ = c => c.route[c.idx] && c.route[c.idx].tx === 10 && c.route[c.idx].ty === 10; if (tLeft === null && inJ(left)) tLeft = i / 60; if (tLast === null && inJ(line[4])) tLast = i / 60; }
  ok(tLeft !== null && tLast !== null && tLeft < tLast - 0.5, 'a left-turner at the front of the inner lane goes with the straight-on queue, not after it (it entered at ' + (tLeft && tLeft.toFixed(1)) + ' s, the last straight car at ' + (tLast && tLast.toFixed(1)) + ' s)');
}

// ---- oncoming cars, both going straight in the inner lanes of a highway intersection, do not wait for each other
{
  const { pieceConflict } = await import(R + 'js/junction.js');
  ok(!pieceConflict(T4(10, 10, 1, 3, 0, 0), T4(10, 10, 3, 1, 0, 0), 0) && !pieceConflict(T4(10, 10, 3, 1, 0, 0), T4(10, 10, 1, 3, 0, 0), 0), 'oncoming straight cars in the two inner lanes do not conflict');
  for (const special of ['light', null]) {
    setup(special); const r = g.roads.get(10 * g.cols + 10); if (special) r.sig = { axis: 1, stage: 'green', t: 0, dem: [0, 0] };
    const west = [T4(12, 10, 1, 3, 0, 0), T4(11, 10, 1, 3, 0, 0), T4(10, 10, 1, 3, 0, 0), T4(9, 10, 1, 3, 0, 0), T4(8, 10, 1, 3, 0, 0)];
    const east = [T4(8, 10, 3, 1, 0, 0), T4(9, 10, 3, 1, 0, 0), T4(10, 10, 3, 1, 0, 0), T4(11, 10, 3, 1, 0, 0), T4(12, 10, 3, 1, 0, 0)];
    const A = car(west, 0.35), B = car(east, 0.35);
    let tA = null, tB = null;
    for (let i = 0; i < 60 * 20 && (tA === null || tB === null); i++) { st.tick(1 / 60); if (tA === null && A.idx >= 2) tA = i / 60; if (tB === null && B.idx >= 2) tB = i / 60; }
    ok(tA !== null && tB !== null && Math.abs(tA - tB) < 0.4, 'two oncoming straight cars go through together at ' + (special ? 'a light' : 'a stop-sign intersection') + ' (' + (tA && tA.toFixed(1)) + ' s and ' + (tB && tB.toFixed(1)) + ' s)');
  }
}
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
