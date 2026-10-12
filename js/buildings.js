// Houses (1 tile) and destinations (2x2: building half + 2-tile parking lot). Each has one exit side `rot` (0=N,1=E,2=S,3=W).
import { DIR, rt } from './lanes.js';
import { tidx } from './network.js';

export const SLOTS = 4;
// A destination has a single gate: lot tile `gate` (0 or 1, the player can flip it); the other lot tile is just parking.
// A SMALL destination is one half of that 2x2 box: its building tile, its lot tile and 2 bays. Its gate is always that lot tile (`half`,
// 0 or 1), so it cannot be flipped, and the other half of the box is plain free ground. All the lot geometry is shared with the big one.
export const gateOf = b => (b.small ? (b.half ? 1 : 0) : (b.gate ? 1 : 0));
export const baysOf = b => (b.small ? [2 * gateOf(b), 2 * gateOf(b) + 1] : [0, 1, 2, 3]);      // the parking bays a destination really has
export const destWeight = b => (b.small ? 0.5 : 1);                                              // its share of a normal destination's capacity

// A destination takes cars of its own colour, and of its second colour if it is a two-colour destination (color2).
export const accepts = (d, colorId) => d.color.id === colorId || (!!d.color2 && d.color2.id === colorId);

export function footprint(b) {
  if (b.kind === 'house') return [[b.x, b.y]];
  if (b.small) { const [lx, ly] = lotTile(b, gateOf(b)), X = DIR[b.rot]; return [[lx, ly], [lx - X[0], ly - X[1]]]; }      // lot tile + the building tile behind it
  return [[b.x, b.y], [b.x + 1, b.y], [b.x, b.y + 1], [b.x + 1, b.y + 1]];
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
    else {
      const i = gateOf(b), [x, y] = lotTile(b, i);
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
