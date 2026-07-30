// Оружие: параметры, GLTF-модели (view/world) с перекраской по скину, пикапы,
// трассеры, hitscan.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { raycastVoxels } from './map.js';

// ID стабильны: 0-2 существовали с самого начала (записи призраков и старые
// UGC-карты ссылаются на них по числу) — новые слоты добавлены следом, 3 бита
// в протоколе записи (js/replay.js) вмещают до 8 значений.
export const PISTOL = 0, SHOTGUN = 1, RAILGUN = 2, SMG = 3, AR = 4, SNIPER = 5;

// recoil — подброс прицела в радианах: он реально уводит следующую пулю, поэтому
// у точных пушек (рейл, снайперка) он почти нулевой — «выстрел в точку».
// viewKick — чисто визуальный откат модели, на попадание не влияет: удар
// чувствуется, но прицел остаётся там, куда игрок навёл.
// mag/reload — размер магазина и секунды перезарядки; запас патронов бесконечен.
// zoomFov — угол обзора в прицеливании; есть только у оптики снайперки.
export const WEAPONS = [
  { id: PISTOL,  key: 'pistol',  damage: 12, cooldown: 0.28, pellets: 1, spread: 0.008, range: 80,  charge: 0, recoil: 0.018, viewKick: 0.05, mag: 12, reload: 1.1, sound: 'pistol' },
  { id: SHOTGUN, key: 'shotgun', damage: 7,  cooldown: 0.85, pellets: 8, spread: 0.085, range: 32,  charge: 0, recoil: 0.05,  viewKick: 0.09, mag: 6,  reload: 1.7, falloff: true, sound: 'shotgun' },
  { id: RAILGUN, key: 'railgun', damage: 100, cooldown: 1.3, pellets: 1, spread: 0,     range: 120, charge: 0.8, recoil: 0.012, viewKick: 0.12, mag: 3, reload: 2, sound: 'railgun' },
  { id: SMG,     key: 'smg',     damage: 9,  cooldown: 0.09, pellets: 1, spread: 0.024, range: 55,  charge: 0, recoil: 0.012, viewKick: 0.035, mag: 30, reload: 1.4, sound: 'smg' },
  { id: AR,      key: 'ar',      damage: 18, cooldown: 0.18, pellets: 1, spread: 0.014, range: 90,  charge: 0, recoil: 0.03,  viewKick: 0.055, mag: 25, reload: 1.5, sound: 'assault' },
  { id: SNIPER,  key: 'sniper',  damage: 80, cooldown: 1.6,  pellets: 1, spread: 0,     range: 150, charge: 0, recoil: 0.016, viewKick: 0.14, mag: 5,  reload: 1.9, zoomFov: 30, sound: 'sniper' },
];

// Поза вьюмодели в руке: length — длина пушки в кадре (метры), плюс смещение
// от камеры и доворот. Отдельно от TARGET_LENGTH, потому что мировые модели на
// земле должны остаться прежними. Раньше вместо длины стоял безымянный
// множитель, и порядок размеров в руках разошёлся с мировым: снайперка
// оказывалась короче дробовика.
export const VIEW_POSE = Object.freeze({
  pistol:  { length: 0.36, pos: [0.2, -0.22, -0.5], rot: [0, 0.06, 0] },
  smg:     { length: 0.62, pos: [0.23, -0.25, -0.6], rot: [0, 0.06, 0] },
  railgun: { length: 0.64, pos: [0.3, -0.3, -0.5], rot: [0, 0, 0] },
  ar:      { length: 0.66, pos: [0.26, -0.26, -0.66], rot: [0, 0.05, 0] },
  shotgun: { length: 0.76, pos: [0.27, -0.27, -0.66], rot: [0, 0.05, 0] },
  // Самая длинная и в мире, и в руках. Отодвинута, иначе приклад уходит
  // за камеру, а ствол — за правый край кадра.
  sniper:  { length: 0.88, pos: [0.26, -0.22, -0.78], rot: [0, 0.08, 0] },
});

/** Множитель вьюмодели: нужная длина в кадре / реальная длина модели. */
export function viewScale(key) {
  return VIEW_POSE[key].length / TARGET_LENGTH[key];
}

// Насколько левая кисть уходит вперёд от центра пушки, в метрах. Хранится
// смещением, а не абсолютной точкой: иначе при смене VIEW_POSE рука повисает
// отдельно от цевья. null — пушка одноручная, рука появляется на перезарядке.
export const LEFT_HAND_FORWARD = Object.freeze({
  pistol: null,
  shotgun: 0.28,
  railgun: 0.24,
  smg: 0.18,
  ar: 0.28,
  sniper: 0.3,
});

