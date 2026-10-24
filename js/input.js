// Pointer input. Mouse: left = current tool, right = demolish, middle/Space+left = pan, wheel = zoom.
// Touch: one finger = current tool (Build / Demolish / Move), two fingers = pan + pinch zoom.
import { actionOf } from './keys.js';
import { game, buildRoad, demolish, setTool, setMode, buildingAt, rotateBuildingAt, devSpawn, buildBridge, buildTunnelTile as buildTunnel1, hasRoad, inBounds, tileIndex, placeSpecial, setEdge, setOneWay, setCut, isCut, flipLotAt, setSpeed, setDevSpeed, toggleSpeed } from './state.js';
import { WATER, HILL } from './terrain.js';
import { cam, screenToWorld, panBy, zoomAround, pinchTo } from './camera.js';
import { toast } from './hud.js';
import { play } from './audio.js';

export const hover = { x: -1, y: -1, show: false };

const pointers = new Map();   // pointerId -> {x, y}
let stroke = null;            // active one-pointer action
let pinch = null;             // active two-finger gesture
let spaceDown = false;
let spacePanned = false;

const tileAt = (sx, sy) => { const w = screenToWorld(sx, sy); return { x: Math.floor(w.x), y: Math.floor(w.y) }; };

const kindAt = (x, y) => (inBounds(x, y) ? game.terrain.water[tileIndex(x, y)] : -1);

// Building by dragging. Water tiles are collected into a straight "span"; when the drag lands on the far side, one bridge item is spent and the
// whole span is built. A hill tile is different: tunnels are dug ONE BLOCK AT A TIME, each block next to a road (or the tunnel you are already
// digging) and each using one tunnel piece, so a tunnel can bend and a half-dug one just goes nowhere yet.
const TUNNEL_MSG = {
  notunnel: 'You need a tunnel piece to dig into the hill. Each block uses one (Shop, or a reward).',
  noroad: 'Dig a tunnel from a road at the edge of the hill (or from the tunnel you already have).',
};
function stepBuild(st, x, y) {
  const prev = st.prevTile;
  st.prevTile = { x, y };
  const kind = kindAt(x, y);
  if (kind === HILL) {
    if (st.span) { st.span = null; toast('Bridges must be a straight line over water.'); return; }
    const r = buildTunnel1(x, y);
    if (r === 'ok') play('tunnel');                                // a tunnel gets the drill
    else if (TUNNEL_MSG[r]) toast(TUNNEL_MSG[r]);
    return;
  }
  if (kind === WATER) {
    if (!st.span) {
      if (!prev || kindAt(prev.x, prev.y) !== 0 || !hasRoad(prev.x, prev.y)) { toast('Start a bridge from a road at the edge.'); return; }
      if ((game.inv.bridge || 0) <= 0) { toast('You need a bridge to cross water.'); return; }
      st.span = { kind, item: 'bridge', dx: x - prev.x, dy: y - prev.y, from: prev, tiles: [{ x, y }] };
    } else {
      const last = st.span.tiles[st.span.tiles.length - 1];
      if (x - last.x === st.span.dx && y - last.y === st.span.dy) st.span.tiles.push({ x, y });
      else { st.span = null; toast('Bridges must be a straight line over water.'); }
    }
    return;
  }
  if (st.span) {
    const sp = st.span, last = sp.tiles[sp.tiles.length - 1];
    st.span = null;
    if (x - last.x === sp.dx && y - last.y === sp.dy) {
      const r = buildBridge(sp.from, sp.tiles, { x, y });
      if (r === 'badend') { toast("The far side isn't clear."); return; }
      if (r !== 'ok') return;
      play('build');
    } else { toast('Bridges must be a straight line.'); return; }
  }
  const r = buildRoad(x, y);
  if (r === 'empty') toast('Out of road pieces and cash!');
  if (r === 'ok' || r === 'upgraded') play('build');
  // Dragging along roads paints the direction: one-way when the toggle is on, two-way again when it's off.
  if (prev && (r === 'ok' || r === 'upgraded' || r === 'exists') && hasRoad(prev.x, prev.y)) setEdge(prev.x, prev.y, x, y, game.oneway);
}

