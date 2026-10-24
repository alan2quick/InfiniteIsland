// Terrain meshes (Step 27a). Every island is its own chunked, culled, vertex-coloured toon mesh under a child Group named
// `terrain-<id>`, built from that island's pure height module and disposable on its own (the PLAN "Scaling" bullet):
//   buildIslandTerrain(island) -> { group, dispose() }
//   buildTerrain()             -> Group 'terrain' holding terrain-home, terrain-frost, terrain-ember (+ userData.islands[id])
// Home keeps the original mesh exactly (150 u square, 240 segments, 8 x 8 chunks, same colours). The big islands use ~1 u
// cells over their square (radius + ISLAND_MESH_MARGIN each side), 8 x 8 chunks with tight bounds. Since Step 69a an island may be a
// RECTANGLE (Duskcrown: ISLANDS halfX / halfZ, islands/extent.js meshExtent): the same ~1 u cells, segment counts rounded to multiples of
// the 8 chunks per axis; the squares keep their old 240 x 240 grid exactly. All islands share one
// toon material (its shader adds the two-tone grass blotch wherever the aGrass vertex attribute is 1).
import * as THREE from 'three';
import { createNoise2D } from '../utils/noise.js';
import {
  PALETTE, ISLANDS, WORLD_SIZE, TERRAIN_SEGMENTS, ISLAND_MESH_MARGIN, FAR_TERRAIN_SEGMENTS,
} from '../config.js';
import { getGradientMap } from '../render/toon.js';
import * as home from './islands/home.js';
import { getIslandModule } from './islands/registry.js';
import { campPaint } from './islands/frostCamp.js';
import { gardenPaint } from './islands/emberGarden.js';
import { pathPaint } from './paths.js';
import { meshExtent, isRectangular } from './islands/extent.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

const ISLAND_SEGMENTS = 240;     // ~1 u cells over a 2 * (radius + margin) square
const CHUNKS = 8;                // chunks per side
const SQUARE_CELL = 2 * (110 + ISLAND_MESH_MARGIN) / ISLAND_SEGMENTS;     // the cell size of a 244 u square (a rectangular island keeps it)
const FAR_CELL = 2 * (110 + ISLAND_MESH_MARGIN) / FAR_TERRAIN_SEGMENTS;  // (and the far version's cell)

/** The mesh grid of a non-home island: { sizeX, sizeZ, segsX, segsZ }. A classic square is exactly the old 240 x 240 grid (far: FAR_TERRAIN_SEGMENTS). */
function islandGrid(island, far = false, farSegs = FAR_TERRAIN_SEGMENTS) {
  const { halfX, halfZ } = meshExtent(island), sizeX = 2 * halfX, sizeZ = 2 * halfZ;
  if (!isRectangular(island)) return { sizeX, sizeZ, segsX: far ? farSegs : ISLAND_SEGMENTS, segsZ: far ? farSegs : ISLAND_SEGMENTS };
  const cell = far ? FAR_CELL * (FAR_TERRAIN_SEGMENTS / farSegs) : SQUARE_CELL, round = far ? 1 : CHUNKS;
  return { sizeX, sizeZ, segsX: Math.max(round, Math.round(sizeX / cell / round) * round), segsZ: Math.max(round, Math.round(sizeZ / cell / round) * round) };
}

// Shared uniforms survive near/far rebuilds; settings never affect terrain sampling or gameplay data.
export const terrainUniforms = { uGroundBlend: { value: 1 } };
export function setGroundBlend(value) {
  const n = Number(value);
  if (Number.isFinite(n)) terrainUniforms.uGroundBlend.value = clamp01(n);
  return terrainUniforms.uGroundBlend.value;
}

