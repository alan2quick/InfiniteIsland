// Shared wind: one time uniform + a helper that patches a (cloned) toon material so vertices sway with the wind.
// Displacement is applied in WORLD space after the model/instance transform, scaled by the vertex height above the
// object's base (so roots stay planted) and phase-shifted by the instance position (so the meadow ripples).
export const windTime = { value: 0 };
export const windStrength = { value: 0.5 };
export function setWindStrength(value) {
  const n = Number(value);
  if (Number.isFinite(n)) windStrength.value = Math.max(0, Math.min(1, n));
  return windStrength.value;
}

/**
 * Make `mat` sway. `amp` is the world-space tip displacement per unit^1.5 of height. Works on plain meshes
 * (phase 0) and InstancedMesh (phase from instance position). `variation` opts grass into independent
 * frequency/amplitude/phase and slight static curvature. Other plants keep their established motion. Returns the material.
 */
export function applySway(mat, { amp = 0.15, speed = 1, variation = false } = {}) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windTime;
    shader.uniforms.uWindStrength = windStrength;
    shader.uniforms.uWindAmp = { value: amp };
    shader.uniforms.uWindSpeed = { value: speed };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uWindTime;
        uniform float uWindStrength;
        uniform float uWindAmp;
        uniform float uWindSpeed;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 wIP = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
            float wSc = length(vec3(instanceMatrix[1]));
          #else
            vec3 wIP = vec3(0.0);
            float wSc = 1.0;
          #endif
          float wH = max(position.y, 0.0) * wSc;
          float wT = uWindTime * uWindSpeed;
          float wPh = wIP.x * 0.31 + wIP.z * 0.23;
          ${variation ? `// Stable instance seeds decorrelate neighbouring tufts without extra attributes or CPU updates.
          vec3 wSeed = fract(vec3(wIP.x, wIP.z, wIP.x + wIP.z) * vec3(0.1031, 0.1030, 0.0973));
          wSeed += vec3(dot(wSeed, wSeed.yxz + vec3(33.33)));
          wSeed = fract((wSeed.xxy + wSeed.yxx) * wSeed.zyx);
          wT *= mix(0.72, 1.24, wSeed.y);
          wPh += wSeed.x * 6.2831853 + dot(position.xz, vec2(1.7, 2.3));` : ''}
          float gust = 0.65 + 0.35 * sin(uWindTime * 0.35 + wIP.x * 0.05);
          vec2 wo = vec2(
            sin(wT * 1.9 + wPh) * 0.7 + sin(wT * 3.3 + wPh * 1.7) * 0.3 + 0.3,
            cos(wT * 1.5 + wPh * 0.8) * 0.4 + sin(wT * 2.7 + wPh * 1.3) * 0.2
          ) * gust * uWindAmp * (uWindStrength * 2.0) * pow(wH, 1.5)${variation ? ' * mix(0.6, 1.15, wSeed.z)' : ''};
          ${variation ? `// A small static bend adds shape variety even when the breeze slider is zero; roots stay fixed.
          wo += (wSeed.xz - 0.5) * 0.12 * wH * wH;` : ''}
          mvPosition.xyz += (viewMatrix * vec4(wo.x, 0.0, wo.y, 0.0)).xyz;
          gl_Position = projectionMatrix * mvPosition;
        }`);
  };
  mat.customProgramCacheKey = () => variation ? 'sway-grass-varied-v1' : 'sway';
  return mat;
}

/** Clone a material and make the clone sway (the original stays untouched and shareable). */
export function swayClone(mat, opts) {
  return applySway(mat.clone(), opts);
}

// Tree / palm wobble: gentle whole-prop tilt about the base. Composes with interaction shakes (those rotate the child mesh).
export function wobbleGroup(g, t, amp, phase) {
  const gust = (0.7 + 0.3 * Math.sin(t * 0.23 + phase)) * windStrength.value * 2;
  g.rotation.x = Math.sin(t * 0.85 + phase) * amp * gust;
  g.rotation.z = Math.sin(t * 0.63 + phase * 1.7 + 1.1) * amp * gust;
}
