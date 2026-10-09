// Game state + the rules for placing/removing things. No drawing or input in here.
import { generateTerrain, WATER } from './terrain.js';
import { clearPieceCache } from './lanes.js';
import { rotateBuilding } from './buildings.js';
import { spawnInitial, spawnPair } from './spawn.js';
import { updateSim } from './cars.js';

export const MAP = { cols: 32, rows: 22 };
export const START_INVENTORY = { road: 20, bridge: 1 };

export const game = {
  seed: 0,
  cols: MAP.cols,
  rows: MAP.rows,
  terrain: null,
  roads: new Map(),         // tile index -> { lanes: 2 }
  inv: { ...START_INVENTORY },
  tool: 'build',            // 'build' | 'destroy' | 'pan'
  palette: [],              // [{id, hex, glyph}] from config/colors.json
  buildings: [], buildingAt: new Map(), ports: new Map(), nextId: 1,
  cars: [], trips: 0, money: 0, time: 0, paused: true,
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); }
function emit() { listeners.forEach(fn => fn(game)); }

export const tileIndex = (x, y) => y * game.cols + x;
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < game.cols && y < game.rows;
export const hasRoad = (x, y) => inBounds(x, y) && game.roads.has(tileIndex(x, y));

export function newGame(seed) {
  game.seed = seed >>> 0;
  game.cols = MAP.cols;
  game.rows = MAP.rows;
  game.terrain = generateTerrain(game.seed, game.cols, game.rows);
  game.roads = new Map();
  game.inv = { ...START_INVENTORY };
  game.buildings = []; game.buildingAt = new Map(); game.ports = new Map(); game.nextId = 1;
  game.cars = []; game.trips = 0; game.money = 0; game.time = 0;
  clearPieceCache();
  spawnInitial(game, game.palette[0]);
  emit();
}

export function setPalette(p) { game.palette = p; }

export function tick(dt) {
  if (game.paused) return;
  if (updateSim(game, dt)) emit();
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
  game.roads.delete(tileIndex(x, y));
  game.inv.road++;
  emit();
  return true;
}
