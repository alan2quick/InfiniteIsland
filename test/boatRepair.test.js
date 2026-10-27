// Step 68c rules, real WorldSync request pairs, save lifetime and scene / physics integration.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldSync } from '../public/js/net/worldSync.js';
import { BOAT_REPAIR as R, HOP_COURSE, PLAYER_SPEED } from '../public/js/config.js';
import { freshBoat, normaliseBoat, boatHashView } from '../public/js/game/boatLogic.js';
import { beatAt, judgeBeat, streakHit, validateStreak, tarHeat, validateRepair, leakSchedule, bilgeAt, floatResult, repairSave } from '../public/js/game/boatRepairLogic.js';
import { coveLayout } from '../public/js/world/islands/emberCove.js';
import { getHeight, isWalkable } from '../public/js/world/terrain.js';
import { courseAt, clearCourses, registerCourse, setHopClock, stepHop, surfaceAt, padPos, validateCourse } from '../public/js/game/hopLogic.js';
import { repairRows, boatPages, questRowsShown } from '../public/js/game/marloScript.js';
const storage = new Map();
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) };
const { createBoat } = await import('../public/js/world/boat.js');
const { emberSave } = await import('../public/js/game/emberSave.js');
const L = coveLayout().repair, B = HOP_COURSE.beat;
const pos = at => ({x:at.x,y:at.top,z:at.z});
const ready = () => { const s = freshBoat(); s.unlocked = s.repair = true; for (const p in s.parts) s.parts[p] = true; return s; };
const hits = (mark, first=10) => Array.from({length:4},(_,i)=>({t:(first+i)*B.period,pos:pos(mark)}));
function pair() {
  storage.clear(); const file=emberSave.read(); for(const k of Object.keys(file)) delete file[k];
  let time=20;
  const hSync=new WorldSync({role:'host',wallNow:()=>time*1000}), rSync=new WorldSync({role:'replica',wallNow:()=>time*1000}), q=[];
  hSync.attachHost({sendTo:(_,m)=>q.push([rSync,m]),broadcast:m=>q.push([rSync,m])});
  rSync.attachReplica({send:m=>{q.push([hSync,m]);return true;}});
  const flush=()=>{while(q.length){const [to,m]=q.shift();if(to===hSync)hSync.screenMessage(1,m);else to.receive(m);}};
  const host=createBoat({sync:hSync}), replica=createBoat({sync:rSync});
  rSync.linkUp();hSync.screenConnected(1,{clientId:'repair'});flush();
  const request=async(kind,data,at,index=0)=>{const p=replica.request(kind,data,{index,position:pos(at)});flush();const result=await p;assert.equal(hSync.hash(),rSync.hash());return result;};
  return {host,replica,hSync,rSync,flush,request,time:t=>{time=t;},tick:t=>{time=t;host.update();flush();},now:()=>time};
}
test('beat grid includes +/-0.14, rejects outside and nonfinite times',()=>{
  for(const offset of [-B.window,0,B.window]) assert.ok(judgeBeat(80+offset));
  for(const t of [80+B.window+0.001,80-B.window-0.001,NaN,Infinity,undefined])assert.equal(judgeBeat(t),false);
  assert.equal(beatAt(80),100);
});
test('streak: four consecutive distinct beats; missed, skipped and duplicate beats cannot grow it',()=>{
  let s=[];for(const h of hits(L.marks[0]))s=streakHit(s,h.t,h.pos,L.marks[0]);assert.equal(s.length,4);
  assert.equal(streakHit(s,s.at(-1).t,pos(L.marks[0]),L.marks[0]).length,4);
  assert.equal(streakHit(s,12.8,pos(L.marks[0]),L.marks[0]).length,1);
  assert.deepEqual(streakHit(s,10.8,pos(L.marks[0]),L.marks[0]),[]);
  assert.deepEqual(streakHit(s,11.2,{x:0,y:0,z:0},L.marks[0]),[]);
});
test('host evidence validates all positions and times, age, count and consumed beats',()=>{
  const h=hits(L.marks[0]),now=h.at(-1).t;
  assert.ok(validateStreak(h,now,L.marks[0]));
  for(const bad of [h.slice(1),[...h.slice(0,3),h[2]],h.map((v,i)=>i===1?{...v,t:v.t+0.2}:v),h.map((v,i)=>i===1?{...v,pos:{x:0,y:0,z:0}}:v),h.map(v=>({...v,pos:{...v.pos,y:v.pos.y+0.4}}))])assert.equal(validateStreak(bad,now,L.marks[0]),false);
  assert.equal(validateStreak(h,now+3,L.marks[0]),false);assert.equal(validateStreak(h,now-1,L.marks[0]),false);
  assert.equal(validateStreak(h,now,L.marks[0],beatAt(h[0].t)),false);
});
test('per-mark counting clamps to two and migrates earlier aggregate plank saves',()=>{
  const s=normaliseBoat({...ready(),nails:[8,-1,1.5,NaN],planks:8});assert.deepEqual(s.nails,[2,0,1,0]);assert.equal(s.planks,3);
  const legacy={...ready(),planks:5};delete legacy.nails;assert.deepEqual(normaliseBoat(legacy).nails,[2,2,1,0]);
});
test('tar heat decreases monotonically and expires at exact coolS',()=>{
  assert.equal(tarHeat({at:10},10),1);assert.ok(Math.abs(tarHeat({at:10},10+R.tar.coolS/2)-0.5)<1e-12);
  assert.equal(tarHeat({at:10},10+R.tar.coolS),0);assert.equal(tarHeat(null,0),0);
});
test('seeded schedules are deterministic, bounded and increase for 1..4 players',()=>{
  for(let party=1;party<=4;party++){
    const a=leakSchedule(123,party);assert.deepEqual(a,leakSchedule(123,party));assert.equal(a.length,R.float.partyScale[party-1]);
    assert.ok(a.every((l,i)=>l.id===i&&l.spot>=0&&l.spot<6&&l.at>=R.float.first&&l.at<=R.float.last&&l.pluggedAt===null));
  }
  assert.notDeepEqual(leakSchedule(123),leakSchedule(124));
});
test('bilge integrates open intervals and caps at the duration regardless of frames',()=>{
  const f={running:true,t0:100,leaks:[{at:4,pluggedAt:110},{at:8,pluggedAt:null}]};
  assert.equal(bilgeAt(f,100),0);assert.equal(bilgeAt(f,120),(6+12)*R.float.rise);
  assert.equal(bilgeAt(f,200),(6+37)*R.float.rise);
  assert.equal(floatResult(f,120),null);assert.equal(floatResult(f,145),true);
});
test('unplugged tests overflow; every party size can pass if leaks are plugged promptly',()=>{
  for(let party=1;party<=4;party++){
    const f={running:true,t0:100,leaks:leakSchedule(12,party)};
    assert.equal(floatResult(f,145),false);
    for(const l of f.leaks)l.pluggedAt=100+l.at+1;
    assert.equal(floatResult(f,144),null);assert.equal(floatResult(f,145),true);
  }
});
test('save excludes session pots and active test; retains completed repair and float',()=>{
  const s=ready();s.nails.fill(2);s.planks=8;s.seams.fill(true);s.floated=true;s.tar['host:0']={at:5};s.float={running:true};
  const save=repairSave(s);assert.equal(save.tar,undefined);assert.equal(save.float,null);assert.equal(save.floated,true);
  assert.equal(s.float.running,true);assert.ok(s.tar['host:0']);assert.deepEqual(normaliseBoat(save).tar,{});
});
test('Marlo progress, activity hints, cheers and voyage hint follow party state',()=>{
  const s=ready();assert.match(repairRows(s)[0].detail,/Four/);s.planks=8;s.seams.fill(true);
  assert.match(repairRows(s)[0].detail,/Eight/);assert.match(repairRows(s)[1].detail,/Tar-tight/);assert.match(repairRows(s)[2].detail,/45 seconds/);
  s.floated=true;assert.match(boatPages(s)[0],/Come back at night/);s.sights.fill(true);assert.deepEqual(boatPages(s),["Ready to see what's past the horizon?"]);s.launched=true;assert.match(boatPages(s)[0],/new dock/);
});
test("Marlo's finished boat rows go away: repair rows once she floats, How's the boat? after the voyage",()=>{
  const s=ready();s.repair=false;assert.deepEqual(questRowsShown(s),{repair:false,boat:true});s.repair=true;assert.deepEqual(questRowsShown(s),{repair:true,boat:true});
  s.floated=true;assert.deepEqual(questRowsShown(s),{repair:false,boat:true});s.launched=true;s.at='duskcrown';assert.deepEqual(questRowsShown(s),{repair:false,boat:false});
});
test('replica repair rejects locked, wrong order and far; Marlo starts once after all parts',async()=>{
  const p=pair();assert.equal((await p.request('repair',{},L.marlo)).reason,'locked');
  p.host.debug.unlock();p.flush();assert.equal((await p.request('repair',{},L.marlo)).reason,'wrong-order');
  for(const part of ['planks','sail','rudder','compass'])p.host.debug.take(part);p.flush();
  assert.equal((await p.request('nail',{plank:0},L.marks[0])).reason,'wrong-order');
  assert.equal((await p.request('repair',{},L.seep)).reason,'far');assert.ok((await p.request('repair',{},L.marlo)).ok);
  assert.equal((await p.request('repair',{},L.marlo)).reason,'already-started');
});
async function start(p){p.host.debug.unlock();for(const part of ['planks','sail','rudder','compass'])p.host.debug.take(part);p.flush();assert.ok((await p.request('repair',{},L.marlo)).ok);}
test('replica nails all eight solo; rejects offbeat, far, repeated evidence, and third at a mark',async()=>{
  const p=pair();await start(p);
  assert.equal((await p.request('nail',{plank:0,hits:[]},L.marks[0])).reason,'not-on-beat');
  assert.equal((await p.request('nail',{plank:0,hits:hits(L.marks[0])},L.seep)).reason,'far');
  let first=30;
  for(let plank=0;plank<4;plank++)for(let j=0;j<2;j++){
    const h=hits(L.marks[plank],first);p.time(h.at(-1).t);
    assert.ok((await p.request('nail',{plank,hits:h},L.marks[plank])).ok);
    if(j===0)assert.equal((await p.request('nail',{plank,hits:h},L.marks[plank])).reason,'not-on-beat');
    first+=4;
  }
  assert.equal(p.host.state.planks,8);assert.deepEqual(p.replica.state.nails,[2,2,2,2]);
  assert.equal((await p.request('nail',{plank:0,hits:[]},L.marks[0])).reason,'nailed');
  assert.equal(emberSave.read().boat.planks,8);
});
test('four party actors can share marks and each actor has independent consumed beats',async()=>{
  const p=pair();await start(p);
  for(let i=0;i<4;i++){const h=hits(L.marks[i],30);p.time(h.at(-1).t);assert.ok((await p.request('nail',{plank:i,hits:h},L.marks[i],i)).ok);}
  assert.equal(p.host.state.planks,4);
});
test('tar and seams run before nails; rejects far, cooled/missing pots and already sealed',async()=>{
  const p=pair();await start(p);
  assert.equal((await p.request('tar',{},L.marlo)).reason,'far');
  assert.equal((await p.request('seal',{seam:0},L.seams[0])).reason,'cooled');
  assert.ok((await p.request('tar',{},L.seep)).ok);
  const key=`${p.rSync.screenId}:0`;assert.equal(p.replica.state.tar[key].at,20);
  assert.equal((await p.request('seal',{seam:0},L.seep)).reason,'far');
  p.time(20+R.tar.coolS);assert.equal((await p.request('seal',{seam:0},L.seams[0])).reason,'cooled');
  for(let seam=0;seam<3;seam++){assert.ok((await p.request('tar',{},L.seep)).ok);assert.ok((await p.request('seal',{seam},L.seams[seam])).ok);assert.equal((await p.request('seal',{seam},L.seams[seam])).reason,'sealed');}
  assert.equal(p.host.state.planks,0);assert.deepEqual(p.replica.state.tar,{});assert.equal(emberSave.read().boat.tar,undefined);
});
test('float rejects wrong order, far, not-running, unborn leaks and double plug; overflow retries immediately',async()=>{
  const p=pair();await start(p);assert.equal((await p.request('float',{},L.deck)).reason,'wrong-order');
  p.host.debug.finishRepair();p.flush();
  assert.equal((await p.request('plug',{leak:0},L.spots[0])).reason,'not-running');
  assert.equal((await p.request('float',{},L.seep)).reason,'far');assert.ok((await p.request('float',{},L.deck)).ok);
  assert.equal((await p.request('float',{},L.deck)).reason,'running');
  const l=p.host.state.float.leaks[0],at=L.spots[l.spot];
  assert.equal((await p.request('plug',{leak:l.id},at)).reason,'bad-request');p.time(24);
  assert.equal((await p.request('plug',{leak:l.id},L.seep)).reason,'far');assert.ok((await p.request('plug',{leak:l.id},at)).ok);
  assert.equal((await p.request('plug',{leak:l.id},at)).reason,'plugged');p.tick(65);assert.equal(p.replica.state.floated,false);assert.equal(p.replica.state.float.running,false);
  assert.ok((await p.request('float',{},L.deck)).ok);assert.equal(p.replica.state.planks,8);
});
test('successful float is saved; late snapshot carries active schedule and plugged leaks silently',async()=>{
  const p=pair();p.host.debug.finishRepair();p.flush();p.host.setPartySize(()=>4);assert.ok((await p.request('float',{},L.deck)).ok);
  assert.equal(p.replica.state.float.leaks.length,15);
  for(const l of p.host.state.float.leaks){p.time(20+l.at+0.3);assert.ok((await p.request('plug',{leak:l.id},L.spots[l.spot])).ok);}
  const snap=p.hSync.domains.get('boat').snapshot();const lateSync=new WorldSync({role:'replica'}),late=createBoat({sync:lateSync}),events=[];late.on(i=>events.push(i));lateSync.domains.get('boat').applySnapshot(snap);
  assert.deepEqual(late.state.float,p.host.state.float);assert.ok(events.every(i=>!i.live));
  p.tick(65);assert.equal(p.replica.state.floated,true);assert.equal(emberSave.read().boat.floated,true);assert.equal(emberSave.read().boat.float,null);
  assert.equal(p.hSync.hash(),p.rSync.hash());
  const reload=createBoat({sync:new WorldSync()});assert.equal(reload.state.floated,true);assert.deepEqual(reload.state.tar,{});
});
test('all repair debug mutations are host-only and replicate; finishRepair does not grant floated',async()=>{
  const p=pair();for(const kind of ['debugFinishRepair','debugNail','debugSeal','debugFloat','debugEndFloat']){
    const pending=p.rSync.request('boat',kind,{plank:0,seam:0,pass:true},p.rSync.actorFor({index:0,position:pos(L.deck)}));p.flush();assert.equal((await pending).ok,false);
  }
  p.host.debug.finishRepair();p.flush();assert.equal(p.replica.state.floated,false);p.host.debug.float();p.flush();p.host.debug.endFloat(true);p.flush();assert.equal(p.replica.state.floated,true);
  assert.equal(p.hSync.hash(),p.rSync.hash());
});
test('deck has course priority only inside its zone, stays level while bobbing and validates',()=>{
  clearCourses();registerCourse(coveLayout().course);registerCourse(L.course);
  assert.equal(courseAt(L.deck.x,L.deck.z),L.course);assert.equal(courseAt(0,0),null);
  assert.ok(validateCourse(L.course,{height:getHeight}).ok);
  for(const t of [0,1,2,3]){const tops=L.course.pads.map(p=>padPos(p,t).top);assert.ok(tops.every(y=>y===tops[0]));}
  clearCourses();
});
test('real hop body can walk the gangplank from sand onto the bob deck without a jump or splash',()=>{
  const a=L.course.approach,body={x:a.from.x,z:a.from.z,y:0.3,vy:0,grounded:true,pad:null},T={height:getHeight};let splash=false;
  const steps=180;
  for(let i=0;i<=steps;i++){
    const u=i/steps;body.x=a.from.x+(a.to.x-a.from.x)*u;body.z=a.from.z+(a.to.z-a.from.z)*u;
    const events=stepHop(body,{},L.course,10+i/60,1/60,T);if(events.splash)splash=true;
  }
  assert.equal(splash,false);assert.ok(body.y>0.5);assert.ok(body.grounded);
});
test('seep, marks and seal approach are reachable without changing old cove pieces; measured route fits cooling',()=>{
  assert.ok(isWalkable(L.seep.x,L.seep.z));assert.ok(Math.abs(getHeight(L.seep.x,L.seep.z)-L.seep.top)<0.1);
  assert.ok(L.marks.every(p=>isWalkable(p.x,p.z)));
  const f=coveLayout().frame,route=[L.seep,f.to(-5.7,-4),f.to(-4.5,2.6),f.to(1.8,2.6),f.to(1.8,5.2),f.to(1.5,7),f.to(1,8),f.to(0.5,9)];
  let length=0;for(let i=1;i<route.length;i++){const a=route[i-1],b=route[i];length+=Math.hypot(b.x-a.x,b.z-a.z);for(let k=0;k<=20;k++){const u=k/20;assert.ok(isWalkable(a.x+(b.x-a.x)*u,a.z+(b.z-a.z)*u));}}
  console.log('Tar route length:',length,'run seconds:',length/PLAYER_SPEED);
  assert.ok(R.tar.coolS>=length/PLAYER_SPEED*1.6);assert.ok(R.tar.coolS<length/PLAYER_SPEED*1.8);
});
test('runtime builds once, restores offhand charms, exposes active leaks and stays below +15 conservative calls',async()=>{
  const {createBoatRepair}=await import('../public/js/world/boatRepair.js');const {createCove}=await import('../public/js/world/cove.js');const {createHopCourses}=await import('../public/js/world/hopCourses.js');
  const p=pair(),scene=new THREE.Scene(),player={index:0,position:new THREE.Vector3(L.seep.x,L.seep.top,L.seep.z),parts:{offhandSocket:new THREE.Group()},_offhandModel:{visible:true}},players={list:[player],p1:player};
  scene.add(player.parts.offhandSocket);const hop=createHopCourses({scene,players,sync:p.hSync}),cove=createCove({scene,players,boat:p.host,hop}),music={duck(){},unduck(){}};
  const repair=createBoatRepair({scene,players,sync:p.hSync,boat:p.host,hop,cove,music});await start(p);repair.update();cove.update(0.016);hop.update(0.016);
  const children=repair.group.children.length;repair.update();assert.equal(repair.group.children.length,children);
  assert.ok(p.host.request('tar',{},player).ok);repair.update();assert.equal(player._offhandModel.visible,false);assert.equal(player.parts.offhandSocket.children.length,1);
  const before=repair.summary();assert.ok(before.drawCalls<=15);console.log('68c repair with solo pot:',JSON.stringify(before));p.tick(27);repair.update();assert.equal(player._offhandModel.visible,true);assert.equal(player.parts.offhandSocket.children.length,0);
  p.host.debug.finishRepair();repair.update();hop.update(0.016);assert.equal(repair.summary().deckAdded,true);
  p.host.debug.float();p.tick(32);repair.update();assert.ok(repair.summary().items>0);
  const draws=repair.summary().drawCalls+hop.summary().drawCalls-2;assert.ok(draws<=15,`repair + deck draws ${draws}`);
  let lights=0;scene.traverse(o=>{if(o.isLight)lights++;});assert.equal(lights,0);
  let allocated=0,triangles=0;repair.group.traverse(o=>{if(o.isMesh){allocated++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);}});
  console.log('68c Node budget:',JSON.stringify(repair.summary()),'allocated repair meshes:',allocated,'triangles:',triangles,'deck hop draws:',hop.summary().drawCalls-2);
  assert.ok(allocated+2+1+1<=15,'all repair meshes + solo pot/steam + deck + next-pad glint');
  p.host.debug.reset();repair.update();cove.update(0.016);hop.update(0.016);assert.equal(repair.summary().deckAdded,false);
  p.host.debug.finishRepair();cove.update(0.016);repair.update();hop.update(0.016);assert.ok(hop.has(cove.course));assert.equal(repair.summary().deckAdded,true);
  clearCourses();
});

