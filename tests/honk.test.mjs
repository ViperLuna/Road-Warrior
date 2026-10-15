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
{ const J = await import(R + 'js/jams.js'); const jev = []; const gg = { cars: [], time: 0, jams: [] }; const note = e => { if (e.type === 'jam') jev.push(e); };
  const car = (x, y, stuck) => ({ state: 'out', stuck, x, y });
  gg.cars = [car(10.5, 10.5, warn + 1), car(11.5, 10.5, warn + 2), car(30, 30, 1)]; for (let i = 0; i < 4; i++) { gg.time += 0.5; J.stepJams(gg, 0.5, note); }
  ok(jev.length === 1 && jev[0].type === 'jam' && jev[0].spots.length === 1, 'two blinking cars side by side are ONE jam, reported once (' + jev.length + ')');
  for (let i = 0; i < 20; i++) { gg.time += 0.5; J.stepJams(gg, 0.5, note); } ok(jev.length === 1, 'and not again while it lasts');
  gg.cars = [car(40, 5, warn + 1)]; gg.time += 0.5; J.stepJams(gg, 0.5, note); ok(jev.length === 2, 'a jam somewhere else is a new one');
  gg.cars = []; for (let i = 0; i < 2 * (tuning.jams.forgetSeconds + 2); i++) { gg.time += 0.5; J.stepJams(gg, 0.5, note); } gg.cars = [car(10.5, 10.5, warn + 1)]; gg.time += 0.5; J.stepJams(gg, 0.5, note);
  ok(jev.length === 2, 'a jam that clears and flickers back within relogSeconds is not logged again (' + jev.length + ')');
  gg.cars = []; for (let i = 0; i < 4 * tuning.jams.relogSeconds; i++) { gg.time += 0.5; J.stepJams(gg, 0.5, note); } gg.cars = [car(10.5, 10.5, warn + 1)]; gg.time += 0.5; J.stepJams(gg, 0.5, note);
  ok(jev.length === 3, 'after the quiet time the same place can be reported again'); }
// the jam clock: the AREA loses the game even if the pack keeps shuffling
{ const J = await import(R + 'js/jams.js'); const evs = []; const note = e => evs.push(e); const T = tuning.jams;
  const gg = { cars: [], time: 0, jams: [] }; let lost = null;
  // a creeping pack: every ~13 s the front cars move (their stuck resets) but others are always blinking within the area
  const step = () => { gg.time += 0.5; const r = J.stepJams(gg, 0.5, note); if (r && !lost) lost = r; };
  for (let i = 0; i < 2 * (T.endSeconds + 5) && !lost; i++) { const phase = (i / 2) % 13; gg.cars = [{ state: 'out', stuck: phase < 6 ? warn + 1 : 0, x: 20.5, y: 20.5 }, { state: 'out', stuck: phase >= 6 ? warn + 1 : 0, x: 21.5, y: 20.5 }]; step(); }
  ok(!!lost && lost.kind === 'jam' && lost.spots.length === 1, 'a jam that keeps blinking (cars reset in turn) for ' + T.endSeconds + ' s loses the game');
  ok(evs.some(e => e.type === 'jam-warn' && e.seconds === T.warnSeconds), 'with a warning half way');
  const g2 = { cars: [], time: 0, jams: [] }; let lost2 = null;
  const step2 = () => { g2.time += 0.5; const r = J.stepJams(g2, 0.5, () => {}); if (r) lost2 = r; };
  for (let k = 0; k < 6; k++) { g2.cars = [{ state: 'out', stuck: warn + 1, x: 5, y: 5 }]; for (let i = 0; i < 2 * 35; i++) step2(); g2.cars = []; for (let i = 0; i < 2 * (T.forgetSeconds + 2); i++) step2(); }
  ok(!lost2, 'a jam that really clears (quiet for forgetSeconds) starts its clock again'); }
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
