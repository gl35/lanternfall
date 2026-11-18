import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { buildScenery, softTexture, R, LAUNCH, TREE } from './scenery.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { sfx } from './audio.js';

// ---------- renderer / scene ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 700);
const scenery = buildScenery(scene);
const camBase = new THREE.Vector3(), camLook = new THREE.Vector3(0, 2.4, 1.5), lookNow = camLook.clone();

// ---------- the thrower: a generated 3D character standing on the launch islet ----------
const hero = new THREE.Group();
hero.position.set(LAUNCH.x - 0.95, LAUNCH.y - 0.47, LAUNCH.z + 0.1);
scene.add(hero);
let heroKick = 0, heroLoaded = false, heroMode = '', heroAct = null, mixer = null;
const acts = {};
const THROW = { clip: 'box_02', wind: 2.0, speed: 1.3, hold: 0.8 };   // which clip is the throw, and where its wind-up sits
new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(import.meta.env.BASE_URL + 'models/general-animated.glb', g => {
  g.scene.scale.setScalar(2.5); g.scene.rotation.y = Math.PI;      // model faces +z; turn it toward the island
  g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } if (o.isSkinnedMesh) o.frustumCulled = false; });
  mixer = new THREE.AnimationMixer(g.scene);
  for (const c of g.animations) {
    for (const t of c.tracks) {                                    // keep him on his islet: no sideways travel from the clips
      if (!/Hips\.position$/.test(t.name)) continue;
      for (let i = 0; i < t.values.length; i += 3) { t.values[i] = t.values[0]; t.values[i + 2] = t.values[2]; }
    }
    acts[c.name] = mixer.clipAction(c);
  }
  hero.add(g.scene); heroLoaded = true;
}, undefined, e => console.error('character model failed to load', e));
function heroPlay(name, { fade = 0.25, once = false, speed = 1, at = null } = {}) {
  const a = acts[name]; if (!a) return;
  if (a !== heroAct) {
    a.reset(); a.enabled = true; a.fadeIn(fade).play();
    if (heroAct) heroAct.fadeOut(fade);
    heroAct = a;
  }
  if (at !== null) a.time = at;
  a.paused = false; a.timeScale = speed; a.clampWhenFinished = true;
  a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
  const dist = Math.max(15, (R + 0.35) / halfW);
  camBase.set(0, 2.6 + dist * 0.2, dist + 1);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

// ---------- physics ----------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -14, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.solver.iterations = 14;
world.defaultContactMaterial.friction = 0.6;
world.defaultContactMaterial.restitution = 0.08;
world.defaultContactMaterial.contactEquationStiffness = 5e7;
world.defaultContactMaterial.contactEquationRelaxation = 4;

function addStatic(shape, x, y, z) {
  const b = new CANNON.Body({ type: CANNON.Body.STATIC, shape }); b.position.set(x, y, z); world.addBody(b); return b;
}
addStatic(new CANNON.Cylinder(R - 0.1, R - 0.1, 2, 20), 0, -1, 0);                 // island top
addStatic(new CANNON.Cylinder(1.1, 1.1, 1, 12), LAUNCH.x, LAUNCH.y - 0.95, LAUNCH.z); // launch islet
addStatic(new CANNON.Box(new CANNON.Vec3(0.3, 1.6, 0.3)), TREE.x, 1.6, TREE.z);         // tree trunk

// ---------- materials ----------
function grainTexture(base, streak) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = streak; g.globalAlpha = 0.05 + Math.random() * 0.13; g.lineWidth = 1 + Math.random() * 3;
    const y = Math.random() * 256; g.beginPath(); g.moveTo(0, y);
    g.bezierCurveTo(80, y + Math.random() * 12 - 6, 170, y + Math.random() * 12 - 6, 256, y + Math.random() * 8 - 4); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const MAT = {
  wood: new THREE.MeshStandardMaterial({ map: grainTexture('#d9a566', '#7a4a22'), roughness: 0.75 }),
  dark: new THREE.MeshStandardMaterial({ map: grainTexture('#a8683a', '#4d2a12'), roughness: 0.8 }),
  stone: new THREE.MeshStandardMaterial({ map: grainTexture('#cfc6ba', '#8a8076'), roughness: 0.95 }),
  ball: new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff3a08, emissiveIntensity: 0.9, roughness: 0.5 }),
  paper: new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffa53a, emissiveIntensity: 1.6, roughness: 0.6 }),
  cap: new THREE.MeshStandardMaterial({ color: 0x5a3320, roughness: 0.7 }),
};
const DENSITY = { wood: 0.7, dark: 0.9, stone: 1.6 };
const glowTex = softTexture('rgba(255,214,140,1)', 'rgba(255,170,60,0)');
const puffTex = softTexture('rgba(255,250,244,1)', 'rgba(255,240,225,0)');
const geoCache = new Map();
function boxGeo(w, h, d) {
  const k = `${w}|${h}|${d}`;
  if (!geoCache.has(k)) geoCache.set(k, new RoundedBoxGeometry(w, h, d, 4, Math.min(0.07, Math.min(w, h, d) * 0.3)));
  return geoCache.get(k);
}
const sphereGeo = new THREE.SphereGeometry(1, 32, 24);
const capGeo = new THREE.CylinderGeometry(0.14, 0.17, 0.09, 20);

