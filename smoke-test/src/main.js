import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Batcher, mulberry32, xf } from './util.js';
import { makeMaterials, defineBatches } from './materials.js';
import { makeIsland, buildIsland, addStairs, fence, orangeBlock, ramp, scatterFlora, tuft, flower, vines, meshyMode } from './world.js';
import { makeDecalMaterials, pathRibbon, dirtPatch } from './decals.js';
import { loadIslands, addBackgroundIslands } from './islands.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { makeSky, makeClouds, makeEnvMap } from './sky.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { loadProps, instanceProp } from './props.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const REF_W = 1672, REF_H = 941;
const params = new URLSearchParams(location.search);
const camName = params.get('cam') || 'ref';
meshyMode.on = params.get('block') === 'meshy'; // A/B: build islands from the Meshy-retextured block instead of procedural bricks

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.06;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// ---------------------------------------------------------------- reference camera + screen-space placement helper
const REF_FOV = 16, REF_PITCH = 19.5 * Math.PI / 180;
const refCam = new THREE.PerspectiveCamera(REF_FOV, REF_W / REF_H, 0.5, 4000);
refCam.position.set(0, 20, 60);
const refTarget = refCam.position.clone().add(new THREE.Vector3(0, -Math.sin(REF_PITCH), -Math.cos(REF_PITCH)).multiplyScalar(40));
refCam.lookAt(refTarget);
refCam.updateMatrixWorld(true);
/** world point seen at reference-image pixel (sx,sy), `d` units from the reference camera */
function place(sx, sy, d) {
  const v = new THREE.Vector3((sx / REF_W) * 2 - 1, -((sy / REF_H) * 2 - 1), 0.5).unproject(refCam);
  const dir = v.sub(refCam.position).normalize();
  return refCam.position.clone().addScaledVector(dir, d);
}

// ---------------------------------------------------------------- lights
// Sky/bounce light on the islands is baked in Blender (lightMap). Real-time: a warm sun with one shadow map, plus a
// soft hemisphere fill for the non-baked props. No screen-space AO.
const hemi = new THREE.HemisphereLight(0xd6e6ff, 0xb39a7c, 0.32);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe0b0, 3.0);
const sunDir = new THREE.Vector3(-0.4, 0.83, 0.39).normalize(); // upper-left-front, as in the reference
const shadowCenter = new THREE.Vector3(3, 6, 12);
sun.position.copy(shadowCenter).addScaledVector(sunDir, 80);
sun.target.position.copy(shadowCenter);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 10, far: 170 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const useBake = params.get('lm') !== '0'; // ?lm=0: drop the baked lightmaps and light the islands with the hemisphere light instead (A/B)
if (!useBake) hemi.intensity = 1.15;
// distance haze
scene.fog = new THREE.Fog(0xb4daf6, 52, 440);
// small procedural sky environment: glossy reflections on coins/pad, a soft sheen on stone
const envMap = makeEnvMap(renderer, sunDir);
scene.environment = envMap;
scene.environmentIntensity = 0.3;

// ---------------------------------------------------------------- sky
scene.add(makeSky(), makeClouds(place, REF_FOV));
const decalMats = makeDecalMaterials();
const decal = (m) => { if (!meshyMode.on) scene.add(m); };

// ---------------------------------------------------------------- terrain
const mats = makeMaterials();
const B = new Batcher();
defineBatches(B, mats);
const P = { pine: [], bush: [], coin: [], spring: [], flag: [] };
const rng = mulberry32(1234);

