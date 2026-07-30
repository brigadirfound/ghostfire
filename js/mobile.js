// Мобильное управление с переключением модальности для гибридных устройств.
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';

const primaryCoarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
const anyFine = window.matchMedia?.('(any-pointer: fine)')?.matches ?? false;
export const HAS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
// Живой экспорт: game.js видит переключение touch ↔ mouse на гибридном устройстве.
export let IS_TOUCH = primaryCoarse;

const isControlPointer = (event) => event.pointerType === 'touch' || event.pointerType === 'pen';

export class MobileControls {
  constructor(settings) {
    this.settings = settings;
    this.player = null;
    this.getGhost = () => null;
    this._stickId = null;
    this._lookId = null;
    this._buttonIds = new Map();
    this._pauseId = null;
    this._stickCenter = { x: 0, y: 0 };
    this._look = { x: 0, y: 0 };
    this._firePressed = false;
    this._aimPressed = false;
    this._jumpPressed = false;
    this._paused = false;
    this._disposed = false;
    this._listeners = [];

    if (IS_TOUCH) document.body.classList.add('is-touch');
    this._bindModality();
    this._blockBrowserGestures();
    this._bind();
    this.applyFireMode();
  }

  _listen(target, type, handler, options) {
    if (!target) return;
    target.addEventListener(type, handler, options);
    this._listeners.push(() => target.removeEventListener(type, handler, options));
  }

  _setTouchMode(active) {
    if (IS_TOUCH === active) return;
    IS_TOUCH = active;
    document.body.classList.toggle('is-touch', active);
    if (!active) this.reset();
  }

  _bindModality() {
    this._listen(document, 'pointerdown', (event) => {
      if (isControlPointer(event)) this._setTouchMode(true);
      else if (event.pointerType === 'mouse' && anyFine) this._setTouchMode(false);
    }, { capture: true });
  }

  /** Пинч и двойной тап блокируются только над игровым полотном/контролами. */
  _blockBrowserGestures() {
    if (!HAS_TOUCH) return;
    const isGameTarget = (target) => target instanceof Element &&
      Boolean(target.closest('#mobile-ui, #game-canvas, #hud'));
    this._listen(document, 'touchmove', (event) => {
      if (event.touches.length > 1 && isGameTarget(event.target)) event.preventDefault();
    }, { passive: false });
    this._listen(document, 'gesturestart', (event) => {
      if (isGameTarget(event.target)) event.preventDefault();
    }, { passive: false });
    let lastTap = 0;
    this._listen(document, 'touchend', (event) => {
      if (!isGameTarget(event.target)) return;
      const now = performance.now();
      if (now - lastTap < 300) event.preventDefault();
      lastTap = now;
    }, { passive: false });
  }

  applyFireMode() {
    const button = document.getElementById('btn-fire');
    if (button) button.style.display = this.settings.fireMode === 'auto' ? 'none' : 'flex';
  }

  attach(player, getGhost = () => null) {
    if (this.player && this.player !== player) this.reset();
    this.player = player;
    this.getGhost = typeof getGhost === 'function' ? getGhost : () => null;
  }

  setPaused(paused) {
    this._paused = Boolean(paused);
    if (this._paused) this.reset();
  }

  reset() {
    const stickZone = document.getElementById('stick-zone');
    const lookZone = document.getElementById('look-zone');
    const pauseButton = document.getElementById('btn-pause-mobile');
    if (this._stickId !== null && stickZone?.hasPointerCapture?.(this._stickId)) {
      stickZone.releasePointerCapture(this._stickId);
    }
    if (this._lookId !== null && lookZone?.hasPointerCapture?.(this._lookId)) {
      lookZone.releasePointerCapture(this._lookId);
    }
    for (const [element, pointerId] of this._buttonIds) {
      if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
    }
    if (this._pauseId !== null && pauseButton?.hasPointerCapture?.(this._pauseId)) {
      pauseButton.releasePointerCapture(this._pauseId);
    }
    this._firePressed = false;
    this._aimPressed = false;
    this._jumpPressed = false;
    this._stickId = null;
    this._lookId = null;
    this._buttonIds.clear();
    this._pauseId = null;
    const base = document.getElementById('stick-base');
    if (base) base.style.display = 'none';
    document.querySelectorAll('#mobile-ui [aria-pressed="true"]').forEach((element) => {
      element.setAttribute('aria-pressed', 'false');
    });
    if (this.player?.input) {
      this.player.input.move?.set?.(0, 0);
      this.player.input.fire = false;
      this.player.input.jump = false;
      this.player.input.aim = false;
    }
  }

