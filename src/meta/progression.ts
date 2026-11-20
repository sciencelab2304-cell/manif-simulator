import type { Camp } from '../core/context';
import { save, persist } from './save';
import { ITEMS } from './shop';
import { MAPS } from '../world/maps';
import { t } from '../core/i18n';

/** XP, levels and what a match earns. */
export const CURRENCY = t('Pavés d\'or');
export const xpNeeded = (level: number) => 100 + 60 * (level - 1);
export const levelCoins = (level: number) => 40 + 10 * level;

/** What happened to the local player in a match (from the end screen). */
export interface MatchResult {
  camp: Camp; win: boolean | null; multi: boolean; seconds: number; survived: number;
  takedowns: number; hits: number; headHits: number; arrests: number; thrown: number; downs: number;
}

export function matchRewards(r: MatchResult) {
  const lines: [string, number][] = [
    [t('Participation'), 15],
    [t(r.win ? 'Victoire' : r.win === false ? 'Défaite' : 'Partie interrompue'), r.win ? 60 : r.win === false ? 0 : 10],
    [t`Éliminations (${r.takedowns})`, r.takedowns * 4],
    [t`Coups au but (${r.hits})`, Math.min(r.hits, 40)],
    ...(r.arrests ? [[t`Interpellations (${r.arrests})`, r.arrests * 8] as [string, number]] : []),
    [t`Survie (${Math.floor(r.survived / 60)} min)`, Math.floor(r.survived / 60) * 5 + (r.downs === 0 ? 20 : 0)],
  ];
  const coins = lines.reduce((a, l) => a + l[1], 0);
  return { lines: lines.filter((l) => l[1] > 0), coins, xp: coins * 2 };
}

/** Adds coins and XP; each new level pays coins and may unlock skins or maps (returned as texts). */
export function grant(coins: number, xp: number) {
  const news: string[] = [];
  save.coins += coins;
  save.xp += xp;
  while (save.xp >= xpNeeded(save.level)) {
    save.xp -= xpNeeded(save.level);
    save.level++;
    save.coins += levelCoins(save.level);
    news.push(t`Niveau ${save.level} : +${levelCoins(save.level)} ${CURRENCY}`);
    for (const i of ITEMS) if (i.level === save.level) news.push(t`Débloqué : ${i.name} (${i.camp === 'police' ? 'CRS' : 'manifestant'})`);
    for (const m of MAPS) if (m.level === save.level) news.push(t`Nouvelle carte : ${m.name}`);
  }
  persist();
  return news;
}
