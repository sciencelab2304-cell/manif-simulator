import * as THREE from 'three';
import { ctx, type Camp } from '../core/context';
import { RAPIER, G, groups } from '../core/physics';
import { clamp, lerp, rr, chance, pick, withSeed } from '../core/util';
import { Wounds, type DamageInfo, type Zone, zoneFromPoint } from '../damage/damage';
import { applyPose, neutralPose, type Pose, type BodyLook, P, NPARTS, NACC, ACC, COVERS_HAIR } from './body';
import { Ragdoll } from './ragdoll';
import { groundY } from '../world/city';

export type Role = 'pacifist' | 'curious' | 'casseur' | 'medic' | 'journalist' | 'crs' | 'firefighter';
export type Weapon = 'shield' | 'lbd' | 'grenade' | 'none';
export type State =
  | 'march' | 'mill' | 'flee' | 'throw' | 'smash' | 'barricade' | 'ignite' | 'film' | 'help' | 'treat' | 'carry' | 'leave'
  | 'line' | 'charge' | 'arrest' | 'escort' | 'down' | 'evac' | 'arrested' | 'ragdoll' | 'getup' | 'gassed' | 'fetch' | 'wait' | 'gone'
  | 'cuffing';

const SKINS = [0xf1c7a5, 0xe0ac86, 0xc68a64, 0x9b6544, 0x6e4630, 0xf5d2b8, 0xd9a07a];
const TOPS = [0x2b2f3a, 0x5a2a25, 0x2e4a3a, 0x7a6a50, 0x1f3550, 0x8a8a84, 0x3a3a3a, 0xa0522d, 0x445566, 0x6b4f7a, 0xc8b89a, 0x9a2222];
const PANTS = [0x1f2633, 0x2a2a2a, 0x3b4a5c, 0x4a4036, 0x22303f, 0x5a5a55, 0x34507a, 0x2c4466, 0x6b5a45];
const HAIR = [0x1a1410, 0x2b1d14, 0x3b2a1c, 0x5a3c22, 0x8a6a3a, 0xc9a66b, 0x6a2f1a, 0x9a9a96, 0x111111];
const BEANIES = [0x9a2222, 0x1f3a8a, 0x2e4a3a, 0xd9a21b, 0x333333, 0x6b4f7a];
const SHOES = [0x1a1a1a, 0x2a2420, 0xe8e8e8, 0x4a3426, 0x3a3f4a, 0xd8d4cc, 0x7a1f1f];
/** A few protesters come in fancy dress (painted accessories: white keeps their colours). */
const FANCY = [ACC.party, ACC.clownNose, ACC.bunny, ACC.afro, ACC.shades, ACC.mustache, ACC.cowboy, ACC.crown, ACC.duck, ACC.topHat, ACC.heartGlasses, ACC.mohawk];
const WIGS = [0xff5fa8, 0x3ad0ff, 0x7a3cff, 0x1a1410, 0xff7a1a, 0x3ae07a];

let NEXT_ID = 1;

