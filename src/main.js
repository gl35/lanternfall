import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { buildScenery, softTexture, R, START, TREES } from './scenery.js';
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
const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 1200);
const scenery = buildScenery(scene);
let portrait = true;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; portrait = h > w;
  camera.fov = portrait ? 62 : 50;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

// ---------- player ----------
const player = { x: START.x, z: START.z, y: 0, vy: 0, face: 0, moving: 0, walkT: 0 };
const JUMP_V = 8.2, GRAVITY = 20;
let camYaw = 0;                                            // 0 looks toward -z; forward = (sin, 0, -cos)
const SPEED = 4.8, HAND_H = 2.15, HAND_F = 0.9, BALL_R = 0.45;
const fwd = (yaw, out) => out.set(Math.sin(yaw), 0, -Math.cos(yaw));

const hero = new THREE.Group(), heroTilt = new THREE.Group();
hero.add(heroTilt); scene.add(hero);
let heroKick = 0, heroLoaded = false, heroMode = '', heroAct = null, mixer = null;
const acts = {};
const THROW = { clip: 'box_02', wind: 2.0, speed: 1.3, hold: 0.8 };   // which clip is the throw, and where its wind-up sits
const CLIP = { idle: null, walk: null, jump: null, win: null };       // filled in by name when the model loads
const HOP = { t0: 0, t1: 1 };                                          // the part of the jump clip that is one take-off-to-landing
function findHop(clip) {
  // jump clips often hold several hops; use the hips' height to cut out the highest one, trough to trough
  const t = clip.tracks.find(t => /Hips.position$/.test(t.name));
  HOP.t0 = 0; HOP.t1 = clip.duration;
  if (!t) return;
  const y = i => t.values[i * 3 + 1], n = t.times.length;
  let top = 0; for (let i = 1; i < n; i++) if (y(i) > y(top)) top = i;
  let a = top, b = top;
  while (a > 0 && y(a - 1) <= y(a)) a--;
  while (b < n - 1 && y(b + 1) <= y(b)) b++;
  if (t.times[b] - t.times[a] > 0.15) { HOP.t0 = t.times[a]; HOP.t1 = t.times[b]; }
}
function pickClips() {
  const names = Object.keys(acts), find = re => names.find(n => re.test(n)) || null;
  CLIP.idle = find(/idle|breath|stand/i) || find(/look/i) || names[0];
  CLIP.walk = find(/run|jog/i) || find(/walk/i);
  CLIP.jump = names.find(n => /^(jump|leap)$/i.test(n)) || find(/jump|leap/i);
  if (CLIP.jump) findHop(acts[CLIP.jump].getClip());
  CLIP.win = find(/dance|cheer|victory/i);
  const t = find(/throw|cast|pitch/i);
  if (t) Object.assign(THROW, { clip: t, wind: 0, speed: 1.4, hold: Math.min(1.2, acts[t].getClip().duration / 1.4) });
}
new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(import.meta.env.BASE_URL + 'models/general-animated.glb', g => {
  g.scene.scale.setScalar(2.5); g.scene.rotation.y = Math.PI;      // model faces +z; turn it to face "forward"
  g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } if (o.isSkinnedMesh) o.frustumCulled = false; });
  mixer = new THREE.AnimationMixer(g.scene);
  for (const c of g.animations) {
    for (const t of c.tracks) {                                    // the game moves him, not the clips
      if (!/Hips\.position$/.test(t.name)) continue;
      for (let i = 0; i < t.values.length; i += 3) { t.values[i] = t.values[0]; t.values[i + 2] = t.values[2]; }
    }
    acts[c.name] = mixer.clipAction(c);
  }
  pickClips(); heroTilt.add(g.scene); heroLoaded = true;
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
addStatic(new CANNON.Cylinder(R - 0.2, R - 0.2, 2, 40), 0, -1, 0);                         // island top
for (const t of TREES) addStatic(new CANNON.Box(new CANNON.Vec3(0.42 * t.s, 2.2 * t.s, 0.42 * t.s)), t.x, 2.2 * t.s, t.z);

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
function haloSprite(scale, opacity, color = 0xffffff) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, opacity }));
  s.scale.setScalar(scale); return s;
}

// ---------- game objects ----------
const objs = [];        // { body, mesh, kind }
const lanterns = [];
const pendingBurst = new Set();
let shake = 0;

