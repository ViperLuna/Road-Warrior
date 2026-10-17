import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const { setTuning, tuning } = await import(R + 'js/tuning.js');
const { signalState, stepLight, lightHolds } = await import(R + 'js/signals.js');
setTuning(JSON.parse(fs.readFileSync(R + 'config/tuning.json')));
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
const { minGreenSeconds: lo, maxGreenSeconds: hi, gapOutSeconds: gap } = tuning.trafficLight;
const run = (sig, secs, dem, dt = 0.05) => { for (let t = 0; t < secs; t += dt) stepLight(sig, typeof dem === 'function' ? dem(t) : dem, dt); };

{ // nobody on the cross street: green stays put
  const s = signalState({}); run(s, 60, [1, 0]); ok(s.stage === 'green' && s.axis === 0, 'no cross demand: the green stays');
}
{ // main stream with one-car holes shorter than the gap-out: green holds until the cap
  const s = signalState({}); run(s, hi - 0.5, t => [(t % 1.2) < 0.9 ? 1 : 0, 1]);
  ok(s.stage === 'green' && s.axis === 0, 'short holes in the stream do not flip the light');
  run(s, 1.5, [1, 1]);
  ok(s.stage !== 'green' || s.axis !== 0, 'the cap of ' + hi + ' s flips it whatever is still coming');
}
{ // main axis runs dry: flips after the gap-out, not before
  const s = signalState({}); run(s, lo + 0.1, [1, 1]); run(s, gap - 0.3, [0, 1]);
  ok(s.stage === 'green' && s.axis === 0, 'still green just inside the gap-out');
  run(s, 0.6, [0, 1]);
  ok(s.stage === 'allred' || s.axis === 1, 'flips once the street has been empty for ' + gap + ' s');
}
{ // the side street gets the same rules
  const s = signalState({}); run(s, 30, [0, 1]); ok(s.axis === 1 && s.stage === 'green', 'side street got its green');
  const t0 = s.t; run(s, hi + 2, [1, 1]); ok(s.axis === 0, 'and gives it back at the cap too (was green ' + t0.toFixed(1) + ')');
}
ok(lightHolds({ stage: 'green', axis: 0, t: 1, gap: 0, dem: [1, 1] }, 0, 3), 'a chain light with traffic on the green axis holds until the cap');
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
