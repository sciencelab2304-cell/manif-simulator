import * as THREE from 'three';
import { ctx } from '../core/context';
import { defs, type ThrowKind, type Projectile } from './projectiles';

export type PickKind = ThrowKind | 'panneau' | 'masque' | 'serum';

export const PICK_FR: Record<string, string> = {
  pave: 'pavé', canette: 'canette', bouteille: 'bouteille', conserve: 'boîte de conserve', mortier: 'mortier d\'artifice', fusee: 'fusée',
  fumigene: 'fumigène', gas: 'grenade lacrymo (la renvoyer)', sting: 'grenade', panneau: 'panneau (bouclier de fortune)', masque: 'masque à gaz', serum: 'sérum physiologique',
};

interface Item { kind: PickKind; mesh: THREE.Object3D; pos: THREE.Vector3; active: boolean; respawn: number; home: THREE.Vector3 }

export type Target =
  | { type: 'item'; item: Item; label: string }
  | { type: 'proj'; proj: Projectile; label: string }
  | { type: 'dig'; pos: THREE.Vector3; label: string };

const _v = new THREE.Vector3();

/** Objects lying around that the protester can pick up. */
export class Pickups {
  items: Item[] = [];
  private glow: THREE.Mesh;

  constructor() {
    this.glow = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.24, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.8, depthTest: false }));
    this.glow.renderOrder = 20; this.glow.visible = false;
    ctx.scene.add(this.glow);
  }

  build() {
    for (const s of ctx.city.pickupSpots) this.add(s.kind as PickKind, new THREE.Vector3(s.x, s.y, s.z));
  }

  private makeMesh(kind: PickKind): THREE.Object3D {
    if (kind in defs()) {
      const d = defs()[kind as ThrowKind];
      const m = new THREE.Mesh(d.geo, d.mat);
      if (kind === 'canette' || kind === 'conserve' || kind === 'bouteille') m.rotation.z = Math.PI / 2;
      if (kind === 'mortier' || kind === 'fusee') {
        const g = new THREE.Group();
        const bag = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.25), new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.9 }));
        bag.position.y = 0.15; g.add(bag);
        for (let i = 0; i < 3; i++) { const t = m.clone(); t.position.set(-0.1 + i * 0.1, 0.38, 0); t.rotation.set(0, 0, 0); g.add(t); }
        return g;
      }
      return m;
    }
    if (kind === 'panneau') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.03), new THREE.MeshStandardMaterial({ color: 0x9a7b4f, roughness: 0.9 }));
      m.rotation.x = -Math.PI / 2 + 0.2;
      return m;
    }
    if (kind === 'masque') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.6 }));
      m.rotation.x = Math.PI / 2;
      return m;
    }
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.08), new THREE.MeshStandardMaterial({ color: 0xe6eef2, roughness: 0.5 }));
    return m;
  }

  add(kind: PickKind, pos: THREE.Vector3) {
    const mesh = this.makeMesh(kind);
    mesh.position.copy(pos);
    if (mesh.position.y < 0.05) mesh.position.y = 0.05;
    mesh.traverse((o) => { o.castShadow = true; });
    ctx.scene.add(mesh);
    this.items.push({ kind, mesh, pos: pos.clone(), active: true, respawn: 0, home: pos.clone() });
  }

  /** What the player is looking at, if anything can be picked up. */
  find(eye: THREE.Vector3, dir: THREE.Vector3): Target | null {
    let best: Target | null = null, bs = Infinity;
    const score = (p: THREE.Vector3, maxD: number) => {
      _v.subVectors(p, eye);
      const d = _v.length();
      if (d > maxD) return Infinity;
      const ang = 1 - _v.normalize().dot(dir);
      if (ang > 0.12) return Infinity;
      return ang * 10 + d * 0.2;
    };
    for (const it of this.items) {
      if (!it.active) continue;
      const s = score(it.mesh.position, 2.8);
      if (s < bs) { bs = s; best = { type: 'item', item: it, label: PICK_FR[it.kind] }; }
    }
    if (ctx.camp === 'protest') {
      for (const p of ctx.projectiles.list) {
        if (p.dead) continue;
        const pickable = (p.kind === 'gas' && p.emit > 0) || (p.spent && p.resting > 0.5 && ['pave', 'canette', 'conserve'].includes(p.kind));
        if (!pickable) continue;
        const s = score(p.pos(new THREE.Vector3()), 2.8);
        if (s < bs) { bs = s; best = { type: 'proj', proj: p, label: PICK_FR[p.kind] }; }
      }
      for (const d of ctx.city.paveSpots) {
        const s = score(d, 3);
        if (s < bs) { bs = s; best = { type: 'dig', pos: d, label: 'dépaver (récupérer des pavés)' }; }
      }
    }
    return best;
  }

  take(it: Item) {
    this.setActive(it, false);
    it.respawn = 30;
    return it.kind;
  }

  setActive(it: Item, on: boolean) {
    it.active = on;
    it.mesh.visible = on;
    ctx.net.emit(['item', this.items.indexOf(it), on]);
  }

  showTarget(t: Target | null) {
    if (!t) { this.glow.visible = false; return; }
    this.glow.visible = true;
    const p = t.type === 'item' ? t.item.mesh.position : t.type === 'proj' ? t.proj.pos(_v) : t.pos;
    this.glow.position.set(p.x, Math.max(0.03, p.y - 0.05), p.z);
    this.glow.scale.setScalar(t.type === 'dig' ? 4 : 1);
  }

  update(dt: number) {
    for (const it of this.items) {
      if (it.active) { it.mesh.rotation.y += dt * 0.6; continue; }
      it.respawn -= dt;
      if (it.respawn <= 0 && !ctx.net.isClient && ctx.crowd.humans.every((h) => it.home.distanceTo(h.pos) > 12)) this.setActive(it, true);
    }
  }
}
