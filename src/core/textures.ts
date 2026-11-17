import * as THREE from 'three';
import { mulberry32 } from './util';

export function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function grain(g: CanvasRenderingContext2D, w: number, h: number, amount: number, rnd: () => number) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

/** Converts a grayscale height canvas into a tangent-space normal map. */
export function heightToNormal(src: HTMLCanvasElement, strength = 2) {
  const w = src.width, h = src.height;
  const s = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const out = canvas(w, h);
  const g = out.getContext('2d')!;
  const img = g.createImageData(w, h);
  const H = (x: number, y: number) => s[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
    const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.sqrt(dx * dx + dy * dy + 1);
    const i = (y * w + x) * 4;
    img.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
    img.data[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
    img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(out, false);
}

// ---------------------------------------------------------------- facades
/** One facade texture = 12 m wide (4 bays) x 20.48 m tall. Ground floor = 4.6 m. */
export const FACADE_W = 12;
export const FACADE_H = 20.48;
export const GROUND_H = 4.6;
export const FLOOR_H = 3.1;

export function facadeTextures(stone: string, seed: number) {
  const W = 512, H = 1024;
  const pxX = W / FACADE_W, pxY = H / FACADE_H;
  const rnd = mulberry32(seed);
  const c = canvas(W, H), g = c.getContext('2d')!;
  const e = canvas(W, H), ge = e.getContext('2d')!;
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  const Y = (m: number) => H - m * pxY; // meters from ground -> canvas y

  // stone + subtle dirt gradient
  g.fillStyle = stone; g.fillRect(0, 0, W, H);
  const dirt = g.createLinearGradient(0, 0, 0, H);
  dirt.addColorStop(0, 'rgba(60,50,40,0.18)'); dirt.addColorStop(0.7, 'rgba(0,0,0,0)'); dirt.addColorStop(1, 'rgba(30,25,20,0.25)');
  g.fillStyle = dirt; g.fillRect(0, 0, W, H);
  // ashlar joints
  g.strokeStyle = 'rgba(70,60,50,0.22)'; g.lineWidth = 1;
  for (let m = GROUND_H; m < FACADE_H; m += 0.5) { g.beginPath(); g.moveTo(0, Y(m)); g.lineTo(W, Y(m)); g.stroke(); }
  for (let row = 0; row < 40; row++) {
    const y0 = Y(GROUND_H + row * 0.5), y1 = Y(GROUND_H + row * 0.5 + 0.5);
    for (let m = (row % 2) * 0.6; m < FACADE_W; m += 1.2) { g.beginPath(); g.moveTo(m * pxX, y0); g.lineTo(m * pxX, y1); g.stroke(); }
  }
  // rusticated ground floor
  g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, Y(GROUND_H), W, GROUND_H * pxY);
  for (let m = 0.4; m < GROUND_H; m += 0.4) { g.fillStyle = 'rgba(40,30,20,0.25)'; g.fillRect(0, Y(m), W, 2); }

  // ground floor shop openings (interior seen through the glass)
  for (let b = 0; b < 4; b++) {
    const x0 = (b * 3 + 0.35) * pxX, x1 = (b * 3 + 2.65) * pxX;
    const grd = g.createLinearGradient(0, Y(3.6), 0, Y(0.25));
    grd.addColorStop(0, '#1b1a19'); grd.addColorStop(1, '#2e2a26');
    g.fillStyle = grd; g.fillRect(x0, Y(3.6), x1 - x0, (3.6 - 0.25) * pxY);
    // shelves / interior hints
    g.fillStyle = 'rgba(200,180,140,0.18)';
    for (let s = 0; s < 3; s++) g.fillRect(x0 + 6, Y(0.9 + s * 0.8), x1 - x0 - 12, 3);
    // interior light at night
    ge.fillStyle = `rgba(255,${190 + Math.floor(rnd() * 40)},120,${0.35 + rnd() * 0.4})`;
    ge.fillRect(x0, Y(3.6), x1 - x0, (3.6 - 0.25) * pxY);
    // sign band
    g.fillStyle = 'rgba(25,22,20,0.85)'; g.fillRect(x0 - 4, Y(4.25), x1 - x0 + 8, 0.45 * pxY);
  }

  // upper floors
  for (let f = 0; f < 5; f++) {
    const base = GROUND_H + f * FLOOR_H;
    const winH = f === 4 ? 1.9 : 2.3;
    for (let b = 0; b < 4; b++) {
      const cx = (b * 3 + 1.5) * pxX, ww = 1.15 * pxX;
      const y0 = Y(base + 0.55 + winH), hh = winH * pxY;
      // stone surround
      g.fillStyle = 'rgba(255,250,235,0.25)'; g.fillRect(cx - ww / 2 - 6, y0 - 8, ww + 12, hh + 12);
      // pediment on 2nd floor (étage noble)
      if (f === 1) { g.fillStyle = 'rgba(255,250,235,0.35)'; g.fillRect(cx - ww / 2 - 10, y0 - 16, ww + 20, 8); }
      // glass
      const lit = rnd() < 0.35;
      const gl = g.createLinearGradient(cx - ww / 2, y0, cx + ww / 2, y0 + hh);
      gl.addColorStop(0, '#3d4652'); gl.addColorStop(0.5, '#1d232b'); gl.addColorStop(1, '#2a3038');
      g.fillStyle = gl; g.fillRect(cx - ww / 2, y0, ww, hh);
      // curtains
      if (rnd() < 0.5) { g.fillStyle = 'rgba(220,210,190,0.35)'; g.fillRect(cx - ww / 2, y0, ww * 0.22, hh); g.fillRect(cx + ww / 2 - ww * 0.22, y0, ww * 0.22, hh); }
      // frames
      g.strokeStyle = '#d9d4c8'; g.lineWidth = 3; g.strokeRect(cx - ww / 2, y0, ww, hh);
      g.lineWidth = 2; g.beginPath(); g.moveTo(cx, y0); g.lineTo(cx, y0 + hh);
      for (let k = 1; k < 3; k++) { g.moveTo(cx - ww / 2, y0 + (hh * k) / 3); g.lineTo(cx + ww / 2, y0 + (hh * k) / 3); }
      g.stroke();
      if (lit) {
        ge.fillStyle = `rgba(255,${170 + Math.floor(rnd() * 60)},${90 + Math.floor(rnd() * 60)},${0.5 + rnd() * 0.5})`;
        ge.fillRect(cx - ww / 2 + 2, y0 + 2, ww - 4, hh - 4);
      }
      // small rail on floors without full balcony
      if (f !== 1 && f !== 4) {
        g.strokeStyle = '#141414'; g.lineWidth = 2;
        const ry = Y(base + 0.55 + 0.9);
        g.beginPath(); g.moveTo(cx - ww / 2 - 4, ry); g.lineTo(cx + ww / 2 + 4, ry); g.stroke();
        for (let k = 0; k <= 8; k++) { const x = cx - ww / 2 + (ww * k) / 8; g.beginPath(); g.moveTo(x, ry); g.lineTo(x, Y(base + 0.55)); g.stroke(); }
      }
    }
    // string course
    g.fillStyle = 'rgba(255,250,240,0.25)'; g.fillRect(0, Y(base) - 3, W, 5);
    g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(0, Y(base) + 2, W, 2);
  }
  // rain streaks
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(40,35,30,${0.03 + rnd() * 0.05})`;
    g.fillRect(rnd() * W, rnd() * H * 0.6, 1 + rnd() * 3, 40 + rnd() * 200);
  }
  grain(g, W, H, 14, rnd);
  return { map: tex(c), emissive: tex(e) };
}

export function mansardTexture() {
  const W = 256, H = 256; // 12 m x 4 m (slope)
  const c = canvas(W, H), g = c.getContext('2d')!;
  const rnd = mulberry32(77);
  g.fillStyle = '#5b6670'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(30,35,40,0.6)'; g.lineWidth = 2;
  for (let x = 0; x < W; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let b = 0; b < 4; b++) {
    const cx = (b + 0.5) * 64;
    g.fillStyle = '#e8e2d4'; g.fillRect(cx - 14, 90, 28, 70);
    g.fillStyle = '#20262d'; g.fillRect(cx - 10, 100, 20, 58);
    g.beginPath(); g.fillStyle = '#e8e2d4'; g.moveTo(cx - 18, 92); g.lineTo(cx, 70); g.lineTo(cx + 18, 92); g.fill();
  }
  grain(g, W, H, 18, rnd);
  return tex(c);
}

export function railTexture() {
  const W = 256, H = 64;
  const c = canvas(W, H), g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#111'; g.fillStyle = '#111';
  g.lineWidth = 4; g.strokeRect(2, 2, W - 4, H - 4);
  g.lineWidth = 2;
  for (let x = 0; x < W; x += 16) {
    g.beginPath(); g.moveTo(x, 4); g.lineTo(x, H - 4); g.stroke();
    g.beginPath(); g.arc(x + 8, H / 2, 6, 0, Math.PI * 2); g.stroke();
  }
  const t = tex(c);
  return t;
}

// ---------------------------------------------------------------- ground
function asphaltCanvas(base: number, size: number, seed: number) {
  const c = canvas(size, size), g = c.getContext('2d')!;
  const rnd = mulberry32(seed);
  g.fillStyle = `rgb(${base},${base},${base + 2})`; g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 8; i++) {
    const v = base + (rnd() - 0.5) * 50;
    g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    g.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  for (let i = 0; i < 18; i++) {
    g.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.08})`;
    g.beginPath(); g.ellipse(rnd() * size, rnd() * size, 10 + rnd() * 50, 6 + rnd() * 30, rnd() * 3, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = 'rgba(20,20,20,0.5)'; g.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    let x = rnd() * size, y = rnd() * size;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 8; k++) { x += (rnd() - 0.5) * 30; y += (rnd() - 0.5) * 30; g.lineTo(x, y); }
    g.stroke();
  }
  grain(g, size, size, 18, rnd);
  return c;
}

