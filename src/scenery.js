// Everything the player doesn't knock over: sky, clouds, the island, grass, flowers, rocks, trees, snow.
// Two seasons share one scene: a bright windy summer meadow, and a winter snowstorm.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const R = 38;                                     // island radius
export const START = { x: 0, z: 25 };                    // where the player begins, facing the centre
export const SUN_DIR = new THREE.Vector3(-0.35, 0.62, -0.7).normalize();
const GRASS_TILE = 34;                                   // side of the square of grass that follows the player
const SNOW_BOX = 44;

const SEASONS = {
  summer: {
    sun: [-0.35, 0.62, -0.7], sunColor: 0xfff1d6, sunPower: 3.4, hemi: [0xbfe0ff, 0x6f9a4a, 1.45], fill: 0.5,
    sky: [0x1a5ccc, 0x4f9eea, 0xc3e4fb, 0xfff2c0, 1], fog: [0xcfe8fb, 70, 430],
    cloud: [0xffffff, 0x8fa8c8], floor: 0xdcecf8, ground: 0xffffff, rock: 0xa9a39a, trunk: 0x6d4a34, snow: 0,
  },
  winter: {
    sun: [-0.3, 0.75, -0.45], sunColor: 0xdfe4ea, sunPower: 0.9, hemi: [0xe8ecf2, 0xb4b8c0, 2.0], fill: 0.25,
    sky: [0x9aa0aa, 0xaeb3bb, 0xc2c5cb, 0x000000, 0], fog: [0xb9bdc4, 5, 78],
    cloud: [0xc9ccd2, 0x8a8d94], floor: 0xb9bdc4, ground: 0xf3f6fb, rock: 0xe6eaf0, trunk: 0x3d3733, snow: 1,
  },
};

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
      sun: { value: new THREE.Vector3() }, sunAmt: { value: 1 },
      zenith: { value: new THREE.Color() }, mid: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() }, glow: { value: new THREE.Color() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 sun, zenith, mid, horizon, glow; uniform float sunAmt;
      void main(){ vec3 d = normalize(vDir); float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.2, h));
        c = mix(c, zenith, smoothstep(0.15, 0.75, h));
        float s = max(dot(d, sun), 0.0);
        c += sunAmt * glow * (pow(s, 8.0) * 0.25 + pow(s, 80.0) * 0.6);
        c += sunAmt * vec3(1.0, 0.97, 0.88) * smoothstep(0.9990, 0.9996, s) * 5.0;
        c = mix(c, horizon, 1.0 - smoothstep(-0.25, 0.0, d.y));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(600, 32, 20), mat);
}

function cloudSea(r) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8fa8c8, emissiveIntensity: 0.5 });
  const N = 700, m = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), mat, N), d = new THREE.Object3D();
  for (let i = 0; i < N; i++) {
    const rad = 20 + Math.pow(r(), 0.7) * 330, a = r() * Math.PI * 2, s = 7 + r() * 13 + rad * 0.035;
    d.position.set(Math.cos(a) * rad, -13 + r() * 2.5 - s * 0.12, Math.sin(a) * rad);
    d.scale.set(s, s * (0.32 + r() * 0.2), s * (0.8 + r() * 0.4));
    d.rotation.y = r() * 6; d.updateMatrix(); m.setMatrixAt(i, d.matrix);
  }
  g.add(m);
  const floorMat = new THREE.MeshBasicMaterial({ color: 0xdcecf8 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(600, 40), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.y = -15; g.add(floor);
  return { group: g, mat, floorMat };
}

// Heaped white summer clouds standing in the sky around the island.
function cumulus(r) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xc2d2ea, emissiveIntensity: 0.62, fog: false });
  const N = 150, m = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 18, 14), mat, N), d = new THREE.Object3D();
  let k = 0;
  for (let c = 0; c < 15 && k < N; c++) {
    const a = c / 15 * Math.PI * 2 + r() * 0.3, rad = 230 + r() * 190, cx = Math.cos(a) * rad, cz = Math.sin(a) * rad, cy = 30 + r() * 80, w = 22 + r() * 26;
    for (let i = 0; i < 10 && k < N; i++, k++) {
      const t = (i / 9 - 0.5) * 2, s = w * (0.45 + r() * 0.5) * (1 - Math.abs(t) * 0.45);
      d.position.set(cx - Math.sin(a) * t * w * 1.4 + (r() - 0.5) * w * 0.5, cy + s * 0.55 + (i % 3 === 0 ? s * 0.5 : 0), cz + Math.cos(a) * t * w * 1.4 + (r() - 0.5) * w * 0.5);
      d.scale.set(s, s * 0.72, s); d.updateMatrix(); m.setMatrixAt(k, d.matrix);
    }
  }
  m.count = k; m.frustumCulled = false;
  return m;
}

