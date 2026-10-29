import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const st = await import(R + 'js/state.js');
const { setTuning } = await import(R + 'js/tuning.js');
const { setProgression, setMaps, maps, prog } = await import(R + 'js/progression.js');
const { checkProgress } = await import(R + 'js/progress.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
setProgression(JSON.parse(fs.readFileSync(R + 'config/progression.json')));
setMaps(JSON.parse(fs.readFileSync(R + 'config/maps.json')));
st.setPalette(JSON.parse(fs.readFileSync(R + 'config/colors.json')).colors);
const g = st.game; let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
st.newGame(5, maps[0]); g.mode = 'play'; g.nextSpawnAt = 1e9;
ok(prog.goals.maxGoals === 10, 'the goal limit is 10');
for (let i = 0; i < 10; i++) {               // the first ten goals each open the reward menu
  g.trips = g.nextGoalAt; checkProgress(g, () => {});
  ok(g.mode === 'reward' || g.reward === null, `goal ${i + 1} is reached`);
  if (g.reward) { st.chooseReward('plain'); g.mode = 'play'; }
}
ok(g.goalCount === 10, `ten goals done (${g.goalCount})`);
g.trips += 5000; g.mode = 'play'; checkProgress(g, () => {});
ok(g.goalCount === 10 && g.mode === 'play' && !g.reward, 'no eleventh goal, however many trips');
console.log(pass, 'passed', fail, 'failed');
