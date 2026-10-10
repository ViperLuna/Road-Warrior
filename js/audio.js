// Audio manager. Browsers block sound until a user gesture, so the splash screen calls unlock().
// Sounds are listed in config/sounds.json by event name. An entry can be one file, a list of files (a random one plays each
// time, never the same one twice in a row), or an object with options:
//   "destroy": { "files": ["assets/sounds/destroy1.mp3", "assets/sounds/destroy2.mp3"], "volume": 0.8, "pitchJitter": 0.05, "volumeJitter": 0.1 }
// pitchJitter: +/- fraction of playback speed; volumeJitter: +/- fraction of volume, both picked fresh every play.
// Game code just calls play('destroy').

let ctx = null;
let defs = {};                     // name -> { files, volume, pitchJitter, volumeJitter }
const buffers = new Map();         // url -> decoded audio
const lastPicked = new Map();      // name -> index of the variant played last
let muted = false;

// Turn any accepted config entry into the full object form.
export function normalize(entry) {
  const o = typeof entry === 'string' ? { files: [entry] } : Array.isArray(entry) ? { files: entry } : { ...entry };
  o.files = (Array.isArray(o.files) ? o.files : o.file ? [o.file] : []).filter(Boolean);
  o.volume = o.volume ?? 1; o.pitchJitter = o.pitchJitter ?? 0; o.volumeJitter = o.volumeJitter ?? 0;
  return o;
}

// Index of the variant to play: random, but never the one just played (unless there's only one).
export function pickIndex(count, last, rng = Math.random) {
  if (count <= 1) return 0;
  if (last == null || last < 0 || last >= count) return Math.floor(rng() * count);
  const i = Math.floor(rng() * (count - 1));
  return i >= last ? i + 1 : i;
}

export function setSounds(config) {
  defs = {};
  for (const [name, entry] of Object.entries(config || {})) if (!name.startsWith('_')) defs[name] = normalize(entry);
}

export async function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') await ctx.resume();
  if (!Object.keys(defs).length) {
    try { const r = await fetch('config/sounds.json', { cache: 'no-cache' }); if (r.ok) setSounds(await r.json()); } catch { /* no sounds configured */ }
  }
  const urls = new Set(Object.values(defs).flatMap(d => d.files));
  await Promise.all([...urls].map(async url => {
    if (buffers.has(url)) return;
    try {
      const res = await fetch(url);
      buffers.set(url, await ctx.decodeAudioData(await res.arrayBuffer()));
    } catch (e) { console.warn('sound failed to load:', url, e); }
  }));
}

// play('destroy'); optional { volume, rate } multiply the entry's own settings.
export function play(name, { volume = 1, rate = 1 } = {}) {
  const d = defs[name];
  if (!ctx || !d || muted) return;
  const ready = d.files.map((url, i) => [i, buffers.get(url)]).filter(([, b]) => b);       // skip files that failed to load
  if (!ready.length) return;
  const pick = ready[pickIndex(ready.length, ready.findIndex(([i]) => i === lastPicked.get(name)))];
  lastPicked.set(name, pick[0]);
  const jitter = j => 1 + (Math.random() * 2 - 1) * j;
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  src.buffer = pick[1];
  src.playbackRate.value = rate * jitter(d.pitchJitter);
  gain.gain.value = volume * d.volume * jitter(d.volumeJitter);
  src.connect(gain).connect(ctx.destination);
  src.start();
}

export function setMuted(m) { muted = m; }
export function isMuted() { return muted; }
