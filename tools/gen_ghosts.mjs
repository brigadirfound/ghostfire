// Генератор встроенных бот-призраков ghosts/ghost1..5.json.
// Использует тот же протокол Recorder из js/replay.js — формат идентичен
// записи живого игрока. Запуск: node tools/gen_ghosts.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Recorder, TICK_RATE } from '../js/replay.js';

const mapCache = {};
function loadMap(id) {
  if (!mapCache[id]) {
    const m = JSON.parse(readFileSync(new URL(`../maps/${id}.json`, import.meta.url)));
    m.solid = new Set(m.blocks.map(([x, y, z]) => `${x}|${y}|${z}`));
    mapCache[id] = m;
  }
  return mapCache[id];
}

function groundY(map, x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  for (let y = 7; y >= 0; y--) if (map.solid.has(`${xi}|${y}|${zi}`)) return y + 1;
  return 1;
}

/**
 * Синтез записи: бот бегает по вэйпоинтам, прыгает, подбирает пушки,
 * периодически стреляет. hit-флаги выстрелов задают профиль меткости.
 */
function synthGhost({ mapId, waypoints, speed, jumpEvery, strafe, accuracy, headRate,
                      fireEvery, pickupAt, durationSec }) {
  const map = loadMap(mapId);
  const rec = new Recorder(TICK_RATE);
  const dt = 1 / TICK_RATE;
  const jumpVel = 8.5, gravity = 24;

  let wi = 0;
  let pos = { x: waypoints[0][0], z: waypoints[0][1] };
  let yOff = 0, vy = 0, airborne = false;
  let weapon = 0;
  let jumpT = jumpEvery * 0.5, fireT = fireEvery, strafeT = 0;
  const pickupsLeft = [...pickupAt]; // [{atSec, weapon}]
  const totalTicks = Math.round(durationSec * TICK_RATE);

  for (let tick = 0; tick < totalTicks; tick++) {
    const t = tick * dt;
    const [wx, wz] = waypoints[wi];
    let dx = wx - pos.x, dz = wz - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) { wi = (wi + 1) % waypoints.length; }
    if (dist > 1e-3) { dx /= dist; dz /= dist; }
    // стрейф-виляние — чем сложнее бот, тем резче
    strafeT += dt;
    const sw = Math.sin(strafeT * (2 + strafe * 3)) * strafe;
    const mx = dx + -dz * sw, mz = dz + dx * sw;
    const ml = Math.hypot(mx, mz) || 1;
    // по-осевое движение с проверкой стен (шаг вверх максимум 1 блок),
    // чтобы стрейф не заносил бота сквозь стены
    const g0 = groundY(map, pos.x, pos.z);
    const stepX = (mx / ml) * speed * dt;
    const stepZ = (mz / ml) * speed * dt;
    if (groundY(map, pos.x + stepX, pos.z) - g0 <= 1.01) pos.x += stepX;
    if (groundY(map, pos.x, pos.z + stepZ) - g0 <= 1.01) pos.z += stepZ;

    // прыжки
    jumpT -= dt;
    if (jumpT <= 0 && !airborne) {
      airborne = true; vy = jumpVel;
      jumpT = jumpEvery * (0.7 + Math.random() * 0.6);
      rec.markJump();
    }
    const gy = groundY(map, pos.x, pos.z);
    if (airborne) {
      vy -= gravity * dt;
      yOff += vy * dt;
      if (yOff <= 0) { yOff = 0; airborne = false; }
    }
    const y = gy + yOff;

    // подбор оружия по расписанию
    if (pickupsLeft.length && t >= pickupsLeft[0].atSec) {
      weapon = pickupsLeft.shift().weapon;
      rec.markPickup(weapon);
    }

    // взгляд по ходу движения + дрожание
    const yaw = Math.atan2(-dx, -dz) + (Math.random() - 0.5) * 0.06;
    const pitch = (Math.random() - 0.5) * 0.1;

    rec.frames.push({ x: pos.x, y, z: pos.z, yaw, pitch, flags: (weapon & 3) << 1 });

    // выстрелы: hit-флаг по целевой меткости (призрак в игре целится живьём,
    // из записи берётся только ПРОФИЛЬ точности)
    fireT -= dt;
    if (fireT <= 0) {
      fireT = fireEvery * (0.6 + Math.random() * 0.8);
      const roll = Math.random();
      const hit = roll < accuracy * headRate ? 2 : roll < accuracy ? 1 : 0;
      rec.shots.push({ tick, weapon, hit });
    }
  }
  return rec;
}

const A1 = {
  // круг по arena01 с заходами в центр и к рейлу
  waypoints: [[20.5, 20.5], [12, 19], [4.5, 20], [4, 12], [6, 5], [12, 6], [14, 12], [20, 12], [20.5, 3.5], [14, 4], [12, 12.5]],
};
const A2 = {
  // arena02: низ + подъём на балкон к рейлгану
  waypoints: [[25.5, 14], [20, 9], [14, 9.5], [9, 12], [6, 6], [2, 8.5], [2, 5], [8, 3.5], [14, 3], [20, 3.5], [25, 6], [25.5, 10], [18, 14], [14, 18], [8, 20], [14, 24.5]],
};

const BOTS = [
  { name: 'Тень',    mapId: 'arena01', wp: A1, speed: 4.5, jumpEvery: 4.0, strafe: 0.15, accuracy: 0.25, headRate: 0.08, fireEvery: 2.2, pickups: [] },
  { name: 'Дымок',   mapId: 'arena01', wp: A1, speed: 5.5, jumpEvery: 3.0, strafe: 0.3,  accuracy: 0.35, headRate: 0.12, fireEvery: 1.7, pickups: [{ atSec: 6, weapon: 1 }] },
  { name: 'Фантом',  mapId: 'arena02', wp: A2, speed: 6.5, jumpEvery: 2.2, strafe: 0.45, accuracy: 0.5,  headRate: 0.18, fireEvery: 1.3, pickups: [{ atSec: 5, weapon: 1 }, { atSec: 20, weapon: 2 }] },
  { name: 'Мираж',   mapId: 'arena01', wp: A1, speed: 7.5, jumpEvery: 1.6, strafe: 0.6,  accuracy: 0.62, headRate: 0.25, fireEvery: 1.0, pickups: [{ atSec: 4, weapon: 1 }, { atSec: 15, weapon: 2 }] },
  { name: 'Инферно', mapId: 'arena02', wp: A2, speed: 8,   jumpEvery: 1.2, strafe: 0.75, accuracy: 0.75, headRate: 0.35, fireEvery: 0.8, pickups: [{ atSec: 3, weapon: 2 }, { atSec: 14, weapon: 1 }, { atSec: 25, weapon: 2 }] },
];

mkdirSync(new URL('../ghosts/', import.meta.url), { recursive: true });
BOTS.forEach((b, i) => {
  const rec = synthGhost({
    mapId: b.mapId, waypoints: b.wp.waypoints, speed: b.speed, jumpEvery: b.jumpEvery,
    strafe: b.strafe, accuracy: b.accuracy, headRate: b.headRate,
    fireEvery: b.fireEvery, pickupAt: b.pickups, durationSec: 45,
  });
  const entry = { v: 1, map: b.mapId, name: b.name, data: rec.encode() };
  writeFileSync(new URL(`../ghosts/ghost${i + 1}.json`, import.meta.url), JSON.stringify(entry));
  console.log(`ghost${i + 1}.json — ${b.name}, ${rec.frames.length} frames, ${rec.shots.length} shots`);
});