function register(body, mesh, kind) {
  world.addBody(body); scene.add(mesh);
  const o = { body, mesh, kind, splashed: false, age: 0 }; body.userData = o; objs.push(o);
  body.sleepSpeedLimit = 0.22; body.sleepTimeLimit = 0.5;
  return o;
}
function near(p, far = 60) { return Math.hypot(p.x - player.x, p.z - player.z) < far; }
function onHit(e) {
  const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
  if (v < 2.6) return;
  const p = e.target.position;
  if (!near(p)) return;
  sfx.thump(v / 16);
  if (v > 5) { dust(p.x, Math.max(0.1, p.y - 0.2), p.z, Math.min(5, 1 + v / 5)); shake = Math.max(shake, Math.min(0.4, v / 55)); }
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
  const glow = haloSprite(2.6, 0.75);
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
for (let i = 0; i < 170; i++) {
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
  for (let i = 0; i < (big ? 7 : 4); i++) spawn(x + rnd(0.8), -9, z + rnd(0.8), rnd(1.5), 2 + Math.random() * 2.5, rnd(1.5), 1.1 + Math.random() * 0.6,
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
    p.s.scale.setScalar(Math.max(0.01, p.size + p.grow * (1 - k)));
    p.s.material.opacity = p.alpha * Math.min(1, k * 2.2);
  }
}

// ---------- levels: towers scattered over the island ----------
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

const forcedSeason = new URLSearchParams(location.search).get('season');
const seasonFor = () => forcedSeason || 'summer';   // summer only for now; winter is parked behind ?season=winter
let level = Math.max(1, parseInt(localStorage.getItem('lanternfall.level') || '1', 10) || 1);
let state = 'play', stateT = 0, combo = 0, comboT = 0, total = 0, cooldown = 0, camReady = false;
const sites = [];

function clearLevel() {
  for (const o of [...objs]) removeObj(o);
  pendingBurst.clear(); sites.length = 0;
}
function buildLevel() {
  clearLevel();
  const rng = mulberry(level * 7919 + 17);
  const n = Math.min(3 + level, 10);
  sites.push({ x: START.x + (level === 1 ? 0 : (rng() - 0.5) * 8), z: START.z - 11 });           // one straight ahead, so there is something to hit at once
  for (let tries = 0; sites.length < n && tries < 600; tries++) {
    const a = rng() * Math.PI * 2, rad = 5 + Math.sqrt(rng()) * (R - 9), x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (Math.hypot(x - START.x, z - START.z) < 9) continue;
    if (sites.some(s => Math.hypot(s.x - x, s.z - z) < 10)) continue;
    if (TREES.some(t => Math.hypot(t.x - x, t.z - z) < 5)) continue;
    sites.push({ x, z });
  }
  sites.forEach((s, i) => {
    const yaw = i === 0 ? (rng() - 0.5) * 0.4 : rng() * Math.PI, pick = level === 1 && i === 0 ? 0 : Math.floor(rng() * 3);
    const tall = Math.min(4, 2 + Math.floor(rng() * (1 + level / 3)));
    if (pick === 0) tower(s.x, s.z, yaw, tall, rng);
    else if (pick === 1) pyramid(s.x, s.z, yaw, Math.min(4, 2 + Math.floor(rng() * (1 + level / 3))));
    else gate(s.x, s.z, yaw);
  });
  total = lanterns.length;
  scenery.setSeason(seasonFor(level));
  player.x = START.x; player.z = START.z; player.face = 0; camYaw = 0; camReady = false;
  state = 'play'; stateT = 0; combo = 0; cooldown = 0;
  hud();
}

// ---------- HUD ----------
const elLvl = document.getElementById('lvl'), elLeft = document.getElementById('left'),
  elFade = document.getElementById('fade'), elHint = document.getElementById('hint'),
  elJoy = document.getElementById('joy'), elKnob = document.getElementById('knob');
if (localStorage.getItem('lanternfall.played')) elHint.classList.add('off');
function hud() { elLvl.textContent = level; elLeft.textContent = lanterns.length; }
document.getElementById('restart').addEventListener('click', e => { e.stopPropagation(); transition(false); });
function transition(next) {
  if (state === 'fade') return;
  state = 'fade'; elFade.classList.add('on');
  setTimeout(() => {
    if (next) { level++; localStorage.setItem('lanternfall.level', level); }
    buildLevel(); elFade.classList.remove('on');
  }, 480);
}

// ---------- input: left thumb walks, any other drag is pull-back-and-release to throw ----------
const joy = { id: null, x: 0, y: 0, sx: 0, sy: 0 };
const aim = { id: null, on: false, sx: 0, sy: 0, yaw: 0, power: 0, valid: false };
const keys = new Set();
const JOY_R = 56;
function inJoyZone(x, y) { return x < window.innerWidth * 0.5 && y > window.innerHeight * 0.55; }
function joyShow(on) {
  elJoy.classList.toggle('on', on);
  if (on) { elJoy.style.left = joy.sx + 'px'; elJoy.style.top = joy.sy + 'px'; elJoy.style.bottom = 'auto'; }
  else { elJoy.style.left = ''; elJoy.style.top = ''; elJoy.style.bottom = ''; }
  elKnob.style.transform = `translate(${joy.x * JOY_R}px, ${joy.y * JOY_R}px)`;
}
function aimFrom(x, y) {
  const dx = x - aim.sx, dy = y - aim.sy, h = window.innerHeight, w = window.innerWidth;
  aim.power = Math.min(1, Math.hypot(dx, dy) / (h * 0.26));
  aim.yaw = THREE.MathUtils.clamp(-dx / Math.min(w, h * 0.7), -0.5, 0.5) * 1.5;
  aim.valid = dy > 12 && aim.power > 0.08;
}
window.addEventListener('pointerdown', e => {
  sfx.init();
  if (e.target.closest && e.target.closest('#restart')) return;
  if (joy.id === null && e.pointerType !== 'mouse' && inJoyZone(e.clientX, e.clientY)) {
    joy.id = e.pointerId; joy.sx = e.clientX; joy.sy = e.clientY; joy.x = joy.y = 0; joyShow(true);
  } else if (aim.id === null) {
    aim.id = e.pointerId; aim.on = true; aim.sx = e.clientX; aim.sy = e.clientY; aim.valid = false; aim.power = 0; aim.t0 = performance.now();
  }
});
window.addEventListener('pointermove', e => {
  if (e.pointerId === joy.id) {
    let dx = (e.clientX - joy.sx) / JOY_R, dy = (e.clientY - joy.sy) / JOY_R; const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    joy.x = dx; joy.y = dy; joyShow(true);
  } else if (e.pointerId === aim.id) aimFrom(e.clientX, e.clientY);
});
function release(e, cancel) {
  if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; joyShow(false); }
  else if (e.pointerId === aim.id) {
    if (!cancel) {
      aimFrom(e.clientX, e.clientY);
      if (aim.valid) fling(aim.yaw, aim.power);
      else if (Math.hypot(e.clientX - aim.sx, e.clientY - aim.sy) < 14 && performance.now() - aim.t0 < 350) jump();
    }
    aim.id = null; aim.on = false;
  }
}
window.addEventListener('pointerup', e => release(e, false));
window.addEventListener('pointercancel', e => release(e, true));
window.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('keydown', e => { keys.add(e.code); if (e.code === 'Space') { e.preventDefault(); jump(); } });
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// ---------- throwing ----------
const dots = [];
{
  const g = new THREE.SphereGeometry(0.1, 10, 8);
  for (let i = 0; i < 20; i++) {
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 - i * 0.035, fog: false }));
    m.visible = false; scene.add(m); dots.push(m);
  }
}
const charge = new THREE.Mesh(sphereGeo, MAT.ball); charge.add(haloSprite(3.4, 0.4, 0xff8a3a)); charge.visible = false; scene.add(charge);
const tmpV = new THREE.Vector3(), tmpF = new THREE.Vector3(), hand = new THREE.Vector3();
function handPos(yaw, out) { fwd(yaw, tmpF); return out.set(player.x + tmpF.x * HAND_F, HAND_H + player.y, player.z + tmpF.z * HAND_F); }
function launchVel(yaw, power, out) {
  const speed = 8 + 18 * power, el = 0.08 + 0.12 * power;    // more pull throws harder and a little higher, so it goes farther
  return out.set(Math.sin(yaw) * Math.cos(el) * speed, Math.sin(el) * speed, -Math.cos(yaw) * Math.cos(el) * speed);
}
function showAim() {
  const on = aim.on && aim.valid && state === 'play' && cooldown <= 0;
  charge.visible = on;
  if (on) {
    const yaw = camYaw + aim.yaw;
    handPos(yaw, hand); launchVel(yaw, aim.power, tmpV);
    charge.position.copy(hand); charge.scale.setScalar(0.18 + aim.power * (BALL_R - 0.18));
  }
  dots.forEach((d, i) => {
    d.visible = on;
    if (!on) return;
    const t = (i + 1) * 0.06;
    d.position.set(hand.x + tmpV.x * t, Math.max(0.12, hand.y + tmpV.y * t - 7 * t * t), hand.z + tmpV.z * t);
  });
}
function fling(yawRel, power) {
  if (state !== 'play' || cooldown > 0) return false;
  const yaw = camYaw + yawRel;
  handPos(yaw, hand);
  const body = new CANNON.Body({ mass: 6, shape: new CANNON.Sphere(BALL_R) });
  body.position.set(hand.x, hand.y, hand.z);
  const v = launchVel(yaw, power, tmpV); body.velocity.set(v.x, v.y, v.z);
  body.angularDamping = 0.3; body.linearDamping = 0.02;
  const mesh = new THREE.Mesh(sphereGeo, MAT.ball); mesh.scale.setScalar(BALL_R); mesh.castShadow = true; mesh.add(haloSprite(3.4, 0.4, 0xff8a3a));
  mesh.position.copy(hand);
  register(body, mesh, 'ball');
  body.addEventListener('collide', e => {
    if (e.body.type !== CANNON.Body.STATIC) wakeNear(body.position, 7);
    onHit(e);
  });
  player.face = yaw; heroKick = 1; cooldown = 0.4;
  sfx.whoosh(power);
  if (!localStorage.getItem('lanternfall.played')) { localStorage.setItem('lanternfall.played', '1'); elHint.classList.add('off'); }
  return true;
}
function wakeNear(p, rad) {
  for (const o of objs) if (o.body.sleepState === CANNON.Body.SLEEPING && o.body.position.distanceSquared(p) < rad * rad) o.body.wakeUp();
}

