import * as THREE from 'three';
import { ctx, asHuman, type Camp, type Human } from '../core/context';
import { RAPIER, G, groups, type Owner } from '../core/physics';
import { rr, chance, clamp, pick } from '../core/util';
import type { NPC } from '../npc/npc';
import type { DamageType } from '../damage/damage';
import { groundY } from '../world/city';
import type { GasCloud } from './gas';
import { tAll } from '../core/i18n';

export type ThrowKind = 'pave' | 'canette' | 'bouteille' | 'conserve' | 'mortier' | 'fusee' | 'fumigene' | 'gas' | 'sting';

interface Def {
  geo: THREE.BufferGeometry;
  mat: THREE.Material | THREE.Material[];
  shape: () => RAPIER.ColliderDesc;
  density: number;
  dmg: number;
  type: DamageType;
  sound: 'stone' | 'metal' | 'glass' | 'can' | 'wood';
}

export const KIND_FR = tAll<ThrowKind>({
  pave: 'Pavé', canette: 'Canette', bouteille: 'Bouteille', conserve: 'Conserve', mortier: 'Mortier', fusee: 'Fusée',
  fumigene: 'Fumigène', gas: 'Grenade lacrymo', sting: 'Désencerclement',
});

let DEFS: Record<ThrowKind, Def> | null = null;
export function defs() {
  if (DEFS) return DEFS;
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  DEFS = {
    pave: { geo: new THREE.BoxGeometry(0.11, 0.1, 0.11), mat: std({ color: 0x8a8178, roughness: 0.95 }), shape: () => RAPIER.ColliderDesc.cuboid(0.055, 0.05, 0.055), density: 2600, dmg: 26, type: 'blunt', sound: 'stone' },
    canette: { geo: new THREE.CylinderGeometry(0.033, 0.033, 0.12, 12), mat: std({ color: 0xb02020, roughness: 0.3, metalness: 0.8 }), shape: () => RAPIER.ColliderDesc.cylinder(0.06, 0.033), density: 1000, dmg: 8, type: 'blunt', sound: 'can' },
    bouteille: { geo: new THREE.CylinderGeometry(0.014, 0.04, 0.3, 10), mat: std({ color: 0x1f5e2a, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.75 }), shape: () => RAPIER.ColliderDesc.cylinder(0.15, 0.04), density: 400, dmg: 15, type: 'glass', sound: 'glass' },
    conserve: { geo: new THREE.CylinderGeometry(0.042, 0.042, 0.11, 14), mat: std({ color: 0xb8bcc0, roughness: 0.25, metalness: 0.95 }), shape: () => RAPIER.ColliderDesc.cylinder(0.055, 0.042), density: 750, dmg: 13, type: 'blunt', sound: 'metal' },
    mortier: { geo: new THREE.CylinderGeometry(0.035, 0.035, 0.24, 10), mat: std({ color: 0xc23a2a, roughness: 0.8 }), shape: () => RAPIER.ColliderDesc.cylinder(0.12, 0.035), density: 350, dmg: 6, type: 'blunt', sound: 'wood' },
    fusee: { geo: new THREE.CylinderGeometry(0.02, 0.025, 0.45, 8), mat: std({ color: 0xd8c040, roughness: 0.6, emissive: 0xff6010, emissiveIntensity: 0.3 }), shape: () => RAPIER.ColliderDesc.cylinder(0.22, 0.025), density: 160, dmg: 6, type: 'blunt', sound: 'wood' },
    fumigene: { geo: new THREE.CylinderGeometry(0.025, 0.025, 0.25, 10), mat: std({ color: 0xd02a1a, roughness: 0.7, emissive: 0xff2000, emissiveIntensity: 0.6 }), shape: () => RAPIER.ColliderDesc.cylinder(0.125, 0.025), density: 450, dmg: 5, type: 'blunt', sound: 'can' },
    gas: { geo: new THREE.CylinderGeometry(0.028, 0.028, 0.15, 10), mat: std({ color: 0x3c4a35, roughness: 0.5, metalness: 0.5 }), shape: () => RAPIER.ColliderDesc.cylinder(0.075, 0.028), density: 680, dmg: 7, type: 'blunt', sound: 'metal' },
    sting: { geo: new THREE.SphereGeometry(0.045, 10, 8), mat: std({ color: 0x1a1a1a, roughness: 0.6 }), shape: () => RAPIER.ColliderDesc.ball(0.045), density: 650, dmg: 7, type: 'blunt', sound: 'metal' },
  };
  return DEFS;
}

