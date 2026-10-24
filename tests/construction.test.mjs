import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const st = await import(R + 'js/state.js');
const { setTuning, tuning } = await import(R + 'js/tuning.js');
const { setProgression, setMaps, setMilestones, milestones, maps } = await import(R + 'js/progression.js');
const { addBuilding, reindex, lotTile } = await import(R + 'js/buildings.js');
const { createCar } = await import(R + 'js/cars.js');
const { workPiece, pieceFromKey, roadPiece, OPP } = await import(R + 'js/lanes.js');
const { startConstruction } = await import(R + 'js/construction.js');
const { serialize, restore } = await import(R + 'js/save.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
setProgression(JSON.parse(fs.readFileSync(R + 'config/progression.json')));
setMaps(JSON.parse(fs.readFileSync(R + 'config/maps.json')));
setMilestones(JSON.parse(fs.readFileSync(R + 'config/milestones.json')));
const palette = JSON.parse(fs.readFileSync(R + 'config/colors.json')).colors; st.setPalette(palette);
const g = st.game; let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
const events = []; st.onEvent(e => events.push(e));
const tickN = secs => { for (let i = 0; i < secs * 60; i++) st.tick(1 / 60); };
let ly;
const S = (trips = 0) => {
  st.newGame(5, maps[0]); g.terrain.water.fill(0); g.nextSpawnAt = 1e9; g.nextGoalAt = 1e9; g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g); g.inv.road = 999; g.mode = 'play';
  tuning.gridlock.gameOverAfterSeconds = 40;
  const blue = palette[0];
  const d = addBuilding(g, 'dest', blue, 24, 10, 3); const l = lotTile(d, 0); ly = l[1];
  for (let x = 3; x <= l[0] - 1; x++) st.buildRoad(x, ly);
  for (let i = 0; i < 9; i++) { const h = addBuilding(g, 'house', blue, 3 + i * 2, ly - 1, 2); g.cars.push(createCar(h)); }
  g.trips = trips; events.length = 0;
};

// ---- the piece: same ends as the plain lane, crossing the center line in between, and saved by key
{
  const plain = roadPiece(10, 10, 3, 1), w = workPiece(10, 10, 3);
  const e = (p, i) => p.pts[i];
  ok(Math.hypot(e(w, 0)[0] - e(plain, 0)[0], e(w, 0)[1] - e(plain, 0)[1]) < 1e-9 && Math.hypot(e(w, 3)[0] - e(plain, 3)[0], e(w, 3)[1] - e(plain, 3)[1]) < 1e-9, 'it starts and ends where the plain lane does');
  const mid = w.xy[8], pm = plain.xy[8];
  ok(Math.abs(mid[1] - pm[1]) > 0.18 && Math.abs(mid[1] - pm[1]) < 0.3, 'and swings across to the oncoming lane in the middle (' + Math.abs(mid[1] - pm[1]).toFixed(2) + ')');
  ok(pieceFromKey(w.key) === w && w.work && w.base === plain, 'it round-trips through its save key');
}

