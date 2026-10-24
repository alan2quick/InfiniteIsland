// Sky dome, fog, lights (hemisphere + shadowed sun) and drifting low-poly clouds.
import * as THREE from 'three';
import { PALETTE, SHADOW_MAP_SIZE, CAMERA_FAR } from '../config.js';
import { skyStars, constellations } from '../game/boatSightLogic.js';
import { mulberry32, range } from '../utils/rng.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getGradientMap } from '../render/toon.js';

const SKY_RADIUS = CAMERA_FAR * 0.92;
const FOG_NEAR = 140;
const FOG_FAR = 330;
const CLOUD_WRAP = 260;

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */`
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunDirection;
  uniform vec3 uMoonDirection;
  uniform float uSunVisible;
  uniform float uMoonVisible;
  uniform float uWarmth;
  varying vec3 vDir;
  void main() {
    float y = max(vDir.y, 0.0);
    float t = smoothstep(0.0, 0.7, pow(y, 0.75));
    vec3 d = normalize(vDir);
    vec3 col = mix(uHorizon, uTop, t);
    col += vec3(0.16, 0.035, 0.008) * exp(-abs(d.y) * 12.0) * uWarmth;
    float sunDot = max(0.0, dot(d, uSunDirection));
    float sunDisc = smoothstep(0.9994, 0.99965, sunDot) * uSunVisible;
    col += vec3(1.0, 0.5, 0.18) * pow(sunDot, 220.0) * 0.22 * uSunVisible;
    col = mix(col, vec3(1.0, 0.86, 0.46), sunDisc);
    float moonDot = max(0.0, dot(d, uMoonDirection));
    float moonDisc = smoothstep(0.99945, 0.99965, moonDot) * uMoonVisible;
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDirection));
    vec3 up = cross(uMoonDirection, right);
    vec2 q = vec2(dot(d, right), dot(d, up)) / 0.028;
    float craters = (1.0 - smoothstep(0.16, 0.23, length(q - vec2(-0.35, 0.25))))
                  + (1.0 - smoothstep(0.23, 0.3, length(q - vec2(0.25, -0.28))));
    col += vec3(0.28, 0.42, 0.7) * pow(moonDot, 250.0) * 0.2 * uMoonVisible;
    col = mix(col, vec3(0.82, 0.89, 1.0) - craters * 0.12, moonDisc);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

function buildCloud(rng) {
  const cloud = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({
    color: '#ffffff',
    emissive: '#ffd6ea',
    emissiveIntensity: 0.32,
    gradientMap: getGradientMap(),
  });
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const puffs = 5 + Math.floor(rng() * 3);
  const spread = range(rng, 5, 7);
  // Puffs are baked into ONE geometry per cloud (1 draw call instead of 5-7).
  const parts = [];
  const dummy = new THREE.Object3D();
  for (let i = 0; i < puffs; i++) {
    const u = puffs === 1 ? 0 : i / (puffs - 1) - 0.5;
    const size = range(rng, 3.2, 4.6) * (1 - Math.abs(u) * 0.9);
    dummy.position.set(u * spread * 2, size * 0.25 + range(rng, -0.4, 0.8), range(rng, -1.5, 1.5));
    dummy.scale.set(size, size * 0.75, size * 0.9);
    dummy.rotation.y = rng() * Math.PI;
    dummy.updateMatrix();
    parts.push(geo.clone().applyMatrix4(dummy.matrix));
  }
  cloud.add(new THREE.Mesh(mergeGeometries(parts, false), mat));
  for (const p of parts) p.dispose();
  return cloud;
}

/**
 * Builds sky dome, fog, lights and clouds and adds them to `scene`.
 * Returns { sun, hemi, dome, clouds, update(dt, camera) }.
 */
export function createSky(scene) {
  // ---- Dome (follows the camera so it never parallaxes)
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(SKY_RADIUS, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(PALETTE.skyTop) },
        uHorizon: { value: new THREE.Color(PALETTE.skyHorizon) },
        uSunDirection: { value: new THREE.Vector3(48, 70, 34).normalize() },
        uMoonDirection: { value: new THREE.Vector3(0, 1, 0.45).normalize() },
        uSunVisible: { value: 1 },
        uMoonVisible: { value: 0 },
        uWarmth: { value: 0 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    })
  );
  dome.name = 'sky-dome';
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  scene.add(dome);

  // One draw call for the night sky. Stars sit just inside the dome and follow the camera.
  const catalogue = skyStars();
  const starPositions = new Float32Array(400 * 3);
  const starSeeds = new Float32Array(400 * 2);
  catalogue.forEach((p,i) => {
    starPositions.set([p.x*(SKY_RADIUS-2),p.y*(SKY_RADIUS-2),p.z*(SKY_RADIUS-2)],i*3);
    starSeeds.set([p.phase,p.size],i*2);
  });
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  starGeo.setAttribute('aStar', new THREE.BufferAttribute(starSeeds, 2));
  const stars = new THREE.Points(starGeo, new THREE.ShaderMaterial({
    uniforms: { uNight: { value: 0 }, uTime: { value: 0 } },
    vertexShader: `attribute vec2 aStar; uniform float uTime; varying float vAlpha;
      void main() { vAlpha = 0.6 + 0.4 * sin(uTime * (1.2 + aStar.x * 0.12) + aStar.x);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv; gl_PointSize = aStar.y; }`,
    fragmentShader: `uniform float uNight; varying float vAlpha;
      void main() { float d = length(gl_PointCoord - 0.5);
        float a = (1.0 - smoothstep(0.12, 0.5, d)) * vAlpha * uNight;
        if (a < 0.01) discard; gl_FragColor = vec4(0.86, 0.92, 1.0, a);
        #include <colorspace_fragment> }`,
    transparent: true, depthWrite: false, depthTest: true, fog: false,
  }));
  stars.name = 'night-stars';
  stars.renderOrder = -999;
  stars.frustumCulled = false;
  scene.add(stars);

  // Found chart lines and larger stars share two cheap draws and follow the real sky.
  const chart = new THREE.Group(); scene.add(chart);
  const chartLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({color:'#ffe3a2',transparent:true,opacity:0.8,depthWrite:false,fog:false}));
  const chartStars = new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({color:'#fff3c9',size:5,sizeAttenuation:false,transparent:true,depthWrite:false,fog:false}));
  chart.add(chartLines,chartStars);chart.visible=false;let chartKey='';
  function setConstellations(sights) {
    const key=sights.map(Boolean).join();if(key===chartKey)return;chartKey=key;
    const lines=[],points=[];
    for(const c of constellations())if(sights[c.post]) {
      for(const id of c.ids){const p=catalogue[id];points.push(p.x*(SKY_RADIUS-3),p.y*(SKY_RADIUS-3),p.z*(SKY_RADIUS-3));}
      for(let i=1;i<c.ids.length;i++)for(const id of [c.ids[i-1],c.ids[i]]){const p=catalogue[id];lines.push(p.x*(SKY_RADIUS-3),p.y*(SKY_RADIUS-3),p.z*(SKY_RADIUS-3));}
    }
    chartLines.geometry.dispose();chartStars.geometry.dispose();
    chartLines.geometry=new THREE.BufferGeometry();chartLines.geometry.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));
    chartStars.geometry=new THREE.BufferGeometry();chartStars.geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
  }

  // ---- Fog & background match the horizon colour
  scene.background = new THREE.Color(PALETTE.skyHorizon);
  scene.fog = new THREE.Fog(PALETTE.skyHorizon, FOG_NEAR, FOG_FAR);

  // ---- Lights
  const hemi = new THREE.HemisphereLight('#d6efff', '#bff0a0', 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight('#fff1d6', 2.7);
  sun.position.set(48, 70, 34);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  const s = 88;   // covers the whole 150u terrain footprint's land
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  // Wider existing PCF filter and gentler contrast; no larger map or extra shadow pass.
  sun.shadow.radius = 1.5;
  sun.shadow.intensity = 0.82;
  const compactLightDirection = new THREE.Vector3();
  scene.add(sun, sun.target);

  // ---- Clouds
  const rng = mulberry32(2024);
  const clouds = [];
  const cloudGroup = new THREE.Group();
  cloudGroup.name = 'clouds';
  const count = 8;
  for (let i = 0; i < count; i++) {
    const c = buildCloud(rng);
    const a = (i / count) * Math.PI * 2 + rng() * 0.5;
    const r = range(rng, 110, 220);
    c.position.set(Math.cos(a) * r, range(rng, 32, 56), Math.sin(a) * r);
    const sc = range(rng, 1.0, 1.6);
    c.scale.setScalar(sc);
    c.rotation.y = range(rng, -0.3, 0.3);
    c.userData.speed = range(rng, 0.9, 1.7);
    cloudGroup.add(c);
    clouds.push(c);
  }
  scene.add(cloudGroup);

  return {
    dome, stars, sun, hemi, clouds: cloudGroup, setConstellations,
    setTimeOfDay(clock) {
      const look = clock.look, u = dome.material.uniforms;
      u.uTop.value.copy(look.top);
      u.uHorizon.value.copy(look.horizon);
      u.uSunDirection.value.copy(clock.sunDirection);
      u.uMoonDirection.value.copy(clock.moonDirection);
      u.uSunVisible.value = clock.isMoon ? 0 : 1;
      u.uMoonVisible.value = clock.isMoon ? 1 : 0;
      u.uWarmth.value = look.warmth;
      stars.material.uniforms.uNight.value = clock.nightness;
      chart.visible = clock.nightness > 0.1 && chartKey.includes('true');
      scene.background.copy(look.fog);
      scene.fog.color.copy(look.fog);
      hemi.color.copy(look.hemiSky);
      hemi.groundColor.copy(look.hemiGround);
      hemi.intensity = look.hemiIntensity;
      sun.color.copy(look.light);
      sun.intensity = clock.lightIntensity;
      // Keep the illustrated sky's sun/moon arc while avoiding enormous grazing-angle ground shadows.
      compactLightDirection.copy(clock.direction);
      compactLightDirection.y = Math.max(compactLightDirection.y, Math.hypot(compactLightDirection.x, compactLightDirection.z) / 1.1);
      compactLightDirection.normalize();
      sun.position.copy(sun.target.position).addScaledVector(compactLightDirection, Math.hypot(48, 70, 34));
      for (const c of clouds) {
        c.children[0].material.color.copy(look.cloud);
        c.children[0].material.emissive.copy(look.emissive);
      }
    },
    update(dt, camera) {
      if (camera) { dome.position.copy(camera.position); stars.position.copy(camera.position); chart.position.copy(camera.position); }
      chart.visible = stars.material.uniforms.uNight.value > 0.1 && chartKey.includes('true');
      chartLines.material.opacity = stars.material.uniforms.uNight.value * 0.8;
      chartStars.material.opacity = stars.material.uniforms.uNight.value;
      stars.material.uniforms.uTime.value += dt;
      for (const c of clouds) {
        c.position.x += c.userData.speed * dt;
        if (c.position.x > CLOUD_WRAP) c.position.x = -CLOUD_WRAP;
      }
    },
  };
}
