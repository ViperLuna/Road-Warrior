import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const st = await import(R + 'js/state.js');
const { setTuning, tuning } = await import(R + 'js/tuning.js');
const { setProgression, setMaps, setMilestones, maps, prog } = await import(R + 'js/progression.js');
const { addBuilding, reindex, lotTile } = await import(R + 'js/buildings.js');
const { createCar } = await import(R + 'js/cars.js');
const { tunnelMouths, roadConns } = await import(R + 'js/network.js');
const T = await import(R + 'js/terrain.js');
const { serialize, restore } = await import(R + 'js/save.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
setProgression(JSON.parse(fs.readFileSync(R + 'config/progression.json')));
setMaps(JSON.parse(fs.readFileSync(R + 'config/maps.json')));
setMilestones(JSON.parse(fs.readFileSync(R + 'config/milestones.json')));
const palette = JSON.parse(fs.readFileSync(R + 'config/colors.json')).colors; st.setPalette(palette);
const g = st.game; let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
const events = []; st.onEvent(e => events.push(e));
const blue = palette[0];
const idx = (x, y) => y * g.cols + x;
const S = () => {
  st.newGame(5, maps[0]); g.terrain.water.fill(0); g.nextSpawnAt = 1e9; g.nextGoalAt = 1e9; g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g); g.inv.road = 9999; g.inv.tunnel = 0; g.mode = 'play'; g.watches = []; events.length = 0;
  for (const k of ['house', 'stadium', 'gates']) { tuning.deadlines[k].graceSeconds = 1e9; tuning.deadlines[k].warnSeconds = 1e9; }
  for (let y = 6; y <= 12; y++) for (let x = 10; x <= 16; x++) g.terrain.water[idx(x, y)] = T.HILL;      // a hill, 7 x 7, in the middle
};
const tickN = secs => { for (let i = 0; i < secs * 60 && g.mode === 'play'; i++) st.tick(1 / 60); };

// ---- digging: one block, one piece, only next to a road ----
S();
ok(st.buildTunnelTile(13, 9) === 'noroad', 'a hill tile with no road beside it cannot be dug');
for (let x = 3; x <= 9; x++) st.buildRoad(x, 9);
ok(st.buildTunnelTile(10, 9) === 'notunnel', 'no pieces, no tunnel');
g.inv.tunnel = 3; const roads0 = g.inv.road;
ok(st.buildTunnelTile(10, 9) === 'ok' && g.inv.tunnel === 2 && g.inv.road === roads0, 'one block uses one tunnel piece (and no road piece)');
ok(g.roads.get(idx(10, 9)).tunnel === true, 'it is a tunnel tile');
ok(st.buildTunnelTile(10, 9) === 'exists', 'digging the same block again does nothing');
ok(st.buildTunnelTile(14, 9) === 'noroad', 'the next block has to touch the tunnel so far');
ok(st.buildTunnelTile(11, 9) === 'ok' && st.buildTunnelTile(11, 10) === 'ok' && g.inv.tunnel === 0, 'a tunnel can bend: east, then south (pieces used up)');
ok(st.buildTunnelTile(11, 11) === 'notunnel', 'out of pieces');
ok(st.buildTunnelTile(2, 9) === 'nothill', 'only hill tiles take a tunnel');
const mouths = tunnelMouths(g, 10, 9);
ok(mouths.length === 1 && mouths[0] === 3, 'the first block has a mouth facing the road at the edge (west)');
ok(tunnelMouths(g, 11, 9).length === 0, 'a block deep in the hill has none (cars on it are out of sight)');

// ---- a half-dug tunnel is an incomplete road; finished, it carries cars ----
S();
const d = addBuilding(g, 'dest', blue, 18, 8, 3); const [lx, ly] = lotTile(d, 0);
const h = addBuilding(g, 'house', blue, 6, ly - 1, 2); g.cars.push(createCar(h));
for (let x = 6; x <= 9; x++) st.buildRoad(x, ly); for (let x = 17; x <= lx - 1; x++) st.buildRoad(x, ly);
g.inv.tunnel = 20; for (let x = 10; x <= 14; x++) st.buildTunnelTile(x, ly);                         // dug as far as x = 14: three blocks short
tickN(120); ok(g.trips === 0, 'a half-dug tunnel carries nobody (no trips)');
for (let x = 15; x <= 16; x++) st.buildTunnelTile(x, ly); tickN(120);
ok(g.trips >= 2, 'once it reaches the far side the trips start (' + g.trips + ')');
ok(g.inv.tunnel === 20 - 7, 'seven blocks cost seven pieces');
// out of sight inside, visible at the mouths
ok(tunnelMouths(g, 10, ly).length === 1 && tunnelMouths(g, 16, ly).length === 1 && tunnelMouths(g, 13, ly).length === 0, 'mouths at both ends only');

