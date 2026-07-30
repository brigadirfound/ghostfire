// Редактор карт GHOSTFIRE. Пишет тот же JSON, что maps/*.json.
// ЛКМ — действие инструмента, ПКМ — вращение камеры (OrbitControls).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import LZString from 'lz-string';
import { GameMap, paletteEntry } from './map.js';
import { Platform } from './platform.js';
import { initSkinEditor } from './skin-editor.js';
import { tilePreviewURL } from './textures.js';
import { applyDocumentTranslations, getLang, resolveLanguage, setLang, t as tr } from './i18n.js';
import { decompressURIComponentBounded } from './lz-bounded.js';
import { VALIDATION_LIMITS, validateCustomMap } from './validation.js';

const MAX_BLOCKS = VALIDATION_LIMITS.mapBlocks;
const MAX_WEAPONS = VALIDATION_LIMITS.mapWeapons;
const MAX_CODE_LENGTH = VALIDATION_LIMITS.shareCodeChars;
const MAX_JSON_LENGTH = VALIDATION_LIMITS.mapJsonChars;
const MIN_COORD = -VALIDATION_LIMITS.mapAxis;
const MAX_COORD = VALIDATION_LIMITS.mapAxis;
const MIN_Y = -8;
const MAX_Y = 32;
const SKYBOX_RE = /^assets\/(?!.*\.\.\/)[a-z0-9_./-]+\.(?:jpe?g|png|webp)$/i;

const DEFAULT_PALETTE = {
  1: { color: '#7ec850', tex: 'grass_dirt' },
  2: { color: '#8a8f98', tex: 'stone' },
  3: { color: '#d98f33', tex: 'crate' },
  4: { color: '#c0563e', tex: 'brick' },
  5: { color: '#3f7fd4', tex: 'metal' },
  6: { color: '#e8c84a', tex: 'sand' },
  7: { color: '#4a5058', tex: 'concrete' },
  8: { color: '#e8e8e8', tex: 'glass' },
};

const WEAPON_MARKER_COLORS = { 1: '#dd3322', 2: '#33ddff', 3: '#ffcc33', 4: '#33dd77', 5: '#cc55ff' };
const cleanups = [];
const listen = (target, type, handler, options) => {
  target.addEventListener(type, handler, options);
  cleanups.push(() => target.removeEventListener(type, handler, options));
};

function status(message, ok = true) {
  const element = document.getElementById('status');
  element.textContent = message;
  element.style.color = ok ? '#8f9' : '#f88';
  clearTimeout(status.timer);
  status.timer = setTimeout(() => { element.textContent = ''; }, 4_000);
}

function disposeObject(root, disposed = {}) {
  const geometries = disposed.geometries ??= new WeakSet();
  const materials = disposed.materials ??= new WeakSet();
  const textures = disposed.textures ??= new WeakSet();
  root?.traverse?.((object) => {
    if (object.geometry && !geometries.has(object.geometry)) {
      geometries.add(object.geometry);
      object.geometry.dispose?.();
    }
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) {
      if (!material || materials.has(material)) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture && !textures.has(value)) {
          textures.add(value);
          value.dispose();
        }
      }
      material.dispose?.();
    }
  });
  return disposed;
}

const inHorizontalBounds = (value) => Number.isFinite(value) && value >= MIN_COORD && value <= MAX_COORD;

function checkedMapData(value, { preserveSkybox = false } = {}) {
  const checked = validateCustomMap(value);
  if (!checked.ok) {
    const error = new Error(checked.code);
    error.validationCode = checked.code;
    throw error;
  }
  const skybox = preserveSkybox && typeof value.skybox === 'string' && value.skybox.length <= 160 &&
    SKYBOX_RE.test(value.skybox) ? value.skybox : undefined;
  return skybox ? { ...checked.value, skybox } : checked.value;
}