  _bind() {
    const stickZone = document.getElementById('stick-zone');
    const lookZone = document.getElementById('look-zone');
    const base = document.getElementById('stick-base');
    const knob = document.getElementById('stick-knob');
    const fireButton = document.getElementById('btn-fire');
    const jumpButton = document.getElementById('btn-jump');
    const pauseButton = document.getElementById('btn-pause-mobile');
    const reloadButton = document.getElementById('btn-reload');
    const aimButton = document.getElementById('btn-aim');
    if (!stickZone || !lookZone || !base || !knob || !fireButton || !jumpButton) return;

    this._listen(stickZone, 'pointerdown', (event) => {
      if (!isControlPointer(event) || this._paused || this._stickId !== null) return;
      event.preventDefault();
      this._setTouchMode(true);
      this._stickId = event.pointerId;
      stickZone.setPointerCapture?.(event.pointerId);
      this._stickCenter = { x: event.clientX, y: event.clientY };
      base.style.display = 'block';
      base.style.left = `${event.clientX - 60}px`;
      base.style.top = `${event.clientY - 60}px`;
      knob.style.left = '33px';
      knob.style.top = '33px';
    });
    this._listen(stickZone, 'pointermove', (event) => {
      if (event.pointerId !== this._stickId || !this.player || this._paused) return;
      event.preventDefault();
      const dx = event.clientX - this._stickCenter.x;
      const dy = event.clientY - this._stickCenter.y;
      const length = Math.hypot(dx, dy);
      const max = 55;
      const scale = length > max ? max / length : 1;
      knob.style.left = `${33 + dx * scale}px`;
      knob.style.top = `${33 + dy * scale}px`;
      this.player.input.move.set(
        THREE.MathUtils.clamp(dx / max, -1, 1),
        THREE.MathUtils.clamp(dy / max, -1, 1),
      );
    });
    const endStick = (event) => {
      if (event.pointerId !== this._stickId) return;
      this._stickId = null;
      base.style.display = 'none';
      this.player?.input.move?.set?.(0, 0);
      if (stickZone.hasPointerCapture?.(event.pointerId)) stickZone.releasePointerCapture(event.pointerId);
    };
    this._listen(stickZone, 'pointerup', endStick);
    this._listen(stickZone, 'pointercancel', endStick);
    this._listen(stickZone, 'lostpointercapture', endStick);

    this._listen(lookZone, 'pointerdown', (event) => {
      if (!isControlPointer(event) || this._paused || this._lookId !== null) return;
      event.preventDefault();
      this._setTouchMode(true);
      this._lookId = event.pointerId;
      lookZone.setPointerCapture?.(event.pointerId);
      this._look = { x: event.clientX, y: event.clientY };
    });
    this._listen(lookZone, 'pointermove', (event) => {
      if (event.pointerId !== this._lookId || !this.player || this._paused) return;
      event.preventDefault();
      const sensitivity = 0.0035 * (this.settings.sensitivity ?? 1);
      this.player.addLook(
        (event.clientX - this._look.x) * sensitivity,
        (event.clientY - this._look.y) * sensitivity,
      );
      this._look = { x: event.clientX, y: event.clientY };
    });
    const endLook = (event) => {
      if (event.pointerId !== this._lookId) return;
      this._lookId = null;
      if (lookZone.hasPointerCapture?.(event.pointerId)) lookZone.releasePointerCapture(event.pointerId);
    };
    this._listen(lookZone, 'pointerup', endLook);
    this._listen(lookZone, 'pointercancel', endLook);
    this._listen(lookZone, 'lostpointercapture', endLook);

    const bindHoldButton = (element, setPressed) => {
      this._listen(element, 'pointerdown', (event) => {
        if (!isControlPointer(event) || this._paused || this._buttonIds.has(element)) return;
        event.preventDefault();
        event.stopPropagation();
        this._setTouchMode(true);
        this._buttonIds.set(element, event.pointerId);
        element.setPointerCapture?.(event.pointerId);
        element.setAttribute('aria-pressed', 'true');
        setPressed(true);
      });
      const end = (event) => {
        if (this._buttonIds.get(element) !== event.pointerId) return;
        this._buttonIds.delete(element);
        element.setAttribute('aria-pressed', 'false');
        setPressed(false);
        if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
      };
      this._listen(element, 'pointerup', end);
      this._listen(element, 'pointercancel', end);
      this._listen(element, 'lostpointercapture', end);
    };
    bindHoldButton(fireButton, (pressed) => { this._firePressed = pressed; });
    bindHoldButton(jumpButton, (pressed) => { this._jumpPressed = pressed; });
    // Перезарядка запускается по нажатию и снимается сама: держать не нужно.
    if (reloadButton) {
      bindHoldButton(reloadButton, (pressed) => {
        if (pressed) this.player?.startReload();
      });
    }
    // Прицел держат пальцем, как и огонь.
    if (aimButton) bindHoldButton(aimButton, (pressed) => { this._aimPressed = pressed; });

    if (pauseButton) {
      this._listen(pauseButton, 'pointerdown', (event) => {
        if (!isControlPointer(event) || this._pauseId !== null) return;
        event.preventDefault();
        event.stopPropagation();
        this._setTouchMode(true);
        this._pauseId = event.pointerId;
        pauseButton.setPointerCapture?.(event.pointerId);
      });
      this._listen(pauseButton, 'pointerup', (event) => {
        if (event.pointerId !== this._pauseId) return;
        event.preventDefault();
        event.stopPropagation();
        this._pauseId = null;
        if (pauseButton.hasPointerCapture?.(event.pointerId)) pauseButton.releasePointerCapture(event.pointerId);
        document.dispatchEvent(new CustomEvent('ghostfire:pause-request'));
      });
      const cancelPause = (event) => {
        if (event.pointerId === this._pauseId) this._pauseId = null;
      };
      this._listen(pauseButton, 'pointercancel', cancelPause);
      this._listen(pauseButton, 'lostpointercapture', cancelPause);
    }

    this._listen(document, 'visibilitychange', () => {
      if (document.hidden) this.reset();
    });
    this._listen(window, 'blur', () => this.reset());
    this._listen(window, 'pagehide', () => this.reset());
  }

