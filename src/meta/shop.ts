import type { Camp } from '../core/context';
import { ACC, COVERS_HAIR, type BodyLook } from '../npc/body';
import { save, persist } from './save';
import { t, tAll } from '../core/i18n';

/**
 * Shop catalogue and loadout: character skins per camp (outfit, head, face, back), weapon / equipment skins, permanent
 * upgrades in tiers. Items have a price in Pavés d'or, or unlock at a player level (then they are free).
 */
export type Slot = 'outfit' | 'head' | 'face' | 'back' | 'weapon';
export const SLOT_FR: Record<Slot, string> = tAll({ outfit: 'Tenues', head: 'Têtes', face: 'Visage', back: 'Dos', weapon: 'Armes et équipement' });

/** How a skin changes a body (colours as 0xRRGGBB, accessories switched on / off); sent to the other players so they see it. */
export interface LookSpec { top?: number; pants?: number; hands?: number; acc?: [number, number][]; off?: number[] }
/** First-person colours: weapon metal, hands (gloves), lighter. */
export interface Gear { metal?: number; hand?: number; lighter?: number }

export interface Item { id: string; camp: Camp; slot: Slot; name: string; price?: number; level?: number; look?: LookSpec; gear?: Gear; swatch: number }

const H = ACC.helmet, HAIR = ACC.hair, PACK = ACC.pack, FLAG = ACC.flag, VEST = ACC.vest, A = ACC;
const outfit = (camp: Camp, id: string, name: string, top: number, pants: number, cost: number | { level: number }): Item =>
  ({ id, camp, slot: 'outfit', name: t(name), look: { top, pants }, swatch: top, ...(typeof cost === 'number' ? { price: cost } : cost) });
/** A worn accessory; on the head it replaces the helmet, and hides the hair if it covers it. Painted ones keep `color` white. */
const acc = (camp: Camp, slot: Slot, id: string, name: string, a: number, color: number, cost: number | { level: number }, swatch = color): Item =>
  ({ id, camp, slot, name: t(name), look: { acc: [[a, color]], off: slot === 'head' ? [H, ...(COVERS_HAIR.includes(a) ? [HAIR] : [])] : [] }, swatch, ...(typeof cost === 'number' ? { price: cost } : cost) });
const fun = (camp: Camp, slot: Slot, id: string, name: string, a: number, swatch: number, cost: number | { level: number }) => acc(camp, slot, id, name, a, 0xffffff, cost, swatch);
const gear = (camp: Camp, id: string, name: string, g: Gear, cost: number | { level: number }): Item =>
  ({ id, camp, slot: 'weapon', name: t(name), gear: g, swatch: g.metal ?? g.hand ?? g.lighter ?? 0, ...(typeof cost === 'number' ? { price: cost } : cost) });