// --- A: main island + stair tower (anchor = spring pad)
const LV = 1.4; // terrace rise
const A = makeIsland({ origin: place(522, 724, 36), anchor: [5.5, 7.3], yaw: -0.25, scale: 0.9 });
A.rect(0, 6, 9, 13, 0);
A.rect(0, 4, 3, 5, 0);
A.rect(2, 1, 5, 2, 3 * LV);          // tower top
A.set(4, 2, 2 * LV, 'stair');        // S3
A.rect(3, 3, 5, 3, 2 * LV);          // mid terrace
A.set(3, 4, 2 * LV); A.set(5, 4, 2 * LV);
A.set(4, 4, LV, 'stair');            // S2
A.rect(6, 4, 8, 4, LV);
A.rect(4, 5, 8, 5, LV);              // low terrace
A.rect(7, 6, 8, 6, LV);
A.set(6, 6, 0, 'stair');             // S1
A.rect(9, 9, 9, 13, -0.6);
buildIsland(B, A, { base: -6, seed: 11, taper: 4 });
addStairs(B, A, { i: 4, j0: 2, len: 1, h0: 2 * LV, h1: 3 * LV, seed: 1 });
addStairs(B, A, { i: 4, j0: 4, len: 1, h0: LV, h1: 2 * LV, seed: 2 });
addStairs(B, A, { i: 6, j0: 6, len: 1, h0: 0, h1: LV, seed: 3 });
fence(B, A, 2.0, 5.5, 3.85, 6.05, 0, 21);
B.add('slab', xf(A.M, 3.95, 0.04, 11.2, 0.95, 1, 0.8, 0, 0.3, 0), '#c4beb2');
B.add('slab', xf(A.M, 7.6, 0.03, 9.5, 0.5, 0.8, 0.42, 0, -0.2, 0), '#b0a799');
P.spring.push({ pos: A.L(5.5, 0.0, 7.3), height: 1.18, wide: 1.45, yaw: 2.3 });
{ // steel base ring with bolts under the Meshy spring pad
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 1.03, 0.1, 40), new THREE.MeshStandardMaterial({ color: 0x74839c, roughness: 0.4, metalness: 0.35 }));
  ring.position.copy(A.L(5.5, 0.04, 7.3)); ring.scale.setScalar(A.scale); ring.castShadow = ring.receiveShadow = true;
  scene.add(ring);
  for (let k = 0; k < 8; k++) B.add('rivet', xf(A.M, 5.5 + Math.cos(k * 0.785 + 0.3) * 0.88, 0.09, 7.3 + Math.sin(k * 0.785 + 0.3) * 0.88, 0.9, 0.6, 0.9), '#b4bfd0');
}
const pathA = pathRibbon(A, [[6.5, 6.9], [6.1, 7.4], [5.5, 8.0], [5.2, 9.2], [5.1, 10.6], [5.15, 12.2], [5.3, 14.3]], [1.3, 2.8, 3.4, 2.7, 2.5, 2.6, 2.9], 0.035, decalMats.ribbon);
decal(pathA.mesh);
decal(dirtPatch(A, 4.5, 3.5, 0.75, 0.42, 2 * LV + 0.035, decalMats.patch));
decal(dirtPatch(A, 5.6, 5.5, 1.7, 0.42, LV + 0.035, decalMats.patch));
const avoidA = [[5.5, 7.3, 1.25], ...pathA.circles, [4.5, 3.5, 0.7], [5.6, 5.5, 0.9], [3.95, 11.2, 0.6]];
P.pine.push({ pos: A.L(0.7, 0, 5.2), height: 3.7, yaw: 0.4 });
P.bush.push({ pos: A.L(0.3, -0.05, 6.4), height: 0.9, yaw: 0 }, { pos: A.L(0.6, -0.05, 7.6), height: 0.85, yaw: 2 }, { pos: A.L(2.6, 3 * LV - 0.05, 1.6), height: 0.72, yaw: 1 });
P.coin.push({ pos: A.L(7.6, 0.25, 7.7), height: 0.8, yaw: 0.25 });
for (const x of [3.5, 4.2, 4.9]) P.coin.push({ pos: A.L(x, 3 * LV + 0.75, 1.5), height: 0.68, yaw: 0.25 });
A.mossAvoid = avoidA;
scatterFlora(B, A, { seed: 5, flowers: 0.6, tufts: 0.36, avoid: [[5.5, 7.3, 1.4], [0.7, 5.2, 0.8], [0.3, 6.4, 0.7], [0.6, 7.6, 0.7], [2.6, 1.6, 0.6], [2.9, 5.8, 1.0], ...pathA.circles.map(([x, z, r]) => [x, z, r * 0.8])] });
vines(B, A, { seed: 71, prob: 0.4, maxLen: 1.5 });

// --- floating orange blocks
{
  const c = place(805, 318, 65);
  const M0 = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeRotationY(-0.12));
  for (const k of [-1, 0, 1]) orangeBlock(B, xf(M0, k * 1.0, 0, 0));
}

