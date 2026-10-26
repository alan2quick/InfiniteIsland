// Duskcrown canopy (69b): one opaque mist lid shared by full/far views, one shader-driven spore layer, no lights.
// createDuskAtmosphere({scene,island}) -> {update(t,w,view,height,camera,px,fogColor), lid(on), mesh, spores, dispose()}.
// duskUniforms.uGlow is the always-on breathing glow contract for the future 69c/d flora.
// Step 85a: the Crownlands' relief and kopjes rise above the old flat 48 u lid, so each lid vertex follows the plateau's envelope (crownLayout lidTop, an 8 u max filter) plus
// DUSK_LIGHT.lidClear: the rim band keeps the lid at exactly lidHeight, so every marsh and boat view still sees the same unbroken cap.
import * as THREE from 'three';
import { DUSK_LIGHT } from '../../config.js';
import { createDuskLayout } from './duskLayout.js';
import { getCrownLayout } from './crownLayout.js';
import { createNoise2D } from '../../utils/noise.js';
import { mulberry32 } from '../../utils/rng.js';

export const duskUniforms = { uGlow: { value: DUSK_LIGHT.glow } };

/** March the cliff/coast signed fields, preserving the horseshoe's concavity.
 * The contour lies within the steep wall: the top is covered with room for oblique
 * views, but smoothing cannot project the canopy onto the walkable cliff foot.
 * Linear edge intersections remove cell steps; all clipped cells share one mesh.
 */
export function buildDuskLidGeometry(island) {
  const layout = createDuskLayout(island), { halfX, halfZ } = layout.bounds, crown = getCrownLayout(island, layout);
  // Use the terrain's cliff perturbation, so alcoves/buttresses agree with its wall.
  const noise = createNoise2D(island.seed + 53), cell = 1, p = [];
  const nx = Math.ceil(2 * halfX / cell), nz = Math.ceil(2 * halfZ / cell);
  const field = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = -halfX + i * cell, z = -halfZ + j * cell;
    field[j * (nx + 1) + i] = Math.min(
      layout.cliffC(x, z) + 1.5 * noise(x * 0.11, z * 0.11) - 0.6,
      layout.coastT(x, z) - 2.0);
  }
  // A compact binomial blur rounds sub-cell kinks without filling the concavity.
  // Its one-cell support is smaller than the unused width of the sheer wall.
  const smooth = new Float32Array(field.length), weights = [1,2,1];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    let value = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++)
      value += field[Math.max(0,Math.min(nz,j+dz))*(nx+1)+Math.max(0,Math.min(nx,i+dx))] * weights[dx+1] * weights[dz+1];
    smooth[j*(nx+1)+i] = value / 16;
  }
  field.set(smooth);
  const lidY = (x, z) => Math.max(DUSK_LIGHT.lidHeight, crown.lidTop(x, z) + DUSK_LIGHT.lidClear);
  const emit = (a, b, c) => { for (const q of [a,b,c]) p.push(q[0], lidY(q[0], q[1]), q[1]); };
  const clip = (tri) => {
    const out = [];
    for (let i = 0; i < tri.length; i++) {
      const a = tri[i], b = tri[(i + 1) % tri.length];
      if (a[2] >= 0) out.push(a);
      if ((a[2] >= 0) !== (b[2] >= 0)) {
        const t = a[2] / (a[2] - b[2]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0]);
      }
    }
    for (let i = 1; i + 1 < out.length; i++) emit(out[0], out[i], out[i + 1]);
  };
  const corner = (i,j) => [-halfX + i * cell, -halfZ + j * cell, field[j * (nx + 1) + i]];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = corner(i,j), b = corner(i+1,j), c = corner(i+1,j+1), d = corner(i,j+1);
    if ([a,b,c,d].every(q => q[2] >= 0)) {
      // Batch interior runs, capped at 8 u to retain the lid shader's wave detail.
      let end = i + 1;
      // (strips stop at multiples of 8 cells, so neighbouring rows share their vertices and the raised lid of Step 85a has no cracks)
      while (end < nx && end % 8 !== 0 && field[j*(nx+1)+end+1] >= 0 && field[(j+1)*(nx+1)+end+1] >= 0) end++;
      const e = corner(end,j), f = corner(end,j+1);
      emit(a,d,e); emit(e,d,f); i = end - 1;
    } else { clip([a,d,b]); clip([b,d,c]); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p,3));
  geo.computeBoundingSphere(); geo.boundingSphere.radius += DUSK_LIGHT.lidWave;
  return geo;
}

