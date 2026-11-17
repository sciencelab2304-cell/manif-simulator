import * as THREE from 'three';
import { ctx, type Camp, type Human, type HitInfo } from '../core/context';
import { NPC } from '../npc/npc';
import type { DamageInfo } from '../damage/damage';
import { angleDiff, lerp } from '../core/util';

/** What a client reports about its player ~20 times per second. */
export interface HumanState {
  x: number; y: number; z: number; yaw: number; vx: number; vz: number;
  alive: boolean; crouch: boolean; aim: boolean; aggro: number; medic: boolean; car: boolean; hp: number; // share of max health
}

/**
 * The body of a human player inside the host's world (solo included): NPC brains, projectiles and medics see it like
 * any other person, and everything that happens to it is handed to that human's Player, locally or over the network.
 */
export class Avatar extends NPC implements Human {
  readonly isHuman = true;
  alive = true;
  inCar = false;
  aggro = 0;
  callMedic = false;
  medic: NPC | null = null;
  private goal = new THREE.Vector3();

  constructor(public peer: string, public name: string, readonly camp: Camp, pos: THREE.Vector3) {
    super(camp === 'police' ? 'crs' : 'pacifist', pos, camp === 'police' ? 'shield' : 'none');
    this.goal.copy(pos);
    this.data.human = { peer, name };
    ctx.net.emit(['human', this.id, peer, name]);
    if (this.local) { this.hidden = true; this.collider.setEnabled(false); }
  }

  get local() { return this.peer === ctx.net.me; }
  get feet() { return this.pos; }
  override get standing() { return this.alive && !this.inCar && super.standing; }

  private send(m: unknown[]) { ctx.net.sendTo(this.peer, m); }

  takeHit(d: DamageInfo) {
    if (!this.standing) return;
    if (this.local) ctx.player.takeHit(d);
    else this.send(['hurt', d.amount, d.zone, d.type, d.dir.x, d.dir.y, d.dir.z, d.point.x, d.point.y, d.point.z, d.force]);
  }
  hitLanded(h: HitInfo) { if (this.local) ctx.player.hitLanded(h); else this.send(['hit', h]); }
  heal(full = false) { if (this.local) ctx.player.heal(full); else this.send(['heal', full]); }
  medicProgress(k: number) { if (this.local) ctx.player.medicProgress(k); else this.send(['medicT', k]); }
  getArrested() { if (this.local) ctx.player.getArrested(); else this.send(['arrest']); }
  seize() { this.data.seizedT = ctx.time + 2.5; if (this.local) ctx.player.seize(); else this.send(['seize']); }
  override get cuffable() { return super.cuffable && !(this.data.seizedT > ctx.time); }
  feed(text: string, color: string) { if (this.local) ctx.hud.feed(text, color); else this.send(['feed', text, color]); }
  // a human falls or gets back up by himself; NPC knock-downs are not applied to him
  override knockDown() {}

  /** Mirror the human: the local Player directly, a remote one from its last report. */
  follow(dt: number, s?: HumanState) {
    if (this.local) {
      const p = ctx.player;
      s = { x: p.feet.x, y: 0, z: p.feet.z, yaw: p.yaw, vx: p.vel.x, vz: p.vel.z, alive: p.alive, crouch: p.crouch, aim: false, aggro: p.aggro, medic: p.callMedic, car: p.inVehicle, hp: p.hp / p.maxHp };
      p.medic = this.medic;
      if (p.vm.throwT > 0.3) this.throwT = Math.max(this.throwT, 0.5);
      if (p.vm.swingT > 0.35) this.strikeT = Math.max(this.strikeT, 0.4);
    }
    if (s) this.apply(s);
    const k = this.local ? 1 : 1 - Math.exp(-dt * 12);
    this.pos.x = lerp(this.pos.x, this.goal.x, k); this.pos.z = lerp(this.pos.z, this.goal.z, k);
    this.aggro = Math.max(0, this.aggro - dt * 0.08);
  }

  apply(s: HumanState) {
    this.goal.set(s.x, 0, s.z);
    this.vel.set(s.vx, 0, s.vz);
    this.yaw += angleDiff(this.yaw, s.yaw + Math.PI);
    this.kneel = s.crouch;
    this.aimT = s.aim ? 0.2 : 0;
    this.aggro = Math.max(this.aggro, s.aggro);
    this.callMedic = s.medic;
    this.inCar = s.car;
    this.hp = s.hp * this.maxHp;
    if (s.alive !== this.alive) {
      this.alive = s.alive;
      if (!s.alive) this.layDown(this.yaw);
      else { this.getUp(); this.setState('march'); this.pos.copy(this.goal); }
    }
    this.collider.setEnabled(!this.local && this.standing);
  }
}
