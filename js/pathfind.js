// A* over (road tile, entry side) states. Returns the road tiles to cross and which port ends the trip.
import { DIR, OPP } from './lanes.js';
import { roadAt, roadConns, roundAt, portAt, tidx, overpassAxis } from './network.js';

class Heap {
  constructor() { this.f = []; this.v = []; }
  get size() { return this.v.length; }
  push(f, v) {
    const F = this.f, V = this.v; let i = F.length; F.push(f); V.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (F[p] <= f) break; F[i] = F[p]; V[i] = V[p]; i = p; }
    F[i] = f; V[i] = v;
  }
  pop() {
    const F = this.f, V = this.v, top = V[0], lf = F.pop(), lv = V.pop(), n = F.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && F[c + 1] < F[c]) c++;
        if (F[c] >= lf) break;
        F[i] = F[c]; V[i] = V[c]; i = c;
      }
      F[i] = lf; V[i] = lv;
    }
    return top;
  }
}

const turnCost = (inS, outS) => {
  if (outS === OPP[inS]) return 0;
  const h0 = [-DIR[inS][0], -DIR[inS][1]], h1 = DIR[outS];
  return h0[0] * h1[1] - h0[1] * h1[0] > 0 ? 0.15 : 0.3;   // right turns slightly cheaper than left
};

// start: road tile (sx,sy) entered from side sEntry. goalPorts: array of ports that end the trip.
export function findPath(g, sx, sy, sEntry, goalPorts) {
  if (!roadAt(g, sx, sy) || !goalPorts.length || g.roads.get(tidx(g, sx, sy)).cone) return null;      // (a coned tile is closed to new trips)
  const cells = g.cols * g.rows, NS = cells * 4;
  const goalTiles = new Map(goalPorts.map(p => [tidx(g, p.x, p.y), p]));
  const gs = new Float32Array(NS + cells).fill(Infinity);
  const parent = new Int32Array(NS + cells).fill(-1);
  const via = new Int8Array(NS + cells).fill(-1);
  const done = new Uint8Array(NS + cells);
  const h = (x, y) => { let m = Infinity; for (const p of goalPorts) m = Math.min(m, Math.abs(x - p.x) + Math.abs(y - p.y)); return m; };

  const heap = new Heap();
  const s0 = tidx(g, sx, sy) * 4 + sEntry;
  gs[s0] = 0;
  heap.push(h(sx, sy), s0);

  while (heap.size) {
    const id = heap.pop();
    if (done[id]) continue;
    done[id] = 1;
    if (id >= NS) {                      // goal node: walk parents back
      const steps = [];
      let goalId = id, cur = parent[id], out = via[id];
      const port = goalTiles.get(id - NS);
      while (cur !== -1) {
        const cell = cur >> 2;
        steps.push({ x: cell % g.cols, y: (cell / g.cols) | 0, in: cur & 3, out });
        out = via[cur]; cur = parent[cur];
      }
      steps.reverse();
      return { steps, port, cost: gs[goalId] };
    }
    const cell = id >> 2, inS = id & 3, x = cell % g.cols, y = (cell / g.cols) | 0;
    const noExit = (g.roads.get(cell) || {}).noExit || 0;                 // one-way streets: sides this tile may not be left through
    for (const e of roadConns(g, x, y)) {
      if (e === inS || (noExit >> e) & 1) continue;
      if (overpassAxis(g, x, y) >= 0 && e !== OPP[inS]) continue;           // an overpass has no turns
      const nx = x + DIR[e][0], ny = y + DIR[e][1];
      const cost = gs[id] + 1 + turnCost(inS, e) + (roundAt(g, x, y) ? 0.35 : 0);
      let nid = -1;
      if (roadAt(g, nx, ny)) { if (g.roads.get(tidx(g, nx, ny)).cone) continue; nid = tidx(g, nx, ny) * 4 + OPP[e]; }
      else {
        const p = portAt(g, nx, ny);
        if (p && p.side === OPP[e] && goalTiles.get(tidx(g, nx, ny)) === p) nid = NS + tidx(g, nx, ny);
      }
      if (nid < 0 || cost >= gs[nid]) continue;
      gs[nid] = cost; parent[nid] = id; via[nid] = e;
      heap.push(cost + (nid >= NS ? 0 : h(nx, ny)), nid);
    }
  }
  return null;
}
