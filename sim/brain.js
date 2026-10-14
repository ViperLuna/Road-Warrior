import {
  buildRoad,
  demolish,
  buy,
  chooseReward,
  placeSpecial,
  rotateBuildingAt,
  setEntrance,
  setEdge,
  setCut,
  isCut,
  ackNotice,
  overpassFit,
  tick,
  setQuiet,
  refresh,
} from "../js/state.js";
import { DIR } from "../js/lanes.js";
import { roadConns, netVersion } from "../js/network.js";
import {
  bounds,
  entOf,
  entsOf,
  entrancesOf,
  exitTile,
  reindex,
} from "../js/buildings.js";
import { stadiumOf, gatesOf } from "../js/outside.js";
import { prog, specialInfo, roadsAvailable } from "../js/progression.js";
import { tuning } from "../js/tuning.js";
import { compile } from "./neat.js";
import { snapshot, load } from "./snapshot.js";
import { mulberry32 } from "../js/rng.js";
import {
  planRoad,
  planCost,
  build,
  unreached,
  destsOf,
  reaches,
  colorsIn,
  trackHeat,
  streetLegs,
} from "./bot.js";

export const BRAIN_VERSION = 4;
const step = 0.5;
const ITEMS = [
  "bridge",
  "tunnel",
  "light",
  "roundabout",
  "highway",
  "overpass",
  "oneway",
];
const TYPES = [
  "noop",
  "connect",
  "reroute",
  "light",
  "roundabout",
  "overpass",
  "widen",
  "oneway",
  "cut",
  "demolish",
  "reward",
];
const GLOBALS = [
  "time",
  "money",
  "roads",
  "roadsAvail",
  ...ITEMS.map((i) => "have_" + i),
  "houses",
  "unconnected",
  "urgency",
  "stuck",
  "heatMax",
  "heatSum",
];
const SLOTS = 8;

const SCORED = TYPES.filter((t) => t !== "noop");
export const INPUTS = [
  ...TYPES.map((t) => "is_" + t),
  ...ITEMS.map((i) => "item_" + i),
  ...SCORED.flatMap((t) => [
    ...GLOBALS.map((n) => t + "." + n),
    ...Array.from({ length: SLOTS }, (_, i) => t + ".a" + i),
  ]),
];

const clip = (v, hi = 3) => Math.max(-hi, Math.min(hi, v));
const tileSpot = (g, k) => ({
  x0: k % g.cols,
  y0: (k / g.cols) | 0,
  x1: k % g.cols,
  y1: (k / g.cols) | 0,
});
const xy = (g, k) => [k % g.cols, (k / g.cols) | 0];
const obtainable = (g, item) =>
  (item === "oneway" ? !!g.unlocks.oneway : (g.inv[item] || 0) > 0) ||
  canBuy(g, item);
const canBuy = (g, item) => {
  const s = specialInfo(item);
  return !!(
    s &&
    s.enabled &&
    s.cost &&
    g.money >= s.cost &&
    !(s.unlock && g.unlocks[item])
  );
};
const have = (g, item) =>
  item === "oneway" ? !!g.unlocks.oneway : (g.inv[item] || 0) > 0;
const ensure = (g, brain, item) =>
  have(g, item) ||
  (buy(item) &&
    ((brain.stats.bought[item] = (brain.stats.bought[item] || 0) + 1), true));

export function createBrain(file, opts = {}) {
  if (file.version !== BRAIN_VERSION || file.inputs.join() !== INPUTS.join())
    throw new Error(
      "brain file was made for a different set of inputs; retrain it",
    );
  return {
    net: compile(file.genome),
    meta: file.meta || {},
    next: 0,
    heat: new Map(),
    tabu: new Map(),
    conn: { ver: -1 },
    onDecision: opts.onDecision || null,
    look: opts.lookahead
      ? { every: 10, horizon: 60, k: 3, cash: 0.02, ...opts.lookahead }
      : null,
    nextLook: 0,
    nextPricey: 0,
    stats: { roadsBuilt: 0, spans: 0, bought: {}, actions: {}, failed: 0 },
  };
}