// ---------- simulation ----------
let time = 0, acc = 0, slowT = 0;
const STEP = 1 / 120;

function burst(o) {
  if (!lanterns.includes(o)) return;
  const p = o.body.position;
  fireflies(p.x, p.y, p.z, 14);
  sfx.chime(combo++); comboT = 2.5; slowT = 0.12; shake = Math.max(shake, 0.1);
  removeObj(o); hud();
  if (lanterns.length === 0 && state === 'play') { state = 'won'; stateT = 0; sfx.win(); }
}
function physics(dt) {
  acc += dt;
  let n = 0;
  while (acc >= STEP && n++ < 8) { world.step(STEP); acc -= STEP; }
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
    o.age += dt;
    if (!o.splashed && p.y < -8) { o.splashed = true; splash(p.x, p.z, o.kind !== 'lantern'); if (o.kind === 'lantern') burst(o); }
    if (objs.includes(o) && (p.y < -22 || (o.kind === 'ball' && o.age > 7))) {
      if (o.kind === 'ball' && p.y > -5) dust(p.x, p.y, p.z, 3);
      removeObj(o);
    }
  }
  for (const o of objs) { o.mesh.position.copy(o.body.position); o.mesh.quaternion.copy(o.body.quaternion); }
}

function jump() {
  if (state !== 'play' || player.y > 0.01) return false;
  player.vy = JUMP_V; player.y = 0.011; sfx.whoosh(0.1);
  return true;
}
function movePlayer(dt) {
  if (player.y > 0 || player.vy > 0) {
    player.vy -= GRAVITY * dt; player.y += player.vy * dt;
    if (player.y <= 0) { player.y = 0; player.vy = 0; dust(player.x, 0.15, player.z, 3); sfx.thump(0.25); }
  }
  let jx = joy.x, jy = joy.y;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) jx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) jx += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) jy -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) jy += 1;
  if (window.__joy) { jx = window.__joy.x; jy = window.__joy.y; }
  let l = Math.hypot(jx, jy); if (l > 1) { jx /= l; jy /= l; l = 1; }
  if (state !== 'play') l = jx = jy = 0;
  player.moving += ((l > 0.12 ? l : 0) - player.moving) * Math.min(1, dt * 10);
  if (l > 0.12) {
    camYaw += jx * 1.15 * dt;                                // pushing sideways swings the view round as he walks
    const s = Math.sin(camYaw), c = Math.cos(camYaw);
    const mx = c * jx + s * -jy, mz = s * jx - c * -jy;      // right * jx + forward * (-jy)
    player.x += mx * SPEED * dt; player.z += mz * SPEED * dt;
    if (!(aim.on && aim.valid) && heroKick <= 0) player.face = Math.atan2(mx, -mz);
    player.walkT += dt * (5 + 6 * l);
  }
  // stay on the island, and out of trees and blocks
  const d = Math.hypot(player.x, player.z), lim = R - 1.3;
  if (d > lim) { player.x *= lim / d; player.z *= lim / d; }
  const push = (ox, oz, rad) => {
    const dx = player.x - ox, dz = player.z - oz, dd = Math.hypot(dx, dz);
    if (dd < rad && dd > 1e-4) { player.x = ox + dx / dd * rad; player.z = oz + dz / dd * rad; }
  };
  for (const t of TREES) push(t.x, t.z, 0.7 * t.s + 0.6);
  for (const o of objs) if (o.kind !== 'ball' && o.body.position.y < 2.4 + player.y && o.body.position.y > player.y - 0.5) push(o.body.position.x, o.body.position.z, 1.0);
}