export function asphalt() {
  const c = asphaltCanvas(62, 512, 3);
  return { map: tex(c), normal: heightToNormal(c, 1.5) };
}
export function sidewalk() {
  const c = asphaltCanvas(118, 512, 9);
  const g = c.getContext('2d')!;
  return { map: tex(c), normal: heightToNormal(c, 1) };
  void g;
}

export function cobbles() {
  const S = 512;
  const c = canvas(S, S), g = c.getContext('2d')!;
  const h = canvas(S, S), gh = h.getContext('2d')!;
  const rnd = mulberry32(11);
  g.fillStyle = '#3a3532'; g.fillRect(0, 0, S, S);
  gh.fillStyle = '#000'; gh.fillRect(0, 0, S, S);
  const n = 16, cs = S / n;
  for (let row = 0; row < n; row++) for (let col = 0; col < n + 1; col++) {
    const ox = (row % 2) * cs * 0.5;
    const x = col * cs - ox + cs / 2, y = row * cs + cs / 2;
    const v = 95 + rnd() * 50;
    g.fillStyle = `rgb(${v},${v * 0.95},${v * 0.9})`;
    g.beginPath(); g.roundRect(x - cs * 0.44, y - cs * 0.44, cs * 0.88, cs * 0.88, 6); g.fill();
    const grd = gh.createRadialGradient(x, y, 2, x, y, cs * 0.5);
    grd.addColorStop(0, '#fff'); grd.addColorStop(0.75, '#999'); grd.addColorStop(1, '#000');
    gh.fillStyle = grd; gh.beginPath(); gh.roundRect(x - cs * 0.44, y - cs * 0.44, cs * 0.88, cs * 0.88, 6); gh.fill();
  }
  grain(g, S, S, 20, rnd);
  return { map: tex(c), normal: heightToNormal(h, 3) };
}

