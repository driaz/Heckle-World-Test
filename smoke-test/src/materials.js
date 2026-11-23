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

// near-white mottled map: instance colour does the hue, this adds painterly blotches
function mottled(seed, { base = 235, spread = 30, blobs = 260, rmin = 4, rmax = 26, tint = [1, 1, 1] } = {}) {
  return canvasTex(256, (g, s) => {
    const rng = mulberry32(seed);
    g.fillStyle = `rgb(${base * tint[0]},${base * tint[1]},${base * tint[2]})`;
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < blobs; i++) {
      const v = base + (rng() - 0.5) * 2 * spread;
      const r = rmin + rng() * (rmax - rmin);
      const x = rng() * s, y = rng() * s;
      g.fillStyle = `rgba(${v * tint[0]},${v * tint[1]},${v * tint[2]},${0.25 + rng() * 0.4})`;
      for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
        g.beginPath(); g.ellipse(x + ox, y + oy, r, r * (0.5 + rng() * 0.6), rng() * 3, 0, 7); g.fill();
      }
    }
  });
}

function bumpNoise(seed, blobs = 500, rmax = 10) {
  return canvasTex(256, (g, s) => {
    const rng = mulberry32(seed);
    g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < blobs; i++) {
      const v = Math.floor(rng() * 255);
      const r = 1.5 + rng() * rmax;
      const x = rng() * s, y = rng() * s;
      g.fillStyle = `rgba(${v},${v},${v},0.35)`;
      for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
        g.beginPath(); g.arc(x + ox, y + oy, r, 0, 7); g.fill();
      }
    }
  }, false);
}

function grassTex(seed) {
  return canvasTex(512, (g, s) => {
    const rng = mulberry32(seed);
    g.fillStyle = 'rgb(214,226,196)'; g.fillRect(0, 0, s, s);
    const blob = (x, y, r, col) => { for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) { g.fillStyle = col; g.beginPath(); g.ellipse(x + ox, y + oy, r, r * 0.7, 0, 0, 7); g.fill(); } };
    g.filter = 'blur(10px)';
    for (let i = 0; i < 46; i++) { // big soft patches: sunlit yellow vs deep moss
      const warm = rng() < 0.5;
      blob(rng() * s, rng() * s, 26 + rng() * 60, warm ? `rgba(255,255,${120 + rng() * 50},0.62)` : `rgba(${80 + rng() * 30},${140 + rng() * 25},${70 + rng() * 30},0.62)`);
    }
    g.filter = 'blur(1px)';
    for (let i = 0; i < 1500; i++) { // short blade strokes
      const x = rng() * s, y = rng() * s, l = 4 + rng() * 9, a = -1.57 + (rng() - 0.5) * 1.2;
      const v = rng();
      g.strokeStyle = v < 0.5 ? `rgba(255,255,${190 + rng() * 60},${0.25 + rng() * 0.3})` : `rgba(${95 + rng() * 40},${140 + rng() * 40},${80 + rng() * 40},${0.25 + rng() * 0.3})`;
      g.lineWidth = 1.2 + rng() * 1.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    g.filter = 'none';
  });
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
  const grassMap = grassTex(11);
  const grassBump = bumpNoise(12, 700, 7);
  const stoneMap = mottled(21, { base: 222, spread: 42, blobs: 380, rmax: 18 });
  const stoneBump = bumpNoise(22, 420, 12);
  const wood = woodTex(31);

  const m = {
    grass: new THREE.MeshStandardMaterial({ map: grassMap, bumpMap: grassBump, bumpScale: 1.6, roughness: 0.82, metalness: 0 }),
    stone: new THREE.MeshStandardMaterial({ map: stoneMap, bumpMap: stoneBump, bumpScale: 1.2, roughness: 0.88, metalness: 0 }),
    dirt: new THREE.MeshStandardMaterial({ map: stoneMap, bumpMap: grassBump, bumpScale: 0.8, roughness: 0.95 }),
    core: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
    wood: new THREE.MeshStandardMaterial({ map: wood, bumpMap: stoneBump, bumpScale: 0.6, roughness: 0.7 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }),
    plain: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65 }),
    white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, emissive: 0x555555 }),
  };
  stylize(m.grass, { map: 'wp_.xz * 0.21 + wp_.y * 0.13', bump: 'wp_.xz * 0.8 + wp_.y * 0.5', edge: 0.34, topLift: 0.1 });
  stylize(m.stone, { map: 'vec2(wp_.x + wp_.z * 0.9, wp_.y + wp_.z * 0.35) * 0.33', bump: 'vec2(wp_.x + wp_.z * 0.9, wp_.y + wp_.z * 0.35) * 0.7', edge: 0.42, topLift: 0.1 });
  stylize(m.dirt, { map: 'wp_.xz * 0.27', bump: 'wp_.xz * 0.9', edge: 0.12, topLift: 0 });
  stylize(m.wood, { edge: 0.32, topLift: 0.06 });
  stylize(m.orange, { edge: 0.3, topLift: 0.08 });
  return m;
}

