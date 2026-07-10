// Проверка: ни одна точка оружия не должна лежать внутри solid-блока.
// Запуск: node tools/check_pickups.mjs
import { readFileSync } from 'node:fs';

let fail = 0;
for (const id of ['arena01', 'arena02', 'arena03', 'arena04', 'arena05']) {
  const map = JSON.parse(readFileSync(new URL(`../maps/${id}.json`, import.meta.url)));
  const solid = new Set(map.blocks.map(([x, y, z]) => `${x}|${y}|${z}`));
  for (const w of map.weapons) {
    const [x, y, z] = w.pos;
    const cell = `${Math.floor(x)}|${Math.floor(y)}|${Math.floor(z)}`;
    if (solid.has(cell)) { console.log(`FAIL ${id}: пикап type=${w.type} (${x},${y},${z}) внутри блока ${cell}`); fail++; }
  }
}
console.log(fail ? `\nПРОВАЛОВ: ${fail}` : '\nВСЁ ЧИСТО');
process.exit(fail ? 1 : 0);
