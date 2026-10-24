// Ocean + pond + stream water, for the whole archipelago (Step 27a; 69d: local still-water mask for Duskcrown inland basins).
//
// The ocean is one big sea at WATER_LEVEL. Its shader looks up a baked height texture of the terrain (see bakeHeightTexture) to
// get the water depth under every pixel: depth drives the shallow->deep colour bands, transparency near the shore and the animated
// toon foam lines. Because the pond / lagoon basins are carved below WATER_LEVEL they are filled by the very same plane (and get
// their own foam rim for free). The stream sits above sea level on the meadow, so it gets its own flowing ribbon mesh (buildRibbon, Step 37c: reusable for
// Emberleaf's waterfall pools, cascade and stream; `waterUniforms` are the shared water look: time, foam and the day tint).
//
// Several islands: every island in config ISLANDS gets ITS OWN baked patch (a texture over its terrain mesh rectangle, a square for the classic islands (Step 69a: Duskcrown
// is 368 x 260); home's is the same 150 u / 384 px bake as before). The ocean fragment shader picks the patch whose square contains the pixel (outside every
// square = deep water). The gently waving, finely tessellated "inner" plane is one rectangle per island (they tile without
// overlapping, so alpha never double-blends; home's is the original 240 u square) and the wave amplitude fades out with the
// distance to the nearest island centre. One huge flat outer plane, re-centred on the archipelago, reaches the horizon and leaves a
// hole where the inner rectangles draw.
import * as THREE from 'three';
import { PALETTE, WATER_LEVEL, WORLD_SIZE, ISLANDS, DUSK_LIGHT, DUSK_WATER } from '../config.js';
import { meshExtent, frameExtent, isRectangular } from './islands/extent.js';
import { getIslandModule } from './islands/registry.js';
import { getHeight, getTerrainHeight, STREAM_PATH, STREAM_HALF_WIDTH } from './terrain.js';

/** The water look shared by the ocean, the stream and every ribbon (Emberleaf's waterfall water): one update per frame drives them all (createWater().update / setTimeOfDay). */
export const waterUniforms = {
  uTime: { value: 0 },
  uFoam: { value: new THREE.Color('#ffffff') },
  uShallowTint: { value: new THREE.Color('#ffffff') },
  uDeepTint: { value: new THREE.Color('#ffffff') },
  uFoamTint: { value: new THREE.Color('#ffffff') },
  uNight: { value: 0 },
};

const duskWater = { shallow: new THREE.Color('#698fba'), deep: new THREE.Color('#536d9f'), foam: new THREE.Color('#8da4c6') };
export function setWaterLook(clock, duskWeight = 0) {
  const k = DUSK_LIGHT.mix * duskWeight;
  for (const [uniform, key] of [['uShallowTint', 'shallow'], ['uDeepTint', 'deep'], ['uFoamTint', 'foam']])
    waterUniforms[uniform].value.copy(clock.look[key]).lerp(duskWater[key], k);
  waterUniforms.uNight.value = THREE.MathUtils.lerp(clock.nightness, 1, k);
}

// A local inlet opening, derived from the existing stream rather than a new terrain cut.
const mouthStart = STREAM_PATH.find((p) => getTerrainHeight(p.x, p.z) < 0.45) || STREAM_PATH[STREAM_PATH.length - 4];
const mouthEnd = STREAM_PATH[STREAM_PATH.length - 1];
export const HOME_STREAM_MOUTH = Object.freeze({ ax: mouthStart.x, az: mouthStart.z, bx: mouthEnd.x, bz: mouthEnd.z, halfWidth: STREAM_HALF_WIDTH * 1.2 });

const HEIGHT_TEX_SIZE = 384;      // home's patch: 150 u -> 0.39 u per texel (unchanged)
const ISLAND_TEX_SIZE = 320;      // big islands: 244 u -> 0.76 u per texel
const OCEAN_PAD = 450;           // outer plane reaches this far past the outermost island square (fog hides the edge by 330 u)
const INNER_SIZE = 240;          // home's finely tessellated plane (waves); every other island gets a rectangle like it
const RECT_TEXEL = 244 / 320;    // a rectangular island's height patch keeps the big islands' texel size (0.76 u)