const camPos = new THREE.Vector3(), camAt = new THREE.Vector3();
function updateCamera(dtReal) {
  if (window.__freecam) return;
  fwd(camYaw, tmpF);
  const aiming = aim.on && aim.valid, D0 = (portrait ? 8.6 : 7.4) + (aiming ? 1.2 : 0);
  let D = D0, H = portrait ? 4.6 : 3.8;
  // keep the camera out of the trees: slide it in toward the player, or duck under the canopy
  const blocked = (d, k) => TREES.some(t => Math.hypot(player.x - tmpF.x * d - t.x, player.z - tmpF.z * d - t.z) < k * t.s);
  while (D > 3 && blocked(D, 4.6)) D -= 0.5;
  if (D <= 3) { H = 2.3; D = D0 * 0.75; while (D > 1.6 && blocked(D, 1.2)) D -= 0.4; }
  camPos.set(player.x - tmpF.x * D, H + player.y * 0.5, player.z - tmpF.z * D);
  camAt.set(player.x + tmpF.x * 7, 1.7 + player.y * 0.5, player.z + tmpF.z * 7);
  const k = camReady ? Math.min(1, dtReal * 7) : 1; camReady = true;
  camera.position.lerp(camPos, k);
  shake = Math.max(0, shake - dtReal * 1.6);
  camera.position.x += rnd(shake) * 0.4; camera.position.y += rnd(shake) * 0.4;
  camera.lookAt(camAt);
}

