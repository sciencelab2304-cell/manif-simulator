import * as THREE from 'three';
import { softSprite, smokeSprite } from '../core/textures';
import { rr } from '../core/util';

const VERT = /* glsl */`
attribute vec4 acolor;
attribute float size;
varying vec4 vC;
varying float vFog;
uniform float scale;
uniform float fogDensity;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(size * scale / max(-mv.z, 0.1), 900.0);
  vC = acolor;
  float d = -mv.z;
  vFog = 1.0 - exp(-fogDensity * fogDensity * d * d);
}`;

const FRAG = /* glsl */`
uniform sampler2D map;
uniform vec3 fogColor;
uniform float additive;
varying vec4 vC;
varying float vFog;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  vec4 c = vec4(vC.rgb, vC.a * t.a);
  if (c.a < 0.004) discard;
  if (additive > 0.5) { c.rgb *= (1.0 - vFog); }
  else { c.rgb = mix(c.rgb, fogColor, vFog); }
  gl_FragColor = c;
}`;

export interface EmitOpts {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  spread?: number; // random velocity magnitude
  posSpread?: number;
  count?: number;
  life?: [number, number];
  size?: [number, number];
  color?: THREE.ColorRepresentation;
  color2?: THREE.ColorRepresentation;
  alpha?: [number, number];
  gravity?: number;
  drag?: number;
  additive?: boolean;
  ground?: boolean; // stop at y=0
}

class Pool {
  cap: number;
  n = 0;
  p: Float32Array; v: Float32Array;
  age: Float32Array; life: Float32Array;
  s: Float32Array; // s0, s1
  c: Float32Array; // r,g,b,r2,g2,b2
  a: Float32Array; // a0, a1
  phys: Float32Array; // gravity, drag, ground
  geo: THREE.BufferGeometry;
  posAttr: THREE.BufferAttribute; colAttr: THREE.BufferAttribute; sizeAttr: THREE.BufferAttribute;
  points: THREE.Points;
  mat: THREE.ShaderMaterial;

  constructor(cap: number, map: THREE.Texture, additive: boolean) {
    this.cap = cap;
    this.p = new Float32Array(cap * 3); this.v = new Float32Array(cap * 3);
    this.age = new Float32Array(cap); this.life = new Float32Array(cap);
    this.s = new Float32Array(cap * 2); this.c = new Float32Array(cap * 6); this.a = new Float32Array(cap * 2);
    this.phys = new Float32Array(cap * 3);
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('acolor', this.colAttr);
    this.geo.setAttribute('size', this.sizeAttr);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { map: { value: map }, scale: { value: 600 }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 }, additive: { value: additive ? 1 : 0 } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 11 : 10;
  }

