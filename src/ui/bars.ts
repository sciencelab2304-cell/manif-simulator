import * as THREE from 'three';
import { ctx } from '../core/context';
import { clamp } from '../core/util';
import type { NPC } from '../npc/npc';

const MAX = 20, RANGE = 22, W = 0.7, H = 0.085;
const _c = new THREE.Color(), _v = new THREE.Vector3();
const GOOD = new THREE.Color(0x52d273), MID = new THREE.Color(0xffc93c), BAD = new THREE.Color(0xff5252), CUFF = new THREE.Color(0x45b7ff);

/**
 * Health bars over the nearby opponents (damaged ones, or anyone close). A CRS sees in blue the protesters
 * that are weak enough to be handcuffed.
 */
export class HealthBars {
  private bars: { bg: THREE.Sprite; fill: THREE.Sprite }[] = [];

  constructor() {
    for (let i = 0; i < MAX; i++) {
      const sprite = (color: number, opacity: number, order: number) => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false, toneMapped: false }));
        s.renderOrder = order; s.visible = false;
        ctx.scene.add(s);
        return s;
      };
      const bg = sprite(0x101014, 0.75, 20), fill = sprite(0xffffff, 1, 21);
      bg.scale.set(W + 0.04, H + 0.04, 1);
      this.bars.push({ bg, fill });
    }
  }

  update() {
    const cam = ctx.camera.position, police = ctx.camp === 'police';
    const list: [NPC, number][] = [];
    for (const n of ctx.crowd.all) {
      if (!n.visible || n.removed || n.hidden || n.camp === ctx.camp || n.camp === 'neutral' || n.state === 'arrested' || n.state === 'escort') continue;
      const d = n.pos.distanceTo(cam);
      if (d < RANGE && (d < 8 || n.hp < n.maxHp * 0.97)) list.push([n, d]);
    }
    list.sort((a, b) => a[1] - b[1]);
    this.bars.forEach(({ bg, fill }, i) => {
      const n = list[i]?.[0];
      bg.visible = fill.visible = !!n && !ctx.player.inVehicle;
      if (!n) return;
      const r = clamp(n.hp / n.maxHp, 0.02, 1);
      n.downPelvis(_v);
      _v.y = n.isDown ? 0.75 : n.kneel || n.state === 'cuffing' ? 1.65 : 2.1;
      bg.position.copy(_v); fill.position.copy(_v);
      fill.scale.set(W * r, H, 1);
      fill.center.set(0.5 / r, 0.5); // keeps the fill's left edge on the background's
      const m = fill.material;
      if (police && n.cuffable) m.color.copy(CUFF);
      else m.color.copy(r > 0.5 ? _c.copy(MID).lerp(GOOD, (r - 0.5) * 2) : _c.copy(BAD).lerp(MID, r * 2));
    });
  }
}
