import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGame, root } from './load.mjs';

const BRAINS = join(root, 'brains'), OUT = join(root, 'sim/out/train');

function parseArgs(argv) {
  const a = { pop: 100, seeds: 3, maps: 'riverbend,lakeside,highlands', start: 900, step: 900, max: 7200, validate: 6, cutoff: 0.5, gens: 0, workers: availableParallelism(), fresh: false, set: [], watch: null, eval: null, games: 4, goal: 20000, look: null, seed: 1, map: 'riverbend', minutes: 30 };
  const nums = ['pop', 'seeds', 'start', 'step', 'max', 'validate', 'cutoff', 'gens', 'workers', 'seed', 'minutes', 'games', 'goal'];
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (k === 'fresh') { a.fresh = true; continue; }
    const v = argv[++i];
    if (k === 'set') a.set.push(v);
    else if (k in a) a[k] = nums.includes(k) ? Number(v) : v;
    else throw new Error('unknown option --' + k);
  }
  if (a.look) { const [every, horizon, k, cash] = a.look.split(',').map(Number); a.look = { every: every || 10, horizon: horizon || 60, k: k || 3, cash: cash ?? 0.02 }; }
  return a;
}

function playOne(G, B, file, seed, mapId, cap, { onDecision, look, goal = Infinity, pace = null } = {}) {
  const { mulberry32, state, maps } = G, g = state.game;
  Math.random = mulberry32((seed ^ 0x5eed1234) >>> 0);
  state.newGame(seed, maps.find(m => m.id === mapId));
  g.headless = true;
  const brain = B.createBrain(file, { onDecision, lookahead: look });
  const DT = 1 / 60, curve = [];
  let behind = false;
  while (g.mode !== 'over' && g.time < cap && g.trips < goal) {
    B.brainTick(g, brain);
    if (g.mode === 'reward') continue;
    state.tick(DT);
    if (g.time >= curve.length * 60) {
      const m = curve.push(g.trips) - 1;
      if (pace && m >= 10 && pace[m] !== undefined && g.trips < pace[m]) { behind = true; break; }
    }
  }
  return { seed, map: mapId, time: g.time, trips: g.trips, survived: g.mode !== 'over' && !behind, why: behind ? 'behind' : g.mode === 'over' ? (g.over && g.over.reason ? 'impatience' : 'gridlock') : g.trips >= goal ? 'goal' : 'cap', curve, actions: brain.stats.actions, lookaheads: brain.stats.lookaheads || 0, overruled: brain.stats.overruled || 0 };
}

const fitnessOf = rs => rs.reduce((n, r) => n + r.trips + r.time / 10, 0) / rs.length;

async function workerMain() {
  const G = await loadGame(workerData.set), B = await import('./brain.js');
  parentPort.on('message', job => {
    if (!job) return process.exit(0);
    try { parentPort.postMessage({ id: job.id, ...playOne(G, B, job.file, job.seed, job.map, job.cap, { look: job.look, goal: job.goal, pace: job.pace }) }); }
    catch (e) { parentPort.postMessage({ id: job.id, seed: job.seed, map: job.map, error: String(e.stack || e), time: 0, trips: 0, survived: false, why: 'crash' }); }
  });
  parentPort.postMessage({ ready: true });
}

function pool(n, set) {
  const workers = Array.from({ length: n }, () => new Worker(fileURLToPath(import.meta.url), { workerData: { set } }));
  const ready = Promise.all(workers.map(w => new Promise(r => w.once('message', r))));
  return {
    async run(jobs) {
      await ready;
      const out = new Array(jobs.length), queue = jobs.map((j, id) => ({ ...j, id }));
      await Promise.all(workers.map(w => new Promise(resolve => {
        const feed = () => { const j = queue.shift(); if (!j) { w.off('message', onMsg); return resolve(); } w.postMessage(j); };
        const onMsg = m => { out[m.id] = m; feed(); };
        w.on('message', onMsg);
        feed();
      })));
      return out;
    },
    close: () => workers.forEach(w => w.postMessage(null)),
  };
}

