// Draws buildings, ghost pieces and cars (tile units, same transform as render.js).
import { entOf, entsOf, entTile, footprint } from './buildings.js';
import { DIR, LANE } from './lanes.js';
import { pieceValid, tunnelMouths } from './network.js';
import { tuning } from './tuning.js';
import { highlightLevel, highlight } from './camera.js';
import { cfgOf } from './deadlines.js';

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

// The entrance stub (in the building's own frame: x runs toward the road, lot tile i spans y in [i-1, i]). ent = tile + 2 * code:
// code 0 is the front (the road side), 1 the -y end of the lot, 2 the +y end.
function drawEntrance(ctx, b) {
  const ent = entOf(b), code = ent >> 1, yc = (ent & 1) - 0.5;
  const rect = (x, y, w, h, alongX) => { ctx.fillStyle = SHOULDER; ctx.fillRect(x, y, w, h); ctx.fillStyle = ASPHALT; if (alongX) ctx.fillRect(x, y + 0.03, w, h - 0.06); else ctx.fillRect(x + 0.03, y, w - 0.06, h); };
  if (code === 0) rect(0.5, yc - 0.26, 0.5, 0.52, true);
  else if (code === 1) rect(0.24, yc - 0.5, 0.52, 0.5, false);
  else rect(0.24, yc, 0.52, 0.5, false);
}

// A small destination: one building tile with its lot tile (2 bays). Same look as the big one, half the size. `half` picks the box half.
function drawDestSmall(ctx, b) {
  const cy = (b.half ? 1 : 0) - 0.5;                              // local y of this lot tile's centre
  ctx.save();
  ctx.translate(b.x + 1, b.y + 1);
  ctx.rotate(rotAngle(b.rot));
  drawEntrance(ctx, b);
  ctx.fillStyle = '#3c4046'; rrect(ctx, 0.05, cy - 0.45, 0.9, 0.9, 0.07); ctx.fill();               // the lot
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 0.02;
  ctx.beginPath(); ctx.moveTo(0.08, cy); ctx.lineTo(0.6, cy); ctx.stroke();                          // bay divider
  ctx.beginPath(); ctx.moveTo(0.08, cy - 0.41); ctx.lineTo(0.08, cy + 0.41); ctx.stroke();           // curb line
  ctx.setLineDash([0.07, 0.07]); ctx.strokeStyle = 'rgba(242,201,76,.5)';
  ctx.beginPath(); ctx.moveTo(0.82, cy - 0.38); ctx.lineTo(0.82, cy + 0.38); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; rrect(ctx, -0.9, cy - 0.42, 0.84, 0.92, 0.1); ctx.fill();         // building
  ctx.fillStyle = b.color.hex; rrect(ctx, -0.92, cy - 0.46, 0.84, 0.92, 0.1); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.2)'; rrect(ctx, -0.84, cy - 0.38, 0.68, 0.76, 0.07); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.025; rrect(ctx, -0.92, cy - 0.46, 0.84, 0.92, 0.1); ctx.stroke();
  for (let n = 0; n < 2; n++) {                                   // inbound-car markers, one per bay
    const k = (b.half ? 2 : 0) + n, y = cy + (n ? 0.22 : -0.22);
    ctx.beginPath(); ctx.arc(-0.66, y, 0.075, 0, 6.2832);
    if (b.slots[k]) { ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 0.02; ctx.stroke(); }
    else { ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 0.025; ctx.stroke(); }
  }
  ctx.translate(-0.3, cy); ctx.rotate(-rotAngle(b.rot));
  ctx.fillStyle = 'rgba(255,255,255,.95)'; glyph(ctx, b.color.glyph, 0.15);
  ctx.restore();
}

