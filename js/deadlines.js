// Patience. Everything the player has to keep connected is a "watch" with a countdown:
//   a house     needs a road to a destination of its color,
//   a destination needs a road from a house of each color it takes,
//   the stadium needs a road from houses of every color in play,
//   the side-road gates (one shared watch for a wave of them) must reach the stadium and a destination of every color.
// Unconnected, a watch first runs a silent grace period, then a warning period (toast + glow + countdown), then the game is over.
// Connected again, it resets. A connection that breaks later starts the whole countdown over (with a toast).
// A connection only counts as broken once the roads have been left alone for settleSeconds, so building a road does not nag.
// Path checks wait for the roads to go quiet (quietSeconds), so dragging a long line of road does not check on every tile.
// A "no longer connected" toast is just a toast (not logged); if the building is still not connected when its warning stage starts, that warning is logged.
// Only advances while the game runs (a paused game, or a popup waiting for [OK], stops every clock). Numbers: tuning.deadlines.
import { tuning } from './tuning.js';
import { reachablePorts } from './pathfind.js';
import { netVersion } from './network.js';
import { DIR, OPP } from './lanes.js';
import { bounds } from './buildings.js';

const GROUP = { house: 'house', dest: 'house', stadium: 'stadium', gates: 'gates' };
export const cfgOf = w => tuning.deadlines[GROUP[w.kind]];
const colorsInPlay = g => g.palette.slice(0, Math.max(1, g.colorsUsed));
// How many of n things must be connected: at least one when the setting is 0, otherwise that percentage (rounded up, never less than one).
export const needOf = n => (n <= 0 ? 0 : tuning.deadlines.requiredPercent > 0 ? Math.max(1, Math.ceil(tuning.deadlines.requiredPercent / 100 * n)) : 1);
const byId = (g, id) => g.buildings.find(b => b.id === id);

export function labelOf(g, w) {
  const b = byId(g, w.ids[0]);
  if (w.kind === 'stadium') return 'The stadium';
  if (w.kind === 'gates') return w.ids.length > 1 ? 'The side roads' : 'The side road';
  if (!b) return 'A building';
  return w.kind === 'house' ? `The ${b.color.id} house` : `The ${b.color.id}${b.color2 ? ' and ' + b.color2.id : ''} destination`;
}
export const spotsOf = (g, w) => w.ids.map(id => byId(g, id)).filter(Boolean).map(bounds);

const newWatch = (kind, ids, extra = {}) => ({ key: kind[0] + ids.join('+'), kind, ids, ack: true, stage: 'grace', t: 0, ok: false, fresh: true, ...extra });

// Make sure there is a watch for every building that needs one, and none for buildings that are gone.
function sync(g) {
  const list = g.watches || (g.watches = []), have = new Map(list.map(w => [w.key, w]));
  const add = w => { if (!have.has(w.key)) { list.push(w); have.set(w.key, w); } };
  for (const b of g.buildings) {
    if (b.kind === 'house') add(newWatch('house', [b.id]));
    else if (b.kind === 'dest' && !b.stadium) add(newWatch('dest', [b.id]));
    else if (b.stadium) add(newWatch('stadium', [b.id]));
  }
  const grouped = new Set(list.filter(w => w.kind === 'gates').flatMap(w => w.ids));
  const loose = g.buildings.filter(b => b.kind === 'portal' && !grouped.has(b.id)).map(b => b.id);
  if (loose.length) add(newWatch('gates', loose));
  g.watches = list.filter(w => { w.ids = w.ids.filter(id => byId(g, id)); return w.ids.length; });
}

