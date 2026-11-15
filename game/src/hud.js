// HUD: all DOM readouts, the buy menu, the kill feed, banners, and the
// minimap — a live 2D canvas of the yard showing walls, sites, allies, the
// bomb, and enemies a teammate has recently seen. DOM writes are cached:
// a value is written only when it changes.
import { BUY_LIST, WEAPON_DEFS, GRENADE_DEFS, AMMO_PRICE } from './weapons.js';

const $ = (id) => document.getElementById(id);

export function createHud(opts) {
  const els = {
    health: $('health'), healthfill: $('healthfill'), money: $('money'),
    weaponname: $('weaponname'), ammo: $('ammo'), grenades: $('grenades'),
    scoreline: $('scoreline'), timer: $('timer'), pips: $('pips'),
    bombstatus: $('bombstatus'), feed: $('feed'),
    banner: $('banner'), subbanner: $('subbanner'),
    prompt: $('prompt'), plantbar: $('plantbar'), plantfill: $('plantfill'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'), damageflash: $('damageflash'),
    buy: $('buy'), buymoney: $('buymoney'), buytable: $('buytable'),
    minimap: $('minimap'),
  };
  const mm = els.minimap.getContext('2d');
  const cache = {};
  let hitAt = 0;

  function setText(el, key, value) {
    if (cache[key] !== value) {
      cache[key] = value;
      el.textContent = value;
    }
  }

  function setHtml(el, key, value) {
    if (cache[key] !== value) {
      cache[key] = value;
      el.innerHTML = value;
    }
  }

  function buildBuyTable() {
    const rows = BUY_LIST.map((item) => {
      const name = item.kind === 'weapon'
        ? WEAPON_DEFS[item.id].name
        : item.kind === 'grenade'
          ? `${GRENADE_DEFS[item.id].name} grenade`
          : 'Refill ammo (current weapon)';
      const price = item.kind === 'weapon'
        ? WEAPON_DEFS[item.id].price
        : item.kind === 'grenade'
          ? GRENADE_DEFS[item.id].price
          : AMMO_PRICE;
      return `<tr data-kind="${item.kind}" data-id="${item.id}"><td class="key">${item.key}</td><td class="name">${name}</td><td class="price">$${price}</td></tr>`;
    }).join('');
    els.buytable.innerHTML = rows;
  }
  buildBuyTable();

  function updateBuy(owned, money) {
    setText(els.buymoney, 'buymoney', `$${money}`);
    for (const row of els.buytable.rows) {
      const { kind, id } = row.dataset;
      const price = kind === 'weapon' ? WEAPON_DEFS[id].price : kind === 'grenade' ? GRENADE_DEFS[id].price : AMMO_PRICE;
      const isOwned = kind === 'weapon' && owned[id];
      row.classList.toggle('owned', !!isOwned);
      row.classList.toggle('cant', money < price && !isOwned);
    }
  }

  function showBuy(open) {
    els.buy.style.display = open ? 'block' : 'none';
  }

  function banner(text, sub = '') {
    setText(els.banner, 'banner', text);
    setText(els.subbanner, 'subbanner', sub);
  }

  function clearBanner() {
    setText(els.banner, 'banner', '');
    setText(els.subbanner, 'subbanner', '');
  }

  function prompt(html) {
    if (html) {
      els.prompt.classList.remove('hidden');
      setHtml(els.prompt, 'prompt', html);
    } else {
      els.prompt.classList.add('hidden');
    }
  }

  function plantProgress(ratio) {
    if (ratio == null) {
      els.plantbar.classList.add('hidden');
    } else {
      els.plantbar.classList.remove('hidden');
      els.plantfill.style.width = `${Math.round(ratio * 100)}%`;
    }
  }

  function feed(html, cls = '') {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.innerHTML = html;
    els.feed.prepend(div);
    while (els.feed.children.length > 5) els.feed.removeChild(els.feed.lastChild);
    setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 9000);
  }

  function hitmarker() {
    els.hitmarker.style.opacity = '1';
    hitAt = performance.now();
  }

  function damageFlash() {
    els.damageflash.style.opacity = '1';
    setTimeout(() => { els.damageflash.style.opacity = '0'; }, 140);
  }

  // Minimap: 168x126 canvas, yard x -32..32, z -24..24.
  function drawMinimap(view) {
    const W = 168;
    const H = 126;
    const sx = (x) => ((x + 32) / 64) * W;
    const sz = (z) => ((z + 24) / 48) * H;
    mm.fillStyle = '#0c1116';
    mm.fillRect(0, 0, W, H);
    mm.fillStyle = '#2a3138';
    for (const s of view.solids) {
      if (s.y1 > 3) continue; // tall walls read as borders, skip the clutter
      mm.fillRect(sx(s.x0), sz(s.z0), Math.max(1, sx(s.x1) - sx(s.x0)), Math.max(1, sz(s.z1) - sz(s.z0)));
    }
    mm.fillStyle = '#ff8c1a';
    for (const key of ['A', 'B']) {
      const site = view.sites[key];
      mm.beginPath();
      mm.arc(sx(site.x), sz(site.z), 4, 0, Math.PI * 2);
      mm.fill();
      mm.fillStyle = '#0c1116';
      mm.font = 'bold 7px sans-serif';
      mm.textAlign = 'center';
      mm.textBaseline = 'middle';
      mm.fillText(key, sx(site.x), sz(site.z));
      mm.fillStyle = '#ff8c1a';
    }
    // Allies + player.
    for (const a of view.allies) {
      mm.fillStyle = '#ff8c1a';
      mm.beginPath();
      mm.arc(sx(a.x), sz(a.z), a.you ? 3.5 : 2.5, 0, Math.PI * 2);
      mm.fill();
    }
    if (view.bomb.visible) {
      const blink = Math.floor(view.now * 3) % 2 === 0;
      if (blink) {
        mm.fillStyle = '#ff453a';
        mm.beginPath();
        mm.arc(sx(view.bomb.x), sz(view.bomb.z), 3.5, 0, Math.PI * 2);
        mm.fill();
      }
    }
    // Enemies only where a teammate saw one recently (fades after 3 s).
    for (const e of view.enemies) {
      const age = view.now - e.at;
      if (age > 3) continue;
      mm.globalAlpha = Math.max(0.25, 1 - age / 3);
      mm.fillStyle = '#58a6ff';
      mm.beginPath();
      mm.arc(sx(e.x), sz(e.z), 2.5, 0, Math.PI * 2);
      mm.fill();
      mm.globalAlpha = 1;
    }
    // Player facing arrow.
    const px = sx(view.you.x);
    const pz = sz(view.you.z);
    mm.save();
    mm.translate(px, pz);
    mm.rotate(Math.atan2(view.you.dirX, -view.you.dirZ) * -1 + Math.PI);
    mm.fillStyle = '#ffffff';
    mm.beginPath();
    mm.moveTo(0, -6);
    mm.lineTo(4, 5);
    mm.lineTo(-4, 5);
    mm.closePath();
    mm.fill();
    mm.restore();
  }

  function update(state) {
    // state: { health, money, weaponName, mag, reserve, grenades, score,
    //   timerText, urgent, pips, bombText, bombPlanted, crosshairGap }
    setText(els.health, 'health', String(Math.max(0, Math.round(state.health))));
    els.health.classList.toggle('low', state.health <= 30);
    els.healthfill.style.width = `${Math.max(0, state.health)}%`;
    els.healthfill.classList.toggle('low', state.health <= 30);
    setText(els.money, 'money', `$${state.money}`);
    setText(els.weaponname, 'weaponname', state.weaponName);
    setHtml(els.ammo, 'ammo', `${state.mag} <small>/ ${state.reserve}</small>`);
    setText(els.grenades, 'grenades', state.grenades);
    setHtml(els.scoreline, 'scoreline', `<span class="att">${state.score.attack}</span> — <span class="def">${state.score.defend}</span>`);
    setText(els.timer, 'timer', state.timerText);
    els.timer.classList.toggle('urgent', !!state.urgent);
    setHtml(els.pips, 'pips', state.pips);
    setText(els.bombstatus, 'bombstatus', state.bombText);
    els.bombstatus.classList.toggle('planted', !!state.bombPlanted);
    els.crosshair.style.setProperty('--gap', `${state.crosshairGap}px`);
    if (performance.now() - hitAt > 130) els.hitmarker.style.opacity = '0';
    if (state.minimap) drawMinimap(state.minimap);
  }

  return { update, updateBuy, showBuy, banner, clearBanner, prompt, plantProgress, feed, hitmarker, damageFlash };
}
