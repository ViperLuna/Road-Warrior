// Game state + the rules for placing/removing things. No drawing or input in here.
import { generateTerrain, WATER, HILL, LAND } from './terrain.js';
import { clearPieceCache } from './lanes.js';
import { rotateBuilding, lotTile, reindex } from './buildings.js';
import { spawnInitial, spawnPair } from './spawn.js';
import { updateSim, reseatCarsOf } from './cars.js';
import { initProgress, checkProgress, chooseReward as pickReward } from './progress.js';
import { prog, maps, specialInfo, roadsAvailable } from './progression.js';
import { roadConns, tileLanes } from './network.js';
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
  tool: 'build',            // 'build' | 'destroy' | 'pan' | 'place'
  placing: null,            // special being placed when tool === 'place'
  palette: [],              // [{id, hex, glyph}] from config/colors.json
  buildings: [], buildingAt: new Map(), ports: new Map(), nextId: 1,
  cars: [], trips: 0, money: 0, time: 0,
  reward: null, over: null,
  unlocks: {},              // permanent unlocks (e.g. { oneway: true })
  oneway: false,            // one-way toggle: drags mark streets one-way
  build4: false,            // highway mode: the Build tool lays 4-lane road from the highway stock
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
  game.mode = 'play'; game.reward = null; game.over = null; game.unlocks = {}; game.oneway = false; game.build4 = false;
  game.buildings = []; game.buildingAt = new Map(); game.ports = new Map(); game.nextId = 1;
  game.cars = []; game.trips = 0; game.money = 0; game.time = 0;
  clearPieceCache();
  spawnInitial(game, game.palette[0]);
  initProgress(game);
  emit();
}

export function setPalette(p) { game.palette = p; }

export function setBuild4(on) { game.build4 = !!on && (game.inv.highway || 0) > 0; if (game.build4 && game.tool !== 'build') game.tool = 'build'; emit(); }

export function setOneWay(on) { game.oneway = !!on && !!game.unlocks.oneway; emit(); }

// Make the street between adjacent road tiles (ax,ay) -> (bx,by) one-way (travel a to b only), or two-way again.
// Stored as blocked exits: b may not exit back towards a.
const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export function setEdge(ax, ay, bx, by, oneWay) {
  const d = SIDES.findIndex(([dx, dy]) => ax + dx === bx && ay + dy === by);
  if (d < 0 || !hasRoad(ax, ay) || !hasRoad(bx, by)) return false;
  const A = game.roads.get(tileIndex(ax, ay)), B = game.roads.get(tileIndex(bx, by));
  if (A.bridge || B.bridge || A.tunnel || B.tunnel) return false;

  A.noExit = (A.noExit || 0) & ~(1 << d);
  B.noExit = oneWay ? (B.noExit || 0) | (1 << ((d + 2) % 4)) : (B.noExit || 0) & ~(1 << ((d + 2) % 4));
  emit();
  return true;
}

// Cut / join the seam between two touching road tiles. A cut seam passes nothing in either direction; cars already on a
// route across it finish as ghosts. Spans (bridges, tunnels) and overpass tiles can't be cut.
export const isCut = (ax, ay, bx, by) => {
  const d = SIDES.findIndex(([dx, dy]) => ax + dx === bx && ay + dy === by);
  const A = d >= 0 && hasRoad(ax, ay) ? game.roads.get(tileIndex(ax, ay)) : null;
  return !!A && !!(((A.cut || 0) >> d) & 1);
};
export function setCut(ax, ay, bx, by, cut) {
  const d = SIDES.findIndex(([dx, dy]) => ax + dx === bx && ay + dy === by);
  if (d < 0 || !hasRoad(ax, ay) || !hasRoad(bx, by)) return false;
  const A = game.roads.get(tileIndex(ax, ay)), B = game.roads.get(tileIndex(bx, by)), e = (d + 2) % 4;
  if (A.bridge || B.bridge || A.tunnel || B.tunnel || A.overpass !== undefined || B.overpass !== undefined) return false;
  if (!!(((A.cut || 0) >> d) & 1) === !!cut) return true;
  if (cut) { A.cut = (A.cut || 0) | (1 << d); B.cut = (B.cut || 0) | (1 << e); A.noExit = (A.noExit || 0) & ~(1 << d); B.noExit = (B.noExit || 0) & ~(1 << e); }
  else { A.cut = (A.cut || 0) & ~(1 << d); B.cut = (B.cut || 0) & ~(1 << e); }
  emit();
  return true;
}

