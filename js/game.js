// GHOSTFIRE — оркестратор: сцена, матч-цикл, стрельба, эффекты, сохранения.
import * as THREE from 'three';
import { GameMap } from './map.js';
import { Player, MOVE } from './player.js';
import { Ghost } from './ghost.js';
import { WEAPONS, RAILGUN, Pickup, TracerPool, fireHitscan, preloadWeaponModels } from './weapons.js';
import { Recorder, decode, TICK_RATE } from './replay.js';
import { MobileControls, IS_TOUCH } from './mobile.js';
import { UI, decodeShareCode } from './ui.js';
import { Platform } from './platform.js';
import {
  computeMatchReward, applyMatchReward, WINS_TO_TAKE_MATCH,
  ROUND_COUNTDOWN_SEC, ROUND_TEARDOWN_SEC, ROUND_SCREEN_SEC,
} from './economy.js';
import { Sound } from './audio.js';
import { t, setLang, resolveLanguage } from './i18n.js';

// ---------- рендер ----------
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap 2 — мобильная производительность
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap; // жёсткие тени — воксельный стиль

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2f2e5c'); // фолбэк, пока грузится скайбокс (цвет зенита текстуры)
scene.fog = new THREE.Fog('#c9955f', 40, 90);  // тёплая дымка под закатное небо

// скайбокс: цельная СФЕРА-купол вокруг игрока (следует за камерой в tick).
// Исходник — широкий кадр города (не 360°-панорама), поэтому на сферу его
// натягиваем не equirect-маппингом (это давало "tiny planet"), а собираем
// честную equirect-развёртку на canvas сами:
//   - картинка занимает пояс широт вокруг горизонта (город внизу пояса);
//   - выше пояса до зенита — плавный градиент, продолжающий цвет верхнего
//     края картинки, + звёзды (у полюса растянутые по X — компенсация
//     сжатия долгот, на сфере становятся круглыми);
//   - ниже пояса до надира — градиент из цвета нижнего края в темноту.
// У сферы нет ни торцов, ни крышек — над головой и под ногами просто небо,
// никаких кругов-заглушек. Один вертикальный шов сзади (края картинки).
const skyGeo = new THREE.SphereGeometry(140, 48, 32);
const skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, color: '#2f2e5c' });
const skyMesh = new THREE.Mesh(skyGeo, skyMat);
skyMesh.renderOrder = -1;
scene.add(skyMesh);

function skyRng(seed) {
  let a = seed | 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Средний цвет горизонтальной полосы картинки (для продолжения краёв
 * градиентом) — подбирается из самой картинки, работает с любым скайбоксом. */
function avgRow(ctx, w, y0, rows) {
  const data = ctx.getImageData(0, y0, w, rows).data;
  let r = 0, g = 0, b = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}
const rgb = (c, mul = 1) =>
  `rgb(${Math.round(c[0] * mul)},${Math.round(c[1] * mul)},${Math.round(c[2] * mul)})`;

/** Собирает equirect-текстуру неба (2:1) из широкого кадра. */
function buildSkyTexture(img) {
  const W = 2048, H = 1024;
  // край картинки для стыковки градиентов
  const probe = document.createElement('canvas');
  probe.width = img.width; probe.height = img.height;
  const pctx = probe.getContext('2d');
  pctx.drawImage(img, 0, 0);
  const edge = Math.max(1, Math.round(img.height * 0.02));
  const topColor = avgRow(pctx, img.width, 0, edge);
  const botColor = avgRow(pctx, img.width, img.height - edge, edge);

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  // пояс картинки: широты от +55° (верх кадра) до -35° (низ кадра);
  // строка canvas = (90° - широта) / 180° * H
  const rowTop = Math.round((90 - 55) / 180 * H);
  const rowBot = Math.round((90 + 35) / 180 * H);
  // зенит: тот же тон, что верх картинки, но темнее — небо "уходит в ночь"
  const gTop = ctx.createLinearGradient(0, 0, 0, rowTop + 1);
  gTop.addColorStop(0, rgb(topColor, 0.55));
  gTop.addColorStop(1, rgb(topColor));
  ctx.fillStyle = gTop;
  ctx.fillRect(0, 0, W, rowTop + 1);
  // надир: низ картинки уходит в темноту
  const gBot = ctx.createLinearGradient(0, rowBot - 1, 0, H);
  gBot.addColorStop(0, rgb(botColor));
  gBot.addColorStop(1, rgb(botColor, 0.25));
  ctx.fillStyle = gBot;
  ctx.fillRect(0, rowBot - 1, W, H - rowBot + 1);
  // сама картинка поясом вокруг горизонта
  ctx.drawImage(img, 0, 0, img.width, img.height, 0, rowTop, W, rowBot - rowTop);
  // мягкий стык градиента с верхом картинки
  const fade = ctx.createLinearGradient(0, rowTop, 0, rowTop + 40);
  fade.addColorStop(0, rgb(topColor));
  fade.addColorStop(1, `rgba(${topColor[0]},${topColor[1]},${topColor[2]},0)`);
  ctx.fillStyle = fade;
  ctx.fillRect(0, rowTop, W, 40);
  // звёзды от ~72° широты вниз до верхней части пояса; ellipse с растяжением
  // по X компенсирует сжатие долгот — на сфере звёзды круглые. Выше 72° НЕ
  // рисуем: у полюса любые точки сходятся в радиальный "фейерверк", пусть
  // там будет чистый градиент
  const rnd = skyRng(1337);
  const yMin = Math.round(H * 0.10); // широта ~72°
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 400; i++) {
    const y = yMin + rnd() * (rowTop * 1.25 - yMin);
    const lat = (0.5 - y / H) * Math.PI;
    const stretch = 1 / Math.max(0.3, Math.cos(lat));
    const r = rnd() < 0.15 ? 1.7 : 0.9;
    ctx.globalAlpha = 0.3 + rnd() * 0.5;
    ctx.beginPath();
    ctx.ellipse(rnd() * W, y, r * stretch, r, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, zenith: rgb(topColor, 0.55) };
}

/** Грузит скайбокс по URL (кеш по URL — реванш/повтор не перегружает). */
let currentSkyboxUrl = null;
function loadSkybox(url) {
  if (url === currentSkyboxUrl) return;
  currentSkyboxUrl = url;
  const img = new Image();
  img.onload = () => {
    if (url !== currentSkyboxUrl) return; // пока грузилась — выбрали другую карту
    const { tex, zenith } = buildSkyTexture(img);
    const previous = skyMat.map;
    skyMat.map = tex;
    skyMat.color.set('#ffffff');
    skyMat.needsUpdate = true;
    scene.background = new THREE.Color(zenith); // фолбэк до загрузки следующего
    previous?.dispose();
  };
  img.onerror = () => { if (url === currentSkyboxUrl) currentSkyboxUrl = null; };
  img.src = url;
}
loadSkybox('assets/skybox.jpg');

// процедурное окружение для металла 3D-пушек (PBR без внешних ассетов)
import('three/addons/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
});

