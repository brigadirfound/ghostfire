// Синтез бота-призрака для пользовательской карты (в браузере).
// Та же логика, что tools/gen_ghosts.mjs, но вэйпоинты выбираются случайно
// из проходимых клеток карты. Формат записи — общий протокол replay.js.
import { Recorder, TICK_RATE } from './replay.js';

const DIFFICULTIES = [
  { name: 'Лёгкий',  speed: 4.5, jumpEvery: 4.0, strafe: 0.15, accuracy: 0.25, headRate: 0.08, fireEvery: 2.2 },
  { name: 'Средний', speed: 6.5, jumpEvery: 2.2, strafe: 0.45, accuracy: 0.5,  headRate: 0.18, fireEvery: 1.3 },
  { name: 'Сложный', speed: 8,   jumpEvery: 1.2, strafe: 0.75, accuracy: 0.72, headRate: 0.32, fireEvery: 0.85 },
];

export function botNames() { return DIFFICULTIES.map(d => d.name); }

/** Собирает призрака-бота уровня diff (0..2) для карты mapData. */
export function synthBotForMap(mapData, diff) {
  const d = DIFFICULTIES[diff] ?? DIFFICULTIES[1];
  const solid = new Set(mapData.blocks.map(([x, y, z]) => `${x}|${y}|${z}`));
  const groundY = (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z);
    for (let y = 14; y >= 0; y--) if (solid.has(`${xi}|${y}|${zi}`)) return y + 1;
    return 1;
  };
  // проходимые клетки: есть пол, две клетки воздуха над ним
  const walkable = [];
  for (const [x, y, z] of mapData.blocks) {
    if (!solid.has(`${x}|${y + 1}|${z}`) && !solid.has(`${x}|${y + 2}|${z}`) &&
        groundY(x + 0.5, z + 0.5) === y + 1) {
      walkable.push([x + 0.5, z + 0.5]);
    }
  }
  if (walkable.length < 4) walkable.push([2, 2], [4, 4], [2, 4], [4, 2]);

  // вэйпоинты: старт у спавна призрака, дальше случайные, но не слишком близкие
  const spawn = mapData.spawns?.[1] ?? mapData.spawns?.[0];
  const waypoints = [spawn ? [spawn[0], spawn[2]] : walkable[0]];
  for (let i = 0; i < 12; i++) {
    let best = null, bestD = -1;
    for (let tries = 0; tries < 8; tries++) {
      const c = walkable[Math.floor(Math.random() * walkable.length)];
      const prev = waypoints[waypoints.length - 1];
      const dist = Math.hypot(c[0] - prev[0], c[1] - prev[1]);
      if (dist > 4 && dist > bestD) { best = c; bestD = dist; }
    }
    waypoints.push(best ?? walkable[Math.floor(Math.random() * walkable.length)]);
  }

  const rec = new Recorder(TICK_RATE);
  const dt = 1 / TICK_RATE;
  const jumpVel = 8.5, gravity = 24;
  let wi = 0, pos = { x: waypoints[0][0], z: waypoints[0][1] };
  let yOff = 0, vy = 0, airborne = false, weapon = 0;
  let jumpT = d.jumpEvery * 0.5, fireT = d.fireEvery, strafeT = 0;
  // подбирает пушку в середине записи, если на карте есть точки
  const pickups = (mapData.weapons ?? []).slice(0, 2).map((w, i) => ({ atSec: 5 + i * 12, weapon: w.type }));
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
    // по-осевое движение с проверкой стен: шаг вверх максимум на 1 блок,
    // иначе бот (особенно с сильным стрейфом) виляет сквозь стены
    const g0 = groundY(pos.x, pos.z);
    const stepX = (mx / ml) * d.speed * dt;
    const stepZ = (mz / ml) * d.speed * dt;
    if (groundY(pos.x + stepX, pos.z) - g0 <= 1.01) pos.x += stepX;
    if (groundY(pos.x, pos.z + stepZ) - g0 <= 1.01) pos.z += stepZ;

    jumpT -= dt;
    if (jumpT <= 0 && !airborne) {
      airborne = true; vy = jumpVel;
      jumpT = d.jumpEvery * (0.7 + Math.random() * 0.6);
      rec.markJump();
    }
    if (airborne) {
      vy -= gravity * dt;
      yOff += vy * dt;
      if (yOff <= 0) { yOff = 0; airborne = false; }
    }
    const y = groundY(pos.x, pos.z) + yOff;

    if (pickups.length && t >= pickups[0].atSec) {
      weapon = pickups.shift().weapon;
      rec.markPickup(weapon);
    }

    const yaw = Math.atan2(-dx, -dz) + (Math.random() - 0.5) * 0.06;
    rec.frames.push({ x: pos.x, y, z: pos.z, yaw, pitch: (Math.random() - 0.5) * 0.1, flags: (weapon & 7) << 1 });

    fireT -= dt;
    if (fireT <= 0) {
      fireT = d.fireEvery * (0.6 + Math.random() * 0.8);
      const roll = Math.random();
      const hit = roll < d.accuracy * d.headRate ? 2 : roll < d.accuracy ? 1 : 0;
      rec.shots.push({ tick, weapon, hit });
    }
  }
  return { v: 1, map: '__custom', name: d.name, data: rec.encode() };
}
