// Призрак: двигается ТОЧНО по записи (интерполяция снапшотов),
// но стреляет "живьём" — в текущую позицию игрока, с профилем меткости оригинала
// и задержкой реакции 150–300 мс. Поэтому дуэль ощущается как PvP.
import * as THREE from 'three';
import { raycastVoxels } from './map.js';
import { WEAPONS, RAILGUN, buildWeaponModel } from './weapons.js';
import { Sound } from './audio.js';

const HEAD = 0.55; // большая кубическая голова — фишка headshot ×2

export class Ghost {
  /**
   * @param {*} opts { replay, map, skin, scene,
   *                   onShoot(weaponId, origin, dir), pickups }
   */
  constructor(opts) {
    this.replay = opts.replay;
    this.map = opts.map;
    this.skin = opts.skin;
    this.scene = opts.scene;
    this.onShoot = opts.onShoot;
    this.pickups = opts.pickups;

    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.hp = 100;
    this.alive = true;
    this.time = 0;
    this._sample = {};
    this._shotIdx = 0;
    this._pickupIdx = 0;
    this._pending = [];   // отложенные (реакция) выстрелы
    this._lastTick = -1;
    this._weapon = 0;

    const prof = this.replay.accuracyProfile();
    // меткость оригинала ± случайность, в разумных рамках
    this.accuracy = THREE.MathUtils.clamp(prof.accuracy, 0.15, 0.92);
    this.headRate = THREE.MathUtils.clamp(prof.headRate, 0.05, 0.5);

    this._buildModel();
    this.hitboxHead = new THREE.Box3();
    this.hitboxBody = new THREE.Box3();
  }

