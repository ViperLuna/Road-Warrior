import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function loadGame(overrides) {
  const { mulberry32 } = await import('../js/rng.js');
  const state = await import('../js/state.js');
  const { setTuning, tuning } = await import('../js/tuning.js');
  const { setProgression, setMaps, setMilestones, milestones, maps, prog } = await import('../js/progression.js');
  const json = f => JSON.parse(readFileSync(join(root, 'config', f), 'utf8'));
  state.setPalette(json('colors.json').colors);
  setTuning(json('tuning.json')); setProgression(json('progression.json')); setMilestones(json('milestones.json')); setMaps(json('maps.json'));
  for (const s of overrides) {
    const [path, raw] = s.split('='), keys = path.split('.');
    let o = keys[0] === 'tuning' ? tuning : keys[0] === 'progression' ? prog : keys[0] === 'milestones' ? milestones : null;
    if (!o) throw new Error('--set must start with tuning., progression. or milestones.');
    for (const k of keys.slice(1, -1)) o = o[k];
    o[keys.at(-1)] = JSON.parse(raw);
  }
  const save = await import('../js/save.js');
  return { mulberry32, state, tuning, maps, save };
}