test('real Player walks the tar route around cove colliders to every seam without jumping or splashing', async()=>{
  const {Player}=await import('../public/js/player/player.js');
  const {addCollider,clearColliders}=await import('../public/js/world/colliders.js');
  const {PLAYER_RADIUS}=await import('../public/js/config.js');
  clearCourses();clearColliders();const c=coveLayout(),f=c.frame;
  registerCourse(c.course);for(const collider of [...c.wreck.colliders,{...c.leanTo,r:1.5},{...c.marlo,r:0.8}])addCollider(collider);
  const p=Object.create(Player.prototype);
  Object.assign(p,{radius:PLAYER_RADIUS,position:new THREE.Vector3(L.seep.x,L.seep.top,L.seep.z),velocity:{x:0,z:0},facing:0,root:{rotation:{y:0}},frozen:false,paused:false,downed:false,speedScale:1,moveGuard:null,
    _noGuard:false,_faceTo:null,speed:0,moving:false,_t:0,_hurtT:-1,_dash:null,pageDrive:null,_turnRate:0,_wasInput:false,_prevSpeed:0,_sq:0,_sqVel:0,_swingT:-1,_hopY:0,_hopVel:0,
    groundProbe:null,_course:null,_cb:null,_courseWalk:null,_courseJump:false,_splashing:false,_wet:false,_air:0,_savedProbe:null,_animatePose(){},_updateDust(){},dustBurst(){}});
  let time=0;setHopClock(()=>time);
  const route=[f.to(-5.7,-4),f.to(-4.5,2.6),f.to(1.8,2.6),f.to(1.8,5.2),f.to(1.5,7),f.to(1,8),f.to(0.5,9)];
  let seam=0;
  for(const target of route){
    for(let n=0;n<300;n++){
      const dx=target.x-p.position.x,dz=target.z-p.position.z,d=Math.hypot(dx,dz);if(d<0.14)break;
      time+=1/120;p.update(1/120,{move:{x:dx/d,z:dz/d}});
      assert.equal(p._splashing,false,`tar splash at ${time}`);
      assert.ok(n<299,`stuck en route to ${target.x},${target.z}`);
    }
    while(seam<3&&Math.hypot(p.position.x-L.seams[seam].x,p.position.z-L.seams[seam].z)<=R.reach)seam++;
  }
  assert.equal(seam,3);assert.ok(time<R.tar.coolS);console.log('Real Player tar run seconds:',time);
  clearCourses();clearColliders();
});
test('standard Interact dispatcher judges local streaks and permits two actors at one mark on the same beat with tools held',async()=>{
  const {createBoatRepair}=await import('../public/js/world/boatRepair.js');
  const {createInteractions}=await import('../public/js/world/interactions.js');
  const {findNearest,clearInteractables}=await import('../public/js/world/interactables.js');
  const {InputManager}=await import('../public/js/input/inputManager.js');
  const {getToolAction}=await import('../public/js/items/tools.js');
  clearInteractables();clearCourses();const p=pair();await start(p);
  const scene=new THREE.Scene(),make=index=>({index,position:new THREE.Vector3(L.marks[0].x,L.marks[0].top,L.marks[0].z),faceToward(){}}),a=make(0),b=make(1),players={list:[a,b],p1:a,on(){}};
  const music={duckLevel:1,duck(v){this.duckLevel=v;}};
  const repair=createBoatRepair({scene,players,sync:p.hSync,boat:p.host,hop:{add(){},remove(){}},cove:{layout:coveLayout()},music});
  const fx=createInteractions({scene,players,sync:p.hSync});repair.update();
  let pressed=false;const input=new InputManager();input.addSource('keyboard',{poll:()=>({x:0,y:0,interact:pressed})});input.update();
  for(let i=0;i<4;i++){
    p.time((40+i)*B.period);repair.update();fx.update(B.period);pressed=false;input.update();pressed=true;const actions=input.update();assert.ok(actions.interactPressed);
    const item=findNearest(a.position);assert.equal(item.type,'boatrepair');assert.equal(getToolAction({kind:'axe',state:'held'},item),null);
    assert.equal(fx.interact(item,a),true);assert.equal(fx.interact(item,b),true);
  }
  assert.equal(p.host.state.nails[0],2);assert.equal(p.host.state.planks,2);
  // An unrelated scene's lower duck survives the crew walking away.
  music.duck(0.2);a.position.set(0,0,0);b.position.set(0,0,0);repair.update();assert.equal(music.duckLevel,0.2);
  clearInteractables();clearCourses();
});

