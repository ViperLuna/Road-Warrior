// Game state + the rules for placing/removing things. No drawing or input in here.
import { generateTerrain, WATER, HILL, LAND } from "./terrain.js";
import { clearPieceCache, DIR } from "./lanes.js";
import {
  rotateBuilding,
  lotTile,
  reindex,
  footprint,
  entOf,
  gateOf,
  entrancesOf,
  entsOf,
  exitTile,
} from "./buildings.js";
import { spawnInitial, spawnPair } from "./spawn.js";
import { settings } from "./settings.js";
import { updateSim, reseatCarsOf, jammedTiles, sceneTiles } from "./cars.js";
import { stepAccidents } from "./accident.js";
import { stepOutside, resetOutside } from "./outside.js";
import { stepJams } from "./jams.js";
import {
  stepWatches,
  refreshWatches as refreshW,
  ackNotice as ackN,
} from "./deadlines.js";
import {
  initProgress,
  checkProgress,
  chooseReward as pickReward,
} from "./progress.js";
import { prog, maps, specialInfo, roadsAvailable } from "./progression.js";
import { roadConns, tileLanes, layerLanes, netChanged } from "./network.js";
import { tuning } from "./tuning.js";

export const START_INVENTORY = { road: 20, bridge: 1 };

export const game = {
  seed: 0,
  speed: 1, // sim speed while playing: 0 (frozen, building still allowed) | 1 | 1.5 | 2
  mode: "menu", // 'menu' | 'play' | 'reward' | 'over' | 'pause'
  map: null,
  cols: 32,
  rows: 22,
  terrain: null,
  roads: new Map(), // tile index -> { lanes: 2, bridge?: id }
  bridges: new Map(),
  nextBridge: 1,
  inv: { ...START_INVENTORY },
  tool: "build", // 'build' | 'destroy' | 'pan' | 'place'
  placing: null, // special being placed when tool === 'place'
  palette: [], // [{id, hex, glyph}] from config/colors.json
  buildings: [],
  buildingAt: new Map(),
  ports: new Map(),
  nextId: 1,
  cars: [],
  trips: 0,
  money: 0,
  time: 0,
  reward: null,
  over: null,
  unlocks: {}, // permanent unlocks (e.g. { oneway: true })
  oneway: false, // one-way toggle: drags mark streets one-way
  build4: false, // highway mode: the Build tool lays 4-lane road from the highway stock
};

const listeners = new Set(),
  evListeners = new Set();
export function onEvent(fn) {
  evListeners.add(fn);
}
let quiet = false;
export const setQuiet = (on) => {
  quiet = !!on;
};
export const announce = (e) => notify(e); // (for modules that change the game from outside, like loading a save)
const notify = (e) => {
  if (!quiet) evListeners.forEach((fn) => fn(e));
};
export function onChange(fn) {
  listeners.add(fn);
}
const fire = () => {
  if (!quiet) listeners.forEach((fn) => fn(game));
};
function emit() {
  netChanged();
  fire();
}
export const refresh = emit; // for modules that change the game from outside (save/load)

export const tileIndex = (x, y) => y * game.cols + x;
export const inBounds = (x, y) =>
  x >= 0 && y >= 0 && x < game.cols && y < game.rows;
export const hasRoad = (x, y) =>
  inBounds(x, y) && game.roads.has(tileIndex(x, y));

export function newGame(seed, map = maps[0]) {
  game.seed = seed >>> 0;
  game.speed = 1;
  game.map = map;
  game.cols = map.cols;
  game.rows = map.rows;
  game.terrain = generateTerrain(game.seed, game.cols, game.rows);
  game.roads = new Map();
  game.bridges = new Map();
  game.nextBridge = 1;
  game.inv = { ...START_INVENTORY };
  game.mode = "play";
  game.tool = "build"; // a new game starts in build mode
  game.options = { demographics: !!(settings.difficulty && settings.difficulty.demographics) }; // difficulty choices are locked in when a game starts
  game.placing = null;
  game.reward = null;
  game.over = null;
  game.unlocks = {};
  game.oneway = false;
  game.build4 = false;
  game.buildings = [];
  game.buildingAt = new Map();
  game.ports = new Map();
  game.nextId = 1;
  game.cars = [];
  game.trips = 0;
  game.money = 0;
  game.time = 0;
  game.accident = null;
  game.work = null;
  game.pendingKind = null;
  game.nextAccidentAt = undefined;
  resetOutside(game);
  game.watches = [];
  game.jams = [];
  game.jamQuiet = [];
  game.log = [];
  game.nextLogId = 1;
  game.seenNet = undefined;
  game.netEditedAt = undefined;
  game.watchKey = "";
  game.visitorsLaunched = 0;
  game.bestAtStart = bestFor(map.id);
  syncBest(); // the best score when this run began (a record means beating that)
  clearPieceCache();
  spawnInitial(game, game.palette[0]);
  initProgress(game);
  emit();
}

