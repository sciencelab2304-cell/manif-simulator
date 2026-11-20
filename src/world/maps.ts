import { t } from '../core/i18n';

/**
 * The maps: same story (the march comes down a street towards a square held by the police), different places.
 * `layout.ts` takes the street sizes of the chosen map; `city.ts` and the sky dress it.
 */
export interface MapDef {
  id: string;
  name: string;
  square: string; // where the march goes
  desc: string;
  level: number; // player level that unlocks it
  road: number; // half width of the carriageway
  facade: number; // facades at |x| = facade
  storeys: number; // building height (floors above the shops)
  stones: string[]; // facade colours
  startHour: number; // in-game time at the start of the match (16.5 = 16h30)
  parked: boolean; // parked cars along the kerbs
  station: boolean; // a railway station closes the square instead of the monument
}

export const MAPS: MapDef[] = ([
  { id: 'tanneurs', name: 'Boulevard des Tanneurs', square: 'la place de la Concorde-Neuve', desc: 'Le grand boulevard haussmannien jusqu\'à la place de la Concorde-Neuve, en fin d\'après-midi.',
    level: 1, road: 8, facade: 14, storeys: 5, stones: ['#cfc3a9', '#d6ccb6', '#c8bba0', '#ddd2bc'], startHour: 16.5, parked: true, station: false },
  { id: 'remparts', name: 'Quartier des Remparts', square: 'la place du Marché', desc: 'Les rues étroites de la vieille ville, briques et crépis, à la tombée du jour. On se bat au corps à corps.',
    level: 3, road: 4.5, facade: 9, storeys: 3, stones: ['#b9775a', '#c98f6b', '#a86a4f', '#d2a27e'], startHour: 18.6, parked: false, station: false },
  { id: 'gare', name: 'Parvis de la gare', square: 'le parvis de la gare', desc: 'La large avenue de la gare et son parvis, de nuit, face à la grande verrière.',
    level: 5, road: 11, facade: 20, storeys: 6, stones: ['#b8b8b0', '#c4c2b8', '#a9aaa4', '#cfcdc4'], startHour: 21, parked: true, station: true },
] as MapDef[]).map((m) => ({ ...m, name: t(m.name), square: t(m.square), desc: t(m.desc) }));
export const mapById = (id: string) => MAPS.find((m) => m.id === id) ?? MAPS[0];
