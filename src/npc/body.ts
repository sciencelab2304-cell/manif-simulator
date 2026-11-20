import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { normGeo } from '../world/geom';

/** Body parts, each with its pivot at the joint. Forward = +Z, left = +X. */
export const P = { pelvis: 0, torso: 1, head: 2, armL: 3, armR: 4, thighL: 5, thighR: 6, shinL: 7, shinR: 8 } as const;
export const NPARTS = 9;
/**
 * Accessories: gear and clothes worn on top of the body, each drawn with its own colour. The fun ones (hats, glasses,
 * capes…) have their colours painted in, their instance colour only tints the white areas.
 */
export const ACC = {
  helmet: 0, shield: 1, baton: 2, gun: 3, camera: 4, pack: 5, flag: 6, vest: 7, phone: 8, hair: 9,
  topHat: 10, cowboy: 11, sombrero: 12, party: 13, viking: 14, crown: 15, afro: 16, mohawk: 17, bunny: 18, propeller: 19,
  chef: 20, bicorne: 21, siren: 22, shades: 23, mustache: 24, clownNose: 25, heartGlasses: 26, cape: 27, wings: 28, duck: 29,
} as const;
export const NACC = 30;
/** which part frame each accessory hangs from */
const H = P.head, T = P.torso;
const ACC_PARENT = [H, T, P.armR, P.armR, P.armR, T, T, T, P.armR, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, T, T, T];

export const PELVIS_H = 0.95;

const _c = new THREE.Color();
/** A piece of a mesh, painted with a colour that multiplies the instance colour (white = the instance colour itself). */
function paint(g: THREE.BufferGeometry, hex = 0xffffff) {
  const n = normGeo(g), count = n.attributes.position.count, a = new Float32Array(count * 3);
  _c.setHex(hex).convertSRGBToLinear();
  for (let i = 0; i < count; i++) a.set([_c.r, _c.g, _c.b], i * 3);
  n.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return n;
}
const merge = (...g: THREE.BufferGeometry[]) => mergeGeometries(g);
/** A rounded limb hanging down from its joint: radius r0 at the top, r1 at the bottom, `len` between the two centres. */
function limb(r0: number, r1: number, len: number, seg = 10) {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 4; i++) { const a = -Math.PI / 2 + (i / 4) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.max(1e-3, r1 * Math.cos(a)), -len + r1 * Math.sin(a))); }
  for (let i = 0; i <= 4; i++) { const a = (i / 4) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.max(1e-3, r0 * Math.cos(a)), r0 * Math.sin(a))); }
  return new THREE.LatheGeometry(pts, seg);
}
const ball = (r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, w = 10, h = 8) =>
  new THREE.SphereGeometry(r, w, h).scale(sx, sy, sz).translate(x, y, z);

const SKIN_DARK = 0x262022, LIPS = 0xb07070, BELT = 0x2a2622;

