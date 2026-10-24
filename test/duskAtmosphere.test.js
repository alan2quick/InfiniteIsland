// Duskcrown 69b: actual Three meshes/lights, continuous region weights and conservative top occlusion without a GPU.
import { spatialRaycastMesh } from './helpers/spatialRaycast.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ISLANDS, DUSK_LIGHT } from '../public/js/config.js';
import { DayNight } from '../public/js/world/dayNight.js';
import { createSky } from '../public/js/world/sky.js';
import { createAtmosphere } from '../public/js/fx/atmosphere.js';
import { setWaterLook, waterUniforms } from '../public/js/world/water.js';
import { duskUniforms } from '../public/js/world/islands/duskAtmosphere.js';
import { getIslandModule } from '../public/js/world/islands/registry.js';
import { islandGap } from '../public/js/world/islands/extent.js';
import { createAmbient } from '../public/js/fx/ambient.js';

const island = ISLANDS.find((i) => i.id === 'duskcrown');
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
function rig() {
  const scene = new THREE.Scene(), sky = createSky(scene), camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 600);
  const clock = new DayNight({ persist: false, params: new URLSearchParams() });
  const view = { x: island.x, z: island.z + 60 };
  const mod = getIslandModule('duskcrown');
  const atmosphere = createAtmosphere({ scene, sky, camera, clock, getHeight: mod.height, view: () => view });
  const tick = (hour, dt = 1 / 60, t = 0) => { clock.set(hour); sky.setTimeOfDay(clock); atmosphere.update(dt, t, 720); };
  return { scene, sky, camera, clock, view, mod, atmosphere, tick };
}

test('Duskcrown noon and midnight retain only 8% of the day palette; stars/discs vanish and the clock is untouched', () => {
  const r = rig(), { sky, scene, atmosphere, clock, tick } = r;
  for (const hour of [0, 6, 12, 18.5]) {
    tick(hour); near(clock.hour, hour); near(atmosphere.duskWeight, 1);
    for (const [actual, base, target] of [[sky.dome.material.uniforms.uTop.value, clock.look.top, DUSK_LIGHT.top],
      [scene.fog.color, clock.look.fog, DUSK_LIGHT.fog], [sky.hemi.color, clock.look.hemiSky, DUSK_LIGHT.hemiSky],
      [sky.hemi.groundColor, clock.look.hemiGround, DUSK_LIGHT.hemiGround], [sky.sun.color, clock.look.light, DUSK_LIGHT.light]]) {
      const expected = base.clone().lerp(new THREE.Color(target), 0.92);
      near(actual.r, expected.r); near(actual.g, expected.g); near(actual.b, expected.b);
    }
    near(sky.sun.intensity, clock.lightIntensity * 0.08 + DUSK_LIGHT.lightIntensity * 0.92);
    near(sky.hemi.intensity, clock.look.hemiIntensity * 0.08 + DUSK_LIGHT.hemiIntensity * 0.92);
    near(scene.fog.near, 140 * 0.08 + DUSK_LIGHT.fogNear * 0.92);
    near(scene.fog.far, 330 * 0.08 + DUSK_LIGHT.fogFar * 0.92);
    near(sky.stars.material.uniforms.uNight.value, 0);
    near(sky.dome.material.uniforms.uSunVisible.value, 0); near(sky.dome.material.uniforms.uMoonVisible.value, 0);
    assert.equal(atmosphere.duskFx.spores.visible, true);
  }
  atmosphere.light(false); tick(12);
  assert.deepEqual(sky.dome.material.uniforms.uTop.value, clock.look.top);
  near(sky.sun.intensity, clock.lightIntensity); near(scene.fog.near, 140);
  atmosphere.dispose();
});

test('walk across the rectangular fade band eases monotonically and teleport snap restores home and Emberleaf', () => {
  const r = rig(), { view, atmosphere, tick, sky, scene, clock } = r;
  let previous = 1;
  for (let gap = -6; gap <= 46; gap++) {
    view.x = island.x + island.halfX + gap; view.z = island.z;
    near(islandGap(island, view.x, view.z), gap);
    tick(12, 0.2);
    assert.ok(atmosphere.duskWeight <= previous); assert.ok(previous - atmosphere.duskWeight < 0.05);
    previous = atmosphere.duskWeight;
  }
  assert.ok(previous < 0.025);
  for (const id of ['home', 'ember', 'frost', 'home']) {
    const i = ISLANDS.find((a) => a.id === id); Object.assign(view, { x: i.x, z: i.z }); atmosphere.snap(); tick(0);
    near(atmosphere.duskWeight, 0); near(scene.fog.near, 140); near(scene.fog.far, 330);
    near(sky.sun.shadow.intensity, 1); near(sky.sun.shadow.radius, 1);
    near(sky.sun.intensity, clock.lightIntensity);
    near(sky.stars.material.uniforms.uNight.value, clock.nightness);
    if (id === 'home') assert.deepEqual(scene.fog.color, clock.look.fog);
    if (id === 'ember') near(scene.fog.color.b, clock.look.fog.b * 0.9);
  }
  atmosphere.dispose();
});

