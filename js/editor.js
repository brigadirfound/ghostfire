// Редактор карт GHOSTFIRE. Пишет тот же JSON, что maps/*.json.
// ЛКМ — действие инструмента, ПКМ — вращение камеры (OrbitControls).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import LZString from 'lz-string';
import { GameMap, paletteEntry } from './map.js';
import { Platform } from './platform.js';
import { initSkinEditor } from './skin-editor.js';
import { tilePreviewURL } from './textures.js';

const DEFAULT_PALETTE = {
  1: { color: '#7ec850', tex: 'grass_dirt' },
  2: { color: '#8a8f98', tex: 'stone' },
  3: { color: '#d98f33', tex: 'crate' },
  4: { color: '#c0563e', tex: 'brick' },
  5: { color: '#3f7fd4', tex: 'metal' },
  6: { color: '#e8c84a', tex: 'sand' },
  7: { color: '#4a5058', tex: 'concrete' },
  8: { color: '#e8e8e8', tex: 'glass' },
};

const status = (msg, ok = true) => {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.style.color = ok ? '#8f9' : '#f88';
  clearTimeout(status._t);
  status._t = setTimeout(() => { el.textContent = ''; }, 4000);
};

// ---------- вкладки ----------
const panels = { map: document.getElementById('panel-map'), skin: document.getElementById('panel-skin') };
const tabs = { map: document.getElementById('tab-map'), skin: document.getElementById('tab-skin') };
for (const name of ['map', 'skin']) {
  tabs[name].onclick = () => {
    for (const n of ['map', 'skin']) {
      panels[n].classList.toggle('hidden', n !== name);
      tabs[n].classList.toggle('active', n === name);
    }
    window.dispatchEvent(new Event('resize'));
  };
}

// ---------- сцена ----------
const canvas = document.getElementById('map-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#7ec8e8');
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
camera.position.set(34, 26, 34);
const controls = new OrbitControls(camera, canvas);
controls.target.set(12, 0, 12);
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
controls.update();

scene.add(new THREE.AmbientLight('#bcd4e8', 0.75));
const sun = new THREE.DirectionalLight('#fff4d6', 1.6);
sun.position.set(40, 45, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
sun.shadow.camera.far = 150;
scene.add(sun);
const grid = new THREE.GridHelper(64, 64, '#446', '#335');
grid.position.set(0, 0.01, 0);
scene.add(grid);

function resize() {
  const w = canvas.clientWidth || canvas.parentElement.clientWidth - 240;
  const h = canvas.clientHeight || canvas.parentElement.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------- данные карты ----------
const ed = {
  blocks: new Map(),          // "x|y|z" -> type
  palette: { ...DEFAULT_PALETTE },
  spawns: [null, null],       // [x, y, z, yawDeg]
  weapons: [],                // { type, pos: [x,y,z] }
  tool: 'place',
  blockType: 2,
  mesh: null,
};
const key = (x, y, z) => `${x}|${y}|${z}`;

function newMap(size = 24) {
  ed.blocks.clear();
  ed.spawns = [null, null];
  ed.weapons = [];
  for (let x = 0; x < size; x++)
    for (let z = 0; z < size; z++) {
      ed.blocks.set(key(x, 0, z), 1);
      if (x === 0 || z === 0 || x === size - 1 || z === size - 1) {
        ed.blocks.set(key(x, 1, z), 2);
        ed.blocks.set(key(x, 2, z), 2);
      }
    }
  controls.target.set(size / 2, 0, size / 2);
  rebuild();
}

function toData() {
  return {
    id: 'custom',
    name: 'Своя карта',
    palette: ed.palette,
    blocks: [...ed.blocks.entries()].map(([k, t]) => {
      const [x, y, z] = k.split('|').map(Number);
      return [x, y, z, t];
    }),
    spawns: ed.spawns.filter(Boolean),
    weapons: ed.weapons,
  };
}

function fromData(data) {
  ed.blocks.clear();
  for (const [x, y, z, t] of data.blocks) ed.blocks.set(key(x, y, z), t);
  ed.palette = { ...DEFAULT_PALETTE, ...data.palette };
  ed.spawns = [data.spawns?.[0] ?? null, data.spawns?.[1] ?? null];
  ed.weapons = (data.weapons ?? []).map(w => ({ type: w.type, pos: [...w.pos] }));
  buildPalette();
  rebuild();
}

// ---------- рендер карты и маркеров ----------
const markers = new THREE.Group();
scene.add(markers);

function rebuild() {
  if (ed.mesh) { scene.remove(ed.mesh); ed.mesh.geometry.dispose(); }
  ed.mesh = null;
  if (ed.blocks.size) {
    const gm = new GameMap({ ...toData(), spawns: [], weapons: [] });
    ed.mesh = gm.mesh;
    scene.add(ed.mesh);
  }
  markers.clear();
  ed.spawns.forEach((s, i) => {
    if (!s) return;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 1.8, 0.7),
      new THREE.MeshLambertMaterial({ color: i === 0 ? '#33ddff' : '#ff5533', transparent: true, opacity: 0.65 }));
    m.position.set(s[0], s[1] + 0.9, s[2]);
    markers.add(m);
  });
  for (const w of ed.weapons) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.3, 0.6),
      new THREE.MeshLambertMaterial({ color: w.type === 1 ? '#dd3322' : '#33ddff' }));
    m.position.set(w.pos[0], w.pos[1] + 0.3, w.pos[2]);
    markers.add(m);
  }
}

