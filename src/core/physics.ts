import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

/** Collision group bits. */
export const G = {
  STATIC: 1,
  PLAYER: 2,
  NPC: 4,
  PROJ: 8,
  RAGDOLL: 16,
  DEBRIS: 32,
  VEHICLE: 64,
};
export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);

export type OwnerKind = 'static' | 'npc' | 'player' | 'proj' | 'ragdoll' | 'vehicle' | 'window' | 'prop' | 'barricade';
export interface Owner { kind: OwnerKind; ref?: any }

export type CollisionHandler = (a: RAPIER.Collider, b: RAPIER.Collider, oa: Owner | undefined, ob: Owner | undefined) => void;

export async function initRapier() {
  await RAPIER.init();
}

export class Physics {
  world: RAPIER.World;
  queue: RAPIER.EventQueue;
  owners = new Map<number, Owner>();
  acc = 0;
  readonly dt = 1 / 60;
  onCollision: CollisionHandler = () => {};
  /** callbacks run before each fixed step (e.g. projectile thrust). */
  preStep: ((dt: number) => void)[] = [];

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.dt;
    this.queue = new RAPIER.EventQueue(true);
  }

  setOwner(c: RAPIER.Collider, o: Owner) { this.owners.set(c.handle, o); }
  owner(c: RAPIER.Collider | null | undefined) { return c ? this.owners.get(c.handle) : undefined; }

  removeCollider(c: RAPIER.Collider) {
    this.owners.delete(c.handle);
    this.world.removeCollider(c, true);
  }
  removeBody(b: RAPIER.RigidBody) {
    for (let i = 0; i < b.numColliders(); i++) this.owners.delete(b.collider(i).handle);
    this.world.removeRigidBody(b);
  }

  /** Fixed static cuboid helper (center + half extents, optional yaw). */
  addStaticBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw = 0, owner: Owner = { kind: 'static' }) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, cz)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }));
    const c = this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setCollisionGroups(groups(G.STATIC, 0xffff)), body);
    this.setOwner(c, owner);
    return c;
  }

  addStaticCylinder(cx: number, cy: number, cz: number, halfH: number, r: number, owner: Owner = { kind: 'static' }) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, cz));
    const c = this.world.createCollider(RAPIER.ColliderDesc.cylinder(halfH, r).setCollisionGroups(groups(G.STATIC, 0xffff)), body);
    this.setOwner(c, owner);
    return c;
  }

  step(frameDt: number) {
    this.acc += Math.min(frameDt, 0.1);
    let n = 0;
    while (this.acc >= this.dt && n < 3) {
      for (const f of this.preStep) f(this.dt);
      this.world.step(this.queue);
      this.queue.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        const a = this.world.getCollider(h1), b = this.world.getCollider(h2);
        if (!a || !b) return;
        this.onCollision(a, b, this.owners.get(h1), this.owners.get(h2));
      });
      this.acc -= this.dt;
      n++;
    }
    if (n === 3) this.acc = 0;
  }

  ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

  /** Ray cast returning collider, distance and normal. */
  castRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, filter: number,
    exclude?: RAPIER.Collider, excludeBody?: RAPIER.RigidBody) {
    this.ray.origin = { x: ox, y: oy, z: oz };
    this.ray.dir = { x: dx, y: dy, z: dz };
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, filter, exclude, excludeBody);
    if (!hit) return null;
    return { collider: hit.collider, dist: hit.timeOfImpact, normal: hit.normal };
  }
}
