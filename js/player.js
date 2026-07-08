// FPS-контроллер: резкое аркадное движение без инерции, распрыжка разрешена.
import * as THREE from 'three';
import { moveAABB } from './map.js';
import { WEAPONS, RAILGUN, buildWeaponModel } from './weapons.js';
import { Sound } from './audio.js';

export const MOVE = {
  speed: 8,        // м/с, мгновенно
  jumpVel: 8.5,
  gravity: 24,
  half: 0.35,      // полуширина AABB
  height: 1.7,
  eye: 1.6,
};

export class Player {
  /**
   * @param {*} opts { camera, map, skin, onFire(weaponId, origin, dir),
   *                   onPickup(weaponId), onJump(), recorder }
   */
  constructor(opts) {
    this.camera = opts.camera;
    this.map = opts.map;
    this.skin = opts.skin;
    this.onFire = opts.onFire;
    this.onPickup = opts.onPickup ?? (() => {});
    this.recorder = opts.recorder ?? null;

    this.pos = new THREE.Vector3();     // ноги
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.hp = 100;
    this.alive = true;

    this.weapon = 0;
    this.cooldown = 0;
    this.charge = 0;          // прогресс зарядки рейла
    this.charging = false;
    this._chargeSoundAt = 0;
    this.recoilPitch = 0;

    // инпут (клавиатура пишет сюда же, куда и мобильный модуль)
    this.input = { move: new THREE.Vector2(), jump: false, fire: false };
    this._keys = new Set();

    // view-модели всех пушек, показываем текущую
    this.viewModels = WEAPONS.map(w => {
      const m = buildWeaponModel(w.id, this.skin);
      m.scale.setScalar(0.9);
      m.position.set(0.28, -0.26, -0.45);
      m.visible = false;
      this.camera.add(m);
      return m;
    });
    this._vmKick = 0;
    this._bobT = 0;
    this._setupKeyboard();
    this.setWeapon(0);

    // статистика раунда
    this.shotsFired = 0;
    this.shotsHit = 0;
  }

  _setupKeyboard() {
    this._onDown = (e) => { this._keys.add(e.code); if (e.code === 'Space') e.preventDefault(); };
    this._onUp = (e) => this._keys.delete(e.code);
    this._onBlur = () => { this._keys.clear(); this.input.fire = false; this.input.jump = false; };
    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup', this._onUp);
    window.addEventListener('blur', this._onBlur);
  }

  dispose() {
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup', this._onUp);
    window.removeEventListener('blur', this._onBlur);
    this.viewModels.forEach(m => this.camera.remove(m));
  }

  spawn(spawnPoint) {
    this.pos.copy(spawnPoint.pos);
    this.vel.set(0, 0, 0);
    this.yaw = spawnPoint.yaw;
    this.pitch = 0;
    this.hp = 100;
    this.alive = true;
    this.setWeapon(0);
    this.cooldown = 0;
    this.charge = 0;
    this.charging = false;
    this.shotsFired = 0;
    this.shotsHit = 0;
  }

  setWeapon(id) {
    this.weapon = id;
    this.viewModels.forEach((m, i) => (m.visible = i === id));
    this.charge = 0;
    this.charging = false;
  }

  addLook(dx, dy) {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  }

  /** Направление взгляда (с учётом отдачи — стреляем туда же, куда смотрим). */
  getAimDir(out = new THREE.Vector3()) {
    const p = this.pitch + this.recoilPitch;
    out.set(-Math.sin(this.yaw) * Math.cos(p), Math.sin(p), -Math.cos(this.yaw) * Math.cos(p));
    return out.normalize();
  }

