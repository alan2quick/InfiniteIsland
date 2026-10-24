import test from 'node:test';
import assert from 'node:assert/strict';
import { dayCycleView, createTimeDial } from '../public/js/ui/timeDial.js';

test('daycycle phases follow dawn, midday and night boundaries without a numerical time label', () => {
  for (const [hour,phase] of [[0,'Night'],[5.49,'Night'],[5.5,'Morning'],[11.99,'Morning'],[12,'Afternoon'],[19.49,'Afternoon'],[19.5,'Night'],[24,'Night']]) assert.equal(dayCycleView(hour).phase,phase);
  assert.deepEqual(dayCycleView(-1),dayCycleView(23));
  assert.deepEqual(dayCycleView(48),dayCycleView(0));
  assert.deepEqual(dayCycleView(NaN),dayCycleView(8));
});

test('indicator crosses the whole strip with a gentle sun-to-moon blend at dawn and dusk', () => {
  assert.equal(dayCycleView(0).x,15); assert.equal(dayCycleView(12).x,120);
  assert.ok(dayCycleView(23.99).x>224); assert.equal(dayCycleView(12).y,17);
  assert.equal(dayCycleView(5).moon,1); assert.equal(dayCycleView(5.5).moon,.5); assert.equal(dayCycleView(6).moon,0);
  assert.equal(dayCycleView(19).moon,0); assert.equal(dayCycleView(19.5).moon,.5); assert.equal(dayCycleView(20).moon,1);
  for(let h=0;h<24;h+=.01) {const v=dayCycleView(h);assert.ok(v.x>=15&&v.x<225&&v.y>=17&&v.y<=36&&v.moon>=0&&v.moon<=1);}
});

test('passive display never edits the clock and changes accessibility text only on phase boundaries', () => {
  const nodes = new Map(),attrs=[],root={appendChild(el){this.child=el;}};
  function node(){return {style:{setProperty(k,v){this[k]=v;}},textContent:'',setAttribute(k,v){attrs.push([this,k,v]);},querySelector(s){if(!nodes.has(s))nodes.set(s,node());return nodes.get(s);}};}
  const before=globalThis.document;globalThis.document={createElement:node};
  try {
    let hour=8;const clock=Object.freeze({get hour(){return hour;}});const dial=createTimeDial(root,{clock});
    assert.equal(root.child,dial.element);assert.equal(dial.element.title,'Morning');
    assert.equal(attrs.filter(([,k])=>k==='aria-label').length,1);
    for(let i=0;i<60;i++)dial.update();
    assert.equal(attrs.filter(([,k])=>k==='aria-label').length,1);
    hour=12;dial.update();
    assert.equal(dial.element.title,'Afternoon');
    assert.equal(attrs.filter(([,k])=>k==='aria-label').length,2);
    dial.update({hour:22});assert.equal(dial.element.title,'Night');
    assert.equal(clock.hour,12,'visual preview never changes the authoritative clock');
    dial.update();assert.equal(dial.element.title,'Afternoon');
    assert.ok(!dial.element.innerHTML.includes('button'));
    assert.ok(!dial.element.innerHTML.includes('time-label'));
    assert.ok(!dial.element.innerHTML.includes('Morning'));
    assert.ok(!dial.element.innerHTML.includes('<rect'));
    assert.ok(!dial.element.innerHTML.includes('linearGradient'));
    assert.ok(dial.element.innerHTML.includes('time-wheel'));
    assert.equal(nodes.get('.time-body').style['--wheel-y'],'75.000%');
    assert.ok(!dial.element.title.match(/[0-9]/));
  } finally {globalThis.document=before;}
});

// The mobile wheel is a continuous orbit through midnight, without the desktop track's end-to-start jump.
test('mobile day wheel stays inside narrow-screen bounds and wraps continuously through midnight', () => {
  for (const [hour,x,y] of [[0,50,25],[6,75,50],[12,50,75],[18,25,50]]) {
    const view=dayCycleView(hour);assert.ok(Math.abs(view.wheelX-x)<1e-9);assert.ok(Math.abs(view.wheelY-y)<1e-9);
  }
  for(let h=0;h<24;h+=.01){const v=dayCycleView(h);assert.ok(v.wheelX>=25&&v.wheelX<=75&&v.wheelY>=25&&v.wheelY<=75);}
  const before=dayCycleView(23.999),after=dayCycleView(.001);
  assert.ok(Math.hypot(before.wheelX-after.wheelX,before.wheelY-after.wheelY)<.02);
});
