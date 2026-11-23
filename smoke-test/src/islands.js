import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Island blocks + moss caps come from Blender (blender/build_islands.py): rounded, bevelled meshes with vertex-colour
 * albedo and a Cycles-baked lighting texture. The GLB stores the bake as base colour; here it becomes the lightMap
 * (sky visibility + bounce + a soft share of the sun) and the aoMap (so real-time ambient is occluded in crevices too).
 */
export async function loadIslands(scene, islands, { lightMapIntensity = Math.PI, base = './models/islands/', baked = true } = {}) {
  const loader = new GLTFLoader();
  const out = {};
  let tris = 0;
  await Promise.all(Object.entries(islands).map(async ([name, isl]) => {
    const g = await loader.loadAsync(`${base}isl_${name}.glb`);
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      const lm = o.material.map;
      lm.channel = 0; lm.anisotropy = 4;
      const moss = /moss/.test(o.material.name);
      o.material = new THREE.MeshStandardMaterial({
        name: o.material.name, vertexColors: true, lightMap: lm, lightMapIntensity, aoMap: lm, aoMapIntensity: 0.9,
        roughness: moss ? 0.9 : 0.48, metalness: 0, envMapIntensity: moss ? 0.15 : 0.3,
      });
      if (!baked) { o.material.lightMap = null; o.material.aoMap = null; } // ?lm=0 A/B: same meshes without the Blender bake
      o.castShadow = o.receiveShadow = true;
      o.frustumCulled = false;
      tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    });
    g.scene.matrixAutoUpdate = false;
    g.scene.matrix.copy(isl.M);
    g.scene.name = 'island:' + name;
    scene.add(g.scene);
    out[name] = g.scene;
  }));
  return { islands: out, tris };
}

/** A few small hazy islands far behind the scene: one low-poly Blender-baked island instanced, distance fog does the haze. */
export async function addBackgroundIslands(scene, place, fov, base = './models/islands/') {
  const g = await new GLTFLoader().loadAsync(`${base}isl_BG.glb`);
  const pxToWorld = (d) => (2 * d * Math.tan((fov * Math.PI) / 360)) / 941;
  // [refX, refY, distance, widthPx, yaw]
  const defs = [[62, 318, 300, 92, -0.5], [912, 212, 330, 96, -0.75], [1642, 272, 310, 62, -0.4], [42, 548, 290, 80, -0.65]];
  const parts = [];
  g.scene.traverse((o) => { if (o.isMesh) parts.push(o); });
  const tree = new THREE.ConeGeometry(0.5, 1, 7); tree.translate(0, 0.5, 0);
  const treeMat = new THREE.MeshStandardMaterial({ color: '#3f9a3a', roughness: 0.9 });
  const treeIM = new THREE.InstancedMesh(tree, treeMat, defs.length * 6);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  let tris = 0, ti = 0;
  for (const part of parts) {
    const lm = part.material.map; lm.channel = 0;
    const moss = /moss/.test(part.material.name);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, lightMap: lm, lightMapIntensity: Math.PI, aoMap: lm, roughness: moss ? 0.92 : 0.6, envMapIntensity: 0.2 });
    const im = new THREE.InstancedMesh(part.geometry, mat, defs.length);
    defs.forEach(([sx, sy, d, w, yaw], i) => {
      const s = (w * pxToWorld(d)) / 4.3; // the BG island is ~4.3 units across its diagonal
      e.set(0, yaw, 0); q.setFromEuler(e);
      m.compose(place(sx, sy, d), q, sc.set(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-1.5, 0, -1.5));
      im.setMatrixAt(i, m);
    });
    im.frustumCulled = false;
    scene.add(im);
    tris += ((part.geometry.index ? part.geometry.index.count : part.geometry.attributes.position.count) / 3) * defs.length;
  }
  defs.forEach(([sx, sy, d, w, yaw], i) => {
    const s = (w * pxToWorld(d)) / 4.3;
    e.set(0, yaw, 0); q.setFromEuler(e);
    const M = new THREE.Matrix4().compose(place(sx, sy, d), q, sc.set(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-1.5, 0, -1.5));
    // two little stacked-cone pines per island
    for (const [x, z, h] of [[0.8 + (i % 2) * 0.5, 1.0, 1.5], [2.1, 1.7 - (i % 3) * 0.4, 1.15]]) {
      for (const [k, r] of [[0, 0.62], [0.36, 0.46], [0.68, 0.3]]) {
        m.makeTranslation(x, k * h, z).multiply(new THREE.Matrix4().makeScale(r * h * 1.3, h * 0.55, r * h * 1.3)).premultiply(M);
        treeIM.setMatrixAt(ti++, m);
      }
    }
  });
  treeIM.count = ti; treeIM.frustumCulled = false;
  scene.add(treeIM);
  return { tris };
}
