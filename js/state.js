// Game state + the rules for placing/removing things. No drawing or input in here.
import { generateTerrain, WATER } from './terrain.js';

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
  emit();
}

export function setTool(tool) { game.tool = tool; emit(); }

// Returns 'ok' | 'oob' | 'water' | 'exists' | 'empty'
export function buildRoad(x, y) {
  if (!inBounds(x, y)) return 'oob';
  if (game.terrain.water[tileIndex(x, y)] === WATER) return 'water';
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
