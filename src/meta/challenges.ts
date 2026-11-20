import { save, persist, today, thisWeek, type ChallengeState } from './save';
import type { MatchResult } from './progression';
import { t } from '../core/i18n';

/**
 * Daily challenges (3, renewed at midnight), weekly ones (3, renewed on Monday) and permanent achievements.
 * Each one reads a metric of the match; `best` ones keep the best single match instead of adding up.
 */
type Metric = 'matches' | 'protest' | 'police' | 'wins' | 'winsProtest' | 'winsPolice' | 'noDeathWin' | 'takedowns' | 'hits'
  | 'headHits' | 'arrests' | 'thrown' | 'survive' | 'multi' | 'level';
export interface Challenge { id: string; text: string; metric: Metric; goal: number; reward: number; best?: boolean }

const metric = (r: MatchResult): Record<Metric, number> => ({
  matches: 1, protest: +(r.camp === 'protest'), police: +(r.camp === 'police'), wins: +!!r.win,
  winsProtest: +(!!r.win && r.camp === 'protest'), winsPolice: +(!!r.win && r.camp === 'police'), noDeathWin: +(!!r.win && r.downs === 0),
  takedowns: r.takedowns, hits: r.hits, headHits: r.headHits, arrests: r.arrests, thrown: r.thrown, survive: Math.floor(r.survived),
  multi: +r.multi, level: 0,
});

const tx = (l: Challenge[]) => l.map((c) => ({ ...c, text: t(c.text) }));
const DAILY = tx([
  { id: 'd-elim', text: 'Faire 10 éliminations', metric: 'takedowns', goal: 10, reward: 60 },
  { id: 'd-protest', text: 'Jouer 2 parties en manifestant', metric: 'protest', goal: 2, reward: 50 },
  { id: 'd-police', text: 'Jouer 2 parties en CRS', metric: 'police', goal: 2, reward: 50 },
  { id: 'd-win', text: 'Gagner une partie', metric: 'wins', goal: 1, reward: 80 },
  { id: 'd-hits', text: 'Toucher 30 fois une cible', metric: 'hits', goal: 30, reward: 50 },
  { id: 'd-survive', text: 'Survivre 4 minutes dans une partie', metric: 'survive', goal: 240, reward: 60, best: true },
  { id: 'd-head', text: 'Réussir 5 coups à la tête', metric: 'headHits', goal: 5, reward: 60 },
  { id: 'd-arrest', text: 'Interpeller 3 manifestants', metric: 'arrests', goal: 3, reward: 60 },
  { id: 'd-throw', text: 'Lancer 25 objets', metric: 'thrown', goal: 25, reward: 50 },
]);
const WEEKLY = tx([
  { id: 'w-win', text: 'Gagner 5 parties', metric: 'wins', goal: 5, reward: 300 },
  { id: 'w-elim', text: 'Faire 60 éliminations', metric: 'takedowns', goal: 60, reward: 300 },
  { id: 'w-protest', text: 'Jouer 5 parties en manifestant', metric: 'protest', goal: 5, reward: 250 },
  { id: 'w-police', text: 'Jouer 5 parties en CRS', metric: 'police', goal: 5, reward: 250 },
  { id: 'w-clean', text: 'Gagner une partie sans être mis à terre', metric: 'noDeathWin', goal: 1, reward: 250 },
  { id: 'w-multi', text: 'Jouer 3 parties en ligne', metric: 'multi', goal: 3, reward: 250 },
  { id: 'w-survive', text: 'Survivre 8 minutes dans une partie', metric: 'survive', goal: 480, reward: 250, best: true },
]);
export const ACHIEVEMENTS = tx([
  { id: 'a-first', text: 'Première partie', metric: 'matches', goal: 1, reward: 50 },
  { id: 'a-win', text: 'Première victoire', metric: 'wins', goal: 1, reward: 100 },
  { id: 'a-matches', text: 'Jouer 50 parties', metric: 'matches', goal: 50, reward: 500 },
  { id: 'a-elim', text: '100 éliminations', metric: 'takedowns', goal: 100, reward: 400 },
  { id: 'a-protest', text: '10 victoires en manifestant', metric: 'winsProtest', goal: 10, reward: 500 },
  { id: 'a-police', text: '10 victoires en CRS', metric: 'winsPolice', goal: 10, reward: 500 },
  { id: 'a-clean', text: 'Gagner sans être mis à terre', metric: 'noDeathWin', goal: 1, reward: 200 },
  { id: 'a-multi', text: '25 parties en ligne', metric: 'multi', goal: 25, reward: 400 },
  { id: 'a-throw', text: '1 000 objets lancés', metric: 'thrown', goal: 1000, reward: 400 },
  { id: 'a-level', text: 'Atteindre le niveau 10', metric: 'level', goal: 10, reward: 500 },
]);
const byId = (id: string) => [...DAILY, ...WEEKLY].find((c) => c.id === id)!;

/** Same picks for everyone on a given day/week, different from one period to the next. */
function draw(pool: Challenge[], key: string, n: number): ChallengeState[] {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const p = [...pool], out: ChallengeState[] = [];
  while (out.length < n) { h = (h * 1103515245 + 12345) | 0; out.push({ id: p.splice(Math.abs(h) % p.length, 1)[0].id, progress: 0, claimed: false }); }
  return out;
}

/** Renews the lists when the day / week changed. */
export function refresh() {
  let changed = false;
  if (save.daily.day !== today()) { save.daily = { day: today(), list: draw(DAILY, today(), 3) }; changed = true; }
  if (save.weekly.week !== thisWeek()) { save.weekly = { week: thisWeek(), list: draw(WEEKLY, 'w' + thisWeek(), 3) }; changed = true; }
  if (changed) persist();
}

export interface Row { c: Challenge; progress: number; done: boolean; claimed: boolean; claim(): number }
const row = (c: Challenge, st: { progress: number; claimed: boolean }, onClaim: () => void): Row => ({
  c, progress: Math.min(st.progress, c.goal), done: st.progress >= c.goal, claimed: st.claimed,
  claim: () => { if (st.progress < c.goal || st.claimed) return 0; onClaim(); persist(); return c.reward; },
});

export function lists() {
  refresh();
  const state = (s: ChallengeState) => row(byId(s.id), s, () => { s.claimed = true; });
  const total = (c: Challenge) => c.metric === 'level' ? save.level : save.totals[c.id] ?? 0;
  return {
    daily: save.daily.list.map(state),
    weekly: save.weekly.list.map(state),
    achievements: ACHIEVEMENTS.map((c) => row(c, { progress: total(c), claimed: !!save.achievements[c.id] }, () => { save.achievements[c.id] = true; })),
  };
}

/** Counts a finished match in every challenge; returns the ones it completed. */
export function record(r: MatchResult) {
  refresh();
  const m = metric(r), done: string[] = [];
  const add = (c: Challenge, cur: number) => (c.best ? Math.max(cur, m[c.metric]) : cur + m[c.metric]);
  for (const s of [...save.daily.list, ...save.weekly.list]) {
    const c = byId(s.id), before = s.progress;
    s.progress = add(c, s.progress);
    if (before < c.goal && s.progress >= c.goal) done.push(c.text);
  }
  for (const c of ACHIEVEMENTS) {
    if (c.metric === 'level') continue;
    const before = save.totals[c.id] ?? 0;
    save.totals[c.id] = add(c, before);
    if (before < c.goal && save.totals[c.id] >= c.goal) done.push(c.text);
  }
  persist();
  return done;
}
