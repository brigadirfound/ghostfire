// FPS-контроллер: резкое аркадное движение без инерции, распрыжка разрешена.
import * as THREE from 'three';
import { moveAABB } from './map.js';
import {
  WEAPONS, RAILGUN, VIEW_POSE, viewScale, leftHandPoint, rightHandPoint,
  buildWeaponModel, disposeWeaponModel,
} from './weapons.js';
import { Sound } from './audio.js';
import { buildHand, HAND_REST, HAND_SCALE } from './hands.js';

// Подброс прицела гаснет за ~0.4 с, откат модели держится дольше — он и даёт
// ощущение удара, ничего не сдвигая в прицеливании.
const RECOIL_RECOVERY = 7;
const VIEW_KICK_RECOVERY = 0.9;
// Куда приходит левая кисть у пистолета — только на время перезарядки.
const PISTOL_RELOAD_HAND = [0.2, -0.5, -0.72];

const ease = (t) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};

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

    // патроны: у каждой пушки свой магазин, запас бесконечен — ограничение
    // только по времени перезарядки
    this.ammo = WEAPONS.map(w => w.mag);
    this.reloadT = 0;         // >0 — идёт перезарядка
    this.reloadTotal = 0;
    this.aiming = false;      // прицеливание в оптику (только снайперка)

    // инпут (клавиатура пишет сюда же, куда и мобильный модуль)
    this.input = { move: new THREE.Vector2(), jump: false, fire: false, reload: false, aim: false };
    this._keys = new Set();

    // view-модели всех пушек, показываем текущую
    this.viewModels = WEAPONS.map(w => {
      const m = buildWeaponModel(w.id, this.skin);
      const pose = VIEW_POSE[w.key];
      m.scale.setScalar(viewScale(w.key));
      m.position.set(...pose.pos);
      m.rotation.set(...pose.rot);
      m.visible = false;
      this.camera.add(m);
      return m;
    });
    // кисть у грипа — только кулак+манжета, не вся рука, чтобы не перекрывать экран
    this.hand = buildHand(this.skin);
    this.hand.scale.setScalar(HAND_SCALE.right);
    this.hand.position.set(0.29, -0.31, -0.46);
    this.camera.add(this.hand);
    // левая кисть держит цевьё двуручных пушек и подаёт магазин при перезарядке
    this.handL = buildHand(this.skin);
    this.handL.scale.setScalar(HAND_SCALE.left);
    this.handL.visible = false;
    this.camera.add(this.handL);
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
    this.viewModels.forEach(m => {
      this.camera.remove(m);
      disposeWeaponModel(m);
    });
    this.camera.remove(this.hand);
    disposeObject(this.hand);
    this.camera.remove(this.handL);
    disposeObject(this.handL);
    this.recorder = null;
  }

  spawn(spawnPoint) {
    this.pos.copy(spawnPoint.pos);
    this.vel.set(0, 0, 0);
    this.yaw = spawnPoint.yaw;
    this.pitch = 0;
    this.hp = 100;
    this.alive = true;
    this.hand.visible = true; // защита от гонки состояний между матчами
    this.setWeapon(0);
    this.cooldown = 0;
    this.charge = 0;
    this.charging = false;
    this.recoilPitch = 0;
    this._vmKick = 0;
    this.ammo = WEAPONS.map(w => w.mag);
    this.reloadT = this.reloadTotal = 0;
    this.input.fire = false;
    this.input.jump = false;
    this.input.reload = false;
    this.input.aim = false;
    this.aiming = false;
    this.shotsFired = 0;
    this.shotsHit = 0;
    // Во время отсчёта update() не вызывается (игрок ещё не может двигаться),
    // поэтому позу надо сбросить здесь: иначе на спавне рука так и стоит в
    // кадре, замершем на середине перезарядки прошлого раунда.
    this._poseViewModel();
  }

  setWeapon(id, { refill = false } = {}) {
    if (!WEAPONS[id]) return false;
    this.weapon = id;
    this.viewModels.forEach((m, i) => (m.visible = i === id));
    this.charge = 0;
    this.charging = false;
    // Смена пушки прерывает перезарядку: магазин остаётся в том состоянии,
    // в котором был, — вернувшись к пушке, игрок дозаряжает её заново.
    this.reloadT = this.reloadTotal = 0;
    this.aiming = false;
    if (refill) this.ammo[id] = WEAPONS[id].mag; // подобранная пушка всегда полная
    return true;
  }

  get ammoInfo() {
    const w = WEAPONS[this.weapon];
    return {
      current: this.ammo[this.weapon] ?? 0,
      max: w?.mag ?? 0,
      reloading: this.reloadT > 0,
      progress: this.reloadTotal > 0 ? 1 - this.reloadT / this.reloadTotal : 0,
    };
  }

  /** Ручная и автоматическая перезарядка. true — процесс запущен. */
  startReload() {
    const w = WEAPONS[this.weapon];
    if (!this.alive || !w || this.reloadT > 0) return false;
    if (this.charging) return false; // рейл на зарядке не бросают
    if (this.ammo[this.weapon] >= w.mag) return false;
    this.reloadT = this.reloadTotal = w.reload;
    this.charging = false;
    this.charge = 0;
    Sound.reloadOut();
    return true;
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

  /**
   * Мировая точка дула. Хитскан по-прежнему идёт из центра камеры (иначе
   * прицел врал бы), но трассер рисуется отсюда — выстрел виден из оружия,
   * а не из переносицы. В оптике модель скрыта, поэтому дуло = центр экрана.
   */
  getMuzzlePoint(out = new THREE.Vector3()) {
    const pose = VIEW_POSE[WEAPONS[this.weapon].key];
    if (this.aiming || !pose) out.set(0, -0.02, -0.6);
    else out.set(pose.pos[0], pose.pos[1] + 0.05, pose.pos[2] - pose.length * 0.5);
    return this.camera.localToWorld(out);
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
    // kill-zone: упал в пропасть (страховочное дно карты лежит на y=-2)
    if (this.pos.y < -1.5) { this.takeDamage(1000); return; }

    // --- подбор оружия ---
    for (const p of pickups) {
      if (p.tryTake(this.pos)) {
        this.setWeapon(p.type, { refill: true });
        Sound.pickup();
        this.onPickup(p.type);
        this.recorder?.markPickup(p.type);
      }
    }

    // --- перезарядка ---
    const w = WEAPONS[this.weapon];
    if (this.reloadT > 0) {
      this.reloadT = Math.max(0, this.reloadT - dt);
      if (this.reloadT === 0) {
        this.ammo[this.weapon] = w.mag;
        this.reloadTotal = 0;
        Sound.reloadIn();
      }
    } else if (this.input.reload || this._keys.has('KeyR')) {
      this.startReload();
    }

    // --- стрельба ---
    this.cooldown = Math.max(0, this.cooldown - dt);
    const loaded = this.reloadT === 0 && this.ammo[this.weapon] > 0;
    if (this.weapon === RAILGUN) {
      // клик запускает зарядку; выстрел случится сам через 0.8с, даже если отпустить
      if (!this.charging && this.input.fire && this.cooldown <= 0 && loaded) {
        this.charging = true;
        this.charge = 0;
        Sound.railCharge(w.charge);
      }
      if (this.charging) {
        this.charge += dt;
        if (this.charge >= w.charge) { this._fire(w); this.charging = false; this.charge = 0; }
      }
    } else if (this.input.fire && this.cooldown <= 0 && loaded) {
      this._fire(w);
    }
    // Пустой магазин уходит в перезарядку сам, как только игрок жмёт огонь.
    if (this.input.fire && this.reloadT === 0 && this.ammo[this.weapon] <= 0) this.startReload();

    // --- прицеливание: только оптика снайперки, и не во время перезарядки ---
    this.aiming = Boolean(w.zoomFov) && this.input.aim && this.reloadT === 0;

    // --- отдача и view-модель ---
    // Прицел возвращается экспоненциально: подброс виден, но следующая пуля
    // уходит туда же, куда игрок смотрит.
    this.recoilPitch *= Math.exp(-dt * RECOIL_RECOVERY);
    if (this.recoilPitch < 1e-4) this.recoilPitch = 0;
    this._vmKick = Math.max(0, this._vmKick - dt * VIEW_KICK_RECOVERY);
    this._bobT += dt * (Math.hypot(this.vel.x, this.vel.z) > 1 && this.onGround ? 10 : 0);
    this._poseViewModel();

    // --- камера ---
    this.camera.position.set(this.pos.x, this.pos.y + MOVE.eye, this.pos.z);
    this.camera.rotation.set(this.pitch + this.recoilPitch, this.yaw, 0, 'YXZ');

    // --- запись снапшотов 20/сек ---
    this.recorder?.update(dt, this.pos, this.yaw, this.pitch, this.weapon);
  }

  /**
   * Поза пушки и кистей: покачивание при беге, откат выстрела и перезарядка.
   * Пушка в покое сидит у нижней кромки кадра, поэтому перезарядка идёт вверх,
   * «к себе»: оружие приподнимается и кренится к центру, левая кисть уходит
   * вниз за магазином и возвращается с ним, в конце — рывок стволом вниз.
   */
  _poseViewModel() {
    const vm = this.viewModels[this.weapon];
    const key = WEAPONS[this.weapon].key;
    // В оптике модель и кисти убираются: игрок смотрит сквозь прицел.
    if (this.aiming) {
      vm.visible = false;
      this.hand.visible = this.handL.visible = false;
      return;
    }
    vm.visible = true;
    this.hand.visible = true;
    const kick = this._vmKick;
    const bobY = Math.sin(this._bobT) * 0.012;
    const bobX = Math.cos(this._bobT * 0.5) * 0.006;

    const active = this.reloadT > 0;
    const r = active && this.reloadTotal > 0 ? 1 - this.reloadT / this.reloadTotal : 0;
    // Подъём: быстро вверх → держим → возврат к боевой стойке.
    const lift = !active ? 0
      : r < 0.3 ? ease(r / 0.3)
      : r < 0.72 ? 1
      : 1 - ease((r - 0.72) / 0.28);
    // Короткий рывок стволом вниз в конце — «дослал и вернул».
    const snap = active && r > 0.74 && r < 0.9 ? Math.sin((r - 0.74) / 0.16 * Math.PI) : 0;
    const rise = lift * 0.1 - snap * 0.04;
    const tilt = lift * 0.45 + snap * 0.35;

    // Связка одновременно поднимается и отводится от камеры: кулаки сидят у
    // near-плана, и без отвода они раздуваются на пол-экрана.
    const base = VIEW_POSE[key];
    vm.position.set(base.pos[0] - lift * 0.04, base.pos[1] + bobY + rise, base.pos[2] + kick - lift * 0.12);
    vm.rotation.set(base.rot[0] + tilt - kick * 1.4, base.rot[1], base.rot[2] + lift * 0.3);
    const grip = rightHandPoint(key);
    this.hand.position.set(grip[0] + bobX - lift * 0.04, grip[1] + bobY + rise, grip[2] + kick - lift * 0.12);
    this.hand.rotation.set(HAND_REST.right.x + tilt * 0.6, HAND_REST.right.y, HAND_REST.right.z + lift * 0.3);

    const pose = leftHandPoint(key);
    // У пистолета левой руки в кадре нет — она появляется только чтобы подать
    // магазин, и уходит вместе с анимацией.
    this.handL.visible = Boolean(pose) || active;
    if (!this.handL.visible) return;
    const [lx, ly, lz] = pose ?? PISTOL_RELOAD_HAND;
    // Кисть ныряет вниз за обоймой и возвращается к магазиноприёмнику.
    const dip = !active ? 0
      : r < 0.45 ? ease(r / 0.45)
      : 1 - ease(Math.min(1, (r - 0.45) / 0.32));
    this.handL.position.set(
      lx + bobX,
      ly + bobY + rise - dip * 0.24,
      lz + kick - lift * 0.14,
    );
    this.handL.rotation.set(HAND_REST.left.x + tilt * 0.5 + dip * 0.5, HAND_REST.left.y, HAND_REST.left.z);
  }

  _fire(w) {
    this.cooldown = w.cooldown;
    // От бедра снайперка бьёт с полноценным подбросом; точность — награда за
    // то, что игрок потратил время и встал в оптику.
    const hip = !this.aiming;
    this.recoilPitch += hip && w.hipRecoil ? w.hipRecoil : w.recoil;
    this._vmKick = hip && w.hipViewKick ? w.hipViewKick : w.viewKick;
    this.ammo[this.weapon] = Math.max(0, this.ammo[this.weapon] - 1);
    this.shotsFired++;
    Sound[w.sound]?.();
    const origin = this.getEyePos();
    const dir = this.getAimDir();
    // onFire возвращает 0 мимо / 1 тело / 2 голова — для записи профиля меткости
    const hit = this.onFire(w.id, origin, dir) ?? 0;
    if (hit) this.shotsHit++;
    this.recorder?.markShot(w.id, hit);
  }

  /** Закрывает timeline текущим состоянием перед синхронным encode(). */
  ensureFinalReplayFrame() {
    return this.recorder?.ensureFinalFrame(this.pos, this.yaw, this.pitch, this.weapon) ?? false;
  }

  get accuracy() { return this.shotsFired ? this.shotsHit / this.shotsFired : 0; }
}

function disposeObject(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse((o) => {
    if (o.geometry) geometries.add(o.geometry);
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const mat of mats) {
      materials.add(mat);
      if (mat.map) textures.add(mat.map);
    }
  });
  textures.forEach(t => t.dispose());
  materials.forEach(m => m.dispose());
  geometries.forEach(g => g.dispose());
}
