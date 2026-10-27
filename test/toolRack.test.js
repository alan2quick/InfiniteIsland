// Step 75: pure cycles, real terrain / registry placement, session-only IDs, real items domain + queued host/replica transport.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFS } from '../public/js/items/spawns.js';
import { campStageLayout } from '../public/js/world/islands/frostCampStages.js';
import { gardenStageLayout } from '../public/js/world/islands/emberGardenStages.js';
import { getIslandModule } from '../public/js/world/islands/registry.js';
import { FIRES, ISLANDS, TOOL_RACK, INTERACT_RADIUS } from '../public/js/config.js';
import { decideCycle, rackKinds, rackId, rackInfo, RACK_COUNT, rackUnlocked } from '../public/js/game/toolRackLogic.js';
import { toolRackPlan, saplingReserve } from '../public/js/world/toolRackPlan.js';
import { createToolRacks } from '../public/js/world/toolRacks.js';
import { createItems } from '../public/js/world/items.js';
import { rememberedTool, createPlayerMemory } from '../public/js/game/playerMemory.js';
import { WorldSync } from '../public/js/net/worldSync.js';
import { getHeight, isWalkable } from '../public/js/world/terrain.js';
import { getColliders, addCollider, clearColliders, overlapsAny } from '../public/js/world/colliders.js';
import { getInteractables, addInteractable, clearInteractables, findNearest } from '../public/js/world/interactables.js';
import { getToolAction } from '../public/js/items/tools.js';
const ctx = new Proxy({}, { get: (t,k) => k === 'measureText' ? () => ({width:10}) : /Gradient/.test(k) ? () => ({addColorStop(){}}) : () => {} });
globalThis.document = { createElement: () => ({getContext:()=>ctx,style:{}}) };
const storage = new Map();
globalThis.localStorage = {getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
const ks = rackKinds(false), stock = Object.fromEntries(ks.map(k=>[k,'rack']));
test('rod gate, plain interact and per-fire unlocks', () => {
  assert.deepEqual(ks, ['axe','hammer','sword','shovel']); assert.deepEqual(rackKinds(true), TOOL_RACK.kinds);
  assert.equal(getToolAction({kind:'axe',state:'held'},{type:'toolrack'}),null);
  for (const f of FIRES) { const q = {slots:{[f.id]:{last:'feast'}}}; for (const g of FIRES) assert.equal(rackUnlocked(q,g.id),f.id===g.id); }
});
test('empty hands take first stock; own copy advances and wraps with no empty step', () => {
  assert.equal(decideCycle(null,stock,ks).take,'axe');
  for (let i=0;i<ks.length;i++) { const d=decideCycle({id:8,kind:ks[i],own:true},stock,ks); assert.equal(d.take,ks[(i+1)%ks.length]); assert.equal(d.put,8); assert.equal(d.drop,null); }
});
test('only held copy remains: keep it; skip tools out in the world', () => {
  const out=Object.fromEntries(ks.map(k=>[k,'out']));
  let d=decideCycle({id:1,kind:'axe',own:true},out,ks); assert.equal(d.take,null); assert.equal(d.put,null); assert.match(d.line,/other tools/);
  d=decideCycle({id:1,kind:'axe',own:true},{...out,shovel:'rack'},ks); assert.equal(d.take,'shovel');
});
for (const label of ['overworld','other rack','other owner']) test(`${label}: drop then take, even when no stock remains`, () => {
  const h={id:9,kind:'axe',own:false}; let d=decideCycle(h,stock,ks); assert.equal(d.drop,9); assert.equal(d.put,null); assert.equal(d.take,'axe');
  d=decideCycle(h,{},ks); assert.equal(d.drop,9); assert.equal(d.take,null); assert.match(d.line,/all out/);
});
test('80 reserved IDs are unique, reversible, stable, before dynamics', () => {
  const ids=[]; for (const f of FIRES) for(let slot=0;slot<4;slot++) for(const k of TOOL_RACK.kinds) { const id=rackId(100,f.id,slot,k); ids.push(id); assert.deepEqual(rackInfo(100,id),{fire:f.id,owner:slot,kind:k}); }
  assert.equal(RACK_COUNT,80); assert.deepEqual(ids,Array.from({length:80},(_,i)=>100+i)); assert.equal(rackInfo(100,180),null);
});
function player(index,scene) {
  const root=new THREE.Group(), handSocket=new THREE.Group(), armR=new THREE.Group(); armR.userData.restZ=0; root.add(armR,handSocket); scene.add(root);
  return { index,root,position:root.position,parts:{armR,handSocket},colors:{name:`P${index+1}`,ui:'#fff'},hop(){},teleport(x,z){root.position.set(x,getHeight(x,z),z);} };
}
function fixture(role='host', options={}) {
  clearColliders(); clearInteractables();
  const sync=new WorldSync({role}),scene=new THREE.Scene(),p=player(role==='host'?0:1,scene), list=[p];
  const players={list,players:list,p1:p,multi:false,get:i=>list.find(p=>p.index===i),labelOf:()=> 'P2',on(){}};
  const items=createItems({scene,players,sync,particles:{burst(){}},hud:{toast(){}},...options});
  const plan=toolRackPlan({overlaps:()=>false,interactables:()=>[]});
  const listeners={}, quests={slots:{},on(k,fn){listeners[k]=fn;}}, boat={state:{discovered:false}};
  const racks=createToolRacks({scene,players,items,quests,sync,boat,plan,particles:{burst(){}},params:new URLSearchParams('racks')});
  function step(){for(let i=0;i<16;i++) items.update(0.1); racks.update(0);}
  function at(f='home'){const s=plan[f];p.teleport(s.x,s.z+1.5);}
  at();return {sync,scene,p,players,items,plan,racks,quests,listeners,boat,step,at};
}
function pair() {
  const h=fixture(),r=fixture('replica'),queue=[];
  h.sync.attachHost({sendTo:(tid,m)=>queue.push([r.sync,structuredClone(m)]),broadcast:m=>queue.push([r.sync,structuredClone(m)])});
  r.sync.attachReplica({send:m=>{queue.push([null,structuredClone(m)]);return true;}});r.sync.linkUp();h.sync.screenConnected(1,{clientId:'rack-test'});
  function flush(){while(queue.length){const [to,m]=queue.shift();if(to)to.receive(m);else h.sync.screenMessage(1,m);}}
  flush();r.racks.update(0);
  function step(){h.step();r.step();flush();assert.equal(h.sync.hash(),r.sync.hash());}
  return {h,r,flush,step};
}
test('reservations cost no item models; separate rack sets and stable dynamic ids', () => {
  const w=fixture(); assert.equal(w.items.list.filter(r=>r.rack).length,80);assert.equal(w.items.list.filter(r=>r.rack&&r.model).length,0);
  const base=w.items.rackBase;w.racks.cycle(w.p,'home');w.step();assert.equal(w.racks.stock(w.p,'home').axe,'held');assert.equal(w.racks.stock(w.p,'frost').axe,'rack');
  w.at('frost'); w.racks.cycle(w.p,'frost'); w.step(); assert.equal(w.racks.stock(w.p,'home').axe,'out'); assert.equal(w.items.held.rack.fire,'frost');
  const saber=w.items.spawnSpecial('lightsaber',{x:25,z:25});assert.ok(saber.id>=base+80);
  w.items.dropFor(w.p);w.step();w.items.restoreEthereal({kind:'hammer'},w.p);assert.ok(w.items.held.id>=base+80);assert.ok(w.items.held.id!==saber.id);
});
test('replica cycle, ground swap, skipped out copy, owner return, cross-owner drop, late snapshot, reset: equal hashes', async () => {
  const {h,r,flush,step}=pair();
  let request=r.racks.cycle(r.p,'home');flush();assert.equal(h.sync.hash(),r.sync.hash());assert.equal((await request).ok,true);step();
  const axe=r.items.held, id=axe.id;assert.equal(axe.kind,'axe');
  const ground=r.items.list.find(i=>i.kind==='hammer'&&i.state==='ground');r.p.position.copy(ground.spot);
  r.items.equip('hammer',r.p);flush();step();assert.equal(r.racks.stock(r.p,'home').axe,'out');
  r.at();request=r.racks.cycle(r.p,'home');flush();await request;step();assert.equal(r.items.held.kind,'hammer');
  // Pick up the exact dropped axe and bring it home. The owner can return it.
  r.p.position.copy(r.items.list[id].spot);getInteractables().find(it=>it.object===r.items.list[id].ground).onInteract(null,r.p);flush();step();r.at();
  request=r.racks.cycle(r.p,'home');flush();await request;step();assert.equal(r.racks.stock(r.p,'home').axe,'rack');
  // Another player may use that copy, but cannot return it to its owner's stock.
  request=r.racks.cycle(r.p,'home');flush();await request;step(); // shovel
  request=r.racks.cycle(r.p,'home');flush();await request;step(); // axe
  r.items.dropFor(r.p);flush();step();
  const ha=h.items.list[id];h.p.position.copy(ha.spot); // invoke the authoritative pickup directly (separate registries in one Node process)
  const result=h.sync.request('items','pickup',{id},h.sync.actorFor(h.p));assert.equal(result.ok,true,JSON.stringify(result));flush();step();h.at();
  h.racks.cycle(h.p,'home');flush();step();assert.equal(h.racks.stock(1,'home').axe,'out');assert.equal(h.items.held.rack.owner,0);
  const snap=h.sync.domains.get('items').snapshot();
  const late=fixture('replica'); late.sync.domains.get('items').applySnapshot(structuredClone(snap));assert.equal(h.sync.hash(),late.sync.hash(),'fresh late join materialises out and held copies');r.sync.domains.get('items').applySnapshot(structuredClone(snap));assert.equal(h.sync.hash(),r.sync.hash());
  h.racks.resetSession();flush();step();assert.equal(h.items.held,null);assert.equal(r.items.held,null);assert.ok(h.items.list.filter(i=>i.rack).every(i=>i.state==='rack'));
});
test('rack request rejects locked / far / missing rack and accepts rod only after discovery', () => {
  const w=fixture();w.p.frozen=true;assert.equal(w.racks.cycle(w.p,'home').ok,false);w.p.frozen=false;w.p.leaving=true;assert.equal(w.racks.cycle(w.p,'home').reason,'gone');w.p.leaving=false;
  w.p.position.set(100,0,100);assert.equal(w.racks.cycle(w.p,'home').reason,'far');w.at();assert.equal(w.racks.cycle(w.p,'bad').ok,false);
  for(let i=0;i<4;i++){w.racks.cycle(w.p,'home');w.step();}assert.equal(w.items.held.kind,'shovel');
  w.boat.state.discovered=true;w.racks.cycle(w.p,'home');w.step();assert.equal(w.items.held.kind,'rod');
});
test('screen leaving drops held copy; slot reuse inherits out stock', async () => {
  const {h,r,flush,step}=pair();const q=r.racks.cycle(r.p,'home');flush();await q;step();
  h.sync.domains.get('items').screenLeft(r.sync.screenId);flush();step();assert.equal(h.items.rackStock(1,'home').axe,'out');
  r.at();const next=r.racks.cycle(r.p,'home');flush();await next;step();assert.equal(r.items.held.kind,'hammer');
});
test('fresh host resets out and held copies; memory skips rack copies and still remembers overworld tools', () => {
  const w=fixture();w.racks.cycle(w.p,'home');w.step();assert.equal(rememberedTool(w.items.held),null);
  const memory=createPlayerMemory();memory.remember(0,'home',w.items.held);assert.equal(memory.get(0).tool,null);
  w.items.dropFor(w.p);w.step();w.racks.cycle(w.p,'home');w.step();assert.ok(w.items.list.some(r=>r.rack&&r.holderKey));assert.ok(w.items.list.some(r=>r.rack&&r.state==='ground'));
  const reloaded=fixture();assert.ok(reloaded.items.list.filter(r=>r.rack).every(r=>r.state==='rack'&&!r.model));assert.equal(reloaded.items.held,null);
  assert.equal(rememberedTool({kind:'axe'}).kind,'axe');
});
test('world unlock gates, pop-in, one registration, local dimming, visibility and five draw-call budget', () => {
  const w=fixture();clearColliders();clearInteractables();
  const scene=new THREE.Scene(),localQuests={slots:{},on(k,fn){this.changed=fn;}};
  const world={regions:{isFull:()=>true}};
  const racks=createToolRacks({...w,scene,quests:localQuests,world,particles:{burst(){}}});
  assert.equal(racks.summary().filter(r=>r.shown).length,0);
  localQuests.slots.frost={last:'feast'};localQuests.changed();racks.update(1);
  assert.equal(getColliders().length,1);assert.equal(getInteractables().filter(i=>i.type==='toolrack').length,1);
  localQuests.changed();racks.update(1);assert.equal(getColliders().length,1);
  let s=racks.summary().find(r=>r.fire==='frost');assert.equal(s.drawCalls,5);assert.ok(s.triangles>0);console.log('rack budget',s.drawCalls,s.triangles);
  const group=scene.children.find(g=>g.name==='toolrack-frost'), display=group.children.at(-1);
  racks.update(0);assert.equal(group.children.at(-1),display,'unchanged stock reuses peg geometry');
  w.players.list.length=0;racks.update(0);const dim=group.children.at(-1).geometry.attributes.color;
  assert.ok(dim.getX(0)<display.geometry.attributes.color.getX(0),'no local stock dims pegs');
  w.players.list.push(w.p);w.boat.state.discovered=true;racks.update(0);
  s=racks.summary().find(r=>r.fire==='frost');assert.equal(s.drawCalls,5);console.log('rod rack budget',s.drawCalls,s.triangles);
  world.regions.isFull=()=>false;racks.update(0);assert.equal(racks.summary().find(r=>r.fire==='frost').visible,false);
});
test('placement against actual island data, camp seats, hat rack, stable and Carle: deterministic and unobstructed', async () => {
  clearColliders();clearInteractables();
  const {createProps}=await import('../public/js/world/props.js'); const props=createProps(new THREE.Scene());
  const {buildIslandData}=await import('../public/js/world/islandVisuals.js');for(const island of ISLANDS)buildIslandData(island);
  const {createGathering}=await import('../public/js/world/gathering.js');
  const gatherSync=new WorldSync({role:'host'});
  createGathering({scene:new THREE.Scene(),props,players:{list:[]},sync:gatherSync,items:{},particles:{burst(){}},hud:{toast(){}},inventory:{},pickups:{},
    frost:buildIslandData(ISLANDS.find(i=>i.id==='frost')).frost,ember:buildIslandData(ISLANDS.find(i=>i.id==='ember')).ember});
  for(const f of FIRES) for(const a of f.bench.angles) addCollider({x:f.x+Math.cos(a)*f.bench.ring,z:f.z+Math.sin(a)*f.bench.ring,r:1.1});
  addCollider({x:-0.6,z:9.8,r:0.65});
  const {homeCarlePlan}=await import('../public/js/world/islands/homeCarle.js');const carle=homeCarlePlan();assert.ok(carle.sapling);addCollider(carle.collider);
  const {duskHearthLayout}=await import('../public/js/world/islands/duskHearth.js');const stable=duskHearthLayout().stable;addCollider(stable);
  const plan=toolRackPlan({reserved:[saplingReserve(carle.collider)]});assert.deepEqual(plan,toolRackPlan({reserved:[saplingReserve(carle.collider)]}));
  assert.deepEqual(Object.fromEntries(Object.entries(plan).map(([id,s])=>[id,[+s.x.toFixed(3),+s.z.toFixed(3),s.dist]])),
    {home:[9.44,14.981,6],frost:[-5,-163,6],ember:[204.495,86.309,8.5],dusk:[870,443.75,6]});
  assert.ok(Math.hypot(plan.home.x-carle.collider.x,plan.home.z-carle.collider.z)>=saplingReserve(carle.collider).r+TOOL_RACK.room,'the home rack keeps clear of Carle\'s sapling');
  for(const f of FIRES){const s=plan[f.id];assert.ok(s,`${f.id} has a spot`);assert.ok(s.dist>=4.5&&s.dist<=(f.id==='ember'?8.5:6.5));assert.ok(s.dist>=Math.min(f.clear,TOOL_RACK.nearClear)+TOOL_RACK.radius);assert.equal(overlapsAny(s.x,s.z,TOOL_RACK.room),false);assert.ok(isWalkable(s.x,s.z));assert.ok(getInteractables().every(i=>Math.hypot(i.position.x-s.x,i.position.z-s.z)>=Math.max(TOOL_RACK.interactClearance,TOOL_RACK.room+i.radius)));}
  for (const s of Object.values(plan)) assert.ok(DEFS.every((d)=>Math.hypot(s.x-d.at[0],s.z-d.at[1])>=2.5));
  // Register the actual final-stage colliders after planning an empty camp: a saved final camp must choose the same spots.
  const frostFinal=campStageLayout(ISLANDS.find(i=>i.id==='frost'));
  const gardenFinal=gardenStageLayout(ISLANDS.find(i=>i.id==='ember'),getIslandModule('ember'));
  for (const layout of [frostFinal,gardenFinal]) for(const stage of [1,2,3]) {
    for(const c of layout.colliders[stage]) { addCollider(c); for(const s of Object.values(plan)) assert.ok(Math.hypot(s.x-c.x,s.z-c.z)>=TOOL_RACK.room+c.r); }
  }
  for(const plot of gardenFinal.reserved.plots) addInteractable({type:'plot',position:new THREE.Vector3(plot.x,plot.y,plot.z),radius:0.75});
  for(const footprints of Object.values(frostFinal.footprints)) for(const c of footprints) assert.ok(Math.hypot(plan.frost.x-c.x,plan.frost.z-c.z)>=TOOL_RACK.room+c.r);
  const shelter=frostFinal.stage3.shelter;assert.ok(Math.hypot(plan.frost.x-shelter.x,plan.frost.z-shelter.z)>=Math.hypot(shelter.hw+0.3,shelter.hl+0.3)+TOOL_RACK.room);
  const gap=(p,a,b)=>{const dx=b.x-a.x,dz=b.z-a.z;const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz)));return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);};
  for(const [lines,r] of [[[gardenFinal.pipe],0.2],[gardenFinal.channels,0.12],[gardenFinal.trellises.map(t=>t.posts),0.25]])
    for(const line of lines) for(let i=1;i<line.length;i++) assert.ok(gap(plan.ember,line[i-1],line[i])>=TOOL_RACK.room+r,'clear of every final pipe/channel/trellis span');
  assert.ok(Math.hypot(plan.ember.x-gardenFinal.pavilion.x,plan.ember.z-gardenFinal.pavilion.z)>=TOOL_RACK.room+5.1,'outside pavilion roof footprint');
  const marsh=duskHearthLayout();assert.ok(Math.hypot(plan.dusk.x-marsh.stable.x,plan.dusk.z-marsh.stable.z)>=TOOL_RACK.room+marsh.stable.r);
  for(const rod of marsh.rods) assert.ok(Math.hypot(plan.dusk.x-rod.x,plan.dusk.z-rod.z)>=2.5);
  assert.deepEqual(plan,toolRackPlan({reserved:[saplingReserve(carle.collider)]}),'full final stages preserve the fresh-game plan');
  const scene = new THREE.Scene(), p = player(0,scene), sync = new WorldSync({role:'host'}), players = {p1:p,list:[p],players:[p],get:()=>p,labelOf:()=> 'P1'};
  const items = createItems({scene, players, sync, particles:{burst(){}},hud:{toast(){}}, frost:buildIslandData(ISLANDS.find(i=>i.id==='frost')).frost, ember:buildIslandData(ISLANDS.find(i=>i.id==='ember')).ember});
  console.log('production rack ID base / dynamic start',items.rackBase,items.rackBase+80);
  assert.equal(items.rackBase,95); assert.equal(items.list.length,175);
  const racks=createToolRacks({scene,players,items,sync,plan,quests:{slots:{},on(){}},boat:{state:{discovered:false}},particles:{burst(){}},params:new URLSearchParams('racks')});
  racks.goto('home');assert.equal(findNearest(p.position).type,'toolrack','real home bushes and starting tools do not steal the front approach');
  console.log('real layout rack spots',JSON.stringify(plan));
});