// ---------------------------------------------------------------- signage
export function signTexture(text: string, bg: string, fg: string, w = 512, h = 64) {
  const c = canvas(w, h), g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = `bold ${Math.floor(h * 0.55)}px Georgia, serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  return tex(c, true, false);
}

export function bannerTexture(text: string, bg: string, fg: string) {
  const w = 1024, h = 160;
  const c = canvas(w, h), g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,0.1)';
  for (let i = 0; i < 30; i++) g.fillRect(Math.random() * w, 0, 2, h);
  g.fillStyle = fg; g.font = 'bold 86px Impact, "Arial Black", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4, w - 40);
  return tex(c, true, false);
}

export function plateTexture(text: string) {
  return signTexture(text, '#f4f4f0', '#1a1a1a', 256, 64);
}

// ---------------------------------------------------------------- fx sprites
export function softSprite() {
  const S = 64, c = canvas(S, S), g = c.getContext('2d')!;
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  return tex(c, false, false);
}

export function smokeSprite() {
  const S = 128, c = canvas(S, S), g = c.getContext('2d')!;
  const rnd = mulberry32(5);
  for (let i = 0; i < 26; i++) {
    const x = S / 2 + (rnd() - 0.5) * S * 0.45, y = S / 2 + (rnd() - 0.5) * S * 0.45, r = S * (0.12 + rnd() * 0.2);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
  }
  return tex(c, false, false);
}

export function bloodTexture(seed: number) {
  const S = 128, c = canvas(S, S), g = c.getContext('2d')!;
  const rnd = mulberry32(seed);
  g.fillStyle = 'rgba(80,0,0,0.9)';
  g.beginPath(); g.ellipse(S / 2, S / 2, S * 0.22, S * 0.17, rnd() * 3, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, d = S * (0.15 + rnd() * 0.32), r = 1 + rnd() * 6;
    g.fillStyle = `rgba(${70 + rnd() * 40},0,0,${0.6 + rnd() * 0.3})`;
    g.beginPath(); g.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, r, 0, Math.PI * 2); g.fill();
  }
  return tex(c, true, false);
}

export function scorchTexture() {
  const S = 128, c = canvas(S, S), g = c.getContext('2d')!;
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(10,8,6,0.95)'); grd.addColorStop(0.6, 'rgba(15,12,10,0.6)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  return tex(c, true, false);
}

export function puddleTexture() {
  const S = 128, c = canvas(S, S), g = c.getContext('2d')!;
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0.8)'); grd.addColorStop(0.7, 'rgba(255,255,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  return tex(c, false, false);
}

export function glassShardsTexture() {
  const S = 128, c = canvas(S, S), g = c.getContext('2d')!;
  const rnd = mulberry32(21);
  for (let i = 0; i < 90; i++) {
    const x = S / 2 + (rnd() - 0.5) * S * 0.9 * rnd(), y = S / 2 + (rnd() - 0.5) * S * 0.9 * rnd();
    g.fillStyle = `rgba(220,235,240,${0.4 + rnd() * 0.5})`;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 8, y + (rnd() - 0.5) * 8); g.lineTo(x + (rnd() - 0.5) * 8, y + (rnd() - 0.5) * 8); g.fill();
  }
  return tex(c, true, false);
}

export function brokenGlassTexture() {
  const S = 256, c = canvas(S, S), g = c.getContext('2d')!;
  const rnd = mulberry32(31);
  g.clearRect(0, 0, S, S);
  // jagged remains at the frame edges
  g.fillStyle = 'rgba(190,210,220,0.55)';
  const edge = (pts: number[][]) => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.fill(); };
  const top: number[][] = [[0, 0]]; for (let x = 0; x <= S; x += 16) top.push([x, 10 + rnd() * 50]); top.push([S, 0]); edge(top);
  const bot: number[][] = [[0, S]]; for (let x = 0; x <= S; x += 16) bot.push([x, S - 8 - rnd() * 40]); bot.push([S, S]); edge(bot);
  const left: number[][] = [[0, 0]]; for (let y = 0; y <= S; y += 16) left.push([6 + rnd() * 30, y]); left.push([0, S]); edge(left);
  g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1;
  for (let i = 0; i < 20; i++) { g.beginPath(); g.moveTo(rnd() * 40, rnd() * S); g.lineTo(rnd() * 80, rnd() * S); g.stroke(); }
  return tex(c, true, false);
}