let NEXT_PID = 1;

export class Projectile {
  age = 0;
  spent = false;
  dead = false;
  prevVel = new THREE.Vector3();
  fuse = Infinity;
  armed = false;
  emit = 0; // seconds of gas / smoke left
  gas: GasCloud | null = null;
  thrust = 0;
  resting = 0;
  bounces = 0;
  /** `body` is null on clients, which only mirror the host's projectiles. */
  constructor(public kind: ThrowKind, public mesh: THREE.Mesh, public body: RAPIER.RigidBody | null,
    public owner: NPC | null, public camp: Camp | 'none', public id = NEXT_PID++) {}
  get by(): Human | null { return asHuman(this.owner); }
  pos(out: THREE.Vector3) {
    if (!this.body) return out.copy(this.mesh.position);
    const t = this.body.translation(); return out.set(t.x, t.y, t.z);
  }
}

/** `owner` null: a client-side tracer, only drawn. */
interface Bullet { pos: THREE.Vector3; vel: THREE.Vector3; owner: NPC | null; camp: Camp; life: number }

export interface BlastOpts { radius: number; damage: number; knock: number; fire: boolean; flash: number; sound: number; by: Human | null; kind: 'mortier' | 'fusee' | 'sting' | 'car' | 'gas' }

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const FW_COLORS = [0xff3030, 0x30ff60, 0x4080ff, 0xffd040, 0xff40ff, 0xffffff, 0x40ffff];

export class Projectiles {
  list: Projectile[] = [];
  bullets: Bullet[] = [];
  bulletMesh: THREE.InstancedMesh;
  max = 170;

