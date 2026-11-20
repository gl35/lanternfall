import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildScenery, softTexture, R, START, TREES, WOODS, ROAM, hillHeight } from './scenery.js';
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
const player = { x: START.x, z: START.z, y: 0, g: 0, vy: 0, face: 0, moving: 0, walkT: 0 };   // y is height above the ground, g the ground's height under him
const JUMP_V = 8.2, GRAVITY = 20;
let camYaw = 0;                                            // 0 looks toward -z; forward = (sin, 0, -cos)
let SPEED = 4.8, HAND_H = 2.15;
const HAND_F = 0.9, BALL_R = 0.45;
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
  else if (!acts[THROW.clip] && CLIP.jump) Object.assign(THROW, { clip: CLIP.jump, wind: HOP.t0, speed: 1.5, hold: 0.6 });   // no throw of her own: she hops as she lets go
  if (!CLIP.win) CLIP.win = find(/laugh/i);
}
// The heroes to pick from. A mount has no clips: it gallops by rocking and bounding, and covers ground faster.
const HEROES = [
  { file: 'general-animated.glb', scale: 2.5, turn: Math.PI, lift: 0, speed: 4.8, hand: 2.15, cam: 0 },
  { file: 'warrior.glb', scale: 4.4, turn: Math.PI, lift: 0.489, speed: 9.5, hand: 3.3, cam: 1, mount: true },
  { file: 'woman.glb', scale: 2.7, turn: Math.PI, lift: 0, speed: 5.0, hand: 2.15, cam: 0, glide: true },   // modelled in one fixed pose, with no clips: she drifts over the grass
  { file: 'kid.glb', scale: 1.9, turn: Math.PI, lift: 0, speed: 4.8, hand: 1.6, cam: -0.2, fly: true },   // a copy of the kid, made when her model loads
];
const KID = 3;
let heroIx = 0, HERO = HEROES[heroIx], heroModel = null, heroLoads = 0;
const heroCache = {};
function setHero(i) {
  heroIx = (i + HEROES.length) % HEROES.length; HERO = HEROES[heroIx];
  SPEED = HERO.speed; HAND_H = HERO.hand;
  const want = ++heroLoads, show = g => {
    if (want !== heroLoads) return;                                // he picked another one meanwhile
    if (heroModel) heroTilt.remove(heroModel);
    if (mixer) mixer.stopAllAction();
    for (const k in acts) delete acts[k];
    Object.assign(CLIP, { idle: null, walk: null, jump: null, win: null });
    Object.assign(THROW, { clip: 'box_02', wind: 2.0, speed: 1.3, hold: 0.8 });
    heroAct = null; heroMode = ''; wings.visible = false;
    mixer = new THREE.AnimationMixer(g.scene);
    for (const c of g.animations) acts[c.name] = mixer.clipAction(c);
    pickClips(); heroModel = g.scene; heroTilt.add(heroModel); heroLoaded = true;
  };
  if (heroCache[HERO.file]) return show(heroCache[HERO.file]);
  loadHero(HERO, show);
}
function loadHero(H, show) {
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(import.meta.env.BASE_URL + 'models/' + H.file, g => {
    g.scene.scale.setScalar(H.scale); g.scene.rotation.y = H.turn; g.scene.position.y = H.lift * H.scale;   // turned to face "forward", feet on the ground
    g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } if (o.isSkinnedMesh) o.frustumCulled = false; });
    for (const c of g.animations) for (const t of c.tracks) {      // the game moves him, not the clips
      if (!/Hips\.position$/.test(t.name)) continue;
      for (let i = 0; i < t.values.length; i += 3) { t.values[i] = t.values[0]; t.values[i + 2] = t.values[2]; }
    }
    if (H.mount) { g.scene.position.y = 0; g.scene.updateMatrixWorld(true); g.scene.position.y = -new THREE.Box3().setFromObject(g.scene, true).min.y; }   // hooves on the grass
    heroCache[H.file] = g; if (show) show(g);
    if (H === HEROES[0]) loadHero(HEROES[2], () => park(2, -5, 0, START.z - 8.5, Math.PI + 0.5));   // she waits a little way ahead
  }, undefined, e => console.error('character model failed to load', e));
}
setHero(heroIx);
loadHero(HEROES[1]);

