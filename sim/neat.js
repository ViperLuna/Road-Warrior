
export const DEFAULTS = {
  popSize: 150,
  weightMutate: 0.8, weightPerturb: 0.9, perturbPower: 0.5, weightRange: 2,
  addConn: 0.08, addNode: 0.03, toggle: 0.01,
  crossover: 0.75,
  c1: 1, c2: 1, c3: 0.4,
  threshold: 1, targetSpecies: 8,
  stagnation: 15, survival: 0.2, elitism: 1,
};

const randn = rng => { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clone = g => ({ nodes: g.nodes.map(n => ({ ...n })), conns: g.conns.map(c => ({ ...c })) });

export function compile(genome) {
  const nIn = genome.nodes.filter(n => n.type === 'in').length;
  const ids = genome.nodes.map(n => n.id), idx = new Map(ids.map((id, i) => [id, i]));
  const live = genome.conns.filter(c => c.on);
  const incoming = new Map(ids.map(id => [id, []]));
  for (const c of live) incoming.get(c.out).push(c);
  const order = [], seen = new Set(), visit = id => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const c of incoming.get(id)) visit(c.in);
    order.push(id);
  };
  const outs = genome.nodes.filter(n => n.type === 'out').map(n => n.id);
  outs.forEach(visit);
  const steps = order.filter(id => { const t = genome.nodes[idx.get(id)].type; return t === 'hid' || t === 'out'; })
    .map(id => ({ at: idx.get(id), from: incoming.get(id).map(c => [idx.get(c.in), c.w]) }));
  const bias = genome.nodes.findIndex(n => n.type === 'bias'), outAt = outs.map(id => idx.get(id));
  const v = new Float64Array(ids.length);
  return input => {
    v.fill(0);
    for (let i = 0; i < nIn; i++) v[i] = input[i];
    v[bias] = 1;
    for (const s of steps) { let sum = 0; for (const [j, w] of s.from) sum += v[j] * w; v[s.at] = Math.tanh(sum); }
    return outAt.map(i => v[i]);
  };
}

export function createPopulation(nIn, nOut, opts = {}, rng = Math.random) {
  const cfg = { ...DEFAULTS, ...opts };
  const P = { cfg, nIn, nOut, gen: 0, nextNode: nIn + 1 + nOut, nextInn: 0, innov: {}, splits: {}, species: [], genomes: [], best: null, nextSpecies: 1 };
  for (let i = 0; i < cfg.popSize; i++) {
    const g = { nodes: [], conns: [] };
    for (let k = 0; k < nIn; k++) g.nodes.push({ id: k, type: 'in' });
    g.nodes.push({ id: nIn, type: 'bias' });
    for (let o = 0; o < nOut; o++) g.nodes.push({ id: nIn + 1 + o, type: 'out' });
    for (let k = 0; k <= nIn; k++) for (let o = 0; o < nOut; o++) g.conns.push({ in: k, out: nIn + 1 + o, w: randn(rng) * 0.5, on: true, inn: innovation(P, k, nIn + 1 + o) });
    P.genomes.push(g);
  }
  return P;
}

function innovation(P, a, b) {
  const key = a + '>' + b;
  if (!(key in P.innov)) P.innov[key] = P.nextInn++;
  return P.innov[key];
}

function feedsInto(g, from, to) {
  const out = new Map();
  for (const c of g.conns) (out.get(c.in) || out.set(c.in, []).get(c.in)).push(c.out);
  const stack = [from], seen = new Set();
  while (stack.length) {
    const n = stack.pop();
    if (n === to) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(out.get(n) || []));
  }
  return false;
}

function mutate(P, g, rng) {
  const c = P.cfg;
  if (rng() < c.weightMutate) for (const k of g.conns) {
    if (rng() < c.weightPerturb) k.w += randn(rng) * c.perturbPower;
    else k.w = (rng() * 2 - 1) * c.weightRange;
    k.w = Math.max(-8, Math.min(8, k.w));
  }
  if (rng() < c.addConn) {
    const from = g.nodes.filter(n => n.type !== 'out'), to = g.nodes.filter(n => n.type === 'hid' || n.type === 'out');
    for (let tries = 0; tries < 20; tries++) {
      const a = from[(rng() * from.length) | 0].id, b = to[(rng() * to.length) | 0].id;
      if (a === b || g.conns.some(k => k.in === a && k.out === b) || feedsInto(g, b, a)) continue;
      g.conns.push({ in: a, out: b, w: randn(rng) * 0.5, on: true, inn: innovation(P, a, b) });
      break;
    }
  }
  if (rng() < c.addNode) {
    const on = g.conns.filter(k => k.on);
    if (on.length) {
      const k = on[(rng() * on.length) | 0];
      k.on = false;
      const id = P.splits[k.inn] ?? (P.splits[k.inn] = P.nextNode++);
      if (!g.nodes.some(n => n.id === id)) {
        g.nodes.push({ id, type: 'hid' });
        g.conns.push({ in: k.in, out: id, w: 1, on: true, inn: innovation(P, k.in, id) });
        g.conns.push({ in: id, out: k.out, w: k.w, on: true, inn: innovation(P, id, k.out) });
      } else k.on = true;
    }
  }
  if (rng() < c.toggle && g.conns.length) { const k = g.conns[(rng() * g.conns.length) | 0]; k.on = !k.on; }
  return g;
}

