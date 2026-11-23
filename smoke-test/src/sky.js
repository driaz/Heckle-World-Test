import * as THREE from 'three';
import { mulberry32, vnoise } from './util.js';

export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color('#3ea4f8') },
      mid: { value: new THREE.Color('#a2defb') },
      low: { value: new THREE.Color('#bfdcf3') },
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

/**
 * Soft cumulus sprite. Puffs are spheres accumulated into a float height field (z toward the viewer); the field is
 * blurred, turned into normals and lit from the upper left: warm-white tops, pale blue-grey undersides and creases,
 * feathered alpha from the cloud's thickness. `soft` (0..1) gives the hazier variant used for far clouds.
 */
function cloudTexture(seed, soft = 0) {
  const W = 512, H = 320, N = W * H;
  const rng = mulberry32(seed);
  const baseY = H - 80;
  const puffs = [];
  const n = 8 + Math.floor(rng() * 5);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const env = Math.pow(Math.sin(t * Math.PI), 0.75);
    const r = 24 + env * (28 + rng() * 36);
    puffs.push({ x: 84 + t * (W - 168) + (rng() - 0.5) * 30, y: baseY - env * (16 + rng() * 70) - r * 0.15, r, z: 0 });
  }
  for (let i = 0; i < 6; i++) puffs.push({ x: 124 + rng() * (W - 248), y: baseY - 10 + rng() * 10, r: 36 + rng() * 24, z: 0 });
  const big = puffs.length;
  for (let i = 0; i < 18; i++) { // smaller billows riding on the surface of the big ones
    const p = puffs[Math.floor(rng() * big)];
    const a = -Math.PI * (0.08 + rng() * 0.84), q = 0.25 + rng() * 0.6;
    const r = p.r * (0.32 + rng() * 0.26);
    puffs.push({ x: p.x + Math.cos(a) * p.r * q, y: p.y + Math.sin(a) * p.r * q, r, z: p.r * Math.sqrt(1 - q * q) * 0.82 });
  }
  for (const p of puffs) { p.x = Math.min(W - p.r - 10, Math.max(p.r + 10, p.x)); p.y = Math.max(p.r + 10, p.y); }

  // height field = union of noise-wobbled spheres
  const h = new Float32Array(N);
  for (const p of puffs) {
    const x0 = Math.max(0, Math.floor(p.x - p.r * 1.2)), x1 = Math.min(W - 1, Math.ceil(p.x + p.r * 1.2));
    const y0 = Math.max(0, Math.floor(p.y - p.r * 1.2)), y1 = Math.min(H - 1, Math.ceil(p.y + p.r * 1.2));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const wob = 1 + 0.16 * (vnoise(x * 0.035 + seed, y * 0.035) - 0.5) + 0.08 * (vnoise(x * 0.09, y * 0.09 + seed) - 0.5);
      const rr = p.r * wob, dx = x - p.x, dy = y - p.y, hh = rr * rr - dx * dx - dy * dy;
      if (hh > 0) { const v = p.z + Math.sqrt(hh), i = y * W + x; if (v > h[i]) h[i] = v; }
    }
  }
  // flatten the base
  for (let y = 0; y < H; y++) {
    const f = 1 - THREE.MathUtils.smoothstep(y, baseY - 14, baseY + 26);
    if (f < 1) for (let x = 0; x < W; x++) h[y * W + x] *= f;
  }
  const blur = (src, rad, passes = 2) => { // separable box blur, clamped edges
    let a = src;
    const win = 2 * rad + 1;
    for (let pass = 0; pass < passes; pass++) {
      const b = new Float32Array(N), c = new Float32Array(N);
      for (let y = 0; y < H; y++) {
        const row = y * W; let acc = 0;
        for (let x = -rad; x <= rad; x++) acc += a[row + Math.min(W - 1, Math.max(0, x))];
        for (let x = 0; x < W; x++) { b[row + x] = acc / win; acc += a[row + Math.min(W - 1, x + rad + 1)] - a[row + Math.max(0, x - rad)]; }
      }
      for (let x = 0; x < W; x++) {
        let acc = 0;
        for (let y = -rad; y <= rad; y++) acc += b[Math.min(H - 1, Math.max(0, y)) * W + x];
        for (let y = 0; y < H; y++) { c[y * W + x] = acc / win; acc += b[Math.min(H - 1, y + rad + 1) * W + x] - b[Math.max(0, y - rad) * W + x]; }
      }
      a = c;
    }
    return a;
  };
  const hs = blur(h, 4 + Math.round(soft * 3));        // shading surface
  const hw = blur(h, 16);                              // wide average -> crease darkening
  const ha = blur(h, 8 + Math.round(soft * 7));        // thickness for alpha
  const data = new Uint8Array(N * 4);
  const Lx = -0.5, Ly = -0.72, Lz = 0.48, Ll = Math.hypot(Lx, Ly, Lz);
  const sst = THREE.MathUtils.smoothstep, clamp = THREE.MathUtils.clamp;
  const lit = [255, 254, 249], shadeTop = [212, 227, 247], shadeLow = [184, 206, 238], haze = [214, 232, 250];
  const slope = 0.55 - soft * 0.2, feather = 26 + soft * 22;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const xm = Math.max(0, x - 1), xp = Math.min(W - 1, x + 1), ym = Math.max(0, y - 1), yp = Math.min(H - 1, y + 1);
    const nx = -(hs[y * W + xp] - hs[y * W + xm]) * 0.5 * slope, ny = -(hs[yp * W + x] - hs[ym * W + x]) * 0.5 * slope;
    const nl = Math.hypot(nx, ny, 1);
    const ndl = (nx * Lx + ny * Ly + Lz) / (nl * Ll);
    const crease = clamp((hw[i] - hs[i]) / 22, 0, 1);
    const low = sst(y, baseY - 120, baseY + 16);
    let lv = sst(ndl, -0.25, 0.8) * (1 - 0.4 * crease) - 0.26 * low + 0.14;
    lv = clamp(lv, 0, 1); lv = lv * lv * (3 - 2 * lv);
    const a = sst(ha[i], 0.5, feather) * (1 - sst(y, baseY + 6, baseY + 40)) * sst(x, 0, 28) * sst(W - 1 - x, 0, 28) * sst(y, 0, 24); // + fade at the sprite border
    const o = ((H - 1 - y) * W + x) * 4;                // DataTexture rows run bottom-up
    for (let k = 0; k < 3; k++) {
      const sh = shadeTop[k] + (shadeLow[k] - shadeTop[k]) * low;
      let c = sh + (lit[k] - sh) * lv;
      c += (haze[k] - c) * soft * 0.45;
      data[o + k] = c;
    }
    data[o + 3] = Math.round(a * 255);
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export function makeClouds(place, fov = 30) {
  const group = new THREE.Group();
  const texs = [1, 2, 3, 4, 5].map((s) => cloudTexture(s * 77));
  const softTexs = [6, 7, 8].map((s) => cloudTexture(s * 77, 1)); // hazier variant for far / faint clouds
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
    const set = op < 0.72 ? softTexs : texs;
    const mat = new THREE.SpriteMaterial({ map: set[i % set.length], transparent: true, opacity: Math.min(1, op + 0.05), depthWrite: false, fog: false });
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

/**
 * Small procedural environment (PMREM) for reflections: sky gradient, HDR warm sun, bright cloud band at the horizon
 * and a bright cloud sea below, so metals facing the camera pick up warm white instead of flat blue.
 * Use as `material.envMap` (see loadProps) or `scene.environment`.
 */
export function makeEnvMap(renderer, sunDir = new THREE.Vector3(0.42, 0.78, 0.5)) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    uniforms: { sunDir: { value: sunDir.clone().normalize() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 sunDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      void main(){
        vec3 d = normalize(vDir);
        float az = atan(d.z, d.x);
        vec3 zenith = vec3(0.16, 0.42, 0.95), horizon = vec3(0.72, 0.86, 1.0);
        vec3 c = mix(horizon, zenith, smoothstep(0.0, 0.75, d.y));
        // cloud sea below the horizon: bright, slightly warm
        vec3 sea = mix(vec3(1.25, 1.2, 1.12), vec3(0.8, 0.88, 1.05), smoothstep(-0.05, -0.9, d.y));
        c = mix(c, sea, smoothstep(0.04, -0.08, d.y));
        // puffy cloud band around the horizon
        float n = noise(vec2(az * 3.0, d.y * 9.0)) * 0.6 + noise(vec2(az * 7.0 + 4.0, d.y * 20.0)) * 0.4;
        float band = smoothstep(0.42, 0.0, abs(d.y - 0.08)) * smoothstep(0.42, 0.62, n);
        c = mix(c, vec3(1.35, 1.32, 1.26), band);
        // sun: HDR core + warm glow
        float s = max(dot(d, sunDir), 0.0);
        c += vec3(1.0, 0.86, 0.6) * (pow(s, 1200.0) * 60.0 + pow(s, 60.0) * 2.0 + pow(s, 8.0) * 0.35);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const geo = new THREE.SphereGeometry(50, 48, 32);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(geo, mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0, 0.1, 200);
  pmrem.dispose(); geo.dispose(); mat.dispose();
  return rt.texture;
}
