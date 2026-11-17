import * as THREE from 'three';
import { ctx } from '../core/context';
import type { Projectile } from './projectiles';

export class GasCloud {
  age = 0;
  radius = 1.5;
  conc = 1;
  puffT = 0;
  constructor(public pos: THREE.Vector3, public source: Projectile | null) {}
}

/** Tear gas: clouds that grow, drift with the wind and fade out. */
export class GasSystem {
  clouds: GasCloud[] = [];
  life = 32;

  create(pos: THREE.Vector3, source: Projectile | null) {
    const c = new GasCloud(pos, source);
    this.clouds.push(c);
    ctx.tension.add(2, 'lacrymo');
    return c;
  }

  /** Concentration 0..~1.5 at a point (head height matters). */
  at(p: THREE.Vector3) {
    let s = 0;
    for (const c of this.clouds) {
      const dx = p.x - c.pos.x, dz = p.z - c.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > c.radius) continue;
      const h = Math.max(0, 1 - Math.max(0, p.y - 3.5) / 4);
      s += c.conc * (1 - (d / c.radius) ** 2) * h;
    }
    return s;
  }

  /** Client: clouds as listed in the host snapshot ([x, z, radius, concentration]...). */
  mirror(list: number[][]) {
    this.clouds.length = list.length;
    list.forEach(([x, z, r, k], i) => {
      const c = (this.clouds[i] ??= new GasCloud(new THREE.Vector3(), null));
      c.pos.set(x, 0, z); c.radius = r; c.conc = k;
    });
  }

  update(dt: number) {
    if (!ctx.net.isClient) this.simulate(dt);
    // visible puffs around each centre, drawn on every machine
    ctx.net.quiet(() => {
      for (const c of this.clouds) {
        c.puffT -= dt;
        if (c.puffT > 0 || c.conc <= 0.05) continue;
        c.puffT = 0.12 / Math.max(0.3, c.conc);
        const a = Math.random() * Math.PI * 2, r = Math.random() * c.radius * 0.7;
        ctx.particles.gasPuff(new THREE.Vector3(c.pos.x + Math.cos(a) * r, 0.6 + Math.random() * 1.2, c.pos.z + Math.sin(a) * r), 1.2 + c.radius * 0.25);
      }
    });
  }

  private simulate(dt: number) {
    const wind = ctx.wind;
    for (const c of this.clouds) {
      c.age += dt;
      if (c.source && !c.source.dead) {
        c.source.pos(c.pos);
        c.radius = Math.min(7, c.radius + dt * 1.4);
        c.conc = 1;
      } else {
        c.pos.x += wind.x * dt * 0.7; c.pos.z += wind.z * dt * 0.7;
        c.radius = Math.min(13, c.radius + dt * 0.35);
        c.conc -= dt / this.life;
      }
    }
    this.clouds = this.clouds.filter((c) => c.conc > 0);
  }
}