function partGeometries() {
  const g: THREE.BufferGeometry[] = [];
  // hips with a belt
  g[P.pelvis] = merge(
    paint(ball(0.17, 0, 0.0, 0, 1, 0.68, 0.66, 14, 10)),
    paint(new THREE.CylinderGeometry(0.173, 0.168, 0.045, 16, 1, true).scale(1, 1, 0.58).translate(0, 0.075, 0), BELT),
  );
  // chest: waist, ribcage and rounded shoulders
  const prof = [[0.001, -0.02], [0.155, -0.02], [0.15, 0.08], [0.165, 0.2], [0.185, 0.33], [0.18, 0.43], [0.13, 0.52], [0.06, 0.56], [0.001, 0.565]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  g[P.torso] = merge(
    paint(new THREE.LatheGeometry(prof, 16).scale(1.08, 1, 0.6)),
    paint(ball(0.064, 0.18, 0.45, 0, 1, 0.8, 0.95)), paint(ball(0.064, -0.18, 0.45, 0, 1, 0.8, 0.95)),
  );
  // neck, skull, jaw, ears, nose, eyes, brows, mouth
  g[P.head] = merge(
    paint(new THREE.CylinderGeometry(0.047, 0.055, 0.13, 10).translate(0, 0.055, -0.005)),
    paint(ball(0.105, 0, 0.205, 0, 0.9, 1.08, 1, 16, 12)),
    paint(ball(0.08, 0, 0.155, 0.025, 0.95, 0.75, 1, 12, 8)),
    paint(ball(0.025, 0.094, 0.195, -0.005, 0.45, 1, 0.8, 8, 6)), paint(ball(0.025, -0.094, 0.195, -0.005, 0.45, 1, 0.8, 8, 6)),
    paint(new THREE.ConeGeometry(0.018, 0.045, 6).rotateX(Math.PI * 0.62).translate(0, 0.19, 0.105)),
    paint(ball(0.013, 0.036, 0.215, 0.093, 1, 1, 0.7, 8, 6), SKIN_DARK), paint(ball(0.013, -0.036, 0.215, 0.093, 1, 1, 0.7, 8, 6), SKIN_DARK),
    paint(new THREE.BoxGeometry(0.035, 0.008, 0.012).rotateZ(-0.12).translate(0.037, 0.238, 0.094), SKIN_DARK),
    paint(new THREE.BoxGeometry(0.035, 0.008, 0.012).rotateZ(0.12).translate(-0.037, 0.238, 0.094), SKIN_DARK),
    paint(new THREE.BoxGeometry(0.04, 0.008, 0.01).translate(0, 0.152, 0.104), LIPS),
  );
  // sleeve and forearm (the hand is drawn apart, in skin or glove colour)
  const arm = merge(paint(limb(0.058, 0.05, 0.28).translate(0, -0.02, 0)), paint(limb(0.05, 0.04, 0.24).translate(0, -0.33, 0)));
  g[P.armL] = arm; g[P.armR] = arm;
  const thigh = merge(paint(limb(0.085, 0.064, 0.38).translate(0, -0.02, 0)));
  g[P.thighL] = thigh; g[P.thighR] = thigh;
  const shin = merge(paint(limb(0.064, 0.044, 0.36).translate(0, -0.02, 0)));
  g[P.shinL] = shin; g[P.shinR] = shin;
  return g;
}

/** Hands and shoes: parts of their own, coloured by the look (skin or gloves, shoes). */
function endGeometries() {
  const hand = merge(paint(ball(0.045, 0, -0.62, 0.005, 0.8, 1.3, 0.55)), paint(ball(0.018, 0.03, -0.6, 0.025, 1, 1.6, 1, 6, 5)));
  const shoe = merge(
    paint(new THREE.CapsuleGeometry(0.052, 0.14, 4, 10).rotateX(Math.PI / 2).scale(1.05, 0.7, 1).translate(0, -0.415, 0.045)),
    paint(new THREE.BoxGeometry(0.11, 0.022, 0.25).translate(0, -0.445, 0.045), 0x9a9a9a),
  );
  return { hand, shoe };
}

const GOLD = 0xe8c040, BLACK = 0x161616, IVORY = 0xf2e8cc, RED = 0xc8202a;
/** Party hat: a striped cone with a pompom. */
function partyHat() {
  const out: THREE.BufferGeometry[] = [], cols = [0xff4fa0, 0xffd23a, 0x3ab0ff];
  for (let i = 0; i < 4; i++) {
    const r0 = 0.085 * (1 - i / 4), r1 = 0.085 * (1 - (i + 1) / 4);
    out.push(paint(new THREE.CylinderGeometry(Math.max(r1, 0.004), r0, 0.06, 12, 1, true).translate(0, 0.33 + i * 0.06, 0), cols[i % 3]));
  }
  out.push(paint(ball(0.025, 0, 0.57, 0), 0xffffff));
  return merge(...out).translate(0, -0.3, 0).rotateZ(0.2).translate(0, 0.3, 0);
}

function accGeometries() {
  const g: THREE.BufferGeometry[] = [];
  g[ACC.helmet] = merge(
    normGeo(new THREE.SphereGeometry(0.155, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(1, 1, 1.12).translate(0, 0.2, 0)),
    normGeo(new THREE.BoxGeometry(0.26, 0.14, 0.02).translate(0, 0.19, 0.165)),
  );
  g[ACC.shield] = normGeo(new THREE.BoxGeometry(0.58, 1.05, 0.03).translate(-0.1, 0.12, 0.4));
  g[ACC.baton] = normGeo(new THREE.CylinderGeometry(0.018, 0.022, 0.62, 6).rotateX(Math.PI / 2).translate(0, -0.64, 0.25));
  g[ACC.gun] = merge(
    normGeo(new THREE.BoxGeometry(0.07, 0.62, 0.11).translate(0, -0.78, 0.0)),
    normGeo(new THREE.CylinderGeometry(0.03, 0.03, 0.25, 8).translate(0, -1.1, 0)),
  );
  g[ACC.camera] = normGeo(new THREE.BoxGeometry(0.14, 0.18, 0.36).translate(0, -0.6, 0.1));
  g[ACC.pack] = normGeo(new THREE.BoxGeometry(0.3, 0.38, 0.16).translate(0, 0.3, -0.18));
  g[ACC.flag] = merge(
    normGeo(new THREE.CylinderGeometry(0.015, 0.015, 2.6, 5).translate(0.28, 1.0, 0.2)),
    normGeo(new THREE.PlaneGeometry(0.9, 0.6).translate(0.75, 2.0, 0.2)),
  );
  g[ACC.vest] = normGeo(new THREE.LatheGeometry([[0.001, 0.08], [0.17, 0.08], [0.19, 0.3], [0.19, 0.44], [0.12, 0.5], [0.001, 0.5]].map(([r, y]) => new THREE.Vector2(r, y)), 14).scale(1.1, 1, 0.68));
  g[ACC.phone] = normGeo(new THREE.BoxGeometry(0.07, 0.13, 0.01).translate(0, -0.64, 0.05));
  // hair (or a beanie): a cap over the skull, longer at the back
  g[ACC.hair] = merge(
    normGeo(new THREE.SphereGeometry(0.114, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.95, 1.08, 1.06).rotateX(-0.5).translate(0, 0.21, -0.006)),
    normGeo(ball(0.09, 0, 0.17, -0.055, 0.95, 0.75, 0.75)),
  );
  // ---- fun headwear (head frame: skull centre at y 0.2, top at 0.32)
  g[ACC.topHat] = merge(
    paint(new THREE.CylinderGeometry(0.18, 0.18, 0.015, 20).scale(1, 1, 0.9).translate(0, 0.295, 0), BLACK),
    paint(new THREE.CylinderGeometry(0.1, 0.095, 0.2, 18).translate(0, 0.4, 0), BLACK),
    paint(new THREE.CylinderGeometry(0.098, 0.098, 0.035, 18).translate(0, 0.32, 0), 0x9a1414),
  ).rotateX(-0.08);
  g[ACC.cowboy] = merge(
    paint(new THREE.LatheGeometry([[0.001, 0], [0.12, 0], [0.2, 0.01], [0.24, 0.05], [0.24, 0.06], [0.2, 0.025], [0.12, 0.012], [0.001, 0.012]].map(([r, y]) => new THREE.Vector2(r, y)), 20).scale(1, 1, 0.85).translate(0, 0.28, 0)),
    paint(ball(0.11, 0, 0.32, 0, 0.95, 0.85, 1.1, 14, 8)),
    paint(new THREE.CylinderGeometry(0.106, 0.106, 0.025, 16).scale(0.95, 1, 1.1).translate(0, 0.3, 0), 0x3a2414),
  ).rotateX(-0.1);
  g[ACC.sombrero] = merge(
    paint(new THREE.LatheGeometry([[0.001, 0], [0.12, 0], [0.3, -0.015], [0.34, 0.03], [0.345, 0.04], [0.29, 0.002], [0.12, 0.012], [0.001, 0.012]].map(([r, y]) => new THREE.Vector2(r, y)), 24).translate(0, 0.285, 0), 0xe2c070),
    paint(new THREE.CylinderGeometry(0.05, 0.11, 0.2, 16).translate(0, 0.39, 0), 0xe2c070),
    paint(new THREE.CylinderGeometry(0.104, 0.11, 0.03, 16).translate(0, 0.31, 0), 0x1f8a3a),
    paint(new THREE.TorusGeometry(0.315, 0.01, 4, 24).rotateX(Math.PI / 2).translate(0, 0.29, 0), RED),
  );
  g[ACC.party] = partyHat();
  g[ACC.viking] = merge(
    paint(new THREE.SphereGeometry(0.125, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 1, 1.08).translate(0, 0.235, 0), 0x8c9198),
    paint(new THREE.CylinderGeometry(0.128, 0.128, 0.03, 16).scale(1, 1, 1.08).translate(0, 0.24, 0), 0x6a4a2a),
    paint(new THREE.ConeGeometry(0.03, 0.17, 8).rotateZ(-0.9).translate(0.17, 0.32, 0), IVORY),
    paint(new THREE.ConeGeometry(0.03, 0.17, 8).rotateZ(0.9).translate(-0.17, 0.32, 0), IVORY),
  );
  {
    const spikes: THREE.BufferGeometry[] = [paint(new THREE.CylinderGeometry(0.1, 0.095, 0.06, 18, 1, true).translate(0, 0.29, 0), GOLD)];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2, x = Math.sin(a) * 0.098, z = Math.cos(a) * 0.098;
      spikes.push(paint(new THREE.ConeGeometry(0.025, 0.06, 4).translate(x, 0.35, z), GOLD), paint(ball(0.014, x * 1.03, 0.29, z * 1.03, 1, 1, 1, 6, 4), i % 2 ? 0x2a4fd1 : RED));
    }
    g[ACC.crown] = merge(...spikes).translate(0, -0.3, 0).rotateZ(0.12).translate(0, 0.3, 0);
  }
  g[ACC.afro] = merge(paint(ball(0.17, 0, 0.3, -0.07, 1.12, 0.95, 1, 14, 10)));
  g[ACC.mohawk] = merge(...[0.07, 0.03, -0.01, -0.05, -0.09].map((z, i) =>
    paint(new THREE.ConeGeometry(0.03, 0.13 - Math.abs(i - 1.5) * 0.015, 4).scale(0.5, 1, 1.2).rotateX(-0.25 + i * 0.12).translate(0, 0.33, z))));
  g[ACC.bunny] = merge(
    paint(new THREE.TorusGeometry(0.105, 0.008, 4, 20, Math.PI).translate(0, 0.21, 0)),
    paint(ball(0.032, 0.05, 0.4, 0, 1, 3.4, 0.5).rotateZ(-0.15)), paint(ball(0.032, -0.05, 0.4, 0, 1, 3.4, 0.5).rotateZ(0.15)),
    paint(ball(0.018, 0.05, 0.4, 0.01, 1, 4.2, 0.5).rotateZ(-0.15), 0xff9ec4), paint(ball(0.018, -0.05, 0.4, 0.01, 1, 4.2, 0.5).rotateZ(0.15), 0xff9ec4),
  );
  {
    const cap: THREE.BufferGeometry[] = [];
    const cols = [RED, 0xffd23a, 0x2a6bd1, 0x2a9a4a];
    for (let i = 0; i < 4; i++) cap.push(paint(new THREE.SphereGeometry(0.118, 6, 8, (i * Math.PI) / 2, Math.PI / 2, 0, Math.PI * 0.5).translate(0, 0.23, 0), cols[i]));
    cap.push(paint(new THREE.CylinderGeometry(0.09, 0.09, 0.012, 14, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 0.8).translate(0, 0.24, 0.08), RED));
    cap.push(paint(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 5).translate(0, 0.37, 0), 0x777777));
    cap.push(paint(new THREE.BoxGeometry(0.26, 0.006, 0.03).rotateY(0.3).translate(0, 0.4, 0), 0xffd23a));
    g[ACC.propeller] = merge(...cap);
  }
  g[ACC.chef] = merge(
    paint(new THREE.CylinderGeometry(0.105, 0.105, 0.1, 18).translate(0, 0.32, 0)),
    paint(ball(0.13, 0, 0.42, 0, 1, 0.65, 1, 14, 8)),
  );
  g[ACC.bicorne] = merge(
    paint(new THREE.SphereGeometry(0.13, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1.75, 1, 0.42).translate(0, 0.27, 0), BLACK),
    paint(new THREE.CylinderGeometry(0.116, 0.116, 0.03, 16).translate(0, 0.28, 0), BLACK),
    paint(new THREE.CylinderGeometry(0.04, 0.04, 0.008, 12).rotateX(Math.PI / 2).translate(0.1, 0.33, 0.052), 0x1f3a8a),
    paint(new THREE.CylinderGeometry(0.027, 0.027, 0.008, 12).rotateX(Math.PI / 2).translate(0.1, 0.33, 0.056), 0xf2f2f2),
    paint(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 12).rotateX(Math.PI / 2).translate(0.1, 0.33, 0.06), RED),
  );
  g[ACC.siren] = merge(
    paint(new THREE.SphereGeometry(0.125, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 1, 1.1).translate(0, 0.235, 0), 0x1c2638),
    paint(new THREE.CylinderGeometry(0.05, 0.055, 0.03, 12).translate(0, 0.36, 0), 0x333333),
    paint(ball(0.048, 0, 0.38, 0, 1, 1.2, 1, 12, 8), 0x3a8bff),
  );
  // ---- faces
  g[ACC.shades] = merge(
    paint(ball(0.03, 0.04, 0.215, 0.106, 1.2, 0.8, 0.3), BLACK), paint(ball(0.03, -0.04, 0.215, 0.106, 1.2, 0.8, 0.3), BLACK),
    paint(new THREE.BoxGeometry(0.03, 0.008, 0.008).translate(0, 0.222, 0.11), BLACK),
    paint(new THREE.BoxGeometry(0.006, 0.008, 0.11).translate(0.093, 0.218, 0.05), BLACK), paint(new THREE.BoxGeometry(0.006, 0.008, 0.11).translate(-0.093, 0.218, 0.05), BLACK),
  );
  g[ACC.mustache] = merge(
    paint(new THREE.CapsuleGeometry(0.012, 0.04, 3, 6).rotateZ(1.25).translate(0.025, 0.168, 0.105), 0x3a2410),
    paint(new THREE.CapsuleGeometry(0.012, 0.04, 3, 6).rotateZ(-1.25).translate(-0.025, 0.168, 0.105), 0x3a2410),
  );
  g[ACC.clownNose] = merge(paint(ball(0.03, 0, 0.19, 0.118, 1, 1, 1, 10, 8), 0xe8121a));
  g[ACC.heartGlasses] = merge(...[0.045, -0.045].flatMap((x) => [
    paint(ball(0.02, x - 0.013, 0.225, 0.11, 1, 1, 0.35), 0xff3d8f), paint(ball(0.02, x + 0.013, 0.225, 0.11, 1, 1, 0.35), 0xff3d8f),
    paint(new THREE.ConeGeometry(0.03, 0.035, 4).rotateZ(Math.PI).scale(1, 1, 0.3).translate(x, 0.205, 0.11), 0xff3d8f),
  ]), paint(new THREE.BoxGeometry(0.02, 0.006, 0.006).translate(0, 0.228, 0.112), 0xff3d8f));
  // ---- backs (torso frame: shoulders at y 0.47, back at z -0.11)
  g[ACC.cape] = merge(
    paint(new THREE.BoxGeometry(0.44, 0.95, 0.012).translate(0, -0.475, 0).rotateX(0.12).translate(0, 0.52, -0.13)),
    paint(new THREE.BoxGeometry(0.3, 0.05, 0.16).translate(0, 0.52, -0.02), GOLD),
  );
  g[ACC.wings] = merge(...[1, -1].flatMap((s) => [
    paint(ball(0.11, 0, 0.17, 0, 1, 2.2, 0.16, 12, 8).rotateZ(s * -0.9).translate(s * 0.08, 0.44, -0.15)),
    paint(ball(0.08, 0, 0.12, 0, 1, 2.2, 0.16, 10, 8).rotateZ(s * -1.5).translate(s * 0.08, 0.36, -0.16)),
    paint(ball(0.06, 0, 0.08, 0, 1, 2.2, 0.16, 10, 8).rotateZ(s * -2.1).translate(s * 0.08, 0.3, -0.17)),
  ]));
  g[ACC.duck] = merge(
    paint(new THREE.TorusGeometry(0.25, 0.075, 8, 20).scale(1, 0.7, 1).rotateX(Math.PI / 2).translate(0, 0.03, 0), 0xffd21a),
    paint(ball(0.07, 0, 0.13, 0.27), 0xffd21a),
    paint(new THREE.ConeGeometry(0.03, 0.07, 6).rotateX(Math.PI / 2).scale(1, 0.5, 1).translate(0, 0.12, 0.35), 0xff8a1a),
    paint(ball(0.011, 0.03, 0.15, 0.325, 1, 1, 1, 6, 4), BLACK), paint(ball(0.011, -0.03, 0.15, 0.325, 1, 1, 1, 6, 4), BLACK),
  );
  return g;
}