test('opaque lid covers every plateau sample from overhead and oblique views, independently of full/far island detail', () => {
  const { scene, atmosphere, mod, tick } = rig(); tick(12);
  const mesh = atmosphere.duskFx.mesh; scene.updateMatrixWorld(true);
  assert.equal(mesh.parent, scene); assert.equal(mesh.material.transparent, false); assert.equal(mesh.material.depthWrite, true);
  assert.equal(mesh.material.side, THREE.DoubleSide); assert.equal(mesh.material.fog, true);
  assert.ok(DUSK_LIGHT.lidHeight - DUSK_LIGHT.lidWave > 46);
  const accelerated = spatialRaycastMesh(mesh);
  const ray = new THREE.Raycaster(), p = new THREE.Vector3(); let count = 0;
  for (let z = -110; z < 100; z += 2) for (let x = -170; x < 175; x += 2) {
    const wx = island.x + x, wz = island.z + z;
    if (mod.height(wx, wz) < 45.99) continue;
    for (const dx of [0, 65]) {
      p.set(wx, 46, wz); const origin = p.clone().add(new THREE.Vector3(dx, 90, 45 * Math.sign(dx)));
      ray.set(origin, p.clone().sub(origin).normalize());
      const hit = ray.intersectObject(accelerated.mesh)[0]; assert.ok(hit && hit.distance < origin.distanceTo(p), `uncovered ${x},${z}`);
      if (count % 1000 === 0) assert.deepEqual(hit.point.toArray(), ray.intersectObject(mesh)[0]?.point.toArray(), 'partition agrees with original raycast');
    }
    count++;
  }
  accelerated.dispose();
  assert.ok(count > 5000); atmosphere.duskFx.lid(false); assert.equal(mesh.visible, false);
  atmosphere.duskFx.lid(true); assert.equal(mesh.visible, true);
  const draws = [mesh, atmosphere.duskFx.spores]; assert.equal(draws.length, 2);
  assert.equal(draws.some((d) => d.castShadow), false);
  assert.equal(scene.children.filter((c) => c.isLight).length, 2);
  atmosphere.dispose(); assert.equal(mesh.parent, null);
});

test('spores and breathing glow are day independent; ambient fireflies preserve all other islands rules', () => {
  const { scene, atmosphere, mod, clock, tick, view, camera } = rig();
  const ambient = createAmbient({ scene, props: { handles: { flowers: { list: [{ x: 0, z: 0 }] }, trees: [] } }, getHeight: mod.height, clock, fireflies: 8 });
  tick(12, 1, 0); near(duskUniforms.uGlow.value, 0.96);
  tick(0, 1, Math.PI / 2 / DUSK_LIGHT.breatheRate); near(duskUniforms.uGlow.value, 1);
  const spore = atmosphere.duskFx.spores;
  assert.equal(spore.geometry.getAttribute('aSeed').count, 240); assert.equal(spore.material.depthWrite, false);
  clock.set(12); ambient.duskWeight = 1; ambient.update(4, 0, view, camera, 720);
  assert.equal(ambient.fireflies.points.visible, true);
  ambient.duskWeight = 0; ambient.update(4, 0, view, camera, 720); assert.equal(ambient.fireflies.points.visible, false);
  clock.set(0); ambient.update(4, 0, view, camera, 720); assert.equal(ambient.fireflies.points.visible, true);
  ambient.calm = true; ambient.update(4, 0, view, camera, 720); assert.equal(ambient.fireflies.points.visible, false);
  atmosphere.dispose();
});

test('water and foam use the same eased Duskcrown weight and restore the exact day sample', () => {
 const r=rig();r.tick(12);setWaterLook(r.clock,r.atmosphere.waterWeight);
 for(const [u,key,target] of [['uShallowTint','shallow','#698fba'],['uDeepTint','deep','#536d9f'],['uFoamTint','foam','#8da4c6']]){
   assert.deepEqual(waterUniforms[u].value,r.clock.look[key].clone().lerp(new THREE.Color(target),DUSK_LIGHT.mix));
 }
 near(waterUniforms.uNight.value,0.92);
 r.view.x=0;r.view.z=0;r.atmosphere.snap();r.tick(12);setWaterLook(r.clock,r.atmosphere.waterWeight);
 assert.deepEqual(waterUniforms.uShallowTint.value,r.clock.look.shallow);
 assert.deepEqual(waterUniforms.uDeepTint.value,r.clock.look.deep);assert.deepEqual(waterUniforms.uFoamTint.value,r.clock.look.foam);
 near(waterUniforms.uNight.value,0);r.atmosphere.dispose();
});

