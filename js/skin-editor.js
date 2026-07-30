// Редактор скинов: цвета тела/пушек/эффектов с живым 3D-превью.
// Пишет тот же формат, что skins/default.json. Задел под донат-магазин.
import * as THREE from 'three';
import { buildWeaponModel } from './weapons.js';
import {
  ALLOWED_IMAGE_TYPES,
  ART_SIZE,
  MAX_IMAGE_BYTES,
  MASK_PRESETS,
  boxMaterials,
  imageToArt,
  sanitizeArt,
} from './face.js';
import { t } from './i18n.js';
import { Platform } from './platform.js';

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const MAX_CUSTOM_PARTS = 64;

const FIELDS = [
  { path: 'body.head', label: 'partHead', panel: 'skin-body' },
  { path: 'body.torso', label: 'partTorso', panel: 'skin-body' },
  { path: 'body.arms', label: 'partArms', panel: 'skin-body' },
  { path: 'body.legs', label: 'partLegs', panel: 'skin-body' },
  { path: 'weapons.pistol.body', label: 'partBody', panel: 'skin-pistol' },
  { path: 'weapons.pistol.grip', label: 'partGrip', panel: 'skin-pistol' },
  { path: 'weapons.pistol.accent', label: 'partAccent', panel: 'skin-pistol' },
  { path: 'weapons.smg.body', label: 'partBody', panel: 'skin-smg' },
  { path: 'weapons.smg.grip', label: 'partGrip', panel: 'skin-smg' },
  { path: 'weapons.smg.accent', label: 'partAccent', panel: 'skin-smg' },
  { path: 'weapons.ar.body', label: 'partBody', panel: 'skin-ar' },
  { path: 'weapons.ar.grip', label: 'partGrip', panel: 'skin-ar' },
  { path: 'weapons.ar.accent', label: 'partAccent', panel: 'skin-ar' },
  { path: 'weapons.shotgun.body', label: 'partBody', panel: 'skin-shotgun' },
  { path: 'weapons.shotgun.grip', label: 'partWood', panel: 'skin-shotgun' },
  { path: 'weapons.shotgun.accent', label: 'partAccent', panel: 'skin-shotgun' },
  { path: 'weapons.sniper.body', label: 'partBody', panel: 'skin-sniper' },
  { path: 'weapons.sniper.grip', label: 'partGrip', panel: 'skin-sniper' },
  { path: 'weapons.sniper.accent', label: 'partAccent', panel: 'skin-sniper' },
  { path: 'weapons.railgun.body', label: 'partBody', panel: 'skin-railgun' },
  { path: 'weapons.railgun.grip', label: 'partGrip', panel: 'skin-railgun' },
  { path: 'weapons.railgun.accent', label: 'partGlow', panel: 'skin-railgun' },
  { path: 'tracer', label: 'partTracer', panel: 'skin-fx' },
  { path: 'railTracer', label: 'partRailTracer', panel: 'skin-fx' },
  { path: 'ghostTint', label: 'partGhostTint', panel: 'skin-fx' },
];

const PANEL_IDS = [...new Set(FIELDS.map((field) => field.panel))];
const MODEL_KEYS = ['pistol', 'shotgun', 'railgun', 'smg', 'ar', 'sniper'];
const get = (obj, path) => path.split('.').reduce((value, key) => value?.[key], obj);
const set = (obj, path, value) => {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((target, key) => (target[key] ??= {}), obj)[last] = value;
};
const clone = (value) => JSON.parse(JSON.stringify(value));

function safeTriplet(value, min, max) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const result = value.map(Number);
  return result.every((number) => Number.isFinite(number) && number >= min && number <= max)
    ? result
    : null;
}

function sanitizeModels(models) {
  if (!models || typeof models !== 'object' || Array.isArray(models)) return undefined;
  const result = {};
  for (const key of MODEL_KEYS) {
    const parts = models[key];
    if (!Array.isArray(parts) || parts.length > MAX_CUSTOM_PARTS) continue;
    const safe = [];
    for (const part of parts) {
      const size = safeTriplet(part?.size, 0.01, 4);
      const pos = safeTriplet(part?.pos, -8, 8);
      const color = typeof part?.color === 'string' &&
        (['body', 'grip', 'accent'].includes(part.color) || COLOR_RE.test(part.color))
        ? part.color
        : null;
      if (size && pos && color) safe.push({ size, pos, color });
    }
    if (safe.length) result[key] = safe;
  }
  return Object.keys(result).length ? result : undefined;
}