export const ITEMS: Item[] = [
  outfit('protest', 'p-kway', 'K-way jaune', 0xe8c21a, 0x2b2f3a, 150),
  outfit('protest', 'p-rouge', 'Gilet rouge', 0xc0251c, 0x22252c, { level: 2 }),
  outfit('protest', 'p-bleu', 'Bleu de travail', 0x2d4f8a, 0x2d4f8a, 200),
  outfit('protest', 'p-vert', 'Survêtement vert', 0x1f7a44, 0x1f7a44, 250),
  outfit('protest', 'p-noir', 'Tout en noir', 0x161616, 0x121212, 350),
  outfit('protest', 'p-fluo', 'Gilet fluo', 0xd6e81a, 0x3a3f4a, { level: 6 }),
  outfit('protest', 'p-pyjama', 'Pyjama rose', 0xf28bb8, 0xf28bb8, 300),
  outfit('protest', 'p-dore', 'Costume doré', 0xd4a83a, 0xc89a30, 900),
  acc('protest', 'head', 'p-bonnet', 'Bonnet rouge', HAIR, 0xb2201a, 80),
  acc('protest', 'head', 'p-chantier', 'Casque de chantier', H, 0xf0c419, 200),
  acc('protest', 'head', 'p-velo', 'Casque de vélo', H, 0x22a7d8, { level: 4 }),
  acc('protest', 'head', 'p-moto', 'Casque de moto', H, 0x151515, 350),
  fun('protest', 'head', 'p-hautforme', 'Haut-de-forme', A.topHat, 0x161616, 400),
  acc('protest', 'head', 'p-cowboy', 'Chapeau de cowboy', A.cowboy, 0x8a5a2a, 350),
  fun('protest', 'head', 'p-sombrero', 'Sombrero', A.sombrero, 0xe2c070, 450),
  fun('protest', 'head', 'p-fete', 'Chapeau de fête', A.party, 0xff4fa0, { level: 7 }),
  fun('protest', 'head', 'p-viking', 'Casque viking', A.viking, 0x8c9198, 550),
  acc('protest', 'head', 'p-afro', 'Perruque afro rose', A.afro, 0xff5fa8, 300),
  acc('protest', 'head', 'p-crete', 'Crête punk', A.mohawk, 0x3ae07a, 300),
  fun('protest', 'head', 'p-lapin', 'Oreilles de lapin', A.bunny, 0xf4f4f4, 250),
  fun('protest', 'head', 'p-helice', 'Casquette à hélice', A.propeller, 0xffd23a, { level: 8 }),
  fun('protest', 'head', 'p-chef', 'Toque de chef', A.chef, 0xf4f4f4, 300),
  fun('protest', 'head', 'p-couronne', 'Couronne', A.crown, 0xe8c040, 1200),
  fun('protest', 'face', 'p-lunettes', 'Lunettes de soleil', A.shades, 0x161616, 150),
  fun('protest', 'face', 'p-moustache', 'Moustache', A.mustache, 0x3a2410, 120),
  fun('protest', 'face', 'p-nez', 'Nez de clown', A.clownNose, 0xe8121a, 100),
  fun('protest', 'face', 'p-coeur', 'Lunettes cœur', A.heartGlasses, 0xff3d8f, { level: 9 }),
  acc('protest', 'back', 'p-sac', 'Sac à dos', PACK, 0x3a5a7a, 100),
  acc('protest', 'back', 'p-drapeau', 'Drapeau rouge', FLAG, 0xc0251c, { level: 3 }),
  acc('protest', 'back', 'p-drapeau-vert', 'Drapeau vert', FLAG, 0x1f6f3a, 250),
  acc('protest', 'back', 'p-cape', 'Cape de super-héros', A.cape, 0xc8202a, 450),
  fun('protest', 'back', 'p-ailes', 'Ailes d\'ange', A.wings, 0xf4f4f4, 600),
  fun('protest', 'back', 'p-canard', 'Bouée canard', A.duck, 0xffd21a, 350),
  gear('protest', 'p-gants', 'Gants en cuir', { hand: 0x5a3a22 }, 120),
  gear('protest', 'p-gants-rouges', 'Gants rouges', { hand: 0xa31a1a }, 200),
  gear('protest', 'p-briquet-or', 'Briquet doré', { lighter: 0xd4a83a }, { level: 5 }),
  outfit('police', 'c-gm', 'Tenue bleu gendarmerie', 0x24345a, 0x1d2840, 200),
  outfit('police', 'c-nuit', 'Tenue de nuit', 0x0b0d12, 0x0b0d12, { level: 2 }),
  outfit('police', 'c-ete', 'Tenue d\'été grise', 0x4a525c, 0x2a3038, 250),
  outfit('police', 'c-kaki', 'Tenue kaki', 0x3b4a32, 0x2f3a28, 350),
  outfit('police', 'c-rose', 'Uniforme rose bonbon', 0xf06aa8, 0xd85a98, 500),
  outfit('police', 'c-parade', 'Tenue de parade blanche', 0xeeeeee, 0xe0e0e0, { level: 8 }),
  acc('police', 'head', 'c-blanc', 'Casque blanc', H, 0xe8e8e8, 150),
  acc('police', 'head', 'c-bleu', 'Casque bleu roi', H, 0x2a4fd1, { level: 4 }),
  acc('police', 'head', 'c-or', 'Casque doré', H, 0xc9a13b, 600),
  fun('police', 'head', 'c-gyrophare', 'Casque gyrophare', A.siren, 0x3a8bff, { level: 7 }),
  fun('police', 'head', 'c-bicorne', 'Bicorne de Napoléon', A.bicorne, 0x161616, 700),
  acc('police', 'head', 'c-sherif', 'Chapeau de shérif', A.cowboy, 0xd8c8a0, 400),
  fun('police', 'head', 'c-hautforme', 'Haut-de-forme', A.topHat, 0x161616, 400),
  fun('police', 'head', 'c-viking', 'Casque viking', A.viking, 0x8c9198, 550),
  fun('police', 'head', 'c-couronne', 'Couronne', A.crown, 0xe8c040, 1200),
  fun('police', 'face', 'c-lunettes', 'Lunettes de soleil', A.shades, 0x161616, 150),
  fun('police', 'face', 'c-moustache', 'Moustache', A.mustache, 0x3a2410, 120),
  fun('police', 'face', 'c-nez', 'Nez de clown', A.clownNose, 0xe8121a, 100),
  acc('police', 'back', 'c-fluo', 'Gilet fluo', VEST, 0xc8e01a, 200),
  acc('police', 'back', 'c-gilet-blanc', 'Gilet blanc', VEST, 0xdcdcdc, { level: 6 }),
  acc('police', 'back', 'c-cape', 'Cape de super-flic', A.cape, 0x1f3a8a, 450),
  fun('police', 'back', 'c-canard', 'Bouée canard', A.duck, 0xffd21a, 350),
  gear('police', 'c-camo', 'LBD camouflage', { metal: 0x4a5a3a }, 200),
  gear('police', 'c-nuit-lbd', 'LBD bleu nuit', { metal: 0x1d2a55 }, 300),
  gear('police', 'c-or-lbd', 'LBD doré', { metal: 0xb8902e }, { level: 5 }),
];
export const item = (id: string) => ITEMS.find((i) => i.id === id);