// ---------- game objects ----------
const objs = [];        // { body, mesh, kind, lantern? }
const lanterns = [];
const pendingBurst = new Set();
let wakeAllFlag = false;

function register(body, mesh, kind) {
  world.addBody(body); scene.add(mesh);
  const o = { body, mesh, kind, splashed: false }; body.userData = o; objs.push(o);
  body.sleepSpeedLimit = 0.22; body.sleepTimeLimit = 0.5;
  return o;
}
function onHit(e) {
  const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
  if (v < 2.6) return;
  const p = e.target.position;
  sfx.thump(v / 16);
  if (v > 5) { dust(p.x, Math.max(0.1, p.y - 0.2), p.z, Math.min(5, 1 + v / 5)); shake = Math.max(shake, Math.min(0.5, v / 45)); }
}
function addBlock(type, w, h, d, x, y, z, yaw = 0) {
  const body = new CANNON.Body({ mass: w * h * d * DENSITY[type] * 2, shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)) });
  body.position.set(x, y, z); body.quaternion.setFromEuler(0, yaw, 0);
  const mesh = new THREE.Mesh(boxGeo(w, h, d), MAT[type]); mesh.castShadow = mesh.receiveShadow = true;
  body.addEventListener('collide', onHit);
  const o = register(body, mesh, 'block'); body.sleep(); return o;
}
function addBoulder(x, y, z, rad = 0.5) {
  const body = new CANNON.Body({ mass: 7, shape: new CANNON.Sphere(rad) }); body.position.set(x, y, z);
  body.angularDamping = 0.25;
  const mesh = new THREE.Mesh(sphereGeo, MAT.stone); mesh.scale.setScalar(rad); mesh.castShadow = mesh.receiveShadow = true;
  body.addEventListener('collide', onHit);
  const o = register(body, mesh, 'block'); body.sleep(); return o;
}
function addLantern(x, y, z) {
  const body = new CANNON.Body({ mass: 0.3, shape: new CANNON.Box(new CANNON.Vec3(0.24, 0.36, 0.24)) });
  body.position.set(x, y + 0.36, z);
  const g = new THREE.Group();
  const paper = new THREE.Mesh(sphereGeo, MAT.paper); paper.scale.set(0.3, 0.3, 0.3); paper.castShadow = true;
  const top = new THREE.Mesh(capGeo, MAT.cap); top.position.y = 0.3; top.rotation.x = Math.PI;
  const bot = new THREE.Mesh(capGeo, MAT.cap); bot.position.y = -0.3;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.75 }));
  glow.scale.setScalar(2.1);
  g.add(paper, top, bot, glow);
  const o = register(body, g, 'lantern'); o.glow = glow; o.phase = Math.random() * 6;
  body.addEventListener('collide', e => {
    if (Math.abs(e.contact.getImpactVelocityAlongNormal()) > 1.9) pendingBurst.add(o);
  });
  lanterns.push(o); body.sleep(); return o;
}
function removeObj(o) {
  world.removeBody(o.body); scene.remove(o.mesh);
  const i = objs.indexOf(o); if (i >= 0) objs.splice(i, 1);
  const j = lanterns.indexOf(o); if (j >= 0) lanterns.splice(j, 1);
}

