import { unlock, play, playFirst } from "./audio.js";
import { loadConfig as loadMusic, start as startMusic } from "./music.js";
import {
  game,
  newGame,
  setPalette,
  setMode,
  tick,
  onChange,
  onEvent,
  flushBest,
  addLog,
} from "./state.js";
import { setTuning } from "./tuning.js";
import { setKeybinds } from "./keys.js";
import { setProgression, setMaps, setMilestones, maps } from "./progression.js";
import { resizeView, fitView, cam, clampCam } from "./camera.js";
import {
  configure,
  restore,
  saveNow,
  loadSaved,
  clearSave,
  describeSave,
  startAutosave,
} from "./save.js";
import { render } from "./render.js";
import { initInput, hover } from "./input.js";
import { initHud, note } from "./hud.js";

const splash = document.getElementById("splash");
const musicReady = loadMusic(); // fetch the playlist while the splash is showing
document.getElementById("start").addEventListener("click", async () => {
  await unlock();
  await musicReady;
  startMusic();
  splash.classList.add("hide");
  setTimeout(() => splash.remove(), 400);
});

onEvent((e) => {
  if (e.type === "spawn") play("spawn");
  if (e.type === "over" && !e.finished) play("gameover"); // (finishing a run on purpose is not a loss: no trombones)
  if (e.type === "speed") {
    // most specific first: 'speed:0>1.5', then the general kind
    const kind =
      e.speed === 0
        ? "pause"
        : e.prev === 0
          ? "speed:resume"
          : e.speed > e.prev
            ? "speed:up"
            : "speed:down";
    playFirst([`speed:${e.prev}>${e.speed}`, kind]);
  }
  if (e.type === "accident") play("crash");
  if (e.type === "impatient") play("unserved");
  if (e.type === "whistle") play("crowd");
  if (e.type === "honk") play("honk", { volume: 0.7 + 0.3 * e.k }); // angrier cars are a bit louder
}); // sound effects hook into game events here

// Hover sound: the moment a mouse first enters any button (not touch, which has no hover; not disabled buttons).
document.addEventListener("pointerover", (e) => {
  if (e.pointerType !== "mouse") return;
  const b = e.target.closest && e.target.closest("button");
  if (b && !b.disabled && !b.contains(e.relatedTarget)) play("hover");
});

// Click sound: pressing any button (on press, like the toolbar reacts), plus keyboard activation (Enter/Space on a focused button).
const pressedButton = (e) => {
  const b = e.target.closest && e.target.closest("button");
  return b && !b.disabled ? b : null;
};
document.addEventListener("pointerdown", (e) => {
  if (e.button === 0 && pressedButton(e)) play("click");
});
document.addEventListener("click", (e) => {
  if (e.detail === 0 && pressedButton(e)) play("click");
});

// Popup sound: any element marked data-popup (shop, pause, settings, a future dev window) pops open when its `hidden` goes away.
const popups = new MutationObserver((records) => {
  for (const r of records)
    if (r.oldValue !== null && !r.target.hidden) play("popup");
});
document
  .querySelectorAll("[data-popup]")
  .forEach((el) =>
    popups.observe(el, {
      attributes: true,
      attributeFilter: ["hidden"],
      attributeOldValue: true,
    }),
  );

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
let W = 0,
  H = 0,
  dpr = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  W = innerWidth;
  H = innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  resizeView(W, H);
}

const randomSeed = () => (Math.random() * 1e9) >>> 0;
let devSeed = (() => {
  const m = location.hash.match(/seed=(\d+)/);
  return m ? Number(m[1]) : null;
})(); // #seed=123 replays a map once

