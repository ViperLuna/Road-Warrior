import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const st = await import(R + 'js/state.js');
const { setTuning, tuning } = await import(R + 'js/tuning.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
const events = []; st.onEvent(e => events.push(e));
const g = st.game, { warnAfterSeconds: warn, gameOverAfterSeconds: over } = tuning.gridlock;
const run = (stuck, seconds, state = 'out') => {          // one car held at `stuck` for `seconds` of game time
  events.length = 0; g.cars = [{ state, stuck, honkIn: undefined }];
  for (let i = 0; i < seconds * 60; i++) st.honkAtStuckCars(1 / 60);
  return events.filter(e => e.type === 'honk');
};
ok(run(warn - 1, 30).length === 0, 'a car that is not stuck long enough stays quiet');
ok(run(warn + 1, 30, 'home').length === 0, 'a parked car stays quiet');
const calm = run(warn + 0.1, 30).length, mad = run(over - 0.1, 30).length;
ok(calm >= 3 && calm <= 9, `just-started-glowing car honks slowly (${calm} in 30 s)`);
ok(mad >= 12, `nearly-game-over car honks a lot faster (${mad} in 30 s)`);
ok(mad > calm * 2, 'honking speeds up as the car gets madder');
const ev = run(over - 0.1, 5);
ok(ev.length && ev.every(e => e.k > 0.9 && e.k <= 1), 'k is how mad the car is (0..1)');
// jams reach the history once each
{ const J = await import(R + 'js/jams.js'); const jev = []; const gg = { cars: [], time: 0, jams: [] }; const note = e => jev.push(e);
  const car = (x, y, stuck) => ({ state: 'out', stuck, x, y });
  gg.cars = [car(10.5, 10.5, warn + 1), car(11.5, 10.5, warn + 2), car(30, 30, 1)]; for (let i = 0; i < 4; i++) { gg.time += 0.5; J.stepJams(gg, 0.5, note); }
  ok(jev.length === 1 && jev[0].type === 'jam' && jev[0].spots.length === 1, 'two blinking cars side by side are ONE jam, reported once (' + jev.length + ')');
  for (let i = 0; i < 20; i++) { gg.time += 0.5; J.stepJams(gg, 0.5, note); } ok(jev.length === 1, 'and not again while it lasts');
  gg.cars = [car(40, 5, warn + 1)]; gg.time += 0.5; J.stepJams(gg, 0.5, note); ok(jev.length === 2, 'a jam somewhere else is a new one');
  gg.cars = []; for (let i = 0; i < 40; i++) { gg.time += 0.5; J.stepJams(gg, 0.5, note); } gg.cars = [car(10.5, 10.5, warn + 1)]; gg.time += 0.5; J.stepJams(gg, 0.5, note);
  ok(jev.length === 3, 'once it has cleared the same place can be reported again'); }
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