export const owns = (i: Item) => save.owned.includes(i.id) || (i.level !== undefined && save.level >= i.level);
/** Items being tried on in the shop, by slot ('' = nothing). */
export type Tried = Partial<Record<Slot, string>>;
/** What a camp wears in a slot: the tried item, else the equipped one. */
const worn = (camp: Camp, slot: Slot, tried: Tried) => item(tried[slot] ?? save.equipped[`${camp}.${slot}`] ?? '');

export function buy(i: Item) {
  if (owns(i) || i.price === undefined || save.coins < i.price) return false;
  save.coins -= i.price;
  save.owned.push(i.id);
  save.equipped[`${i.camp}.${i.slot}`] = i.id;
  persist();
  return true;
}

/** Equips an owned item, or takes it off if it is already worn. */
export function toggleEquip(i: Item) {
  const key = `${i.camp}.${i.slot}`;
  if (!owns(i)) return;
  if (save.equipped[key] === i.id) delete save.equipped[key]; else save.equipped[key] = i.id;
  persist();
}

/** The look of the local player for a camp (what the others see). */
export function lookSpec(camp: Camp, tried: Tried = {}): LookSpec {
  const s: LookSpec = { acc: [] };
  for (const slot of ['outfit', 'head', 'face', 'back'] as Slot[]) {
    const l = worn(camp, slot, tried)?.look;
    if (!l) continue;
    if (l.top !== undefined) { s.top = l.top; s.pants = l.pants; }
    if (l.acc) s.acc!.push(...l.acc);
    if (l.off?.length) (s.off ??= []).push(...l.off);
  }
  const hand = gearOf(camp, tried).hand; // gloves show on the body too
  if (hand !== undefined) s.hands = hand;
  return s;
}
/** Shop skins on a body (the avatar on the host, the same body on every client). */
export function dress(l: BodyLook, s?: LookSpec) {
  if (!s) return;
  if (s.top !== undefined) { l.top.setHex(s.top); l.pants.setHex(s.pants ?? s.top); }
  if (s.hands !== undefined) l.hands.setHex(s.hands);
  for (const a of s.off ?? []) l.acc_on[a] = false;
  for (const [a, c] of s.acc ?? []) { l.acc_on[a] = true; l.acc[a].setHex(c); }
}
export const gearOf = (camp: Camp, tried: Tried = {}): Gear => ({ ...worn(camp, 'weapon', tried)?.gear });

