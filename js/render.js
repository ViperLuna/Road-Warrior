// Draws everything in tile units (1 tile = 1 unit); the camera transform does the scaling.
import { WATER, HILL } from './terrain.js';
import { hasRoad, tileIndex, inBounds, buildingAt } from './state.js';
import { roadConns, edgeLanes } from './network.js';
import { lightGroups, lightColor } from './signals.js';
import { RING_R } from './lanes.js';
import { drawBuildings, drawGhosts, drawCars } from './render_objects.js';

const COL = {
  hill: '#8d8977', hillTop: '#a7a290', cliff: '#5f5b4c',
  bg: '#16201a', grass: '#7fae6a', water: '#4a8fc4', shore: '#8cc7ea', sand: '#d6cc9a',
  shoulder: '#2b2e33', asphalt: '#45494f', line: '#f2c94c', border: '#0e1510',
};
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W
const ROAD_W = 0.46;                              // 2-lane road width; rest of the tile stays clear

const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function render(ctx, W, H, dpr, game, cam, hover) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, W * dpr, H * dpr);
  const s = cam.z * dpr;
  ctx.setTransform(s, 0, 0, s, -cam.x * s, -cam.y * s);

  const { cols, rows, terrain } = game;
  const x0 = Math.max(0, Math.floor(cam.x)), x1 = Math.min(cols - 1, Math.floor(cam.x + W / cam.z));
  const y0 = Math.max(0, Math.floor(cam.y)), y1 = Math.min(rows - 1, Math.floor(cam.y + H / cam.z));

  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fillRect(0.15, 0.25, cols, rows);
  ctx.fillStyle = COL.grass;
  ctx.fillRect(0, 0, cols, rows);

  const isWaterAt = (x, y) => inBounds(x, y) && terrain.water[tileIndex(x, y)] === WATER;
  const isHillAt = (x, y) => inBounds(x, y) && terrain.water[tileIndex(x, y)] === HILL;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (isWaterAt(x, y) || isHillAt(x, y)) continue;
      const h = hash(x, y);
      if (h > 0.72) { ctx.fillStyle = 'rgba(255,255,255,.04)'; ctx.fillRect(x - 0.005, y - 0.005, 1.01, 1.01); }
      else if (h < 0.25) { ctx.fillStyle = 'rgba(0,0,0,.035)'; ctx.fillRect(x - 0.005, y - 0.005, 1.01, 1.01); }
    }
  }

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!isWaterAt(x, y)) continue;
      ctx.fillStyle = COL.water;
      ctx.fillRect(x - 0.005, y - 0.005, 1.01, 1.01);
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
        if (!inBounds(nx, ny) || isWaterAt(nx, ny)) continue;
        const t = 0.1;
        ctx.fillStyle = COL.sand; // sand on the land side
        if (d === 0) ctx.fillRect(x, y - t, 1, t); else if (d === 2) ctx.fillRect(x, y + 1, 1, t);
        else if (d === 1) ctx.fillRect(x + 1, y, t, 1); else ctx.fillRect(x - t, y, t, 1);
        ctx.fillStyle = COL.shore; // lighter water at the edge
        if (d === 0) ctx.fillRect(x, y, 1, t); else if (d === 2) ctx.fillRect(x, y + 1 - t, 1, t);
        else if (d === 1) ctx.fillRect(x + 1 - t, y, t, 1); else ctx.fillRect(x, y, t, 1);
      }
    }
  }

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!isHillAt(x, y)) continue;
      const h = hash(x, y);
      ctx.fillStyle = h > 0.6 ? COL.hillTop : COL.hill;
      ctx.fillRect(x - 0.005, y - 0.005, 1.01, 1.01);
      ctx.fillStyle = 'rgba(0,0,0,.10)'; ctx.beginPath(); ctx.arc(x + 0.25 + h * 0.5, y + 0.3 + hash(y, x) * 0.4, 0.09 + h * 0.07, 0, 6.2832); ctx.fill();   // rock speckle
      for (let d = 0; d < 4; d++) {                                   // cliff face on edges that meet open ground
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
        if (!inBounds(nx, ny) || isHillAt(nx, ny)) continue;
        const t = d === 2 ? 0.2 : 0.1;
        ctx.fillStyle = COL.cliff;
        if (d === 0) ctx.fillRect(x, y, 1, t); else if (d === 2) ctx.fillRect(x, y + 1 - t, 1, t);
        else if (d === 1) ctx.fillRect(x + 1 - t, y, t, 1); else ctx.fillRect(x, y, t, 1);
      }
    }
  }

  if (cam.z >= 16) {
    ctx.strokeStyle = 'rgba(0,0,0,.07)';
    ctx.lineWidth = 1 / cam.z;
    ctx.beginPath();
    for (let x = x0; x <= x1 + 1; x++) { ctx.moveTo(x, y0); ctx.lineTo(x, y1 + 1); }
    for (let y = y0; y <= y1 + 1; y++) { ctx.moveTo(x0, y); ctx.lineTo(x1 + 1, y); }
    ctx.stroke();
  }

  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (game.roads.has(tileIndex(x, y))) drawRoad(ctx, game, x, y);

  drawGhosts(ctx, game);
  drawBuildings(ctx, game);
  drawCars(ctx, game, 'under');                                        // cars beneath an overpass go first...
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {      // ...then the deck covers them
    const r = game.roads.get(tileIndex(x, y));
    if (r && r.overpass !== undefined) drawDeck(ctx, game, x, y, r);
  }
  drawCars(ctx, game, 'top');

  if (hover.show && inBounds(hover.x, hover.y)) {
    const w = isWaterAt(hover.x, hover.y) && !hasRoad(hover.x, hover.y), road = hasRoad(hover.x, hover.y), bld = buildingAt(hover.x, hover.y);
    let ok = true;
    if (bld) ok = game.tool !== 'pan';                       // click rotates
    else if (game.tool === 'destroy') ok = road;
    else if (game.tool === 'build') ok = !w && !isHillAt(hover.x, hover.y) && !road && game.inv.road > 0;
    else if (game.tool === 'place') {
      const r = game.roads.get(tileIndex(hover.x, hover.y));
      ok = !!r && !r.bridge && !r.tunnel && !r.special && roadConns(game, hover.x, hover.y).length >= 3;
    }
    ctx.strokeStyle = game.tool === 'pan' ? 'rgba(255,255,255,.5)' : ok ? 'rgba(255,255,255,.95)' : 'rgba(255,90,80,.95)';
    ctx.lineWidth = 2.5 / cam.z;
    ctx.strokeRect(hover.x + 0.04, hover.y + 0.04, 0.92, 0.92);
  }

  ctx.strokeStyle = COL.border;
  ctx.lineWidth = 3 / cam.z;
  ctx.strokeRect(0, 0, cols, rows);
}

