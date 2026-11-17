import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { normGeo } from '../world/geom';

/** Body parts, each with its pivot at the joint. Forward = +Z, left = +X. */
export const P = { pelvis: 0, torso: 1, head: 2, armL: 3, armR: 4, thighL: 5, thighR: 6, shinL: 7, shinR: 8 } as const;
export const NPARTS = 9;
export const ACC = { helmet: 0, shield: 1, baton: 2, gun: 3, camera: 4, pack: 5, flag: 6, vest: 7, phone: 8, hair: 9 } as const;
export const NACC = 10;
/** which part frame each accessory hangs from */
const ACC_PARENT = [P.head, P.torso, P.armR, P.armR, P.armR, P.torso, P.torso, P.torso, P.armR, P.head];

export const PELVIS_H = 0.95;

function partGeometries() {
  const g: THREE.BufferGeometry[] = [];
  g[P.pelvis] = mergeGeometries([normGeo(new THREE.BoxGeometry(0.34, 0.2, 0.21))]);
  g[P.torso] = mergeGeometries([
    normGeo(new THREE.BoxGeometry(0.33, 0.24, 0.2).translate(0, 0.12, 0)),
    normGeo(new THREE.CylinderGeometry(0.2, 0.17, 0.3, 10).scale(1, 1, 0.62).translate(0, 0.38, 0)),
    normGeo(new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.05, 0.35, 0.62).translate(0, 0.52, 0)),
  ]);
  g[P.head] = mergeGeometries([
    normGeo(new THREE.CylinderGeometry(0.05, 0.055, 0.12, 8).translate(0, 0.05, 0)),
    normGeo(new THREE.SphereGeometry(0.11, 14, 10).scale(0.88, 1.08, 1).translate(0, 0.2, 0.01)),
    normGeo(new THREE.BoxGeometry(0.03, 0.05, 0.04).translate(0, 0.19, 0.115)),
  ]);
  const arm = mergeGeometries([
    normGeo(new THREE.CapsuleGeometry(0.052, 0.5, 4, 8).translate(0, -0.3, 0)),
    normGeo(new THREE.SphereGeometry(0.048, 8, 6).scale(0.8, 1.2, 0.6).translate(0, -0.62, 0)),
  ]);
  g[P.armL] = arm; g[P.armR] = arm;
  const thigh = normGeo(new THREE.CapsuleGeometry(0.078, 0.3, 4, 8).translate(0, -0.21, 0));
  g[P.thighL] = thigh; g[P.thighR] = thigh;
  const shin = mergeGeometries([
    normGeo(new THREE.CapsuleGeometry(0.06, 0.3, 4, 8).translate(0, -0.2, 0)),
    normGeo(new THREE.BoxGeometry(0.11, 0.07, 0.27).translate(0, -0.42, 0.05)),
  ]);
  g[P.shinL] = shin; g[P.shinR] = shin;
  return g;
}

