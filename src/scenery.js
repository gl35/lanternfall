// Everything the player doesn't knock over: sky, clouds, the island, grass, flowers, rocks, trees, snow.
// Two seasons share one scene: a bright windy summer meadow, and a winter snowstorm.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const R = 38;                                     // island radius
export const START = { x: 0, z: 25 };                    // where the player begins, facing the centre
export const SUN_DIR = new THREE.Vector3(-0.35, 0.62, -0.7).normalize();
const SNOW_BOX = 44;
const TONES = [0x17604e, 0x2a8a48, 0x58b93c, 0xa8dc48, 0xf0ee62].map(c => new THREE.Color(c));   // foliage, shade to sunlit

const SEASONS = {
  summer: {
    sun: [-0.35, 0.62, -0.7], sunColor: 0xfff1d6, sunPower: 3.4, hemi: [0xbfe0ff, 0x6f9a4a, 1.45], fill: 0.5,
    sky: [0x1a5ccc, 0x4f9eea, 0xc3e4fb, 0xfff2c0, 1], fog: [0xcfe8fb, 70, 430],
    cloud: [0xffffff, 0x8fa8c8], floor: 0xdcecf8, ground: 0xffffff, rock: 0xa9a39a, trunk: 0xd29478, snow: 0,
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
export const ROAM = 178;      // how far from the middle he can walk: over the hills, up to the foot of the mountains
export const WOODS = [];      // the hill trees, for the game to keep him out of
export const TREES = (() => {
  const r = rng(77), out = [];
  for (let tries = 0; out.length < 18 && tries < 400; tries++) {
    const a = r() * Math.PI * 2, rad = 6 + Math.sqrt(r()) * (R - 9), x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (Math.hypot(x - START.x, z - START.z) < 12) continue;
    if (out.some(t => Math.hypot(t.x - x, t.z - z) < 8)) continue;
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

// Beyond the flat meadow the ground swells into rolling hills, then far mountains. The same formula is
// written again in GLSL (HILL_GLSL) so the grass can stand on the nearest slopes.
const HILL_IN = R + 6, HILL_OUT = 150;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// A valley winds out of the meadow behind where he starts: a flat floor between the hills, closed off at its far end.
export const VALLEY = { ux: -0.342, uz: 0.94, wind: 7, k: 0.045, flat: 16, wall: 40, end0: 88, end1: 112 };
export function valley(x, z) {                              // 1 on the valley floor, 0 away from it
  const t = x * VALLEY.ux + z * VALLEY.uz; if (t <= 0) return 0;
  const side = -x * VALLEY.uz + z * VALLEY.ux + VALLEY.wind * Math.sin(t * VALLEY.k);
  return (1 - sstep(VALLEY.flat, VALLEY.wall, Math.abs(side))) * (1 - sstep(VALLEY.end0, VALLEY.end1, t));
}
export function valleyAt(t, side = 0) {                     // the point t along the valley and `side` across it
  const off = side - VALLEY.wind * Math.sin(t * VALLEY.k);
  return { x: VALLEY.ux * t - VALLEY.uz * off, z: VALLEY.uz * t + VALLEY.ux * off };
}
export const VALLEY2 = { ux: 0.985, uz: -0.17, wind: 6, k: 0.05, flat: 13, wall: 36, end0: 120, end1: 150 };   // east from the meadow, down to the sea
export function valley2(x, z) {
  const V = VALLEY2, t = x * V.ux + z * V.uz; if (t <= 0) return 0;
  const side = -x * V.uz + z * V.ux + V.wind * Math.sin(t * V.k);
  return (1 - sstep(V.flat, V.wall, Math.abs(side))) * (1 - sstep(V.end0, V.end1, t));
}
export function valley2At(t, side = 0) {
  const V = VALLEY2, off = side - V.wind * Math.sin(t * V.k);
  return { x: V.ux * t - V.uz * off, z: V.uz * t + V.ux * off };
}
// The cove at the end of it: the ground dips below the water in the middle and comes up through a strip of sand.
export const BAY = { ...valley2At(138), r: 40, edge: 62, level: -0.35, deep: -3.2, shore: 32.3 };
const bayMask = (x, z) => 1 - sstep(BAY.r, BAY.edge, Math.hypot(x - BAY.x, z - BAY.z));
const bayFloor = r => BAY.deep + 3.5 * sstep(14, BAY.r, r);
export const CASTLE = { x: 0, z: -112, y: 9, flat: 46, edge: 70 };   // a levelled hilltop beyond the far side of the meadow
const castleMask = (x, z) => 1 - sstep(CASTLE.flat, CASTLE.edge, Math.hypot(x - CASTLE.x, z - CASTLE.z));
export const PLAYGROUND = { ...valleyAt(62), r: 12.5 };       // a round of bare ground in the valley: no grass grows on it
export function hillHeight(x, z) {
  const d = Math.hypot(x, z);
  const roll = 0.5 + 0.5 * Math.sin(x * 0.031 + 1.3) * Math.sin(z * 0.027 + 0.7), wave = 0.5 + 0.5 * Math.sin(x * 0.011 - z * 0.017 + 2.0);
  const peaks = 0.5 + 0.5 * Math.sin(x * 0.0085 + 0.5) * Math.cos(z * 0.0075 - 1.0), ridge = 0.5 + 0.5 * Math.sin(Math.atan2(z, x) * 7 + 1.0);
  const cm = castleMask(x, z), bm = bayMask(x, z);
  let h = sstep(HILL_IN, HILL_OUT, d) * (5 + 16 * roll + 9 * wave) * (1 - Math.max(valley(x, z), valley2(x, z))) * (1 - cm) + CASTLE.y * cm;
  if (bm > 0) h = h * (1 - bm) + bayFloor(Math.hypot(x - BAY.x, z - BAY.z)) * bm;
  return h + sstep(190, 430, d) * (26 + 60 * peaks + 26 * ridge);
}
const HILL_GLSL = `float hillH(vec2 p) {
    float d = length(p);
    float roll = 0.5 + 0.5 * sin(p.x * 0.031 + 1.3) * sin(p.y * 0.027 + 0.7), wave = 0.5 + 0.5 * sin(p.x * 0.011 - p.y * 0.017 + 2.0);
    float vt = p.x * ${VALLEY.ux.toFixed(3)} + p.y * ${VALLEY.uz.toFixed(3)};
    float vs = -p.x * ${VALLEY.uz.toFixed(3)} + p.y * ${VALLEY.ux.toFixed(3)} + ${VALLEY.wind.toFixed(1)} * sin(vt * ${VALLEY.k.toFixed(3)});
    float vale = step(0.0, vt) * (1.0 - smoothstep(${VALLEY.flat.toFixed(1)}, ${VALLEY.wall.toFixed(1)}, abs(vs))) * (1.0 - smoothstep(${VALLEY.end0.toFixed(1)}, ${VALLEY.end1.toFixed(1)}, vt));
    float cm = 1.0 - smoothstep(${CASTLE.flat.toFixed(1)}, ${CASTLE.edge.toFixed(1)}, distance(p, vec2(${CASTLE.x.toFixed(1)}, ${CASTLE.z.toFixed(1)})));
    float wt = p.x * ${VALLEY2.ux.toFixed(3)} + p.y * ${VALLEY2.uz.toFixed(3)};
    float ws = -p.x * ${VALLEY2.uz.toFixed(3)} + p.y * ${VALLEY2.ux.toFixed(3)} + ${VALLEY2.wind.toFixed(1)} * sin(wt * ${VALLEY2.k.toFixed(3)});
    float vale2 = step(0.0, wt) * (1.0 - smoothstep(${VALLEY2.flat.toFixed(1)}, ${VALLEY2.wall.toFixed(1)}, abs(ws))) * (1.0 - smoothstep(${VALLEY2.end0.toFixed(1)}, ${VALLEY2.end1.toFixed(1)}, wt));
    float bd = distance(p, vec2(${BAY.x.toFixed(2)}, ${BAY.z.toFixed(2)})), bm = 1.0 - smoothstep(${BAY.r.toFixed(1)}, ${BAY.edge.toFixed(1)}, bd);
    float h = smoothstep(${HILL_IN.toFixed(1)}, ${HILL_OUT.toFixed(1)}, d) * (5.0 + 16.0 * roll + 9.0 * wave) * (1.0 - max(vale, vale2)) * (1.0 - cm) + ${CASTLE.y.toFixed(1)} * cm;
    return mix(h, ${BAY.deep.toFixed(1)} + 3.5 * smoothstep(14.0, ${BAY.r.toFixed(1)}, bd), bm);
  }`;

const LAND = { meadow: new THREE.Color(0x48a838), sunny: new THREE.Color(0x86cf48), wood: new THREE.Color(0x2c8040), high: new THREE.Color(0x4f9a78), sand: new THREE.Color(0xf0dca6), wet: new THREE.Color(0xc9ad76), bed: new THREE.Color(0x3f8f8a) };
function landColor(c, x, z, y, d) {
  const patch = 0.5 + 0.5 * Math.sin(x * 0.05 + Math.sin(z * 0.04) * 2) * Math.sin(z * 0.045 - x * 0.013);
  return c.copy(LAND.meadow).lerp(LAND.sunny, patch * 0.55 * sstep(0, 12, y) + 0.08).lerp(LAND.wood, sstep(0.35, 0.75, 1 - patch) * sstep(4, 16, y) * 0.8).lerp(LAND.high, sstep(190, 400, d) * 0.85);
}
// The cove needs finer ground than the hills have: a close-meshed round of land, sand and sea bed laid just over them.
function cove() {
  const RINGS = 52, SEGS = 112, pos = [], col = [], idx = [], c = new THREE.Color();
  for (let i = 0; i <= RINGS; i++) {
    const r = BAY.edge * i / RINGS;
    for (let j = 0; j <= SEGS; j++) {
      const a = j / SEGS * Math.PI * 2, x = BAY.x + Math.cos(a) * r, z = BAY.z + Math.sin(a) * r, y = hillHeight(x, z);
      pos.push(x, y + 0.03, z);
      landColor(c, x, z, y, Math.hypot(x, z));
      const ripple = Math.sin(r * 2.1 + Math.sin(a * 9) * 0.8) * 0.5 + 0.5;                       // faint ridges left in the sand by the water
      const grassy = sstep(BAY.r - 1.2, BAY.r + 2.2, r + Math.sin(a * 13) * 0.9);
      const sandC = LAND.sand.clone().lerp(LAND.wet, sstep(BAY.level + 0.5, BAY.level - 0.1, y) * 0.9 + ripple * 0.08).lerp(LAND.bed, sstep(BAY.level - 0.3, BAY.deep, y) * 0.85);
      c.lerp(sandC, 1 - grassy); col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < RINGS; i++) for (let j = 0; j < SEGS; j++) { const a = i * (SEGS + 1) + j, b = a + SEGS + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })); mesh.receiveShadow = true; return mesh;
}
// Sea water in the cove: swell running in to the beach, lines of foam breaking along the shore, sun on the ripples, clear in the shallows.
function seaWater(U) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uTime: U.time, uWind: U.wind, uShore: { value: BAY.shore }, uSun: { value: SUN_DIR } },
    vertexShader: 'varying vec2 vP; varying vec3 vW; void main() { vP = position.xy; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uTime, uWind, uShore; uniform vec3 uSun; varying vec2 vP; varying vec3 vW;
      float hgt(vec2 p) {
        float r = length(p), a = atan(p.y, p.x), amp = 0.55 + 0.6 * uWind;
        float swell = sin(r * 0.9 + uTime * 1.5 + sin(a * 3.0) * 0.9) * 0.6 + sin(r * 1.7 + uTime * 2.3 + a * 2.0) * 0.25;
        float chop = sin(p.x * 2.3 + uTime * 1.9) * sin(p.y * 2.9 - uTime * 1.6) * 0.3 + sin((p.x - p.y) * 5.3 + uTime * 3.1) * 0.12;
        return (swell + chop) * amp;
      }
      void main() {
        float r = length(vP), a = atan(vP.y, vP.x);
        float edge = uShore + sin(a * 7.0 + uTime * 0.9) * 0.5 + sin(uTime * 0.7 + a * 3.0) * 0.9;      // the waterline, washing in and out
        if (r > edge + 0.6) discard;
        float e = 0.08, h = hgt(vP), hx = hgt(vP + vec2(e, 0.0)) - h, hy = hgt(vP + vec2(0.0, e)) - h;
        vec3 n = normalize(vec3(-hx / e * 0.16, 1.0, hy / e * 0.16)), V = normalize(cameraPosition - vW), L = normalize(uSun);
        float depth = clamp((edge - r) / 16.0, 0.0, 1.0), fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        vec3 col = mix(vec3(0.42, 0.86, 0.80), vec3(0.04, 0.33, 0.50), pow(depth, 0.7));
        col += h * 0.035;
        col = mix(col, vec3(0.78, 0.90, 1.0), fres * 0.7);
        float spec = pow(max(dot(reflect(-L, n), V), 0.0), 70.0);
        float glit = pow(max(dot(reflect(-L, normalize(n + vec3(sin(vP.x * 23.0 + uTime * 2.4), 0.0, sin(vP.y * 19.0 - uTime * 2.1)) * 0.14)), V), 0.0), 200.0);
        col += vec3(1.0, 0.96, 0.86) * (spec * 0.8 + glit * 1.5);
        float near = 1.0 - clamp((edge - r) / 7.0, 0.0, 1.0);                                           // foam only close in
        float lines = smoothstep(0.55, 0.95, sin((edge - r) * 1.5 + uTime * 1.6 + sin(a * 11.0) * 0.8)) * near;
        float lace = smoothstep(0.9, 0.0, edge - r) * (0.75 + 0.25 * sin(a * 60.0 + uTime * 3.0));
        col = mix(col, vec3(1.0), clamp(lines * 0.7 + lace, 0.0, 1.0));
        float alpha = mix(0.5, 0.94, smoothstep(0.0, 0.35, depth)) * smoothstep(edge + 0.6, edge, r);
        gl_FragColor = vec4(col, max(alpha, lace * 0.9));
      }`,
  });
  const m = new THREE.Mesh(new THREE.CircleGeometry(BAY.shore + 3, 96), mat); m.rotation.x = -Math.PI / 2; m.position.set(BAY.x, BAY.level, BAY.z); m.renderOrder = 1; m.frustumCulled = false; return m;
}
function hills() {
  const RINGS = 56, SEGS = 180, OUT = 470, pos = [], col = [], idx = [];
  const c = new THREE.Color();
  for (let i = 0; i <= RINGS; i++) {
    const d = R * 0.985 + (OUT - R * 0.985) * Math.pow(i / RINGS, 1.7);
    for (let j = 0; j <= SEGS; j++) {
      const a = j / SEGS * Math.PI * 2, x = Math.cos(a) * d, z = Math.sin(a) * d, y = hillHeight(x, z);
      pos.push(x, y + 0.006 - 2.6 * bayMask(x, z) * sstep(BAY.edge, BAY.edge - 6, Math.hypot(x - BAY.x, z - BAY.z)), z);   // sunk out of sight where the cove's own ground lies over it
      landColor(c, x, z, y, d);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < RINGS; i++) for (let j = 0; j < SEGS; j++) {
    const a = i * (SEGS + 1) + j, b = a + SEGS + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  return mesh;
}

// Woods on the hills: the same tree as the meadow's - bent trunk, forking limbs, a broad crown of many lobes.
// There are hundreds, so far ones are drawn as a sketch of that crown (a few big clumps of its leaves over a
// dark heart), and the couple of dozen nearest him are swapped for the full tree, leaf for leaf.
function hillWoods(r, U, bareGeo) {
  const N = 700, PER = 48, T = 4, SLOTS = 7, NEAR = 85, group = new THREE.Group(), d = new THREE.Object3D(), c = new THREE.Color(), n = new THREE.Vector3();
  const sunXZ = new THREE.Vector2(SUN_DIR.x, SUN_DIR.z).normalize();
  const model = tree(rng(31), bareGeo), puffs = model.userData.puffs, r2 = rng(32);
  const tone = t => { const f = THREE.MathUtils.clamp(t, 0, 0.999) * (TONES.length - 1), i0 = Math.floor(f); return c.copy(TONES[i0]).lerp(TONES[i0 + 1], Math.min(1, (f - i0) * 1.6)); };

  // one crown, in the tree's own space: every clump of leaves the meadow tree has
  const crown = [], BASE_Y = 2.75;
  for (const [x, y, z, s] of puffs) {
    for (let i = 0; i < 45; i++) {                           // the shaded underside
      const a = r2() * 6.283, rr = Math.sqrt(r2()) * s * 0.95;
      crown.push({ x: x + Math.cos(a) * rr, y: Math.max(BASE_Y, y - s * 0.5) + r2() * 0.35, z: z + Math.sin(a) * rr, size: s * (0.6 + r2() * 0.35), under: r2() * 0.8 });
    }
    for (let i = 0; i < 215; i++) {
      let ly = 0, rad = 1;
      for (let tries = 0; tries < 12; tries++) {
        const cu = r2() * 1.7 - 0.7, a = r2() * 6.283, q = Math.sqrt(1 - cu * cu);
        n.set(Math.cos(a) * q, cu, Math.sin(a) * q); rad = 0.55 + r2() * 0.52; ly = y + n.y * s * 0.84 * rad;
        if (ly > BASE_Y) break;
      }
      crown.push({ x: x + n.x * s * rad, y: Math.max(BASE_Y, ly), z: z + n.z * s * rad, size: s * (0.62 + r2() * 0.4), nx: n.x, ny: n.y, nz: n.z,
        base: n.y * 0.62 + (ly - 3.9) * 0.17 + (rad - 0.85) * 0.5 + (r2() - 0.5) * 0.3 + 0.46 });
    }
  }
  for (let i = crown.length - 1; i > 0; i--) { const j = Math.floor(r2() * (i + 1)); [crown[i], crown[j]] = [crown[j], crown[i]]; }   // so drawing fewer thins it evenly
  const CN = crown.length, cm = new Float32Array(CN * 16);
  crown.forEach((q, i) => cm.set([q.size, 0, 0, 0, 0, q.size, 0, 0, 0, 0, q.size, 0, q.x, q.y, q.z, 1], i * 16));
  const crownMat = new THREE.InstancedBufferAttribute(cm, 16);
  // the tree is turned four ways; each turn has its own colours, since the sunny side stays put
  const yaws = [0.4, 2.0, 3.6, 5.2], turnCol = (q, yaw) => q.nx === undefined ? c.copy(TONES[0]).lerp(TONES[1], q.under)
    : tone(q.base + ((q.nx * Math.cos(yaw) + q.nz * Math.sin(yaw)) * sunXZ.x + (-q.nx * Math.sin(yaw) + q.nz * Math.cos(yaw)) * sunXZ.y) * 0.3);
  const crownCol = yaws.map(yaw => { const a = new Float32Array(CN * 3); crown.forEach((q, i) => turnCol(q, yaw).toArray(a, i * 3)); return new THREE.InstancedBufferAttribute(a, 3); });
  const sketch = crown.filter(q => q.nx !== undefined).slice(0, PER);

  // far trees
  const cores = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0x17604e, toneMapped: false }), N);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.17, 1, 6), new THREE.MeshBasicMaterial({ color: 0x8a5a44, toneMapped: false }), N);
  const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), clumpMaterial(U), N * PER);
  let cx = 0, cz = 0, k = 0;
  for (let i = 0; i < N; i++) {
    if (i % 9 === 0) { const a = r() * 6.283, rad = 105 + Math.pow(r(), 1.3) * 230; cx = Math.cos(a) * rad; cz = Math.sin(a) * rad; }   // copses
    let x = cx + (r() - 0.5) * 30, z = cz + (r() - 0.5) * 30; const sc = 2.2 + r() * 2.6;
    if (valley(x, z) > 0.05) { x -= VALLEY.uz * 46; z += VALLEY.ux * 46; }   // moved up onto the side of it
    if (valley2(x, z) > 0.05) { x -= VALLEY2.uz * 44; z += VALLEY2.ux * 44; }
    { const bd = Math.hypot(x - BAY.x, z - BAY.z); if (bd < BAY.r + 8) { const k = (BAY.r + 10 + (bd % 9)) / Math.max(bd, 1); x = BAY.x + (x - BAY.x) * k; z = BAY.z + (z - BAY.z) * k; } }
    { const cd = Math.hypot(x - CASTLE.x, z - CASTLE.z); if (cd < CASTLE.flat + 6) { const k = (CASTLE.flat + 8 + (cd % 7)) / Math.max(cd, 1); x = CASTLE.x + (x - CASTLE.x) * k; z = CASTLE.z + (z - CASTLE.z) * k; } }   // and off the castle's hilltop
    const ground = hillHeight(x, z), M = sc * 0.42, tpl = i % T;
    const yaw = yaws[tpl], cy = Math.cos(yaw), sy = Math.sin(yaw);
    WOODS.push({ x, z, r: sc * 0.5, i, y: ground, m: M, tpl, slot: null, d: 0, want: false });
    d.rotation.set(0, 0, 0);
    d.position.set(x, ground + M * 1.4, z); d.scale.set(M * 2, M * 3.2, M * 2); d.updateMatrix(); trunks.setMatrixAt(i, d.matrix);
    d.position.set(x, ground + M * 3.95, z); d.scale.set(M * 2.5, M * 1.2, M * 2.3); d.updateMatrix(); cores.setMatrixAt(i, d.matrix);
    for (const q of sketch) {
      d.position.set(x + (q.x * cy + q.z * sy) * M, ground + q.y * M, z + (-q.x * sy + q.z * cy) * M);
      d.scale.setScalar(q.size * M * 2.7); d.updateMatrix(); leaves.setMatrixAt(k, d.matrix);
      leaves.setColorAt(k++, turnCol(q, yaw));
    }
  }
  cores.frustumCulled = trunks.frustumCulled = leaves.frustumCulled = false; leaves.userData.full = N * PER;
  group.add(trunks, cores, leaves); group.userData.leaves = leaves;
  const keep = { leaves: leaves.instanceMatrix.array.slice(), cores: cores.instanceMatrix.array.slice(), trunks: trunks.instanceMatrix.array.slice() };
  function showFar(w, on) {                                  // the sketch steps aside while the full tree stands in
    for (const [m, per] of [[leaves, PER], [cores, 1], [trunks, 1]]) {
      const a = m.instanceMatrix.array, o = w.i * per * 16, len = per * 16, src = keep[m === leaves ? 'leaves' : m === cores ? 'cores' : 'trunks'];
      if (on) a.set(src.subarray(o, o + len), o); else a.fill(0, o, o + len);
      m.instanceMatrix.addUpdateRange(o, len); m.instanceMatrix.needsUpdate = true;
    }
  }

  // full trees, moved to whichever hill trees are nearest
  const slots = [], plane = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < T * SLOTS; i++) {
    const g = new THREE.Group(), tpl = i % T; g.rotation.y = yaws[tpl]; g.visible = false;
    const trunk = new THREE.Mesh(model.children[0].geometry, trunkMat), limbs = new THREE.Mesh(model.children[1].geometry, trunkMat);
    trunk.castShadow = trunk.receiveShadow = limbs.castShadow = true;
    const lm = new THREE.InstancedMesh(plane, clumpMaterial(U), 1); lm.instanceMatrix = crownMat; lm.instanceColor = crownCol[tpl]; lm.count = CN;
    lm.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 4.3, 0), 4.8);
    g.add(trunk, limbs, lm); group.add(g); slots.push({ g, lm, tpl, tree: null });
  }
  const order = [], used = [0, 0, 0, 0];
  group.userData.lod = (px, pz, q) => {
    order.length = 0; used.fill(0);
    for (const w of WOODS) { w.d = Math.hypot(w.x - px, w.z - pz) - (w.slot ? 6 : 0); w.want = false; if (w.d < NEAR) order.push(w); }
    order.sort((a, b) => a.d - b.d);
    for (const w of order) if (used[w.tpl] < SLOTS) { used[w.tpl]++; w.want = true; }
    for (const sl of slots) if (sl.tree && !sl.tree.want) { showFar(sl.tree, true); sl.tree.slot = null; sl.tree = null; sl.g.visible = false; }
    for (const w of order) if (w.want && !w.slot) {
      const sl = slots.find(o => !o.tree && o.tpl === w.tpl); if (!sl) continue;
      sl.tree = w; w.slot = sl; sl.g.position.set(w.x, w.y, w.z); sl.g.scale.setScalar(w.m); sl.g.visible = true; showFar(w, false);
    }
    for (const sl of slots) if (sl.tree) sl.lm.count = Math.floor(CN * q * (1 - 0.45 * sstep(35, NEAR, sl.tree.d)));   // a little thinner further off
  };
  return group;
}

function sky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      sun: { value: new THREE.Vector3() }, sunAmt: { value: 1 },
      zenith: { value: new THREE.Color() }, mid: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() }, glow: { value: new THREE.Color() },
      uT: { value: 0 }, cloudCol: { value: new THREE.Color(0xffffff) }, shadeCol: { value: new THREE.Color(0x8fa8c8) }, cover: { value: 0.5 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 sun, zenith, mid, horizon, glow, cloudCol, shadeCol; uniform float sunAmt, uT, cover;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int k = 0; k < 4; k++) { s += a * vn(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; } return s; }
      void main(){ vec3 d = normalize(vDir); float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.2, h));
        c = mix(c, zenith, smoothstep(0.15, 0.75, h));
        float s = max(dot(d, sun), 0.0);
        c += sunAmt * glow * (pow(s, 8.0) * 0.25 + pow(s, 80.0) * 0.6);
        c += sunAmt * vec3(1.0, 0.97, 0.88) * smoothstep(0.9990, 0.9996, s) * 5.0;
        if (d.y > 0.0) {
          vec2 q = d.xz / (d.y + 0.2), w = vec2(uT * 0.011, uT * 0.004);          // the dome flattened out to a ceiling of cloud
          float big = fbm(q * 0.7 + w), fine = fbm(q * 3.1 + w * 1.8 + big * 1.6);
          float body = big * 0.86 + fine * 0.3;                                         // big heaps, their edges broken into billows
          float den = smoothstep(cover, cover + 0.075, body);
          vec2 sd = normalize(sun.xz + vec2(1e-4)) * 0.2;
          float toward = fbm((q + sd) * 0.7 + w) * 0.86 + fine * 0.3;                // thinner on the sun side means that side is lit
          float lit = clamp(0.5 + (body - toward) * 6.5 + (fine - 0.47) * 1.6 - (body - cover) * 1.4, 0.0, 1.0);   // bright sunward billows, grey thick middles and undersides
          vec3 cc = mix(shadeCol, cloudCol, lit);
          cc = mix(cc, cloudCol, smoothstep(0.0, 0.5, den) * (1.0 - smoothstep(0.5, 1.0, den)) * 0.35);   // thin edges glow
          cc += sunAmt * glow * pow(s, 5.0) * 0.3;
          float high = smoothstep(0.52, 0.8, fbm(vec2(q.x * 0.35 + uT * 0.02, q.y * 1.6))) * 0.3 * smoothstep(0.25, 0.6, d.y);   // thin streaks far above
          c = mix(c, vec3(1.0), high * (1.0 - den));
          c = mix(c, cc, den * smoothstep(0.02, 0.2, d.y));
        }
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

// Summer clouds are painted, not modelled. Each is a crisp-edged heap of round billows: a solid white
// silhouette first, then, inside it only, a blue-grey underside and a shadow tucked under every billow
// with its sunlit top repainted - so the cloud reads as piled volumes instead of a soft smudge.
function cloudTexture(r) {
  const W = 1024, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), base = H * 0.80, lobes = [];
  const mains = 5 + Math.floor(r() * 3), span = 0.5 + r() * 0.16, x0 = 0.5 - span / 2 + (r() - 0.5) * 0.06;
  for (let i = 0; i < mains; i++) {
    const t = i / (mains - 1), hill = Math.pow(Math.sin(t * Math.PI), 0.8);
    const rad = H * (0.11 + 0.13 * hill + r() * 0.04), x = W * (x0 + span * t), y = base - rad * 0.62 - hill * H * (0.12 + r() * 0.14);
    lobes.push([x, y, rad]);
    for (let k = 0, n = 2 + Math.floor(r() * 3); k < n; k++) {                                   // billows riding on each main one
      const a = -Math.PI * (0.12 + r() * 0.76), r2 = rad * (0.42 + r() * 0.3), x2 = x + Math.cos(a) * rad * 0.82, y2 = y + Math.sin(a) * rad * 0.82;
      lobes.push([x2, y2, r2]);
      if (r() < 0.6) { const a3 = -Math.PI * (0.1 + r() * 0.8); lobes.push([x2 + Math.cos(a3) * r2 * 0.85, y2 + Math.sin(a3) * r2 * 0.85, r2 * (0.4 + r() * 0.25)]); }
    }
  }
  for (let i = 0; i < 10; i++) lobes.push([W * (x0 + span * (0.06 + 0.88 * (i + 0.5) / 10)), base - H * 0.105, H * 0.12]);   // a solid row along the bottom, so no sky shows through
  g.fillStyle = '#fff';
  for (const [x, y, rad] of lobes) { g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill(); }             // the silhouette
  g.beginPath(); g.ellipse(W * (x0 + span / 2), base - H * 0.03, W * span * 0.56, H * 0.075, 0, 0, 7); g.fill();   // a level underside
  g.globalCompositeOperation = 'source-atop';                                                     // from here on, paint only inside it
  const under = g.createLinearGradient(0, base - H * 0.42, 0, base + H * 0.04);
  under.addColorStop(0, 'rgba(232,241,253,0)'); under.addColorStop(0.55, 'rgba(196,216,244,0.75)'); under.addColorStop(1, 'rgba(132,168,220,1)');
  g.fillStyle = under; g.fillRect(0, 0, W, H);
  lobes.sort((p, q) => q[2] - p[2]);
  for (const [x, y, rad] of lobes) {
    const sh = g.createRadialGradient(x + rad * 0.2, y + rad * 0.34, rad * 0.25, x + rad * 0.2, y + rad * 0.34, rad * 1.08);     // shadow under the billow
    sh.addColorStop(0, 'rgba(150,182,228,0.85)'); sh.addColorStop(0.7, 'rgba(168,196,236,0.6)'); sh.addColorStop(1, 'rgba(190,212,242,0)');
    g.fillStyle = sh; g.beginPath(); g.arc(x + rad * 0.2, y + rad * 0.34, rad * 1.08, 0, 7); g.fill();
    const hi = g.createRadialGradient(x - rad * 0.12, y - rad * 0.16, rad * 0.5, x - rad * 0.12, y - rad * 0.16, rad * 0.98);     // its sunlit crown
    hi.addColorStop(0, 'rgba(255,255,255,1)'); hi.addColorStop(0.72, 'rgba(255,255,255,0.96)'); hi.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hi; g.beginPath(); g.arc(x - rad * 0.12, y - rad * 0.16, rad * 0.98, 0, 7); g.fill();
  }
  g.globalCompositeOperation = 'destination-out';                                                 // feather only the very bottom edge
  const cutG = g.createLinearGradient(0, base + H * 0.005, 0, base + H * 0.05); cutG.addColorStop(0, 'rgba(0,0,0,0)'); cutG.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = cutG; g.fillRect(0, base, W, H);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
// Thin high streaks of cloud.
function wispTexture(r) {
  const W = 512, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  for (let i = 0; i < 9; i++) {
    const y = H * (0.25 + r() * 0.5), x = W * (0.1 + r() * 0.3), len = W * (0.35 + r() * 0.4), th = 3 + r() * 9;
    const gr = g.createLinearGradient(x, 0, x + len, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.strokeStyle = gr; g.lineWidth = th; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + len * 0.5, y - 14 + r() * 28, x + len, y - 10 + r() * 20); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function cumulus(r) {
  const group = new THREE.Group();
  const sprite = (map, opacity = 1) => new THREE.SpriteMaterial({ map, fog: false, depthWrite: false, transparent: true, toneMapped: false, opacity });
  const mats = Array.from({ length: 6 }, () => sprite(cloudTexture(r)));
  const N = 22;
  for (let i = 0; i < N; i++) {                             // big heaps standing behind the hills, smaller ones higher up
    const big = i % 2 === 0, a = i / N * Math.PI * 2 + r() * 0.22, rad = 430 + r() * 90, w = big ? 330 + r() * 170 : 150 + r() * 120;
    const sp = new THREE.Sprite(mats[i % mats.length]);
    sp.position.set(Math.cos(a) * rad, big ? 105 + r() * 60 : 210 + r() * 200, Math.sin(a) * rad);
    sp.scale.set(w * (r() < 0.5 ? 1 : -1), w * 0.5, 1);
    group.add(sp);
  }
  const wisps = [sprite(wispTexture(r), 0.8), sprite(wispTexture(r), 0.8)];
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2, rad = 300 + r() * 160, w = 260 + r() * 200, sp = new THREE.Sprite(wisps[i % 2]);
    sp.position.set(Math.cos(a) * rad, 300 + r() * 180, Math.sin(a) * rad); sp.scale.set(w, w * 0.25, 1);
    sp.material.rotation = 0; group.add(sp);
  }
  return group;
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

// Grass is drawn as squares of tufts that wrap around the player in the vertex shader, so the whole island
// looks covered while only nearby blades are drawn. Two layers: fine dense blades close up, and broader
// tufts out to the distance. Gusts roll across as travelling waves: every blade leans the same way by
// (gust strength x height squared), and its tip brightens as it bends.
// No ring between them: the fine layer loses its tufts one by one from 4 m out to 16 m, while the far layer
// gains its tufts one by one over the same stretch. Far blades are the same slim shape as near ones.
const GRASS_NEAR = { tile: 32, count: 122000, mode: 'near', range: [4, 16], spread: [1, 0.7], h: [0.5, 0.3, 0.32],
  blades: [[0.06, 1, 0.2, 0, 0, 2], [0.055, 0.8, 2.3, 0.05, 0.03, 1], [0.055, 0.9, 4.4, -0.04, 0.05, 1]] };
const GRASS_FAR = { tile: 66, count: 150000, mode: 'far', range: [4, 14], fadeOut: [26, 33], spread: [1, 0.7], h: [0.52, 0.3, 0.33],
  blades: [[0.07, 1, 0.2, 0, 0, 1], [0.065, 0.8, 2.3, 0.06, 0.04, 1], [0.065, 0.9, 4.4, -0.05, 0.06, 1]] };
function grassField(r, U, o) {
  const blade = (w, h, yaw, ox, oz, segs) => {
    const g = new THREE.PlaneGeometry(w, h, 1, segs); g.translate(0, h / 2, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) / h; p.setX(i, p.getX(i) * (1 - y * 0.92)); p.setZ(i, y * y * 0.12 * h); }
    g.rotateY(yaw); g.translate(ox, 0, oz); return g;
  };
  const parts = o.blades.map(b => blade(...b));
  const count = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const posA = new Float32Array(count * 3), norA = new Float32Array(count * 3), colA = new Float32Array(count * 3), idx = [];
  const base = new THREE.Color(0x157a2c), tip = new THREE.Color(0x9be24e), c = new THREE.Color();
  let k0 = 0;
  for (const g of parts) {
    const p = g.attributes.position;
    for (const i of g.index.array) idx.push(i + k0);
    for (let i = 0; i < p.count; i++, k0++) {
      posA.set([p.getX(i), p.getY(i), p.getZ(i)], k0 * 3); norA.set([0, 1, 0], k0 * 3);
      c.copy(base).lerp(tip, Math.pow(Math.min(1, Math.max(0, p.getY(i))), 1.4)); colA.set([c.r, c.g, c.b], k0 * 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posA, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(norA, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colA, 3));
  geo.setIndex(idx);

  const f = n => n.toFixed(2), T = f(o.tile), H = f(o.tile / 2);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.customProgramCacheKey = () => 'grass' + o.tile;     // the two layers compile different shaders
  mat.onBeforeCompile = s => {
    s.uniforms.uTime = U.time; s.uniforms.uWind = U.wind; s.uniforms.uCenter = U.center; s.uniforms.uSnow = U.snow;
    s.vertexShader = `uniform float uTime, uSnow, uWind; uniform vec2 uCenter; vec2 wrapOff; float bend, ground;\n` + HILL_GLSL + '\n' + s.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = instanceMatrix[3].xyz;
        vec2 wp = mod(ip.xz - uCenter + ${H}, ${T}) - ${H} + uCenter;
        wrapOff = wp - ip.xz;
        float dC = distance(wp, uCenter);
        float hsh = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
        float ramp = smoothstep(${f(o.range[0])}, ${f(o.range[1])}, dC);
        float keep = ${o.mode === 'near' ? 'clamp((1.0 - ramp - hsh) * 5.0, 0.0, 1.0)' : `clamp((ramp - hsh) * 5.0, 0.0, 1.0) * (1.0 - smoothstep(${f(o.fadeOut[0])}, ${f(o.fadeOut[1])}, dC))`} * step(length(wp), ${f(ROAM + 30)});
        ground = hillH(wp);
        keep *= smoothstep(${f(BAY.r - 1.5)}, ${f(BAY.r + 2.5)}, distance(wp, vec2(${f(BAY.x)}, ${f(BAY.z)})));
        keep *= 1.0 - step(abs(wp.x - ${f(CASTLE.x)}), 26.3) * step(abs(wp.y - ${f(CASTLE.z)}), 26.3);
        keep *= smoothstep(${f(PLAYGROUND.r - 1.2)}, ${f(PLAYGROUND.r + 0.8)}, distance(wp, vec2(${f(PLAYGROUND.x)}, ${f(PLAYGROUND.z)})));
        keep *= mix(1.0, step(fract(hsh * 7.31), 0.05), uSnow);                       // winter: only a few dry stalks show through the snow
        float gust = sin(wp.x * 0.21 + wp.y * 0.12 - uTime * 1.5 + sin(wp.y * 0.08 + uTime * 0.25) * 2.2) * 0.5 + 0.5;
        gust = gust * gust * (0.75 + 0.25 * sin(wp.x * 0.05 - wp.y * 0.07 + uTime * 0.4));
        float flutter = sin(uTime * 4.3 + wp.x * 2.1 - wp.y * 1.7) * 0.07;
        bend = (0.05 + (gust * 0.62 + flutter) * uWind) * mix(1.0, 1.5, uSnow);
        transformed.y *= mix(1.0, 0.5, uSnow);
        ${o.mode === 'far' ? 'transformed.xz *= mix(1.0, 1.7, smoothstep(18.0, 32.0, dC));' : ''}
        transformed *= keep;
        float patchTone = sin(wp.x * 0.31 + sin(wp.y * 0.23) * 1.7) * sin(wp.y * 0.27 - wp.x * 0.11);
        vColor.rgb *= vec3(1.0 + patchTone * 0.10, 1.0 + patchTone * 0.04, 1.0 - patchTone * 0.12);   // drifts of yellower and bluer green
        vColor.rgb *= 0.84 + gust * 0.55 * position.y;                  // the sheen that travels with each gust
        vColor.rgb = mix(vColor.rgb, vec3(0.86, 0.80, 0.62), uSnow);`)
      .replace('#include <project_vertex>', `vec4 mvPosition = instanceMatrix * vec4(transformed, 1.0);
        float lean = bend * mvPosition.y * mvPosition.y;
        mvPosition.xz += wrapOff + vec2(0.86, 0.5) * lean;
        mvPosition.y += ground - lean * lean * 0.25;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        #if defined( USE_SHADOWMAP )
          worldPosition.xz += wrapOff + vec2(0.86, 0.5) * bend * worldPosition.y * worldPosition.y;
          worldPosition.y += ground;
        #endif`);
    // winter stalks are flat dry straw, not shaded leaf
    s.fragmentShader = 'uniform float uSnow;\n' + s.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.62, 0.55, 0.36), uSnow * 0.9);`);
  };
  const m = new THREE.InstancedMesh(geo, mat, o.count), d = new THREE.Object3D(), tint = new THREE.Color();
  for (let k = 0; k < o.count; k++) {
    const x = r() * o.tile, z = r() * o.tile, patch = 0.5 + 0.5 * bump(x * 0.7, 0, z * 0.7), w = o.spread[0] + r() * o.spread[1];
    d.position.set(x, 0, z); d.rotation.set(0, r() * Math.PI * 2, 0);
    d.scale.set(w, o.h[0] + r() * o.h[1] + patch * o.h[2], w);
    d.updateMatrix(); m.setMatrixAt(k, d.matrix);
    tint.setHSL(0.28 + patch * 0.05 + r() * 0.04, 0.72 + r() * 0.1, 0.5 + r() * 0.14); m.setColorAt(k, tint);
  }
  m.receiveShadow = true; m.frustumCulled = false; m.userData.full = o.count;
  return m;
}

// A clump of small leaves, all pointing roughly outward from the middle. Drawn pale, with each leaf a slightly
// different lightness, so the per-clump tint sets the colour and the texture supplies the dabbed detail.
function clumpTexture(r) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), leaves = [];
  for (let i = 0; i < 54; i++) { const a = r() * 6.283, d = Math.sqrt(r()) * 80; leaves.push([a, d, 26 + r() * 16, 0.74 + r() * 0.26, (r() - 0.5) * 1.3]); }
  leaves.sort((p, q) => q[1] - p[1]);
  for (const [a, d, len, l, turn] of leaves) {
    const wid = len * 0.42;
    g.save(); g.translate(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d); g.rotate(a + Math.PI / 2 + turn);
    const gr = g.createLinearGradient(0, 0, 0, -len);
    gr.addColorStop(0, `rgb(${l * 176 | 0},${l * 200 | 0},${l * 170 | 0})`); gr.addColorStop(0.6, `rgb(${l * 240 | 0},${l * 255 | 0},${l * 226 | 0})`);
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0);
    g.bezierCurveTo(wid, -len * 0.25, wid * 0.9, -len * 0.75, 0, -len);
    g.bezierCurveTo(-wid * 0.9, -len * 0.75, -wid, -len * 0.25, 0, 0); g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// Foliage: each crown is a cloud of leaf clumps that always face the camera, filling the whole volume of
// its lobes so no underlying shape shows. Colour is painted, not lit: every clump takes one of five flat
// tones from how far up its lobe it sits and how much it faces the sun - yellow on top of each lobe,
// green on the sides, deep teal in the pockets between lobes and underneath.
let clumpMat = null;
function clumpMaterial(U) {
  if (clumpMat) return clumpMat;
  const mat = clumpMat = new THREE.MeshBasicMaterial({ map: clumpTexture(rng(9)), alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false });
  mat.customProgramCacheKey = () => 'leafclumps';
  mat.onBeforeCompile = s => {
    s.uniforms.uTime = U.time; s.uniforms.uWind = U.wind;
    s.vertexShader = 'uniform float uTime, uWind;\n' + s.vertexShader.replace('#include <project_vertex>', `
      vec3 lc = instanceMatrix[3].xyz; float lsz = length(instanceMatrix[0].xyz) * length(modelMatrix[0].xyz);
      float lh = fract(sin(dot(lc.xz, vec2(12.9898, 78.233)) + lc.y * 3.1) * 43758.5453);
      vec4 wc = modelMatrix * vec4(lc, 1.0);
      float la = lh * 6.2832 + sin(uTime * 1.4 + wc.x * 0.7 + wc.z * 0.5) * (0.04 + 0.13 * uWind);
      vec2 lq = vec2(position.x * cos(la) - position.y * sin(la), position.x * sin(la) + position.y * cos(la)) * lsz;
      wc.x += sin(uTime * 1.1 + wc.z * 0.4 + wc.y) * (0.012 + 0.05 * uWind) * lsz;
      vec4 mvPosition = viewMatrix * wc;
      mvPosition.xy += lq;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  return mat;
}
function leafCloud(r, U, trees) {
  const mat = clumpMaterial(U);
  const PER = 215, UNDER = 45, BASE_Y = 2.75, total = trees.reduce((n, t) => n + t.userData.puffs.length * (PER + UNDER), 0);
  const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, total), d = new THREE.Object3D(), c = new THREE.Color();
  const n = new THREE.Vector3(), p = new THREE.Vector3(), sunXZ = new THREE.Vector2(SUN_DIR.x, SUN_DIR.z).normalize();
  let k = 0;
  for (const t of trees) {
    t.updateMatrixWorld(true);
    const sc = t.scale.x, cy = Math.cos(t.rotation.y), sy = Math.sin(t.rotation.y);
    for (const [x, y, z, s] of t.userData.puffs) for (let i = 0; i < UNDER; i++, k++) {   // a shaded layer closing off the underside
      const a = r() * 6.283, rr = Math.sqrt(r()) * s * 0.95;
      p.set(x + Math.cos(a) * rr, Math.max(BASE_Y, y - s * 0.5) + r() * 0.35, z + Math.sin(a) * rr).applyMatrix4(t.matrixWorld);
      d.position.copy(p); d.scale.setScalar(sc * s * (0.6 + r() * 0.35)); d.updateMatrix(); m.setMatrixAt(k, d.matrix);
      c.copy(TONES[0]).lerp(TONES[1], r() * 0.8); m.setColorAt(k, c);
    }
    for (const [x, y, z, s] of t.userData.puffs) for (let i = 0; i < PER; i++, k++) {
      let ly = 0, rad = 1;
      for (let tries = 0; tries < 12; tries++) {             // nothing below the flat underside of the crown
        const cu = r() * 1.7 - 0.7, a = r() * 6.283, q = Math.sqrt(1 - cu * cu);
        n.set(Math.cos(a) * q, cu, Math.sin(a) * q); rad = 0.55 + r() * 0.52; ly = y + n.y * s * 0.84 * rad;
        if (ly > BASE_Y) break;
      }
      p.set(x + n.x * s * rad, Math.max(BASE_Y, ly), z + n.z * s * rad).applyMatrix4(t.matrixWorld);
      d.position.copy(p); d.scale.setScalar(sc * s * (0.62 + r() * 0.4)); d.updateMatrix(); m.setMatrixAt(k, d.matrix);
      const wx = n.x * cy + n.z * sy, wz = -n.x * sy + n.z * cy;                                   // lobe normal turned with the tree
      const tone = n.y * 0.62 + (wx * sunXZ.x + wz * sunXZ.y) * 0.3 + (ly - 3.9) * 0.17 + (rad - 0.85) * 0.5 + (r() - 0.5) * 0.3 + 0.46;
      const f = THREE.MathUtils.clamp(tone, 0, 0.999) * (TONES.length - 1), i0 = Math.floor(f);
      c.copy(TONES[i0]).lerp(TONES[i0 + 1], Math.min(1, (f - i0) * 1.6));                           // mostly flat bands, soft at the joins
      m.setColorAt(k, c);
    }
  }
  m.frustumCulled = false; m.userData.full = total;
  return m;
}

