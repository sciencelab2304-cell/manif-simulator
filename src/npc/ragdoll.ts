import * as THREE from 'three';
import { RAPIER, G, groups } from '../core/physics';
import { ctx } from '../core/context';
import { P, NPARTS, JOINTS } from './body';

const SHAPES: { make: () => RAPIER.ColliderDesc; off: [number, number, number] }[] = [];
SHAPES[P.pelvis] = { make: () => RAPIER.ColliderDesc.cuboid(0.16, 0.1, 0.1), off: [0, 0, 0] };
SHAPES[P.torso] = { make: () => RAPIER.ColliderDesc.cuboid(0.18, 0.25, 0.11), off: [0, 0.28, 0] };
SHAPES[P.head] = { make: () => RAPIER.ColliderDesc.ball(0.12), off: [0, 0.2, 0] };
SHAPES[P.armL] = { make: () => RAPIER.ColliderDesc.capsule(0.27, 0.05), off: [0, -0.32, 0] };
SHAPES[P.armR] = SHAPES[P.armL];
SHAPES[P.thighL] = { make: () => RAPIER.ColliderDesc.capsule(0.16, 0.075), off: [0, -0.21, 0] };
SHAPES[P.thighR] = SHAPES[P.thighL];
SHAPES[P.shinL] = { make: () => RAPIER.ColliderDesc.capsule(0.17, 0.06), off: [0, -0.22, 0] };
SHAPES[P.shinR] = SHAPES[P.shinL];

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

/** Physical ragdoll made of 9 rigid bodies linked by spherical joints. */
export class Ragdoll {
  bodies: RAPIER.RigidBody[] = [];
  joints: RAPIER.ImpulseJoint[] = [];
  age = 0;
  calm = 0;
  done = false;

  constructor(mats: THREE.Matrix4[], vel: THREE.Vector3, owner: unknown, spin = 2) {
    const w = ctx.physics.world;
    for (let i = 0; i < NPARTS; i++) {
      mats[i].decompose(_p, _q, _s);
      const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(_p.x, _p.y, _p.z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        .setLinvel(vel.x * (0.8 + Math.random() * 0.4), vel.y + Math.random() * 0.5, vel.z * (0.8 + Math.random() * 0.4))
        .setAngvel({ x: (Math.random() - 0.5) * spin, y: (Math.random() - 0.5) * spin, z: (Math.random() - 0.5) * spin })
        .setLinearDamping(0.25).setAngularDamping(2.2).setCcdEnabled(i === P.head || i === P.torso));
      const sh = SHAPES[i];
      const c = w.createCollider(sh.make().setTranslation(sh.off[0], sh.off[1], sh.off[2]).setDensity(950).setFriction(0.9).setRestitution(0.05)
        .setCollisionGroups(groups(G.RAGDOLL, G.STATIC | G.VEHICLE | G.DEBRIS)), b);
      ctx.physics.setOwner(c, { kind: 'ragdoll', ref: owner });
      this.bodies.push(b);
    }
    for (const [child, parent, a] of JOINTS) {
      const jd = RAPIER.JointData.spherical({ x: a[0], y: a[1], z: a[2] }, { x: 0, y: 0, z: 0 });
      const j = w.createImpulseJoint(jd, this.bodies[parent], this.bodies[child], true);
      j.setContactsEnabled(false);
      this.joints.push(j);
    }
  }

  impulse(part: number, dv: THREE.Vector3) {
    const b = this.bodies[part];
    const m = b.mass();
    b.applyImpulse({ x: dv.x * m, y: dv.y * m, z: dv.z * m }, true);
  }
  pushAll(dv: THREE.Vector3) {
    for (const b of this.bodies) { const m = b.mass(); b.applyImpulse({ x: dv.x * m, y: dv.y * m, z: dv.z * m }, true); }
    this.calm = 0;
  }

  /** Writes body transforms into the part matrices. Returns true once settled. */
  update(dt: number, mats: THREE.Matrix4[]) {
    this.age += dt;
    let maxV = 0;
    for (let i = 0; i < NPARTS; i++) {
      const b = this.bodies[i];
      const t = b.translation(), r = b.rotation();
      _p.set(t.x, t.y, t.z); _q.set(r.x, r.y, r.z, r.w); _s.set(1, 1, 1);
      mats[i].compose(_p, _q, _s);
      const v = b.linvel();
      maxV = Math.max(maxV, Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z));
      // safety: a body that fell through the floor
      if (t.y < -2) { b.setTranslation({ x: t.x, y: 0.3, z: t.z }, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true); }
    }
    if (maxV < 0.35) this.calm += dt; else this.calm = 0;
    return (this.calm > 0.6 && this.age > 1.2) || this.age > 6;
  }

  pelvisPos(out: THREE.Vector3) {
    const t = this.bodies[P.pelvis].translation();
    return out.set(t.x, t.y, t.z);
  }

  dispose() {
    for (const j of this.joints) ctx.physics.world.removeImpulseJoint(j, false);
    for (const b of this.bodies) ctx.physics.removeBody(b);
    this.bodies = []; this.joints = [];
    this.done = true;
  }
}
