import { ctx } from '../core/context';
import { clamp } from '../core/util';

export const PHASE_NAMES = ['Calme', 'Tension', 'Chaos'];
const SOMMATIONS = [
  { at: 38, text: 'Police ! Obéissance à la loi. Dispersez-vous.' },
  { at: 46, text: 'Première sommation : on va faire usage de la force.' },
  { at: 54, text: 'Dernière sommation : on va faire usage de la force.' },
];

/**
 * Global tension gauge (0..100) that drives the match:
 * 0-30 calm (peaceful march), 30-65 tension (insults, first throws, warnings), 65+ chaos.
 */
export class Tension {
  value = 0;
  phase = 0;
  sommations = 0;
  private lastReason = '';
  private recent = 0;

  /** Host side only: a client's own actions reach the host as actions (see net/actions). */
  add(v: number, reason = '') {
    if (ctx.over || ctx.net.isClient) return;
    // in the calm phase actions count, but the escalation is slower
    const k = this.phase === 0 ? 0.8 : 1;
    this.value = clamp(this.value + v * k, 0, 100);
    this.lastReason = reason;
    this.recent += v;
  }

  get weaponsFree() { return this.phase >= 1; }
  get gasAllowed() { return this.sommations >= 3 || this.phase >= 2; }

  update(dt: number) {
    const drift = this.phase === 0 ? 2 : this.phase === 1 ? 0.3 : 0.05;
    this.value = clamp(this.value + drift * dt, 0, 100);
    this.recent = Math.max(0, this.recent - dt * 2);
    const newPhase = this.value >= 65 ? 2 : this.value >= 30 ? 1 : 0;
    if (newPhase > this.phase) {
      this.phase = newPhase;
      if (newPhase === 1) {
        ctx.hud.banner('TENSION', 'Les premières insultes fusent. Des projectiles volent.');
      } else {
        ctx.hud.banner('ÇA PART EN CACAHUÈTE', 'Affrontements, lacrymos, incendies. Gardez la tête froide.');
        ctx.crowd.onChaos();
      }
    }
    if (this.phase >= 1 && this.sommations < SOMMATIONS.length && this.value >= SOMMATIONS[this.sommations].at) {
      const s = SOMMATIONS[this.sommations++];
      ctx.audio.bip();
      setTimeout(() => ctx.audio.say(s.text), 700);
      ctx.hud.loudspeaker(s.text);
    }
  }

  get reason() { return this.lastReason; }
}
