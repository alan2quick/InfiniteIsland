/** Revealing available slots never activates the existing join action. */
export function createRosterDisclosure({ roster, trigger, joinButton, slots, documentTarget = document }) {
  let open = false, pinned = false, timer = null;
  function show(pin = false) {
    clearTimeout(timer); open = true; pinned ||= pin;
    roster.classList.add('join-open'); trigger.setAttribute('aria-expanded', 'true');
  }
  function close() {
    clearTimeout(timer); open = pinned = false;
    roster.classList.remove('join-open'); trigger.setAttribute('aria-expanded', 'false');
  }
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (open && pinned) close(); else show(true);
  });
  trigger.addEventListener('pointerenter', () => show());
  roster.addEventListener('pointerenter', () => clearTimeout(timer));
  roster.addEventListener('pointerleave', () => { if (!pinned) timer = setTimeout(close, 250); });
  trigger.addEventListener('keydown', (event) => { if (['Enter', 'Space'].includes(event.code)) event.stopPropagation(); });
  for (const slot of slots) {
    const join = (event) => {
      if (!slot.classList.contains('empty')) return;
      event.preventDefault(); event.stopPropagation(); close(); joinButton.click();
    };
    slot.addEventListener('click', join);
    slot.addEventListener('keydown', (event) => { if (['Enter', 'Space'].includes(event.code)) join(event); });
  }
  const outside = (event) => { if (!roster.contains(event.target)) close(); };
  const escape = (event) => { if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); trigger.focus(); } };
  documentTarget.addEventListener?.('pointerdown', outside);
  documentTarget.addEventListener?.('keydown', escape);
  joinButton.addEventListener('click', close);
  return { close, get isOpen() { return open; }, dispose() { close(); documentTarget.removeEventListener?.('pointerdown', outside); documentTarget.removeEventListener?.('keydown', escape); } };
}
