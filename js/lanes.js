// Lane geometry. Every movement is a "piece": a cubic Bezier a car follows (road tile traversal,
// house driveway, parking-lot entry/exit). Traffic is US right-hand: lanes sit LANE to the car's right.
export const DIR = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W (screen coords, y down)
export const OPP = [2, 3, 0, 1];
export const LANE = 0.115;       // lane centre offset from road centre
export const CAR_LEN = 0.34;
export const rt = v => [-v[1], v[0]];                   // right-hand side of heading v
const mad = (a, d, k) => [a[0] + d[0] * k, a[1] + d[1] * k];

const cache = new Map();
export const clearPieceCache = () => cache.clear();

function bez(p0, c1, c2, p3, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1]];
}

function make(key, kind, p0, c1, c2, p3, extra) {
  const lut = [0], xy = [p0];
  let prev = p0, len = 0;
  const SEG = 16;
  for (let i = 1; i <= SEG; i++) {
    const q = bez(p0, c1, c2, p3, i / SEG);
    len += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
    lut.push(len); xy.push(q); prev = q;
  }
  const p = { key, kind, pts: [p0, c1, c2, p3], len, lut, xy, turn: 'straight', lanes: 2, ...extra };
  cache.set(key, p);
  return p;
}

function line(key, kind, p0, p3, extra) {
  const d = [(p3[0] - p0[0]) / 3, (p3[1] - p0[1]) / 3];
  return make(key, kind, p0, mad(p0, d, 1), mad(p0, d, 2), p3, extra);
}

// Position + heading angle at distance s along a piece.
export function pointAt(p, s, out) {
  s = Math.max(0, Math.min(p.len, s));
  const lut = p.lut;
  let i = 0;
  while (i < lut.length - 2 && lut[i + 1] < s) i++;
  const seg = lut[i + 1] - lut[i];
  const t = (i + (seg > 0 ? (s - lut[i]) / seg : 0)) / (lut.length - 1);
  const [p0, c1, c2, p3] = p.pts;
  const q = bez(p0, c1, c2, p3, t), u = 1 - t;
  const dx = 3 * u * u * (c1[0] - p0[0]) + 6 * u * t * (c2[0] - c1[0]) + 3 * t * t * (p3[0] - c2[0]);
  const dy = 3 * u * u * (c1[1] - p0[1]) + 6 * u * t * (c2[1] - c1[1]) + 3 * t * t * (p3[1] - c2[1]);
  out.x = q[0]; out.y = q[1]; out.a = Math.atan2(dy, dx);
  return out;
}

// Car crosses road tile (x,y) entering from side `inS`, leaving through side `outS`.
export function roadPiece(x, y, inS, outS) {
  const key = `r:${x},${y}:${inS}>${outS}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = [x + 0.5, y + 0.5];
  const h0 = [-DIR[inS][0], -DIR[inS][1]], h1 = DIR[outS];
  const p0 = mad(mad(c, DIR[inS], 0.5), rt(h0), LANE);
  const p3 = mad(mad(c, h1, 0.5), rt(h1), LANE);
  const extra = { tx: x, ty: y, in: inS, out: outS };
  if (outS === OPP[inS]) return line(key, 'road', p0, p3, extra);
  const dot = (p3[0] - p0[0]) * h0[0] + (p3[1] - p0[1]) * h0[1];
  const q = mad(p0, h0, dot);
  const right = h0[0] * h1[1] - h0[1] * h1[0] > 0;
  const k = 2 / 3;
  return make(key, 'road', p0, mad(p0, [q[0] - p0[0], q[1] - p0[1]], k), mad(p3, [q[0] - p3[0], q[1] - p3[1]], k), p3,
    { ...extra, turn: right ? 'right' : 'left' });
}

// Driveway from the house body out to the road (house tile x,y facing rot).
export function houseOutPiece(x, y, rot) {
  const key = `ho:${x},${y}:${rot}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = [x + 0.5, y + 0.5], D = DIR[rot];
  return line(key, 'house_out', mad(mad(c, D, 0.14), rt(D), LANE), mad(mad(c, D, 0.5), rt(D), LANE),
    { tx: x, ty: y, rot });
}

export function houseInPiece(x, y, rot) {
  const key = `hi:${x},${y}:${rot}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = [x + 0.5, y + 0.5], D = DIR[rot], h = [-D[0], -D[1]];
  return line(key, 'house_in', mad(mad(c, D, 0.5), rt(h), LANE), mad(mad(c, D, 0.14), rt(h), LANE),
    { tx: x, ty: y, rot });
}

// ---- Parking lot: one connected space (2 tiles x 2 bays). Any entrance reaches any bay. ----
// Building top-left (bx,by) facing rot. Lot tile i (0|1) centre; i grows along the building's local +y.
export function lotCenter(bx, by, rot, i) {
  const X = DIR[rot], T = rt(X);
  return [bx + 1 + X[0] * 0.5 + T[0] * (i - 0.5), by + 1 + X[1] * 0.5 + T[1] * (i - 0.5)];
}

// Bay k (0..3): tile k>>1, bay k&1 within that tile. Cars park nose-in.
export function slotPos(bx, by, rot, k) {
  const X = DIR[rot], T = rt(X), c = lotCenter(bx, by, rot, k >> 1);
  return mad(mad(c, T, k & 1 ? 0.2 : -0.2), X, -0.1);        // parked a bit deep so the aisle stays clear
}

// Drive in through entrance `ent` and park in bay k.
export function lotInPiece(bx, by, rot, ent, k) {
  const key = `li:${bx},${by}:${rot}:${ent}>${k}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const X = DIR[rot], T = rt(X), h = [-X[0], -X[1]];
  const ce = lotCenter(bx, by, rot, ent);
  const p0 = mad(mad(ce, X, 0.5), T, -LANE), slot = slotPos(bx, by, rot, k);
  // Same side: a short curve into the bay. Other side: stay out in the aisle (clear of parked noses), then turn in.
  const near = (k >> 1) === ent;
  return make(key, 'lot_in', p0, mad(p0, h, near ? 0.22 : 0.16), mad(slot, h, near ? -0.22 : -0.42), slot,
    { tx: Math.floor(ce[0]), ty: Math.floor(ce[1]), bx, by, rot, ent });
}

// Pull out of bay k and leave through entrance `ent`.
export function lotOutPiece(bx, by, rot, k, ent) {
  const key = `lo:${bx},${by}:${rot}:${k}>${ent}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const X = DIR[rot], T = rt(X);
  const ce = lotCenter(bx, by, rot, ent);
  const slot = slotPos(bx, by, rot, k), p3 = mad(mad(ce, X, 0.5), T, LANE);
  const near = (k >> 1) === ent;
  return make(key, 'lot_out', slot, mad(slot, X, near ? 0.27 : 0.42), mad(p3, X, near ? -0.25 : -0.16), p3,
    { tx: Math.floor(ce[0]), ty: Math.floor(ce[1]), bx, by, rot, ent });
}