/** Accessories that hide the hair under them. */
export const COVERS_HAIR: number[] = [ACC.helmet, ACC.afro, ACC.mohawk, ACC.viking, ACC.siren, ACC.propeller];

export interface BodyLook {
  skin: THREE.Color; top: THREE.Color; pants: THREE.Color; hands: THREE.Color; shoes: THREE.Color;
  acc: THREE.Color[]; // per accessory colour
  acc_on: boolean[];
  size: number; // overall scale (height and build vary from person to person)
}

/**
 * Renders every humanoid with one InstancedMesh per part (instancing = a handful of draw calls for 200+ people).
 */
export class BodyRenderer {
  parts: THREE.InstancedMesh[] = [];
  accs: THREE.InstancedMesh[] = [];
  /** hands and shoes: [mesh, part it hangs from, hands or shoes] */
  private ends: [THREE.InstancedMesh, number, 'hands' | 'shoes'][] = [];
  private n = new Array(NPARTS).fill(0);
  private na = new Array(NACC).fill(0);
  private tmp = new THREE.Matrix4();
  private col = new THREE.Color();

  constructor(scene: THREE.Scene, cap: number, shadows: boolean) {
    const make = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color());
      m.castShadow = shadows; m.receiveShadow = true;
      m.frustumCulled = false; m.count = 0;
      scene.add(m);
      return m;
    };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, vertexColors: true });
    this.parts = partGeometries().map((geo) => make(geo, mat));
    const { hand, shoe } = endGeometries();
    const shoeMat = new THREE.MeshStandardMaterial({ roughness: 0.6, vertexColors: true });
    this.ends = [[make(hand, mat), P.armL, 'hands'], [make(hand, mat), P.armR, 'hands'], [make(shoe, shoeMat), P.shinL, 'shoes'], [make(shoe, shoeMat), P.shinR, 'shoes']];
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
    const fun = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05, vertexColors: true });
    this.accs = accGeometries().map((geo, i) => make(geo, accMats[i] ?? fun));
    this.accs[ACC.shield].castShadow = false;
    this.accs[ACC.shield].renderOrder = 5;
  }

  begin() { this.n.fill(0); this.na.fill(0); for (const [m] of this.ends) m.count = 0; }

  add(mats: THREE.Matrix4[], look: BodyLook, bloodTint: number, hidden?: boolean) {
    if (hidden) return;
    for (let i = 0; i < NPARTS; i++) {
      const m = this.parts[i], k = this.n[i]++;
      m.setMatrixAt(k, mats[i]);
      let c = i === P.head ? look.skin : i === P.torso || i === P.armL || i === P.armR ? look.top : look.pants;
      if (bloodTint > 0 && (i === P.head || i === P.torso)) { this.col.copy(c).lerp(BLOOD, bloodTint * (i === P.head ? 0.9 : 0.6)); c = this.col; }
      m.setColorAt(k, c);
    }
    for (const [m, part, c] of this.ends) { const k = m.count++; m.setMatrixAt(k, mats[part]); m.setColorAt(k, look[c]); }
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
    for (const [m] of this.ends) this.flush(m, m.count);
  }
  private flush(m: THREE.InstancedMesh, n: number) {
    m.count = n;
    m.visible = n > 0; // most accessories are worn by nobody: no draw call for them
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
