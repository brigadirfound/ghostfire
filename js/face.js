// Пиксель-арт на персонаже: маска/лицо на голове, одежда на торсе.
// Формат в скине: skin.art = { face: {size, pixels}, torso: {size, pixels} },
// pixels — массив size*size из "#hex" или null (null = базовый цвет части тела).
// Текстура собирается кодом через CanvasTexture — внешних файлов нет.
import * as THREE from 'three';

/** Собирает текстуру из пиксель-арта поверх базового цвета. null, если арта нет. */
export function artToTexture(art, baseColor) {
  if (!art || !Array.isArray(art.pixels) || !art.pixels.some(p => p)) return null;
  const size = art.size ?? 16;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);
  art.pixels.forEach((p, i) => {
    if (!p) return;
    ctx.fillStyle = p;
    ctx.fillRect(i % size, Math.floor(i / size), 1, 1);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;   // жёсткие пиксели — стиль игры
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Материалы для куба с артом на передней грани (-Z, индекс 5).
 * makeMat(hex) — фабрика базового материала (у призрака она даёт прозрачность/тинт).
 */
export function boxMaterials(makeMat, baseColor, art) {
  const tex = artToTexture(art, baseColor);
  if (!tex) return makeMat(baseColor);
  const side = makeMat(baseColor);
  const front = makeMat('#ffffff'); // белая база, чтобы цвет не перекрашивал текстуру
  front.map = tex;
  return [side, side, side, side, side, front];
}

/** Уменьшает произвольную картинку до пиксель-арта size×size. */
export function imageToArt(img, size = 16) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const pixels = [];
  for (let i = 0; i < size * size; i++) {
    const a = data[i * 4 + 3];
    if (a < 96) { pixels.push(null); continue; }
    const hex = '#' + [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]
      .map(v => v.toString(16).padStart(2, '0')).join('');
    pixels.push(hex);
  }
  return { size, pixels };
}

// ---------- готовые маски ----------
// Рисуются кодом на прозрачном холсте 16×16 и снимаются в массив пикселей.

function draw(fn) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d');
  const R = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
  fn(R);
  const data = ctx.getImageData(0, 0, 16, 16).data;
  const pixels = [];
  for (let i = 0; i < 256; i++) {
    if (data[i * 4 + 3] < 96) { pixels.push(null); continue; }
    pixels.push('#' + [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]
      .map(v => v.toString(16).padStart(2, '0')).join(''));
  }
  return { size: 16, pixels };
}

export const MASK_PRESETS = {
  'Череп': draw(R => {
    R(2, 1, 12, 11, '#e8e8e0');
    R(4, 12, 8, 3, '#e8e8e0');
    R(3, 4, 4, 4, '#111'); R(9, 4, 4, 4, '#111');   // глазницы
    R(7, 8, 2, 3, '#111');                            // нос
    R(4, 12, 1, 3, '#999'); R(6, 12, 1, 3, '#999'); R(8, 12, 1, 3, '#999'); R(10, 12, 1, 3, '#999'); // зубы
  }),
  'Робот': draw(R => {
    R(1, 2, 14, 12, '#8a95a5');
    R(2, 5, 12, 3, '#ff2222');                        // визор
    R(4, 10, 8, 2, '#333');                           // решётка
    R(5, 10, 1, 2, '#777'); R(7, 10, 1, 2, '#777'); R(9, 10, 1, 2, '#777');
    R(0, 6, 1, 4, '#556'); R(15, 6, 1, 4, '#556');    // уши
  }),
  'Ниндзя': draw(R => {
    R(0, 0, 16, 16, '#1a1d24');
    R(2, 5, 12, 3, '#f0d0b0');                        // прорезь
    R(3, 6, 2, 1, '#111'); R(11, 6, 2, 1, '#111');    // глаза
    R(0, 2, 16, 1, '#c02030');                        // повязка
  }),
  'Демон': draw(R => {
    R(1, 3, 14, 12, '#a01818');
    R(0, 0, 3, 4, '#e8c84a'); R(13, 0, 3, 4, '#e8c84a'); // рога
    R(3, 6, 3, 2, '#ffe040'); R(10, 6, 3, 2, '#ffe040'); // глаза
    R(5, 11, 6, 2, '#111');
    R(5, 10, 1, 1, '#fff'); R(10, 10, 1, 1, '#fff');  // клыки
  }),
  'Смайл': draw(R => {
    R(1, 1, 14, 14, '#ffd935');
    R(4, 5, 2, 3, '#111'); R(10, 5, 2, 3, '#111');
    R(3, 10, 1, 1, '#111'); R(12, 10, 1, 1, '#111');
    R(4, 11, 8, 1, '#111');
  }),
  'Клоун': draw(R => {
    R(2, 2, 12, 12, '#f0f0f0');
    R(0, 0, 4, 4, '#30a030'); R(12, 0, 4, 4, '#30a030'); R(6, 0, 4, 3, '#30a030'); // волосы
    R(4, 6, 2, 2, '#2040c0'); R(10, 6, 2, 2, '#2040c0');
    R(7, 8, 2, 2, '#e02020');                          // нос
    R(4, 11, 8, 2, '#e02020');                         // рот
  }),
};
