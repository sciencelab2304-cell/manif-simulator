/**
 * Unified input state. Keyboard/mouse (physical key codes, so ZQSD and WASD both work) and the touch
 * overlay feed the same state: touch buttons press virtual key codes / mouse buttons, the joystick sets `stick`
 * and the look pad adds to mouseDX/DY.
 */
export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  released = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  buttons = [false, false, false];
  btnPressed = [false, false, false];
  btnReleased = [false, false, false];
  /** virtual joystick, x right / y forward, length ≤ 1 */
  stick = { x: 0, y: 0 };
  locked = false;
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('F') && e.code.length <= 3) e.preventDefault();
      this.key(e.code, true);
    });
    window.addEventListener('keyup', (e) => this.key(e.code, false));
    window.addEventListener('mousemove', (e) => { if (this.locked) this.look(e.movementX, e.movementY); });
    window.addEventListener('mousedown', (e) => { if (this.locked) this.button(e.button, true); });
    window.addEventListener('mouseup', (e) => this.button(e.button, false));
    window.addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) this.reset();
      this.onLockChange(this.locked);
    });
    window.addEventListener('blur', () => this.reset());
  }

  key(code: string, down: boolean) {
    if (down) { if (!this.keys.has(code)) this.pressed.add(code); this.keys.add(code); }
    else { this.keys.delete(code); this.released.add(code); }
  }
  button(i: number, down: boolean) {
    if (i > 2) return;
    if (down) this.btnPressed[i] = true;
    else if (this.buttons[i]) this.btnReleased[i] = true;
    this.buttons[i] = down;
  }
  look(dx: number, dy: number) { this.mouseDX += dx; this.mouseDY += dy; }

  reset() { this.keys.clear(); this.buttons = [false, false, false]; this.stick.x = this.stick.y = 0; }

  lock() {
    const p = this.el.requestPointerLock?.() as unknown as Promise<void> | undefined;
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(code: string) { return this.keys.has(code); }
  hit(code: string) { return this.pressed.has(code); }
  up(code: string) { return this.released.has(code); }

  /** movement axis from keys + joystick: x right, z forward */
  move() {
    const x = (this.down('KeyD') ? 1 : 0) - (this.down('KeyA') ? 1 : 0) + this.stick.x;
    const z = (this.down('KeyW') ? 1 : 0) - (this.down('KeyS') ? 1 : 0) + this.stick.y;
    const l = Math.hypot(x, z);
    return l > 1 ? { x: x / l, z: z / l } : { x, z };
  }
  /** Shift, or the joystick pushed to its rim */
  get sprint() { return this.down('ShiftLeft') || Math.hypot(this.stick.x, this.stick.y) > 0.92; }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
    this.btnPressed = [false, false, false];
    this.btnReleased = [false, false, false];
  }
}