export function createDuskAtmosphere({ scene, island }) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(DUSK_LIGHT.fog) },
      uWave: { value: DUSK_LIGHT.lidWave }, uSpeed: { value: DUSK_LIGHT.lidSpeed },
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
    vertexShader: `uniform float uTime; uniform float uWave; uniform float uSpeed; varying vec2 vMist;
      #include <fog_pars_vertex>
      void main() {
        vMist = position.xz;
        vec3 p = position;
        p.y += uWave * sin(p.x * 0.065 + uTime * uSpeed) * cos(p.z * 0.07 - uTime * uSpeed);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime; uniform vec3 uColor; uniform float uSpeed; varying vec2 vMist;
      #include <fog_pars_fragment>
      void main() {
        float mist = sin(vMist.x * 0.055 + uTime * uSpeed) * cos(vMist.y * 0.09 - uTime * uSpeed * 0.7);
        gl_FragColor = vec4(uColor * (1.06 + 0.08 * mist), 1.0);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, fog: true, depthWrite: true,
  });
  const mesh = new THREE.Mesh(buildDuskLidGeometry(island), mat);
  mesh.name = 'dusk-cloud-lid'; mesh.position.set(island.x, 0, island.z); scene.add(mesh);

  const rng = mulberry32(island.seed + 69), seeds = new Float32Array(DUSK_LIGHT.spores * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rng();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(DUSK_LIGHT.spores * 3), 3));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4));
  const sporeMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uWeight: { value: 0 }, uScale: { value: 600 }, uCenter: { value: new THREE.Vector3() },
      uOpacity: { value: DUSK_LIGHT.sporeOpacity }, uDensity: { value: DUSK_LIGHT.sporeDensity }, uBox: { value: new THREE.Vector3(...DUSK_LIGHT.sporeBox) },
      uCyan: { value: new THREE.Color(DUSK_LIGHT.palette[0]) }, uViolet: { value: new THREE.Color(DUSK_LIGHT.palette[1]) }, uWarm: { value: new THREE.Color(DUSK_LIGHT.palette[2]) } },
    vertexShader: `attribute vec4 aSeed; uniform float uTime; uniform float uWeight; uniform float uScale;
      uniform float uDensity; uniform vec3 uCenter; uniform vec3 uBox; varying float vAlpha; varying float vKind;
      void main() {
        vec3 box = uBox;
        vec3 q = mod(aSeed.xyz * box + vec3(uTime * 0.13, uTime * 0.065, uTime * 0.09), box) - box * 0.5;
        q.x += sin(uTime * 0.23 + aSeed.w * 25.0) * 0.9;
        vec3 edgeQ = abs(q) / (box * 0.5);
        float edge = 1.0 - smoothstep(0.65, 1.0, max(max(edgeQ.x, edgeQ.z), edgeQ.y));
        vKind = aSeed.w; vAlpha = edge * uWeight * step(aSeed.w, uDensity) * (0.65 + 0.35 * sin(uTime * 0.5 + aSeed.x * 30.0));
        vec4 mv = viewMatrix * vec4(uCenter + q, 1.0);
        gl_Position = projectionMatrix * mv; gl_PointSize = clamp((0.06 + aSeed.z * 0.07) * uScale / max(0.1, -mv.z), 1.5, 12.0);
      }`,
    fragmentShader: `uniform vec3 uCyan; uniform vec3 uViolet; uniform vec3 uWarm; uniform float uOpacity;
      varying float vAlpha; varying float vKind;
      void main() {
        float a = (1.0 - smoothstep(0.15, 1.0, length(gl_PointCoord * 2.0 - 1.0))) * vAlpha * uOpacity;
        if (a < 0.01) discard;
        vec3 c = vKind < 0.10 ? uCyan : (vKind < 0.22 ? uViolet : uWarm);
        gl_FragColor = vec4(c, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  });
  const spores = new THREE.Points(geo, sporeMat);
  spores.name = 'dusk-spores'; spores.frustumCulled = false; spores.visible = false; scene.add(spores);
  return {
    mesh, spores,
    lid(on = true) { mesh.visible = !!on; return mesh.visible; },
    update(t, w, v, height, camera, px, fogColor) {
      mat.uniforms.uTime.value = t;
      if (fogColor) mat.uniforms.uColor.value.copy(fogColor);
      spores.visible = w > 0.01;
      const u = sporeMat.uniforms; u.uTime.value = t; u.uWeight.value = w;
      u.uCenter.value.set(v.x, Math.max(0, height(v.x, v.z)) + 5, v.z);
      if (camera && px) u.uScale.value = px / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    },
    dispose() { mesh.removeFromParent(); spores.removeFromParent(); mesh.geometry.dispose(); mat.dispose(); geo.dispose(); sporeMat.dispose(); },
  };
}
