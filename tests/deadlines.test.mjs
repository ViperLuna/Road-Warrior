import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const st = await import(R + 'js/state.js');
const { setTuning, tuning } = await import(R + 'js/tuning.js');
const { setProgression, setMaps, setMilestones, milestones, maps } = await import(R + 'js/progression.js');
const { addBuilding, reindex, lotTile, exitTile, entsOf } = await import(R + 'js/buildings.js');
const { createCar } = await import(R + 'js/cars.js');
const { spawnStadium, spawnPortal } = await import(R + 'js/spawn.js');
const D = await import(R + 'js/deadlines.js');
const { serialize, restore } = await import(R + 'js/save.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
setProgression(JSON.parse(fs.readFileSync(R + 'config/progression.json')));
setMaps(JSON.parse(fs.readFileSync(R + 'config/maps.json')));
setMilestones(JSON.parse(fs.readFileSync(R + 'config/milestones.json')));
const palette = JSON.parse(fs.readFileSync(R + 'config/colors.json')).colors; st.setPalette(palette);
const g = st.game; let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
const events = []; st.onEvent(e => events.push(e));
const DL = tuning.deadlines, GRACE = DL.house.graceSeconds, WARN = DL.house.warnSeconds;
const S = (map = maps[0]) => { st.newGame(5, map); g.terrain.water.fill(0); g.nextSpawnAt = 1e9; g.nextGoalAt = 1e9; g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g); g.inv.road = 9999; g.mode = 'play'; g.watches = []; events.length = 0; };
const tickN = secs => { for (let i = 0; i < secs * 60 && g.mode === 'play'; i++) st.tick(1 / 60); };
const blue = palette[0], orange = palette[1];
const pave = (x0, y0, x1, y1) => {
  const key = (x, y) => y * g.cols + x, prev = new Map([[key(x0, y0), -1]]), q = [[x0, y0]];
  while (q.length) { const [x, y] = q.shift(); if (x === x1 && y === y1) break; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = key(nx, ny); if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows || prev.has(k) || g.buildingAt.has(k)) continue; prev.set(k, key(x, y)); q.push([nx, ny]); } }
  for (let k = key(x1, y1); k !== -1 && prev.has(k); k = prev.get(k)) st.buildRoad(k % g.cols, (k / g.cols) | 0);
};

// ---- a house with no road: silent grace, then a warning, then the game is over ----
S(); addBuilding(g, 'dest', blue, 20, 8, 3); const h = addBuilding(g, 'house', blue, 5, 8, 1); g.cars.push(createCar(h));
tickN(GRACE - 1);
ok(g.mode === 'play' && !events.some(e => e.type === 'impatient'), 'silent during the grace period');
tickN(2);
const warn = events.find(e => e.type === 'impatient' && e.kind === 'house');
ok(!!warn && warn.seconds === WARN && warn.spots.length === 1, 'a warning toast with the time left and the spot to show');
tickN(WARN - 3); ok(g.mode === 'play', 'still alive just before the end');
tickN(5); ok(g.mode === 'over' && g.over.reason && ['house', 'dest'].includes(g.over.reason.kind), 'game over when the clock runs out (' + (g.over && g.over.reason && g.over.reason.label) + ')');

// ---- connecting in time resets everything ----
S(); const d1 = addBuilding(g, 'dest', blue, 20, 8, 3); const [lx, ly] = lotTile(d1, 0); const h2 = addBuilding(g, 'house', blue, 6, ly - 1, 2); g.cars.push(createCar(h2));
tickN(GRACE + 5); ok(events.some(e => e.type === 'impatient'), 'warning given');
pave(6, ly, lx - 1, ly); tickN(3);
const w2 = g.watches.find(w => w.kind === 'house'); ok(w2.ok && w2.stage === 'ok', 'connected: the clock is off');
tickN(300); ok(g.mode === 'play', 'and it stays off');