function missing(g, brain) {
  const key = netVersion() + ":" + g.buildings.length;
  if (brain.conn.ver === key) return brain.conn.miss;
  const miss = new Map();
  for (const h of g.buildings)
    if (h.kind === "house") {
      const m = unreached(g, h);
      if (m.length) miss.set(h.id, m);
    }
  brain.conn = { ver: key, miss };
  return miss;
}

function urgencyOf(g, id) {
  const w = (g.watches || []).find((w) => w.ids.includes(id));
  if (!w || w.ok || w.stage === "ok") return 0;
  const cfg =
      tuning.deadlines[w.kind === "dest" ? "house" : w.kind] ||
      tuning.deadlines.house,
    all = cfg.graceSeconds + cfg.warnSeconds;
  return Math.min(
    1,
    (w.stage === "grace" ? w.t : cfg.graceSeconds + w.t) / all,
  );
}

function globals(g, brain, miss) {
  const houses = g.buildings.filter((b) => b.kind === "house");
  const heat = [...brain.heat.values()];
  const urg = (g.watches || []).reduce(
    (m, w) => Math.max(m, urgencyOf(g, w.ids[0])),
    0,
  );
  return [
    clip(g.time / 3600),
    clip(g.money / 200),
    clip((g.inv.road || 0) / 30),
    clip(roadsAvailable(g) / 50),
    ...ITEMS.map((i) =>
      i === "oneway"
        ? g.unlocks.oneway
          ? 1
          : 0
        : clip((g.inv[i] || 0) / (i === "highway" ? 10 : 3)),
    ),
    clip(houses.length / 100),
    houses.length ? miss.size / houses.length : 0,
    urg,
    g.cars.reduce((m, c) => Math.max(m, c.stuck), 0) /
      tuning.gridlock.gameOverAfterSeconds,
    clip(Math.max(0, ...heat) / 20),
    clip(heat.reduce((a, b) => a + b, 0) / 100),
  ];
}

const planStats = (g, plan, heat = new Map()) => {
  let tiles = 0,
    spans = 0,
    bends = 0,
    hot = 0,
    prev = null,
    dir = -1;
  for (const p of plan) {
    if (p.span) {
      spans++;
      prev = null;
      dir = -1;
      continue;
    }
    const k = p.y * g.cols + p.x;
    if (!g.roads.has(k)) tiles++;
    hot += heat.get(k) || 0;
    if (prev) {
      const d = p.x !== prev.x ? 0 : 1;
      if (dir >= 0 && d !== dir) bends++;
      dir = d;
    }
    prev = p;
  }
  return { tiles, spans, bends, heat: hot };
};

function trial(g, setup, fn) {
  if (!setup) return fn();
  const { b, key, value } = setup,
    was = b[key];
  b[key] = value;
  reindex(g);
  try {
    return fn();
  } finally {
    if (was === undefined) delete b[key];
    else b[key] = was;
    reindex(g);
  }
}
function applySetup(g, setup) {
  if (!setup) return true;
  if (setup.key === "ent") {
    setEntrance(setup.b, setup.value);
    return entOf(setup.b) === setup.value;
  }
  for (let t = 0; t < 3 && setup.b.rot !== setup.value; t++)
    rotateBuildingAt(setup.b.x, setup.b.y);
  return setup.b.rot === setup.value;
}
const affordable = (g, s, highway = false) =>
  (highway ? g.inv.highway || 0 : 0) + roadsAvailable(g) >= s.tiles;

function buildWith(g, brain, plan, highway) {
  const was = g.build4;
  if (highway) {
    if (!ensure(g, brain, "highway")) return false;
    g.build4 = true;
  }
  try {
    return build(g, plan, brain);
  } finally {
    g.build4 = was && (g.inv.highway || 0) > 0;
  }
}

function junctions(g, brain, n) {
  const out = [];
  for (const [k, r] of g.roads) {
    if (r.special || r.overpass !== undefined || r.bridge || r.tunnel) continue;
    const [x, y] = xy(g, k);
    if (roadConns(g, x, y).length < 3) continue;
    out.push({
      k,
      x,
      y,
      r,
      heat: brain.heat.get(k) || 0,
      legs: streetLegs(g, x, y),
    });
  }
  return out.sort((a, b) => b.heat - a.heat || a.k - b.k).slice(0, n);
}

