// Placeholder: proves the Pages pipeline. Real game starts at Milestone 1 (see DESIGN.md).
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const COLS = 24, ROWS = 16;

function draw() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const size = Math.floor(Math.min(innerWidth / COLS, innerHeight / ROWS));
  const ox = (innerWidth - size * COLS) / 2, oy = (innerHeight - size * ROWS) / 2;
  ctx.fillStyle = '#7fae6a';
  ctx.fillRect(ox, oy, size * COLS, size * ROWS);
  ctx.strokeStyle = 'rgba(0,0,0,.15)';
  for (let c = 0; c <= COLS; c++) { ctx.beginPath(); ctx.moveTo(ox + c * size, oy); ctx.lineTo(ox + c * size, oy + ROWS * size); ctx.stroke(); }
  for (let r = 0; r <= ROWS; r++) { ctx.beginPath(); ctx.moveTo(ox, oy + r * size); ctx.lineTo(ox + COLS * size, oy + r * size); ctx.stroke(); }
  ctx.fillStyle = '#fff';
  ctx.font = '600 24px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Road Warrior - under construction', innerWidth / 2, oy - 12 > 20 ? oy - 12 : 28);
}
addEventListener('resize', draw);
draw();