/** The editor and gameplay/cloud handoff share the exact custom-map validator. */
function normalizeMapData(value) {
  const safe = checkedMapData(value, { preserveSkybox: true });
  return {
    palette: safe.palette,
    blocks: new Map(safe.blocks.map(([x, y, z, type]) => [`${x}|${y}|${z}`, type])),
    spawns: safe.spawns.map((spawn) => [...spawn]),
    weapons: safe.weapons.map((weapon) => ({ type: weapon.type, pos: [...weapon.pos] })),
    skybox: safe.skybox,
  };
}

// ---------- вкладки ----------
const panels = { map: document.getElementById('panel-map'), skin: document.getElementById('panel-skin') };
const tabs = { map: document.getElementById('tab-map'), skin: document.getElementById('tab-skin') };
for (const name of ['map', 'skin']) {
  listen(tabs[name], 'click', () => {
    for (const panelName of ['map', 'skin']) {
      panels[panelName].classList.toggle('hidden', panelName !== name);
      tabs[panelName].classList.toggle('active', panelName === name);
      tabs[panelName].setAttribute('aria-selected', panelName === name ? 'true' : 'false');
    }
    window.dispatchEvent(new Event('resize'));
  });
}

// ---------- сцена ----------
const canvas = document.getElementById('map-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#7ec8e8');
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
camera.position.set(34, 26, 34);
const controls = new OrbitControls(camera, canvas);
controls.target.set(12, 0, 12);
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
controls.update();

scene.add(new THREE.AmbientLight('#bcd4e8', 0.75));
const sun = new THREE.DirectionalLight('#fff4d6', 1.6);
sun.position.set(40, 45, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
sun.shadow.camera.far = 150;
scene.add(sun);
const grid = new THREE.GridHelper(64, 64, '#446', '#335');
grid.position.set(0, 0.01, 0);
scene.add(grid);

function resize() {
  const width = Math.max(1, canvas.clientWidth || canvas.parentElement.clientWidth);
  const height = Math.max(1, canvas.clientHeight || canvas.parentElement.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
listen(window, 'resize', resize);

// ---------- данные карты ----------
const ed = {
  blocks: new Map(),
  palette: { ...DEFAULT_PALETTE },
  spawns: [null, null],
  weapons: [],
  skybox: undefined,
  tool: 'place',
  blockType: 2,
  mesh: null,
};
let mapRevision = 0;
const key = (x, y, z) => `${x}|${y}|${z}`;

function newMap(size = 24) {
  ed.blocks.clear();
  ed.palette = { ...DEFAULT_PALETTE };
  ed.spawns = [null, null];
  ed.weapons = [];
  ed.skybox = undefined;
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      ed.blocks.set(key(x, 0, z), 1);
      if (x === 0 || z === 0 || x === size - 1 || z === size - 1) {
        ed.blocks.set(key(x, 1, z), 2);
        ed.blocks.set(key(x, 2, z), 2);
      }
    }
  }
  controls.target.set(size / 2, 0, size / 2);
  buildPalette();
  rebuild();
}

function toData() {
  const blocks = [...ed.blocks.entries()].map(([blockKey, type]) => {
    const [x, y, z] = blockKey.split('|').map(Number);
    return [x, y, z, type];
  }).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
  return {
    id: 'custom',
    name: 'map_custom',
    palette: ed.palette,
    blocks,
    spawns: ed.spawns.filter(Boolean).map((spawn) => [...spawn]),
    weapons: ed.weapons.map((weapon) => ({ type: weapon.type, pos: [...weapon.pos] })),
    ...(ed.skybox ? { skybox: ed.skybox } : {}),
  };
}

function fromData(data) {
  const safe = normalizeMapData(data);
  ed.blocks = safe.blocks;
  ed.palette = { ...safe.palette };
  if (!(ed.blockType in ed.palette)) ed.blockType = Number(Object.keys(ed.palette)[0]);
  ed.spawns = safe.spawns;
  ed.weapons = safe.weapons;
  ed.skybox = safe.skybox;
  buildPalette();
  rebuild();
}

// ---------- рендер карты и маркеров ----------
const markers = new THREE.Group();
scene.add(markers);
const disposedResources = {};

function clearGroup(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObject(child, disposedResources);
  }
}

