// Everything the player doesn't knock over: sky, cloud sea, the island, grass, flowers, rocks, trees.
import * as THREE from 'three';

export const R = 38;                                     // island radius
export const START = { x: 0, z: 25 };                    // where the player begins, facing the centre
export const SUN_DIR = new THREE.Vector3(-0.17, 0.25, -0.95).normalize();
const GRASS_TILE = 34;                                   // side of the square of grass that follows the player

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// Tree positions are fixed, and exported so the game can add trunk colliders and keep towers clear of them.
export const TREES = (() => {
  const r = rng(77), out = [];
  for (let tries = 0; out.length < 18 && tries < 400; tries++) {
    const a = r() * Math.PI * 2, rad = 6 + Math.sqrt(r()) * (R - 9), x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (Math.hypot(x - START.x, z - START.z) < 7) continue;
    if (out.some(t => Math.hypot(t.x - x, t.z - z) < 7)) continue;
    out.push({ x, z, s: 1 + r() * 0.7 });
  }
  return out;
})();

function bump(x, y, z) {
  return Math.sin(x * 1.7 + y * 0.9) * 0.5 + Math.sin(z * 2.3 - x * 0.6) * 0.3 + Math.sin(y * 3.1 + z * 1.3) * 0.2;
}

export function softTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.55)')); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function sky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      sun: { value: new THREE.Vector3(-0.17, 0.12, -0.95).normalize() },
      zenith: { value: new THREE.Color(0x2a5fae) },
      mid: { value: new THREE.Color(0x7db4e4) },
      horizon: { value: new THREE.Color(0xffc48a) },
      glow: { value: new THREE.Color(0xff9440) },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 sun, zenith, mid, horizon, glow;
      void main(){ vec3 d = normalize(vDir); float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.16, h));
        c = mix(c, zenith, smoothstep(0.1, 0.55, h));
        float s = max(dot(d, sun), 0.0);
        c += glow * (pow(s, 6.0) * 0.45 + pow(s, 60.0) * 0.9);
        c += vec3(1.0, 0.95, 0.8) * smoothstep(0.9993, 0.9997, s) * 4.0;
        c = mix(c, horizon, smoothstep(0.0, -0.25, d.y));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(600, 32, 20), mat);
}

function cloudSea(r) {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 16, 12);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffe9d6, emissive: 0xc48f7c, emissiveIntensity: 0.5 });
  const N = 700, m = new THREE.InstancedMesh(geo, mat, N), d = new THREE.Object3D();
  for (let i = 0; i < N; i++) {
    const rad = 20 + Math.pow(r(), 0.7) * 330, a = r() * Math.PI * 2, s = 7 + r() * 13 + rad * 0.035;
    d.position.set(Math.cos(a) * rad, -13 + r() * 2.5 - s * 0.12, Math.sin(a) * rad);
    d.scale.set(s, s * (0.32 + r() * 0.2), s * (0.8 + r() * 0.4));
    d.rotation.y = r() * 6; d.updateMatrix(); m.setMatrixAt(i, d.matrix);
  }
  g.add(m);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(600, 40), new THREE.MeshBasicMaterial({ color: 0xf6cfb0 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -15; g.add(floor);
  return g;
}

function islandMesh(radius, depth, seed, segs = 56) {
  const pts = [[0, 0], [radius * 0.5, 0], [radius * 0.93, 0], [radius, -0.04], [radius + 0.06, -0.2], [radius * 0.97, -0.55],
    [radius * 0.8, -depth * 0.26], [radius * 0.52, -depth * 0.52], [radius * 0.24, -depth * 0.8], [0.001, -depth]]
    .map(p => new THREE.Vector2(p[0], p[1]));
  const curve = new THREE.SplineCurve(pts.slice(3));
  const prof = [...pts.slice(0, 3), ...curve.getPoints(18)];
  const geo = new THREE.LatheGeometry(prof, segs);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(0x4f8a30), soil = new THREE.Color(0x6b4a30), rock = new THREE.Color(0x8d7a6a), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x), rr = Math.hypot(x, z);
    if (y < -0.1 && rr > 0.01) {
      const k = 1 + (Math.sin(a * 3 + seed) * 0.07 + Math.sin(a * 7 + y * 1.4 + seed * 2) * 0.06 + Math.sin(a * 13 - y * 2.2) * 0.03) * Math.min(1, -y);
      x *= k; z *= k; pos.setXYZ(i, x, y + Math.sin(a * 5 + seed) * 0.12 * Math.min(1, -y * 0.5), z);
    }
    if (y > -0.12) c.copy(grass); else if (y > -0.7) c.copy(grass).lerp(soil, (-y - 0.12) / 0.58);
    else c.copy(soil).lerp(rock, Math.min(1, (-y - 0.7) / 1.2)).multiplyScalar(0.85 + 0.2 * Math.sin(a * 9 + y * 3));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  mesh.receiveShadow = true; mesh.castShadow = true;
  return mesh;
}

