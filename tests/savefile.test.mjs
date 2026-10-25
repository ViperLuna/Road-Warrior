// Export and import of a save as a file (js/savefile.js), plus taking best scores from a file (state.js mergeBest).
import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const store = {};                                                  // a stand-in for localStorage, for the best scores
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; }, key: i => Object.keys(store)[i], get length() { return Object.keys(store).length; } };
const st = await import(R + 'js/state.js');
const { setTuning } = await import(R + 'js/tuning.js');
const { setProgression, setMaps, maps } = await import(R + 'js/progression.js');
const { serialize, restore, SAVE_VERSION } = await import(R + 'js/save.js');
const { makeExport, readExport, exportFileName, FILE_KIND, MAX_BYTES } = await import(R + 'js/savefile.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
setProgression(JSON.parse(fs.readFileSync(R + 'config/progression.json')));
setMaps(JSON.parse(fs.readFileSync(R + 'config/maps.json')));
const palette = JSON.parse(fs.readFileSync(R + 'config/colors.json')).colors; st.setPalette(palette);
const g = st.game; let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
const ctx = { maps, saveVersion: SAVE_VERSION };

// a real game with some history in it
st.newGame(11, maps[0]); g.mode = 'play'; g.nextGoalAt = 1e9;
for (let i = 0; i < 60 * 90; i++) st.tick(1 / 60);
g.trips = 321;
const save = JSON.parse(JSON.stringify(serialize()));
const text = JSON.stringify(makeExport(save, { riverbend: 948, metro: 37178 }));

// the round trip
let r = readExport(text, ctx);
ok(r.ok && r.save.trips === 321 && r.summary.map === maps[0].name && r.summary.trips === 321, 'a file made by Export reads back (' + (r.error || r.summary.map + ', ' + r.summary.trips + ' trips') + ')');
ok(r.ok && r.best.riverbend === 948 && r.best.metro === 37178, 'with its best scores');
ok(JSON.parse(text).kind === FILE_KIND, 'and the file says what it is');
st.newGame(99, maps[0]); restore(r.save);
ok(g.trips === 321 && g.buildings.length === save.buildings.length && g.cars.length === save.cars.length && g.roads.size === save.roads.length, 'and restoring it rebuilds the same game (' + g.trips + ' trips, ' + g.buildings.length + ' buildings, ' + g.cars.length + ' cars)');
ok(readExport(JSON.stringify(save), ctx).ok, 'a bare save with no wrapper is accepted too');
ok(readExport(JSON.stringify(save), ctx).ok && Object.keys(readExport(JSON.stringify(save), ctx).best).length === 0, 'and carries no best scores');

// files that are not saves
const bad = (t, why) => { const x = readExport(t, ctx); ok(!x.ok && typeof x.error === 'string' && x.error.length > 5, why + ' is refused with a message' + (x.ok ? '' : ' ("' + x.error.slice(0, 40) + '...")')); return x; };
bad('', 'an empty file'); bad('   \n', 'a blank file'); bad('not json at all', 'text that is not JSON'); bad('[1, 2, 3]', 'a JSON list'); bad('{"hello": "world"}', 'some other JSON'); bad('null', 'null');
bad(JSON.stringify({ ...save, roads: 'no' }), 'a save whose roads are not a list');
bad(JSON.stringify({ ...save, map: 'atlantis' }), 'a save for an unknown map');
bad(JSON.stringify({ ...save, cars: undefined }), 'a save with no cars list');
bad(JSON.stringify({ ...save, terrain: {} }), 'a save with no terrain');
bad(JSON.stringify({ ...save, trips: 'lots' }), 'a save with a text trip count');
const newer = bad(JSON.stringify({ ...save, version: SAVE_VERSION + 1 }), 'a save from a newer version'); ok(/newer/.test(newer.error), 'and it says it is newer');
const older = bad(JSON.stringify({ ...save, version: SAVE_VERSION - 1 }), 'a save from an older version'); ok(/older/.test(older.error), 'and it says it is older');
bad('x'.repeat(MAX_BYTES + 1), 'a file that is far too big');

// best scores in the file are cleaned up
const dirty = readExport(JSON.stringify({ ...makeExport(save), best: { riverbend: 10.9, metro: -5, lakeside: 'big', atlantis: 99, highlands: 0 } }), ctx);
ok(dirty.ok && JSON.stringify(dirty.best) === JSON.stringify({ riverbend: 10 }), 'best scores: only real maps, only positive numbers, whole trips (' + JSON.stringify(dirty.best) + ')');

// the file name
ok(exportFileName({ map: 'metro', trips: 9775 }) === 'road-warrior-metro-9775-trips.json', 'the file name says the map and the trips');
ok(!/[\/\\ ]/.test(exportFileName({ map: '../evil map', trips: 1 })), 'and cannot carry a path or spaces');

// taking best scores: they only go up
store['roadwarrior.best'] = JSON.stringify({ riverbend: 948, highlands: 11535 });
st.mergeBest({ riverbend: 500, highlands: 20000, metro: 37178 });
const after = JSON.parse(store['roadwarrior.best']);
ok(after.riverbend === 948 && after.highlands === 20000 && after.metro === 37178, 'importing best scores raises them and never lowers one (' + JSON.stringify(after) + ')');
st.mergeBest(undefined); st.mergeBest({}); ok(JSON.parse(store['roadwarrior.best']).metro === 37178, 'and an empty set changes nothing');
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
