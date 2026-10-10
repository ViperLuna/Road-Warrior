
//   node sim/run.mjs --games 1000 [--map riverbend|lakeside|highlands|all] [--minutes 30] [--seed 1] [--reward smart|cash|special] [--workers 12] [--out sim/out/run.jsonl] [--set tuning.gridlock.gameOverAfterSeconds=60] [--set progression.economy.roadCost=3]
//   node sim/run.mjs --replay <seed> --map riverbend

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const a = { games: 100, map: 'riverbend', minutes: 30, seed: 1, reward: 'smart', workers: availableParallelism(), out: null, set: [], replay: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, ''), v = argv[++i];
    if (k === 'set') a.set.push(v);
    else if (k in a) a[k] = ['games', 'minutes', 'seed', 'workers', 'replay'].includes(k) ? Number(v) : v;
    else throw new Error('unknown option --' + k);
  }
  return a;
}

async function loadGame(overrides) {
  const { mulberry32 } = await import('../js/rng.js');
  const state = await import('../js/state.js');
  const { setTuning, tuning } = await import('../js/tuning.js');
  const { setProgression, setMaps, maps, prog } = await import('../js/progression.js');
  const bot = await import('./bot.js');
  const json = f => JSON.parse(readFileSync(join(root, 'config', f), 'utf8'));
  state.setPalette(json('colors.json').colors);
  setTuning(json('tuning.json')); setProgression(json('progression.json')); setMaps(json('maps.json'));
  for (const s of overrides) {
    const [path, raw] = s.split('='), keys = path.split('.');
    let o = keys[0] === 'tuning' ? tuning : keys[0] === 'progression' ? prog : null;
    if (!o) throw new Error('--set must start with tuning. or progression.');
    for (const k of keys.slice(1, -1)) o = o[k];
    o[keys.at(-1)] = JSON.parse(raw);
  }
  return { mulberry32, state, tuning, maps, bot };
}

function describeJunction(J) {
  if (!J) return 'none';
  if (J.kind === 'lot') return 'lot';
  return J.round ? 'roundabout' : J.light ? 'light' : J.taper ? 'taper' : J.n + '-way';
}

function playGame(G, seed, mapId, opts) {
  const { mulberry32, state, tuning, maps, bot: B } = G, g = state.game;
  const map = maps.find(m => m.id === mapId);
  Math.random = mulberry32((seed ^ 0x5eed1234) >>> 0);
  state.newGame(seed, map);
  const bot = B.createBot({ reward: opts.reward });
  const ev = { spawns: 0, spawnAcross: 0, newColors: 0 };
  G.onEvent = e => { if (e.type === 'spawn') { ev.spawns++; if (e.across) ev.spawnAcross++; if (e.kind === 'newColor') ev.newColors++; } };

  const DT = 1 / 60, maxT = opts.minutes * 60, warnAt = tuning.gridlock.warnAfterSeconds;
  const tripsAtMin = [], goalTimes = [];
  let nextSample = 1, unconnectedHouseSec = 0, warnings = 0, warning = false, worstStuckSurvived = 0, peakCars = 0, lastGoals = 0;
  const t0 = performance.now();
  while (g.mode !== 'over' && g.time < maxT) {
    B.botTick(g, bot);
    if (g.mode === 'reward') continue;
    state.tick(DT);
    if (g.goalCount > lastGoals) { lastGoals = g.goalCount; goalTimes.push(Math.round(g.time)); }
    if (g.time >= nextSample) {
      nextSample++;
      const worst = g.cars.reduce((m, c) => Math.max(m, c.stuck), 0);
      if (worst >= warnAt && !warning) warnings++;
      warning = worst >= warnAt;
      if (worst < tuning.gridlock.gameOverAfterSeconds) worstStuckSurvived = Math.max(worstStuckSurvived, worst);
      unconnectedHouseSec += g.buildings.filter(b => b.kind === 'house' && !b.connected).length;
      peakCars = Math.max(peakCars, g.cars.filter(c => c.state === 'out' || c.state === 'back').length);
      if (nextSample % 60 === 1) tripsAtMin.push(g.trips);
    }
  }
  const houses = g.buildings.filter(b => b.kind === 'house');
  const rec = {
    seed, map: mapId, end: g.mode === 'over' ? 'gridlock' : 'timeout', time: Math.round(g.time), trips: g.trips, money: g.money,
    houses: houses.length, dests: g.buildings.filter(b => b.kind === 'dest').length, colors: g.colorsUsed,
    unconnectedAtEnd: houses.filter(h => !h.connected).length, unconnectedHouseSec, roads: g.roads.size,
    goals: g.goalCount, goalTimes, tripsAtMin, warnings, worstStuckSurvived: +worstStuckSurvived.toFixed(1), peakCarsMoving: peakCars,
    ...ev, bot: bot.stats, ms: Math.round(performance.now() - t0),
  };
  if (rec.end === 'gridlock') {
    const c = g.cars.reduce((a, b) => (b.stuck > a.stuck ? b : a));
    const r = c.route[c.idx];
    rec.cause = { why: (c.why || 'queue').split(':')[0], junction: describeJunction(c.entry && c.entry.J), state: c.state, tile: r && r.tx !== undefined ? [r.tx, r.ty] : null, carsStuck10s: g.cars.filter(x => x.stuck > 10).length };
  }
  return rec;
}

async function workerMain() {
  const G = await loadGame(workerData.opts.set);
  G.state.onEvent(e => G.onEvent && G.onEvent(e));
  parentPort.on('message', job => {
    if (!job) return process.exit(0);
    try { parentPort.postMessage(playGame(G, job.seed, job.map, workerData.opts)); }
    catch (e) { parentPort.postMessage({ seed: job.seed, map: job.map, error: String(e.stack || e) }); }
  });
  parentPort.postMessage({ ready: true });
}