// The rider waits at the meadow's edge and turns to watch him when he comes near.
const npc = { x: 0, z: 0, r: 2.1, group: new THREE.Group(), face: 0, rear: 0 };
const REAR = 1;
npc.group.rotation.order = 'YXZ';
{
  let best = null;
  for (let k = 0; k < 40; k++) {                             // an open spot near the edge, away from trees and from where he starts
    const a = 0.9 + k * 0.37, x = Math.cos(a) * (R - 6), z = Math.sin(a) * (R - 6);
    const room = Math.min(...TREES.map(t => Math.hypot(t.x - x, t.z - z)), Math.hypot(x - START.x, z - START.z) - 6);
    if (!best || room > best.room) best = { x, z, room };
    if (room > 9) break;
  }
  npc.x = best.x; npc.z = best.z; npc.face = Math.atan2(-best.x, -best.z) + Math.PI;
  npc.group.position.set(npc.x, 0, npc.z); npc.group.rotation.y = npc.face; scene.add(npc.group);
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(import.meta.env.BASE_URL + 'models/warrior.glb', g => {
    const m = g.scene; m.scale.setScalar(4.4); m.rotation.y = Math.PI;
    m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } if (o.isSkinnedMesh) o.frustumCulled = false; });
    m.updateMatrixWorld(true);
    m.position.y = -new THREE.Box3().setFromObject(m, true).min.y;       // hooves on the grass, measured from the model itself
    npc.group.add(m); npc.loaded = true;
  }, undefined, e => console.error('rider model failed to load', e));
}
// A kid at play in the meadow: dashes somewhere, stops, laughs, turns a flip, hops, wanders off again -
// and every so often runs over to see what he is doing.
const kid = { x: START.x + 7, z: START.z - 4, face: 0, group: new THREE.Group(), mixer: null, acts: {}, act: null, mode: 'wait', t: 1, tx: 0, tz: 0, speed: 0, visit: false, goal: null, ride: null, bones: {}, pose: null };
{
  kid.group.position.set(kid.x, 0, kid.z); scene.add(kid.group);
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(import.meta.env.BASE_URL + 'models/kid.glb', g => {
    const m = g.scene; m.scale.setScalar(1.9);
    m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } if (o.isSkinnedMesh) o.frustumCulled = false; });
    for (const c of g.animations) for (const t of c.tracks) {      // the game moves the kid, not the clips
      if (!/Hips\.position$/.test(t.name)) continue;
      for (let i = 0; i < t.values.length; i += 3) { t.values[i] = t.values[0]; t.values[i + 2] = t.values[2]; }
    }
    m.traverse(o => { if (o.isBone) kid.bones[o.name.replace(/^mixamorig:?/, '')] = { bone: o, bind: o.quaternion.clone() }; });
    kid.model = m;
    kid.mixer = new THREE.AnimationMixer(m);
    for (const c of g.animations) kid.acts[c.name] = kid.mixer.clipAction(c);
    const twin = cloneSkinned(m); twin.rotation.y = Math.PI;
    twin.traverse(o => { if (o.isBone) flyBones[o.name.replace(/^mixamorig:?/, '')] = { bone: o, bind: o.quaternion.clone() }; }); heroCache['kid.glb'] = { scene: twin, animations: g.animations };   // the one he can steer
    kid.group.add(m); kidPlay('idle');
  }, undefined, e => console.error('kid model failed to load', e));
}
function kidPlay(name, once = false, speed = 1) {
  const a = kid.acts[name]; if (!a || a === kid.act) return a ? a.getClip().duration / speed : 1;
  a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = once; a.timeScale = speed;
  a.fadeIn(0.2).play(); if (kid.act) kid.act.fadeOut(0.2); kid.act = a;
  return a.getClip().duration / speed;
}
// Poses the clips don't have, as turns (in degrees) added to each bone's rest pose.
const KID_POSE = {
  stand: { LeftArm: [58, 0, 0], RightArm: [58, 0, 0] },                                                                           // standing on the plank, hands up on the ropes
  lie: { LeftArm: [-72, 0, 0], RightArm: [-72, 0, 0] },                                                                            // arms by the sides
};
const flyBones = {}, FLY_POSE = { LeftArm: [20, 0, 0], RightArm: [20, 0, 0], LeftForeArm: [0, 0, 0], RightForeArm: [0, 0, 0], LeftHand: [0, 0, 0], RightHand: [0, 0, 0] };   // arms straight out to the sides, like wings
let flyW = 0, wingW = 0;
const FLY_ZERO = [0, 0, 0];
// White wings that open from her back while she flies: a fan of long feathers with a row of short ones over them.
const wings = new THREE.Group(), wingP = new THREE.Vector3();
{
  // one feather: a long leaf with a pointed tip, lying along +x, shaded from a cool grey at the quill to white at the tip
  const featherGeo = new THREE.BufferGeometry();
  {
    const N = 10, pos = [], col = [], idx = [];
    for (let k = 0; k <= N; k++) {
      const t = k / N, wd = Math.sin(Math.min(1, t * 1.15 + 0.06) * Math.PI) ** 0.75 * (1 - 0.25 * t), z = -0.06 * t * t;   // widest a third along, drawn to a point
      for (const e of [-1, 0, 1]) { pos.push(t, e * wd, z + (e ? 0 : 0.22 * wd)); const c = e ? 0.7 + 0.12 * t : 1; col.push(c * 0.95, c * 0.975, c); }   // a raised quill, edges in soft shadow
      if (k < N) { const a = k * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
    }
    featherGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); featherGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    featherGeo.setIndex(idx); featherGeo.computeVertexNormals();
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.6, side: THREE.DoubleSide, emissive: 0xaab4c8, emissiveIntensity: 0.3 });
  const edge = t => [0.95 * t, 0.4 * Math.sin(Math.min(1, t * 1.55) * Math.PI * 0.5) - 0.3 * Math.max(0, t - 0.62) ** 1.5 * 4];   // rises to the wrist, then sweeps out and down
  for (const side of [1, -1]) {
    const w = new THREE.Group();
    const row = (n, len, wide, z, drop) => {
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1), [x, y] = edge(t), a = (-100 + 78 * t ** 1.15) * Math.PI / 180, f = new THREE.Mesh(featherGeo, mat);
        f.scale.set(len(t) * (k % 2 ? 1 : 0.94), wide, 1); f.position.set(x, y - drop, z + k * 0.0015); f.rotation.set((k % 2 ? 0.16 : -0.1), 0, a); f.castShadow = true; w.add(f);
      }
    };
    row(15, t => 0.5 + 0.62 * Math.sin((0.12 + 0.88 * t) * Math.PI * 0.62), 0.075, 0, 0);         // flight feathers, longest toward the tip
    row(13, t => 0.3 + 0.24 * Math.sin((0.2 + 0.8 * t) * Math.PI * 0.7), 0.065, -0.03, 0);         // a shorter row over them
    row(12, t => 0.17 + 0.08 * t, 0.055, -0.055, -0.02);                                           // small ones along the edge
    w.scale.x = side; w.position.x = side * 0.05; wings.add(w);
  }
  wings.visible = false; heroTilt.add(wings);
}
const kidE = new THREE.Euler(), kidQ = new THREE.Quaternion(), kidQ2 = new THREE.Quaternion(), D2R = Math.PI / 180;
function kidPose() {
  for (const n in kid.pose) { const b = kid.bones[n]; if (!b) continue; const [x, y, z] = kid.pose[n]; b.bone.quaternion.copy(b.bind).multiply(kidQ.setFromEuler(kidE.set(x * D2R, y * D2R, z * D2R))); }
}
function kidMount(kind) {
  const e = play[kind]; kid.ride = kind; kid.mode = 'ride'; kid.t = 9 + Math.random() * 8; kid.goal = null; e.rider = true;
  kid.mixer.stopAllAction(); kid.act = null; kid.x = e.x; kid.z = e.z;
  const g = kid.group; g.rotation.set(0, 0, 0);
  if (kind === 'swing') { e.pivot.add(g); g.position.set(0, -e.L + 0.035, 0); kid.pose = KID_POSE.stand; e.want = 0.55; }
  else { e.sway.add(g); g.rotation.order = 'YXZ'; g.rotation.set(-Math.PI / 2, Math.PI / 2, 0); g.position.set(0.95, -0.5 - e.drop, 0); kid.pose = KID_POSE.lie; e.want = 0.1; }
}
function kidDismount() {
  const e = play[kid.ride]; if (!e) return;
  e.rider = false; e.want = kid.ride === 'swing' ? 0.05 : 0.02;
  const a = e.g.rotation.y + (kid.ride === 'swing' ? 0 : Math.PI / 2);
  kid.x = e.x + Math.sin(a) * 1.9; kid.z = e.z + Math.cos(a) * 1.9; kid.face = a;
  for (const n in kid.bones) { const b = kid.bones[n]; b.bone.quaternion.copy(b.bind); }
  kid.pose = null; kid.ride = null; scene.add(kid.group);
  kid.group.rotation.order = 'XYZ'; kid.group.rotation.set(0, a, 0); kid.group.position.set(kid.x, 0, kid.z);
  kid.mode = 'wait'; kid.t = Math.min(1.4, kidPlay('jump', true, 1.3));
}
function kidGo(x, z, run) {
  kid.tx = x; kid.tz = z; kid.mode = 'go'; kid.t = 9; kid.speed = run ? 5.6 : 1.5;
  kidPlay(run ? 'run' : Math.random() < 0.4 ? 'swagger' : 'walk', false, run ? 1.15 : 1);
}
function updateKid(dt, dtReal) {
  if (!kid.mixer || (kid.away && !player.ride)) return;
  kid.mixer.update(dtReal);
  if (kid.mode === 'ride') {
    kid.t -= dt; kidPose();
    if (kid.ride === 'swing') {                                    // legs straight and still on the plank
      const dip = 0;
      for (const [n, deg] of [['LeftUpLeg', -22], ['RightUpLeg', -22], ['LeftLeg', 44], ['RightLeg', 44]]) { const b = kid.bones[n]; if (b) b.bone.quaternion.copy(b.bind).multiply(kidQ.setFromEuler(kidE.set(deg * dip * D2R, 0, 0))); }
      kid.group.position.y = -play.swing.L + 0.035 - 0.07 * dip;
    }
    if (kid.t <= 0 && !player.ride) kidDismount();
    return;
  }
  const toP = Math.hypot(player.x - kid.x, player.z - kid.z), inMeadow = Math.hypot(player.x, player.z) < R;
  kid.t -= dt;
  if (kid.mode === 'go') {
    const dx = kid.tx - kid.x, dz = kid.tz - kid.z, d = Math.hypot(dx, dz);
    if (kid.goal && d < 1.0) { kidMount(kid.goal); return; }
    if (d < 0.5 || kid.t <= 0 || (kid.visit && toP < 3.2)) {       // there: now do something
      kid.goal = null;
      const pick = Math.random(), near = kid.visit || toP < 7; kid.visit = false; kid.mode = 'wait';
      if (near) kid.face = Math.atan2(player.x - kid.x, player.z - kid.z);
      if (pick < 0.3) kid.t = Math.min(3.5, kidPlay('laugh_01', true));
      else if (pick < 0.5) kid.t = kidPlay('flip', true);
      else if (pick < 0.68) kid.t = kidPlay('jump', true);
      else if (pick < 0.8 && near) kid.t = kidPlay('agree', true);
      else { kidPlay('idle'); kid.t = 1 + Math.random() * 2.5; }
    } else {
      const want = Math.atan2(dx, dz); let da = want - kid.face; da = Math.atan2(Math.sin(da), Math.cos(da));
      kid.face += da * Math.min(1, dt * 7);
      kid.x += Math.sin(kid.face) * kid.speed * dt; kid.z += Math.cos(kid.face) * kid.speed * dt;
    }
  } else if (kid.t <= 0 && kid.flee) {
    const lim = R - 5; let x = kid.x + kid.flee.x * 14, z = kid.z + kid.flee.z * 14; const d = Math.hypot(x, z);
    if (d > lim) { x *= lim / d; z *= lim / d; }
    kid.flee = null; kidGo(x, z, true);
  } else if (kid.t <= 0) {                                         // off again
    if (Math.random() < 0.3) {                                      // to the swing or the hammock
      const kind = Math.random() < 0.6 ? 'swing' : 'hammock', e = play[kind], a = e.g.rotation.y + (kind === 'swing' ? Math.PI : Math.PI / 2);
      kidGo(e.x + Math.sin(a) * 1.9, e.z + Math.cos(a) * 1.9, true); kid.goal = kind;
    }
    else if (inMeadow && toP > 6 && Math.random() < 0.3) { kid.visit = true; kidGo(player.x, player.z, true); }
    else {
      const a = Math.random() * 6.283, far = Math.random() < 0.65, rad = far ? 6 + Math.random() * 14 : 2 + Math.random() * 4;
      let x = kid.x + Math.cos(a) * rad, z = kid.z + Math.sin(a) * rad; const d = Math.hypot(x, z), lim = R - 5;
      if (d > lim) { x *= lim / d; z *= lim / d; }
      kidGo(x, z, far);
    }
  }
  const out = (ox, oz, rad) => { const dx = kid.x - ox, dz = kid.z - oz, dd = Math.hypot(dx, dz); if (dd < rad && dd > 1e-4) { kid.x = ox + dx / dd * rad; kid.z = oz + dz / dd * rad; } };
  for (const t of TREES) out(t.x, t.z, 0.7 * t.s + 0.5);
  for (const st of sites) out(st.x, st.z, 3.6);
  if (!kid.goal) for (const q of play.spots) out(q.x, q.z, q.r);                    // keeps clear of the towers
  if (!npc.away) out(npc.x, npc.z, npc.r); out(player.x, player.z, HERO.mount ? 2.1 : 1.0);
  kid.group.position.set(kid.x, hillHeight(kid.x, kid.z), kid.z);
  let dy = kid.face - kid.group.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  kid.group.rotation.y += dy * Math.min(1, dt * 10);
}

