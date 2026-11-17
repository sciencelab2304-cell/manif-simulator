import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ctx, type Human } from '../core/context';
import { RAPIER, G, groups } from '../core/physics';
import { brokenGlassTexture } from '../core/textures';
import { rr, chance } from '../core/util';
import { normGeo } from '../world/geom';

export interface Pane { pos: THREE.Vector3; yaw: number; w: number; h: number; normal: THREE.Vector3 }

interface WindowState { pane: Pane; collider: RAPIER.Collider | null; broken: boolean; value: number; index: number }

export type BurnKind = 'car' | 'bin' | 'shelter' | 'barricade';
export interface Burnable {
  kind: BurnKind;
  obj: THREE.Object3D;
  pos: THREE.Vector3;
  radius: number;
  value: number;
  collider?: RAPIER.Collider;
  heat: number;
  fire: Fire | null;
  burnt: boolean;
  prop?: Prop;
}

export class Fire {
  t = 0;
  dead = false;
  intensity = 1;
  smokeT = 0;
  boom = false;
  flick = Math.random() * 10;
  constructor(public pos: THREE.Vector3, public size: number, public life: number, public burnable: Burnable | null) {}
}

export type PropKind = 'bin' | 'barrier' | 'pallet';
export interface Prop { kind: PropKind; mesh: THREE.Object3D; body: RAPIER.RigidBody; used: boolean; burnable?: Burnable }

const FIRE_SIZE: Record<BurnKind, number> = { car: 1.8, barricade: 2, bin: 0.8, shelter: 1.2 };
const FIRE_LIFE: Record<BurnKind, number> = { car: 110, barricade: 150, bin: 70, shelter: 60 };

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _c = new THREE.Color();

export class Destruction {
  windows: WindowState[] = [];
  intact!: THREE.InstancedMesh;
  broken!: THREE.InstancedMesh;
  private pending: { pane: Pane; value: number }[] = [];
  burnables: Burnable[] = [];
  fires: Fire[] = [];
  props: Prop[] = [];
  barricades: { group: THREE.Group; pos: THREE.Vector3; yaw: number; burnable: Burnable; props: number[] }[] = [];
  private propGeos: Record<PropKind, { geo: THREE.BufferGeometry; mats: THREE.Material[] }> | null = null;

  // ------------------------------------------------------------------ windows
  createWindows(panes: Pane[], value = 4500) {
    for (const p of panes) this.pending.push({ pane: p, value });
  }

