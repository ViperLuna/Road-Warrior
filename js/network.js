// Road network queries over the game state: connections, ports (building driveways), piece validity.
import { DIR, OPP } from './lanes.js';

export const tidx = (g, x, y) => y * g.cols + x;
export const inB = (g, x, y) => x >= 0 && y >= 0 && x < g.cols && y < g.rows;
export const roadAt = (g, x, y) => inB(g, x, y) && g.roads.has(tidx(g, x, y));
export const portAt = (g, x, y) => (inB(g, x, y) ? g.ports.get(tidx(g, x, y)) || null : null);

// How many lanes a tile has (2 = street, 4 = highway), and how many its edge on `side` has: the smaller of the two
// neighbours' counts, and 2 where it meets a driveway or gate. A highway tile therefore tapers inside itself.
export const tileLanes = (g, x, y) => (g.roads.get(tidx(g, x, y)) || {}).lanes || 2;
export function edgeLanes(g, x, y, side) {
  const t = tileLanes(g, x, y), nx = x + DIR[side][0], ny = y + DIR[side][1];
  return roadAt(g, nx, ny) ? Math.min(t, tileLanes(g, nx, ny)) : 2;
}

// Sides of road tile (x,y) that connect to a neighbouring road or to a building port facing it.
export function roadConns(g, x, y) {
  const res = [], cut = (g.roads.get(tidx(g, x, y)) || {}).cut || 0;       // cut seams: the two road tiles touch but do not connect
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR[d][0], ny = y + DIR[d][1];
    if (roadAt(g, nx, ny)) { if (!((cut >> d) & 1)) res.push(d); }
    else { const p = portAt(g, nx, ny); if (p && p.side === OPP[d]) res.push(d); }
  }
  return res;
}

// Is road tile (x,y) a working roundabout (a roundabout piece placed on a tile that still has 3+ connections)?
export function roundAt(g, x, y) {
  const r = g.roads.get(tidx(g, x, y));
  return !!r && r.special === 'roundabout' && roadConns(g, x, y).length >= 3;
}

// Overpass: a tile whose highway axis (0 = north/south, 1 = east/west) crosses a street without joining it.
export const axisOf = side => side % 2 === 0 ? 0 : 1;
export const overpassAxis = (g, x, y) => { const r = g.roads.get(tidx(g, x, y)); return r && r.overpass !== undefined ? r.overpass : -1; };

// A piece is "live" if the map still supports it. Dead pieces still carry cars (ghosts).
export function pieceValid(g, p) {
  if (p.kind === 'road') {
    if (!roadAt(g, p.tx, p.ty)) return false;
    const c = roadConns(g, p.tx, p.ty);
    if (!c.includes(p.in) || !c.includes(p.out) || !!p.round !== roundAt(g, p.tx, p.ty)) return false;
    if (p.round) return true;
    const ov = overpassAxis(g, p.tx, p.ty);
    if (ov >= 0 || p.under) {                                   // layered tile: straight movements only, on the right layer
      if (ov < 0 || p.out !== OPP[p.in] || !!p.under !== (axisOf(p.in) !== ov)) return false;
      return (p.tl ?? 2) === (p.under ? 2 : tileLanes(g, p.tx, p.ty)) && (p.ei ?? 2) === edgeLanes(g, p.tx, p.ty, p.in) && (p.eo ?? 2) === edgeLanes(g, p.tx, p.ty, p.out);
    }
    return (p.tl ?? 2) === tileLanes(g, p.tx, p.ty) && (p.ei ?? 2) === edgeLanes(g, p.tx, p.ty, p.in) && (p.eo ?? 2) === edgeLanes(g, p.tx, p.ty, p.out);
  }
  const b = g.buildingAt.get(tidx(g, p.tx, p.ty));
  return !!b && b.rot === p.rot;
}