// Swapping who he steers. The one left behind stays in the world: the general stands where he was, the kid goes back to playing.
const mkStand = () => { const g = new THREE.Group(); g.visible = false; scene.add(g); return { on: false, x: 0, z: 0, group: g, mixer: null }; };
const stand = mkStand(), stand2 = mkStand(), STANDS = { 0: stand, 2: stand2 };
function park(ix, x, y, z, ry) {
  const st = STANDS[ix], g = heroCache[HEROES[ix].file];
  st.x = x; st.z = z; st.on = true; st.group.visible = true; st.group.position.set(x, y, z); st.group.rotation.y = ry; st.group.add(g.scene);
  st.mixer = new THREE.AnimationMixer(g.scene);
  const c = g.animations.find(c => /idle|breath|stand/i.test(c.name)) || g.animations.find(c => /look/i.test(c.name)) || g.animations[0];
  if (c) st.mixer.clipAction(c).play();
}
function standStruck() {}
function stand2Struck() {}
// Steering the kid, he can walk her onto the swing or into the hammock; pushing the stick again (or a jump) gets her off.
function playerMount(kind) {
  const e = play[kind];
  player.ride = kind; player.rideFree = false; player.x = e.x; player.z = e.z; player.moving = 0;
  hero.visible = false; kid.group.visible = true; kidMount(kind); sfx.chime(4);
}
function playerDismount() {
  if (!player.ride) return;
  player.rideLock = player.ride; player.ride = null;
  kidDismount(); kid.mixer.stopAllAction(); kid.act = null; kid.group.visible = false;
  player.x = kid.x; player.z = kid.z; player.face = Math.PI - kid.face; hero.rotation.y = -player.face; hero.visible = true;
  player.vy = JUMP_V * 0.6; player.y = 0.01;                                      // hops down
}
const SWAP = [0, KID, 2, 1];                                // the general, the kid, the warrior woman, the rider
function swapHero() {
  playerDismount(); player.y = 0; player.vy = 0;
  const ready = ix => heroCache[HEROES[ix].file] && (ix === KID ? kid.mixer : ix === 1 ? npc.loaded : ix === 2 ? stand2.on : true);
  const from = heroIx; let to = from;
  for (let k = 1; k < SWAP.length && to === from; k++) { const ix = SWAP[(SWAP.indexOf(from) + k) % SWAP.length]; if (ready(ix)) to = ix; }
  if (to === from || state !== 'play' || aim.on) return false;
  player.flying = false;
  const px = player.x, pz = player.z, py = player.g, ry = hero.rotation.y;
  if (to === KID && kid.ride) kidDismount();
  if (STANDS[to] && STANDS[to].mixer) { STANDS[to].mixer.stopAllAction(); STANDS[to].mixer = null; }
  setHero(to);
  // whoever he was is left standing where he stood
  if (STANDS[from]) {
    park(from, px, py, pz, ry);
  } else if (from === KID) {
    kid.x = px; kid.z = pz; kid.face = Math.PI - player.face; kid.group.rotation.y = kid.face; kid.group.position.set(px, py, pz);
    kid.away = false; kid.group.visible = true; kid.mode = 'wait'; kid.t = 1.2; kid.visit = false; kid.goal = null; kid.flee = null; kidPlay('idle');
  } else {
    npc.x = px; npc.z = pz; npc.gy = py; npc.face = ry; npc.rear = 0; npc.group.position.set(px, py, pz); npc.group.rotation.set(0, ry, 0);
    npc.away = false; npc.group.visible = true;
  }
  // and he takes over the next one where they are
  if (STANDS[to]) { const st = STANDS[to]; player.x = st.x; player.z = st.z; st.on = false; st.group.visible = false; }
  else if (to === KID) { player.x = kid.x; player.z = kid.z; kid.away = true; kid.group.visible = false; }
  else { player.x = npc.x; player.z = npc.z; npc.away = true; npc.group.visible = false; }
  player.face = camYaw; hero.rotation.y = -player.face; camReady = false;
  fireflies(player.x, hillHeight(player.x, player.z) + 1.4, player.z, 16);
  return true;
}
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
addStatic(new CANNON.Cylinder(R + 26, R + 26, 2, 48), 0, -1, 0);                           // the meadow floor, a little past where he can walk
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