// Mottled green ground under the grass blades, so the meadow doesn't read as one flat colour.
function meadow(r) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d'); g.fillStyle = '#4f8a30'; g.fillRect(0, 0, 512, 512);
  const tones = ['#5f9a3a', '#447a2a', '#6aa544', '#3d7026', '#7aae4a'];
  for (let i = 0; i < 260; i++) {
    const x = r() * 512, y = r() * 512, s = 20 + r() * 70;
    g.globalAlpha = 0.10 + r() * 0.14; g.fillStyle = tones[Math.floor(r() * tones.length)];
    for (const [ox, oy] of [[0, 0], [512, 0], [-512, 0], [0, 512], [0, -512]]) { g.beginPath(); g.arc(x + ox, y + oy, s, 0, 7); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(7, 7); t.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.CircleGeometry(R * 0.995, 96), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.012; m.receiveShadow = true;
  return m;
}

// One square of grass tufts that wraps around the player in the vertex shader, so the whole island
// looks covered while only the nearby blades are ever drawn.
function grassField(r, uTime, uCenter) {
  const blade = (w, h, yaw, ox, oz) => {
    const g = new THREE.PlaneGeometry(w, h, 1, 3); g.translate(0, h / 2, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) / h; p.setX(i, p.getX(i) * (1 - y * 0.9)); p.setZ(i, y * y * 0.24 * h); }
    g.rotateY(yaw); g.translate(ox, 0, oz); return g;
  };
  const parts = [blade(0.11, 1, 0.2, 0, 0), blade(0.1, 0.8, 2.3, 0.09, 0.05), blade(0.1, 0.9, 4.4, -0.06, 0.08)];
  const count = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const posA = new Float32Array(count * 3), norA = new Float32Array(count * 3), colA = new Float32Array(count * 3), idx = [];
  const base = new THREE.Color(0x2f6a22), tip = new THREE.Color(0xc5dc62), c = new THREE.Color();
  let o = 0;
  for (const g of parts) {
    const p = g.attributes.position;
    for (const i of g.index.array) idx.push(i + o);
    for (let i = 0; i < p.count; i++, o++) {
      posA.set([p.getX(i), p.getY(i), p.getZ(i)], o * 3); norA.set([0, 1, 0], o * 3);
      c.copy(base).lerp(tip, Math.min(1, p.getY(i))); colA.set([c.r, c.g, c.b], o * 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posA, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(norA, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colA, 3));
  geo.setIndex(idx);

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = s => {
    s.uniforms.uTime = uTime; s.uniforms.uCenter = uCenter;
    s.vertexShader = `uniform float uTime; uniform vec2 uCenter; vec2 wrapOff;\n` + s.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = instanceMatrix[3].xyz;
        vec2 wp = mod(ip.xz - uCenter + ${(GRASS_TILE / 2).toFixed(1)}, ${GRASS_TILE.toFixed(1)}) - ${(GRASS_TILE / 2).toFixed(1)} + uCenter;
        wrapOff = wp - ip.xz;
        float keep = (1.0 - smoothstep(${(GRASS_TILE * 0.2).toFixed(1)}, ${(GRASS_TILE * 0.5).toFixed(1)}, distance(wp, uCenter)))
                   * step(length(wp), ${(R * 0.985).toFixed(2)});
        float w = sin(uTime * 1.6 + wp.x * 0.8 + wp.y * 0.6) * 0.6 + sin(uTime * 3.3 + wp.x * 2.1 - wp.y * 1.7) * 0.25;
        transformed.z += w * 0.26 * position.y * position.y;
        transformed *= keep;`)
      .replace('#include <project_vertex>', `vec4 mvPosition = instanceMatrix * vec4(transformed, 1.0);
        mvPosition.xz += wrapOff;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        #if defined( USE_SHADOWMAP )
          worldPosition.xz += wrapOff;
        #endif`);
  };
  const N = 34000, m = new THREE.InstancedMesh(geo, mat, N), d = new THREE.Object3D(), tint = new THREE.Color();
  for (let k = 0; k < N; k++) {
    const x = r() * GRASS_TILE, z = r() * GRASS_TILE, patch = 0.5 + 0.5 * bump(x * 0.7, 0, z * 0.7);
    d.position.set(x, 0, z); d.rotation.set(0, r() * Math.PI * 2, 0);
    d.scale.set(1 + r() * 0.8, 0.28 + r() * 0.2 + patch * 0.2, 1 + r() * 0.8);
    d.updateMatrix(); m.setMatrixAt(k, d.matrix);
    tint.setHSL(0.24 + patch * 0.05 + r() * 0.03, 0.55, 0.5 + r() * 0.14); m.setColorAt(k, tint);
  }
  m.receiveShadow = true; m.frustumCulled = false;
  return m;
}

function flowers(r) {
  const g = new THREE.Group(), N = 2200;
  const petal = new THREE.CylinderGeometry(0.1, 0.03, 0.035, 9);
  const heart = new THREE.SphereGeometry(0.042, 8, 6);
  const pm = new THREE.InstancedMesh(petal, new THREE.MeshLambertMaterial({ color: 0xffffff }), N);
  const hm = new THREE.InstancedMesh(heart, new THREE.MeshLambertMaterial({ color: 0xffc22e }), N);
  const d = new THREE.Object3D(), c = new THREE.Color();
  let cx = 0, cz = 0;
  for (let i = 0; i < N; i++) {
    if (i % 22 === 0) { const a = r() * 6.283, rad = Math.sqrt(r()) * (R - 3); cx = Math.cos(a) * rad; cz = Math.sin(a) * rad; }  // drifts of flowers
    const a = r() * 6.283, rad = Math.sqrt(r()) * 3.2, s = 0.8 + r() * 0.7;
    d.position.set(cx + Math.cos(a) * rad, 0.42 + r() * 0.16, cz + Math.sin(a) * rad);
    d.rotation.set((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5); d.scale.setScalar(s); d.updateMatrix();
    pm.setMatrixAt(i, d.matrix);
    c.set(r() < 0.7 ? 0xffffff : (r() < 0.5 ? 0xffd0e6 : 0xfff0a0)); pm.setColorAt(i, c);
    d.position.y += 0.025 * s; d.updateMatrix(); hm.setMatrixAt(i, d.matrix);
  }
  g.add(pm, hm);
  return g;
}

function blobGeo(r, sx, sy, sz, amp) {
  const geo = new THREE.SphereGeometry(1, 24, 16), p = geo.attributes.position, o = r() * 50;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + bump(x * 1.6 + o, y * 1.6, z * 1.6 + o) * amp;
    p.setXYZ(i, x * k * sx, y * k * sy, z * k * sz);
  }
  geo.computeVertexNormals();
  return geo;
}
function blob(r, sx, sy, sz, amp, mat) {
  const m = new THREE.Mesh(blobGeo(r, sx, sy, sz, amp), mat); m.castShadow = true; m.receiveShadow = true; return m;
}

const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6d4a34, roughness: 0.9 });
const leafMats = [0x4f8f3a, 0x6aa53f, 0x86b848, 0x5b9b3c].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
const rockMat = new THREE.MeshStandardMaterial({ color: 0xa59a8c, roughness: 0.9 });