test('rounded lid has a continuous nongrid boundary and covers plateau edges from all view bearings', () => {
  const {atmosphere,mod,scene}=rig(), mesh=atmosphere.duskFx.mesh;scene.updateMatrixWorld(true);
  const pos=mesh.geometry.getAttribute('position');
  assert.ok(pos.count/3<16000,'concave contour stays one bounded draw');
  let curved=0;for(let i=1;i<pos.count;i+=3)if(Math.abs(pos.getX(i)-Math.round(pos.getX(i)))>0.01 && Math.abs(pos.getZ(i)-Math.round(pos.getZ(i)))>0.01)curved++;
  assert.ok(curved>30,'outline is rounded rather than a cell boundary');
  const accelerated = spatialRaycastMesh(mesh);
  const ray=new THREE.Raycaster();
  for(let z=-110;z<100;z+=8)for(let x=-170;x<175;x+=8){
    const p=new THREE.Vector3(island.x+x,46,island.z+z);if(mod.height(p.x,p.z)<45.99)continue;
    for(let k=0;k<12;k++){
      const angle=k*Math.PI/6, origin=p.clone().add(new THREE.Vector3(Math.cos(angle)*65,90,Math.sin(angle)*65));
      ray.set(origin,p.clone().sub(origin).normalize());const hit=ray.intersectObject(accelerated.mesh)[0];assert.ok(hit && hit.distance<origin.distanceTo(p));
    }
  }
  accelerated.dispose();
  atmosphere.dispose();
});

test('concave lid excludes every walkable marsh cell, lagoon and pond, including browser regression points', () => {
  const {atmosphere,mod,scene}=rig(), mesh=atmosphere.duskFx.mesh;scene.updateMatrixWorld(true);
  // Index the actual emitted triangles, not the source mask: this also catches
  // accidental fans/convex triangulation across the horseshoe's empty centre.
  const pos=mesh.geometry.getAttribute('position'), bins=new Map(), size=8;
  for(let i=0;i<pos.count;i+=3){
    const tri=[0,1,2].map(k=>[pos.getX(i+k),pos.getZ(i+k)]);
    const x0=Math.floor(Math.min(...tri.map(q=>q[0]))/size),x1=Math.floor(Math.max(...tri.map(q=>q[0]))/size);
    const z0=Math.floor(Math.min(...tri.map(q=>q[1]))/size),z1=Math.floor(Math.max(...tri.map(q=>q[1]))/size);
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){const key=x+','+z;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(tri);}
  }
  const cross=(a,b,x,z)=>(b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0]);
  const covered=(x,z)=>(bins.get(Math.floor(x/size)+','+Math.floor(z/size))||[]).some(([a,b,c])=>{
    const d=[cross(a,b,x,z),cross(b,c,x,z),cross(c,a,x,z)];
    return d.every(v=>v>=-1e-7)||d.every(v=>v<=1e-7);
  });
  const {halfX,halfZ}=mod.layout.bounds;let walkable=0,top=0;
  for(let z=-halfZ;z<=halfZ;z++)for(let x=-halfX;x<=halfX;x++){
    const wx=island.x+x,wz=island.z+z,h=mod.height(wx,wz);
    // The separate, unreachable plateau component is itself flat/walkable;
    // its top must be covered, while all walkable ground below it stays clear.
    if(h>=45.99){assert.ok(covered(x,z),'uncovered plateau cell '+x+','+z);top++;}
    else if(mod.walkable(wx,wz)){assert.equal(covered(x,z),false,'covered walkable cell '+x+','+z);walkable++;}
    if(covered(x,z))assert.ok(mod.layout.cliffC(x,z)>=-2,'overhang past cliff wall exceeds 2 u');
  }
  assert.ok(walkable>15000 && top>20000);
  const ray=new THREE.Raycaster();
  for(const [x,z] of [[924,404],[850,372],...mod.ponds.map(p=>[island.x+p.x,island.z+p.z])]){
    ray.set(new THREE.Vector3(x,100,z),new THREE.Vector3(0,-1,0));
    assert.equal(ray.intersectObject(mesh).length,0,'lid over lagoon/marsh/pond '+x+','+z);
  }
  atmosphere.dispose();
});
