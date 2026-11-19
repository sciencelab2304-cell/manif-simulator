import * as THREE from 'three';
import { ctx } from '../core/context';
import { clamp, rr, lerp, angleDiff } from '../core/util';
import type { Player } from '../player/player';
import { CUFF_HP, type NPC } from '../npc/npc';
import type { DamageInfo, Zone } from '../damage/damage';
import { act } from '../net/actions';

type Weapon = 'lbd' | 'gas' | 'sting' | 'baton';
const NAMES: Record<Weapon, string> = { lbd: 'LBD 40', gas: 'Lacrymo', sting: 'Désencerclement', baton: 'Matraque' };

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const CUFF_SECONDS = 2;

/** CRS gear: LBD, tear gas, sting grenades, baton, shield, gas mask, orders, arrests. */
export class PoliceKit {
  weapons: Weapon[] = ['lbd', 'gas', 'sting', 'baton'];
  sel = 0;
  chamber = 1;
  ammo = 14;
  gas = 6;
  sting = 3;
  medkits = 1;
  reloadT = 0;
  cd = 0;
  aiming = false;
  shieldUp = false;
  charging = false;
  charge = 0;
  /** handcuffing in progress: the officer can do nothing else for CUFF_SECONDS */
  cuffing: { n: NPC; t: number } | null = null;
  private msgCd = 0;

  constructor(private p: Player) {}

  get current(): Weapon { return this.weapons[this.sel]; }

  private say(msg: string) { if (this.msgCd <= 0) { ctx.hud.prompt(msg, 2.5); this.msgCd = 2.5; } }

  update(dt: number) {
    const inp = ctx.input, p = this.p;
    this.msgCd -= dt; this.cd -= dt;
    if (!p.alive || p.inVehicle) { this.aiming = false; this.shieldUp = false; return; }
    if (inp.wheel) this.sel = (this.sel + inp.wheel + 40) % 4;
    for (let i = 0; i < 4; i++) if (inp.hit('Digit' + (i + 1))) this.sel = i;
    const w = this.current;
    p.vm.setItem(w);
    const phase = ctx.tension.phase;

    // reload
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      ctx.hud.progress(1 - this.reloadT / 1.8, 'Rechargement…');
      if (this.reloadT <= 0) { this.chamber = 1; this.ammo--; ctx.audio.click(); ctx.hud.progress(0); }
    }
    if (inp.hit('KeyR') && w === 'lbd' && this.chamber === 0 && this.ammo > 0 && this.reloadT <= 0) { this.reloadT = 1.8; ctx.audio.click(); }

    this.aiming = w === 'lbd' && inp.buttons[2] && this.reloadT <= 0;
    this.shieldUp = (w === 'baton' || w === 'gas' || w === 'sting') && inp.buttons[2] && !this.charging;

    // gas mask, medkit
    if (inp.hit('KeyM')) { p.maskOn = !p.maskOn; ctx.hud.feed(p.maskOn ? 'Masque à gaz ajusté' : 'Masque retiré', '#cfcfcf'); }
    if (inp.hit('KeyH') && this.medkits > 0) { this.medkits--; p.heal(); }

    // orders to the police line
    if (inp.hit('KeyG')) {
      if (phase === 0) this.say('Ordre de la hiérarchie : on reste en ligne, la manifestation est pacifique.');
      else { act('order', 'charge'); ctx.hud.feed('Ordre : CHARGEZ !', '#9fb7ff'); }
    }
    if (inp.hit('KeyT')) { act('order', 'advance'); ctx.hud.feed('Ordre : la ligne avance', '#9fb7ff'); }
    if (inp.hit('KeyV')) { act('order', 'hold'); ctx.hud.feed('Ordre : tenez la ligne', '#9fb7ff'); }

    // water cannon
    if (ctx.truck.canEnter(p.feet)) ctx.hud.setPrompt('[E] Monter dans le canon à eau');

    // interpellation (blocks everything else while it lasts)
    this.arrest(dt);
    if (this.cuffing) { this.aiming = this.shieldUp = this.charging = false; return; }

