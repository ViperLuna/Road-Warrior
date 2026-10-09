// Draws everything in tile units (1 tile = 1 unit); the camera transform does the scaling.
import { WATER } from './terrain.js';
import { hasRoad, tileIndex, inBounds, buildingAt } from './state.js';
import { roadConns } from './network.js';
import { lightGroups, lightColor } from './signals.js';
import { RING_R } from './lanes.js';
import { drawBuildings, drawGhosts, drawCars } from './render_objects.js';

const COL = {
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

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (isWaterAt(x, y)) continue;
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
  drawCars(ctx, game);

  if (hover.show && inBounds(hover.x, hover.y)) {
    const w = isWaterAt(hover.x, hover.y), road = hasRoad(hover.x, hover.y), bld = buildingAt(hover.x, hover.y);
    let ok = true;
    if (bld) ok = game.tool !== 'pan';                       // click rotates
    else if (game.tool === 'destroy') ok = road;
    else if (game.tool === 'build') ok = !w && !road && game.inv.road > 0;
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

  if (conns.length >= 1) {
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = 0.025;
    ctx.setLineDash([0.125, 0.125]);
    path(ROAD_W / 2 + 0.06);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (road.special === 'light' && conns.length >= 3) drawLights(ctx, game, tx, ty, conns);
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
