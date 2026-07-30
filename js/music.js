// Фоновая музыка: тема меню и по треку на арену (assets/music/*.mp3,
// сгенерированы через tools/gen_music.mjs). Отдельно от audio.js: эффекты
// синтезируются в Web Audio, а музыка — обычный <audio>, который не держит
// AudioContext и грузится лениво, уже после старта игры.

const BASE_VOLUME = 0.34;   // заметно тише выстрелов
const DUCK_VOLUME = 0.1;    // пауза, реклама, свёрнутая вкладка
const FADE_MS = 400;

const TRACKS = new Set(['menu', 'arena01', 'arena02', 'arena03', 'arena04', 'arena05']);
const DEFAULT_MATCH_TRACK = 'arena01'; // пользовательские карты и challenge-карты

let element = null;
let current = null;      // что должно играть
let enabled = true;
let ducked = false;
let fadeTimer = null;
let pendingGesture = false;

/** Трек арены: у пользовательских и присланных карт своей темы нет. */
export function trackForMap(mapId) {
  return TRACKS.has(mapId) && mapId !== 'menu' ? mapId : DEFAULT_MATCH_TRACK;
}

function ensureElement() {
  if (element || typeof Audio === 'undefined') return element;
  element = new Audio();
  element.id = 'music';
  element.loop = true;
  element.preload = 'none';
  element.volume = 0;
  // В DOM, а не «в воздухе»: так состояние музыки видно в инспекторе и в
  // автотестах, а браузер корректно освобождает элемент вместе со страницей.
  element.hidden = true;
  document.body?.append(element);
  return element;
}

function targetVolume() {
  if (!enabled || !current) return 0;
  return ducked ? DUCK_VOLUME : BASE_VOLUME;
}

function fadeTo(volume) {
  if (!element) return;
  clearInterval(fadeTimer);
  const from = element.volume;
  const steps = Math.max(1, Math.round(FADE_MS / 40));
  let step = 0;
  fadeTimer = setInterval(() => {
    step++;
    const k = Math.min(1, step / steps);
    element.volume = Math.max(0, Math.min(1, from + (volume - from) * k));
    if (k >= 1) {
      clearInterval(fadeTimer);
      fadeTimer = null;
      if (element.volume === 0 && !current) element.pause();
    }
  }, 40);
}

/**
 * Автоплей блокируется до первого жеста. Не считаем это ошибкой: помечаем,
 * что ждём жеста, и повторяем попытку на ближайшем pointerdown.
 */
function tryPlay() {
  if (!element || !enabled || !current) return;
  const promise = element.play();
  if (!promise?.catch) return;
  promise.then(() => { pendingGesture = false; }).catch(() => {
    if (pendingGesture) return;
    pendingGesture = true;
    const retry = () => {
      document.removeEventListener('pointerdown', retry);
      document.removeEventListener('keydown', retry);
      pendingGesture = false;
      tryPlay();
    };
    document.addEventListener('pointerdown', retry, { once: true });
    document.addEventListener('keydown', retry, { once: true });
  });
}

export const Music = {
  /** Ставит трек; повторный вызов с тем же именем ничего не перезапускает. */
  play(track) {
    if (!TRACKS.has(track)) return;
    if (current === track && element && !element.paused) return;
    const node = ensureElement();
    if (!node) return;
    if (current !== track) {
      current = track;
      node.src = `assets/music/${track}.mp3`;
      node.load();
      node.volume = 0;
    }
    tryPlay();
    fadeTo(targetVolume());
  },

  stop() {
    current = null;
    if (element) fadeTo(0);
  },

  /** Приглушение на паузе, рекламе и свёрнутой вкладке — без остановки. */
  duck(on) {
    ducked = Boolean(on);
    if (element && current) fadeTo(targetVolume());
  },

  setEnabled(on) {
    enabled = Boolean(on);
    if (!element) return;
    if (!enabled) fadeTo(0);
    else if (current) { tryPlay(); fadeTo(targetVolume()); }
  },

  get enabled() { return enabled; },
  get track() { return current; },
};
