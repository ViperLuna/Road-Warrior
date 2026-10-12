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
const { entOf, entSide, entrancesOf, exitTile, baysOf, footprint, lotTile } = await import(R + 'js/buildings.js');
const { serialize, restore } = await import(R + 'js/save.js');
const { DIR, OPP } = await import(R + 'js/lanes.js');
const blue = palette[0];
const key = (x, y) => y * g.cols + x;

// One destination `d` (big, or small on `half`), turned `rot`, entrance `ent`; a straight road leads away from that entrance to 4 houses.
function scene(small, half, rot, ent) {
  st.newGame(5, maps[0]); g.terrain.water.fill(0); g.nextSpawnAt = 1e9; g.nextGoalAt = 1e9; g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g);
  g.inv.road = 999; g.money = 999; g.mode = 'play';
  const d = addBuilding(g, 'dest', blue, 14, 12, rot); if (small) { d.small = true; d.half = half; } d.ent = ent; reindex(g);
  const side = entSide(rot, ent), D = DIR[side], [ex, ey] = exitTile(d, ent);
  const taken = new Set([...footprint(d)].map(([x, y]) => key(x, y)));
  for (let i = 0; i < 6; i++) st.buildRoad(ex + D[0] * i, ey + D[1] * i);
  const P = [DIR[(side + 1) % 4], DIR[(side + 3) % 4]];
  let made = 0;
  for (const [i, pi] of [[2, 0], [2, 1], [4, 0], [4, 1]]) {
    const hx = ex + D[0] * i + P[pi][0], hy = ey + D[1] * i + P[pi][1];
    if (taken.has(key(hx, hy)) || g.roads.has(key(hx, hy)) || g.buildingAt.has(key(hx, hy))) continue;
    const h = addBuilding(g, 'house', blue, hx, hy, OPP[(pi === 0 ? (side + 1) % 4 : (side + 3) % 4)]);
    g.cars.push(createCar(h)); made++;
  }
  return { d, made };
}
const start = p => p.pts[0], end = p => p.pts[3];
const jump = (a, b) => Math.hypot(end(a)[0] - start(b)[0], end(a)[1] - start(b)[1]);

let combos = 0;
for (const [small, half] of [[false, 0], [true, 0], [true, 1]]) for (let rot = 0; rot < 4; rot++) {
  const probe = scene(small, half, rot, small ? half : 0).d;
  for (const ent of entrancesOf(probe)) {
    const { d, made } = scene(small, half, rot, ent);
    const name = `${small ? 'small half ' + half : 'big'} rot ${rot} ent ${ent}`;
    combos++;
    ok(made >= 3, `${name}: test scene has houses (${made})`);
    ok(g.ports.get(key(...lotTile(d, ent & 1)))?.ent === ent, `${name}: the port records the entrance`);
    const seen = new Set(), bays = baysOf(d); let maxParked = 0, bad = 0;
    for (let i = 0; i < 60 * 100; i++) {
      st.tick(1 / 60);
      for (const c of g.cars) if (c.state === 'out' || c.state === 'back') for (let j = 1; j < c.route.length; j++) if (jump(c.route[j - 1], c.route[j]) > 0.03) bad++;
      d.slots.forEach((c, k) => { if (c) seen.add(k); });
      maxParked = Math.max(maxParked, d.slots.filter(c => c).length);
    }
    ok(bad === 0, `${name}: every route is continuous (no jumps between pieces)`);
    ok([...seen].every(k => bays.includes(k)) && maxParked <= bays.length, `${name}: only its own bays are used`);
    ok(g.trips >= 6, `${name}: cars arrive and get home (${g.trips} trips)`);
    const worst = g.cars.reduce((m, c) => Math.max(m, c.stuck), 0);
    ok(worst < 12, `${name}: nobody is stuck (worst ${worst.toFixed(1)} s)`);
  }
}
console.log(combos, 'entrance setups');

// ---- tapping the lot cycles the entrance clockwise, skipping places no road can reach
{
  const { d } = scene(false, 0, 2, 0);
  const tapTile = () => lotTile(d, 0);
  const order = [entOf(d)];
  for (let i = 0; i < 4; i++) { ok(st.flipLotAt(...lotTile(d, entOf(d) & 1)), 'tap moves the entrance'); order.push(entOf(d)); }
  ok(JSON.stringify(order) === JSON.stringify([0, 1, 5, 2, 0]), 'big: front tile 0 -> front tile 1 -> +T end -> -T end -> back to the start (clockwise), got ' + order);
  // clockwise: the direction the entrance faces turns the same way as the building does (rot + 1)
  const faces = [0, 1, 5, 2].map(e => entSide(2, e));
  ok(JSON.stringify(faces) === JSON.stringify([2, 2, 3, 1]), 'the facing goes front, front, then round to the next side clockwise (S, S, W, E for a building facing south)');
  const { d: s1 } = scene(true, 1, 2, 1);
  const o2 = [entOf(s1)]; for (let i = 0; i < 3; i++) { st.flipLotAt(...lotTile(s1, 1)); o2.push(entOf(s1)); }
  ok(JSON.stringify(o2) === JSON.stringify([1, 5, 3, 1]), 'small: front -> +T side -> -T side -> front, got ' + o2);
  ok(entOf(s1) & 1 && footprint(s1).length === 2, 'a small destination stays on its own lot tile');
  // an entrance with a building outside it is skipped
  const { d: s2 } = scene(true, 0, 2, 0);
  const [ex, ey] = exitTile(s2, 4);
  addBuilding(g, 'house', blue, ex, ey, 0);
  st.flipLotAt(...lotTile(s2, 0));
  ok(entOf(s2) === 2, 'a blocked side is skipped (went to ent 2, not 4), got ' + entOf(s2));
}

// ---- save/load keeps the entrance, and old saves (gate 0/1) still mean the front
{
  const { d } = scene(false, 0, 1, 5); const data = JSON.parse(JSON.stringify(serialize())); scene(false, 0, 0, 0); restore(data);
  ok(entOf(g.buildings.find(b => b.kind === 'dest')) === 5, 'save/restore keeps a side entrance');
  const old = { kind: 'dest', gate: 1, rot: 0, x: 1, y: 1 }; ok(entOf(old) === 1, 'an old save with gate 1 is front tile 1');
  const old0 = { kind: 'dest', rot: 0, x: 1, y: 1 }; ok(entOf(old0) === 0, 'and no gate is front tile 0');
}
// ---- the very first destination of a new game always uses the front entrance
{
  let sides = 0;
  for (let seed = 1; seed <= 40; seed++) { st.newGame(seed, maps[0]); const d = g.buildings.find(b => b.kind === 'dest'); if (d && (entOf(d) >> 1) !== 0) sides++; }
  ok(sides === 0, 'new games start with a front entrance (' + sides + ' of 40 did not)');
}
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
