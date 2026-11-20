import { initRapier } from './core/physics';
import { Input } from './core/input';
import { loadSettings, saveSettings } from './core/settings';
import { AudioEngine } from './audio/audio';
import { Game } from './game';
import type { Camp } from './core/context';
import { ctx } from './core/context';
import { isTouch, enterFullscreen } from './core/device';
import { TouchControls } from './ui/touch';
import { showLobby } from './ui/lobby';
import { Net } from './net/net';
import { initMeta, selectedMap } from './ui/meta';
import { lookSpec, rules } from './meta/shop';
import { sdk, store, gameplay, loading, banners, invitedCode, siteMuted, onAdMute, room, onJoinRoom, instantMultiplayer, accountName } from './core/platform';
import { t, tr, lang, setLang, type Lang } from './core/i18n';

const $ = (id: string) => document.getElementById(id)!;
const settings = loadSettings();
let game: Game | null = null;
let audio: AudioEngine | null = null;
const input = new Input(document.body);
document.body.classList.toggle('touch', isTouch);
document.body.classList.toggle('ads', !!sdk);
// no page zoom on phones: double tap (also blocked in CSS) and pinch, which iOS Safari allows despite the viewport tag
for (const t of ['gesturestart', 'dblclick']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
let lastTap = 0; // older browsers: a second tap within 300 ms on the game controls is not a zoom (they act on pointerdown)
$('hud').addEventListener('touchend', (e) => { if (e.timeStamp - lastTap < 300) e.preventDefault(); lastTap = e.timeStamp; }, { passive: false });

// ------------------------------------------------------------------ settings UI
const sens = $('s-sens') as HTMLInputElement, vol = $('s-vol') as HTMLInputElement, fov = $('s-fov') as HTMLInputElement;
const quality = $('s-quality') as HTMLSelectElement, blood = $('s-blood') as HTMLInputElement, invert = $('s-invert') as HTMLInputElement, third = $('s-third') as HTMLInputElement;
sens.value = String(settings.sensitivity); vol.value = String(settings.volume); fov.value = String(settings.fov);
quality.value = settings.quality; blood.checked = settings.blood; invert.checked = settings.invertY; third.checked = settings.thirdPerson;
const sync = () => {
  settings.sensitivity = +sens.value; settings.volume = +vol.value; settings.fov = +fov.value;
  settings.quality = quality.value as typeof settings.quality; settings.blood = blood.checked; settings.invertY = invert.checked; settings.thirdPerson = third.checked;
  saveSettings(settings);
  applyVolume();
};
// the site's mute setting and video ads silence the game whatever its volume
let muted = siteMuted((m) => { muted = m; applyVolume(); }), adPlaying = false;
onAdMute((m) => { adPlaying = m; applyVolume(); });
function applyVolume() { audio?.setVolume(muted || adPlaying ? 0 : settings.volume); }
for (const el of [sens, vol, fov, quality, blood, invert, third]) el.addEventListener('input', sync);

// ------------------------------------------------------------------ menu: name, camp, mode
const net = new Net();
const campButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.camp'));
const modeButtons = ['m-solo', 'm-create', 'm-join'].map((id) => $(id) as HTMLButtonElement);
const pseudo = $('pseudo') as HTMLInputElement, codeInput = $('m-code') as HTMLInputElement;
let camp: Camp = 'protest';
const pickCamp = (c: Camp) => { camp = c; campButtons.forEach((b) => b.classList.toggle('sel', b.dataset.camp === c)); };
const redrawMeta = initMeta(() => camp);
campButtons.forEach((b) => b.addEventListener('click', () => { pickCamp(b.dataset.camp as Camp); redrawMeta(); }));
pseudo.value = store.get('manif-name') ?? store.get('paves-name') ?? '';
codeInput.value = invitedCode() ?? '';
const name = () => { const n = pseudo.value.trim().slice(0, 16) || t('Anonyme'); store.set('manif-name', n); return n; };
// language: one click, from the very first screen
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-lang]')) {
  b.classList.toggle('sel', b.dataset.lang === lang);
  b.onclick = () => setLang(b.dataset.lang as Lang);
}
/** The side ad banners live on the main menu only. */
const AD_SLOTS = ['ad-left', 'ad-right'];
const menuAds = (show: boolean) => banners(show, AD_SLOTS);
const busy = (b: boolean, msg = '') => { modeButtons.forEach((x) => (x.disabled = b)); $('loading').textContent = tr(msg); };

async function online(how: 'create' | 'join', wanted?: string) {
  const code = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (how === 'join' && code.length < 5) { codeInput.focus(); $('loading').textContent = t('Saisissez le code de la partie.'); return; }
  busy(true, how === 'create' ? 'Création de la partie…' : 'Connexion à la partie…');
  menuAds(false);
  net.looks = { protest: lookSpec('protest'), police: lookSpec('police') };
  net.options = { map: selectedMap(), balanced: false };
  try {
    if (how === 'create') await net.create(name(), camp, wanted); else await net.join(code, name(), camp, (msg) => busy(true, msg));
    busy(false);
    showLobby(net, start);
  } catch (e) {
    net.leave();
    busy(false, (e as Error).message || 'Connexion impossible.');
    menuAds(true);
  }
}
modeButtons[0].addEventListener('click', () => start(camp));
modeButtons[1].addEventListener('click', () => online('create'));
modeButtons[2].addEventListener('click', () => online('join'));
codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') online('join'); });

