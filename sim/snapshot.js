import { serialize, restore } from '../js/save.js';
import { netVersion } from '../js/network.js';

export function snapshot(g) {
  const a = g.accident;
  return {
    save: serialize(g),
    speed: g.speed, mode: g.mode, over: g.over,
    accident: a ? { ...a, cars: a.cars.map((c) => c.id), police: a.police.map((p) => ({ ...p })) } : null,
    nextAccidentAt: g.nextAccidentAt,
    jams: (g.jams || []).map((j) => ({ ...j })), jamQuiet: (g.jamQuiet || []).map((j) => ({ ...j })), jamT: g.jamT,
    watches: new Map((g.watches || []).map((w) => [w.key, w.ok])), netEditedAt: g.netEditedAt, evalT: g.evalT,
    visitorsLaunched: g.visitorsLaunched,
    cars: new Map(g.cars.map((c) => [c.id, Object.fromEntries(Object.entries(c).filter(([, v]) => v === null || (typeof v !== 'object' && typeof v !== 'function')))])),
  };
}

export function load(g, s) {
  restore(s.save, g);
  g.speed = s.speed;
  if (s.mode === 'over') { g.mode = 'over'; g.over = s.over; }
  for (const c of g.cars) if (s.cars.has(c.id)) Object.assign(c, s.cars.get(c.id));
  const byId = new Map(g.cars.map((c) => [c.id, c]));
  g.accident = s.accident ? { ...s.accident, cars: s.accident.cars.map((id) => byId.get(id)).filter(Boolean), police: s.accident.police.map((p) => ({ ...p })) } : null;
  if (g.accident) for (const c of g.accident.cars) c.crash = true;
  g.nextAccidentAt = s.nextAccidentAt;
  g.jams = s.jams.map((j) => ({ ...j })); g.jamQuiet = s.jamQuiet.map((j) => ({ ...j })); g.jamT = s.jamT;
  for (const w of g.watches) if (s.watches.has(w.key)) w.ok = s.watches.get(w.key);
  g.seenNet = netVersion(); g.netEditedAt = s.netEditedAt; g.evalT = s.evalT;
  g.visitorsLaunched = s.visitorsLaunched;
}
