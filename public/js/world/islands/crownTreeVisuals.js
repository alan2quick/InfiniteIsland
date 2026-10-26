// Rebuildable visuals of the Crownlands' acacias and baobabs (Step 85d). Gameplay identity (trunk colliders) lives in duskWorld.js (registerCrownTreeGameplay) and is registered once; this file only draws.
//
//   const v = buildCrownTreeVisuals(island, placement)  -> { group (full detail), far (one blob mesh), caps, setLayers(on), fadeStep(), summary(), dispose() }
//   crownTreeFade.update(dt, camera.position, points)    once per frame from main.js (points = the local players' chest points { x, y, z }): eases the canopy fade of every tree whose canopy covers a
//                                                        player or sits between the camera and one (rules: duskFade.js, the same as the marsh mushrooms), written into the per-instance `iInst.x`
//   crownTreeFade.enabled = false  (__game.dusk.crown.treeFade(false)) turns the fade off for comparison;  crownTreeFade.settle(cam, points) jumps to the final fade at once (tests / screenshots)
//
// Lid gating: the trees are part of the plateau's secret (like the elevated water): they are drawn only while the cloud lid is off (crownLayers.js attachExtra) and never fade while hidden.
// Cost: chunks of CROWN_TREES.chunk (80 u) x variants: 1 InstancedMesh (casts + receives the sun shadow) + 1 outline InstancedMesh per chunk and variant. No lights. TWO new programs: the tree toon
// material (family colours, sway, fade, night speckles) and its outline; everything else is shared.
//
// The toon material reads the vertex role `aRole` + `color` (crownTreeAssets.js) and the per-instance `iInst` = (fade 0..1, canopy family 0..3, bark colour 0..5, 0):
//   * colour -> the family tables below (CROWN_TREES in config.js): bark = BARK[bark] x shade; canopy / tuft = mix(top, rim, rimMix) x shade, so one program draws every family;
//   * fade   -> screen-door discard of canopies and tufts with interleaved gradient noise from gl_FragCoord (no blending); trunks, limbs and branches never fade;
//   * sway   -> canopies and tufts only, in world space after the instance transform, from the shared props wind clock (world/wind.js windTime) so the hull follows exactly;
//   * night  -> faint bioluminescent speckles on the light rims / upper tufts, emissive = duskUniforms.uCrownNight (crown weight x darkness: 0 by day and in the marsh).
import * as THREE from 'three';
import { CROWN_TREES, PALETTE } from '../../config.js';
import { G, part, combine, VERTEX_TOON } from '../../render/geo.js';
import { windTime } from '../wind.js';
import { duskUniforms } from './duskAtmosphere.js';
import { getCrownTree } from './crownTreeAssets.js';
import { TREE, fadeRecord } from './crownPlacement.js';
import { fadeTargets, stepFade } from './duskFade.js';
import { crownLayers } from './crownLayers.js';
import { groupIntoChunks } from '../propChunks.js';

const VARIANTS = Object.keys(TREE);
const lin = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };
const TABLES = `const vec3 CAN_TOP[4] = vec3[4](${CROWN_TREES.families.map((f) => lin(f.top)).join(', ')});
const vec3 CAN_RIM[4] = vec3[4](${CROWN_TREES.families.map((f) => lin(f.rim)).join(', ')});
const vec3 BARK[6] = vec3[6](${CROWN_TREES.barks.map(lin).join(', ')});`;
const GLSL_DITHER = (v) => `if (${v} > 0.001) { float dn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); if (dn < ${v}) discard; }`;
const SWAY_VARS = 'uniform float uWindTime;\nuniform float uSwayAmp;\nuniform float uSwaySpeed;';
/** World-space sway of a canopy vertex (aRole > 0.5), added after the instance transform; the outline hull runs the same code, so it never detaches. */
const SWAY = `if (aRole > 0.5) {
    vec3 wIP = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    float wSc = length(vec3(instanceMatrix[1]));
    float wT = uWindTime * uSwaySpeed, wPh = wIP.x * 0.31 + wIP.z * 0.23;
    float gust = 0.65 + 0.35 * sin(uWindTime * 0.35 + wIP.x * 0.05);
    float flex = 0.6 + 0.4 * clamp(length(position.xz) * 0.25, 0.0, 1.0);
    vec2 wo = vec2(sin(wT * 1.9 + wPh + position.x * 0.5) * 0.7 + sin(wT * 3.1 + wPh * 1.7 + position.z * 0.6) * 0.3 + 0.3, cos(wT * 1.5 + wPh * 0.8) * 0.5) * gust * uSwayAmp * wSc * flex;
    mvPosition.xyz += (viewMatrix * vec4(wo.x, 0.0, wo.y, 0.0)).xyz;
    gl_Position = projectionMatrix * mvPosition;
  }`;