function rebuild() {
  if (ed.mesh) {
    scene.remove(ed.mesh);
    disposeObject(ed.mesh, disposedResources);
    ed.mesh = null;
  }
  if (ed.blocks.size) {
    const map = new GameMap({ ...toData(), spawns: [], weapons: [] });
    ed.mesh = map.mesh;
    scene.add(ed.mesh);
  }
  clearGroup(markers);
  ed.spawns.forEach((spawn, index) => {
    if (!spawn) return;
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 1.8, 0.7),
      new THREE.MeshLambertMaterial({
        color: index === 0 ? '#33ddff' : '#ff5533',
        transparent: true,
        opacity: 0.65,
      }),
    );
    marker.position.set(spawn[0], spawn[1] + 0.9, spawn[2]);
    markers.add(marker);
  });
  for (const weapon of ed.weapons) {
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.3, 0.6),
      new THREE.MeshLambertMaterial({ color: WEAPON_MARKER_COLORS[weapon.type] ?? '#dd3322' }),
    );
    marker.position.set(weapon.pos[0], weapon.pos[1] + 0.3, weapon.pos[2]);
    markers.add(marker);
  }
}

// ---------- инструменты ----------
document.querySelectorAll('.tool').forEach((button) => {
  listen(button, 'click', () => {
    document.querySelectorAll('.tool').forEach((candidate) => candidate.classList.remove('active'));
    button.classList.add('active');
    ed.tool = button.dataset.tool;
  });
});

function buildPalette() {
  const palette = document.getElementById('palette');
  palette.replaceChildren();
  for (const type of Object.keys(ed.palette).sort((a, b) => Number(a) - Number(b))) {
    const entry = paletteEntry(ed.palette, type);
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'pal' + (Number(type) === ed.blockType ? ' active' : '');
    const textureName = entry.tex === 'grass_dirt' ? 'grass' : entry.tex;
    if (textureName) {
      swatch.style.background = `url(${tilePreviewURL(textureName, entry.color)})`;
      swatch.style.backgroundSize = 'cover';
      swatch.style.imageRendering = 'pixelated';
    } else {
      swatch.style.background = entry.color;
    }
    swatch.title = `${tr('edBlockType')} ${type}: ${entry.tex ?? tr('edColor')}`;
    swatch.addEventListener('click', () => {
      ed.blockType = Number(type);
      buildPalette();
      if (!ed.tool.startsWith('place')) document.querySelector('[data-tool=place]')?.click();
    });
    palette.append(swatch);
  }
}

// ---------- клики по сцене ----------
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let downPointer = null;

