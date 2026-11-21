// A metallic purple dragon, built from smooth shapes: scaled body, long neck and tail in jointed lengths so they can sway,
// four clawed legs, golden horns and spines, and a pair of two-jointed membrane wings that beat in the air and fold on the ground.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

function scaleBump() {                                       // overlapping rows of scales, as a height map
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'); g.fillStyle = '#6a6a6a'; g.fillRect(0, 0, 256, 256);
  for (let row = -1; row < 13; row++) for (let col = -1; col < 9; col++) {
    const x = col * 32 + (row % 2 ? 16 : 0), y = row * 21.33, gr = g.createLinearGradient(0, y, 0, y + 30);
    gr.addColorStop(0, '#d8d8d8'); gr.addColorStop(0.75, '#8c8c8c'); gr.addColorStop(1, '#2c2c2c');
    g.fillStyle = gr; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 32, y); g.quadraticCurveTo(x + 32, y + 24, x + 16, y + 31); g.quadraticCurveTo(x, y + 24, x, y); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 4); return t;
}

export function buildDragon(renderer) {
  const pm = new THREE.PMREMGenerator(renderer), env = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
  const bump = scaleBump();
  const hide = new THREE.MeshStandardMaterial({ color: 0x7a35e6, metalness: 0.92, roughness: 0.26, envMap: env, envMapIntensity: 1.5, bumpMap: bump, bumpScale: 2.2 });
  const belly = new THREE.MeshStandardMaterial({ color: 0xc7a2ff, metalness: 0.8, roughness: 0.3, envMap: env, envMapIntensity: 1.4 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xf2d27a, metalness: 1, roughness: 0.22, envMap: env, envMapIntensity: 1.5 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x5a1fc0, metalness: 0.7, roughness: 0.34, envMap: env, envMapIntensity: 1.2, side: THREE.DoubleSide });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffc23a, emissive: 0xffa010, emissiveIntensity: 1.6, roughness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c0a3a, roughness: 0.6 });

  const S = 0.8, root = new THREE.Group(), model = new THREE.Group(); model.scale.setScalar(S); root.add(model);
  const sphere = new THREE.SphereGeometry(1, 24, 16), coneG = new THREE.ConeGeometry(1, 1, 10);
  const ball = (parent, mat, sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(sphere, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const cone = (parent, mat, r, h, x, y, z, rx = 0, rz = 0) => {     // stands on its base at x,y,z, leaning by rx, rz
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.set(rx, 0, rz); const m = new THREE.Mesh(coneG, mat); m.scale.set(r, h, r); m.position.y = h / 2; m.castShadow = true; g.add(m); parent.add(g); return g;
  };
  const UP = new THREE.Vector3(0, 1, 0);
  const rod = (parent, mat, a, b, r0, r1) => { const d = b.clone().sub(a), m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, d.length(), 8), mat); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize()); m.castShadow = true; parent.add(m); return m; };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // body
  ball(model, hide, 0.62, 0.6, 0.98, 0, 1.45, 0.42); ball(model, hide, 0.56, 0.53, 0.9, 0, 1.36, -0.72); ball(model, belly, 0.5, 0.46, 1.42, 0, 1.2, -0.12);
  for (let k = 0; k < 6; k++) cone(model, gold, 0.07, 0.3 - Math.abs(k - 2.5) * 0.03, 0, 1.93 - Math.abs(k - 1.2) * 0.035 - (k > 3 ? (k - 3) * 0.05 : 0), 0.05 - k * 0.3 - (k < 1 ? 0 : 0.35), -0.25);   // spines down the back, clear of the saddle place

  // neck and head
  const neck = [], neckBase = new THREE.Group(); neckBase.position.set(0, 1.72, 1.02); neckBase.rotation.x = -0.95; model.add(neckBase);
  let at = neckBase;
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Group(); if (i) { seg.position.z = 0.42; seg.rotation.x = 0.15; } at.add(seg); neck.push(seg);
    const r = 0.33 - i * 0.025; ball(seg, hide, r, r, 0.36, 0, 0, 0.2); ball(seg, belly, r * 0.8, r * 0.75, 0.33, 0, -r * 0.3, 0.22);
    cone(seg, gold, 0.055, 0.22, 0, r * 0.9, 0.2, -0.3); at = seg;
  }
  const head = new THREE.Group(); head.position.z = 0.44; head.rotation.x = 0.62; at.add(head);
  ball(head, hide, 0.3, 0.27, 0.37, 0, 0.02, 0.16); ball(head, hide, 0.2, 0.15, 0.36, 0, -0.01, 0.56); ball(head, hide, 0.13, 0.07, 0.12, 0, 0.1, 0.8);
  const jaw = new THREE.Group(); jaw.position.set(0, -0.11, 0.2); head.add(jaw); ball(jaw, belly, 0.17, 0.07, 0.34, 0, -0.02, 0.3);
  for (const sx of [-1, 1]) {
    ball(head, eyeMat, 0.055, 0.07, 0.085, sx * 0.21, 0.11, 0.34); ball(head, dark, 0.02, 0.05, 0.035, sx * 0.255, 0.11, 0.37);
    ball(head, hide, 0.09, 0.05, 0.16, sx * 0.19, 0.19, 0.3);                                   // brow
    ball(head, dark, 0.025, 0.02, 0.035, sx * 0.07, 0.09, 0.88);                                 // nostril
    cone(head, gold, 0.075, 0.78, sx * 0.16, 0.2, 0.02, -1.15, -sx * 0.22); cone(head, gold, 0.05, 0.36, sx * 0.24, 0.08, -0.02, -1.35, -sx * 0.7);   // horns
    for (let k = 0; k < 4; k++) cone(jaw, gold, 0.022, 0.07, sx * (0.13 - k * 0.012), 0.03, 0.2 + k * 0.1);     // teeth
  }

  // tail
  const tail = [], tailBase = new THREE.Group(); tailBase.position.set(0, 1.32, -1.4); tailBase.rotation.x = -0.2; model.add(tailBase);
  at = tailBase;
  for (let i = 0; i < 11; i++) {
    const seg = new THREE.Group(); if (i) { seg.position.z = -0.44; seg.rotation.x = 0.045; } at.add(seg); tail.push(seg);
    const r = 0.43 * Math.pow(1 - i / 11.5, 1.15) + 0.045; ball(seg, hide, r, r * 0.95, 0.38, 0, 0, -0.22);
    if (i < 9) cone(seg, gold, 0.05, 0.24 - i * 0.015, 0, r * 0.85, -0.22, -0.3); at = seg;
  }
  { const tip = new THREE.Group(); tip.position.z = -0.44; at.add(tip); ball(tip, gold, 0.24, 0.035, 0.3, 0, 0, -0.26); cone(tip, gold, 0.06, 0.3, 0, 0, -0.5, -Math.PI / 2); }

  // legs
  const legs = [];
  for (const [x, z, front] of [[0.52, 0.62, 1], [-0.52, 0.62, 1], [0.5, -0.92, 0], [-0.5, -0.92, 0]]) {
    const hip = new THREE.Group(); hip.position.set(x, 1.2, z); model.add(hip);
    ball(hip, hide, 0.22, 0.44, 0.3, 0, -0.26, 0);
    const knee = new THREE.Group(); knee.position.set(0, -0.6, 0.04); hip.add(knee);
    ball(knee, hide, 0.13, 0.36, 0.15, 0, -0.26, 0); ball(knee, hide, 0.17, 0.09, 0.3, 0, -0.57, 0.14);
    for (const cx of [-0.1, 0, 0.1]) cone(knee, gold, 0.04, 0.2, cx, -0.6, 0.38, Math.PI / 2 + 0.25);
    legs.push({ hip, knee, front, ph: (x > 0) === !!front ? 0 : Math.PI });
  }

  // wings: an arm out to the wrist, then long fingers with skin stretched between them
  const sheet = pts => {                                     // a fan of skin from the first point over the rest
    const pos = [], idx = []; pts.forEach(p => pos.push(p.x, p.y, p.z)); for (let k = 1; k < pts.length - 1; k++) idx.push(0, k, k + 1);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, skin); m.castShadow = true; return m;
  };
  const wings = [];
  for (const sx of [1, -1]) {
    const wing = new THREE.Group(); wing.position.set(sx * 0.4, 1.88, 0.5); wing.scale.x = sx; model.add(wing);
    const inner = new THREE.Group(); wing.add(inner);
    const E = V(1.15, 0.06, 0.42), W = V(2.25, 0, 0.12), R0 = V(0, -0.2, -1.25), R1 = V(1.1, -0.04, -0.95), R2 = V(2.1, 0, -1.5);
    rod(inner, hide, V(0, 0, 0), E, 0.11, 0.08); rod(inner, hide, E, W, 0.08, 0.06); ball(inner, hide, 0.1, 0.1, 0.1, E.x, E.y, E.z);
    inner.add(sheet([V(0, 0, 0), E, R1, R0]), sheet([E, W, R2, R1]));
    const outer = new THREE.Group(); outer.position.copy(W); inner.add(outer);
    const F1 = V(2.5, 0, -0.2), F2 = V(1.85, 0, -1.4), F3 = V(0.75, 0, -1.9), Rr = R2.clone().sub(W), mid = (a, b, k) => a.clone().add(b).multiplyScalar(0.5 * k);
    for (const f of [F1, F2, F3]) rod(outer, hide, V(0, 0, 0), f, 0.055, 0.02);
    outer.add(sheet([V(0, 0, 0), F1, mid(F1, F2, 0.8), F2, mid(F2, F3, 0.8), F3, mid(F3, Rr, 0.86), Rr]));
    ball(outer, hide, 0.08, 0.08, 0.08, 0, 0, 0); cone(outer, gold, 0.04, 0.26, 0, 0, 0.04, 1.0);                   // the thumb claw at the wrist
    wings.push({ inner, outer });
  }

  let ph = 0, walk = 0, t = 0, airS = 0;
  const lerp = (a, b, k) => a + (b - a) * k;
  // st: { air: 0 on the ground .. 1 flying, speed, vy, turn (-1..1), ridden }
  function update(dt, st) {
    t += dt; airS += ((st.air ? 1 : 0) - airS) * Math.min(1, dt * 4); const a = airS;
    ph += dt * (a > 0.5 ? 6.2 + Math.max(0, st.vy) * 0.5 : 1.3); walk += dt * st.speed * 1.9;
    const flap = Math.sin(ph), lag = Math.sin(ph - 0.9);
    for (const w of wings) {
      w.inner.rotation.set(0, lerp(0.75, 0, a), lerp(0.62 + 0.04 * Math.sin(t * 1.3), 0.1 + 0.72 * flap, a));   // folded back and half raised on the ground
      w.outer.rotation.set(0, lerp(0.9, 0, a), lerp(-1.15, 0.05 + 0.6 * lag, a));
    }
    tail.forEach((s, i) => { if (i) { s.rotation.y = Math.sin(t * 1.5 - i * 0.55) * (0.07 + 0.07 * a) - st.turn * 0.05 * a; s.rotation.x = 0.045 + Math.sin(t * 1.1 - i * 0.4) * 0.02 - 0.03 * a; } });
    tailBase.rotation.x = lerp(-0.2, 0.12, a);
    const look = st.ridden ? 0.25 : 1;
    neck.forEach((s, i) => { if (i) { s.rotation.y = Math.sin(t * 0.6 + i * 0.4) * 0.06 * look * (1 - a) + st.turn * 0.09; s.rotation.x = lerp(0.15, 0.2, a) + Math.sin(t * 1.2 + i * 0.5) * 0.015; } });
    neckBase.rotation.x = lerp(-0.95, -0.42, a);              // stretched out ahead in flight
    head.rotation.set(lerp(0.62, 0.05, a) + Math.sin(t * 0.9) * 0.04, Math.sin(t * 0.45) * 0.3 * look * (1 - a), 0);
    jaw.rotation.x = 0.08 + Math.max(0, Math.sin(t * 0.8)) * 0.1;
    const stride = Math.min(1, st.speed / 2.2);
    for (const l of legs) {
      const s = Math.sin(walk + l.ph);
      l.hip.rotation.x = lerp(-s * 0.5 * stride, l.front ? -0.95 : 1.0, a);     // tucked up under her in the air
      l.knee.rotation.x = lerp(Math.max(0, Math.cos(walk + l.ph)) * 0.7 * stride, l.front ? 1.5 : 0.5, a);
    }
    model.position.y = a * (-0.16 * flap) + (1 - a) * Math.sin(t * 1.6) * 0.015;
    model.rotation.set(THREE.MathUtils.clamp(-st.vy * 0.035, -0.32, 0.32) * a, 0, -st.turn * 0.42 * a);
  }
  update(0, { air: 0, speed: 0, vy: 0, turn: 0, ridden: false });
  return { root, update, seat: { y: 1.94 * S, z: 0.5 * S } };
}
