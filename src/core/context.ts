import type * as THREE from 'three';
import type { Physics } from './physics';
import type { Input } from './input';
import type { Settings, QualityProfile } from './settings';
import type { AudioEngine } from '../audio/audio';
import type { Particles } from '../fx/particles';
import type { Decals } from '../fx/decals';
import type { LightPool } from '../fx/lights';
import type { Post } from '../fx/post';
import type { City } from '../world/city';
import type { Sky } from '../world/sky';
import type { Destruction } from '../destruction/destruction';
import type { Crowd } from '../npc/crowd';
import type { Player } from '../player/player';
import type { Projectiles } from '../weapons/projectiles';
import type { GasSystem } from '../weapons/gas';
import type { Tension } from '../tension/tension';
import type { Hud } from '../ui/hud';
import type { WaterCannon } from '../vehicles/watercannon';
import type { Pickups } from '../weapons/pickups';
import type { Net } from '../net/net';
import type { DamageInfo, Zone } from '../damage/damage';
import type { NPC } from '../npc/npc';

export type Camp = 'protest' | 'police';

/** What the attacker learns when one of his hits lands. */
export interface HitInfo { id: number; role: string; camp: Camp | 'neutral'; zone: Zone; eye: boolean; jaw: boolean; type: string; blocked?: boolean }

/**
 * A human player as the world sees it: the local Player, or the Avatar standing in for a remote one on the host.
 * NPC brains, damage and medics only talk to this interface, so solo and multiplayer share one code path.
 */
export interface Human {
  readonly isHuman: true;
  readonly camp: Camp;
  readonly alive: boolean;
  readonly feet: THREE.Vector3;
  aggro: number;
  callMedic: boolean;
  medic: NPC | null;
  takeHit(d: DamageInfo): void;
  zoneAt(p: THREE.Vector3): Zone;
  hitLanded(h: HitInfo): void;
  heal(full?: boolean): void;
  medicProgress(k: number): void;
  getArrested(): void;
  /** grabbed by a CRS player: held still while he handcuffs */
  seize(): void;
}

export const asHuman = (o: unknown): Human | null => (o && (o as Human).isHuman ? (o as Human) : null);


/** Match counters: world ones (from the host) and personal ones (`my…`, hits, thrown…). */
export function newStats() {
  return { thrown: 0, lbdShots: 0, lbdHits: 0, gasGrenades: 0, stingGrenades: 0, batonHits: 0, npcInjured: 0, npcSevere: 0,
    arrests: 0, myArrests: 0, hits: 0, headHits: 0, peopleHit: 0, windows: 0, vehiclesBurnt: 0, fires: 0, barricades: 0, damageEuros: 0, evacuated: 0, playerWounds: 0, waterSeconds: 0 };
}
export type Stats = ReturnType<typeof newStats>;

export interface Ctx {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  physics: Physics;
  input: Input;
  settings: Settings;
  q: QualityProfile;
  audio: AudioEngine;
  particles: Particles;
  decals: Decals;
  lights: LightPool;
  post: Post;
  city: City;
  sky: Sky;
  destruction: Destruction;
  crowd: Crowd;
  player: Player;
  projectiles: Projectiles;
  gas: GasSystem;
  tension: Tension;
  hud: Hud;
  truck: WaterCannon;
  pickups: Pickups;
  stats: Stats;
  camp: Camp;
  time: number; // seconds since start of match
  wind: THREE.Vector3;
  night: number; // 0 day .. 1 night
  over: boolean;
  net: Net;
  game: { arrestGoal: number; finish(winner: Camp, reason: string): void; humanDown(arrested: boolean): void };
}

/** Global mutable game context, filled in by game.ts. */
export const ctx = {} as Ctx;
