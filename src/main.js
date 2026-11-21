import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildScenery, softTexture, R, START, TREES, WOODS, ROAM, hillHeight, VALLEY, valleyAt, PLAYGROUND, CASTLE, BAY, valley2At } from './scenery.js';
import { buildCastle } from './castle.js';
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
  CLIP.walk = (HERO.stroll && find(/^walk$/i)) || find(/run|jog/i) || find(/walk/i);   // the kid walks rather than runs
  CLIP.jump = names.find(n => /^(jump|leap)$/i.test(n)) || find(/jump|leap/i);
  if (CLIP.jump) findHop(acts[CLIP.jump].getClip());
  CLIP.win = find(/dance|cheer|victory/i);
  const t = find(/throw|cast|pitch/i);
  THROW.proc = false;
  if (t) Object.assign(THROW, { clip: t, wind: 0, speed: 1.4, hold: Math.min(1.2, acts[t].getClip().duration / 1.4) });
  else if (!acts[THROW.clip]) Object.assign(THROW, { clip: CLIP.idle, wind: 0, speed: 1, hold: 0.55, proc: true });   // no throw clip of her own: she stays on her feet and her arm is swung for her
  if (!CLIP.win) CLIP.win = find(/laugh/i);
}
// The heroes to pick from. A mount has no clips: it gallops by rocking and bounding, and covers ground faster.
const HEROES = [
  { file: 'general-animated.glb', scale: 2.5, turn: Math.PI, lift: 0, speed: 4.8, hand: 2.15, cam: 0 },
  { file: 'warrior.glb', scale: 4.4, turn: Math.PI, lift: 0.489, speed: 9.5, hand: 3.3, cam: 1, mount: true },
  { file: 'woman.glb', scale: 2.7, turn: Math.PI, lift: 0, speed: 5.0, hand: 2.15, cam: 0, glide: true },   // modelled in one fixed pose, with no clips: she drifts over the grass
  { file: 'kid.glb', scale: 1.9, turn: Math.PI, lift: 0, speed: 3.6, hand: 1.6, cam: -0.2, fly: true, stroll: true },   // a copy of the kid, made when her model loads
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
  lie: { LeftArm: [-72, 0, 0], RightArm: [-72, 0, 0] },
  hold: { LeftArm: [-30, 0, 0], RightArm: [-30, 0, 0] },                                                                           // hands a little out in front, on a rail or a handle                                                                            // arms by the sides
};
const flyBones = {}, FLY_POSE = { LeftArm: [20, 0, 0], RightArm: [20, 0, 0], LeftForeArm: [0, 0, 0], RightForeArm: [0, 0, 0], LeftHand: [0, 0, 0], RightHand: [0, 0, 0] };   // arms straight out to the sides, like wings
let flyW = 0, wingW = 0, swimT = 0, throwW = 0;
const SIT_POSE = { LeftArm: [-58, 0, 0], RightArm: [-58, 0, 0] };
// Turn a bone so the stretch from it to its child points along a given direction (in the world), keeping its twist.
const aimA = new THREE.Vector3(), aimB = new THREE.Vector3(), aimQ = new THREE.Quaternion(), aimW = new THREE.Quaternion(), aimP = new THREE.Quaternion();
function aimBone(bone, child, dir, w) {
  bone.getWorldPosition(aimA); child.getWorldPosition(aimB); aimB.sub(aimA).normalize();
  aimQ.setFromUnitVectors(aimB, dir); bone.getWorldQuaternion(aimW); bone.parent.getWorldQuaternion(aimP);
  aimW.premultiply(aimQ).premultiply(aimP.invert());
  bone.quaternion.slerp(aimW, w);
}
const sitD = new THREE.Vector3(), sitQ = new THREE.Quaternion();
function swimLimbs(w, stroke) {
  hero.getWorldQuaternion(sitQ);                             // along the way she is heading: -z ahead, +y up
  for (const [side, sx, ph] of [['Left', 1, 0], ['Right', -1, Math.PI]]) {
    const arm = flyBones[side + 'Arm'], fore = flyBones[side + 'ForeArm'], hand = flyBones[side + 'Hand'];
    const up = flyBones[side + 'UpLeg'], leg = flyBones[side + 'Leg'], foot = flyBones[side + 'Foot'], toe = flyBones[side + 'ToeBase'];
    if (arm && fore && hand) {
      const a = stroke + ph, c = Math.cos(a), sn = Math.sin(a), over = sn < 0 ? -sn : 0;      // over = how far through the recovery, above the water
      aimBone(arm.bone, fore.bone, sitD.set(sx * (0.16 + 0.5 * over), -sn * (sn > 0 ? 1 : 0.75), -c).normalize().applyQuaternion(sitQ), w);
      aimBone(fore.bone, hand.bone, sitD.set(sx * (0.1 - 0.25 * over), -sn * (sn > 0 ? 1 : 0.2) - 0.55 * over, -c - 0.35 * over).normalize().applyQuaternion(sitQ), w);
    }
    if (up && leg && foot) {
      const k = Math.sin(stroke * 3 + ph), k2 = Math.sin(stroke * 3 + ph - 0.7);
      aimBone(up.bone, leg.bone, sitD.set(sx * 0.05, 0.02 + 0.14 * k, 1).normalize().applyQuaternion(sitQ), w);
      aimBone(leg.bone, foot.bone, sitD.set(sx * 0.03, 0.05 + 0.2 * k2, 1).normalize().applyQuaternion(sitQ), w);
      if (toe) aimBone(foot.bone, toe.bone, sitD.set(0, -0.12 + 0.1 * k2, 1).normalize().applyQuaternion(sitQ), w);
    }
  }
}
// Seated legs for either copy of the kid. `f` is which way that copy faces along its own z (the steered one faces -z, the other +z).
// hang: thighs level in front, shins hanging and swinging in turn; astride: knees out to the sides, shins down; slide: legs stretched out down the chute.
function sitLegs(w, bones = flyBones, ref = heroTilt, f = -1, how = 'hang') {
  ref.getWorldQuaternion(sitQ);
  for (const [side, sx, ph] of [['Left', -f, 0], ['Right', f, Math.PI]]) {
    const up = bones[side + 'UpLeg'], leg = bones[side + 'Leg'], foot = bones[side + 'Foot']; if (!up || !leg || !foot) return;
    const a = Math.sin(time * 2.6 + ph) * 0.42 + 0.08;
    const thigh = how === 'astride' ? [sx * 0.75, -0.3, f] : how === 'slide' ? [sx * 0.1, -0.3, f] : [sx * 0.14, -0.1, f];
    const shin = how === 'astride' ? [sx * 0.12, -1, f * 0.15] : how === 'slide' ? [sx * 0.05, -0.5, f] : [sx * 0.03, -Math.cos(a), f * Math.sin(a)];
    aimBone(up.bone, leg.bone, sitD.set(...thigh).normalize().applyQuaternion(sitQ), w);
    aimBone(leg.bone, foot.bone, sitD.set(...shin).normalize().applyQuaternion(sitQ), w);
  }
}
const FLY_ZERO = [0, 0, 0];
// Her wings: a modelled pair, cut down the middle into a left and a right so each can beat from her back.
const wings = new THREE.Group(), wingP = new THREE.Vector3();
const WING = { scale: 1.15, root: 0.05 };                     // how big they are, and how far up the model they join her back
{
  for (const side of [1, -1]) wings.add(new THREE.Group());
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(import.meta.env.BASE_URL + 'models/wings.glb', g => {
    let src = null; g.scene.traverse(o => { if (o.isMesh && !src) src = o; });
    g.scene.updateMatrixWorld(true);
    const geo = src.geometry, pos = geo.attributes.position, ix = geo.index.array, half = [[], []], M = src.matrixWorld.clone(), v = new THREE.Vector3();
    for (let k = 0; k < ix.length; k += 3) {                 // as the model stands it spans left to right: one wing each side of the middle
      let x = 0; for (let c = 0; c < 3; c++) x += v.fromBufferAttribute(pos, ix[k + c]).applyMatrix4(M).x;
      half[x < 0 ? 0 : 1].push(ix[k], ix[k + 1], ix[k + 2]);
    }
    const mat = src.material.clone(); mat.side = THREE.DoubleSide;
    half.forEach((list, n) => {
      const hg = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'uv']) if (geo.attributes[name]) hg.setAttribute(name, geo.attributes[name]);
      hg.setIndex(list);
      const m = new THREE.Mesh(hg, mat); m.castShadow = true; m.frustumCulled = false; m.matrixAutoUpdate = false; m.matrix.copy(M);
      const turn = new THREE.Group(); turn.rotation.y = Math.PI; turn.scale.setScalar(WING.scale); turn.position.y = -WING.root * WING.scale;   // faced the way she faces, joined at her back
      turn.add(m); wings.children[n].add(turn);
    });
    wings.userData.ready = true;
  }, undefined, e => console.error('wings model failed to load', e));
  wings.visible = false; heroTilt.add(wings);
}
const kidE = new THREE.Euler(), kidQ = new THREE.Quaternion(), kidQ2 = new THREE.Quaternion(), D2R = Math.PI / 180;
function kidPose() {
  for (const n in kid.pose) { const b = kid.bones[n]; if (!b) continue; const [x, y, z] = kid.pose[n]; b.bone.quaternion.copy(b.bind).multiply(kidQ.setFromEuler(kidE.set(x * D2R, y * D2R, z * D2R))); }
}
// What her arms and legs do on each ride. Plain turns for the simple swings of a limb, aimed bones where a limb has to point somewhere.
function rideLimbs() {
  const k = kid.ride, e = play[k], B = kid.bones, t = time, LR = [['Left', -1, 0], ['Right', 1, Math.PI]];
  const set = (n, x) => { const b = B[n]; if (b) b.bone.quaternion.copy(b.bind).multiply(kidQ.setFromEuler(kidE.set(x * D2R, 0, 0))); };
  const free = n => { if (B[n]) B[n].bone.quaternion.copy(B[n].bind); };
  kid.group.getWorldQuaternion(sitQ);
  const aim = (a, b, x, y, z) => { if (B[a] && B[b]) aimBone(B[a].bone, B[b].bone, sitD.set(x, y, z).normalize().applyQuaternion(sitQ), 1); };
  const arm = (side, sx, u, f) => { free(side + 'Arm'); free(side + 'ForeArm'); aim(side + 'Arm', side + 'ForeArm', sx * u[0], u[1], u[2]); aim(side + 'ForeArm', side + 'Hand', sx * f[0], f[1], f[2]); };
  const leg = (side, sx, u, f) => { free(side + 'UpLeg'); free(side + 'Leg'); aim(side + 'UpLeg', side + 'Leg', sx * u[0], u[1], u[2]); aim(side + 'Leg', side + 'Foot', sx * f[0], f[1], f[2]); };
  if (k === 'swing') {                                         // pumping: knees bend at the back of the swing and straighten on the way through
    const dip = Math.max(0, Math.sin(t * 1.9)) * Math.min(1, e.amp / 0.5) * 0.6;
    for (const [side] of LR) { set(side + 'UpLeg', -24 * dip); set(side + 'Leg', 48 * dip); set(side + 'Arm', 58 + 12 * dip); }
    kid.group.position.y = -e.L + 0.035 - 0.075 * dip;
  } else if (k === 'hammock') {                                // idling: a knee drawn up and let down, an arm drifting
    for (const [side, , ph] of LR) { const v = 0.5 + 0.5 * Math.sin(t * 1.2 + ph); set(side + 'UpLeg', -6 - 26 * v); set(side + 'Leg', 10 + 50 * v); set(side + 'Arm', -72 + 10 * Math.sin(t * 0.9 + ph * 0.6)); }
  } else if (k === 'round') {                                  // one foot scoots it round, hands working the rail
    const a = 0.4 + 0.6 * Math.min(1, e.speed / 2);
    set('RightUpLeg', 24 * a * Math.sin(t * 3.2)); set('RightLeg', (24 + 24 * Math.sin(t * 3.2 + 1.2)) * a); set('LeftUpLeg', -7); set('LeftLeg', 14);
    for (const [side, , ph] of LR) set(side + 'Arm', -30 + 9 * a * Math.sin(t * 3.2 + ph));
  } else if (k === 'seesaw') {                                 // legs fold as her end comes down and kick out as it goes up
    const q = Math.sin(t * 1.7) * Math.min(1, e.amp / 0.25);
    for (const [side, sx] of LR) { leg(side, sx, [0.75, -0.3 + 0.22 * q, 1], [0.12, -1, 0.15 + 0.55 * q]); set(side + 'Arm', -30 + 11 * q); }
  } else if (k === 'slide') {                                  // arms thrown up on the way down, feet kicking
    const sm = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); }, p = sm((e.tt - 0.9) / 0.35) * (1 - sm((e.tt - 2.5) / 0.5));
    for (const [side, sx, ph] of LR) { leg(side, sx, [0.1, -0.3, 1], [0.05, -0.5 + (0.08 + 0.2 * p) * Math.sin(t * 8 + ph), 1]); set(side + 'Arm', -30 + 92 * p + 9 * p * Math.sin(t * 11 + ph)); }
  } else if (k === 'bars') {                                   // hand over hand along the rungs, legs swinging under her
    for (const [side, sx, ph] of LR) {
      const a = Math.sin(e.tt * 2.6 + ph), b = Math.sin(e.tt * 2.6 + ph + Math.PI), b2 = Math.sin(e.tt * 2.6 + ph + Math.PI - 0.8);
      arm(side, sx, [0.16, 1, 0.34 * a], [0.04, 1, 0.14 * a]); leg(side, sx, [0.07, -1, 0.3 * b], [0.04, -1, -0.3 + 0.26 * b2]);
    }
  } else if (k === 'sand') {                                   // patting the sand into shape, one hand then the other
    for (const [side, sx, ph] of LR) { const pat = 0.5 + 0.5 * Math.sin(t * 6.5 + ph); arm(side, sx, [0.3, -0.72 + 0.22 * pat, 0.6], [0.0, -0.62 + 0.7 * pat, 0.75]); leg(side, sx, [0.22, -0.3, 1], [0.1, -0.5 + 0.07 * Math.sin(t * 3 + ph), 1]); }
  }
}
function kidMount(kind) {
  const e = play[kind]; kid.ride = kind; kid.mode = 'ride'; kid.t = 9 + Math.random() * 8; kid.goal = null; e.rider = true;
  kid.mixer.stopAllAction(); kid.act = null; kid.x = e.x; kid.z = e.z;
  const g = kid.group; g.rotation.set(0, 0, 0);
  if (kind === 'swing') { e.pivot.add(g); g.position.set(0, -e.L + 0.035, 0); kid.pose = KID_POSE.stand; e.want = 0.55; }
  else if (kind === 'hammock') { e.sway.add(g); g.rotation.order = 'YXZ'; g.rotation.set(-Math.PI / 2, Math.PI / 2, 0); g.position.set(0.95, -0.5 - e.drop, 0); kid.pose = KID_POSE.lie; e.want = 0.1; }
  else { e.seat.add(g); e.put(g); kid.pose = e.pose; kid.sit = e.sit || null; if (e.busy) e.want = e.busy; if (e.dur) kid.t = e.dur; }
}
function kidDismount() {
  const e = play[kid.ride]; if (!e) return;
  e.rider = false; e.want = kid.ride === 'swing' ? 0.05 : kid.ride === 'hammock' ? 0.02 : e.idle || 0;
  const a = e.g.rotation.y + (kid.ride === 'swing' ? 0 : kid.ride === 'hammock' ? Math.PI / 2 : e.exitTurn || 0);
  kid.x = e.x + Math.sin(a) * 1.9; kid.z = e.z + Math.cos(a) * 1.9; kid.face = a; kid.sit = null;
  if (e.exit) { kid.x = e.exit.x; kid.z = e.exit.z; }
  else if (kid.ride === 'round') { const p = kid.group.getWorldPosition(new THREE.Vector3()), d = Math.hypot(p.x - e.x, p.z - e.z) || 1; kid.x = e.x + (p.x - e.x) / d * 2.5; kid.z = e.z + (p.z - e.z) / d * 2.5; kid.face = Math.atan2(p.x - e.x, p.z - e.z); }
  for (const n in kid.bones) { const b = kid.bones[n]; b.bone.quaternion.copy(b.bind); }
  kid.pose = null; kid.ride = null; scene.add(kid.group);
  kid.group.rotation.order = 'XYZ'; kid.group.rotation.set(0, kid.face, 0); kid.group.position.set(kid.x, hillHeight(kid.x, kid.z), kid.z);
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
    rideLimbs();
    if (kid.t <= 0 && play[kid.ride].auto && player.ride) playerDismount();
    else if (kid.t <= 0 && !player.ride) kidDismount();
    return;
  }
  const toP = Math.hypot(player.x - kid.x, player.z - kid.z), inMeadow = Math.hypot(player.x, player.z) < R;
  kid.t -= dt;
  if (kid.mode === 'go') {
    const dx = kid.tx - kid.x, dz = kid.tz - kid.z, d = Math.hypot(dx, dz);
    if (kid.goal && d < (play[kid.goal].r ? play[kid.goal].r + 0.5 : 1.0)) { kidMount(kid.goal); return; }
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
      const far = Math.hypot(kid.x - play.field.x, kid.z - play.field.z) < 22 ? Math.random() < 0.8 : Math.random() < 0.4;   // once out at the playground she stays a while
      const kind = far ? ['round', 'seesaw', 'slide', 'bars', 'sand'][Math.floor(Math.random() * 5)] : Math.random() < 0.6 ? 'swing' : 'hammock', e = play[kind], a = e.g.rotation.y + (kind === 'swing' ? Math.PI : Math.PI / 2);
      if (far) kidGo(e.x, e.z, true); else kidGo(e.x + Math.sin(a) * 1.9, e.z + Math.cos(a) * 1.9, true);
      kid.goal = kind; kid.t = Math.hypot(kid.tx - kid.x, kid.tz - kid.z) / 5 + 4;
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
  player.ride = kind; player.rideFree = false; player.moving = 0;
  hero.visible = false; kid.group.visible = true; kidMount(kind); sfx.chime(4);
  player.x = e.x; player.z = e.z;
}
function playerDismount() {
  if (!player.ride) return;
  player.rideLock = player.ride; player.ride = null;
  kidDismount(); kid.mixer.stopAllAction(); kid.act = null; kid.group.visible = false;
  player.x = kid.x; player.z = kid.z; player.face = Math.PI - kid.face; hero.rotation.y = -player.face; hero.visible = true;
  player.vy = JUMP_V * 0.6; player.y = 0.01;                                      // hops down
}
const SWAP = [0, KID];                                      // he can be the general or the kid; the warrior woman and the rider only stand about
// Flying, she can settle on a limb of a bare tree: near enough to one and not climbing, she sits down on it.
let PERCH = null;
function perches() {
  if (PERCH) return PERCH;
  PERCH = [];
  TREES.forEach((t, i) => scenery.limbs(i).forEach(l => {
    if (l.b.y - l.a.y > 0.8 * Math.hypot(l.b.x - l.a.x, l.b.z - l.a.z)) return;   // not the limb that sticks straight up: nowhere to sit on that
    const k = 0.58, x = l.a.x + (l.b.x - l.a.x) * k, y = l.a.y + (l.b.y - l.a.y) * k, z = l.a.z + (l.b.z - l.a.z) * k;
    PERCH.push({ tree: i, x, y: y + l.r0 + (l.r1 - l.r0) * k, z, dx: l.b.x - l.a.x, dz: l.b.z - l.a.z });
  }));
  return PERCH;
}
const SEAT = 1.34;                                           // how far below her hips her feet hang when she sits
function tryPerch() {
  if (heroIx !== KID || !player.flying || player.vy > 3 || player.perchLock > 0) return false;
  const py = player.g + player.y + SEAT;
  for (const p of perches()) {
    if (!scenery.isBare(p.tree) || Math.hypot(p.x - player.x, p.z - player.z) > 1.15 || Math.abs(p.y - py) > 1.0) continue;
    const out = Math.hypot(p.x - TREES[p.tree].x, p.z - TREES[p.tree].z) || 1, l = Math.hypot(p.dx, p.dz) || 1;
    let fx = -p.dz / l, fz = p.dx / l;                       // she sits across the limb, looking toward where she flew in from
    if (fx * (player.x - p.x) + fz * (player.z - p.z) > 0) { fx = -fx; fz = -fz; }
    player.perch = p; player.flying = false; player.vy = 0; player.moving = 0; player.perchFree = false;
    player.x = p.x + fx * 0.12; player.z = p.z + fz * 0.12; player.g = hillHeight(player.x, player.z); player.y = p.y - SEAT - player.g; player.face = Math.atan2(fx, -fz);
    fireflies(p.x, p.y + 0.4, p.z, 10, false); sfx.chime(5);
    return true;
  }
  return false;
}
function leavePerch(up) {
  if (!player.perch) return;
  player.perch = null; player.perchLock = 0.9; player.flying = true; player.vy = up ? 6.4 : 2.5;
  if (up) sfx.whoosh(0.15);
}
function swapHero() {
  player.perch = null;
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
const castle = buildCastle(scene, { spawn, sfx, ivy: pts => scenery.ivy(pts), addBox: (x, y, z, hx, hy, hz) => addStatic(new CANNON.Box(new CANNON.Vec3(hx, Math.max(0.05, hy), hz)), x, y, z) });
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
// A playground out in the valley: a roundabout, a seesaw, a slide, monkey bars and a sandpit.
{
  const V = (x, y, z) => new THREE.Vector3(x, y, z), UP = new THREE.Vector3(0, 1, 0);
  const paint = (base, streak) => new THREE.MeshStandardMaterial({ map: grainTexture(base, streak), roughness: 0.8 });   // paint on wood: the grain shows through
  const RED = paint('#d2705a', '#8f4332'), YEL = paint('#e6c877', '#a98a45'), BLU = paint('#8fb4cf', '#567c97'), GRN = paint('#93bf86', '#5d8551'), STEEL = MAT.wood;
  const bar = (a, b, r, mat) => { const d = b.clone().sub(a), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), mat); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize()); m.castShadow = true; return m; };
  const knob = (p, r, mat) => { const m = new THREE.Mesh(sphereGeo, mat); m.scale.setScalar(r); m.position.copy(p); m.castShadow = true; return m; };
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * 0.3), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; };
  {                                                            // soft sandy ground under it all, ringed with a low kerb of logs
    const pad = new THREE.Mesh(new THREE.CircleGeometry(PLAYGROUND.r, 48), new THREE.MeshStandardMaterial({ color: 0xe0cd9a, roughness: 1 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(PLAYGROUND.x, 0.03, PLAYGROUND.z); pad.receiveShadow = true; scene.add(pad);
    const N = 30; for (let k = 0; k < N; k++) {
      if (k === 0 || k === N - 1) continue;                    // a gap in the kerb to walk in by
      const a0 = k / N * 6.283 + 5.06, a1 = (k + 0.86) / N * 6.283 + 5.06, rr = PLAYGROUND.r;
      const log = bar(V(PLAYGROUND.x + Math.cos(a0) * rr, 0.12, PLAYGROUND.z + Math.sin(a0) * rr), V(PLAYGROUND.x + Math.cos(a1) * rr, 0.12, PLAYGROUND.z + Math.sin(a1) * rr), 0.13, MAT.wood); scene.add(log);
    }
  }
  const T0 = 62, yaw = Math.atan2(VALLEY.ux, VALLEY.uz);        // laid out along the valley, about a minute's walk from the meadow
  const at = (side, along) => valleyAt(T0 + along, side);
  const place = (side, along, turn = 0) => { const p = at(side, along), g = new THREE.Group(); g.position.set(p.x, hillHeight(p.x, p.z), p.z); g.rotation.y = yaw + turn; scene.add(g); return g; };
  const world = (g, x, z) => { const p = g.localToWorld(V(x, 0, z)); return { x: p.x, z: p.z }; };

  // the roundabout: a painted deck that turns, with rails to hold
  {
    const g = place(5.2, 3.5), spin = new THREE.Group(); spin.position.y = 0.3; g.add(bar(V(0, 0, 0), V(0, 0.3, 0), 0.14, STEEL), spin);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.55, 0.1, 32), RED); deck.castShadow = deck.receiveShadow = true; spin.add(deck);
    for (let k = 0; k < 8; k++) { const w = new THREE.Mesh(new THREE.CylinderGeometry(1.56, 1.56, 0.102, 6, 1, false, k * Math.PI / 4, Math.PI / 8), YEL); spin.add(w); }
    spin.add(bar(V(0, 0, 0), V(0, 1.05, 0), 0.05, STEEL));
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4, x = Math.cos(a) * 1.32, z = Math.sin(a) * 1.32; spin.add(bar(V(x, 0, z), V(x, 0.95, z), 0.035, BLU), bar(V(x, 0.95, z), V(0, 1.05, 0), 0.035, BLU)); }
    g.updateMatrixWorld(true);
    play.round = { x: g.position.x, z: g.position.z, g, r: 1.75, seat: spin, speed: 0.15, want: 0.15, idle: 0.15, busy: 2.3, rider: false, pose: KID_POSE.hold,
      put(k) { k.position.set(1.0, 0.05, 0); k.rotation.set(0, 0, 0); } };
    play.spots.push({ x: g.position.x, z: g.position.z, r: 1.75 });
  }
  // the seesaw: a plank on a post, with a handle at each end
  {
    const g = place(0, -5.5, 0.5), pivot = new THREE.Group(); pivot.position.y = 0.72;
    for (const sz of [-1, 1]) g.add(bar(V(-0.35, 0, sz * 0.24), V(0, 0.72, sz * 0.24), 0.05, STEEL), bar(V(0.35, 0, sz * 0.24), V(0, 0.72, sz * 0.24), 0.05, STEEL));
    g.add(bar(V(0, 0.72, -0.3), V(0, 0.72, 0.3), 0.04, STEEL), pivot);
    pivot.add(box(4.6, 0.08, 0.36, BLU, 0, 0.05, 0));
    for (const sx of [-1, 1]) pivot.add(box(0.5, 0.05, 0.4, YEL, sx * 1.95, 0.11, 0), bar(V(sx * 1.55, 0.08, 0), V(sx * 1.55, 0.42, 0), 0.025, STEEL), bar(V(sx * 1.55, 0.42, -0.17), V(sx * 1.55, 0.42, 0.17), 0.025, RED));
    g.updateMatrixWorld(true);
    const end = world(g, 1.95, 0), c = { x: g.position.x, z: g.position.z };
    play.seesaw = { x: end.x, z: end.z, g, r: 0.9, seat: pivot, amp: 0.03, want: 0.03, idle: 0.03, busy: 0.27, rider: false, pose: KID_POSE.hold, sit: 'astride', exit: world(g, 2.2, 1.6), side: 1,
      dist(px, pz) { const p = g.worldToLocal(V(px, 0, pz)); this.near = p.x < 0 ? -1 : 1; return Math.hypot(Math.max(0, Math.abs(p.x) - 2.3), p.z); },   // how far he is from the plank
      put(k) { const sd = this.side = this.near || 1; this.near = 0; k.position.set(sd * 1.95, 0.13 - 0.93, 0); k.rotation.set(0, -sd * Math.PI / 2, 0); this.exit = world(g, sd * 2.2, 1.6); const e = world(g, sd * 1.95, 0); this.x = e.x; this.z = e.z; } };
  }
  // the slide: a ladder up to a deck, and a chute down the other side
  {
    const g = place(-5.6, 3.2, -0.4), H = 2.15, L = 3.9;
    for (const sx of [-1, 1]) {
      g.add(bar(V(sx * 0.3, 0, -1.75), V(sx * 0.3, H + 0.02, -0.95), 0.035, STEEL), bar(V(sx * 0.48, 0, -0.9), V(sx * 0.48, H + 0.95, -0.9), 0.04, BLU), bar(V(sx * 0.48, 0, 0), V(sx * 0.48, H + 0.95, 0), 0.04, BLU));
      g.add(bar(V(sx * 0.48, H + 0.95, -0.9), V(sx * 0.48, H + 0.95, 0), 0.035, BLU), bar(V(sx * 0.36, H + 0.14, 0.05), V(sx * 0.36, 0.42, L - 0.1), 0.035, RED));
    }
    for (let k = 1; k <= 6; k++) { const t = k / 7; g.add(bar(V(-0.3, H * t, -1.75 + 0.8 * t), V(0.3, H * t, -1.75 + 0.8 * t), 0.028, STEEL)); }
    g.add(box(1.0, 0.08, 0.95, GRN, 0, H, -0.45));
    const chute = box(0.72, 0.05, Math.hypot(L, H - 0.25) + 0.1, YEL, 0, (H + 0.25) / 2, L / 2); chute.rotation.x = Math.atan2(H - 0.25, L); g.add(chute);
    g.add(box(0.72, 0.05, 0.7, YEL, 0, 0.25, L + 0.3), bar(V(-0.3, 0, L + 0.5), V(-0.3, 0.25, L + 0.5), 0.035, STEEL), bar(V(0.3, 0, L + 0.5), V(0.3, 0.25, L + 0.5), 0.035, STEEL));
    g.updateMatrixWorld(true);
    const foot = world(g, 0, -2.3), mid = world(g, 0, 1.2);
    play.slide = { x: foot.x, z: foot.z, g, r: 0.8, seat: g, rider: false, pose: KID_POSE.hold, sit: 'slide', dur: 3.4, auto: true, tt: 0, exit: world(g, 0, L + 1.5), exitTurn: -0.4, top: V(0, H + 0.06, 0.1), low: V(0, 0.32, L + 0.2),
      put(k) { k.position.copy(this.top).y -= 0.9; k.rotation.set(0, 0, 0); this.tt = 0; } };
    play.spots.push({ x: mid.x, z: mid.z, r: 1.0 }, { x: world(g, 0, -0.9).x, z: world(g, 0, -0.9).z, r: 0.9 });
  }
  // monkey bars
  {
    const g = place(6.2, -6.5, 0.2), H = 2.35;
    for (const sx of [-1, 1]) { for (const sz of [-1, 1]) g.add(bar(V(sx * 0.75, 0, sz * 1.7), V(sx * 0.75, H, sz * 1.7), 0.045, GRN)); g.add(bar(V(sx * 0.75, H, -1.7), V(sx * 0.75, H, 1.7), 0.04, GRN)); }
    for (let k = 0; k < 7; k++) g.add(bar(V(-0.75, H, -1.5 + k * 0.5), V(0.75, H, -1.5 + k * 0.5), 0.028, YEL));
    for (const sz of [-1, 1]) for (let k = 1; k <= 4; k++) g.add(bar(V(-0.75, k * 0.45, sz * 1.7), V(0.75, k * 0.45, sz * 1.7), 0.028, RED));
    g.updateMatrixWorld(true);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const p = world(g, sx * 0.75, sz * 1.7); play.spots.push({ x: p.x, z: p.z, r: 0.45 }); }
    const foot = world(g, 0, -2.3);
    play.bars = { x: foot.x, z: foot.z, g, r: 0.8, seat: g, rider: false, pose: KID_POSE.stand, dur: 6.2, auto: true, tt: 0, exit: world(g, 0, 2.7), H,
      put(k) { k.position.set(0, 0.14, -1.5); k.rotation.set(0, 0, 0); this.tt = 0; } };
  }
  // a sandpit, with a bucket left in it
  {
    const g = place(-6.0, -5.2, 0.3), SAND = new THREE.MeshStandardMaterial({ color: 0xead9a4, roughness: 1 });
    const sand = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.12, 6), SAND); sand.position.y = 0.06; sand.receiveShadow = true; g.add(sand);
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3, b = a + Math.PI / 3; g.add(bar(V(Math.cos(a) * 1.95, 0.14, Math.sin(a) * 1.95), V(Math.cos(b) * 1.95, 0.14, Math.sin(b) * 1.95), 0.11, MAT.wood)); }
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.26, 14), RED); bucket.position.set(0.5, 0.25, -0.3); bucket.castShadow = true; g.add(bucket);
    const heap = new THREE.Mesh(sphereGeo, SAND); heap.scale.set(0.42, 0.22, 0.42); heap.position.set(-0.5, 0.12, 0.4); g.add(heap);
    const fort = new THREE.Group(); fort.position.set(0.1, 0.12, 0.95); g.add(fort);                 // what she builds: a keep and four little towers
    const mound = (r, h, x, z) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r, h, 12), SAND); m.position.set(x, h / 2, z); m.castShadow = true; fort.add(m); };
    mound(0.3, 0.38, 0, 0); for (const [x, z] of [[-0.36, -0.3], [0.36, -0.3], [-0.36, 0.3], [0.36, 0.3]]) mound(0.13, 0.3, x, z);
    fort.scale.setScalar(0.01);
    g.updateMatrixWorld(true);
    play.sand = { x: g.position.x, z: g.position.z, g, r: 1.5, seat: g, rider: false, pose: KID_POSE.hold, sit: 'slide', fort, built: 0, exit: world(g, 0, -2.9), exitTurn: Math.PI,
      put(k) { k.position.set(0.1, 0.13 - 0.84, -0.25); k.rotation.set(0, 0, 0); } };
  }
  {
    const COLS = [0xe8806e, 0xf0cf6e, 0x8fc3e6, 0x9fd08c, 0xf0a3c0, 0xf2b07a, 0xc3a6e0, 0xf6efe0];   // the colours of the meadow flowers
    play.deco = [];
    // a balloon: fuller at the top, drawn in to a knot, skin that shines and lets a little light through
    const balloonGeo = (() => { const p = []; for (let k = 0; k <= 22; k++) { const a = k / 22 * Math.PI; p.push(new THREE.Vector2(Math.max(0.001, 0.47 * Math.sin(a) * (1 - 0.2 * Math.cos(a))), -0.6 * Math.cos(a))); } return new THREE.LatheGeometry(p, 28); })();
    const knotGeo = new THREE.ConeGeometry(0.05, 0.1, 8), stringMat = new THREE.MeshStandardMaterial({ color: 0xf3ead8, roughness: 1 });
    const balloon = (x, y, z, col, len, lean, size = 1) => {             // tied at x,y,z; it floats `len` above on a string that bows a little
      const pivot = new THREE.Group(); pivot.position.set(x, y, z); scene.add(pivot);
      const mat = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, transparent: true, opacity: 0.93, emissive: col, emissiveIntensity: 0.16 });
      const b = new THREE.Mesh(balloonGeo, mat); b.scale.setScalar(size); b.position.set(lean[0], len + 0.6 * size, lean[1]); b.castShadow = true;
      const k = new THREE.Mesh(knotGeo, mat); k.position.set(lean[0], len - 0.03, lean[1]);
      const curve = new THREE.CatmullRomCurve3([V(0, 0, 0), V(lean[0] * 0.2, len * 0.35, lean[1] * 0.2), V(lean[0] * 0.75, len * 0.75, lean[1] * 0.75), V(lean[0], len, lean[1])]);
      const st = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.009, 4), stringMat);
      pivot.add(b, k, st); play.deco.push({ kind: 'balloon', o: pivot, b, ph: Math.random() * 6.28, x, z });
    };
    // cloth for the pennants: a woven look and a stitched hem, tinted by each flag's own colour
    const clothTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
      for (let k = 0; k < 128; k += 3) { g.fillStyle = 'rgba(0,0,0,0.045)'; g.fillRect(k, 0, 1, 128); g.fillRect(0, k, 128, 1); }
      g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(0, 0, 128, 9); g.fillStyle = 'rgba(255,255,255,0.5)'; for (let k = 4; k < 128; k += 10) g.fillRect(k, 4, 5, 1.5);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const pennantGeo = (() => {                                // a long triangle, cut into strips so it can curl
      const pos = [], uv = [], idx = [], N = 6, W = 0.62, H = 0.92;
      for (let k = 0; k <= N; k++) { const t = k / N, hw = W / 2 * (1 - t); pos.push(-hw, -t * H, 0, hw, -t * H, 0); uv.push(0.5 - 0.5 * (1 - t), 1 - t, 0.5 + 0.5 * (1 - t), 1 - t); if (k < N) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
    })();
    const gateway = (t, wide, tall, along = valleyAt) => {
      const a = along(t, -wide), b = along(t, wide), ya = hillHeight(a.x, a.z), yb = hillHeight(b.x, b.z), ry = Math.atan2(-(b.z - a.z), b.x - a.x);
      for (const [p, y] of [[a, ya], [b, yb]]) {
        scene.add(bar(V(p.x, y - 0.2, p.z), V(p.x, y + tall + 0.25, p.z), 0.13, MAT.wood), knob(V(p.x, y + tall + 0.25, p.z), 0.16, MAT.dark));
        for (const h of [tall - 0.05, tall + 0.05]) scene.add(bar(V(p.x, y + h - 0.03, p.z), V(p.x, y + h + 0.03, p.z), 0.145, stringMat));       // the rope lashed round the post
      }
      const N = 13, sagAt = u => Math.sin(u * Math.PI) * 1.05, at3 = u => V(a.x + (b.x - a.x) * u, ya + (yb - ya) * u + tall - sagAt(u), a.z + (b.z - a.z) * u);
      const rope = []; for (let k = 0; k <= 20; k++) rope.push(at3(k / 20));
      scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rope), 40, 0.022, 6), stringMat));
      for (let k = 0; k < N; k++) {
        const u = (k + 0.5) / N, p = at3(u), hang = new THREE.Group(); hang.position.copy(p); hang.rotation.y = ry; scene.add(hang);
        const f = new THREE.Mesh(pennantGeo.clone(), new THREE.MeshStandardMaterial({ map: clothTex, color: COLS[(k * 3 + Math.round(t)) % COLS.length], roughness: 0.95, side: THREE.DoubleSide }));
        f.castShadow = true; hang.add(f); play.deco.push({ kind: 'flag', o: hang, f, ph: k * 0.9 + t, x: p.x, z: p.z });
      }
      for (const [p, y, sd] of [[a, ya, 0], [b, yb, 4]]) for (let k = 0; k < 3; k++) balloon(p.x, y + tall + 0.2, p.z, COLS[(k * 2 + sd) % COLS.length], 1.3 + k * 0.5, [(k - 1) * 0.45, (k % 2) * 0.35 - 0.1], 0.9);
    };
    gateway(41, 5.5, 5.2); gateway(53, 7, 4.2);
    gateway(43, 5.5, 5.2, valley2At);
    // on the beach: a rowing boat riding the swell, driftwood, smooth stones, a striped windbreak and a sandcastle
    {
      const ang = a => ({ x: BAY.x + Math.cos(a), z: BAY.z + Math.sin(a) }), on = (a, r) => { const p = { x: BAY.x + Math.cos(a) * r, z: BAY.z + Math.sin(a) * r }; return V(p.x, hillHeight(p.x, p.z), p.z); };
      const toMeadow = Math.atan2(-BAY.z, -BAY.x);              // the side of the cove he arrives on
      // A clinker-built rowing boat: lapped planks over ribs, keel and stem, a transom, thwarts, floorboards,
      // oars resting in their rowlocks, a coiled painter and a bailing bucket.
      const boat = new THREE.Group();
      {
        const L = 2.15, BM = 0.82, sm = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
        const beam = u => BM * (1 - Math.pow(Math.max(0, (u - 0.42) / 0.58), 2.3)) * (0.62 + 0.38 * sm(u / 0.42));
        const keelY = u => -0.36 + 0.34 * Math.pow(Math.max(0, (u - 0.62) / 0.38), 2.4) + 0.1 * Math.pow(1 - u, 3);
        const gunY = u => 0.2 + 0.2 * Math.pow(Math.abs(u - 0.42) / 0.58, 2.2);
        const zAt = (u, t) => -L + 2 * L * u + 0.22 * t * Math.pow(u, 5);          // the stem rakes forward a little
        const pt = (u, t, side, out = 0) => { const b = beam(u), ky = keelY(u); return V(side * (b * Math.pow(t, 0.6) + out * Math.min(1, b * 8)), ky + (gunY(u) - ky) * Math.pow(t, 1.7), zAt(u, t)); };
        const halfAt = (u, y) => { const ky = keelY(u), f = (y - ky) / (gunY(u) - ky); return f <= 0 ? 0 : beam(u) * Math.pow(Math.pow(Math.min(1, f), 1 / 1.7), 0.6); };
        const grain = (base, streak, rx, ry) => { const t = grainTexture(base, streak); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); return t; };
        const plankMat = new THREE.MeshStandardMaterial({ map: grain('#efe8da', '#5e4a36', 1, 1), vertexColors: true, roughness: 0.72, side: THREE.DoubleSide });
        const oak = new THREE.MeshStandardMaterial({ map: grain('#c9965a', '#6a4220', 2, 1), roughness: 0.7 });
        const pale = new THREE.MeshStandardMaterial({ map: grain('#e3bd84', '#8a5a2c', 2, 1), roughness: 0.7 });
        const iron = new THREE.MeshStandardMaterial({ color: 0x3b3d40, metalness: 0.7, roughness: 0.45 });
        const rope = new THREE.MeshStandardMaterial({ map: grain('#dccb9c', '#7d6a40', 8, 1), roughness: 1 });
        const tube = (pts, r, mat, seg = 6) => { const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 3, r, seg), mat); m.castShadow = true; return m; };
        // planking: seven strakes a side, each standing a little proud of the one below it
        {
          const pos = [], col = [], uv = [], idx = [], NS = 7, NU = 40, ROWS = 3;
          for (const side of [-1, 1]) for (let k = 0; k < NS; k++) {
            const shade = 0.9 + 0.1 * ((k * 5 + (side > 0 ? 2 : 0)) % 4) / 3, c = k === NS - 1 ? [0.93, 0.92, 0.86] : k < 2 ? [0.3 * shade, 0.2 * shade, 0.13 * shade] : [0.56 * shade, 0.32 * shade, 0.15 * shade];
            const base = pos.length / 3;
            for (let a = 0; a <= NU; a++) for (let b = 0; b <= ROWS; b++) {
              const f = b / ROWS, p = pt(a / NU, (k + f) / NS, side, 0.024 * (1 - f));
              pos.push(p.x, p.y, p.z); col.push(c[0], c[1], c[2]); uv.push(a / NU * 5, (k + f) / NS * 2);
            }
            for (let a = 0; a < NU; a++) for (let b = 0; b < ROWS; b++) { const q = base + a * (ROWS + 1) + b, n = q + ROWS + 1; idx.push(q, n, q + 1, q + 1, n, n + 1); }
          }
          for (const side of [-1, 1]) {                        // inside, the painted top plank is lined with bare wood
            const base = pos.length / 3;
            for (let a = 0; a <= NU; a++) for (let b = 0; b <= 1; b++) { const p = pt(a / NU, b ? 0.995 : (NS - 1) / NS - 0.01, side, -0.012); pos.push(p.x, p.y, p.z); col.push(0.6, 0.36, 0.18); uv.push(a / NU * 5, b * 0.3); }
            for (let a = 0; a < NU; a++) { const q = base + a * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
          }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
          const hull = new THREE.Mesh(g, plankMat); hull.castShadow = hull.receiveShadow = true; boat.add(hull);
        }
        // the transom closing the stern
        {
          const pos = [], uv = [], idx = [], N = 12;
          for (let k = 0; k <= N; k++) for (const side of [-1, 1]) { const p = pt(0, k / N, side, 0.02); pos.push(p.x, p.y, p.z); uv.push(0.5 + p.x * 0.6, p.y * 1.2); }
          for (let k = 0; k < N; k++) { const q = k * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
          const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: oak.map, roughness: 0.7, side: THREE.DoubleSide })); m.castShadow = true; boat.add(m);
          boat.add(box(beam(0) * 2 + 0.1, 0.05, 0.08, pale, 0, gunY(0) + 0.01, -L));
        }
        // keel running up into the stem, and the gunwale rails
        { const pts = []; for (let k = 0; k <= 20; k++) { const u = k / 20; pts.push(V(0, keelY(u) - 0.025, zAt(u, 0))); }
          for (let k = 1; k <= 8; k++) pts.push(V(0, keelY(1) + (gunY(1) + 0.1 - keelY(1)) * k / 8, zAt(1, k / 8) + 0.03));
          boat.add(tube(pts, 0.036, oak)); }
        for (const side of [-1, 1]) { const pts = []; for (let k = 0; k <= 24; k++) { const p = pt(k / 24, 1, side, 0.02); p.y += 0.012; pts.push(p); } boat.add(tube(pts, 0.032, pale, 8)); }
        // ribs, steamed to the shape of the hull
        for (let u = 0.07; u < 0.93; u += 0.078) { const pts = []; for (let k = 10; k >= 1; k--) pts.push(pt(u, k / 10, -1, -0.022)); for (let k = 0; k <= 10; k++) pts.push(pt(u, k / 10, 1, -0.022)); boat.add(tube(pts, 0.015, pale, 5)); }
        // thwarts to sit on, a knee in the bow, and floorboards
        for (const [u, deep] of [[0.11, 0.42], [0.42, 0.25], [0.68, 0.22]]) { const w = halfAt(u, 0.05) * 2 - 0.05; boat.add(box(w, 0.04, deep, pale, 0, 0.05, zAt(u, 0))); }
        boat.add(box(halfAt(0.93, gunY(0.93) - 0.03) * 2, 0.04, 0.3, pale, 0, gunY(0.93) - 0.03, zAt(0.93, 0)));
        for (const x of [-0.3, -0.15, 0, 0.15, 0.3]) { const u0 = Math.abs(x) > 0.2 ? 0.26 : 0.13, u1 = Math.abs(x) > 0.2 ? 0.69 : 0.74, z0 = zAt(u0, 0), z1 = zAt(u1, 0); boat.add(box(0.125, 0.025, z1 - z0, oak, x, -0.245, (z0 + z1) / 2)); }
        // rowlocks, and the oars left resting in them with their blades trailing just clear of the water
        const uL = 0.345, zL = zAt(uL, 0);
        for (const side of [-1, 1]) {
          const lock = pt(uL, 1, side, 0.02); boat.add(box(0.08, 0.035, 0.2, oak, lock.x, lock.y + 0.035, lock.z));
          boat.add(bar(V(lock.x, lock.y + 0.04, lock.z), V(lock.x, lock.y + 0.085, lock.z), 0.012, iron));
          const horn = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.011, 6, 14, Math.PI), iron); horn.rotation.set(0, Math.PI / 2, 0); horn.rotation.z = Math.PI; horn.position.set(lock.x, lock.y + 0.13, lock.z); boat.add(horn);
          const dir = V(side * 1.75, -0.36, -0.5), len = 2.75, inboard = 0.72, at = V(lock.x, lock.y + 0.115, lock.z), oar = new THREE.Group();
          dir.normalize(); oar.position.copy(at).addScaledVector(dir, -inboard); oar.quaternion.setFromUnitVectors(UP, dir);
          const part = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; oar.add(m); return m; };
          part(new THREE.CylinderGeometry(0.019, 0.019, 0.2, 8), oak, 0.1);                          // the grip
          part(new THREE.CylinderGeometry(0.03, 0.024, len - 0.85, 10), pale, 0.2 + (len - 0.85) / 2); // the loom
          part(new THREE.CylinderGeometry(0.037, 0.037, 0.2, 10), MAT.dark, inboard);                 // leather where it bears on the rowlock
          part(new THREE.TorusGeometry(0.04, 0.012, 6, 12), MAT.dark, inboard - 0.11).rotation.x = Math.PI / 2;
          part(new THREE.CylinderGeometry(0.115, 0.03, 0.68, 16), pale, len - 0.34).scale.z = 0.13;    // the blade
          part(new THREE.CylinderGeometry(0.117, 0.117, 0.035, 16), new THREE.MeshStandardMaterial({ color: COLS[0], roughness: 0.8 }), len - 0.02).scale.z = 0.14;   // its painted tip
          boat.add(oar);
        }
        // the painter: made fast to a ring on the stem and coiled down in the bow
        { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.009, 6, 12), iron); ring.position.set(0, gunY(1) - 0.02, zAt(1, 0.9) - 0.03); boat.add(ring);
          const cz = zAt(0.82, 0), cy = keelY(0.82) + 0.1;
          for (let k = 0; k < 4; k++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.17 - k * 0.028, 0.02, 6, 22), rope); t.rotation.x = Math.PI / 2; t.position.set(0.02 * (k % 2), cy + k * 0.036, cz + 0.01 * k); t.castShadow = true; boat.add(t); }
          boat.add(tube([V(0, gunY(1) - 0.05, zAt(1, 0.9) - 0.04), V(0.03, gunY(0.95) - 0.16, zAt(0.95, 0) - 0.02), V(0.08, cy + 0.22, cz + 0.2), V(0.1, cy + 0.14, cz + 0.06)], 0.02, rope)); }
        // a bailing bucket by the stern seat
        { const b = new THREE.Group(), tin = new THREE.MeshStandardMaterial({ color: COLS[1 % COLS.length], roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
          b.add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.085, 0.2, 16, 1, true), tin)); const bot = new THREE.Mesh(new THREE.CircleGeometry(0.085, 16), tin); bot.rotation.x = -Math.PI / 2; bot.position.y = -0.098; b.add(bot);
          const lip = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.008, 5, 18), iron); lip.rotation.x = Math.PI / 2; lip.position.y = 0.1; b.add(lip);
          const handle = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.006, 5, 14, Math.PI), iron); handle.rotation.x = 0.9; handle.position.y = 0.1; b.add(handle);
          b.position.set(0.22, -0.13, zAt(0.3, 0)); b.rotation.z = 0.06; b.traverse(o => { o.castShadow = true; }); boat.add(b); }
        // the sea is kept out of the inside: an unseen lid below the gunwale that the water cannot be drawn through
        boat.traverse(o => { o.renderOrder = -2; });
        { const pos = [], idx = [], N = 30, y = 0.1;
          for (let k = 0; k <= N; k++) { const u = k / N, h = halfAt(u, y) * 0.98; pos.push(-h, y, zAt(u, 0.6), h, y, zAt(u, 0.6)); if (k < N) { const q = k * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); } }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
          const lid = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide })); lid.renderOrder = -1; boat.add(lid); }
      }
      const SEA = BAY.level > -50;                              // the boat, windbreak and sandcastle belong to a shore: with no sea they stay away
      if (SEA) { const bp = on(toMeadow + 0.5, 25); boat.position.set(bp.x, BAY.level + 0.12, bp.z); boat.rotation.y = 0.8; scene.add(boat); play.deco.push({ kind: 'boat', o: boat, ph: 1.3, x: bp.x, z: bp.z }); }
      for (const [da, r, len, turn] of [[0.25, 36.5, 3.2, 0.4], [-0.35, 37.5, 2.2, 1.9], [0.9, 36, 2.6, 2.6]]) {
        const p = on(toMeadow + da, r), a = turn, log = bar(V(p.x - Math.cos(a) * len / 2, p.y + 0.16, p.z - Math.sin(a) * len / 2), V(p.x + Math.cos(a) * len / 2, p.y + 0.2, p.z + Math.sin(a) * len / 2), 0.17, MAT.wood); scene.add(log);
        play.spots.push({ x: p.x, z: p.z, r: 0.7 });
      }
      for (let k = 0; k < 16; k++) { const p = on(toMeadow + (k * 0.618 % 1 - 0.5) * 2.6, 33 + (k * 0.37 % 1) * 6), st = new THREE.Mesh(sphereGeo, MAT.stone); const sz = 0.16 + (k * 0.29 % 1) * 0.3; st.scale.set(sz * 1.4, sz * 0.6, sz); st.position.set(p.x, p.y + sz * 0.2, p.z); st.rotation.y = k; st.castShadow = true; scene.add(st); }
      // a windbreak: striped cloth between three poles
      if (SEA) { const p0 = on(toMeadow - 0.12, 38.2), p1 = on(toMeadow + 0.02, 38.6), p2 = on(toMeadow + 0.14, 38);
        for (const p of [p0, p1, p2]) scene.add(bar(V(p.x, p.y - 0.1, p.z), V(p.x, p.y + 1.5, p.z), 0.05, MAT.wood));
        for (const [a, b] of [[p0, p1], [p1, p2]]) for (let k = 0; k < 6; k++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(a.distanceTo(b), 0.2), new THREE.MeshStandardMaterial({ map: clothTex, color: k % 2 ? 0xf6efe0 : COLS[0], side: THREE.DoubleSide, roughness: 0.95 })); m.position.set((a.x + b.x) / 2, a.y + 0.25 + k * 0.2, (a.z + b.z) / 2); m.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x); m.castShadow = true; scene.add(m); } }
      // somebody's sandcastle
      if (SEA) { const p = on(toMeadow + 0.42, 36.8), SAND2 = new THREE.MeshStandardMaterial({ color: 0xe6cf96, roughness: 1 });
        for (const [dx, dz, r, h] of [[0, 0, 0.42, 0.5], [-0.5, -0.4, 0.17, 0.42], [0.5, -0.4, 0.17, 0.42], [-0.5, 0.4, 0.17, 0.42], [0.5, 0.4, 0.17, 0.42]]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r, h, 14), SAND2); m.position.set(p.x + dx, p.y + h / 2, p.z + dz); m.castShadow = true; scene.add(m); } }
    }
    const c = at(0, 0);                                         // a big bunch on a tall pole over the middle of the playground, seen from across the meadow
    scene.add(bar(V(c.x, 0, c.z), V(c.x, 6.6, c.z), 0.1, MAT.wood), knob(V(c.x, 6.6, c.z), 0.14, MAT.dark));
    for (let k = 0; k < 9; k++) { const an = k * 2.4, r = 0.35 + (k % 3) * 0.42; balloon(c.x, 6.6, c.z, COLS[k % COLS.length], 1.5 + (k % 4) * 0.55, [Math.cos(an) * r, Math.sin(an) * r], 1.15); }
    play.spots.push({ x: c.x, z: c.z, r: 0.5 });
  }
  play.field = at(0, 0);
}
const RIDES = ['swing', 'hammock', 'round', 'seesaw', 'slide', 'bars', 'sand'];
function updatePlay(dt) {
  {
    const rd = play.round, ss = play.seesaw, sl = play.slide;
    rd.speed += (rd.want - rd.speed) * Math.min(1, dt * 0.8); rd.seat.rotation.y -= rd.speed * dt;
    ss.amp += (ss.want - ss.amp) * Math.min(1, dt * 0.9); ss.seat.rotation.z = Math.sin(time * 1.7) * ss.amp;
    for (const d of play.deco) {
      const wt = scenery.windTime, ws = scenery.wind, gust = (Math.sin(d.x * 0.21 + d.z * 0.12 - wt * 1.5 + Math.sin(d.z * 0.08 + wt * 0.25) * 2.2) * 0.5 + 0.5) * (0.15 + 0.85 * ws), g2 = gust * gust;
      if (d.kind === 'boat') { d.o.position.y = BAY.level + 0.12 + Math.sin(wt * 1.5 + d.ph) * 0.07 * (0.6 + ws); d.o.rotation.z = Math.sin(wt * 1.3 + d.ph) * 0.07 * (0.5 + ws); d.o.rotation.x = Math.sin(wt * 1.7) * 0.04 * (0.5 + ws); continue; }
      if (d.kind === 'balloon') { d.o.rotation.z = -0.03 - Math.min(0.75, g2 * 0.3) + Math.sin(wt * 1.7 + d.ph) * 0.05; d.o.rotation.x = Math.sin(wt * 1.3 + d.ph * 1.7) * 0.07 + g2 * 0.08; d.b.rotation.y = Math.sin(wt * 0.6 + d.ph) * 0.5; }
      else {
        d.o.rotation.x = 0.04 + Math.min(1.2, g2 * 0.8) + Math.sin(wt * 4.6 + d.ph) * 0.1 * (0.2 + gust);
        const p = d.f.geometry.attributes.position; for (let k = 0; k < p.count; k++) { const t = -p.getY(k) / 0.92; p.setZ(k, Math.sin(t * 4.2 - wt * 7 + d.ph) * 0.07 * t * (0.25 + gust)); } p.needsUpdate = true;
      }
    }
    const mb = play.bars, sd = play.sand;
    if (mb.rider) {                                          // along the rungs and back to the middle of the far end, body swinging under her hands
      mb.tt += dt; const p = Math.min(1, mb.tt / 5.4), reach = Math.sin(mb.tt * 5.2);
      kid.group.position.set(0, 0.14 + Math.abs(reach) * 0.05, -1.5 + 3.0 * p); kid.group.rotation.x = reach * 0.2; kid.group.rotation.z = Math.cos(mb.tt * 2.6) * 0.07;
    }
    if (sd.rider) { sd.built = Math.min(1, sd.built + dt / 7); kid.group.rotation.x = 0.12 + Math.sin(time * 4.2) * 0.06; if (Math.random() < dt * 2.5) dust(sd.x + rnd(0.5), 0.3, sd.z + rnd(0.5), 1); }
    else sd.built = Math.max(0, sd.built - dt / 14);         // left alone, it slowly crumbles
    sd.fort.scale.setScalar(Math.max(0.01, sd.built));
    if (sl.rider) { sl.tt += dt; const p = Math.min(1, Math.max(0, (sl.tt - 0.9) / 1.5)); kid.group.position.lerpVectors(sl.top, sl.low, p * p * (3 - 2 * p)).y -= 0.9; }
  }
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
const TOWERS = false;                                        // set true to bring the lantern towers (and levels) back
function buildLevel() {
  clearLevel();
  const rng = mulberry(level * 7919 + 17);
  const n = TOWERS ? Math.min(3 + level, 10) : 0;          // no towers for now: the meadow is left open to play in
  if (TOWERS) sites.push({ x: START.x + (level === 1 ? 0 : (rng() - 0.5) * 8), z: START.z - 11 });           // one straight ahead, so there is something to hit at once
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
  playerDismount(); player.y = 0; player.vy = 0; player.rideLock = null; player.flying = false; player.perch = null;
  player.x = START.x; player.z = START.z; player.face = 0; camYaw = 0; camReady = false;
  state = 'play'; stateT = 0; combo = 0; cooldown = 0;
  hud();
}

// ---------- HUD ----------
const elLvl = document.getElementById('lvl'), elLeft = document.getElementById('left'),
  elFade = document.getElementById('fade'), elHint = document.getElementById('hint'),
  elJoy = document.getElementById('joy'), elKnob = document.getElementById('knob');
if (localStorage.getItem('lanternfall.played')) elHint.classList.add('off');
function hud() { elLvl.textContent = level; elLeft.textContent = lanterns.length; elLvl.style.display = TOWERS ? '' : 'none'; elLeft.parentElement.style.display = TOWERS ? '' : 'none'; }
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
  if (total > 0 && lanterns.length === 0 && state === 'play') { state = 'won'; stateT = 0; sfx.win(); }
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
      castle.ballHit(p);
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
  const clear = (x, z, pad) => !WOODS.some(t => Math.hypot(t.x - x, t.z - z) < t.r * 2.2 + pad) && Math.hypot(x - CASTLE.x, z - CASTLE.z) > 42 && Math.hypot(x - BAY.x, z - BAY.z) > BAY.edge;   // and not inside the castle or in the cove
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
  if (player.perch) { leavePerch(true); return true; }
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
  player.perchLock = Math.max(0, (player.perchLock || 0) - dt);
  if (player.perch) {                                        // sitting on a limb: the stick, let go and pushed again, slips her off
    const l = window.__joy ? Math.hypot(window.__joy.x, window.__joy.y) : Math.hypot(joy.x, joy.y) + (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some(k => keys.has(k)) ? 1 : 0);
    if (l < 0.12) player.perchFree = true; else if (player.perchFree) leavePerch(false);
    if (player.perch) return;
  }
  if (player.y > 0 || player.vy > 0) {
    const fl = HERO.fly && player.flying;
    player.vy -= GRAVITY * (fl ? 0.55 : 1) * dt; if (fl && player.vy < -2.4) player.vy = -2.4;      // she drifts down
    player.y += player.vy * dt;
    if (fl) { player.trail = (player.trail || 0) - dt; if (player.trail <= 0) { player.trail = 0.08; fireflies(player.x, player.g + player.y + 0.3, player.z, 1, false); } }
    if (tryPerch()) return;
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
    const sp = SPEED * (player.flying ? 2.1 : player.swim ? 0.8 : 1);
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
  TREES.forEach((t, i) => push(t.x, t.z, player.flying && scenery.isBare(i) ? 0.45 * t.s + 0.35 : 0.7 * t.s + 0.6));
  if (!npc.away) push(npc.x, npc.z, npc.r + (HERO.mount ? 1 : 0)); if (!kid.ride && !kid.away) push(kid.x, kid.z, 0.9); for (const st of [stand, stand2]) if (st.on) push(st.x, st.z, 1.1);
  if (heroIx === KID && player.y <= 0) for (const kind of RIDES) {
    const e = play[kind], dd = e.dist ? e.dist(player.x, player.z) : Math.hypot(player.x - e.x, player.z - e.z), rad = e.r || (kind === 'swing' ? 1.7 : 1.5);
    if (player.rideLock === kind) { if (dd > rad + 1.4) player.rideLock = null; }
    else if (l > 0.12 && dd < rad + 0.3 && state === 'play' && !aim.on) { playerMount(kind); return; }
  }
  for (const q of play.spots) push(q.x, q.z, q.r);
  if (d > R) for (const t of WOODS) push(t.x, t.z, t.r);
  {
    const feet = player.g + player.y;
    castle.resolve(player, feet, HERO.mount ? 1.2 : 0.45);
    let g2 = castle.groundAt(player.x, player.z, feet);
    const wasSwim = player.swim; player.swim = false;
    if (Math.hypot(player.x - BAY.x, player.z - BAY.z) < BAY.r) {
      if (heroIx === KID && g2 < BAY.level - (wasSwim ? 0.75 : 0.95) && player.y <= 0.05 && !player.flying) { player.swim = true; g2 = BAY.level + 0.02; }   // afloat, stretched out at the surface
      else g2 = Math.max(g2, BAY.level - 0.85);              // in the cove he wades, waist deep at most
    }
    if (player.swim !== wasSwim) { for (let i = 0; i < 12; i++) spawn(player.x + rnd(0.5), BAY.level + 0.1, player.z + rnd(0.5), rnd(1.6), 1.5 + Math.random() * 2.5, rnd(1.6), 0.5 + Math.random() * 0.4, 0.09, { color: 0xeaf7ff, g: 7 }); sfx.whoosh(0.12); }
    const drop = feet - g2;
    player.y = player.y <= 0.001 && drop < 0.5 ? 0 : Math.max(0, drop);     // small steps and slopes are just walked; a real drop is a fall
    player.g = g2;
  }
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
  const lift = player.y * (player.flying || player.perch ? 0.9 : 0.5);
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
  castle.update(dt, time, player.x, player.z, player.g + player.y);
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
  else if (player.swim) { heroTilt.rotation.set(-1.5, 0, Math.sin(swimT) * 0.16);   // level, rolling a little toward the reaching arm
 hero.position.y += Math.sin(time * 2.3) * 0.04; if (bob > 0.3 && Math.random() < dtReal * 9) spawn(player.x + rnd(0.5), BAY.level + 0.05, player.z + rnd(0.5), rnd(0.8), 0.8 + Math.random() * 1.4, rnd(0.8), 0.45, 0.07, { color: 0xeaf7ff, g: 7 }); }
  else if (player.flying) heroTilt.rotation.set(-1.05 * bob, 0, Math.sin(time * 2.4) * 0.06);
  else if (HERO.glide) heroTilt.rotation.set(-0.08 * bob + tuck, 0, Math.sin(time * 1.6) * 0.025);   // leans into it, swaying a little
  else heroTilt.rotation.set(-0.16 * fake + tuck, 0, stride * 0.05 * fake);
  if (heroLoaded) {
    heroKick = Math.max(0, heroKick - dtReal / THROW.hold);
    const mode = state === 'won' ? 'win' : heroKick > 0 ? 'throw' : aiming ? 'aim' : player.swim && CLIP.jump ? 'swim' : player.perch && CLIP.jump ? 'perch' : air && player.flying && CLIP.jump ? 'fly' : air && CLIP.jump ? 'jump' : player.moving > 0.25 && CLIP.walk ? 'walk' : 'idle';
    if (mode !== heroMode) {
      if (mode === 'win') heroPlay(CLIP.win || CLIP.idle, { fade: 0.4 });
      else if (mode === 'aim') heroPlay(THROW.clip, { fade: 0.18, speed: 0, at: THROW.wind });
      else if (mode === 'throw') heroPlay(THROW.clip, { fade: 0.08, speed: THROW.speed, once: true, at: heroMode === 'aim' ? null : THROW.wind });
      else if (mode === 'fly' || mode === 'perch' || mode === 'swim') heroPlay(CLIP.jump, { fade: 0.15, speed: 0, at: HOP.t0 + (HOP.t1 - HOP.t0) * 0.5 });
      else if (mode === 'jump') heroPlay(CLIP.jump, { fade: 0.08, once: true, at: HOP.t0, speed: (HOP.t1 - HOP.t0) / (2 * JUMP_V / GRAVITY) });
      else if (mode === 'walk') heroPlay(CLIP.walk, { fade: 0.2 });
      else heroPlay(CLIP.idle, { fade: 0.35 });
      heroMode = mode;
    }
    if (mode === 'walk') heroAct.timeScale = HERO.stroll ? 0.7 + player.moving * 1.0 : 0.6 + player.moving * 1.5;
    mixer.update(dtReal);
    flyW += ((heroMode === 'fly' || player.perch || player.swim ? 1 : 0) - flyW) * Math.min(1, dtReal * 8);
    swimT += dtReal * (1.3 + 3.4 * player.moving); const stroke = swimT;
    const POSE = player.perch ? SIT_POSE : FLY_POSE;
    wings.visible = heroIx === KID && player.flying && player.y > 0 && !!flyBones.Spine2 && !!wings.userData.ready;   // hers alone, and only in the air
    if (wings.visible) {                                           // they sit between her shoulder blades and beat
      wingW += (1 - wingW) * Math.min(1, dtReal * 7);
      heroTilt.worldToLocal(flyBones.Spine2.bone.getWorldPosition(wingP)); wings.position.set(wingP.x, wingP.y + 0.14, wingP.z + 0.1);
      wings.scale.setScalar(Math.max(0.01, wingW));
      const beat = 0.14 + (0.5 + 0.5 * Math.sin(time * 5.2)) * 0.5, fold = Math.sin(time * 5.2 - 0.9) * 0.12;   // they sweep back from her shoulders and never forward, so they stay clear of her arms
      wings.children[0].rotation.set(0, -beat, fold); wings.children[1].rotation.set(0, beat, -fold);
    } else wingW = 0;
    if (flyW > 0.01 && HERO.fly) for (const n in flyBones) {
      const b = flyBones[n]; let [x, y, z] = POSE[n] || FLY_ZERO;
      if (player.swim) {
        if (n === 'Head' || n === 'Neck') x = -22;                                     // chin up, looking where she is going
      }
      b.bone.quaternion.slerp(kidQ.copy(b.bind).multiply(kidQ2.setFromEuler(kidE.set(x * D2R, y * D2R, z * D2R))), flyW);
    }
    if (player.perch && HERO.fly) sitLegs(flyW);
    if (player.swim && HERO.fly) swimLimbs(flyW, stroke);
    throwW += ((THROW.proc && (aiming || heroKick > 0) ? 1 : 0) - throwW) * Math.min(1, dtReal * 12);
    const tA = flyBones.RightArm, tF = flyBones.RightForeArm, tH = flyBones.RightHand;
    if (throwW > 0.01 && THROW.proc && tA && tF && tH) {         // drawn back over her shoulder while she aims, whipped forward as she lets go
      const q = aiming ? 0 : Math.min(1, (1 - heroKick) * 2.6), e = q * q * (3 - 2 * q);
      hero.getWorldQuaternion(sitQ);
      aimBone(tA.bone, tF.bone, sitD.set(-0.5 + 0.3 * e, 0.7 - 0.8 * e, 0.5 - 1.5 * e).normalize().applyQuaternion(sitQ), throwW);
      aimBone(tF.bone, tH.bone, sitD.set(-0.15, 0.95 - 1.05 * e, 0.25 - 1.25 * e).normalize().applyQuaternion(sitQ), throwW);
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
  fling, jump, setHero, swapHero, beacons, motes, lightBeacon, debug: { castle, CASTLE, FLY_POSE, SIT_POSE, perches, scenery, WING, wings, WOODS, npc, kid, stand, stand2, play, KID_POSE, kidMount, kidDismount, scene, camera, hero, acts, THROW, THREE, player, sites, renderer, get mixer() { return mixer; } },
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
