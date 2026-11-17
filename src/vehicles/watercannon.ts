import * as THREE from 'three';
import { isTouch } from '../core/device';
import { ctx } from '../core/context';
import { RAPIER, G, groups } from '../core/physics';
import { clamp, rr, angleDiff, lerp, chance } from '../core/util';
import { signTexture } from '../core/textures';
import * as L from '../world/layout';
import { P } from '../npc/body';
import type { Avatar } from '../net/avatar';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const GRAV = new THREE.Vector3(0, -9.81, 0);
export const TANK_SECONDS = 12, REFILL_SECONDS = 60;

/**
 * Police water cannon truck: one CRS player at a time can drive it (E), otherwise the AI does.
 * The host simulates it; a client driving it sends its controls and aims the turret locally.
 */
export class WaterCannon {
  group = new THREE.Group();
  turret = new THREE.Group();
  nozzle = new THREE.Object3D();
  gyros: THREE.Mesh[] = [];
  pos = new THREE.Vector3(3, 0, L.TRUCK_Z);
  yaw = 0; // facing +z (towards the protesters)
  speed = 0;
  turretYaw = 0;
  turretPitch = 0.12;
  tank = 100; // % ; a full tank lasts TANK_SECONDS of spraying
  refilling = false; // empty: no water until the tank is full again (REFILL_SECONDS)
  spraying = false;
  driver: Avatar | null = null; // host: the human driving
  driverId = -1; // the driver's avatar id, known on every machine
  remote = { throttle: 0, steer: 0, spray: false }; // host: controls sent by a client driver
  active = true;
  aiEngage = false;
  aiBurst = 0;
  aiCd = 4;
  aiTarget = new THREE.Vector3();
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  kcc: RAPIER.KinematicCharacterController;
  private hitFrame = new Set<number>();
  private puddleT = 0;
  readonly halfW = 1.3; readonly halfL = 4.6;