function tree(r) {
  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0.12, 0.9, 0.05),
    new THREE.Vector3(-0.1, 1.9, 0.1), new THREE.Vector3(0.15, 2.9, 0)]);
  const tg = new THREE.TubeGeometry(curve, 24, 0.24, 12), p = tg.attributes.position;
  for (let i = 0; i < p.count; i++) {                       // taper the trunk and flare the foot
    const y = p.getY(i), c = curve.getPoint(Math.min(1, Math.max(0, (y + 0.2) / 3.1)));
    const k = 1.5 - 0.75 * Math.min(1, (y + 0.2) / 3.1) + Math.max(0, 0.35 - y) * 1.3;
    p.setX(i, c.x + (p.getX(i) - c.x) * k); p.setZ(i, c.z + (p.getZ(i) - c.z) * k);
  }
  tg.computeVertexNormals();
  const trunk = new THREE.Mesh(tg, trunkMat); trunk.castShadow = true; g.add(trunk);
  const puffs = [[0, 3.5, 0, 1.5], [-1.0, 3.1, 0.3, 1.05], [1.05, 3.2, -0.2, 1.1], [0.2, 4.3, 0.2, 1.05], [-0.4, 3.3, -0.9, 0.95], [0.5, 3.0, 0.9, 0.9]];
  for (const [x, y, z, s] of puffs) {
    const b = blob(r, s, s * 0.82, s, 0.16, leafMats[Math.floor(r() * leafMats.length)]);
    b.position.set(x, y, z); g.add(b);
  }
  return g;
}

