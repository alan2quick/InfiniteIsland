import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createAdminTools, initializeExplorationSandbox, ADMIN_DESTINATIONS, testingBlockReason } from '../public/js/settings/adminTools.js';

function fixture() {
  const calls=[];
  const record=(name)=>(...args)=>{calls.push([name,...args]);return {ok:true};};
  const game={sync:{isHost:true,isReplica:false},players:{list:[{}]},link:{screens:new Set(),controllers:new Set()},avatars:{list:[]},
    world:{goto:id=>{calls.push(['travel',id]);return true;}},bridges:{build:record('bridge')},camp:{setComfort:record('camp')},
    garden:{setStage:record('garden'),api:{setSeeds:record('seeds')}},hats:{list:['one','two'],preview:record('hats')},tails:{unlockAll:record('tails')},
    garlands:{api:{debug:{unlockAll:record('garlands')}}},pets:{domain:{debugSet:record('pets')}},boat:{launch:record('boat')},
    quests:new Proxy({}, {get(){throw Error('Quest progress must not be forged');}})};
  return {game,calls};
}

test('travel only uses verified island landings and rejects unknown targets without calling goto',()=>{
  const {game,calls}=fixture(),tools=createAdminTools(game,{href:'https://island.example/editor?admin&join=SECRET',open(){assert.fail();}});
  for(const {id,label} of ADMIN_DESTINATIONS) assert.match(tools.travel(id),new RegExp(label));
  assert.deepEqual(calls.map(c=>c[1]),['home','frost','ember','duskLanding']);
  assert.throws(()=>tools.travel('party:bonk'),/listed island/);assert.equal(calls.length,4);
  assert.equal(tools.help[3].command,"__game.editor.adminTools.travel('duskLanding')");
});

test('host, solo, activity and comparison guards reject before teleport or popup side effects',()=>{
  const mutations=[g=>g.sync.isHost=false,g=>g.sync.isReplica=true,g=>g.players.list.push({}),g=>g.link.screens.add('other'),
    g=>g.link.controllers.add('phone'),g=>g.avatars.list.push({}),g=>g.cinematic={busy:true},g=>g.party={active:true},
    g=>g.storybook={pageMode:true},g=>g.dungeon={state:{active:true}},g=>g.boat.state={float:{}},g=>g.boat.sailApi={state:{startAt:0}},
    g=>g.boat.voyageScene={active:true},g=>g.bagPanel={isOpen:true},g=>g.dialog={isOpen:true},g=>g.editor={isSelecting:true},
    g=>g.editor={bridge:{comparisonOpen:true}}];
  for(const mutate of mutations){const {game,calls}=fixture();mutate(game);let opened=0;const tools=createAdminTools(game,{open(){opened++;}});
    assert.ok(testingBlockReason(game));assert.throws(()=>tools.travel('home'));assert.throws(()=>tools.unlockAll());assert.equal(calls.length,0);assert.equal(opened,0);}
});

test('unlock button opens a fresh isolated sandbox and never changes the real game or forwards private URL fields',()=>{
  const {game,calls}=fixture(),opened=[];
  const tools=createAdminTools(game,{href:'https://island.example/editor?join=ROOM&admin&token=secret',open:(...args)=>opened.push(args)});
  assert.match(tools.unlockAll(),/real progress is unchanged/);assert.equal(calls.length,0);
  assert.deepEqual(opened,[[tools.sandboxUrl,'_blank','noopener,noreferrer']]);
  const url=new URL(tools.sandboxUrl);assert.equal(url.origin,'https://island.example');assert.equal(url.pathname,'/');
  assert.equal(url.searchParams.get('editorPreview'),'1');assert.equal(url.searchParams.get('explore'),'1');assert.equal(url.searchParams.has('token'),false);
  assert.equal(initializeExplorationSandbox(game),false);assert.equal(calls.length,0);
});

test('isolated sandbox executes exact existing host unlock APIs and preflights missing methods',()=>{
  const moduleUrl=new URL('../public/js/settings/adminTools.js',import.meta.url).href;
  const script=`import assert from 'node:assert/strict';globalThis.location={search:'?editorPreview=1&explore=1'};globalThis.window=globalThis;globalThis.parent=globalThis;
    const {initializeExplorationSandbox}=await import(${JSON.stringify(moduleUrl)});
    const fixture=${fixture.toString()};const {game,calls}=fixture();
    assert.equal(initializeExplorationSandbox(game),true);
    assert.deepEqual(calls.filter(c=>c[0]==='bridge').map(c=>c[1]),['frost','ember','story']);
    assert.ok(calls.find(c=>c[0]==='camp'&&c[1]>0));assert.ok(calls.find(c=>c[0]==='garden'&&c[1]===3));
    assert.equal(calls.find(c=>c[0]==='seeds')[1].length,8);
    assert.deepEqual(calls.find(c=>c[0]==='pets')[1],['capray']);
    for(const name of ['hats','tails','garlands','pets','boat'])assert.equal(calls.filter(c=>c[0]===name).length,1);
    const bad=fixture();delete bad.game.boat.launch;assert.throws(()=>initializeExplorationSandbox(bad.game),/No unlocks applied/);assert.equal(bad.calls.length,0);`;
  execFileSync(process.execPath,['--input-type=module','-e',script]);
});
