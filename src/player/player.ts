import * as THREE from 'three';
import { ctx, type HitInfo } from '../core/context';
import { RAPIER, G, groups } from '../core/physics';
import { clamp, chance, lerp, pick, rr } from '../core/util';
import { Wounds, type DamageInfo, type Zone, ZONE_FR, ZONE_SHORT } from '../damage/damage';
import { ViewModel } from './viewmodel';
import type { NPC } from '../npc/npc';
import type { BlastOpts } from '../weapons/projectiles';
import { groundY } from '../world/city';
import { ProtestKit } from '../weapons/protestKit';
import { PoliceKit } from '../weapons/policeKit';
import { loadout, gearOf, lookSpec, type Loadout } from '../meta/shop';
import { t } from '../core/i18n';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _eye = new THREE.Vector3();
const SHOULDER = new THREE.Vector3(0.45, 0.35, 2.8); // third-person camera, in view space
const HALF_H = 0.5, RADIUS = 0.32;

export class Player {
  pos = new THREE.Vector3(); // capsule centre
  vel = new THREE.Vector3();
  push = new THREE.Vector3();
  yaw = Math.PI;
  pitch = 0;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  kcc: RAPIER.KinematicCharacterController;
  grounded = false;
  crouch = false;
  hp: number;
  maxHp: number;
  wounds = new Wounds();
  armor: Partial<Record<Zone, number>> = {};
  alive = true;
  arrested = false;
  stun = 0;
  gas = 0;
  tears = 0;
  serumT = 0;
  maskOn = false;
  hasGasMask = false;
  flash = 0;
  damageFlash = 0;
  wet = 0;
  aggro = 0;
  friendlyFire = 0;
  private touched = new Set<number>(); // ids of the people we hit
  callMedic = false;
  medic: NPC | null = null;
  healT = 0;
  vm: ViewModel;
  kit: ProtestKit | PoliceKit;
  inVehicle = false;
  stepT = 0;
  downT = 0;
  shake = 0;
  roll = 0;
  eyeHeight = 1.62;
  private camEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  lastMouse = new THREE.Vector2();

  /** purchased upgrades and the start bonus of this match (meta/shop) */
  perks: Loadout;