    // weapons
    if (w === 'lbd') {
      if (inp.btnPressed[0]) {
        if (!ctx.tension.forceAllowed) this.say('LBD non autorisé : attendez les sommations, ou qu\'un manifestant entre dans la zone interdite.');
        else if (this.reloadT > 0) { /* busy */ }
        else if (this.chamber === 0) { this.say(this.ammo > 0 ? 'Vide ! [R] pour recharger' : 'Plus de munitions'); ctx.audio.click(); }
        else this.fireLBD();
      }
    } else if (w === 'baton') {
      if (inp.btnPressed[0] && this.cd <= 0 && !this.shieldUp) {
        if (phase === 0 && !ctx.crowd.intrusion) this.say('Pas d\'usage de la force pendant une manifestation pacifique.');
        else this.strike();
      }
    } else {
      const count = w === 'gas' ? this.gas : this.sting;
      if ((inp.btnPressed[0]) && count > 0) {
        if (w === 'gas' && !ctx.tension.forceAllowed) this.say('Lacrymogènes interdits avant les sommations.');
        else if (w === 'sting' && phase < 2) this.say('Grenade de désencerclement : uniquement en situation de chaos.');
        else { this.charging = true; this.charge = 0; }
      }
      if (this.charging) {
        this.charge = clamp(this.charge + dt / 0.7, 0, 1);
        ctx.hud.charge(this.charge);
        if (inp.btnReleased[0] || !inp.buttons[0]) { this.throwGrenade(w as 'gas' | 'sting'); this.charging = false; ctx.hud.charge(0); }
      }
      p.vm.charge = this.charging ? this.charge : 0;
    }
  }

  private fireLBD() {
    const p = this.p;
    const dir = p.forward(new THREE.Vector3());
    // hip fire is inaccurate, aimed fire is precise
    const spread = this.aiming ? 0.004 : 0.03 + Math.hypot(p.vel.x, p.vel.z) * 0.006;
    dir.x += rr(-spread, spread); dir.y += rr(-spread, spread); dir.z += rr(-spread, spread); dir.normalize();
    const from = p.eye.clone().addScaledVector(dir, 0.4);
    act('lbd', [from.x, from.y, from.z], [dir.x, dir.y, dir.z]);
    this.chamber = 0;
    ctx.stats.lbdShots++;
    p.vm.recoilT = 0.25;
    p.pitch += 0.03;
    p.shake = Math.min(1, p.shake + 0.15);
    if (this.ammo > 0) setTimeout(() => { if (this.chamber === 0 && this.reloadT <= 0) this.say('[R] recharger'); }, 400);
  }

  private throwGrenade(kind: 'gas' | 'sting') {
    const p = this.p;
    const dir = p.forward(new THREE.Vector3());
    const lob = ctx.input.buttons[2];
    dir.y += lob ? 0.5 : 0.18; dir.normalize();
    const speed = kind === 'gas' ? 12 + this.charge * 12 : 8 + this.charge * 8;
    const from = p.eye.clone().addScaledVector(dir, 0.5);
    dir.multiplyScalar(speed);
    act('throw', kind, [from.x, from.y, from.z], [dir.x, dir.y, dir.z], 0);
    if (kind === 'gas') { this.gas--; ctx.stats.gasGrenades++; } else { this.sting--; ctx.stats.stingGrenades++; }
    p.vm.throwT = 0.35;
    ctx.audio.whoosh(null, 0.3);
  }

  private strike() {
    const p = this.p;
    this.cd = 0.55;
    p.vm.swingT = 0.4;
    ctx.audio.whoosh(null, 0.35);
    const eye = p.eye, fwd = p.forward(_v);
    let best: NPC | null = null, bd = 2.3;
    for (const n of ctx.crowd.all) {
      if (!n.standing || n.role === 'crs' || n.hidden) continue;
      _v2.subVectors(n.pos, eye).setY(0);
      const d = _v2.length();
      if (d > bd) continue;
      if (_v2.normalize().dot(_v.set(fwd.x, 0, fwd.z).normalize()) < 0.6) continue;
      best = n; bd = d;
    }
    if (!best) return;
    const n = best;
    setTimeout(() => {
      if (!n.standing) return;
      // the zone hit follows where you look
      const pitch = p.pitch;
      const zone: Zone = pitch > -0.05 ? 'head' : pitch > -0.35 ? (Math.random() < 0.5 ? 'armL' : 'torso') : pitch > -0.6 ? 'torso' : (Math.random() < 0.5 ? 'legL' : 'legR');
      act('strike', n.id, zone, rr(16, 26));
      ctx.stats.batonHits++;
    }, 160);
  }

  /** F near a weakened protester: 2 s of handcuffing, then he is taken away. */
  private arrest(dt: number) {
    const p = this.p;
    if (this.cuffing) {
      const c = this.cuffing, n = c.n;
      if (n.removed || n.state === 'arrested' || n.state === 'escort' || n.downPelvis(_v).distanceTo(p.feet) > 3) { this.cuffing = null; ctx.hud.progress(0); return; }
      c.t += dt;
      ctx.hud.progress(c.t / CUFF_SECONDS, 'Menottage…');
      // look down at the suspect
      _v.sub(p.feet);
      p.yaw += angleDiff(p.yaw, Math.atan2(-_v.x, -_v.z)) * Math.min(1, dt * 6);
      p.pitch = lerp(p.pitch, -0.75, Math.min(1, dt * 5));
      if (c.t >= CUFF_SECONDS) {
        act('cuff', n.id);
        ctx.stats.myArrests++;
        ctx.audio.click();
        this.cuffing = null; ctx.hud.progress(0);
      }
      return;
    }
    if (ctx.tension.phase === 0 && !ctx.crowd.intrusion) return;
    const fwd = p.forward(_v2);
    const cand = ctx.crowd.nearest(p.feet, 2.4, (o) => o.camp === 'protest' && !o.hidden && o.state !== 'arrested' && o.state !== 'escort' && o.state !== 'evac'
      && _v.subVectors(o.pos, p.feet).setY(0).normalize().dot(_v2.set(fwd.x, 0, fwd.z).normalize()) > 0.5, true);
    if (!cand) return;
    const hp = Math.round(Math.max(0, cand.hp) / cand.maxHp * 100);
    if (!cand.cuffable) {
      ctx.hud.setPrompt(`Trop combatif pour être menotté (${hp} % de vie, il faut ${CUFF_HP * 100} % ou moins)`);
      return;
    }
    ctx.hud.setPrompt(`[F] Menotter (${hp} % de vie)`);
    if (ctx.input.hit('KeyF')) {
      act('seize', cand.id);
      this.cuffing = { n: cand, t: 0 };
      ctx.audio.impact('body', cand.pos, 0.5);
    }
  }

  onDamaged(d: DamageInfo) { void d; }

  hudInfo() {
    const w = this.current;
    const ammo = w === 'lbd' ? `${this.chamber}/${this.ammo}` : w === 'gas' ? `${this.gas}` : w === 'sting' ? `${this.sting}` : '—';
    return {
      slots: this.weapons.map((k) => ({ name: NAMES[k], n: k === 'lbd' ? this.chamber + this.ammo : k === 'gas' ? this.gas : k === 'sting' ? this.sting : -1, active: k === w })),
      extra: `${NAMES[w]} : ${ammo} · Trousse ${this.medkits} · Masque ${this.p.maskOn ? '✓' : '✗'}`,
    };
  }
}
