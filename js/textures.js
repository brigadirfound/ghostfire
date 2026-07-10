// Процедурный атлас текстур блоков: 16×16 тайлы в одном Canvas 4×4 (64×64).
// Рисуется кодом при старте, NearestFilter — жёсткие пиксели.
// Тайлы нейтральных тонов: цвет из палитры карты умножается сверху (тонировка),
// поэтому один тайл обслуживает любые расцветки. Один атлас = один draw call.
import * as THREE from 'three';

export const TILE = {
  plain: 0,     // чистый белый — фолбэк для блоков без текстуры (старые UGC-карты)
  stone: 1,
  brick: 2,
  planks: 3,
  grass: 4,     // верх травы (grass_dirt: верх grass, бока/низ dirt)
  dirt: 5,
  sand: 6,
  metal: 7,     // рифлёный металл
  crate: 8,     // ящик с окантовкой
  concrete: 9,  // бетон с трещинами
  neon: 10,     // неон-панель
  glass: 11,    // полупрозрачное стекло
};

const GRID = 4;       // 4×4 тайлов
const TS = 16;        // тайл 16 px
let atlasCanvas = null;
let atlasTexture = null;

function rng(seed) {
  let a = seed | 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function buildAtlasCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = GRID * TS;
  const ctx = c.getContext('2d');
  const at = (i) => [(i % GRID) * TS, Math.floor(i / GRID) * TS];
  const px = (ox, oy) => (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(ox + x, oy + y, w, h); };

  const tile = (i, fn) => {
    const [ox, oy] = at(i);
    ctx.save();
    fn(px(ox, oy), rng(1000 + i));
    ctx.restore();
  };

  // plain — чистый белый
  tile(TILE.plain, (P) => P(0, 0, 16, 16, '#ffffff'));

  // stone — светло-серые пятна
  tile(TILE.stone, (P, r) => {
    P(0, 0, 16, 16, '#c2c6cc');
    for (let i = 0; i < 14; i++) P((r() * 16) | 0, (r() * 16) | 0, 1 + (r() * 3 | 0), 1 + (r() * 2 | 0), '#a8adb5');
    for (let i = 0; i < 6; i++) P((r() * 16) | 0, (r() * 16) | 0, 1 + (r() * 2 | 0), 1, '#d8dce2');
  });

  // brick — кирпичи со швами, смещение рядов
  tile(TILE.brick, (P) => {
    P(0, 0, 16, 16, '#9a948c'); // раствор
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? 4 : 0;
      for (let col = -1; col < 3; col++) P(off + col * 8 + 1, row * 4 + 1, 7, 3, '#cfc6ba');
    }
  });

  // planks — горизонтальные доски с волокнами
  tile(TILE.planks, (P, r) => {
    P(0, 0, 16, 16, '#d6c9b2');
    for (let row = 0; row < 4; row++) {
      P(0, row * 4, 16, 1, '#a89878');
      for (let i = 0; i < 3; i++) P((r() * 15) | 0, row * 4 + 1 + (r() * 3 | 0), 2 + (r() * 3 | 0), 1, '#c4b599');
    }
    P(4, 6, 1, 1, '#8a7a5c'); P(11, 13, 1, 1, '#8a7a5c'); // сучки
  });

  // grass — шумная светлая (тонируется зелёным)
  tile(TILE.grass, (P, r) => {
    P(0, 0, 16, 16, '#d2d8c8');
    for (let i = 0; i < 22; i++) P((r() * 16) | 0, (r() * 16) | 0, 1, 1 + (r() * 2 | 0), '#b8c2a4');
    for (let i = 0; i < 10; i++) P((r() * 16) | 0, (r() * 16) | 0, 1, 1, '#e4ead8');
  });

  // dirt — земля с камешками
  tile(TILE.dirt, (P, r) => {
    P(0, 0, 16, 16, '#cbb89e');
    for (let i = 0; i < 16; i++) P((r() * 16) | 0, (r() * 16) | 0, 1 + (r() * 2 | 0), 1, '#b09a7c');
    for (let i = 0; i < 5; i++) P((r() * 16) | 0, (r() * 16) | 0, 2, 1, '#e0d2ba');
  });

  // sand — мелкие точки
  tile(TILE.sand, (P, r) => {
    P(0, 0, 16, 16, '#eee4c8');
    for (let i = 0; i < 20; i++) P((r() * 16) | 0, (r() * 16) | 0, 1, 1, '#d8cba8');
    for (let i = 0; i < 8; i++) P((r() * 16) | 0, (r() * 16) | 0, 1, 1, '#f8f0dc');
  });

  // metal — рифлёные горизонтальные полосы + заклёпки
  tile(TILE.metal, (P) => {
    P(0, 0, 16, 16, '#c8ccd2');
    for (let row = 0; row < 4; row++) {
      P(0, row * 4, 16, 1, '#eef1f5');
      P(0, row * 4 + 3, 16, 1, '#9aa0a8');
    }
    P(1, 1, 1, 1, '#788088'); P(14, 1, 1, 1, '#788088');
    P(1, 14, 1, 1, '#788088'); P(14, 14, 1, 1, '#788088');
  });

  // crate — доски + тёмная окантовка + диагональ
  tile(TILE.crate, (P, r) => {
    P(0, 0, 16, 16, '#d6c9b2');
    for (let row = 1; row < 4; row++) P(2, row * 4, 12, 1, '#b3a284');
    P(0, 0, 16, 2, '#94825f'); P(0, 14, 16, 2, '#94825f');
    P(0, 0, 2, 16, '#94825f'); P(14, 0, 2, 16, '#94825f');
    for (let i = 0; i < 12; i++) P(2 + i, 2 + i, 1, 1, '#a89468'); // диагональ
    void r;
  });

  // concrete — бетон с трещинами и подтёками
  tile(TILE.concrete, (P, r) => {
    P(0, 0, 16, 16, '#c9c9c6');
    let cx = 3, cy = 0;
    for (let i = 0; i < 14 && cy < 16; i++) { P(cx, cy, 1, 1, '#8f8f8c'); cy++; cx += (r() * 3 | 0) - 1; }
    for (let i = 0; i < 6; i++) P((r() * 16) | 0, (r() * 16) | 0, 2, 1 + (r() * 2 | 0), '#b8b8b4');
    P(10, 12, 4, 3, '#bebebb');
  });

  // neon — тёмная рамка, светящаяся сетка (тонируется цветом палитры)
  tile(TILE.neon, (P) => {
    P(0, 0, 16, 16, '#3a3a42');
    P(1, 1, 14, 14, '#ffffff');
    P(3, 3, 10, 10, '#4a4a54');
    P(7, 3, 2, 10, '#ffffff'); P(3, 7, 10, 2, '#ffffff');
  });

  // glass — полупрозрачное с бликами (единственный тайл с альфой)
  tile(TILE.glass, (P) => {
    const [ox, oy] = at(TILE.glass);
    ctx.clearRect(ox, oy, 16, 16);
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.fillRect(ox, oy, 16, 16);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(ox, oy, 16, 1); ctx.fillRect(ox, oy + 15, 16, 1);
    ctx.fillRect(ox, oy, 1, 16); ctx.fillRect(ox + 15, oy, 1, 16);
    for (let i = 0; i < 6; i++) { ctx.fillRect(ox + 3 + i, oy + 9 - i, 1, 1); ctx.fillRect(ox + 7 + i, oy + 12 - i, 1, 1); }
    void P;
  });

  return c;
}

export function getAtlasCanvas() {
  atlasCanvas ??= buildAtlasCanvas();
  return atlasCanvas;
}

export function getAtlas() {
  if (!atlasTexture) {
    atlasTexture = new THREE.CanvasTexture(getAtlasCanvas());
    atlasTexture.magFilter = THREE.NearestFilter;
    atlasTexture.minFilter = THREE.NearestFilter;
    atlasTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return atlasTexture;
}

/** UV-прямоугольник тайла (с учётом flipY у CanvasTexture). */
export function tileUV(index) {
  const col = index % GRID, row = Math.floor(index / GRID);
  const s = 1 / GRID, pad = 0.001; // паддинг от кровотечения соседних тайлов
  return {
    u0: col * s + pad, v0: 1 - (row + 1) * s + pad,
    u1: (col + 1) * s - pad, v1: 1 - row * s - pad,
  };
}

/** Превью тайла с тонировкой для редактора: маленький canvas → dataURL. */
export function tilePreviewURL(texName, color, size = 34) {
  const src = getAtlasCanvas();
  const idx = TILE[texName] ?? TILE.plain;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(src, (idx % GRID) * TS, Math.floor(idx / GRID) * TS, TS, TS, 0, 0, size, size);
  return c.toDataURL();
}
