// Camera: cam.x/cam.y are the world (tile-unit) coords at the viewport's top-left, cam.z is px per tile.
const HUD_TOP = 60, HUD_BOTTOM = 96, KEEP_PX = 120;

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
  cam.minZ = Math.max(4, fit * 0.75);
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