// Грип относительно центра модели: чуть правее, ниже и ближе к игроку.
const RIGHT_HAND_OFFSET = Object.freeze([0.03, -0.06, 0.08]);

/** Точка правой кисти: держит грип, поэтому едет вместе с позой оружия. */
export function rightHandPoint(key) {
  const [x, y, z] = VIEW_POSE[key].pos;
  const [dx, dy, dz] = RIGHT_HAND_OFFSET;
  return [x + dx, y + dy, z + dz];
}

/** Точка левой кисти для пушки: под стволом, со сдвигом наружу от грипа. */
export function leftHandPoint(key) {
  const forward = LEFT_HAND_FORWARD[key];
  if (forward == null) return null;
  const [x, y, z] = VIEW_POSE[key].pos;
  return [x - 0.02, y, z - forward];
}

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
    const pending = _loader.loadAsync(MODEL_URL(key)).then((gltf) => normalizeModel(gltf.scene, key));
    _rawCache.set(key, pending);
    pending.catch(() => { if (_rawCache.get(key) === pending) _rawCache.delete(key); });
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
    o.userData.weaponOwnsMaterial = true;
    o.userData.weaponOwnsGeometry = false; // geometry разделяется с raw-cache
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
    m.userData.weaponOwnsMaterial = true;
    m.userData.weaponOwnsGeometry = true;
    g.add(m);
  }
  return g;
}

/**
 * Оптика снайперки: труба с двумя кольцами и линзой. Размеры — в игровых
 * метрах, потому что группа кладётся рядом с моделью, а не внутрь неё.
 */
function buildScope(colors) {
  const g = new THREE.Group();
  const body = colors.body ?? '#888888';
  const grip = colors.grip ?? '#222222';
  const accent = colors.accent ?? '#ff8800';
  const own = (mesh) => {
    mesh.castShadow = true;
    mesh.userData.weaponOwnsMaterial = true;
    mesh.userData.weaponOwnsGeometry = true;
    return mesh;
  };
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({
    color, metalness: 0.55, roughness: 0.4, ...extra,
  });
  const tube = own(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.058, 0.52, 12), mat(body)));
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, 0.19, 0.08);
  const lens = own(new THREE.Mesh(new THREE.CircleGeometry(0.048, 12),
    mat(accent, { emissive: accent, emissiveIntensity: 0.6 })));
  lens.position.set(0, 0.19, 0.342);
  lens.rotation.y = Math.PI;
  for (const z of [-0.08, 0.22]) {
    const ring = own(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.045), mat(grip)));
    ring.position.set(0, 0.12, z);
    g.add(ring);
  }
  g.add(tube, lens);
  return g;
}

/**
 * Модель пушки. ВАЖНО: загрузка GLTF асинхронна — до готовности возвращается
 * пустая THREE.Group, которая наполняется геометрией по промису (одна и та же
 * ссылка на группу, можно сразу добавлять в сцену/камеру).
 */
export function buildWeaponModel(weaponId, skin) {
  const weapon = WEAPONS[weaponId];
  if (!weapon) return new THREE.Group();
  const key = weapon.key;
  const colors = skin?.weapons?.[key] ?? {};
  const custom = skin?.models?.[key];
  if (custom) return buildCustomModel(custom, colors);

  const holder = new THREE.Group();
  holder.userData.weaponHolder = true;
  // Оптика живёт в holder, а не внутри painted: там свой масштаб нормализации,
  // и труба ушла бы в микроскопический размер.
  if (key === 'sniper') holder.add(buildScope(colors));
  loadRawModel(key).then((raw) => {
    const painted = paintClone(raw, colors);
    if (holder.userData.disposed) disposeWeaponModel(painted);
    else holder.add(painted);
  }).catch((e) => console.warn(`[weapons] модель "${key}" не загрузилась`, e));
  return holder;
}

/** Освобождает только ресурсы клона, не трогая geometry общего raw-cache. */
export function disposeWeaponModel(root) {
  if (!root) return;
  root.userData.disposed = true;
  const geometries = new Set(), materials = new Set();
  root.traverse((o) => {
    if (o.userData.weaponOwnsGeometry && o.geometry) geometries.add(o.geometry);
    if (!o.userData.weaponOwnsMaterial || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(m => materials.add(m));
  });
  materials.forEach(m => m.dispose());
  geometries.forEach(g => g.dispose());
  root.clear();
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

  dispose(scene) {
    scene?.remove(this.mesh);
    disposeWeaponModel(this.mesh);
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

  clear() {
    for (const it of this.items) {
      it.life = 0;
      it.mesh.visible = false;
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
  if (!w) return { tracerEnds: [], hits: 0, headshots: 0 };
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
