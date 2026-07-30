// Генератор встроенных бот-призраков: МАТРИЦА карта × сложность →
// ghosts/{mapId}_d{1..5}.json. Тот же протокол Recorder, что у живого игрока.
// Запуск: node tools/gen_ghosts.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Recorder, TICK_RATE } from '../js/replay.js';
import { createSeededRandom } from './lib/prng.mjs';

const seedArg = process.argv.find((arg) => arg.startsWith('--seed='));
const BASE_SEED = seedArg?.slice('--seed='.length) || 'ghostfire-v1';

const mapCache = {};
function loadMap(id) {
  if (!mapCache[id]) {
    const m = JSON.parse(readFileSync(new URL(`../maps/${id}.json`, import.meta.url)));
    m.solid = new Set(m.blocks.map(([x, y, z]) => `${x}|${y}|${z}`));
    mapCache[id] = m;
  }
  return mapCache[id];
}

// -10 = пустота (карты с пропастью); защита от обрывов не пускает бота туда
function groundY(map, x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  for (let y = 14; y >= 0; y--) if (map.solid.has(`${xi}|${y}|${zi}`)) return y + 1;
  return -10;
}

/** Синтез записи: движение по вэйпоинтам со стрейфом, прыжки, стрельба. */
export function synthGhost(mapId, waypoints, d, random) {
  const map = loadMap(mapId);
  const rec = new Recorder(TICK_RATE);
  const dt = 1 / TICK_RATE;
  const jumpVel = 8.5, gravity = 24;

  let wi = 0;
  let pos = { x: waypoints[0][0], z: waypoints[0][1] };
  let yOff = 0, vy = 0, airborne = false;
  let weapon = 0;
  let jumpT = d.jumpEvery * 0.5, fireT = d.fireEvery, strafeT = 0;
  // подборы: расписание сложности + типы из точек оружия самой карты
  const mapWeapons = map.weapons?.map(w => w.type) ?? [];
  const pickupsLeft = mapWeapons.length
    ? d.pickupAtSec.map((sec, i) => ({ atSec: sec, weapon: mapWeapons[i % mapWeapons.length] }))
    : [];
  const totalTicks = Math.round(45 * TICK_RATE);

  for (let tick = 0; tick < totalTicks; tick++) {
    const t = tick * dt;
    const [wx, wz] = waypoints[wi];
    let dx = wx - pos.x, dz = wz - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) wi = (wi + 1) % waypoints.length;
    if (dist > 1e-3) { dx /= dist; dz /= dist; }
    strafeT += dt;
    const sw = Math.sin(strafeT * (2 + d.strafe * 3)) * d.strafe;
    const mx = dx + -dz * sw, mz = dz + dx * sw;
    const ml = Math.hypot(mx, mz) || 1;
    // по-осевое движение: шаг вверх ≤1 блока (стены) и вниз ≤2.5 (обрывы/пропасти)
    const g0 = groundY(map, pos.x, pos.z);
    const stepX = (mx / ml) * d.speed * dt;
    const stepZ = (mz / ml) * d.speed * dt;
    const gx = groundY(map, pos.x + stepX, pos.z);
    if (gx - g0 <= 1.01 && g0 - gx <= 2.5) pos.x += stepX;
    const gz = groundY(map, pos.x, pos.z + stepZ);
    if (gz - g0 <= 1.01 && g0 - gz <= 2.5) pos.z += stepZ;

    jumpT -= dt;
    if (jumpT <= 0 && !airborne) {
      airborne = true; vy = jumpVel;
      jumpT = d.jumpEvery * (0.7 + random() * 0.6);
      rec.markJump();
    }
    const gy = groundY(map, pos.x, pos.z);
    if (airborne) {
      vy -= gravity * dt;
      yOff += vy * dt;
      if (yOff <= 0) { yOff = 0; airborne = false; }
    }
    const y = Math.max(gy, 1) + yOff;

    if (pickupsLeft.length && t >= pickupsLeft[0].atSec) {
      weapon = pickupsLeft.shift().weapon;
      rec.markPickup(weapon);
    }

    const yaw = Math.atan2(-dx, -dz) + (random() - 0.5) * 0.06;
    const pitch = (random() - 0.5) * 0.1;
    rec.frames.push({ x: pos.x, y, z: pos.z, yaw, pitch, flags: (weapon & 7) << 1 });

    fireT -= dt;
    if (fireT <= 0) {
      fireT = d.fireEvery * (0.6 + random() * 0.8);
      const roll = random();
      const hit = roll < d.accuracy * d.headRate ? 2 : roll < d.accuracy ? 1 : 0;
      rec.shots.push({ tick, weapon, hit });
    }
  }
  return rec;
}

