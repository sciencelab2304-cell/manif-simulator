import type { Input } from '../core/input';
import { ctx, type Camp } from '../core/context';

/**
 * Touch overlay for phones/tablets. It only drives the shared Input state: a floating joystick on the left,
 * a look pad on the right, and buttons that press the same key codes / mouse buttons as the keyboard.
 */
type Act = { key?: string; btn?: number; toggle?: boolean; wheel?: boolean; look?: boolean; fn?: () => void };
type Btn = [label: string, act: Act];

const RING: Record<Camp, Btn[]> = { // inner arc first (3 buttons), then the outer arc
  protest: [
    ['Cloche', { btn: 2, look: true }], ['Ramas.', { key: 'KeyE' }], ['Saut', { key: 'Space' }],
    ['Feu / Barric.', { key: 'KeyF' }], ['Objet ⟳', { wheel: true }], ['Accr.', { key: 'KeyC', toggle: true }],
  ],
  police: [
    ['Viser', { btn: 2, look: true }], ['Rech.', { key: 'KeyR' }], ['CHARGE', { key: 'KeyG' }],
    ['Canon / E', { key: 'KeyE' }], ['Menotter', { key: 'KeyF' }], ['Arme ⟳', { wheel: true }], ['Accr.', { key: 'KeyC', toggle: true }], ['Saut', { key: 'Space' }],
  ],
};
const PILLS: Record<Camp, Btn[]> = {
  protest: [['Masque', { key: 'KeyM' }], ['Medic', { key: 'KeyH' }], ['Slogan', { key: 'KeyI' }], ['Sérum', { key: 'KeyK' }], ['Panneau', { key: 'KeyX' }], ['Vue', { key: 'KeyP' }]],
  police: [['Avancer', { key: 'KeyT' }], ['Tenir', { key: 'KeyV' }], ['Masque', { key: 'KeyM' }], ['Soins', { key: 'KeyH' }], ['Vue', { key: 'KeyP' }]],
};
const LOOK_GAIN = 2.2; // touch pixels feel smaller than mouse counts
const STICK_R = 56;

export class TouchControls {
  private root = document.createElement('div');
  private base = document.createElement('div');
  private knob = document.createElement('div');
  private drags = new Map<number, (e: PointerEvent, end: boolean) => void>();

  constructor(private input: Input, camp: Camp, onPause: () => void) {
    this.root.id = 'touch';
    this.base.className = 'stick'; this.knob.className = 'knob';
    this.base.appendChild(this.knob);
    const ring = document.createElement('div'); ring.className = 'ring';
    const pills = document.createElement('div'); pills.className = 'pills';
    ring.appendChild(this.button('FEU', { btn: 0, look: true }, 'fire'));
    const outer = RING[camp].length - 3;
    RING[camp].forEach(([l, a], i) => {
      const b = this.button(l, a);
      // two arcs around the fire button, from its left to straight above it
      const k = i < 3 ? i / 2 : (i - 3) / Math.max(1, outer - 1);
      const r = i < 3 ? 100 : 172, ang = Math.PI * (1 - 0.5 * k);
      b.style.transform = `translate(${Math.cos(ang) * r}px, ${-Math.sin(ang) * r}px)`;
      ring.appendChild(b);
    });
    pills.appendChild(this.button('❚❚', { fn: onPause }));
    for (const [l, a] of PILLS[camp]) pills.appendChild(this.button(l, a));
    this.root.append(this.base, ring, pills);
    document.getElementById('hud')!.appendChild(this.root);
    this.home();
    const names = new Map([...RING[camp], ...PILLS[camp]].filter(([, a]) => a.key).map(([l, a]) => [a.key!.slice(3), l]));
    ctx.hud.hint = (t) => t.replace(/\[([A-Z])\]/g, (m, k) => names.has(k) ? `[${names.get(k)}]` : m);

    // empty screen: left side = joystick, right side = look
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target !== this.root) return;
      e.preventDefault();
      this.drags.set(e.pointerId, e.clientX < innerWidth * 0.42 ? this.stick(e) : this.lookDrag(e));
    });
    const move = (e: PointerEvent, end: boolean) => this.drags.get(e.pointerId)?.(e, end);
    window.addEventListener('pointermove', (e) => move(e, false));
    for (const t of ['pointerup', 'pointercancel']) window.addEventListener(t, (e) => { move(e as PointerEvent, true); this.drags.delete((e as PointerEvent).pointerId); });

    // tap an inventory slot to select it
    document.getElementById('inventory')!.addEventListener('pointerdown', (e) => {
      const slot = (e.target as HTMLElement).closest('.slot');
      if (!slot) return;
      const code = 'Digit' + (Array.prototype.indexOf.call(slot.parentElement!.children, slot) + 1);
      input.key(code, true); input.key(code, false);
    });
  }

  private button(label: string, a: Act, cls = '') {
    const b = document.createElement('div');
    b.className = 'tb ' + cls; b.textContent = label;
    const set = (down: boolean) => {
      if (a.key) this.input.key(a.key, down);
      if (a.btn !== undefined) this.input.button(a.btn, down);
      b.classList.toggle('on', down);
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (a.fn) return a.fn();
      if (a.wheel) { this.input.wheel += 1; return; }
      if (a.toggle) return set(!this.input.down(a.key!));
      set(true);
      let lx = e.clientX, ly = e.clientY;
      this.drags.set(e.pointerId, (m, end) => {
        if (a.look) { this.input.look((m.clientX - lx) * LOOK_GAIN, (m.clientY - ly) * LOOK_GAIN); lx = m.clientX; ly = m.clientY; }
        if (end) set(false);
      });
    });
    return b;
  }

  private stick(e: PointerEvent) {
    const ox = e.clientX, oy = e.clientY;
    this.base.style.left = `${ox}px`; this.base.style.top = `${oy}px`;
    this.base.classList.add('on');
    return (m: PointerEvent, end: boolean) => {
      let dx = m.clientX - ox, dy = m.clientY - oy;
      const l = Math.hypot(dx, dy);
      if (l > STICK_R) { dx *= STICK_R / l; dy *= STICK_R / l; }
      this.knob.style.transform = end ? '' : `translate(${dx}px, ${dy}px)`;
      this.input.stick.x = end ? 0 : dx / STICK_R;
      this.input.stick.y = end ? 0 : -dy / STICK_R;
      if (end) this.home();
    };
  }

  private lookDrag(e: PointerEvent) {
    let lx = e.clientX, ly = e.clientY;
    return (m: PointerEvent) => {
      this.input.look((m.clientX - lx) * LOOK_GAIN, (m.clientY - ly) * LOOK_GAIN);
      lx = m.clientX; ly = m.clientY;
    };
  }

  /** resting place of the joystick, bottom-left */
  private home() {
    this.base.classList.remove('on');
    this.base.style.left = 'calc(env(safe-area-inset-left) + 110px)';
    this.base.style.top = 'calc(100% - 110px)';
  }
}
