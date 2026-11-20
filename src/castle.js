// The castle on the hill beyond the meadow: curtain walls you can walk along, corner turrets, a gatehouse with a
// portcullis, a keep of open terraces joined by stairs and a bridge, and a courtyard with a fountain. Everything
// solid is one entry in SOLIDS, which is both what is drawn and what he stands on or bumps into.
// Things keep happening here: fireworks, lanterns let go into the sky, birds, the bell, new colours on the flags,
// the fountain playing, targets to hit, and a treasure chest that turns up somewhere new each time it is found.
import * as THREE from 'three';
import { CASTLE, hillHeight } from './scenery.js';

export function buildCastle(scene, { spawn, sfx, addBox }) {
  const Y0 = CASTLE.y, group = new THREE.Group(); group.position.set(CASTLE.x, Y0, CASTLE.z); scene.add(group);
  const rnd = (a, b) => a + Math.random() * (b - a), pick = list => list[Math.floor(Math.random() * list.length)];

  // ---------- what is solid ----------
  const SOLIDS = [];
  // a block from y0 up to `top`; a ramp gives its low end and high end along one axis
  const solid = (x0, x1, z0, z1, top, y0 = 0, o = {}) => {
    const s = { x0, x1, z0, z1, y0, flat: typeof top === 'number' ? top : null, draw: o.draw !== false };
    if (s.flat === null) {
      const { axis, a, b, ha, hb } = top;
      s.top = (x, z) => { const t = Math.min(1, Math.max(0, ((axis === 'x' ? x : z) - a) / (b - a))); return ha + (hb - ha) * t; };
    } else s.top = () => s.flat;
    SOLIDS.push(s); return s;
  };
  const S = 26, T = 3, WH = 6, G = 3;
  // curtain wall, with the gateway in the front (the side toward the meadow)
  solid(-S, S, -S, -S + T, WH); solid(-S, -S + T, -S + T, S - T, WH); solid(S - T, S, -S + T, S - T, WH);
  solid(-S, -G, S - T, S, WH); solid(G, S, S - T, S, WH); solid(-G, G, S - T, S, WH, 4.2);
  // a parapet along the outside of the wall walk
  solid(-S, S, -S, -S + 0.5, WH + 1.1, WH); solid(-S, S, S - 0.5, S, WH + 1.1, WH);
  solid(-S, -S + 0.5, -S + 0.5, S - 0.5, WH + 1.1, WH); solid(S - 0.5, S, -S + 0.5, S - 0.5, WH + 1.1, WH);
  // turrets at the corners and either side of the gate (drawn round, solid as squares)
  const TURRETS = [[-S, -S, 3.3, 11], [S, -S, 3.3, 11], [-S, S, 3.3, 11], [S, S, 3.3, 11], [-5.6, S + 1.6, 2.5, 9.5], [5.6, S + 1.6, 2.5, 9.5]];
  for (const [x, z, r, h] of TURRETS) solid(x - r * 0.72, x + r * 0.72, z - r * 0.72, z + r * 0.72, h, 0, { draw: false });
  // stairs from the yard up to the wall walk, one each side
  solid(-S + T, -S + T + 2.4, -7, 7, { axis: 'z', a: 7, b: -7, ha: 0, hb: WH }); solid(-S + T, -S + T + 2.4, -10, -7, WH);
  solid(S - T - 2.4, S - T, -7, 7, { axis: 'z', a: -7, b: 7, ha: 0, hb: WH }); solid(S - T - 2.4, S - T, 7, 10, WH);
  // the keep: four piers under a first terrace, a tower block on that, and a top terrace
  for (const [x, z] of [[-8, -18], [5, -18], [-8, -7], [5, -7]]) solid(x, x + 3, z, z + 3, 4.4);
  solid(-8, 8, -18, -4, 5, 4.4);
  solid(-4.5, 4.5, -15.5, -6.5, 11, 5);
  solid(8, 10.4, -16, -4, { axis: 'z', a: -4, b: -16, ha: 0, hb: 5 }); solid(8, 10.4, -18, -16, 5);        // yard to first terrace
  solid(-7, -4.5, -15.5, -6.5, { axis: 'z', a: -6.5, b: -15.5, ha: 5, hb: 11 }, 5);                        // first terrace to the top
  solid(-1.5, 1.5, -S + T, -18, { axis: 'z', a: -18, b: -S + T, ha: 5, hb: WH }, 4.4);                      // a bridge to the back wall
  // in the yard
  solid(-2.1, 2.1, 8, 12.2, 0.55, 0, { draw: false }); solid(-0.5, 0.5, 9.6, 10.6, 2.3, 0, { draw: false });  // fountain
  solid(-15, -13.2, 11.2, 13, 1.0, 0, { draw: false });                                                    // well
  solid(11.5, 14.5, 13.3, 14.7, 0.95); solid(14.2, 15.6, 1, 4, 0.95);                                        // stall tables
  solid(-19.5, -17.9, 14.5, 16.1, 0.8); solid(-17.8, -16.2, 15, 16.6, 0.8); solid(-18.8, -17.2, 14.9, 16.5, 1.6, 0.8); solid(15, 17, -15, -13, 1.1);   // crates

  // ---------- drawing it ----------
  const stoneTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#cfc7b6'; g.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 4; row++) for (let k = 0; k < 3; k++) {
      const x = (k * 86 + (row % 2) * 43) % 256, y = row * 64, v = 196 + Math.floor(Math.random() * 30);
      g.fillStyle = `rgb(${v + 6},${v},${v - 14})`; g.fillRect(x + 2, y + 2, 82, 60); if (x + 84 > 256) g.fillRect(x - 256 + 2, y + 2, 82, 60);
    }
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '90,80,70' : '255,250,240'},0.07)`; g.fillRect(Math.random() * 256, Math.random() * 256, 3, 2); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  })();
  const STONE = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.95, side: THREE.DoubleSide });
  const DARK = new THREE.MeshStandardMaterial({ color: 0x8d8576, roughness: 1 }), ROOF = new THREE.MeshStandardMaterial({ color: 0x3f5f9a, roughness: 0.7 });
  const WOOD = new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.85 }), GOLD = new THREE.MeshStandardMaterial({ color: 0xf2c84a, roughness: 0.35, metalness: 0.6 });
  const IRON = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.5, metalness: 0.5 });
  {
    const pos = [], uv = [];
    const quad = (a, b, c, d, kind) => { for (const p of [a, b, c, a, c, d]) { pos.push(p[0], p[1], p[2]); uv.push((kind === 'x' ? p[2] : p[0]) / 3.2, (kind === 'y' ? p[2] : p[1]) / 3.2); } };
    for (const s of SOLIDS) {
      if (!s.draw) continue;
      const { x0, x1, z0, z1, y0 } = s, a = s.top(x0, z0), b = s.top(x1, z0), c = s.top(x1, z1), d = s.top(x0, z1);
      quad([x0, a, z0], [x0, d, z1], [x1, c, z1], [x1, b, z0], 'y');
      if (y0 > 0) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 'y');
      quad([x0, y0, z0], [x1, y0, z0], [x1, b, z0], [x0, a, z0], 'z'); quad([x1, y0, z1], [x0, y0, z1], [x0, d, z1], [x1, c, z1], 'z');
      quad([x0, y0, z1], [x0, y0, z0], [x0, a, z0], [x0, d, z1], 'x'); quad([x1, y0, z0], [x1, y0, z1], [x1, c, z1], [x1, b, z0], 'x');
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, STONE); m.castShadow = m.receiveShadow = true; m.frustumCulled = false; group.add(m);
  }
  const add = (geo, mat, x, y, z, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; group.add(m); return m; };
  // steps drawn on the stairs
  for (const s of SOLIDS) if (s.flat === null && s.draw) {
    const n = 12, w = s.x1 - s.x0; for (let k = 0; k < n; k++) { const z = s.z0 + (s.z1 - s.z0) * (k + 0.5) / n; add(new THREE.BoxGeometry(w, 0.1, 0.22), DARK, (s.x0 + s.x1) / 2, s.top(0, z) + 0.03, z, false); }
  }
  // merlons along the parapets and round the keep's terraces
  {
    const spots = [];
    for (let k = -S + 0.7; k <= S - 0.6; k += 1.7) spots.push([k, WH + 1.1, -S + 0.25, 0], [k, WH + 1.1, S - 0.25, 0], [-S + 0.25, WH + 1.1, k, 1], [S - 0.25, WH + 1.1, k, 1]);
    for (let k = -7.6; k <= 7.7; k += 1.7) spots.push([k, 5, -17.8, 0], [k, 5, -4.2, 0]);
    for (let k = -16; k <= -5.9; k += 1.7) spots.push([-7.8, 5, k, 1], [7.8, 5, k, 1]);
    for (let k = -4.1; k <= 4.2; k += 1.64) spots.push([k, 11, -15.3, 0], [k, 11, -6.7, 0]);
    for (let k = -13.6; k <= -8; k += 1.7) spots.push([4.3, 11, k, 1]);
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.95, 0.6, 0.5), STONE, spots.length), d = new THREE.Object3D();
    spots.forEach(([x, y, z, turn], i) => { d.position.set(x, y + 0.3, z); d.rotation.y = turn ? Math.PI / 2 : 0; d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
    im.castShadow = true; im.frustumCulled = false; group.add(im);
  }
  // flags all share one cloth, so a change of colours sweeps the whole castle
  const FLAG = new THREE.MeshStandardMaterial({ color: 0xd9503a, roughness: 0.8, side: THREE.DoubleSide }), flags = [];
  const flag = (x, y, z, s = 1) => {
    add(new THREE.CylinderGeometry(0.05, 0.05, 2.6 * s, 8), IRON, x, y + 1.3 * s, z);
    const g = new THREE.PlaneGeometry(1.7 * s, 0.9 * s, 6, 1); g.translate(0.85 * s, 0, 0);
    const m = add(g, FLAG, x, y + 2.1 * s, z, false); flags.push(m); return m;
  };
  for (const [x, z, r, h] of TURRETS) {
    add(new THREE.CylinderGeometry(r, r * 1.06, h, 24), STONE, x, h / 2, z);
    add(new THREE.CylinderGeometry(r * 1.12, r, 0.6, 24), DARK, x, h + 0.3, z);
    add(new THREE.ConeGeometry(r * 1.18, r * 1.6, 24), ROOF, x, h + 0.6 + r * 0.8, z);
    for (let k = 0; k < 3; k++) { const a = k * 2.1 + 0.6; add(new THREE.BoxGeometry(0.22, 1.1, 0.12), IRON, x + Math.cos(a) * r * 1.01, h * 0.62, z + Math.sin(a) * r * 1.01, false).rotation.y = -a + Math.PI / 2; }
    flag(x, h + 0.6 + r * 1.6, z);
  }
  // the gate: an arch over the way in, and a portcullis that lifts when somebody comes up to it
  add(new THREE.TorusGeometry(G, 0.35, 8, 20, Math.PI), DARK, 0, 1.25, S + 0.02, false);
  const gate = new THREE.Group(); gate.position.set(0, 0, S - 1.5); group.add(gate);
  for (let k = -2; k <= 2; k++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.2, 6), IRON); m.position.set(k * 1.15, 2.1, 0); gate.add(m); }
  for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(new THREE.BoxGeometry(2 * G - 0.2, 0.12, 0.1), IRON); m.position.set(0, 0.5 + k * 1.1, 0); gate.add(m); }
  for (const sx of [-1, 1]) { const b = add(new THREE.PlaneGeometry(1.3, 3.4), FLAG, sx * 9.5, 3.9, S + 0.06, false); flags.push(b); b.userData.hang = true; }
  // the keep's top: a little bell house, and the tallest flag
  for (const [x, z] of [[-1.6, -12.6], [1.6, -12.6], [-1.6, -9.4], [1.6, -9.4]]) add(new THREE.CylinderGeometry(0.14, 0.16, 3, 10), STONE, x, 12.5, z);
  add(new THREE.ConeGeometry(3, 2.6, 4), ROOF, 0, 15.3, -11).rotation.y = Math.PI / 4;
  const bell = new THREE.Group(); bell.position.set(0, 13.9, -11); group.add(bell);
  { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.62, 0.9, 16, 1, true), GOLD); b.position.y = -0.55; b.castShadow = true; const cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), GOLD); cap.position.y = -0.12; bell.add(b, cap); }
  flag(0, 16.6, -11, 1.5);
  // fountain, well, stalls
  add(new THREE.CylinderGeometry(2.2, 2.4, 0.55, 28), STONE, 0, 0.275, 10.1); add(new THREE.CylinderGeometry(0.42, 0.55, 2.3, 14), STONE, 0, 1.15, 10.1); add(new THREE.CylinderGeometry(1.0, 0.3, 0.3, 20), STONE, 0, 2.4, 10.1);
  const WATER = new THREE.MeshStandardMaterial({ color: 0x7fd0f0, roughness: 0.15, transparent: true, opacity: 0.75 });
  add(new THREE.CylinderGeometry(1.95, 1.95, 0.08, 28), WATER, 0, 0.56, 10.1, false);
  const jets = []; for (let k = 0; k < 5; k++) { const a = k * 1.2566, j = add(new THREE.CylinderGeometry(0.02, 0.07, 1, 6), WATER, k ? Math.cos(a) * 0.55 : 0, 2.55, 10.1 + (k ? Math.sin(a) * 0.55 : 0), false); j.geometry.translate(0, 0.5, 0); jets.push(j); }
  add(new THREE.CylinderGeometry(0.95, 1.0, 1.0, 18), STONE, -14.1, 0.5, 12.1); for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.07, 0.07, 2.3, 8), WOOD, -14.1 + sx * 0.85, 1.15, 12.1); add(new THREE.ConeGeometry(1.35, 0.9, 4), ROOF, -14.1, 2.75, 12.1).rotation.y = Math.PI / 4;
  for (const [x, z, turn, col] of [[13, 14, 0, 0xe6b23a], [14.9, 2.5, Math.PI / 2, 0x4fa36a]]) {
    const st = new THREE.Group(); st.position.set(x, 0, z); st.rotation.y = turn; group.add(st);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), WOOD); p.position.set(sx * 1.5, 1.3, sz * 0.75); st.add(p); }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.08, 2.0), new THREE.MeshStandardMaterial({ color: col, roughness: 0.9 })); roof.position.y = 2.65; roof.rotation.x = 0.16; roof.castShadow = true; st.add(roof);
    for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshStandardMaterial({ color: pick([0xe2503c, 0xf2c230, 0x8ac24a, 0xf08a3c]) })); f.position.set(-1 + k * 0.65, 1.1, rnd(-0.3, 0.3)); st.add(f); }
  }
  // lamps by the gate and at the foot of the keep stairs, always lit
  const GLOW = new THREE.MeshBasicMaterial({ color: 0xffc66a, toneMapped: false });
  for (const [x, y, z] of [[-4.2, 3.4, S + 0.5], [4.2, 3.4, S + 0.5], [11.2, 1.9, -3.4], [-9, 1.9, -3.4], [0, 3.6, -3.7]]) { add(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), IRON, x, y + 0.42, z, false); add(new THREE.SphereGeometry(0.22, 12, 10), GLOW, x, y, z, false); }

  // fireballs meet the stonework too
  for (const s of SOLIDS) { const top = Math.max(s.top(s.x0, s.z0), s.top(s.x1, s.z1)), h = (top - s.y0) / 2; addBox(CASTLE.x + (s.x0 + s.x1) / 2, Y0 + s.y0 + h, CASTLE.z + (s.z0 + s.z1) / 2, (s.x1 - s.x0) / 2, h, (s.z1 - s.z0) / 2); }

  // ---------- standing on it, bumping into it ----------
  const NEAR = S + 8, STEP = 0.6, TALL = 1.7;
  function groundAt(x, z, feet) {
    let g = hillHeight(x, z); const lx = x - CASTLE.x, lz = z - CASTLE.z;
    if (Math.abs(lx) > NEAR || Math.abs(lz) > NEAR) return g;
    for (const s of SOLIDS) if (lx >= s.x0 && lx <= s.x1 && lz >= s.z0 && lz <= s.z1) { const t = Y0 + s.top(lx, lz); if (t <= feet + STEP && t > g) g = t; }
    return g;
  }
  function resolve(p, feet, rad = 0.45) {                    // push him out of whatever is in his way at the height he is at
    let lx = p.x - CASTLE.x, lz = p.z - CASTLE.z;
    if (Math.abs(lx) > NEAR || Math.abs(lz) > NEAR) return;
    for (let pass = 0; pass < 2; pass++) for (const s of SOLIDS) {
      if (lx < s.x0 - rad || lx > s.x1 + rad || lz < s.z0 - rad || lz > s.z1 + rad) continue;
      const cx = Math.min(s.x1, Math.max(s.x0, lx)), cz = Math.min(s.z1, Math.max(s.z0, lz));
      if (Y0 + s.top(cx, cz) <= feet + STEP || feet + TALL <= Y0 + s.y0) continue;      // he can step onto it, or it is over his head
      const dl = lx - (s.x0 - rad), dr = s.x1 + rad - lx, db = lz - (s.z0 - rad), df = s.z1 + rad - lz, m = Math.min(dl, dr, db, df);
      if (m === dl) lx = s.x0 - rad; else if (m === dr) lx = s.x1 + rad; else if (m === db) lz = s.z0 - rad; else lz = s.z1 + rad;
    }
    p.x = lx + CASTLE.x; p.z = lz + CASTLE.z;
  }

  // ---------- the treasure chest: found in one place, it turns up in another ----------
  const CHEST_AT = [[-19, 19, 0], [19, -11, 0], [10, -24.3, WH], [-24.3, 14, WH], [0, 24.2, WH], [24.3, -4, WH], [6, -5.6, 5], [-6, -16.6, 5], [2.6, -8.2, 11], [0, -11, 0], [-12, -2, 0], [19, 19, 0]];
  const chest = new THREE.Group(), lid = new THREE.Group(); group.add(chest);
  {
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 0.65), WOOD); base.position.y = 0.275; base.castShadow = true; chest.add(base);
    for (const x of [-0.36, 0.36]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.57, 0.67), GOLD); b.position.set(x, 0.275, 0); chest.add(b); }
    lid.position.set(0, 0.55, -0.325); chest.add(lid);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.325, 0.325, 1.0, 14, 1, false, 0, Math.PI), WOOD); top.rotation.z = Math.PI / 2; top.rotation.y = Math.PI / 2; top.position.z = 0.325; top.castShadow = true; lid.add(top);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, 14, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    beam.position.y = 7.4; chest.add(beam); chest.userData.beam = beam;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), new THREE.MeshBasicMaterial({ color: 0xfff0a8, toneMapped: false })); gem.position.y = 1.15; chest.add(gem); chest.userData.gem = gem;
  }
  const ch = { at: -1, open: 0, wait: 0, found: 0 };
  const moveChest = () => { let k; do k = Math.floor(Math.random() * CHEST_AT.length); while (k === ch.at); ch.at = k; ch.open = 0; chest.position.set(...[CHEST_AT[k][0], CHEST_AT[k][2], CHEST_AT[k][1]]); chest.rotation.y = rnd(0, 6.28); chest.scale.setScalar(0.01); lid.rotation.x = 0; };
  moveChest();

  // ---------- targets that pop up for a fireball ----------
  const TARGET_AT = [[-12, 3.4, -22.9], [12, 3.4, -22.9], [-22.9, 3.4, 16], [22.9, 3.4, -16], [0, 8, -6.4], [-22.9, 3.4, -14], [18, 3.2, 22.9]];
  const target = new THREE.Group(); group.add(target);
  for (const [r, c] of [[0.9, 0xf4f1e6], [0.65, 0xd9503a], [0.4, 0xf4f1e6], [0.18, 0xd9503a]]) { const d = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.08 + (0.9 - r) * 0.05, 24), new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })); d.rotation.x = Math.PI / 2; target.add(d); }
  const tg = { at: -1, hit: 0, wait: 0 };
  const moveTarget = () => { let k; do k = Math.floor(Math.random() * TARGET_AT.length); while (k === tg.at); tg.at = k; tg.hit = 0; const [x, y, z] = TARGET_AT[k]; target.position.set(x, y, z); target.rotation.set(0, Math.abs(x) > 22 ? Math.PI / 2 : 0, 0); target.scale.setScalar(0.01); };
  moveTarget();
  const tw = new THREE.Vector3();
  function ballHit(p) {                                      // called for each fireball; true if it struck the target
    if (tg.hit > 0 || tg.wait > 0) return false;
    target.getWorldPosition(tw); if (tw.distanceTo(p) > 1.35) return false;
    tg.hit = 1; for (let i = 0; i < 26; i++) spawn(tw.x, tw.y, tw.z, rnd(-4, 4), rnd(0, 5), rnd(-4, 4), rnd(0.7, 1.3), rnd(0.2, 0.4), { color: pick([0xff5a3c, 0xffd060, 0xffffff]), g: 5 });
    sfx.chime(7); return true;
  }

  // ---------- things that happen ----------
  const lanterns = [], birds = [], PALETTE = [0xd9503a, 0x3f8fd6, 0x55b86a, 0xf2c230, 0x9a5fd0, 0xf08a3c, 0xf4f1e6, 0xe85a9a];
  const LAMP = new THREE.MeshBasicMaterial({ color: 0xffb85a, toneMapped: false, transparent: true });
  for (let i = 0; i < 22; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), LAMP); m.scale.set(1, 1.3, 1); m.visible = false; scene.add(m); lanterns.push({ m, t: 0, vx: 0, vz: 0, ph: i }); }
  for (let i = 0; i < 9; i++) {
    const b = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: 0x2d2f3a, side: THREE.DoubleSide });
    for (const sx of [-1, 1]) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.25, 0, 0, -0.2, sx * 1.1, 0, -0.1], 3)); const w = new THREE.Mesh(g, mat); b.add(w); }
    b.visible = false; scene.add(b); birds.push({ b, ph: i * 0.7, off: rnd(-3, 3), h: rnd(-2, 3) });
  }
  const ev = { next: 6, last: '', show: 0, lamps: 0, flock: 0, bell: 0, bellN: 0, fount: 0, hue: 0 };
  const EVENTS = {
    fireworks() { ev.show = 7; },
    lanterns() { ev.lamps = 1; lanterns.forEach((l, i) => { l.t = 26 + i * 0.5; l.delay = i * 0.35; l.m.position.set(CASTLE.x + rnd(-14, 14), Y0 + 0.6, CASTLE.z + rnd(-2, 18)); l.vx = rnd(-0.3, 0.5); l.vz = rnd(-0.2, 0.6); }); sfx.chime(3); },
    birds() { ev.flock = 30; },
    bell() { ev.bell = 9; ev.bellN = 0; },
    colours() { let c; do c = pick(PALETTE); while (c === FLAG.color.getHex()); FLAG.color.setHex(c); for (const f of flags) { f.getWorldPosition(tw); for (let i = 0; i < 6; i++) spawn(tw.x, tw.y, tw.z, rnd(-1.5, 1.5), rnd(0.5, 2.5), rnd(-1.5, 1.5), rnd(0.8, 1.4), 0.22, { color: c, g: 1 }); } sfx.chime(5); },
    fountain() { ev.fount = 12; ev.hue = Math.random(); sfx.chime(2); },
  };
  const here = new THREE.Vector3();
  function update(dt, time, px, pz, feet) {
    const dist = Math.hypot(px - CASTLE.x, pz - CASTLE.z), lx = px - CASTLE.x, lz = pz - CASTLE.z;
    // the portcullis
    const want = Math.hypot(lx, lz - S) < 15 ? 4.1 : 0; gate.position.y += (want - gate.position.y) * Math.min(1, dt * 1.6);
    // flags fly, banners sway
    flags.forEach((f, i) => { if (f.userData.hang) f.rotation.x = Math.sin(time * 1.3 + i) * 0.05; else { f.rotation.y = Math.sin(time * 2.1 + i * 1.7) * 0.35 + 0.3; const p = f.geometry.attributes.position; for (let k = 0; k < p.count; k++) p.setZ(k, Math.sin(p.getX(k) * 3.2 - time * 6 + i) * 0.09 * p.getX(k)); p.needsUpdate = true; } });
    // the chest
    chest.scale.setScalar(Math.min(1, chest.scale.x + dt * 2)); chest.userData.gem.rotation.y = time * 2; chest.userData.gem.position.y = 1.15 + Math.sin(time * 3) * 0.08; chest.userData.beam.material.opacity = 0.16 + 0.08 * Math.sin(time * 2.3);
    if (ch.wait > 0) { ch.wait -= dt; chest.scale.setScalar(Math.max(0.01, Math.min(1, ch.wait / 0.6))); if (ch.wait <= 0) moveChest(); }
    else if (!ch.open) {
      const c = CHEST_AT[ch.at];
      if (Math.hypot(lx - c[0], lz - c[1]) < 1.7 && Math.abs(feet - (Y0 + c[2])) < 1.6) {
        ch.open = 1; ch.found++; ch.wait = 3.2; chest.getWorldPosition(here);
        for (let i = 0; i < 40; i++) spawn(here.x, here.y + 0.6, here.z, rnd(-2.5, 2.5), rnd(2, 7), rnd(-2.5, 2.5), rnd(0.9, 1.8), rnd(0.18, 0.36), { color: pick([0xffd24a, 0xfff2b0, 0xffa53a]), g: 6 });
        sfx.win();
      }
    } else lid.rotation.x += (-1.9 - lid.rotation.x) * Math.min(1, dt * 6);
    chest.userData.gem.visible = chest.userData.beam.visible = !ch.open;
    // the target
    target.scale.setScalar(Math.min(1, target.scale.x + dt * 2.5));
    if (tg.hit) { target.rotation.z += dt * 14; tg.hit -= dt * 0.9; if (tg.hit <= 0) { tg.hit = 0; tg.wait = 2.5; target.scale.setScalar(0.01); } }
    else if (tg.wait > 0) { tg.wait -= dt; target.scale.setScalar(0.01); if (tg.wait <= 0) moveTarget(); }
    // every so often, something new - but only while somebody is near enough to see it
    if (dist < 130) { ev.next -= dt; if (ev.next <= 0) { const names = Object.keys(EVENTS).filter(n => n !== ev.last), n = pick(names); ev.last = n; EVENTS[n](); ev.next = rnd(11, 19); } }
    if (ev.show > 0) {
      const before = Math.floor(ev.show / 0.4); ev.show -= dt;
      if (Math.floor(ev.show / 0.4) !== before) {
        const x = CASTLE.x + rnd(-22, 22), y = Y0 + rnd(18, 30), z = CASTLE.z + rnd(-22, 22), c = pick(PALETTE);
        for (let i = 0; i < 34; i++) { const a = rnd(0, 6.283), e = rnd(-1.2, 1.5), sp = rnd(5, 8); spawn(x, y, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp, rnd(0.9, 1.5), rnd(0.25, 0.45), { color: c, g: 4 }); }
        spawn(x, y, z, 0, 0, 0, 0.3, 3, { grow: 6, color: 0xffffff, alpha: 0.6 }); sfx.thump(0.35);
      }
    }
    if (ev.lamps) { let any = false; for (const l of lanterns) { if (l.t <= 0) { l.m.visible = false; continue; } any = true; if (l.delay > 0) { l.delay -= dt; continue; } l.t -= dt; l.m.visible = true; l.m.position.x += (l.vx + Math.sin(time * 0.7 + l.ph) * 0.25) * dt; l.m.position.z += l.vz * dt; l.m.position.y += 1.25 * dt; l.m.scale.setScalar(Math.min(1, l.t / 3)); l.m.scale.y *= 1.3; } if (!any) ev.lamps = 0; }
    if (ev.flock > 0) {
      ev.flock -= dt; const k = Math.min(1, ev.flock / 5, (30 - ev.flock) / 5), R = 17 + (1 - k) * 70;
      birds.forEach((o, i) => { const a = time * 0.55 + i * 0.16; o.b.visible = true; o.b.position.set(CASTLE.x + Math.cos(a) * (R + o.off), Y0 + 21 + o.h + Math.sin(time + o.ph), CASTLE.z - 6 + Math.sin(a) * (R + o.off)); o.b.rotation.y = -a; const f = Math.sin(time * 9 + o.ph) * 0.7; o.b.children[0].rotation.z = f; o.b.children[1].rotation.z = -f; });
      if (ev.flock <= 0) for (const o of birds) o.b.visible = false;
    }
    if (ev.bell > 0) { ev.bell -= dt; bell.rotation.x = Math.sin(time * 5.2) * 0.5 * Math.min(1, ev.bell / 2); const n = Math.floor((9 - ev.bell) / 1.1); if (n >= ev.bellN && ev.bell > 1.5) { ev.bellN = n + 1; sfx.chime([0, 4, 2, 5, 0, 4, 7][n % 7]); } } else bell.rotation.x *= 0.95;
    const fk = ev.fount > 0 ? Math.min(1, ev.fount / 1.5, (12 - ev.fount) / 1.5) : 0; if (ev.fount > 0) ev.fount -= dt;
    jets.forEach((j, i) => { j.scale.y = (i ? 0.7 : 1.1) + Math.sin(time * 3 + i) * 0.12 + fk * (i ? 2.2 + Math.sin(time * 4 + i * 1.3) : 3.6); });
    if (fk > 0) { WATER.color.setHSL((ev.hue + time * 0.08) % 1, 0.65, 0.68); if (Math.random() < dt * 22) spawn(CASTLE.x + rnd(-0.6, 0.6), Y0 + 5 + fk * 2, CASTLE.z + 10.1 + rnd(-0.6, 0.6), rnd(-1.6, 1.6), rnd(1, 3), rnd(-1.6, 1.6), 1, 0.16, { color: 0xbfe9ff, g: 7 }); } else WATER.color.setHex(0x7fd0f0);
  }
  return { groundAt, resolve, update, ballHit, solids: SOLIDS, state: () => ({ chestAt: ch.at, found: ch.found, targetAt: tg.at, last: ev.last, next: +ev.next.toFixed(1) }), fire: n => EVENTS[n] && EVENTS[n](), chestPos: () => CHEST_AT[ch.at] };
}
