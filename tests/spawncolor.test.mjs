// Which color gets the next house: a plain random pick by default, the "demographics" balance when that difficulty option is on.
import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const st = await import(R + 'js/state.js');
const { setTuning } = await import(R + 'js/tuning.js');
const { setProgression, setMaps, maps } = await import(R + 'js/progression.js');
const { addBuilding, reindex } = await import(R + 'js/buildings.js');
const { pickSpawnColor } = await import(R + 'js/progress.js');
const { serialize, restore } = await import(R + 'js/save.js');
const { settings, setSetting } = await import(R + 'js/settings.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
setProgression(JSON.parse(fs.readFileSync(R + 'config/progression.json')));
setMaps(JSON.parse(fs.readFileSync(R + 'config/maps.json')));
const palette = JSON.parse(fs.readFileSync(R + 'config/colors.json')).colors; st.setPalette(palette);
const g = st.game; let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
const fresh = () => { st.newGame(5, maps[0]); g.terrain.water.fill(0); g.buildings = []; g.cars = []; g.roads = new Map(); g.nextId = 1; reindex(g); g.colorsUsed = 4; };
const tally = (n) => { const t = {}; for (let i = 0; i < n; i++) { const c = pickSpawnColor(g); t[c.id] = (t[c.id] || 0) + 1; } return t; };

ok(settings.difficulty.demographics === false, 'the demographics option is off by default');
// an unbalanced map: orange has two destinations and a pile of houses, pink and green have a destination each and few houses
const setup = () => {
  fresh();
  const [blue, orange, pink, green] = palette;
  [[blue, 2, 10], [orange, 2, 12], [pink, 1, 4], [green, 1, 2]].forEach(([c, d, h], i) => {
    for (let k = 0; k < d; k++) addBuilding(g, 'dest', c, 2 + k * 3, 2 + i * 6, 0);
    for (let k = 0; k < h; k++) addBuilding(g, 'house', c, 2 + k * 2, 5 + i * 6, 2);
  });
  reindex(g);
};
setup(); g.options = { demographics: false };
let t = tally(4000);
ok(palette.slice(0, 4).every(c => t[c.id] > 800 && t[c.id] < 1200), 'random: each of the four colors gets about a quarter of the picks (' + JSON.stringify(t) + ')');
setup(); g.options = { demographics: true };
t = tally(400);
ok(Object.keys(t).length === 1 && t[palette[3].id] === 400, 'demographics: the color with the fewest houses per destination always gets it (' + JSON.stringify(t) + ')');
// ties are still broken at random
fresh(); g.options = { demographics: true }; t = tally(2000);
ok(palette.slice(0, 4).every(c => t[c.id] > 350), 'demographics with an even map: ties are broken at random (' + JSON.stringify(t) + ')');
// only colors in play are picked
fresh(); g.colorsUsed = 2; g.options = { demographics: false }; t = tally(500);
ok(Object.keys(t).every(id => [palette[0].id, palette[1].id].includes(id)), 'random: only the colors already in play are picked');

// the setting is copied into a new game, and kept by a save; an old save (no options) loads as random
setSetting('difficulty', { demographics: true }); st.newGame(6, maps[0]);
ok(g.options.demographics === true, 'a new game takes the setting as it is when the game starts');
setSetting('difficulty', { demographics: false });
ok(g.options.demographics === true, 'and changing it afterwards does not change the game in progress');
g.mode = 'play'; const snap = JSON.parse(JSON.stringify(serialize())); restore(snap);
ok(g.options.demographics === true, 'a save keeps the choice');
delete snap.options; restore(snap);
ok(g.options.demographics === false, 'a save from before the option existed picks colors at random');
st.newGame(7, maps[0]); ok(g.options.demographics === false, 'and a new game with the box unticked is random');
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
