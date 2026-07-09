// Мобильное управление: левая половина — виртуальный стик, правая — свайп камеры,
// кнопки FIRE/JMP, опциональный автоогонь при наведении на врага, aim-assist 3°.
import * as THREE from 'three';

export const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

export class MobileControls {
  constructor(settings) {
    this.settings = settings;   // { fireMode: 'button'|'auto', sensitivity }
    this.player = null;
    this.getGhost = () => null;
    this._stickId = null;
    this._lookId = null;
    this._stickCenter = { x: 0, y: 0 };
    this._look = { x: 0, y: 0 };
    this._firePressed = false;
    this._jumpPressed = false;
    if (IS_TOUCH) {
      document.body.classList.add('is-touch');
      this._blockBrowserGestures();
    }
    this._bind();
    this.applyFireMode();
  }

  /** Пинч-зум и двойной тап ломают управление двумя пальцами — глушим. */
  _blockBrowserGestures() {
    document.addEventListener('touchmove', (e) => {
      if (e.touches.length > 1) e.preventDefault(); // пинч-зум
    }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault()); // iOS Safari
    let lastTap = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTap < 300) e.preventDefault(); // зум двойным тапом
      lastTap = now;
    }, { passive: false });
  }

  applyFireMode() {
    const btn = document.getElementById('btn-fire');
    btn.style.display = this.settings.fireMode === 'auto' ? 'none' : 'flex';
  }

  attach(player, getGhost) {
    this.player = player;
    this.getGhost = getGhost;
  }

  _bind() {
    const stickZone = document.getElementById('stick-zone');
    const lookZone = document.getElementById('look-zone');
    const base = document.getElementById('stick-base');
    const knob = document.getElementById('stick-knob');
    const fireBtn = document.getElementById('btn-fire');
    const jumpBtn = document.getElementById('btn-jump');

    // --- стик движения ---
    stickZone.addEventListener('pointerdown', (e) => {
      if (this._stickId !== null) return;
      this._stickId = e.pointerId;
      stickZone.setPointerCapture(e.pointerId);
      this._stickCenter = { x: e.clientX, y: e.clientY };
      base.style.display = 'block';
      base.style.left = (e.clientX - 60) + 'px';
      base.style.top = (e.clientY - 60) + 'px';
      knob.style.left = '33px'; knob.style.top = '33px';
    });
    stickZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._stickId || !this.player) return;
      const dx = e.clientX - this._stickCenter.x;
      const dy = e.clientY - this._stickCenter.y;
      const len = Math.hypot(dx, dy);
      const max = 55;
      const k = len > max ? max / len : 1;
      knob.style.left = (33 + dx * k) + 'px';
      knob.style.top = (33 + dy * k) + 'px';
      this.player.input.move.set(
        THREE.MathUtils.clamp(dx / max, -1, 1),
        THREE.MathUtils.clamp(dy / max, -1, 1));
    });
    const stickEnd = (e) => {
      if (e.pointerId !== this._stickId) return;
      this._stickId = null;
      base.style.display = 'none';
      this.player?.input.move.set(0, 0);
    };
    stickZone.addEventListener('pointerup', stickEnd);
    stickZone.addEventListener('pointercancel', stickEnd);

    // --- свайп камеры ---
    lookZone.addEventListener('pointerdown', (e) => {
      if (this._lookId !== null) return;
      this._lookId = e.pointerId;
      lookZone.setPointerCapture(e.pointerId);
      this._look = { x: e.clientX, y: e.clientY };
    });
    lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._lookId || !this.player) return;
      const sens = 0.0035 * (this.settings.sensitivity ?? 1);
      this.player.addLook((e.clientX - this._look.x) * sens, (e.clientY - this._look.y) * sens);
      this._look = { x: e.clientX, y: e.clientY };
    });
    const lookEnd = (e) => { if (e.pointerId === this._lookId) this._lookId = null; };
    lookZone.addEventListener('pointerup', lookEnd);
    lookZone.addEventListener('pointercancel', lookEnd);

    // --- кнопки ---
    const press = (el, on, off) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); on(); });
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    };
    press(fireBtn, () => { this._firePressed = true; }, () => { this._firePressed = false; });
    press(jumpBtn, () => { this._jumpPressed = true; }, () => { this._jumpPressed = false; });
  }

  /** Каждый кадр: автоогонь и передача кнопок в инпут игрока. */
  update() {
    if (!IS_TOUCH || !this.player) return;
    this.player.input.jump = this._jumpPressed;
    if (this.settings.fireMode === 'auto') {
      this.player.input.fire = this._aimOnGhost(6 * Math.PI / 180);
    } else {
      this.player.input.fire = this._firePressed;
    }
  }

  _aimOnGhost(cone) {
    const ghost = this.getGhost();
    if (!ghost || !ghost.alive) return false;
    const eye = this.player.getEyePos(_v1);
    const dir = this.player.getAimDir(_v2);
    const toGhost = _v3.set(ghost.pos.x, ghost.pos.y + 1.0, ghost.pos.z).sub(eye);
    const dist = toGhost.length();
    if (dist < 0.01) return true;
    toGhost.normalize();
    if (dir.angleTo(toGhost) > cone) return false;
    return ghost.hasLosTo(eye);
  }

  /**
   * Aim-assist на таче: магнетизм 3° — если луч почти на призраке,
   * доворачиваем направление точно в цель. Вызывается из game.js при выстреле.
   */
  static applyAimAssist(dir, eye, ghost, maxAngleDeg = 3) {
    if (!IS_TOUCH || !ghost || !ghost.alive) return dir;
    const head = _v1.set(ghost.pos.x, ghost.pos.y + 1.43, ghost.pos.z).sub(eye).normalize();
    const body = _v2.set(ghost.pos.x, ghost.pos.y + 1.0, ghost.pos.z).sub(eye).normalize();
    const max = maxAngleDeg * Math.PI / 180;
    if (dir.angleTo(head) < max) return dir.copy(head);
    if (dir.angleTo(body) < max) return dir.copy(body);
    return dir;
  }
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