function step(dtReal) {
  slowT = Math.max(0, slowT - dtReal);
  const dt = dtReal * (slowT > 0 ? 0.3 : 1);
  time += dt; stateT += dtReal; cooldown -= dt;
  if ((comboT -= dt) <= 0) combo = 0;

  movePlayer(dt);
  physics(dt);

  if (state === 'won') {
    if (Math.random() < dtReal * 30) fireflies(player.x + rnd(7), 0.3, player.z + rnd(7), 2, false);
    if (stateT > 3.2) transition(true);
  }

  // the thrower: turn to face where he walks or throws, and pick a clip for what he is doing
  const aiming = aim.on && aim.valid && state === 'play';
  if (aiming) player.face = camYaw + aim.yaw;
  let dy = -player.face - hero.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  hero.rotation.y += dy * Math.min(1, dtReal * 12);
  const bob = player.moving, stride = Math.sin(player.walkT);
  const air = player.y > 0, fake = CLIP.walk ? 0 : bob;      // with no walk clip he leans and bobs instead
  hero.position.set(player.x, player.y + (air ? 0 : Math.abs(stride) * 0.09 * fake), player.z);
  const tuck = air && !CLIP.jump ? THREE.MathUtils.clamp(player.vy / JUMP_V, -1, 1) * -0.22 : 0;
  heroTilt.rotation.set(-0.16 * fake + tuck, 0, stride * 0.05 * fake);
  if (heroLoaded) {
    heroKick = Math.max(0, heroKick - dtReal / THROW.hold);
    const mode = state === 'won' ? 'win' : heroKick > 0 ? 'throw' : aiming ? 'aim' : air && CLIP.jump ? 'jump' : player.moving > 0.25 && CLIP.walk ? 'walk' : 'idle';
    if (mode !== heroMode) {
      if (mode === 'win') heroPlay(CLIP.win || CLIP.idle, { fade: 0.4 });
      else if (mode === 'aim') heroPlay(THROW.clip, { fade: 0.18, speed: 0, at: THROW.wind });
      else if (mode === 'throw') heroPlay(THROW.clip, { fade: 0.08, speed: THROW.speed, once: true, at: heroMode === 'aim' ? null : THROW.wind });
      else if (mode === 'jump') heroPlay(CLIP.jump, { fade: 0.08, once: true, at: HOP.t0, speed: (HOP.t1 - HOP.t0) / (2 * JUMP_V / GRAVITY) });
      else if (mode === 'walk') heroPlay(CLIP.walk, { fade: 0.2 });
      else heroPlay(CLIP.idle, { fade: 0.35 });
      heroMode = mode;
    }
    if (mode === 'walk') heroAct.timeScale = 0.6 + player.moving * 1.5;
    mixer.update(dtReal);
  }

  showAim();
  for (const o of objs) {                                  // fire trail behind flying balls
    if (o.kind !== 'ball' || o.body.velocity.lengthSquared() < 9 || Math.random() > dt * 70) continue;
    const p = o.body.position;
    spawn(p.x + rnd(0.15), p.y + rnd(0.15), p.z + rnd(0.15), rnd(0.5), 0.8 + Math.random(), rnd(0.5), 0.35 + Math.random() * 0.3, 0.9,
      { color: Math.random() < 0.5 ? 0xff6a1a : 0xffb040, grow: -0.6, alpha: 0.8 });
  }
  for (const l of lanterns) l.glow.material.opacity = 0.62 + Math.sin(time * 2.2 + l.phase) * 0.14;
  updateParts(dt, time);
  scenery.update(time, player.x, player.z, camera, renderer.getPixelRatio());
  updateCamera(dtReal);
}