// Forget one-way flags (and cuts) that point at a tile that no longer has a road.
function clearEdgesTowards(x, y) {
  SIDES.forEach(([dx, dy], d) => {
    const n = game.roads.get(tileIndex(x + dx, y + dy));
    if (n && inBounds(x + dx, y + dy)) { n.noExit = (n.noExit || 0) & ~(1 << ((d + 2) % 4)); n.cut = (n.cut || 0) & ~(1 << ((d + 2) % 4)); }
  });
}

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
  if (info.unlock && game.unlocks[id]) return false;
  game.money -= info.cost;
  if (info.unlock) game.unlocks[id] = true;
  else game.inv[id] = (game.inv[id] || 0) + (info.grant || 1);
  emit();
  return true;
}

// ---- bridges (over water) and tunnels (through hills): one item covers any straight run ----
// from: the road tile at the near edge; tiles: the span tiles in order; end: the far-side land tile.
// Returns 'ok' | 'nobridge' | 'notunnel' | 'badend'.
function buildSpan(kind, from, tiles, end) {
  const item = kind === 'tunnel' ? 'tunnel' : 'bridge';
  if ((game.inv[item] || 0) <= 0) return item === 'tunnel' ? 'notunnel' : 'nobridge';
  if (!inBounds(end.x, end.y) || game.terrain.water[tileIndex(end.x, end.y)] !== LAND || game.buildingAt.has(tileIndex(end.x, end.y))) return 'badend';
  const id = game.nextBridge++;
  const dx = Math.sign(tiles[0].x - from.x), dy = Math.sign(tiles[0].y - from.y);
  const dirIdx = SIDES.findIndex(([sx, sy]) => sx === dx && sy === dy);
  tiles.forEach((t, i) => {
    const entry = { lanes: game.build4 ? 4 : 2 };           // bridges/tunnels take the lane count of the road you drag
    if (kind === 'tunnel') {
      entry.tunnel = id;
      if (i === 0) entry.portal = (dirIdx + 2) % 4;                // mouth facing back toward the near side
      if (i === tiles.length - 1) entry.portal = dirIdx;           // mouth facing the far side
    } else entry.bridge = id;
    game.roads.set(tileIndex(t.x, t.y), entry);
  });
  game.bridges.set(id, tiles.map(t => tileIndex(t.x, t.y)));
  game.inv[item]--;
  emit();
  return 'ok';
}
export const buildBridge = (from, tiles, end) => buildSpan('bridge', from, tiles, end);
export const buildTunnel = (from, tiles, end) => buildSpan('tunnel', from, tiles, end);

export const buildingAt = (x, y) => (inBounds(x, y) ? game.buildingAt.get(tileIndex(x, y)) || null : null);

export function rotateBuildingAt(x, y) {
  const b = buildingAt(x, y);
  if (!b) return false;
  rotateBuilding(game, b);
  if (b.kind === 'dest') reseatCarsOf(game, b);
  emit();
  return true;
}

