// Pointer input. Mouse: left = current tool, right = demolish, middle/Space+left = pan, wheel = zoom.
// Touch: one finger = current tool (Build / Demolish / Move), two fingers = pan + pinch zoom.
import { game, buildRoad, demolish, setTool } from './state.js';
import { cam, screenToWorld, panBy, zoomAround, pinchTo } from './camera.js';
import { toast } from './hud.js';

export const hover = { x: -1, y: -1, show: false };

const pointers = new Map();   // pointerId -> {x, y}
let stroke = null;            // active one-pointer action
let pinch = null;             // active two-finger gesture
let spaceDown = false;

const tileAt = (sx, sy) => { const w = screenToWorld(sx, sy); return { x: Math.floor(w.x), y: Math.floor(w.y) }; };

function apply(mode, x, y) {
  if (mode === 'build') {
    const r = buildRoad(x, y);
    if (r === 'water') toast("Can't build on water. Bridges are coming soon.");
    else if (r === 'empty') toast('Out of road pieces!');
  } else if (mode === 'destroy') {
    demolish(x, y);
  }
}

// 4-connected walk from a to b (excludes a, includes b) so fast drags never leave gaps.
function* walk(a, b) {
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
  const sx = Math.sign(b.x - a.x), sy = Math.sign(b.y - a.y);
  let x = a.x, y = a.y, ix = 0, iy = 0;
  while (ix < dx || iy < dy) {
    if ((0.5 + ix) / dx < (0.5 + iy) / dy) { x += sx; ix++; } else { y += sy; iy++; }
    yield { x, y };
  }
}

function pinchState() {
  const [a, b] = [...pointers.values()];
  return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
}

export function initInput(canvas) {
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      stroke = null;
      const p = pinchState();
      pinch = { ...p, anchor: screenToWorld(p.mx, p.my) };
      return;
    }
    let mode = game.tool;
    if (e.pointerType === 'mouse') {
      if (e.button === 1) mode = 'pan';
      else if (e.button === 2) mode = 'destroy';
      else if (e.button === 0 && spaceDown) mode = 'pan';
      else if (e.button !== 0) return;
    }
    e.preventDefault();
    const t = tileAt(e.clientX, e.clientY);
    if (e.pointerType === 'mouse') { hover.x = t.x; hover.y = t.y; hover.show = true; }
    stroke = { mode, last: t, start: t, lx: e.clientX, ly: e.clientY, applied: false, touch: e.pointerType !== 'mouse' };
    // Touch waits (a 2nd finger may be arriving for a pinch); mouse acts immediately.
    if (mode !== 'pan' && !stroke.touch) { apply(mode, t.x, t.y); stroke.applied = true; }
  });

  canvas.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse') {
      const t = tileAt(e.clientX, e.clientY);
      hover.x = t.x; hover.y = t.y; hover.show = true;
    }
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;

    if (pinch && pointers.size >= 2) {
      const cur = pinchState();
      pinchTo(pinch.anchor, cur.mx, cur.my, cur.d / pinch.d);
      pinch.d = cur.d;
      pinch.anchor = screenToWorld(cur.mx, cur.my);
      return;
    }
    if (!stroke) return;
    if (stroke.mode === 'pan') {
      panBy(-(e.clientX - stroke.lx), -(e.clientY - stroke.ly));
      stroke.lx = e.clientX; stroke.ly = e.clientY;
      return;
    }
    const t = tileAt(e.clientX, e.clientY);
    if (t.x === stroke.last.x && t.y === stroke.last.y) return;
    if (!stroke.applied) { apply(stroke.mode, stroke.start.x, stroke.start.y); stroke.applied = true; }
    for (const step of walk(stroke.last, t)) apply(stroke.mode, step.x, step.y);
    stroke.last = t;
  });

  const end = e => {
    if (!pointers.has(e.pointerId)) return;
    if (stroke && stroke.touch && !stroke.applied && stroke.mode !== 'pan' && e.type === 'pointerup') {
      apply(stroke.mode, stroke.start.x, stroke.start.y); // tap
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    stroke = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hover.show = false; });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAround(e.clientX, e.clientY, Math.exp(-dy * 0.0015));
  }, { passive: false });

  addEventListener('keydown', e => {
    if (e.code === 'Space') { spaceDown = true; e.preventDefault(); }
    else if (e.key === 'b') setTool('build');
    else if (e.key === 'd') setTool('destroy');
    else if (e.key === 'm') setTool('pan');
  });
  addEventListener('keyup', e => { if (e.code === 'Space') spaceDown = false; });
}
