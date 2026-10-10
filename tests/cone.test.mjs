import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const st = await import(R + 'js/state.js');
const { setTuning } = await import(R + 'js/tuning.js');
const { setProgression, setMaps, maps } = await import(R + 'js/progression.js');
const { addBuilding, reindex, lotTile } = await import(R + 'js/buildings.js');
const { createCar } = await import(R + 'js/cars.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
setProgression(JSON.parse(fs.readFileSync(R + 'config/progression.json')));
setMaps(JSON.parse(fs.readFileSync(R + 'config/maps.json')));
const palette = JSON.parse(fs.readFileSync(R + 'config/colors.json')).colors; st.setPalette(palette);
const g = st.game; let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
const S = () => { st.newGame(5, maps[0]); g.terrain.water.fill(0); g.nextSpawnAt = 1e9; g.nextGoalAt = 1e9; g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g); g.inv.road = 999; g.mode = 'play'; };
// A: orange house + orange dest on a road; an unintended blue road crosses it. Cone the blue crossing: orange never uses it.
// layout: orange street y=10 x=4..19; blue street x=12 y=4..16 crosses at (12,10). Orange house at the west end of the blue street? Put an orange house ON the blue street so its only way to orange dest is through the cone.
S();
const orange = palette[1], blue = palette[0];
const od = addBuilding(g, 'dest', orange, 20, 10, 3); const [lx, ly] = lotTile(od, 0);
for (let x = 4; x <= lx - 1; x++) st.buildRoad(x, ly);
for (let y = ly - 6; y <= ly + 6; y++) st.buildRoad(12, y);
const oh = addBuilding(g, 'house', orange, 11, ly - 5, 1); g.cars.push(createCar(oh));     // orange house beside the blue street, driveway onto (12, ly-5)
const bh = addBuilding(g, 'house', blue, 13, ly + 5, 3); g.cars.push(createCar(bh));
addBuilding(g, 'dest', blue, 20, ly + 6, 3);
ok(st.setCone(12, ly - 1, true) && st.hasCone(12, ly - 1) && st.coneCount() === 1, 'cone placed');
let used = 0; const car = g.cars[0];
for (let i = 0; i < 60 * 90; i++) { st.tick(1 / 60); if (car.state !== 'home' && car.route.some(p => p.kind === 'road' && p.tx === 12 && p.ty === ly - 1)) used++; }
ok(used === 0 && car.state === 'home', `the orange house finds no route through the cone (used ${used}, state ${car.state})`);
st.setCone(12, ly - 1, false);
for (let i = 0; i < 60 * 60; i++) st.tick(1 / 60);
ok(g.trips >= 1, 'after the cone comes off the trip happens (' + g.trips + ')');
// B: a cone dropped on a car's way while it is on its trip: it still finishes AND gets home
S();
const d2 = addBuilding(g, 'dest', blue, 20, 10, 3); const [l2x, l2y] = lotTile(d2, 0);
const h2 = addBuilding(g, 'house', blue, 3, l2y - 1, 2); const c2 = createCar(h2); g.cars.push(c2);
for (let x = 3; x <= l2x - 1; x++) st.buildRoad(x, l2y);
for (const when of ['out', 'dwell']) {
  let t = 0; while (t++ < 60 * 200 && c2.state !== when) st.tick(1 / 60);
  for (let x = 4; x <= l2x - 1; x++) st.setCone(x, l2y, true);                        // cone the whole street
  const trips0 = g.trips; for (let i = 0; i < 60 * 40; i++) st.tick(1 / 60);
  ok(c2.state === 'home' || c2.state === 'back' || (when === 'out' && g.trips > trips0), `${when}: a car already on its trip is not stranded by cones (state ${c2.state}, trips +${g.trips - trips0})`);
  for (let i = 0; i < 60 * 30; i++) st.tick(1 / 60);
  ok(c2.state === 'home' && dest_free(), `${when}: it got home and its bay is free`);
  function dest_free() { return d2.slots.every(s => s === null); }
  const after = g.trips; for (let i = 0; i < 60 * 40; i++) st.tick(1 / 60);
  ok(g.trips === after, `${when}: while the street is coned no NEW trip starts`);
  for (let x = 4; x <= l2x - 1; x++) st.setCone(x, l2y, false);
  for (let i = 0; i < 60 * 40; i++) st.tick(1 / 60);
  ok(g.trips > after, `${when}: trips resume once the cones are removed`);
}
// save keeps cones
const S2 = await import(R + 'js/save.js'); st.setCone(8, l2y, true); const d = JSON.parse(JSON.stringify(S2.serialize())); st.newGame(9, maps[0]); S2.restore(d); ok(st.hasCone(8, l2y), 'cones survive a save/load');
// demolish removes it
st.demolish(8, l2y); st.buildRoad(8, l2y); ok(!st.hasCone(8, l2y), 'rebuilding a tile starts without its cone');
console.log(pass, 'passed', fail, 'failed');