export function setPalette(p) {
  game.palette = p;
}

export function setBuild4(on) {
  game.build4 = !!on && (game.inv.highway || 0) > 0;
  if (game.build4 && game.tool !== "build") game.tool = "build";
  emit();
}

export function setOneWay(on) {
  game.oneway = !!on && !!game.unlocks.oneway;
  emit();
}

// Make the street between adjacent road tiles (ax,ay) -> (bx,by) one-way (travel a to b only), or two-way again.
// Stored as blocked exits: b may not exit back towards a.
const SIDES = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
export function setEdge(ax, ay, bx, by, oneWay) {
  const d = SIDES.findIndex(([dx, dy]) => ax + dx === bx && ay + dy === by);
  if (d < 0 || !hasRoad(ax, ay) || !hasRoad(bx, by)) return false;
  const A = game.roads.get(tileIndex(ax, ay)),
    B = game.roads.get(tileIndex(bx, by));
  if (A.bridge || B.bridge || A.tunnel || B.tunnel) return false;

  A.noExit = (A.noExit || 0) & ~(1 << d);
  B.noExit = oneWay
    ? (B.noExit || 0) | (1 << ((d + 2) % 4))
    : (B.noExit || 0) & ~(1 << ((d + 2) % 4));
  emit();
  return true;
}

// Cut / join the seam between two touching road tiles. A cut seam passes nothing in either direction; cars already on a
// route across it finish as ghosts. Spans (bridges, tunnels) and overpass tiles can't be cut.
export const isCut = (ax, ay, bx, by) => {
  const d = SIDES.findIndex(([dx, dy]) => ax + dx === bx && ay + dy === by);
  const A =
    d >= 0 && hasRoad(ax, ay) ? game.roads.get(tileIndex(ax, ay)) : null;
  return !!A && !!(((A.cut || 0) >> d) & 1);
};
// Which way a bridge/tunnel tile runs (0 north-south, 1 east-west); -1 if unknown.
function spanAxis(k, r) {
  if (r.axis !== undefined) return r.axis;
  const tiles = game.bridges.get(r.bridge || r.tunnel);
  return tiles && tiles.length > 1
    ? tiles[0] % game.cols !== tiles[1] % game.cols
      ? 1
      : 0
    : -1;
}
export function setCut(ax, ay, bx, by, cut) {
  const d = SIDES.findIndex(([dx, dy]) => ax + dx === bx && ay + dy === by);
  if (d < 0 || !hasRoad(ax, ay) || !hasRoad(bx, by)) return false;
  const A = game.roads.get(tileIndex(ax, ay)),
    B = game.roads.get(tileIndex(bx, by)),
    e = (d + 2) % 4;
  if (A.overpass !== undefined || B.overpass !== undefined) return false;
  // A bridge can be cut from a road that meets it from the side, never along its own length. Tunnel tiles are like road tiles: cut any seam.
  for (const [r, x, y] of [
    [A, ax, ay],
    [B, bx, by],
  ])
    if (r.bridge && spanAxis(tileIndex(x, y), r) !== (d + 1) % 2)          // (a tunnel is dug, so it can be cut from any side)
      return false;
  if (!!(((A.cut || 0) >> d) & 1) === !!cut) return true;
  if (cut) {
    A.cut = (A.cut || 0) | (1 << d);
    B.cut = (B.cut || 0) | (1 << e);
    A.noExit = (A.noExit || 0) & ~(1 << d);
    B.noExit = (B.noExit || 0) & ~(1 << e);
  } else {
    A.cut = (A.cut || 0) & ~(1 << d);
    B.cut = (B.cut || 0) & ~(1 << e);
  }
  emit();
  return true;
}

// Construction cones: a coned road tile is closed to trips that haven't been planned yet. Cars already driving (or parked and
// heading home) keep their routes, so a cone never strands anyone.
export const coneCount = () => {
  let n = 0;
  for (const r of game.roads.values()) if (r.cone) n++;
  return n;
};
export function setCone(x, y, on) {
  if (!hasRoad(x, y)) return false;
  const r = game.roads.get(tileIndex(x, y));
  if (!!r.cone === !!on) return true;
  if (on) r.cone = true;
  else delete r.cone;
  emit();
  return true;
}
export const hasCone = (x, y) =>
  hasRoad(x, y) && !!game.roads.get(tileIndex(x, y)).cone;