// --- D: big far island with flag mound
const D = makeIsland({ origin: place(1245, 300, 68), anchor: [6, 2.5], yaw: -0.5 });
D.rect(0, 1, 5, 5, 0);
D.rect(3, 0, 11, 2, 0);
D.del(0, 5); D.del(11, 0);
D.rect(4, 0, 8, 2, 0.8);
D.rect(5, 0, 7, 1, 2.0);
buildIsland(B, D, { base: -1.5, seed: 22, taper: 3 });
vines(B, D, { seed: 72, prob: 0.35, maxLen: 1.2 });
fence(B, D, 0.4, 1.3, 2.2, 1.25, 0, 31);
fence(B, D, 2.9, 0.4, 3.9, 0.3, 0, 32);
P.flag.push({ pos: D.L(7.0, 2.0, 0.8), height: 3.1, yaw: 0.5 });
P.pine.push({ pos: D.L(3.6, 0, 1.0), height: 2.9, yaw: 1 }, { pos: D.L(9.9, 0, 1.3), height: 2.9, yaw: 2.2 });
P.bush.push({ pos: D.L(10.6, -0.05, 2.2), height: 0.9, yaw: 0.6 });
decal(dirtPatch(D, 2.7, 3.0, 2.0, 1.1, 0.035, decalMats.patch, 0.2));
decal(dirtPatch(D, 8.1, 2.3, 0.8, 0.6, 0.035, decalMats.patch));
D.mossAvoid = [[2.7, 3.0, 1.6], [8.1, 2.3, 0.7]];
scatterFlora(B, D, { seed: 6, flowers: 0.3, tufts: 0.3, avoid: [[3.6, 1, 0.7], [9.9, 1.3, 0.7], [10.6, 2.2, 0.6], [7.0, 0.8, 0.6]] });

// --- F: island under the ramp
const F = makeIsland({ origin: place(1200, 502, 57), anchor: [2, 2], yaw: -0.75 });
F.rect(0, 0, 3, 3, 0);
buildIsland(B, F, { base: -1.4, seed: 33, taper: 3 });
vines(B, F, { seed: 73, prob: 0.3, maxLen: 1.0 });
scatterFlora(B, F, { seed: 7, flowers: 0.35, tufts: 0.4 });
ramp(B, D.L(8.1, 0.02, 3.05), F.L(2.4, 0.08, 0.3), 2.0, 9);

// --- E: small coin island
const E = makeIsland({ origin: place(920, 470, 57), anchor: [1.5, 1.5], yaw: -0.6, scale: 0.88 });
E.rect(0, 0, 2, 2, 0);
buildIsland(B, E, { base: -0.9, seed: 44, taper: 3 });
P.coin.push({ pos: E.L(1.5, 0.3, 1.5), height: 0.8, yaw: 0.2 });
decal(dirtPatch(E, 1.5, 1.5, 0.7, 0.6, 0.035, decalMats.patch));
E.mossAvoid = [[1.5, 1.5, 0.65]];
scatterFlora(B, E, { seed: 8, flowers: 0.3, tufts: 0.25, avoid: [[1.5, 1.5, 0.5]] });

// --- G: right coin island
const G = makeIsland({ origin: place(1530, 592, 51), anchor: [1.5, 1.5], yaw: -0.55 });
G.rect(0, 0, 2, 2, 0);
buildIsland(B, G, { base: -1.3, seed: 55, taper: 3 });
vines(B, G, { seed: 75, prob: 0.3, maxLen: 1.0 });
P.coin.push({ pos: G.L(1.5, 0.3, 1.5), height: 0.8, yaw: 0.2 });
decal(dirtPatch(G, 1.5, 1.5, 0.7, 0.6, 0.035, decalMats.patch));
G.mossAvoid = [[1.5, 1.5, 0.65]];
scatterFlora(B, G, { seed: 9, flowers: 0.3, tufts: 0.3, avoid: [[1.5, 1.5, 0.5]] });

// --- H: front island with fences + bush
const H = makeIsland({ origin: place(1140, 750, 42), anchor: [2.5, 2], yaw: -0.6 });
H.rect(0, 0, 4, 3, 0);
buildIsland(B, H, { base: -1.5, seed: 66, taper: 3 });
vines(B, H, { seed: 76, prob: 0.3, maxLen: 1.1 });
fence(B, H, 0.9, 1.6, 2.1, 2.5, 0, 41);
fence(B, H, 3.5, 2.5, 4.6, 2.2, 0, 42);
P.bush.push({ pos: H.L(2.85, -0.05, 2.6), height: 1.0, yaw: 0.3 });
H.mossAvoid = [[2.85, 2.6, 0.6]];
scatterFlora(B, H, { seed: 10, flowers: 0.3, tufts: 0.2, avoid: [[2.85, 2.6, 0.7]] });