// Tap the parking-lot part of a destination: move its gate to the other end of the lot.
export function flipLotAt(x, y) {
  const b = buildingAt(x, y);
  if (!b || b.kind !== 'dest') return false;
  const onLot = [0, 1].some(i => { const [lx, ly] = lotTile(b, i); return lx === x && ly === y; });
  if (!onLot) return false;
  b.gate = b.gate ? 0 : 1;
  reindex(game);
  reseatCarsOf(game, b);
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

export function setTool(tool) { game.tool = tool; if (tool !== 'place') game.placing = null; emit(); }

// Pick a placeable special (roundabout / light) from the inventory; taps on road tiles then place it.
export function selectSpecial(id) {
  if ((game.inv[id] || 0) <= 0) return;
  game.tool = 'place'; game.placing = id;
  emit();
}

// Put a roundabout / traffic light on an intersection (a road tile with 3+ connections).
// Returns 'ok' | 'none' | 'badtile' | 'taken' | 'notjunction' | 'notcrossing' | 'highway' | 'toonear' | 'empty'
export function placeSpecial(id, x, y) {
  if (!hasRoad(x, y)) return 'none';
  const r = game.roads.get(tileIndex(x, y));
  if (r.bridge || r.tunnel) return 'badtile';
  if (r.special || r.overpass !== undefined) return 'taken';
  if ((game.inv[id] || 0) <= 0) return 'empty';
  if (id === 'overpass') {                                      // a highway crossing a street, with nothing else joining
    const c = roadConns(game, x, y), lanesAt = d => { const n = game.roads.get(tileIndex(x + SIDES[d][0], y + SIDES[d][1])); return n ? (n.lanes || 2) : 0; };
    if (c.length !== 4 || (r.lanes || 2) !== 4) return 'notcrossing';
    const axis = [0, 1].find(a => lanesAt(a) === 4 && lanesAt(a + 2) === 4 && lanesAt(1 - a) === 2 && lanesAt(1 - a + 2) === 2);
    if (axis === undefined) return 'notcrossing';
    r.overpass = axis;
    game.inv[id]--;
    if (game.inv[id] <= 0) { game.tool = 'build'; game.placing = null; }
    emit();
    return 'ok';
  }
  if (roadConns(game, x, y).length < 3) return 'notjunction';
  if (id === 'roundabout' && (r.lanes || 2) === 4) return 'highway';
  // Lights need room to queue between them: with no gap, a car cleared by one light can end up stuck inside
  // the intersection waiting for the next, blocking everyone. So no two lights on neighbouring tiles.
  if (id === 'light') for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const n = game.roads.get(tileIndex(x + dx, y + dy));
    if (inBounds(x + dx, y + dy) && n && n.special === 'light') return 'toonear';
  }
  r.special = id;
  game.inv[id]--;
  if (game.inv[id] <= 0) { game.tool = 'build'; game.placing = null; }
  emit();
  return 'ok';
}

// Returns 'ok' | 'upgraded' | 'oob' | 'water' | 'hill' | 'blocked' | 'exists' | 'empty'
// In highway mode this lays 4-lane road from the highway stock (and upgrades a street it is dragged over).
export function buildRoad(x, y) {
  if (!inBounds(x, y)) return 'oob';
  const idx = tileIndex(x, y), terrainKind = game.terrain.water[idx];
  if (terrainKind === WATER) return 'water';
  if (terrainKind === HILL) return 'hill';
  if (game.buildingAt.has(idx)) return 'blocked';
  const four = game.build4 && (game.inv.highway || 0) > 0;
  const have = game.roads.get(idx);
  if (have) {
    if (four && (have.lanes || 2) === 2 && !have.bridge && !have.tunnel && have.special !== 'roundabout') {   // widen a street in place
      have.lanes = 4;
      game.inv.highway--; game.inv.road++;
      if (game.inv.highway <= 0) game.build4 = false;
      emit();
      return 'upgraded';
    }
    return 'exists';
  }
  if (four) { game.inv.highway--; if (game.inv.highway <= 0) game.build4 = false; }
  else if (game.inv.road > 0) game.inv.road--;                       // spare pieces (start stock, demolish refunds) go first
  else if (game.money >= prog.economy.roadCost) game.money -= prog.economy.roadCost;       // after that, each road costs cash
  else return 'empty';
  game.roads.set(idx, { lanes: four ? 4 : 2 });
  clearEdgesTowards(x, y);
  emit();
  return 'ok';
}

// Demolishing always refunds the piece immediately.
export function demolish(x, y) {
  if (!hasRoad(x, y)) return false;
  const r = game.roads.get(tileIndex(x, y));
  if (r.bridge || r.tunnel) {                       // removing any span tile removes the whole bridge / tunnel
    const id = r.bridge || r.tunnel;
    for (const k of game.bridges.get(id) || []) game.roads.delete(k);
    game.bridges.delete(id);
    const item = r.bridge ? 'bridge' : 'tunnel';
    game.inv[item] = (game.inv[item] || 0) + 1;
    emit();
    return true;
  }
  if (r.special) game.inv[r.special] = (game.inv[r.special] || 0) + 1;      // the roundabout / light comes back too
  if (r.overpass !== undefined) game.inv.overpass = (game.inv.overpass || 0) + 1;
  game.roads.delete(tileIndex(x, y));
  clearEdgesTowards(x, y);
  if ((r.lanes || 2) === 4) game.inv.highway = (game.inv.highway || 0) + 1; else game.inv.road++;      // each kind of piece comes back as itself
  emit();
  return true;
}