function chainFrom(g, x, y, d) {
  const tiles = [];
  let cx = x,
    cy = y,
    cd = d;
  for (let i = 0; i < 10; i++) {
    const nx = cx + DIR[cd][0],
      ny = cy + DIR[cd][1],
      k = ny * g.cols + nx,
      r = g.roads.get(k);
    if (!r || r.bridge || r.tunnel) break;
    tiles.push(k);
    const conns = roadConns(g, nx, ny).filter((e) => e !== (cd + 2) % 4);
    if (conns.length !== 1) break;
    cx = nx;
    cy = ny;
    cd = conns[0];
  }
  return tiles;
}

const connectedHouses = (g, miss) =>
  g.buildings.filter((b) => b.kind === "house" && !miss.has(b.id));
const stillConnected = (g, houses) =>
  houses.every((h) => unreached(g, h).length === 0);

function candidates(g, brain) {
  const out = [],
    miss = missing(g, brain),
    C = (type, item, f, run, text, spots, key, cool = 0) =>
      out.push({ type, item, f, run, text, spots, key, cool });
  const heatOf = (k) => brain.heat.get(k) || 0;

  if (g.mode === "reward") {
    for (const o of g.reward.options)
      C(
        "reward",
        o.special && o.special.id,
        [o.cash / 100, o.special ? 1 : 0, 0, 0, 0, 0],
        () => (chooseReward(o.id), true),
        o.special
          ? `Took the ${o.special.name} reward`
          : `Took the plain reward ($${o.cash})`,
        [],
        "reward",
      );
    return out;
  }
  C("noop", null, [0, 0, 0, 0, 0, 0], () => true, null, [], "noop");

  const seen = new Set();
  const costOf = (h, to) => {
    const p = planRoad(g, h, to);
    return p ? planCost(g, p) : Infinity;
  };
  const variants = [
    ["short", {}, false],
    ["straight", { adj: 0 }, false],
    ["avoid", { extra: (k) => heatOf(k) * 0.3, adj: 0.8 }, false],
  ];
  if (obtainable(g, "highway")) variants.push(["highway", {}, true]);
  for (const h of g.buildings
    .filter((b) => b.kind === "house" && miss.has(b.id))
    .slice(0, 8)) {
    const to = miss.get(h.id),
      urg = urgencyOf(g, h.id),
      base = costOf(h, to);
    const partial = destsOf(g, h.color).length > to.length ? 1 : 0;
    const setups = [null],
      home = g.cars.find((c) => c.house === h);
    const bestOf = (opts) => {
      let best = null,
        bestCost = base;
      for (const o of opts) {
        const c = trial(g, o, () => costOf(h, to));
        if (c < bestCost) {
          best = o;
          bestCost = c;
        }
      }
      if (best) setups.push(best);
    };
    if (!partial && (!home || home.state === "home"))
      bestOf(
        [1, 2, 3].map((t) => ({ b: h, key: "rot", value: (h.rot + t) % 4 })),
      );
    for (const d of to.slice(0, 2))
      if (
        !d.stadium &&
        !g.buildings.some(
          (o) =>
            (o.kind === "house" || o.kind === "portal") && reaches(g, o, d),
        )
      )
        bestOf(
          entrancesOf(d)
            .filter((e) => e !== entOf(d))
            .map((e) => ({ b: d, key: "ent", value: e })),
        );
    for (const setup of setups) {
      const plans = trial(g, setup, () =>
        variants.map(([name, opts, hw]) => [
          name,
          planRoad(g, h, to, opts),
          hw,
        ]),
      );
      for (const [name, plan, hw] of plans) {
        if (!plan) continue;
        const sig =
          (setup ? setup.key + setup.value : "") +
          hw +
          ":" +
          plan.map((p) => (p.span ? "s" : p.x + "," + p.y)).join(";");
        if (seen.has(h.id + sig)) continue;
        seen.add(h.id + sig);
        const s = planStats(g, plan, brain.heat);
        if (!affordable(g, s, hw)) continue;
        const turned = setup && setup.key === "rot",
          moved = setup && setup.key === "ent";
        const how = [
          hw && "as highway",
          turned && "after turning it",
          moved && `after moving the ${setup.b.color.id} entrance`,
        ]
          .filter(Boolean)
          .join(", ");
        C(
          "connect",
          hw ? "highway" : null,
          [
            s.tiles / 20,
            s.spans / 2,
            urg,
            s.heat / 20,
            s.bends / 10,
            turned ? 1 : 0,
            moved ? 1 : 0,
            partial,
          ],
          () =>
            applySetup(g, setup) &&
            buildWith(g, brain, plan, hw) &&
            unreached(g, h).length === 0,
          `Connected the ${h.color.id} house (${s.tiles} road${s.tiles === 1 ? "" : "s"}, ${s.bends} bend${s.bends === 1 ? "" : "s"}${s.spans ? `, ${s.spans} span` : ""}${how ? ", " + how : ""})`,
          [bounds(h), ...(moved ? [bounds(setup.b)] : [])],
          "connect:" +
            h.id +
            ":" +
            name +
            (setup ? ":" + setup.key + setup.b.id + "=" + setup.value : ""),
        );
      }
    }
  }

  const arena = stadiumOf(g);
  if (arena) {
    const pseudo = entsOf(arena).map((ent) => ({ exit: exitTile(arena, ent) }));
    const urg = urgencyOf(g, arena.id);
    const tryPlan = (from, to, label) => {
      const plan = planRoad(g, from, to);
      if (!plan) return;
      const s = planStats(g, plan);
      if (affordable(g, s))
        C(
          "connect",
          null,
          [s.tiles / 20, s.spans / 2, urg, 0, s.bends / 10, 0, 0, 0],
          () => build(g, plan, brain),
          label,
          [bounds(arena)],
          "outside:" + from.id,
        );
    };
    for (const c of colorsIn(g)) {
      const mine = g.buildings.filter(
        (b) => b.kind === "house" && b.color.id === c.id && !miss.has(b.id),
      );
      if (mine.length && !mine.some((h) => reaches(g, h, arena)))
        tryPlan(mine[0], pseudo, `Connected ${c.id} to the stadium`);
    }
    for (const gate of gatesOf(g)) {
      if (!reaches(g, gate, arena))
        tryPlan(gate, pseudo, "Connected a side-road gate to the stadium");
      for (const c of colorsIn(g)) {
        const all = destsOf(g, c);
        if (all.length && !all.some((d) => reaches(g, gate, d)))
          tryPlan(gate, all, `Connected a side-road gate to ${c.id}`);
      }
    }
  }

  const hot = [...brain.heat.entries()]
    .filter(([, v]) => v > 2)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 3);
  for (const [k, v] of hot) {
    const [x, y] = xy(g, k);
    const car = g.cars.find(
      (c) =>
        c.house && c.route && c.route.some((r) => r.tx === x && r.ty === y),
    );
    const h = car && car.house;
    if (!h || h.kind !== "house" || miss.has(h.id)) continue;
    const plan = planRoad(g, h, destsOf(g, h.color), {
      extra: (q) => (q === k ? 50 : heatOf(q) * 0.5),
      adj: 0.5,
    });
    if (!plan || plan.some((p) => !p.span && p.y * g.cols + p.x === k))
      continue;
    const s = planStats(g, plan);
    if (!s.tiles || !affordable(g, s)) continue;
    C(
      "reroute",
      null,
      [s.tiles / 20, v / 20, s.spans / 2, 0, 0, 0],
      () => build(g, plan, brain),
      `Built a bypass around a busy spot (${s.tiles} roads)`,
      [tileSpot(g, k)],
      "reroute:" + k,
    );
  }

  const J = junctions(g, brain, 6);
  for (const j of J) {
    const near = DIR.filter(([dx, dy]) => {
      const n = g.roads.get((j.y + dy) * g.cols + j.x + dx);
      return n && roadConns(g, j.x + dx, j.y + dy).length >= 3;
    }).length;
    const stuck = g.cars.filter(
      (c) =>
        c.stuck > 2 &&
        c.entry &&
        c.entry.q.kind === "road" &&
        c.entry.q.tx === j.x &&
        c.entry.q.ty === j.y,
    ).length;
    for (const id of ["light", "roundabout", "overpass"]) {
      if (!obtainable(g, id)) continue;
      if (id === "roundabout" && (j.r.lanes || 2) === 4) continue;
      if (id === "overpass" && typeof overpassFit(j.x, j.y) === "string")
        continue;
      if (
        id === "light" &&
        DIR.some(
          ([dx, dy]) =>
            (g.roads.get((j.y + dy) * g.cols + j.x + dx) || {}).special ===
            "light",
        )
      )
        continue;
      C(
        id,
        id,
        [
          j.heat / 20,
          j.legs / 4,
          (j.r.lanes || 2) === 4 ? 1 : 0,
          near / 4,
          have(g, id) ? 0 : 1,
          stuck / 5,
        ],
        () => ensure(g, brain, id) && placeSpecial(id, j.x, j.y) === "ok",
        `${specialInfo(id).name} on a junction (busy ${j.heat.toFixed(0)})`,
        [tileSpot(g, j.k)],
        id + ":" + j.k,
      );
    }
  }

  if (obtainable(g, "highway")) {
    const done = new Set();
    for (const [k, v] of [...brain.heat.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 4)) {
      const [x, y] = xy(g, k);
      if (!g.roads.has(k)) continue;
      for (const d of roadConns(g, x, y)) {
        const run = chainFrom(g, x, y, d).filter((q) => {
          const r = g.roads.get(q);
          return (r.lanes || 2) === 2 && !r.special && r.overpass === undefined;
        });
        const key = run.slice().sort().join(",");
        if (!run.length || done.has(key)) continue;
        done.add(key);
        if ((g.inv.highway || 0) < run.length && !canBuy(g, "highway"))
          continue;
        const runHeat = run.reduce((n, q) => n + heatOf(q), 0) + v;
        C(
          "widen",
          "highway",
          [
            runHeat / 20,
            run.length / 10,
            have(g, "highway") ? 0 : 1,
            (g.inv.highway || 0) / 10,
            0,
            0,
          ],
          () => {
            if (!ensure(g, brain, "highway")) return false;
            g.build4 = true;
            for (const q of run) {
              if (
                (g.inv.highway || 0) <= 0 &&
                !(canBuy(g, "highway") && buy("highway"))
              )
                break;
              g.build4 = true;
              buildRoad(...xy(g, q));
            }
            g.build4 = false;
            return true;
          },
          `Widened ${run.length} tile${run.length === 1 ? "" : "s"} of busy street to highway`,
          run.map((q) => tileSpot(g, q)),
          "widen:" + key,
        );
      }
    }
  }

  const top = J.filter((j) => j.heat > 1).slice(0, 3);
  if (obtainable(g, "oneway"))
    for (const j of top)
      for (const d of roadConns(g, j.x, j.y)) {
        const chain = chainFrom(g, j.x, j.y, d);
        if (chain.length < 2) continue;
        const path = [j.k, ...chain];
        for (const dir of [1, -1]) {
          const seq = dir === 1 ? path : path.slice().reverse();
          C(
            "oneway",
            "oneway",
            [
              j.heat / 20,
              heatOf(seq.at(-1)) / 20,
              chain.length / 10,
              have(g, "oneway") ? 0 : 1,
              dir === 1 ? 1 : 0,
              0,
            ],
            () => {
              if (!ensure(g, brain, "oneway")) return false;
              const keep = connectedHouses(g, miss);
              for (let i = 0; i + 1 < seq.length; i++)
                setEdge(...xy(g, seq[i]), ...xy(g, seq[i + 1]), true);
              if (stillConnected(g, keep)) return true;
              for (let i = 0; i + 1 < seq.length; i++)
                setEdge(...xy(g, seq[i]), ...xy(g, seq[i + 1]), false);
              return false;
            },
            `Made a street one-way ${dir === 1 ? "away from" : "into"} a busy junction`,
            seq.map((q) => tileSpot(g, q)),
            "oneway:" + seq.join(","),
          );
        }
      }
  for (const j of top)
    for (const d of roadConns(g, j.x, j.y)) {
      const nx = j.x + DIR[d][0],
        ny = j.y + DIR[d][1],
        nk = ny * g.cols + nx;
      if (
        !g.roads.has(nk) ||
        isCut(j.x, j.y, nx, ny) ||
        roadConns(g, nx, ny).length < 3
      )
        continue;
      C(
        "cut",
        null,
        [j.heat / 20, heatOf(nk) / 20, 0, 0, 0, 0],
        () => {
          const keep = connectedHouses(g, miss);
          if (!setCut(j.x, j.y, nx, ny, true)) return false;
          if (stillConnected(g, keep)) return true;
          setCut(j.x, j.y, nx, ny, false);
          return false;
        },
        "Cut the link between two crowded junctions",
        [tileSpot(g, j.k), tileSpot(g, nk)],
        "cut:" + Math.min(j.k, nk) + ":" + Math.max(j.k, nk),
      );
    }

  let dead = 0;
  for (const [k, r] of g.roads) {
    if (dead >= 3) break;
    const [x, y] = xy(g, k);
    if (
      r.bridge ||
      r.tunnel ||
      r.special ||
      r.overpass !== undefined ||
      (r.lanes || 2) !== 2 ||
      roadConns(g, x, y).length > 1 ||
      heatOf(k)
    )
      continue;
    if (
      g.cars.some(
        (c) => c.route && c.route.some((p) => p.tx === x && p.ty === y),
      )
    )
      continue;
    dead++;
    C(
      "demolish",
      null,
      [(g.inv.road || 0) / 30, roadConns(g, x, y).length, 0, 0, 0, 0],
      () => {
        const keep = connectedHouses(g, miss);
        if (!demolish(x, y)) return false;
        if (stillConnected(g, keep)) return true;
        buildRoad(x, y);
        return false;
      },
      "Picked up a dead-end road",
      [tileSpot(g, k)],
      "demolish:" + k,
    );
  }

  return out;
}

