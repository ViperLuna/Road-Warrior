// Timings come from config/tuning.json.
import { tuning } from './tuning.js';

// Approach groups for a light: [north/south sides present, east/west sides present].
export function lightGroups(conns) {
  return [conns.filter(d => d === 0 || d === 2), conns.filter(d => d === 1 || d === 3)];
}

export function signalState(road) {
  return road.sig || (road.sig = { axis: 0, stage: 'green', t: 0, dem: [0, 0] });
}

export function lightColor(sig, groups, side) {
  if (!groups[0].includes(side) && !groups[1].includes(side)) return 'red';
  if ((side & 1) !== sig.axis || sig.stage === 'allred') return 'red';
  return sig.stage;
}

export function lightHolds(sig, side, margin) {
  if (sig.stage !== 'green' || (side & 1) !== sig.axis) return false;
  if (!sig.dem[1 - sig.axis]) return true;
  const { minGreenSeconds: lo, maxGreenSeconds: hi, gapOutSeconds: gap } = tuning.trafficLight;
  return sig.dem[sig.axis] ? sig.t + margin <= hi : margin <= gap - (sig.gap || 0) || sig.t + margin <= lo;
}

export function stepLight(sig, dem, dt) {
  const { minGreenSeconds: lo, maxGreenSeconds: hi, gapOutSeconds: gap, yellowSeconds: Y, allRedSeconds: R } = tuning.trafficLight;
  sig.dem = dem; sig.t += dt;
  const own = dem[sig.axis], cross = dem[1 - sig.axis];
  sig.gap = own ? 0 : (sig.gap || 0) + dt;                    // how long the green axis has had nobody coming
  if (sig.stage === 'green') {
    // Gap-out: the green gives way once its own traffic has stopped for `gapOutSeconds` (a one-car hole in a stream doesn't count),
    // or at the hard cap of `maxGreenSeconds`, whatever is still coming. The same rules apply to both streets.
    if (cross && sig.t >= lo && (own ? sig.t >= hi : sig.gap >= gap)) { sig.stage = own ? 'yellow' : 'allred'; sig.t = 0; }
  } else if (sig.stage === 'yellow') {
    if (sig.t >= Y) { sig.stage = 'allred'; sig.t = 0; }
  } else if (sig.t >= R) { sig.stage = 'green'; sig.axis = 1 - sig.axis; sig.t = 0; sig.gap = 0; }
}