export function buildScenery(scene) {
  const r = rng(20261117), uTime = { value: 0 }, uCenter = { value: new THREE.Vector2(START.x, START.z) };
  scene.add(sky());
  const clouds = cloudSea(r); scene.add(clouds);

  scene.add(islandMesh(R, 24, 1.3, 120));
  scene.add(meadow(r));
  scene.add(grassField(r, uTime, uCenter));
  scene.add(flowers(r));

  for (const t of TREES) {
    const m = tree(r); m.position.set(t.x, 0, t.z); m.scale.setScalar(t.s * 1.5); m.rotation.y = r() * 6; scene.add(m);
  }
  for (let i = 0; i < 46; i++) {                             // rounded boulders, a few big ones
    const a = r() * 6.283, rad = Math.sqrt(r()) * (R - 1.5), s = (i < 6 ? 0.9 : 0.25) + r() * 0.5;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (Math.hypot(x - START.x, z - START.z) < 4) continue;
    const b = blob(r, s * 1.2, s * 0.75, s, 0.2, rockMat);
    b.position.set(x, s * 0.3, z); b.rotation.y = r() * 6; scene.add(b);
  }

  // far islands for depth, raised so they show above the meadow's edge
  for (const [x, y, z, s] of [[-90, 6, -150, 14], [80, 12, -190, 20], [170, 4, -40, 12], [-180, 9, 30, 16], [40, 3, 170, 11], [-70, 14, 200, 18]]) {
    const far = islandMesh(s, s * 1.4, x); far.position.set(x, y, z); far.castShadow = false; scene.add(far);
    const ft = tree(r); ft.scale.setScalar(s * 0.3); ft.position.set(x, y, z); scene.add(ft);
  }

  const sun = new THREE.DirectionalLight(0xffcf96, 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 140 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x8a7350, 1.35));
  const fill = new THREE.DirectionalLight(0xffe6cf, 0.9); fill.position.set(6, 9, 20); scene.add(fill);
  scene.fog = new THREE.Fog(0xf8cfa8, 45, 330);

  return {
    update(t, px, pz) {
      uTime.value = t; uCenter.value.set(px, pz); clouds.rotation.y = t * 0.003;
      sun.target.position.set(px, 0, pz); sun.position.set(px + SUN_DIR.x * 60, SUN_DIR.y * 60, pz + SUN_DIR.z * 60);
    },
  };
}
