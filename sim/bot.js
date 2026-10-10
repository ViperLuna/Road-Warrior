import {
  buildRoad,
  buildBridge,
  buildTunnel,
  buy,
  chooseReward,
  placeSpecial,
  rotateBuildingAt,
  flipLotAt,
  setCut,
  isCut,
} from "../js/state.js";
import { DIR, OPP } from "../js/lanes.js";
import { findPath } from "../js/pathfind.js";
import { roadConns } from "../js/network.js";
import { lotTile, gateOf } from "../js/buildings.js";
import { prog, specialInfo } from "../js/progression.js";
import { WATER, HILL, LAND } from "../js/terrain.js";

const useable = new Set(["bridge", "tunnel", "light", "roundabout"]);
const placeable = ["light", "roundabout"];
const step = 0.5;

class Heap {
  constructor() {
    this.f = [];
    this.v = [];
  }
  get size() {
    return this.v.length;
  }
  push(f, v) {
    this.f.push(f);
    this.v.push(v);
    let i = this.f.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[p] <= this.f[i]) break;
      [this.f[p], this.f[i]] = [this.f[i], this.f[p]];
      [this.v[p], this.v[i]] = [this.v[i], this.v[p]];
      i = p;
    }
  }
  pop() {
    const top = this.v[0],
      lf = this.f.pop(),
      lv = this.v.pop(),
      n = this.f.length;
    if (n) {
      this.f[0] = lf;
      this.v[0] = lv;
      for (let i = 0; ;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && this.f[c + 1] < this.f[c]) c++;
        if (this.f[c] >= this.f[i]) break;
        [this.f[c], this.f[i]] = [this.f[i], this.f[c]];
        [this.v[c], this.v[i]] = [this.v[i], this.v[c]];
        i = c;
      }
    }
    return top;
  }
}

// Features beyond the basics, switched on with `--bot flip,cut` in sim/run.mjs:
//   flip: before connecting a colour's first house, flip a destination's gate to the other end if that is the cheaper hookup
//   cut:  now and then, cut the seam between two neighbouring junctions if every connected house still has a route
export const FEATURES = ["flip", "cut"];

export function createBot(opts = {}) {
  return {
    reward: opts.reward || "smart",
    features: new Set(opts.features || []),
    nextTidy: 0,
    next: 0,
    heat: new Map(),
    fails: new Map(),
    stats: {
      roadsBuilt: 0,
      spans: 0,
      bought: {},
      placed: {},
      rotations: 0,
      flips: 0,
      cuts: 0,
      cutsUndone: 0,
      rewards: { plain: 0, special: 0 },
      specialsTaken: {},
    },
  };
}

const gateTile = (d) => lotTile(d, gateOf(d));
const exitOf = (h) => [h.x + DIR[h.rot][0], h.y + DIR[h.rot][1]];
const gateExit = (d) => {
  const [x, y] = lotTile(d, gateOf(d));
  return [x + DIR[d.rot][0], y + DIR[d.rot][1]];
};
const destsOf = (g, color) =>
  g.buildings.filter((b) => b.kind === "dest" && b.color.id === color.id);

export function isConnected(g, h) {
  const [ex, ey] = exitOf(h);
  if (!g.roads.has(ey * g.cols + ex)) return false;
  for (const d of destsOf(g, h.color)) {
    const goals = [...g.ports.values()].filter((p) => p.b === d);
    if (findPath(g, ex, ey, OPP[h.rot], goals)) return true;
  }
  return false;
}

const canGet = (g, item) =>
  (g.inv[item] || 0) > 0 ||
  (specialInfo(item)?.enabled && g.money >= specialInfo(item).cost);

