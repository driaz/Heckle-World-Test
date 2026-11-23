import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Per-prop tweaks applied after normalising the GLB to unit height with its base at the origin.
// preRot: fix up the model's native orientation.
export const PROP_CFG = {
  pine: { file: 'pine.glb', preRot: [0, 0, 0] },
  bush: { file: 'bush.glb', preRot: [0, 0, 0] },
  coin: { file: 'coin.glb', preRot: [0, 0, 0] },
  // starYaw undoes the placement yaw (2.3) so one star point faces away from the reference camera
  spring: { file: 'spring.glb', preRot: [0, 0, 0], starYaw: -2.3 },
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

/**
 * Extra parts for the spring pad, in normalised prop space (unit height, base at y=0, centred on the Y axis):
 * a glossy red cap over the Meshy pad top (which has a 6-point star baked in) and a clean white five-pointed star.
 * Measured on the GLB: pad top face at y~0.968, old embossed star up to y=1.0, rim radius ~0.53.
 */
function springStarParts(cfg, envMap) {
  const red = new THREE.MeshStandardMaterial({ color: '#d9261f', roughness: 0.32, metalness: 0.0, envMap, envMapIntensity: 0.9 });
  const white = new THREE.MeshStandardMaterial({ color: '#fff7ea', roughness: 0.38, metalness: 0.0, envMap, envMapIntensity: 0.7 });
  const prof = [[0.528, 0.94], [0.522, 0.962], [0.508, 0.985], [0.475, 1.002], [0.43, 1.008], [0, 1.008]].map(([r, y]) => new THREE.Vector2(r, y));
  const cap = new THREE.LatheGeometry(prof, 40);
  const sh = new THREE.Shape();
  const R = 0.335, r = R * 0.47;
  for (let k = 0; k < 10; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 5, rad = k % 2 ? r : R;
    if (k) sh.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); else sh.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  sh.closePath();
  const star = new THREE.ExtrudeGeometry(sh, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.007, bevelSize: 0.008, bevelSegments: 2, curveSegments: 1 });
  star.rotateX(-Math.PI / 2);          // lie flat, first point toward -Z
  star.rotateY(cfg.starYaw || 0);
  star.translate(0, 1.016, 0);
  const I = new THREE.Matrix4();
  return [{ geometry: cap, material: red, matrix: I.clone() }, { geometry: star, material: white, matrix: I.clone() }];
}

/**
 * Painted gold coin faces for both sides (the Meshy coin has a faint "?" on one side only, and a flat mirror face
 * reflects a single sky direction, so it reads as flat orange). Yellow-to-amber gradient, embossed "?", diagonal glint;
 * the material stays glossy/metallic so the sky still reflects in it. Normalised prop space.
 */
function coinFaceParts(thick, envMap) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, 7); g.clip();
  const gr = g.createLinearGradient(40, 20, 216, 236);
  gr.addColorStop(0, '#ffe873'); gr.addColorStop(0.45, '#ffcb2e'); gr.addColorStop(1, '#f09c0c');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.lineWidth = 9; g.strokeStyle = 'rgba(214,126,4,0.55)'; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 26, 0, 7); g.stroke();
  g.lineWidth = 4; g.strokeStyle = 'rgba(255,244,170,0.7)'; g.beginPath(); g.arc(S / 2 + 2, S / 2 + 2, S / 2 - 26, 0.4, 2.2); g.stroke();
  g.font = '900 170px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#fff2a8'; g.fillText('?', S / 2 + 4, S / 2 + 12);
  g.fillStyle = '#c9740a'; g.fillText('?', S / 2, S / 2 + 8);
  g.save(); g.translate(S / 2, S / 2); g.rotate(-0.7); g.filter = 'blur(6px)';
  g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(-150, -62, 300, 26);
  g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(-150, -20, 300, 10);
  g.restore();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.22, metalness: 0.55, envMap, envMapIntensity: 0.7 });
  const geo = new THREE.CircleGeometry(0.43, 32);
  const z = thick / 2 + 0.006;
  const T = (zz, flip) => new THREE.Matrix4().makeRotationY(flip ? Math.PI : 0).setPosition(0, 0.5, zz);
  return [{ geometry: geo, material: mat, matrix: T(z, false) }, { geometry: geo, material: mat, matrix: T(-z, true) }];
}

export async function loadProps(base = './models/', { envMap = null } = {}) {
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
      if (name === 'coin' && status[name] === 'glb') {
        // glossy metallic gold: the Meshy map (orange with an embossed "?") tints the reflection
        // (map is a near-uniform orange, linear ~(0.91, 0.35, 0); green is lifted toward gold)
        o.material.map = null; o.material.color.set('#ffb224'); o.material.roughness = 0.22; o.material.metalness = 1.0;
        o.material.envMap = envMap; o.material.envMapIntensity = 0.85;
        o.material.emissive.setRGB(0.05, 0.03, 0.0);
      }
      if (name === 'spring' && status[name] === 'glb') { o.material.roughness = 0.5; o.material.envMap = envMap; o.material.envMapIntensity = 0.5; }
      tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      parts.push({ geometry: o.geometry, material: o.material, matrix: N.clone().multiply(o.matrixWorld) });
    });
    if (name === 'coin' && status[name] === 'glb') {
      for (const part of coinFaceParts(size.z * s, envMap)) { parts.push(part); tris += (part.geometry.index ? part.geometry.index.count : part.geometry.attributes.position.count) / 3; }
    }
    if (name === 'spring' && status[name] === 'glb') {
      for (const part of springStarParts(cfg, envMap)) {
        parts.push(part);
        tris += (part.geometry.index ? part.geometry.index.count : part.geometry.attributes.position.count) / 3;
      }
    }
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
