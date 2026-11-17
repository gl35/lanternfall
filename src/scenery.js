// Everything the player doesn't knock over: sky, cloud sea, the island, grass, flowers, rocks, tree.
import * as THREE from 'three';

export const R = 4.6;
export const TREE = { x: -3.3, z: -2.6 };              // island radius
export const LAUNCH = new THREE.Vector3(0, 1.05, 10);
export const SUN_DIR = new THREE.Vector3(-0.17, 0.25, -0.95).normalize();

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

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
  return new THREE.Mesh(new THREE.SphereGeometry(400, 32, 20), mat);
}

function cloudSea(r) {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 16, 12);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffe9d6, emissive: 0xc48f7c, emissiveIntensity: 0.5 });
  const N = 620, m = new THREE.InstancedMesh(geo, mat, N), d = new THREE.Object3D();
  for (let i = 0; i < N; i++) {
    const rad = 6 + Math.pow(r(), 0.7) * 190, a = r() * Math.PI * 2, s = 4 + r() * 8 + rad * 0.03;
    d.position.set(Math.cos(a) * rad, -9.5 + r() * 1.6 - s * 0.12, Math.sin(a) * rad);
    d.scale.set(s, s * (0.32 + r() * 0.2), s * (0.8 + r() * 0.4));
    d.rotation.y = r() * 6; d.updateMatrix(); m.setMatrixAt(i, d.matrix);
  }
  g.add(m);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(400, 40), new THREE.MeshBasicMaterial({ color: 0xf6cfb0 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -10.5; g.add(floor);
  return g;
}

function islandMesh(radius, depth, seed) {
  const pts = [[0, 0], [radius * 0.5, 0], [radius * 0.93, 0], [radius, -0.04], [radius + 0.06, -0.2], [radius * 0.97, -0.55],
    [radius * 0.8, -depth * 0.26], [radius * 0.52, -depth * 0.52], [radius * 0.24, -depth * 0.8], [0.001, -depth]]
    .map(p => new THREE.Vector2(p[0], p[1]));
  const curve = new THREE.SplineCurve(pts.slice(3));
  const prof = [...pts.slice(0, 3), ...curve.getPoints(18)];
  const geo = new THREE.LatheGeometry(prof, 56);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(0x5f9a3a), soil = new THREE.Color(0x6b4a30), rock = new THREE.Color(0x8d7a6a), c = new THREE.Color();
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

function grassField(r, uTime, spots) {
  const geo = new THREE.PlaneGeometry(0.07, 1, 1, 4); geo.translate(0, 0.5, 0);
  const p = geo.attributes.position, n = geo.attributes.normal, col = new Float32Array(p.count * 3);
  const base = new THREE.Color(0x2f6a22), tip = new THREE.Color(0xc5dc62), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) * (1 - y * 0.88)); p.setZ(i, y * y * 0.22);
    n.setXYZ(i, 0, 1, 0);
    c.copy(base).lerp(tip, y); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = s => {
    s.uniforms.uTime = uTime;
    s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = instanceMatrix[3].xyz;
        float w = sin(uTime * 1.6 + ip.x * 0.8 + ip.z * 0.6) * 0.6 + sin(uTime * 3.3 + ip.x * 2.1 - ip.z * 1.7) * 0.25;
        transformed.z += w * 0.28 * position.y * position.y;
      #endif`);
  };
  const N = spots.reduce((s, sp) => s + sp.n, 0);
  const m = new THREE.InstancedMesh(geo, mat, N), d = new THREE.Object3D(), tint = new THREE.Color();
  let k = 0;
  for (const sp of spots) for (let i = 0; i < sp.n; i++, k++) {
    const rad = Math.sqrt(r()) * sp.r, a = r() * Math.PI * 2;
    const x = sp.x + Math.cos(a) * rad, z = sp.z + Math.sin(a) * rad;
    const patch = 0.5 + 0.5 * bump(x * 0.9, 0, z * 0.9);
    d.position.set(x, sp.y, z); d.rotation.set(0, r() * Math.PI * 2, 0);
    d.scale.set(1 + r() * 0.9, 0.16 + r() * 0.16 + patch * 0.14, 1);
    d.updateMatrix(); m.setMatrixAt(k, d.matrix);
    tint.setHSL(0.24 + patch * 0.05 + r() * 0.03, 0.55, 0.5 + r() * 0.14); m.setColorAt(k, tint);
  }
  m.receiveShadow = true;
  return m;
}