// ---------- fire ----------
// A flame is an upright card that always faces the camera. Its shape is drawn in the shader: a teardrop whose
// edge and tip are eaten away by noise scrolling upward, so tongues lick up and break off, coloured in
// a few flat bands from a pale core through yellow and orange to deep red - painted fire, not a glowing ball.
const FIRE_T = { value: 0 };
const flameGeo = new THREE.PlaneGeometry(1, 1);
function flameMaterial(w, h, seed, base = 0, heat = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: FIRE_T, uSize: { value: new THREE.Vector2(w, h) }, uSeed: { value: seed }, uBase: { value: base }, uHeat: { value: heat } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `uniform vec2 uSize; uniform float uBase; varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        float sc = length(modelMatrix[0].xyz);                                                   // grows with whatever it sits on
        c.xyz += (vec3(1.0, 0.0, 0.0) * (uv.x - 0.5) * uSize.x + up * (uv.y - uBase) * uSize.y) * sc;
        gl_Position = projectionMatrix * c;
      }`,
    fragmentShader: `uniform float uTime, uSeed, uHeat; varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fbm(vec2 p) { return noise(p) * 0.6 + noise(p * 2.1 + 7.3) * 0.28 + noise(p * 4.3 + 2.1) * 0.12; }
      void main() {
        float y = vUv.y, t = uTime + uSeed * 9.0;
        float sway = (fbm(vec2(uSeed * 3.0, y * 1.6 - t * 1.3)) - 0.5) * 0.7 * y;              // the whole flame leans and snakes
        float x = (vUv.x - 0.5) * 2.0 - sway;
        float w = 0.92 * pow(1.0 - y, 0.75) * (0.5 + 0.5 * smoothstep(0.0, 0.2, y));           // teardrop, pinched at the foot
        float body = 1.0 - abs(x) / max(w, 0.001);
        float lick = fbm(vec2(x * 2.6 + uSeed * 5.0, y * 3.4 - t * 2.6));                        // tongues climbing
        float fine = noise(vec2(x * 7.0, y * 8.0 - t * 4.4));
        float f = body - (lick * 0.95 + fine * 0.25) * (0.25 + 1.15 * y);
        f = f * uHeat + (1.0 - y) * 0.28 * step(0.0, body);
        if (f < 0.05) discard;
        vec3 col = vec3(0.78, 0.13, 0.04);                                                       // deep red rim
        col = mix(col, vec3(1.0, 0.36, 0.05), smoothstep(0.10, 0.16, f));                        // orange
        col = mix(col, vec3(1.0, 0.68, 0.10), smoothstep(0.26, 0.33, f));                        // amber
        col = mix(col, vec3(1.0, 0.90, 0.38), smoothstep(0.46, 0.54, f));                        // yellow
        col = mix(col, vec3(1.0, 0.98, 0.84), smoothstep(0.70, 0.80, f));                        // pale core
        gl_FragColor = vec4(col, smoothstep(0.05, 0.11, f));
        #include <colorspace_fragment>
      }`,
  });
}
function flame(w, h, seed, base, heat) {
  const m = new THREE.Mesh(flameGeo, flameMaterial(w, h, seed, base, heat)); m.frustumCulled = false; m.renderOrder = 3; return m;
}
const ballFlameMat = [flameMaterial(3.6, 5.0, 0.3, 0.26, 1.1), flameMaterial(2.6, 3.6, 0.7, 0.26, 1.3), flameMaterial(1.7, 2.3, 0.1, 0.28, 1.7)];
const noBall = new THREE.MeshBasicMaterial({ visible: false });   // the ball itself is never drawn
function ballFlames(mesh) {                                  // fire wrapped round a thrown ball: a wide back flame and a hotter inner one
  for (const mat of ballFlameMat) { const m = new THREE.Mesh(flameGeo, mat); m.frustumCulled = false; m.renderOrder = 3; mesh.add(m); }
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
// ---------- the kid's corner: a swing and a hammock ----------
const play = { swing: null, hammock: null, spots: [] };
{
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0xe9dcb8, roughness: 1 }), UP = new THREE.Vector3(0, 1, 0), V = (x, y, z) => new THREE.Vector3(x, y, z);
  const bar = (a, b, r, mat) => {                           // a round pole from a to b
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 12), mat); m.castShadow = m.receiveShadow = true;
    m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize()); return m;
  };
  const knob = (p, r, mat) => { const m = new THREE.Mesh(sphereGeo, mat); m.scale.setScalar(r); m.position.copy(p); m.castShadow = true; return m; };
  // the hammock hangs between the two trees that stand closest together; the swing takes the open spot nearest to where he starts
  const clear = (x, z) => Math.hypot(x - START.x, z - START.z) > 8 && Math.hypot(x - START.x, z - START.z + 11) > 9 && Math.hypot(x - npc.x, z - npc.z) > 7;
  let pair = null;
  for (let i = 0; i < TREES.length; i++) for (let j = i + 1; j < TREES.length; j++) {
    const a = TREES[i], b = TREES[j], len = Math.hypot(a.x - b.x, a.z - b.z), mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    if (len < 6.5 || len > 11 || Math.hypot(mx, mz) > R - 6 || !clear(mx, mz)) continue;
    const d = len * 3 + Math.hypot(mx - START.x, mz - START.z) * 0.5;
    if (!pair || d < pair.d) pair = { a, b, len, d };
  }
  const best = pair ? { hx: (pair.a.x + pair.b.x) / 2, hz: (pair.a.z + pair.b.z) / 2 } : { hx: -20, hz: 9 };
  const ok = (x, z) => Math.hypot(x, z) < R - 7 && TREES.every(t => Math.hypot(t.x - x, t.z - z) > 5.5) && clear(x, z) && Math.hypot(x - best.hx, z - best.hz) > 7;
  best.x = -14; best.z = 14; best.d = 1e9;
  for (let x = -R; x <= R; x += 1.5) for (let z = -R; z <= R; z += 1.5) {
    const d = Math.hypot(x - START.x, z - START.z);
    if (d < best.d && ok(x, z)) { best.x = x; best.z = z; best.d = d; }
  }
  const face = (x, z) => Math.atan2(START.x - x, START.z - z);

  // the swing: an A-frame of poles, two ropes and a plank
  {
    const g = new THREE.Group(); g.position.set(best.x, 0, best.z); g.rotation.y = face(best.x, best.z) + 0.5;
    const H = 3.7, L = 2.9;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(bar(V(sx * 1.55, -0.1, sz * 1.35), V(sx * 1.28, H + 0.12, -sz * 0.07), 0.085, MAT.wood));
    g.add(bar(V(-1.56, H, 0), V(1.56, H, 0), 0.095, MAT.dark), knob(V(-1.56, H, 0), 0.13, MAT.dark), knob(V(1.56, H, 0), 0.13, MAT.dark));
    const pivot = new THREE.Group(); pivot.position.y = H;
    for (const sx of [-1, 1]) pivot.add(bar(V(sx * 0.56, 0, 0), V(sx * 0.56, -L, 0), 0.024, ropeMat));
    const seat = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.07, 0.34, 3, 0.03), MAT.dark); seat.position.y = -L; seat.castShadow = true; pivot.add(seat);
    g.add(pivot); scene.add(g);
    play.swing = { x: best.x, z: best.z, g, pivot, amp: 0.05, want: 0.05, L, rider: false };
    play.spots.push({ x: best.x, z: best.z, r: 1.7 });
  }
  // the hammock: striped cloth roped to two trees (or to its own posts, were there no two trees near enough)
  {
    const g = new THREE.Group(); g.position.set(best.hx, 0, best.hz);
    g.rotation.y = pair ? Math.atan2(-(pair.b.z - pair.a.z), pair.b.x - pair.a.x) : face(best.hx, best.hz) + 1.2;
    const PX = pair ? pair.len / 2 : 2.4, TIE = pair ? 2.7 : 1.6, DROP = pair ? 0.85 : 0.1, HL = 1.6, KX = HL + 0.5;
    if (!pair) for (const sx of [-1, 1]) g.add(bar(V(sx * (PX - 0.12), -0.1, 0), V(sx * PX, TIE, 0), 0.085, MAT.wood), knob(V(sx * PX, TIE, 0), 0.11, MAT.dark));
    const sway = new THREE.Group(); sway.position.y = TIE;                // it rocks about the line between the two ties
    const geo = new THREE.PlaneGeometry(HL * 2, 1, 28, 10), p = geo.attributes.position, col = [], c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / HL, v = p.getY(i), k = 1 - u * u;
      p.setXYZ(i, u * HL, -DROP - 0.62 * (1 - u * u * u * u) + 1.5 * v * v * (0.35 + 0.65 * k), v * (0.3 + 0.75 * Math.sqrt(Math.max(0, k)) ) * 1.05);
      c.set(Math.floor((v + 0.5) * 6.999) % 2 ? 0xf3ead2 : 0xd9503a); col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
    const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.95 })); cloth.castShadow = cloth.receiveShadow = true;
    sway.add(cloth);
    for (const sx of [-1, 1]) {                                           // cords gather to a knot, and one rope runs from it up to the trunk
      const kn = V(sx * KX, -DROP + 0.13, 0);
      for (const z of [-0.16, 0, 0.16]) sway.add(bar(V(sx * HL, -DROP + 1.5 * 0.25 * 0.35 * (z ? 1 : 0), z), kn, 0.012, ropeMat));
      sway.add(knob(kn, 0.045, ropeMat), bar(kn, V(sx * PX, 0, 0), 0.03, ropeMat));
    }
    g.add(sway); scene.add(g);
    play.hammock = { x: best.hx, z: best.hz, g, sway, amp: 0.02, want: 0.02, rider: false, drop: DROP };
    play.spots.push({ x: best.hx, z: best.hz, r: 1.5 });
  }
}
function updatePlay(dt) {
  const sw = play.swing, hm = play.hammock;
  sw.amp += (sw.want - sw.amp) * Math.min(1, dt * 0.7); hm.amp += (hm.want - hm.amp) * Math.min(1, dt * 0.8);
  sw.pivot.rotation.x = Math.sin(time * 1.9) * sw.amp;
  hm.sway.rotation.x = Math.sin(time * 1.5) * hm.amp;
}

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
    if (play.spots.some(p => Math.hypot(p.x - x, p.z - z) < 6.5)) continue;
    if (Math.hypot(npc.x - x, npc.z - z) < 8.5) continue;       // nothing is built where the rider stands
    if ([stand, stand2].some(st => st.on && Math.hypot(st.x - x, st.z - z) < 6)) continue;
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
  playerDismount(); player.y = 0; player.vy = 0; player.rideLock = null; player.flying = false;
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
document.getElementById('hero').addEventListener('click', e => { e.stopPropagation(); if (swapHero()) sfx.chime(2); });
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
  if (e.target.closest && e.target.closest('#restart, #hero')) return;
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
const charge = new THREE.Mesh(sphereGeo, noBall); charge.add(haloSprite(3.0, 0.3, 0xff8a3a)); ballFlames(charge); charge.visible = false; scene.add(charge);
const tmpV = new THREE.Vector3(), tmpF = new THREE.Vector3(), hand = new THREE.Vector3();
function handPos(yaw, out) { fwd(yaw, tmpF); return out.set(player.x + tmpF.x * HAND_F, HAND_H + player.y + player.g, player.z + tmpF.z * HAND_F); }
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
    d.position.set(hand.x + tmpV.x * t, Math.max(player.g + 0.12, hand.y + tmpV.y * t - 7 * t * t), hand.z + tmpV.z * t);
  });
}
function fling(yawRel, power) {
  if (state !== 'play' || cooldown > 0) return false;
  const yaw = camYaw + yawRel;
  handPos(yaw, hand);
  for (const off of HERO.fly ? [-0.15, 0, 0.15] : [0]) {
  const body = new CANNON.Body({ mass: 6, shape: new CANNON.Sphere(BALL_R) });
  body.position.set(hand.x, hand.y, hand.z);
  const v = launchVel(yaw + off, power, tmpV); body.velocity.set(v.x, v.y, v.z);
  body.angularDamping = 0.3; body.linearDamping = 0.02;
  const mesh = new THREE.Mesh(sphereGeo, noBall); mesh.scale.setScalar(BALL_R); mesh.add(haloSprite(3.0, 0.3, 0xff8a3a)); ballFlames(mesh);
  mesh.position.copy(hand);
  register(body, mesh, 'ball');
  body.addEventListener('collide', e => {
    if (e.body.type !== CANNON.Body.STATIC) wakeNear(body.position, 7);
    onHit(e);
  });
  }
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
// A tree to a fireball: a trunk, and a crown shaped like a flattened ball. It bounces off either.
function ballTree(o, tx, tz, ty, m) {
  const p = o.body.position, v = o.body.velocity, dx = p.x - tx, dz = p.z - tz, hd = Math.hypot(dx, dz);
  if (hd > 3.3 * m) return;
  const cy = (p.y - ty - 4.2 * m) / (1.7 * m), cr = hd / (2.9 * m), crown = cy * cy + cr * cr < 1, trunk = hd < 0.42 * m + BALL_R && p.y < ty + 3 * m;
  if (!crown && !trunk) return;
  const nx = hd > 1e-3 ? dx / hd : 1, nz = hd > 1e-3 ? dz / hd : 0, vn = v.x * nx + v.z * nz;
  if (vn < 0) {
    v.x = (v.x - 1.45 * vn * nx) * 0.6; v.z = (v.z - 1.45 * vn * nz) * 0.6;
    if (vn < -3) { dust(p.x, p.y, p.z, 3); sfx.thump(Math.min(1, -vn / 20)); }
  }
  if (crown && cy > 0.2 && v.y < 0) v.y *= -0.3;             // dropped onto the top of it
}
// A fireball meets somebody standing in the field: it bursts in sparks and bounces off, and they notice.
function ballBody(o, x, z, rad, top, hit) {
  const p = o.body.position, v = o.body.velocity, dx = p.x - x, dz = p.z - z, hd = Math.hypot(dx, dz);
  if (hd > rad + BALL_R || p.y > top + BALL_R || o.struck === hit) return;
  o.struck = hit;                                            // one hit each per throw
  const sp = Math.hypot(v.x, v.z) || 1, nx = -v.x / sp, nz = -v.z / sp;      // back the way it came
  v.x *= -0.4; v.z *= -0.4; v.y = Math.max(v.y, 3);
  fireflies(p.x, p.y, p.z, 14); dust(p.x, p.y, p.z, 3); sfx.thump(0.7); shake = Math.max(shake, 0.15);
  hit(nx, nz);
}
function kidStruck(nx, nz) {                                 // yelps, tumbles, then bolts away from where it came from
  if (!kid.mixer) return;
  if (kid.ride) kidDismount();
  kid.goal = null;
  kid.act = kid.act === kid.acts.flip ? null : kid.act;
  kid.mode = 'wait'; kid.visit = false; kid.t = Math.min(1.6, kidPlay('flip', true, 1.6)); kid.flee = { x: -nx, z: -nz };
  sfx.chime(6);
}
function npcStruck() { npc.rear = 1; }
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
    if (o.kind === 'ball') {
      const gh = hillHeight(p.x, p.z), v = o.body.velocity;
      if (gh > 0.05 && p.y < gh + BALL_R) {                  // the hills are not in the physics world: bounce it off the slope by hand
        p.y = gh + BALL_R; if (v.y < 0) { if (v.y < -4) dust(p.x, gh + 0.1, p.z, 2); v.y *= -0.35; } v.x *= 0.9; v.z *= 0.9;
      }
      for (const t of TREES) ballTree(o, t.x, t.z, 0, t.s * 1.5);
      if (!kid.away) ballBody(o, kid.x, kid.z, kid.ride ? 0.8 : 0.5, kid.ride ? 2.9 : 1.9, kidStruck); for (const st of [stand, stand2]) if (st.on) ballBody(o, st.x, st.z, 0.6, 2.3, st === stand ? standStruck : stand2Struck); if (!npc.away) ballBody(o, npc.x, npc.z, 1.5, 4.3, npcStruck);
      if (Math.hypot(p.x, p.z) > R) for (const t of WOODS) ballTree(o, t.x, t.z, t.y, t.m);
      for (const b of beacons) if (!b.lit && Math.hypot(p.x - b.x, p.z - b.z) < 1.9 && p.y > b.h - 0.5 && p.y < b.h + 8) { lightBeacon(b); o.age = 99; }
    }
    if (!o.splashed && p.y < -8) { o.splashed = true; splash(p.x, p.z, o.kind !== 'lantern'); if (o.kind === 'lantern') burst(o); }
    if (objs.includes(o) && (p.y < -22 || (o.kind === 'ball' && o.age > 7))) {
      if (o.kind === 'ball' && p.y > -5) dust(p.x, p.y, p.z, 3);
      removeObj(o);
    }
  }
  for (const o of objs) { o.mesh.position.copy(o.body.position); o.mesh.quaternion.copy(o.body.quaternion); }
}

