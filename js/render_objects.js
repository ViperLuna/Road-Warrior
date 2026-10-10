// Draws buildings, ghost pieces and cars (tile units, same transform as render.js).
import { DIR } from './lanes.js';
import { pieceValid } from './network.js';
import { tuning } from './tuning.js';

const ASPHALT = '#45494f', SHOULDER = '#2b2e33';
const rotAngle = rot => rot * Math.PI / 2 - Math.PI / 2;   // local +x points along the exit direction

function glyph(ctx, kind, r) {
  ctx.beginPath();
  if (kind === 'circle') ctx.arc(0, 0, r, 0, 6.2832);
  else if (kind === 'square') ctx.rect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7);
  else if (kind === 'triangle') { ctx.moveTo(0, -r); ctx.lineTo(r * 0.95, r * 0.75); ctx.lineTo(-r * 0.95, r * 0.75); ctx.closePath(); }
  else { ctx.moveTo(0, -r * 1.1); ctx.lineTo(r, 0); ctx.lineTo(0, r * 1.1); ctx.lineTo(-r, 0); ctx.closePath(); }
  ctx.fill();
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawHouse(ctx, b) {
  ctx.save();
  ctx.translate(b.x + 0.5, b.y + 0.5);
  ctx.rotate(rotAngle(b.rot));
  ctx.fillStyle = SHOULDER; ctx.fillRect(0.1, -0.26, 0.4, 0.52);          // driveway
  ctx.fillStyle = ASPHALT; ctx.fillRect(0.1, -0.23, 0.4, 0.46);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; rrect(ctx, -0.38, -0.25, 0.54, 0.56, 0.08); ctx.fill();   // shadow
  ctx.fillStyle = b.color.hex; rrect(ctx, -0.4, -0.29, 0.56, 0.56, 0.08); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.22)'; rrect(ctx, -0.34, -0.23, 0.44, 0.2, 0.05); ctx.fill();  // roof highlight
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.02; rrect(ctx, -0.4, -0.29, 0.56, 0.56, 0.08); ctx.stroke();
  ctx.translate(-0.12, 0); ctx.rotate(-rotAngle(b.rot));           // keep glyph upright
  ctx.fillStyle = 'rgba(255,255,255,.95)'; glyph(ctx, b.color.glyph, 0.1);
  ctx.restore();
}

function drawDest(ctx, b) {
  ctx.save();
  ctx.translate(b.x + 1, b.y + 1);
  ctx.rotate(rotAngle(b.rot));
  for (const y0 of [b.gate ? 0.5 : -0.5]) {                         // the single entrance (reaches every bay)
    ctx.fillStyle = SHOULDER; ctx.fillRect(0.5, y0 - 0.26, 0.5, 0.52);
    ctx.fillStyle = ASPHALT; ctx.fillRect(0.5, y0 - 0.23, 0.5, 0.46);
  }
  ctx.fillStyle = '#3c4046'; rrect(ctx, 0.05, -0.95, 0.9, 1.9, 0.07); ctx.fill();                  // one lot, two tiles long
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 0.02;
  for (const y of [-0.5, 0, 0.5]) { ctx.beginPath(); ctx.moveTo(0.08, y); ctx.lineTo(0.6, y); ctx.stroke(); }   // bay dividers
  ctx.beginPath(); ctx.moveTo(0.08, -0.9); ctx.lineTo(0.08, 0.9); ctx.stroke();                             // curb line
  ctx.setLineDash([0.07, 0.07]); ctx.strokeStyle = 'rgba(242,201,76,.5)';
  ctx.beginPath(); ctx.moveTo(0.82, -0.85); ctx.lineTo(0.82, 0.85); ctx.stroke(); ctx.setLineDash([]);     // drive aisle joining the two ends
  ctx.fillStyle = 'rgba(0,0,0,.28)'; rrect(ctx, -0.9, -0.88, 0.84, 1.84, 0.1); ctx.fill();       // building
  ctx.fillStyle = b.color.hex; rrect(ctx, -0.92, -0.92, 0.84, 1.84, 0.1); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.2)'; rrect(ctx, -0.84, -0.84, 0.68, 1.68, 0.07); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.025; rrect(ctx, -0.92, -0.92, 0.84, 1.84, 0.1); ctx.stroke();
  for (let k = 0; k < 4; k++) {                                   // inbound-car markers, one per parking bay
    const y = (k >> 1) - 0.5 + ((k & 1) ? 0.22 : -0.22);
    ctx.beginPath(); ctx.arc(-0.66, y, 0.075, 0, 6.2832);
    if (b.slots[k]) { ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 0.02; ctx.stroke(); }
    else { ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 0.025; ctx.stroke(); }
  }
  ctx.translate(-0.3, 0); ctx.rotate(-rotAngle(b.rot));
  ctx.fillStyle = 'rgba(255,255,255,.95)'; glyph(ctx, b.color.glyph, 0.17);
  ctx.restore();
}

