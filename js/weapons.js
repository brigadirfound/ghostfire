// Оружие: параметры, GLTF-модели (view/world) с перекраской по скину, пикапы,
// трассеры, hitscan.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { raycastVoxels } from './map.js';

// ID стабильны: 0-2 существовали с самого начала (записи призраков и старые
// UGC-карты ссылаются на них по числу) — новые слоты добавлены следом, 3 бита
// в протоколе записи (js/replay.js) вмещают до 8 значений.
export const PISTOL = 0, SHOTGUN = 1, RAILGUN = 2, SMG = 3, AR = 4, SNIPER = 5;

export const WEAPONS = [
  { id: PISTOL,  key: 'pistol',  damage: 12, cooldown: 0.28, pellets: 1, spread: 0.008, range: 80,  charge: 0, recoil: 0.018 },
  { id: SHOTGUN, key: 'shotgun', damage: 7,  cooldown: 0.85, pellets: 8, spread: 0.085, range: 32,  charge: 0, recoil: 0.05, falloff: true },
  { id: RAILGUN, key: 'railgun', damage: 100, cooldown: 1.3, pellets: 1, spread: 0,     range: 120, charge: 0.8, recoil: 0.09 },
  { id: SMG,     key: 'smg',     damage: 9,  cooldown: 0.09, pellets: 1, spread: 0.024, range: 55,  charge: 0, recoil: 0.012 },
  { id: AR,      key: 'ar',      damage: 18, cooldown: 0.18, pellets: 1, spread: 0.014, range: 90,  charge: 0, recoil: 0.03 },
  { id: SNIPER,  key: 'sniper',  damage: 80, cooldown: 1.6,  pellets: 1, spread: 0,     range: 150, charge: 0, recoil: 0.12 },
];

// ---------- 3D-модели пушек ----------
// Пушки — единственные "гладкие" 3D-объекты в игре (контраст с воксельным миром —
// фишка стиля). Модели — Quaternius "Modular Sci-Fi Guns" (CC0), assets/weapons/*.gltf.
// Материалы во всех моделях одинаковые: Black/Grey/White/Main — перекрашиваем их
// в цвета скина (body/grip/accent), поэтому "несколько скинов" = просто разные
// наборы цветов в skins/*.json, без новых ассетов.
// UGC-задел сохранён: если в скине есть "models.<key>" (воксельные части
// { size, pos, color }), она ПОЛНОСТЬЮ заменяет модель GLTF.

const MODEL_URL = (key) => `assets/weapons/${key}.gltf`;
const _loader = new GLTFLoader();
const _rawCache = new Map();      // key -> Promise<THREE.Group> (нормализованная геометрия)

// Исходники пака смотрят стволом вдоль +X (а не вдоль -Z, как ждёт наш код) и
// у каждой модели свой произвольный масштаб (метры пака ≠ метры игры — иначе
// пушки на земле выходили огромными, а в руке "плашмя" боком к камере).
// Целевая длина "от руки до дула" в игровых метрах, подобрана на глаз по
// пропорциям категории оружия.
const TARGET_LENGTH = {
  pistol: 0.3, smg: 0.6, ar: 0.82, shotgun: 0.95, sniper: 1.15, railgun: 0.85,
};

/** Поворачивает +X→-Z, центрирует по bbox и калибрует длину под TARGET_LENGTH. */
function normalizeModel(raw, key) {
  raw.rotation.y = Math.PI / 2; // локальный +X теперь смотрит в мировой -Z (вперёд)
  raw.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(raw);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  raw.position.sub(center); // геометрический центр модели → начало координат

  const wrapper = new THREE.Group();
  wrapper.add(raw);
  const forwardExtent = size.z || 1; // после поворота "длина ствола" лежит в Z
  wrapper.scale.setScalar((TARGET_LENGTH[key] ?? 0.6) / forwardExtent);
  return wrapper;
}

function loadRawModel(key) {
  if (!_rawCache.has(key)) {
    _rawCache.set(key, _loader.loadAsync(MODEL_URL(key)).then((gltf) => normalizeModel(gltf.scene, key)));
  }
  return _rawCache.get(key);
}

/** Клонирует геометрию модели и красит материалы Black/Grey/White/Main по скину. */
function paintClone(raw, colors) {
  const clone = raw.clone(true);
  const paletteByName = {
    Black: colors.grip ?? '#222222',
    Grey: colors.body ?? '#888888',
    White: colors.body ?? '#cccccc',
    Main: colors.accent ?? '#ff8800',
  };
  clone.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    const srcMat = o.material;
    const hex = paletteByName[srcMat?.name] ?? colors.body ?? '#888888';
    o.material = new THREE.MeshStandardMaterial({
      color: hex, metalness: 0.5, roughness: 0.45,
      emissive: srcMat?.name === 'Main' && colors.emissive ? hex : '#000000',
      emissiveIntensity: srcMat?.name === 'Main' && colors.emissive ? 0.7 : 0,
    });
  });
  return clone;
}

/** Воксельная замена из UGC-скина: список боксов { size, pos, color }. */
function buildCustomModel(parts, colors) {
  const g = new THREE.Group();
  for (const p of parts) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]),
      new THREE.MeshLambertMaterial({ color: colors[p.color] ?? p.color }));
    m.position.set(p.pos[0], p.pos[1], p.pos[2]);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

