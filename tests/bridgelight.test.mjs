// A traffic light may go on a bridge tile where a road meets the span from the side (a T-junction at the shore).
import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const st = await import(R + 'js/state.js');
const { setTuning, tuning } = await import(R + 'js/tuning.js');
const { setProgression, setMaps, maps } = await import(R + 'js/progression.js');
const { roadConns } = await import(R + 'js/network.js');
const { addBuilding, reindex, lotTile } = await import(R + 'js/buildings.js');
const { createCar } = await import(R + 'js/cars.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
setProgression(JSON.parse(fs.readFileSync(R + 'config/progression.json')));
setMaps(JSON.parse(fs.readFileSync(R + 'config/maps.json')));
const palette = JSON.parse(fs.readFileSync(R + 'config/colors.json')).colors; st.setPalette(palette);
const g = st.game; let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
st.newGame(5, maps[0]); g.terrain.water.fill(0); g.nextSpawnAt = 1e9; g.nextGoalAt = 1e9; g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g);
for (const x of [10, 11, 12]) g.terrain.water[10 * g.cols + x] = 1;                          // a river one tile wide, the bridge crosses it
g.inv.road = 99; g.inv.bridge = 2; g.inv.light = 2; g.inv.roundabout = 1; g.mode = 'play'; g.colorsUsed = 1;
tuning.gridlock.gameOverAfterSeconds = 1e9;
const blue = palette[0], tile = (x, y) => g.roads.get(y * g.cols + x);
const d = addBuilding(g, 'dest', blue, 20, 8, 3); const [lx, ly] = lotTile(d, 0);        // east of the river
for (let x = 3; x <= 9; x++) st.buildRoad(x, 10);
st.buildRoad(13, 10);
st.buildBridge({ x: 9, y: 10 }, [10, 11, 12].map(x => ({ x, y: 10 })), { x: 13, y: 10 });
for (let x = 14; x <= lx - 1; x++) st.buildRoad(x, ly);
for (let y = Math.min(10, ly); y <= Math.max(10, ly); y++) st.buildRoad(14, y);
st.buildRoad(14, 10);
for (let y = 5; y <= 9; y++) st.buildRoad(10, y);                                         // a road meeting the bridge's first tile from the north
for (const [x, rot] of [[4, 2], [6, 2]]) { const h = addBuilding(g, 'house', blue, x, 9, rot); g.cars.push(createCar(h)); }
{ const h = addBuilding(g, 'house', blue, 9, 5, 1); g.cars.push(createCar(h)); }
reindex(g);

ok(roadConns(g, 10, 10).length === 3 && tile(10, 10).bridge, 'the bridge tile at the shore is a 3-way junction');
ok(st.placeSpecial('light', 11, 10) === 'notjunction', 'a plain stretch of bridge has no junction to light');
ok(st.placeSpecial('roundabout', 10, 10) === 'badtile', 'a roundabout still cannot go on a bridge');
ok(st.placeSpecial('light', 10, 10) === 'ok' && tile(10, 10).special === 'light' && g.inv.light === 1, 'a traffic light goes on the bridge junction');
ok(st.placeSpecial('light', 10, 10) === 'taken', 'and only one');
let axes = new Set(), trips0 = g.trips;
for (let i = 0; i < 60 * 240; i++) { st.tick(1 / 60); const s = tile(10, 10) && tile(10, 10).sig; if (s) axes.add(s.axis); }
ok(g.trips > trips0 + 2, 'traffic crosses the lit bridge junction (' + (g.trips - trips0) + ' trips)');
ok(axes.has(0) && axes.has(1), 'the light gives each street its turn');
ok(g.mode === 'play', 'and nobody gridlocks');
st.demolish(11, 10);
ok(!tile(10, 10) && g.inv.light === 2, 'demolishing the bridge gives the light back');
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
