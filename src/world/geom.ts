import * as THREE from 'three';

/** Tiny non-indexed geometry builder with metric UVs. */
export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  private a = new THREE.Vector3(); private b = new THREE.Vector3(); private n = new THREE.Vector3();

  /** Quad given CCW from outside: p0 bottom-left, p1 bottom-right, p2 top-right, p3 top-left. */
  quad(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3,
    uv0: [number, number], uv1: [number, number], uv2: [number, number], uv3: [number, number]) {
    this.a.subVectors(p1, p0); this.b.subVectors(p3, p0);
    this.n.crossVectors(this.a, this.b).normalize();
    const P = [p0, p1, p2, p0, p2, p3], U = [uv0, uv1, uv2, uv0, uv2, uv3];
    for (let i = 0; i < 6; i++) {
      this.pos.push(P[i].x, P[i].y, P[i].z);
      this.nor.push(this.n.x, this.n.y, this.n.z);
      this.uv.push(U[i][0], U[i][1]);
    }
  }

  /** Vertical walls of an axis-aligned box + optional top, UV in meters / (uScale, vScale). */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, uScale: number, vScale: number, top = true, bottom = false) {
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const v0 = y0 / vScale, v1 = y1 / vScale;
    const lx = (x1 - x0) / uScale, lz = (z1 - z0) / uScale;
    // +X face, right = -z
    this.quad(V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1), [0, v0], [lz, v0], [lz, v1], [0, v1]);
    // -X face, right = +z
    this.quad(V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0), [0, v0], [lz, v0], [lz, v1], [0, v1]);
    // +Z face, right = +x
    this.quad(V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1), [0, v0], [lx, v0], [lx, v1], [0, v1]);
    // -Z face, right = -x
    this.quad(V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0), [0, v0], [lx, v0], [lx, v1], [0, v1]);
    if (top) this.quad(V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0), [0, 0], [lx, 0], [lx, lz], [0, lz]);
    if (bottom) this.quad(V(x0, y0, z0), V(x1, y0, z0), V(x1, y0, z1), V(x0, y0, z1), [0, 0], [lx, 0], [lx, lz], [0, lz]);
  }

  /** Mansard roof: slopes from the wall top rectangle to an inset rectangle. */
  mansard(x0: number, x1: number, z0: number, z1: number, y0: number, h: number, inset: number, uScale: number) {
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const y1 = y0 + h;
    const ix0 = x0 + inset, ix1 = x1 - inset, iz0 = z0 + inset, iz1 = z1 - inset;
    const lx = (x1 - x0) / uScale, lz = (z1 - z0) / uScale, il = inset / uScale;
    this.quad(V(x1, y0, z1), V(x1, y0, z0), V(ix1, y1, iz0), V(ix1, y1, iz1), [0, 0], [lz, 0], [lz - il, 1], [il, 1]);
    this.quad(V(x0, y0, z0), V(x0, y0, z1), V(ix0, y1, iz1), V(ix0, y1, iz0), [0, 0], [lz, 0], [lz - il, 1], [il, 1]);
    this.quad(V(x0, y0, z1), V(x1, y0, z1), V(ix1, y1, iz1), V(ix0, y1, iz1), [0, 0], [lx, 0], [lx - il, 1], [il, 1]);
    this.quad(V(x1, y0, z0), V(x0, y0, z0), V(ix0, y1, iz0), V(ix1, y1, iz0), [0, 0], [lx, 0], [lx - il, 1], [il, 1]);
    this.quad(V(ix0, y1, iz1), V(ix1, y1, iz1), V(ix1, y1, iz0), V(ix0, y1, iz0), [0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

/** Ensures every geometry is non-indexed with position/normal/uv only, so they can be merged. */
export function normGeo(g: THREE.BufferGeometry) {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv'].includes(k)) ng.deleteAttribute(k);
  if (!ng.attributes.uv) {
    ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
  }
  if (!ng.attributes.normal) ng.computeVertexNormals();
  return ng;
}