// Forget one-way flags (and cuts) that point at a tile that no longer has a road.
function clearEdgesTowards(x, y) {
  SIDES.forEach(([dx, dy], d) => {
    const n = game.roads.get(tileIndex(x + dx, y + dy));
    if (n && inBounds(x + dx, y + dy)) {
      n.noExit = (n.noExit || 0) & ~(1 << ((d + 2) % 4));
      n.cut = (n.cut || 0) & ~(1 << ((d + 2) % 4));
    }
  });
}

// The message log (the History button): every toast that is about something, newest last. `spots` are tile boxes to fly to; `extra` is kept
// on the entry (e.g. ref: 'accident' so the log knows whether the spot is still live).
export const LOG_MAX = 200;
export function addLog(text, spots = [], extra = {}) {
  const e = { id: game.nextLogId++, t: game.time, text, spots, ...extra };
  game.log.push(e);
  if (game.log.length > LOG_MAX) game.log.splice(0, game.log.length - LOG_MAX);
  fire();
  return e;
}

// Re-check what is connected (after the player built something). Cheap when nothing changed.
let rwTimer = 0;
export function refreshWatches() {
  // (debounced: the check runs once the player stops building)
  clearTimeout(rwTimer);
  rwTimer = setTimeout(() => {
    if (game.mode !== "menu") {
      refreshW(game);
      fire();
    }
  }, 450);
}
// [OK] on a popup: its clock starts, and the game carries on.
export function ackNotice() {
  ackN(game);
  emit();
}

export function setMode(mode) {
  game.mode = mode;
  emit();
}
export const SPEEDS = [0, 1, 1.5, 2];
let lastRunSpeed = 1;
export function setSpeed(v) {
  const prev = game.speed;
  game.speed = SPEEDS.includes(v) ? v : 1;
  if (game.speed > 0) lastRunSpeed = game.speed;
  if (game.speed !== prev) notify({ type: "speed", speed: game.speed, prev });
  emit();
}

export function setDevSpeed(v) {
  const prev = game.speed;
  game.speed = v;
  lastRunSpeed = v;
  if (v !== prev) notify({ type: "speed", speed: v, prev });
  emit();
}
export function cycleSpeed() {
  setSpeed(SPEEDS[(SPEEDS.indexOf(game.speed) + 1) % SPEEDS.length]);
}
export function toggleSpeed() {
  setSpeed(game.speed === 0 ? lastRunSpeed : 0);
}

export function tick(dt) {
  if (game.mode !== "play") return;
  if (updateSim(game, dt)) {
    checkProgress(game, notify);
    fire();
  }
  stepAccidents(game, dt, notify);
  stepOutside(game, dt, notify);
  const lost = stepWatches(game, dt, notify);
  if (lost) {
    endGame(false, lost);
    return;
  }
  const worst = game.cars.reduce((m, c) => Math.max(m, c.stuck), 0);
  honkAtStuckCars(dt);
  const jamLost = stepJams(game, dt, notify);
  if (jamLost) { endGame(false, jamLost); return; }
  trackBest();
  if (worst >= tuning.gridlock.gameOverAfterSeconds) endGame();
}

// Cars that have been stuck long enough to glow also get mad: they honk, slowly at first and faster as the game-over timer nears.
// Emits { type: 'honk', k } (k = 0..1 how mad). Sound is the listener's business.
export function honkAtStuckCars(dt) {
  const {
    warnAfterSeconds: warn,
    gameOverAfterSeconds: over,
    honkSlowSeconds: slow,
    honkFastSeconds: fast,
  } = tuning.gridlock;
  for (const c of game.cars) {
    if (c.state === "home" || c.state === "dwell" || c.stuck < warn) {
      c.honkIn = undefined;
      continue;
    }
    if (c.honkIn === undefined) c.honkIn = Math.random() * 1.5; // the first honk comes soon after it starts glowing
    c.honkIn -= dt;
    if (c.honkIn > 0) continue;
    const k = Math.min(1, (c.stuck - warn) / (over - warn));
    c.honkIn = (slow + (fast - slow) * k) * (0.7 + Math.random() * 0.6);
    notify({ type: "honk", k });
  }
}

