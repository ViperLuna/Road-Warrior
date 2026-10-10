import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const st = await import(R + 'js/state.js');
const { setTuning } = await import(R + 'js/tuning.js');
const { setProgression, setMaps, maps } = await import(R + 'js/progression.js');
const { addBuilding, reindex, lotTile } = await import(R + 'js/buildings.js');
const { createCar } = await import(R + 'js/cars.js');
const { DIR } = await import(R + 'js/lanes.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
setProgression(JSON.parse(fs.readFileSync(R + 'config/progression.json')));
setMaps(JSON.parse(fs.readFileSync(R + 'config/maps.json')));
const palette = JSON.parse(fs.readFileSync(R + 'config/colors.json')).colors; st.setPalette(palette);
const g = st.game; let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
const scenes = {
  demolish: () => { for (let x = 3; x <= 17; x++) st.demolish(x, g.ly); },
  cut: () => { st.setCut(10, g.ly, 11, g.ly, true); st.setCut(11, g.ly, 12, g.ly, true); },
  demolishMiddle: () => { st.demolish(10, g.ly); st.demolish(11, g.ly); },
};
for (const [name, act] of Object.entries(scenes)) for (const when of ['dwell', 'back']) {
  st.newGame(5, maps[0]); g.terrain.water.fill(0); g.nextSpawnAt = 1e9; g.nextGoalAt = 1e9; g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g);
  g.inv.road = 999; g.mode = 'play';
  const blue = palette[0];
  const dest = addBuilding(g, 'dest', blue, 20, 10, 3); const [lx, ly] = lotTile(dest, 0); g.ly = ly;
  const h = addBuilding(g, 'house', blue, 3, ly - 1, 2); const car = createCar(h); g.cars.push(car);
  for (let x = 3; x <= lx - 1; x++) st.buildRoad(x, ly);
  let t = 0; while (t++ < 60 * 120 && car.state !== (when === 'dwell' ? 'dwell' : 'back')) st.tick(1 / 60);
  if (when === 'back') for (let i = 0; i < 90; i++) st.tick(1 / 60);
  ok(car.state === when || car.state === 'home', `${name}/${when}: reached the state to test (${car.state})`);
  const trips0 = g.trips; act();
  let stuck = 0; for (let i = 0; i < 60 * 90; i++) { st.tick(1 / 60); }
  ok(car.state === 'home' && g.trips > trips0, `${name}/${when}: the car still gets home over its ghost road (state ${car.state}, +${g.trips - trips0} trips)`);
  ok(dest.slots.every(s => s === null), `${name}/${when}: its bay is free again`);
}
console.log(pass, 'passed', fail, 'failed');
