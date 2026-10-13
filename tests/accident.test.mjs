import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const st = await import(R + 'js/state.js');
const { setTuning, tuning } = await import(R + 'js/tuning.js');
const { setProgression, setMaps, maps } = await import(R + 'js/progression.js');
const { addBuilding, reindex, lotTile } = await import(R + 'js/buildings.js');
const { createCar } = await import(R + 'js/cars.js');
const { serialize, restore } = await import(R + 'js/save.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
setProgression(JSON.parse(fs.readFileSync(R + 'config/progression.json')));
setMaps(JSON.parse(fs.readFileSync(R + 'config/maps.json')));
const palette = JSON.parse(fs.readFileSync(R + 'config/colors.json')).colors; st.setPalette(palette);
const g = st.game; let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
const events = []; st.onEvent(e => events.push(e));
const S = (trips) => {
  st.newGame(5, maps[0]); g.terrain.water.fill(0); g.nextSpawnAt = 1e9; g.nextGoalAt = 1e9; g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g); g.inv.road = 999; g.mode = 'play';
  const blue = palette[0];
  const d = addBuilding(g, 'dest', blue, 24, 10, 3); const [lx, ly] = lotTile(d, 0);
  for (let x = 3; x <= lx - 1; x++) st.buildRoad(x, ly);
  for (let i = 0; i < 8; i++) { const h = addBuilding(g, 'house', blue, 3 + i * 2, ly - 1, 2); g.cars.push(createCar(h)); }
  g.trips = trips; events.length = 0;
};
const tickN = secs => { for (let i = 0; i < secs * 60; i++) st.tick(1 / 60); };

// before the threshold nothing ever happens
S(tuning.accidents.afterTrips - 900); g.trips = 10;
let seen = false; for (let i = 0; i < 60 * 400; i++) { st.tick(1 / 60); g.trips = Math.min(g.trips, 100); if (g.accident) seen = true; }
ok(!seen && !events.some(e => e.type === 'accident'), 'no accidents before the trip threshold');

// after it one happens; wrecks hold still for the duration, then clear and everyone carries on
S(tuning.accidents.afterTrips);
let t = 0; while (!g.accident && t++ < 60 * 900) { st.tick(1 / 60); g.trips = Math.max(g.trips, tuning.accidents.afterTrips); g.nextGoalAt = 1e9; }
ok(!!g.accident, 'an accident happens once past the threshold (t=' + (t / 60).toFixed(0) + 's)');
const acc = g.accident;
if (acc) {
  ok(events.filter(e => e.type === 'accident').length === 1, 'one accident event');
  const [A, B] = acc.cars, pos = acc.cars.map(c => [c.x, c.y]);
  ok(A !== B && A.crash && B.crash && A.v === 0 && B.v === 0, 'both cars are stopped');
  tickN(tuning.accidents.durationSeconds - 1);
  ok(g.accident === acc && acc.cars.every((c, i) => c.x === pos[i][0] && c.y === pos[i][1] && c.stuck === 0), 'they have not moved before the 15 s are up');
  const queued = g.cars.filter(c => c.state !== 'home' && c !== A && c !== B && c.v < 0.05).length;
  console.log('stopped behind the wreck:', queued);
  const behind = g.cars.filter(c => c.state !== 'home' && !c.crash && c.stuck > 5).length;
  console.log('cars waiting >5s:', behind);
  tickN(2);
  ok(g.accident === null && !A.crash && !B.crash, 'accident clears after the duration');
  ok(events.some(e => e.type === 'cleared'), 'cleared event');
  ok(g.nextAccidentAt > g.time + tuning.accidents.minGapSeconds * 0.4, 'next accident is scheduled well ahead');
  const trips0 = g.trips; tickN(90);
  ok(g.trips > trips0, 'traffic flows again after the clear-up (' + (g.trips - trips0) + ' trips)');
  ok(!g.cars.some(c => c.crash), 'no car is left wrecked');
}

// a save made mid-accident loads without a wreck, and the schedule starts fresh
S(tuning.accidents.afterTrips); t = 0; while (!g.accident && t++ < 60 * 900) { st.tick(1 / 60); g.trips = Math.max(g.trips, tuning.accidents.afterTrips); }
if (g.accident) { const data = JSON.parse(JSON.stringify(serialize())); restore(data); ok(g.accident === null && g.nextAccidentAt === undefined && !g.cars.some(c => c.crash), 'restore clears accident state'); }
st.newGame(6, maps[0]); ok(g.accident === null, 'new game starts with no accident');
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