// ---------- out in the hills: beacons to light, and trails of little lights that lead to them ----------
// Eight stone beacons stand on high ground around the meadow. A fireball lights one for good. From the
// meadow's edge a wandering line of floating lights runs to each beacon; he gathers them by passing through.
const beacons = [], motes = [];
let moteCombo = 0, moteT = 0;
const elBeacons = document.getElementById('beacons');
{
  const rng = mulberry(4242), N = 8;
  const pillarGeo = new THREE.CylinderGeometry(0.55, 0.9, 4.4, 14), bowlGeo = new THREE.CylinderGeometry(1.25, 0.6, 0.8, 20), footGeo = new THREE.CylinderGeometry(1.3, 1.5, 0.5, 16);
  const clear = (x, z, pad) => !WOODS.some(t => Math.hypot(t.x - x, t.z - z) < t.r * 2.2 + pad);
  for (let i = 0; i < N; i++) {
    let best = null;
    for (let k = 0; k < 80; k++) {                           // the highest clear spot in this beacon's slice of the hills
      const a = (i + 0.15 + rng() * 0.7) / N * Math.PI * 2, rad = 80 + rng() * 80, x = Math.cos(a) * rad, z = Math.sin(a) * rad, h = hillHeight(x, z);
      if (clear(x, z, 4) && (!best || h > best.h)) best = { x, z, h };
    }
    const { x, z, h } = best, g = new THREE.Group(); g.position.set(x, h, z);
    const foot = new THREE.Mesh(footGeo, MAT.stone); foot.position.y = 0.1;
    const pillar = new THREE.Mesh(pillarGeo, MAT.stone); pillar.position.y = 2.4;
    const bowl = new THREE.Mesh(bowlGeo, MAT.dark); bowl.position.y = 4.9;
    for (const m of [foot, pillar, bowl]) { m.castShadow = m.receiveShadow = true; }
    const mark = haloSprite(5, 0.3); mark.position.y = 5.6;                                   // a pale glint so an unlit one can be spotted from afar
    const fire = new THREE.Group(); fire.position.y = 5.15; fire.visible = false;                 // three flames of different size and pace, back to front
    fire.add(flame(3.6, 4.4, rng(), 0, 0.95), flame(2.6, 3.3, rng(), 0, 1.1), flame(1.6, 2.2, rng(), 0, 1.35));
    const flameRef = fire;
    const glow = haloSprite(8, 0.45, 0xffa040); glow.position.y = 6.4; glow.visible = false;
    const beam = haloSprite(1, 0.5, 0xffc060); beam.scale.set(7, 150, 1); beam.position.y = 62; beam.visible = false;   // a column of light, seen across the hills
    g.add(foot, pillar, bowl, mark, glow, beam, fire); scene.add(g);
    beacons.push({ x, z, h, lit: false, mark, flame: flameRef, glow, beam, phase: rng() * 6 });
    const dot = document.createElement('i'); elBeacons.appendChild(dot);
    // the trail
    const dist = Math.hypot(x, z), ux = x / dist, uz = z / dist;
    for (let d = R + 5; d < dist - 7; d += 8.5) {
      const w = Math.sin(d * 0.07 + i * 1.7) * 7 * Math.min(1, (d - R) / 20, (dist - d) / 20), mx = ux * d - uz * w, mz = uz * d + ux * w;
      if (!clear(mx, mz, 1)) continue;
      const m = new THREE.Group(), core = new THREE.Mesh(sphereGeo, MAT.paper); core.scale.setScalar(0.2);
      m.add(core, haloSprite(1.9, 0.7)); m.position.set(mx, hillHeight(mx, mz) + 1.4, mz); m.visible = false; scene.add(m);
      motes.push({ x: mx, z: mz, y: m.position.y, mesh: m, phase: rng() * 6 });
    }
  }
}
function lightBeacon(b) {
  if (b.lit) return;
  b.lit = true; b.mark.visible = false; b.flame.visible = b.glow.visible = b.beam.visible = true;
  fireflies(b.x, b.h + 6, b.z, 40); sfx.win(); shake = Math.max(shake, 0.3);
  const lit = beacons.filter(q => q.lit).length;
  [...elBeacons.children].forEach((d, i) => d.classList.toggle('on', i < lit));
  if (lit === beacons.length) { for (const q of beacons) fireflies(q.x, q.h + 8, q.z, 60); setTimeout(() => sfx.win(), 700); }
}
function updateHills(dt) {
  const reach = HERO.mount ? 2.6 : HERO.fly ? 3.4 : 1.9;
  moteT -= dt; if (moteT <= 0) moteCombo = 0;
  for (let i = motes.length - 1; i >= 0; i--) {
    const m = motes[i], d = Math.hypot(m.x - player.x, m.z - player.z);
    m.mesh.visible = d < 75;
    if (!m.mesh.visible) continue;
    m.mesh.position.y = m.y + Math.sin(time * 1.8 + m.phase) * 0.18;
    if (d < reach && player.y < 3) {
      scene.remove(m.mesh); motes.splice(i, 1);
      fireflies(m.x, m.y, m.z, 6, false); sfx.chime(moteCombo++); moteT = 4;
    }
  }
  for (const b of beacons) {
    const dx = player.x - b.x, dz = player.z - b.z, d = Math.hypot(dx, dz);
    if (d < 1.9 && d > 1e-4) { player.x = b.x + dx / d * 1.9; player.z = b.z + dz / d * 1.9; }
    if (!b.lit) { b.mark.material.opacity = 0.22 + Math.sin(time * 2 + b.phase) * 0.1; continue; }
    const f = 1 + Math.sin(time * 9 + b.phase) * 0.12 + Math.sin(time * 14.3 + b.phase) * 0.07;
    b.glow.material.opacity = 0.3 + 0.14 * f; b.beam.material.opacity = 0.34 + 0.1 * f;
    if (d < 70 && Math.random() < dt * 9) spawn(b.x + rnd(0.7), b.h + 7 + Math.random() * 2, b.z + rnd(0.7), rnd(0.9), 2.2 + Math.random() * 2.2, rnd(0.9), 0.8 + Math.random() * 0.8, 0.22,
      { color: Math.random() < 0.5 ? 0xff6a1a : 0xffc050, grow: -0.5, alpha: 0.85 });
  }
}