  constructor(spawn: THREE.Vector3) {
    const police = ctx.camp === 'police';
    this.perks = loadout();
    this.maxHp = this.hp = Math.round(120 * this.perks.hp);
    if (police) { this.armor = { head: 0.55, torso: 0.4, armL: 0.25, armR: 0.25, legL: 0.2, legR: 0.2 }; this.hasGasMask = true; }
    this.pos.copy(spawn).setY(spawn.y + HALF_H + RADIUS + 0.05);
    const w = ctx.physics.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x, this.pos.y, this.pos.z));
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(HALF_H, RADIUS).setCollisionGroups(groups(G.PLAYER, G.STATIC | G.NPC | G.PROJ | G.VEHICLE | G.DEBRIS)), this.body);
    ctx.physics.setOwner(this.collider, { kind: 'player' });
    this.kcc = w.createCharacterController(0.02);
    this.kcc.enableAutostep(0.4, 0.15, false);
    this.kcc.enableSnapToGround(0.35);
    this.kcc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(police ? 110 : 75);
    this.vm = new ViewModel(ctx.camera, police, gearOf(ctx.camp), lookSpec(ctx.camp).top);
    this.kit = police ? new PoliceKit(this) : new ProtestKit(this);
    this.yaw = police ? Math.PI : 0;
  }

  get feet() { return _v2.copy(this.pos).setY(this.pos.y - HALF_H - RADIUS); }
  /** The head (the camera sits there in first person, behind the shoulder in third person). */
  get eye() { return _eye.set(this.pos.x, this.pos.y - HALF_H - RADIUS + this.eyeHeight, this.pos.z); }
  forward(out = new THREE.Vector3()) { return ctx.camera.getWorldDirection(out); }

  // ------------------------------------------------------------------ Human
  readonly isHuman = true;
  get camp() { return ctx.camp; }

  /** Every hit on the player goes through here, local or sent by the host. */
  takeHit(d: DamageInfo) {
    if (!this.alive) return;
    if (d.type === 'water') return this.water(d.dir, d.force);
    if (d.type !== 'blast' && d.type !== 'trample' && this.blocks(d.dir, d.zone)) {
      ctx.audio.shieldHit(d.point); ctx.particles.sparks(d.point, 4, 2); this.shake = Math.min(1, this.shake + 0.15);
      if (this.kit instanceof ProtestKit) this.kit.panneauHp -= d.amount;
      return;
    }
    // the deeper a protester is behind the police line, the harder the police hit him; upgrades soften every hit
    const k = this.perks.damage * (ctx.camp === 'protest' ? 1 + 1.5 * ctx.crowd.depth(this.feet.z) : 1);
    if (k !== 1) d = { ...d, amount: d.amount * k };
    const amt = this.wounds.apply(d, this.armor);
    this.kit.onDamaged(d);
    this.hp -= amt;
    this.damageFlash = Math.min(1, this.damageFlash + amt / 25);
    this.shake = Math.min(1, this.shake + amt / 30);
    ctx.stats.playerWounds++;
    ctx.audio.hurt();
    if (d.type !== 'gas' && amt > 4) {
      ctx.particles.bloodSpray(d.point, d.dir, clamp(amt / 30, 0.3, 1));
      let extra = '';
      if (this.wounds.eye && d.zone === 'head' && d.type === 'lbd') extra = t(' · Œil touché !');
      else if (this.wounds.jaw && d.zone === 'head' && d.type === 'lbd') extra = t(' · Mâchoire fracturée');
      else if (d.zone.startsWith('leg') && this.wounds.limp > 0.5) extra = t(' · vous boitez');
      ctx.hud.feed(t`Blessé : ${ZONE_FR[d.zone]} (−${Math.round(amt)} PV)` + extra, '#ff6a5a');
    }
    // after-effects by weapon
    const flat = _v.copy(d.dir).setY(0).normalize();
    if (d.type === 'lbd') {
      this.push.addScaledVector(flat, 2.5);
      if (d.zone === 'head') { ctx.audio.tinnitus(5); this.stun = Math.max(this.stun, 1.6); }
      else if (d.zone === 'torso') this.stun = Math.max(this.stun, 0.6);
    } else if (d.type === 'baton') {
      ctx.audio.baton(d.point);
      this.push.addScaledVector(flat, 3);
      this.stun = Math.max(this.stun, d.zone === 'head' ? 1.8 : 0.7);
    } else if (d.type === 'blast') {
      this.push.addScaledVector(flat, d.force * 1.2);
      this.stun = Math.max(this.stun, d.force / 4);
    } else if (d.zone === 'head' && amt > 9) {
      this.stun = Math.max(this.stun, amt / 25);
      if (this.wounds.concussion > 0.6) { this.stun = Math.max(this.stun, 1); ctx.audio.tinnitus(3); }
    }
    if (this.hp <= 0) { this.goDown(); return; }
    // a protester clubbed while weak gets arrested
    if (d.type === 'baton' && ctx.camp === 'protest' && (this.hp < this.maxHp * 0.25 || this.stun > 2) && chance(0.3)) this.getArrested();
  }

  /** Hit zone from a world point. */
  zoneAt(p: THREE.Vector3): Zone {
    const f = this.feet;
    const h = (p.y - f.y) / (this.crouch ? 0.65 : 1);
    const lateral = (p.x - f.x) * Math.cos(this.yaw + Math.PI) - (p.z - f.z) * Math.sin(this.yaw + Math.PI);
    if (h > 1.5) return 'head';
    if (h > 0.98) return Math.abs(lateral) > 0.2 ? (lateral > 0 ? 'armL' : 'armR') : 'torso';
    return lateral > 0 ? 'legL' : 'legR';
  }

  /** Frontal block by the CRS shield or the makeshift panel. */
  private blocks(dir: THREE.Vector3, zone: Zone) {
    const fwd = this.forward(_v).setY(0).normalize();
    const facing = fwd.dot(_v2.copy(dir).setY(0).normalize()) < -0.4;
    if (!facing) return false;
    const k = this.kit;
    if (k instanceof PoliceKit) {
      if (zone.startsWith('leg')) return false;
      return Math.random() < (k.shieldUp ? 0.92 : k.current === 'lbd' && k.aiming ? 0.15 : 0.45);
    }
    if (k instanceof ProtestKit && k.panneauUp) return !zone.startsWith('leg') ? Math.random() < 0.8 : false;
    return false;
  }

  /** Flash, deafness and shrapnel from an explosion (every machine runs this for its own player). */
  onBlast(pos: THREE.Vector3, o: BlastOpts) {
    if (!this.alive) return;
    const d = this.pos.distanceTo(pos);
    if (d < o.radius * 2.5) {
      const k = 1 - d / (o.radius * 2.5);
      this.flash = Math.max(this.flash, k * (o.kind === 'sting' ? 1 : 0.7));
      this.shake = Math.min(1, this.shake + k);
      if (k > 0.35) ctx.audio.tinnitus(2 + k * 6);
    }
    if (d < o.radius) {
      const f = 1 - d / o.radius;
      const dir = new THREE.Vector3().subVectors(this.pos, pos).setY(0.3).normalize();
      this.takeHit({ amount: o.damage * f, zone: pick(['legL', 'legR', 'torso', 'armL', 'armR', 'head'] as Zone[]),
        type: 'blast', dir, point: pos.clone(), force: o.knock * f, fromCamp: 'none' });
    }
  }

  private water(dir: THREE.Vector3, strength: number) {
    if (this.inVehicle) return;
    this.push.addScaledVector(_v.copy(dir).setY(0).normalize(), strength);
    this.wet = Math.min(1, this.wet + strength * 0.05);
    if (strength > 6) this.stun = Math.max(this.stun, 0.6);
    if (strength > 4 && chance(0.05)) { this.hp -= 3; this.damageFlash = Math.min(1, this.damageFlash + 0.12); }
  }

  /** One of our hits landed (or was blocked): counters, hit marker, and a word in the feed for the notable ones. */
  hitLanded(h: HitInfo) {
    if (h.blocked) { if (h.type !== 'water') ctx.hud.feed('Bloqué par un bouclier', '#9fb7d8'); return; }
    const s = ctx.stats;
    this.touched.add(h.id);
    s.peopleHit = this.touched.size;
    ctx.hud.hitCount();
    if (h.type === 'water' || h.type === 'gas') return;
    s.hits++;
    if (h.zone === 'head') s.headHits++;
    if (h.type === 'lbd') s.lbdHits++;
    if (h.type !== 'blast') ctx.hud.hitMarker(h.zone === 'head');
    const own = h.camp === ctx.camp || h.role === 'journalist' || h.role === 'medic';
    if (own) this.friendlyFire++;
    else if (h.down) s.takedowns++;
    if (ctx.camp === 'protest' && h.role === 'crs') this.aggro += 1.5;
    if (own || h.zone === 'head') {
      const who = t(h.role === 'crs' ? 'CRS' : h.role === 'journalist' ? 'journaliste' : h.role === 'medic' ? 'street medic' : h.role === 'firefighter' ? 'pompier' : 'manifestant');
      ctx.hud.feed((own ? t('Attention, touché :') : t('Touché :')) + ` ${who} (${ZONE_SHORT[h.zone]})` + (h.eye ? t(' · œil') : h.jaw ? t(' · mâchoire') : ''), own ? '#ff8a6a' : '#f2e2b0');
    }
  }

  seize() {
    if (!this.alive) return;
    this.stun = Math.max(this.stun, 2.6);
    ctx.hud.feed('Un CRS vous plaque au sol et sort les menottes !', '#ff4040');
  }

  medicProgress(k: number) { ctx.hud.progress(k, 'Le street medic vous soigne…'); }

  goDown() {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.fell();
    ctx.hud.feed('Vous êtes à terre…', '#ff4040');
    ctx.audio.tinnitus(4);
    ctx.game.humanDown(false);
  }

  getArrested() {
    if (!this.alive) return;
    this.alive = false;
    this.arrested = true;
    this.fell();
    ctx.hud.feed('Interpellé ! Plaqué au sol et menotté.', '#ff4040');
    ctx.game.humanDown(true);
  }

  private fell() { const s = ctx.stats; s.downs++; s.firstDown ||= ctx.time; }

  /** Multiplayer: back in the game after being evacuated or released. */
  respawn(at: THREE.Vector3) {
    Object.assign(this, { alive: true, arrested: false, hp: this.maxHp, stun: 0, gas: 0, tears: 0, flash: 0, wet: 0, aggro: 0, callMedic: false, medic: null });
    this.wounds = new Wounds();
    this.pos.copy(at).setY(at.y + HALF_H + RADIUS + 0.05);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    this.vel.set(0, 0, 0); this.push.set(0, 0, 0);
    this.yaw = ctx.camp === 'police' ? Math.PI : 0; this.pitch = 0;
  }

  heal(full = false) {
    this.wounds.heal();
    this.hp = Math.min(this.maxHp, this.hp + (full ? this.maxHp : 35));
    if (full) { this.tears = 0; this.callMedic = false; this.medic = null; ctx.hud.progress(0); }
    ctx.hud.feed('Soigné : saignement arrêté.', '#9fd29b');
  }

  update(dt: number) {
    const inp = ctx.input;
    // look
    if (!this.inVehicle) {
      const sens = 0.0022 * ctx.settings.sensitivity * (this.kit instanceof PoliceKit && this.kit.aiming ? 0.5 : 1);
      this.yaw -= inp.mouseDX * sens;
      this.pitch -= inp.mouseDY * sens * (ctx.settings.invertY ? -1 : 1);
      this.pitch = clamp(this.pitch, -1.45, 1.45);
      ctx.post.u.motion.value.set(clamp(-inp.mouseDX * 0.0004, -0.02, 0.02), clamp(inp.mouseDY * 0.0004, -0.02, 0.02));
    }
    // status
    this.stun = Math.max(0, this.stun - dt);
    this.flash = Math.max(0, this.flash - dt * 0.5);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.5);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.wet = Math.max(0, this.wet - dt * 0.12);
    this.aggro = Math.max(0, this.aggro - dt * 0.08);
    this.wounds.concussion = Math.max(0, this.wounds.concussion - dt);
    if (this.alive && this.wounds.bleed > 0) {
      this.hp -= this.wounds.bleed * dt * 0.35;
      if (chance(dt * this.wounds.bleed * 0.3)) { const f = this.feet; ctx.decals.add('blood', f.x + rr(-0.3, 0.3), f.z + rr(-0.3, 0.3), rr(0.12, 0.3), groundY(f.x, f.z)); }
      if (this.hp <= 0) this.goDown();
    }
    // gas
    const g = ctx.gas.at(this.eye);
    const mask = this.maskOn ? (this.hasGasMask ? 0.92 : 0.4) : 0;
    this.gas = lerp(this.gas, g * (1 - mask), 1 - Math.exp(-dt * (g > this.gas ? 2 : 0.6)));
    this.serumT = Math.max(0, this.serumT - dt);
    const tearTarget = clamp(this.gas * 1.3, 0, 1) * (this.serumT > 0 ? 0.3 : 1);
    this.tears = lerp(this.tears, tearTarget, 1 - Math.exp(-dt * (tearTarget > this.tears ? 1.5 : 0.25)));
    if (this.gas > 0.25 && chance(dt * this.gas * 1.5)) ctx.audio.cough(null, 0.5);
    if (this.gas > 0.5 && this.alive) this.hp -= dt * this.gas * 1.2;
    // fire
    const heat = ctx.destruction.heatAt(this.feet);
    if (heat > 0.25 && this.alive) {
      this.hp -= heat * dt * 18; this.damageFlash = Math.min(1, this.damageFlash + dt * 2);
      if (chance(dt * 2)) ctx.audio.hurt();
      if (this.hp <= 0) this.goDown();
    }
    // medic called by the protester
    if (this.medic) {
      if (this.medic.state === 'gone' || !this.medic.standing) { this.medic = null; this.callMedic = false; }
    }

    if (!this.inVehicle) this.move(dt);
    this.kit.update(dt);
    this.updateCamera(dt);
    // walk sounds
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && sp > 1 && this.alive) {
      this.stepT -= dt * sp;
      if (this.stepT <= 0) { this.stepT = 1.6; ctx.audio.step(ctx.camp === 'police' ? 0.22 : 0.14, ctx.camp === 'police'); }
    }
    this.vm.update(dt, sp, {
      panneau: this.kit instanceof ProtestKit && this.kit.panneauUp,
      crouch: this.crouch,
      aiming: this.kit instanceof PoliceKit && this.kit.aiming,
      shieldUp: this.kit instanceof PoliceKit && this.kit.shieldUp,
      hidden: this.inVehicle || !this.alive || ctx.settings.thirdPerson,
    });
    this.updateFx(dt);
  }

  private move(dt: number) {
    const inp = ctx.input;
    const police = ctx.camp === 'police';
    const cuffing = this.kit instanceof PoliceKit && !!this.kit.cuffing;
    const canMove = this.alive && this.stun < 0.9 && !cuffing;
    const { x, z } = canMove ? inp.move() : { x: 0, z: 0 };
    this.crouch = cuffing || canMove && (inp.down('KeyC') || inp.down('ControlLeft'));
    const sprint = inp.sprint && z > 0.5 && !this.crouch;
    let speed = police ? (sprint ? 5.6 : 3.1) : (sprint ? 7.2 : 3.9);
    speed *= 1 - this.wounds.limp * 0.45;
    if (this.crouch) speed *= 0.5;
    if (this.gas > 0.3) speed *= 0.75;
    if (this.wounds.concussion > 0) speed *= 0.7;
    if (this.kit instanceof ProtestKit && this.kit.panneauUp) speed *= 0.7;
    if (this.kit instanceof PoliceKit && (this.kit.aiming || this.kit.shieldUp)) speed *= 0.6;
    const fwd = _v.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = _v2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const dx = (fwd.x * z + right.x * x) * speed, dz = (fwd.z * z + right.z * x) * speed;
    const acc = this.grounded ? 12 : 3;
    this.vel.x += (dx - this.vel.x) * Math.min(1, acc * dt);
    this.vel.z += (dz - this.vel.z) * Math.min(1, acc * dt);
    this.vel.y -= 9.81 * dt;
    if (this.grounded && this.vel.y < 0) this.vel.y = -1;
    if (canMove && this.grounded && inp.hit('Space')) { this.vel.y = police ? 3.8 : 4.8; this.grounded = false; }
    const pushK = Math.exp(-dt * 3.5);
    const mx = (this.vel.x + this.push.x) * dt, my = this.vel.y * dt, mz = (this.vel.z + this.push.z) * dt;
    this.push.multiplyScalar(pushK);
    this.kcc.computeColliderMovement(this.collider, { x: mx, y: my, z: mz }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(G.PLAYER, G.STATIC | G.NPC | G.VEHICLE | G.DEBRIS));
    const m = this.kcc.computedMovement();
    this.pos.x += m.x; this.pos.y += m.y; this.pos.z += m.z;
    this.grounded = this.kcc.computedGrounded();
    if (this.grounded && this.vel.y < 0) this.vel.y = -1;
    if (this.pos.y < -5) this.pos.y = 2;
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
  }


  updateCamera(dt: number) {
    if (this.inVehicle) return;
    const cam = ctx.camera;
    const targetEye = !this.alive ? 0.25 : this.crouch ? 1.05 : (ctx.camp === 'police' ? 1.68 : 1.62);
    this.eyeHeight = lerp(this.eyeHeight, targetEye, 1 - Math.exp(-dt * (this.alive ? 10 : 2)));
    const f = this.feet;
    cam.position.set(f.x, f.y + this.eyeHeight, f.z);
    const t = ctx.time;
    const sh = this.shake * 0.04 + this.stun * 0.01;
    const sway = this.wounds.concussion > 0 ? Math.sin(t * 1.3) * 0.03 : 0;
    this.roll = lerp(this.roll, !this.alive ? 1.2 : this.stun > 0.9 ? 0.25 : 0, 1 - Math.exp(-dt * 3));
    this.camEuler.set(this.pitch + (Math.random() - 0.5) * sh + sway * 0.5, this.yaw + (Math.random() - 0.5) * sh, this.roll + sway);
    cam.quaternion.setFromEuler(this.camEuler);
    if (ctx.settings.thirdPerson) {
      // over the shoulder, pulled in front of walls
      const back = _v.copy(SHOULDER).applyQuaternion(cam.quaternion), len = back.length();
      back.divideScalar(len);
      const hit = ctx.physics.castRay(cam.position.x, cam.position.y, cam.position.z, back.x, back.y, back.z, len + 0.3, groups(G.PLAYER, G.STATIC | G.VEHICLE));
      cam.position.addScaledVector(back, hit ? Math.max(0.2, hit.dist - 0.3) : len);
    }
    // FOV (aiming zoom)
    const aim = this.kit instanceof PoliceKit && this.kit.aiming ? 0.55 : 1;
    const fov = ctx.settings.fov * aim;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = lerp(cam.fov, fov, 1 - Math.exp(-dt * 14)); cam.updateProjectionMatrix(); ctx.particles.resize(window.innerHeight * ctx.renderer.getPixelRatio(), cam.fov); }
  }

  private updateFx(dt: number) {
    const u = ctx.post.u;
    const lowHp = clamp(1 - this.hp / (this.maxHp * 0.45), 0, 1);
    u.damage.value = this.damageFlash;
    u.lowHp.value = lowHp;
    u.blur.value = clamp(this.wounds.concussion * 0.4 + this.tears * 0.6 + lowHp * 0.3 + (this.alive ? 0 : 1), 0, 1);
    u.tears.value = this.tears;
    u.flash.value = this.flash;
    u.eyeLoss.value = this.wounds.eye ? 0.85 : 0;
    u.wet.value = this.wet;
    u.visor.value = ctx.camp === 'police' && !this.inVehicle ? 1 : 0;
    void dt;
  }
}