  _buildModel() {
    const b = this.skin.body;
    const tint = new THREE.Color(this.skin.ghostTint ?? '#88ddff');
    const mat = (hex) => {
      const c = new THREE.Color(hex).lerp(tint, 0.45);
      return new THREE.MeshLambertMaterial({
        color: c, transparent: true, opacity: this.skin.ghostOpacity ?? 0.85,
        emissive: tint.clone().multiplyScalar(0.15),
      });
    };
    const part = (w, h, d, hex) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(hex));
      m.castShadow = true;
      return m;
    };
    this.group = new THREE.Group();
    this.head = part(HEAD, HEAD, HEAD, b.head); this.head.position.y = 0.6 + 0.55 + HEAD / 2;
    this.torso = part(0.6, 0.55, 0.32, b.torso); this.torso.position.y = 0.6 + 0.55 / 2;
    this.armL = part(0.16, 0.5, 0.16, b.arms); this.armL.position.set(-0.38, 1.05, 0);
    this.armR = part(0.16, 0.5, 0.16, b.arms); this.armR.position.set(0.38, 1.05, 0);
    this.legL = part(0.22, 0.6, 0.22, b.legs); this.legL.position.set(-0.16, 0.3, 0);
    this.legR = part(0.22, 0.6, 0.22, b.legs); this.legR.position.set(0.16, 0.3, 0);
    this.group.add(this.head, this.torso, this.armL, this.armR, this.legL, this.legR);
    // пушка в правой руке
    this.weaponModels = WEAPONS.map(w => {
      const m = buildWeaponModel(w.id, this.skin);
      m.position.set(0.38, 0.95, -0.35);
      m.visible = false;
      this.group.add(m);
      return m;
    });
    this.weaponModels[0].visible = true;
    this.scene.add(this.group);
    this._animT = 0;
  }

  dispose() { this.scene.remove(this.group); }

  reset() {
    this.time = 0;
    this.hp = 100;
    this.alive = true;
    this._shotIdx = 0;
    this._pickupIdx = 0;
    this._pending.length = 0;
    this._lastTick = -1;
    this._setWeapon(0);
    this.group.visible = true;
    this.update(0, null);
  }

  _setWeapon(id) {
    this._weapon = id;
    this.weaponModels.forEach((m, i) => (m.visible = i === id));
  }

  takeDamage(dmg) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - dmg);
    if (this.hp <= 0) { this.alive = false; this.group.visible = false; }
  }

  getEyePos(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 1.4, this.pos.z);
  }

  /** targets-запись для fireHitscan игрока. */
  get target() {
    return {
      head: this.hitboxHead,
      body: this.hitboxBody,
      onHit: (part, dmg) => this.takeDamage(dmg),
    };
  }

  /** @param {Player|null} player живой игрок — цель для живого прицеливания */
  update(dt, player) {
    if (!this.alive) return;
    this.time += dt;
    const s = this.replay.sample(this.time, this._sample);
    if (!s) return;

    const prevY = this.pos.y;
    this.pos.set(s.x, s.y, s.z);
    this.yaw = s.yaw;
    this.group.position.copy(this.pos);
    this.group.rotation.y = s.yaw;

    // смена оружия по записи
    if (s.weapon !== this._weapon) this._setWeapon(s.weapon);

    // подборы: гасим пикап на карте в записанный момент
    while (this._pickupIdx < this.replay.pickups.length &&
           this.replay.pickups[this._pickupIdx].tick <= s.tick) {
      const pk = this.replay.pickups[this._pickupIdx++];
      let best = null, bestD = 9;
      for (const p of this.pickups) {
        if (!p.available || p.type !== pk.weapon) continue;
        const d = p.pos.distanceToSquared(this.pos);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best) { best.timer = best.respawnTime; best.mesh.visible = false; }
    }

    // анимация ходьбы
    const speed = Math.hypot(s.x - (this._px ?? s.x), s.z - (this._pz ?? s.z)) / Math.max(dt, 1e-4);
    this._px = s.x; this._pz = s.z;
    this._animT += dt * Math.min(speed, 10);
    const sw = Math.sin(this._animT * 1.6) * 0.5;
    this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
    this.armL.rotation.x = -sw * 0.7;
    this.head.rotation.x = s.pitch * 0.5;

    // хитбоксы (axis-aligned, голова — большой куб)
    this.hitboxHead.setFromCenterAndSize(
      new THREE.Vector3(this.pos.x, this.pos.y + 1.43, this.pos.z),
      new THREE.Vector3(HEAD, HEAD, HEAD));
    this.hitboxBody.setFromCenterAndSize(
      new THREE.Vector3(this.pos.x, this.pos.y + 0.58, this.pos.z),
      new THREE.Vector3(0.7, 1.15, 0.45));

    // --- живое прицеливание ---
    // на записанном тике выстрела ставим отложенный выстрел с реакцией 150–300 мс
    while (this._shotIdx < this.replay.shots.length &&
           this.replay.shots[this._shotIdx].tick <= s.tick) {
      const shot = this.replay.shots[this._shotIdx++];
      const reaction = 0.15 + Math.random() * 0.15;
      if (WEAPONS[shot.weapon]?.charge > 0) Sound.railCharge(WEAPONS[shot.weapon].charge);
      this._pending.push({ at: this.time + reaction + (WEAPONS[shot.weapon]?.charge ?? 0) * 0.5, weapon: shot.weapon });
    }
    // сработка отложенных выстрелов — в ТЕКУЩУЮ позицию игрока
    for (let i = this._pending.length - 1; i >= 0; i--) {
      const pd = this._pending[i];
      if (this.time < pd.at) continue;
      this._pending.splice(i, 1);
      if (player && player.alive) this._fireAt(pd.weapon, player);
    }
    void prevY;
  }

  _fireAt(weaponId, player) {
    const origin = this.getEyePos();
    const isHead = Math.random() < this.headRate;
    const target = new THREE.Vector3(
      player.pos.x, player.pos.y + (isHead ? 1.6 : 1.0), player.pos.z);
    const dir = target.clone().sub(origin);
    const dist = dir.length();
    if (dist < 0.01) return;
    dir.normalize();

    const willHit = Math.random() < this.accuracy;
    if (willHit) {
      // лёгкое дрожание, чтобы дробовик не клал все дробины в точку
      dir.x += (Math.random() - 0.5) * 0.01;
      dir.y += (Math.random() - 0.5) * 0.01;
      dir.normalize();
    } else {
      // промах: увод луча на 3–10°
      const err = (3 + Math.random() * 7) * Math.PI / 180;
      const perp = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .cross(dir).normalize();
      dir.addScaledVector(perp, Math.tan(err)).normalize();
    }
    // LOS: если стена ближе цели, выстрел уйдёт в стену (трассер честный) —
    // это решает fireHitscan в game.js через raycastVoxels
    if (weaponId === 0) Sound.pistol();
    else if (weaponId === 1) Sound.shotgun();
    else Sound.railgun();
    this.onShoot(weaponId, origin, dir);
  }

  /** Есть ли прямая видимость до точки (для мобильного автоогня по призраку). */
  hasLosTo(point) {
    const origin = this.getEyePos();
    const d = point.clone().sub(origin);
    const dist = d.length();
    return raycastVoxels(this.map, origin, d.normalize(), dist) >= dist - 0.05;
  }
}