// Which watches are connected right now: one flood fill per house and per gate.
function evaluate(g) {
  sync(g);
  const houses = g.buildings.filter(b => b.kind === 'house'), dests = g.buildings.filter(b => b.kind === 'dest' && !b.stadium);
  const arena = g.buildings.find(b => b.stadium), gates = g.buildings.filter(b => b.kind === 'portal');
  const portsOf = new Map();                                                       // building id -> its port tiles
  for (const [k, p] of g.ports) (portsOf.get(p.b.id) || portsOf.set(p.b.id, []).get(p.b.id)).push(k);
  const reach = new Map();
  for (const b of [...houses, ...gates]) {
    const rx = b.x + DIR[b.rot][0], ry = b.y + DIR[b.rot][1];
    reach.set(b.id, reachablePorts(g, rx, ry, OPP[b.rot]));
  }
  const reaches = (from, target) => (portsOf.get(target.id) || []).some(k => reach.get(from.id).has(k));
  const colors = colorsInPlay(g), takes = (d, c) => d.color.id === c.id || (d.color2 && d.color2.id === c.id);
  for (const w of g.watches) {
    const b = byId(g, w.ids[0]);
    if (w.kind === 'house') { w.ok = dests.some(d => takes(d, b.color) && reaches(b, d)); w.detail = null; }
    else if (w.kind === 'dest') {
      let ok = true;
      for (const c of [b.color, b.color2].filter(Boolean)) {
        const mine = houses.filter(h => h.color.id === c.id);
        if (mine.length && mine.filter(h => reaches(h, b)).length < needOf(mine.length)) ok = false;
      }
      w.ok = ok; w.detail = null;
    } else if (w.kind === 'stadium') {
      let have = 0, total = 0;
      for (const c of colors) {
        const mine = houses.filter(h => h.color.id === c.id);
        if (!mine.length) continue;
        total++; if (mine.filter(h => reaches(h, b)).length >= needOf(mine.length)) have++;
      }
      w.ok = have === total; w.detail = { have, total, what: 'colors connected' };
    } else {                                                                      // gates
      let ok = !!arena, have = 0, total = 0, stadiumOk = 0;
      const gs = w.ids.map(id => byId(g, id));
      for (const gate of gs) {
        const toArena = !!arena && reaches(gate, arena);
        if (toArena) stadiumOk++; else ok = false;
        for (const c of colors) {
          const all = dests.filter(d => takes(d, c));
          if (!all.length) continue;
          total++; if (all.filter(d => reaches(gate, d)).length >= needOf(all.length)) have++; else ok = false;
        }
      }
      w.ok = ok; w.detail = { have, total, gates: gs.length, stadiumOk, what: 'colors connected' };
    }
    if (w.fresh) { w.fresh = false; if (w.ok) { w.stage = 'ok'; w.t = 0; } }
  }
}

const keyOf = g => netVersion() + ':' + g.buildings.length + ':' + g.colorsUsed + ':' + g.roads.size + ':' + tuning.deadlines.requiredPercent;
// Re-check connections if anything that could change them has changed (nothing happens otherwise). The caller decides WHEN: the game loop
// waits until the roads have been left alone for quietSeconds, and the HUD debounces, so pulling a long line of road (or demolishing one)
// is not a path check per tile.
export function refreshWatches(g, force = false) {
  const key = keyOf(g);
  if (!force && key === g.watchKey && g.watches) return;
  g.watchKey = key;
  evaluate(g);
}

// Advance the clocks. Returns { kind, label, text } if the game is lost, else null.
export function stepWatches(g, dt, notify) {
  const v = netVersion();
  if (g.seenNet !== v) { g.seenNet = v; g.netEditedAt = g.time; }                      // the player (or the game) just changed the roads
  g.evalT = (g.evalT || 0) + dt;
  if (g.evalT >= 0.25 || !g.watchKey) {                                                  // (look about four times a second, and only when the roads have gone quiet)
    g.evalT = 0;
    if (!g.watchKey || g.time - (g.netEditedAt ?? -1e9) >= tuning.deadlines.quietSeconds) refreshWatches(g);
  }
  const settled = g.time - (g.netEditedAt ?? -1e9) >= tuning.deadlines.settleSeconds;   // ...give the new layout a moment before judging it
  for (const w of g.watches) {
    if (!w.ack) continue;
    const cfg = cfgOf(w);
    if (w.ok) { if (w.stage !== 'ok') { w.stage = 'ok'; w.t = 0; } continue; }
    if (w.stage === 'ok' && !settled) continue;                                         // (still being edited: not "disconnected" yet)
    if (w.stage === 'ok') { w.stage = 'grace'; w.t = 0; notify({ type: 'disconnected', key: w.key, kind: w.kind, label: labelOf(g, w), spots: spotsOf(g, w) }) }
    w.t += dt;
    if (w.stage === 'grace' && w.t >= cfg.graceSeconds) {
      w.stage = 'warn'; w.t = 0;
      notify({ type: 'impatient', key: w.key, kind: w.kind, label: labelOf(g, w), seconds: cfg.warnSeconds, spots: spotsOf(g, w) });
    } else if (w.stage === 'warn' && w.t >= cfg.warnSeconds) {
      return { kind: w.kind, label: labelOf(g, w), spots: spotsOf(g, w) };
    }
  }
  return null;
}

