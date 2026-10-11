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
  const { minGreenSeconds: lo, maxGreenSeconds: hi } = tuning.trafficLight;
  return sig.t + margin <= (sig.dem[sig.axis] ? hi : lo);
}

export function stepLight(sig, dem, dt) {
  const { minGreenSeconds: lo, maxGreenSeconds: hi, yellowSeconds: Y, allRedSeconds: R } = tuning.trafficLight;
  sig.dem = dem; sig.t += dt;
  const own = dem[sig.axis], cross = dem[1 - sig.axis];
  if (sig.stage === 'green') {
    if (cross && sig.t >= lo && (!own || sig.t >= hi)) { sig.stage = own ? 'yellow' : 'allred'; sig.t = 0; }
  } else if (sig.stage === 'yellow') {
    if (sig.t >= Y) { sig.stage = 'allred'; sig.t = 0; }
  } else if (sig.t >= R) { sig.stage = 'green'; sig.axis = 1 - sig.axis; sig.t = 0; }
}
