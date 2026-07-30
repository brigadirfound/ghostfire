// Boundary validation for data that can come from share codes, cloud storage
// or user-authored maps. Keep this module free of DOM/Three dependencies so it
// can also be exercised from Node.

export const VALIDATION_LIMITS = Object.freeze({
  shareCodeChars: 60_000,
  shareJsonChars: 220_000,
  replayBase64Chars: 120_000,
  replayFrames: 3_600,       // three minutes at the canonical 20 Hz
  replayShots: 12_000,
  replayPickups: 512,
  mapJsonChars: 160_000,
  mapBlocks: 8_192,
  mapWeapons: 64,
  mapPaletteEntries: 32,
  mapAxis: 128,
  mapSpan: 96,
  cloudBytes: 190_000,       // SDK hard limit is 200 KB; leave envelope room
  walletCoins: 1_000_000_000,
});

// Стартовый баланс. Был 100 при цене первого скина 150 — две трети покупки
// выдавались до первого матча, и магазин открывался почти сразу.
export const STARTING_COINS = 0;

const BUILTIN_MAPS = new Set(['arena01', 'arena02', 'arena03', 'arena04', 'arena05']);
const MAP_TEXTURES = new Set([
  'stone', 'brick', 'planks', 'grass_dirt', 'grass', 'dirt', 'sand', 'metal',
  'crate', 'concrete', 'neon', 'glass', 'plain',
]);
const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z0-9_-]{1,48}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function fail(code, message = code) { return { ok: false, code, error: message }; }
function pass(value, meta = undefined) { return { ok: true, value, meta }; }
function finite(v, min, max) { return Number.isFinite(v) && v >= min && v <= max; }
function integer(v, min, max) { return Number.isInteger(v) && v >= min && v <= max; }
function validDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function jsonLength(value) {
  try { return JSON.stringify(value).length; } catch { return Infinity; }
}

function base64Bytes(value) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Validate the binary GF01 replay without constructing its full object graph. */
export function validateReplayData(data) {
  if (typeof data !== 'string' || data.length < 24 ||
      data.length > VALIDATION_LIMITS.replayBase64Chars || data.length % 4 !== 0 ||
      !BASE64.test(data)) return fail('bad_replay_size', 'Replay data is malformed or too large');
  let bytes;
  try { bytes = base64Bytes(data); } catch { return fail('bad_replay_base64', 'Replay is not valid base64'); }
  if (bytes.byteLength < 18) return fail('bad_replay_header');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'GF01') {
    return fail('bad_replay_magic');
  }
  const tickRate = dv.getUint16(4, true);
  const frames = dv.getUint32(6, true);
  const shots = dv.getUint32(10, true);
  const pickups = dv.getUint32(14, true);
  if (tickRate !== 20 || !integer(frames, 1, VALIDATION_LIMITS.replayFrames) ||
      !integer(shots, 0, VALIDATION_LIMITS.replayShots) ||
      !integer(pickups, 0, VALIDATION_LIMITS.replayPickups)) return fail('bad_replay_counts');
  const expected = 18 + frames * 21 + shots * 6 + pickups * 5;
  if (expected !== bytes.byteLength) return fail('bad_replay_length');

  let o = 18;
  for (let i = 0; i < frames; i++, o += 21) {
    const x = dv.getFloat32(o, true), y = dv.getFloat32(o + 4, true), z = dv.getFloat32(o + 8, true);
    const yaw = dv.getFloat32(o + 12, true), pitch = dv.getFloat32(o + 16, true);
    const flags = dv.getUint8(o + 20), weapon = (flags >> 1) & 7;
    if (!finite(x, -256, 256) || !finite(y, -64, 96) || !finite(z, -256, 256) ||
        !finite(yaw, -512, 512) || !finite(pitch, -Math.PI, Math.PI) || weapon > 5 || (flags & 0xf0)) {
      return fail('bad_replay_frame');
    }
  }
  for (let i = 0; i < shots; i++, o += 6) {
    const tick = dv.getUint32(o, true), weapon = dv.getUint8(o + 4), hit = dv.getUint8(o + 5);
    if (tick >= frames || weapon > 5 || hit > 2) return fail('bad_replay_shot');
  }
  for (let i = 0; i < pickups; i++, o += 5) {
    const tick = dv.getUint32(o, true), weapon = dv.getUint8(o + 4);
    if (tick >= frames || weapon > 5) return fail('bad_replay_pickup');
  }
  return pass(data, { tickRate, frames, shots, pickups, durationSec: frames / tickRate });
}