// Bark: furrows running up the trunk, used both as colour and as surface relief.
function barkTexture(r) {
  const W = 256, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); g.fillStyle = '#b9a48e'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 150; i++) {
    const x = r() * W, dark = r() < 0.6;
    g.strokeStyle = dark ? 'rgba(40,24,14,0.5)' : 'rgba(238,222,196,0.4)'; g.lineWidth = dark ? 2 + r() * 5 : 1 + r() * 3;
    let y = r() * H, px = x; const len = 60 + r() * 220;
    for (const ox of [0, W, -W]) {
      g.beginPath(); g.moveTo(px + ox, y); let yy = y, xx = px;
      for (let k = 0; k < 6; k++) { yy += len / 6; xx += (r() - 0.5) * 12; g.lineTo(xx + ox, yy); }
      g.stroke();
    }
  }
  for (let i = 0; i < 9; i++) {                                                                    // knots
    const x = r() * W, y = r() * H, rad = 6 + r() * 9;
    g.strokeStyle = 'rgba(40,24,14,0.6)'; g.lineWidth = 2.5; g.beginPath(); g.ellipse(x, y, rad, rad * 1.5, 0, 0, 7); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

// The same travelling gust the grass uses, so a flower leans with the blades around it.
const GUST_GLSL = `float gustAt(vec2 wp, float t) {
    float g = sin(wp.x * 0.21 + wp.y * 0.12 - t * 1.5 + sin(wp.y * 0.08 + t * 0.25) * 2.2) * 0.5 + 0.5;
    g = g * g * (0.75 + 0.25 * sin(wp.x * 0.05 - wp.y * 0.07 + t * 0.4));
    return 0.1 + g * 0.62 + sin(t * 4.3 + wp.x * 2.1 - wp.y * 1.7) * 0.07;
  }`;
function swayWithGrass(mat, U) {
  mat.customProgramCacheKey = () => 'flower-sway';
  mat.onBeforeCompile = s => {
    s.uniforms.uTime = U.time; s.uniforms.uWind = U.wind;
    s.vertexShader = 'uniform float uTime, uWind;\n' + GUST_GLSL + '\n' + s.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = instanceMatrix * vec4(transformed, 1.0);
      vec3 fo = instanceMatrix[3].xyz;
      vec3 off = mvPosition.xyz - fo;
      float hh = max(0.0, fo.y + min(off.y, 0.0));                      // how high this point stands: a stem bends from its foot
      float fb = gustAt(fo.xz, uTime) * (0.15 + 0.85 * uWind), lean = fb * hh * hh;
      mvPosition.xz += vec2(0.86, 0.5) * lean;
      mvPosition.y -= lean * lean * 0.25 + dot(off.xz, vec2(0.86, 0.5)) * fb * 0.9;      // the head tips over as it leans
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  return mat;
}
// Meadow flowers, each a real flower on its own stem: daisies with two rings of narrow petals round a domed golden
// eye, and cupped five-petalled blooms (poppy, buttercup, cornflower by colour) with a dark heart ringed by stamens.
// Petals are shaded along their length and curl at the edges, so a head reads as petals and not as a flat shape.
function flowerHead(rings) {
  const pos = [], col = [], idx = [];
  for (const R of rings) for (let p = 0; p < R.n; p++) {
    const a = p / R.n * 6.283 + R.rot, ca = Math.cos(a), sa = Math.sin(a), S = 4, base = pos.length / 3, jit = 0.88 + 0.24 * ((p * 7) % 5) / 5;
    for (let k = 0; k <= S; k++) {
      const t = k / S, x = R.r0 + R.len * jit * t, hw = R.wid / 2 * Math.pow(Math.sin(Math.min(1, t * 0.9 + 0.1) * Math.PI), 0.6) * (1 - 0.12 * t), y = R.lift * Math.sin(t * 1.9) - R.droop * t * t;
      for (const sd of [-1, 1]) {
        const z = sd * hw; pos.push(x * ca - z * sa, y + R.cup * hw * 1.2, x * sa + z * ca);
        const c = R.shade0 + (R.shade1 - R.shade0) * Math.pow(t, 0.7) - (sd > 0 ? 0.04 : 0); col.push(c, c, c);
      }
      if (k < S) { const q = base + k * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function tinted(geo, fn) {                                   // give a plain shape vertex colours from a function of its position
  const p = geo.attributes.position, col = []; for (let k = 0; k < p.count; k++) col.push(...fn(p.getX(k), p.getY(k), p.getZ(k)));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); return geo;
}
function flowers(r, U) {
  const g = new THREE.Group(), N = 2600, mat = () => swayWithGrass(new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide }), U);
  const daisy = flowerHead([{ n: 15, len: 0.105, wid: 0.036, r0: 0.02, lift: 0.012, droop: 0.032, rot: 0, shade0: 0.8, shade1: 1, cup: 0.25 },
    { n: 10, len: 0.078, wid: 0.03, r0: 0.016, lift: 0.03, droop: 0.01, rot: 0.3, shade0: 0.86, shade1: 1, cup: 0.3 }]);
  const cup = flowerHead([{ n: 5, len: 0.1, wid: 0.118, r0: 0.008, lift: 0.07, droop: -0.012, rot: 0, shade0: 0.48, shade1: 1, cup: 0.5 },
    { n: 4, len: 0.074, wid: 0.09, r0: 0.006, lift: 0.086, droop: -0.02, rot: 0.6, shade0: 0.55, shade1: 0.96, cup: 0.6 }]);
  const eye = tinted(new THREE.SphereGeometry(0.031, 10, 6).scale(1, 0.6, 1).translate(0, 0.014, 0), (x, y) => { const k = 0.75 + y * 9 + 0.12 * Math.sin(x * 400); return [1.0 * k, 0.78 * k, 0.16 * k]; });
  const heartParts = [tinted(new THREE.SphereGeometry(0.017, 8, 6).translate(0, 0.02, 0), () => [0.16, 0.1, 0.14])];
  for (let k = 0; k < 9; k++) { const a = k * 0.698; heartParts.push(tinted(new THREE.SphereGeometry(0.0065, 5, 4).translate(Math.cos(a) * 0.03, 0.036, Math.sin(a) * 0.03), () => [1.0, 0.86, 0.3])); }
  const heart = mergeGeometries(heartParts);
  const stem = (() => { const c = new THREE.CylinderGeometry(0.006, 0.011, 1.06, 5, 5); c.translate(0, -0.53, 0); const p = c.attributes.position; for (let k = 0; k < p.count; k++) { const t = -p.getY(k) / 1.06; p.setX(k, p.getX(k) + Math.sin(t * Math.PI) * 0.035); } c.computeVertexNormals(); return tinted(c, (x, y) => { const k = 0.7 + 0.3 * (1 + y); return [0.3 * k, 0.56 * k, 0.2 * k]; }); })();
  const ND = Math.round(N * 0.56), NC = N - ND;
  const kinds = [{ n: ND, petals: new THREE.InstancedMesh(daisy, mat(), ND), mid: new THREE.InstancedMesh(eye, mat(), ND), hues: [0xffffff, 0xfff6ee, 0xffd9e8, 0xe7d6ff], size: [0.95, 0.5], k: 0 },
    { n: NC, petals: new THREE.InstancedMesh(cup, mat(), NC), mid: new THREE.InstancedMesh(heart, mat(), NC), hues: [0xf0503c, 0xffd23a, 0xff8a3a, 0x6f8fe6, 0xf2a0c4], size: [0.85, 0.45], k: 0 }];
  const stems = new THREE.InstancedMesh(stem, mat(), N);
  const d = new THREE.Object3D(), c = new THREE.Color();
  let cx = 0, cz = 0, hue = 0, kind = kinds[0];
  for (let i = 0; i < N; i++) {
    if (i % 26 === 0) {                                      // they grow in drifts of one kind and mostly one colour
      const a = r() * 6.283, rad = Math.sqrt(r()) * (R - 3); cx = Math.cos(a) * rad; cz = Math.sin(a) * rad;
      kind = kinds[0].k >= kinds[0].n ? kinds[1] : kinds[1].k >= kinds[1].n ? kinds[0] : r() < 0.56 ? kinds[0] : kinds[1]; hue = Math.floor(r() * kind.hues.length);
    }
    if (kind.k >= kind.n) kind = kinds[0].k < kinds[0].n ? kinds[0] : kinds[1];
    const a = r() * 6.283, rad = Math.sqrt(r()) * 3.6, sc = kind.size[0] + r() * kind.size[1];
    d.position.set(cx + Math.cos(a) * rad, 0.78 + r() * 0.32, cz + Math.sin(a) * rad);
    d.rotation.set((r() - 0.5) * 0.6, r() * 6, (r() - 0.5) * 0.6); d.scale.setScalar(sc); d.updateMatrix();
    kind.petals.setMatrixAt(kind.k, d.matrix); kind.mid.setMatrixAt(kind.k, d.matrix); stems.setMatrixAt(i, d.matrix);
    c.set(r() < 0.78 ? kind.hues[hue % kind.hues.length] : kind.hues[Math.floor(r() * kind.hues.length)]); c.offsetHSL((r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.06); kind.petals.setColorAt(kind.k, c);
    kind.k++;
  }
  for (const m of [kinds[0].petals, kinds[0].mid, kinds[1].petals, kinds[1].mid, stems]) { m.frustumCulled = false; g.add(m); }
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
const leafMat = new THREE.MeshBasicMaterial({ color: 0x17604e, toneMapped: false });   // the shaded inside of the crown
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
  const uv = tg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i) * 1.6);
  const trunk = new THREE.Mesh(tg, trunkMat); trunk.castShadow = trunk.receiveShadow = true; g.add(trunk);

  const leaves = new THREE.Group(), pal = LEAF[Math.floor(r() * LEAF.length)];
  // a broad, slightly flattened crown
  const puffs = [[0, 3.7, 0, 1.45], [-1.5, 3.3, 0.3, 1.1], [1.5, 3.4, -0.2, 1.15], [0.2, 4.7, 0.2, 1.05], [-0.5, 3.5, -1.5, 1.05], [0.6, 3.2, 1.5, 1.0],
    [-1.2, 4.3, 0.9, 0.9], [1.3, 4.4, 0.7, 0.88], [0.1, 4.2, -1.3, 0.9], [-2.3, 3.4, -0.6, 0.8], [2.3, 3.5, 0.7, 0.78], [0, 5.3, -0.1, 0.75],
    [-1.4, 3.1, -1.6, 0.75], [1.6, 3.0, -1.5, 0.75]];
  // limbs forking from the top of the trunk into the crown
  const limbs = [], ends = [], up = new THREE.Vector3(0, 1, 0), from = new THREE.Vector3(0.14, 2.7, 0), q = new THREE.Quaternion();
  for (const i of [1, 2, 4, 5, 3]) {
    const to = new THREE.Vector3(puffs[i][0], puffs[i][1] - 0.1, puffs[i][2]), dir = to.clone().sub(from), len = dir.length() * 0.85;
    const lg = new THREE.CylinderGeometry(0.05, 0.15, len, 8, 1, true);
    lg.applyQuaternion(q.setFromUnitVectors(up, dir.normalize())); lg.translate(from.x + dir.x * len / 2, from.y + dir.y * len / 2, from.z + dir.z * len / 2);
    limbs.push(lg); ends.push([from.clone(), from.clone().addScaledVector(dir, len)]);
  }
  const limbMesh = new THREE.Mesh(mergeGeometries(limbs), trunkMat); limbMesh.castShadow = true; g.add(limbMesh);
  for (const [x, y, z, s] of puffs) {
    const b = new THREE.Mesh(blobGeo(r, s * 0.56, s * 0.44, s * 0.56, 0.12), leafMat);
    b.position.set(x, Math.max(y, 2.95 + s * 0.5), z);       // never pokes out below the leaves b.castShadow = true; leaves.add(b);
  }
  const bare = new THREE.Mesh(bareGeo, twigMat); bare.castShadow = true; bare.visible = false;
  g.add(leaves, bare);
  g.userData = { leaves, bare, puffs, limbs: ends };
  return g;
}

// Snowflakes in a box that wraps around the camera, falling and blown sideways.
function specks(r, U, { N, fall, wind, size, tint, alpha }) {
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos.set([r() * SNOW_BOX, r() * SNOW_BOX, r() * SNOW_BOX], i * 3); seed[i] = r(); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const B = SNOW_BOX.toFixed(1), HB = (SNOW_BOX / 2).toFixed(1);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: U.time, uCam: { value: new THREE.Vector3() }, uSize: { value: 1 }, uTint: { value: new THREE.Color(tint) } },
    vertexShader: `attribute float seed; uniform float uTime, uSize; uniform vec3 uCam; varying float vA;
      void main(){ vec3 p = position;
        p.y -= uTime * (${fall.toFixed(2)} * (1.0 + seed * 0.9)) - sin(uTime * 0.7 + seed * 20.0) * ${(fall < 1 ? 0.8 : 0).toFixed(1)};
        p.x += uTime * (${wind.toFixed(2)} * (1.0 + seed * 0.6)) + sin(uTime * 1.3 + seed * 40.0) * 0.9;
        p.z += uTime * ${(wind * 0.32).toFixed(2)} + cos(uTime * 1.1 + seed * 31.0) * 0.9;
        p = mod(p - uCam + ${HB}, ${B}) - ${HB} + uCam;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * (0.55 + seed * 0.9) * ${size.toFixed(1)} / max(1.5, -mv.z);
        vA = (1.0 - smoothstep(${(SNOW_BOX * 0.3).toFixed(1)}, ${HB}, -mv.z)) * (0.55 + seed * 0.45) * ${alpha.toFixed(2)};
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; uniform vec3 uTint; void main(){ float d = length(gl_PointCoord - 0.5);
      gl_FragColor = vec4(uTint, vA * (1.0 - smoothstep(0.15, 0.5, d))); }`,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.visible = false;
  return pts;
}

export function buildScenery(scene) {
  const r = rng(20261117);
  const bark = barkTexture(rng(5)); bark.repeat.set(3, 1);
  trunkMat.map = bark; trunkMat.bumpMap = bark; trunkMat.bumpScale = 2.5; trunkMat.needsUpdate = true;
  const U = { time: { value: 0 }, wind: { value: 1 }, center: { value: new THREE.Vector2(START.x, START.z) }, snow: { value: 0 } };
  let lastT = 0;
  const skyMesh = sky(); scene.add(skyMesh);
  const sea = cloudSea(r); scene.add(sea.group);
  const heaps = cumulus(r); scene.add(heaps);

  scene.add(islandMesh(R, 24, 1.3, 120));
  const ground = meadow(r); scene.add(ground.mesh);
  const grassNear = grassField(r, U, GRASS_NEAR), grassFar = grassField(r, U, GRASS_FAR); scene.add(grassNear, grassFar);
  const blooms = flowers(r, U); scene.add(blooms);

  const bareGeos = [branchGeo(r), branchGeo(r), branchGeo(r)], trees = [];
  TREES.forEach((t, i) => {
    const m = tree(r, bareGeos[i % bareGeos.length]); m.position.set(t.x, 0, t.z); m.scale.setScalar(t.s * 1.5); m.rotation.y = r() * 6;
    scene.add(m); trees.push(m);
  });
  const foliage = leafCloud(r, U, trees); scene.add(foliage);
  const LEAVES_PER = foliage.userData.full / trees.length;   // leaves are laid down tree by tree, so the last trees can simply go without
  foliage.userData.full = Math.round(LEAVES_PER * (trees.length - 4)); foliage.count = foliage.userData.full;
  const land = hills(); scene.add(land);
  scene.add(cove(), seaWater(U));
  const woods = hillWoods(r, U, bareGeos[0]); scene.add(woods);
  let detailQ = 1, lodT = -1;
  for (let i = 0; i < 46; i++) {                             // rounded boulders, a few big ones
    const a = r() * 6.283, rad = Math.sqrt(r()) * (R - 1.5), s = (i < 6 ? 0.9 : 0.25) + r() * 0.5;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (Math.hypot(x - START.x, z - START.z) < 4) continue;
    const b = new THREE.Mesh(blobGeo(r, s * 1.2, s * 0.75, s, 0.2), rockMat); b.castShadow = b.receiveShadow = true;
    b.position.set(x, s * 0.3, z); b.rotation.y = r() * 6; scene.add(b);
  }

  const flakes = specks(r, U, { N: 5200, fall: 2.4, wind: 5.5, size: 95, tint: 0xffffff, alpha: 1 }); scene.add(flakes);
  const seeds = specks(r, U, { N: 700, fall: 0.12, wind: 1.6, size: 34, tint: 0xfffbd0, alpha: 0.85 }); scene.add(seeds);

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
    land.material.vertexColors = !S.snow; land.material.color.set(S.snow ? 0xf0f4f9 : 0xffffff); land.material.needsUpdate = true;
    woods.visible = !S.snow;
    U.snow.value = S.snow;
    heaps.visible = false; blooms.visible = foliage.visible = seeds.visible = !S.snow; flakes.visible = !!S.snow;
    u.cloudCol.value.set(S.cloud[0]); u.shadeCol.value.set(S.cloud[1]); u.cover.value = S.snow ? 0.4 : 0.565;
    for (const t of trees) { t.userData.leaves.visible = !S.snow; t.userData.bare.visible = !!S.snow; }
  }
  setSeason('summer');

  return {
    setSeason,
    // 0.3 .. 1: draw that fraction of the grass and leaves (instances are in random order, so it thins evenly)
    setDetail(q) { detailQ = q; lodT = -1; for (const m of [grassNear, grassFar, foliage, woods.userData.leaves]) m.count = Math.floor(m.userData.full * q); },
    get season() { return season; },
    // leaf clumps at the given points ({x,y,z,s} in the world), in the trees' own greens; they flutter with the trees
    ivy(points, seed = 77) {
      const rr = rng(seed), m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), clumpMaterial(U), points.length), d = new THREE.Object3D(), c = new THREE.Color();
      points.forEach((p, i) => { d.position.set(p.x, p.y, p.z); d.scale.setScalar(p.s); d.updateMatrix(); m.setMatrixAt(i, d.matrix); c.copy(TONES[0]).lerp(TONES[1 + Math.floor(rr() * 3)], 0.35 + rr() * 0.6 * (p.lit ?? 0.7)); m.setColorAt(i, c); });
      m.frustumCulled = false; scene.add(m); return m;
    },
    get wind() { return U.wind.value; }, get windTime() { return U.time.value; },
    // a tree is bare when (nearly) none of its leaves are being drawn
    isBare(i) { return season !== 'summer' || (foliage.count - i * LEAVES_PER) / LEAVES_PER < 0.35; },
    // the limbs of tree i as world-space segments, each with the radius of the limb along it
    limbs(i) {
      const t = trees[i]; t.updateMatrixWorld(true);
      return t.userData.limbs.map(([a, b]) => ({ a: a.clone().applyMatrix4(t.matrixWorld), b: b.clone().applyMatrix4(t.matrixWorld), r0: 0.15 * t.scale.x, r1: 0.05 * t.scale.x }));
    },
    update(t, px, pz, camera, pixelRatio = 1, py = 0) {
      // the wind: a slow swell between near calm and a stiff breeze, with shorter gusts riding on it
      const swell = 0.5 + 0.5 * Math.sin(t * 0.085 + 1.4 * Math.sin(t * 0.027)), puff = Math.max(0, Math.sin(t * 0.37 + 2.0 * Math.sin(t * 0.11))) ** 3;
      U.wind.value = Math.min(1.9, 0.12 + 1.15 * swell * swell + 0.65 * puff * (0.3 + swell));
      U.time.value += Math.min(0.1, Math.max(0, t - lastT)) * (0.3 + 0.75 * U.wind.value); lastT = t;
      skyMesh.material.uniforms.uT.value = U.time.value;
      U.center.value.set(px, pz);
      if (woods.visible && Math.abs(t - lodT) > 0.2) { lodT = t; woods.userData.lod(px, pz, detailQ); } sea.group.rotation.y = t * 0.003; heaps.rotation.y = t * 0.0016;
      sun.target.position.set(px, py, pz); sun.position.set(px + SUN_DIR.x * 60, py + SUN_DIR.y * 60, pz + SUN_DIR.z * 60);
      for (const f of [flakes, seeds]) if (f.visible) { f.material.uniforms.uCam.value.copy(camera.position); f.material.uniforms.uSize.value = pixelRatio; }
    },
  };
}
