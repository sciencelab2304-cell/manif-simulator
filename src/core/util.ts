import * as THREE from 'three';

export const rand = Math.random;
export const rr = (a: number, b: number) => a + Math.random() * (b - a);
export const ri = (a: number, b: number) => Math.floor(rr(a, b + 1));
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const damp = (a: number, b: number, lambda: number, dt: number) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const chance = (p: number) => Math.random() < p;
export const smooth = (t: number) => t * t * (3 - 2 * t);

export function angleDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function dist2(ax: number, az: number, bx: number, bz: number) {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}

export const V = () => new THREE.Vector3();
export const tmpV1 = new THREE.Vector3();
export const tmpV2 = new THREE.Vector3();
export const tmpV3 = new THREE.Vector3();
export const tmpQ = new THREE.Quaternion();
export const tmpM = new THREE.Matrix4();

/** Seeded PRNG so the city layout is identical at each launch. */
export function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Initial velocity to hit `to` from `from` with horizontal speed `speed` (ballistic arc). */
export function ballistic(from: THREE.Vector3, to: THREE.Vector3, speed: number, g = 9.81, out = new THREE.Vector3()) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const horiz = Math.sqrt(dx * dx + dz * dz) || 0.001;
  const t = horiz / speed;
  const vy = (to.y - from.y + 0.5 * g * t * t) / t;
  out.set((dx / horiz) * speed, vy, (dz / horiz) * speed);
  return out;
}

/** Runs fn with Math.random replaced by a seeded generator (same NPC looks on every machine). */
export function withSeed<T>(seed: number, fn: () => T): T {
  const r = Math.random;
  Math.random = mulberry32(seed);
  try { return fn(); } finally { Math.random = r; }
}