// ---------- инструменты ----------
document.querySelectorAll('.tool').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ed.tool = btn.dataset.tool;
  };
});

function buildPalette() {
  const pal = document.getElementById('palette');
  pal.innerHTML = '';
  for (const t of Object.keys(ed.palette)) {
    const e = paletteEntry(ed.palette, t);
    const d = document.createElement('div');
    d.className = 'pal' + (Number(t) === ed.blockType ? ' active' : '');
    // превью: тайл атласа с тонировкой цветом палитры
    const texName = e.tex === 'grass_dirt' ? 'grass' : e.tex;
    if (texName) {
      d.style.background = `url(${tilePreviewURL(texName, e.color)})`;
      d.style.backgroundSize = 'cover';
      d.style.imageRendering = 'pixelated';
    } else {
      d.style.background = e.color;
    }
    d.title = e.tex ?? 'цвет';
    d.onclick = () => {
      ed.blockType = Number(t);
      buildPalette();
      if (!ed.tool.startsWith('place')) document.querySelector('[data-tool=place]').click();
    };
    pal.append(d);
  }
}

// ---------- клики по сцене ----------
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let downPos = null;
canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) downPos = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !downPos) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  downPos = null;
  if (moved > 5) return; // это был драг камеры
  handleClick(e);
});

function handleClick(e) {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);

  let point = null, normal = null;
  if (ed.mesh) {
    const hit = raycaster.intersectObject(ed.mesh)[0];
    if (hit) { point = hit.point; normal = hit.face.normal; }
  }
  if (!point) {
    const p = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, p)) { point = p; normal = new THREE.Vector3(0, 1, 0); }
  }
  if (!point) return;

  const cellOn = point.clone().addScaledVector(normal, 0.5).floor();   // куда ставить
  const cellIn = point.clone().addScaledVector(normal, -0.5).floor();  // по чему кликнули

  switch (ed.tool) {
    case 'place':
      if (cellOn.y < 0 || cellOn.y > 14) return;
      ed.blocks.set(key(cellOn.x, cellOn.y, cellOn.z), ed.blockType);
      break;
    case 'erase':
      ed.blocks.delete(key(cellIn.x, cellIn.y, cellIn.z));
      break;
    case 'spawn0':
    case 'spawn1': {
      const i = ed.tool === 'spawn0' ? 0 : 1;
      ed.spawns[i] = [cellOn.x + 0.5, cellOn.y, cellOn.z + 0.5, 0];
      break;
    }
    case 'weapon1':
    case 'weapon2': {
      const type = ed.tool === 'weapon1' ? 1 : 2;
      // клик по существующей точке — удалить
      const idx = ed.weapons.findIndex(w =>
        Math.abs(w.pos[0] - (cellOn.x + 0.5)) < 0.6 && Math.abs(w.pos[2] - (cellOn.z + 0.5)) < 0.6);
      if (idx >= 0) ed.weapons.splice(idx, 1);
      else ed.weapons.push({ type, pos: [cellOn.x + 0.5, cellOn.y + 0.6, cellOn.z + 0.5] });
      break;
    }
  }
  rebuild();
}

// ---------- кнопки ----------
document.getElementById('btn-new').onclick = () => { newMap(24); status('Новая карта 24×24'); };
document.getElementById('btn-load1').onclick = () => loadBuiltin('arena01');
document.getElementById('btn-load2').onclick = () => loadBuiltin('arena02');
async function loadBuiltin(id) {
  const data = await (await fetch(`maps/${id}.json`)).json();
  fromData(data);
  const s = data.spawns?.[0];
  if (s) controls.target.set(s[0], 0, s[2]);
  status(`Загружена ${id}`);
}

document.getElementById('btn-export').onclick = () => {
  document.getElementById('code-io').value =
    LZString.compressToEncodedURIComponent(JSON.stringify(toData()));
  status('Код в поле выше — копируй и делись');
};
document.getElementById('btn-import').onclick = () => {
  try {
    const raw = document.getElementById('code-io').value.trim();
    const json = LZString.decompressFromEncodedURIComponent(raw);
    const data = JSON.parse(json);
    if (!Array.isArray(data.blocks)) throw new Error('no blocks');
    fromData(data);
    status('Карта импортирована');
  } catch { status('Не удалось прочитать код', false); }
};
document.getElementById('btn-download').onclick = () => {
  const blob = new Blob([JSON.stringify(toData())], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mymap.json';
  a.click();
  URL.revokeObjectURL(a.href);
};
document.getElementById('btn-save').onclick = async () => {
  if (!ed.spawns[0] || !ed.spawns[1]) { status('Расставь оба спавна (🔵 и 🔴)', false); return; }
  if (!ed.weapons.length) { status('Поставь хотя бы одну точку оружия', false); return; }
  await Platform.saveCustomMap(toData());
  status('Сохранено! В игре появилась «Своя карта»');
};

// ---------- старт ----------
(async () => {
  const saved = await Platform.loadCustomMap();
  if (saved) fromData(saved); else newMap(24);
  buildPalette();
  resize();
  initSkinEditor(status);
  (function loop() {
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  })();
})();