function drawRoad(ctx, game, tx, ty) {
  const conns = roadConns(game, tx, ty);   // neighbouring roads + building driveways facing this tile
  const cx = tx + 0.5, cy = ty + 0.5;
  const mid = d => [cx + DIRS[d][0] * 0.5, cy + DIRS[d][1] * 0.5];
  const isCurve = conns.length === 2 && conns[1] - conns[0] !== 2;

  const path = (inset) => {
    ctx.beginPath();
    if (isCurve) {
      const a = mid(conns[0]), b = mid(conns[1]);
      ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(cx, cy, b[0], b[1]);
    } else if (conns.length === 2) {
      const a = mid(conns[0]), b = mid(conns[1]);
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    } else {
      for (const d of conns) {
        const m = mid(d);
        ctx.moveTo(cx + DIRS[d][0] * inset, cy + DIRS[d][1] * inset);
        ctx.lineTo(m[0], m[1]);
      }
    }
  };

  const road = game.roads.get(tileIndex(tx, ty));
  if (road.tunnel) { drawTunnel(ctx, road, cx, cy, conns, mid); return; }
  if (road.overpass !== undefined) { drawUnderStreet(ctx, game, tx, ty, road); return; }
  if ((road.lanes || 2) === 4 && road.special !== 'roundabout') { drawWide(ctx, game, tx, ty, conns, road); return; }
  const bridge = !!road.bridge;
  const round = road.special === 'roundabout' && conns.length >= 3;
  const pass = (width, color) => {
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = width; ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    path(round ? RING_R : 0); ctx.stroke();
    if (conns.length <= 1) { ctx.beginPath(); ctx.arc(cx, cy, width / 2, 0, 6.2832); ctx.fill(); }
    else if (conns.length >= 3 && !round) ctx.fillRect(cx - width / 2, cy - width / 2, width, width);
  };
  if (round) {                                              // circular road around a grass island
    drawRing(ctx, cx, cy, conns, path, pass);
    return;
  }
  if (bridge) pass(ROAD_W + 0.16, '#cdbb9a');             // bridge rails
  pass(ROAD_W + 0.06, bridge ? '#6d5d49' : COL.shoulder);
  pass(ROAD_W, bridge ? '#6a6f76' : COL.asphalt);

  const flows = computeFlows(game, tx, ty, conns, road);
  if (conns.length >= 1) {
    ctx.strokeStyle = flows.length ? '#ffffff' : COL.line;
    ctx.lineWidth = 0.025;
    ctx.setLineDash([0.125, 0.125]);
    path(ROAD_W / 2 + 0.06);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  drawTail(ctx, game, tx, ty, conns, road, flows);
}

function drawRing(ctx, cx, cy, conns, path, pass) {
  pass(ROAD_W + 0.06, COL.shoulder);
  pass(ROAD_W, COL.asphalt);
  for (const [w, col] of [[0.34, COL.shoulder], [0.28, COL.asphalt]]) {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(cx, cy, RING_R, 0, 6.2832); ctx.stroke();
  }
  ctx.fillStyle = '#6f9d5b'; ctx.beginPath(); ctx.arc(cx, cy, RING_R - 0.15, 0, 6.2832); ctx.fill();   // island
  ctx.strokeStyle = '#a9c79a'; ctx.lineWidth = 0.02; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 0.014; ctx.setLineDash([0.06, 0.06]);
  ctx.beginPath(); ctx.arc(cx, cy, RING_R, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]);
}

