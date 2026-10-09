// Houses (1 tile) and destinations (2x2: building half + 2-tile parking lot). Each has one exit side `rot` (0=N,1=E,2=S,3=W).
import { DIR, rt } from './lanes.js';
import { tidx } from './network.js';

export const SLOTS = 4;
export const LOT_GATES = 1;

export function footprint(b) {
  return b.kind === 'house' ? [[b.x, b.y]] : [[b.x, b.y], [b.x + 1, b.y], [b.x, b.y + 1], [b.x + 1, b.y + 1]];
}

// Lot tile i (0|1); i increases along the building's local +y so geometry is the same for every rotation.
export function lotTile(b, i) {
  const X = DIR[b.rot], T = rt(X), cx = b.x + 1, cy = b.y + 1;
  return [Math.floor(cx + X[0] * 0.5 + T[0] * (i - 0.5)), Math.floor(cy + X[1] * 0.5 + T[1] * (i - 0.5))];
}

export function reindex(g) {
  g.buildingAt = new Map();
  g.ports = new Map();
  for (const b of g.buildings) {
    for (const [x, y] of footprint(b)) g.buildingAt.set(tidx(g, x, y), b);
    if (b.kind === 'house') g.ports.set(tidx(g, b.x, b.y), { b, x: b.x, y: b.y, side: b.rot, kind: 'house', lot: 0 });
    else for (let i = 0; i < LOT_GATES; i++) {       // a destination has a single gate (lot tile 0); the second lot tile is just parking
      const [x, y] = lotTile(b, i);
      g.ports.set(tidx(g, x, y), { b, x, y, side: b.rot, kind: 'lot', lot: i });
    }
  }
}

export function addBuilding(g, kind, color, x, y, rot) {
  const b = { id: g.nextId++, kind, color, x, y, rot, born: g.time, slots: kind === 'dest' ? new Array(SLOTS).fill(null) : null };
  g.buildings.push(b);
  reindex(g);
  return b;
}

export function rotateBuilding(g, b) {
  b.rot = (b.rot + 1) % 4;
  reindex(g);
}