for (const source of ['overworld','other rack']) test(`${source} drop lands beside/away from rack and next E cycles instead of reclaiming it`, () => {
  const w=fixture();
  if(source==='overworld') w.items.equip('axe',w.p);
  else {w.at('frost');w.racks.cycle(w.p,'frost');}
  w.step();const dropped=w.items.held;w.at();const at=w.p.position.clone(),rack=w.plan.home;
  let target=findNearest(at,INTERACT_RADIUS);assert.equal(target.type,'toolrack');assert.equal(target.fire,'home');target.onInteract(target,w.p);w.step();
  const distance=Math.hypot(dropped.spot.x-at.x,dropped.spot.z-at.z);
  assert.ok(distance>=1.59&&distance<=2.01,`drop travels ${distance}`);
  assert.ok(Math.hypot(dropped.spot.x-rack.x,dropped.spot.z-rack.z)>INTERACT_RADIUS+TOOL_RACK.radius);
  assert.ok(Math.abs(dropped.spot.x-at.x)>0.5,'toss has a sideways component');
  target=findNearest(at,INTERACT_RADIUS);assert.equal(target.type,'toolrack');target.onInteract(target,w.p);w.step();
  assert.equal(w.items.held.kind,'hammer');assert.equal(w.items.rackStock(0,'home').axe,'rack');assert.equal(dropped.state,'ground');
});