// ---------- particles ----------
const parts = [];
for (let i = 0; i < 150; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, depthWrite: false, transparent: true }));
  s.visible = false; scene.add(s); parts.push({ s, life: 0, max: 1, v: new THREE.Vector3(), size: 1, grow: 0, g: 0, wob: 0 });
}
let partIdx = 0;
function spawn(x, y, z, vx, vy, vz, life, size, opt = {}) {
  const p = parts[partIdx = (partIdx + 1) % parts.length], m = p.s.material;
  m.map = opt.puff ? puffTex : glowTex; m.blending = opt.puff ? THREE.NormalBlending : THREE.AdditiveBlending;
  m.color.set(opt.color ?? 0xffffff); m.needsUpdate = true;
  p.s.position.set(x, y, z); p.v.set(vx, vy, vz); p.life = p.max = life; p.size = size;
  p.grow = opt.grow ?? 0; p.g = opt.g ?? 0; p.wob = opt.wob ?? 0; p.alpha = opt.alpha ?? 1; p.s.visible = true;
}
const rnd = (a = 1) => (Math.random() - 0.5) * 2 * a;
function dust(x, y, z, n) {
  for (let i = 0; i < n; i++) spawn(x + rnd(0.3), y, z + rnd(0.3), rnd(1.2), 0.4 + Math.random(), rnd(1.2), 0.7 + Math.random() * 0.5, 0.5,
    { puff: true, grow: 1.6, alpha: 0.5 });
}
function splash(x, z, big) {
  for (let i = 0; i < (big ? 7 : 4); i++) spawn(x + rnd(0.8), -7.5, z + rnd(0.8), rnd(1.5), 2 + Math.random() * 2.5, rnd(1.5), 1.1 + Math.random() * 0.6,
    1.6, { puff: true, grow: 2.8, alpha: 0.8, g: -3 });
}
function fireflies(x, y, z, n, flash = true) {
  if (flash) spawn(x, y, z, 0, 0, 0, 0.35, 2.4, { grow: 4, color: 0xffd9a0, alpha: 0.7 });
  for (let i = 0; i < n; i++) spawn(x, y, z, rnd(2.2), 1.5 + Math.random() * 3, rnd(2.2), 1.6 + Math.random() * 1.4, 0.28 + Math.random() * 0.25,
    { color: 0xffc66a, g: 1.2, wob: 3 + Math.random() * 4 });
}
function updateParts(dt, t) {
  for (const p of parts) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.s.visible = false; continue; }
    p.v.y += p.g * dt; p.v.multiplyScalar(1 - 1.4 * dt);
    p.s.position.addScaledVector(p.v, dt);
    if (p.wob) p.s.position.x += Math.sin(t * p.wob + p.max * 9) * dt * 0.8;
    const k = p.life / p.max;
    p.s.scale.setScalar(p.size + p.grow * (1 - k));
    p.s.material.opacity = p.alpha * Math.min(1, k * 2.2);
  }
}

// ---------- levels ----------
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function place(cx, cz, yaw, lx, lz) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [cx + lx * c + lz * s, cz - lx * s + lz * c];
}
function tower(cx, cz, yaw, floors, rng) {
  const PH = 1.3, PW = 0.38, TH = 0.24;
  for (let f = 0; f < floors; f++) {
    const y0 = f * (PH + TH), wide = 0.78 - f * 0.06;
    for (const sx of [-wide, wide]) { const [x, z] = place(cx, cz, yaw, sx, 0); addBlock(f % 2 ? 'dark' : 'wood', PW, PH, PW + 0.3, x, y0 + PH / 2, z, yaw); }
    addBlock('stone', 2.1 - f * 0.12, TH, 0.95, cx, y0 + PH + TH / 2, cz, yaw);
    if (f === 0 || rng() < 0.45) addLantern(cx, y0, cz);
  }
  addLantern(cx, floors * (PH + TH), cz);
}
function pyramid(cx, cz, yaw, n) {
  const S = 0.7;
  for (let r = 0; r < n; r++) for (let i = 0; i < n - r; i++) {
    const [x, z] = place(cx, cz, yaw, (i - (n - r - 1) / 2) * (S + 0.03), 0);
    addBlock((r + i) % 2 ? 'wood' : 'dark', S, S, S, x, S / 2 + r * S, z, yaw);
  }
  addLantern(cx, n * S, cz);
  if (n >= 3) { const [x, z] = place(cx, cz, yaw, 0, -0.9); addLantern(x, 0, z); }
}
function gate(cx, cz, yaw) {
  const S = 0.62;
  for (const sx of [-0.85, 0.85]) for (let k = 0; k < 3; k++) {
    const [x, z] = place(cx, cz, yaw, sx, 0); addBlock(k % 2 ? 'stone' : 'dark', S, S, S, x, S / 2 + k * S, z, yaw);
  }
  addBlock('wood', 2.5, 0.22, 0.8, cx, 3 * S + 0.11, cz, yaw);
  addBoulder(cx, 3 * S + 0.22 + 0.5, cz);
  addLantern(cx, 0, cz);
  const [x, z] = place(cx, cz, yaw, 0.85, 0); addLantern(x, 3 * S + 0.22, z);
}

