import type { Camp } from '../core/context';
import { save, onSave, persist, resetSave } from '../meta/save';
import { CURRENCY, xpNeeded, grant, matchRewards, type MatchResult } from '../meta/progression';
import { ITEMS, SLOT_FR, owns, buy, toggleEquip, UPGRADES, upgradeCost, buyUpgrade, BOOSTS, MULTI_CAP, item, type Slot } from '../meta/shop';
import { lists, record, type Row } from '../meta/challenges';
import { adsLeft, ADS_PER_DAY, showRewardedAd } from '../meta/ads';
import { MAPS, mapById } from '../world/maps';

/** Menu bar (Pavés d'or, level, XP), shop, challenges, rewarded ads, map choice and end-of-match rewards. */
const $ = (id: string) => document.getElementById(id)!;
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const coin = (n: number) => `<span class="price"><i class="coin"></i>${n}</span>`;
const CAMP_FR: Record<Camp, string> = { protest: 'Manifestant', police: 'CRS' };
const AD_COINS = 50;

let camp: () => Camp = () => 'protest';

// ------------------------------------------------------------------ map choice (solo and host)
const MAP_KEY = 'manif-map';
let chosenMap = (() => { try { return localStorage.getItem(MAP_KEY) ?? 'tanneurs'; } catch { return 'tanneurs'; } })();
export const unlocked = (id: string) => save.level >= mapById(id).level;
export const selectedMap = () => (unlocked(chosenMap) ? chosenMap : 'tanneurs');
export function chooseMap(id: string) {
  if (!unlocked(id)) return;
  chosenMap = id;
  try { localStorage.setItem(MAP_KEY, id); } catch { /* ignore */ }
  renderMaps();
}
/** Map cards; `onPick` lets the lobby forward the host's choice. */
export function mapCards(selected: string, interactive: boolean) {
  return MAPS.map((m) => {
    const open = unlocked(m.id);
    return `<button class="mapcard${m.id === selected ? ' sel' : ''}" data-map="${m.id}" ${!interactive || !open ? 'disabled' : ''}>
      <b>${m.name}</b><span>${open ? m.desc : `Débloquée au niveau ${m.level}`}</span></button>`;
  }).join('');
}
function renderMaps() { $('maps').innerHTML = mapCards(selectedMap(), true); }

// ------------------------------------------------------------------ menu bar
function renderBar() {
  $('mb-coins').textContent = String(save.coins);
  $('mb-level').textContent = String(save.level);
  ($('mb-xp') as HTMLElement).style.width = `${(save.xp / xpNeeded(save.level)) * 100}%`;
  $('mb-xpt').textContent = `${save.xp} / ${xpNeeded(save.level)} XP`;
  const l = lists();
  $('mb-ch-dot').classList.toggle('hidden', ![...l.daily, ...l.weekly, ...l.achievements].some((r) => r.done && !r.claimed));
  const ad = $('mb-ad') as HTMLButtonElement;
  ad.textContent = `Pub récompensée ${adsLeft()}/${ADS_PER_DAY}`;
  ad.disabled = adsLeft() === 0;
  const b = save.boost && BOOSTS[save.boost];
  $('boost-line').classList.toggle('hidden', !b);
  if (b) $('boost-line').innerHTML = `Bonus de départ prêt pour la prochaine partie : <b>${b.name}</b> (${b.desc[camp()]})`;
  renderMaps();
}

export function initMeta(getCamp: () => Camp) {
  camp = getCamp;
  onSave(renderBar);
  renderBar();
  $('mb-shop').onclick = () => openShop(camp());
  $('mb-ch').onclick = openChallenges;
  $('mb-ad').onclick = openAdPick;
  $('s-reset').onclick = () => { if (confirm('Effacer toute la progression (Pavés d\'or, niveau, skins, améliorations, défis) ?')) resetSave(); };
  $('maps').onclick = (e) => { const m = (e.target as HTMLElement).closest<HTMLElement>('[data-map]'); if (m) chooseMap(m.dataset.map!); };
  return renderBar;
}