const BASE_FOV = 78;
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

const ambient = new THREE.AmbientLight('#bcd4e8', 0.75);
const sun = new THREE.DirectionalLight('#fff4d6', 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -25; sun.shadow.camera.right = 25;
sun.shadow.camera.top = 25; sun.shadow.camera.bottom = -25;
sun.shadow.camera.far = 100;
scene.add(ambient, sun, sun.target);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- смерть = разлёт на кубики ----------
class GibPool {
  constructor(size = 40) {
    this.items = [];
    for (let i = 0; i < size; i++) {
      const mat = new THREE.MeshLambertMaterial({ transparent: true });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), mat);
      mesh.visible = false;
      mesh.castShadow = true;
      scene.add(mesh);
      this.items.push({ mesh, vel: new THREE.Vector3(), rot: new THREE.Vector3(), life: 0 });
    }
  }
  explode(pos, colors) {
    Sound.death();
    for (const it of this.items) {
      it.mesh.visible = true;
      it.mesh.material.color.set(colors[Math.floor(Math.random() * colors.length)]);
      it.mesh.material.opacity = 1;
      it.mesh.position.set(
        pos.x + (Math.random() - 0.5) * 0.5,
        pos.y + 0.3 + Math.random() * 1.3,
        pos.z + (Math.random() - 0.5) * 0.5);
      it.vel.set((Math.random() - 0.5) * 7, 3 + Math.random() * 6, (Math.random() - 0.5) * 7);
      it.rot.set(Math.random() * 12, Math.random() * 12, Math.random() * 12);
      it.life = 1;
    }
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      it.life -= dt;
      if (it.life <= 0) { it.mesh.visible = false; continue; }
      it.vel.y -= 18 * dt;
      it.mesh.position.addScaledVector(it.vel, dt);
      it.mesh.rotation.x += it.rot.x * dt;
      it.mesh.rotation.y += it.rot.y * dt;
      it.mesh.material.opacity = it.life; // fade 1с
    }
  }
  clear() {
    for (const it of this.items) {
      it.life = 0;
      it.mesh.visible = false;
    }
  }
}

// ---------- состояние ----------
const G = {
  state: 'menu',      // menu | loading | countdown | playing | paused | roundend | roundscreen | matchend
  map: null,
  mapGroup: null,
  player: null,
  ghost: null,
  pickups: [],
  tracers: null,
  gibs: null,
  skin: null,
  score: { me: 0, foe: 0 },
  ghostEntry: null,
  mapId: 'arena01',
  roundRecorder: null,
  roundElapsed: 0,
  roundStartedAt: null,
  roundPausedMs: 0,
  roundPauseAt: null,
  bestRound: null,     // { durationSec, data } — быстрейший выигранный раунд
  ownerDurationSec: null,
  mapIsEmbedded: false,
  startSeq: 0,
  platformPaused: false,
  matchShots: 0,
  matchHits: 0,
  matchHeadshots: 0,
  matchBodyshots: 0,
  countdownT: 0,
  roundEndT: 0,
  playerGhost: null,   // сохранённая обёртка призрака игрока
};

const settings = { lang: 'ru', fireMode: 'button', sensitivity: 1, sound: true, tutorialDone: false };