function islandMesh(radius, depth, seed, segs = 56) {
  const pts = [[0, 0], [radius * 0.5, 0], [radius * 0.93, 0], [radius, -0.04], [radius + 0.06, -0.2], [radius * 0.97, -0.55],
    [radius * 0.8, -depth * 0.26], [radius * 0.52, -depth * 0.52], [radius * 0.24, -depth * 0.8], [0.001, -depth]]
    .map(p => new THREE.Vector2(p[0], p[1]));
  const curve = new THREE.SplineCurve(pts.slice(3));
  const prof = [...pts.slice(0, 3), ...curve.getPoints(18)];
  const geo = new THREE.LatheGeometry(prof, segs);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(0x3f9a34), soil = new THREE.Color(0x6b4a30), rock = new THREE.Color(0x8d7a6a), c = new THREE.Color();
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

// Mottled green ground under the grass blades; plain white in winter.
function meadow(r) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d'); g.fillStyle = '#3f9a34'; g.fillRect(0, 0, 512, 512);
  const tones = ['#4fae3c', '#2f8a2e', '#62bd44', '#2a7d2c', '#7ccb4c'];
  for (let i = 0; i < 260; i++) {
    const x = r() * 512, y = r() * 512, s = 20 + r() * 70;
    g.globalAlpha = 0.10 + r() * 0.14; g.fillStyle = tones[Math.floor(r() * tones.length)];
    for (const [ox, oy] of [[0, 0], [512, 0], [-512, 0], [0, 512], [0, -512]]) { g.beginPath(); g.arc(x + ox, y + oy, s, 0, 7); g.fill(); }
  }
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(7, 7); map.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 1 });
  const m = new THREE.Mesh(new THREE.CircleGeometry(R * 0.995, 96), mat);
  m.rotation.x = -Math.PI / 2; m.position.y = 0.012; m.receiveShadow = true;
  return { mesh: m, mat, map };
}