  constructor() {
    this.bulletMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.022, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd8d0b0, emissive: 0x3a3020 }), 64);
    this.bulletMesh.count = 0; this.bulletMesh.frustumCulled = false;
    ctx.scene.add(this.bulletMesh);
    ctx.physics.preStep.push((dt) => this.preStep(dt));
  }

  private mesh(kind: ThrowKind) {
    const d = defs()[kind];
    const mesh = new THREE.Mesh(d.geo, d.mat);
    mesh.castShadow = true;
    ctx.scene.add(mesh);
    return mesh;
  }

  /** Client: a projectile seen in a host snapshot. */
  ghost(id: number, kind: ThrowKind) {
    const p = new Projectile(kind, this.mesh(kind), null, null, 'none', id);
    this.list.push(p);
    return p;
  }

  byId(id: number) { return this.list.find((p) => p.id === id && !p.dead); }

  spawn(kind: ThrowKind, pos: THREE.Vector3, vel: THREE.Vector3, owner: NPC | null, camp: Camp | 'none') {
    const d = defs()[kind];
    const mesh = this.mesh(kind);
    const body = ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z)
      .setLinvel(vel.x, vel.y, vel.z).setAngvel({ x: rr(-12, 12), y: rr(-8, 8), z: rr(-12, 12) })
      .setCcdEnabled(true).setLinearDamping(0.02).setAngularDamping(0.4));
    let filter = G.STATIC | G.NPC | G.VEHICLE | G.DEBRIS | G.RAGDOLL;
    if (!owner?.hidden) filter |= G.PLAYER; // the local player's own throws never hit him
    const col = ctx.physics.world.createCollider(d.shape().setDensity(d.density).setRestitution(kind === 'pave' ? 0.15 : 0.35).setFriction(0.6)
      .setCollisionGroups(groups(G.PROJ, filter)).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    const p = new Projectile(kind, mesh, body, owner, camp);
    p.prevVel.copy(vel);
    ctx.physics.setOwner(col, { kind: 'proj', ref: p });
    if (kind === 'mortier') { p.fuse = rr(1.3, 1.8); ctx.audio.launch(pos); }
    if (kind === 'fusee') { p.fuse = 2.4; p.thrust = 2.2; ctx.audio.launch(pos); body.setGravityScale(0.35, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
    if (kind === 'gas') { p.emit = 14; ctx.audio.hiss(pos, 3); }
    if (kind === 'sting') p.fuse = 1.4;
    if (kind === 'fumigene') p.emit = 28;
    this.list.push(p);
    // keep the number of physical objects bounded
    if (this.list.length > this.max) {
      const old = this.list.find((q) => q.spent && q.emit <= 0 && q.fuse === Infinity);
      if (old) this.kill(old);
    }
    return p;
  }

  kill(p: Projectile) {
    if (p.dead) return;
    p.dead = true;
    ctx.net.emit(['pk', p.id]);
    ctx.scene.remove(p.mesh);
    if (p.body) ctx.physics.removeBody(p.body);
    if (p.gas) p.gas.source = null;
  }

  /** Grab a resting/live projectile (pick up a stone, return a gas grenade). */
  take(p: Projectile) {
    const kind = p.kind;
    const emit = p.emit;
    this.kill(p);
    return { kind, emit };
  }

  private preStep(dt: number) {
    for (const p of this.list) {
      if (p.dead || !p.body) continue;
      const v = p.body.linvel();
      p.prevVel.set(v.x, v.y, v.z);
      if (p.thrust > 0) {
        p.thrust -= dt;
        _v.set(v.x, v.y, v.z).normalize().multiplyScalar(22 * dt * p.body.mass());
        p.body.applyImpulse({ x: _v.x, y: _v.y, z: _v.z }, true);
      }
    }
  }

  // ------------------------------------------------------------------ collisions
  onCollision(p: Projectile, other: RAPIER.Collider, o: Owner | undefined) {
    if (p.dead) return;
    const speed = p.prevVel.length();
    const pos = p.pos(_v).clone();
    const def = defs()[p.kind];
    p.bounces++;
    if (speed > 2.5) ctx.audio.impact(def.sound, pos, clamp(speed / 14, 0.2, 1));
    if (p.kind === 'pave' && speed > 6) ctx.particles.dust(pos, 3);

    // explosive projectiles
    if ((p.kind === 'fusee' && p.age > 0.08) || (p.kind === 'mortier' && p.age > 0.35 && speed > 5 && o?.kind !== 'static')) {
      this.explode(pos, { radius: 5, damage: 42, knock: 5, fire: true, flash: 1, sound: 1, by: p.by, kind: p.kind });
      this.kill(p);
      return;
    }
    if (p.spent || speed < 4) { this.afterHit(p, pos, speed, other, o); return; }

    const target = o?.kind === 'npc' ? (o.ref as NPC) : o?.kind === 'player' ? ctx.player : null;
    if (target) {
      if (target === p.owner) return;
      if (o?.kind === 'npc' && (target as NPC).camp === p.camp && !p.by) { p.spent = true; return; } // NPCs spare their own side
      target.takeHit({ amount: def.dmg * Math.pow(speed / 15, 1.2), zone: target.zoneAt(pos), type: def.type, dir: p.prevVel.clone().normalize(), point: pos,
        force: (def.density > 2000 ? 2.5 : 0.8) * speed / 15, by: p.by, fromCamp: p.camp });
      p.spent = true;
    } else if (o?.kind === 'window') {
      const energy = defs()[p.kind].density * speed;
      if (p.kind !== 'canette' && energy > 2500 || chance(0.15)) ctx.destruction.breakWindow(o.ref as number, p.prevVel, p.by);
      p.spent = p.kind !== 'pave';
    } else if (o?.kind === 'vehicle') {
      ctx.truck.onHit(pos, speed);
      p.spent = true;
    } else {
      p.spent = speed > 8 ? false : true;
    }
    this.afterHit(p, pos, speed, other, o);
  }

  private afterHit(p: Projectile, pos: THREE.Vector3, speed: number, _other: RAPIER.Collider, _o: Owner | undefined) {
    if (p.kind === 'bouteille' && speed > 5) {
      ctx.particles.glass(pos, p.prevVel.clone().normalize(), 26);
      ctx.audio.glass(pos, 0.5);
      if (pos.y < 0.4) ctx.decals.add('glass', pos.x, pos.z, 0.5, groundY(pos.x, pos.z));
      this.kill(p);
    }
  }

  // ------------------------------------------------------------------ LBD
  fireLBD(from: THREE.Vector3, dir: THREE.Vector3, owner: NPC | null, camp: Camp) {
    this.bullets.push({ pos: from.clone(), vel: dir.clone().normalize().multiplyScalar(95), owner, camp, life: 1.2 });
    if (!owner) return; // client tracer
    ctx.net.emit(['lbd', from.x, from.y, from.z, dir.x, dir.y, dir.z]);
    const human = !!asHuman(owner);
    ctx.audio.shot(from, owner.hidden ? 1.2 : 0.9);
    ctx.particles.flash(from.clone().addScaledVector(dir, 0.5), 0.5, 0xffe0a0);
    ctx.particles.emit({ pos: from.clone().addScaledVector(dir, 0.6), vel: dir.clone().multiplyScalar(2), spread: 0.6, count: 4, life: [0.4, 0.9], size: [0.1, 0.5], color: 0xbbbbbb, alpha: [0.4, 0], drag: 2 });
    ctx.lights.request({ pos: from.clone(), color: new THREE.Color(1, 0.8, 0.5), intensity: 20, distance: 8, priority: 5 });
    ctx.tension.add(human ? 1.5 : 0.8, 'tir LBD');
  }

  private updateBullets(dt: number) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      b.vel.y -= 9.81 * dt * 0.6;
      const step = b.vel.length() * dt;
      _v.copy(b.vel).normalize();
      const filter = groups(G.PROJ, G.STATIC | G.NPC | G.VEHICLE | G.DEBRIS | G.RAGDOLL | (b.owner?.hidden ? 0 : G.PLAYER));
      const hit = ctx.physics.castRay(b.pos.x, b.pos.y, b.pos.z, _v.x, _v.y, _v.z, step, filter, b.owner?.collider);
      if (hit) {
        if (b.owner) this.bulletHit(b, b.pos.clone().addScaledVector(_v, hit.dist), _v.clone(), ctx.physics.owner(hit.collider));
        this.bullets.splice(i, 1);
        continue;
      }
      b.pos.addScaledVector(_v, step);
      if (b.life <= 0 || b.pos.y < -1) this.bullets.splice(i, 1);
    }
    this.bulletMesh.count = Math.min(64, this.bullets.length);
    const m = new THREE.Matrix4();
    for (let i = 0; i < this.bulletMesh.count; i++) { m.makeTranslation(this.bullets[i].pos); this.bulletMesh.setMatrixAt(i, m); }
    this.bulletMesh.instanceMatrix.needsUpdate = true;
  }

  private bulletHit(b: Bullet, point: THREE.Vector3, dir: THREE.Vector3, o: Owner | undefined) {
    const by = asHuman(b.owner);
    const target = o?.kind === 'npc' ? (o.ref as NPC) : o?.kind === 'player' ? ctx.player : null;
    if (target) {
      if (target === b.owner) return;
      const zone = target.zoneAt(point);
      const base = zone === 'head' ? 48 : zone === 'torso' ? 28 : 20;
      target.takeHit({ amount: base * rr(0.85, 1.15), zone, type: 'lbd', dir, point, force: zone === 'torso' ? 4 : 3, by, fromCamp: b.camp });
      ctx.audio.impact('body', point, 1);
    } else if (o?.kind === 'ragdoll') {
      const n = o.ref as NPC;
      n.ragdoll?.pushAll(dir.clone().multiplyScalar(1.5));
      ctx.particles.bloodSpray(point, dir, 0.5);
    } else if (o?.kind === 'window') {
      if (chance(0.6)) ctx.destruction.breakWindow(o.ref as number, dir, by);
    } else {
      ctx.audio.impact('stone', point, 0.5);
      ctx.particles.dust(point, 3);
      ctx.particles.sparks(point, 3, 2);
    }
  }

  // ------------------------------------------------------------------ explosions
  explode(pos: THREE.Vector3, o: BlastOpts) {
    const firework = o.kind === 'mortier' || o.kind === 'fusee';
    ctx.particles.flash(pos, 6 * o.flash, firework ? 0xfff0d0 : 0xffffff);
    ctx.particles.sparks(pos, firework ? 70 : 30, firework ? 11 : 7);
    if (firework) {
      for (let i = 0; i < 3; i++) {
        const col = pick(FW_COLORS);
        ctx.particles.emit({ pos, spread: 9, count: 40, life: [0.4, 1.2], size: [0.18, 0.05], color: col, color2: col, alpha: [1, 0], gravity: 4, drag: 1.4, additive: true });
      }
      ctx.audio.firework(pos);
    } else ctx.audio.explosion(pos, o.sound);
    ctx.particles.smoke(pos, 6, 0.45, 2.2);
    ctx.lights.flash(pos, firework ? new THREE.Color(1, 0.7, 0.5) : new THREE.Color(1, 0.95, 0.85), 150 * o.flash, 0.18);
    if (pos.y < 1.5) ctx.decals.add('scorch', pos.x, pos.z, o.radius * 0.5, groundY(pos.x, pos.z));

    // people (human players feel their own blast: see Player.onBlast)
    ctx.player.onBlast(pos, o);
    ctx.net.emit(['blast', pos.x, pos.y, pos.z, o.radius, o.damage, o.knock, o.kind]);
    for (const n of ctx.crowd.all) {
      if (n.state === 'gone' || n.data.human) continue;
      n.downPelvis(_v2);
      const d = _v2.distanceTo(pos);
      if (d > o.radius) continue;
      const f = 1 - d / o.radius;
      const dir = _v3.subVectors(_v2, pos).setY(0.2).normalize().clone();
      if (n.ragdoll) { n.ragdoll.pushAll(dir.clone().multiplyScalar(o.knock * f)); continue; }
      if (!n.standing) continue;
      const zone = d < 1.2 ? pick(['legL', 'legR', 'torso'] as const) : pick(['torso', 'legL', 'legR', 'armL', 'armR', 'head'] as const);
      n.takeHit({ amount: o.damage * f, zone, type: 'blast', dir, point: _v2.clone(), force: o.knock * f * (chance(0.5) ? 1.4 : 0.6), by: o.by, fromCamp: o.by?.camp ?? 'none' });
      if (n.standing && n.camp === 'protest') n.coverHead = 1.5;
    }
    // world
    ctx.destruction.push(pos, o.radius * 1.2, o.knock * 1.5);
    for (const w of ctx.destruction.windows) if (!w.broken && w.pane.pos.distanceTo(pos) < o.radius * 0.7) ctx.destruction.breakWindow(w.index, _v.subVectors(w.pane.pos, pos), o.by);
    if (o.fire) ctx.destruction.igniteAround(pos, o.radius * 0.8, o.by);
    ctx.crowd.panic(pos, o.radius * 3.5, 1);
    ctx.tension.add(firework ? 2.5 : o.kind === 'sting' ? 2 : 3, 'explosion');
    if (firework && Math.abs(pos.z - ctx.crowd.police.lineZ) < 7) ctx.crowd.shake(6);
  }

  // ------------------------------------------------------------------ update
  update(dt: number) {
    for (const p of this.list) if (!p.dead && p.body) this.simulate(p, dt);
    // smoke, sparks and trails are drawn on every machine, never relayed by the host
    ctx.net.quiet(() => { for (const p of this.list) if (!p.dead) this.trail(p, dt); });
    this.list = this.list.filter((p) => !p.dead);
    this.updateBullets(dt);
  }

  private simulate(p: Projectile, dt: number) {
    const body = p.body!;
    p.age += dt;
    const t = body.translation(), r = body.rotation();
    p.mesh.position.set(t.x, t.y, t.z);
    p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    if (t.y < -3) { this.kill(p); return; }
    const pos = _v.set(t.x, t.y, t.z);
    if (p.fuse !== Infinity && p.age >= p.fuse) {
      if (p.kind === 'sting') this.explode(pos.clone(), { radius: 6, damage: 14, knock: 4.5, fire: false, flash: 1.2, sound: 1.2, by: p.by, kind: 'sting' });
      else this.explode(pos.clone(), { radius: 5, damage: 38, knock: 4.5, fire: true, flash: 1, sound: 1, by: p.by, kind: p.kind as 'mortier' | 'fusee' });
      this.kill(p);
      return;
    }
    if (p.emit > 0) {
      p.emit -= dt;
      if (p.kind === 'gas') {
        if (!p.gas) p.gas = ctx.gas.create(pos.clone(), p);
        if (p.emit <= 0 && p.gas) p.gas.source = null;
      }
    }
    const v = body.linvel();
    if (Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z) < 0.15) p.resting += dt; else p.resting = 0;
    if (p.resting > 0.3) p.spent = true;
    if (p.age > 150 && p.emit <= 0) this.kill(p); // old debris
  }

  private trail(p: Projectile, dt: number) {
    const pos = p.pos(_v);
    if (p.kind === 'fusee' && p.thrust > 0) {
      ctx.particles.emit({ pos, spread: 0.6, count: 3, life: [0.2, 0.5], size: [0.15, 0.03], color: 0xffd080, color2: 0xff4000, alpha: [1, 0], additive: true, gravity: 2 });
      ctx.particles.emit({ pos, spread: 0.2, count: 1, life: [0.8, 1.6], size: [0.15, 0.6], color: 0x999999, alpha: [0.3, 0], drag: 1 });
    }
    if (p.kind === 'mortier' && p.age < p.fuse) {
      ctx.particles.emit({ pos, spread: 0.4, count: 1, life: [0.15, 0.35], size: [0.12, 0.02], color: 0xffb060, alpha: [1, 0], additive: true });
    }
    if (p.emit <= 0) return;
    if (p.kind === 'gas') {
      if (Math.random() < dt * 30) ctx.particles.emit({ pos, vel: _v2.set(rr(-1, 1), 1.5, rr(-1, 1)).clone(), spread: 0.6, count: 1, life: [1, 2.2], size: [0.2, 1.6], color: 0xf2f4f0, alpha: [0.7, 0], drag: 1.2 });
    } else if (p.kind === 'fumigene') {
      if (Math.random() < dt * 14) ctx.particles.colorSmoke(pos, pick([0xd8261a, 0xd8261a, 0xff6a10]));
      ctx.particles.emit({ pos, spread: 0.3, count: 1, life: [0.1, 0.25], size: [0.35, 0.1], color: 0xff3010, alpha: [1, 0], additive: true });
      if (Math.random() < dt * 4) ctx.lights.request({ pos: pos.clone().setY(pos.y + 0.4), color: new THREE.Color(1, 0.15, 0.08), intensity: 12, distance: 10, priority: 1.5 });
    }
  }

  /** NPC throw helper. */
  npcThrow(n: NPC, kind: ThrowKind, target: THREE.Vector3, speed = 16, error = 1.2) {
    const from = n.pos.clone().setY(n.pos.y + 1.7).addScaledVector(n.forward, 0.45);
    const aim = target.clone().add(_v.set(rr(-error, error), rr(-0.3, 0.6), rr(-error, error)));
    const g = 9.81;
    const dx = aim.x - from.x, dz = aim.z - from.z;
    const horiz = Math.hypot(dx, dz) || 0.01;
    const s = Math.max(speed, Math.sqrt(horiz * g) * 0.75);
    const tt = horiz / s;
    const vy = (aim.y - from.y + 0.5 * g * tt * tt) / tt;
    const vel = new THREE.Vector3((dx / horiz) * s, vy, (dz / horiz) * s);
    n.throwT = 0.55;
    ctx.audio.whoosh(from, 0.2);
    setTimeout(() => {
      if (n.standing) this.spawn(kind, from, vel, n, n.camp === 'neutral' ? 'none' : n.camp);
    }, 300);
  }
}

