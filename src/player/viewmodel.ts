import * as THREE from 'three';
import { defs, type ThrowKind } from '../weapons/projectiles';
import type { Gear } from '../meta/shop';

/** First-person hands and held objects, attached to the camera. */
export class ViewModel {
  root = new THREE.Group();
  handR: THREE.Group;
  handL: THREE.Group;
  item: THREE.Object3D | null = null;
  shield: THREE.Mesh | null = null;
  panneau: THREE.Mesh;
  lbd: THREE.Group;
  baton: THREE.Mesh;
  grenade: THREE.Mesh;
  t = 0;
  throwT = 0; recoilT = 0; swingT = 0;
  charge = 0;
  bob = 0;
  shieldUp = 0;
  aim = 0;
  current = '';

  /** gear: skins bought in the shop (weapon metal, gloves, lighter); sleeve: colour of the outfit */
  constructor(camera: THREE.Camera, police: boolean, private gear: Gear = {}, sleeveColor?: number) {
    camera.add(this.root);
    const skin = new THREE.MeshStandardMaterial({ color: gear.hand ?? (police ? 0x1a1d22 : 0xd9a98a), roughness: police ? 0.8 : 0.6 });
    const sleeve = new THREE.MeshStandardMaterial({ color: sleeveColor ?? (police ? 0x1a2333 : 0x3a3f4a), roughness: 0.9 });
    const mk = () => {
      const g = new THREE.Group();
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.32, 4, 8), sleeve); arm.rotation.x = Math.PI / 2; arm.position.z = 0.2;
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.05, 0.11), skin); hand.position.z = -0.02;
      g.add(arm, hand);
      return g;
    };
    this.handR = mk(); this.handL = mk();
    this.root.add(this.handR, this.handL);
    this.handR.position.set(0.22, -0.22, -0.42);
    this.handL.position.set(-0.24, -0.25, -0.42);

    // police kit
    const metal = new THREE.MeshStandardMaterial({ color: gear.metal ?? 0x2b2f2a, roughness: 0.45, metalness: 0.6 });
    this.lbd = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.55), metal); body.position.z = -0.2;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.32, 12).rotateX(Math.PI / 2), metal); barrel.position.set(0, 0.03, -0.55);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.25), metal); stock.position.set(0, -0.03, 0.15);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.1), new THREE.MeshStandardMaterial({ color: 0x111111 })); sight.position.set(0, 0.09, -0.15);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.05), metal); grip.position.set(0, -0.1, -0.05); grip.rotation.x = 0.3;
    this.lbd.add(body, barrel, stock, sight, grip);
    this.baton = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.62, 8), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }));
    this.baton.geometry.translate(0, 0.25, 0);
    this.grenade = new THREE.Mesh(defs().gas.geo, defs().gas.mat as THREE.Material);
    if (police) {
      this.shield = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.0, 0.02), new THREE.MeshStandardMaterial({ color: 0xc8d2da, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.3, depthWrite: false }));
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.64, 1.02, 0.01), new THREE.MeshBasicMaterial({ color: 0x0a0a0a, wireframe: true }));
      this.shield.add(rim);
      this.shield.position.set(-0.5, -0.35, -0.55);
      this.root.add(this.shield);
    }
    this.panneau = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.95, 0.03), new THREE.MeshStandardMaterial({ color: 0x9a7b4f, roughness: 0.9 }));
    this.panneau.visible = false;
    this.root.add(this.panneau);
    this.root.traverse((o) => { (o as THREE.Mesh).castShadow = false; o.renderOrder = 30; });
  }

  setItem(kind: string) {
    if (kind === this.current) return;
    this.current = kind;
    if (this.item) this.handR.remove(this.item);
    this.item = null;
    if (kind === 'lbd') this.item = this.lbd;
    else if (kind === 'baton') this.item = this.baton;
    else if (kind === 'briquet') this.item = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.02), new THREE.MeshStandardMaterial({ color: this.gear.lighter ?? 0xd8342a, roughness: 0.4, metalness: this.gear.lighter ? 0.8 : 0 }));
    else if (kind && kind in defs()) {
      const d = defs()[kind as ThrowKind];
      this.item = new THREE.Mesh(d.geo, d.mat as THREE.Material);
    }
    if (this.item) {
      this.item.position.set(0, 0.03, -0.06);
      if (kind !== 'lbd' && kind !== 'baton') this.item.scale.setScalar(0.65);
      this.item.rotation.set(0, 0, 0);
      if (kind === 'lbd') { this.item.position.set(-0.05, 0.02, -0.05); }
      if (kind === 'baton') { this.item.rotation.set(-1.2, 0, 0); }
      this.item.renderOrder = 30;
      this.handR.add(this.item);
    }
  }

  update(dt: number, speed: number, opts: { panneau: boolean; crouch: boolean; aiming: boolean; shieldUp: boolean; hidden: boolean }) {
    this.root.visible = !opts.hidden;
    this.t += dt;
    this.bob += dt * speed * 1.8;
    const b = Math.min(1, speed / 4);
    const bx = Math.sin(this.bob) * 0.012 * b, by = Math.abs(Math.cos(this.bob)) * 0.014 * b;
    this.throwT = Math.max(0, this.throwT - dt);
    this.recoilT = Math.max(0, this.recoilT - dt);
    this.swingT = Math.max(0, this.swingT - dt);
    this.aim += ((opts.aiming ? 1 : 0) - this.aim) * Math.min(1, dt * 12);
    this.shieldUp += ((opts.shieldUp ? 1 : 0) - this.shieldUp) * Math.min(1, dt * 10);

    // right hand
    const R = this.handR;
    R.position.set(0.22 + bx, -0.22 + by, -0.42);
    R.rotation.set(0, 0, 0);
    if (this.current === 'lbd') {
      R.position.lerp(new THREE.Vector3(0.0, -0.115, -0.32), this.aim);
      R.position.z += this.recoilT * 0.4;
      R.rotation.x = this.recoilT * 1.2;
    } else if (this.current === 'baton') {
      const k = this.swingT > 0 ? 1 - this.swingT / 0.4 : 0;
      if (this.swingT > 0) {
        R.rotation.x = k < 0.35 ? -k / 0.35 * -1.2 : 1.2 - (k - 0.35) / 0.65 * 2.6;
        R.position.y += k < 0.35 ? k * 0.5 : 0.17 - (k - 0.35) * 0.6;
      }
    } else {
      // charging a throw: arm goes back and up
      R.position.y += this.charge * 0.12;
      R.position.z += this.charge * 0.18;
      R.rotation.x = -this.charge * 0.6;
      if (this.throwT > 0) {
        const k = 1 - this.throwT / 0.35;
        R.position.z -= Math.sin(k * Math.PI) * 0.35;
        R.position.y += Math.sin(k * Math.PI) * 0.08;
        R.rotation.x = 0.8 * Math.sin(k * Math.PI);
      }
    }
    // left hand / shield
    const Lh = this.handL;
    Lh.position.set(-0.24 - bx, -0.25 + by, -0.42);
    if (this.shield) {
      this.shield.position.set(-0.52 + 0.4 * this.shieldUp - bx, -0.4 + 0.25 * this.shieldUp + by, -0.6 + 0.12 * this.shieldUp);
      this.shield.rotation.y = 0.6 - 0.55 * this.shieldUp;
      Lh.position.copy(this.shield.position).add(new THREE.Vector3(0.05, -0.05, 0.12));
      if (this.current === 'lbd' && this.aim > 0.1) {
        this.shield.position.x -= 0.25 * this.aim;
        Lh.position.lerp(new THREE.Vector3(-0.02, -0.14, -0.55), this.aim);
      }
    }
    this.panneau.visible = opts.panneau;
    if (opts.panneau) {
      this.panneau.position.set(-0.05, -0.15 + by, -0.55);
      this.panneau.rotation.set(0, 0, 0.05);
      Lh.position.set(-0.25, -0.3, -0.5);
    }
    this.root.position.y = opts.crouch ? -0.02 : 0;
  }
}
