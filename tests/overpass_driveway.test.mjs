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
const { overpassFit } = st;
const orange = palette[1], blue = palette[0];
const key = (x, y) => y * g.cols + x;

// E-W road y=11 (x 6..26) crossing a N-S road x=16 that stops at the crossing from the north (y 3..10); a building sits on the SOUTH arm.
function scene(southBuilding = 'house') {
  st.newGame(5, maps[0]); g.terrain.water.fill(0); g.nextSpawnAt = 1e9; g.nextGoalAt = 1e9; g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g);
  g.inv.road = 999; g.inv.overpass = 3; g.money = 999; g.mode = 'play';
  for (let x = 6; x <= 26; x++) st.buildRoad(x, 11);
  for (let y = 3; y <= 10; y++) st.buildRoad(16, y);
  addBuilding(g, 'dest', blue, 27, 10, 3); addBuilding(g, 'dest', orange, 15, 1, 2);       // blue dest at the east end, orange dest at the north end
  const mk = (col, x, y, rot) => { const h = addBuilding(g, 'house', col, x, y, rot); g.cars.push(createCar(h)); return h; };
  mk(blue, 8, 10, 2); mk(blue, 21, 12, 0);                                                  // blue houses on the E-W road
  if (southBuilding === 'house') { mk(orange, 16, 12, 0); mk(orange, 18, 10, 2); }          // orange house at the south end of the N-S road (its driveway leads into the crossing)
  else {                                                                                   // a destination whose front entrance is on the tile just south of the crossing
    const d = addBuilding(g, 'dest', orange, 16, 12, 0); d.ent = 0; reindex(g); mk(orange, 18, 10, 2);
  }
  return {};
}

// ---- a house's driveway on one end of the street underneath
scene();
{
  const fit = overpassFit(16, 11);
  ok(typeof fit === 'object' && fit.top === 1, 'a driveway at the south end of the N-S road: the deck is the E-W road (' + JSON.stringify(fit) + ')');
  ok(st.placeSpecial('overpass', 16, 11) === 'ok', 'the overpass is placed right next to the building');
  const r = g.roads.get(key(16, 11));
  ok(r.overpass === 1 && g.inv.overpass === 2, 'deck runs east-west, the road with the driveway goes underneath');
  ok(st.placeSpecial('overpass', 16, 11) === 'driveway' && r.overpass === 1, 'tapping it again will not swap the deck onto the road that ends at the building');
  let stuck = 0, t0 = g.trips, orangeTrips = 0;
  for (let i = 0; i < 60 * 150; i++) {
    st.tick(1 / 60);
    for (const c of g.cars) stuck = Math.max(stuck, c.stuck);
  }
  ok(g.trips - t0 >= 20, 'traffic flows through and over it (' + (g.trips - t0) + ' trips)');
  ok(stuck < 12, 'nobody gets stuck (worst ' + stuck.toFixed(1) + ' s)');
  const orangeHouses = g.buildings.filter(b => b.kind === 'house' && b.color.id === 'orange');
  ok(orangeHouses.every(h => g.cars.find(c => c.house === h)), 'orange cars exist');
}

// ---- a destination lot's entrance can be the end of the street underneath too
scene('dest');
{
  const [ex, ey] = [16, 11];
  ok(typeof overpassFit(ex, ey) === 'object', 'a parking lot entrance at one end works the same way');
  ok(st.placeSpecial('overpass', ex, ey) === 'ok', 'placed');
  let stuck = 0, t0 = g.trips;
  for (let i = 0; i < 60 * 150; i++) { st.tick(1 / 60); for (const c of g.cars) stuck = Math.max(stuck, c.stuck); }
  ok(g.trips - t0 >= 15 && stuck < 12, 'traffic still flows (' + (g.trips - t0) + ' trips, worst stuck ' + stuck.toFixed(1) + ' s)');
}

// ---- never from the driveway: a building on BOTH ways, or two buildings on one way
{
  scene('house');
  // remove the east road beyond the crossing and put a building on the east arm: both ways now end at a building
  for (let x = 17; x <= 26; x++) st.demolish(x, 11);
  const e = addBuilding(g, 'house', orange, 17, 11, 3);
  ok(g.ports.has(key(17, 11)) && overpassFit(16, 11) === 'driveway', 'a building on both ways: refused, the deck would have to come from a driveway (' + JSON.stringify(overpassFit(16, 11)) + ')');
  ok(st.placeSpecial('overpass', 16, 11) === 'driveway' && g.inv.overpass === 3, 'and no overpass is spent');
}
{
  scene('house');
  // the N-S road is just the house and another house: no road on that way at all
  for (let y = 3; y <= 10; y++) st.demolish(16, y);
  addBuilding(g, 'house', orange, 16, 10, 2);
  ok(overpassFit(16, 11) === 'notcrossing', 'a way with buildings at both ends and no road is not a crossing');
}

// ---- unchanged rules: roads on all four arms still work; a T does not
{
  scene('house'); g.buildings = g.buildings.filter(b => !(b.kind === 'house' && b.x === 16 && b.y === 12)); reindex(g); st.buildRoad(16, 12); st.buildRoad(16, 13);
  ok(typeof overpassFit(16, 11) === 'object', 'a plain four-road crossing still works');
  st.demolish(16, 10); ok(overpassFit(16, 11) === 'notcrossing', 'a T is still refused');
}
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
