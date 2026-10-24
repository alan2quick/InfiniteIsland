import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { installPreviewIsolation, createPreviewLink, mountPreviewReceiver } from '../public/js/settings/previewRuntime.js';
import { DEFAULT_WORLD_SETTINGS } from '../public/js/settings/worldSettings.js';
import { createEnvironmentBridge } from '../public/js/settings/environmentBridge.js';

test('child storage is ephemeral and never reads or changes parent progress', () => {
  const parentStorage = { getItem() { throw new Error('must not read parent'); }, setItem() { throw new Error('must not write parent'); } };
  const child={localStorage:parentStorage,sessionStorage:parentStorage};installPreviewIsolation(child);
  assert.equal(child.localStorage.getItem('progress'),null);child.localStorage.setItem('progress',42);
  assert.equal(child.localStorage.getItem('progress'),'42');assert.equal(child.sessionStorage.getItem('progress'),null);
  assert.equal(child.localStorage.getItem('infiniteIsland.muted'),'1');
  assert.notEqual(child.localStorage,parentStorage);
});

test('preview link exposes the normal passive interface without creating a connection', () => {
  const link=createPreviewLink();assert.equal(link.connected,false);assert.equal(link.code,null);
  assert.equal(link.on('room',()=>assert.fail()),link);assert.equal(link.sendToScreen('other',{}),false);
  assert.equal(link.controllers.size,0);assert.equal(link.screens.size,0);link.close();
});

test('only exact same-origin parent messages with a complete valid settings object apply', () => {
  const listeners=new Map(),ready=[],applied=[];
  const parent={postMessage:(...args)=>ready.push(args)};
  const target={parent,location:{origin:'https://island.example'},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const dispose=mountPreviewReceiver({target,apply:value=>applied.push(value)});
  assert.deepEqual(ready,[[{type:'island-editor-preview-ready'},target.location.origin]]);
  const good={source:parent,origin:target.location.origin,data:{type:'island-editor-preview',settings:DEFAULT_WORLD_SETTINGS}};
  for(const event of [{...good,source:{}},{...good,origin:'https://evil.example'},{...good,data:{type:'other',settings:DEFAULT_WORLD_SETTINGS}},{...good,data:{type:good.data.type,settings:{hour:5}}},{...good,data:{type:good.data.type,settings:{...DEFAULT_WORLD_SETTINGS,brightness:50}}}]) listeners.get('message')(event);
  assert.equal(applied.length,0);listeners.get('message')(good);assert.deepEqual(applied,[DEFAULT_WORLD_SETTINGS]);
  dispose();assert.equal(listeners.size,0);
});

test('preview save master cannot be enabled even with newgame or join parameters', () => {
  const runtime=new URL('../public/js/settings/previewRuntime.js',import.meta.url).href;
  const save=new URL('../public/js/game/save.js',import.meta.url).href;
  const script=`globalThis.location={search:'?editorPreview=1&newgame&join=OTHER'};globalThis.window=globalThis;await import(${JSON.stringify(runtime)});const save=await import(${JSON.stringify(save)});save.setSaveEnabled(true);if(save.NEW_GAME||save.saveEnabled||save.writeSave('progress',{bad:true})||save.loadSave('progress')!==null)throw Error('preview escaped isolation');`;
  execFileSync(process.execPath,['--input-type=module','-e',script]);
});

test('comparison pause is reversible and never publishes or alters preview clock settings', () => {
  let releases=0;const bridge=createEnvironmentBridge({keyboard:{releaseAll(){releases++;}}});
  assert.equal(bridge.comparisonOpen,false);bridge.setComparisonOpen(true);assert.equal(bridge.comparisonOpen,true);
  bridge.setComparisonOpen(false);assert.equal(bridge.comparisonOpen,false);assert.equal(releases,2);
  bridge.setComparisonOpen(true);bridge.dispose();assert.equal(bridge.comparisonOpen,false);
});