/**
 * Модель пушки. ВАЖНО: загрузка GLTF асинхронна — до готовности возвращается
 * пустая THREE.Group, которая наполняется геометрией по промису (одна и та же
 * ссылка на группу, можно сразу добавлять в сцену/камеру).
 */
export function buildWeaponModel(weaponId, skin) {
  const key = WEAPONS[weaponId].key;
  const colors = skin.weapons[key] ?? {};
  const custom = skin.models?.[key];
  if (custom) return buildCustomModel(custom, colors);

  const holder = new THREE.Group();
  loadRawModel(key).then((raw) => {
    holder.add(paintClone(raw, colors));
  }).catch((e) => console.warn(`[weapons] модель "${key}" не загрузилась`, e));
  return holder;
}

/** Прогрев кеша моделей — вызывается на загрузке игры, чтобы первый подбор не лагал. */
export function preloadWeaponModels() {
  return Promise.all(WEAPONS.map((w) => loadRawModel(w.key).catch(() => null)));
}

/** Точки оружия на карте: моделька крутится и левитирует, респаун 10 с. */
export class Pickup {
  constructor(spot, skin, scene) {
    this.type = spot.type;
    this.pos = spot.pos.clone();
    this.respawnTime = 10;
    this.timer = 0;         // >0 — ждём респауна
    this.mesh = buildWeaponModel(spot.type, skin);
    // GLTF-модели уже нормализованы до реальных TARGET_LENGTH в normalizeModel —
    // доп. множитель не нужен (раньше был 1.6× под крошечные процедурные модели)
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
    this._t = Math.random() * 10;
  }

  update(dt) {
    this._t += dt;
    if (this.timer > 0) {
      this.timer -= dt;
      if (this.timer <= 0) this.mesh.visible = true;
      return;
    }
    this.mesh.rotation.y += dt * 2;
    this.mesh.position.y = this.pos.y + Math.sin(this._t * 2.5) * 0.12;
  }

  get available() { return this.timer <= 0; }

  /** true, если actorPos достаточно близко — пушка взята. */
  tryTake(actorPos) {
    if (!this.available) return false;
    if (actorPos.distanceToSquared(this.pos) > 1.9) return false;
    this.timer = this.respawnTime;
    this.mesh.visible = false;
    return true;
  }
}

/** Пул трассеров: тонкие вытянутые боксы, гаснут за ~0.12с (рейл — дольше). */
export class TracerPool {
  constructor(scene, size = 24) {
    this.items = [];
    for (let i = 0; i < size; i++) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 1), mat);
      mesh.visible = false;
      scene.add(mesh);
      this.items.push({ mesh, life: 0, maxLife: 0 });
    }
    this._next = 0;
  }

  spawn(from, to, color, maxLife = 0.12) {
    const it = this.items[this._next];
    this._next = (this._next + 1) % this.items.length;
    const len = from.distanceTo(to);
    if (len < 0.1) return;
    it.mesh.visible = true;
    it.mesh.material.color.set(color);
    it.mesh.material.opacity = 0.9;
    it.mesh.scale.set(1, 1, len);
    it.mesh.position.copy(from).add(to).multiplyScalar(0.5);
    it.mesh.lookAt(to);
    it.life = it.maxLife = maxLife;
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      it.life -= dt;
      if (it.life <= 0) { it.mesh.visible = false; continue; }
      it.mesh.material.opacity = 0.9 * (it.life / it.maxLife);
    }
  }
}

const _ray = new THREE.Ray();
const _dir = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();

/**
 * Hitscan одной пушки. targets: [{ head: Box3, body: Box3, onHit(part, dmg) }].
 * Возвращает { tracerEnds: Vector3[], hits: number, headshots: number }.
 * Рейл (pierce) не останавливается на цели — но в дуэли цель одна.
 */
export function fireHitscan(map, origin, baseDir, weaponId, targets, rng = Math.random) {
  const w = WEAPONS[weaponId];
  const tracerEnds = [];
  let hits = 0, headshots = 0;
  for (let p = 0; p < w.pellets; p++) {
    _dir.copy(baseDir);
    if (w.spread > 0) {
      _dir.x += (rng() * 2 - 1) * w.spread;
      _dir.y += (rng() * 2 - 1) * w.spread;
      _dir.z += (rng() * 2 - 1) * w.spread;
      _dir.normalize();
    }
    const wallDist = raycastVoxels(map, origin, _dir, w.range);
    _ray.set(origin, _dir);
    let bestDist = wallDist, bestPart = null, bestTarget = null;
    for (const t of targets) {
      const hHit = _ray.intersectBox(t.head, _hitPoint);
      if (hHit) {
        const d = hHit.distanceTo(origin);
        if (d < bestDist) { bestDist = d; bestPart = 'head'; bestTarget = t; }
      }
      const bHit = _ray.intersectBox(t.body, _hitPoint);
      if (bHit) {
        const d = bHit.distanceTo(origin);
        if (d < bestDist) { bestDist = d; bestPart = 'body'; bestTarget = t; }
      }
    }
    if (bestTarget) {
      let dmg = w.damage;
      if (w.falloff) dmg *= Math.max(0.3, 1 - bestDist / w.range);
      if (bestPart === 'head') { dmg *= 2; headshots++; }
      bestTarget.onHit(bestPart, Math.round(dmg));
      hits++;
    }
    tracerEnds.push(origin.clone().addScaledVector(_dir, bestDist));
  }
  return { tracerEnds, hits, headshots };
}
