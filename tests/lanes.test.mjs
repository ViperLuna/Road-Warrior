// On a 4-lane road a car takes the lane its turn needs (right turns from the outer lane, left turns from the inner lane), and a stadium gate
// works the same whichever way the stadium faces.
import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const st = await import(R + 'js/state.js');
const { setTuning, tuning } = await import(R + 'js/tuning.js');
const { setProgression, setMaps, setMilestones, maps } = await import(R + 'js/progression.js');
const { addBuilding, reindex, entsOf, exitTile } = await import(R + 'js/buildings.js');
const { createCar } = await import(R + 'js/cars.js');
const { DIR, OPP } = await import(R + 'js/lanes.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
setProgression(JSON.parse(fs.readFileSync(R + 'config/progression.json')));
setMaps(JSON.parse(fs.readFileSync(R + 'config/maps.json')));
setMilestones(JSON.parse(fs.readFileSync(R + 'config/milestones.json')));
const palette = JSON.parse(fs.readFileSync(R + 'config/colors.json')).colors; st.setPalette(palette);
const g = st.game; let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
const hl = maps.find(m => m.id === 'highlands');
const gap = (a, b) => Math.hypot(a.pts[3][0] - b.pts[0][0], a.pts[3][1] - b.pts[0][1]);

for (const rot of [0, 1, 2, 3]) {
  st.newGame(5 + rot, hl); g.terrain.water.fill(0); g.nextSpawnAt = 1e9; g.nextGoalAt = 1e9; g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g); g.inv.road = 9999; g.inv.highway = 9999; g.mode = 'play'; g.colorsUsed = palette.length;
  tuning.gridlock.gameOverAfterSeconds = 1e9;
  for (const k of ['house', 'stadium', 'gates']) { tuning.deadlines[k].graceSeconds = 1e9; tuning.deadlines[k].warnSeconds = 1e9; }
  const arena = addBuilding(g, 'dest', palette[0], 30, 20, rot); arena.stadium = true; arena.gates = [-1, 2]; arena.slots = new Array(40).fill(null); reindex(g);
  const ex = entsOf(arena).map(e => exitTile(arena, e)), [ax, ay] = ex[0], [bx, by] = ex[1], ux = Math.sign(bx - ax), uy = Math.sign(by - ay), o = DIR[rot];
  g.build4 = true; for (let i = -8; i <= 11; i++) st.buildRoad(ax + ux * i, ay + uy * i); g.build4 = false;
  for (const i of [-6, -4, 7, 9]) { const h = addBuilding(g, 'house', palette[0], ax + ux * i + o[0], ay + uy * i + o[1], (rot + 2) % 4); g.cars.push(createCar(h)); }
  reindex(g); g.cars.forEach(c => { c.forceStadium = true; });
  let bad = 0, turns = 0, jump = 0, seenIn = 0, seenOut = 0;
  const seen = new Set();
  for (let i = 0; i < 60 * 400; i++) {
    st.tick(1 / 60);
    for (const c of g.cars) {
      for (const pc of c.route) {
        if (seen.has(pc.key) || pc.kind !== 'road' || pc.tl !== 4 || pc.turn === 'straight' || pc.turn === 'round') continue;
        seen.add(pc.key); turns++;
        const want = pc.turn === 'right' ? 1 : 0;
        if ((pc.ei === 4 && pc.li !== want) || (pc.eo === 4 && pc.lo !== want)) bad++;
        if (pc.ei === 2 || pc.eo === 2) { if (pc.ei === 2) seenOut++; else seenIn++; }
      }
      for (let j = 0; j + 1 < c.route.length; j++) if (gap(c.route[j], c.route[j + 1]) > 0.02 && c.route[j].kind !== 'round' && c.route[j + 1].kind !== 'round') jump++;
    }
  }
  ok(turns > 6 && seenIn > 0 && seenOut > 0, 'rot ' + rot + ': cars turned into and out of the gates (' + turns + ' turn pieces)');
  ok(bad === 0, 'rot ' + rot + ': every turn on the 4-lane road uses the lane for its turn (' + bad + ' wrong of ' + turns + ')');
  ok(jump === 0, 'rot ' + rot + ': the route pieces join up (' + jump + ' jumps)');
  ok(g.trips > 3, 'rot ' + rot + ': traffic moves (' + g.trips + ' trips)');
}
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
