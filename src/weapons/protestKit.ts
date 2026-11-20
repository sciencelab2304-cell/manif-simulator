import * as THREE from 'three';
import { ctx } from '../core/context';
import { clamp, pick } from '../core/util';
import { KIND_FR, type ThrowKind } from './projectiles';
import type { Player } from '../player/player';
import type { Target } from './pickups';
import type { DamageInfo } from '../damage/damage';
import { act } from '../net/actions';

const ORDER: ThrowKind[] = ['pave', 'bouteille', 'conserve', 'canette', 'mortier', 'fusee', 'fumigene', 'gas'];
const CALM_OK: ThrowKind[] = ['fumigene'];
/** Always last in the bar: selected, the throw button sets fire / builds a barricade, like [F]. */
const LIGHTER = 'briquet';
type Slot = ThrowKind | typeof LIGHTER;

const SLOGANS = ['« On lâche rien ! »', '« Valbrune debout ! »', '« Tous ensemble, tous ensemble ! »', '« Et un, et deux, et trois… »', '« Des sous pour les salaires ! »'];
const INSULTS = ['« Rentrez chez vous ! »', '« Dégagez ! »', '« Bande de robots ! »', '« Lâches ! »', '« Honte à vous ! »'];

const _v = new THREE.Vector3();

/** Protester gear: things to throw, makeshift shield, mask, saline, lighter. */
export class ProtestKit {
  inv: Record<string, number> = { pave: 4, bouteille: 2, canette: 1, conserve: 0, mortier: 4, fusee: 4, fumigene: 2, gas: 0 };
  gasEmit = 0;
  sel = 0;
  charge = 0;
  charging = false;
  lob = false;
  panneau = false;
  panneauUp = false;
  panneauHp = 0;
  serum = 2;
  shoutCd = 0;
  digT = 0;
  target: Target | null = null;
  private msgCd = 0;

  constructor(private p: Player) {
    const L = p.perks, inv = this.inv;
    inv.pave += 2 * L.ammo + (L.boost === 'ammo' ? 6 : 0);
    inv.mortier += L.mags + (L.boost === 'ammo' ? 2 : 0);
    inv.fusee += L.mags + (L.boost === 'grenade' ? 1 : 0);
    inv.fumigene += L.boost === 'grenade' ? 2 : 0;
  }

  get list(): Slot[] { return [...ORDER.filter((k) => (this.inv[k] ?? 0) > 0), LIGHTER]; }
  get current(): Slot { const l = this.list; return l[this.sel % l.length]; }

  give(kind: string, n = 1) {
    if (kind === 'panneau') { this.panneau = true; this.panneauHp = 140; ctx.hud.feed('Panneau ramassé : [X] pour se protéger', '#f2e2b0'); return; }
    if (kind === 'masque') { this.p.hasGasMask = true; this.p.maskOn = true; ctx.hud.feed('Masque à gaz enfilé ([M])', '#f2e2b0'); return; }
    if (kind === 'serum') { this.serum += 2; ctx.hud.feed('+2 doses de sérum ([K])', '#f2e2b0'); return; }
    this.inv[kind] = (this.inv[kind] ?? 0) + n;
    const l = this.list;
    this.sel = Math.max(0, l.indexOf(kind as ThrowKind));
    ctx.hud.feed(`+${n} ${KIND_FR[kind as ThrowKind] ?? kind}`, '#f2e2b0');
  }

  private say(msg: string) { if (this.msgCd <= 0) { ctx.hud.prompt(msg, 2.5); this.msgCd = 2.5; } }

