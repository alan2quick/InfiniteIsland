import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AUTUMN_TREE_FAMILIES, autumnTreePalette, autumnTreeMaterial } from '../public/js/render/autumnTrees.js';
import { createProps } from '../public/js/world/props.js';
import { PALETTE } from '../public/js/config.js';
import { installDom } from './fixtures/domStub.js';
installDom();

test('home autumn trees use five distinct color families with two variations and stable position hashing', () => {
  assert.deepEqual(AUTUMN_TREE_FAMILIES.map((f) => f.id), ['sage', 'golden-butter', 'peach', 'dusty-rose', 'muted-terracotta']);
  const colors = AUTUMN_TREE_FAMILIES.flatMap((f) => f.colors); assert.equal(colors.length, 10); assert.equal(new Set(colors).size, 10);
  for (const f of AUTUMN_TREE_FAMILIES) {
    const a = new THREE.Color(f.colors[0]).toArray(), b = new THREE.Color(f.colors[1]).toArray();
    assert.ok(Math.hypot(...a.map((v, i) => v - b[i])) > 0.08, `${f.id}: variations must be visibly different`);
  }
  for (const [x, z] of [[0, 0], [2.18, -4.72], [-13.2, 29.3]]) assert.deepEqual(autumnTreePalette(x, z), autumnTreePalette(x, z));
});

test('actual home trees span every family, share material instances/program, and leave bark colors distinguishable', () => {
  const props = createProps(new THREE.Scene()), families = new Set(), palettes = new Set(), byIndex = new Map();
  for (const tree of props.handles.trees) {
    const mesh = tree.children.find((c) => c.isMesh), palette = mesh.material.userData.autumnPalette;
    assert.ok(palette); families.add(palette.family); palettes.add(palette.index);
    assert.equal(mesh.material, autumnTreeMaterial(tree.position.x, tree.position.z));
    if (byIndex.has(palette.index)) assert.equal(mesh.material, byIndex.get(palette.index)); else byIndex.set(palette.index, mesh.material);
    assert.equal(mesh.material.customProgramCacheKey(), 'home-autumn-foliage-v1');
    assert.equal(mesh.geometry.attributes.aFoliage, undefined, 'no new geometry attributes or duplicated buffers required');
    const col = mesh.geometry.attributes.color;
    let leafVertices = 0, barkVertices = 0;
    for (let i = 0; i < col.count; i++) {
      const leaf = col.getY(i) > col.getX(i) * 1.15 || col.getZ(i) > col.getY(i) * 1.05;
      if (leaf) leafVertices++; else barkVertices++;
    }
    assert.ok(leafVertices > 0 && barkVertices > 0);
  }
  assert.equal(families.size, 5); assert.ok(palettes.size >= 8);
  const bark = new THREE.Color(PALETTE.trunk);
  assert.equal(bark.g > bark.r * 1.15 || bark.b > bark.g * 1.05, false);
  assert.equal([...byIndex.values()].filter((m) => m.isMeshToonMaterial).length, byIndex.size);
  // The same shader patch works for ordinary and instanced meshes; it introduces no instance-specific assumptions.
  const shader = { uniforms: {}, fragmentShader: '#include <common>\n#include <color_fragment>' };
  byIndex.values().next().value.onBeforeCompile(shader);
  assert.ok(shader.uniforms.uAutumnLow.value.isColor && shader.uniforms.uAutumnHigh.value.isColor);
  assert.doesNotMatch(shader.fragmentShader, /instanceMatrix|gl_InstanceID/);
  assert.match(shader.fragmentShader, /diffuseColor\.rgb = mix/);
  console.log(JSON.stringify({ autumnFamilies: [...families], paletteVariations: palettes.size, treeMeshes: props.handles.trees.length }));
});
