// Audio manager. Browsers block sound until a user gesture, so the splash screen calls unlock().
// Sounds are registered by name; add files under assets/sounds/ and list them in SOUNDS.
const SOUNDS = {
  // example: click: 'assets/sounds/click.mp3',
};

let ctx = null;
const buffers = new Map();
let muted = false;

export async function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') await ctx.resume();
  await Promise.all(Object.entries(SOUNDS).map(async ([name, url]) => {
    if (buffers.has(name)) return;
    try {
      const res = await fetch(url);
      buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
    } catch (e) { console.warn('sound failed to load:', name, e); }
  }));
}

export function play(name, { volume = 1, rate = 1 } = {}) {
  const buf = buffers.get(name);
  if (!ctx || !buf || muted) return;
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  src.buffer = buf;
  src.playbackRate.value = rate;
  gain.gain.value = volume;
  src.connect(gain).connect(ctx.destination);
  src.start();
}

export function setMuted(m) { muted = m; }
export function isMuted() { return muted; }
