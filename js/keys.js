// Keyboard bindings. Every action has up to two keys. The defaults come from config/keybinds.json; what a player changes in Settings > Keyboard
// is saved in their browser (settings.keys) and wins over the default. A key is a "token": a lower-case letter ('b'), or the key's code for
// anything else ('Digit1', 'Numpad0', 'Slash'). Letters follow the character on the keycap (so other keyboard layouts work); the rest are by position.
import { settings, setSetting } from './settings.js';

let actions = [];                 // [{ id, label, keys }] in display order
let map = null;                   // token -> action id (built lazily, dropped whenever bindings change)
const listeners = new Set();
export const onKeys = fn => { listeners.add(fn); return () => listeners.delete(fn); };

// Keys that cannot be bound: they have a fixed job (Space pans / pauses, Escape is the menu) or belong to the browser.
const RESERVED = new Set(['Space', 'Escape', 'Tab', 'Enter', 'Backspace', 'F5', 'F11', 'F12']);
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'ContextMenu']);

export function setKeybinds(cfg) { if (cfg && Array.isArray(cfg.actions)) actions = cfg.actions.map(a => ({ id: a.id, label: a.label, keys: [...a.keys] })); map = null; }
export const actionList = () => actions;
export const labelOfAction = id => (actions.find(a => a.id === id) || {}).label || id;

// The token for a key event, or null for a key that is not bindable.
export function tokenOf(e) {
  if (MODIFIERS.has(e.key)) return null;
  const t = e.key && e.key.length === 1 && /[a-z]/i.test(e.key) ? e.key.toLowerCase() : e.code;
  return !t || RESERVED.has(t) || /^F\d+$/.test(t) ? null : t;
}
export const isReserved = e => RESERVED.has(e.code) || /^F\d+$/.test(e.code || '');

// What a token looks like to a person.
export function labelOf(t) {
  if (/^Digit\d$/.test(t)) return t.slice(5);
  if (/^Numpad\d$/.test(t)) return 'Num ' + t.slice(6);
  if (/^Numpad/.test(t)) return 'Num ' + t.slice(6);
  if (/^Key[A-Z]$/.test(t)) return t.slice(3);
  if (t.length === 1) return t.toUpperCase();
  return t.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export const keysOf = id => {
  const own = settings.keys && settings.keys[id];
  return own ? [...own] : [...((actions.find(a => a.id === id) || {}).keys || [])];
};
export const keyText = id => { const k = keysOf(id); return k.length ? k.map(labelOf).join(' / ') : 'unbound'; };
export const titleFor = (id, name) => { const k = keysOf(id); return k.length ? `${name} (${k.map(labelOf).join(' / ')})` : name; };

function build() { map = new Map(); for (const a of actions) for (const t of keysOf(a.id)) if (!map.has(t)) map.set(t, a.id); return map; }
export const actionOf = e => { const t = tokenOf(e); return t ? (map || build()).get(t) || null : null; };
export const actionOfToken = t => (map || build()).get(t) || null;

// Which of these tokens are already another action's? -> [{ token, other }]
export function conflicts(id, tokens) {
  const out = [];
  for (const t of tokens) { const o = actionOfToken(t); if (o && o !== id) out.push({ token: t, other: o }); }
  return out;
}

function store(id, tokens) {
  settings.keys = { ...(settings.keys || {}), [id]: tokens.slice(0, 2) };
  setSetting('keys', settings.keys);
  map = null;
}

// Set an action's keys. With conflicts, `swap` hands each clashing key to this action and gives the other action one of this action's old keys
// in its place (so nothing is silently lost). Returns false if there are conflicts and swap was not allowed.
export function bind(id, tokens, swap = false) {
  tokens = [...new Set(tokens)].slice(0, 2);
  const cs = conflicts(id, tokens);
  if (cs.length && !swap) return false;
  const prev = keysOf(id);
  for (const { token, other } of cs) {
    const rest = keysOf(other).filter(t => t !== token);
    const give = prev.find(t => !tokens.includes(t) && !rest.includes(t) && !cs.some(c => c.other === other && c.token === t));
    if (give && rest.length < 2) rest.push(give);
    store(other, rest);
  }
  store(id, tokens);
  listeners.forEach(fn => fn());
  return true;
}

// What pressing one key or two does to an action that has `old` keys: one key replaces the first, keeping the second; two replace both.
export const mergeKeys = (old, pressed) => (pressed.length >= 2 ? pressed.slice(0, 2) : [pressed[0], ...old.slice(1).filter(t => t !== pressed[0])].slice(0, 2));

export function resetKeys() { settings.keys = {}; setSetting('keys', {}); map = null; listeners.forEach(fn => fn()); }

// ---- capture: "press a key (or two)" ----
let capturing = null;
export const isCapturing = () => !!capturing;
// Listens for up to two keys within `windowMs` of the first. done(tokens) gets 1 or 2 tokens; Backspace gives [] (unbind); Escape cancels (cancel()).
export function startCapture(done, cancel = () => {}, windowMs = 1500) {
  stopCapture();
  const got = []; let timer = 0;
  const finish = () => { stopCapture(); got.length ? done(got) : cancel(); };
  const onKey = e => {
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.code === 'Escape') { stopCapture(); cancel(); return; }
    if (e.code === 'Backspace') { stopCapture(); done([]); return; }
    const t = tokenOf(e);
    if (!t || got.includes(t)) return;
    got.push(t);
    if (got.length >= 2) { clearTimeout(timer); finish(); } else timer = setTimeout(finish, windowMs);
  };
  addEventListener('keydown', onKey, true);
  capturing = { stop: () => { clearTimeout(timer); removeEventListener('keydown', onKey, true); } };
}
export function stopCapture() { if (capturing) { capturing.stop(); capturing = null; } }