function sanitizePalette(raw) {
  if (!isPlainObject(raw)) return fail('bad_map_palette');
  const entries = Object.entries(raw);
  if (!entries.length || entries.length > VALIDATION_LIMITS.mapPaletteEntries) return fail('bad_map_palette');
  const palette = Object.create(null);
  for (const [rawType, rawEntry] of entries) {
    const type = Number(rawType);
    if (!integer(type, 1, 255)) return fail('bad_map_palette_type');
    if (typeof rawEntry === 'string') {
      if (!HEX.test(rawEntry)) return fail('bad_map_color');
      palette[type] = rawEntry.toLowerCase();
      continue;
    }
    if (!isPlainObject(rawEntry) || !HEX.test(rawEntry.color ?? '')) return fail('bad_map_color');
    const tex = rawEntry.tex ?? null;
    if (tex !== null && (!MAP_TEXTURES.has(tex) || typeof tex !== 'string')) return fail('bad_map_texture');
    palette[type] = { color: rawEntry.color.toLowerCase(), ...(tex ? { tex } : {}) };
  }
  return pass(palette);
}

/** Strict custom-map schema. The returned map is a detached allow-listed copy. */
export function validateCustomMap(raw) {
  if (!isPlainObject(raw) || jsonLength(raw) > VALIDATION_LIMITS.mapJsonChars) return fail('bad_map_size');
  const pal = sanitizePalette(raw.palette);
  if (!pal.ok) return pal;
  if (!Array.isArray(raw.blocks) || !raw.blocks.length || raw.blocks.length > VALIDATION_LIMITS.mapBlocks) {
    return fail('bad_map_blocks');
  }
  const blocks = [], solid = new Set();
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const block of raw.blocks) {
    if (!Array.isArray(block) || block.length !== 4) return fail('bad_map_block');
    const [x, y, z, type] = block;
    if (!integer(x, -VALIDATION_LIMITS.mapAxis, VALIDATION_LIMITS.mapAxis) ||
        !integer(y, -8, 32) ||
        !integer(z, -VALIDATION_LIMITS.mapAxis, VALIDATION_LIMITS.mapAxis) ||
        !integer(type, 1, 255) || pal.value[type] === undefined) return fail('bad_map_block');
    const key = `${x}|${y}|${z}`;
    if (solid.has(key)) return fail('duplicate_map_block');
    solid.add(key); blocks.push([x, y, z, type]);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  if (maxX - minX + 1 > VALIDATION_LIMITS.mapSpan || maxZ - minZ + 1 > VALIDATION_LIMITS.mapSpan) {
    return fail('bad_map_span');
  }

  if (!Array.isArray(raw.spawns) || raw.spawns.length < 2 || raw.spawns.length > 8) return fail('bad_map_spawns');
  const spawns = [];
  for (const spawn of raw.spawns) {
    if (!Array.isArray(spawn) || spawn.length < 3 || spawn.length > 4) return fail('bad_map_spawn');
    const [x, y, z, yaw = 0] = spawn;
    if (!finite(x, minX, maxX + 1) || !finite(y, -7, 34) || !finite(z, minZ, maxZ + 1) ||
        !finite(yaw, -3600, 3600)) return fail('bad_map_spawn');
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    if (!solid.has(`${xi}|${yi - 1}|${zi}`) || solid.has(`${xi}|${yi}|${zi}`) ||
        solid.has(`${xi}|${yi + 1}|${zi}`)) return fail('unsafe_map_spawn');
    spawns.push([x, y, z, yaw]);
  }

  if (!Array.isArray(raw.weapons) || !raw.weapons.length || raw.weapons.length > VALIDATION_LIMITS.mapWeapons) {
    return fail('bad_map_weapons');
  }
  const weapons = [];
  for (const item of raw.weapons) {
    if (!isPlainObject(item) || !integer(item.type, 1, 5) || !Array.isArray(item.pos) || item.pos.length !== 3 ||
        !finite(item.pos[0], minX, maxX + 1) || !finite(item.pos[1], -7, 34) ||
        !finite(item.pos[2], minZ, maxZ + 1)) return fail('bad_map_weapon');
    weapons.push({ type: item.type, pos: [...item.pos] });
  }
  return pass({ id: 'custom', name: 'map_custom', palette: pal.value, blocks, spawns, weapons });
}

