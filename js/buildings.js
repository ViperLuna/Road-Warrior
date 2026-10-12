// Houses (1 tile) and destinations (2x2: building half + 2-tile parking lot). Each has one exit side `rot` (0=N,1=E,2=S,3=W).
import { DIR, rt } from './lanes.js';
import { tidx } from './network.js';

export const SLOTS = 4;
// A destination has a single entrance. It is written as `ent` = tile + 2 * code:
//   tile (0|1)  which lot tile it sits on (tile 0 is the building's -T end of the lot, tile 1 the +T end; T = a clockwise quarter turn from the front)
//   code        0 = the front (the road side), 1 = the -T end of the lot, 2 = the +T end
// A big (double) destination can use ent 0, 1 (front, either tile), 5 (+T end, on tile 1) and 2 (-T end, on tile 0): 4 choices.
// A SMALL destination is one half of that 2x2 box: its building tile, its lot tile and 2 bays. Its lot tile is `half` (0 or 1), the other half
// of the box is plain free ground, and it has 3 choices: the front (half), its +T side (half + 4) and its -T side (half + 2).
// All the lot geometry is shared between the two.
// Older saves have `gate` (0|1) = the front entrance on that tile, which is the same as ent 0|1.
export function entOf(b) {
  if (b.small) { const h = b.half ? 1 : 0, e = b.ent ?? h; return (e & 1) === h ? e : h; }
  return b.ent ?? (b.gate ? 1 : 0);
}
export const gateOf = b => entOf(b) & 1;                                                           // the lot tile the entrance is on
export const entCode = ent => ent >> 1;
export const entSide = (rot, ent) => (ent >> 1 === 0 ? rot : ent >> 1 === 1 ? (rot + 3) % 4 : (rot + 1) % 4);   // which way the entrance faces (a DIR index)
// The entrances a destination can use, in the order tapping its lot cycles through them: clockwise round the lot, the same
// way a building turns.
export const entrancesOf = b => (b.small ? [entOf(b) & 1, (entOf(b) & 1) + 4, (entOf(b) & 1) + 2] : [0, 1, 5, 2]);
export const baysOf = b => (b.small ? [2 * gateOf(b), 2 * gateOf(b) + 1] : [0, 1, 2, 3]);      // the parking bays a destination really has
export const destWeight = b => (b.small ? 0.5 : 1);                                              // its share of a normal destination's capacity

// The road tile just outside entrance `ent` of destination (or box) b: where the road must reach.
export function exitTile(b, ent = entOf(b)) {
  const [lx, ly] = lotTile(b, ent & 1), D = DIR[entSide(b.rot, ent)];
  return [lx + D[0], ly + D[1]];
}

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
      const ent = entOf(b), i = ent & 1, [x, y] = lotTile(b, i);
      g.ports.set(tidx(g, x, y), { b, x, y, side: entSide(b.rot, ent), kind: 'lot', lot: i, ent });
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