function crossover(a, b, rng) {
  const bi = new Map(b.conns.map(k => [k.inn, k]));
  const conns = a.conns.map(k => {
    const o = bi.get(k.inn), pick = o && rng() < 0.5 ? o : k;
    const on = (k.on && (!o || o.on)) || rng() > 0.75;
    return { ...pick, on };
  });
  const need = new Set(conns.flatMap(k => [k.in, k.out]));
  const nodes = a.nodes.filter(n => n.type !== 'hid' || need.has(n.id)).map(n => ({ ...n }));
  return { nodes, conns };
}

function distance(P, a, b) {
  const ai = new Map(a.conns.map(k => [k.inn, k])), bi = new Map(b.conns.map(k => [k.inn, k]));
  const maxA = Math.max(-1, ...ai.keys()), maxB = Math.max(-1, ...bi.keys()), cut = Math.min(maxA, maxB);
  let ex = 0, dis = 0, wd = 0, m = 0;
  for (const [inn, k] of ai) { const o = bi.get(inn); if (o) { m++; wd += Math.abs(k.w - o.w); } else if (inn > cut) ex++; else dis++; }
  for (const inn of bi.keys()) if (!ai.has(inn)) { if (inn > cut) ex++; else dis++; }
  const big = Math.max(a.conns.length, b.conns.length), N = big < 20 ? 1 : big;
  return (P.cfg.c1 * ex + P.cfg.c2 * dis) / N + P.cfg.c3 * (m ? wd / m : 0);
}

function speciate(P) {
  for (const s of P.species) s.members = [];
  for (const g of P.genomes) {
    const s = P.species.find(s => distance(P, g, s.rep) < P.cfg.threshold);
    if (s) s.members.push(g);
    else P.species.push({ id: P.nextSpecies++, rep: clone(g), members: [g], best: -Infinity, stale: 0 });
  }
  P.species = P.species.filter(s => s.members.length);
  P.cfg.threshold = Math.max(0.05, P.cfg.threshold + (P.species.length > P.cfg.targetSpecies ? 0.1 : P.species.length < P.cfg.targetSpecies ? -0.1 : 0));
}

export function evolve(P, rng = Math.random) {
  const c = P.cfg;
  speciate(P);
  for (const g of P.genomes) if (!P.best || g.fitness > P.best.fitness) P.best = { ...clone(g), fitness: g.fitness, gen: P.gen };
  for (const s of P.species) {
    s.members.sort((x, y) => y.fitness - x.fitness);
    const top = s.members[0].fitness;
    if (top > s.best) { s.best = top; s.stale = 0; } else s.stale++;
    s.adj = s.members.reduce((n, g) => n + g.fitness, 0) / s.members.length;
  }
  P.species.sort((x, y) => y.best - x.best);
  P.species = P.species.filter((s, i) => i < 2 || s.stale < c.stagnation);
  const lo = Math.min(...P.species.map(s => s.adj)), total = P.species.reduce((n, s) => n + s.adj - lo + 1e-6, 0);
  const next = [];
  for (const s of P.species) {
    let n = Math.round(((s.adj - lo + 1e-6) / total) * c.popSize);
    const parents = s.members.slice(0, Math.max(1, Math.ceil(s.members.length * c.survival)));
    if (s.members.length >= 5) for (let e = 0; e < c.elitism && n > 0; e++, n--) next.push(clone(s.members[e]));
    for (; n > 0; n--) {
      const a = parents[(rng() * parents.length) | 0];
      let child;
      if (rng() < c.crossover && parents.length > 1) {
        const b = parents[(rng() * parents.length) | 0];
        child = crossover(a.fitness >= b.fitness ? a : b, a.fitness >= b.fitness ? b : a, rng);
      } else child = clone(a);
      next.push(mutate(P, child, rng));
    }
    s.rep = clone(s.members[(rng() * s.members.length) | 0]);
  }
  while (next.length < c.popSize) next.push(mutate(P, clone(P.best), rng));
  P.genomes = next.slice(0, c.popSize);
  P.gen++;
  return P;
}

export const savePopulation = P => JSON.stringify({ ...P, species: P.species.map(s => ({ ...s, members: [] })) });
export const loadPopulation = text => JSON.parse(text);