  /** Каждый кадр: автоогонь и передача кнопок в input игрока. */
  update() {
    if (!IS_TOUCH || !this.player) return;
    if (this._paused || document.hidden) {
      this.reset();
      return;
    }
    this.player.input.jump = this._jumpPressed;
    this.player.input.fire = this.settings.fireMode === 'auto'
      ? this._aimOnGhost(6 * Math.PI / 180)
      : this._firePressed;
    this.player.input.aim = this._aimPressed;
    // Кнопка оптики есть только у пушки с прицелом.
    const aimButton = document.getElementById('btn-aim');
    if (aimButton) {
      const scoped = Boolean(WEAPONS[this.player.weapon]?.zoomFov);
      aimButton.classList.toggle('hidden', !scoped);
      if (!scoped && this._aimPressed) this._aimPressed = false;
    }
  }

  _aimOnGhost(cone) {
    const ghost = this.getGhost();
    if (!ghost?.alive) return false;
    const eye = this.player.getEyePos(_v1);
    const direction = this.player.getAimDir(_v2);
    const toGhost = _v3.set(ghost.pos.x, ghost.pos.y + 1, ghost.pos.z).sub(eye);
    const distance = toGhost.length();
    if (distance < 0.01) return true;
    toGhost.normalize();
    if (direction.angleTo(toGhost) > cone) return false;
    return typeof ghost.hasLosTo === 'function' && ghost.hasLosTo(eye);
  }

  static applyAimAssist(direction, eye, ghost, maxAngleDeg = 3) {
    if (!IS_TOUCH || !ghost?.alive) return direction;
    const head = _v1.set(ghost.pos.x, ghost.pos.y + 1.43, ghost.pos.z).sub(eye).normalize();
    const body = _v2.set(ghost.pos.x, ghost.pos.y + 1, ghost.pos.z).sub(eye).normalize();
    const max = maxAngleDeg * Math.PI / 180;
    if (direction.angleTo(head) < max) return direction.copy(head);
    if (direction.angleTo(body) < max) return direction.copy(body);
    return direction;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.reset();
    for (const remove of this._listeners.splice(0)) remove();
    document.body.classList.remove('is-touch');
    IS_TOUCH = false;
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