function toEditorArt(art) {
  const safe = sanitizeArt(art, ART_SIZE);
  if (safe.size === ART_SIZE) return safe;
  const pixels = new Array(ART_SIZE * ART_SIZE).fill(null);
  for (let y = 0; y < ART_SIZE; y++) {
    for (let x = 0; x < ART_SIZE; x++) {
      const sourceX = Math.min(safe.size - 1, Math.floor(x * safe.size / ART_SIZE));
      const sourceY = Math.min(safe.size - 1, Math.floor(y * safe.size / ART_SIZE));
      pixels[y * ART_SIZE + x] = safe.pixels[sourceY * safe.size + sourceX];
    }
  }
  return { size: ART_SIZE, pixels };
}

function normalizeSkin(source, fallback) {
  const result = clone(fallback);
  for (const field of FIELDS) {
    const value = get(source, field.path);
    if (typeof value === 'string' && COLOR_RE.test(value)) set(result, field.path, value.toLowerCase());
  }
  result.art = {
    face: toEditorArt(source?.art?.face),
    torso: toEditorArt(source?.art?.torso),
  };
  const models = sanitizeModels(source?.models);
  if (models) result.models = models;
  else delete result.models;
  return result;
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

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const timer = setTimeout(() => finish(new Error('image timeout')), 10_000);
    const finish = (error) => {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(url);
      if (error) reject(error); else resolve(image);
    };
    image.onload = () => finish();
    image.onerror = () => finish(new Error('image decode failed'));
    image.src = url;
  });
}