  constructor() {
    this.buildModel();
    ctx.scene.add(this.group);
    const w = ctx.physics.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x, 1.7, this.pos.z));
    this.collider = w.createCollider(RAPIER.ColliderDesc.cuboid(this.halfW, 1.6, this.halfL).setCollisionGroups(groups(G.VEHICLE, G.STATIC | G.PLAYER | G.PROJ | G.DEBRIS | G.RAGDOLL)), this.body);
    ctx.physics.setOwner(this.collider, { kind: 'vehicle', ref: this });
    this.kcc = w.createCharacterController(0.05);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(15000);
    this.sync();
  }

  private buildModel() {
    const white = new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.45, metalness: 0.3 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x1b2f6b, roughness: 0.5, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.7, metalness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0b1015, roughness: 0.05, metalness: 0.9 });
    const tire = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
    const g = this.group;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    add(new THREE.BoxGeometry(2.5, 2.4, 6.2), white, 0, 1.9, -1.2); // tank body
    add(new THREE.BoxGeometry(2.52, 0.35, 6.22), blue, 0, 1.25, -1.2);
    add(new THREE.BoxGeometry(2.5, 2.2, 2.4), white, 0, 1.75, 3.2); // cab
    add(new THREE.BoxGeometry(2.3, 0.9, 0.05), glass, 0, 2.3, 4.42);
    add(new THREE.BoxGeometry(2.4, 0.95, 0.06), dark, 0, 2.3, 4.47).scale.set(1, 1, 1);
    add(new THREE.BoxGeometry(2.6, 0.5, 9.2), dark, 0, 0.75, 0); // chassis
    add(new THREE.BoxGeometry(2.4, 0.25, 0.3), dark, 0, 0.7, 4.6); // bumper / blade
    for (const z of [-3.4, -1.6, 3.0]) for (const x of [-1.15, 1.15]) {
      const w = add(new THREE.CylinderGeometry(0.55, 0.55, 0.45, 18).rotateZ(Math.PI / 2), tire, x, 0.55, z); void w;
    }
    const plate = new THREE.MeshStandardMaterial({ map: signTexture('POLICE', '#1b2f6b', '#ffffff', 256, 64) });
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.6), plate); p.position.set(sx * 1.27, 2.2, -1.2); p.rotation.y = sx * Math.PI / 2; g.add(p); }
    // turret
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.4, 16), dark); base.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.6), dark); head.position.y = 0.35;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.4, 12).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a9298, metalness: 0.9, roughness: 0.3 }));
    barrel.position.set(0, 0.4, 0.8);
    this.turret.add(base, head, barrel);
    this.nozzle.position.set(0, 0.4, 1.55);
    this.turret.add(this.nozzle);
    this.turret.position.set(0, 3.3, 2.1);
    g.add(this.turret);
    // gyrophares
    for (const x of [-0.8, 0.8]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.3), new THREE.MeshStandardMaterial({ color: 0x2244ff, emissive: 0x2a5bff, emissiveIntensity: 0 }));
      m.position.set(x, 2.95, 4.1); g.add(m); this.gyros.push(m);
    }
  }

  private sync() {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.turret.rotation.set(0, this.turretYaw, 0);
    this.turret.children[2].rotation.x = -this.turretPitch;
    this.nozzle.position.set(0, 0.4 + Math.sin(this.turretPitch) * 1.55, Math.cos(this.turretPitch) * 1.55);
  }

  canEnter(feet: THREE.Vector3) {
    return ctx.camp === 'police' && !ctx.player.inVehicle && this.driverId < 0 && this.localDist(feet) < 2.2;
  }

  /** Distance from a point to the truck's box (0 inside). */
  localDist(p: THREE.Vector3) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const c = Math.cos(-this.yaw), s = Math.sin(-this.yaw);
    const lx = dx * c + dz * s, lz = -dx * s + dz * c;
    const ox = Math.max(0, Math.abs(lx) - this.halfW), oz = Math.max(0, Math.abs(lz) - this.halfL);
    return Math.hypot(ox, oz);
  }

  pushOut(p: THREE.Vector3) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    // local frame: x = right-ish, z = forward
    let lx = dx * c - dz * s, lz = dx * s + dz * c;
    const px = this.halfW + 0.35 - Math.abs(lx), pz = this.halfL + 0.35 - Math.abs(lz);
    if (px > 0 && pz > 0) {
      if (px < pz) lx += Math.sign(lx || 1) * px; else lz += Math.sign(lz || 1) * pz;
      p.x = this.pos.x + lx * c + lz * s;
      p.z = this.pos.z - lx * s + lz * c;
    }
  }

  /** Host: who drives. */
  enter(by: Avatar) { if (!this.driver) { this.driver = by; this.driverId = by.id; } }
  exit(by: Avatar) { if (this.driver === by) { this.driver = null; this.driverId = -1; } }

  /** Local player gets in / out (the host is told through an action). */
  board() {
    ctx.player.inVehicle = true;
    this.turretYaw = 0; this.turretPitch = 0.12;
    ctx.hud.feed(isTouch ? 'Canon à eau : joystick conduire, glisser viser, FEU arroser, [E] descendre'
      : 'Canon à eau : ZQSD conduire, souris viser, clic gauche arroser, E descendre', '#9fb7ff');
  }

  leave() {
    const p = ctx.player;
    p.inVehicle = false;
    const side = _v.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(-(this.halfW + 1));
    p.pos.set(this.pos.x + side.x, 1.2, this.pos.z + side.z);
    p.body.setNextKinematicTranslation({ x: p.pos.x, y: p.pos.y, z: p.pos.z });
    p.yaw = this.yaw + this.turretYaw + Math.PI;
    p.pitch = 0;
  }

  onHit(pos: THREE.Vector3, speed: number) {
    ctx.audio.impact('metal', pos, clamp(speed / 12, 0.3, 1));
    if (speed > 8) ctx.particles.sparks(pos, 4, 3);
  }

  update(dt: number) {
    const inp = ctx.input;
    const local = ctx.player.inVehicle;
    let throttle = 0, steer = 0;
    if (local) {
      const m = inp.move();
      throttle = m.z; steer = -m.x;
      const sens = 0.0018 * ctx.settings.sensitivity;
      this.turretYaw = clamp(this.turretYaw - inp.mouseDX * sens, -2.4, 2.4);
      this.turretPitch = clamp(this.turretPitch - inp.mouseDY * sens * (ctx.settings.invertY ? -1 : 1), -0.25, 0.6);
      this.spraying = inp.buttons[0] && this.canSpray;
      if (inp.buttons[0] && ctx.tension.phase === 0) { this.spraying = false; ctx.hud.prompt('Pas d\'usage du canon à eau pendant une manifestation pacifique.', 2); }
      else if (inp.buttons[0] && this.refilling) ctx.hud.prompt(`Réservoir vide : remplissage en cours (${Math.ceil((100 - this.tank) / 100 * REFILL_SECONDS)} s)`, 0.5);
      this.remote = { throttle, steer, spray: this.spraying };
    }
    if (ctx.net.isClient) {
      // position comes from the host; the driver keeps his own turret aim
      this.sync();
      if (this.spraying) this.spray(dt, false);
      this.lights();
      if (local) this.camera();
      return;
    }
    if (!local) this.spraying = false;
    if (!local && this.driver) ({ throttle, steer, spray: this.spraying } = this.remote);
    else if (!local && this.aiEngage) {
      // AI: drive just behind the police line and spray the front of the crowd in bursts
      const targetZ = ctx.crowd.police.lineZ - 7;
      const dz = targetZ - this.pos.z;
      throttle = clamp(dz / 4, -0.5, 0.5);
      steer = clamp(angleDiff(this.yaw, 0) * 2 + (2 - this.pos.x) * -0.05, -1, 1);
      this.aiCd -= dt;
      if (this.aiBurst > 0) {
        this.aiBurst -= dt;
        this.spraying = this.canSpray;
        // aim at the target
        _v.subVectors(this.aiTarget, this.pos);
        const wantYaw = Math.atan2(_v.x, _v.z) - this.yaw;
        this.turretYaw += angleDiff(this.turretYaw, wantYaw) * Math.min(1, dt * 3);
        const d = Math.hypot(_v.x, _v.z);
        this.turretPitch = lerp(this.turretPitch, clamp(0.02 + d * 0.006, 0, 0.45), dt * 2);
      } else if (this.aiCd <= 0 && ctx.tension.phase === 2) {
        const t = ctx.crowd.nearest(this.pos, 34, (n) => n.camp === 'protest' && n.standing && n.pos.z > ctx.crowd.police.lineZ + 2);
        const h = ctx.crowd.closestHuman('protest', this.pos, 30, 1);
        const pl = h && h.feet.z > ctx.crowd.police.lineZ + 2 ? h : null;
        if (pl || t) {
          this.aiTarget.copy(pl ? pl.feet : t!.pos);
          this.aiBurst = rr(3, 6); this.aiCd = rr(4, 9);
        } else this.aiCd = 2;
      }
    }
    // driving
    const maxV = 6;
    this.speed += (throttle * maxV - this.speed) * Math.min(1, dt * (throttle ? 0.6 : 1.5));
    if (Math.abs(this.speed) > 0.1) this.yaw += steer * dt * 0.35 * clamp(this.speed / 3, -1, 1);
    const fwd = _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const move = fwd.multiplyScalar(this.speed * dt);
    this.body.setRotation({ x: 0, y: Math.sin(this.yaw / 2), z: 0, w: Math.cos(this.yaw / 2) }, true);
    this.kcc.computeColliderMovement(this.collider, { x: move.x, y: 0, z: move.z }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(G.VEHICLE, G.STATIC));
    const m = this.kcc.computedMovement();
    this.pos.x += m.x; this.pos.z += m.z;
    L.clampWalkable(this.pos);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: 1.7, z: this.pos.z });
    // run over / bump into people (human players are shoved)
    if (Math.abs(this.speed) > 1.5) {
      const fwd = _v2.set(Math.sin(this.yaw), 0.5, Math.cos(this.yaw));
      for (const n of ctx.crowd.all) {
        if (!n.standing || n.role === 'crs' || this.localDist(n.pos) > 0.4) continue;
        if (n.data.human) n.takeHit({ amount: 0, zone: 'torso', type: 'water', dir: fwd.clone(), point: n.pos.clone(), force: 6, fromCamp: 'police' });
        else n.knockDown(fwd.clone().multiplyScalar(Math.abs(this.speed) * 1.2), P.torso);
      }
    }
    this.sync();
    if (this.spraying) this.spray(dt, true);
    if (this.refilling) {
      this.tank = Math.min(100, this.tank + dt * 100 / REFILL_SECONDS);
      if (this.tank >= 100) { this.refilling = false; if (local) ctx.hud.feed('Canon à eau : réservoir plein', '#9fb7ff'); }
    }
    this.lights();
    if (local) this.camera();
  }

  get canSpray() { return !this.refilling && this.tank > 0; }

  private lights() {
    const on = ctx.tension.phase >= 1;
    this.gyros.forEach((g, i) => { (g.material as THREE.MeshStandardMaterial).emissiveIntensity = on && Math.sin(ctx.time * 10 + i * Math.PI) > 0.3 ? 14 : 0; });
    if (on && Math.sin(ctx.time * 10) > 0.6) ctx.lights.request({ pos: this.pos.clone().setY(3.3), color: new THREE.Color(0.15, 0.3, 1), intensity: 14, distance: 18, priority: 1.2 });
  }

  /** First-person view from the turret. */
  private camera() {
    const cam = ctx.camera;
    this.turret.updateWorldMatrix(true, false);
    cam.position.copy(this.turret.localToWorld(_v.set(0, 1.0, -1.3)));
    cam.quaternion.setFromEuler(new THREE.Euler(this.turretPitch * 0.9 - 0.08, this.yaw + this.turretYaw + Math.PI, 0, 'YXZ'));
    if (Math.abs(cam.fov - ctx.settings.fov) > 0.1) { cam.fov = ctx.settings.fov; cam.updateProjectionMatrix(); }
  }

  /** The jet: drawn everywhere, its effects (`sim`) computed by the host only. */
  private spray(dt: number, sim: boolean) {
    if (sim) {
      this.tank = Math.max(0, this.tank - dt * 100 / TANK_SECONDS);
      if (this.tank <= 0) { this.refilling = true; this.spraying = false; this.driver?.feed(`Réservoir vide : ${REFILL_SECONDS} s de remplissage`, '#ffb070'); }
    }
    if (ctx.player.inVehicle) ctx.stats.waterSeconds += dt;
    const o = this.nozzle.getWorldPosition(new THREE.Vector3());
    this.nozzle.getWorldQuaternion(_q);
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(_q).normalize();
    const v0 = dir.clone().multiplyScalar(27);
    const n = Math.round(14 * Math.max(0.5, ctx.q.particleScale));
    ctx.net.quiet(() => { for (let i = 0; i < n; i++) ctx.particles.water(o.clone().addScaledVector(dir, Math.random() * 0.8), v0.clone().multiplyScalar(0.9 + Math.random() * 0.15)); });
    // trace the jet and push whatever it meets
    this.hitFrame.clear();
    const p = new THREE.Vector3();
    let last = o.clone();
    for (let t = 0.04; t < 2.2; t += 0.05) {
      p.copy(o).addScaledVector(v0, t).addScaledVector(GRAV, 0.5 * t * t);
      const travelled = t * 27;
      const strength = clamp(1 - travelled / 42, 0.15, 1);
      if (p.y <= 0.05) {
        p.y = 0.05;
        ctx.net.quiet(() => {
          ctx.particles.splash(p);
          this.puddleT -= dt;
          if (this.puddleT <= 0) { ctx.decals.add('water', p.x + rr(-1, 1), p.z + rr(-1, 1), rr(1.5, 3)); this.puddleT = 0.3; }
        });
        if (sim) {
          ctx.destruction.push(p, 2, 4 * strength * dt * 10);
          ctx.destruction.extinguish(p, 1.5, dt * 0.6);
        }
        this.hitPeople(p, _v2.subVectors(p, last).setY(0).normalize(), strength * 0.6, dt, sim);
        break;
      }
      // facades / vehicles stop the jet
      if (!L.isWalkable(p.x, p.z)) break;
      if (sim && Math.floor(t * 20) % 2 === 0) {
        const d = _v2.subVectors(p, last).normalize();
        this.hitPeople(p, d, strength, dt, true);
        ctx.destruction.extinguish(p, 1.2, dt * 0.6);
      }
      last.copy(p);
    }
    ctx.tension.add(dt * 0.4, 'canon à eau');
  }

  private hitPeople(p: THREE.Vector3, dir: THREE.Vector3, strength: number, dt: number, sim: boolean) {
    // ragdolls get blown along the street (local physics on every machine)
    for (const n of ctx.crowd.all) {
      if (!n.ragdoll) continue;
      n.ragdoll.pelvisPos(_v);
      if (_v.distanceTo(p) < 1.8) n.ragdoll.pushAll(dir.clone().multiplyScalar(dt * 18 * strength).setY(dt * 4));
    }
    if (!sim) return;
    ctx.crowd.neighbors(p.x, p.z, 1.3, (n) => {
      if (this.hitFrame.has(n.id) || n.role === 'crs') return;
      if (Math.abs(p.y - 1) > 1.6) return;
      this.hitFrame.add(n.id);
      n.data.wet = (n.data.wet ?? 0) + dt * strength * 3;
      if (n.data.wet > 0.25) {
        n.data.wet = 0;
        n.takeHit({ amount: 2 * strength, zone: 'torso', type: 'water', dir: dir.clone(), point: n.pos.clone().setY(1.2), force: 2 + 5 * strength, by: this.driver, fromCamp: 'police' });
        if (chance(0.3) && !n.data.human) ctx.audio.scream(n.pos.clone().setY(1.5), 0.6);
      }
    });
    ctx.crowd.panic(p, 6, 0.4 * dt * 10);
  }
}