/** Terrain rectangle covered by an island's height patch: home is the original 150 u square, the others radius + mesh margin (a rectangle when the island has halfX / halfZ). */
function patchOf(island) {
  const e = island.id === 'home' ? { halfX: WORLD_SIZE / 2, halfZ: WORLD_SIZE / 2 } : meshExtent(island);
  return { cx: island.x, cz: island.z, halfX: e.halfX, halfZ: e.halfZ, id: island.id, rect: island.id !== 'home' && isRectangular(island) };
}

/** Bake terrain height over an island's rectangle into a half-float texture (linear filtered). */
function bakeHeightTexture({ cx, cz, halfX, halfZ, id, rect }) {
  const sizeX = halfX * 2, sizeZ = halfZ * 2;
  const nx = rect ? Math.round(sizeX / RECT_TEXEL) : id === 'home' ? HEIGHT_TEX_SIZE : ISLAND_TEX_SIZE;
  const nz = rect ? Math.round(sizeZ / RECT_TEXEL) : nx;
  const fungal = id === 'duskcrown', stride = fungal ? 2 : 1;
  const mod = fungal ? getIslandModule(id) : null;
  const data = new Uint16Array(nx * nz * stride);
  for (let j = 0; j < nz; j++) {
    const z = cz - halfZ + ((j + 0.5) / nz) * sizeZ;
    for (let i = 0; i < nx; i++) {
      const x = cx - halfX + ((i + 0.5) / nx) * sizeX;
      data[(j * nx + i) * stride] = THREE.DataUtils.toHalfFloat(getTerrainHeight(x, z));
      // Only inland Duskcrown water uses the still, foam-free look. The old patches remain byte-identical.
      if (fungal) data[(j * nx + i) * stride + 1] = THREE.DataUtils.toHalfFloat(mod.layout.coastT(x - cx, z - cz) > 7 && mod.layout.cliffC(x - cx, z - cz) < -2 ? 1 : 0);
    }
  }
  const tex = new THREE.DataTexture(data, nx, nz, fungal ? THREE.RGFormat : THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Inner (waved) plane rectangles {x0, x1, z0, z1}, one per island, tiling without overlap. Home is the original +-120 square;
 * the others start as radius + 40 squares and are trimmed on the side facing an earlier rectangle.
 */
function computeInnerRects() {
  const rects = [];
  for (const island of ISLANDS) {
    const f = frameExtent(island), h = island.id === 'home' ? INNER_SIZE / 2 : Math.max(f.halfX, f.halfZ) + 40;      // (a classic island: radius + 40)
    const r = { x0: island.x - h, x1: island.x + h, z0: island.z - h, z1: island.z + h, cx: island.x, cz: island.z };
    for (const o of rects) {
      if (Math.min(r.x1, o.x1) <= Math.max(r.x0, o.x0) || Math.min(r.z1, o.z1) <= Math.max(r.z0, o.z0)) continue;   // no overlap
      if (Math.abs(r.cx - o.cx) > Math.abs(r.cz - o.cz)) { if (r.cx > o.cx) r.x0 = o.x1; else r.x1 = o.x0; }
      else if (r.cz > o.cz) r.z0 = o.z1; else r.z1 = o.z0;
    }
    rects.push(r);
  }
  return rects;
}

/** Ocean vertex shader for `n` islands: waves fade with the distance to the nearest island (uFade[i] = cx, cz, start, end). */
function oceanVert(n) {
  const dusk = ISLANDS.findIndex((i) => i.id === 'duskcrown');
  return /* glsl */`
  #include <common>
  #include <fog_pars_vertex>
  #define N_ISLANDS ${n}
  uniform float uTime;
  uniform float uWaveAmp;
  uniform sampler2D uHeight${dusk}; uniform vec4 uRect${dusk};
  uniform vec4 uFade[N_ISLANDS];
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float fade = 0.0;
    for (int k = 0; k < N_ISLANDS; k++) {
      fade = max(fade, 1.0 - smoothstep(uFade[k].z, uFade[k].w, length(wp.xz - uFade[k].xy)));
    }
    float w = sin(wp.x * 0.30 + uTime * 0.8)
            + sin(wp.z * 0.26 - uTime * 0.6)
            + sin((wp.x + wp.z) * 0.17 + uTime * 0.5);
    float marsh = texture2D(uHeight${dusk}, clamp((wp.xz - uRect${dusk}.xy) / (2.0 * uRect${dusk}.zw) + 0.5, 0.0, 1.0)).g;
    vec2 dq = abs((wp.xz - uRect${dusk}.xy) / uRect${dusk}.zw);
    if (dq.x > 1.0 || dq.y > 1.0) marsh = 0.0;
    // Duskcrown's inland water keeps a slow, low swell of its own instead of the sea's waves.
    float w2 = sin(wp.x * 0.52 + uTime * 0.55) + sin(wp.z * 0.47 - uTime * 0.42);
    if (marsh > 0.0) wp.y += uWaveAmp * fade * (w * (1.0 - marsh) + 0.7 * w2 * marsh);
    else wp.y += uWaveAmp * w * fade;
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
}

/**
 * Ocean fragment shader for `n` islands. Island i has a height patch (uHeight<i>) over the rectangle uRect<i> = (cx, cz, halfX, halfZ);
 * the pixel's depth comes from the patch that contains it, else it is open deep water. The outer plane discards where one of its
 * uHole rectangles (minX, minZ, maxX, maxZ) lies, because an inner plane draws there.
 */
function oceanFrag(n) {
  const dusk = ISLANDS.findIndex((i) => i.id === 'duskcrown');
  let decl = '';
  let pick = '';
  for (let i = 0; i < n; i++) {
    decl += `
  uniform sampler2D uHeight${i};
  uniform vec4 uRect${i};
  float tap${i}(vec2 p) { return texture2D(uHeight${i}, clamp((p - uRect${i}.xy) / (2.0 * uRect${i}.zw) + 0.5, 0.0, 1.0)).r; }
  bool in${i}(vec2 p) { vec2 q = (p - uRect${i}.xy) / (2.0 * uRect${i}.zw) + 0.5; return q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0; }`;
    pick += `${i ? ' else ' : ''}if (in${i}(p)) {
      inside = 1.0;
      terrainH = tap${i}(p);
      hx = tap${i}(p + vec2(epsW, 0.0)) - tap${i}(p - vec2(epsW, 0.0));
      hz = tap${i}(p + vec2(0.0, epsW)) - tap${i}(p - vec2(0.0, epsW));
    }`;
  }
  return /* glsl */`
  #include <common>
  #include <fog_pars_fragment>
  #define N_ISLANDS ${n}
  uniform float uLevel;
  uniform vec3 uMarshShallow; uniform vec3 uMarshDeep; uniform vec3 uMarshGlint;
  uniform float uTime;
  uniform vec4 uHole[N_ISLANDS];
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uFoam;
  uniform vec3 uShallowTint;
  uniform vec3 uDeepTint;
  uniform vec3 uFoamTint;
  uniform float uNight;
  uniform vec4 uHomeMouthSegment;
  uniform float uHomeMouthWidth;
  varying vec3 vWorld;
  ${decl}

  void main() {
    // The outer plane leaves holes where the (waved) inner planes draw, to avoid double blending.
    for (int k = 0; k < N_ISLANDS; k++) {
      if (vWorld.x > uHole[k].x && vWorld.x < uHole[k].z && vWorld.z > uHole[k].y && vWorld.z < uHole[k].w) discard;
    }

    vec2 p = vWorld.xz;
    float epsW = 0.8;
    float inside = 0.0;
    float terrainH = -3.5;
    float hx = 0.0;
    float hz = 0.0;
    ${pick}
    float depth = uLevel - terrainH;
    if (depth < -0.06) discard;

    // Wobbly depth so the foam line wiggles along the shore
    float wob = 0.07 * sin(vWorld.x * 0.9 + uTime * 1.1) * sin(vWorld.z * 0.8 - uTime * 0.9)
              + 0.04 * sin((vWorld.x - vWorld.z) * 1.7 + uTime * 1.6);
    float d = depth + wob;

    // Preserve the turquoise palette with a soft depth transition instead of contour stripes.
    float deepT = smoothstep(0.0, 3.0, depth);
    vec3 col = mix(uShallow * uShallowTint, uDeep * uDeepTint, deepT);

    // Soft lighter wave streaks on open water
    float streak = sin(vWorld.x * 0.55 + vWorld.z * 0.35 + uTime * 0.7 + 2.5 * sin(vWorld.z * 0.21 + uTime * 0.35));
    col += 0.03 * (1.0 - uNight * 0.65) * step(0.94, streak) * deepT;

    // Foam: thickness/travel are specified in world units and converted to depth units with the local
    // shore gradient (hx, hz above), so lines look equally wide on gentle beaches and steep pond banks.
    float shoreSlope = length(vec2(hx, hz)) / (2.0 * epsW);
    float g = clamp(shoreSlope, 0.06, 0.7) * inside + (1.0 - inside) * 0.2;
    float edgeAA = max(fwidth(d), 0.008);
    float rim = 1.0 - smoothstep(0.3 * g - edgeAA, 0.3 * g + edgeAA, d);
    float p1 = g * (1.4 + 1.1 * sin(uTime * 1.15));
    float p2 = g * (3.6 + 1.3 * sin(uTime * 1.15 - 1.7));
    float line1 = 1.0 - smoothstep(0.16 * g, 0.3 * g + edgeAA, abs(d - p1));
    float line2 = 1.0 - smoothstep(0.1 * g, 0.22 * g + edgeAA, abs(d - p2));
    // Traveling foam belongs at sloping banks, not on broad flat, ankle-deep sandbars.
    float bank = smoothstep(0.035, 0.12, shoreSlope);
    float foam = max(rim, max(line1 * 0.32, line2 * 0.16) * bank);
    // The shore is open where the stream enters: no white foam bar across the inlet.
    vec2 inletA = uHomeMouthSegment.xy, inletB = uHomeMouthSegment.zw;
    vec2 inletD = inletB - inletA;
    float inletT = clamp(dot(p - inletA, inletD) / max(dot(inletD, inletD), 0.001), 0.0, 1.0);
    float inletDistance = length(p - (inletA + inletD * inletT));
    float inletOpen = 1.0 - smoothstep(uHomeMouthWidth * 0.82, uHomeMouthWidth * 1.1, inletDistance);
    foam *= 1.0 - inletOpen;
    col = mix(col, uFoam * uFoamTint, foam);

    float alpha = mix(0.5, 0.97, smoothstep(0.0, 1.5, depth));
    // Keep flat wading water visibly turquoise over the pale sand, while banks stay translucent.
    alpha = max(alpha, 0.8 * (1.0 - bank) * smoothstep(0.08, 0.16, depth));
    alpha = max(alpha, foam);

    // Local branch only: the arithmetic above stays exactly the old ocean everywhere else.
    if (in${dusk}(p)) {
      float marsh = texture2D(uHeight${dusk}, clamp((p - uRect${dusk}.xy) / (2.0 * uRect${dusk}.zw) + 0.5, 0.0, 1.0)).g;
      if (marsh > 0.0) {
        vec3 still = mix(uMarshShallow, uMarshDeep, smoothstep(0.0, 1.4, depth));
        // Movement in the dark palette: drifting ripple bands, slow wandering glints and a faint ring
        // that breathes along the shore (glint-coloured, never the sea's white foam).
        float r1 = sin(p.x * 0.9 + p.y * 0.55 + uTime * 0.9 + 1.8 * sin(p.y * 0.33 + uTime * 0.27));
        float r2 = sin(p.x * -0.6 + p.y * 1.05 - uTime * 0.7 + 1.5 * sin(p.x * 0.29 - uTime * 0.21));
        float ripple = smoothstep(0.82, 0.97, r1) * 0.6 + smoothstep(0.86, 0.98, r2) * 0.4;
        float glint = pow(max(0.0, sin(p.x * 1.3 + p.y * 0.7 + uTime * 0.6) * sin(p.x * 0.8 - p.y * 1.1 - uTime * 0.45)), 10.0);
        float ring = (1.0 - step(0.06, abs(d - (0.18 + 0.1 * sin(uTime * 0.9))))) * (1.0 - smoothstep(0.0, 0.6, depth));
        still += uMarshGlint * (ripple * 0.09 + glint * 0.16 + ring * 0.12);
        col = mix(col, still, marsh);
        alpha = mix(alpha, 0.94 * smoothstep(-0.04, 0.22, depth), marsh);
      }
    }
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // Extra horizon haze: linear fog alone leaves a hard blue band at grazing view angles.
    float haze = pow(smoothstep(100.0, 330.0, length(vWorld - cameraPosition)), 0.6);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, haze);
    #include <fog_fragment>
  }
`;
}

const STREAM_VERT = /* glsl */`
  #include <common>
  #include <fog_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const STREAM_FRAG = /* glsl */`
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uFoam;
  uniform vec3 uShallowTint;
  uniform vec3 uDeepTint;
  uniform vec3 uFoamTint;
  uniform float uNight;
  varying vec2 vUv;
  void main() {
    float e = abs(vUv.x - 0.5) * 2.0;             // 0 centre .. 1 bank
    vec3 col = mix(uShallow * uShallowTint, uDeep * uDeepTint, 0.25 * (1.0 - e) + 0.05);
    float flow = sin(vUv.y * 1.6 - uTime * 2.6 + sin(vUv.x * 6.2832 + vUv.y * 0.7) * 1.3);
    col = mix(col, uFoam * uFoamTint, 0.22 * (1.0 - uNight * 0.15) * smoothstep(0.76, 0.98, flow) * (1.0 - e * 0.5));
    col = mix(col, uFoam * uFoamTint, 0.45 * smoothstep(0.78, 1.0, e));          // soft foamy banks
    gl_FragColor = vec4(col, 0.94);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/**
 * A flowing water ribbon along a path (home's stream, and in Step 37c Emberleaf's cascade and stream): a strip of quads across the path, uv.x 0..1 across (0.5 = the centre line),
 * uv.y = the distance travelled along it (the shader scrolls the foam streaks with it).
 *   path   [{ x, z, ... }]  world points, in flow order
 *   width  half width in u, a number or (i, p) => number
 *   opts.y(p, i) -> y | null   the water level at a point; null ENDS the ribbon there (it flows into a pond). Default: p.y
 *   opts.fall(p, i) -> 0..1    (optional) a per-vertex "falling / splashing" amount for the ember variant's shader (attribute aFall)
 *   opts.mouth(p, i) -> 0..1   (optional) home pond-depth fade: shares the lake wave phase and dissolves into its surface (attribute aMouth)
 * Returns a THREE.BufferGeometry (or null when fewer than two points survive); makeRibbonMaterial() builds the matching material.
 */
export function buildRibbonGeometry(path, width, opts = {}) {
  const positions = [];
  const uvs = [];
  const falls = [];
  const mouths = [];
  const indices = [];
  let dist = 0;
  let prev = null;
  let count = 0;
  const yAt = opts.y || ((p) => p.y);
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const y = yAt(p, i);
    if (y === null) break;
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    if (prev) dist += Math.hypot(p.x - prev.x, p.z - prev.z);
    prev = p;
    const hw = typeof width === 'function' ? width(i, p) : width;
    positions.push(p.x + nx * hw, y, p.z + nz * hw, p.x - nx * hw, y, p.z - nz * hw);
    uvs.push(0, dist, 1, dist);
    if (opts.fall) { const f = opts.fall(p, i); falls.push(f, f); }
    if (opts.mouth) { const amount = opts.mouth(p, i); mouths.push(amount, amount); }
    if (count > 0) {
      const k = count * 2;
      indices.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
    count++;
  }
  if (count < 2) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (opts.fall) geo.setAttribute('aFall', new THREE.Float32BufferAttribute(falls, 1));
  if (opts.mouth) geo.setAttribute('aMouth', new THREE.Float32BufferAttribute(mouths, 1));
  geo.setIndex(indices);
  return geo;
}

/** The ribbon material: home's stream look (default) or opts.falls = the ember variant (aFall attribute: faster, foamier water where it drops). One set of shared uniforms drives every ribbon. */
export function makeRibbonMaterial(uniformsShared = waterUniforms, opts = {}) {
  let vertexShader = STREAM_VERT, fragmentShader = STREAM_FRAG;
  if (opts.falls) {
    vertexShader = STREAM_VERT.replace('varying vec2 vUv;', 'varying vec2 vUv; attribute float aFall; varying float vFall;').replace('vUv = uv;', 'vUv = uv; vFall = aFall;');
    fragmentShader = STREAM_FRAG.replace('varying vec2 vUv;', 'varying vec2 vUv; varying float vFall;')
      .replace('float flow = sin(vUv.y * 1.6 - uTime * 2.6', 'float flow = sin(vUv.y * (1.6 + 1.6 * vFall) - uTime * (2.6 + 3.0 * vFall)')
      .replace('gl_FragColor = vec4(col, 0.94);', 'float churn = step(0.55, 0.5 + 0.5 * sin(vUv.y * 5.3 - uTime * 7.0 + vUv.x * 9.0)); col = mix(col, uFoam * uFoamTint, vFall * (0.35 + 0.5 * churn)); gl_FragColor = vec4(col, 0.94);');
  }
  if (opts.mouth) {
    vertexShader = vertexShader.replace('varying vec2 vUv;', 'varying vec2 vUv; attribute float aMouth; varying float vMouth; uniform float uTime;')
      .replace('vUv = uv;', 'vUv = uv; vMouth = aMouth;')
      .replace('vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);', `
        vec3 p = position;
        vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz;
        float pondWave = sin(wp.x * 0.30 + uTime * 0.8) + sin(wp.z * 0.26 - uTime * 0.6) + sin((wp.x + wp.z) * 0.17 + uTime * 0.5);
        p.y += pondWave * 0.05 * smoothstep(0.0, 0.12, aMouth);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);`);
    fragmentShader = fragmentShader.replace('varying vec2 vUv;', 'varying vec2 vUv; varying float vMouth;')
      .replace('0.45 * smoothstep(0.78, 1.0, e)', '0.45 * smoothstep(0.78, 1.0, e) * (1.0 - smoothstep(0.08, 0.45, vMouth))')
      .replace('gl_FragColor = vec4(col, 0.94);', `float mouthFade = 1.0 - smoothstep(0.1, 1.0, vMouth);
        float sideFade = 1.0 - smoothstep(mix(0.98, 0.65, vMouth), 1.0, e);
        gl_FragColor = vec4(col, 0.94 * mouthFade * sideFade);`);
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: uniformsShared.uTime,
      uShallow: { value: new THREE.Color('#7feaf2') },
      uDeep: { value: new THREE.Color(PALETTE.waterDeep) },
      uFoam: uniformsShared.uFoam,
    }]),
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: !opts.mouth,
    side: THREE.DoubleSide,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  // merge() clones uniform objects; re-link the shared ones so a single update drives everything.
  mat.uniforms.uTime = uniformsShared.uTime;
  mat.uniforms.uFoam = uniformsShared.uFoam;
  mat.uniforms.uShallowTint = uniformsShared.uShallowTint;
  mat.uniforms.uDeepTint = uniformsShared.uDeepTint;
  mat.uniforms.uFoamTint = uniformsShared.uFoamTint;
  mat.uniforms.uNight = uniformsShared.uNight;
  return mat;
}

/** A ready ribbon mesh (geometry + material), never frustum culled. */
export function buildRibbon(path, width, opts = {}) {
  const geo = buildRibbonGeometry(path, width, opts);
  const mesh = new THREE.Mesh(geo, makeRibbonMaterial(waterUniforms, opts));
  mesh.name = opts.name || 'stream';
  mesh.frustumCulled = false;
  return mesh;
}

/** Home's stream: a soft inlet overlaps the lake, follows its waves and fades before the ribbon ends. */
function buildStream() {
  return buildRibbon(STREAM_PATH, (i) => STREAM_HALF_WIDTH * 1.12 * (0.35 + 0.65 * Math.min(1, i / 4)), {   // tapers into a little spring
    mouth(p) { return Math.max(0, Math.min(1, (WATER_LEVEL - getTerrainHeight(p.x, p.z)) / 1.05)); },
    y(p) {
      const h = getHeight(p.x, p.z);
      return Math.max(h + 0.2, WATER_LEVEL + 0.012);
    },
  });
}

/** A small source cascade follows the existing plateau face into the first stream point. Purely visual: no terrain edits or registrations. */
export function buildHomeSpring() {
  const first = STREAM_PATH[0], next = STREAM_PATH[1];
  const length = Math.hypot(next.x - first.x, next.z - first.z) || 1;
  const dx = (next.x - first.x) / length, dz = (next.z - first.z) / length;
  const path = [];
  for (let i = 9; i >= 0; i--) {
    const d = i * 0.3;
    const x = first.x - dx * d, z = first.z - dz * d;
    path.push({ x, z, y: getHeight(x, z) + 0.16 });
  }
  // The final lip meets the original stream at exactly the same surface height.
  path[path.length - 1].y = getHeight(first.x, first.z) + 0.2;
  const mesh = buildRibbon(path, 0.46, { name: 'home-spring-cascade' });
  mesh.renderOrder = 2;
  return mesh;
}

/**
 * Creates the ocean (+pond / lagoon, which are just carved parts of the terrain) and the stream ribbon.
 * Returns { group, heightTexture (home's patch), heightTextures: {islandId: texture}, setTimeOfDay(clock), update(t) } where t is elapsed seconds.
 */
export function createWater() {
  const group = new THREE.Group();
  group.name = 'water';

  const n = ISLANDS.length;
  const patches = ISLANDS.map(patchOf);
  const heightTexs = patches.map(bakeHeightTexture);
  const rects = computeInnerRects();
  const shared = waterUniforms;
  // Wave fade per island: home keeps its original 80..105 u falloff (radius + 25 .. radius + 50), the big islands radius + 10 .. + 35
  // so the waves are gone before the edge of their inner rectangle.
  const fade = ISLANDS.map((i) => {
    const f = frameExtent(i), r = Math.max(f.halfX, f.halfZ);        // (a classic island: radius)
    return i.id === 'home' ? new THREE.Vector4(i.x, i.z, i.radius + 25, i.radius + 50) : new THREE.Vector4(i.x, i.z, r + 10, r + 35);
  });
  const rectUniforms = patches.map((pt) => new THREE.Vector4(pt.cx, pt.cz, pt.halfX, pt.halfZ));
  const NO_HOLE = () => ISLANDS.map(() => new THREE.Vector4(1, 1, -1, -1));
  const vert = oceanVert(n), frag = oceanFrag(n);

  function makeOceanMaterial(holes, waveAmp) {
    const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uLevel: { value: WATER_LEVEL },
      uMarshShallow: { value: new THREE.Color(DUSK_WATER.shallow) },
      uMarshDeep: { value: new THREE.Color(DUSK_WATER.deep) },
      uMarshGlint: { value: new THREE.Color(DUSK_WATER.glint) },
      uWaveAmp: { value: waveAmp },
      uHomeMouthSegment: { value: new THREE.Vector4(HOME_STREAM_MOUTH.ax, HOME_STREAM_MOUTH.az, HOME_STREAM_MOUTH.bx, HOME_STREAM_MOUTH.bz) },
      uHomeMouthWidth: { value: HOME_STREAM_MOUTH.halfWidth },
      uShallow: { value: new THREE.Color(PALETTE.waterShallow) },
      uDeep: { value: new THREE.Color(PALETTE.waterDeep) },
    }]);
    for (let i = 0; i < n; i++) {
      u[`uHeight${i}`] = { value: heightTexs[i] };
      u[`uRect${i}`] = { value: rectUniforms[i] };
    }
    u.uHole = { value: holes };
    u.uFade = { value: fade };
    u.uTime = shared.uTime;
    u.uFoam = shared.uFoam;
    u.uShallowTint = shared.uShallowTint;
    u.uDeepTint = shared.uDeepTint;
    u.uFoamTint = shared.uFoamTint;
    u.uNight = shared.uNight;
    return new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      fog: true,
    });
  }

  // Inner: detailed planes (one rectangle per island, 2u cells: waves are >20u long, foam is per-pixel) with gentle vertex waves.
  ISLANDS.forEach((island, i) => {
    const r = rects[i];
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    const geo = new THREE.PlaneGeometry(w, d, Math.round(w / 2), Math.round(d / 2));
    geo.rotateX(-Math.PI / 2);
    const inner = new THREE.Mesh(geo, makeOceanMaterial(NO_HOLE(), 0.05));
    inner.position.set((r.x0 + r.x1) / 2, WATER_LEVEL, (r.z0 + r.z1) / 2);
    inner.name = i === 0 ? 'ocean-inner' : `ocean-inner-${island.id}`;
    inner.renderOrder = 1;
    inner.frustumCulled = true;      // Step 27b: an inner plane off screen is skipped (its waves are far smaller than its bounds)
    group.add(inner);
  });

  // Outer: huge flat plane out to the horizon, centred on the archipelago, with a hole (1 u smaller all round) for every inner rectangle.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const pt of patches) {
    minX = Math.min(minX, pt.cx - pt.halfX); maxX = Math.max(maxX, pt.cx + pt.halfX);
    minZ = Math.min(minZ, pt.cz - pt.halfZ); maxZ = Math.max(maxZ, pt.cz + pt.halfZ);
  }
  const ox = (minX + maxX) / 2, oz = (minZ + maxZ) / 2;
  const oHalf = Math.max(maxX - minX, maxZ - minZ) / 2 + OCEAN_PAD;
  const outerGeo = new THREE.PlaneGeometry(oHalf * 2, oHalf * 2, 1, 1);
  outerGeo.rotateX(-Math.PI / 2);
  const holes = rects.map((r) => new THREE.Vector4(r.x0 + 1, r.z0 + 1, r.x1 - 1, r.z1 - 1));
  const outer = new THREE.Mesh(outerGeo, makeOceanMaterial(holes, 0));
  outer.position.set(ox, WATER_LEVEL - 0.02, oz);
  outer.name = 'ocean-outer';
  outer.frustumCulled = false;
  group.add(outer);

  const stream = buildStream();
  stream.renderOrder = 2;
  group.add(stream);
  group.add(buildHomeSpring());

  let motion = 1, lastTime = null, visualTime = 0;
  const heightTextures = {};
  ISLANDS.forEach((island, i) => { heightTextures[island.id] = heightTexs[i]; });
  return {
    group,
    heightTexture: heightTexs[0],
    heightTextures,
    setTimeOfDay: setWaterLook,
    /** Visual-only calm-to-lively water. Preserve phase when adjusted, and keep the day clock untouched. */
    setMotion(value) {
      const n = Number(value);
      if (Number.isFinite(n)) motion = THREE.MathUtils.clamp(n, 0, 1);
      return motion;
    },
    get motion() { return motion; },
    update(t) {
      if (!Number.isFinite(t)) return;
      if (lastTime === null || t < lastTime) visualTime = t;
      else visualTime += (t - lastTime) * (0.2 + 0.8 * motion);
      lastTime = t;
      shared.uTime.value = visualTime;
    },
  };
}