function flowers(r, spots) {
  const g = new THREE.Group(), N = 260;
  const petal = new THREE.CylinderGeometry(0.075, 0.02, 0.03, 9);
  const heart = new THREE.SphereGeometry(0.032, 8, 6);
  const pm = new THREE.InstancedMesh(petal, new THREE.MeshLambertMaterial({ color: 0xffffff }), N);
  const hm = new THREE.InstancedMesh(heart, new THREE.MeshLambertMaterial({ color: 0xffc22e }), N);
  const d = new THREE.Object3D(), c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const sp = spots[i % spots.length], rad = Math.sqrt(r()) * sp.r * 0.96, a = r() * 6.283, s = 0.8 + r() * 0.7;
    d.position.set(sp.x + Math.cos(a) * rad, sp.y + 0.3 + r() * 0.1, sp.z + Math.sin(a) * rad);
    d.rotation.set((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5); d.scale.setScalar(s); d.updateMatrix();
    pm.setMatrixAt(i, d.matrix);
    c.set(r() < 0.75 ? 0xffffff : (r() < 0.5 ? 0xffd9ec : 0xfff0a8)); pm.setColorAt(i, c);
    d.position.y += 0.02 * s; d.updateMatrix(); hm.setMatrixAt(i, d.matrix);
  }
  g.add(pm, hm);
  return g;
}

function blob(r, sx, sy, sz, amp, color, rough = 0.9) {
  const geo = new THREE.SphereGeometry(1, 28, 20), p = geo.attributes.position, o = r() * 50;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + bump(x * 1.6 + o, y * 1.6, z * 1.6 + o) * amp;
    p.setXYZ(i, x * k * sx, y * k * sy, z * k * sz);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: rough }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

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
  const trunk = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ color: 0x6d4a34, roughness: 0.9 }));
  trunk.castShadow = true; g.add(trunk);
  const greens = [0x4f8f3a, 0x6aa53f, 0x86b848, 0x5b9b3c];
  const puffs = [[0, 3.5, 0, 1.5], [-1.0, 3.1, 0.3, 1.05], [1.05, 3.2, -0.2, 1.1], [0.2, 4.3, 0.2, 1.05], [-0.4, 3.3, -0.9, 0.95], [0.5, 3.0, 0.9, 0.9]];
  for (const [x, y, z, s] of puffs) {
    const b = blob(r, s, s * 0.82, s, 0.16, greens[Math.floor(r() * greens.length)], 0.85);
    b.position.set(x, y, z); g.add(b);
  }
  return g;
}

export function buildScenery(scene) {
  const r = rng(20261117), uTime = { value: 0 };
  scene.add(sky());
  const clouds = cloudSea(r); scene.add(clouds);

  scene.add(islandMesh(R, 7, 1.3));
  const islet = islandMesh(1.25, 2.4, 4.1); islet.position.set(LAUNCH.x, LAUNCH.y - 0.45, LAUNCH.z); scene.add(islet);

  const spots = [{ x: 0, y: 0, z: 0, r: R * 0.985, n: 15000 }, { x: LAUNCH.x, y: LAUNCH.y - 0.45, z: LAUNCH.z, r: 1.2, n: 700 }];
  scene.add(grassField(r, uTime, spots));
  scene.add(flowers(r, spots));

  for (let i = 0; i < 9; i++) {                              // rounded boulders around the rim
    const a = r() * 6.283, rad = R * (0.86 + r() * 0.1), s = 0.25 + r() * 0.4;
    if (Math.abs(Math.sin(a)) < 0.35 && Math.cos(a) > 0) continue;
    const b = blob(r, s * 1.2, s * 0.75, s, 0.2, 0xa59a8c);
    b.position.set(Math.cos(a) * rad, s * 0.3, Math.sin(a) * rad); b.rotation.y = r() * 6; scene.add(b);
  }
  const t = tree(r); t.position.set(TREE.x, 0, TREE.z); scene.add(t);

  // two far islands for depth
  for (const [x, y, z, s] of [[-34, -3, -60, 5], [30, 2, -85, 7]]) {
    const far = islandMesh(s, s * 1.4, x); far.position.set(x, y, z); far.castShadow = false; scene.add(far);
    const ft = tree(r); ft.scale.setScalar(s * 0.3); ft.position.set(x, y, z); scene.add(ft);
  }

  const sun = new THREE.DirectionalLight(0xffcf96, 3.4);
  sun.position.copy(SUN_DIR).multiplyScalar(40); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 12, bottom: -10, near: 1, far: 90 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x8a7350, 1.35));
  const fill = new THREE.DirectionalLight(0xffe6cf, 0.9); fill.position.set(6, 9, 20); scene.add(fill);
  scene.fog = new THREE.Fog(0xf8cfa8, 50, 210);

  return { update(t) { uTime.value = t; clouds.rotation.y = t * 0.004; } };
}
