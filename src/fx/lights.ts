import * as THREE from 'three';

export interface LightReq {
  pos: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
  distance: number;
  priority: number; // higher = more important
}

/**
 * Fixed pool of point lights shared by fires, flashes and gyrophares.
 * The number never changes during a match, so shaders are compiled only once.
 */
export class LightPool {
  lights: THREE.PointLight[] = [];
  reqs: LightReq[] = [];
  private cam = new THREE.Vector3();

  constructor(scene: THREE.Scene, n: number) {
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 20, 2);
      l.castShadow = false;
      scene.add(l);
      this.lights.push(l);
    }
  }

  request(r: LightReq) { this.reqs.push(r); }

  private flashes: { pos: THREE.Vector3; color: THREE.Color; intensity: number; t: number; dur: number }[] = [];
  /** Short bright flash (explosions, muzzle). */
  flash(pos: THREE.Vector3, color: THREE.Color, intensity: number, dur: number) {
    this.flashes.push({ pos: pos.clone(), color: color.clone(), intensity, t: 0, dur });
  }
  tick(dt: number) {
    for (const f of this.flashes) {
      f.t += dt;
      const k = 1 - f.t / f.dur;
      if (k > 0) this.request({ pos: f.pos, color: f.color, intensity: f.intensity * k * k, distance: 35, priority: 10 });
    }
    this.flashes = this.flashes.filter((f) => f.t < f.dur);
  }

  /** Picks the most relevant requests for this frame and assigns them to the pool. */
  update(camera: THREE.Camera) {
    camera.getWorldPosition(this.cam);
    const c = this.cam;
    for (const r of this.reqs) {
      const d = r.pos.distanceTo(c);
      (r as any)._score = r.priority * r.intensity / (1 + d * 0.08);
    }
    this.reqs.sort((a, b) => (b as any)._score - (a as any)._score);
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i], r = this.reqs[i];
      if (r) {
        l.position.copy(r.pos); l.color.copy(r.color); l.intensity = r.intensity; l.distance = r.distance;
      } else l.intensity = 0;
    }
    this.reqs.length = 0;
  }
}