// Seconds left on a watch's clock while it is counting down, or null.
export const remaining = w => (!w.ok && w.ack && w.stage !== 'ok' ? Math.max(0, (w.stage === 'grace' ? cfgOf(w).graceSeconds + cfgOf(w).warnSeconds : cfgOf(w).warnSeconds) - (w.stage === 'grace' ? w.t : w.t)) : null);

// ---- the stadium and the gates ask the player to read a message first ----
const secs = k => `${tuning.deadlines[k].graceSeconds} seconds to start building, then ${tuning.deadlines[k].warnSeconds} seconds of warning`;
const rule = () => (tuning.deadlines.requiredPercent > 0 ? `at least ${tuning.deadlines.requiredPercent}% of each color` : 'at least one of each color');

export function addStadiumWatch(g, stadium) {
  sync(g);
  const w = g.watches.find(x => x.kind === 'stadium');
  if (!w) return;
  w.ack = false; w.stage = 'grace'; w.t = 0;
  w.notice = { title: 'A stadium has been donated to the city!', text: `It takes any color of car, and big crowds will come for it. It must be connected to houses of every color (${rule()}). You get ${secs('stadium')}. If it is still not connected when that runs out, the game is over. Pausing the game stops the clock.` };
  raiseNotice(g);
}

export function addGateWatch(g, gates, edgeNames) {
  sync(g);
  const w = g.watches.find(x => x.kind === 'gates' && gates.some(b => x.ids.includes(b.id)));
  if (!w) return;
  w.ack = false; w.stage = 'grace'; w.t = 0;
  const where = edgeNames.length > 1 ? edgeNames.slice(0, -1).join(', ') + ' and ' + edgeNames.at(-1) : edgeNames[0];
  w.notice = { title: edgeNames.length > 1 ? 'New roads to other cities!' : 'A new road to another city!', text: `${edgeNames.length > 1 ? 'Side roads have' : 'A side road has'} appeared on the ${where} ${edgeNames.length > 1 ? 'edges' : 'edge'} of the map. ${edgeNames.length > 1 ? 'Each one' : 'It'} must be connected to the stadium and to destinations of every color (${rule()}), and cars from outside will start arriving. You get ${secs('gates')}. If any of them is still not connected when that runs out, the game is over. Pausing the game stops the clock.` };
  raiseNotice(g);
}

export const pendingNotice = g => (g.watches || []).find(w => !w.ack && w.notice) || null;
export function raiseNotice(g) { if (pendingNotice(g) && g.mode === 'play') g.mode = 'notice'; }
// [OK]: the clock starts.
export function ackNotice(g) {
  const w = pendingNotice(g);
  if (w) { w.ack = true; w.t = 0; }
  if (!pendingNotice(g) && g.mode === 'notice') g.mode = 'play';
}

// Countdown chips for the HUD: the stadium and the gates while they are not connected.
export function chipsOf(g) {
  return (g.watches || []).filter(w => (w.kind === 'stadium' || w.kind === 'gates') && !w.ok && w.stage !== 'ok').map(w => ({
    key: w.key, kind: w.kind, label: labelOf(g, w), waiting: !w.ack, warn: w.stage === 'warn', left: remaining(w), detail: w.detail, spots: spotsOf(g, w),
  }));
}