// ---------- туториал первого запуска ----------
const TUT = { active: false, step: 0, timer: 0 };

async function startTutorial() {
  const g = (await ui.ghostsForMap('arena01'))[0];
  if (!g) { ui.buildMaps(); return; } // призраки не загрузились — обычный флоу
  TUT.active = true;
  TUT.step = 1;
  startMatch('arena01', { ...g, _builtin: true, _diffMult: 1 });
  tutShow(t('tutHint1'));
  document.getElementById('tut-close').onclick = () => finishTutorial(false);
}

function tutShow(text) {
  const box = document.getElementById('tut-box');
  box.classList.remove('hidden');
  document.getElementById('tut-text').textContent = text;
}

function tutHide() {
  document.getElementById('tut-box').classList.add('hidden');
  document.getElementById('tut-arrow').classList.add('hidden');
}

function finishTutorial(won) {
  if (!TUT.active) return;
  TUT.active = false;
  tutHide();
  settings.tutorialDone = true;
  persist();
  if (won) ui.toast(t('tutorialWin'));
}

const _tutV = new THREE.Vector3();
function updateTutorial(dt) {
  if (!TUT.active) return;
  const arrow = document.getElementById('tut-arrow');
  if (TUT.step === 1) {
    // стрелка над пикапом дробовика, спроецированная на экран
    const pk = G.pickups.find(p => p.type === 1 && p.available);
    if (pk) {
      _tutV.copy(pk.pos).add({ x: 0, y: 1.1, z: 0 }).project(camera);
      if (_tutV.z < 1) {
        arrow.classList.remove('hidden');
        arrow.style.left = THREE.MathUtils.clamp((_tutV.x * 0.5 + 0.5) * 100, 5, 95) + 'vw';
        arrow.style.top = THREE.MathUtils.clamp((-_tutV.y * 0.5 + 0.5) * 100, 10, 90) + 'vh';
      } else {
        arrow.classList.add('hidden'); // пикап за спиной
      }
    }
    if (G.player.weapon !== 0) { // подобрал любую пушку — шаг 2
      arrow.classList.add('hidden');
      TUT.step = 2;
      TUT.timer = 5;
      tutShow(t('tutHint2'));
    }
  } else if (TUT.step === 2) {
    TUT.timer -= dt;
    if (TUT.timer <= 0) { TUT.step = 3; TUT.timer = 6; tutShow(t('tutHint3')); }
  } else if (TUT.step === 3) {
    TUT.timer -= dt;
    if (TUT.timer <= 0) { TUT.step = 4; tutHide(); }
  }
}

let customMap = null;
let shop = { packs: [], skins: [] };
let wallet = { coins: 0, owned: ['default'], equipped: 'default' };
let defaultSkin = null;

const ui = new UI({
  settings,
  startMatch,
  saveSettings: persist,
  getPlayerGhost: () => G.playerGhost,
  getCustomMap: () => customMap,
  getShop: () => shop,
  getWallet: () => wallet,
  loadPaymentCatalog: () => Platform.loadPaymentCatalog(),
  buyCoins: async (pack) => { wallet = await Platform.buyCoinsPack(pack.id, pack.coins); },
  buyOrEquipSkin,
  getShareUrl: (code) => Platform.getShareUrl(code),
  doubleReward: doubleMatchReward,
  shouldTutorial: () => !settings.tutorialDone,
  startTutorial,
  rematchRewarded,
  resumeMatch: () => resumeMatch(),
  exitMatch: () => endMatchToMenu(),
});

/** Цена по каталогу, а не по объекту из UI: цену назначают только данные. */
function catalogSkinPrice(id) {
  if (id === 'default') return 0;
  if (id === 'custom') {
    return Number.isInteger(shop.customSkinPrice) && shop.customSkinPrice >= 0 ? shop.customSkinPrice : Infinity;
  }
  const item = shop.skins?.find(s => s.id === id);
  return Number.isInteger(item?.price) && item.price >= 0 ? item.price : Infinity;
}

/** Покупка/надевание скина из магазина. Возвращает 'ok' | 'poor'. */
async function buyOrEquipSkin(item) {
  const id = item?.id;
  if (typeof id !== 'string' || !/^[a-z0-9_-]{1,48}$/i.test(id)) return 'poor';
  if (!wallet.owned.includes(id)) {
    const price = catalogSkinPrice(id);
    if (!Number.isFinite(price) || wallet.coins < price) return 'poor';
    wallet.coins -= price;
    wallet.owned.push(id);
  }
  wallet.equipped = id;
  await Platform.saveWallet(wallet);
  G.skin = await resolveActiveSkin();
  return 'ok';
}

/** Активный скин по wallet.equipped: 'custom' — из редактора, иначе магазин/дефолт. */
async function resolveActiveSkin() {
  const eq = wallet.equipped ?? 'default';
  if (eq === 'custom') return (await Platform.loadSkin()) ?? defaultSkin;
  const shopItem = shop.skins?.find(s => s.id === eq);
  return shopItem?.skin ?? defaultSkin;
}
const mobile = new MobileControls(settings);