// One square of grass tufts that wraps around the player in the vertex shader, so the whole island
// looks covered while only the nearby blades are drawn. Gusts roll across it as travelling waves:
// every blade leans the same way by (gust strength x height squared), and its tip brightens as it bends.
function grassField(r, U) {
  const blade = (w, h, yaw, ox, oz) => {
    const g = new THREE.PlaneGeometry(w, h, 1, 3); g.translate(0, h / 2, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) / h; p.setX(i, p.getX(i) * (1 - y * 0.92)); p.setZ(i, y * y * 0.12 * h); }
    g.rotateY(yaw); g.translate(ox, 0, oz); return g;
  };
  const parts = [blade(0.1, 1, 0.2, 0, 0), blade(0.09, 0.8, 2.3, 0.09, 0.05), blade(0.09, 0.9, 4.4, -0.06, 0.08)];
  const count = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const posA = new Float32Array(count * 3), norA = new Float32Array(count * 3), colA = new Float32Array(count * 3), idx = [];
  const base = new THREE.Color(0x157a2c), tip = new THREE.Color(0x9be24e), c = new THREE.Color();
  let o = 0;
  for (const g of parts) {
    const p = g.attributes.position;
    for (const i of g.index.array) idx.push(i + o);
    for (let i = 0; i < p.count; i++, o++) {
      posA.set([p.getX(i), p.getY(i), p.getZ(i)], o * 3); norA.set([0, 1, 0], o * 3);
      c.copy(base).lerp(tip, Math.pow(Math.min(1, Math.max(0, p.getY(i))), 1.4)); colA.set([c.r, c.g, c.b], o * 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posA, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(norA, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colA, 3));
  geo.setIndex(idx);

  const T = GRASS_TILE.toFixed(1), H = (GRASS_TILE / 2).toFixed(1);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = s => {
    s.uniforms.uTime = U.time; s.uniforms.uCenter = U.center; s.uniforms.uSnow = U.snow;
    s.vertexShader = `uniform float uTime, uSnow; uniform vec2 uCenter; vec2 wrapOff; float bend;\n` + s.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = instanceMatrix[3].xyz;
        vec2 wp = mod(ip.xz - uCenter + ${H}, ${T}) - ${H} + uCenter;
        wrapOff = wp - ip.xz;
        float keep = (1.0 - smoothstep(${(GRASS_TILE * 0.2).toFixed(1)}, ${H}, distance(wp, uCenter))) * step(length(wp), ${(R * 0.985).toFixed(2)});
        float hsh = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
        keep *= mix(1.0, step(hsh, 0.07), uSnow);                       // winter: only a few dry stalks show through the snow
        float gust = sin(wp.x * 0.21 + wp.y * 0.12 - uTime * 1.5 + sin(wp.y * 0.08 + uTime * 0.25) * 2.2) * 0.5 + 0.5;
        gust = gust * gust * (0.75 + 0.25 * sin(wp.x * 0.05 - wp.y * 0.07 + uTime * 0.4));
        float flutter = sin(uTime * 4.3 + wp.x * 2.1 - wp.y * 1.7) * 0.07;
        bend = (0.1 + gust * 0.62 + flutter) * mix(1.0, 1.5, uSnow);
        transformed.y *= mix(1.0, 0.5, uSnow);
        transformed *= keep;
        vColor.rgb *= 0.86 + gust * 0.5 * position.y;                   // the sheen that travels with each gust
        vColor.rgb = mix(vColor.rgb, vec3(0.86, 0.80, 0.62), uSnow);`)
      .replace('#include <project_vertex>', `vec4 mvPosition = instanceMatrix * vec4(transformed, 1.0);
        float lean = bend * mvPosition.y * mvPosition.y;
        mvPosition.xz += wrapOff + vec2(0.86, 0.5) * lean;
        mvPosition.y -= lean * lean * 0.25;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        #if defined( USE_SHADOWMAP )
          worldPosition.xz += wrapOff + vec2(0.86, 0.5) * bend * worldPosition.y * worldPosition.y;
        #endif`);
    // winter stalks are flat dry straw, not shaded leaf
    s.fragmentShader = 'uniform float uSnow;\n' + s.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.62, 0.55, 0.36), uSnow * 0.9);`);
  };
  const N = 40000, m = new THREE.InstancedMesh(geo, mat, N), d = new THREE.Object3D(), tint = new THREE.Color();
  for (let k = 0; k < N; k++) {
    const x = r() * GRASS_TILE, z = r() * GRASS_TILE, patch = 0.5 + 0.5 * bump(x * 0.7, 0, z * 0.7);
    d.position.set(x, 0, z); d.rotation.set(0, r() * Math.PI * 2, 0);
    d.scale.set(1.2 + r() * 0.9, 0.5 + r() * 0.3 + patch * 0.32, 1.2 + r() * 0.9);
    d.updateMatrix(); m.setMatrixAt(k, d.matrix);
    tint.setHSL(0.29 + patch * 0.04 + r() * 0.03, 0.75, 0.52 + r() * 0.12); m.setColorAt(k, tint);
  }
  m.receiveShadow = true; m.frustumCulled = false;
  return m;
}

function flowers(r) {
  const g = new THREE.Group(), N = 2600;
  // five-petal star: a flat disc with every other rim vertex pulled in
  const petal = new THREE.CircleGeometry(0.13, 10), pp = petal.attributes.position;
  for (let i = 1; i < pp.count; i++) if (i % 2 === 0) pp.setXYZ(i, pp.getX(i) * 0.42, pp.getY(i) * 0.42, 0);
  petal.rotateX(-Math.PI / 2);
  const heart = new THREE.SphereGeometry(0.04, 8, 6);
  const pm = new THREE.InstancedMesh(petal, new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), N);
  const hm = new THREE.InstancedMesh(heart, new THREE.MeshLambertMaterial({ color: 0xffd23e }), N);
  const d = new THREE.Object3D(), c = new THREE.Color(), hues = [0xff7fb0, 0xc58cff, 0xffe45a, 0xffffff, 0xff9a5a, 0x8fb8ff];
  let cx = 0, cz = 0, hue = 0;
  for (let i = 0; i < N; i++) {
    if (i % 26 === 0) { const a = r() * 6.283, rad = Math.sqrt(r()) * (R - 3); cx = Math.cos(a) * rad; cz = Math.sin(a) * rad; hue = Math.floor(r() * hues.length); }
    const a = r() * 6.283, rad = Math.sqrt(r()) * 3.6, s = 0.8 + r() * 0.7;
    d.position.set(cx + Math.cos(a) * rad, 0.62 + r() * 0.3, cz + Math.sin(a) * rad);
    d.rotation.set((r() - 0.5) * 0.7, r() * 6, (r() - 0.5) * 0.7); d.scale.setScalar(s); d.updateMatrix();
    pm.setMatrixAt(i, d.matrix);
    c.set(r() < 0.75 ? hues[hue] : hues[Math.floor(r() * hues.length)]); pm.setColorAt(i, c);
    d.position.y += 0.02 * s; d.updateMatrix(); hm.setMatrixAt(i, d.matrix);
  }
  g.add(pm, hm);
  return g;
}

function blobGeo(r, sx, sy, sz, amp, lo, hi) {
  const geo = new THREE.SphereGeometry(1, 24, 16), p = geo.attributes.position, o = r() * 50;
  const col = lo ? new Float32Array(p.count * 3) : null, c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + bump(x * 1.6 + o, y * 1.6, z * 1.6 + o) * amp + (lo ? bump(x * 5 + o, y * 5, z * 5) * amp * 0.35 : 0);
    if (col) { c.copy(lo).lerp(hi, THREE.MathUtils.smoothstep(y + (k - 1) * 1.5, -0.5, 0.9)); col.set([c.r, c.g, c.b], i * 3); }
    p.setXYZ(i, x * k * sx, y * k * sy, z * k * sz);
  }
  if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6d4a34, roughness: 0.9 });
const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
const twigMat = new THREE.MeshStandardMaterial({ color: 0x3a3430, roughness: 1 });
const rockMat = new THREE.MeshStandardMaterial({ color: 0xa9a39a, roughness: 0.9 });
const LEAF = [[0x1c7a34, 0xcdf060], [0x268a3a, 0xe0f56a], [0x1a7240, 0xb4ea58]].map(p => p.map(c => new THREE.Color(c)));

// A bare winter crown: a leader that keeps climbing, with side branches forking off it.
function branchGeo(r) {
  const parts = [], up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), mid = new THREE.Vector3();
  const grow = (base, dir, len, rad, depth) => {
    const end = base.clone().addScaledVector(dir, len);
    const g = new THREE.CylinderGeometry(rad * 0.7, rad, len, depth > 2 ? 7 : 5, 1, true);
    q.setFromUnitVectors(up, dir); g.applyQuaternion(q); mid.copy(base).add(end).multiplyScalar(0.5); g.translate(mid.x, mid.y, mid.z);
    parts.push(g);
    if (depth <= 0) return;
    const kids = depth > 3 ? 3 : 2 + (r() < 0.4 ? 1 : 0);
    for (let i = 0; i < kids; i++) {
      const leader = i === 0 && depth > 2;
      const side = new THREE.Vector3(r() - 0.5, 0, r() - 0.5).normalize();
      const nd = dir.clone().multiplyScalar(leader ? 1 : 0.55).addScaledVector(side, leader ? 0.16 : 0.75).add(new THREE.Vector3(0, leader ? 0.3 : 0.28, 0)).normalize();
      grow(end, nd, len * (leader ? 0.82 : 0.66), rad * (leader ? 0.74 : 0.55), depth - 1);
    }
  };
  grow(new THREE.Vector3(0.12, 2.6, 0), new THREE.Vector3(0.05, 1, 0).normalize(), 1.5, 0.19, 5);
  return mergeGeometries(parts);
}

function tree(r, bareGeo) {
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

  const leaves = new THREE.Group(), pal = LEAF[Math.floor(r() * LEAF.length)];
  const puffs = [[0, 3.6, 0, 1.35], [-1.1, 3.2, 0.3, 1.0], [1.1, 3.3, -0.2, 1.05], [0.2, 4.5, 0.2, 1.0], [-0.4, 3.4, -1.0, 0.95], [0.5, 3.1, 1.0, 0.9],
    [-0.8, 4.1, 0.6, 0.8], [0.9, 4.2, 0.5, 0.78], [0.1, 4.0, -0.9, 0.8], [-1.5, 3.5, -0.5, 0.7], [1.5, 3.6, 0.6, 0.68], [0, 5.1, -0.1, 0.7]];
  for (const [x, y, z, s] of puffs) {
    const b = new THREE.Mesh(blobGeo(r, s, s * 0.8, s, 0.2, pal[0], pal[1]), leafMat);
    b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; leaves.add(b);
  }
  const bare = new THREE.Mesh(bareGeo, twigMat); bare.castShadow = true; bare.visible = false;
  g.add(leaves, bare);
  g.userData = { leaves, bare };
  return g;
}

// Snowflakes in a box that wraps around the camera, falling and blown sideways.
function snowfall(r, U) {
  const N = 5200, pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos.set([r() * SNOW_BOX, r() * SNOW_BOX, r() * SNOW_BOX], i * 3); seed[i] = r(); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const B = SNOW_BOX.toFixed(1), HB = (SNOW_BOX / 2).toFixed(1);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: U.time, uCam: { value: new THREE.Vector3() }, uSize: { value: 1 } },
    vertexShader: `attribute float seed; uniform float uTime, uSize; uniform vec3 uCam; varying float vA;
      void main(){ vec3 p = position;
        p.y -= uTime * (2.4 + seed * 2.2);
        p.x += uTime * (5.0 + seed * 3.0) + sin(uTime * 1.3 + seed * 40.0) * 0.9;
        p.z += uTime * 1.6 + cos(uTime * 1.1 + seed * 31.0) * 0.9;
        p = mod(p - uCam + ${HB}, ${B}) - ${HB} + uCam;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * (0.55 + seed * 0.9) * 95.0 / max(1.5, -mv.z);
        vA = (1.0 - smoothstep(${(SNOW_BOX * 0.3).toFixed(1)}, ${HB}, -mv.z)) * (0.55 + seed * 0.45);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5);
      gl_FragColor = vec4(1.0, 1.0, 1.0, vA * (1.0 - smoothstep(0.15, 0.5, d))); }`,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.visible = false;
  return pts;
}

export function buildScenery(scene) {
  const r = rng(20261117);
  const U = { time: { value: 0 }, center: { value: new THREE.Vector2(START.x, START.z) }, snow: { value: 0 } };
  const skyMesh = sky(); scene.add(skyMesh);
  const sea = cloudSea(r); scene.add(sea.group);
  const heaps = cumulus(r); scene.add(heaps);

  scene.add(islandMesh(R, 24, 1.3, 120));
  const ground = meadow(r); scene.add(ground.mesh);
  scene.add(grassField(r, U));
  const blooms = flowers(r); scene.add(blooms);

  const bareGeos = [branchGeo(r), branchGeo(r), branchGeo(r)], trees = [];
  TREES.forEach((t, i) => {
    const m = tree(r, bareGeos[i % bareGeos.length]); m.position.set(t.x, 0, t.z); m.scale.setScalar(t.s * 1.5); m.rotation.y = r() * 6;
    scene.add(m); trees.push(m);
  });
  for (let i = 0; i < 46; i++) {                             // rounded boulders, a few big ones
    const a = r() * 6.283, rad = Math.sqrt(r()) * (R - 1.5), s = (i < 6 ? 0.9 : 0.25) + r() * 0.5;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (Math.hypot(x - START.x, z - START.z) < 4) continue;
    const b = new THREE.Mesh(blobGeo(r, s * 1.2, s * 0.75, s, 0.2), rockMat); b.castShadow = b.receiveShadow = true;
    b.position.set(x, s * 0.3, z); b.rotation.y = r() * 6; scene.add(b);
  }

  // far islands for depth, raised so they show above the meadow's edge
  for (const [x, y, z, s] of [[-90, 6, -150, 14], [80, 12, -190, 20], [170, 4, -40, 12], [-180, 9, 30, 16], [40, 3, 170, 11], [-70, 14, 200, 18]]) {
    const far = islandMesh(s, s * 1.4, x); far.position.set(x, y, z); far.castShadow = false; scene.add(far);
    const ft = tree(r, bareGeos[0]); ft.scale.setScalar(s * 0.3); ft.position.set(x, y, z); scene.add(ft); trees.push(ft);
  }

  const flakes = snowfall(r, U); scene.add(flakes);

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 140 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.4); scene.add(hemi);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(6, 9, 20); scene.add(fill);
  scene.fog = new THREE.Fog(0xffffff, 60, 400);

  let season = '';
  function setSeason(name) {
    const S = SEASONS[name] || SEASONS.summer;
    if (name === season) return;
    season = name;
    SUN_DIR.set(...S.sun).normalize();
    sun.color.set(S.sunColor); sun.intensity = S.sunPower;
    hemi.color.set(S.hemi[0]); hemi.groundColor.set(S.hemi[1]); hemi.intensity = S.hemi[2]; fill.intensity = S.fill;
    const u = skyMesh.material.uniforms;
    u.zenith.value.set(S.sky[0]); u.mid.value.set(S.sky[1]); u.horizon.value.set(S.sky[2]); u.glow.value.set(S.sky[3]);
    u.sunAmt.value = S.sky[4]; u.sun.value.copy(SUN_DIR);
    scene.fog.color.set(S.fog[0]); scene.fog.near = S.fog[1]; scene.fog.far = S.fog[2];
    sea.mat.color.set(S.cloud[0]); sea.mat.emissive.set(S.cloud[1]); sea.floorMat.color.set(S.floor);
    ground.mat.map = S.snow ? null : ground.map; ground.mat.color.set(S.ground); ground.mat.needsUpdate = true;
    rockMat.color.set(S.rock); trunkMat.color.set(S.trunk);
    U.snow.value = S.snow;
    heaps.visible = blooms.visible = !S.snow; flakes.visible = !!S.snow;
    for (const t of trees) { t.userData.leaves.visible = !S.snow; t.userData.bare.visible = !!S.snow; }
  }
  setSeason('summer');

  return {
    setSeason,
    get season() { return season; },
    update(t, px, pz, camera, pixelRatio = 1) {
      U.time.value = t; U.center.value.set(px, pz); sea.group.rotation.y = t * 0.003; heaps.rotation.y = t * 0.0016;
      sun.target.position.set(px, 0, pz); sun.position.set(px + SUN_DIR.x * 60, SUN_DIR.y * 60, pz + SUN_DIR.z * 60);
      if (flakes.visible) { flakes.material.uniforms.uCam.value.copy(camera.position); flakes.material.uniforms.uSize.value = pixelRatio; }
    },
  };
}