export function patchTreeToon(shader) {
  const S = CROWN_TREES.sway, K = CROWN_TREES.speckle;
  shader.uniforms.uCrownNight = duskUniforms.uCrownNight;
  shader.uniforms.uWindTime = windTime;
  shader.uniforms.uSwayAmp = { value: S.amp };
  shader.uniforms.uSwaySpeed = { value: S.speed };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
${TABLES}
${SWAY_VARS}
attribute float aRole;
attribute vec4 iInst;
varying float vRole;
varying float vFade;
varying float vRimK;
varying vec2 vSpeckP;
varying vec3 vSpeckCol;`)
    .replace('#include <color_vertex>', `#include <color_vertex>
  vRole = aRole;
  vFade = aRole > 0.5 ? iInst.x : 0.0;
  int fam = int(iInst.y + 0.5);
  int bark = int(iInst.z + 0.5);
  // (.rgb: three 0.186 declares vColor as a vec4 for instanced meshes)
  if (aRole < 0.5) vColor.rgb = BARK[bark] * color.r;
  else vColor.rgb = mix(CAN_TOP[fam], CAN_RIM[fam], color.r) * color.g;
  vRimK = aRole > 0.5 ? color.r : 0.0;
  vSpeckP = position.xz;
  vSpeckCol = mix(CAN_RIM[fam], vec3(1.0), 0.3);`)
    .replace('#include <project_vertex>', `#include <project_vertex>
  ${SWAY}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
uniform float uCrownNight;
uniform float uWindTime;
varying float vRole;
varying float vFade;
varying float vRimK;
varying vec2 vSpeckP;
varying vec3 vSpeckCol;`)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n  ${GLSL_DITHER('vFade')}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  if (vRole > 0.5 && uCrownNight > 0.01) {
    vec2 sc = vSpeckP / ${K.cell.toFixed(3)};
    vec2 sid = floor(sc);
    float sh = fract(sin(dot(sid, vec2(12.9898, 78.233))) * 43758.5453);
    float dotK = (1.0 - smoothstep(0.14, 0.34, length(fract(sc) - 0.5))) * step(1.0 - ${K.density.toFixed(3)}, sh);
    float tw = 0.6 + 0.4 * sin(uWindTime * 1.3 + sh * 40.0);
    totalEmissiveRadiance += vSpeckCol * dotK * tw * smoothstep(0.3, 0.75, vRimK) * uCrownNight * ${K.strength.toFixed(3)};
  }`);
}
const solidKey = () => 'crownTree';

let solidMat = null, outlineMat = null;
export function treeMaterials() {
  if (!solidMat) {
    solidMat = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: VERTEX_TOON.gradientMap, vertexColors: true });
    solidMat.onBeforeCompile = patchTreeToon; solidMat.customProgramCacheKey = solidKey;
    outlineMat = new THREE.MeshBasicMaterial({ color: PALETTE.outline, side: THREE.BackSide });
    outlineMat.onBeforeCompile = (shader) => {
      shader.uniforms.uThick = { value: CROWN_TREES.outline };
      shader.uniforms.uWindTime = windTime; shader.uniforms.uSwayAmp = { value: CROWN_TREES.sway.amp }; shader.uniforms.uSwaySpeed = { value: CROWN_TREES.sway.speed };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uThick;\n${SWAY_VARS}\nattribute float aRole;\nattribute vec4 iInst;\nvarying float vFade;`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += normalize(normal) * uThick;\n  vFade = aRole > 0.5 ? iInst.x : 0.0;')
        .replace('#include <project_vertex>', `#include <project_vertex>\n  ${SWAY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFade;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n  ${GLSL_DITHER('vFade')}`);
    };
    outlineMat.customProgramCacheKey = () => 'crownTreeOutline';
  }
  return { solidMat, outlineMat };
}