function blockFitsMapSpan(nextX, nextZ) {
  let minX = nextX, maxX = nextX, minZ = nextZ, maxZ = nextZ;
  for (const blockKey of ed.blocks.keys()) {
    const [x, , z] = blockKey.split('|').map(Number);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return maxX - minX + 1 <= VALIDATION_LIMITS.mapSpan &&
    maxZ - minZ + 1 <= VALIDATION_LIMITS.mapSpan;
}

listen(canvas, 'pointerdown', (event) => {
  if (event.button !== 0 || downPointer) return;
  downPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  canvas.setPointerCapture?.(event.pointerId);
});
const cancelCanvasPointer = (event) => {
  if (downPointer?.id !== event.pointerId) return;
  downPointer = null;
};
listen(canvas, 'pointercancel', cancelCanvasPointer);
listen(canvas, 'lostpointercapture', cancelCanvasPointer);
listen(canvas, 'pointerup', (event) => {
  if (event.button !== 0 || downPointer?.id !== event.pointerId) return;
  const moved = Math.hypot(event.clientX - downPointer.x, event.clientY - downPointer.y);
  downPointer = null;
  if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (moved <= 5) handleClick(event);
});

function handleClick(event) {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);

  let point = null;
  let normal = null;
  if (ed.mesh) {
    const hit = raycaster.intersectObject(ed.mesh)[0];
    if (hit) {
      point = hit.point;
      normal = hit.face.normal;
    }
  }
  if (!point) {
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, hit)) {
      point = hit;
      normal = new THREE.Vector3(0, 1, 0);
    }
  }
  if (!point) return;

  const cellOn = point.clone().addScaledVector(normal, 0.5).floor();
  const cellIn = point.clone().addScaledVector(normal, -0.5).floor();
  if (!inHorizontalBounds(cellOn.x) || !inHorizontalBounds(cellOn.z)) {
    status(tr('edOutOfBounds'), false);
    return;
  }

  switch (ed.tool) {
    case 'place': {
      if (cellOn.y < MIN_Y || cellOn.y > MAX_Y) return;
      const blockKey = key(cellOn.x, cellOn.y, cellOn.z);
      if (!ed.blocks.has(blockKey) && ed.blocks.size >= MAX_BLOCKS) {
        status(tr('edBlockLimit'), false);
        return;
      }
      if (!ed.blocks.has(blockKey) && !blockFitsMapSpan(cellOn.x, cellOn.z)) {
        status(tr('edMapSpanLimit'), false);
        return;
      }
      ed.blocks.set(blockKey, ed.blockType);
      break;
    }
    case 'erase':
      ed.blocks.delete(key(cellIn.x, cellIn.y, cellIn.z));
      break;
    case 'spawn0':
    case 'spawn1': {
      const index = ed.tool === 'spawn0' ? 0 : 1;
      ed.spawns[index] = [cellOn.x + 0.5, cellOn.y, cellOn.z + 0.5, 0];
      break;
    }
    case 'weapon1':
    case 'weapon2':
    case 'weapon3':
    case 'weapon4':
    case 'weapon5': {
      const type = Number(ed.tool.slice(6));
      const index = ed.weapons.findIndex((weapon) =>
        Math.abs(weapon.pos[0] - (cellOn.x + 0.5)) < 0.6 &&
        Math.abs(weapon.pos[2] - (cellOn.z + 0.5)) < 0.6);
      if (index >= 0) ed.weapons.splice(index, 1);
      else if (ed.weapons.length < MAX_WEAPONS) {
        ed.weapons.push({ type, pos: [cellOn.x + 0.5, cellOn.y + 0.6, cellOn.z + 0.5] });
      } else {
        status(tr('edWeaponLimit'), false);
        return;
      }
      break;
    }
    default:
      return;
  }
  mapRevision++;
  rebuild();
}

// ---------- кнопки ----------
listen(document.getElementById('btn-new'), 'click', () => {
  mapRevision++;
  newMap(24);
  status(tr('edNewMap'));
});
listen(document.getElementById('btn-load1'), 'click', () => { void loadBuiltin('arena01'); });
listen(document.getElementById('btn-load2'), 'click', () => { void loadBuiltin('arena02'); });