function accGeometries() {
  const g: THREE.BufferGeometry[] = [];
  g[ACC.helmet] = mergeGeometries([
    normGeo(new THREE.SphereGeometry(0.155, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(1, 1, 1.12).translate(0, 0.2, 0)),
    normGeo(new THREE.BoxGeometry(0.26, 0.14, 0.02).translate(0, 0.19, 0.165)),
  ]);
  g[ACC.shield] = normGeo(new THREE.BoxGeometry(0.58, 1.05, 0.03).translate(-0.1, 0.12, 0.4));
  g[ACC.baton] = normGeo(new THREE.CylinderGeometry(0.018, 0.022, 0.62, 6).rotateX(Math.PI / 2).translate(0, -0.64, 0.25));
  g[ACC.gun] = mergeGeometries([
    normGeo(new THREE.BoxGeometry(0.07, 0.62, 0.11).translate(0, -0.78, 0.0)),
    normGeo(new THREE.CylinderGeometry(0.03, 0.03, 0.25, 8).translate(0, -1.1, 0)),
  ]);
  g[ACC.camera] = normGeo(new THREE.BoxGeometry(0.14, 0.18, 0.36).translate(0, -0.6, 0.1));
  g[ACC.pack] = normGeo(new THREE.BoxGeometry(0.3, 0.38, 0.16).translate(0, 0.3, -0.18));
  g[ACC.flag] = mergeGeometries([
    normGeo(new THREE.CylinderGeometry(0.015, 0.015, 2.6, 5).translate(0.28, 1.0, 0.2)),
    normGeo(new THREE.PlaneGeometry(0.9, 0.6).translate(0.75, 2.0, 0.2)),
  ]);
  g[ACC.vest] = normGeo(new THREE.BoxGeometry(0.36, 0.42, 0.24).translate(0, 0.3, 0));
  g[ACC.phone] = normGeo(new THREE.BoxGeometry(0.07, 0.13, 0.01).translate(0, -0.64, 0.05));
  // hair (or a beanie): a cap over the skull, longer at the back
  g[ACC.hair] = mergeGeometries([
    normGeo(new THREE.SphereGeometry(0.118, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.92, 1.1, 1.06).translate(0, 0.205, -0.004)),
    normGeo(new THREE.BoxGeometry(0.19, 0.1, 0.05).translate(0, 0.17, -0.09)),
  ]);
  return g;
}

export interface BodyLook {
  skin: THREE.Color; top: THREE.Color; pants: THREE.Color; acc: THREE.Color[]; // per accessory colour
  acc_on: boolean[];
  size: number; // overall scale (height and build vary from person to person)
}

/**
 * Renders every humanoid with one InstancedMesh per part (instancing = a handful of draw calls for 200+ people).
 */
export class BodyRenderer {
  parts: THREE.InstancedMesh[] = [];
  accs: THREE.InstancedMesh[] = [];
  private n = new Array(NPARTS).fill(0);
  private na = new Array(NACC).fill(0);
  private tmp = new THREE.Matrix4();
  private col = new THREE.Color();

  constructor(scene: THREE.Scene, cap: number, shadows: boolean) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    partGeometries().forEach((geo, i) => {
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color());
      m.castShadow = shadows; m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      this.parts[i] = m; scene.add(m);
    });
    const accMats = [
      new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.4 }), // helmet
      new THREE.MeshStandardMaterial({ color: 0xbfc8cf, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.55 }), // shield
      new THREE.MeshStandardMaterial({ roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.5 }),
      new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.3 }),
      new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }),
      new THREE.MeshStandardMaterial({ roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x8fb6ff, emissiveIntensity: 0.6 }),
      new THREE.MeshStandardMaterial({ roughness: 0.95 }), // hair
    ];
    accGeometries().forEach((geo, i) => {
      const m = new THREE.InstancedMesh(geo, accMats[i], cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color());
      m.castShadow = shadows && i !== ACC.shield; m.receiveShadow = true;
      m.frustumCulled = false; m.count = 0;
      if (i === ACC.shield) m.renderOrder = 5;
      this.accs[i] = m; scene.add(m);
    });
  }

  begin() { this.n.fill(0); this.na.fill(0); }

  add(mats: THREE.Matrix4[], look: BodyLook, bloodTint: number, hidden?: boolean) {
    if (hidden) return;
    for (let i = 0; i < NPARTS; i++) {
      const m = this.parts[i], k = this.n[i]++;
      m.setMatrixAt(k, mats[i]);
      let c = i === P.head ? look.skin : i === P.torso || i === P.armL || i === P.armR ? look.top : look.pants;
      if (bloodTint > 0 && (i === P.head || i === P.torso)) { this.col.copy(c).lerp(BLOOD, bloodTint * (i === P.head ? 0.9 : 0.6)); c = this.col; }
      m.setColorAt(k, c);
    }
    for (let a = 0; a < NACC; a++) {
      if (!look.acc_on[a]) continue;
      const m = this.accs[a], k = this.na[a]++;
      m.setMatrixAt(k, mats[ACC_PARENT[a]]);
      m.setColorAt(k, look.acc[a]);
    }
  }

  end() {
    for (let i = 0; i < NPARTS; i++) this.flush(this.parts[i], this.n[i]);
    for (let a = 0; a < NACC; a++) this.flush(this.accs[a], this.na[a]);
  }
  private flush(m: THREE.InstancedMesh, n: number) {
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}
const BLOOD = new THREE.Color(0x4a0303);

// --------------------------------------------------------------------------- posing
export interface Pose {
  y: number; // pelvis height offset from PELVIS_H (negative = lower)
  pelvisRx: number;
  torsoRx: number; torsoRy: number;
  headRx: number; headRy: number;
  armLx: number; armLz: number; armRx: number; armRz: number;
  thighL: number; thighR: number; shinL: number; shinR: number;
}

export function neutralPose(): Pose {
  return { y: 0, pelvisRx: 0, torsoRx: 0, torsoRy: 0, headRx: 0, headRy: 0, armLx: 0, armLz: 0.08, armRx: 0, armRz: -0.08, thighL: 0, thighR: 0, shinL: 0, shinR: 0 };
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _t = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();

function local(out: THREE.Matrix4, parent: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _t.compose(_p, _q, _one);
  out.multiplyMatrices(parent, _t);
}

/** Computes the 9 part matrices from a base (feet) matrix and a pose. */
export function applyPose(base: THREE.Matrix4, p: Pose, out: THREE.Matrix4[]) {
  local(out[P.pelvis], base, 0, PELVIS_H + p.y, 0, p.pelvisRx, 0, 0);
  local(out[P.torso], out[P.pelvis], 0, 0.08, 0, p.torsoRx, p.torsoRy, 0);
  local(out[P.head], out[P.torso], 0, 0.52, 0, p.headRx, p.headRy, 0);
  local(out[P.armL], out[P.torso], 0.22, 0.47, 0, p.armLx, 0, p.armLz);
  local(out[P.armR], out[P.torso], -0.22, 0.47, 0, p.armRx, 0, p.armRz);
  local(out[P.thighL], out[P.pelvis], 0.1, -0.06, 0, p.thighL - p.pelvisRx, 0, 0.02);
  local(out[P.thighR], out[P.pelvis], -0.1, -0.06, 0, p.thighR - p.pelvisRx, 0, -0.02);
  local(out[P.shinL], out[P.thighL], 0, -0.43, 0, p.shinL, 0, 0);
  local(out[P.shinR], out[P.thighR], 0, -0.43, 0, p.shinR, 0, 0);
}

/** Joint description used by ragdolls: [child, parent, anchor in parent frame]. */
export const JOINTS: [number, number, [number, number, number]][] = [
  [P.torso, P.pelvis, [0, 0.08, 0]],
  [P.head, P.torso, [0, 0.52, 0]],
  [P.armL, P.torso, [0.22, 0.47, 0]],
  [P.armR, P.torso, [-0.22, 0.47, 0]],
  [P.thighL, P.pelvis, [0.1, -0.06, 0]],
  [P.thighR, P.pelvis, [-0.1, -0.06, 0]],
  [P.shinL, P.thighL, [0, -0.43, 0]],
  [P.shinR, P.thighR, [0, -0.43, 0]],
];
