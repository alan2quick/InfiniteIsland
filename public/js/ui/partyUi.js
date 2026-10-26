// The party's HUD (Step 80a): the Mario-Party-style corner scoreboard, the big centre banner (3, 2, 1, Go! / Finish!), the card (the roulette, the how-to with its per-device button icons, the results) and the little
// "next game" pill, the kiosk-exit ring. Inline SVG icons only (ui/icons.js). Pure DOM: game/party.js owns the logic and tells this what to show; every setter is cheap and skips identical content.
//
//   const ui = createPartyUi(hudRoot)
//   ui.setActive(on)                              show / hide the whole layer
//   ui.setBoard(rows)                             rows = [{ slot, name, bot, color, stars, line, out, ready }] (the corner chips; `line` = the game's live score text)
//   ui.banner(text, { ms, tone })                 a big centred word that pops in and fades (ms = how long it stays; 0 = until the next banner / hideBanner)       ui.hideBanner()
//   ui.roulette({ ids, names, pos })              the game picker: tiles in a row, `pos` = which one is lit (a float: the highlight slides)       ui.hideCard()
//   ui.howto({ id, name, host, line, pitch, devices, left, rows })    the how-to card: devices = [{ kind: 'keyboard' | 'gamepad' | 'phone', buttons: [{ btn, verb }] }], left = seconds of practice, rows = [{ name, color, ready, bot }]
//   ui.results({ id, name, ranks, partyOver, round, bonus })      the results card: ranks = [{ name, color, place, score, stars, bot, winner }]; bonus = { label, text, names } (Step 80e: the game's feat and who did it best, or null)
//   ui.podium(rows | null)                        (Step 80e) the trophy cut's standings strip: rows = [{ place, ord, name, color, stars, bot }] already revealed, 1st first (null = hidden)
//   ui.pill(text | null)                          "Next game in 4"       ui.exit(frac | null, text)   the kiosk exit ring (null = hidden)
import { ICONS, keyCap, padButton, STICK_SVG } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const BTN = {
  jump: { keyboard: keyCap('Space'), gamepad: padButton('Y', '#ffcf3f'), phone: padButton('Jump', '#5aa0ff') },
  interact: { keyboard: keyCap('E'), gamepad: padButton('A', '#55d96a'), phone: padButton('A', '#55d96a') },
  cancel: { keyboard: keyCap('Q'), gamepad: padButton('B', '#ff7a93'), phone: padButton('B', '#ff7a93') },
  stick: { keyboard: keyCap('WASD'), gamepad: STICK_SVG, phone: STICK_SVG },
};
const DEVICE_NAME = { keyboard: 'Keyboard', gamepad: 'Controller', phone: 'Phone' };
export const buttonIcon = (btn, kind) => (BTN[btn] && (BTN[btn][kind] || BTN[btn].keyboard)) || '';

