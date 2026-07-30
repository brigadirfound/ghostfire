// Кисти от первого лица. Вынесены из player.js, чтобы стенд позы вьюмодели и
// игра строили одну и ту же геометрию.
import * as THREE from 'three';

// Базовый разворот кистей. Без него предплечье шло строго вдоль ствола и рука
// выглядела бруском: теперь она приходит снизу-сбоку под ~45°, как у живого
// хвата. y разводит руки наружу, x опускает локоть, z доворачивает кулак.
export const HAND_REST = Object.freeze({
  right: { x: 0.5, y: 0.34, z: -0.16 },
  left: { x: 0.58, y: -0.46, z: 0.18 },
  // Пистолет держат одной рукой и ближе к оси прицеливания: сильный разворот
  // под двуручный хват делал кисть вывернутой.
  rightOneHanded: { x: 0.34, y: 0.16, z: -0.06 },
});

// Кулак на 0.3 м от глаза занимал треть кадра — кисти уменьшены и отодвинуты.
export const HAND_SCALE = Object.freeze({ right: 0.78, left: 0.72 });

/** Маленький кулак + манжета + предплечье, цвета кожи/рукава скина. */
export function buildHand(skin) {
  const g = new THREE.Group();
  const skinMat = new THREE.MeshLambertMaterial({ color: skin.body.arms });
  const sleeveMat = new THREE.MeshLambertMaterial({ color: skin.body.torso });
  // яркая полоска цветом трассера — чтобы кисть не сливалась с тёмными
  // пушками/скинами (Пустота и т.п.), где кожа/торс почти чёрные
  const trimMat = new THREE.MeshBasicMaterial({ color: skin.tracer });
  const fist = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.22), skinMat);
  fist.position.set(0, 0, 0.03);
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.16), sleeveMat);
  sleeve.position.set(0, -0.03, 0.21);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.035, 0.05), trimMat);
  trim.position.set(0, 0.055, 0.15);
  // Предплечье: без него кисть читалась обрубком, торчащим вдоль ствола.
  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.34), sleeveMat);
  forearm.position.set(0, -0.05, 0.44);
  fist.castShadow = sleeve.castShadow = forearm.castShadow = true;
  g.add(fist, sleeve, trim, forearm);
  return g;
}