  spawn(px: number, py: number, pz: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number,
    c1: THREE.Color, c2: THREE.Color, a0: number, a1: number, grav: number, drag: number, ground: boolean) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.p[i * 3] = px; this.p[i * 3 + 1] = py; this.p[i * 3 + 2] = pz;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life;
    this.s[i * 2] = s0; this.s[i * 2 + 1] = s1;
    this.c[i * 6] = c1.r; this.c[i * 6 + 1] = c1.g; this.c[i * 6 + 2] = c1.b;
    this.c[i * 6 + 3] = c2.r; this.c[i * 6 + 4] = c2.g; this.c[i * 6 + 5] = c2.b;
    this.a[i * 2] = a0; this.a[i * 2 + 1] = a1;
    this.phys[i * 3] = grav; this.phys[i * 3 + 1] = drag; this.phys[i * 3 + 2] = ground ? 1 : 0;
  }

  copy(dst: number, src: number) {
    for (let k = 0; k < 3; k++) { this.p[dst * 3 + k] = this.p[src * 3 + k]; this.v[dst * 3 + k] = this.v[src * 3 + k]; this.phys[dst * 3 + k] = this.phys[src * 3 + k]; }
    for (let k = 0; k < 6; k++) this.c[dst * 6 + k] = this.c[src * 6 + k];
    this.s[dst * 2] = this.s[src * 2]; this.s[dst * 2 + 1] = this.s[src * 2 + 1];
    this.a[dst * 2] = this.a[src * 2]; this.a[dst * 2 + 1] = this.a[src * 2 + 1];
    this.age[dst] = this.age[src]; this.life[dst] = this.life[src];
  }

  update(dt: number, wind: THREE.Vector3) {
    const P = this.posAttr.array as Float32Array, C = this.colAttr.array as Float32Array, S = this.sizeAttr.array as Float32Array;
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.n--; if (i !== this.n) this.copy(i, this.n); continue; }
      const t = this.age[i] / this.life[i];
      const grav = this.phys[i * 3], drag = this.phys[i * 3 + 1];
      const k = Math.exp(-drag * dt);
      this.v[i * 3] = this.v[i * 3] * k + wind.x * drag * dt * 0.6;
      this.v[i * 3 + 1] = this.v[i * 3 + 1] * k - grav * dt;
      this.v[i * 3 + 2] = this.v[i * 3 + 2] * k + wind.z * drag * dt * 0.6;
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      if (this.phys[i * 3 + 2] > 0 && this.p[i * 3 + 1] < 0.03) {
        this.p[i * 3 + 1] = 0.03; this.v[i * 3] *= 0.3; this.v[i * 3 + 1] = 0; this.v[i * 3 + 2] *= 0.3;
      }
      P[i * 3] = this.p[i * 3]; P[i * 3 + 1] = this.p[i * 3 + 1]; P[i * 3 + 2] = this.p[i * 3 + 2];
      C[i * 4] = this.c[i * 6] + (this.c[i * 6 + 3] - this.c[i * 6]) * t;
      C[i * 4 + 1] = this.c[i * 6 + 1] + (this.c[i * 6 + 4] - this.c[i * 6 + 1]) * t;
      C[i * 4 + 2] = this.c[i * 6 + 2] + (this.c[i * 6 + 5] - this.c[i * 6 + 2]) * t;
      const fadeIn = Math.min(1, this.age[i] * 12);
      C[i * 4 + 3] = (this.a[i * 2] + (this.a[i * 2 + 1] - this.a[i * 2]) * t) * fadeIn;
      S[i] = this.s[i * 2] + (this.s[i * 2 + 1] - this.s[i * 2]) * t;
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    this.posAttr.needsUpdate = true; this.colAttr.needsUpdate = true; this.sizeAttr.needsUpdate = true;
    this.posAttr.clearUpdateRanges(); this.posAttr.addUpdateRange(0, this.n * 3);
    this.colAttr.clearUpdateRanges(); this.colAttr.addUpdateRange(0, this.n * 4);
    this.sizeAttr.clearUpdateRanges(); this.sizeAttr.addUpdateRange(0, this.n);
  }
}

const c1 = new THREE.Color(), c2 = new THREE.Color();
const tv = new THREE.Vector3();

export class Particles {
  alpha: Pool;
  add: Pool;
  scale = 1;
  blood = true;

  constructor(scene: THREE.Scene, scale: number) {
    this.scale = scale;
    this.alpha = new Pool(Math.floor(9000 * Math.max(scale, 0.5)), smokeSprite(), false);
    this.add = new Pool(Math.floor(5000 * Math.max(scale, 0.5)), softSprite(), true);
    scene.add(this.alpha.points, this.add.points);
  }

  resize(heightPx: number, fovDeg: number) {
    const s = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.alpha.mat.uniforms.scale.value = s;
    this.add.mat.uniforms.scale.value = s;
  }

  setFog(color: THREE.Color, density: number) {
    for (const p of [this.alpha, this.add]) { p.mat.uniforms.fogColor.value.copy(color); p.mat.uniforms.fogDensity.value = density; }
  }

  emit(o: EmitOpts) {
    const pool = o.additive ? this.add : this.alpha;
    const count = Math.max(1, Math.round((o.count ?? 1) * (o.count && o.count > 3 ? this.scale : 1)));
    c1.set(o.color ?? 0xffffff); c2.set(o.color2 ?? o.color ?? 0xffffff);
    const life = o.life ?? [1, 1], size = o.size ?? [0.3, 0.3], alpha = o.alpha ?? [1, 0];
    const sp = o.spread ?? 0, ps = o.posSpread ?? 0;
    for (let i = 0; i < count; i++) {
      tv.set(rr(-1, 1), rr(-1, 1), rr(-1, 1));
      if (tv.lengthSq() > 1) tv.normalize();
      const vx = (o.vel?.x ?? 0) + tv.x * sp, vy = (o.vel?.y ?? 0) + tv.y * sp, vz = (o.vel?.z ?? 0) + tv.z * sp;
      pool.spawn(o.pos.x + rr(-ps, ps), o.pos.y + rr(-ps, ps) * 0.5, o.pos.z + rr(-ps, ps), vx, vy, vz, rr(life[0], life[1]),
        size[0], size[1], c1, c2, alpha[0], alpha[1], o.gravity ?? 0, o.drag ?? 0, o.ground ?? false);
    }
  }

