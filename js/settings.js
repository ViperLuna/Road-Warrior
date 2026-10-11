// Player preferences, kept in this browser (not in save games). Read them straight off `settings`; change them with setSetting;
// react to changes with onSetting(fn) (fn gets the setting's name).
const KEY = 'roadwarrior.settings';
const defaults = { showCuts: true, sfxVolume: 1, sfxMuted: false, musicVolume: 0.75, musicMuted: false, musicOn: true };
export const settings = { ...defaults };
try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { /* storage unavailable */ }
const listeners = new Set();
export const onSetting = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export function setSetting(name, value) {
  settings[name] = value;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
  listeners.forEach(fn => fn(name));
}
// A 0..1 slider position becomes a gain on a curve (halving the slider is not halving the loudness).
export const gainOf = v => Math.max(0, Math.min(1, v)) ** 2;
