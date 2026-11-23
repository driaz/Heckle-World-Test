import * as THREE from 'three';
import { mulberry32 } from './util.js';

export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color('#1f7ee6') },
      mid: { value: new THREE.Color('#79bdf4') },
      low: { value: new THREE.Color('#c2e3fa') },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 top; uniform vec3 mid; uniform vec3 low;
      void main(){
        float e = asin(clamp(normalize(vDir).y,-1.0,1.0)); // elevation (rad)
        float t1 = smoothstep(-0.52, -0.34, e);
        float t2 = smoothstep(-0.35, -0.17, e);
        vec3 c = mix(low, mid, t1); c = mix(c, top, t2);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 24), mat);
  mesh.renderOrder = -10;
  return mesh;
}

function cloudTexture(seed) {
  const W = 512, H = 320;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const rng = mulberry32(seed);
  const puffs = [];
  const n = 11 + Math.floor(rng() * 6);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const env = Math.pow(Math.sin(t * Math.PI), 0.8);
    const r = 26 + env * (30 + rng() * 40);
    puffs.push({ x: 70 + t * (W - 140) + (rng() - 0.5) * 34, y: H - 84 - env * (20 + rng() * 80) - r * 0.2, r });
  }
  for (let i = 0; i < 7; i++) puffs.push({ x: 110 + rng() * (W - 220), y: H - 92 + rng() * 10, r: 36 + rng() * 26 });
  // soft silhouette
  g.filter = 'blur(5px)';
  g.fillStyle = '#ffffff';
  for (const p of puffs) { g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill(); }
  // vertical shading: bright top, cool underside
  g.filter = 'none';
  g.globalCompositeOperation = 'source-atop';
  const sh = g.createLinearGradient(0, 40, 0, H - 40);
  sh.addColorStop(0, 'rgba(255,255,255,1)'); sh.addColorStop(0.55, 'rgba(246,251,255,1)'); sh.addColorStop(1, 'rgba(196,221,246,1)');
  g.fillStyle = sh; g.fillRect(0, 0, W, H);
  // soft per-puff highlights and core shadows for volume
  g.filter = 'blur(8px)';
  for (const p of puffs) {
    g.fillStyle = 'rgba(190,215,242,0.35)';
    g.beginPath(); g.arc(p.x + p.r * 0.1, p.y + p.r * 0.55, p.r * 0.55, 0, 7); g.fill();
  }
  for (const p of puffs) {
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath(); g.arc(p.x - p.r * 0.15, p.y - p.r * 0.3, p.r * 0.62, 0, 7); g.fill();
  }
  // fade the flat bottom
  g.filter = 'none';
  g.globalCompositeOperation = 'destination-out';
  const fade = g.createLinearGradient(0, H - 90, 0, H - 30);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = fade; g.fillRect(0, H - 90, W, 90);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeClouds(place, fov = 30) {
  const group = new THREE.Group();
  const texs = [1, 2, 3, 4, 5].map((s) => cloudTexture(s * 77));
  // [refX, refY, distance, widthPx, opacity]
  const defs = [
    [150, 120, 320, 330, 1], [400, 120, 420, 80, 0.9], [175, 265, 380, 120, 0.9], [290, 315, 400, 100, 0.85],
    [1030, 45, 400, 100, 0.9], [830, 175, 340, 130, 0.95], [1160, 150, 300, 260, 1], [1575, 85, 300, 260, 1],
    [1640, 520, 260, 300, 0.9], [1520, 870, 200, 420, 1], [1250, 760, 420, 300, 0.7], [930, 660, 380, 200, 0.75],
    [760, 400, 300, 220, 0.8], [40, 450, 300, 220, 0.9], [60, 250, 420, 140, 0.8], [280, 470, 380, 170, 0.75],
    [1420, 500, 420, 280, 0.6], [560, 60, 480, 110, 0.7], [1330, 40, 460, 90, 0.7], [30, 930, 240, 300, 0.8],
    [1000, 900, 300, 320, 0.75], [1330, 620, 440, 360, 0.55], [640, 560, 460, 260, 0.5], [820, 300, 460, 200, 0.55], [1460, 330, 470, 240, 0.5], [330, 180, 480, 200, 0.5],
  ];
  const pxToWorld = (d) => (2 * d * Math.tan((fov * Math.PI) / 360)) / 941;
  defs.forEach(([sx, sy, d, w, op], i) => {
    const mat = new THREE.SpriteMaterial({ map: texs[i % texs.length], transparent: true, opacity: op, depthWrite: false, fog: false });
    const s = new THREE.Sprite(mat);
    s.position.copy(place(sx, sy, d));
    const ww = w * pxToWorld(d) * 1.25;
    s.scale.set(ww, ww * 0.625, 1);
    s.renderOrder = -5;
    group.add(s);
  });
  const rng = mulberry32(999);
  for (let i = 0; i < 34; i++) {
    const az = rng() * Math.PI * 2;            // 0 = +x, PI/2 = -z (reference view direction)
    const dAz = Math.abs(((az - Math.PI / 2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (dAz < 0.5) continue;
    const r = 170 + rng() * 200;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texs[i % texs.length], transparent: true, opacity: 0.75 + rng() * 0.25, depthWrite: false, fog: false }));
    s.position.set(2 + Math.cos(az) * r, -70 + rng() * 110, 12 - Math.sin(az) * r);
    const ww = 45 + rng() * 80;
    s.scale.set(ww, ww * 0.625, 1);
    s.renderOrder = -5;
    group.add(s);
  }
  return group;
}

/** tiny hazy silhouettes of far-away islands (billboards) */
function islandTexture(seed) {
  const S = 128;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const rng = mulberry32(seed);
  g.filter = 'blur(1.2px)';
  // rock body
  const gr = g.createLinearGradient(0, 50, 0, 120);
  gr.addColorStop(0, '#a98f7a'); gr.addColorStop(1, '#7f8fb0');
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(22, 52); g.lineTo(106, 52); g.lineTo(92, 78); g.lineTo(74, 96); g.lineTo(62, 118); g.lineTo(50, 92); g.lineTo(32, 76); g.closePath(); g.fill();
  // grass top
  g.fillStyle = '#86b85a';
  g.beginPath(); g.ellipse(64, 50, 46, 9, 0, 0, 7); g.fill();
  // trees
  g.fillStyle = '#5f9f5e';
  for (const [x, h] of [[44 + rng() * 8, 26], [70 + rng() * 14, 20]]) { g.beginPath(); g.moveTo(x - 9, 46); g.lineTo(x, 46 - h); g.lineTo(x + 9, 46); g.closePath(); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function makeDistantIslands(place, fov = 30) {
  const group = new THREE.Group();
  const pxToWorld = (d) => (2 * d * Math.tan((fov * Math.PI) / 360)) / 941;
  const defs = [[62, 320, 300, 95, 0.5], [912, 215, 320, 80, 0.45], [1642, 275, 300, 70, 0.5], [40, 515, 280, 90, 0.42]];
  defs.forEach(([sx, sy, d, w, op], k) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: islandTexture(k + 3), transparent: true, opacity: op, depthWrite: false, fog: false, color: 0xcfe6ff }));
    s.position.copy(place(sx, sy, d));
    const ww = w * pxToWorld(d) * 1.3;
    s.scale.set(ww, ww, 1);
    s.renderOrder = -4;
    group.add(s);
  });
  return group;
}
