// DOM overlay: inventory pills, goal bar, shop, toolbar, toasts, and the menu / reward / pause / game-over screens.
import { game, onChange, onEvent, setTool, setMode, setOneWay, setBuild4, selectSpecial, chooseReward, finishRun, buy, bestFor, isUnlocked, cycleSpeed, addLog, ackNotice, refreshWatches } from './state.js';
import { chipsOf, pendingNotice } from './deadlines.js';
import { flyTo } from './camera.js';
import { actionList, keyText, titleFor, onKeys, bind as bindKeys, mergeKeys, keysOf, conflicts, labelOfAction, labelOf, resetKeys, startCapture, stopCapture } from './keys.js';
import { settings, setSetting, onSetting } from './settings.js';
import { onMusic, getState as musicState, next as musicNext, prev as musicPrev, toggle as musicToggle } from './music.js';
import { play } from './audio.js';
import { maps, prog, roadsAvailable } from './progression.js';

let toastEl, toastTimer = 0, lastMsg = '', lastAt = 0;
const $ = id => document.getElementById(id);

export function toast(msg) {
  const now = performance.now();
  if (msg === lastMsg && now - lastAt < 1500) return;
  lastMsg = msg; lastAt = now;
  play('toast');
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

// A message that is worth keeping: shown as a toast AND written to the history, with the places it is about (tile boxes) so the log can fly there.
export function note(msg, spots = [], extra = {}) { toast(msg); addLog(msg, spots, extra); }

const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function initHud({ onPlay, onRestart, onToMenu, onContinue = () => {}, getSaveInfo = () => null, onExportSave = async () => ({ ok: false, message: '' }), onReadSaveFile = () => ({ ok: false, error: '' }), onApplySaveFile = async () => ({ ok: false, message: '' }) }) {
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
  // Settings screen: cut markers, plus volume and mute for sound effects and for music.
  // The eye button in the corner hides every button, counter and message so the map can be seen (or screenshotted) bare. Popups that need an
  // answer (the menu, rewards, game over) are not part of the HUD and still show. The setting is not saved: a reload starts with the HUD on.
  const guiBtn = $('gui-btn');
  guiBtn.addEventListener('click', () => { const off = document.body.classList.toggle('gui-off'); guiBtn.setAttribute('aria-pressed', String(off)); });
  const optCuts = $('opt-cuts'), optDemo = $('opt-demographics');
  const bind = (rangeId, muteId, volKey, muteKey) => {
    const range = $(rangeId), mute = $(muteId);
    range.addEventListener('input', () => setSetting(volKey, range.value / 100));
    mute.addEventListener('change', () => setSetting(muteKey, mute.checked));
    return () => { range.value = Math.round(settings[volKey] * 100); mute.checked = settings[muteKey]; };
  };
  const syncSfx = bind('opt-sfx-vol', 'opt-sfx-mute', 'sfxVolume', 'sfxMuted');
  const syncMusicA = bind('opt-music-vol', 'opt-music-mute', 'musicVolume', 'musicMuted');
  const syncMusicB = bind('music-vol', 'music-mute', 'musicVolume', 'musicMuted');       // the music panel's own copy of the same two controls
  // Save file: export any time; import only from the main menu (a running game keeps writing its own autosave over whatever is imported).
  const saveMsg = $('save-msg'), saveConfirm = $('save-confirm'), saveImport = $('save-import'), saveFile = $('save-file');
  let pendingImport = null;
  const saySave = text => { saveMsg.textContent = text; };
  const resetSaveUi = () => { pendingImport = null; saveConfirm.hidden = true; saveFile.value = ''; saveImport.disabled = game.mode !== 'menu'; saySave(game.mode === 'menu' ? 'Export your game to a file, or load a saved file back in.' : 'Export your game to a file. To import a file, go to the main menu first.'); };
  $('save-export').addEventListener('click', async () => { saySave('Exporting...'); const r = await onExportSave(); saySave(r.message); });
  saveImport.addEventListener('click', () => { if (game.mode === 'menu') saveFile.click(); });
  saveFile.addEventListener('change', async () => {
    const file = saveFile.files && saveFile.files[0];
    if (!file) return;
    let text = '';
    try { text = await file.text(); } catch { saySave('That file could not be read.'); return; }
    const r = onReadSaveFile(text);
    if (!r.ok) { saySave(r.error); saveFile.value = ''; return; }
    const sv = getSaveInfo();
    if (!sv) { saySave('Importing...'); const done = await onApplySaveFile(r); saySave(done.message); saveFile.value = ''; return; }
    pendingImport = r;
    saySave(`Replace your saved game (${sv.map}, ${sv.trips.toLocaleString('en-US')} trips) with ${r.summary.map}, ${r.summary.trips.toLocaleString('en-US')} trips from this file?`);
    saveConfirm.hidden = false;
  });
  $('save-replace').addEventListener('click', async () => { const r = pendingImport; if (!r) return; saveConfirm.hidden = true; pendingImport = null; saySave('Importing...'); const done = await onApplySaveFile(r); saySave(done.message); saveFile.value = ''; });
  $('save-cancel').addEventListener('click', resetSaveUi);
  const syncAll = () => { optCuts.checked = settings.showCuts; optDemo.checked = !!settings.difficulty.demographics; syncSfx(); syncMusicA(); syncMusicB(); };
  const openSettings = () => { syncAll(); resetSaveUi(); $('settings').hidden = false; };
  $('settings-btn').addEventListener('click', openSettings);
  $('pause-settings-btn').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', () => { $('settings').hidden = true; });
  optCuts.addEventListener('change', () => setSetting('showCuts', optCuts.checked));
  optDemo.addEventListener('change', () => setSetting('difficulty', { ...settings.difficulty, demographics: optDemo.checked }));
  onSetting(() => { if (!$('settings').hidden || !$('music').hidden) syncAll(); });

  // Music panel (the note button): shown only when there are songs.
  const paintMusic = st => {
    $('music-btn').hidden = st.count === 0;
    $('opt-music-group').hidden = st.count === 0;
    $('music-title').textContent = st.title || '\u00a0';
    $('music-play').textContent = st.playing ? '\u23f8' : '\u25b6';
    $('music-btn').classList.toggle('paused', !st.playing);
  };
  onMusic(paintMusic); paintMusic(musicState());
  $('music-btn').addEventListener('click', () => { const m = $('music'); m.hidden = !m.hidden; if (!m.hidden) syncAll(); });
  $('music-close').addEventListener('click', () => { $('music').hidden = true; });
  $('music-play').addEventListener('click', musicToggle);
  $('music-next').addEventListener('click', musicNext);
  $('music-prev').addEventListener('click', musicPrev);
  // End game: counts the score without having to lose. Two taps, so it can't be hit by accident.
  let finishTimer = 0;
  const finishBtn = $('finish-run');
  finishBtn.addEventListener('click', () => {
    if (finishBtn.dataset.armed) { clearTimeout(finishTimer); delete finishBtn.dataset.armed; finishBtn.textContent = 'End game'; finishRun(); return; }
    finishBtn.dataset.armed = '1'; finishBtn.textContent = 'Tap again to end game';
    finishTimer = setTimeout(() => { delete finishBtn.dataset.armed; finishBtn.textContent = 'End game'; }, 3000);
  });
  $('speed-btn').addEventListener('click', cycleSpeed);
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
        ? `<div class="big-n">$${o.cash}</div><h3>+ ${(o.special.rewardGrant || 1) > 1 ? o.special.rewardGrant + ' ' + o.special.name + ' pieces' : o.special.name}</h3><p>${o.special.description}</p>`
        : `<div class="big-n">$${o.cash}</div><h3>Just cash</h3><p>Roads cost cash now. Spend it on road or the Shop.</p>`;
      b.addEventListener('click', () => chooseReward(o.id));
      box.appendChild(b);
    }
  }

  // The top bar wraps onto several rows on a phone: the chips and the log panel sit just below however tall it is, never over its buttons.
  function placeBelowTop() {
    const bottom = Math.ceil($('hud-top').getBoundingClientRect().bottom) + 6;
    $('chips').style.top = bottom + 'px';
    $('log').style.top = bottom + 'px';
    $('log').style.maxHeight = `calc(100vh - ${bottom + 100}px)`;
  }
  addEventListener('resize', placeBelowTop);

  // Countdown chips: the stadium / the side roads while they are not connected. Tap one to fly there.
  function paintChips() {
    placeBelowTop();
    const box = $('chips'), chips = game.mode === 'play' || game.mode === 'pause' ? chipsOf(game).filter(c => !c.waiting) : [];
    const sig = chips.map(c => c.key + c.warn + (c.detail ? c.detail.have + '/' + c.detail.total + '/' + (c.detail.stadiumOk ?? '') : '') + Math.floor(c.left ?? 0)).join('|');
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig; box.innerHTML = '';
    for (const c of chips) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chipbar' + (c.warn ? ' warn' : '');
      const d = c.detail, parts = [];
      if (d) { if (c.kind === 'gates') parts.push(`${d.stadiumOk}/${d.gates} reach the stadium`); parts.push(`${d.have}/${d.total} ${d.what}`); }
      b.textContent = `${c.label}: ${parts.join(', ')} \u00b7 ${fmtTime(c.left ?? 0)}`;
      b.addEventListener('click', () => flyTo(c.spots));
      box.appendChild(b);
    }
  }
  setInterval(() => { if (game.mode === 'play') paintChips(); }, 500);
  $('notice-ok').addEventListener('click', ackNotice);

  // Message history (the Log button): newest first; tap an entry to fly to the places it is about.
  function paintLog() {
    const list = $('log-list'); list.innerHTML = '';
    const items = [...(game.log || [])].reverse();
    if (!items.length) { list.innerHTML = '<div class="empty">Nothing yet. Messages about new buildings, accidents and patience show up here.</div>'; return; }
    for (const e of items) {
      const hasSpot = e.spots && e.spots.length, row = document.createElement(hasSpot ? 'button' : 'div');
      row.className = 'entry' + (/not connected|left!|no longer|jammed/.test(e.text) ? ' bad' : ''); if (hasSpot) row.type = 'button';
      row.innerHTML = `<time>${fmtTime(e.t)}</time><span></span>${hasSpot ? '<span class="pin" aria-hidden="true">\u25ce</span>' : ''}`;
      row.children[1].textContent = e.text;
      if (hasSpot) row.addEventListener('click', () => {
        $('log').hidden = true;
        const live = e.ref === 'accident' ? !!game.accident && Math.hypot(game.accident.x - e.x, game.accident.y - e.y) < 1.5 : e.ref === 'construction' ? !!game.work && game.work.x === Math.floor(e.x) && game.work.y === Math.floor(e.y) : true;     // an accident that is gone: show where it was, faded
        flyTo(e.spots, { ghost: !live });
      });
      list.appendChild(row);
    }
  }
  $('log-btn').addEventListener('click', () => { const l = $('log'); l.hidden = !l.hidden; if (!l.hidden) { placeBelowTop(); paintLog(); } });
  $('log-close').addEventListener('click', () => { $('log').hidden = true; });

  // ---- Settings > Keyboard: click a key box, press a key (or two together). ----
  const keysList = $('keys-list'), keysMsg = $('keys-msg');
  let pending = null;                                                       // a rebind waiting for "swap?" (the key is already used)
  const say = (html, buttons = []) => {
    keysMsg.hidden = !html; keysMsg.textContent = html || '';
    for (const [label, fn] of buttons) { const b = document.createElement('button'); b.type = 'button'; b.className = 'big alt'; b.textContent = label; b.addEventListener('click', fn); keysMsg.appendChild(b); }
  };
  function paintKeys() {
    keysList.innerHTML = '';
    for (const a of actionList()) {
      const lab = document.createElement('span'); lab.textContent = a.label;
      const b = document.createElement('button'); b.type = 'button'; b.dataset.action = a.id;
      const txt = keyText(a.id); b.textContent = txt; if (txt === 'unbound') b.className = 'unbound';
      b.addEventListener('click', () => {
        stopCapture(); pending = null; say(''); paintKeys();
        const me = keysList.querySelector(`[data-action="${a.id}"]`); me.classList.add('listening'); me.textContent = 'press a key...';
        startCapture(pressed => {
          const next = pressed.length ? mergeKeys(keysOf(a.id), pressed) : [];
          const cs = conflicts(a.id, next);
          if (!cs.length) { bindKeys(a.id, next); paintKeys(); return; }
          const c = cs[0];
          pending = { id: a.id, next };
          paintKeys();
          say(`${labelOf(c.token)} is already ${labelOfAction(c.other)}'s key. Swap?`, [['Swap', () => { bindKeys(a.id, next, true); pending = null; say(''); paintKeys(); }], ['Cancel', () => { pending = null; say(''); paintKeys(); }]]);
        }, () => paintKeys());
      });
      keysList.append(lab, b);
    }
  }
  $('keys-open').addEventListener('click', () => { paintKeys(); say(''); $('keys').hidden = false; });
  const closeKeys = () => { stopCapture(); pending = null; $('keys').hidden = true; };
  $('keys-close').addEventListener('click', closeKeys);
  $('keys-reset').addEventListener('click', () => { stopCapture(); resetKeys(); say('Keys are back to their defaults.'); paintKeys(); });

  // Tooltips show the current keys, wherever they came from.
  function keyTitles() {
    for (const [id, action, name] of [['oneway-btn', 'oneway', 'One-way'], ['log-btn', 'log', 'Message history'], ['shop-btn', 'shop', 'Shop'], ['music-btn', 'music', 'Music'], ['speed-btn', 'speed1', 'Speed']]) { const el = $(id); if (el) el.title = titleFor(action, name); }
    document.querySelectorAll('#toolbar button[data-tool]').forEach(b => { b.title = titleFor(b.dataset.tool, b.textContent.trim()); });
    document.querySelectorAll('#specials [data-special]').forEach(p => { p.title = titleFor(p.dataset.special, p.dataset.name || p.textContent.replace(/\d+/g, '').trim()); });
  }
  onKeys(keyTitles);

  function render() {
    const mode = game.mode;
    $('hud').hidden = mode === 'menu';
    const sb = $('speed-btn'); sb.textContent = game.speed === 0 ? '⏸' : game.speed + 'x'; sb.classList.toggle('paused', game.speed === 0);
    $('menu').hidden = mode !== 'menu';
    $('reward').hidden = mode !== 'reward';
    $('pause').hidden = mode !== 'pause';
    $('over').hidden = mode !== 'over';
    $('notice').hidden = mode !== 'notice';
    if (mode === 'notice') { const n = pendingNotice(game); if (n) { $('notice-title').textContent = n.notice.title; $('notice-text').textContent = n.notice.text; } }
    if (mode === 'play' || mode === 'pause') refreshWatches();
    paintChips();
    if (mode === 'menu') buildMenu();
    if (mode === 'reward') buildReward();
    if (mode === 'over' && game.over) {
      const o = game.over;
      const patience = o.reason && o.reason.kind !== 'jam';                    // (a jam that never cleared is gridlock, not impatience)
      $('over-title').textContent = o.finished ? 'Game ended' : patience ? 'Out of patience!' : 'Gridlock!';
      const why = o.finished ? 'You ended this game.' : patience ? `${o.reason.label} was not connected in time.` : o.reason ? 'A traffic jam never cleared.' : 'Traffic ground to a halt.';
      $('over-sub').innerHTML = o.record ? `<span class="record">New best!</span> ${why}` : why;
      $('over-stats').innerHTML = `<div><b>${o.trips}</b><small>trips</small></div><div><b>${fmtTime(o.time)}</b><small>${o.finished ? 'played' : 'survived'}</small></div><div><b>$${o.money}</b><small>cash</small></div><div><b>${o.best}</b><small>best</small></div>`;
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
      d.dataset.special = s.id;
      d.dataset.name = s.name;
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

    keyTitles();

    // goal progress
    const span = Math.max(1, game.nextGoalAt - game.prevGoalAt);
    $('goal-bar').firstElementChild.style.width = Math.min(100, ((game.trips - game.prevGoalAt) / span) * 100) + '%';
    $('goal-text').textContent = `Goal ${game.goalCount + 1}: ${game.trips}/${game.nextGoalAt} trips`;

    // shop
    const shop = $('shop'), box = $('shop-items');
    if (mode !== 'play') shop.hidden = true;
    if (mode === 'menu' || mode === 'over') $('log').hidden = true; else if (!$('log').hidden) paintLog();
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
  const listOf = names => (names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names.at(-1) : names[0]);
  const IMPATIENT = {
    house: l => `${l} is not connected to a destination of its color.`,
    dest: l => `${l} is not reached by every color it takes.`,
    stadium: l => `${l} is still not connected to every color.`,
    gates: l => `${l} still do not reach the stadium and every color.`,
  };
  onEvent(e => {
    if (e.type === 'cash') note(`Goal reached: +$${e.n}.`);
    if (e.type === 'stadium') {
      const bits = [e.razed && `${e.razed} building${e.razed > 1 ? 's' : ''}`, e.cleared && `${e.cleared} road piece${e.cleared > 1 ? 's' : ''}`].filter(Boolean);
      if (e.razed) note(`A generous billionaire donated a stadium to the city! (${bits.join(' and ')} made way. Connect its gates.)`, e.spots);
      else note(e.cleared ? `A stadium has been donated to the city! It took ${bits.join(' and ')} to fit (the road pieces are back in your stock). Connect its gates.` : 'A stadium has been donated to the city! Any color can go there. Connect its gates.', e.spots);
    }
    if (e.type === 'portal') note(e.count > 1 ? `Side roads to other cities on the ${listOf(e.edges)} edges: connect them to the stadium and every color.` : `A side road to another city on the ${e.edges[0]} edge: connect it to the stadium and every color.`, e.spots);
    if (e.type === 'portal' && (e.cleared || e.razed)) note(`${e.razed ? 'A building' : 'A road piece'} made way for ${e.cleared + e.razed > 1 ? 'the new roads' : 'the new road'} to another city.`, e.spots);
    if (e.type === 'make-room') note(`The city is growing: ${e.cleared} road piece${e.cleared > 1 ? 's were' : ' was'} cleared to make room for new buildings.`, e.spots);
    if (e.type === 'gate-info') toast(e.demolish ? "That's the road to another city. It can't be demolished." : "This is an expansion to another city you can't see. Visitors come in through here.");
    if (e.type === 'tunnel-bonus') note(`Thanks for testing! Tunnels are dug one block at a time now. Your ${e.tunnels} old tunnel${e.tunnels > 1 ? 's were' : ' was'} converted, and here are ${e.pieces} tunnel pieces for being here early.`);
    if (e.type === 'rotate-blocked') toast("No room to turn this: it needs a free tile of land beside it (or outside its lot).");
    if (e.type === 'jam-locked') toast(e.why === 'works' ? "Can't demolish this: there are road works here. They'll be finished soon." : e.why === 'accident' ? "Can't demolish this: there has been an accident here. Wait for the police to clear it." : "Can't demolish this: cars are jammed here. Clear the jam first.");
    if (e.type === 'horde') note(`A game is being hosted at the stadium! A crowd of ${e.size} is on its way.`, e.spots);
    if (e.type === 'whistle') note('The game is over! The crowd is heading home.', e.spots);
    if (e.type === 'accident') { const x = Math.floor(e.x), y = Math.floor(e.y); note('Accident! Police are on the scene.', [{ x0: x, y0: y, x1: x, y1: y }], { ref: 'accident', x: e.x, y: e.y }); }
    if (e.type === 'construction') { const x = Math.floor(e.x), y = Math.floor(e.y); note('Road works! One lane is closed, so traffic takes turns.', [{ x0: x, y0: y, x1: x, y1: y }], { ref: 'construction', x: e.x, y: e.y }); }
    if (e.type === 'construction-cleared') toast('The road works are finished.');
    if (e.type === 'jam-warn') note(`This jam is getting out of hand! ${e.seconds} seconds left!`, e.spots, { ref: 'jam' });
    if (e.type === 'jam') note('Traffic is jammed up here. The cars are getting angry!', e.spots, { ref: 'jam' });
    if (e.type === 'impatient') note(`${IMPATIENT[e.kind](e.label)} ${e.seconds} seconds left!`, e.spots);
    if (e.type === 'disconnected') toast(`${e.label} is no longer connected.`);                       // (just a toast, not logged: roads are being edited. If it is still broken when its warning starts, THAT toast is logged)
    if (e.type === 'unlock') note(`New map unlocked: ${e.map.name}!`);
    if (e.type === 'spawn') {
      const name = e.color.id;
      if (e.across) note(e.needsBridge ? `New ${name} house across the water. You'll need a bridge.` : `New ${name} house across the river (bridge already built).`, e.spots);
      else if (e.kind === 'newColor') note(`New ${name} house and destination!`, e.spots);
      else if (e.kind === 'combo') note(`New ${name} destination and house.`, e.spots);
      else if (e.kind === 'dual') note(`New ${name} and ${e.color2.id} destination: both colors park here.`, e.spots);
      else note(e.n > 1 ? `${e.n} new ${name} houses.` : `New ${name} house.`, e.spots);
    }
  });
  render();
}
