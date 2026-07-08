// Оружие: параметры, воксельные модельки (view/world), пикапы, трассеры, hitscan.
import * as THREE from 'three';
import { raycastVoxels } from './map.js';

export const PISTOL = 0, SHOTGUN = 1, RAILGUN = 2;

export const WEAPONS = [
  { id: PISTOL,  key: 'pistol',  damage: 12,  cooldown: 0.28, pellets: 1, spread: 0.008, range: 80, charge: 0,   recoil: 0.018 },
  { id: SHOTGUN, key: 'shotgun', damage: 7,   cooldown: 0.85, pellets: 8, spread: 0.085, range: 32, charge: 0,   recoil: 0.05, falloff: true },
  { id: RAILGUN, key: 'railgun', damage: 100, cooldown: 1.3,  pellets: 1, spread: 0,     range: 120, charge: 0.8, recoil: 0.09 },
];

// ---------- 3D-модели пушек ----------
// Пушки — единственные "гладкие" 3D-объекты в игре (контраст с воксельным миром —
// фишка стиля). Строятся кодом из примитивов, цвета — из скина.
// UGC-задел: если в скине есть "models.<key>" (список воксельных частей
// { size, pos, color }), он ПОЛНОСТЬЮ заменяет встроенную модель.

const _mat = (color, { metal = 0.7, rough = 0.35, emissive = null } = {}) =>
  new THREE.MeshStandardMaterial({
    color, metalness: metal, roughness: rough,
    emissive: emissive ?? '#000000',
    emissiveIntensity: emissive ? 0.9 : 0,
  });

function _add(group, geo, material, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  group.add(m);
  return m;
}

const _box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const _cyl = (r, len, seg = 12) => new THREE.CylinderGeometry(r, r, len, seg);
const _torus = (r, tube) => new THREE.TorusGeometry(r, tube, 8, 16);
const RX = Math.PI / 2; // цилиндр вдоль ствола (-Z)

function buildPistol(c) {
  const g = new THREE.Group();
  const body = _mat(c.body), grip = _mat(c.grip, { metal: 0.2, rough: 0.7 }), acc = _mat(c.accent);
  _add(g, _box(0.1, 0.11, 0.34), body, 0, 0.09, -0.12);           // затвор
  _add(g, _cyl(0.032, 0.14), body, 0, 0.09, -0.34, RX);           // ствол
  _add(g, _box(0.09, 0.07, 0.26), grip, 0, 0.01, -0.08);          // рамка
  _add(g, _box(0.085, 0.2, 0.11), grip, 0, -0.1, 0.03, 0.22);     // рукоять
  _add(g, _torus(0.045, 0.011), grip, 0, -0.035, -0.06, 0, RX);   // скоба крючка
  _add(g, _box(0.035, 0.045, 0.05), acc, 0, 0.17, -0.24);         // мушка
  _add(g, _box(0.06, 0.03, 0.06), acc, 0, 0.16, 0.02);            // целик
  return g;
}

function buildShotgun(c) {
  const g = new THREE.Group();
  const body = _mat(c.body), wood = _mat(c.grip, { metal: 0.05, rough: 0.8 }), acc = _mat(c.accent);
  _add(g, _cyl(0.042, 0.85), body, 0, 0.1, -0.33, RX);            // ствол
  _add(g, _cyl(0.032, 0.68), body, 0, 0.02, -0.3, RX);            // трубчатый магазин
  _add(g, _cyl(0.055, 0.2, 10), wood, 0, 0.02, -0.44, RX);        // цевьё-помпа
  _add(g, _box(0.11, 0.15, 0.3), body, 0, 0.06, 0.02);            // ресивер
  _add(g, _box(0.09, 0.14, 0.34), wood, 0, -0.03, 0.3, -0.18);    // приклад
  _add(g, _torus(0.05, 0.014), acc, 0, 0.1, -0.74, 0, 0);         // дульное кольцо
  _add(g, _box(0.03, 0.04, 0.04), acc, 0, 0.17, -0.7);            // мушка
  return g;
}

function buildRailgun(c) {
  const g = new THREE.Group();
  const body = _mat(c.body), grip = _mat(c.grip, { metal: 0.2, rough: 0.7 });
  const glow = _mat(c.accent, { metal: 0.1, rough: 0.3, emissive: c.accent });
  _add(g, _box(0.13, 0.16, 0.8), body, 0, 0.03, -0.12);           // корпус
  _add(g, _cyl(0.018, 1.05), body, -0.05, 0.13, -0.3, RX);        // рельса левая
  _add(g, _cyl(0.018, 1.05), body, 0.05, 0.13, -0.3, RX);         // рельса правая
  _add(g, _cyl(0.02, 0.9), glow, 0, 0.13, -0.28, RX);             // светящийся сердечник
  for (const z of [-0.2, -0.42, -0.64]) _add(g, _torus(0.085, 0.02), glow, 0, 0.08, z); // катушки
  _add(g, _cyl(0.055, 0.2), glow, 0, 0.16, 0.12, RX);             // конденсатор
  _add(g, _box(0.09, 0.2, 0.11), grip, 0, -0.12, 0.08, 0.2);      // рукоять
  _add(g, _box(0.08, 0.12, 0.22), grip, 0, -0.02, 0.32, -0.15);   // упор
  return g;
}

const BUILDERS = { pistol: buildPistol, shotgun: buildShotgun, railgun: buildRailgun };

/** Модель пушки: встроенная 3D или воксельная замена из скина (UGC). */
export function buildWeaponModel(weaponId, skin) {
  const key = WEAPONS[weaponId].key;
  const colors = skin.weapons[key] ?? {};
  const custom = skin.models?.[key];
  if (custom) {
    const g = new THREE.Group();
    for (const p of custom) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]),
        new THREE.MeshLambertMaterial({ color: colors[p.color] ?? p.color }));
      m.position.set(p.pos[0], p.pos[1], p.pos[2]);
      m.castShadow = true;
      g.add(m);
    }
    return g;
  }
  return BUILDERS[key](colors);
}

/** Точки оружия на карте: моделька крутится и левитирует, респаун 10 с. */
export class Pickup {
  constructor(spot, skin, scene) {
    this.type = spot.type;
    this.pos = spot.pos.clone();
    this.respawnTime = 10;
    this.timer = 0;         // >0 — ждём респауна
    this.mesh = buildWeaponModel(spot.type, skin);
    this.mesh.scale.setScalar(1.6);
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
