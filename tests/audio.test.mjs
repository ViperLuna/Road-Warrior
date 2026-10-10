import { normalize, pickIndex } from '../js/audio.js';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
ok(JSON.stringify(normalize('a.mp3').files) === '["a.mp3"]', 'string entry');
ok(normalize(['a', 'b']).files.length === 2, 'list entry');
const o = normalize({ files: ['a', 'b'], volume: 0.5, pitchJitter: 0.1 });
ok(o.volume === 0.5 && o.pitchJitter === 0.1 && o.volumeJitter === 0, 'object entry keeps options, fills defaults');
ok(normalize('a').cooldownMs === 0 && normalize({ files: ['a'], cooldownMs: 70 }).cooldownMs === 70, 'cooldownMs defaults to 0 and is kept')
ok(normalize({ file: 'x' }).files[0] === 'x', 'single "file" key');
ok(pickIndex(1, 0) === 0 && pickIndex(0, null) === 0, 'single variant');
// never repeats the previous variant, and every other variant can come up
for (const n of [2, 3, 4]) {
  const seen = new Set(); let repeat = false, last = null;
  for (let i = 0; i < 2000; i++) { const k = pickIndex(n, last); if (k === last || k < 0 || k >= n) repeat = true; seen.add(k); last = k; }
  ok(!repeat && seen.size === n, `${n} variants: no immediate repeat, all used`);
}
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