// Cut/Join: dragging across the seam between two touching roads cuts it; the first seam of the drag decides whether the
// whole drag cuts (it was connected) or joins (it was already cut).
function stepCut(st, x, y) {
  const prev = st.prevTile;
  st.prevTile = hasRoad(x, y) ? { x, y } : null;
  if (!prev || !hasRoad(x, y) || Math.abs(prev.x - x) + Math.abs(prev.y - y) !== 1) return;
  const mx = x - prev.x, my = y - prev.y;
  // Two roads running side by side: after crossing from one to the other, keep dragging ALONG them and every step cuts
  // (or rejoins) the seam between the pair, so a whole parallel run is one drag.
  if (st.sweep && mx * st.sweep.vx + my * st.sweep.vy === 0) {
    const px = x - st.sweep.vx, py = y - st.sweep.vy;
    if (hasRoad(px, py)) setCut(x, y, px, py, st.cutMode === 'cut');
    return;
  }
  if (st.cutMode === undefined) st.cutMode = isCut(prev.x, prev.y, x, y) ? 'join' : 'cut';
  if (!setCut(prev.x, prev.y, x, y, st.cutMode === 'cut')) { toast("Can't cut there. Drag across the gap between two roads (bridges can only be cut from the side; overpasses not at all)."); return; }
  const ux = my !== 0 ? 1 : 0, uy = mx !== 0 ? 1 : 0;                       // the direction along the roads, if they are parallel
  if ((hasRoad(prev.x + ux, prev.y + uy) && hasRoad(x + ux, y + uy)) || (hasRoad(prev.x - ux, prev.y - uy) && hasRoad(x - ux, y - uy))) st.sweep = { vx: mx, vy: my };
}


const PLACE_MSG = {
  none: 'Tap a road tile.', badtile: "Only a traffic light can go on a bridge, and nothing goes in a tunnel.", taken: 'That intersection already has one.',
  notjunction: 'Needs an intersection: 3 or more roads meeting.', empty: 'None left.',
  toonear: 'Too close to another light. Leave at least one tile between lights.',
  highway: 'Roundabouts only fit on regular streets.',
  mismatch: "An overpass needs the same road size on both sides of each road. One side here is a different size (check bridge ends and road/highway joins).",
  notcrossing: 'An overpass goes on a straight crossing of two roads (4 roads meeting, same size on both sides of each).',
  driveway: "The overpass can't come from a driveway. A building can only be at the end of the road that runs underneath it.",
};