function jump() {
  if (player.ride) { playerDismount(); return true; }
  if (HERO.fly && player.y > 0.01) {
    if (state !== 'play' || player.y > 18) return false;
    player.vy = 6.4; player.flying = true; sfx.whoosh(0.15); fireflies(player.x, player.g + player.y + 0.6, player.z, 6, false);
    return true;
  }
  if (state !== 'play' || player.y > 0.01) return false;
  player.vy = JUMP_V; player.y = 0.011; sfx.whoosh(0.1);
  return true;
}
function movePlayer(dt) {
  if (player.y > 0 || player.vy > 0) {
    const fl = HERO.fly && player.flying;
    player.vy -= GRAVITY * (fl ? 0.55 : 1) * dt; if (fl && player.vy < -2.4) player.vy = -2.4;      // she drifts down
    player.y += player.vy * dt;
    if (fl) { player.trail = (player.trail || 0) - dt; if (player.trail <= 0) { player.trail = 0.08; fireflies(player.x, player.g + player.y + 0.3, player.z, 1, false); } }
    if (player.y <= 0) { player.y = 0; player.vy = 0; player.flying = false; dust(player.x, player.g + 0.15, player.z, 3); sfx.thump(0.25); }
  }
  let jx = joy.x, jy = joy.y;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) jx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) jx += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) jy -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) jy += 1;
  if (window.__joy) { jx = window.__joy.x; jy = window.__joy.y; }
  let l = Math.hypot(jx, jy); if (l > 1) { jx /= l; jy /= l; l = 1; }
  if (state !== 'play') l = jx = jy = 0;
  if (player.ride) {
    if (l < 0.12) player.rideFree = true;
    else if (player.rideFree) playerDismount();
    if (player.ride) { player.g = hillHeight(player.x, player.z); return; }
  }
  player.moving += ((l > 0.12 ? l : 0) - player.moving) * Math.min(1, dt * 10);
  if (l > 0.12) {
    camYaw += jx * 1.15 * dt;                                // pushing sideways swings the view round as he walks
    const s = Math.sin(camYaw), c = Math.cos(camYaw);
    const mx = c * jx + s * -jy, mz = s * jx - c * -jy;      // right * jx + forward * (-jy)
    const sp = SPEED * (player.flying ? 1.6 : 1);
    player.x += mx * sp * dt; player.z += mz * sp * dt;
    if (!(aim.on && aim.valid) && heroKick <= 0) player.face = Math.atan2(mx, -mz);
    player.walkT += dt * (HERO.mount ? 4 + 5 * l : 5 + 6 * l);
  }
  // stay this side of the mountains, and out of trees and blocks
  const d = Math.hypot(player.x, player.z), lim = ROAM;
  if (d > lim) { player.x *= lim / d; player.z *= lim / d; }
  const push = (ox, oz, rad) => {
    const dx = player.x - ox, dz = player.z - oz, dd = Math.hypot(dx, dz);
    if (dd < rad && dd > 1e-4) { player.x = ox + dx / dd * rad; player.z = oz + dz / dd * rad; }
  };
  for (const t of TREES) push(t.x, t.z, 0.7 * t.s + 0.6);
  if (!npc.away) push(npc.x, npc.z, npc.r + (HERO.mount ? 1 : 0)); if (!kid.ride && !kid.away) push(kid.x, kid.z, 0.9); for (const st of [stand, stand2]) if (st.on) push(st.x, st.z, 1.1);
  if (heroIx === KID && player.y <= 0) for (const kind of ['swing', 'hammock']) {
    const e = play[kind], dd = Math.hypot(player.x - e.x, player.z - e.z), rad = kind === 'swing' ? 1.7 : 1.5;
    if (player.rideLock === kind) { if (dd > rad + 1.4) player.rideLock = null; }
    else if (l > 0.12 && dd < rad + 0.3 && state === 'play' && !aim.on) { playerMount(kind); return; }
  }
  for (const q of play.spots) push(q.x, q.z, q.r);
  if (d > R) for (const t of WOODS) push(t.x, t.z, t.r);
  player.g = hillHeight(player.x, player.z);
  for (const o of objs) if (o.kind !== 'ball' && o.body.position.y < 2.4 + player.y && o.body.position.y > player.y - 0.5) push(o.body.position.x, o.body.position.z, 1.0);
}