// The stadium: a 4-wide, 3-deep oval arena. Local frame as the small destination (+x toward the road, +y along the front); the front row is
// the lot row, so lot tile i spans y in [i-1, i] and the block covers x in [-2, 1], y in [-2, 2]. Each gate is a short road stub into the front.
function drawStadium(ctx, b) {
  const cap = b.slots.length, full = b.slots.reduce((n, c) => n + (c ? 1 : 0), 0) / Math.max(1, cap);
  ctx.save();
  ctx.translate(b.x + 1, b.y + 1);
  ctx.rotate(rotAngle(b.rot));
  ctx.fillStyle = 'rgba(0,0,0,.28)'; rrect(ctx, -1.92, -1.92, 2.9, 3.9, 0.85); ctx.fill();            // arena: shadow, stands, pitch
  ctx.fillStyle = '#cfd8dc'; rrect(ctx, -1.97, -1.97, 2.94, 3.94, 0.85); ctx.fill();
  ctx.fillStyle = '#8fa0a8'; rrect(ctx, -1.72, -1.72, 2.44, 3.44, 0.7); ctx.fill();
  ctx.fillStyle = '#3f8f4f'; rrect(ctx, -1.47, -1.47, 1.94, 2.94, 0.5); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 0.03;
  ctx.beginPath(); ctx.moveTo(-1.47, 0); ctx.lineTo(0.47, 0); ctx.stroke();                          // halfway line: across the pitch, square to its long axis (y)
  ctx.beginPath(); ctx.arc(-0.5, 0, 0.4, 0, 6.2832); ctx.stroke();
  for (const e of [-1, 1]) {                                                                          // at each end: penalty box, goal area and a goal with a net
    const edge = e * 1.47, inward = -e;
    ctx.beginPath(); ctx.rect(-1.0, e < 0 ? -1.47 : 0.97, 1.0, 0.5); ctx.stroke();
    ctx.beginPath(); ctx.rect(-0.8, e < 0 ? -1.47 : 1.25, 0.6, 0.22); ctx.stroke();
    const y0 = e < 0 ? edge - 0.15 : edge, gx = -0.78, gw = 0.56;                                      // the goal sits just behind the end line, on the stand side
    ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(gx, y0, gw, 0.15);
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 0.012;
    for (let n = 1; n < 5; n++) { ctx.beginPath(); ctx.moveTo(gx + (gw * n) / 5, y0); ctx.lineTo(gx + (gw * n) / 5, y0 + 0.15); ctx.stroke(); }     // net
    ctx.beginPath(); ctx.moveTo(gx, y0 + 0.075); ctx.lineTo(gx + gw, y0 + 0.075); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.03; ctx.strokeRect(gx, y0, gw, 0.15);               // posts and crossbar
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 0.03;
  }
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.025; rrect(ctx, -1.97, -1.97, 2.94, 3.94, 0.85); ctx.stroke();
  for (const ent of entsOf(b)) {                                                                       // a gate: the road stub, a dark opening and a yellow line
    const yc = entTile(ent) - 0.5;
    ctx.fillStyle = SHOULDER; ctx.fillRect(0.45, yc - 0.26, 0.55, 0.52);
    ctx.fillStyle = ASPHALT; ctx.fillRect(0.45, yc - 0.23, 0.55, 0.46);
    ctx.fillStyle = '#2b2e33'; rrect(ctx, 0.2, yc - 0.3, 0.3, 0.6, 0.06); ctx.fill();
    ctx.setLineDash([0.06, 0.06]); ctx.strokeStyle = 'rgba(242,201,76,.65)'; ctx.lineWidth = 0.02;
    ctx.beginPath(); ctx.moveTo(1, yc); ctx.lineTo(0.5, yc); ctx.stroke(); ctx.setLineDash([]);
  }
  for (let n = 0; n < 10; n++) {                                                                       // how full it is: a row of lights along the back
    ctx.fillStyle = n < Math.round(full * 10) ? '#ffcc33' : 'rgba(255,255,255,.2)';
    ctx.beginPath(); ctx.arc(-1.84, -1.5 + n * 0.33, 0.07, 0, 6.2832); ctx.fill();
  }
  ctx.restore();
}

