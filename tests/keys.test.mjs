import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('../', import.meta.url));
const K = await import(R + 'js/keys.js');
const { settings } = await import(R + 'js/settings.js');
const cfg = JSON.parse(fs.readFileSync(R + 'config/keybinds.json'));
K.setKeybinds(cfg);
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
const ev = (key, code) => ({ key, code: code || (key.length === 1 && /[a-z]/i.test(key) ? 'Key' + key.toUpperCase() : key) });

// ---- the defaults ----
const ids = K.actionList().map(a => a.id);
for (const want of ['build', 'destroy', 'pan', 'cut', 'oneway', 'bridge', 'tunnel', 'highway', 'overpass', 'roundabout', 'light', 'rotate', 'shop', 'log', 'music', 'speed0', 'speed1', 'speed15', 'speed2'])
  ok(ids.includes(want), 'action ' + want + ' exists');
const seen = new Map(); let dup = null;
for (const a of cfg.actions) for (const t of a.keys) { if (seen.has(t)) dup = t; seen.set(t, a.id); }
ok(!dup, 'no key is the default of two actions (' + dup + ')');
ok(K.keysOf('build').join() === 'Digit1,b' && K.keyText('build') === '1 / B', 'Build is 1 / B');
ok(K.actionOf(ev('b')) === 'build' && K.actionOf(ev('B')) === 'build', 'B (and shift-B) is Build');
ok(K.actionOf(ev('1', 'Digit1')) === 'build' && K.actionOf(ev('1', 'Numpad1')) === 'speed1', 'number row 1 is Build, numpad 1 is speed 1x (different keys)');
ok(K.actionOf(ev('s')) === 'shop' && K.actionOf(ev('l')) === 'log' && K.actionOf(ev('o')) === 'roundabout' && K.actionOf(ev('v')) === 'overpass' && K.actionOf(ev('h')) === 'highway', 'the pill and panel keys');
ok(K.actionOf(ev(' ', 'Space')) === null && K.actionOf(ev('Escape', 'Escape')) === null && K.actionOf(ev('Shift', 'ShiftLeft')) === null, 'Space, Escape and modifiers are never actions');
ok(K.actionOf(ev('z')) === null, 'an unbound key does nothing');
ok(K.labelOf('Numpad0') === 'Num 0' && K.labelOf('Digit5') === '5' && K.labelOf('b') === 'B' && K.labelOf('Slash') === 'Slash', 'labels read well');
ok(K.titleFor('shop', 'Shop') === 'Shop (S)', 'tooltip text');

// ---- rebinding ----
ok(K.bind('shop', ['p']) === true && K.actionOf(ev('p')) === 'shop' && K.actionOf(ev('s')) === null, 'rebind Shop to P: P opens it, S no longer does');
ok(settings.keys.shop.join() === 'p', 'and it is kept in the settings (saved in the browser)');
ok(K.bind('log', ['p']) === false && K.actionOf(ev('p')) === 'shop', 'a key that is already used is refused unless you agree to swap');
ok(K.conflicts('log', ['p']).length === 1 && K.conflicts('log', ['p'])[0].other === 'shop', 'the conflict names the other action');
ok(K.bind('log', ['p'], true) === true && K.actionOf(ev('p')) === 'log', 'swapping gives the key to the new action');
ok(K.keysOf('shop').join() === 'l', 'and gives the other action the old key in return (nothing lost): Shop now has L');
ok(K.bind('build', ['x', 'y']) && K.keysOf('build').join() === 'x,y' && K.keyText('build') === 'X / Y', 'two keys at once fill both slots: X / Y');
ok(K.actionOf(ev('x')) === 'build' && K.actionOf(ev('y')) === 'build' && K.actionOf(ev('b')) === null && K.actionOf(ev('1', 'Digit1')) === null, 'the old keys no longer work');
ok(K.mergeKeys(['Digit1', 'b'], ['x']).join() === 'x,b' && K.mergeKeys(['Digit1', 'b'], ['x', 'y']).join() === 'x,y' && K.mergeKeys(['Digit1'], ['Digit1']).join() === 'Digit1', 'one key replaces the first slot and keeps the second; two replace both');
ok(K.bind('cut', []) && K.keyText('cut') === 'unbound' && K.actionOf(ev('c')) === null, 'Backspace (empty) leaves an action unbound');
ok(K.bind('destroy', ['d', 'd']) && K.keysOf('destroy').join() === 'd', 'the same key twice is one key');
K.resetKeys();
ok(K.keysOf('build').join() === 'Digit1,b' && K.actionOf(ev('b')) === 'build' && K.actionOf(ev('c')) === 'cut' && K.keysOf('shop').join() === 's', 'Reset puts every default back');
console.log(pass, 'passed', fail, 'failed'); process.exit(fail ? 1 : 0);
