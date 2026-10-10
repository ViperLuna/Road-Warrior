// Save games. Two halves:
//   1. serialize / restore: turn the whole game (map, roads, buildings, goals AND every car mid-trip) into plain JSON and back.
//   2. storage backends: where the JSON goes. The game only talks to the `backend` interface below, so moving saves from
//      this browser to a server later means calling setBackend(httpBackend(...)) in main.js and nothing else.
//
//   backend = { id, load(slot) -> data|null, save(slot, data) -> bool, remove(slot) -> bool, list() -> [{ slot, savedAt }] }
//   (every method may be async; the manager awaits them)
import { game, refresh } from './state.js';
import { maps, specialInfo } from './progression.js';
import { terrainFromWater } from './terrain.js';
import { reindex } from './buildings.js';
import { clearPieceCache, pieceFromKey } from './lanes.js';
import { createCar } from './cars.js';

export const SAVE_VERSION = 1;
const PLAYABLE = new Set(['play', 'reward', 'pause']);

// ---- terrain grid <-> short string (run-length encoded) ----
const encodeGrid = a => { let out = '', i = 0; while (i < a.length) { let j = i; while (j < a.length && a[j] === a[i]) j++; out += a[i] + ':' + (j - i) + ','; i = j; } return out; };
function decodeGrid(s, n) {
  const a = new Uint8Array(n); let p = 0;
  for (const part of s.split(',')) { if (!part) continue; const [v, c] = part.split(':').map(Number); a.fill(v, p, p + c); p += c; }
  if (p !== n) throw new Error('terrain size mismatch');
  return a;
}

// ---- serialize ----
export function serialize(g = game) {
  const carData = g.cars.map(c => ({
    id: c.id, house: c.house.id, state: c.state, idx: c.idx, s: c.s, v: c.v, x: c.x, y: c.y, a: c.a,
    dest: c.dest ? c.dest.id : null, slot: c.slot, lot: c.lot ? { ...c.lot } : null, dwell: c.dwell, cooldown: c.cooldown,
    route: c.route.map(p => p.key), stuck: c.stuck, holdT: c.holdT || 0,
  }));
  return {
    version: SAVE_VERSION, savedAt: Date.now(),
    seed: g.seed, map: g.map.id, mode: g.mode === 'reward' ? 'reward' : 'play',
    time: g.time, trips: g.trips, money: g.money, nextId: g.nextId, nextBridge: g.nextBridge,
    inv: { ...g.inv }, unlocks: { ...g.unlocks }, oneway: !!g.oneway, build4: !!g.build4,
    progress: { spawnCount: g.spawnCount, nextSpawnAt: g.nextSpawnAt, goalCount: g.goalCount, nextGoalAt: g.nextGoalAt, prevGoalAt: g.prevGoalAt, colorsUsed: g.colorsUsed },
    reward: g.reward ? { goal: g.reward.goal, options: g.reward.options.map(o => ({ ...o, special: o.special ? o.special.id : undefined })) } : null,
    terrain: { water: encodeGrid(g.terrain.water), start: g.terrain.start },
    roads: [...g.roads.entries()].map(([k, t]) => [k, { ...t }]),
    bridges: [...g.bridges.entries()],
    buildings: g.buildings.map(b => ({ ...b, color: b.color.id, slots: b.slots ? b.slots.map(c => (c ? c.id : null)) : null })),
    cars: carData,
  };
}

