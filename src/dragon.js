// A metallic purple dragon, long and slender: a swan-curved neck and a whip of a tail in many close joints so they flow,
// a lean body on fine legs, swept golden horns, and wide scalloped wings that beat in the air and fold on the ground.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

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

export function buildDragon(renderer) {
  const pm = new THREE.PMREMGenerator(renderer), env = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
  const bump = scaleBump();
  const hide = new THREE.MeshPhysicalMaterial({ color: 0x6f2fe0, metalness: 0.9, roughness: 0.22, envMap: env, envMapIntensity: 1.5, bumpMap: bump, bumpScale: 1.4, clearcoat: 1, clearcoatRoughness: 0.12, iridescence: 0.7, iridescenceIOR: 1.7 });
  const belly = new THREE.MeshPhysicalMaterial({ color: 0xd3b6ff, metalness: 0.8, roughness: 0.25, envMap: env, envMapIntensity: 1.4, clearcoat: 1, clearcoatRoughness: 0.15 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xf4d98c, metalness: 1, roughness: 0.2, envMap: env, envMapIntensity: 1.5 });
  const skin = new THREE.MeshPhysicalMaterial({ color: 0x8444e8, emissive: 0x2a0a66, emissiveIntensity: 0.5, metalness: 0.6, roughness: 0.3, envMap: env, envMapIntensity: 1.2, side: THREE.DoubleSide, vertexColors: true, iridescence: 0.8, iridescenceIOR: 1.5 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffd060, emissive: 0xffa818, emissiveIntensity: 1.7, roughness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c0a3a, roughness: 0.6 });

  const S = 0.85, root = new THREE.Group(), model = new THREE.Group(); model.scale.setScalar(S); root.add(model);
  const sphere = new THREE.SphereGeometry(1, 28, 18), coneG = new THREE.ConeGeometry(1, 1, 12);
  const ball = (parent, mat, sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(sphere, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const cone = (parent, mat, r, h, x, y, z, rx = 0, rz = 0) => {     // stands on its base at x,y,z, leaning by rx, rz
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.set(rx, 0, rz); const m = new THREE.Mesh(coneG, mat); m.scale.set(r, h, r); m.position.y = h / 2; m.castShadow = true; g.add(m); parent.add(g); return g;
  };
  const UP = new THREE.Vector3(0, 1, 0);
  const rod = (parent, mat, a, b, r0, r1) => { const d = b.clone().sub(a), m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, d.length(), 8), mat); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize()); m.castShadow = true; parent.add(m); return m; };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

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
  const jaw = new THREE.Group(); jaw.position.set(0, -0.08, 0.16); head.add(jaw); ball(jaw, belly, 0.105, 0.04, 0.34, 0, -0.02, 0.3);
  for (const sx of [-1, 1]) {
    const eye = ball(head, eyeMat, 0.035, 0.045, 0.075, sx * 0.14, 0.08, 0.3); eye.rotation.y = sx * 0.5; ball(head, dark, 0.012, 0.036, 0.03, sx * 0.168, 0.08, 0.325);
    ball(head, hide, 0.055, 0.03, 0.14, sx * 0.13, 0.135, 0.27).rotation.z = -sx * 0.3;           // brow
    ball(head, dark, 0.016, 0.012, 0.026, sx * 0.045, 0.06, 0.87);                                // nostril
    cone(head, gold, 0.042, 1.05, sx * 0.1, 0.15, 0.02, -1.22, -sx * 0.16); cone(head, gold, 0.028, 0.5, sx * 0.16, 0.06, -0.02, -1.4, -sx * 0.55);   // long swept horns
    const fin = cone(head, skin, 0.16, 0.5, sx * 0.17, 0.0, 0.0, -1.5, -sx * 1.0); fin.scale.z = 0.12;                                               // a frill behind the jaw
    for (let k = 0; k < 4; k++) cone(jaw, gold, 0.013, 0.045, sx * (0.08 - k * 0.008), 0.02, 0.24 + k * 0.09);     // teeth
  }

  // tail: a long whip, finishing in a golden leaf
  const tail = [], tailBase = new THREE.Group(); tailBase.position.set(0, 1.4, -1.45); tailBase.rotation.x = -0.24; model.add(tailBase);
  at = tailBase;
  for (let i = 0; i < 22; i++) {
    const seg = new THREE.Group(); if (i) { seg.position.z = -0.28; seg.rotation.x = 0.024; } at.add(seg); tail.push(seg);
    const r = 0.36 * Math.pow(1 - i / 22.5, 1.35) + 0.028; ball(seg, hide, r, r * 0.96, 0.3, 0, 0, -0.14);
    if (i % 2 === 0 && i < 18) cone(seg, gold, 0.026, 0.15 - i * 0.005, 0, r * 0.9, -0.14, -0.5); at = seg;
  }
  { const tip = new THREE.Group(); tip.position.z = -0.28; at.add(tip); ball(tip, gold, 0.17, 0.02, 0.4, 0, 0, -0.34); ball(tip, gold, 0.03, 0.03, 0.42, 0, 0, -0.34); }

  // legs: long and fine
  const legs = [];
  for (const [x, z, front] of [[0.4, 0.62, 1], [-0.4, 0.62, 1], [0.38, -0.95, 0], [-0.38, -0.95, 0]]) {
    const hip = new THREE.Group(); hip.position.set(x, 1.3, z); model.add(hip);
    ball(hip, hide, 0.15, 0.42, 0.25, 0, -0.26, 0);
    const knee = new THREE.Group(); knee.position.set(0, -0.62, 0.03); hip.add(knee);
    ball(knee, hide, 0.08, 0.36, 0.1, 0, -0.29, 0); ball(knee, hide, 0.11, 0.06, 0.22, 0, -0.62, 0.1);
    for (const cx of [-0.07, 0, 0.07]) cone(knee, gold, 0.026, 0.17, cx, -0.64, 0.27, Math.PI / 2 + 0.3);
    legs.push({ hip, knee, front, ph: (x > 0) === !!front ? 0 : Math.PI });
  }

  // wings: a slim arm out to the wrist, four long fingers, and skin between them hanging in curves
  const sheet = (pivot, tips, sag = 0.8) => {                 // skin from the pivot out to the tips, its edge scalloped between each pair
    const pts = [pivot];
    tips.forEach((p, i) => {
      pts.push(p);
      if (i < tips.length - 1) { const q = tips[i + 1], c = p.clone().add(q).multiplyScalar(0.5).lerp(pivot, 1 - sag); for (let k = 1; k < 6; k++) { const t = k / 6; pts.push(p.clone().multiplyScalar((1 - t) * (1 - t)).addScaledVector(c, 2 * t * (1 - t)).addScaledVector(q, t * t)); } }
    });
    const pos = [], col = [], idx = [], far = Math.max(...tips.map(p => p.distanceTo(pivot)));
    pts.forEach(p => { pos.push(p.x, p.y, p.z); const k = 0.62 + 0.5 * Math.min(1, p.distanceTo(pivot) / far); col.push(k, k * 0.92, k); });      // paler toward the edge
    for (let k = 1; k < pts.length - 1; k++) idx.push(0, k, k + 1);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, skin); m.castShadow = true; return m;
  };
  const wings = [];
  for (const sx of [1, -1]) {
    const wing = new THREE.Group(); wing.position.set(sx * 0.3, 1.9, 0.5); wing.scale.x = sx; model.add(wing);
    const inner = new THREE.Group(); wing.add(inner);
    const O = V(0, 0, 0), E = V(1.25, 0.1, 0.55), W = V(2.6, 0, 0.3), R0 = V(0, -0.2, -1.15), R2 = V(2.35, 0, -1.75);
    rod(inner, hide, O, E, 0.075, 0.055); rod(inner, hide, E, W, 0.055, 0.04); ball(inner, hide, 0.07, 0.07, 0.07, E.x, E.y, E.z);
    inner.add(sheet(E, [O, R0, R2, W], 0.9));
    const outer = new THREE.Group(); outer.position.copy(W); inner.add(outer);
    const F = [V(3.1, 0, -0.55), V(2.65, 0, -1.8), V(1.75, 0, -2.55), V(0.75, 0, -2.6)], Rr = R2.clone().sub(W);
    for (const f of F) rod(outer, hide, O, f, 0.04, 0.012);
    outer.add(sheet(O, [...F, Rr], 0.8));
    ball(outer, hide, 0.055, 0.055, 0.055, 0, 0, 0); cone(outer, gold, 0.026, 0.24, 0, 0, 0.03, 1.0);               // the thumb claw at the wrist
    wings.push({ inner, outer });
  }

  let ph = 0, walk = 0, t = 0, airS = 0;
  const lerp = (a, b, k) => a + (b - a) * k;
  // st: { air: on the ground or flying, speed, vy, turn (-1..1), ridden }
  function update(dt, st) {
    t += dt; airS += ((st.air ? 1 : 0) - airS) * Math.min(1, dt * 4); const a = airS;
    ph += dt * (a > 0.5 ? 5.4 + Math.max(0, st.vy) * 0.5 : 1.3); walk += dt * st.speed * 1.9;
    const flap = Math.sin(ph), lag = Math.sin(ph - 1.0);
    for (const w of wings) {
      w.inner.rotation.set(0, lerp(0.85, 0, a), lerp(0.7 + 0.03 * Math.sin(t * 1.3), 0.1 + 0.68 * flap, a));   // folded back and half raised on the ground
      w.outer.rotation.set(0, lerp(1.05, 0, a), lerp(-1.3, 0.05 + 0.62 * lag, a));
    }
    tail.forEach((s, i) => { if (i) { s.rotation.y = Math.sin(t * 1.3 - i * 0.3) * (0.05 + 0.04 * a) - st.turn * 0.03 * a; s.rotation.x = 0.024 + Math.sin(t * 1.0 - i * 0.25) * 0.012 - 0.018 * a; } });
    tailBase.rotation.x = lerp(-0.24, 0.1, a);
    const look = st.ridden ? 0.25 : 1;
    neck.forEach((s, i) => { if (i) { s.rotation.y = Math.sin(t * 0.6 + i * 0.25) * 0.035 * look * (1 - a) + st.turn * 0.05; s.rotation.x = lerp(s.userData.rx, 0.06, a) + Math.sin(t * 1.2 + i * 0.35) * 0.008; } });
    neckBase.rotation.x = lerp(-1.2, -0.52, a);               // stretched out ahead in flight
    head.rotation.set(lerp(0.4, 0.02, a) + Math.sin(t * 0.9) * 0.03, Math.sin(t * 0.45) * 0.3 * look * (1 - a), 0);
    jaw.rotation.x = 0.05 + Math.max(0, Math.sin(t * 0.8)) * 0.07;
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
  return { root, update, seat: { y: 1.9 * S, z: 0.5 * S } };
}