/** The connection ended: from the lobby, back to the menu; in a match, end screen. */
net.onClosed = (why) => {
  net.leave();
  room(null);
  if (game) { game.showEnd(null, why); return; }
  $('lobby').classList.add('hidden');
  $('menu').classList.remove('hidden');
  busy(false, why);
  menuAds(true);
};

function start(c: Camp) {
  if (game) return;
  sync();
  // online, purchased bonuses are capped, or off in a balanced match; the host chose the map
  rules.multi = net.multi;
  rules.balanced = net.multi && net.options.balanced;
  const map = net.multi ? net.options.map : selectedMap();
  audio = audio ?? new AudioEngine();
  applyVolume();
  audio.resume();
  if (isTouch) { if (!sdk) enterFullscreen(); } else input.lock(); // CrazyGames has its own fullscreen button
  busy(true, 'Construction de Valbrune… (quelques secondes)');
  menuAds(false);
  $('lobby').classList.add('hidden');
  $('menu').classList.remove('hidden');
  // multiplayer: the menus lead back to the main menu, and the match keeps running behind the pause screen
  $('pause-net').classList.toggle('hidden', !net.multi);
  $('restart').classList.toggle('hidden', net.multi);
  $('again').textContent = t(net.multi ? 'Rejouer avec le groupe' : 'Rejouer');
  $('switch').textContent = t(net.multi ? 'Menu principal' : 'Changer de camp');
  if (net.multi) room(net.code, false);
  // let the browser paint the message before the heavy city generation
  setTimeout(() => {
    try {
      game = new Game(c, settings, input, audio!, net, map);
      $('menu').classList.add('hidden');
      game.start();
      gameplay(true);
      if (isTouch) new TouchControls(input, c, () => setPaused(true));
      else if (!input.locked) setPaused(true);
    } catch (e) {
      $('loading').textContent = t('Erreur : ') + (e as Error).message;
      console.error(e);
    }
  }, 60);
}

// pause / resume: pointer lock on desktop, the ❚❚ button (or leaving the app) on touch screens
function setPaused(p: boolean) {
  if (!game || ctx.over) return;
  game.setPaused(p);
  gameplay(!p);
  $('pause').classList.toggle('hidden', !p);
  if (p) input.reset();
}
input.onLockChange = (locked) => setPaused(!locked);
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
$('resume').addEventListener('click', () => { if (isTouch) { if (!sdk) enterFullscreen(); setPaused(false); } else input.lock(); });
$('app').addEventListener('click', () => { if (game && !ctx.over && !isTouch && !input.locked) input.lock(); });
const restart = (c: Camp | null) => {
  net.leave();
  room(null);
  try { if (c && !net.multi) sessionStorage.setItem('manif-autostart', c); else sessionStorage.removeItem('manif-autostart'); } catch { /* ignore */ }
  location.reload();
};
$('restart').addEventListener('click', () => restart(camp));
$('quit').addEventListener('click', () => restart(null));
$('again').addEventListener('click', () => {
  if (!net.multi) restart(camp);
  else if (net.isHost) again();
  else { ($('again') as HTMLButtonElement).disabled = true; $('again').textContent = t('En attente de l\'hôte…'); } // the host's 'again' brings everybody back
});
$('switch').addEventListener('click', () => restart(net.multi ? null : camp === 'police' ? 'protest' : 'police'));
/** Next match with the same group: the host opens the same room again after the reload, the others join it. */
function again() {
  const host = net.isHost;
  if (host) net.broadcast(['again']);
  try { sessionStorage.setItem('manif-again', JSON.stringify({ how: host ? 'create' : 'join', code: net.code, camp })); } catch { /* ignore */ }
  setTimeout(() => restart(null), host ? 300 : 0);
}
net.onAgain = again;
// a friend's room picked on CrazyGames while the game is open
onJoinRoom((code) => {
  if (game || net.multi) { try { sessionStorage.setItem('manif-again', JSON.stringify({ how: 'join', code, camp })); } catch { /* ignore */ } restart(null); }
  else { codeInput.value = code; online('join'); }
});
$('l-quit').addEventListener('click', () => restart(null));
window.addEventListener('pagehide', () => net.leave());

// ------------------------------------------------------------------ boot
initRapier().then(async () => {
  busy(false, 'Choisissez votre camp, puis appuyez sur Jouer.');
  loading(false);
  menuAds(true);
  const account = await accountName(); // CrazyGames: friends see each other under their account name
  if (account) { pseudo.value = account; pseudo.disabled = true; }
  let auto: string | null = null, next: { how: 'create' | 'join'; code: string; camp: Camp } | null = null;
  try {
    auto = sessionStorage.getItem('manif-autostart'); sessionStorage.removeItem('manif-autostart');
    next = JSON.parse(sessionStorage.getItem('manif-again') ?? 'null'); sessionStorage.removeItem('manif-again');
  } catch { /* ignore */ }
  if (auto === 'protest' || auto === 'police') pickCamp(auto);
  // straight into multiplayer: same group again, an invite link, or CrazyGames' multiplayer page
  if (next) { pickCamp(next.camp); codeInput.value = next.code; online(next.how, next.code); }
  else if (codeInput.value) online('join');
  else if (instantMultiplayer()) online('create');
}).catch((e) => { $('loading').textContent = t('Erreur de chargement : ') + e; });

(window as any).__manif = ctx;