function encode(glob, c) {
  const v = [];
  for (const t of TYPES) v.push(c.type === t ? 1 : 0);
  for (const i of ITEMS) v.push(c.item === i ? 1 : 0);
  for (const t of SCORED) {
    if (t !== c.type) {
      for (let i = 0; i < glob.length + SLOTS; i++) v.push(0);
      continue;
    }
    v.push(...glob);
    for (let i = 0; i < SLOTS; i++) v.push(clip(c.f[i] || 0));
  }
  return v;
}

export function brainTick(g, brain) {
  if (g.mode === "notice") ackNotice();
  if (g.mode === "reward") return decide(g, brain);
  if (g.mode !== "play" || g.time < brain.next) return;
  brain.next = g.time + step;
  trackHeat(g, brain);
  decide(g, brain);
}

function decide(g, brain) {
  const cands = candidates(g, brain).filter(
    (c) => !(brain.tabu.get(c.key) > g.time),
  );
  if (!cands.length) return;
  const glob = globals(g, brain, missing(g, brain));
  for (const c of cands) c.score = brain.net(encode(glob, c))[0];
  cands.sort((a, b) => b.score - a.score);
  const due = g.time >= brain.nextLook,
    pricey = g.time >= brain.nextPricey && spendOf(g, cands[0]) > 0;
  if (
    brain.look &&
    g.mode === "play" &&
    cands[0].type !== "noop" &&
    (due || pricey)
  ) {
    if (due) brain.nextLook = g.time + brain.look.every;
    brain.nextPricey = g.time + brain.look.every / 2;
    const options = [
      cands.find((c) => c.type === "noop"),
      ...cands.filter((c) => c.type !== "noop").slice(0, brain.look.k),
    ].filter(Boolean);
    const best = lookahead(g, brain, options);
    for (const o of options)
      if (o.type !== "noop" && (!best || o.key !== best.key))
        brain.tabu.set(o.key, g.time + brain.look.every);
    if (best && best.type === "noop") return;
    const c = best && candidates(g, brain).find((c) => c.key === best.key);
    if (c && act(g, brain, c, best.note)) return;
  }
  for (const c of cands.slice(0, 3)) {
    if (c.type === "noop") return;
    if (act(g, brain, c)) return;
  }
  if (g.mode === "reward") chooseReward("plain");
}

