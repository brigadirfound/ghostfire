// Оружие: параметры, воксельные модельки (view/world), пикапы, трассеры, hitscan.
import * as THREE from 'three';
import { raycastVoxels } from './map.js';

export const PISTOL = 0, SHOTGUN = 1, RAILGUN = 2;

export const WEAPONS = [
  { id: PISTOL,  key: 'pistol',  damage: 12,  cooldown: 0.28, pellets: 1, spread: 0.008, range: 80, charge: 0,   recoil: 0.018 },
  { id: SHOTGUN, key: 'shotgun', damage: 7,   cooldown: 0.85, pellets: 8, spread: 0.085, range: 32, charge: 0,   recoil: 0.05, falloff: true },
  { id: RAILGUN, key: 'railgun', damage: 100, cooldown: 1.3,  pellets: 1, spread: 0,     range: 120, charge: 0.8, recoil: 0.09 },
];

const box = (w, h, d, color) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.castShadow = true;
  return m;
};

// Дефолтные воксельные модели пушек — тот же формат, что "models" в skins/*.json:
// список частей { size:[w,h,d], pos:[x,y,z], color: имя цвета из weapons.<key> или #hex }.
// Скин может целиком переопределить модель — задел под пользовательские скины.
export const DEFAULT_WEAPON_MODELS = {
  pistol: [
    { size: [0.12, 0.14, 0.36], pos: [0, 0.05, -0.1], color: 'body' },
    { size: [0.1, 0.2, 0.12], pos: [0, -0.1, 0.06], color: 'grip' },
    { size: [0.04, 0.05, 0.06], pos: [0, 0.15, -0.2], color: 'accent' },
  ],
  shotgun: [
    { size: [0.14, 0.14, 0.8], pos: [0, 0.06, -0.25], color: 'body' },
    { size: [0.1, 0.1, 0.5], pos: [0, 0.17, -0.35], color: 'accent' },
    { size: [0.18, 0.12, 0.22], pos: [0, -0.02, -0.35], color: 'grip' },
    { size: [0.12, 0.18, 0.3], pos: [0, -0.06, 0.25], color: 'grip' },
  ],
  railgun: [
    { size: [0.16, 0.2, 0.9], pos: [0, 0.04, -0.2], color: 'body' },
    { size: [0.06, 0.06, 1.1], pos: [-0.08, 0.14, -0.3], color: 'accent' },
    { size: [0.06, 0.06, 1.1], pos: [0.08, 0.14, -0.3], color: 'accent' },
    { size: [0.26, 0.26, 0.14], pos: [0, 0.08, -0.55], color: 'accent' },
    { size: [0.1, 0.2, 0.12], pos: [0, -0.12, 0.1], color: 'grip' },
  ],
};

/** Воксельная моделька пушки: геометрия и цвета — из скина (или дефолт). */
export function buildWeaponModel(weaponId, skin) {
  const key = WEAPONS[weaponId].key;
  const colors = skin.weapons[key] ?? {};
  const parts = skin.models?.[key] ?? DEFAULT_WEAPON_MODELS[key];
  const g = new THREE.Group();
  for (const p of parts) {
    const m = box(p.size[0], p.size[1], p.size[2], colors[p.color] ?? p.color);
    m.position.set(p.pos[0], p.pos[1], p.pos[2]);
    g.add(m);
  }
  return g;
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