/** A full-screen panel with a back button; `onClick` gets the clicked [data-act] element. */
function panel(id: string, html: () => string, onClick: (el: HTMLElement) => void) {
  const screen = $(id), inner = screen.querySelector('.menu-inner')!;
  const draw = () => { inner.innerHTML = html() + '<button class="ghost back" data-act="close">Retour</button>'; };
  (inner as HTMLElement).onclick = (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    if (el.dataset.act === 'close') { screen.classList.add('hidden'); return; }
    onClick(el);
    draw();
  };
  draw();
  screen.classList.remove('hidden');
  screen.scrollTop = 0;
  return draw;
}
const wallet = () => `<div class="wallet"><i class="coin"></i><b>${save.coins}</b> ${CURRENCY}<button class="ghost" disabled>Acheter des ${CURRENCY} · bientôt</button></div>`;

// ------------------------------------------------------------------ shop
function openShop(start: Camp) {
  let tab: Camp = start;
  const card = (id: string) => {
    const i = item(id)!, own = owns(i), on = save.equipped[`${i.camp}.${i.slot}`] === i.id;
    const btn = on ? '<button class="ghost" data-act="equip" data-id="' + i.id + '">Retirer</button>'
      : own ? `<button data-act="equip" data-id="${i.id}">Équiper</button>`
      : i.level !== undefined ? `<button disabled>Niveau ${i.level}</button>`
      : `<button data-act="buy" data-id="${i.id}" ${save.coins < i.price! ? 'disabled' : ''}>${coin(i.price!)}</button>`;
    return `<div class="card${on ? ' on' : ''}"><i class="sw" style="background:${hex(i.swatch)}"></i><b>${i.name}</b>${btn}</div>`;
  };
  panel('shop', () => `<h2>Boutique</h2>${wallet()}
    <div class="tabs">${(['protest', 'police'] as Camp[]).map((c) => `<button class="${c === tab ? '' : 'ghost'}" data-act="tab" data-camp="${c}">${CAMP_FR[c]}</button>`).join('')}</div>
    ${(Object.keys(SLOT_FR) as Slot[]).map((slot) => `<h3>${SLOT_FR[slot]}</h3><div class="grid">${ITEMS.filter((i) => i.camp === tab && i.slot === slot).map((i) => card(i.id)).join('')}</div>`).join('')}
    <h3>Améliorations permanentes</h3>
    <p class="note">Valables dans les deux camps. En ligne, leur effet est plafonné au palier ${MULTI_CAP}, et l'hôte peut les couper (« partie équilibrée »).</p>
    ${UPGRADES.map((u) => {
      const t = save.upgrades[u.id] ?? 0;
      return `<div class="up"><div><b>${u.name}</b><span>${u.desc[tab]}</span><i class="pips">${'●'.repeat(t)}${'○'.repeat(u.tiers - t)}</i></div>
        ${t >= u.tiers ? '<button disabled>Max</button>' : `<button data-act="up" data-id="${u.id}" ${save.coins < upgradeCost(t) ? 'disabled' : ''}>${coin(upgradeCost(t))}</button>`}</div>`;
    }).join('')}`, (el) => {
    const a = el.dataset.act, i = item(el.dataset.id ?? '');
    if (a === 'tab') tab = el.dataset.camp as Camp;
    else if (a === 'buy' && i) buy(i);
    else if (a === 'equip' && i) toggleEquip(i);
    else if (a === 'up') buyUpgrade(UPGRADES.find((u) => u.id === el.dataset.id)!);
  });
}