  update(dt: number) {
    const inp = ctx.input, p = this.p;
    this.msgCd -= dt; this.shoutCd -= dt;
    if (!p.alive) return;
    const l = this.list;
    if (inp.wheel) this.sel = (this.sel + inp.wheel + l.length * 10) % Math.max(1, l.length);
    for (let i = 0; i < 9; i++) if (inp.hit('Digit' + (i + 1)) && i < l.length) this.sel = i;
    const cur = this.current;
    p.vm.setItem(this.panneauUp ? '' : cur);

    // panel
    if (inp.hit('KeyX') && this.panneau) this.panneauUp = !this.panneauUp;
    if (this.panneau && this.panneauHp <= 0) { this.panneau = false; this.panneauUp = false; ctx.hud.feed('Votre panneau a volé en éclats', '#ff8a6a'); }
    // mask & saline
    if (inp.hit('KeyM')) { p.maskOn = !p.maskOn; ctx.hud.feed(p.maskOn ? (p.hasGasMask ? 'Masque à gaz mis' : 'Masque FFP2 + lunettes de piscine') : 'Masque retiré', '#cfcfcf'); }
    if (inp.hit('KeyK') && this.serum > 0) { this.serum--; p.serumT = 25; p.tears *= 0.3; ctx.hud.feed('Sérum physiologique dans les yeux', '#9fd29b'); }
    // call a street medic
    if (inp.hit('KeyH')) { p.callMedic = true; ctx.hud.feed('« Medic ! » Un street medic arrive.', '#ffffff'); }
    // slogans / insults (raise the tension)
    if (inp.hit('KeyI') && this.shoutCd <= 0) {
      const insult = ctx.tension.phase >= 1 || ctx.input.down('ShiftLeft');
      ctx.hud.feed(insult ? pick(INSULTS) : pick(SLOGANS), insult ? '#ffb070' : '#ffe9a0');
      act('tension', insult ? 2.2 : 0.8, insult ? 'insultes' : 'slogans');
      if (insult) p.aggro += 0.3;
      this.shoutCd = 2.5;
    }

    // pick up
    const fwd = p.forward(_v);
    this.target = ctx.pickups.find(p.eye, fwd);
    ctx.pickups.showTarget(this.target);
    if (this.target) {
      const t = this.target;
      if (t.type === 'dig') {
        if (inp.down('KeyE')) {
          this.digT += dt;
          ctx.hud.progress(this.digT / 1.4, 'Dépavage…');
          if (this.digT >= 1.4) { this.digT = 0; this.give('pave', 2); ctx.audio.impact('stone', t.pos, 0.6); ctx.particles.dust(t.pos, 5); }
        } else { this.digT = 0; ctx.hud.progress(0); }
      } else if (inp.hit('KeyE')) {
        if (t.type === 'item') {
          const k = ctx.pickups.take(t.item);
          act('take', 'item', ctx.pickups.items.indexOf(t.item));
          this.give(k, k === 'pave' ? 2 : 1);
        } else {
          act('take', 'proj', t.proj.id);
          const { kind, emit } = ctx.projectiles.take(t.proj);
          if (kind === 'gas') { this.gasEmit = emit; this.p.gas += 0.2; }
          this.give(kind, 1);
        }
        ctx.audio.pickup();
      }
      ctx.hud.setPrompt(`[E] ${t.type === 'dig' ? 'Maintenir : ' : 'Ramasser : '}${t.label}`);
    } else {
      this.digT = 0;
      const near = ctx.destruction.propsNear(p.feet, 8).length;
      const burn = ctx.destruction.nearestBurnable(p.feet, 2.5);
      if (ctx.tension.phase >= 1 && near >= 2) ctx.hud.setPrompt('[F] Monter une barricade');
      else if (ctx.tension.phase >= 1 && burn) ctx.hud.setPrompt(`[F] Mettre le feu (${burn.kind === 'car' ? 'voiture' : burn.kind === 'bin' ? 'poubelle' : burn.kind === 'barricade' ? 'barricade' : 'abribus'})`);
      else ctx.hud.setPrompt('');
    }

    // barricade / fire: [F], or the throw button with the lighter selected
    const lighter = cur === LIGHTER && !this.panneauUp;
    if (inp.hit('KeyF') || lighter && inp.btnPressed[0]) {
      if (ctx.tension.phase === 0) this.say('Le cortège est pacifique pour l\'instant.');
      else {
        const front = p.feet.clone().add(_v.copy(fwd).setY(0).normalize().multiplyScalar(3));
        act('fire', [front.x, front.y, front.z], p.yaw);
      }
    }

    // throwing
    if (cur === LIGHTER || this.panneauUp) { this.charging = false; this.charge = 0; p.vm.charge = 0; return; }
    const allowed = ctx.tension.weaponsFree || CALM_OK.includes(cur);
    if ((inp.btnPressed[0] || inp.btnPressed[2]) && p.stun < 0.5) {
      if (!allowed) this.say('Le cortège est calme… Personne ne lance rien. Pour l\'instant. [I] pour scander / provoquer');
      else { this.charging = true; this.charge = 0; this.lob = inp.btnPressed[2]; }
    }
    if (this.charging) {
      this.charge = clamp(this.charge + dt * p.perks.reload / 0.85, 0, 1);
      ctx.hud.charge(this.charge);
      const released = this.lob ? inp.btnReleased[2] || !inp.buttons[2] : inp.btnReleased[0] || !inp.buttons[0];
      if (released) { this.throw(cur); this.charging = false; ctx.hud.charge(0); }
    }
    p.vm.charge = this.charging ? this.charge : 0;
  }

  private throw(kind: ThrowKind) {
    const p = this.p;
    const dir = p.forward(new THREE.Vector3());
    const from = p.eye.clone().addScaledVector(dir, 0.5).add(_v.set(0, -0.08, 0));
    let speed = 9 + this.charge * 14;
    if (this.lob) { dir.y += 0.45; dir.normalize(); speed = 8 + this.charge * 8; }
    else { dir.y += 0.06; dir.normalize(); }
    if (kind === 'fusee') { speed = 20; }
    if (kind === 'mortier' && !this.lob) { speed = 18 + this.charge * 8; dir.y -= 0.02; }
    const vel = dir.multiplyScalar(speed).add(new THREE.Vector3(p.vel.x, 0, p.vel.z).multiplyScalar(0.5));
    act('throw', kind, [from.x, from.y, from.z], [vel.x, vel.y, vel.z], kind === 'gas' ? Math.max(2, this.gasEmit) : 0);
    this.inv[kind]--;
    p.vm.throwT = 0.35;
    ctx.audio.whoosh(null, 0.3);
    ctx.stats.thrown++;
    p.aggro += kind === 'fumigene' ? 0.1 : 1;
    const l = this.list;
    if (this.sel >= l.length) this.sel = 0;
  }

  onDamaged(d: DamageInfo) { void d; if (this.charging && Math.random() < 0.5) { this.charging = false; ctx.hud.charge(0); } }

  hudInfo() {
    return {
      slots: this.list.map((k) => ({ name: k === LIGHTER ? 'Briquet' : KIND_FR[k], n: k === LIGHTER ? -1 : this.inv[k], active: k === this.current })),
      extra: `Sérum ${this.serum} · Masque ${this.p.maskOn ? (this.p.hasGasMask ? 'gaz ✓' : 'FFP2 ✓') : '✗'}${this.panneau ? ' · Panneau ' + Math.max(0, Math.round(this.panneauHp)) : ''}`,
    };
  }
}
