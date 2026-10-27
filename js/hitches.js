// Hitch recorder, off unless the page is opened with #perf (e.g. .../index.html#perf). Every frame that takes longer than `limitMs` is written
// to a small panel (and the console) with where the time went: the sim steps, the drawing, and "elsewhere" (the browser: garbage collection,
// page layout, timers such as the autosave). Long tasks the browser reports are listed too. Tap the panel to copy the lines.
const limitMs = 25, keep = 12;
export const on = typeof location !== 'undefined' && /[#&]perf\b/.test(location.hash);

let panel = null, lines = [], simMs = 0, drawMs = 0, lastStart = 0, timers = [];

export function begin(now) { lastStart = now; simMs = 0; drawMs = 0; }
export function addSim(ms) { simMs += ms; }
export function addDraw(ms) { drawMs += ms; }

// Time a function that runs outside the frame (a timer, the autosave) so a hitch can be pinned on it.
export function timed(name, fn) {
  if (!on) return fn;
  return (...a) => { const t0 = performance.now(); try { return fn(...a); } finally { timers.push(`${name} ${(performance.now() - t0).toFixed(1)}`); } };
}

export const note = {};                                   // set by main.js: what the page looks like (canvas size, zoom, speed)
let honks = 0, huds = 0;
export const count = what => { if (what === 'honk') honks++; else huds++; };

export function end(gap, game) {
  if (gap < limitMs) { timers.length = 0; honks = 0; return; }
  const used = performance.now() - lastStart;
  const line = `${game.time.toFixed(0)}s  frame ${gap.toFixed(0)} ms  (sim ${simMs.toFixed(1)}, draw ${drawMs.toFixed(1)}, rest of frame ${(used - simMs - drawMs).toFixed(1)})  cars ${game.cars.length}  roads ${game.roads.size}  speed ${game.speed}x  honks ${honks}  ${note.info ? note.info() : ''}${timers.length ? '  timers: ' + timers.join(', ') : ''}`;
  timers.length = 0; honks = 0;
  show(line);
}

function show(line) {
  console.log('[hitch]', line);
  lines.push(line); if (lines.length > keep) lines.shift();
  if (!panel) {
    panel = document.createElement('pre');
    panel.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:99;margin:0;padding:6px 8px;max-width:96vw;overflow:hidden;font:11px/1.35 monospace;color:#cfe;background:rgba(0,0,0,.75);border-radius:6px;white-space:pre-wrap';
    panel.addEventListener('click', () => { try { navigator.clipboard.writeText(lines.join('\n')); } catch { /* no clipboard */ } });
    document.body.appendChild(panel);
  }
  panel.textContent = 'hitches (tap to copy)\n' + lines.join('\n');
}

if (on && 'PerformanceObserver' in globalThis) {
  // Chrome's long animation frames say where a slow frame went: our scripts, or the browser's own style / layout / painting.
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) {
      if (e.duration < limitMs) continue;
      const sc = (e.scripts || []).map(x => `${x.invoker || x.sourceFunctionName || 'script'} ${x.duration.toFixed(0)}`).join(', ');
      show(`slow frame ${e.duration.toFixed(0)} ms: scripts ${(e.renderStart - e.startTime).toFixed(0)}, style+layout ${(e.renderStart ? e.styleAndLayoutStart && e.renderStart ? (e.startTime + e.duration - e.styleAndLayoutStart).toFixed(0) : '?' : '?')}, blocked ${(e.blockingDuration || 0).toFixed(0)}${sc ? '  [' + sc + ']' : ''}`);
    } }).observe({ type: 'long-animation-frame', buffered: false });
  } catch { /* not supported */ }
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) show(`browser long task ${e.duration.toFixed(0)} ms`); }).observe({ entryTypes: ['longtask'] }); } catch { /* not supported */ }
}
