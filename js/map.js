// Карта: загрузка из JSON и постройка ОДНОГО merged-меша + воксельные коллизии.
// Никакой геометрии в коде — всё из maps/*.json (тот же формат будет писать редактор).
//
// Формат maps/*.json:
// {
//   "id": "arena01", "name": "...",
//   "palette": { "1": "#hex" | {"color": "#hex", "tex": "stone"}, ... },
//       tex — имя тайла из textures.js (или "grass_dirt": верх трава, бока земля);
//       строка "#hex" — легаси-формат старых UGC-карт, рендерится чистым цветом
//   "blocks": [[x, y, z, type], ...],               воксели, шаг сетки = 1 м
//   "spawns": [[x, y, z, yawDeg], [x, y, z, yawDeg]],
//   "weapons": [{ "type": 1|2, "pos": [x, y, z] }]  1 — дробовик, 2 — рейлган
// }

/** Нормализация записи палитры: строка или {color, tex} → {color, tex}. */
export function paletteEntry(palette, type) {
  const raw = palette?.[String(type)];
  if (!raw) return { color: '#ff00ff', tex: null };
  if (typeof raw === 'string') return { color: raw, tex: null };
  return { color: raw.color ?? '#ff00ff', tex: raw.tex ?? null };
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TILE, getAtlas, tileUV } from './textures.js';

export class GameMap {
  constructor(data) {
    this.data = data;
    this.solid = new Set();
    for (const [x, y, z] of data.blocks) this.solid.add(key(x, y, z));
    this.mesh = this._buildMesh();
    this.spawns = data.spawns.map(([x, y, z, yaw]) => ({
      pos: new THREE.Vector3(x, y, z),
      yaw: (yaw ?? 0) * Math.PI / 180,
    }));
    this.weaponSpots = data.weapons.map(w => ({
      type: w.type,
      pos: new THREE.Vector3(w.pos[0], w.pos[1], w.pos[2]),
    }));
  }

  static async load(id) {
    const res = await fetch(`maps/${id}.json`);
    if (!res.ok) throw new Error(`map load failed: ${id}`);
    return new GameMap(await res.json());
  }

  /** Занят ли воксель с целыми координатами (x,y,z — индексы сетки). */
  isSolid(x, y, z) {
    if (y < -2) return true; // страховочное дно
    return this.solid.has(key(x, y, z));
  }

  _buildMesh() {
    const geoms = [];
    const color = new THREE.Color();
    const jitter = mulberry32(12345); // детерминированная вариация тона
    for (const [x, y, z, type] of this.data.blocks) {
      // скрытые блоки (окружены со всех сторон) не рендерим
      if (this.isSolid(x + 1, y, z) && this.isSolid(x - 1, y, z) &&
          this.isSolid(x, y + 1, z) && this.isSolid(x, y - 1, z) &&
          this.isSolid(x, y, z + 1) && this.isSolid(x, y, z - 1)) continue;
      const g = new THREE.BoxGeometry(1, 1, 1);
      g.translate(x + 0.5, y + 0.5, z + 0.5);
      const entry = paletteEntry(this.data.palette, type);
      color.set(entry.color);
      const v = 0.92 + jitter() * 0.16;
      const c = color.clone().multiplyScalar(v);
      const count = g.attributes.position.count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      // UV на тайл атласа: грань 2 — верх, грань 3 — низ, остальные бока
      let topTile, sideTile, bottomTile;
      if (entry.tex === 'grass_dirt') {
        topTile = TILE.grass; sideTile = TILE.dirt; bottomTile = TILE.dirt;
      } else {
        topTile = sideTile = bottomTile = TILE[entry.tex] ?? TILE.plain;
      }
      const uv = g.attributes.uv;
      for (let f = 0; f < 6; f++) {
        const r = tileUV(f === 2 ? topTile : f === 3 ? bottomTile : sideTile);
        for (let vtx = 0; vtx < 4; vtx++) {
          const i = f * 4 + vtx;
          uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
        }
      }
      geoms.push(g);
    }
    const merged = mergeGeometries(geoms, false);
    geoms.forEach(g => g.dispose());
    // один материал с атласом = один draw call; transparent — ради тайла стекла
    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true, map: getAtlas(), transparent: true, alphaTest: 0.05,
    });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

/**
 * Скольжение AABB по вокселям. pos — центр НОГ, half — полуширина, height — рост.
 * Двигает по осям раздельно, возвращает { onGround, hitHead }.
 */
export function moveAABB(map, pos, vel, dt, half, height) {
  const res = { onGround: false, hitHead: false };
  // по каждой оси отдельно — классический воксельный свип
  for (const axis of ['x', 'z', 'y']) {
    const d = vel[axis] * dt;
    if (d === 0) continue;
    pos[axis] += d;
    const minX = Math.floor(pos.x - half), maxX = Math.floor(pos.x + half - 1e-4);
    const minY = Math.floor(pos.y), maxY = Math.floor(pos.y + height - 1e-4);
    const minZ = Math.floor(pos.z - half), maxZ = Math.floor(pos.z + half - 1e-4);
    let collided = false;
    outer:
    for (let x = minX; x <= maxX; x++)
      for (let y = minY; y <= maxY; y++)
        for (let z = minZ; z <= maxZ; z++)
          if (map.isSolid(x, y, z)) { collided = true; break outer; }
    if (!collided) continue;
    if (axis === 'y') {
      if (d < 0) { pos.y = Math.ceil(pos.y); res.onGround = true; }
      else { pos.y = Math.floor(pos.y + height) - height; res.hitHead = true; }
      vel.y = 0;
    } else if (axis === 'x') {
      pos.x = d < 0 ? Math.ceil(pos.x - half) + half : Math.floor(pos.x + half) - half;
      vel.x = 0;
    } else {
      pos.z = d < 0 ? Math.ceil(pos.z - half) + half : Math.floor(pos.z + half) - half;
      vel.z = 0;
    }
  }
  // проверка "стою на земле" даже без вертикального движения
  if (!res.onGround && vel.y <= 0) {
    const yBelow = Math.floor(pos.y - 0.02);
    const minX = Math.floor(pos.x - half), maxX = Math.floor(pos.x + half - 1e-4);
    const minZ = Math.floor(pos.z - half), maxZ = Math.floor(pos.z + half - 1e-4);
    for (let x = minX; x <= maxX && !res.onGround; x++)
      for (let z = minZ; z <= maxZ && !res.onGround; z++)
        if (map.isSolid(x, yBelow, z) && pos.y - (yBelow + 1) < 0.02) res.onGround = true;
  }
  return res;
}

/** Рейкаст по вокселям (DDA). Возвращает дистанцию до стены или maxDist. */
export function raycastVoxels(map, origin, dir, maxDist) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;
  let tMaxX = stepX > 0 ? (x + 1 - origin.x) * tDeltaX : stepX < 0 ? (origin.x - x) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - origin.y) * tDeltaY : stepY < 0 ? (origin.y - y) * tDeltaY : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - origin.z) * tDeltaZ : stepZ < 0 ? (origin.z - z) * tDeltaZ : Infinity;
  let t = 0;
  while (t <= maxDist) {
    if (map.isSolid(x, y, z)) return t;
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) { t = tMaxX; tMaxX += tDeltaX; x += stepX; }
    else if (tMaxY <= tMaxZ) { t = tMaxY; tMaxY += tDeltaY; y += stepY; }
    else { t = tMaxZ; tMaxZ += tDeltaZ; z += stepZ; }
  }
  return maxDist;
}

function key(x, y, z) { return x + '|' + y + '|' + z; }

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
