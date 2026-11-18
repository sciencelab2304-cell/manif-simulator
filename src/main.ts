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

const $ = (id: string) => document.getElementById(id)!;
const settings = loadSettings();
let game: Game | null = null;
let audio: AudioEngine | null = null;
const input = new Input(document.body);
document.body.classList.toggle('touch', isTouch);

// ------------------------------------------------------------------ settings UI
const sens = $('s-sens') as HTMLInputElement, vol = $('s-vol') as HTMLInputElement, fov = $('s-fov') as HTMLInputElement;
const quality = $('s-quality') as HTMLSelectElement, blood = $('s-blood') as HTMLInputElement, invert = $('s-invert') as HTMLInputElement, third = $('s-third') as HTMLInputElement;
sens.value = String(settings.sensitivity); vol.value = String(settings.volume); fov.value = String(settings.fov);
quality.value = settings.quality; blood.checked = settings.blood; invert.checked = settings.invertY; third.checked = settings.thirdPerson;
const sync = () => {
  settings.sensitivity = +sens.value; settings.volume = +vol.value; settings.fov = +fov.value;
  settings.quality = quality.value as typeof settings.quality; settings.blood = blood.checked; settings.invertY = invert.checked; settings.thirdPerson = third.checked;
  saveSettings(settings);
  audio?.setVolume(settings.volume);
};
for (const el of [sens, vol, fov, quality, blood, invert, third]) el.addEventListener('input', sync);

// ------------------------------------------------------------------ menu: name, camp, mode
const net = new Net();
const campButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.camp'));
const modeButtons = ['m-solo', 'm-create', 'm-join'].map((id) => $(id) as HTMLButtonElement);
const pseudo = $('pseudo') as HTMLInputElement, codeInput = $('m-code') as HTMLInputElement;
let camp: Camp = 'protest';
const pickCamp = (c: Camp) => { camp = c; campButtons.forEach((b) => b.classList.toggle('sel', b.dataset.camp === c)); };
campButtons.forEach((b) => b.addEventListener('click', () => pickCamp(b.dataset.camp as Camp)));
try { pseudo.value = localStorage.getItem('paves-name') ?? ''; } catch { /* ignore */ }
codeInput.value = new URLSearchParams(location.search).get('code') ?? '';
const name = () => { const n = pseudo.value.trim().slice(0, 16) || 'Anonyme'; try { localStorage.setItem('paves-name', n); } catch { /* ignore */ } return n; };
const busy = (b: boolean, msg = '') => { modeButtons.forEach((x) => (x.disabled = b)); $('loading').textContent = msg; };

async function online(how: 'create' | 'join') {
  const code = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (how === 'join' && code.length < 5) { codeInput.focus(); $('loading').textContent = 'Saisissez le code de la partie.'; return; }
  busy(true, how === 'create' ? 'Création de la partie…' : 'Connexion à la partie…');
  try {
    if (how === 'create') await net.create(name(), camp); else await net.join(code, name(), camp, (msg) => busy(true, msg));
    busy(false);
    showLobby(net, start);
  } catch (e) {
    net.leave();
    busy(false, (e as Error).message || 'Connexion impossible.');
  }
}
modeButtons[0].addEventListener('click', () => start(camp));
modeButtons[1].addEventListener('click', () => online('create'));
modeButtons[2].addEventListener('click', () => online('join'));
codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') online('join'); });

/** The connection ended: from the lobby, back to the menu; in a match, end screen. */
net.onClosed = (why) => {
  net.leave();
  if (game) { game.showEnd(null, why); return; }
  $('lobby').classList.add('hidden');
  $('menu').classList.remove('hidden');
  busy(false, why);
};

function start(c: Camp) {
  if (game) return;
  sync();
  audio = audio ?? new AudioEngine();
  audio.setVolume(settings.volume);
  audio.resume();
  if (isTouch) enterFullscreen(); else input.lock();
  busy(true, 'Construction de Valbrune… (quelques secondes)');
  $('lobby').classList.add('hidden');
  $('menu').classList.remove('hidden');
  // multiplayer: the menus lead back to the main menu, and the match keeps running behind the pause screen
  $('pause-net').classList.toggle('hidden', !net.multi);
  $('restart').classList.toggle('hidden', net.multi);
  $('switch').classList.toggle('hidden', net.multi);
  $('again').textContent = net.multi ? 'Menu principal' : 'Rejouer';
  // let the browser paint the message before the heavy city generation
  setTimeout(() => {
    try {
      game = new Game(c, settings, input, audio!, net);
      $('menu').classList.add('hidden');
      game.start();
      if (isTouch) new TouchControls(input, c, () => setPaused(true));
      else if (!input.locked) setPaused(true);
    } catch (e) {
      $('loading').textContent = 'Erreur : ' + (e as Error).message;
      console.error(e);
    }
  }, 60);
}

// pause / resume: pointer lock on desktop, the ❚❚ button (or leaving the app) on touch screens
function setPaused(p: boolean) {
  if (!game || ctx.over) return;
  game.setPaused(p);
  $('pause').classList.toggle('hidden', !p);
  if (p) input.reset();
}
input.onLockChange = (locked) => setPaused(!locked);
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
$('resume').addEventListener('click', () => { if (isTouch) { enterFullscreen(); setPaused(false); } else input.lock(); });
$('app').addEventListener('click', () => { if (game && !ctx.over && !isTouch && !input.locked) input.lock(); });
const restart = (c: Camp | null) => {
  net.leave();
  try { if (c && !net.multi) sessionStorage.setItem('paves-autostart', c); else sessionStorage.removeItem('paves-autostart'); } catch { /* ignore */ }
  location.reload();
};
$('restart').addEventListener('click', () => restart(camp));
$('quit').addEventListener('click', () => restart(null));
$('again').addEventListener('click', () => restart(camp));
$('switch').addEventListener('click', () => restart(camp === 'police' ? 'protest' : 'police'));
$('l-quit').addEventListener('click', () => restart(null));
window.addEventListener('pagehide', () => net.leave());

// ------------------------------------------------------------------ boot
initRapier().then(() => {
  busy(false, 'Choisissez votre camp, puis jouez seul ou à plusieurs.');
  let auto: string | null = null;
  try { auto = sessionStorage.getItem('paves-autostart'); sessionStorage.removeItem('paves-autostart'); } catch { /* ignore */ }
  if (auto === 'protest' || auto === 'police') pickCamp(auto);
}).catch((e) => { $('loading').textContent = 'Erreur de chargement : ' + e; });

(window as any).__paves = ctx;