// ---- restore ----
export function restore(data, g = game) {
  if (!data || data.version !== SAVE_VERSION) throw new Error('unsupported save version ' + (data && data.version));
  const map = maps.find(m => m.id === data.map);
  if (!map) throw new Error('unknown map ' + data.map);
  const color = id => g.palette.find(c => c.id === id);

  g.seed = data.seed >>> 0; g.map = map; g.cols = map.cols; g.rows = map.rows;
  g.terrain = terrainFromWater(g.seed, g.cols, g.rows, decodeGrid(data.terrain.water, g.cols * g.rows), data.terrain.start);
  g.roads = new Map(data.roads.map(([k, t]) => [k, { ...t }]));
  g.bridges = new Map(data.bridges.map(([id, tiles]) => [id, [...tiles]]));
  g.nextBridge = data.nextBridge; g.nextId = data.nextId;
  g.inv = { ...data.inv }; g.unlocks = { ...data.unlocks }; g.oneway = !!data.oneway && !!g.unlocks.oneway; g.build4 = !!data.build4 && (g.inv.highway || 0) > 0;
  g.trips = data.trips; g.money = data.money; g.time = data.time;
  Object.assign(g, data.progress);
  g.over = null;
  g.reward = data.reward ? { goal: data.reward.goal, options: data.reward.options.map(o => ({ ...o, special: o.special ? specialInfo(o.special) : undefined })) } : null;
  g.mode = g.reward ? 'reward' : 'play';
  g.tool = 'build'; g.placing = null;

  const slotsById = new Map();
  g.buildings = data.buildings.map(b => { const o = { ...b, color: color(b.color) }; slotsById.set(o.id, b.slots); return o; });
  const byId = new Map(g.buildings.map(b => [b.id, b]));
  clearPieceCache();
  reindex(g);

  g.cars = data.cars.map(sc => {
    const c = createCar(byId.get(sc.house));
    Object.assign(c, {
      id: sc.id, state: sc.state, idx: sc.idx, s: sc.s, v: sc.v, x: sc.x, y: sc.y, a: sc.a, slot: sc.slot, lot: sc.lot ? { ...sc.lot } : null,
      dwell: sc.dwell, cooldown: sc.cooldown, stuck: sc.stuck, holdT: sc.holdT, dest: sc.dest != null ? byId.get(sc.dest) || null : null,
      route: sc.route.map(pieceFromKey),
    });
    return c;
  });
  const carById = new Map(g.cars.map(c => [c.id, c]));
  for (const b of g.buildings) if (b.slots) b.slots = slotsById.get(b.id).map(id => (id == null ? null : carById.get(id) || null));
  refresh();
  return true;
}

// ---- storage backends ----
const PREFIX = 'roadwarrior.save.';
export const localBackend = {
  id: 'local',
  load(slot) { try { const s = localStorage.getItem(PREFIX + slot); return s ? JSON.parse(s) : null; } catch { return null; } },
  save(slot, data) { try { localStorage.setItem(PREFIX + slot, JSON.stringify(data)); return true; } catch (e) { console.warn('save failed', e); return false; } },
  remove(slot) { try { localStorage.removeItem(PREFIX + slot); return true; } catch { return false; } },
  list() {
    const out = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(PREFIX)) { const d = JSON.parse(localStorage.getItem(k)); out.push({ slot: k.slice(PREFIX.length), savedAt: d.savedAt }); } } } catch { /* storage unavailable */ }
    return out;
  },
};

// A server-backed store: GET/PUT/DELETE {baseUrl}/{slot}, GET {baseUrl}/ lists. Not used yet; here so the switch is a one-liner.
export function httpBackend({ baseUrl, headers = {}, fetchFn = (...a) => fetch(...a) }) {
  const url = slot => baseUrl.replace(/\/$/, '') + '/' + encodeURIComponent(slot);
  const json = { 'Content-Type': 'application/json', ...headers };
  return {
    id: 'http',
    async load(slot) { const r = await fetchFn(url(slot), { headers }); return r.status === 404 ? null : r.ok ? r.json() : null; },
    async save(slot, data) { const r = await fetchFn(url(slot), { method: 'PUT', headers: json, body: JSON.stringify(data) }); return r.ok; },
    async remove(slot) { const r = await fetchFn(url(slot), { method: 'DELETE', headers }); return r.ok; },
    async list() { const r = await fetchFn(baseUrl, { headers }); return r.ok ? r.json() : []; },
  };
}

// ---- manager ----
let backend = localBackend, slotName = 'autosave', config = { backend: 'local', slot: 'autosave', intervalSeconds: 10 };
export const setBackend = b => { backend = b; };
export const getBackend = () => backend;
export function configure(cfg) {
  config = { ...config, ...cfg };
  slotName = config.slot;
  if (config.backend === 'local') backend = localBackend;
}

// Save the running game. Does nothing in the menu or after game over (those aren't states worth keeping).
export async function saveNow(extra = {}) {
  if (!PLAYABLE.has(game.mode)) return false;
  return backend.save(slotName, { ...serialize(), ...extra });
}
export async function loadSaved() { return backend.load(slotName); }
export async function clearSave() { return backend.remove(slotName); }

// A one-line summary for the menu's Continue card.
export async function describeSave() {
  try {
    const d = await backend.load(slotName);
    if (!d || d.version !== SAVE_VERSION) return null;
    const m = maps.find(x => x.id === d.map);
    return m ? { map: m.name, trips: d.trips, time: d.time, savedAt: d.savedAt, cars: d.cars.length } : null;
  } catch { return null; }
}

// Keep the save fresh while playing, and write once more as the page goes away. getExtra() adds UI state (e.g. the camera).
export function startAutosave(getExtra = () => ({})) {
  const write = () => { if (PLAYABLE.has(game.mode)) saveNow(getExtra()); };
  setInterval(write, config.intervalSeconds * 1000);
  addEventListener('pagehide', write);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') write(); });
}
