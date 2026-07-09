// Редактор скинов: цвета тела/пушек/эффектов с живым 3D-превью.
// Пишет тот же формат, что skins/default.json. Задел под донат-магазин.
import * as THREE from 'three';
import { buildWeaponModel } from './weapons.js';
import { Platform } from './platform.js';

const FIELDS = [
  { path: 'body.head', label: 'Голова', panel: 'skin-body' },
  { path: 'body.torso', label: 'Торс', panel: 'skin-body' },
  { path: 'body.arms', label: 'Руки', panel: 'skin-body' },
  { path: 'body.legs', label: 'Ноги', panel: 'skin-body' },
  { path: 'weapons.pistol.body', label: 'Корпус', panel: 'skin-pistol' },
  { path: 'weapons.pistol.grip', label: 'Рукоять', panel: 'skin-pistol' },
  { path: 'weapons.pistol.accent', label: 'Акцент', panel: 'skin-pistol' },
  { path: 'weapons.shotgun.body', label: 'Корпус', panel: 'skin-shotgun' },
  { path: 'weapons.shotgun.grip', label: 'Дерево', panel: 'skin-shotgun' },
  { path: 'weapons.shotgun.accent', label: 'Акцент', panel: 'skin-shotgun' },
  { path: 'weapons.railgun.body', label: 'Корпус', panel: 'skin-railgun' },
  { path: 'weapons.railgun.grip', label: 'Рукоять', panel: 'skin-railgun' },
  { path: 'weapons.railgun.accent', label: 'Свечение', panel: 'skin-railgun' },
  { path: 'tracer', label: 'Трассер', panel: 'skin-fx' },
  { path: 'railTracer', label: 'След рейла', panel: 'skin-fx' },
  { path: 'ghostTint', label: 'Оттенок призрака', panel: 'skin-fx' },
];

const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const set = (obj, path, v) => {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => (o[k] ??= {}), obj)[last] = v;
};

export function initSkinEditor(status) {
  const canvas = document.getElementById('skin-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#232a33');
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
  camera.position.set(0, 1.6, 4.2);
  camera.lookAt(0, 1, 0);
  scene.add(new THREE.AmbientLight('#bcd4e8', 0.8));
  const sun = new THREE.DirectionalLight('#fff4d6', 1.5);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(6, 0.2, 6),
    new THREE.MeshLambertMaterial({ color: '#7ec850' }));
  floor.position.y = -0.1;
  scene.add(floor);

  let skin = null;
  let defaultSkin = null;
  const preview = new THREE.Group();
  scene.add(preview);

  function rebuild() {
    preview.clear();
    // персонаж (большая голова — как в игре)
    const part = (w, h, d, color, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
        new THREE.MeshLambertMaterial({ color }));
      m.position.set(x, y, z);
      preview.add(m);
      return m;
    };
    const b = skin.body;
    part(0.55, 0.55, 0.55, b.head, 0, 1.43, 0);
    part(0.6, 0.55, 0.32, b.torso, 0, 0.88, 0);
    part(0.16, 0.5, 0.16, b.arms, -0.38, 1.05, 0);
    part(0.16, 0.5, 0.16, b.arms, 0.38, 1.05, 0);
    part(0.22, 0.6, 0.22, b.legs, -0.16, 0.3, 0);
    part(0.22, 0.6, 0.22, b.legs, 0.16, 0.3, 0);
    // пушки в ряд
    [0, 1, 2].forEach(id => {
      const w = buildWeaponModel(id, skin);
      w.scale.setScalar(1.15);
      w.position.set(-1.5 + id * 1.5, 0.45, 1.2);
      w.rotation.y = -0.5;
      preview.add(w);
    });
    // трассеры
    const tr = (color, y) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 2.4),
        new THREE.MeshBasicMaterial({ color }));
      m.position.set(1.6, y, 0);
      m.rotation.y = 0.4;
      preview.add(m);
    };
    tr(skin.tracer, 1.7);
    tr(skin.railTracer, 1.85);
  }

  function buildForm() {
    for (const p of ['skin-body', 'skin-pistol', 'skin-shotgun', 'skin-railgun', 'skin-fx'])
      document.getElementById(p).innerHTML = '';
    for (const f of FIELDS) {
      const row = document.createElement('div');
      row.className = 'crow';
      const input = document.createElement('input');
      input.type = 'color';
      input.value = get(skin, f.path);
      input.oninput = () => { set(skin, f.path, input.value); rebuild(); };
      row.append(Object.assign(document.createElement('span'), { textContent: f.label }), input);
      document.getElementById(f.panel).append(row);
    }
  }

  document.getElementById('btn-skin-save').onclick = async () => {
    await Platform.saveSkin(skin);
    status('Скин применён — увидишь в игре');
  };
  document.getElementById('btn-skin-reset').onclick = async () => {
    skin = JSON.parse(JSON.stringify(defaultSkin));
    await Platform.saveSkin(skin);
    buildForm();
    rebuild();
    status('Сброшено к стандарту');
  };

  function resize() {
    const w = canvas.parentElement.clientWidth - 240;
    const h = canvas.parentElement.clientHeight;
    if (w > 0 && h > 0) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }
  window.addEventListener('resize', resize);

  (async () => {
    defaultSkin = await (await fetch('skins/default.json')).json();
    skin = (await Platform.loadSkin()) ?? JSON.parse(JSON.stringify(defaultSkin));
    buildForm();
    rebuild();
    resize();
    (function loop() {
      requestAnimationFrame(loop);
      preview.rotation.y += 0.006;
      renderer.render(scene, camera);
    })();
  })();
}
