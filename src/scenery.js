// Everything the player doesn't knock over: sky, clouds, the island, grass, flowers, rocks, trees, snow.
// Two seasons share one scene: a bright windy summer meadow, and a winter snowstorm.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const R = 38;                                     // island radius
export const START = { x: 0, z: 25 };                    // where the player begins, facing the centre
export const SUN_DIR = new THREE.Vector3(-0.35, 0.62, -0.7).normalize();
const SNOW_BOX = 44;

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

// Summer clouds are painted, not modelled: each is a heap of soft puffs drawn on a canvas, blue-grey in the
// body and white where the sun catches the tops, with a flat base. The paintings sit on camera-facing cards.
function cloudTexture(r) {
  const W = 512, H = 288, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), puffs = [], n = 20 + Math.floor(r() * 10);
  for (let i = 0; i < n; i++) {
    const t = r(), hill = Math.sin(t * Math.PI), rad = 26 + r() * 30 + hill * 26;
    puffs.push([W * (0.13 + 0.74 * t), H * 0.80 - rad * 0.5 - hill * r() * H * 0.36, rad]);
  }
  for (let i = 0; i < 7; i++) puffs.push([W * (0.2 + 0.6 * r()), H * 0.74, 44 + r() * 26]);       // fill the base
  const pass = (dx, dy, k, rgb, solid) => {
    for (const [x, y, rad] of puffs) {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad * k);
      gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(solid, `rgba(${rgb},1)`); gr.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(x + dx, y + dy, rad * k, 0, 7); g.fill();
    }
  };
  pass(0, 6, 1.0, '150,180,226', 0.84);        // shaded body
  pass(-3, -2, 0.93, '204,222,246', 0.74);      // mid tone
  pass(-7, -9, 0.8, '255,255,255', 0.66);       // sunlit tops
  g.globalCompositeOperation = 'destination-out';                                                 // soft flat underside
  const cutG = g.createLinearGradient(0, H * 0.74, 0, H * 0.9); cutG.addColorStop(0, 'rgba(0,0,0,0)'); cutG.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = cutG; g.fillRect(0, H * 0.74, W, H * 0.26);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function cumulus(r) {
  const group = new THREE.Group();
  const mats = Array.from({ length: 5 }, () => new THREE.SpriteMaterial({ map: cloudTexture(r), fog: false, depthWrite: false, transparent: true, toneMapped: false }));
  const N = 26;
  for (let i = 0; i < N; i++) {
    const low = i % 4 === 0, a = i / N * Math.PI * 2 + r() * 0.2, rad = 400 + r() * 110, w = low ? 200 + r() * 110 : 110 + r() * 130;
    const sp = new THREE.Sprite(mats[i % mats.length]);
    sp.position.set(Math.cos(a) * rad, low ? 45 + r() * 40 : 110 + r() * 200, Math.sin(a) * rad);
    sp.scale.set(w * (r() < 0.5 ? 1 : -1), w * 288 / 512, 1);
    group.add(sp);
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
    s.uniforms.uTime = U.time; s.uniforms.uCenter = U.center; s.uniforms.uSnow = U.snow;
    s.vertexShader = `uniform float uTime, uSnow; uniform vec2 uCenter; vec2 wrapOff; float bend;\n` + s.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = instanceMatrix[3].xyz;
        vec2 wp = mod(ip.xz - uCenter + ${H}, ${T}) - ${H} + uCenter;
        wrapOff = wp - ip.xz;
        float dC = distance(wp, uCenter);
        float hsh = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
        float ramp = smoothstep(${f(o.range[0])}, ${f(o.range[1])}, dC);
        float keep = ${o.mode === 'near' ? 'clamp((1.0 - ramp - hsh) * 5.0, 0.0, 1.0)' : `clamp((ramp - hsh) * 5.0, 0.0, 1.0) * (1.0 - smoothstep(${f(o.fadeOut[0])}, ${f(o.fadeOut[1])}, dC))`} * step(length(wp), ${f(R * 0.985)});
        keep *= mix(1.0, step(fract(hsh * 7.31), 0.05), uSnow);                       // winter: only a few dry stalks show through the snow
        float gust = sin(wp.x * 0.21 + wp.y * 0.12 - uTime * 1.5 + sin(wp.y * 0.08 + uTime * 0.25) * 2.2) * 0.5 + 0.5;
        gust = gust * gust * (0.75 + 0.25 * sin(wp.x * 0.05 - wp.y * 0.07 + uTime * 0.4));
        float flutter = sin(uTime * 4.3 + wp.x * 2.1 - wp.y * 1.7) * 0.07;
        bend = (0.1 + gust * 0.62 + flutter) * mix(1.0, 1.5, uSnow);
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
const TONES = [0x17604e, 0x2a8a48, 0x58b93c, 0xa8dc48, 0xf0ee62].map(c => new THREE.Color(c));
function leafCloud(r, U, trees) {
  const mat = new THREE.MeshBasicMaterial({ map: clumpTexture(rng(9)), alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false });
  mat.customProgramCacheKey = () => 'leafclumps';
  mat.onBeforeCompile = s => {
    s.uniforms.uTime = U.time;
    s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <project_vertex>', `
      vec3 lc = instanceMatrix[3].xyz; float lsz = length(instanceMatrix[0].xyz);
      float lh = fract(sin(dot(lc.xz, vec2(12.9898, 78.233)) + lc.y * 3.1) * 43758.5453);
      float la = lh * 6.2832 + sin(uTime * 1.4 + lc.x * 0.7 + lc.z * 0.5) * 0.14;
      vec2 lq = vec2(position.x * cos(la) - position.y * sin(la), position.x * sin(la) + position.y * cos(la)) * lsz;
      lc.x += sin(uTime * 1.1 + lc.z * 0.4 + lc.y) * 0.05 * lsz;
      vec4 mvPosition = viewMatrix * vec4(lc, 1.0);
      mvPosition.xy += lq;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  const PER = 135, BASE_Y = 2.75, total = trees.reduce((n, t) => n + t.userData.puffs.length * PER, 0);
  const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, total), d = new THREE.Object3D(), c = new THREE.Color();
  const n = new THREE.Vector3(), p = new THREE.Vector3(), sunXZ = new THREE.Vector2(SUN_DIR.x, SUN_DIR.z).normalize();
  let k = 0;
  for (const t of trees) {
    t.updateMatrixWorld(true);
    const sc = t.scale.x, cy = Math.cos(t.rotation.y), sy = Math.sin(t.rotation.y);
    for (const [x, y, z, s] of t.userData.puffs) for (let i = 0; i < PER; i++, k++) {
      let ly = 0, rad = 1;
      for (let tries = 0; tries < 12; tries++) {             // nothing below the flat underside of the crown
        const cu = r() * 1.7 - 0.7, a = r() * 6.283, q = Math.sqrt(1 - cu * cu);
        n.set(Math.cos(a) * q, cu, Math.sin(a) * q); rad = 0.7 + r() * 0.36; ly = y + n.y * s * 0.84 * rad;
        if (ly > BASE_Y) break;
      }
      p.set(x + n.x * s * rad, Math.max(BASE_Y, ly), z + n.z * s * rad).applyMatrix4(t.matrixWorld);
      d.position.copy(p); d.scale.setScalar(sc * s * (0.62 + r() * 0.4)); d.updateMatrix(); m.setMatrixAt(k, d.matrix);
      const wx = n.x * cy + n.z * sy, wz = -n.x * sy + n.z * cy;                                   // lobe normal turned with the tree
      const tone = n.y * 0.62 + (wx * sunXZ.x + wz * sunXZ.y) * 0.3 + (ly - 3.9) * 0.17 + (rad - 0.9) * 0.5 + (r() - 0.5) * 0.3 + 0.46;
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

function flowers(r) {
  const g = new THREE.Group(), N = 2600;
  // five-petal star: a flat disc with every other rim vertex pulled in
  const petal = new THREE.CircleGeometry(0.13, 10), pp = petal.attributes.position;
  for (let i = 1; i < pp.count; i++) if (i % 2 === 0) pp.setXYZ(i, pp.getX(i) * 0.42, pp.getY(i) * 0.42, 0);
  petal.rotateX(-Math.PI / 2);
  const heart = new THREE.SphereGeometry(0.026, 8, 6);
  const pm = new THREE.InstancedMesh(petal, new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), N);
  const hm = new THREE.InstancedMesh(heart, new THREE.MeshLambertMaterial({ color: 0xffd23e }), N);
  const d = new THREE.Object3D(), c = new THREE.Color(), hues = [0xff7fb0, 0xc58cff, 0xffe45a, 0xffffff, 0xff9a5a, 0x8fb8ff];
  let cx = 0, cz = 0, hue = 0;
  for (let i = 0; i < N; i++) {
    if (i % 26 === 0) { const a = r() * 6.283, rad = Math.sqrt(r()) * (R - 3); cx = Math.cos(a) * rad; cz = Math.sin(a) * rad; hue = Math.floor(r() * hues.length); }
    const a = r() * 6.283, rad = Math.sqrt(r()) * 3.6, s = 1.1 + r() * 0.8;
    d.position.set(cx + Math.cos(a) * rad, 0.8 + r() * 0.3, cz + Math.sin(a) * rad);
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
  const limbs = [], up = new THREE.Vector3(0, 1, 0), from = new THREE.Vector3(0.14, 2.7, 0), q = new THREE.Quaternion();
  for (const i of [1, 2, 4, 5, 3]) {
    const to = new THREE.Vector3(puffs[i][0], puffs[i][1] - 0.1, puffs[i][2]), dir = to.clone().sub(from), len = dir.length() * 0.85;
    const lg = new THREE.CylinderGeometry(0.05, 0.15, len, 8, 1, true);
    lg.applyQuaternion(q.setFromUnitVectors(up, dir.normalize())); lg.translate(from.x + dir.x * len / 2, from.y + dir.y * len / 2, from.z + dir.z * len / 2);
    limbs.push(lg);
  }
  const limbMesh = new THREE.Mesh(mergeGeometries(limbs), trunkMat); limbMesh.castShadow = true; g.add(limbMesh);
  for (const [x, y, z, s] of puffs) {
    const b = new THREE.Mesh(blobGeo(r, s * 0.74, s * 0.6, s * 0.74, 0.15), leafMat);
    b.position.set(x, y, z); b.castShadow = true; leaves.add(b);
  }
  const bare = new THREE.Mesh(bareGeo, twigMat); bare.castShadow = true; bare.visible = false;
  g.add(leaves, bare);
  g.userData = { leaves, bare, puffs };
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
  const U = { time: { value: 0 }, center: { value: new THREE.Vector2(START.x, START.z) }, snow: { value: 0 } };
  const skyMesh = sky(); scene.add(skyMesh);
  const sea = cloudSea(r); scene.add(sea.group);
  const heaps = cumulus(r); scene.add(heaps);

  scene.add(islandMesh(R, 24, 1.3, 120));
  const ground = meadow(r); scene.add(ground.mesh);
  const grassNear = grassField(r, U, GRASS_NEAR), grassFar = grassField(r, U, GRASS_FAR); scene.add(grassNear, grassFar);
  const blooms = flowers(r); scene.add(blooms);

  const bareGeos = [branchGeo(r), branchGeo(r), branchGeo(r)], trees = [];
  TREES.forEach((t, i) => {
    const m = tree(r, bareGeos[i % bareGeos.length]); m.position.set(t.x, 0, t.z); m.scale.setScalar(t.s * 1.5); m.rotation.y = r() * 6;
    scene.add(m); trees.push(m);
  });
  const foliage = leafCloud(r, U, trees); scene.add(foliage);
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
    U.snow.value = S.snow;
    heaps.visible = blooms.visible = foliage.visible = seeds.visible = !S.snow; flakes.visible = !!S.snow;
    for (const t of trees) { t.userData.leaves.visible = !S.snow; t.userData.bare.visible = !!S.snow; }
  }
  setSeason('summer');

  return {
    setSeason,
    // 0.3 .. 1: draw that fraction of the grass and leaves (instances are in random order, so it thins evenly)
    setDetail(q) { for (const m of [grassNear, grassFar, foliage]) m.count = Math.floor(m.userData.full * q); },
    get season() { return season; },
    update(t, px, pz, camera, pixelRatio = 1) {
      U.time.value = t; U.center.value.set(px, pz); sea.group.rotation.y = t * 0.003; heaps.rotation.y = t * 0.0016;
      sun.target.position.set(px, 0, pz); sun.position.set(px + SUN_DIR.x * 60, SUN_DIR.y * 60, pz + SUN_DIR.z * 60);
      for (const f of [flakes, seeds]) if (f.visible) { f.material.uniforms.uCam.value.copy(camera.position); f.material.uniforms.uSize.value = pixelRatio; }
    },
  };
}
