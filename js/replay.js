// Протокол записи призрака. ЭТОТ ЖЕ формат в V2 поедет по WebSocket —
// поэтому модуль не зависит от DOM/three и работает и в браузере, и в Node.
//
// Бинарный формат (little-endian), затем base64:
//   [0..3]  magic "GF01"
//   [4..5]  uint16 tickRate (снапшотов в секунду, 20)
//   [6..9]  uint32 frameCount
//   [10..13] uint32 shotCount
//   [14..17] uint32 pickupCount
//   далее frameCount × 21 байт:  float32 x, y, z, yaw, pitch; uint8 flags
//         flags: bit0 — прыжок в этот тик; bits1-3 — id оружия (0..5, см. js/weapons.js).
//         Изначально было 2 бита (0 пистолет, 1 дробовик, 2 рейлган) — расширено до
//         3 бит для новых слотов; бит3 в старых записях всегда 0, так что старые
//         записи читаются новым декодером без изменений (полная совместимость)
//   далее shotCount × 6 байт:    uint32 tick; uint8 weapon; uint8 hit (0 мимо, 1 тело, 2 голова)
//   далее pickupCount × 5 байт:  uint32 tick; uint8 weapon

export const TICK_RATE = 20;
const MAGIC = 'GF01';
const FRAME_SIZE = 21, SHOT_SIZE = 6, PICKUP_SIZE = 5, HEADER_SIZE = 18;

export class Recorder {
  constructor(tickRate = TICK_RATE) {
    this.tickRate = tickRate;
    this.frames = [];   // {x,y,z,yaw,pitch,flags}
    this.shots = [];    // {tick,weapon,hit}
    this.pickups = [];  // {tick,weapon}
    this._accum = 0;
    this._jumped = false;
  }

  /** Вызывается каждый кадр рендера; сам прореживает до tickRate. */
  update(dt, pos, yaw, pitch, weapon) {
    this._accum += dt;
    const step = 1 / this.tickRate;
    let written = 0;
    while (this._accum >= step) {
      this._accum -= step;
      this._pushFrame(pos, yaw, pitch, weapon);
      written++;
    }
    return written;
  }

  markJump() { this._jumped = true; }
  markShot(weapon, hit) { this.shots.push({ tick: this.frames.length, weapon, hit }); }
  markPickup(weapon) { this.pickups.push({ tick: this.frames.length, weapon }); }

  get durationSec() { return this.frames.length / this.tickRate; }

  /**
   * Гарантирует, что текущее состояние и все события текущего render-frame
   * представлены в timeline до encode(). Если обычный update() уже записал
   * это состояние и event tick валиден, дубликат не создаётся.
   */
  ensureFinalFrame(pos, yaw, pitch, weapon) {
    const last = this.frames[this.frames.length - 1];
    const latestEventTick = Math.max(
      this.shots.length ? this.shots[this.shots.length - 1].tick : -1,
      this.pickups.length ? this.pickups[this.pickups.length - 1].tick : -1,
    );
    const sameState = last && last.x === pos.x && last.y === pos.y && last.z === pos.z &&
      last.yaw === yaw && last.pitch === pitch && ((last.flags >> 1) & 7) === (weapon & 7);
    if (this.frames.length > latestEventTick && sameState) return false;
    this._pushFrame(pos, yaw, pitch, weapon);
    return true;
  }

  _pushFrame(pos, yaw, pitch, weapon) {
    let flags = (weapon & 7) << 1;
    if (this._jumped) { flags |= 1; this._jumped = false; }
    this.frames.push({ x: pos.x, y: pos.y, z: pos.z, yaw, pitch, flags });
  }

  encode() {
    validateTimeline(this.tickRate, this.frames, this.shots, this.pickups);
    const size = HEADER_SIZE + this.frames.length * FRAME_SIZE +
      this.shots.length * SHOT_SIZE + this.pickups.length * PICKUP_SIZE;
    const buf = new ArrayBuffer(size);
    const dv = new DataView(buf);
    for (let i = 0; i < 4; i++) dv.setUint8(i, MAGIC.charCodeAt(i));
    dv.setUint16(4, this.tickRate, true);
    dv.setUint32(6, this.frames.length, true);
    dv.setUint32(10, this.shots.length, true);
    dv.setUint32(14, this.pickups.length, true);
    let o = HEADER_SIZE;
    for (const f of this.frames) {
      dv.setFloat32(o, f.x, true); dv.setFloat32(o + 4, f.y, true); dv.setFloat32(o + 8, f.z, true);
      dv.setFloat32(o + 12, f.yaw, true); dv.setFloat32(o + 16, f.pitch, true);
      dv.setUint8(o + 20, f.flags);
      o += FRAME_SIZE;
    }
    for (const s of this.shots) {
      dv.setUint32(o, s.tick, true); dv.setUint8(o + 4, s.weapon); dv.setUint8(o + 5, s.hit);
      o += SHOT_SIZE;
    }
    for (const p of this.pickups) {
      dv.setUint32(o, p.tick, true); dv.setUint8(o + 4, p.weapon);
      o += PICKUP_SIZE;
    }
    return bytesToBase64(new Uint8Array(buf));
  }
}