// ---------- pointer lock (десктоп) + фолбэк без него ----------
// В песочницах/iframe (встроенное превью) pointer lock запрещён — тогда
// включается фолбэк: камера крутится обычным движением мыши, огонь по ЛКМ.
let locked = false;
let lockFallback = false;

function tryLock() {
  if (IS_TOUCH || locked || lockFallback) return;
  try {
    const r = canvas.requestPointerLock();
    if (r && typeof r.catch === 'function') r.catch(() => { lockFallback = true; });
  } catch { lockFallback = true; }
}

canvas.addEventListener('click', () => {
  Sound.init(); Sound.resume();
  if (G.state === 'playing' || G.state === 'countdown') tryLock();
});
document.addEventListener('pointerlockchange', () => {
  const was = locked;
  locked = document.pointerLockElement === canvas;
  // ESC во время игры снимает захват мыши → это и есть "открыть паузу"
  if (was && !locked && (G.state === 'playing' || G.state === 'countdown')) {
    // При скрытии Yandex пришлёт authoritative game_api_pause; обычный Escape
    // во видимой вкладке остаётся ручной паузой.
    if (!(Platform.isYandex && document.hidden)) pauseMatch();
  }
});
document.addEventListener('mousemove', (e) => {
  if (!G.player) return;
  const inGame = G.state === 'playing' || G.state === 'countdown';
  if (!locked && !(lockFallback && inGame)) return;
  const s = 0.0022 * settings.sensitivity * (G.player.aiming ? 0.45 : 1);
  G.player.addLook(e.movementX * s, e.movementY * s);
});
document.addEventListener('mousedown', (e) => {
  if (!((locked || lockFallback) && G.player && G.state === 'playing')) return;
  if (e.button === 0) G.player.input.fire = true;
  if (e.button === 2) G.player.input.aim = true;
});
document.addEventListener('mouseup', (e) => {
  if (!G.player) return;
  if (e.button === 0) G.player.input.fire = false;
  if (e.button === 2) G.player.input.aim = false;
});
// сворачивание вкладки: пауза матча и звука (требование площадок)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // На Яндексе состояние синхронизируют game_api_pause/resume. Если здесь
    // успеть поставить manual pause раньше SDK event, platform resume уже не
    // имеет права снять её. В offline режиме сохраняем прежнюю автопаузу.
    if (!Platform.isYandex && (G.state === 'playing' || G.state === 'countdown')) pauseMatch();
    Sound.suspend();
  } else {
    // Не будим AudioContext в menu/matchend (там может идти platform ad).
    if (['loading', 'countdown', 'playing', 'roundend', 'roundscreen'].includes(G.state)) Sound.resume();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  // с pointer lock браузер сам шлёт pointerlockchange; здесь — путь без лока
  if (!locked && (G.state === 'playing' || G.state === 'countdown')) pauseMatch();
  else if (G.state === 'paused') resumeMatch();
});
document.addEventListener('ghostfire:pause-request', () => {
  if (G.state === 'paused') resumeMatch();
  else pauseMatch();
});
document.addEventListener('ghostfire:platform-pause', () => {
  if (G.state === 'playing' || G.state === 'countdown') pauseMatch('platform');
});
document.addEventListener('ghostfire:platform-resume', () => {
  if (!G.platformPaused) return; // ручную паузу платформа снимать не вправе
  if (G.state === 'paused') resumeMatch('platform');
  else G.platformPaused = false;
});

// ---------- пауза ----------
function pauseMatch(source = 'manual') {
  if (G.state !== 'playing' && G.state !== 'countdown') return;
  G._pausedFrom = G.state;
  G.platformPaused = source === 'platform';
  if (G.state === 'playing') G.roundPauseAt = performance.now();
  G.state = 'paused';
  // game_api_pause уже синхронизировал GameplayAPI внутри Platform.
  if (source !== 'platform') Platform.gameplayStop?.();
  if (G.player) G.player.input.fire = false;
  mobile.setPaused?.(true);
  Sound.suspend();
  document.exitPointerLock?.();
  ui.buildPause();
}

function resumeMatch(source = 'manual') {
  if (G.state !== 'paused') return;
  if (G.platformPaused && source !== 'platform') return;
  ui.hideAll();
  G.state = G._pausedFrom ?? 'playing';
  if (G.state === 'playing' && G.roundPauseAt != null) {
    G.roundPausedMs += performance.now() - G.roundPauseAt;
    G.roundPauseAt = null;
  }
  G.platformPaused = false;
  mobile.setPaused?.(false);
  Sound.resume();
  // Аналогично, game_api_resume не нужно подтверждать вторым SDK-вызовом.
  if (G.state === 'playing' && source !== 'platform') Platform.gameplayStart?.();
  tryLock();
}

