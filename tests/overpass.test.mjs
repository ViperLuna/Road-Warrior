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
const corners = c => { const ca = Math.cos(c.a), sa = Math.sin(c.a); return [[L/2,W/2],[L/2,-W/2],[-L/2,-W/2],[L/2*-1,W/2]].map(([x,y]) => [c.x + x*ca - y*sa, c.y + x*sa + y*ca]); };
const overlap = (a, b) => { const A = corners(a), B = corners(b); for (const poly of [A, B]) for (let i = 0; i < 4; i++) { const p = poly[i], q = poly[(i+1)%4], nx = -(q[1]-p[1]), ny = q[0]-p[0]; const pr = pts => { let mn=1e9,mx=-1e9; for (const [x,y] of pts){const d=x*nx+y*ny; mn=Math.min(mn,d); mx=Math.max(mx,d);} return [mn,mx]; }; const [a1,a2]=pr(A),[b1,b2]=pr(B); if (a2<=b1||b2<=a1) return false; } return true; };
tuning.trips.homeCooldownMinSeconds = 0.2; tuning.trips.homeCooldownMaxSeconds = 0.6; tuning.trips.parkedSeconds = 0.4;

// hLanes / vLanes: lane count of the east-west and north-south road
function scene(hLanes, vLanes) {
  st.newGame(5, maps[0]); g.terrain.water.fill(0); g.nextSpawnAt = 1e9; g.nextGoalAt = 1e9; g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g);
  g.inv.road = 999; g.inv.highway = 999; g.inv.overpass = 1; g.money = 999; g.mode = 'play';
  for (let x = 6; x <= 26; x++) { g.build4 = hLanes === 4; st.buildRoad(x, 11); }
  for (let y = 3; y <= 19; y++) { g.build4 = vLanes === 4; st.buildRoad(16, y); }
  g.build4 = false;
  const blue = palette[0], orange = palette[1];
  const H = (col, x, y, rot) => { const h = addBuilding(g, 'house', col, x, y, rot); g.cars.push(createCar(h)); g.build4 = false; st.buildRoad(x + [0, 1, 0, -1][rot], y + [-1, 0, 1, 0][rot]); };
  addBuilding(g, 'dest', blue, 27, 10, 3); addBuilding(g, 'dest', blue, 4, 10, 1);
  addBuilding(g, 'dest', orange, 15, 20, 0); addBuilding(g, 'dest', orange, 15, 1, 2);
  for (let i = 0; i < 3; i++) { H(blue, 8 + i * 2, 10, 2); H(blue, 20 + i * 2, 12, 0); H(orange, 15, 4 + i * 2, 1); H(orange, 17, 13 + i * 2, 3); }
}
const layerOf = c => { const p = c.route && c.route[c.idx]; return p && p.under ? 1 : 0; };
for (const [h, v] of (process.env.ONLY ? [process.env.ONLY.split('x').map(Number)] : [[2, 2], [4, 2], [2, 4], [4, 4]])) for (const withOverpass of [true, false]) {
  scene(h, v);
  const name = `${h}-lane E-W x ${v}-lane N-S` + (withOverpass ? ' + overpass' : ' (plain)');
  if (withOverpass) {
    ok(st.placeSpecial('overpass', 16, 11) === 'ok', name + ': overpass accepted');
    const r = g.roads.get(11 * g.cols + 16);
    const expTop = h > v ? 1 : v > h ? 0 : 1;
    ok(r.overpass === expTop, `${name}: bigger road on top (axis ${r.overpass}, wanted ${expTop})`);
    ok(layerLanes(g, 16, 11, 1) === h && layerLanes(g, 16, 11, 0) === v, `${name}: each layer keeps its own lane count (${layerLanes(g, 16, 11, 1)}/${layerLanes(g, 16, 11, 0)})`);
    ok(edgeLanes(g, 16, 11, 1) === h && edgeLanes(g, 16, 11, 0) === v, `${name}: tile edges match their roads`);
    // swap
    ok(st.placeSpecial('overpass', 16, 11) === 'flipped' && r.overpass === 1 - expTop, `${name}: tapping it again swaps the top road`);
    ok(g.inv.overpass === 0, `${name}: swapping costs nothing`);
    st.placeSpecial('overpass', 16, 11); ok(r.overpass === expTop, `${name}: swap back`);
  }
  let near = 0, far = 0, bad = 0, overl = 0, trips0 = g.trips, nan = 0, onTile = 0, invalid = 0, worst = 0;
  for (let i = 0; i < 60 * 240; i++) {
    st.tick(1 / 60);
    const cs = g.cars.filter(c => c.state === 'out' || c.state === 'back');
    for (let a = 0; a < cs.length; a++) for (let b = a + 1; b < cs.length; b++) if (layerOf(cs[a]) === layerOf(cs[b]) && overlap(cs[a], cs[b])) { overl++; if (Math.hypot(cs[a].x - 16.5, cs[a].y - 11.5) < 2) near++; else far++; }
    for (const c of g.cars) { if (Number.isNaN(c.x + c.y + c.v)) nan++; worst = Math.max(worst, c.stuck); const p = c.route[c.idx]; if (p && p.kind === 'road' && p.tx === 16 && p.ty === 11 && (c.state === 'out' || c.state === 'back')) { onTile++; if (!pieceValid(g, p)) invalid++; if (withOverpass && p.out !== [2, 3, 0, 1][p.in]) bad++; } }
  }
  ok(nan === 0, name + ': no NaN'); ok(invalid === 0, `${name}: every piece on the crossing is valid (${invalid} invalid of ${onTile})`);
  if (withOverpass) ok(bad === 0, name + ': nobody turns on the overpass tile');
  ok(g.trips - trips0 > 25, `${name}: traffic flows (${g.trips - trips0} trips, ${overl} same-layer overlap frames, worst stuck ${worst.toFixed(0)}s)`);
  console.log(`  ${name}: trips ${g.trips - trips0}, overlap frames ${overl} (near the crossing ${near}), worst stuck ${worst.toFixed(1)}s, cars on the tile ${onTile}`);
}
// placement rules
scene(2, 2); g.build4 = false; st.buildRoad(16, 8); // already a road; make a T instead
scene(2, 2); g.roads.delete(11 * g.cols + 17); ok(st.placeSpecial('overpass', 16, 11) === 'notcrossing', 'refused on a T (3 roads)');
scene(2, 2); ok(st.placeSpecial('overpass', 10, 11) === 'notcrossing', 'refused on a plain straight road');
scene(2, 2); g.roads.get(11 * g.cols + 15).lanes = 4; ok(st.placeSpecial('overpass', 16, 11) === 'mismatch', 'refused when one road changes size at the crossing');
scene(2, 2); g.inv.light = 1; g.roads.get(11 * g.cols + 16).special = 'light'; ok(st.placeSpecial('overpass', 16, 11) === 'taken', 'refused on a tile that already has a light');
// an overpass next door (4-lane road on top of a 2-lane street) must not make the next crossing look mismatched
scene(2, 2); g.build4 = true; for (let y = 3; y <= 19; y++) st.buildRoad(15, y); g.build4 = false; g.inv.overpass = 2;
ok(st.placeSpecial('overpass', 15, 11) === 'ok' && st.placeSpecial('overpass', 16, 11) === 'ok', 'overpass beside an overpass of a different size');
console.log(pass, 'passed', fail, 'failed');