function planRoad(g, h) {
  const { cols, rows } = g,
    W = g.terrain.water,
    N = cols * rows;
  const inB = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const land = (k) => W[k] === LAND && !g.buildingAt.has(k);
  const adjRoads = (x, y) =>
    DIR.reduce(
      (n, [dx, dy]) =>
        n +
        (inB(x + dx, y + dy) && g.roads.has((y + dy) * cols + x + dx) ? 1 : 0),
      0,
    );
  const stepCost = (x, y, k) =>
    g.roads.has(k) ? 0.1 : 1 + 0.3 * adjRoads(x, y);

  const targets = new Set(
    destsOf(g, h.color)
      .map(gateExit)
      .filter(([x, y]) => inB(x, y))
      .map(([x, y]) => y * cols + x),
  );
  const [sx, sy] = exitOf(h),
    s = sy * cols + sx;
  if (!inB(sx, sy) || !(g.roads.has(s) || land(s)) || !targets.size)
    return null;
  const dist = new Float64Array(N).fill(Infinity),
    prev = new Int32Array(N).fill(-1),
    span = new Map();
  const items = { bridge: canGet(g, "bridge"), tunnel: canGet(g, "tunnel") };
  dist[s] = stepCost(sx, sy, s);
  const heap = new Heap();
  heap.push(dist[s], s);
  let goal = -1;
  while (heap.size) {
    const k = heap.pop(),
      c = dist[k];
    if (targets.has(k)) {
      goal = k;
      break;
    }
    const x = k % cols,
      y = (k / cols) | 0;
    for (const [dx, dy] of DIR) {
      const nx = x + dx,
        ny = y + dy,
        nk = ny * cols + nx;
      if (!inB(nx, ny)) continue;
      if (g.roads.has(nk) || land(nk)) {
        const nc = c + stepCost(nx, ny, nk);
        if (nc < dist[nk]) {
          dist[nk] = nc;
          prev[nk] = k;
          span.delete(nk);
          heap.push(nc, nk);
        }
        continue;
      }
      const kind = W[nk];
      if (kind !== WATER && kind !== HILL) continue;
      const item = kind === WATER ? "bridge" : "tunnel";
      if (
        !items[item] ||
        (g.roads.has(k) && (g.roads.get(k).bridge || g.roads.get(k).tunnel))
      )
        continue;
      let n = 0;
      while (
        n <= 10 &&
        inB(x + dx * (n + 1), y + dy * (n + 1)) &&
        W[(y + dy * (n + 1)) * cols + x + dx * (n + 1)] === kind &&
        !g.roads.has((y + dy * (n + 1)) * cols + x + dx * (n + 1))
      )
        n++;
      const ex = x + dx * (n + 1),
        ey = y + dy * (n + 1),
        ek = ey * cols + ex;
      if (n < 1 || n > 10 || !inB(ex, ey) || !land(ek)) continue;
      const nc = c + n + 6 + stepCost(ex, ey, ek);
      if (nc < dist[ek]) {
        dist[ek] = nc;
        prev[ek] = k;
        heap.push(nc, ek);
        span.set(ek, {
          item,
          from: { x, y },
          tiles: Array.from({ length: n }, (_, i) => ({
            x: x + dx * (i + 1),
            y: y + dy * (i + 1),
          })),
          end: { x: ex, y: ey },
        });
      }
    }
  }
  if (goal < 0) return null;
  const out = [];
  for (let k = goal; k !== -1; k = prev[k]) {
    out.push({ x: k % cols, y: (k / cols) | 0 });
    if (span.has(k)) out.push({ span: span.get(k) });
  }
  return out.reverse();
}

function build(g, plan, bot) {
  const newTiles = plan.filter(
    (p) => !p.span && !g.roads.has(p.y * g.cols + p.x),
  ).length;
  const spans = plan.filter((p) => p.span).map((p) => p.span);
  const need = { bridge: 0, tunnel: 0 };
  spans.forEach((s) => need[s.item]++);
  let cash = 0;
  for (const item of ["bridge", "tunnel"]) {
    const short = Math.max(0, need[item] - (g.inv[item] || 0));
    if (short) cash += short * (specialInfo(item)?.cost ?? Infinity);
  }
  const roadsAfter =
    (g.inv.road || 0) + Math.floor((g.money - cash) / prog.economy.roadCost);
  if (cash > g.money || newTiles > roadsAfter) return false;
  for (const item of ["bridge", "tunnel"])
    while ((g.inv[item] || 0) < need[item]) {
      if (!buy(item)) return false;
      bot.stats.bought[item] = (bot.stats.bought[item] || 0) + 1;
    }
  for (const p of plan) {
    if (p.span) {
      const r = (p.span.item === "bridge" ? buildBridge : buildTunnel)(
        p.span.from,
        p.span.tiles,
        p.span.end,
      );
      if (r !== "ok") return false;
      bot.stats.spans++;
    } else if (!g.roads.has(p.y * g.cols + p.x)) {
      const r = buildRoad(p.x, p.y);
      if (r !== "ok") return false;
      bot.stats.roadsBuilt++;
    }
  }
  return true;
}

const planCost = (g, plan) =>
  plan
    ? plan.reduce((n, p) => n + (p.span ? 8 : g.roads.has(p.y * g.cols + p.x) ? 0 : 1), 0)
    : Infinity;