// The run is over: gridlock took it, or the player finished it on purpose (finished = true).
function endGame(finished = false, reason = null) {
  const prev = game.bestAtStart ?? 0,
    record = game.trips > prev;
  trackBest();
  flushBest();
  game.over = {
    trips: game.trips,
    money: game.money,
    time: game.time,
    record,
    best: Math.max(prev, bestCache, game.trips),
    finished,
    reason,
  };
  game.mode = "over";
  notify({ type: "over", record, finished, reason });
  emit();
}
// Finish the current run on purpose: the score counts (and can unlock maps) without having to lose.
export function finishRun() {
  if (game.mode === "play" || game.mode === "pause") endGame(true);
}

export function chooseReward(id) {
  if (pickReward(game, id)) emit();
}

// ---- best scores (per map, in localStorage) ----
const BEST_KEY = "roadwarrior.best";
function readBest() {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY)) || {};
  } catch {
    return {};
  }
}
export const bestFor = (id) => readBest()[id] || 0;
export const bestScores = () => readBest();
// Take the best scores from an imported file: a score only ever goes up.
export function mergeBest(incoming) {
  const b = readBest();
  for (const [id, v] of Object.entries(incoming || {})) if (Number.isFinite(v) && v > (b[id] || 0)) b[id] = v;
  try { localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch { /* storage unavailable */ }
  bestDirty = false; bestCache = game.map ? bestFor(game.map.id) : bestCache;
}
function saveBest(id, trips) {
  try {
    const b = readBest();
    b[id] = trips;
    localStorage.setItem(BEST_KEY, JSON.stringify(b));
  } catch {
    /* storage unavailable */
  }
}

// The best score is kept live: it goes up the moment a run passes it (a run that never jams still counts, and can unlock maps),
// and is written to storage at most every couple of seconds, on leaving the game, and when a run ends.
let bestCache = 0,
  bestDirty = false,
  lastBestWrite = -1e9;
export function syncBest() {
  bestCache = game.map ? bestFor(game.map.id) : 0;
  bestDirty = false;
  lastBestWrite = -1e9;
}
export function trackBest() {
  if (quiet || !game.map || game.trips <= bestCache) return;
  const before = bestCache;
  bestCache = game.trips;
  bestDirty = true;
  for (const m of maps)
    if (
      m.unlock &&
      m.unlock.map === game.map.id &&
      before < m.unlock.trips &&
      bestCache >= m.unlock.trips
    )
      notify({ type: "unlock", map: m });
  if (game.time - lastBestWrite > 2) flushBest();
}
export function flushBest() {
  if (!quiet && bestDirty && game.map) {
    saveBest(game.map.id, bestCache);
    bestDirty = false;
    lastBestWrite = game.time;
  }
}
export function isUnlocked(map) {
  return !map.unlock || bestFor(map.unlock.map) >= map.unlock.trips;
}

// ---- shop: spend cash on specials the goals don't hand out ----
export function buy(id) {
  const info = specialInfo(id);
  if (!info || !info.enabled || !info.cost || game.money < info.cost)
    return false;
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
  const item = kind === "tunnel" ? "tunnel" : "bridge";
  if ((game.inv[item] || 0) <= 0)
    return item === "tunnel" ? "notunnel" : "nobridge";
  if (
    !inBounds(end.x, end.y) ||
    game.terrain.water[tileIndex(end.x, end.y)] !== LAND ||
    game.buildingAt.has(tileIndex(end.x, end.y))
  )
    return "badend";
  const id = game.nextBridge++;
  const dx = Math.sign(tiles[0].x - from.x),
    dy = Math.sign(tiles[0].y - from.y);
  const dirIdx = SIDES.findIndex(([sx, sy]) => sx === dx && sy === dy);
  tiles.forEach((t, i) => {
    const entry = { lanes: game.build4 ? 4 : 2, axis: dirIdx % 2 }; // bridges/tunnels take the lane count of the road you drag (axis: 0 north-south, 1 east-west)
    if (kind === "tunnel") {
      entry.tunnel = id;
      if (i === 0) entry.portal = (dirIdx + 2) % 4; // mouth facing back toward the near side
      if (i === tiles.length - 1) entry.portal = dirIdx; // mouth facing the far side
    } else entry.bridge = id;
    game.roads.set(tileIndex(t.x, t.y), entry);
  });
  game.bridges.set(
    id,
    tiles.map((t) => tileIndex(t.x, t.y)),
  );
  game.inv[item]--;
  emit();
  return "ok";
}
export const buildBridge = (from, tiles, end) =>
  buildSpan("bridge", from, tiles, end);
// ---- tunnels: dug one block at a time ----
// A tunnel block goes on a HILL tile next to a road or another tunnel block, and uses one tunnel piece. Tunnel blocks are road tiles
// (`tunnel: true`): they connect to every neighboring road, can bend and branch, and can be cut. A half-dug tunnel is just a road that goes
// nowhere yet. Returns 'ok' | 'exists' | 'notunnel' | 'noroad' | 'nothill' | 'blocked' | 'oob'.
export function buildTunnelTile(x, y) {
  if (!inBounds(x, y)) return "oob";
  const idx = tileIndex(x, y);
  if (game.roads.has(idx)) return "exists";
  if (game.terrain.water[idx] !== HILL) return "nothill";
  if (game.buildingAt.has(idx)) return "blocked";
  if (!SIDES.some(([dx, dy]) => hasRoad(x + dx, y + dy))) return "noroad";
  if ((game.inv.tunnel || 0) <= 0) return "notunnel";
  const four = game.build4 && (game.inv.highway || 0) > 0;
  if (four) {
    game.inv.highway--;
    if (game.inv.highway <= 0) game.build4 = false;
  }
  game.inv.tunnel--;
  game.roads.set(idx, { lanes: four ? 4 : 2, tunnel: true });
  clearEdgesTowards(x, y);
  emit();
  return "ok";
}
// (the old whole-span call: digs each tile in turn; used by the sim bot)
export function buildTunnel(from, tiles, end) {
  if (
    !inBounds(end.x, end.y) ||
    game.terrain.water[tileIndex(end.x, end.y)] !== LAND ||
    game.buildingAt.has(tileIndex(end.x, end.y))
  )
    return "badend";
  for (const t of tiles) {
    const r = buildTunnelTile(t.x, t.y);
    if (r !== "ok" && r !== "exists") return r === "notunnel" ? "notunnel" : r;
  }
  return "ok";
}

export const buildingAt = (x, y) =>
  inBounds(x, y) ? game.buildingAt.get(tileIndex(x, y)) || null : null;

// Can building `b` stand with the given rotation? (a small destination moves inside its 2x2 box when it turns, so its new tiles must be free)
function fitsTurned(b, rot) {
  const turned = { ...b, rot };
  return footprint(turned).every(
    ([x, y]) =>
      inBounds(x, y) &&
      game.terrain.water[tileIndex(x, y)] === LAND &&
      !game.roads.has(tileIndex(x, y)) &&
      (!game.buildingAt.has(tileIndex(x, y)) ||
        game.buildingAt.get(tileIndex(x, y)) === b),
  );
}

// A stadium can always turn half way round IN PLACE: the 4x3 block covers the same tiles, only its gates move to the opposite long side.
// Returns the new anchor { x, y } for rotation rot + 2 (or null if there is no room for a road at the new gates).
function flipStadiumInPlace(b) {
  const here = new Set(footprint(b).map(([x, y]) => tileIndex(x, y)));
  for (let dx = -4; dx <= 4; dx++)
    for (let dy = -4; dy <= 4; dy++) {
      const cand = { ...b, x: b.x + dx, y: b.y + dy, rot: (b.rot + 2) % 4 }, fp = footprint(cand);
      if (fp.length !== here.size || !fp.every(([fx, fy]) => inBounds(fx, fy) && here.has(tileIndex(fx, fy)))) continue;
      const roomForRoads = entsOf(cand).every((e) => {
        const [ex, ey] = exitTile(cand, e), k = tileIndex(ex, ey);
        return inBounds(ex, ey) && game.terrain.water[k] === LAND && (!game.buildingAt.has(k) || here.has(k));
      });
      return roomForRoads ? { x: cand.x, y: cand.y } : null;
    }
  return null;
}

// A single unit turns by swinging its LOT round the building (the building tile stays put): the lot goes to the side n quarter turns clockwise
// from where it is, which only needs that one tile to be free land. Returns the new { x, y, half, ent, rot } or null.
function pivotSmall(b, n) {
  const X = DIR[b.rot], [lx, ly] = lotTile(b, gateOf(b)), B = [lx - X[0], ly - X[1]];
  const rot = (b.rot + n) % 4, X2 = DIR[rot], L = [B[0] + X2[0], B[1] + X2[1]], k = inBounds(L[0], L[1]) ? tileIndex(L[0], L[1]) : -1;
  if (k < 0 || game.terrain.water[k] !== LAND || game.roads.has(k) || (game.buildingAt.has(k) && game.buildingAt.get(k) !== b)) return null;
  for (let dx = -3; dx <= 3; dx++)
    for (let dy = -3; dy <= 3; dy++)
      for (const half of [0, 1]) {
        const cand = { ...b, x: b.x + dx, y: b.y + dy, half, ent: half, rot }, [cx, cy] = lotTile(cand, half);
        if (cx === L[0] && cy === L[1]) return { x: cand.x, y: cand.y, half, ent: half, rot };       // (back to the front entrance: a side one may now face the wrong way)
      }
  return null;
}

// A single-unit destination can always turn half way round IN PLACE: its building and its lot swap places on the same two tiles, so it faces
// the other way without needing any room (it only needs free land for a road outside the new lot, on its front). Returns the new
// { x, y, half, ent } for rotation rot + 2, or null.
function flipSmallInPlace(b) {
  const here = new Set(footprint(b).map(([x, y]) => tileIndex(x, y)));
  for (let dx = -3; dx <= 3; dx++)
    for (let dy = -3; dy <= 3; dy++)
      for (const half of [0, 1]) {
        const cand = { ...b, x: b.x + dx, y: b.y + dy, half, ent: half, rot: (b.rot + 2) % 4 }, fp = footprint(cand);
        if (fp.length !== here.size || !fp.every(([fx, fy]) => inBounds(fx, fy) && here.has(tileIndex(fx, fy)))) continue;
        const [ex, ey] = exitTile(cand, half), k = tileIndex(ex, ey);
        if (inBounds(ex, ey) && game.terrain.water[k] === LAND && !game.buildingAt.has(k)) return { x: cand.x, y: cand.y, half, ent: half };
      }
  return null;
}

export function rotateBuildingAt(x, y) {
  const b = buildingAt(x, y);
  if (b && b.kind === "portal") {
    notify({ type: "gate-info" });
    return false;
  } // (a side-road gate stays where it is; tapping it explains what it is)
  if (!b) return false;
  if (b.stadium) {
    // quarter turns only where the new block fits; half a turn is always possible in place (so a stadium with roads all round it can still turn)
    for (const n of [1, 2, 3]) {
      const rot = (b.rot + n) % 4;
      if (n === 2) {
        const a = flipStadiumInPlace(b);
        if (!a) continue;
        b.x = a.x; b.y = a.y;
      } else if (!fitsTurned(b, rot)) continue;
      b.rot = rot;
      reindex(game);
      reseatCarsOf(game, b);
      emit();
      return true;
    }
    notify({ type: 'rotate-blocked' });
    return false;
  }
  if (b.small) {
    // The lot swings clockwise round the building to the next free side. With no free side at all it flips in place (building and lot swap
    // places on the same two tiles), so a unit with no room round it can still face the other way.
    let r = null;
    for (const n of [1, 2, 3]) if ((r = pivotSmall(b, n))) break;
    if (!r) { const f = flipSmallInPlace(b); if (f) r = { ...f, rot: (b.rot + 2) % 4 }; }
    if (!r) { notify({ type: 'rotate-blocked' }); return false; }
    b.x = r.x; b.y = r.y; b.half = r.half; b.ent = r.ent; b.rot = r.rot;
    reindex(game);
    reseatCarsOf(game, b);
    emit();
    return true;
  }
  rotateBuilding(game, b);
  if (b.kind === "dest") reseatCarsOf(game, b);
  emit();
  return true;
}

// Move a destination's entrance (see buildings.js for the encoding) and put its cars on the new layout.
export function setEntrance(b, ent) {
  b.ent = ent;
  reindex(game);
  reseatCarsOf(game, b);
  emit();
}

// Can a road reach entrance `ent` of b? (the tile outside it must be land and not covered by a building)
const entranceUsable = (b, ent) => {
  const [x, y] = exitTile(b, ent),
    k = tileIndex(x, y);
  return (
    inBounds(x, y) && game.terrain.water[k] === LAND && !game.buildingAt.has(k)
  );
};

// Tap the parking-lot part of a destination: move its entrance to the next place round the lot, clockwise (the same way a
// building turns), skipping places a road could not reach. Returns false when there is nowhere else to go.
export function flipLotAt(x, y) {
  const b = buildingAt(x, y);
  if (!b || b.kind !== "dest") return false;
  const onLot = (b.small ? [entOf(b) & 1] : [0, 1]).some((i) => {
    const [lx, ly] = lotTile(b, i);
    return lx === x && ly === y;
  });
  if (!onLot) return false;
  const cycle = entrancesOf(b),
    here = cycle.indexOf(entOf(b));
  for (let n = 1; n < cycle.length; n++) {
    const ent = cycle[(here + n) % cycle.length];
    if (entranceUsable(b, ent)) {
      setEntrance(b, ent);
      return true;
    }
  }
  return false;
}

// Dev hotkey: extra pair near an existing building (real spawning arrives with progression).
export function devSpawn() {
  if (game.mode !== "play") return false;
  const color =
    game.palette[(Math.random() * Math.min(game.palette.length, 2)) | 0];
  const a = game.buildings[(Math.random() * game.buildings.length) | 0];
  const r = spawnPair(game, color, {
    anchor: { x: a.x, y: a.y, rMin: 3, rMax: 7 },
    roads: [4, 14],
  });
  if (r) emit();
  return !!r;
}

export function setTool(tool) {
  game.tool = tool;
  if (tool !== "place") game.placing = null;
  emit();
}

// Pick a placeable special (roundabout / light) from the inventory; taps on road tiles then place it.
export function selectSpecial(id) {
  const flippable =
    id === "overpass" &&
    [...game.roads.values()].some((r) => r.overpass !== undefined);
  if ((game.inv[id] || 0) <= 0 && !flippable) return;
  game.tool = "place";
  game.placing = id;
  emit();
}

// Put a roundabout / traffic light on an intersection (a road tile with 3+ connections).
// Lanes of the road running through (x,y) along axis `a` (0 = north-south, 1 = east-west), read off its neighbors.
function overpassLanesAlong(x, y, a) {
  const sides = a === 0 ? [0, 2] : [1, 3];
  return Math.min(
    ...sides.map((d) => {
      const n = game.roads.get(tileIndex(x + SIDES[d][0], y + SIDES[d][1]));
      return n ? layerLanes(game, x + SIDES[d][0], y + SIDES[d][1], d) : 2;
    }),
  );
}

// Where an overpass at (x,y) could go: { top, lanes } (top = the deck's axis, 0 north-south / 1 east-west), or why not.
// Two straight roads crossing with nothing else joining, except that one end of the road UNDER the deck may be a building's driveway or
// lot entrance (an overpass often has to sit right next to a building). The deck itself can never come from a driveway.
export function overpassFit(x, y) {
  if (roadConns(game, x, y).length !== 4) return "notcrossing";
  const isRoad = (d) =>
    game.roads.has(tileIndex(x + SIDES[d][0], y + SIDES[d][1]));
  const open = (a) => [a, a + 2].filter((d) => !isRoad(d)).length; // arms of axis a that are a building's entrance, not a road
  if (open(0) && open(1)) return "driveway"; // each way has a building at one end: one of them would be the deck
  if (open(0) === 2 || open(1) === 2) return "notcrossing"; // a way with no road in it at all
  const along = (d) => layerLanes(game, x + SIDES[d][0], y + SIDES[d][1], d); // an overpass neighbor counts by the road running our way
  const deckAxes = [0, 1].filter((a) => !open(a)); // the axes made of two roads
  if (!deckAxes.every((a) => along(a) === along(a + 2))) return "mismatch";
  const lanes = [0, 1].map((a) => overpassLanesAlong(x, y, a));
  const top = deckAxes.length === 1 ? deckAxes[0] : lanes[0] > lanes[1] ? 0 : 1; // the bigger road goes over; a tie puts east-west on top
  return { top, lanes: lanes[top] };
}

// Returns 'ok' | 'flipped' | 'none' | 'badtile' | 'taken' | 'notjunction' | 'notcrossing' | 'mismatch' | 'driveway' | 'highway' | 'toonear' | 'empty'
export function placeSpecial(id, x, y) {
  if (!hasRoad(x, y)) return "none";
  const r = game.roads.get(tileIndex(x, y));
  if (r.tunnel || (r.bridge && id !== "light")) return "badtile"; // (a bridge only takes a traffic light, and only where a road meets it: see the 3-way check below)
  if (id === "overpass" && r.overpass !== undefined) {
    // tap an overpass again: swap which road goes over
    const next = 1 - r.overpass;
    if (
      [next, next + 2].some(
        (d) => !game.roads.has(tileIndex(x + SIDES[d][0], y + SIDES[d][1])),
      )
    )
      return "driveway"; // not onto a road that ends at a building
    r.overpass = next;
    r.lanes = overpassLanesAlong(x, y, r.overpass);
    emit();
    return "flipped";
  }
  if (r.special || r.overpass !== undefined) return "taken";
  if ((game.inv[id] || 0) <= 0) return "empty";
  if (id === "overpass") {
    const fit = overpassFit(x, y);
    if (typeof fit === "string") return fit;
    r.overpass = fit.top;
    r.lanes = fit.lanes;
    game.inv[id]--; // (the tool stays on so the player can tap it to swap)
    emit();
    return "ok";
  }
  if (roadConns(game, x, y).length < 3) return "notjunction";
  if (id === "roundabout" && (r.lanes || 2) === 4) return "highway";
  // Lights need room to queue between them: with no gap, a car cleared by one light can end up stuck inside
  // the intersection waiting for the next, blocking everyone. So no two lights on neighboring tiles.
  if (id === "light")
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]) {
      const n = game.roads.get(tileIndex(x + dx, y + dy));
      if (inBounds(x + dx, y + dy) && n && n.special === "light")
        return "toonear";
    }
  r.special = id;
  delete r.sig;
  game.inv[id]--;
  if (game.inv[id] <= 0) {
    game.tool = "build";
    game.placing = null;
  }
  emit();
  return "ok";
}

