import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Per-prop tweaks applied after normalising the GLB to unit height with its base at the origin.
// preRot: fix up the model's native orientation.
export const PROP_CFG = {
  pine: { file: 'pine.glb', preRot: [0, 0, 0] },
  bush: { file: 'bush.glb', preRot: [0, 0, 0] },
  coin: { file: 'coin.glb', preRot: [0, 0, 0] },
  spring: { file: 'spring.glb', preRot: [0, 0, 0] },
  flag: { file: 'flag.glb', preRot: [0, Math.PI, 0] },
};

function placeholder(name) {
  const g = new THREE.Group();
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, ...o });
  if (name === 'pine') {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.3, 8), std('#8a5a32')); trunk.position.y = 0.15; g.add(trunk);
    [[0.42, 0.42, 0.42], [0.33, 0.36, 0.66], [0.22, 0.32, 0.86]].forEach(([r, h, y]) => {
      const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 10), std('#3fa33a')); c.position.y = y; g.add(c);
    });
  } else if (name === 'bush') {
    [[0, 0.4, 0, 0.42], [0.3, 0.3, 0.1, 0.3], [-0.3, 0.32, -0.05, 0.3], [0, 0.3, 0.3, 0.28]].forEach(([x, y, z, r]) => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), std('#4fae32')); s.position.set(x, y, z); g.add(s);
    });
  } else if (name === 'coin') {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.14, 24), std('#ffc21a', { metalness: 0.6, roughness: 0.3 }));
    c.rotation.x = Math.PI / 2; c.position.y = 0.5; g.add(c);
  } else if (name === 'spring') {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.12, 24), std('#8d98a8', { metalness: 0.5 })); base.position.y = 0.06; g.add(base);
    const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 16), std('#aab4c2', { metalness: 0.6 })); coil.position.y = 0.27; g.add(coil);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.5, 0.2, 24), std('#e23a36')); top.position.y = 0.5; g.add(top);
  } else if (name === 'flag') {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.2), std('#ddd')); b.position.y = 0.04; g.add(b);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 8), std('#f4f4f4')); p.position.y = 0.5; g.add(p);
    const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.42, -0.12); sh.lineTo(0, -0.26); sh.closePath();
    const f = new THREE.Mesh(new THREE.ShapeGeometry(sh), std('#e0352f', { side: THREE.DoubleSide })); f.position.set(0.015, 0.95, 0); g.add(f);
  }
  return g;
}

export async function loadProps(base = './models/') {
  const loader = new GLTFLoader();
  const out = {};
  const status = {};
  await Promise.all(Object.entries(PROP_CFG).map(async ([name, cfg]) => {
    let root;
    try {
      const gltf = await loader.loadAsync(base + cfg.file);
      root = gltf.scene;
      status[name] = 'glb';
    } catch (e) {
      root = placeholder(name);
      status[name] = 'placeholder';
    }
    // bake pre-rotation, then normalise: unit height, base centred on origin
    const wrap = new THREE.Group();
    root.rotation.set(...(status[name] === 'glb' ? cfg.preRot : [0, 0, 0]));
    wrap.add(root);
    wrap.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wrap);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const s = 1 / size.y;
    const N = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
    const parts = [];
    let tris = 0;
    wrap.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material.map) o.material.map.anisotropy = 4;
      if (name === 'coin' && status[name] === 'glb') { o.material.color.setRGB(1.0, 1.2, 0.72); o.material.roughness = 0.35; o.material.metalness = 0.0; }
      tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      parts.push({ geometry: o.geometry, material: o.material, matrix: N.clone().multiply(o.matrixWorld) });
    });
    out[name] = { parts, aspect: { x: size.x * s, z: size.z * s }, tris };
  }));
  return { props: out, status };
}

/** place: [{pos:Vector3, height, yaw, tilt?}] */
export function instanceProp(scene, prop, places, { castShadow = true } = {}) {
  if (!places.length) return;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
  for (const part of prop.parts) {
    const im = new THREE.InstancedMesh(part.geometry, part.material, places.length);
    places.forEach((p, i) => {
      e.set(p.tiltX || 0, p.yaw || 0, p.tiltZ || 0, 'YXZ'); q.setFromEuler(e);
      const s = p.height; sc.set(s * (p.wide || 1), s, s * (p.wide || 1));
      m.compose(p.pos, q, sc).multiply(part.matrix);
      im.setMatrixAt(i, m);
    });
    im.castShadow = castShadow; im.receiveShadow = true; im.frustumCulled = false;
    scene.add(im);
  }
}
