// Some houses (tuning.houses.secondCarChance) get a second car: its own id, its own trips, each trip counts.
import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const st = await import(R + 'js/state.js');
const { setTuning, tuning } = await import(R + 'js/tuning.js');
const { setProgression, setMaps, maps } = await import(R + 'js/progression.js');
const { addBuilding, reindex, lotTile } = await import(R + 'js/buildings.js');
const { addCarsFor } = await import(R + 'js/cars.js');
const { spawnHouse, spawnPair } = await import(R + 'js/spawn.js');
const { serialize, restore } = await import(R + 'js/save.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
setProgression(JSON.parse(fs.readFileSync(R + 'config/progression.json')));
setMaps(JSON.parse(fs.readFileSync(R + 'config/maps.json')));
const palette = JSON.parse(fs.readFileSync(R + 'config/colors.json')).colors; st.setPalette(palette);
const g = st.game; let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
const blue = palette[0];
const S = () => { st.newGame(5, maps[0]); g.terrain.water.fill(0); g.nextSpawnAt = 1e9; g.nextGoalAt = 1e9; g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g); g.inv.road = 999; g.mode = 'play'; tuning.gridlock.gameOverAfterSeconds = 1e9; };

ok(tuning.houses.secondCarChance === 0.1, 'the chance is in the config, 10% to start');

// the chance decides it
S(); tuning.houses.secondCarChance = 0;
for (let i = 0; i < 20; i++) addCarsFor(g, addBuilding(g, 'house', blue, 2 + i, 2, 2));
ok(g.cars.length === 20, 'at 0% every house has one car');
S(); tuning.houses.secondCarChance = 1;
for (let i = 0; i < 20; i++) addCarsFor(g, addBuilding(g, 'house', blue, 2 + i, 2, 2));
ok(g.cars.length === 40 && new Set(g.cars.map(c => c.id)).size === 40, 'at 100% every house has two, all with different ids');
S(); tuning.houses.secondCarChance = 0.1; let two = 0;
for (let i = 0; i < 400; i++) { const n = g.cars.length; addCarsFor(g, addBuilding(g, 'house', blue, 2 + (i % 40), 2 + 2 * ((i / 40) | 0), 2)); if (g.cars.length - n === 2) two++; }
ok(two > 15 && two < 75, 'at 10% about one house in ten gets a second car (' + two + ' of 400)');

// the spawners use it
S(); tuning.houses.secondCarChance = 1;
const p = spawnPair(g, blue, { roads: [3, 14], anchor: { x: 20, y: 15, rMin: 3, rMax: 6 } });
ok(!!p && g.cars.filter(c => c.house === p.house).length === 2, 'a new destination\'s house gets two cars');
const h2 = spawnHouse(g, blue, {});
ok(!!h2 && g.cars.filter(c => c.house === h2).length === 2, 'and so does a house added later');

// two cars from one house both make their own trips, each one counted, with no overlap on the driveway
S(); tuning.houses.secondCarChance = 1;
const d = addBuilding(g, 'dest', blue, 24, 10, 3); const [lx, ly] = lotTile(d, 0);
for (let x = 3; x <= lx - 1; x++) st.buildRoad(x, ly);
const h = addBuilding(g, 'house', blue, 6, ly - 1, 2); addCarsFor(g, h); reindex(g);
let overlap = 0; const seenTrips = new Map();
for (let i = 0; i < 60 * 300; i++) {
  st.tick(1 / 60);
  const out = g.cars.filter(c => c.state === 'out' && c.idx === 0 && c.s < 0.3);
  if (out.length > 1) overlap++;
}
ok(g.trips >= 4, 'trips are made (' + g.trips + ')');
ok(g.cars.length === 2 && g.cars[0].id !== g.cars[1].id, 'both cars are still there, with their own ids');
ok(overlap === 0, 'the second car waits for the first to pull out (' + overlap + ' ticks overlapped)');

// a save keeps both, and raising the house takes both
const data = JSON.parse(JSON.stringify(serialize())); restore(data);
ok(g.cars.length === 2 && new Set(g.cars.map(c => c.id)).size === 2 && g.cars.every(c => c.house === g.buildings.find(b => b.kind === 'house')), 'a save and load keeps both cars and their house');
st.tick(1 / 60);
tuning.houses.secondCarChance = 0.1;
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