// Signal heads sit at each approach, on the driver's right, showing the live colour.
function drawLights(ctx, game, tx, ty, conns) {
  const cx = tx + 0.5, cy = ty + 0.5, groups = lightGroups(conns);
  for (const d of conns) {
    const col = lightColor(game.time, groups, d);
    const hx = -DIRS[d][0], hy = -DIRS[d][1], rx = -hy, ry = hx;        // approach heading + its right-hand side
    const px = cx + DIRS[d][0] * 0.4 + rx * 0.3, py = cy + DIRS[d][1] * 0.4 + ry * 0.3;
    ctx.fillStyle = '#15181c'; ctx.beginPath(); ctx.arc(px, py, 0.075, 0, 6.2832); ctx.fill();
    const c = col === 'green' ? '#37d67a' : col === 'yellow' ? '#ffd23f' : '#ff4d4d';
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(px, py, 0.052, 0, 6.2832); ctx.fill();
  }
}


// A tunnel tile: the road runs under the hill (faint dashed outline), with a stone-rimmed mouth at each end.
function drawTunnel(ctx, road, cx, cy, conns, mid) {
  ctx.lineCap = 'butt';
  ctx.strokeStyle = 'rgba(30,26,20,.35)'; ctx.lineWidth = (road.lanes || 2) === 4 ? 0.88 : ROAD_W;
  ctx.beginPath();
  for (const d of conns) { const m = mid(d); ctx.moveTo(cx, cy); ctx.lineTo(m[0], m[1]); }
  ctx.stroke();
  ctx.setLineDash([0.07, 0.07]); ctx.strokeStyle = 'rgba(255,235,190,.55)'; ctx.lineWidth = 0.025;
  ctx.beginPath();
  for (const d of conns) { const m = mid(d); ctx.moveTo(cx, cy); ctx.lineTo(m[0], m[1]); }
  ctx.stroke(); ctx.setLineDash([]);
  if (road.portal !== undefined) {
    const d = DIRS[road.portal], px = cx + d[0] * 0.3, py = cy + d[1] * 0.3;
    ctx.save();
    ctx.translate(px, py); ctx.rotate(Math.atan2(d[1], d[0]));          // local +x points out of the hill
    ctx.fillStyle = '#b9b49f'; ctx.beginPath(); ctx.roundRect(-0.12, -0.31, 0.24, 0.62, 0.1); ctx.fill();      // stone rim
    ctx.fillStyle = '#1d1a16'; ctx.beginPath(); ctx.roundRect(-0.09, -0.26, 0.2, 0.52, 0.09); ctx.fill();      // dark opening
    ctx.restore();
  }
}


