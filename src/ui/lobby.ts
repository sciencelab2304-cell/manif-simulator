import type { Camp } from '../core/context';
import type { Net } from '../net/net';
import { mapCards, unlocked } from './meta';
import { mapById } from '../world/maps';

const $ = (id: string) => document.getElementById(id)!;
const CAMP_FR: Record<Camp, string> = { protest: 'Manifestant', police: 'CRS' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Link that opens the menu with the code already filled in (the signalling server option is kept). */
export function inviteLink(code: string) {
  const u = new URL(location.href);
  u.hash = '';
  u.searchParams.set('code', code);
  return u.toString();
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* insecure context: fall back */ }
  const t = document.createElement('textarea');
  t.value = text; document.body.appendChild(t); t.select();
  const ok = document.execCommand('copy');
  t.remove();
  return ok;
}

/** Waiting room: code to share, players and their camps, ready flags; the host launches the match. */
export function showLobby(net: Net, launch: (camp: Camp) => void) {
  const status = (t: string) => ($('l-status').textContent = t);
  const mine = () => net.members.find((m) => m.id === net.me);
  $('menu').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  $('l-code').textContent = net.code;
  $('l-start').classList.toggle('hidden', !net.isHost);
  $('l-ready').classList.toggle('hidden', net.isHost);

  const render = () => {
    $('l-list').innerHTML = net.members.map((m, i) => `<li><span class="n">${esc(m.name)}${m.id === net.me ? '<i>vous</i>' : ''}${i === 0 ? '<i>hôte</i>' : ''}</span>`
      + `<span class="c ${m.camp}">${CAMP_FR[m.camp]}</span><span class="r ${m.ready ? 'ok' : ''}">${m.ready ? '✓ prêt' : 'pas prêt'}</span></li>`).join('');
    // match options: the host chooses, the others see them
    const o = net.options;
    $('l-options').innerHTML = net.isHost
      ? `<div class="maps">${mapCards(o.map, true)}</div><label class="chk"><input type="checkbox" id="l-balanced" ${o.balanced ? 'checked' : ''}> Partie équilibrée : sans améliorations ni bonus achetés</label>`
      : `<p class="sub">Carte : <b>${mapById(o.map).name}</b>${o.balanced ? ' · partie équilibrée (sans améliorations)' : ' · améliorations plafonnées'}</p>`;
    const me = mine();
    $('l-ready').textContent = me?.ready ? 'Pas prêt' : 'Prêt';
    ($('l-start') as HTMLButtonElement).disabled = !net.allReady;
    status(net.isHost
      ? net.members.length < 2 ? 'En attente de joueurs… Gardez cette page ouverte à l\'écran pendant qu\'ils rejoignent.' : net.allReady ? 'Tout le monde est prêt.' : 'En attente que tout le monde soit prêt…'
      : me?.ready ? 'En attente du lancement par l\'hôte…' : 'Choisissez votre camp puis cliquez sur « Prêt ».');
  };
  net.onMembers = render;
  $('l-options').onclick = (e) => {
    const t = e.target as HTMLElement, m = t.closest<HTMLElement>('[data-map]');
    if (!net.isHost) return;
    if (m && unlocked(m.dataset.map!)) net.setOptions({ map: m.dataset.map! });
    else if (t.id === 'l-balanced') net.setOptions({ balanced: (t as HTMLInputElement).checked });
  };
  render();

  $('l-copy').onclick = async () => status(await copy(net.code) ? 'Code copié.' : 'Copie impossible : notez le code.');
  $('l-share').onclick = async () => {
    const url = inviteLink(net.code);
    if (navigator.share) { try { await navigator.share({ title: 'Manif Simulator', text: `Rejoins ma partie de Manif Simulator : code ${net.code}`, url }); } catch { /* cancelled */ } }
    else status(await copy(url) ? 'Lien d\'invitation copié.' : url);
  };
  $('l-ready').onclick = () => net.set('ready', !mine()?.ready);
  $('l-camp').onclick = () => { const me = mine(); if (me) net.set('camp', me.camp === 'police' ? 'protest' : 'police'); };
  $('l-start').onclick = () => {
    if (!net.allReady) return;
    net.start();
    launch(mine()!.camp);
  };
  // clients: the host's "start"
  net.handler = (m) => { if (m[0] === 'start') launch(mine()!.camp); };
}