// ---------- матч ----------
function cleanupMatchEntities() {
  Sound.stopAll?.();
  if (G.player) G.player.dispose();
  if (G.ghost) G.ghost.dispose();
  for (const p of G.pickups) p.dispose(scene);
  if (G.mapGroup) scene.remove(G.mapGroup);
  G.map?.dispose();
  G.player = null;
  G.ghost = null;
  G.pickups = [];
  G.map = null;
  G.mapGroup = null;
  G.roundRecorder = null;
  G.roundElapsed = 0;
  G.roundStartedAt = null;
  G.roundPausedMs = 0;
  G.roundPauseAt = null;
  G.tracers?.clear();
  G.gibs?.clear();
  mobile.attach(null, () => null);
  mobile.reset?.();
}

async function startMatch(mapId, ghostEntry) {
  let replay;
  try {
    replay = decode(ghostEntry?.data);
  } catch (error) {
    console.warn('[game] invalid replay', error);
    ui.toast(t('badCode'));
    return;
  }
  const startSeq = ++G.startSeq;
  Sound.init(); Sound.stopAll?.(); Sound.resume();
  G.state = 'loading';
  G.platformPaused = false;
  Platform.gameplayStop?.();
  // встроенные боты существуют на каждой карте — выбор игрока главнее;
  // призраки-вызовы наоборот привязаны к своей карте (едет с призраком)
  G.mapId = ghostEntry?._builtin ? mapId : (ghostEntry?.map ?? mapId);
  G.ghostEntry = ghostEntry;
  G.score.me = 0; G.score.foe = 0; G.bestRound = null;
  G.matchShots = 0; G.matchHits = 0; G.matchHeadshots = 0; G.matchBodyshots = 0;
  G.lastReward = null;
  G.ownerDurationSec = null;
  G.mapIsEmbedded = Boolean(ghostEntry?.mapData || G.mapId === '__custom');

  // очистка предыдущего матча
  cleanupMatchEntities();

  let nextMap;
  try {
    if (ghostEntry?.mapData) {
      // призрак пришёл с собственной картой (шеринг с пользовательской карты)
      nextMap = new GameMap(ghostEntry.mapData);
    } else if (G.mapId === '__custom') {
      const data = await Platform.loadCustomMap();
      if (!data) throw new Error('custom map is unavailable');
      nextMap = new GameMap(data);
    } else {
      nextMap = await GameMap.load(G.mapId);
    }
  } catch (error) {
    if (startSeq !== G.startSeq) return;
    console.warn('[game] map load failed', error);
    G.state = 'menu';
    G.ghostEntry = null;
    G.mapIsEmbedded = false;
    Sound.suspend();
    ui.buildMenu();
    ui.toast(t('edLoadFailed'));
    return;
  }
  // Двойной клик может запустить два fetch карты. Доживает только последний;
  // ресурсы опоздавшей загрузки сразу освобождаем.
  if (startSeq !== G.startSeq) {
    nextMap?.dispose();
    return;
  }
  G.map = nextMap;
  G.mapGroup = G.map.mesh;
  scene.add(G.mapGroup);
  loadSkybox(G.map.data.skybox ?? 'assets/skybox.jpg');

  // солнце в фактический центр карты (важно для UGC-карт)
  const blocks = G.map.data.blocks ?? [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const b of blocks) {
    minX = Math.min(minX, b[0]); maxX = Math.max(maxX, b[0]);
    minZ = Math.min(minZ, b[2]); maxZ = Math.max(maxZ, b[2]);
  }
  const cx = blocks.length ? (minX + maxX + 1) * 0.5 : 0;
  const cz = blocks.length ? (minZ + maxZ + 1) * 0.5 : 0;
  sun.position.set(cx + 18, 30, cz + 10);
  sun.target.position.set(cx, 0, cz);

  G.pickups = G.map.weaponSpots.map(s => new Pickup(s, G.skin, scene));
  G.tracers ??= new TracerPool(scene);
  G.gibs ??= new GibPool();
  G.tracers.clear();
  G.gibs.clear();

  const declaredDuration = Number(ghostEntry?.durationSec);
  const minDeclaredDuration = Math.max(0.05, replay.durationSec - 1 / replay.tickRate);
  G.ownerDurationSec = Number.isFinite(declaredDuration) &&
    declaredDuration >= minDeclaredDuration && declaredDuration <= 600
    ? declaredDuration
    : (!ghostEntry?._builtin && replay.durationSec > 0 ? replay.durationSec : null);
  G.ghost = new Ghost({
    replay, map: G.map, skin: G.skin, scene,
    pickups: G.pickups,
    onShoot: ghostShoots,
  });

  G.player = new Player({
    camera, map: G.map, skin: G.skin,
    onFire: playerShoots,
  });
  mobile.attach(G.player, () => G.ghost);
  mobile.setPaused?.(false);

  ui.hideAll();
  startRound();
}