// One-way streets: which sides of this tile carry flow ([side, +1 out | -1 in]).
function computeFlows(game, tx, ty, conns, road) {
  const flows = [];
  for (const d of conns) {
    const nb = game.roads.get(tileIndex(tx + DIRS[d][0], ty + DIRS[d][1]));
    if (!nb || !inBounds(tx + DIRS[d][0], ty + DIRS[d][1])) continue;
    const outBlocked = ((road.noExit || 0) >> d) & 1, inBlocked = ((nb.noExit || 0) >> ((d + 2) % 4)) & 1;
    if (outBlocked && !inBlocked) flows.push([d, -1]);                  // traffic flows into this tile from side d
    else if (!outBlocked && inBlocked) flows.push([d, 1]);              // traffic flows out of this tile through side d
  }
  return flows;
}

// Signal heads and one-way chevrons, drawn on top of the road body.
function drawTail(ctx, game, tx, ty, conns, road, flows) {
  const cx = tx + 0.5, cy = ty + 0.5;
  for (let d = 0; d < 4; d++) {                                          // cut seams: a curb across the road's end
    if (!(((road.cut || 0) >> d) & 1)) continue;
    const ex = cx + DIRS[d][0] * 0.5, ey = cy + DIRS[d][1] * 0.5, px = -DIRS[d][1], py = DIRS[d][0], w = (road.lanes || 2) === 4 ? 0.46 : 0.26;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#111316'; ctx.lineWidth = 0.12; ctx.beginPath(); ctx.moveTo(ex - px * w, ey - py * w); ctx.lineTo(ex + px * w, ey + py * w); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,214,90,.9)'; ctx.lineWidth = 0.03; ctx.setLineDash([0.07, 0.05]);
    const ix = ex - DIRS[d][0] * 0.07, iy = ey - DIRS[d][1] * 0.07;
    ctx.beginPath(); ctx.moveTo(ix - px * w, iy - py * w); ctx.lineTo(ix + px * w, iy + py * w); ctx.stroke(); ctx.setLineDash([]);
  }
  if (road.special === 'light' && conns.length >= 3) drawLights(ctx, game, tx, ty, conns);
  for (const [d, sign] of flows) {                                       // chevron along the arm, pointing the way traffic goes
    const dx = DIRS[d][0] * sign, dy = DIRS[d][1] * sign, px = cx + DIRS[d][0] * 0.3, py = cy + DIRS[d][1] * 0.3;
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 0.035; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(px - dx * 0.06 - dy * 0.08, py - dy * 0.06 + dx * 0.08); ctx.lineTo(px + dx * 0.07, py + dy * 0.07);
    ctx.lineTo(px - dx * 0.06 + dy * 0.08, py - dy * 0.06 - dx * 0.08); ctx.stroke();
    ctx.lineCap = 'butt';
  }
}

// ---- 4-lane roads (highways): a wide ribbon that flares back to street width wherever it meets a 2-lane road ----
const HW = 0.44;                                   // half-width of a 4-lane road body

function ribbon(ctx, pts, hws, grow, color) {
  const n = pts.length, L = [], Rr = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const w = hws[i] + grow;
    L.push([pts[i][0] - dy * w, pts[i][1] + dx * w]); Rr.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
  }
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(L[0][0], L[0][1]);
  for (const q of L) ctx.lineTo(q[0], q[1]);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(Rr[i][0], Rr[i][1]);
  ctx.closePath(); ctx.fill();
}

function offsetLine(pts, d) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    return [p[0] - dy * d, p[1] + dx * d];
  });
}

function strokePts(ctx, pts) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); }