const brainUrl = (() => {
  const m = location.hash.match(/brain(?:=([^&]+))?/);
  return m ? decodeURIComponent(m[1] || "brains/best.json") : null;
})();
const brainLook = /[#&]look\b/.test(location.hash);
const brainMod = brainUrl ? await import("../sim/brain.js") : null;
const brainFile = brainUrl
  ? await fetch(brainUrl)
      .then((r) => r.json())
      .catch((e) => {
        console.warn("no brain at " + brainUrl, e);
        return null;
      })
  : null;
let brain = null;
const hashOf = () =>
  "#seed=" +
  game.seed +
  (brainUrl
    ? "&brain" +
      (brainUrl === "brains/best.json"
        ? ""
        : "=" + encodeURIComponent(brainUrl)) +
      (brainLook ? "&look" : "")
    : "");
function wakeBrain() {
  brain = null;
  // if (!brainFile) return note(`No bot: couldn't load ${brainUrl} (train one with npm run train). You're playing yourself.`);
  try {
    brain = brainMod.createBrain(brainFile, {
      onDecision: (text, spots) => addLog("Bot: " + text, spots),
      lookahead: brainLook ? { every: 10, horizon: 30, k: 2 } : null,
    });
  } catch (e) {
    // return note(`No bot: ${e.message}. You're playing yourself.`);
  }
  note(
    `The bot is playing (trained ${brainFile.meta.gen} generations, games up to ${Math.round(brainFile.meta.cap / 60)} min${brainLook ? ", looking ahead" : ""}). Its moves go in the log.`,
  );
}

function startMap(map) {
  newGame(devSeed ?? randomSeed(), map);
  devSeed = null;
  fitView(game.cols, game.rows);
  history.replaceState(null, "", hashOf());
  wakeBrain();
}

const loadJson = (url) => fetch(url).then((r) => r.json());
setPalette((await loadJson("config/colors.json")).colors);
for (const [url, apply] of [
  ["config/tuning.json", setTuning],
  ["config/progression.json", setProgression],
  ["config/milestones.json", setMilestones],
  ["config/keybinds.json", setKeybinds],
  ["config/maps.json", setMaps],
  ["config/save.json", configure],
]) {
  try {
    apply(await loadJson(url));
  } catch (e) {
    console.warn(url + " not loaded, using defaults", e);
  }
}

// The main menu's History window shows history.txt from the site root (hidden if there isn't one).
fetch("history.txt", { cache: "no-cache" })
  .then((r) => (r.ok ? r.text() : ""))
  .then((t) => {
    if (!t.trim() || /^\s*<(!doctype|html)/i.test(t)) return; // missing file, or a host's HTML 404 page
    document.getElementById("history-text").textContent = t.trim();
    document.getElementById("history").hidden = false;
  })
  .catch(() => {});

// Save games: the whole game, every car included, is written every few seconds and when the page goes away.
let saveInfo = null;
const refreshSaveInfo = async () => {
  saveInfo = await describeSave();
};
const view = () => ({ view: { x: cam.x, y: cam.y, z: cam.z } });
await refreshSaveInfo();

async function continueGame() {
  const d = await loadSaved();
  if (!d) return;
  try {
    restore(d);
  } catch (e) {
    console.error("could not load the save", e);
    return;
  }
  fitView(game.cols, game.rows); // tells the camera the real map size (and zoom limits) first...
  if (d.view) Object.assign(cam, d.view); // ...then puts the player's saved view back
  clampCam();
  history.replaceState(null, "", hashOf());
  wakeBrain();
}

initHud({
  onPlay: (map) => startMap(map),
  onRestart: () => startMap(game.map),
  onToMenu: async () => {
    flushBest();
    await saveNow(view());
    await refreshSaveInfo();
    setMode("menu");
  },
  onContinue: continueGame,
  getSaveInfo: () => saveInfo,
});
startAutosave(view);
addEventListener("pagehide", flushBest); // never lose the latest best score
let wasOver = false;
onChange((g) => {
  if (g.mode === "over" && !wasOver) {
    wasOver = true;
    clearSave().then(refreshSaveInfo);
  } else if (g.mode !== "over") wasOver = false;
});
initInput(canvas);
addEventListener("resize", resize);
resize();

// A backdrop map behind the menu, then wait for the player to pick one.
newGame(randomSeed(), maps[0]);
game.time = 1; // let the backdrop's buildings finish their pop-in
fitView(game.cols, game.rows);
setMode("menu");

const STEP = 1 / 60;
let last = performance.now(),
  acc = 0;
(function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000) * game.speed;
  last = now;
  while (acc >= STEP) {
    if (brain) brainMod.brainTick(game, brain);
    tick(STEP);
    acc -= STEP;
  }
  render(ctx, W, H, dpr, game, cam, hover);
  requestAnimationFrame(frame);
})(last);
