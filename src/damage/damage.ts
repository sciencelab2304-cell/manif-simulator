import * as THREE from 'three';
import type { Camp, Human } from '../core/context';

export type Zone = 'head' | 'torso' | 'armL' | 'armR' | 'legL' | 'legR';
export const ZONES: Zone[] = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'];
export const ZONE_FR: Record<Zone, string> = { head: 'tête', torso: 'torse', armL: 'bras gauche', armR: 'bras droit', legL: 'jambe gauche', legR: 'jambe droite' };

export const ZONE_SHORT: Record<Zone, string> = { head: 'tête', torso: 'torse', armL: 'bras', armR: 'bras', legL: 'jambe', legR: 'jambe' };

export type DamageType = 'blunt' | 'glass' | 'lbd' | 'blast' | 'baton' | 'water' | 'trample' | 'fire' | 'gas';

export interface DamageInfo {
  amount: number;
  zone: Zone;
  type: DamageType;
  dir: THREE.Vector3; // direction of the hit (from source to target)
  point: THREE.Vector3;
  force: number; // knock-back impulse (m/s scale)
  by?: Human | null; // the human who caused it, if any
  fromCamp: Camp | 'none';
}

/**
 * Localised wound state shared by NPCs and the player.
 * Each zone accumulates damage 0..100; flags express lasting consequences.
 */
export class Wounds {
  z: Record<Zone, number> = { head: 0, torso: 0, armL: 0, armR: 0, legL: 0, legR: 0 };
  bleed = 0; // hp per second
  eye = false; // eye injury (LBD in the face)
  jaw = false;
  concussion = 0; // seconds of daze left
  limp = 0; // 0..1

  apply(d: DamageInfo, armor: Partial<Record<Zone, number>> = {}) {
    const a = armor[d.zone] ?? 0;
    const amt = d.amount * (1 - a);
    this.z[d.zone] = Math.min(100, this.z[d.zone] + amt * 1.5);
    let bleed = 0;
    switch (d.type) {
      case 'glass': bleed = amt * 0.06; break;
      case 'lbd': bleed = d.zone === 'head' ? amt * 0.05 : amt * 0.015; break;
      case 'blast': bleed = amt * 0.04; break;
      case 'baton': bleed = d.zone === 'head' ? amt * 0.04 : 0; break;
      case 'blunt': bleed = d.zone === 'head' ? amt * 0.05 : amt * 0.01; break;
      case 'trample': bleed = amt * 0.01; break;
    }
    this.bleed = Math.min(6, this.bleed + bleed);
    if (d.zone === 'legL' || d.zone === 'legR') this.limp = Math.min(1, this.limp + amt / 40);
    if (d.zone === 'head') {
      if (d.type === 'baton' || d.type === 'blunt' || d.type === 'lbd') this.concussion = Math.max(this.concussion, amt * 0.12);
      if (d.type === 'lbd' && a < 0.5) {
        // what the projectile hits on the face depends on the height of the impact
        if (Math.random() < 0.55) this.eye = true; else this.jaw = true;
      }
    }
    return amt;
  }

  /** 0..1 overall severity, used for "blessé grave". */
  severity() {
    let s = 0;
    for (const k in this.z) s = Math.max(s, this.z[k as Zone]);
    return s / 100 + (this.eye ? 0.4 : 0) + (this.jaw ? 0.25 : 0);
  }

  heal() {
    this.bleed = 0;
    for (const k in this.z) this.z[k as Zone] *= 0.6;
    this.limp *= 0.6;
  }
}

/**
 * Localise a hit on a standing humanoid.
 * base = feet position, yaw = facing angle, scale = 1 for adults.
 */
export function zoneFromPoint(base: THREE.Vector3, yaw: number, p: THREE.Vector3, crouch = 0): Zone {
  const h = (p.y - base.y) / (1 - crouch * 0.35);
  const dx = p.x - base.x, dz = p.z - base.z;
  // lateral offset in body space (right = +)
  const lateral = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  if (h > 1.5) return 'head';
  if (h > 0.98) {
    if (Math.abs(lateral) > 0.2) return lateral > 0 ? 'armL' : 'armR';
    return 'torso';
  }
  if (h > 0.85 && Math.abs(lateral) < 0.15) return 'torso';
  return lateral > 0 ? 'legL' : 'legR';
}
