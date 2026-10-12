// the best score is kept live, and a game can be ended on purpose
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; }, key: i => Object.keys(store)[i], get length() { return Object.keys(store).length; } };
import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const st = await import(R + 'js/state.js');
const { setTuning } = await import(R + 'js/tuning.js');
const { setProgression, setMaps, maps } = await import(R + 'js/progression.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
setProgression(JSON.parse(fs.readFileSync(R + 'config/progression.json')));
setMaps(JSON.parse(fs.readFileSync(R + 'config/maps.json')));
st.setPalette(JSON.parse(fs.readFileSync(R + 'config/colors.json')).colors);
const { serialize, restore } = await import(R + 'js/save.js');
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
const g = st.game, events = []; st.onEvent(e => events.push(e));
const riverbend = maps[0], lakeside = maps.find(m => m.unlock);

st.newGame(3, riverbend);
ok(st.bestFor(riverbend.id) === 0 && g.bestAtStart === 0, 'fresh start: no best yet');
g.trips = 10; st.trackBest(); st.flushBest();
ok(st.bestFor(riverbend.id) === 10, 'a run that never jams still posts its score (10)');
g.time += 1; g.trips = 20; st.trackBest();
ok(st.bestFor(riverbend.id) === 10, 'writes are throttled: only a couple of seconds apart');
g.time += 3; g.trips = 25; st.trackBest();
ok(st.bestFor(riverbend.id) === 25, 'and the next write after the pause carries the latest score');
g.trips = 30; st.trackBest(); st.flushBest();
ok(st.bestFor(riverbend.id) === 30, 'flushBest writes immediately');

// maps unlock from the live best, with a toast event, without losing
events.length = 0; st.newGame(3, riverbend); g.bestAtStart = 0; st.syncBest();
g.trips = (lakeside.unlock.trips) - 1; st.trackBest();
ok(!events.some(e => e.type === 'unlock'), 'not unlocked yet one trip short');
g.trips = lakeside.unlock.trips; st.trackBest(); st.flushBest();
ok(events.filter(e => e.type === 'unlock').length === 1 && events.find(e => e.type === 'unlock').map.id === lakeside.id, 'the unlock announces itself exactly once');
ok(st.isUnlocked(lakeside), 'and the map really is unlocked');
g.trips += 5; st.trackBest(); ok(events.filter(e => e.type === 'unlock').length === 1, 'no second announcement');

// ending a game on purpose
store['roadwarrior.best'] = JSON.stringify({ [riverbend.id]: 100 });
st.newGame(4, riverbend); events.length = 0;
ok(g.bestAtStart === 100, 'bestAtStart remembers the best when the run began');
g.trips = 130; g.money = 555; g.time = 300; g.mode = 'play'; st.finishRun();
ok(g.mode === 'over' && g.over.finished === true, 'finishRun ends the game');
ok(g.over.record === true && g.over.best === 130 && st.bestFor(riverbend.id) === 130, 'it counts as a new best (130 vs 100)');
ok(events.some(e => e.type === 'over' && e.finished && e.record), 'and says so in the event');
st.newGame(4, riverbend); g.trips = 90; g.mode = 'play'; st.finishRun();
ok(g.over.record === false && g.over.best === 130 && st.bestFor(riverbend.id) === 130, 'a lower score is not a record and the best stays');
st.newGame(4, riverbend); g.mode = 'menu'; st.finishRun(); ok(g.mode === 'menu', 'finishRun does nothing from the menu');

// the record flag survives a save + Continue (it is measured against the best at the START of the run)
st.newGame(5, riverbend); const startBest = g.bestAtStart; g.trips = 140; g.mode = 'play'; st.trackBest(); st.flushBest();   // best is already 140 in storage
const data = JSON.parse(JSON.stringify(serialize())); st.newGame(6, riverbend); restore(data);
ok(g.bestAtStart === startBest, 'bestAtStart is saved with the run');
g.mode = 'play'; st.finishRun(); ok(g.over.record === true, 'so the run is still a record after Continue, although storage already holds the new best');
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
