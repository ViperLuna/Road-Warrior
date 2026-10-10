// Player preferences, kept in this browser (not in save games). Read them straight off `settings`; change them with setSetting.
const KEY = 'roadwarrior.settings';
const defaults = { showCuts: true };
export const settings = { ...defaults };
try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { /* storage unavailable */ }
export function setSetting(name, value) {
  settings[name] = value;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}