function startRound() {
  // игрок спавнится на точке, ДАЛЬНЕЙ от старта записи призрака —
  // иначе против шеренного призрака оба окажутся на одном спавне
  const gs = G.ghost.replay.frames[0] ?? { x: 0, z: 0 };
  const spawn = [...G.map.spawns].sort((a, b) =>
    ((b.pos.x - gs.x) ** 2 + (b.pos.z - gs.z) ** 2) -
    ((a.pos.x - gs.x) ** 2 + (a.pos.z - gs.z) ** 2))[0] ?? G.map.spawns[0];
  G.player.spawn(spawn);
  G.player.recorder = null;
  for (const p of G.pickups) { p.timer = 0; p.mesh.visible = true; }
  G.ghost.reset();
  ui.setHP(100);
  ui.setWeapon(WEAPONS[0].key);
  ui.setAmmo(G.player.ammoInfo);
  ui.setScore(G.score.me, G.score.foe);
  ui.banner(null);
  G.state = 'countdown';
  G.countdownT = ROUND_COUNTDOWN_SEC;
  ui.countdown(Math.ceil(ROUND_COUNTDOWN_SEC));
  Sound.countdown();
  tryLock();
}

function beginPlay() {
  G.state = 'playing';
  ui.countdown(null);
  Sound.go();
  G.roundRecorder = new Recorder(TICK_RATE);
  G.player.recorder = G.roundRecorder;
  G.roundElapsed = 0;
  G.roundStartedAt = performance.now();
  G.roundPausedMs = 0;
  G.roundPauseAt = null;
  Platform.gameplayStart?.();
}

function currentRoundDuration() {
  if (G.roundStartedAt == null) return 0;
  const openPause = G.roundPauseAt != null ? performance.now() - G.roundPauseAt : 0;
  return Math.max(0, (performance.now() - G.roundStartedAt - G.roundPausedMs - openPause) / 1000);
}

// выстрел игрока → hitscan по призраку
const _assistDir = new THREE.Vector3();
function playerShoots(weaponId, origin, dir) {
  if (G.state !== 'playing') return 0;
  _assistDir.copy(dir);
  MobileControls.applyAimAssist(_assistDir, origin, G.ghost, 3);
  const res = fireHitscan(G.map, origin, _assistDir, weaponId,
    G.ghost.alive ? [G.ghost.target] : []);
  const skin = G.skin;
  const color = weaponId === RAILGUN ? skin.railTracer : skin.tracer;
  for (const end of res.tracerEnds) {
    // трассер из "дула" чуть ниже глаз
    const from = origin.clone().addScaledVector(_assistDir, 0.4);
    from.y -= 0.12;
    G.tracers.spawn(from, end, color, weaponId === RAILGUN ? 0.4 : 0.12);
  }
  G.matchShots++;
  if (res.hits > 0) {
    G.matchHits++;
    if (res.headshots > 0) G.matchHeadshots++; else G.matchBodyshots++;
    ui.hitmarker();
    if (res.headshots > 0) Sound.headshot(); else Sound.hit();
    if (!G.ghost.alive) {
      G._lastKill = { weaponId, headshot: res.headshots > 0 };
    }
    return res.headshots > 0 ? 2 : 1;
  }
  return 0;
}

// выстрел призрака → hitscan по игроку
const _pHead = new THREE.Box3(), _pBody = new THREE.Box3();
const _v = new THREE.Vector3();
function ghostShoots(weaponId, origin, dir) {
  if (G.state !== 'playing') return;
  const p = G.player;
  _pHead.setFromCenterAndSize(_v.set(p.pos.x, p.pos.y + MOVE.eye, p.pos.z),
    new THREE.Vector3(0.45, 0.45, 0.45));
  _pBody.setFromCenterAndSize(_v.set(p.pos.x, p.pos.y + 0.7, p.pos.z),
    new THREE.Vector3(0.7, 1.4, 0.7));
  const target = {
    head: _pHead, body: _pBody,
    onHit: (part, dmg) => {
      p.takeDamage(dmg); ui.setHP(p.hp);
      if (!p.alive) G._lastKill = { weaponId, headshot: part === 'head' };
    },
  };
  const res = fireHitscan(G.map, origin, dir, weaponId, p.alive ? [target] : []);
  const color = weaponId === RAILGUN ? G.skin.railTracer : G.skin.tracer;
  for (const end of res.tracerEnds) {
    G.tracers.spawn(origin.clone(), end, color, weaponId === RAILGUN ? 0.4 : 0.12);
  }
  if (!p.alive) onPlayerDied();
}

function onGhostDied() {
  if (G.state !== 'playing') return;
  // playerShoots завершился, markShot уже добавлен; закрываем timeline текущим
  // frame до encode, чтобы убийственный выстрел гарантированно воспроизводился.
  G.player.ensureFinalReplayFrame();
  const colors = Object.values(G.skin.body);
  G.gibs.explode(G.ghost.pos, colors);
  G.score.me++;
  // лучший раунд = быстрейшая победа; сохраняем для призрака игрока
  // Настоящее активное wall-clock время: frame-dt ограничен для физики 50 мс,
  // но таймер челленджа не должен замедляться на слабом устройстве. Паузы
  // вычитаются отдельно в pauseMatch/resumeMatch.
  const dur = Math.max(1 / TICK_RATE, currentRoundDuration());
  if (!G.bestRound || dur < G.bestRound.durationSec) {
    G.bestRound = { durationSec: dur, data: G.roundRecorder.encode() };
  }
  endRound(true);
}

function onPlayerDied() {
  if (G.state !== 'playing') return;
  G.gibs.explode(G.player.pos, Object.values(G.skin.body));
  G.score.foe++;
  endRound(false);
}