export function createPartyUi(root) {
  const el = document.createElement('div');
  el.className = 'party-ui';
  el.hidden = true;
  el.innerHTML = '<div class="pu-board"></div><div class="pu-banner" hidden></div><div class="pu-card" hidden></div><div class="pu-pill" hidden></div><div class="pu-podium" hidden></div><div class="pu-exit" hidden><svg viewBox="0 0 36 36" width="1em" height="1em"><circle class="pu-track" cx="18" cy="18" r="14"/><circle class="pu-fill" cx="18" cy="18" r="14"/></svg><span></span></div>';
  root.appendChild(el);
  const boardEl = el.querySelector('.pu-board'), bannerEl = el.querySelector('.pu-banner'), cardEl = el.querySelector('.pu-card'), pillEl = el.querySelector('.pu-pill'), podiumEl = el.querySelector('.pu-podium'), exitEl = el.querySelector('.pu-exit');
  const fillEl = exitEl.querySelector('.pu-fill'), exitText = exitEl.querySelector('span');
  const CIRC = 2 * Math.PI * 14;
  fillEl.style.strokeDasharray = `${CIRC}`;
  let boardKey = '', cardKey = '', bannerTimer = 0, pillKey = '', podiumKey = '';

  return {
    el,
    setActive(on) { el.hidden = !on; if (!on) { this.hideBanner(); this.hideCard(); this.pill(null); this.exit(null); boardEl.innerHTML = ''; boardKey = ''; } },
    setBoard(rows) {
      const key = JSON.stringify(rows);
      if (key === boardKey) return;
      boardKey = key;
      boardEl.innerHTML = rows.map((r) => `<div class="pu-chip${r.out ? ' out' : ''}" style="--pc:${esc(r.color)}"><span class="pu-name">${r.bot ? `<i class="pu-bot">${ICONS.bot}</i>` : ''}${esc(r.name)}</span><span class="pu-stars">${ICONS.star}<b>${r.stars | 0}</b></span><span class="pu-line">${esc(r.line || '')}</span>${r.ready ? '<span class="pu-ready">Ready!</span>' : ''}</div>`).join('');
    },
    banner(text, { ms = 900, tone = '' } = {}) {
      clearTimeout(bannerTimer);
      bannerEl.textContent = text;
      bannerEl.className = `pu-banner ${tone}`;
      bannerEl.hidden = false;
      void bannerEl.offsetWidth;
      bannerEl.classList.add('pop');
      if (ms > 0) bannerTimer = setTimeout(() => { bannerEl.hidden = true; }, ms);
    },
    hideBanner() { clearTimeout(bannerTimer); bannerEl.hidden = true; },
    roulette({ ids, names, pos }) {
      const key = `r|${ids.join()}`;
      if (cardKey !== key) {
        cardKey = key;
        cardEl.className = 'pu-card roulette';
        cardEl.innerHTML = `<h2>Next game!</h2><div class="pu-tiles">${ids.map((id, i) => `<div class="pu-tile" data-i="${i}"><i>${ICONS['party-' + id] || ''}</i><span>${esc(names[i])}</span></div>`).join('')}</div>`;
        cardEl.hidden = false;
      }
      const n = ids.length, lit = ((Math.round(pos) % n) + n) % n;
      cardEl.querySelectorAll('.pu-tile').forEach((t, i) => t.classList.toggle('lit', i === lit));
    },
    howto({ id, name, host, line, pitch, devices, left, rows }) {
      const key = `h|${id}|${devices.map((d) => d.kind).join()}|${rows.map((r) => (r.ready ? 1 : 0)).join('')}|${Math.ceil(left)}`;
      if (key === cardKey) return;
      cardKey = key;
      cardEl.className = 'pu-card howto';
      cardEl.innerHTML = `<div class="pu-head"><i>${ICONS['party-' + id] || ''}</i><div><h2>${esc(name)}</h2><small>with ${esc(host)}</small></div></div>
        <p class="pu-line">${esc(line)}</p><p class="pu-pitch">${esc(pitch)}</p>
        <div class="pu-devs">${devices.map((d) => `<div class="pu-dev"><b>${DEVICE_NAME[d.kind] || d.kind}</b>${d.buttons.map((b) => `<span class="pu-key">${buttonIcon(b.btn, d.kind)}<em>${esc(b.verb)}</em></span>`).join('')}</div>`).join('')}</div>
        <div class="pu-ready-row">${rows.map((r) => `<span class="pu-pip${r.ready || r.bot ? ' on' : ''}" style="--pc:${esc(r.color)}">${esc(r.name)}${r.ready || r.bot ? ' ✓' : ''}</span>`).join('')}</div>
        <p class="pu-hint">Practice now! Hold ${buttonIcon('interact', devices[0] ? devices[0].kind : 'keyboard')} to be <b>Ready</b> <small>(${Math.max(0, Math.ceil(left))})</small></p>`;
      cardEl.hidden = false;
    },
    results({ id, name, ranks, partyOver, round, bonus = null }) {
      const key = `x|${id}|${JSON.stringify(ranks)}|${partyOver}|${JSON.stringify(bonus)}`;
      if (key === cardKey) return;
      cardKey = key;
      cardEl.className = 'pu-card results';
      cardEl.innerHTML = `<div class="pu-head"><i>${partyOver ? ICONS.trophy : ICONS['party-' + id] || ''}</i><div><h2>${partyOver ? 'Party over!' : esc(name)}</h2><small>${partyOver ? 'Final stars' : `Round ${round | 0}`}</small></div></div>
        <ol class="pu-rank">${ranks.map((r) => `<li class="${r.winner ? 'win' : ''}" style="--pc:${esc(r.color)}"><b>${r.place}</b><span class="pu-n">${r.bot ? `<i class="pu-bot">${ICONS.bot}</i>` : ''}${esc(r.name)}</span><span class="pu-s">${esc(r.score)}</span><span class="pu-st">${ICONS.star}${r.stars | 0}</span>${r.winner ? `<i class="pu-pop">${ICONS.popper}</i>` : ''}</li>`).join('')}</ol>${bonus ? `<p class="pu-bonus">${ICONS.star}<b>Bonus star: ${esc(bonus.label)}</b> <span>${esc(bonus.names.join(' & '))} (${esc(bonus.text)})</span></p>` : ''}`;
      cardEl.hidden = false;
    },
    podium(rows) {
      const key = rows ? JSON.stringify(rows) : '';
      if (key === podiumKey) return;
      podiumKey = key;
      podiumEl.hidden = !rows || !rows.length;
      if (!podiumEl.hidden) podiumEl.innerHTML = rows.map((r) => `<div class="pu-pod p${r.place | 0}" style="--pc:${esc(r.color)}"><b>${esc(r.ord)}</b><span class="pu-n">${r.bot ? `<i class="pu-bot">${ICONS.bot}</i>` : ''}${esc(r.name)}</span><span class="pu-st">${ICONS.star}${r.stars | 0}</span></div>`).join('');
    },
    hideCard() { cardKey = ''; cardEl.hidden = true; },
    pill(text) {
      if (text === pillKey) return;
      pillKey = text;
      pillEl.hidden = !text;
      if (text) pillEl.textContent = text;
    },
    exit(frac, text = 'Leaving the party...') {
      exitEl.hidden = frac === null || frac === undefined;
      if (exitEl.hidden) return;
      fillEl.style.strokeDashoffset = `${CIRC * (1 - Math.min(1, Math.max(0, frac)))}`;
      exitText.textContent = text;
    },
    summary: () => ({ hidden: el.hidden, podium: podiumEl.hidden ? null : podiumEl.children.length, card: cardEl.hidden ? null : cardEl.className, banner: bannerEl.hidden ? null : bannerEl.textContent, chips: boardEl.children.length, pill: pillEl.hidden ? null : pillEl.textContent }),
  };
}
