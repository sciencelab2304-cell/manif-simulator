/**
 * Map of the fictional city of Valbrune.
 * The boulevard des Tanneurs runs along -Z. The crowd starts in the north (z > 0)
 * and walks south towards the place de la Concorde-Neuve (z < -200).
 */
export const ROAD_HALF = 8; // carriageway: x in [-8, 8]
export const FACADE_X = 14; // building facades at |x| = 14
export const AVE_START = 50; // northern end (closing facade)
export const AVE_END = -200; // avenue opens on the place
export const CROSS_Z0 = -84; // rue de la Corderie (cross street) z in [-98, -84]
export const CROSS_Z1 = -98;
export const CROSS_HALF_X = 60;
export const PLACE_Z0 = -200;
export const PLACE_Z1 = -290;
export const PLACE_HALF_X = 55;
export const MONUMENT = { x: 0, z: -248, r: 5 };

export const CRS_LINE_Z = -150; // initial police line
export const BREACH_STEP = 17; // the line falls back this far when the protesters' push gauge is full
export const VAN_Z = -166;
export const TRUCK_Z = -180;
export const OBJECTIVE = { x: 0, z: -228, r: 18 }; // protester goal on the place
export const EVAC_PROTEST = { x: 0, z: 46 };
export const EVAC_POLICE = { x: 4, z: -196 };
export const MATCH_SECONDS = 600; // police must hold for 10 minutes

export interface Rect { x0: number; x1: number; z0: number; z1: number } // x0<x1, z0<z1

export const WALKABLE: Rect[] = [
  { x0: -FACADE_X + 0.4, x1: FACADE_X - 0.4, z0: AVE_END - 1, z1: AVE_START - 0.6 },
  { x0: -CROSS_HALF_X + 0.4, x1: CROSS_HALF_X - 0.4, z0: CROSS_Z1 + 0.4, z1: CROSS_Z0 - 0.4 },
  { x0: -PLACE_HALF_X + 0.4, x1: PLACE_HALF_X - 0.4, z0: PLACE_Z1 + 0.4, z1: PLACE_Z0 },
];

export function inRect(r: Rect, x: number, z: number) {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

export function isWalkable(x: number, z: number) {
  for (const r of WALKABLE) if (inRect(r, x, z)) return true;
  return false;
}

/** Push a point back inside the nearest walkable rectangle. */
export function clampWalkable(p: { x: number; z: number }) {
  if (isWalkable(p.x, p.z)) return;
  let best = Infinity, bx = p.x, bz = p.z;
  for (const r of WALKABLE) {
    const cx = Math.min(Math.max(p.x, r.x0), r.x1);
    const cz = Math.min(Math.max(p.z, r.z0), r.z1);
    const d = (cx - p.x) ** 2 + (cz - p.z) ** 2;
    if (d < best) { best = d; bx = cx; bz = cz; }
  }
  p.x = bx; p.z = bz;
}

export function onPlace(z: number) { return z < PLACE_Z0; }
