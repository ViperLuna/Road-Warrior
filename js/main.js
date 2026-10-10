import { unlock } from './audio.js';
import { game, newGame, setPalette, setMode, tick, onChange } from './state.js';
import { setTuning } from './tuning.js';
import { setProgression, setMaps, maps } from './progression.js';
import { resizeView, fitView, cam, clampCam } from './camera.js';
import { configure, restore, saveNow, loadSaved, clearSave, describeSave, startAutosave } from './save.js';
import { render } from './render.js';
import { initInput, hover } from './input.js';
import { initHud } from './hud.js';

const splash = document.getElementById('splash');
document.getElementById('start').addEventListener('click', async () => {
  await unlock();
  splash.classList.add('hide');
  setTimeout(() => splash.remove(), 400);
});

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, dpr = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  W = innerWidth; H = innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  resizeView(W, H);
}

const randomSeed = () => (Math.random() * 1e9) >>> 0;
let devSeed = (() => { const m = location.hash.match(/seed=(\d+)/); return m ? Number(m[1]) : null; })();   // #seed=123 replays a map once

function startMap(map) {
  newGame(devSeed ?? randomSeed(), map);
  devSeed = null;
  fitView(game.cols, game.rows);
  history.replaceState(null, '', '#seed=' + game.seed);
}

const loadJson = url => fetch(url).then(r => r.json());
setPalette((await loadJson('config/colors.json')).colors);
for (const [url, apply] of [['config/tuning.json', setTuning], ['config/progression.json', setProgression], ['config/maps.json', setMaps], ['config/save.json', configure]]) {
  try { apply(await loadJson(url)); } catch (e) { console.warn(url + ' not loaded, using defaults', e); }
}

// The main menu's History window shows history.txt from the site root (hidden if there isn't one).
fetch('history.txt', { cache: 'no-cache' }).then(r => (r.ok ? r.text() : '')).then(t => {
  if (!t.trim() || /^\s*<(!doctype|html)/i.test(t)) return;                     // missing file, or a host's HTML 404 page
  document.getElementById('history-text').textContent = t.trim();
  document.getElementById('history').hidden = false;
}).catch(() => {});

// Save games: the whole game, every car included, is written every few seconds and when the page goes away.
let saveInfo = null;
const refreshSaveInfo = async () => { saveInfo = await describeSave(); };
const view = () => ({ view: { x: cam.x, y: cam.y, z: cam.z } });
await refreshSaveInfo();

async function continueGame() {
  const d = await loadSaved();
  if (!d) return;
  try { restore(d); } catch (e) { console.error('could not load the save', e); return; }
  if (d.view) Object.assign(cam, d.view); else fitView(game.cols, game.rows);
  clampCam();
  history.replaceState(null, '', '#seed=' + game.seed);
}

initHud({
  onPlay: map => startMap(map),
  onRestart: () => startMap(game.map),
  onToMenu: async () => { await saveNow(view()); await refreshSaveInfo(); setMode('menu'); },
  onContinue: continueGame,
  getSaveInfo: () => saveInfo,
});
startAutosave(view);
let wasOver = false;
onChange(g => { if (g.mode === 'over' && !wasOver) { wasOver = true; clearSave().then(refreshSaveInfo); } else if (g.mode !== 'over') wasOver = false; });
initInput(canvas);
addEventListener('resize', resize);
resize();

// A backdrop map behind the menu, then wait for the player to pick one.
newGame(randomSeed(), maps[0]);
game.time = 1;                    // let the backdrop's buildings finish their pop-in
fitView(game.cols, game.rows);
setMode('menu');

const STEP = 1 / 60;
let last = performance.now(), acc = 0;
(function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000); last = now;
  while (acc >= STEP) { tick(STEP); acc -= STEP; }
  render(ctx, W, H, dpr, game, cam, hover);
  requestAnimationFrame(frame);
})(last);
