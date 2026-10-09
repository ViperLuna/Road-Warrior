// Game state + the rules for placing/removing things. No drawing or input in here.
import { generateTerrain, WATER } from './terrain.js';
import { clearPieceCache } from './lanes.js';
import { rotateBuilding } from './buildings.js';
import { spawnInitial, spawnPair } from './spawn.js';
import { updateSim } from './cars.js';
import { initProgress, checkProgress, chooseReward as pickReward } from './progress.js';
import { prog, maps, specialInfo } from './progression.js';
import { tuning } from './tuning.js';

export const START_INVENTORY = { road: 20, bridge: 1 };

export const game = {
  seed: 0,
  mode: 'menu',             // 'menu' | 'play' | 'reward' | 'over' | 'pause'
  map: null,
  cols: 32,
  rows: 22,
  terrain: null,
  roads: new Map(),         // tile index -> { lanes: 2, bridge?: id }
  bridges: new Map(), nextBridge: 1,
  inv: { ...START_INVENTORY },
  tool: 'build',            // 'build' | 'destroy' | 'pan'
  palette: [],              // [{id, hex, glyph}] from config/colors.json
  buildings: [], buildingAt: new Map(), ports: new Map(), nextId: 1,
  cars: [], trips: 0, money: 0, time: 0,
  reward: null, over: null,
};

const listeners = new Set(), evListeners = new Set();
export function onEvent(fn) { evListeners.add(fn); }
const notify = e => evListeners.forEach(fn => fn(e));
export function onChange(fn) { listeners.add(fn); }
function emit() { listeners.forEach(fn => fn(game)); }

export const tileIndex = (x, y) => y * game.cols + x;
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < game.cols && y < game.rows;
export const hasRoad = (x, y) => inBounds(x, y) && game.roads.has(tileIndex(x, y));

export function newGame(seed, map = maps[0]) {
  game.seed = seed >>> 0;
  game.map = map;
  game.cols = map.cols;
  game.rows = map.rows;
  game.terrain = generateTerrain(game.seed, game.cols, game.rows);
  game.roads = new Map(); game.bridges = new Map(); game.nextBridge = 1;
  game.inv = { ...START_INVENTORY };
  game.mode = 'play'; game.reward = null; game.over = null;
  game.buildings = []; game.buildingAt = new Map(); game.ports = new Map(); game.nextId = 1;
  game.cars = []; game.trips = 0; game.money = 0; game.time = 0;
  clearPieceCache();
  spawnInitial(game, game.palette[0]);
  initProgress(game);
  emit();
}

export function setPalette(p) { game.palette = p; }

export function setMode(mode) { game.mode = mode; emit(); }

export function tick(dt) {
  if (game.mode !== 'play') return;
  if (updateSim(game, dt)) {
    checkProgress(game, notify);
    emit();
  }
  const worst = game.cars.reduce((m, c) => Math.max(m, c.stuck), 0);
  if (worst >= tuning.gridlock.gameOverAfterSeconds) endGame();
}

function endGame() {
  const prev = bestFor(game.map.id);
  const record = game.trips > prev;
  if (record) saveBest(game.map.id, game.trips);
  game.over = { trips: game.trips, money: game.money, time: game.time, record, best: Math.max(prev, game.trips) };
  game.mode = 'over';
  emit();
}

export function chooseReward(id) { if (pickReward(game, id)) emit(); }

// ---- best scores (per map, in localStorage) ----
const BEST_KEY = 'roadwarrior.best';
function readBest() { try { return JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch { return {}; } }
export const bestFor = id => readBest()[id] || 0;
function saveBest(id, trips) { try { const b = readBest(); b[id] = trips; localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch { /* storage unavailable */ } }
export function isUnlocked(map) { return !map.unlock || bestFor(map.unlock.map) >= map.unlock.trips; }

// ---- shop: spend cash on specials the goals don't hand out ----
export function buy(id) {
  const info = specialInfo(id);
  if (!info || !info.enabled || !info.cost || game.money < info.cost) return false;
  game.money -= info.cost;
  game.inv[id] = (game.inv[id] || 0) + 1;
  emit();
  return true;
}

// ---- bridges: one item covers any straight run of water ----
// from: shore road tile; tiles: the water tiles in order; end: the far-bank tile. Returns 'ok' | 'nobridge' | 'badend'.
export function buildBridge(from, tiles, end) {
  if ((game.inv.bridge || 0) <= 0) return 'nobridge';
  if (!inBounds(end.x, end.y) || game.terrain.water[tileIndex(end.x, end.y)] === WATER || game.buildingAt.has(tileIndex(end.x, end.y))) return 'badend';
  const id = game.nextBridge++;
  for (const t of tiles) game.roads.set(tileIndex(t.x, t.y), { lanes: 2, bridge: id });
  game.bridges.set(id, tiles.map(t => tileIndex(t.x, t.y)));
  game.inv.bridge--;
  emit();
  return 'ok';
}

export const buildingAt = (x, y) => (inBounds(x, y) ? game.buildingAt.get(tileIndex(x, y)) || null : null);

export function rotateBuildingAt(x, y) {
  const b = buildingAt(x, y);
  if (!b) return false;
  rotateBuilding(game, b);
  emit();
  return true;
}

// Dev hotkey: extra pair near an existing building (real spawning arrives with progression).
export function devSpawn() {
  if (game.mode !== 'play') return false;
  const color = game.palette[(Math.random() * Math.min(game.palette.length, 2)) | 0];
  const a = game.buildings[(Math.random() * game.buildings.length) | 0];
  const r = spawnPair(game, color, { anchor: { x: a.x, y: a.y, rMin: 3, rMax: 7 }, roads: [4, 14] });
  if (r) emit();
  return !!r;
}

export function setTool(tool) { game.tool = tool; emit(); }

// Returns 'ok' | 'oob' | 'water' | 'blocked' | 'exists' | 'empty'
export function buildRoad(x, y) {
  if (!inBounds(x, y)) return 'oob';
  if (game.terrain.water[tileIndex(x, y)] === WATER) return 'water';
  if (game.buildingAt.has(tileIndex(x, y))) return 'blocked';
  if (game.roads.has(tileIndex(x, y))) return 'exists';
  if (game.inv.road <= 0) return 'empty';
  game.roads.set(tileIndex(x, y), { lanes: 2 });
  game.inv.road--;
  emit();
  return 'ok';
}

// Demolishing always refunds the piece immediately.
export function demolish(x, y) {
  if (!hasRoad(x, y)) return false;
  const r = game.roads.get(tileIndex(x, y));
  if (r.bridge) {                                   // removing any span tile removes the whole bridge
    for (const k of game.bridges.get(r.bridge) || []) game.roads.delete(k);
    game.bridges.delete(r.bridge);
    game.inv.bridge = (game.inv.bridge || 0) + 1;
    emit();
    return true;
  }
  game.roads.delete(tileIndex(x, y));
  game.inv.road++;
  emit();
  return true;
}