const POP = 0.6;   // seconds for a new building's pop-in
export function drawBuildings(ctx, g) {
  for (const b of g.buildings) {
    const age = g.time - b.born;
    if (age >= POP) { b.kind === 'house' ? drawHouse(ctx, b) : drawDest(ctx, b); continue; }
    const k = Math.max(0, age / POP), c = 1.70158 + 1;
    const scale = Math.max(0.01, 1 + c * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2));   // easeOutBack
    const cx = b.x + (b.kind === 'house' ? 0.5 : 1), cy = b.y + (b.kind === 'house' ? 0.5 : 1);
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy);
    b.kind === 'house' ? drawHouse(ctx, b) : drawDest(ctx, b);
    ctx.restore();
    ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - k)})`; ctx.lineWidth = 0.06;       // expanding ping
    ctx.beginPath(); ctx.arc(cx, cy, (b.kind === 'house' ? 0.5 : 1) + k * 1.4, 0, 6.2832); ctx.stroke();
  }
}

// Pieces cars still need but the map no longer supports: faded "ghost" road.
export function drawGhosts(ctx, g) {
  const seen = new Set();
  ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  for (const car of g.cars) {
    if (car.state === 'home') continue;
    const pieces = car.state === 'dwell' ? car.homeRoute || [] : car.route.slice(car.idx);       // a parked car's way home counts too
    for (const p of pieces) {
      if (seen.has(p.key) || pieceValid(g, p)) continue;
      seen.add(p.key);
      ctx.beginPath();
      if (p.poly) { ctx.moveTo(p.xy[0][0], p.xy[0][1]); for (const q of p.xy) ctx.lineTo(q[0], q[1]); }
      else { const [a, b, c, d] = p.pts; ctx.moveTo(a[0], a[1]); ctx.bezierCurveTo(b[0], b[1], c[0], c[1], d[0], d[1]); }
      ctx.strokeStyle = 'rgba(180,190,200,.35)'; ctx.lineWidth = 0.46; ctx.stroke();
      ctx.setLineDash([0.08, 0.08]); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 0.03; ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

// A car counts as "under" while on the street piece beneath a deck, and for the last/first bit of the pieces either side
// (its nose already pokes under the deck's edge).
export function isUnder(car) {
  const p = car.route[car.idx];
  if (!p) return false;
  if (p.under) return true;
  const nx = car.route[car.idx + 1], pv = car.route[car.idx - 1];
  return (!!nx && !!nx.under && car.s > p.len - 0.2) || (!!pv && !!pv.under && car.s < 0.2);
}

// layer 'under': cars beneath an overpass (drawn before the deck); 'top': everyone else.
export function drawCars(ctx, g, layer = 'top') {
  const { warnAfterSeconds, gameOverAfterSeconds } = tuning.gridlock;
  if (layer === 'top') for (const car of g.cars) {                       // gold shine that builds as a car stays stuck
    if (car.state === 'home' || car.state === 'dwell' || car.stuck < warnAfterSeconds) continue;
    const k = Math.min(1, (car.stuck - warnAfterSeconds) / (gameOverAfterSeconds - warnAfterSeconds));
    const pulse = 0.55 + 0.45 * Math.sin(g.time * (4 + 8 * k));
    const r = 0.38 + 0.25 * k;
    const grad = ctx.createRadialGradient(car.x, car.y, 0.05, car.x, car.y, r);
    grad.addColorStop(0, `rgba(255,215,64,${0.55 * pulse + 0.2 * k})`);
    grad.addColorStop(1, 'rgba(255,215,64,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(car.x, car.y, r, 0, 6.2832); ctx.fill();
  }
  for (const car of g.cars) {
    if (car.state === 'home') continue;
    if ((layer === 'under') !== isUnder(car)) continue;
    const under = g.roads.get(Math.floor(car.y) * g.cols + Math.floor(car.x));
    if (under && under.tunnel && under.portal === undefined) continue;        // inside the hill: out of sight
    ctx.save();
    ctx.translate(car.x, car.y); ctx.rotate(car.a);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; rrect(ctx, -0.17, -0.08, 0.34, 0.2, 0.05); ctx.fill();
    ctx.fillStyle = car.color.hex; rrect(ctx, -0.17, -0.1, 0.34, 0.2, 0.05); ctx.fill();
    ctx.fillStyle = 'rgba(15,25,35,.75)'; ctx.fillRect(0.02, -0.075, 0.07, 0.15);     // windshield
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(-0.15, -0.085, 0.1, 0.03);   // roof glint
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 0.018; rrect(ctx, -0.17, -0.1, 0.34, 0.2, 0.05); ctx.stroke();
    ctx.restore();
  }
}