let sharedMaterial = null;
function makeTerrainMaterial() {
  if (sharedMaterial) return sharedMaterial;
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getGradientMap() });
  const darkRatio = new THREE.Color(PALETTE.grassDark);
  const light = new THREE.Color(PALETTE.grassLight);
  darkRatio.set(darkRatio.r / light.r, darkRatio.g / light.g, darkRatio.b / light.b);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGroundBlend = terrainUniforms.uGroundBlend;
    shader.uniforms.uGrassDark = { value: new THREE.Vector3(darkRatio.r, darkRatio.g, darkRatio.b) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aGrass;
        varying float vGrass;
        varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGrass = aGrass;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uGrassDark;
        uniform float uGroundBlend;
        varying float vGrass;
        varying vec3 vWPos;
        float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float tVNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(tHash(i), tHash(i + vec2(1, 0)), f.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), f.x), f.y);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 gp = vWPos.xz;
          float n = tVNoise(gp * 0.17) * 0.65 + tVNoise(gp * 0.43 + 7.0) * 0.35;
          float w = fwidth(n) * 1.2 + mix(0.006, 0.12, uGroundBlend);
          float blotch = smoothstep(0.5 - w, 0.5 + w, n);
          vec2 cell = floor(gp / 4.0);
          float checker = mod(cell.x + cell.y, 2.0);
          diffuseColor.rgb *= mix(vec3(1.0), uGrassDark, blotch * vGrass);
          diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(1.0), uGrassDark, 0.3), mix(checker, n, uGroundBlend) * vGrass);
        }`);
  };
  sharedMaterial = mat;
  return mat;
}

/**
 * Builds a plane over [cx - sizeX/2, cx + sizeX/2] x [cz - sizeZ/2, cz + sizeZ/2] with segsX x segsZ cells (a square when equal), heights from
 * heightAt, then colours via paint(x, z, h, slope, out) (out = { color: THREE.Color, grass: number }).
 */
function buildPlane(cx, cz, sizeX, sizeZ, segsX, segsZ, heightAt, paint) {
  const geo = new THREE.PlaneGeometry(sizeX, sizeZ, segsX, segsZ);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const count = pos.count;
  const heights = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i) + cx, z = pos.getZ(i) + cz;
    const h = heightAt(x, z);
    heights[i] = h;
    pos.setXYZ(i, x, h, z);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const colors = new Float32Array(count * 3);
  const grass = new Float32Array(count);
  const out = { color: new THREE.Color(), grass: 1 };
  for (let i = 0; i < count; i++) {
    const ny = Math.max(0.05, nrm.getY(i));
    const slope = Math.sqrt(1 - ny * ny) / ny;
    paint(pos.getX(i), pos.getZ(i), heights[i], slope, out);
    colors[i * 3] = out.color.r;
    colors[i * 3 + 1] = out.color.g;
    colors[i * 3 + 2] = out.color.b;
    grass[i] = out.grass;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aGrass', new THREE.BufferAttribute(grass, 1));
  return { geo, heights };
}

/**
 * Splits a plane into a grid of chunks that share the vertex buffers but each own an index range + tight bounding sphere,
 * so frustum culling (camera AND sun shadow camera) drops the off-screen terrain.
 */
function chunkPlane(geo, heights, segsX, segsZ, cx, cz, sizeX, sizeZ, mat, group) {
  const perX = segsX / CHUNKS, perZ = segsZ / CHUNKS;
  const src = geo.index.array;
  const cellsPerRow = segsX;             // PlaneGeometry emits 6 indices per quad, row-major
  const box = new THREE.Box3();
  const geos = [];
  for (let cj = 0; cj < CHUNKS; cj++) {
    for (let ci = 0; ci < CHUNKS; ci++) {
      const idx = new src.constructor(perX * perZ * 6);
      let o = 0;
      for (let y = 0; y < perZ; y++) {
        const q0 = (cj * perZ + y) * cellsPerRow + ci * perX;
        idx.set(src.subarray(q0 * 6, (q0 + perX) * 6), o);
        o += perX * 6;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', geo.attributes.position);
      g.setAttribute('normal', geo.attributes.normal);
      g.setAttribute('uv', geo.attributes.uv);
      g.setAttribute('color', geo.attributes.color);
      g.setAttribute('aGrass', geo.attributes.aGrass);
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      box.makeEmpty();
      const stride = segsX + 1;
      let minY = Infinity, maxY = -Infinity;
      for (let y = cj * perZ; y <= (cj + 1) * perZ; y++) {
        for (let x = ci * perX; x <= (ci + 1) * perX; x++) {
          const h = heights[y * stride + x];
          if (h < minY) minY = h;
          if (h > maxY) maxY = h;
        }
      }
      const stepX = sizeX / CHUNKS, stepZ = sizeZ / CHUNKS;
      const x0 = cx - sizeX / 2 + ci * stepX, z0 = cz - sizeZ / 2 + cj * stepZ;
      box.set(new THREE.Vector3(x0, minY, z0), new THREE.Vector3(x0 + stepX, maxY, z0 + stepZ));
      g.boundingBox = box.clone();
      g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = 'terrain-chunk';
      mesh.receiveShadow = true;
      mesh.castShadow = true;   // plateau / mountains shade the ground below
      group.add(mesh);
      geos.push(g);
    }
  }
  return geos;
}

// ---------------------------------------------------------------------------------------------
// Home island paint (unchanged from the single-island version)
// ---------------------------------------------------------------------------------------------
function homePainter() {
  const nB = home.homeNoiseB;
  const PLATEAU = home.PLATEAU;
  const cLight = new THREE.Color(PALETTE.grassLight);
  const cPlateau = new THREE.Color('#b4f27a');
  const cSand = new THREE.Color(PALETTE.sand);
  const cSandLight = new THREE.Color('#fff2c4');
  const cWet = new THREE.Color('#f6dca0');
  const cDirt = new THREE.Color(PALETTE.dirt);
  const cDirtDark = new THREE.Color('#c48a52');
  const cSea = new THREE.Color('#5fcfd0');
  const tmp = new THREE.Color();
  return (x, z, h, slope, out) => {
    const col = out.color;
    const t = home.inlandDistance(x, z);

    // Grass colour = light grass; the two-tone blotch/checker pattern is added per pixel in the shader (grassW).
    col.copy(cLight);
    col.lerp(tmp.copy(cPlateau), sstep(2.3, 3.4, h) * 0.55);
    let grassW = 1;

    // Sand ring
    const sandM = 1 - sstep(10.0, 11.0, t);
    tmp.copy(cSand).lerp(cSandLight, sstep(-0.1, 0.1, nB(x * 0.12 + 50, z * 0.12 - 30)) * 0.7);
    col.lerp(tmp, sandM);
    grassW *= 1 - sandM;

    // Cliff dirt
    const dirtM = sstep(0.38, 0.62, slope) * sstep(0.4, 0.9, h)
      * (1 - sstep(PLATEAU.radius + 4, PLATEAU.radius + 9, Math.hypot(x - PLATEAU.x, z - PLATEAU.z)));
    if (dirtM > 0) {
      tmp.copy(cDirt).lerp(cDirtDark, sstep(-0.2, 0.3, nB(x * 0.5, z * 0.5)));
      col.lerp(tmp, dirtM);
      grassW *= 1 - dirtM;
    }

    // Wet sand at the waterline, tinting to sea floor colour below the water
    const wetM = 1 - sstep(0.03, 0.22, h);
    col.lerp(cWet, wetM);
    const seaM = sstep(-0.1, -2.6, h) * 0.85;
    col.lerp(cSea, seaM);
    grassW *= (1 - wetM) * (1 - seaM);
    out.grass = grassW;
  };
}

// ---------------------------------------------------------------------------------------------
// Frostpine paint: sand beach, pine-meadow grass, dirt / grey rock cliffs, snow, pale-blue ice
// ---------------------------------------------------------------------------------------------
function frostPainter(island, mod) {
  const nP = createNoise2D(island.seed + 99);
  const cGrass = new THREE.Color('#82d98c');
  const cFoot = new THREE.Color('#a9e3a4');
  const cSand = new THREE.Color(PALETTE.sand);
  const cSandLight = new THREE.Color('#fff2c4');
  const cWet = new THREE.Color('#f6dca0');
  const cDirt = new THREE.Color(PALETTE.dirt);
  const cDirtDark = new THREE.Color('#c48a52');
  const cRock = new THREE.Color('#a3a8b8');
  const cRockDark = new THREE.Color('#858ba0');
  const cSnow = new THREE.Color('#f4f8ff');
  const cSnowShade = new THREE.Color('#dfe8f7');
  const cIce = new THREE.Color('#bfe9f7');
  const cIceLight = new THREE.Color('#dff6ff');
  const cSea = new THREE.Color('#5fcfd0');
  const tmp = new THREE.Color();
  const cRockMix = new THREE.Color();
  // Step 33b: the camp's trampled-snow clearing + the trails (world/paths.js), painted on top of the grass / snow and before the lake
  const cTramp = new THREE.Color('#eef3fa');
  const cTrampShade = new THREE.Color('#cfd9ea');
  const cTrampAsh = new THREE.Color('#9d8f94');
  const trailCol = { snow: [new THREE.Color('#e6edf7'), new THREE.Color('#c9d6ea')], dirt: [new THREE.Color('#d9b98a'), new THREE.Color('#c29a68')] };
  return (x, z, h, slope, out) => {
    const col = out.color;
    const info = mod.paintInfo(x, z, h);
    col.copy(cGrass).lerp(cFoot, sstep(2.2, 3.6, h) * 0.6);
    let grassW = 1;

    const sandM = 1 - sstep(10.0, 11.0, info.t);
    tmp.copy(cSand).lerp(cSandLight, sstep(-0.1, 0.1, nP(x * 0.12 + 50, z * 0.12 - 30)) * 0.7);
    col.lerp(tmp, sandM);
    grassW *= 1 - sandM;

    // Cliffs: warm dirt low down, grey rock higher up
    const cliffM = sstep(0.38, 0.62, slope) * sstep(0.4, 0.9, h);
    if (cliffM > 0) {
      tmp.copy(cDirt).lerp(cDirtDark, sstep(-0.2, 0.3, nP(x * 0.5, z * 0.5)));
      const rockM = sstep(2.6, 3.8, h);
      const rk = tmp.lerp(cRockMix.copy(cRock).lerp(cRockDark, sstep(-0.2, 0.3, nP(x * 0.4 + 9, z * 0.4))), rockM);
      col.lerp(rk, cliffM);
      grassW *= 1 - cliffM;
    }

    // Snow on the high ground (steep faces stay mostly bare rock), with a noisy edge from paintInfo
    const snowM = info.snow * (1 - sstep(0.7, 1.2, slope) * 0.75);
    if (snowM > 0) {
      tmp.copy(cSnow).lerp(cSnowShade, sstep(-0.1, 0.5, nP(x * 0.2 - 4, z * 0.2 + 13)) * 0.8);
      col.lerp(tmp, snowM);
      grassW *= 1 - snowM;
    }

    // The camp clearing (trampled snow, dirty round the fire, a noisy edge) and the trails (packed snow / dirt, soft edges)
    const cp = campPaint(island, x, z);
    if (cp.w > 0) {
      const cw = clamp01(cp.w + 0.24 * nP(x * 0.32 + 3, z * 0.32 - 8) * Math.sin(Math.PI * cp.w));
      tmp.copy(cTramp).lerp(cTrampShade, sstep(-0.15, 0.45, nP(x * 0.5 + 21, z * 0.5 + 4)) * 0.85);
      tmp.lerp(cTrampAsh, cp.ring * (0.55 + 0.3 * sstep(-0.2, 0.3, nP(x * 0.9, z * 0.9))));
      col.lerp(tmp, cw);
      grassW *= 1 - cw;
    }
    const tp = pathPaint(island, x, z);
    if (tp.w > 0) {
      const tc = trailCol[tp.surface] || trailCol.snow;
      tmp.copy(tc[0]).lerp(tc[1], sstep(-0.2, 0.4, nP(x * 0.7 - 5, z * 0.7 + 11)) * 0.9);
      col.lerp(tmp, tp.w);
      grassW *= 1 - tp.w;
    }

    // Frozen lake
    if (info.ice > 0) {
      tmp.copy(cIce).lerp(cIceLight, sstep(-0.2, 0.4, nP(x * 0.35, z * 0.35)));
      col.lerp(tmp, info.ice);
      grassW *= 1 - info.ice;
    }

    const wetM = 1 - sstep(0.03, 0.22, h);
    col.lerp(cWet, wetM);
    const seaM = sstep(-0.1, -2.6, h) * 0.85;
    col.lerp(cSea, seaM);
    grassW *= (1 - wetM) * (1 - seaM);
    out.grass = grassW;
  };
}

// ---------------------------------------------------------------------------------------------
// Emberleaf paint: gold + black sand, lush jungle grass, dark volcanic rock, lava, teal hot spring
// ---------------------------------------------------------------------------------------------
function emberPainter(island, mod) {
  const nP = createNoise2D(island.seed + 99);
  const cJungle = new THREE.Color('#4fc25a');
  const cJungleDark = new THREE.Color('#3aa851');
  const cGold = new THREE.Color('#ffd36e');
  const cGoldLight = new THREE.Color('#ffe7a0');
  const cBlack = new THREE.Color('#463e4c');
  const cBlackLight = new THREE.Color('#5c5366');
  const cWet = new THREE.Color('#d9b46a');
  const cWetBlack = new THREE.Color('#3d3646');
  const cDirt = new THREE.Color('#9a6a4a');
  const cDirtDark = new THREE.Color('#7a5440');
  const cRock = new THREE.Color('#6e5f6b');
  const cRockDark = new THREE.Color('#574a5a');
  const cAsh = new THREE.Color('#a39aa6');
  const cLava = new THREE.Color('#ff6a2b');
  const cLavaHot = new THREE.Color('#ffb53a');
  const cSpring = new THREE.Color('#58b8b4');
  const cSea = new THREE.Color('#5fcfd0');
  const tmp = new THREE.Color();
  const cBlackMix = new THREE.Color();
  // Step 37a: the terrace garden's bare dark soil (with paler old stone on the risers and ash round the hearth) and the garden trail (packed earth, black-sand flecks)
  const cSoil = new THREE.Color('#43363f');
  const cSoilLight = new THREE.Color('#5a474d');
  const cRiser = new THREE.Color('#7a6b7e');
  const cHearthAsh = new THREE.Color('#8a8190');
  const cEarth = new THREE.Color('#b9915e');
  const cEarthDark = new THREE.Color('#a07a50');
  const cEarthFleck = new THREE.Color('#5a4d58');
  // Step 37c: the waterfall's stony shore and the dark wet stone beside the water
  const cFallRock = new THREE.Color('#6a5d6c');
  const cFallWet = new THREE.Color('#4a4659');
  return (x, z, h, slope, out) => {
    const col = out.color;
    const info = mod.paintInfo(x, z, h);
    col.copy(cJungle).lerp(cJungleDark, sstep(-0.3, 0.4, nP(x * 0.06, z * 0.06)) * 0.5);
    col.lerp(cJungleDark, sstep(0.14, 0.32, slope) * 0.8);        // darker jungle on the terrace risers so the tiers read
    let grassW = 1;

    // Beach: gold sand with black-sand stretches
    const sandM = 1 - sstep(10.0, 11.0, info.t);
    tmp.copy(cGold).lerp(cGoldLight, sstep(-0.1, 0.1, nP(x * 0.12 + 50, z * 0.12 - 30)) * 0.7);
    const black = cBlackMix.copy(cBlack).lerp(cBlackLight, sstep(-0.1, 0.2, nP(x * 0.15 + 5, z * 0.15)) * 0.8);
    tmp.lerp(black, info.black);
    col.lerp(tmp, sandM);
    grassW *= 1 - sandM;

    // Cliffs and the volcano's dark rock
    const rockM = Math.max(sstep(0.38, 0.62, slope) * sstep(0.4, 0.9, h) * sstep(2.8, 3.8, h), info.volcano * sstep(4.8, 6.0, h));
    const dirtM = sstep(0.38, 0.62, slope) * sstep(0.4, 0.9, h) * (1 - sstep(2.8, 3.8, h));
    if (dirtM > 0) {
      tmp.copy(cDirt).lerp(cDirtDark, sstep(-0.2, 0.3, nP(x * 0.5, z * 0.5)));
      col.lerp(tmp, dirtM);
      grassW *= 1 - dirtM;
    }
    if (rockM > 0) {
      tmp.copy(cRock).lerp(cRockDark, sstep(-0.2, 0.3, nP(x * 0.4 + 9, z * 0.4)));
      tmp.lerp(cAsh, sstep(8, 15, h) * (0.35 + 0.35 * sstep(-0.1, 0.4, nP(x * 0.07 + 3, z * 0.7))));   // paler, streaky ash towards the rim
      col.lerp(tmp, rockM);
      grassW *= 1 - rockM;
    }

    // The terrace garden: dark volcanic soil (a noisy edge), old pale stone on the risers, ash round the hearth
    const gp = gardenPaint(island, x, z);
    if (gp.w > 0) {
      const gw = clamp01(gp.w + 0.22 * nP(x * 0.3 + 11, z * 0.3 - 5) * Math.sin(Math.PI * gp.w));
      tmp.copy(cSoil).lerp(cSoilLight, sstep(-0.2, 0.45, nP(x * 0.55 + 2, z * 0.55 + 9)) * 0.85);
      tmp.lerp(cRiser, sstep(0.16, 0.34, slope) * 0.45);
      tmp.lerp(cHearthAsh, gp.ring * (0.5 + 0.3 * sstep(-0.2, 0.3, nP(x * 0.9, z * 0.9))));
      col.lerp(tmp, gw);
      grassW *= 1 - gw;
    }
    // The garden trail: packed earth with a few black-sand flecks, soft edges
    const tp = pathPaint(island, x, z);
    if (tp.w > 0) {
      tmp.copy(cEarth).lerp(cEarthDark, sstep(-0.2, 0.4, nP(x * 0.7 - 5, z * 0.7 + 11)) * 0.9);
      tmp.lerp(cEarthFleck, sstep(0.4, 0.58, nP(x * 1.3 + 3, z * 1.3 - 7)) * 0.55);
      col.lerp(tmp, tp.w);
      grassW *= 1 - tp.w;
    }

    // The waterfall: the ledge, the bluff and the pool's shore are grey stone, everything beside the water is dark and wet
    if (info.fallsRock > 0) {
      tmp.copy(cFallRock).lerp(cRockDark, sstep(-0.2, 0.3, nP(x * 0.5 + 4, z * 0.5)) * 0.8);
      col.lerp(tmp, info.fallsRock);
      grassW *= 1 - info.fallsRock;
    }
    if (info.fallsWet > 0) {
      col.lerp(cFallWet, info.fallsWet * 0.85);
      grassW *= 1 - info.fallsWet;
    }

    // Lava floor of the crater
    if (info.lava > 0) {
      tmp.copy(cLava).lerp(cLavaHot, sstep(0.0, 0.55, nP(x * 0.55 + 2, z * 0.55 - 6)));
      col.lerp(tmp, info.lava);
      grassW *= 1 - info.lava;
    }

    // Hot spring: teal wet stone
    if (info.spring > 0) {
      col.lerp(cSpring, info.spring);
      grassW *= 1 - info.spring;
    }

    const wetM = 1 - sstep(0.03, 0.22, h);
    tmp.copy(cWet).lerp(cWetBlack, info.black);
    col.lerp(tmp, wetM);
    const seaM = sstep(-0.1, -2.6, h) * 0.85;
    col.lerp(cSea, seaM);
    grassW *= (1 - wetM) * (1 - seaM);
    out.grass = grassW;
  };
}

// ---------------------------------------------------------------------------------------------
// Storybook Cay paint (Step 48): soft paper-pale meadow, cream sand, a cream ribbon path, the dark ink pond and a slightly warmer reading hill
// ---------------------------------------------------------------------------------------------
function storyPainter(island, mod) {
  const nP = createNoise2D(island.seed + 99);
  const cMeadow = new THREE.Color('#a9e68a');
  const cMeadowPale = new THREE.Color('#c3efa0');
  const cHill = new THREE.Color('#b9ee8f');
  const cSand = new THREE.Color('#fff0c6');
  const cSandLight = new THREE.Color('#fff9e3');
  const cWet = new THREE.Color('#f0d9a2');
  const cPath = new THREE.Color('#fff3d2');
  const cPathDark = new THREE.Color('#f4dfb4');
  const cInk = new THREE.Color('#3b3470');
  const cInkLight = new THREE.Color('#5a4fa0');
  const cSea = new THREE.Color('#5fcfd0');
  const tmp = new THREE.Color();
  return (x, z, h, slope, out) => {
    const col = out.color;
    const info = mod.paintInfo(x, z, h);
    col.copy(cMeadow).lerp(cMeadowPale, sstep(-0.2, 0.4, nP(x * 0.05, z * 0.05)) * 0.55);
    col.lerp(tmp.copy(cHill), info.hill * 0.5);
    let grassW = 1;
    const sandM = 1 - sstep(10.0, 11.0, info.t);
    tmp.copy(cSand).lerp(cSandLight, sstep(-0.1, 0.1, nP(x * 0.12 + 50, z * 0.12 - 30)) * 0.7);
    col.lerp(tmp, sandM);
    grassW *= 1 - sandM;
    // the ribbon path: pale cream, dotted with slightly darker paper flecks
    if (info.path > 0) {
      tmp.copy(cPath).lerp(cPathDark, sstep(0.2, 0.5, nP(x * 0.7, z * 0.7)) * 0.6);
      col.lerp(tmp, info.path);
      grassW *= 1 - info.path;
    }
    // the ink pond: deep blue-violet with a lighter shimmer ring near the lip
    if (info.ink > 0) {
      tmp.copy(cInk).lerp(cInkLight, sstep(0.5, 0.9, 1 - info.ink) * 0.7 + 0.15 * nP(x * 0.4, z * 0.4));
      col.lerp(tmp, info.ink);
      grassW *= 1 - info.ink;
    }
    // wet sand at the waterline, sea floor tint below it
    const wetM = 1 - sstep(0.03, 0.22, h);
    col.lerp(cWet, wetM);
    const seaM = sstep(-0.1, -2.6, h) * 0.85;
    col.lerp(cSea, seaM);
    grassW *= (1 - wetM) * (1 - seaM);
    out.grass = grassW;
  };
}

// ---------------------------------------------------------------------------------------------
// Duskcrown paint (Step 69a, PLAIN colours; the glow and the night look come in 69b+): the Glowcap Marsh in dusky teal-greens with lighter hummock tops, mud shelves round the
// ponds / streams / lagoon, pale sand at the landing, dark indigo rock for the sheer wall and a neutral grey-lavender top for the Crownlands placeholder
// ---------------------------------------------------------------------------------------------
function duskPainter(island, mod) {
  const nP = createNoise2D(island.seed + 99);
  const cMarsh = new THREE.Color('#2f8f7c');
  const cMarshLight = new THREE.Color('#4fb08f');
  const cMarshDark = new THREE.Color('#236f66');
  const cMud = new THREE.Color('#5d4b47');
  const cMudDark = new THREE.Color('#42343f');
  const cSand = new THREE.Color('#ead9a0');
  const cSandLight = new THREE.Color('#f7edc8');
  const cWet = new THREE.Color('#c4ad7c');
  const cWetMud = new THREE.Color('#4a3b42');
  const cRock = new THREE.Color('#47405f');
  const cRockLight = new THREE.Color('#645d82');
  const cRockDark = new THREE.Color('#2f2a45');
  const cTop = new THREE.Color('#9ba3b4');
  const cTopLight = new THREE.Color('#b4bac8');
  const cSea = new THREE.Color('#3f9c9d');
  const tmp = new THREE.Color();
  return (x, z, h, slope, out) => {
    const col = out.color;
    const info = mod.paintInfo(x, z, h);
    // marsh: teal-green, lighter on the hummock tops, darker in the hollows, with a soft blotch
    col.copy(cMarsh).lerp(cMarshLight, sstep(0.45, 0.95, info.hum) * 0.7).lerp(cMarshDark, (1 - sstep(0.0, 0.4, info.hum)) * 0.55);
    col.lerp(tmp.copy(cMarshLight), sstep(0.25, 0.7, nP(x * 0.09, z * 0.09)) * 0.18);
    let grassW = 0.45;

    // mud shelves
    if (info.mud > 0) {
      tmp.copy(cMud).lerp(cMudDark, sstep(-0.2, 0.4, nP(x * 0.4 + 3, z * 0.4 - 7)) * 0.8);
      col.lerp(tmp, info.mud * 0.92);
      grassW *= 1 - info.mud;
    }
    // the landing beach
    if (info.sand > 0) {
      tmp.copy(cSand).lerp(cSandLight, sstep(-0.1, 0.1, nP(x * 0.12 + 50, z * 0.12 - 30)) * 0.7);
      col.lerp(tmp, info.sand);
      grassW *= 1 - info.sand;
    }
    // the sheer wall (steep) and the flat top
    const wall = Math.max(sstep(0.7, 1.5, slope) * sstep(1.2, 3.0, h), info.plateau * (1 - info.top));
    if (wall > 0) {
      tmp.copy(cRock).lerp(cRockLight, sstep(-0.1, 0.5, nP(x * 0.35 + 9, z * 0.9)) * 0.8).lerp(cRockDark, sstep(0.1, -0.5, nP(x * 0.6, z * 0.5 + 4)) * 0.6);
      col.lerp(tmp, wall);
      grassW *= 1 - wall;
    }
    if (info.top > 0) {
      tmp.copy(cTop).lerp(cTopLight, sstep(-0.2, 0.5, nP(x * 0.05 + 2, z * 0.05)) * 0.6);
      col.lerp(tmp, info.top);
      grassW *= 1 - info.top;
    }
    // wet edge at the waterline, tinting to the sea / pond bed below the water
    const wetM = 1 - sstep(0.03, 0.22, h);
    tmp.copy(cWet).lerp(cWetMud, 1 - info.sand);
    col.lerp(tmp, wetM);
    const seaM = sstep(-0.1, -2.6, h) * 0.85;
    col.lerp(cSea, seaM);
    grassW *= (1 - wetM) * (1 - seaM);
    out.grass = h > 6 ? 0 : grassW;
  };
}

const PAINTERS = { alpine: frostPainter, volcanic: emberPainter, storybook: storyPainter, fungal: duskPainter };

/**
 * Builds one island's terrain: { group, dispose() }. The group is named `terrain-<id>`; dispose() frees its geometry (the toon
 * material is shared by all islands and stays alive).
 */
export function buildIslandTerrain(island) {
  const mat = makeTerrainMaterial();
  const group = new THREE.Group();
  group.name = `terrain-${island.id}`;
  let base, chunkGeos;
  if (island.id === 'home') {
    const { geo, heights } = buildPlane(0, 0, WORLD_SIZE, WORLD_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS, home.getHeight, homePainter());
    base = geo;
    chunkGeos = chunkPlane(geo, heights, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS, 0, 0, WORLD_SIZE, WORLD_SIZE, mat, group);
  } else {
    const mod = getIslandModule(island.id);
    const g = islandGrid(island);
    const { geo, heights } = buildPlane(island.x, island.z, g.sizeX, g.sizeZ, g.segsX, g.segsZ, mod.height, PAINTERS[island.biome](island, mod));
    base = geo;
    chunkGeos = chunkPlane(geo, heights, g.segsX, g.segsZ, island.x, island.z, g.sizeX, g.sizeZ, mat, group);
  }
  return {
    group,
    dispose() {
      for (const g of chunkGeos) g.dispose();
      base.dispose();
      group.removeFromParent();
    },
  };
}

/** All islands' terrain in one Group 'terrain' (main.js adds it to the scene). userData.islands[id] = { group, dispose }. */
export function buildTerrain() {
  const root = new THREE.Group();
  root.name = 'terrain';
  root.userData.islands = {};
  for (const island of ISLANDS) {
    const built = buildIslandTerrain(island);
    root.add(built.group);
    root.userData.islands[island.id] = built;
  }
  return root;
}

/**
 * The FAR version of an island's terrain (Step 27b): the same height + paint functions sampled on a coarse FAR_TERRAIN_SEGMENTS grid, ONE
 * mesh (no chunks), same shared toon material (so day / night tint and fog match the near terrain), no shadows. -> { mesh, dispose() }
 */
export function buildFarTerrain(island, segs = FAR_TERRAIN_SEGMENTS) {
  const mat = makeTerrainMaterial();
  let geo;
  if (island.id === 'home') {
    geo = buildPlane(0, 0, WORLD_SIZE, WORLD_SIZE, segs, segs, home.getHeight, homePainter()).geo;
  } else {
    const mod = getIslandModule(island.id);
    const g = islandGrid(island, true, segs);
    geo = buildPlane(island.x, island.z, g.sizeX, g.sizeZ, g.segsX, g.segsZ, mod.height, PAINTERS[island.biome](island, mod)).geo;
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `terrain-far-${island.id}`;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return { mesh, dispose() { geo.dispose(); mesh.removeFromParent(); } };
}
