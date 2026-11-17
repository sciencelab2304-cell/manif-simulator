import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ctx } from '../core/context';
import { RAPIER, G, groups } from '../core/physics';
import * as T from '../core/textures';
import { mulberry32 } from '../core/util';
import { GeoBuilder, normGeo } from './geom';
import * as L from './layout';

export interface Circle { x: number; z: number; r: number }
export interface Box { x: number; z: number; hx: number; hz: number; id?: number }
export interface PickupSpot { x: number; y: number; z: number; kind: string }

const SHOPS = [
  'BOULANGERIE MERCIER', 'PHARMACIE DU CENTRE', 'TABAC · PRESSE', 'BRASSERIE LE ZINC', 'OPTIQUE LUMIÈRE', 'BANQUE DES TANNEURS',
  'FLEURS & CIE', 'LIBRAIRIE LA PLUME', 'CAFÉ DE LA GARE', 'BOUCHERIE ROUX', 'AGENCE IMMOBILIÈRE', 'PRIMEUR', 'CORDONNERIE',
  'BAZAR DU COIN', 'TÉLÉPHONIE PLUS', 'ASSURANCES VALBRUNE', 'BIJOUTERIE ORLANE', 'LAVERIE', 'SUPÉRETTE', 'CRÊPERIE',
];
const STONES = ['#cfc3a9', '#d6ccb6', '#c8bba0', '#ddd2bc'];
const CAR_COLORS = [0x8c1d18, 0x1c2a44, 0xd8d8d2, 0x2b2b2b, 0x6d7275, 0x29452f, 0xb9b3a6, 0x3a5a7a, 0x4a2d1f, 0xe0dccf];

export function groundY(x: number, z: number) {
  const ax = Math.abs(x);
  if (ax > L.ROAD_HALF && ax < L.FACADE_X && z > L.AVE_END && z < L.AVE_START && !(z < L.CROSS_Z0 && z > L.CROSS_Z1)) return 0.12;
  return 0;
}

export class City {
  root = new THREE.Group();
  circles: Circle[] = [];
  boxes: Box[] = [];
  pickupSpots: PickupSpot[] = [];
  paveSpots: THREE.Vector3[] = []; // infinite cobble piles
  buildingRects: { x0: number; x1: number; z0: number; z1: number }[] = [];
  lampBulbs!: THREE.InstancedMesh;
  lampPools!: THREE.InstancedMesh;
  facadeMats: THREE.MeshStandardMaterial[] = [];
  vanLights: THREE.Mesh[] = [];
  vans: THREE.Vector3[] = [];
  morris: THREE.Vector3[] = [];
  rnd = mulberry32(1234);

