// Проверка карт и ботов: спавны не в стенах и на земле, боты не заходят
// в стены и не зависают над пропастью. Запуск: node tools/check_maps.mjs
import { readFileSync } from 'node:fs';
import { decode } from '../js/replay.js';

const MAPS = ['arena01', 'arena02', 'arena03', 'arena04', 'arena05'];
let fail = 0;

for (const id of MAPS) {
  const map = JSON.parse(readFileSync(new URL(`../maps/${id}.json`, import.meta.url)));
  const solid = new Set(map.blocks.map(([x, y, z]) => `${x}|${y}|${z}`));
  const groundY = (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z);
    for (let y = 14; y >= 0; y--) if (solid.has(`${xi}|${y}|${zi}`)) return y + 1;
    return -10;
  };

  // спавны: не в стене (2 блока воздуха) и есть земля под ногами
  for (const [sx, sy, sz] of map.spawns) {
    const inWall = solid.has(`${Math.floor(sx)}|${Math.floor(sy)}|${Math.floor(sz)}`) ||
      solid.has(`${Math.floor(sx)}|${Math.floor(sy) + 1}|${Math.floor(sz)}`);
    const g = groundY(sx, sz);
    if (inWall || g === -10 || Math.abs(g - sy) > 0.5) {
      console.log(`FAIL ${id}: спавн (${sx},${sy},${sz}) inWall=${inWall} ground=${g}`);
      fail++;
    }
  }
  // точки оружия: над твёрдой землёй
  for (const w of map.weapons) {
    if (groundY(w.pos[0], w.pos[2]) === -10) { console.log(`FAIL ${id}: пикап над пропастью`, w.pos); fail++; }
  }

  // боты всех сложностей
  for (let d = 1; d <= 5; d++) {
    const entry = JSON.parse(readFileSync(new URL(`../ghosts/${id}_d${d}.json`, import.meta.url)));
    const r = decode(entry.data);
    let inWall = 0, overVoid = 0;
    for (const f of r.frames) {
      const bx = Math.floor(f.x), bz = Math.floor(f.z);
      if (solid.has(`${bx}|${Math.floor(f.y + 0.9)}|${bz}`)) inWall++;
      if (groundY(f.x, f.z) === -10) overVoid++;
    }
    const spawnDist = Math.hypot(r.frames[0].x - map.spawns[1][0], r.frames[0].z - map.spawns[1][2]);
    const status = (inWall || overVoid) ? 'FAIL' : 'ok';
    if (status === 'FAIL') fail++;
    console.log(`${status} ${id}_d${d}: в стенах=${inWall}, над пропастью=${overVoid}, старт от спавна2=${spawnDist.toFixed(1)}м`);
  }
}
console.log(fail ? `\nПРОВАЛОВ: ${fail}` : '\nВСЁ ЧИСТО');
process.exit(fail ? 1 : 0);
