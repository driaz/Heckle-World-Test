import * as THREE from 'three';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// cheap 2D value noise
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
/** M * T(x,y,z) * R(rx,ry,rz) * S(sx,sy,sz) */
export function xf(M, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  _p.set(x, y, z); _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _s.set(sx, sy, sz);
  const m = new THREE.Matrix4().compose(_p, _q, _s);
  return M ? m.premultiply(M) : m;
}

const _c1 = new THREE.Color(), _c2 = new THREE.Color();
export function mixHex(a, b, t) {
  _c1.set(a); _c2.set(b);
  return _c1.clone().lerp(_c2, t);
}
export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

/** Collects instances per (geometry, material) class and emits InstancedMeshes. */
export class Batcher {
  constructor() { this.classes = new Map(); }
  define(name, geometry, material, opts = {}) {
    this.classes.set(name, { geometry, material, opts, mats: [], cols: [] });
  }
  add(name, matrix, color = 0xffffff) {
    const c = this.classes.get(name);
    if (!c) throw new Error('unknown batch class ' + name);
    c.mats.push(matrix);
    c.cols.push(color instanceof THREE.Color ? color : new THREE.Color(color));
  }
  build(scene) {
    let total = 0;
    for (const [name, c] of this.classes) {
      const n = c.mats.length;
      if (!n) continue;
      const mesh = new THREE.InstancedMesh(c.geometry, c.material, n);
      for (let i = 0; i < n; i++) { mesh.setMatrixAt(i, c.mats[i]); mesh.setColorAt(i, c.cols[i]); }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = c.opts.castShadow !== false;
      mesh.receiveShadow = c.opts.receiveShadow !== false;
      mesh.frustumCulled = false;
      mesh.name = 'batch:' + name;
      scene.add(mesh);
      total += n;
    }
    return total;
  }
}