// ------------------------------------------------------------------ challenges
function openChallenges() {
  const row = (r: Row, k: number) => `<div class="ch${r.claimed ? ' claimed' : ''}"><div><b>${r.c.text}</b>
    <div class="bar"><div style="width:${(r.progress / r.c.goal) * 100}%"></div></div><span>${r.c.metric === 'survive' ? `${Math.floor(r.progress / 60)} / ${r.c.goal / 60} min` : `${r.progress} / ${r.c.goal}`}</span></div>
    ${r.claimed ? '<button disabled>Récupéré</button>' : `<button data-act="claim" data-k="${k}" ${r.done ? '' : 'disabled'}>${coin(r.c.reward)}</button>`}</div>`;
  let rows: Row[] = [];
  panel('challenges', () => {
    const l = lists();
    rows = [...l.daily, ...l.weekly, ...l.achievements];
    let k = 0;
    const section = (title: string, list: Row[]) => `<h3>${title}</h3>${list.map((r) => row(r, k++)).join('')}`;
    return `<h2>Défis</h2>${wallet()}${section('Quotidiens · renouvelés à minuit', l.daily)}${section('De la semaine · renouvelés le lundi', l.weekly)}${section('Succès', l.achievements)}`;
  }, (el) => {
    const coins = rows[+el.dataset.k!]?.claim() ?? 0;
    if (coins) grant(coins, Math.round(coins / 2));
  });
}

// ------------------------------------------------------------------ rewarded ads in the menu
function openAdPick() {
  let draw = () => {};
  draw = panel('adpick', () => `<h2>Pub récompensée</h2>
    <p class="sub">Regardez une pub de 15 secondes jusqu'au bout pour choisir votre récompense. Encore ${adsLeft()} sur ${ADS_PER_DAY} aujourd'hui.</p>
    <div class="adopts">
      <button data-act="coins" ${adsLeft() ? '' : 'disabled'}>+${AD_COINS} ${CURRENCY}</button>
      ${Object.entries(BOOSTS).map(([id, b]) => `<button class="ghost" data-act="boost" data-id="${id}" ${adsLeft() ? '' : 'disabled'}>
        Bonus de départ : ${b.name}<small>${b.desc[camp()]}${save.boost === id ? ' · déjà prêt' : ''}</small></button>`).join('')}
    </div>
    <p class="note">Un seul bonus de départ à la fois, utilisé par la prochaine partie (sauf partie équilibrée).</p>`, (el) => {
    const id = el.dataset.id;
    showRewardedAd(() => {
      if (el.dataset.act === 'coins') save.coins += AD_COINS; else save.boost = id!;
      persist();
    }, () => draw());
  });
}

// ------------------------------------------------------------------ end of match
export function showEndRewards(r: MatchResult) {
  const { lines, coins, xp } = matchRewards(r);
  const done = record(r);
  const news = grant(coins, xp);
  const box = $('end-rewards');
  const draw = (doubled: boolean) => {
    box.innerHTML = `<div class="gain">+${coins * (doubled ? 2 : 1)} <i class="coin"></i> ${CURRENCY} · +${xp * (doubled ? 2 : 1)} XP</div>
      <ul>${lines.map(([k, v]) => `<li><span>${k}</span><b>+${v}</b></li>`).join('')}${doubled ? '<li><span>Pub : gains doublés</span><b>×2</b></li>' : ''}</ul>
      <div class="lvl">Niveau ${save.level}<div class="xpbar"><div style="width:${(save.xp / xpNeeded(save.level)) * 100}%"></div></div>${save.xp} / ${xpNeeded(save.level)} XP</div>
      ${[...news, ...done.map((d) => `Défi réussi : ${d} (récompense dans « Défis »)`)].map((n) => `<p class="news">${n}</p>`).join('')}
      ${doubled ? '' : `<button id="end-double" class="ghost" ${adsLeft() ? '' : 'disabled'}>Doubler les gains (pub)</button>`}`;
    const dbl = document.getElementById('end-double');
    if (dbl) dbl.onclick = () => showRewardedAd(() => { news.push(...grant(coins, xp)); draw(true); });
  };
  draw(false);
}