// ------------------------------------------------------------------ upgrades
export interface Upgrade { id: string; name: string; desc: Record<Camp, string>; tiers: number }
export const UPGRADES: Upgrade[] = [
  { id: 'ammo', name: 'Munitions de départ', tiers: 5, desc: { protest: '+2 pavés par palier', police: '+3 balles de LBD par palier' } },
  { id: 'mags', name: 'Chargeurs', tiers: 5, desc: { protest: '+1 fusée et +1 mortier par palier', police: '+1 lacrymo par palier, +1 désencerclement tous les 2' } },
  { id: 'hp', name: 'Vie max', tiers: 5, desc: { protest: '+6 % de vie par palier', police: '+6 % de vie par palier' } },
  { id: 'reload', name: 'Rechargement', tiers: 5, desc: { protest: 'Lancers chargés 8 % plus vite par palier', police: 'LBD rechargé 8 % plus vite par palier' } },
  { id: 'armor', name: 'Résistance', tiers: 5, desc: { protest: '−4 % de dégâts subis par palier', police: '−4 % de dégâts subis par palier' } },
].map((u) => ({ ...u, name: t(u.name), desc: tAll(u.desc) }));
export const upgradeCost = (tier: number) => Math.round(120 * 1.7 ** tier); // price of the next tier
export const MULTI_CAP = 2;

export function buyUpgrade(u: Upgrade) {
  const t = save.upgrades[u.id] ?? 0;
  if (t >= u.tiers || save.coins < upgradeCost(t)) return false;
  save.coins -= upgradeCost(t);
  save.upgrades[u.id] = t + 1;
  persist();
  return true;
}

/** Rules of the current match: online, purchased bonuses are capped; in a balanced match they are off. */
export const rules = { multi: false, balanced: false };
export function tier(id: string) {
  const t = save.upgrades[id] ?? 0;
  return rules.balanced ? 0 : rules.multi ? Math.min(t, MULTI_CAP) : t;
}

// ------------------------------------------------------------------ start bonus (rewarded ad)
type Boost = { name: string; desc: Record<Camp, string> };
export const BOOSTS: Record<string, Boost> = Object.fromEntries(Object.entries<Boost>({
  ammo: { name: 'Munitions', desc: { protest: '+6 pavés et +2 mortiers', police: '+10 balles de LBD' } },
  hp: { name: 'Vie', desc: { protest: '+25 % de vie', police: '+25 % de vie' } },
  grenade: { name: 'Grenade', desc: { protest: '+2 fumigènes et +1 fusée', police: '+2 lacrymos et +1 désencerclement' } },
}).map(([k, b]) => [k, { name: t(b.name), desc: tAll(b.desc) }]));

/** What upgrades and the waiting start bonus give in this match (the bonus is used up). */
export function loadout() {
  const boost = rules.balanced ? null : save.boost;
  if (save.boost && !rules.balanced) { save.boost = null; persist(); }
  return {
    ammo: tier('ammo'), mags: tier('mags'), boost,
    hp: 1 + 0.06 * tier('hp') + (boost === 'hp' ? 0.25 : 0),
    reload: 1 + 0.08 * tier('reload'),
    damage: 1 - 0.04 * tier('armor'),
  };
}
export type Loadout = ReturnType<typeof loadout>;