let level = Math.max(1, parseInt(localStorage.getItem('lanternfall.level') || '1', 10) || 1);
let shotsLeft = 0, shotsMax = 0, state = 'play', stateT = 0, sinceFling = 99, combo = 0;
let readyBall = null, reloadT = 0;

function clearLevel() {
  for (const o of [...objs]) removeObj(o);
  pendingBurst.clear();
  if (readyBall) { scene.remove(readyBall); readyBall = null; }
}
function buildLevel() {
  clearLevel();
  const rng = mulberry(level * 7919 + 17);
  const n = level === 1 ? 1 : Math.min(3, 1 + Math.floor(level / 2));
  const xs = n === 1 ? [0] : n === 2 ? [-1.8, 1.8] : [-2.9, 0, 2.9];
  xs.forEach((x, i) => {
    const z = n === 1 ? 0 : (rng() - 0.5) * 2.2 + (n === 3 && i === 1 ? -1.2 : 0.4), yaw = (rng() - 0.5) * 0.5;
    const pick = level === 1 ? 0 : level === 2 ? (i ? 1 : 0) : Math.floor(rng() * 3);
    const tall = Math.min(4, 2 + Math.floor(rng() * (1 + level / 3)));
    if (pick === 0) tower(x, z, yaw, level === 1 ? 2 : tall, rng);
    else if (pick === 1) pyramid(x, z, yaw, Math.min(4, 2 + Math.floor(rng() * (1 + level / 3))));
    else gate(x, z, yaw);
  });
  shotsMax = shotsLeft = Math.max(3, lanterns.length + 1);
  state = 'play'; stateT = 0; sinceFling = 99; combo = 0; reloadT = 0;
  spawnReady(); hud();
}
function spawnReady() {
  readyBall = new THREE.Mesh(sphereGeo, MAT.ball); readyBall.scale.setScalar(0.01); readyBall.castShadow = true;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff8a3a, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.4 }));
  halo.scale.setScalar(3.4); readyBall.add(halo);
  readyBall.position.copy(LAUNCH); scene.add(readyBall);
}

// ---------- HUD ----------
const elLvl = document.getElementById('lvl'), elShots = document.getElementById('shots'),
  elFade = document.getElementById('fade'), elHint = document.getElementById('hint');
if (localStorage.getItem('lanternfall.played')) elHint.classList.add('off');
function hud() {
  elLvl.textContent = level;
  elShots.innerHTML = Array.from({ length: shotsMax }, (_, i) => `<i class="${i < shotsLeft ? '' : 'used'}"></i>`).join('');
}
document.getElementById('restart').addEventListener('click', e => { e.stopPropagation(); transition(false); });
function transition(next) {
  if (state === 'fade') return;
  state = 'fade'; elFade.classList.add('on');
  setTimeout(() => {
    if (next) { level++; localStorage.setItem('lanternfall.level', level); }
    buildLevel(); elFade.classList.remove('on');
  }, 480);
}

