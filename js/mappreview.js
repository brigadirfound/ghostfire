// Мини-превью карты: рендер сверху в canvas из JSON (для карточек в меню).
import { paletteEntry } from './map.js';

const cache = {};

/** dataURL превью карты сверху. mapData можно передать напрямую (своя карта). */
export async function mapPreviewURL(mapId, mapData = null, px = 160) {
  const cacheable = mapId !== '__custom';
  if (cacheable && cache[mapId]) return cache[mapId];
  const data = mapData ?? await (await fetch(`maps/${mapId}.json`)).json();

  // верхний блок каждой колонны
  const cols = new Map(); // "x|z" -> {y, type}
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, maxY = 1;
  for (const [x, y, z, type] of data.blocks) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    maxY = Math.max(maxY, y);
    const k = `${x}|${z}`;
    const cur = cols.get(k);
    if (!cur || y > cur.y) cols.set(k, { y, type });
  }
  const w = maxX - minX + 1, d = maxZ - minZ + 1;
  const scale = Math.floor(px / Math.max(w, d)) || 1;
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = d * scale;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#12161c';
  ctx.fillRect(0, 0, c.width, c.height);
  for (const [k, v] of cols) {
    const [x, z] = k.split('|').map(Number);
    const e = paletteEntry(data.palette, v.type);
    // выше — светлее: читается рельеф
    const shade = 0.55 + 0.45 * (v.y / maxY);
    ctx.fillStyle = shadeColor(e.color, shade);
    ctx.fillRect((x - minX) * scale, (z - minZ) * scale, scale, scale);
  }
  // точки спавнов
  for (const [sx, , sz] of data.spawns ?? []) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect((sx - minX) * scale - 1, (sz - minZ) * scale - 1, scale + 2, scale + 2);
  }
  const url = c.toDataURL();
  if (cacheable) cache[mapId] = url;
  return url;
}

function shadeColor(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * k) | 0;
  const g = Math.min(255, ((n >> 8) & 255) * k) | 0;
  const b = Math.min(255, (n & 255) * k) | 0;
  return `rgb(${r},${g},${b})`;
}
