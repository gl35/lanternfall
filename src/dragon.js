// A metallic purple dragon, long and slender: a swan-curved neck and a whip of a tail in many close joints so they flow,
// a lean body on fine legs, swept golden horns, and wide scalloped wings that beat in the air and fold on the ground.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

function scaleBump() {                                       // overlapping rows of small scales, as a height map
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'); g.fillStyle = '#707070'; g.fillRect(0, 0, 256, 256);
  for (let row = -1; row < 13; row++) for (let col = -1; col < 9; col++) {
    const x = col * 32 + (row % 2 ? 16 : 0), y = row * 21.33, gr = g.createLinearGradient(0, y, 0, y + 30);
    gr.addColorStop(0, '#cfcfcf'); gr.addColorStop(0.75, '#8e8e8e'); gr.addColorStop(1, '#3a3a3a');
    g.fillStyle = gr; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 32, y); g.quadraticCurveTo(x + 32, y + 24, x + 16, y + 31); g.quadraticCurveTo(x, y + 24, x, y); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(7, 5); return t;
}

// With a model file given, that model is the dragon: the built one below stands in only until it has loaded (or if it fails to).
export const DRAGON_FIT = { span: 10, turn: -Math.PI / 2, level: 0.85, seat: [0.6, 0.06], mouth: [0.75, 0.47], hinge: [0.75, 0.56], low: 0.42, tailLow: 0.33, tailThick: 0.75 };   // tailLow: the tail's tip is looked for below this part of her height; tailThick: a slice wider than this (metres) is body, not tail   // hinge: how far out from her spine the wings start to swing (metres), and how high (part of her height)   // how long she is made; which way the model faces; where the kid sits and where the fire leaves, as parts of her height and length
export function buildDragon(renderer, url) {
  const pm = new THREE.PMREMGenerator(renderer), env = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
  const bump = scaleBump();
  const hide = new THREE.MeshPhysicalMaterial({ color: 0x6f2fe0, metalness: 0.9, roughness: 0.22, envMap: env, envMapIntensity: 1.5, bumpMap: bump, bumpScale: 1.4, clearcoat: 1, clearcoatRoughness: 0.12, iridescence: 0.7, iridescenceIOR: 1.7 });
  const belly = new THREE.MeshPhysicalMaterial({ color: 0xd3b6ff, metalness: 0.8, roughness: 0.25, envMap: env, envMapIntensity: 1.4, clearcoat: 1, clearcoatRoughness: 0.15 });
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xa57cf7, metalness: 0.85, roughness: 0.2, envMap: env, envMapIntensity: 1.5, clearcoat: 1, clearcoatRoughness: 0.1 });   // spines and crest: a paler violet
  const hornMat = new THREE.MeshPhysicalMaterial({ color: 0x9d7bea, metalness: 0.85, roughness: 0.22, envMap: env, envMapIntensity: 1.5, clearcoat: 1, clearcoatRoughness: 0.1 });
  const claw = new THREE.MeshStandardMaterial({ color: 0x3b1c86, metalness: 0.9, roughness: 0.25, envMap: env, envMapIntensity: 1.4 });
  // wing skin: violet deepening to the root, with veins that glow
  const veins = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
    const bg = g.createRadialGradient(40, 380, 20, 40, 380, 560); bg.addColorStop(0, '#2c0f78'); bg.addColorStop(0.45, '#6426c4'); bg.addColorStop(1, '#9a50e6'); g.fillStyle = bg; g.fillRect(0, 0, 512, 512);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.lineCap = 'round'; g.shadowColor = '#f070ff'; g.strokeStyle = '#d98cff';
    const branch = (x, y, a, len, w, depth) => {
      let px = x, py = y; g.lineWidth = w; g.shadowBlur = 6 + w * 3; g.globalAlpha = 0.55 + 0.1 * depth; g.beginPath(); g.moveTo(px, py);
      const steps = 7; for (let k = 0; k < steps; k++) { a += (rnd() - 0.5) * 0.9; px += Math.cos(a) * len / steps; py += Math.sin(a) * len / steps; g.lineTo(px, py); if (depth > 0 && k > 1 && rnd() < 0.5) { g.stroke(); branch(px, py, a + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5), len * 0.55, w * 0.6, depth - 1); g.lineWidth = w; g.shadowBlur = 6 + w * 3; g.globalAlpha = 0.55 + 0.1 * depth; g.beginPath(); g.moveTo(px, py); } }
      g.stroke();
    };
    for (let k = 0; k < 13; k++) branch(30 + rnd() * 60, 300 + rnd() * 150, -1.5 + k * 0.14 + rnd() * 0.1, 330 + rnd() * 160, 2.4, 3);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const skin = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: veins, emissive: 0xffffff, emissiveMap: veins, emissiveIntensity: 0.3, metalness: 0.45, roughness: 0.32, envMap: env, envMapIntensity: 1.0, side: THREE.DoubleSide, vertexColors: true, iridescence: 0.6, iridescenceIOR: 1.5 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xf6dcff, emissive: 0xd070ff, emissiveIntensity: 0.9, roughness: 0.15 });
  const glint = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0418, roughness: 0.35 });

  const S = 0.85, root = new THREE.Group(), model = new THREE.Group(); model.scale.setScalar(S); root.add(model);
  const sphere = new THREE.SphereGeometry(1, 28, 18), coneG = new THREE.ConeGeometry(1, 1, 12);
  const ball = (parent, mat, sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(sphere, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const cone = (parent, mat, r, h, x, y, z, rx = 0, rz = 0) => {     // stands on its base at x,y,z, leaning by rx, rz
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.set(rx, 0, rz); const m = new THREE.Mesh(coneG, mat); m.scale.set(r, h, r); m.position.y = h / 2; m.castShadow = true; g.add(m); parent.add(g); return g;
  };
  const UP = new THREE.Vector3(0, 1, 0);
  const rod = (parent, mat, a, b, r0, r1) => { const d = b.clone().sub(a), m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, d.length(), 8), mat); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize()); m.castShadow = true; parent.add(m); return m; };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const curl = (parent, mat, pts, r0, r1) => {
    const curve = new THREE.CatmullRomCurve3(pts), N = 22, RAD = 9, fr = curve.computeFrenetFrames(N, false), pos = [], idx = [];
    for (let i = 0; i <= N; i++) { const t = i / N, p = curve.getPoint(t), r = (r0 + (r1 - r0) * t) * (1 + 0.07 * Math.sin(t * 40));     // faint rings along it
      for (let j = 0; j < RAD; j++) { const a = j / RAD * 6.283, cx = Math.cos(a) * r, sy = Math.sin(a) * r; pos.push(p.x + fr.normals[i].x * cx + fr.binormals[i].x * sy, p.y + fr.normals[i].y * cx + fr.binormals[i].y * sy, p.z + fr.normals[i].z * cx + fr.binormals[i].z * sy); } }
    for (let i = 0; i < N; i++) for (let j = 0; j < RAD; j++) { const a = i * RAD + j, b = i * RAD + (j + 1) % RAD; idx.push(a, b, a + RAD, b, b + RAD, a + RAD); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.castShadow = true; parent.add(m); return m;
  };

  // body: lean, deep in the chest and drawn in at the waist
  ball(model, hide, 0.46, 0.48, 0.98, 0, 1.5, 0.42); ball(model, hide, 0.36, 0.38, 0.85, 0, 1.46, -0.2); ball(model, hide, 0.4, 0.42, 0.9, 0, 1.43, -0.78);
  ball(model, belly, 0.36, 0.36, 1.55, 0, 1.3, -0.14);
  for (let k = 0; k < 7; k++) cone(model, gold, 0.035, 0.2 - k * 0.012, 0, 1.86 - k * 0.012, -0.28 - k * 0.2, -0.45);   // a fine crest down the back, behind where she sits

  // neck: many short joints in a swan's curve, up from the shoulders and over
  const neck = [], neckBase = new THREE.Group(); neckBase.position.set(0, 1.74, 1.02); neckBase.rotation.x = -1.2; model.add(neckBase);
  let at = neckBase;
  for (let i = 0; i < 10; i++) {
    const seg = new THREE.Group(), rx = i < 4 ? 0.0 : 0.19; if (i) { seg.position.z = 0.28; seg.rotation.x = rx; } seg.userData.rx = rx; at.add(seg); neck.push(seg);
    const r = 0.28 - i * 0.014; ball(seg, hide, r, r, 0.3, 0, 0, 0.14); ball(seg, belly, r * 0.74, r * 0.7, 0.27, 0, -r * 0.34, 0.15);
    if (i % 2 === 1) cone(seg, gold, 0.028, 0.14, 0, r * 0.92, 0.14, -0.5); at = seg;
  }
  const head = new THREE.Group(); head.position.z = 0.3; head.rotation.x = 0.4; at.add(head);
  ball(head, hide, 0.2, 0.18, 0.3, 0, 0.02, 0.14); ball(head, hide, 0.125, 0.095, 0.36, 0, -0.01, 0.52); ball(head, hide, 0.085, 0.05, 0.1, 0, 0.055, 0.8);
  const mouth = new THREE.Object3D(); mouth.position.set(0, -0.05, 0.9); head.add(mouth);
  const jaw = new THREE.Group(); jaw.position.set(0, -0.08, 0.16); head.add(jaw); ball(jaw, belly, 0.105, 0.04, 0.34, 0, -0.02, 0.3);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group(); eye.position.set(sx * 0.145, 0.075, 0.3); eye.rotation.y = -sx * 0.4; head.add(eye);       // turned a little to look ahead
    ball(eye, eyeMat, 0.052, 0.07, 0.092, 0, 0, 0); ball(eye, dark, 0.012, 0.052, 0.024, sx * 0.046, 0, 0.004);                 // a tall dark slit of a pupil on the pale iris
    ball(eye, glint, 0.008, 0.012, 0.012, sx * 0.047, 0.03, 0.026);
    ball(head, hide, 0.055, 0.03, 0.14, sx * 0.13, 0.135, 0.27).rotation.z = -sx * 0.3;           // brow
    ball(head, dark, 0.016, 0.012, 0.026, sx * 0.045, 0.06, 0.87);                                // nostril
    curl(head, hornMat, [V(sx * 0.09, 0.12, 0.0), V(sx * 0.15, 0.36, -0.2), V(sx * 0.2, 0.6, -0.28), V(sx * 0.2, 0.8, -0.18), V(sx * 0.15, 0.9, 0.0), V(sx * 0.11, 0.84, 0.12)], 0.075, 0.01);   // tall horns that rise, sweep back and curl forward at the tip
    curl(head, hornMat, [V(sx * 0.15, 0.08, -0.08), V(sx * 0.27, 0.3, -0.34), V(sx * 0.31, 0.56, -0.44), V(sx * 0.27, 0.72, -0.36)], 0.036, 0.006);
    for (let k = 0; k < 3; k++) cone(head, gold, 0.022, 0.42 - k * 0.07, sx * (0.17 - k * 0.01), 0.04 - k * 0.07, -0.12, -1.75 - k * 0.12, -sx * (0.45 + k * 0.12));   // crest spines sweeping back from the cheek
    const fin = cone(head, skin, 0.16, 0.5, sx * 0.17, 0.0, 0.0, -1.5, -sx * 1.0); fin.scale.z = 0.12;                                               // a frill behind the jaw
    for (let k = 0; k < 4; k++) cone(jaw, gold, 0.013, 0.045, sx * (0.08 - k * 0.008), 0.02, 0.24 + k * 0.09);     // teeth
  }

  // tail: a long whip, finishing in a golden leaf
  const tail = [], tailBase = new THREE.Group(); tailBase.position.set(0, 1.4, -1.45); tailBase.rotation.x = -0.24; model.add(tailBase);
  at = tailBase;
  for (let i = 0; i < 28; i++) {
    const seg = new THREE.Group(); if (i) { seg.position.z = -0.28; seg.rotation.x = 0.024; } at.add(seg); tail.push(seg);
    const r = 0.36 * Math.pow(1 - i / 28.5, 1.3) + 0.026; ball(seg, hide, r, r * 0.96, 0.3, 0, 0, -0.14);
    if (i % 2 === 0 && i < 22) cone(seg, gold, 0.026, 0.15 - i * 0.004, 0, r * 0.9, -0.14, -0.5); at = seg;
  }
  { const tip = new THREE.Group(); tip.position.z = -0.28; at.add(tip); ball(tip, hide, 0.13, 0.02, 0.36, 0, 0, -0.3); ball(tip, hide, 0.028, 0.028, 0.4, 0, 0, -0.3); }

  // legs: long and fine
  const legs = [];
  for (const [x, z, front] of [[0.4, 0.62, 1], [-0.4, 0.62, 1], [0.38, -0.95, 0], [-0.38, -0.95, 0]]) {
    const hip = new THREE.Group(); hip.position.set(x, 1.3, z); model.add(hip);
    ball(hip, hide, 0.15, 0.42, 0.25, 0, -0.26, 0);
    const knee = new THREE.Group(); knee.position.set(0, -0.62, 0.03); hip.add(knee);
    ball(knee, hide, 0.08, 0.36, 0.1, 0, -0.29, 0); ball(knee, hide, 0.11, 0.06, 0.22, 0, -0.62, 0.1);
    for (const cx of [-0.07, 0, 0.07]) cone(knee, claw, 0.026, 0.19, cx, -0.64, 0.27, Math.PI / 2 + 0.3);
    legs.push({ hip, knee, front, ph: (x > 0) === !!front ? 0 : Math.PI });
  }

  // wings: a slim arm out to the wrist, four long fingers, and skin between them hanging in curves
  const sheet = (pivot, tips, sag = 0.8, off = new THREE.Vector3()) => {                 // skin from the pivot out to the tips, its edge scalloped between each pair
    const pts = [pivot];
    tips.forEach((p, i) => {
      pts.push(p);
      if (i < tips.length - 1) { const q = tips[i + 1], c = p.clone().add(q).multiplyScalar(0.5).lerp(pivot, 1 - sag); for (let k = 1; k < 6; k++) { const t = k / 6; pts.push(p.clone().multiplyScalar((1 - t) * (1 - t)).addScaledVector(c, 2 * t * (1 - t)).addScaledVector(q, t * t)); } }
    });
    const pos = [], col = [], uv = [], idx = [], far = Math.max(...tips.map(p => p.distanceTo(pivot)));
    pts.forEach(p => { pos.push(p.x, p.y, p.z); uv.push(0.06 + (p.x + off.x) / 6.2, 0.9 - (0.7 - (p.z + off.z)) / 3.9); const k = 0.8 + 0.3 * Math.min(1, p.distanceTo(pivot) / far); col.push(k, k, k); });      // paler toward the edge
    for (let k = 1; k < pts.length - 1; k++) idx.push(0, k, k + 1);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, skin); m.castShadow = true; return m;
  };
  const wings = [];
  for (const sx of [1, -1]) {
    const wing = new THREE.Group(); wing.position.set(sx * 0.3, 1.9, 0.5); wing.scale.set(sx * 1.3, 1.3, 1.3); model.add(wing);
    const inner = new THREE.Group(); wing.add(inner);
    const O = V(0, 0, 0), E = V(1.25, 0.1, 0.55), W = V(2.6, 0, 0.3), R0 = V(0, -0.2, -1.15), R2 = V(2.35, 0, -1.75);
    rod(inner, hide, O, E, 0.075, 0.055); rod(inner, hide, E, W, 0.055, 0.04); ball(inner, hide, 0.07, 0.07, 0.07, E.x, E.y, E.z);
    inner.add(sheet(E, [O, R0, R2, W], 0.9));
    const outer = new THREE.Group(); outer.position.copy(W); inner.add(outer);
    const F = [V(3.3, 0.05, -0.75), V(2.8, 0, -2.0), V(1.8, 0, -2.75), V(0.75, 0, -2.75)], Rr = R2.clone().sub(W);
    for (const f of F) rod(outer, hide, O, f, 0.04, 0.012);
    outer.add(sheet(O, [...F, Rr], 0.78, W));
    ball(outer, hide, 0.055, 0.055, 0.055, 0, 0, 0); curl(outer, claw, [V(0, 0, 0.02), V(0.02, 0.1, 0.2), V(0.05, 0.12, 0.36), V(0.1, 0.04, 0.46)], 0.03, 0.004);               // the thumb claw at the wrist
    wings.push({ inner, outer });
  }

  let ph = 0, walk = 0, t = 0, airS = 0, fireS = 0, glideS = 0;
  const lerp = (a, b, k) => a + (b - a) * k;
  // st: { air: on the ground or flying, speed, vy, turn (-1..1), ridden }
  function update(dt, st) {
    t += dt; airS += ((st.air ? 1 : 0) - airS) * Math.min(1, dt * 4); const a = airS;
    glideS += ((st.glide ? 1 : 0) - glideS) * Math.min(1, dt * 2.5);                 // soaring: wings held wide, beating slow and shallow
    ph += dt * (a > 0.5 ? (5.4 + Math.max(0, st.vy) * 0.5) * (1 - 0.6 * glideS) : 1.3); walk += dt * st.speed * 1.9;
    const amp = 1 - 0.62 * glideS, flap = Math.sin(ph) * amp, lag = Math.sin(ph - 1.0) * amp;
    for (const w of wings) {
      w.inner.rotation.set(0, lerp(0.85, 0, a), lerp(0.7 + 0.03 * Math.sin(t * 1.3), 0.1 + 0.68 * flap, a));   // folded back and half raised on the ground
      w.outer.rotation.set(0, lerp(1.05, 0, a), lerp(-1.3, 0.05 + 0.62 * lag, a));
    }
    tail.forEach((s, i) => { if (i) { s.rotation.y = Math.sin(t * 1.3 - i * 0.3) * (0.04 + 0.04 * a) - st.turn * 0.03 * a + (i > 5 ? 0.115 * (1 - a) : 0); s.rotation.x = 0.024 + Math.sin(t * 1.0 - i * 0.25) * 0.012 - 0.018 * a; } });
    tailBase.rotation.x = lerp(-0.24, 0.1, a);
    const look = st.ridden ? 0.25 : 1;
    neck.forEach((s, i) => { if (i) { s.rotation.y = Math.sin(t * 0.6 + i * 0.25) * 0.035 * look * (1 - a) + st.turn * 0.05; s.rotation.x = lerp(s.userData.rx, 0.06, a) + Math.sin(t * 1.2 + i * 0.35) * 0.008; } });
    neckBase.rotation.x = lerp(-1.2, -0.52, a);               // stretched out ahead in flight
    head.rotation.set(lerp(0.4, 0.02, a) + Math.sin(t * 0.9) * 0.03, Math.sin(t * 0.45) * 0.3 * look * (1 - a), 0);
    fireS += ((st.fire ? 1 : 0) - fireS) * Math.min(1, dt * 12);
    jaw.rotation.x = 0.05 + Math.max(0, Math.sin(t * 0.8)) * 0.07 + 0.5 * fireS; head.rotation.x -= 0.12 * fireS;
    const stride = Math.min(1, st.speed / 2.2);
    for (const l of legs) {
      const s = Math.sin(walk + l.ph);
      l.hip.rotation.x = lerp(-s * 0.5 * stride, l.front ? -0.95 : 1.0, a);     // tucked up under her in the air
      l.knee.rotation.x = lerp(Math.max(0, Math.cos(walk + l.ph)) * 0.7 * stride, l.front ? 1.5 : 0.5, a);
    }
    model.position.y = a * (-0.14 * flap) + (1 - a) * Math.sin(t * 1.6) * 0.012;
    model.rotation.set(THREE.MathUtils.clamp(-st.vy * 0.035, -0.32, 0.32) * a, 0, -st.turn * 0.42 * a);
  }
  update(0, { air: 0, speed: 0, vy: 0, turn: 0, ridden: false });
  const api = { root, update, mouth, env, seat: { y: 1.9 * S, z: 0.5 * S }, glb: null, bones: {} };
  if (url) new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(url, g => {
    const m = g.scene, box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), k = DRAGON_FIT.span / Math.max(size.x, size.z);
    const H = size.y * k, L = Math.min(size.x, size.z) * k, pivot = H * 0.5;             // H: how tall she stands; L: nose to tail
    // tilt: the whole of her, turning about her middle, with the kid's seat and the mouth going with it; holder: the model, sized and faced forward
    const tilt = new THREE.Group(), holder = new THREE.Group(); tilt.position.y = pivot; root.add(tilt);
    m.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2); holder.add(m); holder.scale.setScalar(k); holder.rotation.y = DRAGON_FIT.turn; holder.position.y = -pivot; tilt.add(holder);
    m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; o.material.envMap = env; o.material.envMapIntensity = 1.3; o.material.needsUpdate = true; } if (o.isBone) api.bones[o.name.replace(/^mixamorig:?/, '')] = { bone: o, bind: o.quaternion.clone() }; });
    model.visible = false; api.glb = holder; api.tilt = tilt; api.size = { H, L };
    // her body is not in the middle of her wings as modelled: she is slid across so her spine is on the centre line
    root.updateMatrixWorld(true); if (api.bones.Hips) { const hp = tilt.worldToLocal(api.bones.Hips.bone.getWorldPosition(new THREE.Vector3())); holder.position.x -= hp.x; }
    // her wings beat: everything out beyond her shoulders swings up and down about a hinge line along each side of her body
    // Her wings beat: what lies out beyond her shoulders swings about a hinge line along each side of her body. Her tail and legs are left out of it
    // (they are low down and close in), and the droop the wings were modelled with is taken out first, so they are straight and flat as they beat.
    const BX = 18, BZ = 8, OUT = DRAGON_FIT.span / 2 + 0.3, hingeX = DRAGON_FIT.hinge[0], lowY = H * DRAGON_FIT.low - pivot, v3 = new THREE.Vector3();
    root.updateMatrixWorld(true); m.traverse(o => { if (o.isSkinnedMesh) o.skeleton.update(); });
    const at = (o, i, to) => (o.isSkinnedMesh ? o.getVertexPosition(i, to) : to.fromBufferAttribute(o.geometry.attributes.position, i)).applyMatrix4(o.matrixWorld);
    api.at = at;
    const wingPts = []; let wz0 = 1e9, wz1 = -1e9, rootZ = 0, rootY = 0, rootN = 0;
    m.traverse(o => { if (!o.isMesh) return; const pa = o.geometry.attributes.position;
      for (let i = 0; i < pa.count; i++) { tilt.worldToLocal(at(o, i, v3)); const ax = Math.abs(v3.x); if (ax < hingeX || (ax < 2.2 && v3.y < lowY + 0.6)) continue; wingPts.push(ax, v3.y, v3.z); wz0 = Math.min(wz0, v3.z); wz1 = Math.max(wz1, v3.z); if (ax < hingeX + 1) { rootZ += v3.z; rootY += v3.y; rootN++; } } });
    rootZ /= Math.max(1, rootN); rootY /= Math.max(1, rootN);
    const gsum = new Float32Array(BX * BZ), gcnt = new Float32Array(BX * BZ), grid = new Float32Array(BX * BZ);
    for (let k = 0; k < wingPts.length; k += 3) { const ix = Math.min(BX - 1, Math.floor((wingPts[k] - hingeX) / (OUT - hingeX) * BX)), iz = Math.min(BZ - 1, Math.floor((wingPts[k + 2] - wz0) / (wz1 - wz0) * BZ)); gsum[iz * BX + ix] += wingPts[k + 1]; gcnt[iz * BX + ix]++; }
    for (let k = 0; k < BX * BZ; k++) grid[k] = gcnt[k] > 2 ? gsum[k] / gcnt[k] : NaN;
    for (let pass = 0; pass < BX + BZ; pass++) { const g0 = grid.slice(); for (let iz = 0; iz < BZ; iz++) for (let ix = 0; ix < BX; ix++) { const k = iz * BX + ix; if (!Number.isNaN(g0[k])) continue; let sm = 0, n = 0; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = ix + dx, z = iz + dz; if (x < 0 || x >= BX || z < 0 || z >= BZ || Number.isNaN(g0[z * BX + x])) continue; sm += g0[z * BX + x]; n++; } if (n) grid[k] = sm / n; } }
    for (let k = 0; k < BX * BZ; k++) if (Number.isNaN(grid[k])) grid[k] = rootY;
    { const g0 = grid.slice(); for (let iz = 0; iz < BZ; iz++) for (let ix = 0; ix < BX; ix++) { let sm = 0, n = 0; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const x = ix + dx, z = iz + dz; if (x < 0 || x >= BX || z < 0 || z >= BZ) continue; sm += g0[z * BX + x]; n++; } grid[iz * BX + ix] = sm / n; } }
    // Her tail is found by walking the surface: the far end of it is the low point furthest (over her skin) from her head, and from that tip
    // the tail is followed back, slice by slice, until the slices fatten into her body. Each point then knows how far along the tail it is
    // and where it sits around the middle of it, so the tail can be drawn out straight.
    const tailU = { uTailBase: { value: new THREE.Vector3() }, uTailDir: { value: new THREE.Vector3(0, -0.3, -1) }, uTailOn: { value: 0 }, uTailT: { value: 0 }, uTailSway: { value: 0 } };
    m.traverse(o => { if (o.isMesh) o.geometry.setAttribute('aTail', new THREE.BufferAttribute(new Float32Array(o.geometry.attributes.position.count * 4), 4)); });
    m.traverse(o => {
      if (!o.isMesh || !o.geometry.index) return;
      const pa = o.geometry.attributes.position, n = pa.count, P = new Float32Array(n * 3), ids = new Int32Array(n), key = new Map(), rep2 = [];
      for (let i = 0; i < n; i++) { tilt.worldToLocal(at(o, i, v3)); P[i * 3] = v3.x; P[i * 3 + 1] = v3.y; P[i * 3 + 2] = v3.z; const kk = Math.round(v3.x * 500) + ',' + Math.round(v3.y * 500) + ',' + Math.round(v3.z * 500); let id = key.get(kk); if (id === undefined) { id = rep2.length; key.set(kk, id); rep2.push(i); } ids[i] = id; }
      const W = rep2.length, adj = Array.from({ length: W }, () => []), ix = o.geometry.index;
      const link = (a, b) => { if (a !== b && !adj[a].includes(b)) { adj[a].push(b); adj[b].push(a); } };
      for (let k = 0; k < ix.count; k += 3) { const a = ids[ix.getX(k)], b = ids[ix.getX(k + 1)], c = ids[ix.getX(k + 2)]; link(a, b); link(b, c); link(c, a); }
      const px = w => P[rep2[w] * 3], py = w => P[rep2[w] * 3 + 1], pz = w => P[rep2[w] * 3 + 2];
      const walk = from => { const d = new Float32Array(W).fill(1e9), q = [from]; d[from] = 0; for (let h = 0; h < q.length; h++) { const a = q[h]; for (const b of adj[a]) { const nd = d[a] + Math.hypot(px(a) - px(b), py(a) - py(b), pz(a) - pz(b)); if (nd < d[b] - 1e-4) { d[b] = nd; q.push(b); } } } return d; };
      const hb = api.bones.Head; if (!hb) return; tilt.worldToLocal(hb.bone.getWorldPosition(v3));
      let head = 0, bd = 1e9; for (let w = 0; w < W; w++) { const dd = Math.hypot(px(w) - v3.x, py(w) - v3.y, pz(w) - v3.z); if (dd < bd) { bd = dd; head = w; } }
      const dH = walk(head); let tip = -1, far = 0; for (let w = 0; w < W; w++) if (dH[w] < 1e8 && dH[w] > far && Math.abs(px(w)) < 3.2) { far = dH[w]; tip = w; }
      if (tip < 0) return;
      const dT = walk(tip), STEP = 0.25, MAXK = 60, cx = new Float32Array(MAXK), cy = new Float32Array(MAXK), cz = new Float32Array(MAXK), cn = new Float32Array(MAXK);
      for (let w = 0; w < W; w++) { const k = Math.floor(dT[w] / STEP); if (k < MAXK) { cx[k] += px(w); cy[k] += py(w); cz[k] += pz(w); cn[k]++; } }
      for (let k = 0; k < MAXK; k++) { if (cn[k]) { cx[k] /= cn[k]; cy[k] /= cn[k]; cz[k] /= cn[k]; } else if (k) { cx[k] = cx[k - 1]; cy[k] = cy[k - 1]; cz[k] = cz[k - 1]; } }
      const rad = new Float32Array(MAXK); for (let w = 0; w < W; w++) { const k = Math.floor(dT[w] / STEP); if (k < MAXK) rad[k] += (px(w) - cx[k]) ** 2 + (py(w) - cy[k]) ** 2 + (pz(w) - cz[k]) ** 2; }
      let K = 3; for (; K < MAXK; K++) { if (cn[K] && Math.sqrt(rad[K] / cn[K]) > DRAGON_FIT.tailThick) break; }       // where the slices stop being tail
      if (K < 8) return;
      // slices renumbered from her body outward, their middles smoothed into one line
      const C = []; for (let j = 0; j < K; j++) { const k = K - 1 - j; C.push(new THREE.Vector3(cx[k], cy[k], cz[k])); }
      for (let pass = 0; pass < 2; pass++) for (let j = 1; j < K - 1; j++) C[j].lerp(C[j - 1].clone().add(C[j + 1]).multiplyScalar(0.5), 0.5);
      const T = C.map((c, j) => C[Math.min(K - 1, j + 1)].clone().sub(C[Math.max(0, j - 1)]).normalize()), S = [], N = [];
      for (let j = 0; j < K; j++) { const sv = j ? S[j - 1].clone() : new THREE.Vector3(1, 0, 0); sv.addScaledVector(T[j], -sv.dot(T[j])).normalize(); S.push(sv); N.push(sv.clone().cross(T[j])); }
      const aT = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { const w = ids[i], k = Math.floor(dT[w] / STEP); if (k >= K) continue; const j = K - 1 - k; v3.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).sub(C[j]); aT[i * 4] = j * STEP + v3.dot(T[j]); aT[i * 4 + 1] = v3.dot(S[j]); aT[i * 4 + 2] = v3.dot(N[j]); aT[i * 4 + 3] = 1; }
      o.geometry.setAttribute('aTail', new THREE.BufferAttribute(aT, 4)); tailU.uTailBase.value.copy(C[0]); tailU.uTailOn.value = 1; api.tail = { K, length: K * STEP, base: C[0].clone(), tip: [px(tip), py(tip), pz(tip)], far };
    });
    const hd = api.bones.Head ? tilt.worldToLocal(api.bones.Head.bone.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3(0, H * 0.72 - pivot, L * 0.3), hp = api.bones.Hips ? tilt.worldToLocal(api.bones.Hips.bone.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3(0, -0.4, -0.3);
    const wing = { ...tailU, uTilt: { value: new THREE.Matrix4() }, uInvTilt: { value: new THREE.Matrix4() }, uFlap: { value: 0 }, uFlat: { value: 1 }, uHinge: { value: new THREE.Vector2(hingeX, H * DRAGON_FIT.hinge[1] - pivot) }, uOut: { value: OUT }, uLow: { value: lowY },
      uGrid: { value: Array.from(grid) }, uWz: { value: new THREE.Vector2(wz0, wz1) }, uPlane: { value: rootY }, uWingPitch: { value: 0 }, uWingZ: { value: rootZ },
      uNeck: { value: 0 }, uNeckP: { value: new THREE.Vector2(hd.y - 0.45, hd.z - 0.1) }, uLegs: { value: 0 }, uLegP: { value: new THREE.Vector2(hp.y, hp.z) } };
    const reshape = sh => {
      Object.assign(sh.uniforms, wing);
      sh.vertexShader = 'attribute vec4 aTail; uniform vec3 uTailBase, uTailDir; uniform float uTailOn, uTailT, uTailSway; uniform mat4 uTilt, uInvTilt; uniform float uFlap, uFlat, uOut, uLow, uPlane, uWingPitch, uWingZ, uNeck, uLegs; uniform vec2 uHinge, uWz, uNeckP, uLegP; uniform float uGrid[' + (BX * BZ) + '];\n' + sh.vertexShader.replace('#include <project_vertex>', `
        vec4 tp = uInvTilt * (modelMatrix * vec4(transformed, 1.0));
        float ax0 = abs(tp.x);
        if (aTail.w > 0.5) {
          vec3 tD = normalize(uTailDir), tS = vec3(1.0, 0.0, 0.0), tN = normalize(cross(tS, tD));
          float sway = sin(aTail.x * 1.1 - uTailT * 3.0) * 0.07 * aTail.x * uTailSway;
          tp.xyz = mix(tp.xyz, uTailBase + tD * aTail.x * 0.72 + tS * (aTail.y + sway) + tN * aTail.z, smoothstep(0.0, 0.7, aTail.x) * uTailOn);
        } else {
          float lw = (1.0 - smoothstep(1.0, 1.4, ax0)) * (1.0 - smoothstep(uLegP.x - 0.7, uLegP.x - 0.15, tp.y)) * (1.0 - smoothstep(0.5, 0.9, tp.z));
          float la = uLegs * lw, ly = tp.y - uLegP.x, lz = tp.z - uLegP.y;
          tp.y = uLegP.x + ly * cos(la) - lz * sin(la); tp.z = uLegP.y + ly * sin(la) + lz * cos(la);
          float nw = (1.0 - smoothstep(0.7, 1.0, ax0)) * smoothstep(uNeckP.x - 0.35, uNeckP.x + 0.35, tp.y) * smoothstep(uNeckP.y - 1.1, uNeckP.y - 0.5, tp.z);
          float na = uNeck * nw, ny = tp.y - uNeckP.x, nz = tp.z - uNeckP.y;
          tp.y = uNeckP.x + ny * cos(na) - nz * sin(na); tp.z = uNeckP.y + ny * sin(na) + nz * cos(na);
        }
        float sd = sign(tp.x), ax = abs(tp.x);
        float wgt = smoothstep(uHinge.x, uHinge.x + 1.0, ax) * max(smoothstep(1.5, 2.3, ax), smoothstep(uLow, uLow + 0.7, tp.y)) * (1.0 - aTail.w);
        float gx = clamp((ax - uHinge.x) / (uOut - uHinge.x), 0.0, 0.999) * ${BX}.0 - 0.5, gz = clamp((tp.z - uWz.x) / (uWz.y - uWz.x), 0.0, 0.999) * ${BZ}.0 - 0.5;
        float x0 = clamp(floor(gx), 0.0, ${BX - 1}.0), x1 = min(x0 + 1.0, ${BX - 1}.0), z0 = clamp(floor(gz), 0.0, ${BZ - 1}.0), z1 = min(z0 + 1.0, ${BZ - 1}.0), fx = clamp(gx - x0, 0.0, 1.0), fz = clamp(gz - z0, 0.0, 1.0);
        float mid = mix(mix(uGrid[int(z0) * ${BX} + int(x0)], uGrid[int(z0) * ${BX} + int(x1)], fx), mix(uGrid[int(z1) * ${BX} + int(x0)], uGrid[int(z1) * ${BX} + int(x1)], fx), fz);
        tp.y = mix(tp.y, uPlane + (ax - uHinge.x) * 0.04 + (tp.y - mid), wgt * uFlat);
        float wp = uWingPitch * wgt, wy = tp.y - uHinge.y, wz = tp.z - uWingZ;
        tp.y = uHinge.y + wy * cos(wp) - wz * sin(wp); tp.z = uWingZ + wy * sin(wp) + wz * cos(wp);
        float ang = uFlap * wgt, dx = ax - uHinge.x, dy = tp.y - uHinge.y, cs = cos(ang), sn = sin(ang);
        tp.x = sd * (uHinge.x + dx * cs - dy * sn); tp.y = uHinge.y + dx * sn + dy * cs;
        vec4 mvPosition = viewMatrix * (uTilt * tp);
        gl_Position = projectionMatrix * mvPosition;`);
    };
    m.traverse(o => { if (!o.isMesh) return; o.material.onBeforeCompile = reshape; o.material.needsUpdate = true; const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); dm.onBeforeCompile = reshape; o.customDepthMaterial = dm; });
    api.wing = wing;
    const tX = new THREE.Vector3(1, 0, 0);
    const mouth0 = new THREE.Vector3(0, H * DRAGON_FIT.mouth[0] - pivot, L * DRAGON_FIT.mouth[1]);
    api.flap = (beat, air, tt) => {
      const pitch = tilt.rotation.x;
      wing.uTailDir.value.set(0, -0.28 + 0.2 * air, -1).applyAxisAngle(tX, -pitch); wing.uTailT.value = tt; wing.uTailSway.value = 0.25 + 0.75 * air;
      wing.uWingPitch.value = -pitch; wing.uNeck.value = -pitch * 0.85; wing.uLegs.value = 0.95 * air;      // wings kept level, head brought up to look ahead, hind legs swung back under her tail
      const na = wing.uNeck.value, ny = mouth0.y - wing.uNeckP.value.x, nz = mouth0.z - wing.uNeckP.value.y; mo.position.set(0, wing.uNeckP.value.x + ny * Math.cos(na) - nz * Math.sin(na), wing.uNeckP.value.y + ny * Math.sin(na) + nz * Math.cos(na));
      tilt.updateMatrixWorld(true); wing.uTilt.value.copy(tilt.matrixWorld); wing.uInvTilt.value.copy(tilt.matrixWorld).invert();
      wing.uFlap.value = air * (0.06 + 0.6 * beat) + (1 - air) * (0.2 + 0.05 * Math.sin(tt * 1.3));
    };
    api.seat = { y: H * DRAGON_FIT.seat[0] - pivot, z: L * DRAGON_FIT.seat[1] };
    const mo = new THREE.Object3D(); mo.position.set(0, H * DRAGON_FIT.mouth[0] - pivot, L * DRAGON_FIT.mouth[1]); tilt.add(mo); api.mouth = mo;
    let tt = 0, air = 0, ph = 0, glide = 0;
    const E = new THREE.Euler(), Q = new THREE.Quaternion(), turnBone = (n, x, y, z) => { const bn = api.bones[n]; if (bn) bn.bone.quaternion.copy(bn.bind).multiply(Q.setFromEuler(E.set(x, y, z))); };
    api.turnBone = turnBone;
    api.update = (dt, st) => {
      tt += dt; air += ((st.air ? 1 : 0) - air) * Math.min(1, dt * 3); glide += ((st.glide ? 1 : 0) - glide) * Math.min(1, dt * 2.5);
      ph += dt * (air > 0.5 ? (5.2 + Math.max(0, st.vy) * 0.5) * (1 - 0.6 * glide) : 1.2);
      const beat = Math.sin(ph) * (1 - 0.6 * glide);
      // she stands reared up on the ground and levels out to fly, rising and dipping with each beat, nosing up to climb and leaning into her turns
      tilt.position.y = pivot + air * (-0.2 * beat) + (1 - air) * Math.sin(tt * 1.6) * 0.02;
      tilt.rotation.set(air * DRAGON_FIT.level + THREE.MathUtils.clamp(-st.vy * 0.04, -0.35, 0.35) * air + (1 - air) * Math.sin(tt * 1.6) * 0.012, 0, -st.turn * 0.45 * air, 'YXZ');
      if (api.flap) api.flap(beat, air, tt, st);
    };
  }, undefined, e => console.warn('dragon model not loaded', e));
  return api;
}
