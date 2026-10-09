import { unlock } from './audio.js';
import { game, newGame } from './state.js';
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

function startMap(seed) {
  newGame(seed);
  fitView(game.cols, game.rows);
  history.replaceState(null, '', '#seed=' + game.seed);
}

const randomSeed = () => (Math.random() * 1e9) >>> 0;
const hashSeed = () => { const m = location.hash.match(/seed=(\d+)/); return m ? Number(m[1]) : null; };

initHud({ onNewMap: () => startMap(randomSeed()) });
initInput(canvas);
addEventListener('resize', resize);
resize();
startMap(hashSeed() ?? randomSeed());

(function frame() {
  render(ctx, W, H, dpr, game, cam, hover);
  requestAnimationFrame(frame);
})();