// ---- breaking a connection: a settle time, then a toast and a fresh clock ----
st.demolish(lx - 2, ly); events.length = 0; tickN(1.5);
ok(!events.some(e => e.type === 'disconnected'), 'no "no longer connected" while the roads are still being edited (settle time)');
tickN(tuning.deadlines.settleSeconds + 1);
const dis = events.find(e => e.type === 'disconnected' && e.kind === 'house');
ok(!!dis && /house/.test(dis.label), 'toast: no longer connected (' + (dis && dis.label) + ')');
const w3 = g.watches.find(w => w.kind === 'house'); ok(w3.stage === 'grace' && w3.t < 5, 'the clock starts over from the beginning');
tickN(GRACE); ok(events.some(e => e.type === 'impatient' && e.kind === 'house' && e.spots.length), 'still broken after the grace period: the building complains (that one goes in the history, with its place)');
st.buildRoad(lx - 2, ly); tickN(3); ok(g.watches.find(w => w.kind === 'house').ok, 'rebuilt: connected again');

// ---- destinations: a destination no house reaches counts down too (and a two-colour one needs both colours) ----
S(); const dd = addBuilding(g, 'dest', blue, 20, 8, 3); dd.color2 = orange; const [dx, dy] = lotTile(dd, 0);
const hb = addBuilding(g, 'house', blue, 6, dy - 1, 2); g.cars.push(createCar(hb)); const ho = addBuilding(g, 'house', orange, 9, dy + 4, 0); g.cars.push(createCar(ho));
pave(6, dy, dx - 1, dy); tickN(5);
ok(g.watches.find(w => w.kind === 'dest').ok === false, 'a two-colour destination is not connected until both colours reach it');
pave(9, dy + 3, 9, dy); tickN(5); ok(g.watches.find(w => w.kind === 'dest').ok, 'now both reach it');

// ---- pausing stops the clocks ----
S(); addBuilding(g, 'dest', blue, 20, 8, 3); const h5 = addBuilding(g, 'house', blue, 5, 8, 1); g.cars.push(createCar(h5));
tickN(30); const t0 = g.watches.find(w => w.kind === 'house').t; g.mode = 'pause'; for (let i = 0; i < 600; i++) st.tick(1 / 60); ok(g.watches.find(w => w.kind === 'house').t === t0, 'a paused game does not run the clock');

// ---- stadium: popup first, then the clock; "one of each colour" ----
S(maps.find(m => m.id === 'highlands'));
const d3 = addBuilding(g, 'dest', blue, 30, 20, 3), [ax, ay] = lotTile(d3, 0), d4 = addBuilding(g, 'dest', orange, 30, 26, 3), [bx2, by2] = lotTile(d4, 0);
const hs1 = addBuilding(g, 'house', blue, 10, ay - 1, 2), hs2 = addBuilding(g, 'house', orange, 10, by2 - 1, 2); g.cars.push(createCar(hs1), createCar(hs2));
pave(10, ay, ax - 1, ay); pave(10, by2, bx2 - 1, by2); pave(10, ay, 10, by2); g.colorsUsed = 2;      // (one street network)
g.trips = milestones.stadium.afterTrips; g.colorsUsed = palette.length; g.colorsUsed = 2;
const arena = spawnStadium(g, { budget: 900 }); D.addStadiumWatch(g, arena);
ok(g.mode === 'notice' && D.pendingNotice(g) && /every colour/.test(D.pendingNotice(g).notice.text), 'a popup explains the rule and waits for [OK]');
for (let i = 0; i < 60 * 200; i++) st.tick(1 / 60); ok(g.watches.find(w => w.kind === 'stadium').t === 0 && g.mode === 'notice', 'the clock does not run while the popup is open');
st.ackNotice(); ok(g.mode === 'play', 'OK closes it');
const sw = () => g.watches.find(w => w.kind === 'stadium');
tickN(2); ok(!sw().ok && sw().detail.have === 0 && sw().detail.total === 2, 'stadium not connected: 0 of 2 colours');
const [ex, ey] = exitTile(arena, entsOf(arena)[0]); pave(10, ay, ex, ey); tickN(4);
ok(sw().ok === true && sw().detail.have === 2, 'one road from the street reaches it for both colours (' + sw().detail.have + ' of ' + sw().detail.total + ')');
ok(D.chipsOf(g).length === 0, 'no chip once connected');
// percentage rule
tuning.deadlines.requiredPercent = 100; const h6 = addBuilding(g, 'house', blue, 3, 3, 1); g.cars.push(createCar(h6)); tickN(2);
ok(sw().ok === false, 'with requiredPercent 100 a new blue house that has no road breaks the stadium rule'); tuning.deadlines.requiredPercent = 0; tickN(2);
ok(sw().ok === true, 'at 0 one of each colour is enough again');

