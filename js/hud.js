// DOM overlay: inventory pills, goal bar, shop, toolbar, toasts, and the menu / reward / pause / game-over screens.
import { game, onChange, onEvent, setTool, setMode, setOneWay, setBuild4, selectSpecial, chooseReward, buy, bestFor, isUnlocked } from './state.js';
import { maps, prog, roadsAvailable } from './progression.js';

let toastEl, toastTimer = 0, lastMsg = '', lastAt = 0;
const $ = id => document.getElementById(id);

export function toast(msg) {
  const now = performance.now();
  if (msg === lastMsg && now - lastAt < 1500) return;
  lastMsg = msg; lastAt = now;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function initHud({ onPlay, onRestart, onToMenu, onContinue = () => {}, getSaveInfo = () => null }) {
  toastEl = $('toast');
  const buttons = document.querySelectorAll('#toolbar button[data-tool]');
  const canvas = $('game');
  const cursors = { cut: 'crosshair', build: 'crosshair', destroy: 'not-allowed', pan: 'grab', place: 'cell' };

  // pointerdown for instant response on touch; click keeps keyboard activation working.
  buttons.forEach(b => {
    const pick = () => setTool(b.dataset.tool);
    b.addEventListener('pointerdown', pick);
    b.addEventListener('click', pick);
  });
  $('oneway-btn').addEventListener('click', () => { setOneWay(!game.oneway); toast(game.oneway ? 'One-way on: drag along a road to set its direction.' : 'One-way off: dragging along a road makes it two-way.'); });
  $('menu-btn').addEventListener('click', () => setMode('pause'));
  $('shop-btn').addEventListener('click', () => { $('shop').hidden = !$('shop').hidden; render(); });
  $('shop-close').addEventListener('click', () => { $('shop').hidden = true; });
  $('resume').addEventListener('click', () => setMode('play'));
  $('restart').addEventListener('click', onRestart);
  $('again').addEventListener('click', onRestart);
  $('to-menu').addEventListener('click', onToMenu);
  $('over-menu').addEventListener('click', onToMenu);

  function buildMenu() {
    const list = $('map-list');
    list.innerHTML = '';
    const sv = getSaveInfo();
    if (sv) {
      const b = document.createElement('button');
      b.className = 'card continue'; b.type = 'button';
      const mins = Math.floor(sv.time / 60);
      b.innerHTML = `<h3>Continue</h3><p>${sv.map}: ${sv.trips} trips, ${mins} min in</p><p>Traffic exactly where you left it</p>`;
      b.addEventListener('click', onContinue);
      list.appendChild(b);
    }
    for (const m of maps) {
      const b = document.createElement('button');
      b.className = 'card'; b.type = 'button';
      const ok = isUnlocked(m), best = bestFor(m.id);
      const need = m.unlock ? `Reach ${m.unlock.trips} trips on ${maps.find(x => x.id === m.unlock.map)?.name}` : '';
      b.disabled = !ok;
      b.innerHTML = `<h3>${m.name}</h3><p>${m.cols} x ${m.rows} tiles</p><p>${ok ? (best ? `Best: ${best} trips` : 'Not played yet') : 'Locked: ' + need}</p>`;
      b.addEventListener('click', () => onPlay(m));
      list.appendChild(b);
    }
  }

  function buildReward() {
    const box = $('reward-cards');
    box.innerHTML = '';
    if (!game.reward) return;
    $('reward-sub').textContent = `Goal ${game.reward.goal}. Choose your reward.`;
    for (const o of game.reward.options) {
      const b = document.createElement('button');
      b.className = 'card'; b.type = 'button';
      b.innerHTML = o.special
        ? `<div class="big-n">$${o.cash}</div><h3>+ ${o.special.name}</h3><p>${o.special.description}</p>`
        : `<div class="big-n">$${o.cash}</div><h3>Just cash</h3><p>Roads cost cash now. Spend it on road or the Shop.</p>`;
      b.addEventListener('click', () => chooseReward(o.id));
      box.appendChild(b);
    }
  }

  function render() {
    const mode = game.mode;
    $('hud').hidden = mode === 'menu';
    $('menu').hidden = mode !== 'menu';
    $('reward').hidden = mode !== 'reward';
    $('pause').hidden = mode !== 'pause';
    $('over').hidden = mode !== 'over';
    if (mode === 'menu') buildMenu();
    if (mode === 'reward') buildReward();
    if (mode === 'over' && game.over) {
      const o = game.over;
      $('over-sub').innerHTML = o.record ? '<span class="record">New best!</span> Traffic ground to a halt.' : 'Traffic ground to a halt.';
      $('over-stats').innerHTML = `<div><b>${o.trips}</b><small>trips</small></div><div><b>${fmtTime(o.time)}</b><small>survived</small></div><div><b>$${o.money}</b><small>cash</small></div><div><b>${o.best}</b><small>best</small></div>`;
    }

    $('oneway-btn').hidden = !game.unlocks.oneway;
    $('oneway-btn').classList.toggle('on', game.oneway);
    $('n-road').textContent = roadsAvailable(game);
    $('pill-road').classList.toggle('empty', roadsAvailable(game) === 0);
    $('n-trips').textContent = game.trips;
    $('n-money').textContent = '$' + game.money;
    buttons.forEach(b => b.classList.toggle('active', b.dataset.tool === game.tool));
    canvas.style.cursor = cursors[game.tool];

    // one pill per special you own (the bridge is always shown)
    const sp = $('specials');
    sp.innerHTML = '';
    const anyOverpass = [...game.roads.values()].some(r => r.overpass !== undefined);
    for (const s of prog.specials) {
      const n = game.inv[s.id] || 0;
      if (!s.enabled || s.unlock || (n === 0 && s.id !== 'bridge' && game.placing !== s.id && !(s.id === 'overpass' && anyOverpass))) continue;
      const tappable = s.placeable || s.toggle;
      const d = document.createElement(tappable ? 'button' : 'div');
      d.className = 'pill' + (tappable ? ' tap' : '') + ((game.placing === s.id) || (s.toggle === 'build4' && game.build4) ? ' on' : '');
      d.innerHTML = `${s.name} <b>${n}</b>`;
      if (s.toggle === 'build4') {
        d.type = 'button';
        d.addEventListener('click', () => { setBuild4(!game.build4); toast(game.build4 ? 'Highway mode: drag to lay 4-lane road (or widen a street).' : 'Back to regular roads.'); });
      } else if (s.placeable) {
        d.type = 'button';
        d.addEventListener('click', () => {
          if (game.placing === s.id) setTool('build');
          else { selectSpecial(s.id); toast(s.id === 'overpass' ? 'Tap a crossing to place the overpass. Tap an overpass again to swap which road is on top.' : `Tap an intersection to place the ${s.name.toLowerCase()}.`); }
        });
      }
      sp.appendChild(d);
    }

    // goal progress
    const span = Math.max(1, game.nextGoalAt - game.prevGoalAt);
    $('goal-bar').firstElementChild.style.width = Math.min(100, ((game.trips - game.prevGoalAt) / span) * 100) + '%';
    $('goal-text').textContent = `Goal ${game.goalCount + 1}: ${game.trips}/${game.nextGoalAt} trips`;

    // shop
    const shop = $('shop'), box = $('shop-items');
    if (mode !== 'play') shop.hidden = true;
    if (!shop.hidden) {
      box.innerHTML = '';
      const items = prog.specials.filter(s => s.enabled && s.cost && !(s.unlock && game.unlocks[s.id]));
      if (!items.length) box.textContent = 'Nothing for sale yet.';
      for (const s of items) {
        const row = document.createElement('div'); row.className = 'row';
        row.innerHTML = `<div>${s.name}<small>${s.description}</small></div>`;
        const b = document.createElement('button');
        b.textContent = '$' + s.cost; b.disabled = game.money < s.cost; b.className = game.money >= s.cost ? 'afford' : '';
        b.addEventListener('click', () => { if (buy(s.id)) toast(`Bought a ${s.name}.`); });
        row.appendChild(b); box.appendChild(row);
      }
    }
    $('shop-btn').classList.toggle('afford', prog.specials.some(s => s.enabled && s.cost && game.money >= s.cost && !(s.unlock && game.unlocks[s.id])));
  }

  onChange(render);
  onEvent(e => {
    if (e.type === 'cash') toast(`Goal reached: +$${e.n}.`);
    if (e.type === 'spawn') {
      const name = e.color.id;
      if (e.across) toast(e.needsBridge ? `New ${name} house across the water. You'll need a bridge.` : `New ${name} house across the river (bridge already built).`);
      else if (e.kind === 'newColor') toast(`New ${name} house and destination!`);
      else if (e.kind === 'combo') toast(`New ${name} destination and house.`);
      else toast(e.n > 1 ? `${e.n} new ${name} houses.` : `New ${name} house.`);
    }
  });
  render();
}
