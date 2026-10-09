// DOM overlay: inventory pills, tool buttons, toasts.
import { game, onChange, setTool } from './state.js';

let toastEl, toastTimer = 0, lastMsg = '', lastAt = 0;

export function toast(msg) {
  const now = performance.now();
  if (msg === lastMsg && now - lastAt < 1500) return;
  lastMsg = msg; lastAt = now;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

export function initHud({ onNewMap }) {
  toastEl = document.getElementById('toast');
  const nRoad = document.getElementById('n-road');
  const nBridge = document.getElementById('n-bridge');
  const nTrips = document.getElementById('n-trips');
  const nMoney = document.getElementById('n-money');
  const seedEl = document.getElementById('seed');
  const buttons = document.querySelectorAll('#toolbar button');
  const canvas = document.getElementById('game');
  const cursors = { build: 'crosshair', destroy: 'not-allowed', pan: 'grab' };

  // pointerdown for instant response on touch; click keeps keyboard activation working.
  buttons.forEach(b => {
    const pick = () => setTool(b.dataset.tool);
    b.addEventListener('pointerdown', pick);
    b.addEventListener('click', pick);
  });
  document.getElementById('newmap').addEventListener('click', onNewMap);

  onChange(() => {
    nRoad.textContent = game.inv.road;
    nBridge.textContent = game.inv.bridge;
    nTrips.textContent = game.trips;
    nMoney.textContent = '$' + game.money;
    seedEl.textContent = 'Seed ' + game.seed;
    buttons.forEach(b => b.classList.toggle('active', b.dataset.tool === game.tool));
    canvas.style.cursor = cursors[game.tool];
    document.getElementById('pill-road').classList.toggle('empty', game.inv.road === 0);
  });
}
