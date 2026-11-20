import { store } from '../core/platform';

/**
 * Everything the player keeps between matches, in one stored entry (CrazyGames cloud save there, localStorage elsewhere): Pavés d'or, XP, level, skins, upgrades,
 * challenges, rewarded ads of the day and the start bonus waiting for the next match.
 */
export interface ChallengeState { id: string; progress: number; claimed: boolean }

export interface Save {
  v: 1;
  coins: number;
  xp: number; // inside the current level
  level: number;
  owned: string[]; // shop item ids
  equipped: Record<string, string>; // slot ('protest.outfit', 'police.gear'…) → item id
  upgrades: Record<string, number>; // upgrade id → tier
  boost: string | null; // start bonus earned with an ad, used by the next match
  ads: { day: string; n: number };
  daily: { day: string; list: ChallengeState[] };
  weekly: { week: string; list: ChallengeState[] };
  achievements: Record<string, boolean>; // claimed
  totals: Record<string, number>; // lifetime counters (achievements read them)
}

const KEY = 'manif-progress-v1';

const fresh = (): Save => ({
  v: 1, coins: 0, xp: 0, level: 1, owned: [], equipped: {}, upgrades: {}, boost: null,
  ads: { day: '', n: 0 }, daily: { day: '', list: [] }, weekly: { week: '', list: [] }, achievements: {}, totals: {},
});

function load(): Save {
  const s = fresh();
  try { Object.assign(s, JSON.parse(store.get(KEY) ?? '{}')); } catch { /* damaged */ }
  return s;
}

/** The save, read once at start; change it then call `persist()`. */
export const save = load();
const listeners: (() => void)[] = [];
/** UI parts that show the save (menu bar…) redraw on every change. */
export const onSave = (fn: () => void) => listeners.push(fn);

export function persist() {
  store.set(KEY, JSON.stringify(save));
  for (const f of listeners) f();
}

export function resetSave() {
  Object.assign(save, fresh());
  persist();
}

/** Local calendar day (midnight renewal) and ISO-like week number, as keys. */
export const today = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
export function thisWeek(d = new Date()) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return today(t);
}
