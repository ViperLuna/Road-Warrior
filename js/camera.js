// Camera: cam.x/cam.y are the world (tile-unit) coords at the viewport's top-left, cam.z is px per tile.
const HUD_TOP = 88, HUD_BOTTOM = 96, KEEP_PX = 120;       // HUD_TOP leaves room for the (wrapping) top bar + goal row

export const cam = { x: 0, y: 0, z: 20, minZ: 8, maxZ: 120, W: 1, H: 1, cols: 1, rows: 1 };

export function resizeView(W, H) {
  cam.W = W; cam.H = H;
  updateLimits();
  clampCam();
}

function fitZoom() {
  return Math.min((cam.W - 16) / cam.cols, (cam.H - HUD_TOP - HUD_BOTTOM) / cam.rows);
}

function updateLimits() {
  const fit = fitZoom();
  cam.minZ = Math.max(3, fit * 0.75);
  cam.maxZ = Math.max(100, fit * 6);
}

export function fitView(cols, rows) {
  cam.cols = cols; cam.rows = rows;
  updateLimits();
  cam.z = Math.max(cam.minZ, fitZoom());
  const availH = cam.H - HUD_TOP - HUD_BOTTOM;
  cam.x = cols / 2 - cam.W / 2 / cam.z;
  cam.y = rows / 2 - (HUD_TOP + availH / 2) / cam.z;
  clampCam();
}

// Never let the map leave the screen entirely.
export function clampCam() {
  const minX = -(cam.W - KEEP_PX) / cam.z, maxX = cam.cols - KEEP_PX / cam.z;
  const minY = -(cam.H - KEEP_PX) / cam.z, maxY = cam.rows - KEEP_PX / cam.z;
  cam.x = Math.min(maxX, Math.max(minX, cam.x));
  cam.y = Math.min(maxY, Math.max(minY, cam.y));
}

export const screenToWorld = (sx, sy) => ({ x: sx / cam.z + cam.x, y: sy / cam.z + cam.y });

export function panBy(dxPx, dyPx) {
  cam.x += dxPx / cam.z;
  cam.y += dyPx / cam.z;
  clampCam();
}

// Zoom by `factor`, keeping the world point under (sx, sy) fixed.
export function zoomAround(sx, sy, factor) {
  const w = screenToWorld(sx, sy);
  cam.z = Math.min(cam.maxZ, Math.max(cam.minZ, cam.z * factor));
  cam.x = w.x - sx / cam.z;
  cam.y = w.y - sy / cam.z;
  clampCam();
}

// Two-finger gesture: put world point `anchor` under (sx, sy) at zoom z*factor.
export function pinchTo(anchor, sx, sy, factor) {
  cam.z = Math.min(cam.maxZ, Math.max(cam.minZ, cam.z * factor));
  cam.x = anchor.x - sx / cam.z;
  cam.y = anchor.y - sy / cam.z;
  clampCam();
}

// ---- Fly to places (the message log, countdown chips): pan and zoom so every box is in view, then pulse a highlight over them. ----
// A box is { x0, y0, x1, y1 } in tiles (inclusive). `ghost` draws the highlight faded and dashed: "this is where it was".
export const highlight = { boxes: [], start: 0, dur: 4000, ghost: false };
let flight = null;

export function flyTo(boxes, { ghost = false, ms = 650, highlightMs = 4000 } = {}) {
  if (!boxes || !boxes.length) return false;
  const x0 = Math.min(...boxes.map(b => b.x0)), y0 = Math.min(...boxes.map(b => b.y0));
  const x1 = Math.max(...boxes.map(b => b.x1)) + 1, y1 = Math.max(...boxes.map(b => b.y1)) + 1;
  const pad = 2.5, availH = cam.H - HUD_TOP - HUD_BOTTOM;
  const z = Math.max(cam.minZ, Math.min(70, cam.maxZ, (cam.W - 24) / (x1 - x0 + 2 * pad), availH / (y1 - y0 + 2 * pad)));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const to = { z, x: cx - cam.W / 2 / z, y: cy - (HUD_TOP + availH / 2) / z };
  const from = { x: cam.x, y: cam.y, z: cam.z }, t0 = performance.now(), token = {};
  flight = token;
  highlight.boxes = boxes; highlight.start = performance.now(); highlight.dur = highlightMs; highlight.ghost = ghost;
  const step = now => {
    if (flight !== token) return;
    const k = Math.min(1, (now - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;       // ease in-out
    cam.z = from.z + (to.z - from.z) * e;
    cam.x = from.x + (to.x - from.x) * e; cam.y = from.y + (to.y - from.y) * e;
    clampCam();
    if (k < 1) requestAnimationFrame(step); else flight = null;
  };
  requestAnimationFrame(step);
  return true;
}
export const cancelFlight = () => { flight = null; };

// 0..1 strength of the highlight right now (fades in, pulses, fades out), or 0 when there is none.
export function highlightLevel(now = performance.now()) {
  if (!highlight.boxes.length) return 0;
  const t = now - highlight.start;
  if (t < 0 || t > highlight.dur) return 0;
  const env = Math.min(1, t / 350, (highlight.dur - t) / 700), pulse = 0.55 + 0.45 * Math.sin(t / 1000 * 2 * Math.PI * 1.4);
  return env * pulse;
}