/** The shared canopy-fade controller: the CURRENT tree visuals register their canopy records here (rebuild-safe: dispose() clears it). */
export const crownTreeFade = {
  current: null, enabled: true,
  update(dt, cam, points) { return this.current ? this.current.fadeStep(dt, cam, points, this.enabled) : 0; },
  settle(cam, points) { return this.current ? this.current.fadeStep(1e3, cam, points, this.enabled) : 0; },
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

/** A geometry sharing every attribute of `base` plus its own per-instance `iInst`. */
function chunkGeometry(base, inst) {
  const g = new THREE.BufferGeometry();
  for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
  if (base.index) g.setIndex(base.index);
  g.setAttribute('iInst', inst);
  g.boundingBox = base.boundingBox; g.boundingSphere = base.boundingSphere;
  return g;
}

export function buildCrownTreeVisuals(island, placement) {
  const group = new THREE.Group(), far = new THREE.Group();
  group.name = 'crown-trees'; far.name = 'crown-far-trees';
  const { solidMat: sm, outlineMat: om } = treeMaterials();
  const origin = { x: island.x - 200, z: island.z - 140 };
  const caps = [], meshes = [], geos = [], perVariant = {};
  for (const variant of VARIANTS) {
    const a = getCrownTree(variant), list = placement.items.filter((i) => i.variant === variant);
    perVariant[variant] = 0;
    for (const [key, items] of groupIntoChunks(list, origin, CROWN_TREES.chunk)) {
      const inst = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 4), 4);
      const gm = chunkGeometry(a.geo, inst), go = chunkGeometry(a.outlineGeo, inst);
      const mesh = new THREE.InstancedMesh(gm, sm, items.length), hull = new THREE.InstancedMesh(go, om, items.length);
      items.forEach((it, i) => {
        _q.setFromAxisAngle(_up, it.rot); _p.set(it.x, it.y, it.z); _s.set(it.s, it.s, it.s);
        mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
        inst.setXYZW(i, 0, it.fam, it.bark, 0);
        caps.push({ rec: fadeRecord(it), inst, i, cur: 0, id: it.id });
      });
      mesh.instanceMatrix.needsUpdate = true;
      hull.instanceMatrix = mesh.instanceMatrix; hull.renderOrder = -1;
      mesh.castShadow = true; mesh.receiveShadow = true; hull.castShadow = false; hull.receiveShadow = false;
      for (const o of [mesh, hull]) { o.computeBoundingSphere(); o.computeBoundingBox(); o.boundingSphere.radius += 1.2; }     // (+ the sway)
      mesh.name = `crown-${variant}-${key}`; hull.name = `crown-${variant}-outline-${key}`;
      group.add(mesh, hull); meshes.push(mesh, hull); geos.push(gm, go);
      perVariant[variant] += items.length;
    }
  }

  // ---- far: ONE merged blob mesh (a flat family-coloured crown on a stub) in the shared vertex toon material
  const fam = CROWN_TREES.families, bark = CROWN_TREES.barks;
  const blobs = placement.items.map((it) => {
    const top = fam[it.fam].top, out = [];
    if (it.type === 'acacia') {
      out.push(part(G.cyl6, bark[it.bark], { p: [it.x, (it.y + it.capUnder) / 2, it.z], s: [0.5 * it.s, it.capUnder - it.y, 0.5 * it.s] }));
      out.push(part(G.ico1, top, { p: [it.x, it.capUnder + (it.capTop - it.capUnder) * 0.4, it.z], s: [it.canopyR, (it.capTop - it.capUnder) * 0.6, it.canopyR] }));
    } else {
      out.push(part(G.cyl6, bark[it.bark], { p: [it.x, it.y + it.height * 0.38, it.z], s: [it.trunkR, it.height * 0.78, it.trunkR] }));
      out.push(part(G.ico1, top, { p: [it.x, it.y + it.height * 0.86, it.z], s: [it.canopyR * 0.8, it.height * 0.14, it.canopyR * 0.8] }));
    }
    return out;
  }).flat();
  const farGeo = combine(blobs);
  const farMesh = new THREE.Mesh(farGeo, VERTEX_TOON); farMesh.name = 'far-crown-trees'; farMesh.castShadow = false; farMesh.receiveShadow = false;
  far.add(farMesh);

  const targets = new Float32Array(caps.length), recs = caps.map((c) => c.rec);
  const drawn = () => { for (let o = group; o; o = o.parent) if (!o.visible) return false; return true; };
  const api = {
    group, far, caps,
    /** Show / hide the trees (the cloud lid decides: crownLayers.js). */
    setLayers(on) { group.visible = !!on; far.visible = !!on; },
    /** Ease every canopy's fade towards its target; returns how many canopies are (partly) faded. Nothing runs while the trees are hidden. */
    fadeStep(dt, cam, points, enabled) {
      if (!drawn()) return 0;
      if (enabled && points.length) fadeTargets(recs, cam, points, CROWN_TREES.fadeMargin, targets); else targets.fill(0);
      let faded = 0;
      const dirty = new Set();
      for (let k = 0; k < caps.length; k++) {
        const c = caps[k], next = stepFade(c.cur, targets[k], dt, CROWN_TREES.fadeRate);
        if (next !== c.cur) { c.cur = next; c.inst.setX(c.i, next); dirty.add(c.inst); }
        if (c.cur > 0.001) faded++;
      }
      for (const x of dirty) x.needsUpdate = true;
      return faded;
    },
    summary() {
      const per = {};
      for (const m of meshes) if (!m.name.includes('outline')) per[m.name] = m.count;
      const tri = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
      return {
        items: placement.items.length, caps: caps.length, faded: caps.filter((c) => c.cur > 0.001).length, meshes: meshes.length, drawCalls: meshes.length, byVariant: perVariant, chunks: per,
        triangles: meshes.reduce((n, m) => n + (m.name.includes('outline') ? 0 : tri(m.geometry) * m.count), 0), farTriangles: tri(farGeo), visible: group.visible, fade: crownTreeFade.enabled,
      };
    },
    dispose() {
      if (crownTreeFade.current === api) crownTreeFade.current = null;
      crownLayers.detachExtra(api);
      for (const m of meshes) m.dispose();
      for (const g of geos) g.dispose(); farGeo.dispose();
      group.removeFromParent(); far.removeFromParent();
    },
  };
  crownTreeFade.current = api;
  crownLayers.attachExtra(api);
  return api;
}