function drawWide(ctx, game, tx, ty, conns, road) {
  const cx = tx + 0.5, cy = ty + 0.5;
  const mid = d => [cx + DIRS[d][0] * 0.5, cy + DIRS[d][1] * 0.5];
  const hwEdge = d => (edgeLanes(game, tx, ty, d) === 4 ? HW : 0.23);
  const bridge = !!road.bridge || road.overpass !== undefined;           // an overpass deck gets bridge-style rails
  const lerp = (a, b, t) => a + (b - a) * t;
  const shapes = [];                                              // { pts, hws, mark: which points get lane markings }
  const N = 14;
  if (conns.length === 2) {                                       // straight or curved through-tile
    const [d0, d1] = conns, a = mid(d0), b = mid(d1), curve = d1 - d0 !== 2, pts = [], hws = [], mark = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      pts.push(curve ? [u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]] : [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
      hws.push(t < 0.5 ? lerp(hwEdge(d0), HW, t * 2) : lerp(HW, hwEdge(d1), (t - 0.5) * 2));
      mark.push(hws[i] >= HW - 0.02);
    }
    shapes.push({ pts, hws, mark });
  } else {                                                        // junction / dead end: one arm per connection
    for (const d of conns) {
      const m = mid(d), pts = [], hws = [], mark = [];
      for (let i = 0; i <= N; i++) {
        const s = i / N;
        pts.push([lerp(cx, m[0], s), lerp(cy, m[1], s)]);
        hws.push(s < 0.5 ? HW : lerp(HW, hwEdge(d), (s - 0.5) * 2));
        mark.push(conns.length < 3 || (s > 0.66 && hws[i] >= HW - 0.02));      // no markings across a junction's middle
      }
      shapes.push({ pts, hws, mark });
    }
  }
  const body = (grow, color) => {
    for (const sh of shapes) ribbon(ctx, sh.pts, sh.hws, grow, color);
    ctx.fillStyle = color;
    if (conns.length >= 3) ctx.fillRect(cx - HW - grow, cy - HW - grow, 2 * (HW + grow), 2 * (HW + grow));
    else if (conns.length <= 1) { ctx.beginPath(); ctx.arc(cx, cy, HW + grow, 0, 6.2832); ctx.fill(); }
  };
  if (bridge) body(0.1, '#cdbb9a');
  body(0.035, bridge ? '#6d5d49' : COL.shoulder);
  body(0, bridge ? '#6a6f76' : COL.asphalt);
  ctx.lineCap = 'butt';
  for (const sh of shapes) {                                      // markings on the 4-lane stretches only
    const runs = []; let cur = [];
    sh.pts.forEach((p, i) => { if (sh.mark[i]) cur.push(p); else if (cur.length) { runs.push(cur); cur = []; } });
    if (cur.length) runs.push(cur);
    for (const run of runs) {
      if (run.length < 2) continue;
      ctx.setLineDash([]); ctx.strokeStyle = COL.line; ctx.lineWidth = 0.02;
      strokePts(ctx, offsetLine(run, 0.022)); strokePts(ctx, offsetLine(run, -0.022));     // double yellow median
      ctx.setLineDash([0.1, 0.1]); ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 0.018;
      strokePts(ctx, offsetLine(run, 0.22)); strokePts(ctx, offsetLine(run, -0.22));        // white lane dividers
      ctx.setLineDash([]);
    }
  }
  drawTail(ctx, game, tx, ty, conns, road, computeFlows(game, tx, ty, conns, road));
}


// ---- Overpass: a street runs underneath, the highway deck passes over it ----
function drawUnderStreet(ctx, game, tx, ty, road) {
  const cx = tx + 0.5, cy = ty + 0.5, street = road.overpass === 0 ? [3, 1] : [0, 2];     // the street runs across the highway's axis
  const a = [cx + DIRS[street[0]][0] * 0.5, cy + DIRS[street[0]][1] * 0.5], b = [cx + DIRS[street[1]][0] * 0.5, cy + DIRS[street[1]][1] * 0.5];
  ctx.lineCap = 'butt';
  for (const [w, col] of [[ROAD_W + 0.06, COL.shoulder], [ROAD_W, COL.asphalt]]) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  ctx.strokeStyle = COL.line; ctx.lineWidth = 0.025; ctx.setLineDash([0.125, 0.125]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
}

function drawDeck(ctx, game, tx, ty, road) {
  const cx = tx + 0.5, cy = ty + 0.5, hw = road.overpass === 0 ? [0, 2] : [3, 1];
  ctx.fillStyle = 'rgba(0,0,0,.30)';                                                       // shadow cast on the street below
  if (road.overpass === 0) ctx.fillRect(cx - HW - 0.06, ty, 2 * HW + 0.16, 1); else ctx.fillRect(tx, cy - HW - 0.06 + 0.04, 1, 2 * HW + 0.16);
  drawWide(ctx, game, tx, ty, hw, road);
}