// ---- demolishing: a block at a time, the piece comes back ----
const t0 = g.inv.tunnel; ok(st.demolish(13, ly) === true && !g.roads.has(idx(13, ly)) && g.inv.tunnel === t0 + 1, 'demolish takes out ONE block and refunds one piece');
ok(g.roads.has(idx(12, ly)) && g.roads.has(idx(14, ly)), 'the rest of the tunnel stays');

// ---- two tunnels side by side can be cut ----
S(); g.inv.tunnel = 20;
for (let x = 3; x <= 9; x++) { st.buildRoad(x, 8); st.buildRoad(x, 9); }
for (let x = 10; x <= 13; x++) { st.buildTunnelTile(x, 8); st.buildTunnelTile(x, 9); }
ok(roadConns(g, 11, 8).includes(2) && roadConns(g, 11, 9).includes(0), 'tunnels side by side touch and connect');
ok(st.setCut(11, 8, 11, 9, true) === true && !roadConns(g, 11, 8).includes(2) && !roadConns(g, 11, 9).includes(0), 'the Cut tool cuts the seam between them');
ok(st.setCut(12, 8, 12, 9, true) === true, 'along the whole length');
ok(st.setCut(11, 8, 11, 9, false) === true && roadConns(g, 11, 8).includes(2), 'and joins it again');

// ---- old saves: whole-span tunnels become blocks, with a thank-you ----
S(); g.inv.tunnel = 0;
for (let x = 3; x <= 9; x++) st.buildRoad(x, 9); for (let x = 17; x <= 20; x++) st.buildRoad(x, 9);
const span = [10, 11, 12, 13, 14, 15, 16].map(x => idx(x, 9));
span.forEach((k, i) => g.roads.set(k, { lanes: 2, tunnel: 7, axis: 1, ...(i === 0 ? { portal: 3 } : i === 6 ? { portal: 1 } : {}) })); g.bridges.set(7, span);
const second = [10, 11, 12].map(x => idx(x, 11)); st.buildRoad(9, 11); second.forEach((k, i) => g.roads.set(k, { lanes: 2, tunnel: 8, axis: 1, ...(i === 0 ? { portal: 3 } : {}) })); g.bridges.set(8, second);
const data = JSON.parse(JSON.stringify(serialize())); events.length = 0; restore(data);
ok([...g.roads.values()].filter(r => r.tunnel).every(r => r.tunnel === true && r.axis === undefined && r.portal === undefined), 'old tunnel tiles became plain tunnel blocks');
ok(g.roads.size === data.roads.length, 'nothing was lost');
ok(g.inv.tunnel === 2 * prog.economy.tunnelConversionBonus, 'two old tunnels: a thank-you of ' + 2 * prog.economy.tunnelConversionBonus + ' pieces (' + g.inv.tunnel + ')');
ok(events.some(e => e.type === 'tunnel-bonus' && e.tunnels === 2), 'and a message about it');
ok(![...g.bridges.keys()].some(id => id === 7 || id === 8), 'the old span records are gone');
ok(tunnelMouths(g, 10, 9).length === 1 && tunnelMouths(g, 16, 9).length === 1 && tunnelMouths(g, 12, 9).length === 0, 'mouths now come from the shape: both ends');
const again = JSON.parse(JSON.stringify(serialize())); restore(again);
ok(g.inv.tunnel === 2 * prog.economy.tunnelConversionBonus, 'the thank-you is given once (a second load changes nothing)');

// ---- a reward gives a few pieces; buying gives one ----
S(); const sp = prog.specials.find(s => s.id === 'tunnel');
ok(sp.rewardGrant >= 2 && !(sp.grant > 1), 'tunnel rewards hand out a few pieces, the shop one at a time');
g.money = 1000; const inv0 = g.inv.tunnel; st.buy('tunnel'); ok(g.inv.tunnel === inv0 + 1 && g.money === 1000 - sp.cost, 'a purchase is one piece at the old per-tunnel price ($' + sp.cost + ')');
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