function endRound(playerWon) {
  G.state = 'roundend';
  Platform.gameplayStop?.();
  G.roundEndT = ROUND_TEARDOWN_SEC; // даём кубикам разлететься
  G._roundPlayerWon = playerWon;
  if (playerWon) Sound.winRound(); else Sound.loseRound();
  ui.setScore(G.score.me, G.score.foe);
  if (G._lastKill) {
    const weapon = t(WEAPONS[G._lastKill.weaponId].key);
    const zone = t(G._lastKill.headshot ? 'zoneHead' : 'zoneBody');
    ui.banner(t(playerWon ? 'killfeedWin' : 'killfeedLose', weapon, zone));
    G._lastKill = null;
  }
}

function afterRoundPause() {
  const matchOver = G.score.me >= WINS_TO_TAKE_MATCH || G.score.foe >= WINS_TO_TAKE_MATCH;
  if (matchOver) return endMatch();
  document.exitPointerLock?.();
  ui.showRoundScreen(G.score.me, G.score.foe, G._roundPlayerWon);
  G.state = 'roundscreen';
  setTimeout(() => {
    if (G.state !== 'roundscreen') return;
    ui.hideAll();
    startRound();
  }, ROUND_SCREEN_SEC * 1000);
}

async function endMatch() {
  G.state = 'matchend';
  Platform.gameplayStop?.();
  document.exitPointerLock?.();
  const won = G.score.me >= WINS_TO_TAKE_MATCH;
  const acc = G.matchShots ? G.matchHits / G.matchShots : 0;
  // призрак игрока = лучший раунд матча
  if (G.bestRound) {
    G.playerGhost = {
      v: 1, map: G.mapId, name: 'You',
      score: `${G.score.me}:${G.score.foe}`,
      durationSec: G.bestRound.durationSec,
      data: G.bestRound.data,
    };
    // Наследуем именно фактически сыгранную embedded/custom карту, а не
    // локальный слот редактора получателя challenge.
    if (G.mapIsEmbedded) G.playerGhost.mapData = G.map.data;
    await persist();
  }
  if (won) await Platform.recordWinAndSubmit?.('wins');
  finishTutorial(won); // если шёл туториал — завершаем (флаг + тост про вызов)
  // награда ТОЛЬКО за завершённый матч
  const serverNow = Platform.serverTime?.();
  const rewardNow = Number.isFinite(serverNow) ? serverNow : Date.now();
  G.lastReward = computeMatchReward(won, G.score.foe, G.ghostEntry, wallet, rewardNow);
  applyMatchReward(wallet, G.lastReward, won, rewardNow);
  await Platform.saveWallet(wallet);
  const playerBestDurationSec = G.bestRound?.durationSec ?? null;
  const timing = {
    ownerDurationSec: G.ownerDurationSec,
    playerBestDurationSec,
    beatOwnerTime: G.ownerDurationSec != null && playerBestDurationSec != null
      ? playerBestDurationSec < G.ownerDurationSec
      : null,
  };
  ui.showMatchScreen(G.score.me, G.score.foe, acc, won, G.ghostEntry, G.lastReward,
    { headshots: G.matchHeadshots, bodyshots: G.matchBodyshots }, timing);
  Platform.showInterstitialAd('match_end'); // кулдаун 3 мин внутри Platform
}

/** Rewarded "Удвоить награду": начисляет ту же сумму ещё раз, одноразово. */
async function doubleMatchReward() {
  if (!G.lastReward || G.lastReward.doubled || G.lastReward.total <= 0 || G._doubleRewardPending) return false;
  const reward = G.lastReward;
  G._doubleRewardPending = true;
  try {
    const granted = await Platform.showRewardedAd('double_match_reward');
    if (!granted || G.lastReward !== reward || reward.doubled) return false;
    reward.doubled = true;
    // Тот же bounded путь, что у основной выплаты: finite, >=0, cap 1e9.
    applyMatchReward(wallet, reward, false);
    await Platform.saveWallet(wallet);
    return true;
  } finally {
    G._doubleRewardPending = false;
  }
}

async function rematchRewarded() {
  // Полный честный реванш: новая серия до 5 со счёта 0:0.
  const granted = await Platform.showRewardedAd('rematch_full_restart');
  if (!granted) return;
  startMatch(G.mapId, G.ghostEntry);
}

function endMatchToMenu() {
  finishTutorial(false); // вышел из туториала — считаем пропущенным
  G.startSeq++; // отменяет ещё не завершившуюся асинхронную загрузку карты
  G.state = 'menu';
  G.platformPaused = false;
  Platform.gameplayStop?.();
  document.exitPointerLock?.();
  Sound.suspend();
  cleanupMatchEntities();
  // Не удерживаем большой входящий replay/mapData после выхода. Собственный
  // G.playerGhost остаётся — он является сохранением игрока и нужен меню.
  G.ghostEntry = null;
  G.bestRound = null;
  G.ownerDurationSec = null;
  G.mapIsEmbedded = false;
  G.lastReward = null;
  G._lastKill = null;
  ui.show('menu');
}

