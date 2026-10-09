// Road network queries over the game state: connections, ports (building driveways), piece validity.
import { DIR, OPP } from './lanes.js';

export const tidx = (g, x, y) => y * g.cols + x;
export const inB = (g, x, y) => x >= 0 && y >= 0 && x < g.cols && y < g.rows;
export const roadAt = (g, x, y) => inB(g, x, y) && g.roads.has(tidx(g, x, y));
export const portAt = (g, x, y) => (inB(g, x, y) ? g.ports.get(tidx(g, x, y)) || null : null);

// Sides of road tile (x,y) that connect to a neighbouring road or to a building port facing it.
export function roadConns(g, x, y) {
  const res = [];
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR[d][0], ny = y + DIR[d][1];
    if (roadAt(g, nx, ny)) res.push(d);
    else { const p = portAt(g, nx, ny); if (p && p.side === OPP[d]) res.push(d); }
  }
  return res;
}

// Is road tile (x,y) a working roundabout (a roundabout piece placed on a tile that still has 3+ connections)?
export function roundAt(g, x, y) {
  const r = g.roads.get(tidx(g, x, y));
  return !!r && r.special === 'roundabout' && roadConns(g, x, y).length >= 3;
}

// A piece is "live" if the map still supports it. Dead pieces still carry cars (ghosts).
export function pieceValid(g, p) {
  if (p.kind === 'road') {
    if (!roadAt(g, p.tx, p.ty)) return false;
    const c = roadConns(g, p.tx, p.ty);
    return c.includes(p.in) && c.includes(p.out) && !!p.round === roundAt(g, p.tx, p.ty);
  }
  const b = g.buildingAt.get(tidx(g, p.tx, p.ty));
  return !!b && b.rot === p.rot;
}
