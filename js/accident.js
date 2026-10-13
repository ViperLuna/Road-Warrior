// Road accidents. After a while (milestones.accidents.afterTrips) two cars that are close together on a plain road tile bump:
// both stop dead (one knocked to a slant), police show up, and after durationSeconds everything clears and the cars drive on.
// The wreck blocks its lane like any stopped car, so traffic behind it queues and its patience keeps running: that is the point.
import { tuning } from './tuning.js';
import { milestones } from './progression.js';

const rand = (a, b) => a + Math.random() * (b - a);

export function resetAccidents(g) { g.accident = null; g.nextAccidentAt = undefined; for (const c of g.cars) c.crash = false; }

// Two moving cars on one plain road piece (not a junction, lot, driveway, overpass or tunnel), both rolling: the rear one hits the front one.
function findPair(g) {
  const { minSpeed } = tuning.accidents, pairs = [];
  const byPiece = new Map();
  for (const c of g.cars) {
    if ((c.state !== 'out' && c.state !== 'back') || c.crash || c.inJ || c.v < minSpeed) continue;
    const p = c.route[c.idx], nx = c.route[c.idx + 1];
    if (!p || p.kind !== 'road' || p.under || (nx && nx.under)) continue;
    const road = g.roads.get(p.ty * g.cols + p.tx);
    if (!road || road.tunnel || road.special || road.bridge) continue;
    (byPiece.get(p) || byPiece.set(p, []).get(p)).push(c);
  }
  for (const [p, list] of byPiece) {
    list.sort((a, b) => a.s - b.s);
    for (let i = 1; i < list.length; i++) pairs.push([list[i - 1], list[i]]);       // [rear, front] on one piece
    for (const rear of list) {                                                     // or the rear car just behind a front car on its next piece
      const nx = rear.route[rear.idx + 1], ahead = nx && byPiece.get(nx);
      if (ahead) for (const front of ahead) if (front.route[front.idx] === nx && (p.len - rear.s) + front.s < tuning.accidents.closeTiles) pairs.push([rear, front]);
    }
  }
  return pairs.length ? pairs[(Math.random() * pairs.length) | 0] : null;
}

function startAccident(g, rear, front, notify) {
  const slant = (Math.random() < 0.5 ? -1 : 1) * rand(0.35, 0.6);
  front.a += slant; rear.a -= slant * 0.4;                             // the front car is knocked askew, the rear one a little
  for (const c of [rear, front]) { c.crash = true; c.v = 0; c.stuck = 0; }
  const mx = (rear.x + front.x) / 2, my = (rear.y + front.y) / 2, h = front.a - slant;
  const tx = Math.cos(h), ty = Math.sin(h), nx = -ty, ny = tx;
  g.accident = {
    cars: [rear, front], left: tuning.accidents.durationSeconds, age: 0, x: mx, y: my,
    police: [ { x: mx - tx * 0.3 + nx * 0.2, y: my - ty * 0.3 + ny * 0.2, a: h + 0.35 }, { x: mx + tx * 0.34 + nx * 0.14, y: my + ty * 0.34 + ny * 0.14, a: h - 0.25 } ],
  };
  notify({ type: 'accident', x: mx, y: my });
}

// Called every tick while playing.
export function stepAccidents(g, dt, notify) {
  const cfg = tuning.accidents, a = g.accident;
  if (a) {
    a.age += dt; a.left -= dt;
    if (a.left <= 0) {
      for (const c of a.cars) { c.crash = false; c.stuck = 0; }
      g.accident = null;
      const k = Math.min(1, Math.max(0, (g.trips - milestones.accidents.afterTrips) / cfg.rampTrips));
      g.nextAccidentAt = g.time + rand(cfg.minGapSeconds, cfg.maxGapSeconds) * (1 - cfg.rampShrink * k);
      notify({ type: 'cleared' });
    }
    return;
  }
  if (g.trips < milestones.accidents.afterTrips) return;
  if (g.nextAccidentAt === undefined) g.nextAccidentAt = g.time + cfg.firstDelaySeconds + rand(0, cfg.firstDelaySeconds);
  if (g.time < g.nextAccidentAt) return;
  const pair = findPair(g);
  if (pair) startAccident(g, pair[0], pair[1], notify);
  else g.nextAccidentAt = g.time + 2;                                  // nobody close enough right now: look again shortly
}