// ---------- сохранение ----------
async function persist() {
  Sound.setEnabled(settings.sound);
  mobile.applyFireMode();
  await Platform.savePlayer({ settings, ghost: G.playerGhost });
}

function setLoadProgress(pct) {
  const fill = document.getElementById('preloader-fill');
  if (fill) fill.style.width = Math.round(pct * 100) + '%';
}

async function boot() {
  setLoadProgress(0.15); // модули загружены, стартуем
  const weaponModelsReady = preloadWeaponModels();
  await Platform.initSDK();
  setLoadProgress(0.35);
  const saved = await Platform.loadPlayer();
  if (saved?.settings) Object.assign(settings, saved.settings);
  if (saved?.ghost) G.playerGhost = saved.ghost;
  // Выбор игрока > язык площадки/браузера > русский как последняя опора.
  settings.lang = resolveLanguage(saved?.settings?.lang, Platform.detectedLang);
  setLang(settings.lang);
  Sound.setEnabled(settings.sound);
  mobile.applyFireMode();

  defaultSkin = await (await fetch('skins/default.json')).json();
  customMap = await Platform.loadCustomMap();
  wallet = await Platform.loadWallet();
  try { shop = await (await fetch('skins/shop.json')).json(); } catch { /* магазин опционален */ }
  wallet = (await Platform.recoverPurchases?.(shop.packs ?? [], wallet)) ?? wallet;
  // активный скин: слот из редактора / купленный в магазине / стандартный
  G.skin = await resolveActiveSkin();
  setLoadProgress(0.6);
  await Promise.all([
    ui.ghostsForMap('arena01'), // прогрев ботов стартовой карты (туториал)
    weaponModelsReady,
  ]);
  setLoadProgress(0.95);

  // принятие вызова: payload платформы или ?ghost= из URL
  const launchCode = Platform.getLaunchPayload();
  const launchEntry = launchCode ? decodeShareCode(launchCode) : null;
  if (launchEntry) ui.buildChallenge(launchCode);
  else ui.buildMenu();

  // прячем прелоадер, и только затем сигналим платформе о готовности
  setLoadProgress(1);
  document.getElementById('preloader')?.classList.add('done');
  Platform.gameReady();
  requestAnimationFrame(loop);
}

// ---------- главный цикл ----------
let lastT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  tick(dt);
}

function tick(dt) {
  if (G.state === 'countdown') {
    const prev = Math.ceil(G.countdownT);
    G.countdownT -= dt;
    const cur = Math.ceil(G.countdownT);
    if (cur !== prev && cur > 0) { ui.countdown(cur); Sound.countdown(); }
    if (G.countdownT <= 0) beginPlay();
    // во время отсчёта можно осмотреться, но не двигаться
    G.player.camera.position.set(G.player.pos.x, G.player.pos.y + 1.6, G.player.pos.z);
    G.player.camera.rotation.set(G.player.pitch, G.player.yaw, 0, 'YXZ');
  }

  if (G.state === 'playing') {
    G.roundElapsed = currentRoundDuration();
    mobile.update();
    G.player.update(dt, G.pickups);
    if (G.player.alive === false && G.state === 'playing') onPlayerDied();
    if (G.ghost.alive === false && G.state === 'playing') onGhostDied();
    if (G.state === 'playing') {
      G.ghost.update(dt, G.player);
      ui.setWeapon(WEAPONS[G.player.weapon].key);
      ui.setCharging(G.player.charging);
      ui.setHP(G.player.hp);
      ui.setAmmo(G.player.ammoInfo);
      ui.setScope(G.player.aiming);
      updateTutorial(dt);
    }
  }

  // Плавный переход в оптику и обратно; вне матча всегда базовый обзор.
  const aiming = G.state === 'playing' && G.player?.aiming === true;
  const targetFov = aiming ? (WEAPONS[G.player.weapon].zoomFov ?? BASE_FOV) : BASE_FOV;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
    camera.updateProjectionMatrix();
  }
  if (!aiming && G.state !== 'playing') ui.setScope(false);

  if (G.state === 'roundend') {
    G.roundEndT -= dt;
    if (G.roundEndT <= 0) afterRoundPause();
  }

  const worldAdvances = G.state === 'countdown' || G.state === 'playing' || G.state === 'roundend';
  if (worldAdvances) {
    for (const p of G.pickups) p.update(dt);
    G.tracers?.update(dt);
    G.gibs?.update(dt);
  }
  if (G.state !== 'menu') {
    // скайбокс всегда центрирован на игроке по всем 3 осям — раньше по Y был
    // фиксирован (y=20), и на высоких точках карт (башни) игрок физически
    // приближался к закрытому торцу цилиндра, тот застилал полнеба огромным
    // кругом; теперь торец всегда на постоянном удалении (±250) от камеры
    skyMesh.position.x = camera.position.x;
    skyMesh.position.y = camera.position.y;
    skyMesh.position.z = camera.position.z;
    renderer.render(scene, camera);
  }
}

boot();

// отладочный хук (используется тестами/консолью, в проде не мешает)
window.GF = G;
window.GF.tick = tick;