  // ----- presets
  bloodSpray(pos: THREE.Vector3, dir: THREE.Vector3, amount = 1) {
    if (!this.blood) return;
    this.emit({ pos, vel: tv.copy(dir).multiplyScalar(2.5 * amount).clone(), spread: 2.2 * amount, count: 14 * amount, life: [0.35, 0.8],
      size: [0.06, 0.03], color: 0x7a0606, color2: 0x3a0000, alpha: [0.95, 0.8], gravity: 9.8, drag: 0.6, ground: true });
    this.emit({ pos, spread: 0.5, count: 4 * amount, life: [0.2, 0.4], size: [0.2, 0.45], color: 0x8a0a0a, alpha: [0.5, 0], drag: 2 });
  }
  sparks(pos: THREE.Vector3, n = 20, speed = 6) {
    this.emit({ pos, spread: speed, count: n, life: [0.2, 0.7], size: [0.08, 0.02], color: 0xffd38a, color2: 0xff5a10,
      alpha: [1, 0], gravity: 9.8, drag: 1, additive: true, ground: true });
  }
  flash(pos: THREE.Vector3, size = 6, color: THREE.ColorRepresentation = 0xfff1c8) {
    this.emit({ pos, count: 1, life: [0.12, 0.16], size: [size, size * 1.6], color, alpha: [1, 0], additive: true });
  }
  glass(pos: THREE.Vector3, dir: THREE.Vector3, n = 40) {
    this.emit({ pos, vel: tv.copy(dir).multiplyScalar(2).clone(), spread: 3.5, posSpread: 0.6, count: n, life: [0.6, 1.6],
      size: [0.05, 0.04], color: 0xcfe6ee, alpha: [0.9, 0.6], gravity: 9.8, drag: 0.2, ground: true });
  }
  dust(pos: THREE.Vector3, n = 8, color: THREE.ColorRepresentation = 0x9a9086) {
    this.emit({ pos, spread: 1.2, count: n, life: [0.8, 1.8], size: [0.3, 1.2], color, alpha: [0.45, 0], gravity: -0.2, drag: 2 });
  }
  smoke(pos: THREE.Vector3, n = 1, dark = 0.15, size = 2.5) {
    const v = dark;
    c1.setRGB(v, v, v);
    this.emit({ pos, vel: tv.set(0, 1.8, 0).clone(), spread: 0.6, posSpread: 0.4, count: n, life: [3, 6], size: [size * 0.5, size * 2.5],
      color: c1.getHex(), color2: c1.clone().multiplyScalar(1.6).getHex(), alpha: [0.55, 0], gravity: -0.15, drag: 0.35 });
  }
  fire(pos: THREE.Vector3, n = 2, scale = 1) {
    this.emit({ pos, vel: tv.set(0, 2.2 * scale, 0).clone(), spread: 0.5, posSpread: 0.45 * scale, count: n, life: [0.35, 0.8],
      size: [0.9 * scale, 0.25 * scale], color: 0xffc46b, color2: 0xff3d0a, alpha: [0.95, 0], drag: 0.6, additive: true });
  }
  gasPuff(pos: THREE.Vector3, size: number) {
    this.emit({ pos, vel: tv.set(0, 0.3, 0).clone(), spread: 0.9, posSpread: 0.6, count: 1, life: [5, 9], size: [size * 0.6, size * 2.6],
      color: 0xe8ebe6, color2: 0xcfd3cc, alpha: [0.5, 0], gravity: -0.03, drag: 0.25 });
  }
  colorSmoke(pos: THREE.Vector3, color: THREE.ColorRepresentation) {
    this.emit({ pos, vel: tv.set(0, 1.2, 0).clone(), spread: 0.6, count: 1, life: [3, 6], size: [0.4, 3.2],
      color, alpha: [0.7, 0], gravity: -0.1, drag: 0.35 });
  }
  water(pos: THREE.Vector3, vel: THREE.Vector3) {
    this.emit({ pos, vel, spread: 0.9, count: 1, life: [0.8, 1.3], size: [0.25, 1.1], color: 0xe9f3ff, color2: 0xcfe0ef,
      alpha: [0.75, 0.0], gravity: 9.8, drag: 0.15, ground: true });
  }
  splash(pos: THREE.Vector3) {
    this.emit({ pos, vel: tv.set(0, 2, 0).clone(), spread: 2.5, count: 3, life: [0.3, 0.6], size: [0.4, 1.2], color: 0xf0f6ff,
      alpha: [0.6, 0], gravity: 6, drag: 1 });
  }

  update(dt: number, wind: THREE.Vector3) {
    this.alpha.update(dt, wind);
    this.add.update(dt, wind);
  }
}