// Returns 'ok' | 'upgraded' | 'oob' | 'water' | 'hill' | 'blocked' | 'exists' | 'empty'
// In highway mode this lays 4-lane road from the highway stock (and upgrades a street it is dragged over).
export function buildRoad(x, y) {
  if (!inBounds(x, y)) return "oob";
  const idx = tileIndex(x, y),
    terrainKind = game.terrain.water[idx];
  if (terrainKind === WATER) return "water";
  if (terrainKind === HILL) return "hill";
  if (game.buildingAt.has(idx)) return "blocked";
  const four = game.build4 && (game.inv.highway || 0) > 0;
  const have = game.roads.get(idx);
  if (have) {
    if (
      four &&
      (have.lanes || 2) === 2 &&
      !have.bridge &&
      !have.tunnel &&
      have.special !== "roundabout" &&
      have.overpass === undefined
    ) {
      // widen a street in place
      have.lanes = 4;
      game.inv.highway--;
      game.inv.road++;
      if (game.inv.highway <= 0) game.build4 = false;
      emit();
      return "upgraded";
    }
    return "exists";
  }
  if (four) {
    game.inv.highway--;
    if (game.inv.highway <= 0) game.build4 = false;
  } else if (game.inv.road > 0)
    game.inv.road--; // spare pieces (start stock, demolish refunds) go first
  else if (game.money >= prog.economy.roadCost)
    game.money -= prog.economy.roadCost; // after that, each road costs cash
  else return "empty";
  game.roads.set(idx, { lanes: four ? 4 : 2 });
  clearEdgesTowards(x, y);
  emit();
  return "ok";
}