  getEyePos(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + MOVE.eye, this.pos.z);
  }

  takeDamage(dmg) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - dmg);
    Sound.hurt();
    if (this.hp <= 0) this.alive = false;
  }

  update(dt, pickups) {
    if (!this.alive) return;

    // --- сбор инпута: клавиатура поверх мобильного стика ---
    const mv = this.input.move;
    let fx = mv.x, fz = mv.y;
    if (this._keys.has('KeyW') || this._keys.has('ArrowUp')) fz -= 1;
    if (this._keys.has('KeyS') || this._keys.has('ArrowDown')) fz += 1;
    if (this._keys.has('KeyA') || this._keys.has('ArrowLeft')) fx -= 1;
    if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) fx += 1;
    const jump = this.input.jump || this._keys.has('Space');

    // --- движение: без инерции, полный контроль и в воздухе ---
    const len = Math.hypot(fx, fz);
    if (len > 1) { fx /= len; fz /= len; }
    // поворот локального (fx, fz) вокруг Y: вперёд = -Z в локальных осях камеры
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    this.vel.x = (fx * cos + fz * sin) * MOVE.speed;
    this.vel.z = (-fx * sin + fz * cos) * MOVE.speed;
    this.vel.y -= MOVE.gravity * dt;

    if (jump && this.onGround) {
      this.vel.y = MOVE.jumpVel;
      this.onGround = false;
      Sound.jump();
      this.recorder?.markJump();
    }

    const res = moveAABB(this.map, this.pos, this.vel, dt, MOVE.half, MOVE.height);
    this.onGround = res.onGround;
    if (this.pos.y < -20) { this.takeDamage(1000); return; } // выпал из мира

    // --- подбор оружия ---
    for (const p of pickups) {
      if (p.tryTake(this.pos)) {
        this.setWeapon(p.type);
        Sound.pickup();
        this.onPickup(p.type);
        this.recorder?.markPickup(p.type);
      }
    }

    // --- стрельба ---
    this.cooldown = Math.max(0, this.cooldown - dt);
    const w = WEAPONS[this.weapon];
    if (this.weapon === RAILGUN) {
      if (this.input.fire && this.cooldown <= 0) {
        if (!this.charging) { this.charging = true; this.charge = 0; Sound.railCharge(w.charge); }
        this.charge += dt;
        if (this.charge >= w.charge) { this._fire(w); this.charging = false; this.charge = 0; }
      } else {
        this.charging = false;
        this.charge = 0;
      }
    } else if (this.input.fire && this.cooldown <= 0) {
      this._fire(w);
    }

    // --- отдача и view-модель ---
    this.recoilPitch = Math.max(0, this.recoilPitch - dt * 0.35);
    this._vmKick = Math.max(0, this._vmKick - dt * 3);
    this._bobT += dt * (Math.hypot(this.vel.x, this.vel.z) > 1 && this.onGround ? 10 : 0);
    const vm = this.viewModels[this.weapon];
    vm.position.z = -0.45 + this._vmKick;
    vm.position.y = -0.26 + Math.sin(this._bobT) * 0.012;

    // --- камера ---
    this.camera.position.set(this.pos.x, this.pos.y + MOVE.eye, this.pos.z);
    this.camera.rotation.set(this.pitch + this.recoilPitch, this.yaw, 0, 'YXZ');

    // --- запись снапшотов 20/сек ---
    this.recorder?.update(dt, this.pos, this.yaw, this.pitch, this.weapon);
  }

  _fire(w) {
    this.cooldown = w.cooldown;
    this.recoilPitch += w.recoil;
    this._vmKick = 0.09;
    this.shotsFired++;
    if (w.id === 0) Sound.pistol();
    else if (w.id === 1) Sound.shotgun();
    else Sound.railgun();
    const origin = this.getEyePos();
    const dir = this.getAimDir();
    // onFire возвращает 0 мимо / 1 тело / 2 голова — для записи профиля меткости
    const hit = this.onFire(w.id, origin, dir) ?? 0;
    if (hit) this.shotsHit++;
    this.recorder?.markShot(w.id, hit);
  }

  get accuracy() { return this.shotsFired ? this.shotsHit / this.shotsFired : 0; }
}