// ---------- aiming ----------
const BALL_R = 0.45;
const aim = { on: false, sx: 0, sy: 0, yaw: 0, power: 0, valid: false };
const dots = [];
{
  const g = new THREE.SphereGeometry(0.09, 10, 8);
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 - i * 0.04, fog: false }));
    m.visible = false; scene.add(m); dots.push(m);
  }
}
function launchVel(yaw, power, out = new THREE.Vector3()) {
  const speed = 9 + 15.5 * power, el = 0.3 + (1 - power) * 0.26;
  return out.set(Math.sin(yaw) * Math.cos(el) * speed, Math.sin(el) * speed, -Math.cos(yaw) * Math.cos(el) * speed);
}
const tmpV = new THREE.Vector3();
function showDots() {
  const on = aim.on && aim.valid && readyBall;
  if (on) launchVel(aim.yaw, aim.power, tmpV);
  dots.forEach((d, i) => {
    d.visible = !!on;
    if (!on) return;
    const t = (i + 1) * 0.06;
    d.position.set(LAUNCH.x + tmpV.x * t, LAUNCH.y + tmpV.y * t - 7 * t * t, LAUNCH.z + tmpV.z * t);
  });
}
function fling(yaw, power) {
  if (!readyBall || state !== 'play' || shotsLeft <= 0) return false;
  const body = new CANNON.Body({ mass: 6, shape: new CANNON.Sphere(BALL_R) });
  body.position.set(LAUNCH.x, LAUNCH.y, LAUNCH.z);
  const v = launchVel(yaw, power); body.velocity.set(v.x, v.y, v.z);
  body.angularVelocity.set(-8, 0, 0); body.angularDamping = 0.3; body.linearDamping = 0.02;
  readyBall.position.copy(LAUNCH); readyBall.scale.setScalar(BALL_R);
  const o = register(body, readyBall, 'ball'); o.hit = false;
  body.addEventListener('collide', e => {
    if (e.body.type !== CANNON.Body.STATIC && !o.hit) { o.hit = true; wakeAllFlag = true; }
    onHit(e);
  });
  readyBall = null; shotsLeft--; sinceFling = 0; combo = 0; reloadT = 0.7; heroKick = 1;
  sfx.whoosh(power); hud();
  if (!localStorage.getItem('lanternfall.played')) { localStorage.setItem('lanternfall.played', '1'); elHint.classList.add('off'); }
  return true;
}
function aimFrom(x, y) {
  const dx = x - aim.sx, dy = y - aim.sy, h = window.innerHeight, w = window.innerWidth;
  aim.power = Math.min(1, Math.hypot(dx, dy) / (h * 0.28));
  aim.yaw = THREE.MathUtils.clamp(-dx / Math.min(w, h * 0.7), -0.5, 0.5) * 1.3;
  aim.valid = dy > 12 && aim.power > 0.08;
}
window.addEventListener('pointerdown', e => {
  sfx.init();
  if (e.target.closest && e.target.closest('#restart')) return;
  aim.on = true; aim.sx = e.clientX; aim.sy = e.clientY; aim.valid = false;
});
window.addEventListener('pointermove', e => { if (aim.on) aimFrom(e.clientX, e.clientY); });
function release(e) {
  if (!aim.on) return;
  aimFrom(e.clientX, e.clientY); aim.on = false;
  if (aim.valid) fling(aim.yaw, aim.power);
}
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', () => { aim.on = false; });
window.addEventListener('contextmenu', e => e.preventDefault());

// ---------- simulation ----------
let time = 0, acc = 0, shake = 0, slowT = 0;
const STEP = 1 / 120;

function burst(o) {
  if (!lanterns.includes(o)) return;
  const p = o.body.position;
  fireflies(p.x, p.y, p.z, 14);
  sfx.chime(combo++); slowT = 0.14; shake = Math.max(shake, 0.12);
  removeObj(o);
  if (lanterns.length === 0 && state === 'play') { state = 'won'; stateT = 0; sfx.win(); }
}
function physics(dt) {
  acc += dt;
  let n = 0;
  while (acc >= STEP && n++ < 8) {
    world.step(STEP); acc -= STEP;
    if (wakeAllFlag) { wakeAllFlag = false; for (const o of objs) o.body.wakeUp(); }
  }
  if (n >= 8) acc = 0;
  // a sleeping piece must wake when something nearby starts moving, or it would hang in the air
  for (const a of objs) {
    const b = a.body;
    if (b.sleepState === CANNON.Body.SLEEPING || b.velocity.lengthSquared() < 0.5) continue;
    for (const c of objs) if (c.body.sleepState === CANNON.Body.SLEEPING && c.body.position.distanceSquared(b.position) < 9) c.body.wakeUp();
  }
  for (const o of pendingBurst) burst(o);
  pendingBurst.clear();
  for (const o of [...objs]) {
    const p = o.body.position;
    if (!o.splashed && p.y < -6.5) { o.splashed = true; splash(p.x, p.z, o.kind !== 'lantern'); if (o.kind === 'lantern') burst(o); }
    if (p.y < -12 && objs.includes(o)) removeObj(o);
  }
  for (const o of objs) { o.mesh.position.copy(o.body.position); o.mesh.quaternion.copy(o.body.quaternion); }
}
function settled() {
  for (const o of objs) if (o.body.sleepState !== CANNON.Body.SLEEPING && o.body.velocity.lengthSquared() > 0.15) return false;
  return true;
}

