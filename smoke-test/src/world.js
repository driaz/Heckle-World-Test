import * as THREE from 'three';
import { mulberry32, vnoise, xf, mixHex, pick } from './util.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const WARM = ['#d39a5e', '#c4864a', '#b87840', '#dcac6e', '#ad7040', '#cb9054', '#e2b87e', '#c07c42'];
const GREY = ['#b3a898', '#a59a88', '#bdb3a2', '#9d9282'];
const STEP = ['#cdbd9d', '#bfae8e', '#d6c8aa', '#c4b392'];
const WOOD = ['#c98b4b', '#b97a3c', '#d39a58', '#c08040'];
const PETAL = ['#ffffff', '#ffffff', '#ffe46b', '#86d4ff', '#ff9fcd', '#ffb655'];
const BLADE = ['#7cc52e', '#8fd13a', '#62b026', '#9ad943'];

export function makeIsland({ origin, anchor = [0, 0], yaw = 0, scale = 1 }) {
  const M = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z)
    .multiply(new THREE.Matrix4().makeRotationY(yaw))
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
    .multiply(new THREE.Matrix4().makeTranslation(-anchor[0], 0, -anchor[1]));
  const cells = new Map();
  return {
    M, cells, yaw, scale,
    get(i, j) { return cells.get(i + ',' + j); },
    set(i, j, h = 0, type = 'grass') { cells.set(i + ',' + j, { i, j, h, type }); },
    del(i, j) { cells.delete(i + ',' + j); },
    rect(i0, j0, i1, j1, h = 0, type = 'grass') {
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) this.set(i, j, h, type);
    },
    type(list, type) { for (const [i, j] of list) { const c = this.get(i, j); if (c) c.type = type; } },
    L(x, y, z) { return new THREE.Vector3(x, y, z).applyMatrix4(M); },
  };
}

export function grassColor(wx, wz, rng) {
  const n = vnoise(wx * 0.45 + 31, wz * 0.45 + 17) * 0.65 + vnoise(wx * 1.7, wz * 1.7) * 0.35;
  const c = mixHex('#557c12', '#a9bf36', THREE.MathUtils.clamp((n - 0.2) * 1.8, 0, 1));
  c.offsetHSL((rng() - 0.5) * 0.015, 0, (rng() - 0.5) * 0.04);
  return c;
}
function dirtColor(rng) {
  return mixHex('#e3c078', '#d4ae64', rng());
}
function brickColor(rng, t) {
  // t: 0 near island top, 1 at the bottom of the wall
  let c = new THREE.Color(rng() < 0.06 + t * 0.22 ? pick(rng, GREY) : pick(rng, WARM));
  c.offsetHSL(0, 0, (rng() - 0.5) * 0.06);
  if (t > 0.45) c.lerp(new THREE.Color('#6f6a78'), (t - 0.45) * 0.9);
  return c;
}

export const meshyMode = { on: false, cubes: [] };

