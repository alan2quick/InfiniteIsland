import test from 'node:test';
import assert from 'node:assert/strict';
import { createRosterDisclosure } from '../public/js/ui/rosterDisclosure.js';

function element() {
  const classes = new Set(), handlers = new Map(), attrs = new Map();
  return {
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    setAttribute: (k, v) => attrs.set(k, v), getAttribute: (k) => attrs.get(k),
    addEventListener(k, fn) { handlers.set(k, [...(handlers.get(k) || []), fn]); },
    removeEventListener(k, fn) { handlers.set(k, (handlers.get(k) || []).filter((h) => h !== fn)); },
    fire(k, options = {}) { for (const fn of handlers.get(k) || []) fn({ target: this, preventDefault() {}, stopPropagation() {}, ...options }); },
    click() { this.fire('click'); }, focus() { this.focused = true; }, contains(node) { return node === this; },
  };
}
function rig() {
  const roster = element(), trigger = element(), joinButton = element(), empty = element(), active = element(), documentTarget = element();
  empty.classList.add('empty'); let joins = 0;
  joinButton.addEventListener('click', () => joins++);
  const disclosure = createRosterDisclosure({ roster, trigger, joinButton, slots: [empty, active], documentTarget });
  return { roster, trigger, joinButton, empty, active, documentTarget, disclosure, get joins() { return joins; } };
}

test('first click reveals slots without joining; choosing an empty slot uses the existing join action once', () => {
  const r = rig();
  try {
    r.trigger.click(); assert.equal(r.disclosure.isOpen, true); assert.equal(r.joins, 0);
    assert.equal(r.trigger.getAttribute('aria-expanded'), 'true');
    r.active.click(); assert.equal(r.joins, 0, 'active players are never join targets');
    r.empty.click(); assert.equal(r.joins, 1); assert.equal(r.disclosure.isOpen, false);
    assert.equal(r.trigger.getAttribute('aria-expanded'), 'false');
  } finally { r.disclosure.dispose(); }
});

test('hover reveals safely, a click pins it, and outside press dismisses it', () => {
  const r = rig();
  try {
    r.trigger.fire('pointerenter'); assert.equal(r.disclosure.isOpen, true); assert.equal(r.joins, 0);
    r.trigger.click(); assert.equal(r.disclosure.isOpen, true, 'clicking a hover preview pins instead of immediately closing');
    r.roster.fire('pointerleave');
    r.documentTarget.fire('pointerdown'); assert.equal(r.disclosure.isOpen, false);
    assert.equal(r.joins, 0);
  } finally { r.disclosure.dispose(); }
});

test('keyboard activation of available slots joins once; Escape dismisses and returns focus', () => {
  const r = rig();
  try {
    r.trigger.click(); r.empty.fire('keydown', { code: 'Enter' }); assert.equal(r.joins, 1);
    r.trigger.click(); r.documentTarget.fire('keydown', { key: 'Escape' });
    assert.equal(r.disclosure.isOpen, false); assert.equal(r.trigger.focused, true); assert.equal(r.joins, 1);
  } finally { r.disclosure.dispose(); }
});
