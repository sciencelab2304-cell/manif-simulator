import { isTouch } from './device';

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
const KEY = isTouch ? 'paves-settings-touch-v1' : 'paves-settings-v1';

export function defaultSettings(): Settings {
  return isTouch
    ? { sensitivity: 1, volume: 0.8, quality: 'mobile', blood: true, fov: 80, invertY: false, thirdPerson: false }
    : { sensitivity: 1, volume: 0.8, quality: 'medium', blood: true, fov: 75, invertY: false, thirdPerson: false };
}

export function loadSettings(): Settings {
  const s = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(s, JSON.parse(raw));
  } catch { /* storage unavailable */ }
  return s;
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
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