// A side-road gate on the map edge: one asphalt tile where the road goes off the map. Local +x points in from the edge.
function drawPortal(ctx, b, t) {
  ctx.save();
  ctx.translate(b.x + 0.5, b.y + 0.5);
  ctx.rotate(rotAngle(b.rot));
  ctx.fillStyle = SHOULDER; ctx.fillRect(-0.5, -0.31, 1, 0.62);
  ctx.fillStyle = ASPHALT; ctx.fillRect(-0.5, -0.27, 1, 0.54);
  ctx.setLineDash([0.08, 0.08]); ctx.strokeStyle = 'rgba(242,201,76,.7)'; ctx.lineWidth = 0.02;
  ctx.beginPath(); ctx.moveTo(-0.5, 0); ctx.lineTo(0.5, 0); ctx.stroke(); ctx.setLineDash([]);
  const pulse = 0.5 + 0.5 * Math.sin(t * 3);
  ctx.strokeStyle = `rgba(255,255,255,${0.55 + 0.35 * pulse})`; ctx.lineWidth = 0.05; ctx.lineJoin = 'round';
  for (const x of [0.12, 0.32]) { ctx.beginPath(); ctx.moveTo(x - 0.07, -0.13); ctx.lineTo(x + 0.07, 0); ctx.lineTo(x - 0.07, 0.13); ctx.stroke(); }       // arrows pointing into the map
  ctx.fillStyle = '#e2b93b'; ctx.fillRect(-0.5, -0.31, 0.07, 0.62);                                     // the edge-of-map bar
  ctx.translate(-0.2, 0); ctx.rotate(-rotAngle(b.rot));                                                  // the icon stays upright: a round badge with a city skyline, by the map edge
  ctx.fillStyle = 'rgba(20,30,40,.88)'; ctx.beginPath(); ctx.arc(0, 0, 0.17, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 0.022; ctx.beginPath(); ctx.arc(0, 0, 0.17, 0, 6.2832); ctx.stroke();
  ctx.fillStyle = '#e8eef2';
  for (const [x, y, w, h] of [[-0.11, -0.01, 0.06, 0.12], [-0.045, -0.1, 0.07, 0.21], [0.035, -0.05, 0.06, 0.16], [0.105, 0.02, 0.04, 0.09]]) ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function drawDest(ctx, b) {
  if (b.stadium) { drawStadium(ctx, b); return; }
  if (b.small) { drawDestSmall(ctx, b); return; }
  ctx.save();
  ctx.translate(b.x + 1, b.y + 1);
  ctx.rotate(rotAngle(b.rot));
  drawEntrance(ctx, b);                                              // the single entrance (reaches every bay)
  ctx.fillStyle = '#3c4046'; rrect(ctx, 0.05, -0.95, 0.9, 1.9, 0.07); ctx.fill();                  // one lot, two tiles long
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 0.02;
  for (const y of [-0.5, 0, 0.5]) { ctx.beginPath(); ctx.moveTo(0.08, y); ctx.lineTo(0.6, y); ctx.stroke(); }   // bay dividers
  ctx.beginPath(); ctx.moveTo(0.08, -0.9); ctx.lineTo(0.08, 0.9); ctx.stroke();                             // curb line
  ctx.setLineDash([0.07, 0.07]); ctx.strokeStyle = 'rgba(242,201,76,.5)';
  ctx.beginPath(); ctx.moveTo(0.82, -0.85); ctx.lineTo(0.82, 0.85); ctx.stroke(); ctx.setLineDash([]);     // drive aisle joining the two ends
  ctx.fillStyle = 'rgba(0,0,0,.28)'; rrect(ctx, -0.9, -0.88, 0.84, 1.84, 0.1); ctx.fill();       // building
  if (b.color2) {                                                  // two colours: one half each, a thin seam between them
    ctx.save(); rrect(ctx, -0.92, -0.92, 0.84, 1.84, 0.1); ctx.clip();
    ctx.fillStyle = b.color.hex; ctx.fillRect(-0.92, -0.92, 0.84, 0.92);
    ctx.fillStyle = b.color2.hex; ctx.fillRect(-0.92, 0, 0.84, 0.92);
    ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(-0.84, -0.84, 0.68, 0.84 - 0.02); ctx.fillRect(-0.84, 0.02, 0.68, 0.82);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(-0.92, -0.012, 0.84, 0.024);
    ctx.restore();
  } else {
    ctx.fillStyle = b.color.hex; rrect(ctx, -0.92, -0.92, 0.84, 1.84, 0.1); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.2)'; rrect(ctx, -0.84, -0.84, 0.68, 1.68, 0.07); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.025; rrect(ctx, -0.92, -0.92, 0.84, 1.84, 0.1); ctx.stroke();
  for (let k = 0; k < 4; k++) {                                   // inbound-car markers, one per parking bay
    const y = (k >> 1) - 0.5 + ((k & 1) ? 0.22 : -0.22);
    ctx.beginPath(); ctx.arc(-0.66, y, 0.075, 0, 6.2832);
    if (b.slots[k]) { ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 0.02; ctx.stroke(); }
    else { ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 0.025; ctx.stroke(); }
  }
  ctx.translate(-0.3, 0); ctx.rotate(-rotAngle(b.rot));
  ctx.fillStyle = 'rgba(255,255,255,.95)';
  if (b.color2) {                                                  // each colour keeps its own shape (colour is never the only cue)
    const up = rotAngle(b.rot);                                    // the halves lie along the building's long axis (local y); undo the turn to place them
    const place = (dy, c) => { ctx.save(); ctx.rotate(up); ctx.translate(0, dy); ctx.rotate(-up); glyph(ctx, c.glyph, 0.14); ctx.restore(); };
    place(-0.46, b.color); place(0.46, b.color2);
  } else glyph(ctx, b.color.glyph, 0.17);
  ctx.restore();
}

const POP = 0.6;   // seconds for a new building's pop-in
export function drawBuildings(ctx, g) {
  for (const b of g.buildings) {
    const age = g.time - b.born;
    const draw = () => (b.kind === 'house' ? drawHouse(ctx, b) : b.kind === 'portal' ? drawPortal(ctx, b, g.time) : drawDest(ctx, b));
    if (age >= POP) { draw(); continue; }
    const k = Math.max(0, age / POP), c = 1.70158 + 1;
    const scale = Math.max(0.01, 1 + c * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2));   // easeOutBack
    const cx = b.x + (b.kind === 'house' ? 0.5 : 1), cy = b.y + (b.kind === 'house' ? 0.5 : 1);
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy);
    draw();
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
    if (car.state === 'home' || (car.state === 'dwell' && car.dest && car.dest.stadium)) continue;       // (cars inside the stadium are out of sight)
    if ((layer === 'under') !== isUnder(car)) continue;
    const under = g.roads.get(Math.floor(car.y) * g.cols + Math.floor(car.x));
    if (under && under.tunnel && !tunnelMouths(g, Math.floor(car.x), Math.floor(car.y)).length) continue;        // deep inside the hill: out of sight
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

// The accident scene: hazard flashers on the two wrecks and two police cars (red/blue light bars) that fade in and out.
export function drawAccident(ctx, g) {
  const a = g.accident;
  if (!a) return;
  const fade = Math.min(1, a.age / 0.6, Math.max(0, a.left) / 0.6), blink = Math.floor(g.time * 4) % 2 === 0;
  ctx.save();
  ctx.globalAlpha = fade;
  for (const c of a.cars) {                                                       // amber hazard lights at the four corners
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
    ctx.fillStyle = blink ? '#ffb300' : 'rgba(255,179,0,.25)';
    for (const [x, y] of [[0.16, -0.1], [0.16, 0.1], [-0.16, -0.1], [-0.16, 0.1]]) { ctx.beginPath(); ctx.arc(x, y, 0.03, 0, 6.2832); ctx.fill(); }
    ctx.restore();
  }
  a.police.forEach((p, i) => {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; rrect(ctx, -0.17, -0.08, 0.34, 0.2, 0.05); ctx.fill();
    ctx.fillStyle = '#f4f6f8'; rrect(ctx, -0.17, -0.1, 0.34, 0.2, 0.05); ctx.fill();
    ctx.fillStyle = '#1c2a3a'; ctx.fillRect(-0.12, -0.1, 0.13, 0.2);              // dark doors / roof band
    ctx.fillStyle = 'rgba(15,25,35,.75)'; ctx.fillRect(0.02, -0.075, 0.07, 0.15);
    const red = (Math.floor(g.time * 5) + i) % 2 === 0;
    ctx.fillStyle = red ? '#ff2b2b' : '#2b6bff'; ctx.fillRect(-0.05, -0.09, 0.05, 0.08);
    ctx.fillStyle = red ? '#2b6bff' : '#ff2b2b'; ctx.fillRect(-0.05, 0.01, 0.05, 0.08);
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 0.018; rrect(ctx, -0.17, -0.1, 0.34, 0.2, 0.05); ctx.stroke();
    ctx.restore();
    const glow = ctx.createRadialGradient(p.x, p.y, 0.02, p.x, p.y, 0.45);        // light spill on the road
    glow.addColorStop(0, red ? 'rgba(255,40,40,.35)' : 'rgba(40,100,255,.35)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p.x, p.y, 0.45, 0, 6.2832); ctx.fill();
  });
  ctx.restore();
}

// Road works: little cones down the closed lane (the lane of the cars that enter from side `closedIn`) and a striped barrier across its start.
export function drawWorkZone(ctx, g) {
  const w = g.work;
  if (!w) return;
  const h = [-DIR[w.closedIn][0], -DIR[w.closedIn][1]], r = [-h[1], h[0]], n = tuning.construction.cones, blink = Math.floor(g.time * 2) % 2 === 0;
  const fade = Math.min(1, w.age / 0.6, Math.max(0, w.left) / 0.6), cx = w.x + 0.5, cy = w.y + 0.5;
  ctx.save();
  ctx.globalAlpha = fade;
  const lx = cx + r[0] * LANE, ly = cy + r[1] * LANE;                                   // centre of the closed lane
  ctx.fillStyle = 'rgba(255,150,40,.16)'; ctx.save(); ctx.translate(lx, ly); ctx.rotate(Math.atan2(h[1], h[0])); ctx.fillRect(-0.5, -0.1, 1, 0.2); ctx.restore();
  for (let i = 0; i < n; i++) {
    const t = -0.4 + (0.8 * i) / (n - 1), px = lx + h[0] * t, py = ly + h[1] * t;
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(px + 0.015, py + 0.045, 0.045, 0.018, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.moveTo(px - 0.034, py + 0.03); ctx.lineTo(px - 0.01, py - 0.05); ctx.lineTo(px + 0.01, py - 0.05); ctx.lineTo(px + 0.034, py + 0.03); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(px - 0.024, py - 0.012, 0.048, 0.016);
  }
  const bx = lx + h[0] * -0.46, by = ly + h[1] * -0.46;                                  // barrier across the start of the closed lane
  ctx.save(); ctx.translate(bx, by); ctx.rotate(Math.atan2(h[1], h[0]));
  ctx.fillStyle = '#fff'; ctx.fillRect(-0.02, -0.12, 0.04, 0.24);
  ctx.fillStyle = '#ff7a1a'; for (let i = 0; i < 4; i += 2) ctx.fillRect(-0.02, -0.12 + i * 0.06, 0.04, 0.06);
  ctx.fillStyle = blink ? '#ffb300' : 'rgba(255,179,0,.25)'; ctx.beginPath(); ctx.arc(0, -0.14, 0.025, 0, 6.2832); ctx.fill();
  ctx.restore();
  ctx.restore();
}

// Buildings that are out of patience (the warning stage): a pulsing red ring and the seconds left.
export function drawPatience(ctx, g) {
  for (const w of g.watches || []) {
    if (w.stage !== 'warn' || !w.ack || w.ok) continue;
    const left = Math.max(0, Math.ceil(cfgOf(w).warnSeconds - w.t)), pulse = 0.5 + 0.5 * Math.sin(g.time * 7);
    for (const id of w.ids) {
      const b = g.buildings.find(o => o.id === id); if (!b) continue;
      const fp = footprint(b), x0 = Math.min(...fp.map(p => p[0])), y0 = Math.min(...fp.map(p => p[1])), x1 = Math.max(...fp.map(p => p[0])) + 1, y1 = Math.max(...fp.map(p => p[1])) + 1;
      ctx.strokeStyle = `rgba(255,70,55,${0.45 + 0.5 * pulse})`; ctx.lineWidth = 0.09;
      rrect(ctx, x0 - 0.08, y0 - 0.08, x1 - x0 + 0.16, y1 - y0 + 0.16, 0.18); ctx.stroke();
      ctx.fillStyle = 'rgba(190,30,25,.9)'; ctx.beginPath(); ctx.arc((x0 + x1) / 2, y0 - 0.32, 0.27, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 0.3px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(left), (x0 + x1) / 2, y0 - 0.31);
    }
  }
}

// The "look here" highlight after flying to a message: a glowing frame round each box, fading in and out. Dashed and faint for a ghost
// (something that is already gone, like a cleared accident).
export function drawHighlight(ctx) {
  const k = highlightLevel();
  if (!k) return;
  for (const b of highlight.boxes) {
    const x = b.x0 - 0.25, y = b.y0 - 0.25, w = b.x1 - b.x0 + 1.5, h = b.y1 - b.y0 + 1.5;
    if (highlight.ghost) { ctx.setLineDash([0.18, 0.14]); ctx.strokeStyle = `rgba(230,236,240,${0.8 * k})`; ctx.fillStyle = `rgba(230,236,240,${0.12 * k})`; }
    else { ctx.setLineDash([]); ctx.strokeStyle = `rgba(255,214,64,${0.95 * k})`; ctx.fillStyle = `rgba(255,214,64,${0.22 * k})`; }
    ctx.lineWidth = 0.12; rrect(ctx, x, y, w, h, 0.3); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  }
}