function step(dtReal) {
  slowT = Math.max(0, slowT - dtReal);
  const dt = dtReal * (slowT > 0 ? 0.3 : 1);
  time += dt; stateT += dtReal; sinceFling += dt;

  physics(dt);

  if (state === 'play') {
    if (!readyBall && shotsLeft > 0 && (reloadT -= dt) <= 0) spawnReady();
    if (shotsLeft === 0 && !readyBall && lanterns.length && sinceFling > 2.5 && (settled() || sinceFling > 9)) transition(false);
  } else if (state === 'won') {
    if (Math.random() < dtReal * 30) fireflies(rnd(R * 0.8), 0.3, rnd(R * 0.8), 2, false);
    if (stateT > 1.7) transition(true);
  }

  if (readyBall) {                                         // pop in, and pull back while aiming
    const s = Math.min(BALL_R, readyBall.scale.x + dt * 3);
    readyBall.scale.setScalar(s);
    const pull = aim.on && aim.valid ? aim.power : 0;
    readyBall.position.set(LAUNCH.x - Math.sin(aim.yaw) * pull * 0.7, LAUNCH.y + pull * 0.1 + Math.sin(time * 2.4) * 0.03, LAUNCH.z + Math.cos(aim.yaw) * pull * 0.7);
  }
  showDots();
  if (heroLoaded) {                                        // the thrower: idle, hold the wind-up while aiming, throw on release
    const aiming = aim.on && aim.valid && !!readyBall, yaw = aim.on ? aim.yaw : 0;
    heroKick = Math.max(0, heroKick - dtReal / THROW.hold);
    const mode = state === 'won' ? 'win' : heroKick > 0 ? 'throw' : aiming ? 'aim' : 'idle';
    if (mode !== heroMode) {
      if (mode === 'win') heroPlay('dance_01', { fade: 0.4 });
      else if (mode === 'aim') heroPlay(THROW.clip, { fade: 0.18, speed: 0, at: THROW.wind });
      else if (mode === 'throw') heroPlay(THROW.clip, { fade: 0.08, speed: THROW.speed, once: true, at: heroMode === 'aim' ? null : THROW.wind });
      else heroPlay('look_around', { fade: 0.35 });
      heroMode = mode;
    }
    mixer.update(dtReal);
    hero.rotation.y += (-yaw * 0.8 - hero.rotation.y) * Math.min(1, dtReal * 8);
  }
  for (const o of objs) {                                  // fire trail behind flying balls
    if (o.kind !== 'ball' || o.body.velocity.lengthSquared() < 9 || Math.random() > dt * 70) continue;
    const p = o.body.position;
    spawn(p.x + rnd(0.15), p.y + rnd(0.15), p.z + rnd(0.15), rnd(0.5), 0.8 + Math.random(), rnd(0.5), 0.35 + Math.random() * 0.3, 0.9,
      { color: Math.random() < 0.5 ? 0xff6a1a : 0xffb040, grow: -0.6, alpha: 0.8 });
  }
  for (const l of lanterns) l.glow.material.opacity = 0.62 + Math.sin(time * 2.2 + l.phase) * 0.14;
  updateParts(dt, time);
  scenery.update(time);

  // camera: gentle sway, lean toward the newest ball, shake on impacts
  const ball = objs.findLast?.(o => o.kind === 'ball');
  const tx = ball && ball.body.position.y > -3 ? ball.body.position.x * 0.22 : 0;
  lookNow.x += (tx - lookNow.x) * Math.min(1, dtReal * 3);
  shake = Math.max(0, shake - dtReal * 1.6);
  if (!window.__freecam) camera.position.set(camBase.x + Math.sin(time * 0.22) * 0.5 + lookNow.x * 0.5 + rnd(shake) * 0.5,
    camBase.y + Math.sin(time * 0.31) * 0.2 + rnd(shake) * 0.5, camBase.z);
  if (!window.__freecam) camera.lookAt(lookNow.x, camLook.y, camLook.z);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!window.__manual) step(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// Scripted stepping for tests (the preview pane only runs frames while visible).
window.game = {
  step(seconds = 1, dt = 1 / 60) { window.__manual = true; for (let t = 0; t < seconds; t += dt) step(dt); renderer.render(scene, camera); return this.state(); },
  fling, debug: { camera, hero, acts, THROW, THREE, get mixer() { return mixer; } },
  setLevel(n) { level = n; buildLevel(); },
  auto() { window.__manual = false; },
  state() {
    return { heroLoaded, level, state, shotsLeft, shotsMax, lanterns: lanterns.length, objects: objs.length, ready: !!readyBall,
      maxY: +Math.max(0, ...objs.map(o => o.body.position.y)).toFixed(2),
      moving: objs.filter(o => o.body.sleepState !== CANNON.Body.SLEEPING).length };
  },
};

buildLevel();
requestAnimationFrame(frame);