export function decode(base64) {
  const bytes = base64ToBytes(base64);
  if (bytes.byteLength < HEADER_SIZE) throw new Error('bad ghost data: truncated header');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== MAGIC) throw new Error('bad ghost data: magic mismatch');
  const tickRate = dv.getUint16(4, true);
  const frameCount = dv.getUint32(6, true);
  const shotCount = dv.getUint32(10, true);
  const pickupCount = dv.getUint32(14, true);
  const expectedSize = HEADER_SIZE + frameCount * FRAME_SIZE +
    shotCount * SHOT_SIZE + pickupCount * PICKUP_SIZE;
  if (expectedSize !== bytes.byteLength) throw new Error('bad ghost data: size mismatch');
  if (tickRate < 1 || tickRate > 240) throw new Error('bad ghost data: invalid tick rate');
  if (frameCount === 0) throw new Error('bad ghost data: empty replay');
  let o = HEADER_SIZE;
  const frames = new Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    frames[i] = {
      x: dv.getFloat32(o, true), y: dv.getFloat32(o + 4, true), z: dv.getFloat32(o + 8, true),
      yaw: dv.getFloat32(o + 12, true), pitch: dv.getFloat32(o + 16, true), flags: dv.getUint8(o + 20),
    };
    o += FRAME_SIZE;
  }
  const shots = new Array(shotCount);
  for (let i = 0; i < shotCount; i++) {
    shots[i] = { tick: dv.getUint32(o, true), weapon: dv.getUint8(o + 4), hit: dv.getUint8(o + 5) };
    o += SHOT_SIZE;
  }
  const pickups = new Array(pickupCount);
  for (let i = 0; i < pickupCount; i++) {
    pickups[i] = { tick: dv.getUint32(o, true), weapon: dv.getUint8(o + 4) };
    o += PICKUP_SIZE;
  }
  validateTimeline(tickRate, frames, shots, pickups);
  return new Replay(tickRate, frames, shots, pickups);
}

export class Replay {
  constructor(tickRate, frames, shots, pickups) {
    this.tickRate = tickRate;
    this.frames = frames;
    this.shots = shots;
    this.pickups = pickups;
  }

  get durationSec() { return this.frames.length / this.tickRate; }

  /** Профиль меткости оригинала: доля попаданий записанных выстрелов. */
  accuracyProfile() {
    if (!this.shots.length) return { accuracy: 0.4, headRate: 0.1, shots: 0 };
    let hits = 0, heads = 0;
    for (const s of this.shots) { if (s.hit) hits++; if (s.hit === 2) heads++; }
    return { accuracy: hits / this.shots.length, headRate: hits ? heads / hits : 0, shots: this.shots.length };
  }

  /** Интерполированное состояние на момент t (сек). Зацикливается по концу записи. */
  sample(t, out = {}) {
    const n = this.frames.length;
    if (n === 0) return null;
    const ft = (t * this.tickRate) % n;
    const i0 = Math.floor(ft) % n;
    const i1 = (i0 + 1) % n;
    // не интерполировать через стык цикла
    const a = this.frames[i0], b = i1 === 0 ? a : this.frames[i1];
    const k = ft - Math.floor(ft);
    out.x = a.x + (b.x - a.x) * k;
    out.y = a.y + (b.y - a.y) * k;
    out.z = a.z + (b.z - a.z) * k;
    out.yaw = lerpAngle(a.yaw, b.yaw, k);
    out.pitch = a.pitch + (b.pitch - a.pitch) * k;
    out.weapon = (a.flags >> 1) & 7;
    out.jumped = (a.flags & 1) === 1;
    out.tick = i0;
    return out;
  }
}

function lerpAngle(a, b, k) {
  // Остаток нормализует за O(1). Циклы здесь позволяли crafted, но конечному
  // yaw порядка 1e38 заморозить главный поток на практически бесконечное время.
  const turn = Math.PI * 2;
  let d = (b - a) % turn;
  if (d > Math.PI) d -= turn;
  else if (d < -Math.PI) d += turn;
  return a + d * k;
}

function validateTimeline(tickRate, frames, shots, pickups) {
  if (!Number.isInteger(tickRate) || tickRate < 1 || tickRate > 240)
    throw new Error('bad ghost data: invalid tick rate');
  if (!frames.length) throw new Error('bad ghost data: empty replay');
  for (const f of frames) {
    if (![f.x, f.y, f.z, f.yaw, f.pitch].every(Number.isFinite) ||
        !Number.isInteger(f.flags) || f.flags < 0 || f.flags > 255 || ((f.flags >> 1) & 7) > 5)
      throw new Error('bad ghost data: invalid frame');
  }
  for (const s of shots) {
    if (!Number.isInteger(s.tick) || s.tick < 0 || s.tick >= frames.length ||
        !Number.isInteger(s.weapon) || s.weapon < 0 || s.weapon > 5 ||
        !Number.isInteger(s.hit) || s.hit < 0 || s.hit > 2)
      throw new Error('bad ghost data: invalid shot');
  }
  for (const p of pickups) {
    if (!Number.isInteger(p.tick) || p.tick < 0 || p.tick >= frames.length ||
        !Number.isInteger(p.weapon) || p.weapon < 0 || p.weapon > 5)
      throw new Error('bad ghost data: invalid pickup');
  }
}

// --- base64, работает в браузере и в Node ---
export function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToBytes(b64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
