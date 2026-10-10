import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const st = await import(R + 'js/state.js');
const { setTuning } = await import(R + 'js/tuning.js');
const { setProgression, setMaps, maps } = await import(R + 'js/progression.js');
const { roadConns } = await import(R + 'js/network.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
setProgression(JSON.parse(fs.readFileSync(R + 'config/progression.json')));
setMaps(JSON.parse(fs.readFileSync(R + 'config/maps.json')));
const palette = JSON.parse(fs.readFileSync(R + 'config/colors.json')).colors; st.setPalette(palette);
const g = st.game; let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
st.newGame(5, maps[0]); g.terrain.water.fill(0); g.nextSpawnAt = 1e9; g.nextGoalAt = 1e9; g.buildings = []; g.cars = []; g.roads = new Map();
for (let y = 8; y <= 12; y++) for (let x = 10; x <= 12; x++) g.terrain.water[y * g.cols + x] = 1;      // a river, 3 wide
g.inv.road = 99; g.inv.bridge = 3; g.mode = 'play';
const span = y => { st.buildRoad(9, y); st.buildBridge({ x: 9, y }, [10, 11, 12].map(x => ({ x, y })), { x: 13, y }); };
span(10); span(11);                                  // two bridges side by side
ok(roadConns(g, 11, 10).includes(2) && roadConns(g, 11, 11).includes(0), 'side-by-side bridges touch (an intersection in the middle of the span)');
ok(!st.setCut(10, 10, 11, 10, true), 'cutting ALONG a bridge is refused');
ok(st.setCut(11, 10, 11, 11, true), 'cutting across the side of a bridge works');
ok(!roadConns(g, 11, 10).includes(2) && !roadConns(g, 11, 11).includes(0), 'the two bridges no longer connect');
ok(roadConns(g, 11, 10).includes(1) && roadConns(g, 11, 10).includes(3), 'each bridge still runs end to end');
ok(st.setCut(11, 11, 11, 10, false) && roadConns(g, 11, 10).includes(2), 'rejoining works');
console.log(pass, 'passed', fail, 'failed');