/** A random look for a role (call inside `withSeed` for a stable one). */
export function makeLook(role: Role, weapon: Weapon): BodyLook {
  const c = (h: number) => new THREE.Color(h);
  const skin = c(pick(SKINS));
  let top = c(pick(TOPS)), pants = c(pick(PANTS));
  const acc = Array.from({ length: NACC }, () => new THREE.Color(0x222222));
  const on = new Array(NACC).fill(false);
  const size = role === 'crs' ? rr(0.98, 1.06) : rr(0.9, 1.08);
  const gloved = role === 'crs' || role === 'firefighter' || role === 'casseur';
  const hands = gloved ? c(0x141414) : skin.clone(), shoes = c(gloved ? 0x111111 : pick(SHOES));
  if (role !== 'crs' && role !== 'firefighter' && role !== 'casseur') {
    on[ACC.hair] = chance(0.9);
    acc[ACC.hair] = c(chance(0.15) ? pick(BEANIES) : pick(HAIR));
  }
  switch (role) {
    case 'crs':
      top = c(0x1a2333); pants = c(0x1a2333);
      on[ACC.helmet] = true; acc[ACC.helmet] = c(0x1c2638);
      on[ACC.vest] = true; acc[ACC.vest] = c(0x0f141c);
      if (weapon === 'shield') { on[ACC.shield] = true; on[ACC.baton] = true; acc[ACC.baton] = c(0x111111); }
      if (weapon === 'lbd') { on[ACC.gun] = true; acc[ACC.gun] = c(0x2a3a2a); }
      if (weapon === 'grenade') { on[ACC.gun] = true; acc[ACC.gun] = c(0x333333); }
      break;
    case 'casseur':
      top = c(0x0e0e0e); pants = c(0x121212); skin.lerp(c(0x101010), 0.85); // balaclava
      if (chance(0.5)) { on[ACC.pack] = true; acc[ACC.pack] = c(0x151515); }
      break;
    case 'medic':
      top = c(0xe8e8e8); on[ACC.helmet] = true; acc[ACC.helmet] = c(0xf2f2f2);
      on[ACC.pack] = true; acc[ACC.pack] = c(0xc02020);
      break;
    case 'journalist':
      on[ACC.helmet] = true; acc[ACC.helmet] = c(0x2a6bd1);
      on[ACC.vest] = true; acc[ACC.vest] = c(0x2a6bd1);
      on[ACC.camera] = true; acc[ACC.camera] = c(0x1a1a1a);
      break;
    case 'firefighter':
      top = c(0x1b2230); pants = c(0x1b2230);
      on[ACC.helmet] = true; acc[ACC.helmet] = c(0xd8dde2);
      on[ACC.vest] = true; acc[ACC.vest] = c(0x2a3342);
      break;
    case 'curious':
      if (chance(0.6)) { on[ACC.phone] = true; }
      break;
    default:
      if (chance(0.3)) { on[ACC.pack] = true; acc[ACC.pack] = c(pick(TOPS)); }
      if (chance(0.07)) { on[ACC.flag] = true; acc[ACC.flag] = c(pick([0xc0251c, 0xc0251c, 0x1f6f3a, 0xe3c11a, 0x1f3a8a])); }
      if (chance(0.08)) {
        const f = pick(FANCY);
        on[f] = true; acc[f] = c(f === ACC.afro || f === ACC.mohawk ? pick(WIGS) : 0xffffff);
        if (COVERS_HAIR.includes(f)) on[ACC.hair] = false;
      }
  }
  return { skin, top, pants, hands, shoes, acc, acc_on: on, size };
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4();
const _base = new THREE.Matrix4(), _s = new THREE.Vector3();

export const STATES: State[] = ['march', 'mill', 'flee', 'throw', 'smash', 'barricade', 'ignite', 'film', 'help', 'treat', 'carry', 'leave',
  'line', 'charge', 'arrest', 'escort', 'down', 'evac', 'arrested', 'ragdoll', 'getup', 'gassed', 'fetch', 'wait', 'gone', 'cuffing'];

/** Below this share of their health, protesters can be handcuffed. */
export const CUFF_HP = 0.5;

export class NPC {
  camp: Camp | 'neutral';
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  target = new THREE.Vector3();
  speed = 0; // desired speed
  faceYaw: number | null = null; // face a direction when idle
  hp: number;
  maxHp: number;
  wounds = new Wounds();
  armor: Partial<Record<Zone, number>> = {};
  state: State = 'march';
  stateT = 0;
  think = Math.random() * 0.5;
  look: BodyLook;
  mats: THREE.Matrix4[] = Array.from({ length: NPARTS }, () => new THREE.Matrix4());
  pose: Pose = neutralPose();
  phase = Math.random() * 10;
  t = Math.random() * 100;
  // animation overlays
  throwT = 0; strikeT = 0; flinchT = 0; aimT = 0; chant = false; handsUp = false; coverHead = 0; kneel = false;
  // physics
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  ragdoll: Ragdoll | null = null;
  downMats: THREE.Matrix4[] | null = null;
  downOffset = new THREE.Vector3();
  downT = 0;
  unconscious = false;
  injuredCounted = false;
  severeCounted = false;
  helper: NPC | null = null;
  patient: NPC | null = null;
  escortOf: NPC | null = null;
  gas = 0;
  cooldown = rr(2, 6);
  cooldown2 = rr(5, 15);
  slot = { x: 0, z: 0, row: 0 };
  courage = Math.random();
  removed = false;
  visible = true;
  hidden = false; // the local player's own avatar
  tint = 0; // blood on the clothes, 0..1
  bubbleT = 0;
  limpPhase = 0;
  data: any = {};

  /** `id` is only passed by clients, which mirror the NPCs created on the host. */
  constructor(public role: Role, pos: THREE.Vector3, public weapon: Weapon = 'none', public id = NEXT_ID++) {
    this.pos.copy(pos);
    this.target.copy(pos);
    this.camp = role === 'crs' ? 'police' : role === 'firefighter' || role === 'journalist' ? 'neutral' : 'protest';
    this.maxHp = this.hp = role === 'crs' ? 100 : role === 'firefighter' ? 120 : rr(85, 110);
    this.look = withSeed(this.id * 7919 + 13, () => makeLook(role, weapon));
    if (role === 'crs') this.armor = { head: 0.6, torso: 0.45, armL: 0.3, armR: 0.3, legL: 0.25, legR: 0.25 };
    if (role === 'firefighter') this.armor = { head: 0.7, torso: 0.3 };
    if (role === 'medic' || role === 'journalist') this.armor = { head: 0.5 };
    const w = ctx.physics.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + 0.9, pos.z));
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.28)
      .setCollisionGroups(groups(G.NPC, G.PLAYER | G.PROJ | G.VEHICLE)), this.body);
    ctx.physics.setOwner(this.collider, { kind: 'npc', ref: this });
    ctx.net.emit(['npc', this.id, role, weapon, pos.x, pos.z]);
  }

  get carryingFlag() { return this.look.acc_on[ACC.flag]; }

  get standing() { return !this.ragdoll && !this.downMats && this.state !== 'gone'; }
  get isDown() { return !!this.ragdoll || !!this.downMats; }
  /** A protester weak enough (or down, or choking on gas) to be handcuffed. */
  get cuffable() {
    return this.camp === 'protest' && this.role !== 'medic' && !this.removed
      && !['arrested', 'escort', 'evac', 'cuffing', 'gone', 'carry'].includes(this.state)
      && (this.isDown || this.state === 'gassed' || this.hp <= this.maxHp * CUFF_HP);
  }
  get forward() { return _v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  setState(s: State) { this.state = s; this.stateT = 0; }

  // ------------------------------------------------------------------ damage
  takeHit(d: DamageInfo) {
    if (this.state === 'gone' || this.removed) return;
    // CRS shield blocks frontal hits (front row holding the line)
    if (this.weapon === 'shield' && this.standing && d.type !== 'water' && d.type !== 'blast' && d.type !== 'gas' && d.zone !== 'legL' && d.zone !== 'legR') {
      const fwd = this.forward;
      if (fwd.dot(d.dir) < -0.35 && Math.random() < 0.85) {
        ctx.audio.shieldHit(d.point);
        ctx.particles.sparks(d.point, 4, 2);
        this.flinchT = 0.25;
        ctx.crowd.onBlocked(this, d);
        return;
      }
    }
    const amt = this.wounds.apply(d, this.armor);
    this.hp -= amt;
    // blood
    const bleeding = d.type === 'glass' || d.type === 'lbd' || d.type === 'blast' || (d.zone === 'head' && amt > 8) || amt > 22;
    if (bleeding && amt > 3) {
      ctx.particles.bloodSpray(d.point, d.dir, clamp(amt / 25, 0.4, 1.6));
      if (amt > 10) ctx.decals.add('blood', d.point.x + d.dir.x * 0.6, d.point.z + d.dir.z * 0.6, rr(0.4, 0.9), groundY(d.point.x, d.point.z));
    }
    if (amt > 6 && !this.injuredCounted) { this.injuredCounted = true; ctx.stats.npcInjured++; }
    const severe = this.wounds.severity() > 0.85 || this.wounds.eye || this.wounds.jaw || this.hp < 25;
    if (severe && !this.severeCounted) { this.severeCounted = true; ctx.stats.npcSevere++; }
    const wasUp = this.standing;
    const knock = this.hp <= 0 || d.force > 5.5 || (d.zone === 'head' && amt > 18) || (d.type === 'lbd' && (d.zone === 'head' || d.zone === 'legL' || d.zone === 'legR') && chance(0.7))
      || (d.type === 'baton' && d.zone === 'head') || (this.wounds.limp > 0.8 && chance(0.5));
    if (this.hp <= 0) { this.unconscious = true; this.hp = 0; }
    if (knock && this.standing) {
      _v.copy(d.dir).setY(0).normalize().multiplyScalar(Math.max(2, d.force)).add(_v2.set(0, d.type === 'blast' || d.type === 'water' ? 2.5 : 1, 0));
      this.knockDown(_v, d.zone === 'head' ? P.head : d.zone === 'torso' ? P.torso : d.zone.startsWith('leg') ? P.shinL : P.armL);
      if (!this.unconscious) ctx.audio.scream(this.pos.clone().setY(1.6), 1);
    } else if (this.standing) {
      this.flinchT = 0.35;
      if (amt > 5 && chance(0.6)) ctx.audio.scream(this.pos.clone().setY(1.6), 0.6);
      else if (amt > 5) ctx.audio.impact('body', d.point, 0.6);
    } else if (this.ragdoll) {
      this.ragdoll.impulse(d.zone === 'head' ? P.head : P.torso, _v.copy(d.dir).multiplyScalar(d.force * 0.6));
    }
    ctx.crowd.onNpcHit(this, d, amt, wasUp && !this.standing);
  }

  knockDown(vel: THREE.Vector3, part: number = P.torso) {
    if (!this.standing) return;
    ctx.net.emit(['knock', this.id, vel.x, vel.y, vel.z, part]);
    if (!this.visible) this.computeStandingPose(0);
    this.collider.setEnabled(false);
    this.throwT = this.strikeT = this.aimT = 0;
    if (this.patient) { this.patient.helper = null; this.patient = null; }
    if (ctx.crowd.ragdollSlot()) {
      this.ragdoll = new Ragdoll(this.mats, vel.clone().add(this.vel), this);
      this.ragdoll.impulse(part, _v.copy(vel).multiplyScalar(0.4));
      this.setState('ragdoll');
    } else {
      // no ragdoll budget left: procedural fall
      this.layDown(Math.atan2(vel.x, vel.z), true);
    }
    this.vel.set(0, 0, 0);
  }

  /** Height of the feet: the street, or a walkway for a human player. */
  get floorY() { return Math.max(this.pos.y, groundY(this.pos.x, this.pos.z)); }

  /** Lying pose without physics. */
  layDown(dirYaw: number, quiet = false) {
    if (!quiet) ctx.net.emit(['lay', this.id, dirYaw]);
    const p = neutralPose();
    p.armLz = 0.5; p.armRz = -0.4; p.armLx = rr(-0.5, 0.3); p.thighL = rr(-0.3, 0.1); p.shinR = rr(0, 0.6);
    _base.makeTranslation(this.pos.x, this.floorY + 0.13, this.pos.z)
      .multiply(_m.makeRotationY(dirYaw + Math.PI))
      .multiply(_m.makeRotationX(-Math.PI / 2));
    applyPose(_base, p, this.mats);
    this.downMats = this.mats.map((m) => m.clone());
    this.downOffset.set(0, 0, 0);
    this.collider.setEnabled(false);
    this.setState('down');
    this.downT = 0;
  }

  downPelvis(out: THREE.Vector3) {
    if (this.ragdoll) return this.ragdoll.pelvisPos(out);
    if (this.downMats) return out.setFromMatrixPosition(this.downMats[P.pelvis]).add(this.downOffset);
    return out.copy(this.pos).setY(1);
  }

  getUp() {
    if (!this.downMats) return;
    this.downPelvis(_v);
    this.pos.set(_v.x, 0, _v.z);
    this.downMats = null;
    this.collider.setEnabled(true);
    this.setState('getup');
    ctx.net.emit(['up', this.id, this.pos.x, this.pos.z]);
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    this.state = 'gone';
    ctx.net.emit(['rm', this.id]);
    if (this.ragdoll) { this.ragdoll.dispose(); this.ragdoll = null; }
    ctx.physics.removeBody(this.body);
    if (this.helper) this.helper.patient = null;
    if (this.patient) this.patient.helper = null;
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number, camPos: THREE.Vector3, drawDist: number) {
    this.t += dt;
    this.stateT += dt;
    this.throwT = Math.max(0, this.throwT - dt);
    this.strikeT = Math.max(0, this.strikeT - dt);
    this.flinchT = Math.max(0, this.flinchT - dt);
    this.coverHead = Math.max(0, this.coverHead - dt);
    this.wounds.concussion = Math.max(0, this.wounds.concussion - dt);
    // bleeding
    if (this.wounds.bleed > 0 && this.state !== 'gone') {
      this.hp -= this.wounds.bleed * dt * 0.25;
      if (this.hp <= 0 && !this.unconscious) { this.unconscious = true; this.hp = 0; if (this.standing) this.knockDown(new THREE.Vector3(0, 0.5, 0)); }
      if (ctx.decals.blood && chance(dt * this.wounds.bleed * 0.15)) {
        this.downPelvis(_v);
        ctx.decals.add('blood', _v.x + rr(-0.3, 0.3), _v.z + rr(-0.3, 0.3), rr(0.15, 0.35), groundY(_v.x, _v.z));
      }
    }
    const dist = this.pos.distanceTo(camPos);
    // your own body only shows in third person
    this.visible = (!this.hidden || ctx.settings.thirdPerson && !ctx.player.inVehicle) && dist < drawDist;

    if (this.ragdoll) {
      if (this.ragdoll.update(dt, this.mats)) {
        this.downMats = this.mats.map((m) => m.clone());
        this.downOffset.set(0, 0, 0);
        this.ragdoll.dispose(); this.ragdoll = null;
        this.downPelvis(_v); this.pos.set(_v.x, 0, _v.z);
        this.setState('down'); this.downT = 0;
      }
      return;
    }
    if (this.downMats) {
      for (let i = 0; i < NPARTS; i++) this.mats[i].copy(this.downMats[i]).premultiply(_m.makeTranslation(this.downOffset.x, this.downOffset.y, this.downOffset.z));
      return;
    }
    if (this.state === 'gone') return;
    // keep the kinematic capsule on the character
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + 0.9, z: this.pos.z });
    if (this.visible) this.computeStandingPose(dt);
  }

  computeStandingPose(dt: number) {
    const p = this.pose;
    const spd = Math.hypot(this.vel.x, this.vel.z);
    const run = clamp((spd - 2.2) / 2.5, 0, 1);
    const amp = clamp(spd / 1.5, 0, 1.15);
    this.phase += spd * dt * (2.6 - run * 0.6);
    const ph = this.phase;
    const s = Math.sin(ph), c = Math.cos(ph);
    const limp = this.wounds.limp;
    Object.assign(p, neutralPose());
    p.y = -Math.abs(s) * 0.04 * amp - run * 0.05;
    p.thighL = -s * (0.5 + run * 0.35) * amp;
    p.thighR = s * (0.5 + run * 0.35) * amp * (1 - limp * 0.6);
    p.shinL = (Math.max(0, -c) * (0.8 + run * 0.7) + 0.06) * amp;
    p.shinR = (Math.max(0, c) * (0.8 + run * 0.7) + 0.06) * amp * (1 - limp * 0.7);
    p.armLx = s * (0.45 + run * 0.4) * amp;
    p.armRx = -s * (0.45 + run * 0.4) * amp;
    p.torsoRx = run * 0.3 + limp * 0.1 * Math.abs(s);
    p.pelvisRx = run * 0.1;
    // breathing / idle sway
    p.torsoRy = Math.sin(this.t * 0.7 + this.id) * 0.05;
    p.headRy = Math.sin(this.t * 0.4 + this.id * 3) * 0.25;
    p.headRx = 0.05;

    if (this.role === 'crs' && this.weapon === 'shield') { p.armLx = -1.2; p.armLz = -0.2; p.armRx = Math.min(p.armRx, -0.3); }
    if (this.role === 'crs' && (this.weapon === 'lbd' || this.weapon === 'grenade') && (this.aimT > 0 || this.state === 'line')) {
      const aim = this.aimT > 0 ? 1 : 0.35;
      p.armRx = lerp(p.armRx, -1.45, aim); p.armRz = lerp(p.armRz, 0.25, aim); p.armLx = lerp(p.armLx, -1.5, aim); p.armLz = lerp(p.armLz, -0.45, aim);
      p.headRx = 0.12 * aim;
    }
    if (this.chant && spd < 1.2) {
      const pump = Math.max(0, Math.sin(this.t * 5 + this.id));
      p.armRx = -2.5 - pump * 0.4; p.armRz = -0.15;
    }
    if (this.handsUp) { p.armLx = -2.9; p.armRx = -2.9; p.armLz = 0.2; p.armRz = -0.2; }
    if (this.look.acc_on[ACC.phone] && (this.state === 'film' || this.state === 'mill')) { p.armRx = -1.7; p.armRz = 0.2; p.headRx = 0.25; p.headRy = 0; }
    if (this.role === 'journalist' && this.state === 'film') { p.armRx = -2.6; p.armRz = -0.25; p.armLx = -2.2; p.armLz = 0.4; p.headRy = 0; }
    if (this.carryingFlag) { p.armRx = -0.9; p.armRz = 0; }
    if (this.coverHead > 0 || this.state === 'gassed') {
      p.armLx = -2.5; p.armLz = 0.75; p.armRx = -2.5; p.armRz = -0.75; p.torsoRx += 0.45; p.headRx = 0.5;
    }
    if (this.state === 'cuffing') {
      // on the knees, hands behind the back
      p.y = -0.42; p.thighL = -1.45; p.shinL = 1.55; p.thighR = -0.15; p.shinR = 1.85; p.torsoRx = 0.35;
    }
    if (this.state === 'arrested' || this.state === 'cuffing' || this.state === 'escort' && this.role !== 'crs') {
      p.armLx = 0.55; p.armLz = -0.3; p.armRx = 0.55; p.armRz = 0.3; p.headRx = 0.35; p.torsoRx += 0.15;
    }
    if (this.state === 'carry') { p.armLx = -1.1; p.armRx = -1.1; p.torsoRx += 0.45; }
    if (this.throwT > 0) {
      const k = 1 - this.throwT / 0.55;
      if (k < 0.55) { p.armRx = lerp(p.armRx, -2.9, k / 0.55); p.armRz = -0.35; p.torsoRy = 0.4 * (k / 0.55); p.torsoRx -= 0.15; }
      else { const u = (k - 0.55) / 0.45; p.armRx = lerp(-2.9, -0.6, u); p.torsoRy = lerp(0.4, -0.35, u); p.torsoRx += 0.25 * u; }
    }
    if (this.strikeT > 0) {
      const k = 1 - this.strikeT / 0.45;
      p.armRx = k < 0.4 ? lerp(-0.4, -3, k / 0.4) : lerp(-3, -0.5, (k - 0.4) / 0.6); p.armRz = -0.2; p.torsoRx += 0.2;
    }
    if (this.kneel || this.state === 'getup' && this.stateT < 0.8) {
      p.y = -0.42; p.thighL = -1.45; p.shinL = 1.55; p.thighR = -0.15; p.shinR = 1.85; p.torsoRx = 0.45;
      if (this.kneel) { p.armLx = -0.9; p.armRx = -0.9 + Math.sin(this.t * 6) * 0.2; }
    }
    if (this.flinchT > 0) { p.torsoRx -= this.flinchT * 1.2; p.headRx -= this.flinchT; }
    if (this.wounds.concussion > 0) p.torsoRy += Math.sin(this.t * 2) * 0.2;

    const k = this.look.size;
    _base.makeRotationY(this.yaw).scale(_s.set(k, k, k)).setPosition(this.pos.x, this.floorY, this.pos.z);
    applyPose(_base, p, this.mats);
  }

  /** Hit test helper for melee & water: approximate zone from a world point. */
  zoneAt(p: THREE.Vector3): Zone {
    return zoneFromPoint(_v.set(this.pos.x, this.floorY, this.pos.z), this.yaw, p, this.kneel ? 1 : 0);
  }
}
