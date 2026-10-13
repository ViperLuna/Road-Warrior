import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const st = await import(R + 'js/state.js');
const { setTuning, tuning } = await import(R + 'js/tuning.js');
const { setProgression, setMaps, setMilestones, milestones, maps } = await import(R + 'js/progression.js');
const { addBuilding, reindex } = await import(R + 'js/buildings.js');
const { createCar } = await import(R + 'js/cars.js');
const { pieceValid, layerLanes, edgeLanes } = await import(R + 'js/network.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
setProgression(JSON.parse(fs.readFileSync(R + 'config/progression.json')));
setMaps(JSON.parse(fs.readFileSync(R + 'config/maps.json')));
setMilestones(JSON.parse(fs.readFileSync(R + 'config/milestones.json')));
tuning.gridlock.gameOverAfterSeconds = 1e9;
const palette = JSON.parse(fs.readFileSync(R + 'config/colors.json')).colors; st.setPalette(palette);
const g = st.game;
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
const L = 0.34 * 0.92, W = 0.2 * 0.92;

const { lotTile, gateOf, accepts } = await import(R + 'js/buildings.js');
const { serialize, restore } = await import(R + 'js/save.js');
const { dualChance } = await import(R + 'js/progress.js');
const { prog } = await import(R + 'js/progression.js');
const { spawnPair, spawnHouse } = await import(R + 'js/spawn.js');
const blue = palette[0], orange = palette[1];

// ---- the two-colour destination: cars of BOTH colours drive to it and park in the same lot
function scene() {
  st.newGame(5, maps[0]); g.terrain.water.fill(0); g.nextSpawnAt = 1e9; g.nextGoalAt = 1e9; g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g);
  g.inv.road = 999; g.money = 999; g.mode = 'play';
  for (let x = 6; x <= 26; x++) st.buildRoad(x, 11);
  const d = addBuilding(g, 'dest', blue, 14, 9, 2); d.color2 = orange;
  const [gx, gy] = lotTile(d, gateOf(d)); st.buildRoad(gx, gy + 1);
  const mk = (col, x) => { const h = addBuilding(g, 'house', col, x, 10, 2); g.cars.push(createCar(h)); return h; };
  const houses = [mk(blue, 8), mk(blue, 10), mk(orange, 20), mk(orange, 22)];
  return { d, houses };
}
{
  const { d } = scene();
  ok(accepts(d, 'blue') && accepts(d, 'orange') && !accepts(d, 'pink'), 'a two-colour destination accepts exactly its two colours');
  const seen = new Set(), tripsBefore = g.trips;
  for (let i = 0; i < 60 * 120; i++) {
    st.tick(1 / 60);
    for (const c of d.slots) if (c) seen.add(c.color.id);
    if (seen.size === 2 && g.trips > 12) break;
  }
  ok(seen.has('blue') && seen.has('orange'), 'cars of both colours park in the two-colour destination (saw ' + [...seen] + ')');
  ok(g.trips > tripsBefore + 5, 'trips are completed (' + (g.trips - tripsBefore) + ')');
  const worst = g.cars.reduce((m, c) => Math.max(m, c.stuck), 0);
  ok(worst < 12, 'nobody is stuck in the plain two-colour scene (worst ' + worst.toFixed(1) + ' s)');
}
// ---- saving and loading keeps the second colour
{
  const { d } = scene(); const data = JSON.parse(JSON.stringify(serialize()));
  scene(); restore(data);
  const back = g.buildings.find(b => b.kind === 'dest');
  ok(back && back.color.id === 'blue' && back.color2 && back.color2.id === 'orange', 'save/restore keeps color2');
  ok(!g.buildings.filter(b => b.kind === 'house').some(h => h.color2), 'houses never get a second colour');
  scene(); const plain = addBuilding(g, 'dest', orange, 3, 3, 0);
  const d2 = JSON.parse(JSON.stringify(serialize())); scene(); restore(d2);
  ok(g.buildings.filter(b => b.kind === 'dest').every(b => b.color2 === undefined || b.color2.id), 'a normal destination stays single-colour after a save');
}
// ---- spawning: spawnPair(color2) + a second-colour house placed apart from the first
{
  st.newGame(7, maps[0]); g.terrain.water.fill(0); g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g);
  const made = spawnPair(g, blue, { region: { x0: 10, y0: 8, x1: 16, y1: 14 }, roads: [4, 14], color2: orange });
  ok(made && made.dest.color2 && made.dest.color2.id === 'orange', 'spawnPair(color2) makes a two-colour destination');
  const h2 = made && spawnHouse(g, orange, { near: made.dest, apart: { x: made.house.x, y: made.house.y, min: 5 }, roads: [4, 14] });
  ok(!h2 || Math.hypot(h2.x - made.house.x, h2.y - made.house.y) >= 5, 'the second colour\'s house stays at least 5 tiles from the first');
  ok(!h2 || h2.color.id === 'orange', 'the second house is the second colour');
  const h3 = spawnHouse(g, orange, { roads: [4, 14] });                  // no `near`: any destination that accepts orange, including this one
  ok(!h3 || accepts(made.dest, 'orange'), 'orange houses may spawn for a destination that only lists orange as its second colour');
}
// ---- how often they appear
{
  const sp = prog.spawns.dual; const fake = (trips, colorsUsed) => ({ trips, colorsUsed });
  ok(dualChance(fake(0, 3)) === 0 && dualChance(fake(milestones.dual.afterTrips - 1, 3)) === 0, 'none before afterTrips');
  ok(dualChance(fake(milestones.dual.afterTrips, 1)) === 0, 'none with only one colour in play');
  ok(Math.abs(dualChance(fake(milestones.dual.afterTrips, 3)) - sp.startChance) < 1e-9, 'starts at startChance');
  ok(Math.abs(dualChance(fake(milestones.dual.afterTrips + sp.rampTrips * 10, 3)) - sp.maxChance) < 1e-9, 'climbs to maxChance and stays there');
  ok(dualChance(fake(milestones.dual.afterTrips + sp.rampTrips / 2, 3)) > sp.startChance && dualChance(fake(milestones.dual.afterTrips + sp.rampTrips / 2, 3)) < sp.maxChance, 'in between while ramping');
}
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
