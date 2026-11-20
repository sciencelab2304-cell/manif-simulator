import { save, persist, today } from './save';

/**
 * Rewarded ads. The game only calls `showRewardedAd`; what shows the ad is the provider, a simulation for now.
 * To plug a real web ad network, write a provider and pass it to `setAdProvider` (nothing else changes). Example with
 * Google H5 Games Ads (Ad Placement API), once its script tag is in index.html:
 *
 *   setAdProvider((done) => adBreak({
 *     type: 'reward', name: 'recompense',
 *     beforeReward: (showAdFn) => showAdFn(),
 *     adViewed: () => done(true),
 *     adDismissed: () => done(false),
 *     adBreakDone: (info) => { if (info.breakStatus !== 'viewed') done(false); },
 *   }));
 */
export type AdProvider = (done: (watched: boolean) => void) => void;

export const ADS_PER_DAY = 5;
const AD_SECONDS = 15;

export function adsLeft() {
  return save.ads.day === today() ? Math.max(0, ADS_PER_DAY - save.ads.n) : ADS_PER_DAY;
}

/** Full-screen fake ad: a countdown, and the close button only once it is over. */
const simulated: AdProvider = (done) => {
  const el = document.createElement('div');
  el.id = 'ad';
  el.innerHTML = `<div class="ad-tag">Publicité</div>
    <div class="ad-body"><div class="ad-logo">☕</div><b>Café de la Concorde-Neuve</b><span>Le meilleur crème de Valbrune, depuis 1923.</span><small>(publicité simulée : un vrai réseau de pubs la remplacera)</small></div>
    <div class="ad-count"></div><button class="ad-close hidden">Fermer</button>`;
  document.body.appendChild(el);
  const count = el.querySelector('.ad-count')!, close = el.querySelector('.ad-close')!;
  let left = AD_SECONDS, last = performance.now();
  const tick = () => {
    const now = performance.now();
    if (!document.hidden) left -= (now - last) / 1000; // a hidden page is not watching
    last = now;
    if (left > 0) { count.textContent = `Récompense dans ${Math.ceil(left)} s`; return; }
    clearInterval(iv);
    count.textContent = 'Récompense obtenue !';
    close.classList.remove('hidden');
  };
  const iv = window.setInterval(tick, 200);
  tick();
  close.addEventListener('click', () => { el.remove(); done(true); });
};

let provider: AdProvider = simulated;
export const setAdProvider = (p: AdProvider) => { provider = p; };

/** Shows a rewarded ad if today's quota allows it; `onReward` runs only when it was watched to the end. */
export function showRewardedAd(onReward: () => void, onClose: () => void = () => {}) {
  if (adsLeft() <= 0) return false;
  let answered = false;
  provider((watched) => {
    if (answered) return;
    answered = true;
    if (watched) {
      if (save.ads.day !== today()) save.ads = { day: today(), n: 0 };
      save.ads.n++;
      persist();
      onReward();
    }
    onClose();
  });
  return true;
}