/** Drop all non-protocol fields (_builtin/_diffMult included) from a share entry. */
export function validateShareEntry(raw) {
  if (!isPlainObject(raw) || jsonLength(raw) > VALIDATION_LIMITS.shareJsonChars || raw.v !== 1) {
    return fail('bad_share_envelope');
  }
  const replay = validateReplayData(raw.data);
  if (!replay.ok) return replay;
  const map = raw.map ?? 'arena01';
  if (map !== '__custom' && !BUILTIN_MAPS.has(map)) return fail('bad_share_map');
  let mapData;
  if (map === '__custom') {
    const checked = validateCustomMap(raw.mapData);
    if (!checked.ok) return checked;
    mapData = checked.value;
  } else if (raw.mapData !== undefined && raw.mapData !== null) {
    return fail('unexpected_share_map');
  }
  const value = { v: 1, map, data: replay.value };
  if (typeof raw.name === 'string') {
    value.name = raw.name.normalize().replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 32);
  }
  if (typeof raw.score === 'string' && /^\d{1,3}:\d{1,3}$/.test(raw.score)) value.score = raw.score;
  // Wall-clock time can exceed frames/tickRate on slow devices because physics
  // dt is capped. It must never claim materially less time than its timeline.
  const declaredDuration = Number(raw.durationSec);
  const minDuration = Math.max(0.05, replay.meta.durationSec - 1 / replay.meta.tickRate);
  value.durationSec = finite(declaredDuration, minDuration, 600)
    ? declaredDuration
    : replay.meta.durationSec;
  if (mapData) value.mapData = mapData;
  return pass(value, replay.meta);
}

export function normalizeWallet(raw) {
  const src = isPlainObject(raw) ? raw : {};
  const coins = integer(src.coins, 0, VALIDATION_LIMITS.walletCoins) ? src.coins : STARTING_COINS;
  const owned = Array.isArray(src.owned)
    ? [...new Set(src.owned.filter(v => typeof v === 'string' && ID.test(v)).slice(0, 64))]
    : [];
  if (!owned.includes('default')) owned.unshift('default');
  const equipped = typeof src.equipped === 'string' && owned.includes(src.equipped) ? src.equipped : 'default';
  const out = { coins, owned, equipped };
  if (validDate(src.lastWinDate)) out.lastWinDate = src.lastWinDate;
  if (isPlainObject(src.ghostRewards) && validDate(src.ghostRewards.date)) {
    const counts = Object.create(null);
    if (isPlainObject(src.ghostRewards.counts)) {
      for (const [hash, count] of Object.entries(src.ghostRewards.counts).slice(0, 256)) {
        if (/^[a-z0-9:_-]{3,96}$/i.test(hash) && integer(count, 1, 10_000)) counts[hash] = count;
      }
    }
    out.ghostRewards = { date: src.ghostRewards.date, counts };
  }
  if (isPlainObject(src.processedPurchases)) {
    const ledger = Object.create(null);
    for (const [token, info] of Object.entries(src.processedPurchases).slice(-128)) {
      if (typeof token !== 'string' || token.length < 8 || token.length > 512 || !isPlainObject(info)) continue;
      if (!ID.test(info.productID ?? '') || !integer(info.coins, 1, 1_000_000)) continue;
      ledger[token] = { productID: info.productID, coins: info.coins, at: finite(info.at, 0, 9e15) ? info.at : 0 };
    }
    out.processedPurchases = ledger;
  }
  return out;
}

export function normalizePlayerData(raw) {
  if (!isPlainObject(raw)) return null;
  const s = isPlainObject(raw.settings) ? raw.settings : {};
  const settings = {
    // null = игрок язык не выбирал; тогда решает автоопределение платформы,
    // иначе сейв без явной настройки навсегда прибивал игру к русскому.
    lang: s.lang === 'en' || s.lang === 'ru' ? s.lang : null,
    fireMode: s.fireMode === 'auto' ? 'auto' : 'button',
    sensitivity: finite(s.sensitivity, 0.3, 2.5) ? s.sensitivity : 1,
    sound: s.sound !== false,
    music: s.music !== false,
    tutorialDone: s.tutorialDone === true,
  };
  if (isPlainObject(s.lastPick) && (BUILTIN_MAPS.has(s.lastPick.map) || s.lastPick.map === '__custom') &&
      isPlainObject(s.lastPick.ghost) && ['builtin', 'custombot', 'mine'].includes(s.lastPick.ghost.type) &&
      integer(s.lastPick.ghost.index ?? 0, 0, 4)) {
    settings.lastPick = { map: s.lastPick.map, ghost: { type: s.lastPick.ghost.type, index: s.lastPick.ghost.index ?? 0 } };
  }
  const out = { settings, ghost: null };
  if (raw.ghost) {
    const ghost = validateShareEntry(raw.ghost);
    if (ghost.ok) out.ghost = ghost.value;
  }
  return out;
}

export function serializableObject(value, maxChars = VALIDATION_LIMITS.cloudBytes) {
  return isPlainObject(value) && jsonLength(value) <= maxChars;
}