const pct = (arr, p) => { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = arr => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
const tally = arr => Object.entries(arr.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');

export function summarise(recs, opts) {
  const lines = [];
  const say = s => lines.push(s);
  const byMap = Object.groupBy(recs.filter(r => !r.error), r => r.map);
  const errors = recs.filter(r => r.error);
  for (const [map, rs] of Object.entries(byMap)) {
    const over = rs.filter(r => r.end === 'gridlock'), n = rs.length;
    const p = over.length / n, ci = 1.96 * Math.sqrt(p * (1 - p) / n);
    const f = (k, arr = rs) => { const v = arr.map(r => r[k]); return `mean ${mean(v).toFixed(1)}, p10 ${pct(v, 0.1)}, median ${pct(v, 0.5)}, p90 ${pct(v, 0.9)}`; };
    say(`\n${map}: ${n} games, ${opts.minutes} min cap, reward policy '${opts.reward}'`);
    say(`Game over (gridlock): ${over.length} / ${n} = ${(100 * p).toFixed(1)}% (±${(100 * ci).toFixed(1)}%)`);
    if (over.length) {
      say(`time of game over (s): ${f('time', over)}`);
      say(`cause (wait rule): ${tally(over.map(r => r.cause.why))}`);
      say(`cause (junction): ${tally(over.map(r => r.cause.junction))}`);
      say(`cars stuck >10s at the end: ${f('carsStuck10s', over.map(r => r.cause))}`);
    }
    say(`Trips: ${f('trips')}`);
    say(`Houses: ${f('houses')}`);
    say(`Colours used: ${f('colors')}`);
    say(`Roads on map: ${f('roads')}`);
    say(`Money at end: ${f('money')}`);
    say(`Goals reached: ${f('goals')}`);
    say(`Warnings (gold): ${f('warnings')}  | games with ≥1 warning: ${rs.filter(r => r.warnings).length}`);
    say(`Peak cars moving: ${f('peakCarsMoving')}`);
    say(`Houses the bot never connected (at end): ${f('unconnectedAtEnd')}`);
    const mins = Math.max(...rs.map(r => r.tripsAtMin.length));
    const curve = [];
    for (let m = 0; m < mins; m += 5) {
      const alive = rs.filter(r => r.tripsAtMin.length > m);
      curve.push(`${m + 1}m: ${pct(alive.map(r => r.tripsAtMin[m]), 0.5)} (${alive.length} alive)`);
    }
    say(`Median trips over time: ${curve.join(' | ')}`);
    const firstGoals = [1, 3, 5, 10].map(k => { const t = rs.map(r => r.goalTimes[k - 1]).filter(x => x !== undefined); return `goal ${k}: ${t.length ? pct(t, 0.5) + 's' : '-'} (${t.length})`; });
    say(`Median time to: ${firstGoals.join(' | ')}`);
    say(`Specials taken: ${tally(rs.flatMap(r => Object.entries(r.bot.specialsTaken).flatMap(([k, v]) => Array(v).fill(k)))) || 'none'}`);
    say(`Specials placed: ${tally(rs.flatMap(r => Object.entries(r.bot.placed).flatMap(([k, v]) => Array(v).fill(k)))) || 'none'}`);
    say(`Bought in shop: ${tally(rs.flatMap(r => Object.entries(r.bot.bought).flatMap(([k, v]) => Array(v).fill(k)))) || 'none'}`);
    say(`Spawns: mean ${mean(rs.map(r => r.spawns)).toFixed(1)}, across water ${mean(rs.map(r => r.spawnAcross)).toFixed(1)}`);
    say(`Wall time per game: median ${pct(rs.map(r => r.ms), 0.5)} ms, max ${Math.max(...rs.map(r => r.ms))} ms`);
  }
  if (errors.length) say(`\n${errors.length} games crashed. First: seed ${errors[0].seed} ${errors[0].map}\n${errors[0].error}`);
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.replay !== null) {
    const G = await loadGame(opts.set);
    G.state.onEvent(e => G.onEvent && G.onEvent(e));
    console.log(JSON.stringify(playGame(G, opts.replay, opts.map === 'all' ? 'riverbend' : opts.map, opts), null, 1));
    return;
  }
  const mapIds = opts.map === 'all' ? JSON.parse(readFileSync(join(root, 'config/maps.json'), 'utf8')).maps.map(m => m.id) : [opts.map];
  const jobs = [];
  for (const map of mapIds) for (let i = 0; i < opts.games; i++) jobs.push({ seed: opts.seed + i, map });
  const out = opts.out || join(root, 'sim/out', `run-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, '');
  const recs = [], total = jobs.length, start = Date.now();
  let done = 0;
  await new Promise(resolve => {
    let live = Math.min(opts.workers, total);
    for (let w = 0; w < live; w++) {
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { opts } });
      const feed = () => worker.postMessage(jobs.shift() || null);
      worker.on('message', m => {
        if (!m.ready) {
          recs.push(m); appendFileSync(out, JSON.stringify(m) + '\n'); done++;
          if (done % 50 === 0 || done === total) process.stderr.write(`\r${done}/${total} games, ${((Date.now() - start) / 1000).toFixed(0)} s`);
        }
        feed();
      });
      worker.on('exit', () => { if (--live === 0) resolve(); });
      worker.on('error', e => { console.error(e); });
    }
  });
  process.stderr.write('\n');
  const text = summarise(recs, opts);
  console.log(text);
  writeFileSync(out.replace(/\.jsonl$/, '.summary.txt'), text + '\n');
  console.log(`\nPer-game records: ${out}`);
}

if (isMainThread) main(); else workerMain();