export function defineBatches(B, m) {
  const rb = (w, h, d, seg, r) => addLocal(new RoundedBoxGeometry(w, h, d, seg, r));
  B.define('grass', rb(1.05, 0.44, 1.05, 2, 0.14), m.grass);
  B.define('dirt', rb(1.08, 0.44, 1.08, 1, 0.05), m.dirt);
  B.define('fringe', rb(0.36, 0.5, 0.24, 2, 0.11), m.grass);
  B.define('brick', rb(0.975, 0.47, 0.32, 1, 0.06), m.stone);
  B.define('brickH', rb(0.475, 0.47, 0.32, 1, 0.06), m.stone);
  B.define('rock', rb(1, 1, 1, 1, 0.2), m.stone);
  B.define('step', rb(0.94, 0.3, 0.3, 1, 0.045), m.stone);
  B.define('slab', rb(1, 0.16, 1, 1, 0.06), m.stone);
  B.define('core', new THREE.BoxGeometry(1, 1, 1), m.core);
  B.define('post', rb(0.27, 1.0, 0.27, 1, 0.05), m.wood);
  B.define('rail', rb(1, 0.2, 0.11, 1, 0.045), m.wood);
  B.define('plank', rb(1, 0.13, 0.46, 1, 0.04), m.wood);
  B.define('beam', rb(0.16, 0.22, 1, 1, 0.05), m.wood);
  B.define('orange', rb(1, 1, 1, 2, 0.085), m.orange);
  B.define('rivet', new THREE.SphereGeometry(0.055, 10, 8), m.orange);
  B.define('pebble', new THREE.IcosahedronGeometry(0.5, 1), m.stone);
  B.define('moss', new THREE.IcosahedronGeometry(0.5, 1), m.grass, { castShadow: false });
  // flora
  const blade = new THREE.ConeGeometry(0.055, 0.5, 5, 1); blade.translate(0, 0.25, 0);
  B.define('blade', blade, m.leaf, { castShadow: false });
  const leaf = new THREE.SphereGeometry(0.5, 8, 6);
  B.define('leaf', leaf, m.leaf);
  const stem = new THREE.CylinderGeometry(0.012, 0.016, 1, 5); stem.translate(0, 0.5, 0);
  B.define('stem', stem, m.leaf, { castShadow: false });
  B.define('petal', new THREE.SphereGeometry(0.5, 8, 6), m.plain, { castShadow: false });
  // ramp arrow (tip toward -Z after rotate)
  const sh = new THREE.Shape();
  sh.moveTo(0, 0.42); sh.lineTo(0.42, 0.02); sh.lineTo(0.16, 0.02); sh.lineTo(0.16, -0.3);
  sh.lineTo(-0.16, -0.3); sh.lineTo(-0.16, 0.02); sh.lineTo(-0.42, 0.02); sh.closePath();
  const arrow = new THREE.ShapeGeometry(sh); arrow.rotateX(-Math.PI / 2);
  B.define('arrow', arrow, m.white, { castShadow: false });
}