const camPos = new THREE.Vector3(), camAt = new THREE.Vector3();
function updateCamera(dtReal) {
  if (window.__freecam) return;
  fwd(camYaw, tmpF);
  const aiming = aim.on && aim.valid, D0 = (portrait ? 8.6 : 7.4) + (aiming ? 1.2 : 0) + HERO.cam * 3;
  let D = D0, H = (portrait ? 4.6 : 3.8) + HERO.cam * 1.4;
  // keep the camera out of the trees: slide it in toward the player, or duck under the canopy
  const near = Math.hypot(player.x, player.z) > R ? WOODS.filter(t => Math.abs(t.x - player.x) < 22 && Math.abs(t.z - player.z) < 22) : [];   // hill trees close by
  const blocked = (d, k) => { const x = player.x - tmpF.x * d, z = player.z - tmpF.z * d; return TREES.some(t => Math.hypot(x - t.x, z - t.z) < k * t.s) || near.some(t => Math.hypot(x - t.x, z - t.z) < k * 0.75 * t.r); };
  while (D > 3 && blocked(D, 4.6)) D -= 0.5;
  if (D <= 3) { H = 2.3; D = D0 * 0.75; while (D > 1.6 && blocked(D, 1.2)) D -= 0.4; }
  const lift = player.y * (player.flying ? 0.9 : 0.5);
  camPos.set(player.x - tmpF.x * D, H + player.g + lift, player.z - tmpF.z * D);
  camPos.y = Math.max(camPos.y, hillHeight(camPos.x, camPos.z) + 1.6);                        // never under a slope behind him
  const ax = player.x + tmpF.x * 7, az = player.z + tmpF.z * 7;                                 // look along the slope he is on
  camAt.set(ax, 1.7 + HERO.cam + lift * (player.flying ? 0.8 : 1) + player.g + (hillHeight(ax, az) - player.g) * 0.5, az);
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

  FIRE_T.value = time;
  movePlayer(dt);
  if (!npc.away) {                                           // the rider looks his way when he is close
    const dx = player.x - npc.x, dz = player.z - npc.z, want = Math.hypot(dx, dz) < 16 ? Math.atan2(dx, dz) + Math.PI : npc.face;
    let da = want - npc.group.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da));
    npc.group.rotation.y += da * Math.min(1, dt * 1.6);
    if (npc.rear > 0) { npc.rear = Math.max(0, npc.rear - dt * 0.9); const k = Math.sin(npc.rear * Math.PI); npc.group.rotation.x = REAR * 0.38 * k; npc.group.position.y = (npc.gy || 0) + 0.5 * k; }
  }
  updatePlay(dt);
  updateKid(dt, dtReal); for (const st of [stand, stand2]) if (st.mixer) st.mixer.update(dtReal);
  updateHills(dt);
  physics(dt);

  if (state === 'won') {
    if (Math.random() < dtReal * 30) fireflies(player.x + rnd(7), player.g + 0.3, player.z + rnd(7), 2, false);
    if (stateT > 3.2) transition(true);
  }

  // the thrower: turn to face where he walks or throws, and pick a clip for what he is doing
  const aiming = aim.on && aim.valid && state === 'play';
  if (aiming) player.face = camYaw + aim.yaw;
  let dy = -player.face - hero.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  hero.rotation.y += dy * Math.min(1, dtReal * 12);
  const bob = player.moving, stride = Math.sin(player.walkT);
  const air = player.y > 0, fake = CLIP.walk ? 0 : bob;      // with no walk clip he leans and bobs instead
  hero.position.set(player.x, player.g + player.y + (HERO.glide ? 0.1 + Math.sin(time * 2.2) * 0.05 : air ? 0 : Math.abs(stride) * (HERO.mount ? 0.3 : 0.09) * fake), player.z);
  const tuck = air && !CLIP.jump ? THREE.MathUtils.clamp(player.vy / JUMP_V, -1, 1) * -0.22 : 0;
  if (HERO.mount) heroTilt.rotation.set(Math.sin(player.walkT * 2 + 0.9) * 0.085 * bob + tuck * 1.3, 0, 0);   // a rocking gallop
  else if (player.flying) heroTilt.rotation.set(-1.05 * bob, 0, Math.sin(time * 2.4) * 0.06);
  else if (HERO.glide) heroTilt.rotation.set(-0.08 * bob + tuck, 0, Math.sin(time * 1.6) * 0.025);   // leans into it, swaying a little
  else heroTilt.rotation.set(-0.16 * fake + tuck, 0, stride * 0.05 * fake);
  if (heroLoaded) {
    heroKick = Math.max(0, heroKick - dtReal / THROW.hold);
    const mode = state === 'won' ? 'win' : heroKick > 0 ? 'throw' : aiming ? 'aim' : air && player.flying && CLIP.jump ? 'fly' : air && CLIP.jump ? 'jump' : player.moving > 0.25 && CLIP.walk ? 'walk' : 'idle';
    if (mode !== heroMode) {
      if (mode === 'win') heroPlay(CLIP.win || CLIP.idle, { fade: 0.4 });
      else if (mode === 'aim') heroPlay(THROW.clip, { fade: 0.18, speed: 0, at: THROW.wind });
      else if (mode === 'throw') heroPlay(THROW.clip, { fade: 0.08, speed: THROW.speed, once: true, at: heroMode === 'aim' ? null : THROW.wind });
      else if (mode === 'fly') heroPlay(CLIP.jump, { fade: 0.15, speed: 0, at: HOP.t0 + (HOP.t1 - HOP.t0) * 0.5 });
      else if (mode === 'jump') heroPlay(CLIP.jump, { fade: 0.08, once: true, at: HOP.t0, speed: (HOP.t1 - HOP.t0) / (2 * JUMP_V / GRAVITY) });
      else if (mode === 'walk') heroPlay(CLIP.walk, { fade: 0.2 });
      else heroPlay(CLIP.idle, { fade: 0.35 });
      heroMode = mode;
    }
    if (mode === 'walk') heroAct.timeScale = 0.6 + player.moving * 1.5;
    mixer.update(dtReal);
    flyW += ((heroMode === 'fly' ? 1 : 0) - flyW) * Math.min(1, dtReal * 8);
    wings.visible = heroIx === KID && player.flying && player.y > 0 && !!flyBones.Spine2;   // hers alone, and only in the air
    if (wings.visible) {                                           // they sit between her shoulder blades and beat
      wingW += (1 - wingW) * Math.min(1, dtReal * 7);
      heroTilt.worldToLocal(flyBones.Spine2.bone.getWorldPosition(wingP)); wings.position.set(wingP.x, wingP.y + 0.05, wingP.z + 0.24);
      wings.scale.setScalar(Math.max(0.01, wingW) * 0.85);
      const beat = 0.14 + (0.5 + 0.5 * Math.sin(time * 5.2)) * 0.5, fold = Math.sin(time * 5.2 - 0.9) * 0.08;   // they sweep back from her shoulders and never forward, so they stay clear of her arms
      wings.children[0].rotation.set(0, -beat, 0.1 + fold); wings.children[1].rotation.set(0, beat, -0.1 - fold);
    } else wingW = 0;
    if (flyW > 0.01 && HERO.fly) for (const n in flyBones) {
      const b = flyBones[n], [x, y, z] = FLY_POSE[n] || FLY_ZERO;
      b.bone.quaternion.slerp(kidQ.copy(b.bind).multiply(kidQ2.setFromEuler(kidE.set(x * D2R, y * D2R, z * D2R))), flyW);
    }
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
  scenery.update(time, player.x, player.z, camera, renderer.getPixelRatio(), player.g);
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
  fling, jump, setHero, swapHero, beacons, motes, lightBeacon, debug: { FLY_POSE, wings, WOODS, npc, kid, stand, stand2, play, KID_POSE, kidMount, kidDismount, scene, camera, hero, acts, THROW, THREE, player, sites, renderer, get mixer() { return mixer; } },
  walk(x, y) { window.__joy = x || y ? { x, y } : null; },
  setLevel(n) { level = n; buildLevel(); },
  setSeason(name) { scenery.setSeason(name); },
  auto() { window.__manual = false; },
  state() {
    return { heroLoaded, lit: beacons.filter(b => b.lit).length, motes: motes.length, hero: heroIx, g: +player.g.toFixed(2), level, season: scenery.season, detail: +detail.toFixed(2), state, lanterns: lanterns.length, total, objects: objs.length, sites: sites.length,
      x: +player.x.toFixed(2), y: +player.y.toFixed(2), z: +player.z.toFixed(2), clips: { ...CLIP, throw: THROW.clip }, hop: [+HOP.t0.toFixed(2), +HOP.t1.toFixed(2)], mode: heroMode, camYaw: +camYaw.toFixed(2),
      moving: objs.filter(o => o.body.sleepState !== CANNON.Body.SLEEPING).length };
  },
};

buildLevel();
requestAnimationFrame(frame);