const ISLANDS = { A, D, F, E, G, H };
window.__layout = {
  sunDir: sunDir.toArray(),
  islands: Object.entries(ISLANDS).map(([name, isl]) => ({ name, M: isl.M.toArray(), yaw: isl.yaw, scale: isl.scale, cells: [...isl.cells.values()], stairs: isl.stairs || [], mossAvoid: isl.mossAvoid || [], ...isl.opts })),
};
const instanceCount = B.build(scene);
if (meshyMode.on) {
  new GLTFLoader().load('./models/grass_block.glb', (g) => {
    let mesh; g.scene.traverse((o) => { if (o.isMesh) mesh = o; });
    g.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g.scene), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const N = new THREE.Matrix4().makeScale(1 / size.x, 1 / size.y, 1 / size.z).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z)).multiply(mesh.matrixWorld);
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, meshyMode.cubes.length);
    meshyMode.cubes.forEach((m, i) => im.setMatrixAt(i, m.clone().multiply(N)));
    im.castShadow = im.receiveShadow = true; im.frustumCulled = false;
    scene.add(im);
  });
}

// ---------------------------------------------------------------- cameras
const cams = {
  ref: () => ({ pos: refCam.position.clone(), target: refTarget.clone(), fov: REF_FOV }),
  wide: () => ({ pos: new THREE.Vector3(36, 21, 50), target: new THREE.Vector3(1, 3.5, 10), fov: 34 }),
  close: () => ({ pos: A.L(-1.5, 3.2, 15.5), target: A.L(5.2, 1.6, 4), fov: 42 }),
};
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.5, 4000);
const controls = new OrbitControls(camera, renderer.domElement);
function setCam(name) {
  const c = (cams[name] || cams.ref)();
  camera.position.copy(c.pos); camera.fov = c.fov; camera.updateProjectionMatrix();
  controls.target.copy(c.target); controls.update();
}
setCam(camName);
const usePost = params.get('post') !== '0';
const size = renderer.getDrawingBufferSize(new THREE.Vector2());
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { samples: 4, type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.2, 0.8, 0.85));
composer.addPass(new OutputPass());
// cheap colour grade after tone mapping: a little contrast and saturation, like the painted reference
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null }, sat: { value: +(params.get('sat') || 0.94) }, con: { value: +(params.get('con') || 1.03) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float sat; uniform float con; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      vec3 g = mix(vec3(l), c.rgb, sat); g = (g - 0.5) * con + 0.5; gl_FragColor = vec4(clamp(g, 0.0, 1.0), c.a); }`,
}));
renderer.info.autoReset = false;
const draw = () => { renderer.info.reset(); usePost ? composer.render() : renderer.render(scene, camera); };
window.addEventListener('keydown', (e) => { const k = { 1: 'ref', 2: 'wide', 3: 'close' }[e.key]; if (k) setCam(k); });
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- props (Meshy GLBs, instanced)
const coinSpin = [];
Promise.all([loadProps('./models/', { envMap }), meshyMode.on ? Promise.resolve({ tris: 0 }) : loadIslands(scene, ISLANDS, { baked: useBake }), addBackgroundIslands(scene, place, REF_FOV)]).then(([{ props, status }, isl]) => {
  for (const name of Object.keys(P)) instanceProp(scene, props[name], P[name]);
  draw();
  window.__stats = {
    props: status, propTris: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.tris])),
    instances: instanceCount, batches: (() => { const o = {}; scene.traverse((m) => { if (m.isInstancedMesh && m.name.startsWith('batch:')) { const g = m.geometry; o[m.name.slice(6)] = [m.count, Math.round((g.index ? g.index.count : g.attributes.position.count) / 3 * m.count)]; } }); return o; })(), islandTris: Math.round(isl.tris), calls: renderer.info.render.calls, sceneTriangles: (() => { let t = 0; scene.traverse((o) => { if (o.isMesh) { const g = o.geometry; t += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1); } }); return Math.round(t); })(),
  };
  window.__ready = true;
});

// ?still=1 renders a single frame (used by the headless screenshot script: software GL is too slow to loop the AO pass)
if (!params.has('still')) renderer.setAnimationLoop(() => {
  controls.update();
  draw();
});