let last = performance.now(), detail = 1, fpsT = 0, fpsN = 0, fpsSum = 0;
function watchFrameRate(ms) {                              // if frames run long for a while, draw less grass
  if (ms > 250 || document.hidden) return;                 // tab was in the background
  fpsSum += ms; fpsN++; fpsT += ms;
  if (fpsT < 2500) return;
  const avg = fpsSum / fpsN; fpsT = fpsN = fpsSum = 0;
  if (avg > 24 && detail > 0.3) { detail = Math.max(0.3, detail * 0.72); scenery.setDetail(detail); }
}
function frame(now) {
  if (!window.__manual) watchFrameRate(now - last);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!window.__manual) step(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// Scripted stepping for tests (the preview pane only runs frames while visible).
window.game = {
  step(seconds = 1, dt = 1 / 60) { window.__manual = true; for (let t = 0; t < seconds; t += dt) step(dt); renderer.render(scene, camera); return this.state(); },
  fling, jump, debug: { scene, camera, hero, acts, THROW, THREE, player, sites, renderer, get mixer() { return mixer; } },
  walk(x, y) { window.__joy = x || y ? { x, y } : null; },
  setLevel(n) { level = n; buildLevel(); },
  setSeason(name) { scenery.setSeason(name); },
  auto() { window.__manual = false; },
  state() {
    return { heroLoaded, level, season: scenery.season, detail: +detail.toFixed(2), state, lanterns: lanterns.length, total, objects: objs.length, sites: sites.length,
      x: +player.x.toFixed(2), y: +player.y.toFixed(2), z: +player.z.toFixed(2), clips: { ...CLIP, throw: THROW.clip }, hop: [+HOP.t0.toFixed(2), +HOP.t1.toFixed(2)], mode: heroMode, camYaw: +camYaw.toFixed(2),
      moving: objs.filter(o => o.body.sleepState !== CANNON.Body.SLEEPING).length };
  },
};

buildLevel();
requestAnimationFrame(frame);