// Flip a destination's gate if that makes the first hookup of its colour cheaper. Only while nothing of that colour is
// connected yet (a flip would cut off houses already wired to the old gate).
function maybeFlip(g, h, bot) {
  if (!bot.features.has("flip")) return;
  if (g.buildings.some((o) => o.kind === "house" && o.connected && o.color.id === h.color.id)) return;
  const base = planCost(g, planRoad(g, h));
  for (const d of destsOf(g, h.color)) {
    const [fx, fy] = gateTile(d);
    if (!flipLotAt(fx, fy)) continue;
    const alt = planCost(g, planRoad(g, h));
    if (alt < base - 1) {
      bot.stats.flips++;
      return;
    }
    const [bx, by] = gateTile(d);
    flipLotAt(bx, by);
  }
}

function connectHouses(g, bot) {
  for (const h of g.buildings) {
    if (h.kind !== "house" || h.connected) continue;
    if (isConnected(g, h)) {
      h.connected = true;
      continue;
    }
    maybeFlip(g, h, bot);
    const plan = planRoad(g, h);
    if (plan) {
      if (build(g, plan, bot) && isConnected(g, h)) h.connected = true;
      continue;
    }
    const f = (bot.fails.get(h.id) || 0) + 1;
    bot.fails.set(h.id, f);
    if (
      f % 4 === 0 &&
      f <= 16 &&
      g.cars.find((c) => c.house === h)?.state === "home"
    ) {
      rotateBuildingAt(h.x, h.y);
      bot.stats.rotations++;
    }
  }
}

// Cut the seam between two neighbouring junctions when nothing needs it: every connected house must still reach a destination.
function tidyCuts(g, bot) {
  if (!bot.features.has("cut")) return;
  const homes = g.buildings.filter((b) => b.kind === "house" && b.connected);
  const seams = [];
  for (const [k] of g.roads) {
    const x = k % g.cols, y = (k / g.cols) | 0;
    if (roadConns(g, x, y).length < 3) continue;
    for (const d of [1, 2]) {                      // east and south only: each seam once
      const nx = x + DIR[d][0], ny = y + DIR[d][1];
      if (!g.roads.has(ny * g.cols + nx) || isCut(x, y, nx, ny)) continue;
      if (roadConns(g, nx, ny).length >= 3 && roadConns(g, x, y).includes(d)) seams.push([x, y, nx, ny]);
    }
  }
  for (const [x, y, nx, ny] of seams.slice(0, 3)) {
    if (!setCut(x, y, nx, ny, true)) continue;
    if (homes.every((h) => isConnected(g, h))) bot.stats.cuts++;
    else {
      setCut(x, y, nx, ny, false);
      bot.stats.cutsUndone++;
    }
  }
}

function trackHeat(g, bot) {
  for (const [k, v] of bot.heat) {
    const nv = v * 0.98;
    if (nv < 0.05) bot.heat.delete(k);
    else bot.heat.set(k, nv);
  }
  for (const c of g.cars) {
    if (!c.hold || !c.entry || c.entry.q.kind !== "road") continue;
    const k = c.entry.q.ty * g.cols + c.entry.q.tx;
    bot.heat.set(k, (bot.heat.get(k) || 0) + step);
  }
}

function placeSpecials(g, bot) {
  for (const id of placeable) {
    if ((g.inv[id] || 0) <= 0) continue;
    const spots = [...bot.heat.entries()]
      .filter(([, v]) => v > 3)
      .sort((a, b) => b[1] - a[1]);
    for (const [k] of spots) {
      const x = k % g.cols,
        y = (k / g.cols) | 0;
      if (roadConns(g, x, y).length < 3) continue;
      if (placeSpecial(id, x, y) === "ok") {
        bot.stats.placed[id] = (bot.stats.placed[id] || 0) + 1;
        bot.heat.delete(k);
        break;
      }
    }
  }
}

function answerReward(g, bot) {
  const special = g.reward.options.find((o) => o.id === "special");
  const take =
    special &&
    (bot.reward === "special" ||
      (bot.reward === "smart" && useable.has(special.special.id)));
  chooseReward(take ? "special" : "plain");
  bot.stats.rewards[take ? "special" : "plain"]++;
  if (take)
    bot.stats.specialsTaken[special.special.id] =
      (bot.stats.specialsTaken[special.special.id] || 0) + 1;
}

export function botTick(g, bot) {
  if (g.mode === "reward") answerReward(g, bot);
  if (g.mode !== "play" || g.time < bot.next) return;
  bot.next = g.time + step;
  trackHeat(g, bot);
  connectHouses(g, bot);
  placeSpecials(g, bot);
  if (g.time >= bot.nextTidy) {
    bot.nextTidy = g.time + 30;
    tidyCuts(g, bot);
  }
}
