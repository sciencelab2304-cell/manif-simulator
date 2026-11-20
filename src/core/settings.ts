import { isTouch } from './device';
import { store, sdk } from './platform';

export type Quality = 'mobile' | 'low' | 'medium' | 'high';

export interface Settings {
  sensitivity: number; // 0.2 .. 3
  volume: number; // 0 .. 1
  quality: Quality;
  blood: boolean;
  fov: number;
  invertY: boolean;
  thirdPerson: boolean; // camera behind the shoulder (P)
}

// phones keep their own settings so a shared browser profile never starts a phone in 'high'
const KEY = isTouch ? 'manif-settings-touch-v1' : 'manif-settings-v1';
const OLD_KEY = isTouch ? 'paves-settings-touch-v1' : 'paves-settings-v1'; // before the game was renamed

export function defaultSettings(): Settings {
  const blood = !sdk; // CrazyGames (PEGI 12 audience): no blood unless the player turns it on
  return isTouch
    ? { sensitivity: 1, volume: 0.8, quality: 'mobile', blood, fov: 80, invertY: false, thirdPerson: false }
    : { sensitivity: 1, volume: 0.8, quality: 'medium', blood, fov: 75, invertY: false, thirdPerson: false };
}

export function loadSettings(): Settings {
  const s = defaultSettings();
  try { Object.assign(s, JSON.parse(store.get(KEY) ?? store.get(OLD_KEY) ?? '{}')); } catch { /* damaged */ }
  return s;
}

export function saveSettings(s: Settings) {
  store.set(KEY, JSON.stringify(s));
}

export interface QualityProfile {
  pixelRatio: number;
  shadows: boolean;
  shadowSize: number;
  post: boolean;
  bloom: boolean;
  motionBlur: boolean;
  maxRagdolls: number;
  pointLights: number;
  particleScale: number;
  crowd: number; // protester count
  drawDistance: number;
}

export function profile(q: Quality): QualityProfile {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  switch (q) {
    case 'mobile':
      return { pixelRatio: Math.min(dpr, 1.5) * 0.75, shadows: true, shadowSize: 512, post: false, bloom: false, motionBlur: false,
        maxRagdolls: 5, pointLights: 2, particleScale: 0.4, crowd: 45, drawDistance: 150 };
    case 'low':
      return { pixelRatio: Math.min(dpr, 1) * 0.8, shadows: false, shadowSize: 512, post: false, bloom: false, motionBlur: false,
        maxRagdolls: 6, pointLights: 3, particleScale: 0.5, crowd: 70, drawDistance: 220 };
    case 'high':
      return { pixelRatio: Math.min(dpr, 1.5), shadows: true, shadowSize: 2048, post: true, bloom: true, motionBlur: true,
        maxRagdolls: 18, pointLights: 8, particleScale: 1, crowd: 140, drawDistance: 420 };
    default:
      return { pixelRatio: Math.min(dpr, 1.25), shadows: true, shadowSize: 1024, post: true, bloom: true, motionBlur: false,
        maxRagdolls: 12, pointLights: 5, particleScale: 0.75, crowd: 105, drawDistance: 320 };
  }
}