const DEV = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname) || /[#&]dev\b/.test(location.hash);
const DEV_SPEED = { Numpad3: 3, Numpad4: 4, Numpad5: 5, Numpad6: 6, Numpad7: 7, Numpad8: 8, Numpad9: 9, Numpad0: 10 };

function apply(mode, x, y, st) {
  if (mode === 'build') stepBuild(st, x, y);
  else if (mode === 'destroy') { if (demolish(x, y)) play('destroy'); }
  else if (mode === 'cut') stepCut(st, x, y);
  else if (mode === 'place') { const r = placeSpecial(game.placing, x, y); if (r === 'flipped') toast('Swapped: the other road is on top now.'); else if (r !== 'ok') toast(PLACE_MSG[r]); else play('build'); }
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
      else if (e.button === 0 && spaceDown) { mode = 'pan'; spacePanned = true; }
      else if (e.button !== 0) return;
    }
    e.preventDefault();
    const t = tileAt(e.clientX, e.clientY);
    if (e.pointerType === 'mouse') { hover.x = t.x; hover.y = t.y; hover.show = true; }
    if (game.mode !== 'play') { pointers.delete(e.pointerId); return; }
    stroke = { mode, prevTile: null, span: null, button: e.button, bld: buildingAt(t.x, t.y), moved: false, last: t, start: t, lx: e.clientX, ly: e.clientY, applied: false, touch: e.pointerType !== 'mouse' };
    // Touch waits (a 2nd finger may be arriving for a pinch); mouse acts immediately.
    if (mode !== 'pan' && !stroke.touch) { apply(mode, t.x, t.y, stroke); stroke.applied = true; }
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
    stroke.moved = true;
    if (!stroke.applied) { apply(stroke.mode, stroke.start.x, stroke.start.y, stroke); stroke.applied = true; }
    for (const step of walk(stroke.last, t)) apply(stroke.mode, step.x, step.y, stroke);
    stroke.last = t;
  });

  const end = e => {
    if (!pointers.has(e.pointerId)) return;
    if (stroke && stroke.touch && !stroke.applied && stroke.mode !== 'pan' && e.type === 'pointerup') {
      apply(stroke.mode, stroke.start.x, stroke.start.y, stroke); // tap
    }
    // Click/tap on a building (without dragging) rotates it.
    if (stroke && stroke.bld && !stroke.moved && stroke.mode !== 'pan' && e.type === 'pointerup' && stroke.button !== 2) {
      // Tap the building to rotate it; tap a destination's parking lot to flip its gate to the other end.
      if (flipLotAt(stroke.start.x, stroke.start.y) || rotateBuildingAt(stroke.start.x, stroke.start.y)) play('rotate');
    }
    if (stroke && stroke.mode === 'cut' && stroke.cutMode === undefined && e.type === 'pointerup') toast('Drag across the seam between two roads to cut it. For side-by-side roads, cross once and keep dragging along them. Drag again to rejoin.');
    if (stroke && stroke.span) toast(`Drag all the way to the far side to finish the ${stroke.span.item}.`);
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

  // What each bindable action does (the keys themselves live in js/keys.js and config/keybinds.json). A hotkey that does what a toolbar/HUD button
  // does also makes that button's click sound (not while a key is held down). The pills (overpass, highway, ...) are clicked, so a key does exactly
  // what tapping the pill does, and only while that pill is showing.
  const clickPill = (id, press) => { const pill = document.querySelector(`#specials [data-special="${id}"]`); if (pill) press(() => pill.click()); };
  const clickBtn = (id, press) => { const b = document.getElementById(id); if (b && !b.hidden) press(() => b.click()); };
  const running = () => game.mode === 'play';
  const ACTION = {
    build: press => press(() => setTool('build')),
    destroy: press => press(() => setTool('destroy')),
    pan: press => press(() => setTool('pan')),
    cut: press => press(() => setTool('cut')),
    oneway: press => { if (game.unlocks.oneway) press(() => setOneWay(!game.oneway)); },
    bridge: press => press(() => { setTool('build'); toast((game.inv.bridge || 0) > 0 ? `Bridge ready (${game.inv.bridge}): drag from a road across the water to the far side.` : 'No bridges left. Get one from the Shop or a reward.'); }),
    tunnel: press => press(() => { setTool('build'); toast((game.inv.tunnel || 0) > 0 ? `Tunnel pieces: ${game.inv.tunnel}. Drag from a road into a hill: each block uses one.` : 'No tunnel pieces left. Get some from the Shop or a reward.'); }),
    highway: press => { if (running()) clickPill('highway', press); },
    overpass: press => { if (running()) clickPill('overpass', press); },
    roundabout: press => { if (running()) clickPill('roundabout', press); },
    light: press => { if (running()) clickPill('light', press); },
    rotate: () => { if (hover.show && rotateBuildingAt(hover.x, hover.y)) play('rotate'); },
    shop: press => { if (running()) clickBtn('shop-btn', press); },
    log: press => { if (running() || game.mode === 'pause') clickBtn('log-btn', press); },
    music: press => clickBtn('music-btn', press),
    gui: press => clickBtn('gui-btn', press),
    speed0: press => { if (running()) press(() => setSpeed(0)); },
    speed1: press => { if (running()) press(() => setSpeed(1)); },
    speed15: press => { if (running()) press(() => setSpeed(1.5)); },
    speed2: press => { if (running()) press(() => setSpeed(2)); },
  };
  addEventListener('keydown', e => {
    const press = fn => { if (!e.repeat) play('click'); fn(); };
    if (e.code === 'Escape') {
      // Esc closes the topmost window first (the keyboard list, then settings); only with none open does it pause / resume.
      const open = id => { const el = document.getElementById(id); return el && !el.hidden; };
      if (open('keys')) press(() => document.getElementById('keys-close').click());
      else if (open('settings')) press(() => document.getElementById('settings-close').click());
      else if (game.mode === 'play') press(() => setMode('pause')); else if (game.mode === 'pause') press(() => setMode('play'));
    }
    else if (e.code === 'Space') { if (!e.repeat) { spaceDown = true; spacePanned = false; } e.preventDefault(); }
    else if (e.ctrlKey || e.metaKey || e.altKey) return;                       // (Ctrl+S and friends belong to the browser)
    else if (DEV && e.shiftKey && DEV_SPEED[e.code] && game.mode === 'play') press(() => setDevSpeed(DEV_SPEED[e.code]));
    else { const id = actionOf(e); if (id && ACTION[id]) ACTION[id](press); else if (e.key === 'p') { if (devSpawn()) play('spawn'); } }      // (P: dev, spawn an extra pair)
  });
  addEventListener('keyup', e => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    if (spaceDown && !spacePanned && game.mode === 'play') { play('click'); toggleSpeed(); }
    spaceDown = false;
  });
}
