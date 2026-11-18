// Combine animation clips from several exports of the same rigged character into one GLB.
// Usage: node scripts/merge-clips.mjs <out.glb> <base.glb>[:clip,clip] <extra.glb>[:clip,clip] ...
// The first file supplies the mesh, textures and skeleton; later files supply clips only, matched to bones by name.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, prune, unpartition } from '@gltf-transform/functions';

const [out, ...inputs] = process.argv.slice(2);
if (!out || !inputs.length) { console.error('usage: merge-clips.mjs <out.glb> <base.glb>[:clips] <extra.glb>[:clips] ...'); process.exit(1); }
const parse = s => { const i = s.lastIndexOf('.glb:'); return i < 0 ? [s, null] : [s.slice(0, i + 4), s.slice(i + 5).split(',')]; };
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const [basePath, baseKeep] = parse(inputs[0]);
const doc = await io.read(basePath);
const root = doc.getRoot();
for (const a of root.listAnimations()) if (baseKeep && !baseKeep.includes(a.getName())) a.dispose();
const byName = new Map(root.listNodes().map(n => [n.getName(), n]));

for (const input of inputs.slice(1)) {
  const [path, keep] = parse(input);
  const before = new Set([...root.listNodes(), ...root.listMeshes(), ...root.listSkins(), ...root.listMaterials(),
    ...root.listTextures(), ...root.listScenes(), ...root.listAnimations()]);
  mergeDocuments(doc, await io.read(path));
  for (const a of root.listAnimations()) {
    if (before.has(a)) continue;
    if (keep && !keep.includes(a.getName())) { a.dispose(); continue; }
    for (const ch of a.listChannels()) {
      const target = byName.get(ch.getTargetNode()?.getName());
      if (target) ch.setTargetNode(target); else ch.dispose();       // a bone the base model doesn't have
    }
  }
  for (const list of [root.listScenes(), root.listNodes(), root.listSkins(), root.listMeshes(), root.listMaterials(), root.listTextures()])
    for (const p of list) if (!before.has(p)) p.dispose();
}
await doc.transform(prune(), unpartition());
await io.write(out, doc);
console.log('clips:', root.listAnimations().map(a => a.getName()).join(', '));