export function buildIsland(B, isl, o) {
  const rng = mulberry32(o.seed || 1);
  const { cells, M } = isl;
  const base = o.base;
  const p = new THREE.Vector3();

  // edge distance
  const dist = new Map();
  let frontier = [];
  for (const c of cells.values()) {
    let edge = false;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (!isl.get(c.i + di, c.j + dj)) edge = true;
    if (edge) { dist.set(c, 1); frontier.push(c); }
  }
  let d = 1;
  while (frontier.length) {
    const next = [];
    for (const c of frontier) for (const [di, dj] of DIRS) {
      const n = isl.get(c.i + di, c.j + dj);
      if (n && !dist.has(n)) { dist.set(n, d + 1); next.push(n); }
    }
    frontier = next; d++;
  }
  const maxD = d - 1;

  for (const c of cells.values()) {
    const cx = c.i + 0.5, cz = c.j + 0.5, h = c.h;
    p.set(cx, h, cz).applyMatrix4(M);
    if (meshyMode.on) {
      let lowest = base;
      for (let top = h; top > lowest + 0.01; top -= 1) {
        const hh = Math.min(1, top - lowest);
        let exposed = top === h;
        for (const [di, dj] of DIRS) { const n = isl.get(c.i + di, c.j + dj); if (!n || n.h < top - 0.01) exposed = true; }
        if (exposed) meshyMode.cubes.push(xf(M, cx, top - hh / 2, cz, 1, hh, 1));
      }
      continue;
    }
    // cap
    if (c.type === 'grass') {
      B.add('grass', xf(M, cx, h - 0.22 + (rng() - 0.5) * 0.05, cz, 1, 1, 1, 0, 0, 0), grassColor(p.x, p.z, rng));
    } else if (c.type === 'dirt') {
      B.add('dirt', xf(M, cx, h - 0.255, cz, 1, 1, 1), dirtColor(rng));
    }
    // core
    const bot = base - 0.1;
    B.add('core', xf(M, cx, (h - 0.3 + bot) / 2, cz, 0.9, h - 0.3 - bot, 0.9), 0x4d3826);

    for (const [di, dj] of DIRS) {
      const n = isl.get(c.i + di, c.j + dj);
      const nh = n ? n.h : -Infinity;
      if (nh >= h) continue;
      const wallBot = n ? nh - 0.3 : base;
      const ry = di !== 0 ? Math.PI / 2 : 0;
      const tx = di !== 0 ? 0 : 1, tz = di !== 0 ? 1 : 0; // tangent
      // bricks
      for (let y = h - 0.36; y - 0.3 > wallBot - 0.3; y -= 0.5) {
        const t = THREE.MathUtils.clamp((-(y - 0.25)) / (-base), 0, 1);
        const out = 0.355 + (rng() - 0.5) * 0.06;
        if (rng() < 0.58) {
          B.add('brick', xf(M, cx + di * out, y - 0.25, cz + dj * out, 1, 1, 1, 0, ry, 0), brickColor(rng, t));
        } else {
          for (const s of [-0.25, 0.25]) {
            const o2 = out + (rng() - 0.5) * 0.05;
            B.add('brickH', xf(M, cx + di * o2 + tx * s, y - 0.25, cz + dj * o2 + tz * s, 1, 1, 1, 0, ry, 0), brickColor(rng, t));
          }
        }
      }
      // grass fringe hanging over the edge
      if (c.type === 'grass' && nh < h - 0.3) {
        for (const s of [-0.375, -0.125, 0.125, 0.375]) {
          const len = 0.45 + rng() * rng() * 1.1;
          const g = grassColor(p.x + s, p.z + s, rng).multiplyScalar(0.92);
          B.add('fringe', xf(M, cx + di * 0.47 + tx * (s + (rng() - 0.5) * 0.06), h - 0.03 - 0.25 * len, cz + dj * 0.47 + tz * (s + (rng() - 0.5) * 0.06), 0.62 + rng() * 0.25, len, 1, 0, ry, 0), g);
        }
      }
    }
  }

  // underside: inverted stepped pyramid of rough stone, shrinking toward the centroid
  let mx = 0, mz = 0;
  for (const c of cells.values()) { mx += c.i + 0.5; mz += c.j + 0.5; }
  mx /= cells.size; mz /= cells.size;
  const K = o.taper ?? 3;
  for (let k = 1; k <= K; k++) {
    const s = 1 - (k / (K + 1)) * (o.taperAmt ?? 0.82);
    const t = k / K;
    for (const c of cells.values()) {
      const col = mixHex(pick(rng, ['#b88a5e', '#a67c56', '#c09468', '#a08468']), '#9a9cbc', 0.05 + t * 0.5);
      B.add('rock', xf(M, mx + (c.i + 0.5 - mx) * s + (rng() - 0.5) * 0.1, base - 0.36 - (k - 1) * 0.7 + (rng() - 0.5) * 0.22, mz + (c.j + 0.5 - mz) * s + (rng() - 0.5) * 0.1,
        1.16 * s, 0.86, 1.16 * s, (rng() - 0.5) * 0.16, (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.16), col);
    }
  }
  return { maxD };
}

export function addStairs(B, isl, { i, j0, len = 2, h0, h1, seed = 5 }) {
  const rng = mulberry32(seed);
  const n = Math.round((h1 - h0) / 0.27);
  const rise = (h1 - h0) / n;
  const tread = len / n;
  for (let k = 0; k < n; k++) {
    const zc = j0 + 1 - (k + 0.5) * tread;
    const top = h0 + (k + 1) * rise;
    B.add('step', xf(isl.M, i + 0.5 + (rng() - 0.5) * 0.03, top - 0.15, zc, 1, 1, (tread / 0.3) * 1.15, 0, 0, 0), new THREE.Color(pick(rng, STEP)));
    const y0 = h0 - 0.3, y1 = top - 0.2;
    B.add('core', xf(isl.M, i + 0.5, (y0 + y1) / 2, zc, 0.9, y1 - y0, tread), 0x8a7458);
  }
}

export function fence(B, isl, x0, z0, x1, z1, y, seed = 3) {
  const rng = mulberry32(seed);
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
  const ry = Math.atan2(-dz, dx);
  const nPosts = L > 2.4 ? 3 : 2;
  for (let k = 0; k < nPosts; k++) {
    const t = k / (nPosts - 1);
    B.add('post', xf(isl.M, x0 + dx * t, y + 0.44, z0 + dz * t, 1, 0.95 + rng() * 0.15, 1, (rng() - 0.5) * 0.1, ry + (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.1), new THREE.Color(pick(rng, WOOD)));
  }
  for (const [hy, th] of [[0.66, 1], [0.34, 0.85]]) {
    B.add('rail', xf(isl.M, x0 + dx / 2, y + hy, z0 + dz / 2, L + 0.12, th, 1, 0, ry, (rng() - 0.5) * 0.12), new THREE.Color(pick(rng, WOOD)));
  }
}

export function orangeBlock(B, Mw) {
  B.add('orange', Mw, '#f7a01f');
  const m = new THREE.Matrix4();
  for (let axis = 0; axis < 3; axis++) for (const sgn of [-1, 1]) for (const a of [-0.34, 0.34]) for (const b of [-0.34, 0.34]) {
    const v = [0, 0, 0];
    v[axis] = sgn * 0.495; v[(axis + 1) % 3] = a; v[(axis + 2) % 3] = b;
    m.makeTranslation(v[0], v[1], v[2]).premultiply(Mw);
    B.add('rivet', m.clone(), '#b65a08');
  }
}

export function ramp(B, Ptop, Pbot, width = 2, seed = 9) {
  const rng = mulberry32(seed);
  const f = Ptop.clone().sub(Pbot); const len = f.length(); f.normalize();
  const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
  const n = new THREE.Vector3().crossVectors(r, f).normalize();
  const mid = Ptop.clone().add(Pbot).multiplyScalar(0.5);
  const R = new THREE.Matrix4().makeBasis(r, n, f.clone().negate()).setPosition(mid);
  const np = Math.floor(len / 0.5);
  const pitch = len / np;
  for (let k = 0; k < np; k++) {
    const z = -len / 2 + (k + 0.5) * pitch;
    B.add('plank', xf(R, (rng() - 0.5) * 0.06, 0, z, width, 1, pitch / 0.46 * 0.96, 0, (rng() - 0.5) * 0.02, 0), new THREE.Color(pick(rng, WOOD)));
  }
  for (const s of [-1, 1]) {
    B.add('beam', xf(R, s * (width / 2 + 0.03), 0.06, 0, 1, 1, len + 0.2), '#a8672f');
    B.add('beam', xf(R, s * (width / 2 - 0.25), -0.14, 0, 1, 1, len), '#8f5526');
  }
  const na = Math.floor(len / 1.02);
  for (let k = 0; k < na; k++) {
    const z = -len / 2 + (k + 0.5) * (len / na);
    B.add('arrow', xf(R, 0, 0.075, z, 1.3, 1, 1.05), '#fffdf2');
  }
}

export function flower(B, M, x, y, z, rng, s = 1) {
  const hh = (0.13 + rng() * 0.14) * s;
  B.add('stem', xf(M, x, y, z, 1, hh, 1), '#5aa828');
  const col = new THREE.Color(pick(rng, PETAL));
  const a0 = rng() * 6.28;
  for (let k = 0; k < 5; k++) {
    const a = a0 + (k / 5) * Math.PI * 2;
    B.add('petal', xf(M, x + Math.cos(a) * 0.062 * s, y + hh, z - Math.sin(a) * 0.062 * s, 0.085 * s, 0.035 * s, 0.065 * s, 0, a, 0), col);
  }
  B.add('petal', xf(M, x, y + hh + 0.012 * s, z, 0.06 * s, 0.05 * s, 0.06 * s), '#ffc928');
}

export function tuft(B, M, x, y, z, rng, s = 1) {
  const n = 5 + Math.floor(rng() * 3);
  for (let k = 0; k < n; k++) {
    const a = rng() * 6.28, rr = rng() * 0.09 * s;
    B.add('blade', xf(M, x + Math.cos(a) * rr, y - 0.02, z - Math.sin(a) * rr, s, s * (0.7 + rng() * 0.9), s, 0.12 + rng() * 0.5, a + Math.PI / 2, 0), new THREE.Color(pick(rng, BLADE)));
  }
}

/** ivy: strings of leaves hanging down the front (+z) and right (+x) wall faces */
export function vines(B, isl, { seed = 1, prob = 0.3, maxLen = 1.6 } = {}) {
  const rng = mulberry32(seed);
  const LEAF = ['#5fa822', '#74ba2c', '#4f961e', '#86c734'];
  for (const c of isl.cells.values()) {
    if (c.type === 'stair') continue;
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const n = isl.get(c.i + di, c.j + dj);
      if (n && n.h > c.h - 0.9) continue;
      if (rng() > prob) continue;
      const strands = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < strands; k++) {
        let u = 0.1 + rng() * 0.8;
        const len = 0.5 + rng() * (maxLen - 0.5);
        for (let y = c.h - 0.3; y > c.h - 0.3 - len; y -= 0.13 + rng() * 0.12) {
          u += (rng() - 0.5) * 0.3;
          const sz = 0.13 + rng() * 0.15;
          const x = di ? c.i + 1.04 : c.i + u, z = di ? c.j + u : c.j + 1.04;
          B.add('leaf', xf(isl.M, x, y, z, di ? sz * 0.4 : sz * 1.3, sz * 0.9, di ? sz * 1.3 : sz * 0.4, (rng() - 0.5) * (di ? 1.2 : 0), 0, (rng() - 0.5) * (di ? 0 : 1.2)), new THREE.Color(pick(rng, LEAF)));
        }
      }
    }
  }
}

