/**
 * CrazyGames: when the game runs on their site, their SDK (v3) provides the ads (banners, rewarded and midgame
 * videos), the cloud save, invite links, the player's language and the gameplay events they ask for.
 * Anywhere else (GitHub Pages, a local file) `sdk` stays null and every helper falls back to plain browser behaviour.
 * `?useLocalSdk=true` loads the SDK in its local test mode (demo ads and banners).
 * The SDK is started by this module itself (top-level await), so every module that reads the save, the settings
 * or the language waits for it.
 */
type SDK = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export let sdk: SDK | null = null;

const SCRIPT = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const wanted = () => /crazygames/.test(location.hostname) || new URLSearchParams(location.search).has('useLocalSdk');

function loadScript(src: string, ms: number) {
  return new Promise<void>((ok, ko) => {
    const s = document.createElement('script');
    s.src = src; s.onload = () => ok(); s.onerror = () => ko(new Error('sdk'));
    document.head.appendChild(s);
    setTimeout(() => ko(new Error('sdk timeout')), ms);
  });
}

/** Loads and starts the SDK when on CrazyGames (never blocks more than a few seconds). */
async function init() {
  if (!wanted()) return;
  try {
    await loadScript(SCRIPT, 6000);
    const s = (window as any).CrazyGames.SDK; // eslint-disable-line @typescript-eslint/no-explicit-any
    await s.init();
    if (s.environment !== 'disabled') sdk = s;
  } catch (e) { console.warn('CrazyGames SDK unavailable', e); }
}

const safe = (f: () => void) => { try { f(); } catch (e) { console.warn(e); } };

/** Small key/value storage: CrazyGames cloud save there, localStorage elsewhere; never throws. */
export const store = {
  get(k: string): string | null {
    try { return sdk ? sdk.data.getItem(k) : localStorage.getItem(k); } catch { return null; }
  },
  set(k: string, v: string) {
    try { if (sdk) sdk.data.setItem(k, v); else localStorage.setItem(k, v); } catch { /* full or unavailable */ }
  },
};

/** The player's language (CrazyGames account, else the browser). */
export const locale = (): string => sdk?.user?.systemInfo?.locale ?? navigator.language ?? 'en';

let playing = false;
/** Tells CrazyGames when the player is actually playing (match running and not paused). */
export function gameplay(on: boolean) {
  if (on === playing || !sdk) return;
  playing = on;
  safe(() => (on ? sdk.game.gameplayStart() : sdk.game.gameplayStop()));
}
export const loading = (on: boolean) => sdk && safe(() => (on ? sdk.game.loadingStart() : sdk.game.loadingStop()));
export const happytime = () => sdk && safe(() => sdk.game.happytime());

/** Audio muted by the site (its own sound setting wins over the game's), with a callback when it changes. */
export function siteMuted(onChange: (muted: boolean) => void) {
  if (!sdk) return false;
  safe(() => sdk.game.addSettingsChangeListener((s: { muteAudio: boolean }) => onChange(!!s.muteAudio)));
  return !!sdk.game.settings?.muteAudio;
}

/** Mute hook used while a video ad plays. */
let adMute: (muted: boolean) => void = () => {};
export const onAdMute = (fn: (muted: boolean) => void) => { adMute = fn; };

/** True once an ad blocker stopped a video ad: the rewarded-ad buttons are then disabled, with a note. */
export let adBlocked = false;

/**
 * A video ad: 'rewarded' (`done(true)` only when watched to the end) or 'midgame' (between matches).
 * Where CrazyGames turns ads off (basic launch), a rewarded button still works: the reward is given without an ad.
 */
export function videoAd(type: 'rewarded' | 'midgame', done: (watched: boolean) => void = () => {}) {
  if (!sdk) { done(false); return; }
  let over = false;
  const end = (watched: boolean) => { if (over) return; over = true; adMute(false); done(watched); };
  safe(() => sdk.ad.requestAd(type, {
    adStarted: () => adMute(true),
    adFinished: () => end(true),
    adError: (e: { code?: string }) => { if (e?.code === 'adblock') adBlocked = true; end(type === 'rewarded' && e?.code === 'adsDisabled'); },
  }));
}

/** Side banners of the menu: shown in the containers that are visible, cleared when the menu hides. */
export function banners(show: boolean, ids: string[]) {
  if (!sdk) return;
  for (const id of ids) {
    const el = document.getElementById(id);
    if (show && el && el.offsetWidth >= 120 && el.offsetHeight >= 250) sdk.banner.requestResponsiveBanner(id).catch(() => {});
    else safe(() => sdk.banner.clearBanner(id));
  }
}

/** Invite links: a CrazyGames link carrying the room code there, the page address with ?code= elsewhere. */
export function inviteLink(code: string) {
  if (sdk) try { return sdk.game.inviteLink({ code }) as string; } catch { /* fall through */ }
  const u = new URL(location.href); // keeps the other options (signalling server…)
  u.hash = '';
  u.searchParams.set('code', code);
  return u.toString();
}
export const invitedCode = (): string | null =>
  (sdk && (() => { try { return sdk.game.getInviteParam('code'); } catch { return null; } })()) || new URLSearchParams(location.search).get('code');

await init();
loading(true);