// ---- the gates: one shared clock, each must reach the stadium and every colour ----
const g1 = spawnPortal(g, 0, arena, { budget: 900 }), g2 = spawnPortal(g, 2, arena, { budget: 900 });
D.addGateWatch(g, [g1, g2], ['north', 'south']); st.ackNotice();
const gw = () => g.watches.find(w => w.kind === 'gates');
ok(gw().ids.length === 2 && /north and south/.test(gw().notice.text), 'one watch for the wave, the popup names the directions');
const gx = g1.x, gy = g1.y + 1; pave(gx, gy, ex, ey); pave(gx, gy, 10, ay); tickN(4);
ok(gw().ok === false, 'one gate connected, the other not: the shared watch is not satisfied');
const hx = g2.x, hy = g2.y - 1; pave(hx, hy, ex, ey); pave(hx, hy, 10, ay); tickN(4);
ok(gw().ok === true, 'both gates connected to the stadium and a destination of each colour');
ok(D.chipsOf(g).length === 0, 'no chip once connected');

// ---- jam lock ----
S(); const d7 = addBuilding(g, 'dest', blue, 20, 8, 3); const [jx, jy] = lotTile(d7, 0); const h7 = addBuilding(g, 'house', blue, 6, jy - 1, 2); g.cars.push(createCar(h7)); pave(6, jy, jx - 1, jy);
const car = g.cars[0]; car.state = 'out'; car.stuck = tuning.gridlock.warnAfterSeconds + 1; car.x = 10.5; car.y = jy + 0.5; car.route = []; car.idx = 0;
events.length = 0; ok(st.demolish(10, jy) === false && g.roads.has(jy * g.cols + 10) && events.some(e => e.type === 'jam-locked'), 'a road under a blinking jammed car cannot be demolished');
events.length = 0; ok(st.demolish(9, jy) === false && st.demolish(11, jy) === false && events.some(e => e.type === 'jam-locked'), 'and so can neither road touching it (the tile it is waiting to enter)');
ok(st.demolish(12, jy) === true && st.demolish(8, jy) === true, 'but roads further along are free');
car.stuck = 1; ok(st.demolish(10, jy) === true && st.demolish(9, jy) === true, 'and they can once the car is not jammed');

// ---- saves keep the clocks and a pending popup ----
S(maps.find(m => m.id === 'highlands')); const d8 = addBuilding(g, 'dest', blue, 30, 20, 3); const h8 = addBuilding(g, 'house', blue, 10, 20, 1); g.cars.push(createCar(h8));
pave(11, 20, 28, 20); tickN(20); const A8 = spawnStadium(g, { budget: 900 }); g.colorsUsed = 1; D.addStadiumWatch(g, A8);
const data = JSON.parse(JSON.stringify(serialize())); restore(data);
ok(g.mode === 'notice' && !!D.pendingNotice(g), 'a popup that was waiting is waiting again after a load');
ok(g.watches.some(w => w.kind === 'house' && w.t > 10), 'house clocks carry over a load');
// ---- the message log: capped, kept with the game ----
S(); for (let i = 0; i < 260; i++) st.addLog('message ' + i, i % 2 ? [{ x0: i, y0: 1, x1: i, y1: 1 }] : []);
ok(g.log.length === st.LOG_MAX && g.log.at(-1).text === 'message 259' && g.log[0].text === 'message 60', 'the log keeps the newest ' + st.LOG_MAX);
const lg = JSON.parse(JSON.stringify(serialize())); restore(lg);
ok(g.log.length === st.LOG_MAX && g.log.at(-1).spots.length === 1 && g.log.at(-1).t === lg.log.at(-1).t, 'and comes back after a load, spots included');
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