async function loadBuiltin(id) {
  const revision = ++mapRevision;
  try {
    const response = await fetch(`maps/${id}.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (disposed || revision !== mapRevision) return;
    fromData(data);
    const spawn = data.spawns?.[0];
    if (spawn) controls.target.set(spawn[0], 0, spawn[2]);
    status(`${tr('edLoaded')} ${id}`);
  } catch {
    if (!disposed && revision === mapRevision) status(tr('edLoadFailed'), false);
  }
}

listen(document.getElementById('btn-export'), 'click', () => {
  try {
    const json = JSON.stringify(checkedMapData(toData(), { preserveSkybox: true }));
    if (json.length > MAX_JSON_LENGTH) throw new Error('bad_map_size');
    const code = LZString.compressToEncodedURIComponent(json);
    if (code.length > MAX_CODE_LENGTH) {
      status(tr('edMapTooLarge'), false);
      return;
    }
    document.getElementById('code-io').value = code;
    status(tr('edExported'));
  } catch {
    status(tr('edInvalidMap'), false);
  }
});

listen(document.getElementById('btn-import'), 'click', () => {
  try {
    const raw = document.getElementById('code-io').value.trim();
    if (!raw || raw.length > MAX_CODE_LENGTH) throw new Error('code length');
    const json = decompressURIComponentBounded(raw, MAX_JSON_LENGTH);
    if (typeof json !== 'string' || !json) throw new Error('json length');
    fromData(JSON.parse(json));
    mapRevision++;
    status(tr('edImported'));
  } catch {
    status(tr('edBadCode'), false);
  }
});

listen(document.getElementById('btn-download'), 'click', () => {
  try {
    const data = checkedMapData(toData(), { preserveSkybox: true });
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ghostfire-map.json';
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch {
    status(tr('edInvalidMap'), false);
  }
});

const saveButton = document.getElementById('btn-save');
listen(saveButton, 'click', async () => {
  if (!ed.spawns[0] || !ed.spawns[1]) {
    status(tr('edNeedSpawns'), false);
    return;
  }
  if (!ed.weapons.length) {
    status(tr('edNeedWeapons'), false);
    return;
  }
  saveButton.disabled = true;
  try {
    // Save the validator's detached allow-listed copy: gameplay receives the
    // same shape that passed here instead of failing later inside Platform.
    const data = checkedMapData(toData());
    const saved = await Platform.saveCustomMap(data);
    status(saved ? tr('edSaved') : tr('edSaveFailed'), saved);
  } catch {
    status(tr('edSaveFailed'), false);
  } finally {
    saveButton.disabled = false;
  }
});

let skinEditor = null;
let raf = 0;
let disposed = false;
const languageButton = document.getElementById('btn-lang');
let playerSnapshot = null;
let languageSaveQueue = Promise.resolve();
function refreshLanguage() {
  applyDocumentTranslations();
  languageButton.textContent = getLang().toUpperCase();
  languageButton.setAttribute('aria-label', tr('language'));
  buildPalette();
  skinEditor?.relocalize();
}
listen(languageButton, 'click', () => {
  const nextLanguage = getLang() === 'ru' ? 'en' : 'ru';
  setLang(nextLanguage);
  try { localStorage.setItem('ghostfire.editorLang', nextLanguage); } catch {}
  refreshLanguage();
  if (playerSnapshot) {
    const nextPlayer = {
      ...playerSnapshot,
      settings: { ...playerSnapshot.settings, lang: nextLanguage },
    };
    playerSnapshot = nextPlayer;
    // Serialize rapid toggles so an earlier cloud request cannot win the race.
    languageSaveQueue = languageSaveQueue
      .then(() => Platform.savePlayer(nextPlayer))
      .catch(() => false);
  }
});

function dispose() {
  if (disposed) return;
  disposed = true;
  cancelAnimationFrame(raf);
  clearTimeout(status.timer);
  for (const cleanup of cleanups.splice(0)) cleanup();
  skinEditor?.dispose();
  controls.dispose();
  if (ed.mesh) disposeObject(ed.mesh, disposedResources);
  clearGroup(markers);
  disposeObject(grid, disposedResources);
  sun.shadow.map?.dispose();
  renderer.dispose();
  renderer.forceContextLoss?.();
}
listen(window, 'pagehide', dispose, { once: true });

async function boot() {
  const initialMapRevision = mapRevision;
  try {
    await Platform.initSDK();
  } catch {
    status(tr('edPlatformFailed'), false);
  }
  let savedLanguage;
  try { savedLanguage = localStorage.getItem('ghostfire.editorLang'); } catch {}
  try { playerSnapshot = await Platform.loadPlayer(); } catch {}
  const savedPlayerLanguage = playerSnapshot?.settings?.lang;
  setLang(resolveLanguage(savedPlayerLanguage, savedLanguage, Platform.detectedLang));
  refreshLanguage();

  try {
    const saved = await Platform.loadCustomMap();
    if (initialMapRevision === mapRevision) {
      if (saved) fromData(saved); else newMap(24);
    }
  } catch {
    if (initialMapRevision === mapRevision) {
      newMap(24);
      status(tr('edLoadFailed'), false);
    }
  }
  resize();
  try {
    skinEditor = await initSkinEditor(status);
  } catch {
    status(tr('skinLoadFailed'), false);
  }

  const loop = () => {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);
}

boot();
