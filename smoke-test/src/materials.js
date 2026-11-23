import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from './util.js';

function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

// world-space UVs (so neighbouring instances don't repeat the same texture patch) plus a painted
// "cushion" shade: every block darkens toward its own edges, read from a per-vertex normalised local position.
function stylize(mat, { map, bump, edge = 0.3, topLift = 0.06 } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aLocal;\nvarying vec3 vLocal;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
      vLocal = aLocal;
      #ifdef USE_INSTANCING
        vec4 wp_ = modelMatrix * instanceMatrix * vec4(position, 1.0);
      #else
        vec4 wp_ = modelMatrix * vec4(position, 1.0);
      #endif
      ${map ? `#ifdef USE_MAP
        vMapUv = ${map};
      #endif` : ''}
      ${bump ? `#ifdef USE_BUMPMAP
        vBumpMapUv = ${bump};
      #endif` : ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 al = abs(vLocal);
        float mx = max(al.x, max(al.y, al.z)), mn = min(al.x, min(al.y, al.z));
        float md = al.x + al.y + al.z - mx - mn;
        float e = smoothstep(0.45, 1.0, md);
        diffuseColor.rgb *= (1.0 - ${edge.toFixed(3)} * e * e) * (1.0 + ${topLift.toFixed(3)} * vLocal.y);
      }`);
  };
  mat.customProgramCacheKey = () => `sty-${map}-${bump}-${edge}-${topLift}`;
  return mat;
}
export function addLocal(geo) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox, c = bb.getCenter(new THREE.Vector3()), h = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const p = geo.attributes.position, arr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    arr[i * 3] = (p.getX(i) - c.x) / h.x; arr[i * 3 + 1] = (p.getY(i) - c.y) / h.y; arr[i * 3 + 2] = (p.getZ(i) - c.z) / h.z;
  }
  geo.setAttribute('aLocal', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function woodTex(seed) {
  return canvasTex(256, (g, s) => {
    const rng = mulberry32(seed);
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      const v = 190 + rng() * 65;
      g.strokeStyle = `rgba(${v},${v * 0.96},${v * 0.9},0.5)`;
      g.lineWidth = 1 + rng() * 3;
      const y = rng() * s;
      g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(s * 0.3, y + (rng() - 0.5) * 12, s * 0.6, y + (rng() - 0.5) * 12, s, y); g.stroke();
    }
  });
}

export function makeMaterials() {
  // run 2: no tiled detail textures or bump maps. Colour comes from the instance colour, form from soft edge shading.
  const wood = woodTex(31);
  const m = {
    stone: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0 }),
    wood: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.7 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32 }),
    plain: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }),
    white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, emissive: 0x555555 }),
  };
  stylize(m.stone, { edge: 0.25, topLift: 0.08 });
  stylize(m.wood, { edge: 0.3, topLift: 0.08 });
  stylize(m.orange, { edge: 0.28, topLift: 0.1 });
  return m;
}

export function defineBatches(B, m) {
  const rb = (w, h, d, seg, r) => addLocal(new RoundedBoxGeometry(w, h, d, seg, r));
  B.define('slab', rb(1, 0.16, 1, 2, 0.06), m.stone);
  B.define('post', rb(0.27, 1.0, 0.27, 1, 0.06), m.wood);
  B.define('rail', rb(1, 0.2, 0.11, 1, 0.05), m.wood);
  B.define('plank', rb(1, 0.13, 0.46, 1, 0.045), m.wood);
  B.define('beam', rb(0.16, 0.22, 1, 1, 0.05), m.wood);
  B.define('orange', rb(1, 1, 1, 3, 0.1), m.orange);
  B.define('rivet', new THREE.SphereGeometry(0.055, 6, 4), m.orange);
  B.define('pebble', new THREE.IcosahedronGeometry(0.5, 1), m.stone);
  // flora
  const blade = new THREE.ConeGeometry(0.055, 0.5, 5, 1); blade.translate(0, 0.25, 0);
  B.define('blade', blade, m.leaf, { castShadow: false });
  B.define('leaf', new THREE.SphereGeometry(0.5, 6, 4), m.leaf);
  const stem = new THREE.CylinderGeometry(0.012, 0.016, 1, 4); stem.translate(0, 0.5, 0);
  B.define('stem', stem, m.leaf, { castShadow: false });
  B.define('petal', new THREE.SphereGeometry(0.5, 5, 3), m.plain, { castShadow: false });
  // ramp arrow (tip toward -Z after rotate)
  const sh = new THREE.Shape();
  sh.moveTo(0, 0.42); sh.lineTo(0.42, 0.02); sh.lineTo(0.16, 0.02); sh.lineTo(0.16, -0.3);
  sh.lineTo(-0.16, -0.3); sh.lineTo(-0.16, 0.02); sh.lineTo(-0.42, 0.02); sh.closePath();
  const arrow = new THREE.ShapeGeometry(sh); arrow.rotateX(-Math.PI / 2);
  B.define('arrow', arrow, m.white, { castShadow: false });
}