test('normalisation rejects malformed pots, premature repair/float, and forged seeded leak schedules',()=>{
  const s=ready();s.nails.fill(2);s.planks=8;s.seams.fill(true);
  const raw={...s,tar:{'host:0':{at:2},'bad':{at:5},'host:1':{at:-1},'host:2':{at:Infinity}},
    float:{running:true,seed:12,party:1,t0:100,bilge:0.2,leaks:[{id:0,at:0,spot:99,pluggedAt:101},{id:1,pluggedAt:130}]}};
  const n=normaliseBoat(raw);assert.deepEqual(n.tar,{'host:0':{at:2}});
  assert.equal(n.float.leaks[0].at,R.float.first);assert.equal(n.float.leaks[0].pluggedAt,null);assert.equal(n.float.leaks[1].pluggedAt,130);
  assert.deepEqual(normaliseBoat(n),n);
  const bad=normaliseBoat({...raw,parts:{...s.parts,sail:false},floated:true});assert.equal(bad.repair,false);assert.equal(bad.float,null);assert.equal(bad.floated,false);assert.deepEqual(bad.tar,{});
});
test('remote offhand pots follow authoritative snapshot keys and preserve the avatar hand tool',async()=>{
  const {createBoatRepair}=await import('../public/js/world/boatRepair.js');const p=pair();await start(p);
  const carrier={index:1,position:pos(L.seep)};assert.ok(p.host.request('tar',{},carrier).ok);p.flush();
  const avatar={screen:'host',index:1,position:new THREE.Vector3(L.seep.x,L.seep.top,L.seep.z),parts:{offhandSocket:new THREE.Group(),handSocket:new THREE.Group()},_offhandModel:{visible:true}};
  const tool=new THREE.Mesh();avatar.parts.handSocket.add(tool);
  const scene=new THREE.Scene(),repair=createBoatRepair({scene,players:{list:[]},avatars:{list:[avatar]},sync:p.rSync,boat:p.replica,hop:{add(){},remove(){}},cove:{layout:coveLayout()}});
  repair.update();assert.equal(avatar.parts.offhandSocket.children.length,1);assert.equal(avatar.parts.handSocket.children[0],tool);
  p.tick(27);repair.update();assert.equal(avatar.parts.offhandSocket.children.length,0);assert.equal(avatar._offhandModel.visible,true);
});
test('actual syncStress boat action completes a seeded host/replica run without exceptions or unequal hashes',async()=>{
  const NativeChannel=globalThis.MessageChannel,channels=[];
  globalThis.MessageChannel=class extends NativeChannel { constructor(){super();channels.push(this);} };
  const {runStress}=await import('../public/js/net/syncStress.js');globalThis.MessageChannel=NativeChannel;const p=pair();
  const player={index:0,position:new THREE.Vector3(),teleport(x,z){this.position.set(x,getHeight(x,z),z);}};
  const g={sync:p.hSync,players:{p1:player},items:{list:[]},pickups:{list:[]},inventory:{all:()=>[],total:0},feast:{busy:false},
    campfire:{position:{x:0,z:0},level:0,fuel:0},dayNight:{hour:12,locked:true},quests:{summary:()=>({})},harvest:{states:[]},
    boat:{...p.host.debug,api:p.host,cove:{layout:coveLayout()},goto(where){const at=p.host.layout[where];player.teleport(at.x,at.z);player.position.y=at.top;}},
    step(dt,n){p.tick(p.now()+dt*n);}};
  const oldWindow=globalThis.window;globalThis.window={__game:g,addEventListener(){},removeEventListener(){}};
  try{const result=await runStress({steps:300,seed:68,only:['boat'],wait:0,settle:0});assert.deepEqual(result.problems,[]);assert.equal(result.actions.boat,300);assert.equal(p.hSync.hash(),p.rSync.hash());}
  finally{globalThis.window=oldWindow;for(const channel of channels){channel.port1.close();channel.port2.close();}}
});
