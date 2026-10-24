// Home-only pastel autumn foliage. Shared shader/program, ten uniform palettes; existing bark/geometry stay intact.
import * as THREE from 'three';
import { getGradientMap } from './toon.js';

export const AUTUMN_TREE_FAMILIES = Object.freeze([
  Object.freeze({ id: 'sage', colors: Object.freeze(['#c4d3a1', '#aabf96']) }),
  Object.freeze({ id: 'golden-butter', colors: Object.freeze(['#efd293', '#dfbf79']) }),
  Object.freeze({ id: 'peach', colors: Object.freeze(['#e8b298', '#dba58c']) }),
  Object.freeze({ id: 'dusty-rose', colors: Object.freeze(['#c99aa6', '#b98c9b']) }),
  Object.freeze({ id: 'muted-terracotta', colors: Object.freeze(['#c58d7c', '#b77d6b']) }),
]);
export function autumnTreePalette(x, z) {
  const hash = (Math.imul(Math.round(x * 1000), 73856093) ^ Math.imul(Math.round(z * 1000), 19349663)) >>> 0;
  const index = hash % 10, family = AUTUMN_TREE_FAMILIES[Math.floor(index / 2)], variation = index % 2;
  return { index, family: family.id, variation, color: family.colors[variation] };
}
const materials = new Map();
export function autumnTreeMaterial(x, z) {
  const palette = autumnTreePalette(x, z);
  if (materials.has(palette.index)) return materials.get(palette.index);
  const base = new THREE.Color(palette.color), low = base.clone().multiplyScalar(0.8), high = base.clone().lerp(new THREE.Color('#fff6e7'), 0.16);
  const material = new THREE.MeshToonMaterial({ color: '#ffffff', vertexColors: true, gradientMap: getGradientMap() });
  material.name = `home-autumn-${palette.family}-${palette.variation}`;
  material.userData.autumnPalette = palette;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAutumnLow = { value: low }; shader.uniforms.uAutumnHigh = { value: high };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uAutumnLow; uniform vec3 uAutumnHigh;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Original green/pink leaf vertices are distinct from the brown trunk. This avoids new attributes/geometry variants.
        #if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
          if (vColor.g > vColor.r * 1.15 || vColor.b > vColor.g * 1.05) {
            float leafLight = clamp((dot(vColor.rgb, vec3(0.2126, 0.7152, 0.0722)) - 0.14) / 0.42, 0.0, 1.0);
            diffuseColor.rgb = mix(uAutumnLow, uAutumnHigh, leafLight);
          }
        #endif`);
  };
  material.customProgramCacheKey = () => 'home-autumn-foliage-v1';
  materials.set(palette.index, material); return material;
}
