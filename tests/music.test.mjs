import { makeQueue, titleOf, setTracks, getState } from '../js/music.js';
import { settings, gainOf } from '../js/settings.js';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
// shuffle: every song once per lap, and a new lap never opens with the song that just finished
for (const n of [1, 2, 3, 5, 12]) {
  let last = -1, bad = 0, bad2 = 0;
  for (let lap = 0; lap < 500; lap++) {
    const q = makeQueue(n, last);
    if (q.length !== n || new Set(q).size !== n) bad++;
    if (n > 1 && q[0] === last) bad2++;
    last = q[q.length - 1];
  }
  ok(!bad, `${n} songs: each lap plays every song exactly once`);
  ok(!bad2, `${n} songs: a lap never starts with the song that just played`);
}
// every ordering shows up (it really is shuffled)
const firsts = new Set(Array.from({ length: 400 }, () => makeQueue(4, -1)[0]));
ok(firsts.size === 4, 'any song can open a lap');
ok(titleOf({ file: 'assets/music/quiet-asphalt_v2.mp3' }) === 'quiet asphalt v2', 'title made from the file name');
ok(titleOf({ title: 'Quiet Asphalt', file: 'x.mp3' }) === 'Quiet Asphalt', 'explicit title wins');
setTracks([]); ok(getState().count === 0 && !getState().playing, 'no tracks: nothing to play');
setTracks(['a.mp3', { title: 'B', file: 'b.mp3' }, null, {}]); ok(getState().count === 2, 'plain file names and objects accepted, junk dropped');
// settings: defaults and the volume curve
ok(settings.musicVolume === 0.75 && settings.sfxVolume === 1 && !settings.musicMuted && !settings.sfxMuted, 'defaults: music 75%, effects 100%, nothing muted');
ok(gainOf(1) === 1 && gainOf(0) === 0 && gainOf(0.5) === 0.25 && gainOf(2) === 1 && gainOf(-1) === 0, 'volume curve is clamped and quieter than linear');
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