/** Инициализирует редактор и возвращает контроллер жизненного цикла. */
export async function initSkinEditor(status) {
  const canvas = document.getElementById('skin-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#232a33');
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
  camera.position.set(0, 1.6, 4.2);
  camera.lookAt(0, 1, 0);
  scene.add(new THREE.AmbientLight('#bcd4e8', 0.8));
  const sun = new THREE.DirectionalLight('#fff4d6', 1.5);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(6, 0.2, 6),
    new THREE.MeshLambertMaterial({ color: '#7ec850' }),
  );
  floor.position.y = -0.1;
  scene.add(floor);

  const defaultResponse = await fetch('skins/default.json');
  if (!defaultResponse.ok) throw new Error(`default skin: HTTP ${defaultResponse.status}`);
  const defaultSkin = await defaultResponse.json();
  let skin = normalizeSkin((await Platform.loadSkin()) ?? defaultSkin, defaultSkin);
  let preview = new THREE.Group();
  scene.add(preview);

  let disposed = false;
  let raf = 0;
  let lastFrame = performance.now();
  let rebuildRequested = true;
  let paintingPointer = null;
  let eraser = false;
  const cleanups = [];
  const retired = new Map();
  const disposedResources = {};
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };

  const retire = (group) => {
    scene.remove(group);
    disposeObject(group, disposedResources);
    // GLTF-клоны могут добавиться в holder после удаления. Пока страница жива,
    // повторно осматриваем retired-группу и освобождаем поздние материалы.
    retired.set(group, performance.now() + 30_000);
  };
  const drainRetired = (force = false) => {
    const now = performance.now();
    for (const [group, deadline] of retired) {
      disposeObject(group, disposedResources);
      if (force || now >= deadline) retired.delete(group);
    }
  };

  function rebuild() {
    const oldPreview = preview;
    preview = new THREE.Group();
    scene.add(preview);
    retire(oldPreview);

    const part = (width, height, depth, color, x, y, z) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        new THREE.MeshLambertMaterial({ color }),
      );
      mesh.position.set(x, y, z);
      preview.add(mesh);
    };
    const artPart = (width, height, depth, color, art, x, y, z) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        boxMaterials((hex) => new THREE.MeshLambertMaterial({ color: hex }), color, art),
      );
      mesh.position.set(x, y, z);
      preview.add(mesh);
    };

    const body = skin.body;
    artPart(0.55, 0.55, 0.55, body.head, skin.art.face, 0, 1.43, 0);
    artPart(0.6, 0.55, 0.32, body.torso, skin.art.torso, 0, 0.88, 0);
    part(0.16, 0.5, 0.16, body.arms, -0.38, 1.05, 0);
    part(0.16, 0.5, 0.16, body.arms, 0.38, 1.05, 0);
    part(0.22, 0.6, 0.22, body.legs, -0.16, 0.3, 0);
    part(0.22, 0.6, 0.22, body.legs, 0.16, 0.3, 0);

    [0, 1, 2, 3, 4, 5].forEach((id) => {
      const weapon = buildWeaponModel(id, skin);
      weapon.scale.setScalar(1.05);
      const column = id % 3;
      const row = Math.floor(id / 3);
      weapon.position.set(-1.6 + column * 1.6, 0.45 - row * 0.55, 1.2 + row * 0.9);
      weapon.rotation.y = -0.5;
      preview.add(weapon);
    });
    const tracer = (color, y) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.04, 2.4),
        new THREE.MeshBasicMaterial({ color }),
      );
      mesh.position.set(1.6, y, 0);
      mesh.rotation.y = 0.4;
      preview.add(mesh);
    };
    tracer(skin.tracer, 1.7);
    tracer(skin.railTracer, 1.85);
  }

  const requestRebuild = () => { rebuildRequested = true; };

  function buildForm() {
    for (const id of PANEL_IDS) document.getElementById(id).replaceChildren();
    for (const field of FIELDS) {
      const row = document.createElement('div');
      row.className = 'crow';
      const label = document.createElement('span');
      label.dataset.i18n = field.label;
      label.textContent = t(field.label);
      const input = document.createElement('input');
      input.type = 'color';
      input.value = get(skin, field.path);
      input.addEventListener('input', () => {
        set(skin, field.path, input.value);
        requestRebuild();
      });
      row.append(label, input);
      document.getElementById(field.panel).append(row);
    }
  }

  const pixCanvas = document.getElementById('pix-canvas');
  const pixContext = pixCanvas.getContext('2d', { willReadFrequently: false });
  const cell = pixCanvas.width / ART_SIZE;
  const target = () => document.getElementById('pix-target').value;
  const getArt = () => {
    skin.art ??= {};
    skin.art[target()] = toEditorArt(skin.art[target()]);
    return skin.art[target()];
  };

  function drawPixels() {
    const art = getArt();
    for (let i = 0; i < ART_SIZE * ART_SIZE; i++) {
      const x = (i % ART_SIZE) * cell;
      const y = Math.floor(i / ART_SIZE) * cell;
      pixContext.fillStyle = ((i % ART_SIZE) + Math.floor(i / ART_SIZE)) % 2 ? '#252b33' : '#2c333d';
      pixContext.fillRect(x, y, cell, cell);
      if (art.pixels[i]) {
        pixContext.fillStyle = art.pixels[i];
        pixContext.fillRect(x, y, cell, cell);
      }
    }
  }

  function paintAt(event) {
    const rect = pixCanvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / rect.width * ART_SIZE);
    const y = Math.floor((event.clientY - rect.top) / rect.height * ART_SIZE);
    if (x < 0 || y < 0 || x >= ART_SIZE || y >= ART_SIZE) return;
    const art = getArt();
    const color = eraser ? null : document.getElementById('pix-color').value;
    if (art.pixels[y * ART_SIZE + x] === color) return;
    art.pixels[y * ART_SIZE + x] = color;
    drawPixels();
    requestRebuild();
  }

  const endPainting = (event) => {
    if (event.pointerId !== paintingPointer) return;
    paintingPointer = null;
    if (pixCanvas.hasPointerCapture?.(event.pointerId)) pixCanvas.releasePointerCapture(event.pointerId);
  };
  listen(pixCanvas, 'pointerdown', (event) => {
    if (paintingPointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    paintingPointer = event.pointerId;
    pixCanvas.setPointerCapture?.(event.pointerId);
    paintAt(event);
  });
  listen(pixCanvas, 'pointermove', (event) => {
    if (event.pointerId === paintingPointer) paintAt(event);
  });
  listen(pixCanvas, 'pointerup', endPainting);
  listen(pixCanvas, 'pointercancel', endPainting);
  listen(pixCanvas, 'lostpointercapture', endPainting);

  const targetSelect = document.getElementById('pix-target');
  const eraserButton = document.getElementById('pix-eraser');
  const clearButton = document.getElementById('pix-clear');
  listen(targetSelect, 'change', drawPixels);
  listen(eraserButton, 'click', () => {
    eraser = !eraser;
    eraserButton.classList.toggle('active', eraser);
    eraserButton.textContent = t(eraser ? 'eraserOn' : 'eraserOff');
  });
  listen(clearButton, 'click', () => {
    getArt().pixels.fill(null);
    drawPixels();
    requestRebuild();
  });

  const presetsBox = document.getElementById('pix-presets');
  presetsBox.replaceChildren();
  for (const [name, art] of Object.entries(MASK_PRESETS)) {
    const button = document.createElement('button');
    button.className = 'btn';
    button.style.flex = '1 1 45%';
    button.dataset.i18n = name;
    button.textContent = t(name);
    listen(button, 'click', () => {
      targetSelect.value = 'face';
      skin.art.face = sanitizeArt(art, ART_SIZE);
      drawPixels();
      requestRebuild();
    });
    presetsBox.append(button);
  }

  const upload = document.getElementById('pix-upload');
  listen(upload, 'change', async () => {
    const file = upload.files?.[0];
    upload.value = '';
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      status(t('imageUnsupported'), false);
      return;
    }
    if (file.size < 1 || file.size > MAX_IMAGE_BYTES) {
      status(t('imageTooLarge'), false);
      return;
    }
    try {
      const image = await loadImage(file);
      if (disposed) return;
      skin.art[target()] = imageToArt(image, ART_SIZE);
      drawPixels();
      requestRebuild();
      status(t(target() === 'face' ? 'imageOnFace' : 'imageOnTorso'));
    } catch {
      status(t('imageLoadFailed'), false);
    }
  });

  const saveButton = document.getElementById('btn-skin-save');
  const resetButton = document.getElementById('btn-skin-reset');
  listen(saveButton, 'click', async () => {
    saveButton.disabled = true;
    try {
      if (!(await Platform.saveSkin(skin))) {
        status(t('skinSaveFailed'), false);
        return;
      }
      const wallet = await Platform.loadWallet();
      if (Array.isArray(wallet?.owned) && wallet.owned.includes('custom')) {
        wallet.equipped = 'custom';
        if (!(await Platform.saveWallet(wallet))) {
          status(t('skinEquipFailed'), false);
          return;
        }
        status(t('skinApplied'));
      } else {
        status(t('skinDraftSaved'), false);
      }
    } finally {
      saveButton.disabled = false;
    }
  });
  listen(resetButton, 'click', async () => {
    const replacement = normalizeSkin(defaultSkin, defaultSkin);
    resetButton.disabled = true;
    try {
      if (!(await Platform.saveSkin(replacement))) {
        status(t('skinSaveFailed'), false);
        return;
      }
      skin = replacement;
      buildForm();
      drawPixels();
      requestRebuild();
      status(t('skinReset'));
    } finally {
      resetButton.disabled = false;
    }
  });

  function resize() {
    const width = Math.max(1, canvas.clientWidth || canvas.parentElement.clientWidth);
    const height = Math.max(1, canvas.clientHeight || canvas.parentElement.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  listen(window, 'resize', resize);

  const relocalize = () => {
    document.querySelectorAll('#panel-skin [data-i18n]').forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    eraserButton.textContent = t(eraser ? 'eraserOn' : 'eraserOff');
  };

  function frame(now) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    if (rebuildRequested) {
      rebuildRequested = false;
      rebuild();
    }
    drainRetired();
    const delta = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    preview.rotation.y += delta * 0.36;
    renderer.render(scene, camera);
  }

  buildForm();
  drawPixels();
  resize();
  raf = requestAnimationFrame(frame);

  return {
    relocalize,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      for (const cleanup of cleanups.splice(0)) cleanup();
      retire(preview);
      preview = null;
      drainRetired(true);
      disposeObject(floor, disposedResources);
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}
