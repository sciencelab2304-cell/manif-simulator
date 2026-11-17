import * as THREE from 'three';
import { bloodTexture, scorchTexture, glassShardsTexture, puddleTexture } from '../core/textures';

type Kind = 'blood' | 'scorch' | 'glass' | 'water';

class Ring {
  mesh: THREE.InstancedMesh;
  idx = 0;
  count = 0;
  m = new THREE.Matrix4();
  constructor(scene: THREE.Scene, map: THREE.Texture, cap: number, y: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, y, 0);
    const mat = new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 0.4, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...opts });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }
  add(x: number, z: number, size: number, rot: number, yOff = 0) {
    const cap = this.mesh.instanceMatrix.count;
    this.m.makeRotationY(rot).scale(new THREE.Vector3(size, 1, size)).setPosition(x, yOff, z);
    this.mesh.setMatrixAt(this.idx, this.m);
    this.idx = (this.idx + 1) % cap;
    this.count = Math.min(this.count + 1, cap);
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Decals {
  rings: Record<Kind, Ring>;
  blood = true;
  constructor(scene: THREE.Scene) {
    this.rings = {
      blood: new Ring(scene, bloodTexture(3), 300, 0.025, { roughness: 0.15, metalness: 0.1 }),
      scorch: new Ring(scene, scorchTexture(), 80, 0.03, { roughness: 1 }),
      glass: new Ring(scene, glassShardsTexture(), 80, 0.035, { roughness: 0.05, metalness: 0.6 }),
      water: new Ring(scene, puddleTexture(), 120, 0.02, { color: 0x222831, roughness: 0.02, metalness: 0.6, opacity: 0.55 }),
    };
  }
  add(kind: Kind, x: number, z: number, size: number, y = 0) {
    if (kind === 'blood' && !this.blood) return;
    this.rings[kind].add(x, z, size, Math.random() * Math.PI * 2, y);
  }
}