// ---------- маршруты по картам ----------
export const WAYPOINTS = {
  // круг по arena01 с заходами в центр и к рейлу
  arena01: [[20.5, 20.5], [12, 19], [4.5, 20], [4, 12], [6, 5], [12, 6], [14, 12], [20, 12], [20.5, 3.5], [14, 4], [12, 12.5]],
  // arena02: низ + подъём на балкон к рейлгану
  arena02: [[25.5, 14], [20, 9], [14, 9.5], [9, 12], [6, 6], [2, 8.5], [2, 5], [8, 3.5], [14, 3], [20, 3.5], [25, 6], [25.5, 10], [18, 14], [14, 18], [8, 20], [14, 24.5]],
  // arena03 "Блоки": бот живёт на своей стороне рва (x20..29), лазает по ярусам
  arena03: [[28.5, 7], [26, 3.5], [23, 3], [21, 3], [24, 7], [21, 11], [23, 11], [26, 10.5], [28, 10], [21, 7], [25, 5]],
  // arena04 "Пятак": кольцо вокруг креста через все четверти
  arena04: [[13.5, 2.5], [13.5, 8], [13.5, 13.5], [8, 13.5], [2.5, 13.5], [2.5, 8], [2.5, 2.5], [8, 2.5], [10.5, 5.5], [5.5, 10.5]],
  // arena05 "Мосты": крест-накрест по мостам между башнями
  arena05: [[12, 27.5], [11.5, 25], [11.5, 22], [11.5, 15], [11.5, 8], [12, 5.5], [12, 3], [5.5, 3], [5.5, 8], [5.5, 15], [5.5, 22], [5.5, 26], [9, 27.5]],
};

// ---------- 5 сложностей (личности одни на всех картах) ----------
export const DIFFICULTIES = [
  { name: 'ghost_shadow',  speed: 4.5, jumpEvery: 4.0, strafe: 0.15, accuracy: 0.25, headRate: 0.08, fireEvery: 2.2, pickupAtSec: [] },
  { name: 'ghost_smoke',   speed: 5.5, jumpEvery: 3.0, strafe: 0.3,  accuracy: 0.35, headRate: 0.12, fireEvery: 1.7, pickupAtSec: [6] },
  { name: 'ghost_phantom', speed: 6.5, jumpEvery: 2.2, strafe: 0.45, accuracy: 0.5,  headRate: 0.18, fireEvery: 1.3, pickupAtSec: [5, 20] },
  { name: 'ghost_mirage',  speed: 7.5, jumpEvery: 1.6, strafe: 0.6,  accuracy: 0.62, headRate: 0.25, fireEvery: 1.0, pickupAtSec: [4, 15] },
  { name: 'ghost_inferno', speed: 8,   jumpEvery: 1.2, strafe: 0.75, accuracy: 0.75, headRate: 0.35, fireEvery: 0.8, pickupAtSec: [3, 14, 25] },
];

mkdirSync(new URL('../ghosts/', import.meta.url), { recursive: true });
for (const [mapId, waypoints] of Object.entries(WAYPOINTS)) {
  DIFFICULTIES.forEach((d, i) => {
    const contentSeed = `${BASE_SEED}:${mapId}:d${i + 1}`;
    const rec = synthGhost(mapId, waypoints, d, createSeededRandom(contentSeed));
    const entry = {
      v: 1,
      map: mapId,
      name: d.name,
      data: rec.encode(),
      generator: { id: 'gen_ghosts', seed: contentSeed },
    };
    writeFileSync(new URL(`../ghosts/${mapId}_d${i + 1}.json`, import.meta.url), `${JSON.stringify(entry)}\n`);
    console.log(`${mapId}_d${i + 1}.json — ${d.name}, ${rec.frames.length} frames, ${rec.shots.length} shots`);
  });
}
