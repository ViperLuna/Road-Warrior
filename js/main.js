import { unlock } from './audio.js';
import { game, newGame, setPalette, setMode, tick } from './state.js';
import { setTuning } from './tuning.js';
import { setProgression, setMaps, maps } from './progression.js';
import { resizeView, fitView, cam } from './camera.js';
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
for (const [url, apply] of [['config/tuning.json', setTuning], ['config/progression.json', setProgression], ['config/maps.json', setMaps]]) {
  try { apply(await loadJson(url)); } catch (e) { console.warn(url + ' not loaded, using defaults', e); }
}

initHud({
  onPlay: map => startMap(map),
  onRestart: () => startMap(game.map),
  onToMenu: () => setMode('menu'),
});
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