function spendOf(g, c) {
  if (c.item && c.type !== "reward" && c.type !== "connect" && !have(g, c.item))
    return specialInfo(c.item).cost;
  if (c.type === "connect" || c.type === "reroute")
    return (
      Math.max(0, Math.round(c.f[0] * 20) - (g.inv.road || 0)) *
      prog.economy.roadCost
    );
  return 0;
}

function act(g, brain, c, note = "") {
  if (!c.run()) {
    brain.stats.failed++;
    brain.tabu.set(c.key, g.time + 20);
    return false;
  }
  brain.stats.actions[c.type] = (brain.stats.actions[c.type] || 0) + 1;
  if (c.cool) brain.tabu.set(c.key, g.time + c.cool);
  if (brain.onDecision && c.text) brain.onDecision(c.text + note, c.spots, c);
  return true;
}

function lookahead(g, brain, options) {
  const snap = snapshot(g),
    random = Math.random,
    seed = (g.seed ^ Math.round(g.time * 60)) >>> 0;
  const results = [];
  setQuiet(true);
  try {
    for (const o of options) {
      load(g, snap);
      Math.random = mulberry32(seed);
      const sub = {
        ...brain,
        look: null,
        onDecision: null,
        heat: new Map(brain.heat),
        tabu: new Map(brain.tabu),
        conn: { ver: -1 },
        stats: { roadsBuilt: 0, spans: 0, bought: {}, actions: {}, failed: 0 },
      };
      if (o.type === "noop")
        for (const x of options)
          if (x.type !== "noop") sub.tabu.set(x.key, g.time + brain.look.every);
      const c =
        o.type === "noop" ? o : candidates(g, sub).find((x) => x.key === o.key);
      if (!c || !c.run()) {
        results.push({
          o,
          failed: !c ? "gone" : "failed",
          score: -Infinity,
          trips: 0,
        });
        continue;
      }
      const trips = g.trips,
        money = g.money,
        end = g.time + brain.look.horizon;
      let worst = 0;
      while (g.mode !== "over" && g.time < end) {
        brainTick(g, sub);
        if (g.mode === "reward") continue;
        tick(1 / 60);
        for (const car of g.cars) if (car.stuck > worst) worst = car.stuck;
      }
      const danger = Math.max(
        0,
        worst / tuning.gridlock.gameOverAfterSeconds - 0.5,
      );
      const waiting = (g.watches || []).reduce(
        (n, w) => n + urgencyOf(g, w.ids[0]),
        0,
      );
      results.push({
        o,
        trips: g.trips - trips,
        score:
          g.trips -
          trips +
          brain.look.cash * (g.money - money) -
          (g.mode === "over" ? 1e4 : 0) -
          40 * danger -
          25 * waiting,
      });
    }
  } finally {
    load(g, snap);
    Math.random = random;
    setQuiet(false);
    brain.conn = { ver: -1 };
    refresh();
  }
  brain.stats.lookaheads = (brain.stats.lookaheads || 0) + 1;
  if (brain.look.debug) brain.look.debug(g, options, results);
  if (!results.length) return null;
  const wait = results.find((r) => r.o.type === "noop"),
    moves = results.filter((r) => r.o.type !== "noop" && r.score > -Infinity);
  moves.sort((a, b) => b.score - a.score);
  const best =
    !moves.length || (wait && wait.score > moves[0].score + 0.5)
      ? wait
      : moves[0];
  if (!best) return null;
  if (best.o !== options.find((x) => x.type !== "noop"))
    brain.stats.overruled = (brain.stats.overruled || 0) + 1;
  return {
    ...best.o,
    note:
      wait && best.o.type !== "noop"
        ? ` [looked ahead ${brain.look.horizon}s: ${best.trips} trips vs ${wait.trips} if it waited]`
        : "",
  };
}