export function scatterFlora(B, isl, { seed = 1, flowers = 0.5, tufts = 0.3, avoid = [] }) {
  const rng = mulberry32(seed);
  for (const c of isl.cells.values()) {
    if (c.type !== 'grass') continue;
    const tries = 3;
    for (let t = 0; t < tries; t++) {
      const x = c.i + 0.12 + rng() * 0.76, z = c.j + 0.12 + rng() * 0.76;
      if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) { rng(); continue; }
      const r = rng();
      if (r < flowers / tries) flower(B, isl.M, x, c.h, z, rng, 1.15 + rng() * 0.6);
      else if (r < (flowers + tufts) / tries) tuft(B, isl.M, x, c.h, z, rng, 0.65 + rng() * 0.6);
    }
  }
}

/** low mossy lumps that break up the flat tile tops */
export function moss(B, isl, { seed = 1, per = 5, avoid = [] } = {}) {
  const rng = mulberry32(seed);
  const p = new THREE.Vector3();
  for (const c of isl.cells.values()) {
    if (c.type !== 'grass') continue;
    for (let k = 0; k < per; k++) {
      const x = c.i + 0.06 + rng() * 0.88, z = c.j + 0.06 + rng() * 0.88;
      const r = 0.2 + rng() * 0.3, sx = 1 + rng() * 0.6, sz = 1 + rng() * 0.6, ry = rng() * 3, v = rng();
      if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
      p.set(x, c.h, z).applyMatrix4(isl.M);
      const col = grassColor(p.x * 1.3 + 5, p.z * 1.3, rng);
      if (v < 0.3) col.lerp(new THREE.Color('#c6d24c'), 0.45); else if (v > 0.72) col.multiplyScalar(0.76);
      B.add('moss', xf(isl.M, x, c.h - 0.04, z, r * sx, r * 0.42, r * sz, 0, ry, 0), col);
    }
  }
}
