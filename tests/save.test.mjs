import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const st = await import(R + 'js/state.js');
const { setTuning } = await import(R + 'js/tuning.js');
const { setProgression, setMaps, maps } = await import(R + 'js/progression.js');
const S = await import(R + 'js/save.js');
const bot = await import(R + 'sim/bot.js');
const { mulberry32 } = await import(R + 'js/rng.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
setProgression(JSON.parse(fs.readFileSync(R + 'config/progression.json')));
setMaps(JSON.parse(fs.readFileSync(R + 'config/maps.json')));
const palette = JSON.parse(fs.readFileSync(R + 'config/colors.json')).colors; st.setPalette(palette);
const g = st.game;
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
// fake localStorage
const store = new Map(); globalThis.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), key: i => [...store.keys()][i], get length() { return store.size; } };

const playUntil = (secs, b) => { while (g.time < secs && g.mode !== 'over') { bot.botTick(g, b); if (g.mode === 'reward') continue; st.tick(1 / 60); } };
for (const [seed, mapId] of [[3, 'riverbend'], [7, 'lakeside'], [11, 'highlands']]) {
  Math.random = mulberry32(seed * 977);
  st.newGame(seed, maps.find(m => m.id === mapId));
  const b = bot.createBot({ reward: 'smart' });
  playUntil(480, b);
  const moving = g.cars.filter(c => c.state === 'out' || c.state === 'back').length;
  ok(moving >= 3, `${mapId}: traffic exists at save time (${moving} cars out)`);
  const data = JSON.parse(JSON.stringify(S.serialize()));
  const bytes = JSON.stringify(data).length;
  // wipe the game completely, then restore
  st.newGame(999, maps[0]);
  S.restore(data);
  const again = JSON.parse(JSON.stringify(S.serialize()));
  again.savedAt = data.savedAt;
  ok(JSON.stringify(again) === JSON.stringify(data), `${mapId}: save -> restore -> save is identical (${(bytes / 1024).toFixed(0)} KB, ${data.cars.length} cars, ${data.roads.length} road tiles)`);
  ok(g.cars.every(c => c.route.every(p => p && p.key)) && g.cars.every(c => c.state === 'home' || c.route[c.idx]), `${mapId}: every car has a valid route piece`);
  ok(g.buildings.every(bd => !bd.slots || bd.slots.every(s => s === null || g.cars.includes(s))), `${mapId}: lot slots point at real cars`);
  ok(g.terrain.mainId >= 0 && g.terrain.comp.length === g.cols * g.rows, `${mapId}: terrain rebuilt`);
  // carry on: the game must keep running, trips keep coming, traffic is still there
  const trips0 = g.trips, t0 = g.time;
  let err = null; try { playUntil(t0 + 120, b); } catch (e) { err = e; }
  ok(!err, `${mapId}: runs 2 more minutes after loading ${err ? err.stack : ''}`);
  ok(g.trips > trips0 + 5 || g.mode === 'over', `${mapId}: trips continue after loading (${g.trips - trips0})`);
  ok(g.cars.every(c => Number.isFinite(c.x + c.y + c.a + c.v)), `${mapId}: no NaN cars`);
}
// the point of it: a jam survives a "refresh"
Math.random = mulberry32(5);
st.newGame(3, maps[0]);
const gb = bot.createBot({ reward: 'smart' }); playUntil(300, gb);
g.cars.forEach(c => { c.cooldown = 0; });
const before = g.cars.map(c => [c.id, c.state, +c.x.toFixed(3), +c.y.toFixed(3)].join());
const d2 = JSON.parse(JSON.stringify(S.serialize())); st.newGame(1, maps[0]); S.restore(d2);
const after = g.cars.map(c => [c.id, c.state, +c.x.toFixed(3), +c.y.toFixed(3)].join());
ok(JSON.stringify(before) === JSON.stringify(after), 'every car comes back in exactly the same place');
// a goal reward waiting to be picked survives too
Math.random = mulberry32(8);
st.newGame(4, maps[0]); g.trips = g.nextGoalAt + 1; (await import(R + 'js/progress.js')).checkProgress(g, () => {});
if (g.mode === 'reward') {
  const rd = JSON.parse(JSON.stringify(S.serialize())); st.newGame(2, maps[0]); S.restore(rd);
  ok(g.mode === 'reward' && g.reward.options.length === 2, 'reward screen restored with its two choices');
  ok(g.reward.options.every(o => !o.special || (o.special.id && o.special.name)), 'reward specials are real shop items again');
  const m0 = g.money; st.chooseReward('plain'); ok(g.mode === 'play' && g.money > m0, 'picking the restored reward works');
} else ok(false, 'could not trigger a reward in the test');
// backends
const slot = 'test';
ok(S.localBackend.save(slot, { hello: 1, savedAt: 5 }) && S.localBackend.load(slot).hello === 1, 'local backend round-trips');
ok(S.localBackend.list().some(x => x.slot === slot), 'local backend lists slots');
ok(S.localBackend.remove(slot) && S.localBackend.load(slot) === null, 'local backend removes');
// http backend against a fake server
const db = new Map();
const fakeFetch = async (url, o = {}) => { const m = o.method || 'GET'; const slot = decodeURIComponent(url.split('/').pop()); const resp = (status, body) => ({ status, ok: status < 300, json: async () => body });
  if (url.endsWith('/saves')) return resp(200, [...db.keys()].map(s => ({ slot: s })));
  if (m === 'PUT') { db.set(slot, JSON.parse(o.body)); return resp(200, {}); } if (m === 'DELETE') { db.delete(slot); return resp(200, {}); }
  return db.has(slot) ? resp(200, db.get(slot)) : resp(404, null); };
const http = S.httpBackend({ baseUrl: 'https://example.test/saves', fetchFn: fakeFetch });
ok(await http.save('a', { x: 1 }) && (await http.load('a')).x === 1 && (await http.load('zzz')) === null && (await http.list()).length === 1 && await http.remove('a') && (await http.load('a')) === null, 'http backend (fake server) works through the same interface');
// switching the backend moves where saves go
S.setBackend(http); S.configure({ backend: 'http', slot: 'main' });
st.newGame(3, maps[0]); ok(await S.saveNow(), 'saveNow goes to the chosen backend'); ok(db.has('main') && (await S.describeSave()).map === maps[0].name, 'describeSave reads it back from the same backend');
// bad data is refused, not half-loaded
let threw = false; try { S.restore({ version: 99 }); } catch { threw = true; } ok(threw, 'unknown save version is rejected');
console.log(pass, 'passed', fail, 'failed');