async function watch(opts) {
  const G = await loadGame(opts.set), B = await import('./brain.js');
  const file = JSON.parse(readFileSync(opts.watch, 'utf8'));
  const g = G.state.game, clock = () => `${String(Math.floor(g.time / 60)).padStart(2, ' ')}:${String(Math.floor(g.time % 60)).padStart(2, '0')}`;
  console.log(`brain from generation ${file.meta.gen} (cap ${file.meta.cap} s), seed ${opts.seed} on ${opts.map}`);
  const r = playOne(G, B, file, opts.seed, opts.map, opts.minutes * 60, { onDecision: text => console.log(`${clock()}  ${text}`), look: opts.look, goal: opts.goal });
  console.log(`\n${r.survived ? (r.why === 'goal' ? 'Reached the goal' : 'Survived') : 'Lost (' + r.why + ')'} at ${clock()} with ${r.trips} trips. Actions: ${JSON.stringify(r.actions)}${opts.look ? `  Lookaheads: ${r.lookaheads}, network overruled ${r.overruled} times` : ''}`);
}

async function evaluate(opts) {
  const file = JSON.parse(readFileSync(opts.eval, 'utf8')), maps = opts.maps.split(',');
  console.log(`brain from generation ${file.meta.gen}: ${opts.games} games per map, up to ${opts.minutes} min or ${opts.goal} trips${opts.look ? `, lookahead every ${opts.look.every}s over ${opts.look.horizon}s, top ${opts.look.k}, $1 = ${opts.look.cash} trips` : ''}`);
  const workers = pool(opts.workers, opts.set), t0 = Date.now();
  const jobs = maps.flatMap(map => Array.from({ length: opts.games }, (_, i) => ({ file, seed: 5e6 + i, map, cap: opts.minutes * 60, look: opts.look, goal: opts.goal })));
  const res = await workers.run(jobs);
  workers.close();
  for (const map of maps) {
    const rs = res.filter(r => r.map === map), trips = rs.map(r => r.trips).sort((a, b) => a - b);
    console.log(`${map.padEnd(10)} trips: mean ${(trips.reduce((a, b) => a + b, 0) / trips.length).toFixed(0)}, median ${trips[trips.length >> 1]}, best ${trips.at(-1)}  |  ` +
      `goal ${rs.filter(r => r.why === 'goal').length}, survived the cap ${rs.filter(r => r.why === 'cap').length}, gridlock ${rs.filter(r => r.why === 'gridlock').length}, impatience ${rs.filter(r => r.why === 'impatience').length}  |  mean ${(rs.reduce((n, r) => n + r.time, 0) / rs.length / 60).toFixed(0)} min`);
    const crashed = rs.find(r => r.error);
    if (crashed) console.warn(`  ${rs.filter(r => r.error).length} game(s) crashed. Seed ${crashed.seed}:`, crashed.error);
  }
  console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.watch) return watch(opts);
  if (opts.eval) return evaluate(opts);
  const { createPopulation, evolve, savePopulation, loadPopulation } = await import('./neat.js');
  const { INPUTS, BRAIN_VERSION } = await import('./brain.js');
  const { mulberry32 } = await import('../js/rng.js');
  mkdirSync(BRAINS, { recursive: true }); mkdirSync(OUT, { recursive: true });
  const ckpt = join(OUT, 'population.json'), log = join(OUT, 'history.jsonl');
  let P, run;
  if (!opts.fresh && existsSync(ckpt)) {
    ({ P, run } = loadPopulation(readFileSync(ckpt, 'utf8')));
    if (run.version !== BRAIN_VERSION) throw new Error(`the saved population was trained for brain version ${run.version}, this is version ${BRAIN_VERSION}: start over with --fresh`);
    console.log(`resuming at generation ${P.gen}, cap ${run.cap} s`);
  } else {
    P = createPopulation(INPUTS.length, 1, { popSize: opts.pop }, mulberry32(1));
    run = { cap: opts.start, bestVal: -Infinity, version: BRAIN_VERSION };
    writeFileSync(log, '');
  }
  const rng = mulberry32((P.gen * 7919 + 1) >>> 0), maps = opts.maps.split(',');
  const brainFile = (genome, meta) => ({ version: BRAIN_VERSION, inputs: INPUTS, genome: { nodes: genome.nodes, conns: genome.conns }, meta });
  const workers = pool(opts.workers, opts.set);
  let stop = false;
  process.on('SIGINT', () => { if (stop) process.exit(1); stop = true; console.log('\nstopping after this generation (Ctrl+C again to quit now)'); });

  while (!stop && (!opts.gens || P.gen < opts.gens)) {
    const t0 = Date.now(), seeds = Array.from({ length: opts.seeds }, (_, i) => ({ seed: P.gen * 1000 + i + 1, map: maps[(P.gen + i) % maps.length] }));
    const files = P.genomes.map(gn => brainFile(gn, {}));
    const paceOf = map => (opts.cutoff > 0 && run.pace && run.pace[map]) ? run.pace[map].map(t => t * opts.cutoff) : null;
    const res = await workers.run(files.flatMap(file => seeds.map(s => ({ file, ...s, cap: run.cap, pace: paceOf(s.map) }))));
    const crashed = res.find(r => r.error);
    if (crashed) console.warn('a game crashed:', crashed.error);
    P.genomes.forEach((gn, i) => { gn.results = res.slice(i * seeds.length, (i + 1) * seeds.length); gn.fitness = fitnessOf(gn.results); });
    const champ = P.genomes.reduce((a, b) => (b.fitness > a.fitness ? b : a));
    const val = await workers.run(Array.from({ length: opts.validate }, (_, i) => ({ file: brainFile(champ, {}), seed: 1e6 + P.gen * 100 + i, map: maps[i % maps.length], cap: run.cap })));
    const survived = val.filter(r => r.survived).length, valScore = fitnessOf(val);
    run.pace = {};
    for (const map of maps) {
      const curves = val.filter(r => r.map === map && r.curve).map(r => r.curve);
      const n = Math.max(0, ...curves.map(c => c.length));
      if (curves.length) run.pace[map] = Array.from({ length: n }, (_, m) => { const at = curves.filter(c => c.length > m).map(c => c[m]); return at.reduce((a, b) => a + b, 0) / at.length; });
    }
    const meta = { gen: P.gen, cap: run.cap, fitness: +champ.fitness.toFixed(1), validation: { games: val.length, survived, meanTime: +(val.reduce((n, r) => n + r.time, 0) / val.length).toFixed(0), meanTrips: +(val.reduce((n, r) => n + r.trips, 0) / val.length).toFixed(1) }, maps, nodes: champ.nodes.length, conns: champ.conns.filter(c => c.on).length, date: new Date().toISOString() };
    writeFileSync(join(BRAINS, 'latest.json'), JSON.stringify(brainFile(champ, meta)));
    if (valScore > run.bestVal) { run.bestVal = valScore; writeFileSync(join(BRAINS, 'best.json'), JSON.stringify(brainFile(champ, meta))); }
    const times = P.genomes.map(gn => gn.fitness).sort((a, b) => a - b);
    const line = { ...meta, median: +times[times.length >> 1].toFixed(1), stoppedEarly: res.filter(r => r.why === 'behind').length / res.length, ms: Date.now() - t0, actions: champ.results.reduce((m, r) => { for (const [k, v] of Object.entries(r.actions || {})) m[k] = (m[k] || 0) + v; return m; }, {}) };
    for (const gn of P.genomes) delete gn.results;
    evolve(P, rng);
    line.species = P.species.length;
    appendFileSync(log, JSON.stringify(line) + '\n');
    console.log(`gen ${meta.gen}  cap ${run.cap}s  best ${champ.fitness.toFixed(0)}  median ${line.median.toFixed(0)}  validation ${survived}/${val.length} survived (${meta.validation.meanTime}s, ${meta.validation.meanTrips} trips)  species ${line.species}  net ${meta.nodes}n/${meta.conns}c  stopped early ${(100 * line.stoppedEarly).toFixed(0)}%  ${(line.ms / 1000).toFixed(0)}s`);
    if (survived === val.length && run.cap < opts.max) {
      run.cap = Math.min(opts.max, run.cap + opts.step);
      run.bestVal = -Infinity;
      console.log(`  champion beat the cap every time: cap is now ${run.cap} s`);
    }
    writeFileSync(ckpt, JSON.stringify({ P: JSON.parse(savePopulation(P)), run }));
  }
  workers.close();
}

if (isMainThread) main(); else workerMain();