// ---- one-lane working: both ways are used, never at once
S();
let started = false; for (let i = 0; i < 60 * 30 && !started; i++) { st.tick(1 / 60); started = startConstruction(g, () => {}); }
ok(started && !!g.work, 'works start on a busy straight tile');
if (g.work) {
  const w = g.work, wk = w.k;
  events.length = 0; ok(st.demolish(w.x, w.y) === false && g.roads.has(wk) && events.some(e => e.type === 'jam-locked' && e.why === 'works'), 'the road works tile cannot be demolished');
  ok(w.left <= tuning.gridlock.gameOverAfterSeconds - 1, 'their length is kept below the game-over time (' + w.left + ' s)');
  let both = 0, frames = 0, seenClosed = 0, seenOpen = 0, plainClosed = 0, maxStuck = 0;
  const trips0 = g.trips;
  for (let i = 0; i < 60 * 36; i++) {
    st.tick(1 / 60);
    if (!g.work) break;
    const on = g.cars.filter(c => (c.state === 'out' || c.state === 'back') && c.route[c.idx] && c.route[c.idx].tx === w.x && c.route[c.idx].ty === w.y && c.route[c.idx].kind === 'road');
    const a = on.filter(c => c.route[c.idx].in === w.closedIn), b = on.filter(c => c.route[c.idx].in !== w.closedIn);
    if (a.length) seenClosed++; if (b.length) seenOpen++; if (a.some(c => !c.route[c.idx].work)) plainClosed++;
    if (a.length && b.length) both++; frames++;
    maxStuck = Math.max(maxStuck, ...g.cars.map(c => c.stuck));
  }
  ok(seenClosed > 8 && seenOpen > 8, 'both directions got through (' + seenClosed + ' / ' + seenOpen + ' frames)');
  ok(plainClosed < 5, 'cars from the coned side use the shared-lane piece (' + plainClosed + ' frames on the plain lane)');
  ok(both < frames * 0.03, 'and the two directions are not in the tile together (' + both + ' of ' + frames + ' frames)');
  ok(g.trips > trips0 + 3, 'traffic keeps flowing through it (' + (g.trips - trips0) + ' trips)');
  ok(maxStuck < tuning.gridlock.gameOverAfterSeconds && g.mode === 'play', 'nobody is stuck long enough to end the game (' + maxStuck.toFixed(1) + ' s)');
  tickN(tuning.construction.durationSeconds);
  ok(g.work === null && events.some(e => e.type === 'construction-cleared'), 'the works clear after their time');
  ok(st.demolish(w.x, w.y) === true, 'and the tile can be demolished again');
  ok(!g.cars.some(c => c.route.slice(c.idx + 1).some(p => p.work)), 'and no car still has the shared-lane piece planned ahead');
  ok(g.nextAccidentAt > g.time, 'the next event is scheduled');
  tickN(30); ok(g.trips > trips0 + 6, 'traffic is normal afterwards');
}

// ---- the cones can land on either side of the road
{
  const sides = new Set();
  for (let n = 0; n < 40 && sides.size < 2; n++) {
    S(); for (let i = 0; i < 60 * 12; i++) st.tick(1 / 60);
    if (startConstruction(g, () => {})) sides.add(g.work.closedIn);
  }
  ok(sides.has(1) && sides.has(3), 'the closed lane can be either side of the road (eastbound and westbound): ' + [...sides].join(','));
}

// ---- the works are on the accident schedule, from their own milestone
S(milestones.accidents.afterTrips);
let nCon = 0, nAcc = 0, firstCon = null;
for (let i = 0; i < 60 * 2400 && nAcc < 1; i++) { st.tick(1 / 60); g.trips = Math.max(g.trips, milestones.accidents.afterTrips); g.nextGoalAt = 1e9; g.cars.forEach(c => { c.stuck = 0; }); if (g.work) nCon++; if (g.accident) nAcc++; }
ok(nCon === 0 && nAcc > 0, 'before the construction milestone only accidents happen');
S(milestones.construction.afterTrips); tuning.accidents.switchAfterSeconds = 1e9;           // (an accident needs two cars close together: wait for one rather than switching kinds)
let sawC = false, sawA = false, bothAtOnce = 0;
for (let i = 0; i < 60 * 6000 && !(sawC && sawA); i++) {
  st.tick(1 / 60); g.trips = Math.max(g.trips, milestones.construction.afterTrips); g.nextGoalAt = 1e9; g.cars.forEach(c => { c.stuck = 0; });
  if (g.work) sawC = true; if (g.accident) sawA = true;
  if (g.work && g.accident) bothAtOnce++;
}
ok(bothAtOnce === 0, 'never both at once');
ok(sawC && sawA, 'past it both kinds come up (works: ' + sawC + ', accident: ' + sawA + ')');

// ---- a save drops the works but old routes still load
S(); startConstruction(g, () => {}); tickN(2);
const data = JSON.parse(JSON.stringify(serialize())); restore(data);
ok(g.work === null, 'a save made during the works loads without them');
tickN(20); ok(g.cars.every(c => Number.isFinite(c.x)), 'and the cars carry on');
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