  // materials shared with other modules
  burntMat = new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 1, metalness: 0.2 });
  burntGlass = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 });

  build() {
    const scene = ctx.scene;
    scene.add(this.root);
    this.ground();
    this.buildings();
    this.streetFurniture();
    this.parkedCars();
    this.busShelters();
    this.chantier();
    this.terrace();
    this.place();
    this.policeVans();
    this.bins();
  }

  // ------------------------------------------------------------------ ground
  private ground() {
    const P = ctx.physics;
    // physics: one huge slab + raised sidewalks
    P.addStaticBox(0, -0.5, -120, 200, 0.5, 220);
    const asp = T.asphalt(), side = T.sidewalk(), cob = T.cobbles();
    const roadMat = new THREE.MeshStandardMaterial({ map: asp.map, normalMap: asp.normal, roughness: 0.92, metalness: 0 });
    asp.map.repeat.set(1, 1); asp.normal.repeat.set(1, 1);
    const sideMat = new THREE.MeshStandardMaterial({ map: side.map, normalMap: side.normal, roughness: 0.85, color: 0xd8d4cc });
    const cobMat = new THREE.MeshStandardMaterial({ map: cob.map, normalMap: cob.normal, roughness: 0.8, normalScale: new THREE.Vector2(1.2, 1.2) });

    const roadG = new GeoBuilder();
    const flat = (g: GeoBuilder, x0: number, x1: number, z0: number, z1: number, y: number, s: number) => {
      const V = (x: number, z: number) => new THREE.Vector3(x, y, z);
      g.quad(V(x0, z1), V(x1, z1), V(x1, z0), V(x0, z0), [x0 / s, z1 / s], [x1 / s, z1 / s], [x1 / s, z0 / s], [x0 / s, z0 / s]);
    };
    flat(roadG, -L.ROAD_HALF, L.ROAD_HALF, L.AVE_END, L.AVE_START, 0, 8);
    flat(roadG, -L.CROSS_HALF_X, -L.ROAD_HALF, L.CROSS_Z1, L.CROSS_Z0, 0, 8);
    flat(roadG, L.ROAD_HALF, L.CROSS_HALF_X, L.CROSS_Z1, L.CROSS_Z0, 0, 8);
    const road = new THREE.Mesh(roadG.build(), roadMat); road.receiveShadow = true; this.root.add(road);

    // sidewalks with curbs
    const sideG = new GeoBuilder();
    const segs: [number, number][] = [[L.CROSS_Z0, L.AVE_START], [L.AVE_END, L.CROSS_Z1]];
    for (const s of [-1, 1]) for (const [z0, z1] of segs) {
      const x0 = s < 0 ? -L.FACADE_X : L.ROAD_HALF, x1 = s < 0 ? -L.ROAD_HALF : L.FACADE_X;
      sideG.box(x0, x1, 0, 0.12, z0, z1, 4, 4, true);
      P.addStaticBox((x0 + x1) / 2, 0.06, (z0 + z1) / 2, (x1 - x0) / 2, 0.06, (z1 - z0) / 2);
    }
    const sideMesh = new THREE.Mesh(sideG.build(), sideMat); sideMesh.receiveShadow = true; this.root.add(sideMesh);

    const placeG = new GeoBuilder();
    flat(placeG, -L.PLACE_HALF_X, L.PLACE_HALF_X, L.PLACE_Z1, L.PLACE_Z0, 0.001, 6);
    const placeMesh = new THREE.Mesh(placeG.build(), cobMat); placeMesh.receiveShadow = true; this.root.add(placeMesh);

    // road markings
    const mark = new GeoBuilder();
    const strip = (x0: number, x1: number, z0: number, z1: number) => flat(mark, x0, x1, z0, z1, 0.012, 1);
    for (let z = L.AVE_START - 4; z > L.AVE_END + 4; z -= 9) {
      if (z < L.CROSS_Z0 + 8 && z > L.CROSS_Z1 - 8) continue;
      strip(-0.08, 0.08, z - 4.5, z);
      strip(-4.08, -3.92, z - 3, z); strip(3.92, 4.08, z - 3, z);
    }
    for (const zc of [L.CROSS_Z0 + 4, L.CROSS_Z1 - 4, L.AVE_END + 3]) {
      for (let x = -7.5; x < 7.5; x += 1.2) strip(x, x + 0.6, zc - 2, zc + 2);
    }
    const markMesh = new THREE.Mesh(mark.build(), new THREE.MeshStandardMaterial({ color: 0xd9d6cc, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1 }));
    markMesh.receiveShadow = true; this.root.add(markMesh);
  }

  // ------------------------------------------------------------------ buildings
  private buildings() {
    const facades = STONES.map((c, i) => T.facadeTextures(c, 100 + i));
    this.facadeMats = facades.map((f) => new THREE.MeshStandardMaterial({
      map: f.map, emissiveMap: f.emissive, emissive: new THREE.Color(1, 0.85, 0.6), emissiveIntensity: 0, roughness: 0.85, metalness: 0,
    }));
    const mansardMat = new THREE.MeshStandardMaterial({ map: T.mansardTexture(), roughness: 0.55, metalness: 0.45 });
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xd2c8b2, roughness: 0.9 });
    const railMat = new THREE.MeshStandardMaterial({ map: T.railTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6, color: 0x222222 });
    const facadeGeos: THREE.BufferGeometry[][] = facades.map(() => []);
    const mansardGeos: THREE.BufferGeometry[] = [], stoneGeos: THREE.BufferGeometry[] = [], railGeos: THREE.BufferGeometry[] = [];
    const H = 4.6 + 5 * 3.1; // 20.1 m

    type Face = 'px' | 'nx' | 'pz' | 'nz';
    const shopFaces: { x0: number; x1: number; z0: number; z1: number; face: Face }[] = [];

    const building = (x0: number, x1: number, z0: number, z1: number, street: Face[], shops: boolean) => {
      const k = Math.floor(this.rnd() * facades.length);
      const g = new GeoBuilder();
      g.box(x0, x1, 0, H, z0, z1, T.FACADE_W, T.FACADE_H, true);
      facadeGeos[k].push(g.build());
      const m = new GeoBuilder();
      m.mansard(x0 + 0.2, x1 - 0.2, z0 + 0.2, z1 - 0.2, H, 3.6, 2.2, 12);
      mansardGeos.push(m.build());
      const s = new GeoBuilder();
      s.box(x0 - 0.35, x1 + 0.35, H - 0.45, H, z0 - 0.35, z1 + 0.35, 2, 2, true, true); // cornice
      s.box(x0 - 0.15, x1 + 0.15, 4.45, 4.7, z0 - 0.15, z1 + 0.15, 2, 2, true, true); // string course above shops
      // chimneys
      const nCh = 1 + Math.floor(this.rnd() * 3);
      for (let i = 0; i < nCh; i++) {
        const cx = x0 + 2.5 + this.rnd() * (x1 - x0 - 5), cz = z0 + 2.5 + this.rnd() * (z1 - z0 - 5);
        s.box(cx - 0.5, cx + 0.5, H + 2, H + 5.2, cz - 0.3, cz + 0.3, 2, 2, true);
      }
      // balconies on the 2nd and 5th floors of street faces
      for (const f of street) {
        for (const by of [4.6 + 3.1, 4.6 + 4 * 3.1]) {
          const d = 0.75;
          const r = new GeoBuilder();
          if (f === 'px' || f === 'nx') {
            const xf = f === 'px' ? x1 : x0, xo = f === 'px' ? x1 + d : x0 - d;
            s.box(Math.min(xf, xo), Math.max(xf, xo), by - 0.18, by, z0 + 0.2, z1 - 0.2, 2, 2, true, true);
            const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
            r.quad(V(xo, by, z0 + 0.2), V(xo, by, z1 - 0.2), V(xo, by + 1, z1 - 0.2), V(xo, by + 1, z0 + 0.2), [0, 0], [(z1 - z0) / 4, 0], [(z1 - z0) / 4, 1], [0, 1]);
          } else {
            const zf = f === 'pz' ? z1 : z0, zo = f === 'pz' ? z1 + d : z0 - d;
            s.box(x0 + 0.2, x1 - 0.2, by - 0.18, by, Math.min(zf, zo), Math.max(zf, zo), 2, 2, true, true);
            const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
            r.quad(V(x0 + 0.2, by, zo), V(x1 - 0.2, by, zo), V(x1 - 0.2, by + 1, zo), V(x0 + 0.2, by + 1, zo), [0, 0], [(x1 - x0) / 4, 0], [(x1 - x0) / 4, 1], [0, 1]);
          }
          railGeos.push(r.build());
        }
        if (shops) shopFaces.push({ x0, x1, z0, z1, face: f });
      }
      stoneGeos.push(s.build());
      ctx.physics.addStaticBox((x0 + x1) / 2, H / 2, (z0 + z1) / 2, (x1 - x0) / 2, H / 2, (z1 - z0) / 2);
      this.buildingRects.push({ x0, x1, z0, z1 });
    };

    const strip = (x0: number, x1: number, zA: number, zB: number, street: Face[], shops: boolean) => {
      let z = zA;
      while (z < zB - 0.01) {
        let w = 12 + Math.floor(this.rnd() * 4) * 3;
        if (zB - (z + w) < 9) w = zB - z;
        building(x0, x1, z, z + w, street, shops);
        z += w;
      }
    };
    const D = 16;
    // avenue blocks (left side faces +X, right side faces -X)
    strip(-L.FACADE_X - D, -L.FACADE_X, L.CROSS_Z0, L.AVE_START, ['px'], true);
    strip(-L.FACADE_X - D, -L.FACADE_X, L.AVE_END, L.CROSS_Z1, ['px'], true);
    strip(L.FACADE_X, L.FACADE_X + D, L.CROSS_Z0, L.AVE_START, ['nx'], true);
    strip(L.FACADE_X, L.FACADE_X + D, L.AVE_END, L.CROSS_Z1, ['nx'], true);
    // closing facade at the north end
    building(-L.FACADE_X - D, L.FACADE_X + D, L.AVE_START, L.AVE_START + 14, ['nz'], false);
    // cross street
    for (const s of [-1, 1]) {
      const a = L.FACADE_X + D, b = L.CROSS_HALF_X;
      const x0 = s < 0 ? -b : a, x1 = s < 0 ? -a : b;
      building(x0, x1, L.CROSS_Z0, L.CROSS_Z0 + 14, ['nz'], false);
      building(x0, x1, L.CROSS_Z1 - 14, L.CROSS_Z1, ['pz'], false);
      const ex0 = s < 0 ? -b - 14 : b, ex1 = s < 0 ? -b : b + 14;
      building(ex0, ex1, L.CROSS_Z1 - 14, L.CROSS_Z0 + 14, [s < 0 ? 'px' : 'nx'], false);
    }
    // place
    for (const s of [-1, 1]) {
      const a = L.FACADE_X + D, b = L.PLACE_HALF_X + 16;
      const x0 = s < 0 ? -b : a, x1 = s < 0 ? -a : b;
      building(x0, x1, L.PLACE_Z0, L.PLACE_Z0 + 16, ['nz'], true);
      const sx0 = s < 0 ? -L.PLACE_HALF_X - 16 : L.PLACE_HALF_X, sx1 = s < 0 ? -L.PLACE_HALF_X : L.PLACE_HALF_X + 16;
      strip(sx0, sx1, L.PLACE_Z1, L.PLACE_Z0, [s < 0 ? 'px' : 'nx'], true);
    }
    // the place's back facade (city hall-ish)
    strip(-L.PLACE_HALF_X - 16, L.PLACE_HALF_X + 16, L.PLACE_Z1 - 16, L.PLACE_Z1, ['pz'], false);
    // fill behind the cross-street blocks so the skyline has no holes
    for (const s of [-1, 1]) {
      const a = L.FACADE_X + D;
      building(s < 0 ? -a - 30 : a, s < 0 ? -a : a + 30, L.CROSS_Z0 + 14, L.AVE_START, [], false);
      building(s < 0 ? -a - 30 : a, s < 0 ? -a : a + 30, L.AVE_END + 16, L.CROSS_Z1 - 14, [], false);
    }

    const add = (geos: THREE.BufferGeometry[], mat: THREE.Material, shadow = true) => {
      if (!geos.length) return;
      const m = new THREE.Mesh(mergeGeometries(geos.map(normGeo)), mat);
      m.castShadow = shadow; m.receiveShadow = true;
      this.root.add(m);
    };
    facadeGeos.forEach((gs, i) => add(gs, this.facadeMats[i]));
    add(mansardGeos, mansardMat);
    add(stoneGeos, stoneMat);
    add(railGeos, railMat, false);

    this.shops(shopFaces);
  }

  /** Shop windows (breakable), signs and awnings. */
  private shops(faces: { x0: number; x1: number; z0: number; z1: number; face: 'px' | 'nx' | 'pz' | 'nz' }[]) {
    const awningCols = ['#7d1f1f', '#1f4d2f', '#203a5c', '#6b5a2a', '#5a1f4d'];
    const awnMats = awningCols.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, side: THREE.DoubleSide }));
    const panes: { pos: THREE.Vector3; yaw: number; w: number; h: number; normal: THREE.Vector3 }[] = [];
    let si = 0;
    for (const f of faces) {
      // origin (u=0) and right vector consistent with GeoBuilder.box UVs
      let O: THREE.Vector3, R: THREE.Vector3, N: THREE.Vector3, len: number;
      switch (f.face) {
        case 'px': O = new THREE.Vector3(f.x1, 0, f.z1); R = new THREE.Vector3(0, 0, -1); N = new THREE.Vector3(1, 0, 0); len = f.z1 - f.z0; break;
        case 'nx': O = new THREE.Vector3(f.x0, 0, f.z0); R = new THREE.Vector3(0, 0, 1); N = new THREE.Vector3(-1, 0, 0); len = f.z1 - f.z0; break;
        case 'pz': O = new THREE.Vector3(f.x0, 0, f.z1); R = new THREE.Vector3(1, 0, 0); N = new THREE.Vector3(0, 0, 1); len = f.x1 - f.x0; break;
        default: O = new THREE.Vector3(f.x1, 0, f.z0); R = new THREE.Vector3(-1, 0, 0); N = new THREE.Vector3(0, 0, -1); len = f.x1 - f.x0; break;
      }
      const yaw = Math.atan2(N.x, N.z);
      const gy = groundY(O.x + N.x * 0.5, O.z + N.z * 0.5);
      const bays = Math.floor(len / 3);
      for (let b = 0; b < bays; b++) {
        const c = O.clone().addScaledVector(R, b * 3 + 1.5).addScaledVector(N, 0.04);
        c.y = 1.925;
        panes.push({ pos: c, yaw, w: 2.3, h: 3.35, normal: N.clone() });
        // awnings on some bays
        if (this.rnd() < 0.3) {
          const aw = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.3), awnMats[Math.floor(this.rnd() * awnMats.length)]);
          aw.position.copy(O).addScaledVector(R, b * 3 + 1.5).addScaledVector(N, 0.6); aw.position.y = 3.75;
          aw.rotation.set(0, yaw, 0); aw.rotateX(-Math.PI / 2 + 0.45);
          aw.castShadow = true;
          this.root.add(aw);
        }
      }
      // sign
      const name = SHOPS[si++ % SHOPS.length];
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(len - 1, 7), 0.42),
        new THREE.MeshStandardMaterial({ map: T.signTexture(name, '#1a1714', '#e6d3a3'), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 }));
      sign.material.emissiveMap = sign.material.map;
      sign.position.copy(O).addScaledVector(R, len / 2).addScaledVector(N, 0.06); sign.position.y = 4.2;
      sign.rotation.y = yaw;
      this.root.add(sign);
      this.signs.push(sign.material);
      void gy;
    }
    ctx.destruction.createWindows(panes);
  }
  signs: THREE.MeshStandardMaterial[] = [];

  // ------------------------------------------------------------------ furniture
  private streetFurniture() {
    const trunkPos: THREE.Vector3[] = [];
    const lampPos: { p: THREE.Vector3; side: number }[] = [];
    const bollards: THREE.Vector3[] = [];
    for (const s of [-1, 1]) {
      for (let z = L.AVE_START - 6; z > L.AVE_END + 4; z -= 9) {
        if (z < L.CROSS_Z0 + 3 && z > L.CROSS_Z1 - 3) continue;
        if (s < 0 && z < -55 && z > -76) continue; // construction site
        if (s > 0 && z < 2 && z > -18) continue; // terrace
        trunkPos.push(new THREE.Vector3(s * 11.3, 0.12, z));
      }
      for (let z = L.AVE_START - 10; z > L.AVE_END + 2; z -= 18) {
        if (z < L.CROSS_Z0 + 2 && z > L.CROSS_Z1 - 2) continue;
        lampPos.push({ p: new THREE.Vector3(s * 8.55, 0.12, z), side: s });
      }
      for (let z = L.AVE_START - 2; z > L.AVE_END + 2; z -= 2.2) {
        if (z < L.CROSS_Z0 + 1 && z > L.CROSS_Z1 - 1) continue;
        if (Math.abs(((z % 18) + 18) % 18 - 4) < 1.2) continue;
        bollards.push(new THREE.Vector3(s * 8.3, 0.12, z));
      }
    }
    // trees around the place
    for (let x = -45; x <= 45; x += 10) for (const z of [-208, -282]) if (Math.abs(x) > 12) trunkPos.push(new THREE.Vector3(x, 0, z));
    for (let z = -215; z > -280; z -= 11) for (const x of [-47, 47]) trunkPos.push(new THREE.Vector3(x, 0, z));
    // place lamps
    for (const [x, z] of [[-14, -215], [14, -215], [-14, -280], [14, -280], [-30, -248], [30, -248], [0, -215]]) lampPos.push({ p: new THREE.Vector3(x, 0, z), side: 0 });

    // trees (plane trees in autumn)
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 6.5, 8).translate(0, 3.25, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a7362, roughness: 0.95 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trunkPos.length);
    const canopyGeo = new THREE.IcosahedronGeometry(1, 2);
    const p = canopyGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      v.multiplyScalar(1 + (Math.sin(v.x * 5.1) * Math.cos(v.z * 4.3) + Math.sin(v.y * 6.7)) * 0.12);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    canopyGeo.computeVertexNormals();
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, trunkPos.length * 3);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const autumn = [0x8a7a2a, 0x9c6a24, 0x6f7a2e, 0xa5812f, 0x7c5e22];
    trunkPos.forEach((tp, i) => {
      m.makeTranslation(tp.x, tp.y, tp.z); trunks.setMatrixAt(i, m);
      for (let k = 0; k < 3; k++) {
        q.setFromEuler(new THREE.Euler(this.rnd(), this.rnd() * 6, this.rnd()));
        sc.set(1.9 + this.rnd(), 1.4 + this.rnd() * 0.6, 1.9 + this.rnd());
        m.compose(new THREE.Vector3(tp.x + (this.rnd() - 0.5) * 2, tp.y + 6.2 + this.rnd() * 1.6, tp.z + (this.rnd() - 0.5) * 2), q, sc);
        canopies.setMatrixAt(i * 3 + k, m);
        canopies.setColorAt(i * 3 + k, new THREE.Color(autumn[Math.floor(this.rnd() * autumn.length)]));
      }
      ctx.physics.addStaticCylinder(tp.x, tp.y + 2, tp.z, 2, 0.25);
      this.circles.push({ x: tp.x, z: tp.z, r: 0.5 });
    });
    trunks.castShadow = true; trunks.receiveShadow = true;
    canopies.castShadow = true; canopies.receiveShadow = true;
    this.root.add(trunks, canopies);
    // tree grates
    const grate = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.6, metalness: 0.5 }), trunkPos.length);
    trunkPos.forEach((tp, i) => { m.makeTranslation(tp.x, tp.y + 0.015, tp.z); grate.setMatrixAt(i, m); });
    grate.receiveShadow = true; this.root.add(grate);

    // lamps
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x1f2a24, roughness: 0.5, metalness: 0.7 });
    const poleGeo = mergeGeometries([
      normGeo(new THREE.CylinderGeometry(0.07, 0.12, 6, 8).translate(0, 3, 0)),
      normGeo(new THREE.CylinderGeometry(0.18, 0.22, 0.6, 8).translate(0, 0.3, 0)),
      normGeo(new THREE.BoxGeometry(0.06, 0.06, 1.2).translate(0, 5.9, 0.55)),
      normGeo(new THREE.CylinderGeometry(0.12, 0.3, 0.45, 6).translate(0, 5.75, 1.1)),
    ]);
    const poles = new THREE.InstancedMesh(poleGeo, lampMat, lampPos.length);
    const bulbGeo = new THREE.SphereGeometry(0.16, 8, 6).translate(0, 5.5, 1.1);
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffc070, emissiveIntensity: 0 });
    this.lampBulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, lampPos.length);
    const poolMat = new THREE.MeshBasicMaterial({ map: T.puddleTexture(), color: 0xffb060, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3 });
    this.lampPools = new THREE.InstancedMesh(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), poolMat, lampPos.length);
    this.lampPools.renderOrder = 3;
    lampPos.forEach((l, i) => {
      const yaw = l.side === 0 ? 0 : l.side > 0 ? -Math.PI / 2 : Math.PI / 2;
      m.makeRotationY(yaw).setPosition(l.p); poles.setMatrixAt(i, m); this.lampBulbs.setMatrixAt(i, m);
      const off = new THREE.Vector3(0, 0, 1.1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      m.makeTranslation(l.p.x + off.x, 0.04, l.p.z + off.z); this.lampPools.setMatrixAt(i, m);
      ctx.physics.addStaticCylinder(l.p.x, 3, l.p.z, 3, 0.15);
      this.circles.push({ x: l.p.x, z: l.p.z, r: 0.35 });
    });
    poles.castShadow = true;
    this.root.add(poles, this.lampBulbs, this.lampPools);

    // bollards
    const bol = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.07, 0.9, 8).translate(0, 0.45, 0), lampMat, bollards.length);
    bollards.forEach((b, i) => { m.makeTranslation(b.x, b.y, b.z); bol.setMatrixAt(i, m); ctx.physics.addStaticCylinder(b.x, 0.5, b.z, 0.45, 0.08); });
    bol.castShadow = true; this.root.add(bol);

    // Morris columns (posters)
    const posterC = T.canvas(512, 256), pg = posterC.getContext('2d')!;
    const pc = ['#c94a2c', '#2f5e8a', '#e2c044', '#2c2c2c', '#9a2f6b', '#e8e2d0', '#3f7a4a'];
    for (let i = 0; i < 16; i++) { pg.fillStyle = pc[i % pc.length]; pg.fillRect((i % 8) * 64, Math.floor(i / 8) * 128, 62, 126);
      pg.fillStyle = 'rgba(255,255,255,0.8)'; pg.font = 'bold 14px sans-serif'; pg.fillText(['CONCERT', 'THÉÂTRE', 'EXPO', 'CIRQUE'][i % 4], (i % 8) * 64 + 4, Math.floor(i / 8) * 128 + 30); }
    const posterTex = new THREE.CanvasTexture(posterC); posterTex.colorSpace = THREE.SRGBColorSpace; posterTex.wrapS = THREE.RepeatWrapping;
    for (const [x, z] of [[-11.5, 18], [11.5, -112]]) {
      const col = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 2.6, 20, 1, true), new THREE.MeshStandardMaterial({ map: posterTex, roughness: 0.8 }));
      body.position.y = 1.5;
      const capM = new THREE.MeshStandardMaterial({ color: 0x1f3a2a, roughness: 0.5, metalness: 0.5 });
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.8, 0.6, 20), capM); cap.position.y = 3.1;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.25, 20), capM); base.position.y = 0.12;
      col.add(body, cap, base); col.position.set(x, 0.12, z);
      col.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      this.root.add(col);
      ctx.physics.addStaticCylinder(x, 1.6, z, 1.6, 0.7);
      this.circles.push({ x, z, r: 1 });
    }
  }

  // ------------------------------------------------------------------ cars
  static carGeometry() {
    const lower = new THREE.Shape();
    lower.moveTo(0, 0.3); lower.lineTo(4.2, 0.3); lower.lineTo(4.25, 0.75); lower.lineTo(3.85, 0.98);
    lower.lineTo(1.4, 0.98); lower.lineTo(0.15, 0.82); lower.lineTo(0, 0.65); lower.closePath();
    const cabin = new THREE.Shape();
    cabin.moveTo(1.45, 0.97); cabin.lineTo(3.75, 0.97); cabin.lineTo(3.45, 1.42); cabin.lineTo(2.15, 1.45); cabin.closePath();
    const ex = (s: THREE.Shape, d: number) => new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2, curveSegments: 2 })
      .translate(-2.1, 0, -d / 2).rotateY(Math.PI / 2);
    const body = ex(lower, 1.66);
    const glass = ex(cabin, 1.5);
    const wheels: THREE.BufferGeometry[] = [];
    for (const zz of [-1.3, 1.3]) for (const xx of [-0.82, 0.82]) wheels.push(normGeo(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 14).rotateZ(Math.PI / 2).translate(xx, 0.32, zz)));
    const lights = mergeGeometries([
      normGeo(new THREE.BoxGeometry(0.35, 0.12, 0.05).translate(-0.55, 0.72, -2.13)), normGeo(new THREE.BoxGeometry(0.35, 0.12, 0.05).translate(0.55, 0.72, -2.13)),
    ]);
    return mergeGeometries([normGeo(body), normGeo(glass), mergeGeometries(wheels), normGeo(lights)], true);
  }

  private parkedCars() {
    const geo = City.carGeometry();
    const glass = new THREE.MeshStandardMaterial({ color: 0x0d1418, roughness: 0.05, metalness: 0.9 });
    const tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
    const lightM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0d0, emissiveIntensity: 0.2 });
    for (const s of [-1, 1]) {
      let z = L.AVE_START - 8;
      while (z > L.CRS_LINE_Z + 12) {
        if (z < L.CROSS_Z0 + 6 && z > L.CROSS_Z1 - 6) { z -= 6; continue; }
        if (this.rnd() < 0.25) { z -= 4 + this.rnd() * 4; continue; }
        const paint = new THREE.MeshStandardMaterial({ color: CAR_COLORS[Math.floor(this.rnd() * CAR_COLORS.length)], roughness: 0.32, metalness: 0.55 });
        const car = new THREE.Mesh(geo, [paint, glass, tire, lightM]);
        const x = s * 6.95;
        car.position.set(x, 0, z);
        car.rotation.y = s > 0 ? Math.PI : 0;
        car.castShadow = true; car.receiveShadow = true;
        this.root.add(car);
        const col = ctx.physics.addStaticBox(x, 0.75, z, 0.9, 0.75, 2.15);
        const id = this.boxes.length;
        this.boxes.push({ x, z, hx: 1.05, hz: 2.3, id });
        ctx.destruction.registerBurnable({ kind: 'car', obj: car, pos: new THREE.Vector3(x, 0.6, z), radius: 2.4, value: 18000, collider: col });
        z -= 5.6 + this.rnd() * 1.2;
      }
    }
  }

  // ------------------------------------------------------------------ shelters
  private busShelters() {
    const frameM = new THREE.MeshStandardMaterial({ color: 0x2d3a33, roughness: 0.4, metalness: 0.7 });
    const roofM = new THREE.MeshStandardMaterial({ color: 0x9aa6a0, roughness: 0.3, metalness: 0.4, transparent: true, opacity: 0.85 });
    const adM = new THREE.MeshStandardMaterial({ map: T.signTexture('VALBRUNE · VILLE LUMIÈRE', '#273a6b', '#f1e6c8', 512, 128), emissive: 0xffffff, emissiveIntensity: 0.0 });
    adM.emissiveMap = adM.map;
    for (const [x, z, yaw] of [[-10.9, 8, Math.PI / 2], [10.9, -42, -Math.PI / 2]] as [number, number, number][]) {
      const g = new THREE.Group();
      const W = 4.2, D = 1.5, H = 2.5;
      for (const px of [-W / 2, W / 2]) for (const pz of [-D / 2, D / 2]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, H, 0.08), frameM); post.position.set(px, H / 2, pz); g.add(post);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.08, D + 0.3), roofM); roof.position.y = H; g.add(roof);
      const ad = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.8), adM); ad.position.set(W / 2 + 0.01, 1.3, 0); ad.rotation.y = Math.PI / 2; g.add(ad);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.08, 0.4), frameM); bench.position.set(0, 0.5, -D / 2 + 0.3); g.add(bench);
      g.position.set(x, 0.12, z); g.rotation.y = yaw;
      g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      this.root.add(g);
      // glass panels (back and side) are breakable windows
      g.updateMatrixWorld(true);
      const panes: { pos: THREE.Vector3; yaw: number; w: number; h: number; normal: THREE.Vector3 }[] = [];
      const back = new THREE.Vector3(0, 1.3, -D / 2).applyMatrix4(g.matrixWorld);
      const nBack = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      panes.push({ pos: back, yaw, w: W - 0.1, h: 2.2, normal: nBack });
      const side = new THREE.Vector3(-W / 2, 1.3, 0).applyMatrix4(g.matrixWorld);
      panes.push({ pos: side, yaw: yaw + Math.PI / 2, w: D - 0.1, h: 2.2, normal: new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw) });
      ctx.destruction.createWindows(panes, 1200);
      const col = ctx.physics.addStaticBox(x, H + 0.1, z, 0.1, 0.05, 0.1); // roof marker (no blocking)
      ctx.destruction.registerBurnable({ kind: 'shelter', obj: g, pos: new THREE.Vector3(x, 1, z), radius: 2, value: 6000, collider: col });
    }
  }

  // ------------------------------------------------------------------ construction site
  private chantier() {
    // fenced area on the left sidewalk, with a pile of loose cobbles and pallets
    const cx = -11, cz = -66;
    const sand = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1, 14), new THREE.MeshStandardMaterial({ color: 0xb59a6c, roughness: 1 }));
    sand.position.set(cx - 1.5, 0.6, cz + 4); sand.castShadow = true; sand.receiveShadow = true; this.root.add(sand);
    const paveM = new THREE.MeshStandardMaterial({ color: 0x7d746a, roughness: 0.95 });
    const pile = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 0.13, 0.15), paveM, 120);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < 120; i++) {
      const r = Math.sqrt(this.rnd()) * 1.2, a = this.rnd() * Math.PI * 2;
      const h = (1 - r / 1.2) * 0.7 + 0.12;
      q.setFromEuler(new THREE.Euler(this.rnd(), this.rnd() * 3, this.rnd()));
      m.compose(new THREE.Vector3(cx + 0.5 + Math.cos(a) * r, h * this.rnd() + 0.1, cz - 2 + Math.sin(a) * r), q, new THREE.Vector3(1, 1, 1));
      pile.setMatrixAt(i, m);
    }
    pile.castShadow = true; this.root.add(pile);
    this.paveSpots.push(new THREE.Vector3(cx + 0.5, 0.4, cz - 2));
    // the sidewalk is torn up: dark patch
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 9).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 1 }));
    patch.position.set(cx, 0.125, cz); patch.receiveShadow = true; this.root.add(patch);
    // barriers and pallets are dynamic props (used for barricades)
    for (let i = 0; i < 4; i++) ctx.destruction.spawnProp('barrier', new THREE.Vector3(-8.9, 0.6, cz + 4.5 - i * 2.6), Math.PI / 2);
    for (let i = 0; i < 4; i++) ctx.destruction.spawnProp('pallet', new THREE.Vector3(cx - 1.4 + (i % 2) * 0.1, 0.3 + Math.floor(i / 2) * 0.16, cz - 4.5 + (i % 2) * 0.2), 0);
    this.pickupSpots.push({ x: cx + 1, y: 0.2, z: cz + 2, kind: 'pave' }, { x: cx + 1.4, y: 0.2, z: cz + 1, kind: 'pave' });
  }

  // ------------------------------------------------------------------ terrace
  private terrace() {
    const tableM = new THREE.MeshStandardMaterial({ color: 0x8f8f8a, roughness: 0.3, metalness: 0.8 });
    const chairM = new THREE.MeshStandardMaterial({ color: 0x7a3a1d, roughness: 0.8 });
    const tables: THREE.Vector3[] = [];
    for (let z = 0; z > -16; z -= 2.6) for (const x of [10.2, 12.4]) tables.push(new THREE.Vector3(x, 0.12, z));
    const top = new THREE.InstancedMesh(mergeGeometries([normGeo(new THREE.CylinderGeometry(0.35, 0.35, 0.04, 14).translate(0, 0.74, 0)), normGeo(new THREE.CylinderGeometry(0.03, 0.03, 0.72, 6).translate(0, 0.36, 0))]), tableM, tables.length);
    const chairGeo = mergeGeometries([normGeo(new THREE.BoxGeometry(0.42, 0.04, 0.42).translate(0, 0.45, 0)), normGeo(new THREE.BoxGeometry(0.42, 0.45, 0.04).translate(0, 0.68, -0.2))]);
    const chairs = new THREE.InstancedMesh(chairGeo, chairM, tables.length * 2);
    const m = new THREE.Matrix4();
    tables.forEach((t, i) => {
      m.makeTranslation(t.x, t.y, t.z); top.setMatrixAt(i, m);
      for (let k = 0; k < 2; k++) { m.makeRotationY(k * Math.PI + (this.rnd() - 0.5) * 0.5).setPosition(t.x, t.y, t.z + (k ? 0.55 : -0.55)); chairs.setMatrixAt(i * 2 + k, m); }
      this.pickupSpots.push({ x: t.x, y: 0.9, z: t.z, kind: this.rnd() < 0.6 ? 'bouteille' : 'canette' });
      this.circles.push({ x: t.x, z: t.z, r: 0.6 });
    });
    top.castShadow = true; chairs.castShadow = true;
    this.root.add(top, chairs);
    // café awning
    const aw = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.1, 17), new THREE.MeshStandardMaterial({ color: 0x5a1a16, roughness: 0.9 }));
    aw.position.set(12.2, 3.4, -7.5); aw.rotation.z = -0.12; aw.castShadow = true; this.root.add(aw);
  }

  // ------------------------------------------------------------------ place
  private place() {
    const stone = new THREE.MeshStandardMaterial({ color: 0xcdbf9f, roughness: 0.8 });
    const bronze = new THREE.MeshStandardMaterial({ color: 0x3c4a3a, roughness: 0.35, metalness: 0.9 });
    const g = new THREE.Group();
    const base1 = new THREE.Mesh(new THREE.BoxGeometry(9, 1.2, 9), stone); base1.position.y = 0.6;
    const base2 = new THREE.Mesh(new THREE.BoxGeometry(5, 2.5, 5), stone); base2.position.y = 2.45;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.15, 16, 20), stone); col.position.y = 11.7;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.8, 2.8), stone); cap.position.y = 20.1;
    // allegorical statue (abstract silhouette): torso + raised arm with a torch
    const statue = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, 2.6, 10), bronze); body.position.y = 1.3;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.33, 12, 10), bronze); head.position.y = 2.9;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.6, 8), bronze); arm.position.set(0.45, 3.2, 0); arm.rotation.z = -0.35;
    const torch = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 10), new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.3 }));
    torch.position.set(0.75, 4.1, 0);
    statue.add(body, head, arm, torch); statue.position.y = 20.5;
    g.add(base1, base2, col, cap, statue);
    g.position.set(L.MONUMENT.x, 0, L.MONUMENT.z);
    g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    this.root.add(g);
    ctx.physics.addStaticBox(L.MONUMENT.x, 0.6, L.MONUMENT.z, 4.5, 0.6, 4.5);
    ctx.physics.addStaticBox(L.MONUMENT.x, 6, L.MONUMENT.z, 2.5, 6, 2.5);
    this.boxes.push({ x: L.MONUMENT.x, z: L.MONUMENT.z, hx: 4.8, hz: 4.8 });
    // loose cobbles on the place (dépaver)
    for (const [x, z] of [[-20, -232], [22, -262], [-8, -270], [30, -220]]) this.paveSpots.push(new THREE.Vector3(x, 0, z));
    // benches
    const benchM = new THREE.MeshStandardMaterial({ color: 0x3b4a3a, roughness: 0.6, metalness: 0.4 });
    for (const [x, z, r] of [[-12, -240, Math.PI / 2], [12, -256, -Math.PI / 2], [-30, -268, 0], [30, -230, Math.PI]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(2, 0.45, 0.6), benchM); b.position.set(x, 0.25, z); b.rotation.y = r; b.castShadow = true;
      this.root.add(b); ctx.physics.addStaticBox(x, 0.25, z, r === 0 || r === Math.PI ? 1 : 0.3, 0.25, r === 0 || r === Math.PI ? 0.3 : 1);
    }
  }

  // ------------------------------------------------------------------ police vans
  private policeVans() {
    const white = new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.4, metalness: 0.3 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x1b2f6b, roughness: 0.5, metalness: 0.3 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0a0f14, roughness: 0.05, metalness: 0.9 });
    const tire = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
    const gyroM = new THREE.MeshStandardMaterial({ color: 0x2244ff, emissive: 0x2a5bff, emissiveIntensity: 0 });
    const grill = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.7 });
    const plate = new THREE.MeshStandardMaterial({ map: T.signTexture('POLICE', '#1b2f6b', '#ffffff', 256, 64) });
    for (const [x, z, yaw] of [[-10.6, L.VAN_Z, 0], [10.6, L.VAN_Z - 2, 0], [-4.5, L.VAN_Z - 8, 0.2]] as [number, number, number][]) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.2, 5.6), white); body.position.y = 1.5;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.3, 5.62), blue); stripe.position.y = 1.2;
      const ws = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.8, 0.05), glass); ws.position.set(0, 2, -2.81);
      const grid = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.85, 0.05), grill); grid.position.set(0, 2, -2.86);
      for (const sx of [-1, 1]) { const sw = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.6, 3.6), glass); sw.position.set(sx * 1.06, 2.05, 0.4); g.add(sw);
        const p = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), plate); p.position.set(sx * 1.065, 1.2, 0.3); p.rotation.y = sx * Math.PI / 2; g.add(p); }
      for (const wz of [-1.9, 1.9]) for (const wx of [-0.95, 0.95]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 14).rotateZ(Math.PI / 2), tire); w.position.set(wx, 0.4, wz); g.add(w);
      }
      for (const gx of [-0.5, 0.5]) {
        const gy = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.25), gyroM.clone()); gy.position.set(gx, 2.68, -2.2); g.add(gy);
        this.vanLights.push(gy);
      }
      g.add(body, stripe, ws, grid);
      g.position.set(x, groundY(x, z), z); g.rotation.y = yaw;
      g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      this.root.add(g);
      ctx.physics.addStaticBox(x, 1.4, z, 1.1, 1.4, 2.85, yaw);
      this.boxes.push({ x, z, hx: 1.4, hz: 3.1 });
      this.vans.push(new THREE.Vector3(x, 2.7, z - 2));
    }
  }

  // ------------------------------------------------------------------ bins
  private bins() {
    for (const s of [-1, 1]) for (let z = L.AVE_START - 12; z > L.CRS_LINE_Z + 10; z -= 21) {
      if (z < L.CROSS_Z0 + 3 && z > L.CROSS_Z1 - 3) continue;
      if (s < 0 && z < -55 && z > -76) continue;
      ctx.destruction.spawnProp('bin', new THREE.Vector3(s * 13.3, 0.62, z), 0);
      if (this.rnd() < 0.6) ctx.destruction.spawnProp('bin', new THREE.Vector3(s * 13.3, 0.62, z - 0.9), 0);
      this.pickupSpots.push({ x: s * 12.6, y: 0.2, z: z - 1.8, kind: this.rnd() < 0.5 ? 'canette' : 'conserve' });
    }
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) ctx.destruction.spawnProp('barrier', new THREE.Vector3(s * (L.FACADE_X - 1.2), 0.6, L.CRS_LINE_Z + 6 + k * 2.6), Math.PI / 2);
    // scattered pickups along the avenue
    for (let i = 0; i < 26; i++) {
      const z = L.AVE_START - 5 - this.rnd() * (L.AVE_START - L.CRS_LINE_Z - 20);
      const x = (this.rnd() - 0.5) * 2 * 12.5;
      const kinds = ['pave', 'pave', 'canette', 'bouteille', 'conserve', 'pave'];
      this.pickupSpots.push({ x, y: groundY(x, z) + 0.1, z, kind: kinds[Math.floor(this.rnd() * kinds.length)] });
    }
    // a few fireworks bags and makeshift shields
    for (const [x, z, k] of [[-12.5, 30, 'mortier'], [12.8, -20, 'mortier'], [-12.7, -48, 'fusee'], [12.6, -78, 'mortier'], [-12.4, -105, 'fusee'],
      [12.7, 10, 'panneau'], [-12.8, -30, 'panneau'], [-12.5, -2, 'serum'], [12.5, -60, 'masque'], [-13, -120, 'fumigene']] as [number, number, string][]) {
      this.pickupSpots.push({ x, y: 0.25, z, kind: k });
    }
  }

  // ------------------------------------------------------------------ per frame
  update(night: number, time: number) {
    for (const m of this.facadeMats) m.emissiveIntensity = night * 0.9;
    for (const s of this.signs) s.emissiveIntensity = night * 0.6;
    (this.lampBulbs.material as THREE.MeshStandardMaterial).emissiveIntensity = night > 0.15 ? 6 * Math.min(1, night * 2) : 0;
    (this.lampPools.material as THREE.MeshBasicMaterial).opacity = Math.min(1, night * 1.5) * 0.35;
    void time;
  }

  setGyros(on: boolean, time: number) {
    this.vanLights.forEach((m, i) => {
      const mat = m.material as THREE.MeshStandardMaterial;
      const ph = Math.sin(time * 9 + i * Math.PI) > 0.2;
      mat.emissiveIntensity = on && ph ? 14 : 0;
    });
  }
}

void RAPIER; void G; void groups;