// Demolishing always refunds the piece immediately.
export function demolish(x, y) {
  const gate = buildingAt(x, y);
  if (gate && gate.kind === "portal") {
    notify({ type: "gate-info", demolish: true });
    return false;
  } // the road to another city is not ours to demolish
  if (!hasRoad(x, y)) return false;
  const r = game.roads.get(tileIndex(x, y));
  const jam = jammedTiles(game),
    span =
      r.bridge
        ? game.bridges.get(r.bridge) || []
        : [tileIndex(x, y)];
  if (span.some((k) => jam.has(k))) {
    notify({ type: "jam-locked" });
    return false;
  } // cars are jammed here: it has to be cleared the hard way
  const scene = sceneTiles(game);
  if (span.some((k) => scene.has(k))) {
    notify({ type: "jam-locked", why: game.work && span.includes(game.work.k) ? "works" : "accident" });
    return false;
  } // an accident or road works: the road stays until they clear
  if (r.tunnel) {
    // a tunnel comes out one block at a time, the piece going back to the player's stock
    game.roads.delete(tileIndex(x, y));
    clearEdgesTowards(x, y);
    game.inv.tunnel = (game.inv.tunnel || 0) + 1;
    if ((r.lanes || 2) === 4) game.inv.highway = (game.inv.highway || 0) + 1;
    emit();
    return true;
  }
  if (r.bridge) {
    // removing any bridge tile removes the whole bridge
    const id = r.bridge;
    for (const k of game.bridges.get(id) || []) {
      const t = game.roads.get(k);
      if (t && t.special) game.inv[t.special] = (game.inv[t.special] || 0) + 1; // a light on the bridge comes back too
      game.roads.delete(k);
    }
    game.bridges.delete(id);
    const item = "bridge";
    game.inv[item] = (game.inv[item] || 0) + 1;
    emit();
    return true;
  }
  if (r.special) game.inv[r.special] = (game.inv[r.special] || 0) + 1; // the roundabout / light comes back too
  if (r.overpass !== undefined)
    game.inv.overpass = (game.inv.overpass || 0) + 1;
  game.roads.delete(tileIndex(x, y));
  clearEdgesTowards(x, y);
  if ((r.lanes || 2) === 4) game.inv.highway = (game.inv.highway || 0) + 1;
  else game.inv.road++; // each kind of piece comes back as itself
  emit();
  return true;
}
