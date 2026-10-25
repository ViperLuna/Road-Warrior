// Saving a game to a file and loading one back: the pure part (no DOM, no storage), so it can be tested.
// The file is JSON: { kind, formatVersion, exportedAt, save, best } where `save` is exactly what serialize() (save.js) makes and `best` is
// the per-map best trips (so a new phone keeps its high scores). A bare save (no wrapper) is accepted on import too.
export const FILE_KIND = 'road-warrior-save';
export const FORMAT_VERSION = 1;
export const MAX_BYTES = 40 * 1024 * 1024;

export function makeExport(save, best = {}, now = Date.now()) {
  return { kind: FILE_KIND, formatVersion: FORMAT_VERSION, exportedAt: now, save, best };
}

export const exportFileName = save => `rw-${String(save.map || 'game').replace(/[^a-z0-9_-]/gi, '')}-${Math.max(0, save.trips | 0)}-trips.json`;

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

// Check a file's text. Returns { ok: true, save, best, summary: { map, trips, time } } or { ok: false, error } (the error is a sentence for the player).
// Only the shape is checked here: restore() (save.js) is what actually rebuilds the game, and Continue copes with a save it cannot load.
export function readExport(text, { maps, saveVersion }) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'That file is empty.' };
  if (text.length > MAX_BYTES) return { ok: false, error: 'That file is too big to be a Road Warrior save.' };
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'That does not look like a Road Warrior save file.' }; }
  const wrapped = isObj(data) && data.kind === FILE_KIND;
  const save = wrapped ? data.save : data;
  if (!isObj(save) || save.version === undefined || !Array.isArray(save.roads)) return { ok: false, error: 'That does not look like a Road Warrior save file.' };
  if (save.version !== saveVersion) return { ok: false, error: save.version > saveVersion ? 'That save was made by a newer version of the game. Reload the page to get the latest version, then try again.' : 'That save is from an older version of the game and cannot be loaded.' };
  const map = maps.find(m => m.id === save.map);
  if (!map) return { ok: false, error: 'That save is for a map this version does not have.' };
  if (!Array.isArray(save.buildings) || !Array.isArray(save.cars) || !isObj(save.terrain) || typeof save.terrain.water !== 'string' || !Number.isFinite(save.trips)) return { ok: false, error: 'That save file is damaged.' };
  const best = {};
  if (wrapped && isObj(data.best)) for (const m of maps) { const v = data.best[m.id]; if (Number.isFinite(v) && v > 0) best[m.id] = Math.floor(v); }
  return { ok: true, save, best, summary: { map: map.name, trips: save.trips, time: Number.isFinite(save.time) ? save.time : 0 } };
}
