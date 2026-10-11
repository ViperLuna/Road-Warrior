// Background music: a shuffled playlist of long, slow songs that crossfade into each other.
// Songs live in assets/music/ and are listed in config/music.json:
//   { "crossfadeSeconds": 4, "tracks": [ { "title": "Quiet Asphalt", "file": "assets/music/quiet-asphalt.mp3" }, ... ] }
// (a track can also be just a file name; the title is then made from the file name). No tracks = no music and no music button.
// Volume, mute and on/off come from settings.js (musicVolume, musicMuted, musicOn), so the Settings screen and the music panel
// share one truth. Browsers only allow sound after a click, so start() is called from the splash screen's Start button.
import { settings, setSetting, onSetting, gainOf } from './settings.js';
import { getContext } from './audio.js';

let tracks = [], crossfade = 4;
let queue = [], history = [], current = -1;
const slots = [];                       // two <audio> elements that take turns, so one song can fade out while the next fades in
let active = 0, bus = null, started = false, fading = false;
const listeners = new Set();
export const onMusic = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => fn(getState()));

export const titleOf = t => t.title || String(t.file).replace(/^.*\//, '').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');

// A shuffled order of 0..n-1 for the next lap through the playlist; the first song never repeats the one that just played.
export function makeQueue(n, last, rng = Math.random) {
  const q = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
  if (n > 1 && q[0] === last) { const j = 1 + Math.floor(rng() * (n - 1)); [q[0], q[j]] = [q[j], q[0]]; }
  return q;
}
function pickNext() {
  if (!queue.length) queue = makeQueue(tracks.length, current);
  return queue.shift();
}

export function setTracks(list, crossfadeSeconds = 4) {
  tracks = (list || []).map(t => (typeof t === 'string' ? { file: t } : t)).filter(t => t && t.file);
  crossfade = Math.max(0, Number(crossfadeSeconds) || 0);
  queue = []; history = []; current = -1;
  emit();
}
export async function loadConfig() {
  try {
    const r = await fetch('config/music.json', { cache: 'no-cache' });
    if (r.ok) { const c = await r.json(); setTracks(c.tracks, c.crossfadeSeconds ?? 4); }
  } catch { /* no music configured */ }
}

export const getState = () => ({
  count: tracks.length,
  title: current >= 0 && tracks[current] ? titleOf(tracks[current]) : '',
  playing: started && settings.musicOn,
});

function ensureGraph() {
  const ctx = getContext();
  if (!ctx) return false;
  if (bus) return true;
  bus = ctx.createGain();
  bus.connect(ctx.destination);
  applyVolume();
  for (let i = 0; i < 2; i++) {
    const el = new Audio(); el.preload = 'auto';
    const gain = ctx.createGain(); gain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(gain).connect(bus);
    el.addEventListener('timeupdate', () => { if (i === active) watch(el); });
    el.addEventListener('ended', () => { if (i === active && !fading) advance(1); });
    slots.push({ el, gain });
  }
  return true;
}
function applyVolume() {
  if (!bus) return;
  bus.gain.value = settings.musicMuted ? 0 : gainOf(settings.musicVolume);
}

// Near the end of the song: start the next one underneath so they overlap.
function watch(el) {
  if (fading || !settings.musicOn || !(el.duration > 0)) return;
  if (el.duration - el.currentTime <= crossfade + 0.1) advance(1);
}

// Play a song. dir = 1 next (shuffled), -1 previous (history). The old song fades out while the new one fades in.
function advance(dir) {
  if (!tracks.length || !ensureGraph()) return;
  let idx;
  if (dir < 0 && history.length > 1) { history.pop(); idx = history[history.length - 1]; }
  else { idx = pickNext(); history.push(idx); if (history.length > 50) history.shift(); }
  play(idx);
}
function play(idx) {
  const ctx = getContext(), now = ctx.currentTime;
  const from = slots[active], to = slots[1 - active];
  const t = tracks[idx];
  current = idx;
  to.el.src = t.file; to.el.currentTime = 0;
  const fade = from.el.paused ? 0 : crossfade;
  to.gain.gain.cancelScheduledValues(now);
  to.gain.gain.setValueAtTime(fade ? 0 : 1, now);
  if (fade) to.gain.gain.linearRampToValueAtTime(1, now + fade);
  to.el.play().catch(() => {});
  from.gain.gain.cancelScheduledValues(now);
  from.gain.gain.setValueAtTime(from.gain.gain.value, now);
  from.gain.gain.linearRampToValueAtTime(0, now + fade);
  fading = true; active = 1 - active;
  const old = from.el;
  setTimeout(() => { old.pause(); fading = false; }, fade * 1000 + 50);
  emit();
}

// Called from the splash Start click (a user gesture, so the browser allows sound).
export function start() {
  if (started || !tracks.length) return;
  started = true;
  if (settings.musicOn && ensureGraph()) advance(1);
  emit();
}
export function next() { if (started && settings.musicOn) advance(1); }
export function prev() { if (started && settings.musicOn) advance(-1); }
export function toggle() {
  if (!started) return;
  setSetting('musicOn', !settings.musicOn);
}

onSetting(name => {
  if (name === 'musicVolume' || name === 'musicMuted') applyVolume();
  if (name === 'musicOn' && started) {
    const a = slots[active];
    if (settings.musicOn) { if (current < 0) advance(1); else a && a.el.play().catch(() => {}); }
    else slots.forEach(s => s.el.pause());
    emit();
  }
});

// For tests and debugging: what the two audio elements are doing right now.
export const status = () => ({ active, fading, slots: slots.map(s => ({ src: s.el.src.slice(-8), t: +s.el.currentTime.toFixed(2), d: +(s.el.duration || 0).toFixed(2), paused: s.el.paused, g: +s.gain.gain.value.toFixed(2) })) });
