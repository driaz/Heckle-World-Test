import * as THREE from 'three';
import { mulberry32 } from './util.js';

function tex(size, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Soft-edged sandy dirt drawn over the grass tiles: a ribbon for paths, discs for patches. */
export function makeDecalMaterials() {
  const dirt = tex(256, (g, s) => {
    const rng = mulberry32(5);
    g.fillStyle = '#d9b672'; g.fillRect(0, 0, s, s);
    const wrap = (fn) => { for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) fn(ox, oy); };
    g.filter = 'blur(5px)';
    for (let i = 0; i < 70; i++) {
      const x = rng() * s, y = rng() * s, r = 10 + rng() * 26;
      g.fillStyle = rng() < 0.5 ? 'rgba(236,208,146,0.5)' : 'rgba(190,148,84,0.5)';
      wrap((ox, oy) => { g.beginPath(); g.ellipse(x + ox, y + oy, r, r * 0.7, 0, 0, 7); g.fill(); });
    }
    g.filter = 'none';
  });
  const band = tex(256, (g, s) => {
    const rng = mulberry32(8);
    g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
    g.filter = 'blur(9px)';
    g.fillStyle = '#fff'; g.fillRect(52, -20, s - 104, s + 40);
    for (let i = 0; i < 40; i++) { // ragged edges
      const left = rng() < 0.5, y = rng() * s, r = 8 + rng() * 18;
      const x = left ? 52 + (rng() - 0.5) * 30 : s - 52 + (rng() - 0.5) * 30;
      g.fillStyle = rng() < 0.6 ? '#fff' : '#000';
      for (const oy of [-s, 0, s]) { g.beginPath(); g.arc(x, y + oy, r, 0, 7); g.fill(); }
    }
  }, false);
  const disc = tex(256, (g, s) => {
    const rng = mulberry32(9);
    g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
    g.filter = 'blur(10px)';
    g.fillStyle = '#fff'; g.beginPath(); g.arc(s / 2, s / 2, s * 0.33, 0, 7); g.fill();
    for (let i = 0; i < 26; i++) {
      const a = rng() * 6.28, rr = s * (0.3 + rng() * 0.08), r = 8 + rng() * 16;
      g.fillStyle = rng() < 0.6 ? '#fff' : '#000';
      g.beginPath(); g.arc(s / 2 + Math.cos(a) * rr, s / 2 + Math.sin(a) * rr, r, 0, 7); g.fill();
    }
  }, false);
  band.channel = 1; disc.channel = 1;
  const base = { map: dirt, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  return {
    ribbon: new THREE.MeshStandardMaterial({ ...base, alphaMap: band }),
    patch: new THREE.MeshStandardMaterial({ ...base, alphaMap: disc }),
  };
}

function finish(geo, isl, mat) {
  geo.applyMatrix4(isl.M);
  const n = geo.attributes.position.count, nrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) nrm[i * 3 + 1] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true; m.renderOrder = 1;
  return m;
}

/** pts: [[x,z],...] in island-local coords; widths interpolated along the curve */
export function pathRibbon(isl, pts, widths, y, mat) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, y, z)));
  const N = 56, pos = [], uv = [], uv1 = [], idx = [];
  let len = 0, prev = null;
  const circles = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, p = curve.getPoint(t), tan = curve.getTangent(t);
    const nx = -tan.z, nz = tan.x, nl = Math.hypot(nx, nz) || 1;
    const wf = t * (widths.length - 1), w0 = widths[Math.floor(wf)], w1 = widths[Math.min(widths.length - 1, Math.floor(wf) + 1)];
    const w = w0 + (w1 - w0) * (wf - Math.floor(wf));
    if (prev) len += p.distanceTo(prev); prev = p.clone();
    circles.push([p.x, p.z, w * 0.36]);
    for (let c = 0; c < 4; c++) {
      const u = c / 3, x = p.x + (nx / nl) * (u - 0.5) * w, z = p.z + (nz / nl) * (u - 0.5) * w;
      pos.push(x, y, z); uv.push(x * 0.33, z * 0.33); uv1.push(u, len * 0.21);
    }
    if (i < N) for (let c = 0; c < 3; c++) {
      const a = i * 4 + c, b = a + 1, c2 = a + 4, d = a + 5;
      idx.push(a, b, c2, b, d, c2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  geo.setIndex(idx);
  return { mesh: finish(geo, isl, mat), circles };
}

export function dirtPatch(isl, x, z, rx, rz, y, mat, rot = 0) {
  const geo = new THREE.CircleGeometry(1, 28);
  geo.setAttribute('uv1', geo.attributes.uv.clone());
  geo.rotateX(-Math.PI / 2);
  geo.scale(rx * 1.5, 1, rz * 1.5);
  geo.rotateY(rot);
  geo.translate(x, y, z);
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 0.33, p.getZ(i) * 0.33);
  return finish(geo, isl, mat);
}