  /** Called once after the city is built: one InstancedMesh for every pane of the city. */
  finalizeWindows() {
    const n = this.pending.length;
    const geo = new THREE.PlaneGeometry(1, 1);
    const glass = new THREE.MeshStandardMaterial({ color: 0x1e2a30, metalness: 0.95, roughness: 0.04, transparent: true, opacity: 0.55, envMapIntensity: 1.6 });
    const brokenM = new THREE.MeshStandardMaterial({ map: brokenGlassTexture(), transparent: true, alphaTest: 0.05, metalness: 0.6, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false });
    this.intact = new THREE.InstancedMesh(geo, glass, n);
    this.broken = new THREE.InstancedMesh(geo, brokenM, n);
    this.broken.count = n;
    this.pending.forEach(({ pane, value }, i) => {
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pane.yaw);
      _m.compose(pane.pos, _q, new THREE.Vector3(pane.w, pane.h, 1));
      this.intact.setMatrixAt(i, _m);
      _m.compose(pane.pos, _q, new THREE.Vector3(0, 0, 0));
      this.broken.setMatrixAt(i, _m);
      const body = ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pane.pos.x, pane.pos.y, pane.pos.z)
        .setRotation({ x: 0, y: Math.sin(pane.yaw / 2), z: 0, w: Math.cos(pane.yaw / 2) }));
      const col = ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(pane.w / 2, pane.h / 2, 0.04)
        .setCollisionGroups(groups(G.STATIC, 0xffff)), body);
      ctx.physics.setOwner(col, { kind: 'window', ref: i });
      this.windows.push({ pane, collider: col, broken: false, value, index: i });
    });
    this.intact.renderOrder = 4;
    ctx.scene.add(this.intact, this.broken);
    this.pending = [];
  }

  breakWindow(i: number, dir?: THREE.Vector3, by: Human | null = null) {
    const w = this.windows[i];
    if (!w || w.broken) return;
    w.broken = true;
    ctx.net.emit(['win', i, ...(dir ? [dir.x, dir.y, dir.z] : [])]);
    const p = w.pane;
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
    _m.compose(p.pos, _q, new THREE.Vector3(0, 0, 0)); this.intact.setMatrixAt(i, _m); this.intact.instanceMatrix.needsUpdate = true;
    _m.compose(p.pos, _q, new THREE.Vector3(p.w, p.h, 1)); this.broken.setMatrixAt(i, _m); this.broken.instanceMatrix.needsUpdate = true;
    if (w.collider) { ctx.physics.removeCollider(w.collider); w.collider = null; }
    // clients replay the break themselves, so the host keeps these effects to itself
    ctx.net.quiet(() => {
      const d = dir ? dir.clone().normalize() : p.normal.clone().negate();
      ctx.particles.glass(p.pos, d, Math.round(30 + p.w * 15));
      ctx.audio.glass(p.pos, Math.min(1.5, p.w / 2));
      ctx.decals.add('glass', p.pos.x + p.normal.x * 0.8, p.pos.z + p.normal.z * 0.8, p.w * 0.9, p.pos.y - p.h / 2 + 0.02);
    });
    ctx.stats.windows++;
    ctx.stats.damageEuros += w.value;
    ctx.tension.add(by ? 3 : 1.5, 'vitrine');
    if (by?.camp === 'protest') by.aggro += 2;
  }

  nearestWindow(pos: THREE.Vector3, maxDist: number) {
    let best: WindowState | null = null, bd = maxDist * maxDist;
    for (const w of this.windows) {
      if (w.broken) continue;
      const d = w.pane.pos.distanceToSquared(pos);
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }

  // ------------------------------------------------------------------ burnables & fire
  registerBurnable(b: Omit<Burnable, 'heat' | 'fire' | 'burnt'>) {
    const full: Burnable = { ...b, heat: 0, fire: null, burnt: false };
    this.burnables.push(full);
    return full;
  }

  ignite(b: Burnable, by: Human | null = null) {
    if (b.fire || b.burnt) return;
    b.fire = new Fire(b.pos.clone(), FIRE_SIZE[b.kind], FIRE_LIFE[b.kind], b);
    this.fires.push(b.fire);
    ctx.stats.fires++;
    ctx.tension.add(b.kind === 'car' ? 6 : 3, 'incendie');
    ctx.audio.launch(b.pos);
    if (by?.camp === 'protest') by.aggro += 3;
  }

  /** Called by explosions: ignites what's close, heats what's around. */
  igniteAround(pos: THREE.Vector3, r: number, by: Human | null = null) {
    for (const b of this.burnables) {
      if (b.burnt || b.fire) continue;
      const d = b.pos.distanceTo(pos) - b.radius;
      if (d < r * 0.4) this.ignite(b, by);
      else if (d < r) b.heat += 0.35;
    }
  }

  extinguish(pos: THREE.Vector3, r: number, amount: number) {
    for (const f of this.fires) {
      if (f.pos.distanceTo(pos) < r + f.size) {
        f.intensity -= amount;
        ctx.particles.smoke(f.pos.clone().setY(f.pos.y + 0.5), 1, 0.85, 2);
        if (f.intensity <= 0.05) f.dead = true;
      }
    }
  }

  heatAt(pos: THREE.Vector3) {
    let h = 0;
    for (const f of this.fires) {
      const d = Math.hypot(f.pos.x - pos.x, f.pos.z - pos.z);
      const r = f.size * 1.3 * f.intensity + 0.4;
      if (d < r) h = Math.max(h, (1 - d / r) * f.intensity);
    }
    return h;
  }

  /** Client: fires as listed in the host snapshot ([burnable index, age, intensity]...). */
  mirrorFires(list: number[][]) {
    const live = new Set<Fire>();
    for (const [i, t, k] of list) {
      const b = this.burnables[i];
      if (!b) continue;
      if (!b.fire) { b.fire = new Fire(b.pos.clone(), FIRE_SIZE[b.kind], Infinity, b); this.fires.push(b.fire); }
      b.fire.t = t; b.fire.intensity = k;
      live.add(b.fire);
    }
    for (const f of this.fires) if (!live.has(f)) f.dead = true;
  }

  nearestBurnable(pos: THREE.Vector3, maxDist: number, kinds?: BurnKind[]) {
    let best: Burnable | null = null, bd = maxDist;
    for (const b of this.burnables) {
      if (b.burnt || b.fire) continue;
      if (kinds && !kinds.includes(b.kind)) continue;
      const d = b.pos.distanceTo(pos) - b.radius * 0.5;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  private char(b: Burnable) {
    b.obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (Array.isArray(m.material)) m.material = m.material.map((mm, i) => (i === 1 ? ctx.city.burntGlass : ctx.city.burntMat));
      else m.material = ctx.city.burntMat;
    });
  }

  // ------------------------------------------------------------------ dynamic props
  private buildPropGeos() {
    const binBody = mergeGeometries([
      normGeo(new THREE.BoxGeometry(0.6, 0.95, 0.7).translate(0, -0.05, 0)),
      normGeo(new THREE.BoxGeometry(0.66, 0.08, 0.76).translate(0, 0.47, 0)),
    ]);
    const binWheels = normGeo(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 10).rotateZ(Math.PI / 2).translate(0, -0.5, -0.28));
    const tube = (x0: number, y0: number, x1: number, y1: number) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      return normGeo(new THREE.CylinderGeometry(0.02, 0.02, len, 5).rotateZ(Math.atan2(x1 - x0, y1 - y0) * -1).translate((x0 + x1) / 2, (y0 + y1) / 2, 0));
    };
    const bar: THREE.BufferGeometry[] = [tube(-1.25, -0.5, -1.25, 0.55), tube(1.25, -0.5, 1.25, 0.55), tube(-1.25, 0.55, 1.25, 0.55), tube(-1.25, -0.3, 1.25, -0.3)];
    for (let x = -1.1; x <= 1.1; x += 0.14) bar.push(tube(x, -0.3, x, 0.55));
    bar.push(normGeo(new THREE.BoxGeometry(0.5, 0.04, 0.12).translate(-1.15, -0.54, 0)), normGeo(new THREE.BoxGeometry(0.5, 0.04, 0.12).translate(1.15, -0.54, 0)));
    const pallet: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) pallet.push(normGeo(new THREE.BoxGeometry(1.2, 0.025, 0.12).translate(0, 0.06, -0.34 + i * 0.17)));
    for (const z of [-0.34, 0, 0.34]) pallet.push(normGeo(new THREE.BoxGeometry(1.2, 0.09, 0.1).translate(0, 0, z)));
    const green = new THREE.MeshStandardMaterial({ color: 0x2d5a33, roughness: 0.6 });
    const black = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.35, metalness: 0.85 });
    const wood = new THREE.MeshStandardMaterial({ color: 0xa88a5c, roughness: 0.9 });
    this.propGeos = {
      bin: { geo: mergeGeometries([binBody, binWheels], true), mats: [green, black] },
      barrier: { geo: mergeGeometries(bar), mats: [metal] },
      pallet: { geo: mergeGeometries(pallet), mats: [wood] },
    };
  }

  spawnProp(kind: PropKind, pos: THREE.Vector3, yaw: number) {
    // clients only move props where the host says they are
    const dyn = !ctx.net.isClient;
    if (!this.propGeos) this.buildPropGeos();
    const def = this.propGeos![kind];
    const mesh = new THREE.Mesh(def.geo, def.mats.length > 1 ? def.mats.map((m) => m.clone()) : def.mats[0]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    ctx.scene.add(mesh);
    const desc = (dyn ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.kinematicPositionBased()).setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }).setLinearDamping(0.3).setAngularDamping(0.6).setCanSleep(true);
    const body = ctx.physics.world.createRigidBody(desc);
    let cd: RAPIER.ColliderDesc;
    if (kind === 'bin') cd = RAPIER.ColliderDesc.cuboid(0.3, 0.52, 0.35).setDensity(80);
    else if (kind === 'barrier') cd = RAPIER.ColliderDesc.cuboid(1.25, 0.55, 0.06).setDensity(60);
    else cd = RAPIER.ColliderDesc.cuboid(0.6, 0.06, 0.42).setDensity(250);
    cd.setCollisionGroups(groups(G.DEBRIS, G.STATIC | G.PLAYER | G.PROJ | G.DEBRIS | G.VEHICLE | G.RAGDOLL)).setFriction(0.7);
    const col = ctx.physics.world.createCollider(cd, body);
    const prop: Prop = { kind, mesh, body, used: false };
    ctx.physics.setOwner(col, { kind: 'prop', ref: prop });
    if (kind === 'bin') prop.burnable = this.registerBurnable({ kind: 'bin', obj: mesh, pos: pos.clone(), radius: 0.6, value: 400, prop });
    this.props.push(prop);
    this.syncProp(prop);
    return prop;
  }

  syncProp(p: Prop) {
    const t = p.body.translation(), r = p.body.rotation();
    p.mesh.position.set(t.x, t.y, t.z);
    p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    if (p.burnable) p.burnable.pos.set(t.x, t.y, t.z);
  }

  propsNear(pos: THREE.Vector3, r: number) {
    return this.props.filter((p) => !p.used && p.mesh.position.distanceTo(pos) < r);
  }

  push(pos: THREE.Vector3, r: number, power: number) {
    for (const p of this.props) {
      if (p.used) continue;
      const d = p.mesh.position.distanceTo(pos);
      if (d < r) {
        _v.subVectors(p.mesh.position, pos).setY(0.4).normalize().multiplyScalar(power * (1 - d / r) * p.body.mass());
        p.body.applyImpulse({ x: _v.x, y: _v.y, z: _v.z }, true);
      }
    }
  }

  // ------------------------------------------------------------------ barricades
  /** Builds a barricade from nearby materials (bins, barriers, pallets). Returns null if not enough. */
  buildBarricade(center: THREE.Vector3, yaw: number, by: Human | null, minProps = 2) {
    const near = this.propsNear(center, 9).filter((p) => !p.burnable?.fire).slice(0, 6);
    if (near.length < minProps) return null;
    const burn = this.makeBarricade(center, yaw, near);
    ctx.net.emit(this.barricadeEvent(this.barricades.length - 1));
    ctx.stats.barricades++;
    ctx.tension.add(by ? 5 : 3, 'barricade');
    ctx.audio.impact('metal', center, 1);
    ctx.audio.impact('wood', center, 1);
    return burn;
  }

  /** The heap itself (clients rebuild it from the host's event). */
  makeBarricade(center: THREE.Vector3, yaw: number, near: Prop[]) {
    const g = new THREE.Group();
    let k = 0;
    for (const p of near) {
      p.used = true;
      ctx.physics.removeBody(p.body);
      ctx.scene.remove(p.mesh);
      if (p.burnable) p.burnable.burnt = true;
      const m = (p.mesh as THREE.Mesh).clone();
      const along = (k - near.length / 2) * 0.9;
      m.position.set(along + rr(-0.2, 0.2), p.kind === 'pallet' ? 0.6 + rr(0, 0.4) : 0.55, rr(-0.3, 0.3));
      m.rotation.set(rr(-0.4, 0.4), rr(-0.8, 0.8), p.kind === 'barrier' ? rr(-0.3, 0.3) : rr(-1.2, 1.2));
      g.add(m); k++;
    }
    // debris filler: tyres, planks
    const deb = new THREE.MeshStandardMaterial({ color: 0x3a332c, roughness: 1 });
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(rr(0.4, 1.4), rr(0.1, 0.3), rr(0.2, 0.6)), deb);
      b.position.set(rr(-2, 2), rr(0.1, 0.9), rr(-0.5, 0.5)); b.rotation.set(rr(-1, 1), rr(-1, 1), rr(-1, 1));
      g.add(b);
    }
    g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    g.position.copy(center).setY(0); g.rotation.y = yaw;
    ctx.scene.add(g);
    const col = ctx.physics.addStaticBox(center.x, 0.65, center.z, 2.4, 0.65, 0.6, yaw, { kind: 'barricade' });
    const burn = this.registerBurnable({ kind: 'barricade', obj: g, pos: center.clone().setY(0.6), radius: 2.4, value: 0, collider: col });
    ctx.city.boxes.push({ x: center.x, z: center.z, hx: Math.abs(Math.cos(yaw)) * 2.4 + 0.6, hz: Math.abs(Math.sin(yaw)) * 2.4 + 0.6 });
    this.barricades.push({ group: g, pos: center.clone(), yaw, burnable: burn, props: near.map((p) => this.props.indexOf(p)) });
    return burn;
  }

  barricadeEvent(i: number) {
    const b = this.barricades[i];
    return ['barricade', b.pos.x, b.pos.z, b.yaw, b.props];
  }

  // ------------------------------------------------------------------ update
  update(dt: number) {
    const sim = !ctx.net.isClient;
    if (sim) for (const p of this.props) if (!p.used && !p.body.isSleeping()) this.syncProp(p);

    for (const f of this.fires) {
      f.t += dt;
      if (f.burnable) f.pos.copy(f.burnable.pos);
      const age = f.t / f.life;
      const grow = Math.min(1, f.t / 6);
      const fade = age > 0.8 ? (1 - age) / 0.2 : 1;
      const I = grow * fade * f.intensity;
      if (age >= 1) f.dead = true;
      // char the object after a while
      const b = f.burnable;
      if (b && !b.burnt && f.t > (b.kind === 'car' ? 18 : 8)) {
        b.burnt = true; this.char(b);
        ctx.stats.damageEuros += b.value;
        if (b.kind === 'car') { ctx.stats.vehiclesBurnt++; }
        ctx.net.quiet(() => ctx.decals.add('scorch', f.pos.x, f.pos.z, b.radius * 2.4, 0.01));
      }
      if (sim && b && b.kind === 'car' && f.t > 32 && !f.boom) {
        f.boom = true;
        ctx.projectiles.explode(f.pos.clone().setY(1), { radius: 5, damage: 25, knock: 6, fire: true, flash: 1, sound: 1.3, by: null, kind: 'car' });
      }
      ctx.net.quiet(() => this.flames(f, I, dt));
      // spread heat
      if (sim && b && I > 0.3) {
        for (const o of this.burnables) {
          if (o === b || o.fire || o.burnt) continue;
          const d = o.pos.distanceTo(f.pos) - o.radius - b.radius;
          if (d < 1.5) { o.heat += dt * 0.025 * I; if (o.heat >= 1) this.ignite(o); }
        }
      }
    }
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      if (f.dead) {
        if (f.burnable) { f.burnable.fire = null; f.burnable.burnt = true; }
        this.fires.splice(i, 1);
      }
    }
  }

  /** Flames, smoke, sparks and light of one fire (drawn on every machine). */
  private flames(f: Fire, I: number, dt: number) {
    const b = f.burnable;
    const s = f.size * (0.6 + 0.4 * I);
    f.flick += dt;
    if (I <= 0.02) return;
    ctx.particles.fire(_v.copy(f.pos).setY(f.pos.y + 0.2), Math.max(1, Math.round(3 * f.size * I)), s);
    f.smokeT -= dt;
    if (f.smokeT <= 0) {
      ctx.particles.smoke(_v.copy(f.pos).setY(f.pos.y + s * 1.5), 1, b && (b.kind === 'car' || b.kind === 'barricade') ? 0.06 : 0.25, 2 + f.size * 1.5);
      f.smokeT = 0.18;
    }
    if (chance(dt * 3)) ctx.particles.sparks(_v.copy(f.pos).setY(f.pos.y + s), 3, 2.5);
    const flick = 0.75 + 0.25 * Math.sin(f.flick * 17) * Math.sin(f.flick * 7.3);
    _c.setRGB(1, 0.5, 0.18);
    ctx.lights.request({ pos: _v.copy(f.pos).setY(f.pos.y + 1.2).clone(), color: _c.clone(), intensity: 30 * f.size * I * flick, distance: 14 + f.size * 6, priority: 2 });
  }
}
