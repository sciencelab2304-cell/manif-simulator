import { ctx } from '../core/context';
import { clamp } from '../core/util';
import { PHASE_NAMES } from '../tension/tension';
import { ZONES, type Zone } from '../damage/damage';
import * as L from '../world/layout';
import { PoliceKit } from '../weapons/policeKit';
import { REFILL_SECONDS } from '../vehicles/watercannon';

const $ = (id: string) => document.getElementById(id)!;

export class Hud {
  root = $('hud');
  private promptEl = $('prompt');
  private promptMsg = '';
  private promptMsgT = 0;
  private framePrompt = '';
  private feedEl = $('feed');
  private chargeEl = $('charge');
  private chargeFill = $('charge-fill');
  private progEl = $('progress');
  private progFill = $('progress-fill');
  private progLabel = $('progress-label');
  private hitEl = $('hitmarker');
  private bannerEl = $('banner');
  private speakerEl = $('speaker');
  private mapCanvas = $('minimap') as HTMLCanvasElement;
  private map = (this.mapCanvas as HTMLCanvasElement).getContext('2d')!;
  private mapT = 0;
  private fpsT = 0; private frames = 0;
  private progressSet = false;

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  /** rewrites "[E]"-style key hints; the touch overlay swaps them for its button names */
  hint = (text: string) => text;

  feed(text: string, color = '#fff') {
    const d = document.createElement('div');
    d.textContent = this.hint(text); d.style.color = color;
    this.feedEl.appendChild(d);
    while (this.feedEl.children.length > 6) this.feedEl.firstChild!.remove();
    setTimeout(() => d.remove(), 4200);
  }
  prompt(text: string, seconds: number) { this.promptMsg = this.hint(text); this.promptMsgT = seconds; }
  setPrompt(text: string) { if (text) this.framePrompt = this.hint(text); }
  charge(v: number) { this.chargeEl.style.opacity = v > 0 ? '1' : '0'; this.chargeFill.style.width = `${v * 100}%`; }
  progress(v: number, label = '') {
    this.progressSet = v > 0;
    this.progEl.style.opacity = v > 0 ? '1' : '0';
    this.progFill.style.width = `${clamp(v, 0, 1) * 100}%`;
    this.progLabel.textContent = label;
  }
  /** "×3" next to the crosshair: people hit within the last moments (throws into the crowd, gas, water). */
  private combo = 0; private comboT = 0;
  private comboEl = $('combo');
  hitCount() {
    this.combo = this.comboT > 0 ? this.combo + 1 : 1;
    this.comboT = 1.6;
    this.comboEl.textContent = this.combo > 1 ? `×${this.combo} touchés` : '+1 touché';
    this.comboEl.classList.remove('on'); void this.comboEl.offsetWidth; this.comboEl.classList.add('on');
  }
  hitMarker(head: boolean) {
    this.hitEl.classList.remove('on', 'head'); void this.hitEl.offsetWidth;
    this.hitEl.classList.add('on'); if (head) this.hitEl.classList.add('head');
  }
  banner(title: string, sub: string) {
    this.bannerEl.innerHTML = `<div class="t">${title}</div><div class="s">${sub}</div>`;
    this.bannerEl.classList.remove('on'); void this.bannerEl.offsetWidth; this.bannerEl.classList.add('on');
  }
  loudspeaker(text: string) {
    this.speakerEl.innerHTML = `<span>📢 Haut-parleur</span>${text}`;
    this.speakerEl.classList.remove('on'); void this.speakerEl.offsetWidth; this.speakerEl.classList.add('on');
  }

  update(dt: number) {
    const p = ctx.player;
    // fps
    this.frames++; this.fpsT += dt;
    if (this.fpsT > 0.5) { $('fps').textContent = `${Math.round(this.frames / this.fpsT)} fps`; this.frames = 0; this.fpsT = 0; }
    // prompts
    this.promptMsgT -= dt;
    this.promptEl.textContent = this.promptMsgT > 0 ? this.promptMsg : this.framePrompt;
    this.framePrompt = '';
    // tension
    const t = ctx.tension;
    $('tension-fill').style.width = `${t.value}%`;
    $('tension-fill').style.background = t.phase === 0 ? '#7fbf7a' : t.phase === 1 ? '#e8a33c' : '#e0412f';
    $('phase').innerHTML = `Phase : <b>${PHASE_NAMES[t.phase]}</b>`;
    this.comboT -= dt;
    // objective & clock
    const left = Math.max(0, L.MATCH_SECONDS - ctx.time);
    const mm = Math.floor(left / 60), ss = Math.floor(left % 60).toString().padStart(2, '0');
    const hour = 16 * 60 + 30 + Math.floor(ctx.time / L.MATCH_SECONDS * 210);
    const clock = `${Math.floor(hour / 60)}h${(hour % 60).toString().padStart(2, '0')}`;
    const st = ctx.stats;
    if (ctx.camp === 'protest') {
      const d = Math.round(Math.hypot(p.pos.x - L.OBJECTIVE.x, p.pos.z - L.OBJECTIVE.z));
      $('objective').textContent = `Objectif : atteindre la place de la Concorde-Neuve · ${mm}:${ss}`;
      $('score-main').innerHTML = `<b>${d} m</b> avant la place`;
    } else {
      $('objective').textContent = `Objectif : ${ctx.game.arrestGoal} interpellations, ou tenir la place · ${mm}:${ss}`;
      $('score-main').innerHTML = `<b>${ctx.crowd.humanArrests} / ${ctx.game.arrestGoal}</b> interpellations${ctx.net.multi ? ` · vous ${st.myArrests}` : ''}`;
    }
    // the protesters' push on the police line (tug of war, see Crowd.updatePush)
    const P = ctx.crowd.police, prot = ctx.camp === 'protest';
    $('push').classList.toggle('hidden', ctx.tension.phase === 0);
    $('push').classList.toggle('on', P.pushers > 0);
    $('push-fill').style.width = `${P.push}%`;
    $('push-label').textContent = P.pushers ? (prot ? 'Poussée en cours !' : 'Ça pousse sur la ligne !') : prot ? 'Poussée : collez-vous aux CRS' : 'Poussée : ligne tenue';
    $('score-sub').textContent = `Touchés ${st.hits} · Personnes ${st.peopleHit} · Tête ${st.headHits}`;
    $('clock').textContent = clock;
    // health
    const hp = clamp(p.hp / p.maxHp, 0, 1);
    $('hp-fill').style.width = `${hp * 100}%`;
    $('hp-fill').style.background = hp > 0.5 ? '#52d273' : hp > 0.25 ? '#ffc93c' : '#ff5252';
    $('hp-num').textContent = `${Math.max(0, Math.round(p.hp))}`;
    for (const z of ZONES) {
      const el = document.getElementById('w-' + z);
      if (!el) continue;
      const v = p.wounds.z[z as Zone];
      el.setAttribute('fill', v < 5 ? 'rgba(220,215,200,0.35)' : v < 35 ? '#e8c23c' : v < 70 ? '#e8742c' : '#d8261a');
    }
    const tags: string[] = [];
    if (p.wounds.bleed > 0.05) tags.push('<span class="r">Saignement</span>');
    if (p.wounds.limp > 0.3) tags.push('Boiterie');
    if (p.wounds.eye) tags.push('<span class="r">Œil</span>');
    if (p.wounds.jaw) tags.push('Mâchoire');
    if (p.wounds.concussion > 0) tags.push('Sonné');
    if (p.tears > 0.15) tags.push('Gaz');
    if (p.maskOn) tags.push('Masque');
    $('status').innerHTML = tags.join(' · ');
    // inventory
    const info = p.kit.hudInfo();
    $('inventory').innerHTML = info.slots.map((s, i) => `<div class="slot${s.active ? ' active' : ''}"><div class="k">${i + 1}</div><div class="n">${s.n < 0 ? '' : s.n}</div>${s.name}</div>`).join('');
    $('extra').textContent = info.extra;
    // scope / vehicle
    const aiming = p.kit instanceof PoliceKit && p.kit.aiming;
    $('scope').classList.toggle('on', aiming);
    $('crosshair').style.opacity = aiming || p.inVehicle ? '0' : '1';
    const truck = ctx.truck;
    $('vehicle').classList.toggle('hidden', !p.inVehicle);
    if (p.inVehicle) {
      $('tank-fill').style.width = `${truck.tank}%`;
      $('tank-fill').classList.toggle('refill', truck.refilling);
      $('tank-label').textContent = truck.refilling ? `Remplissage du réservoir… ${Math.ceil((100 - truck.tank) * REFILL_SECONDS / 100)} s` : `Canon à eau · réservoir ${Math.round(truck.tank)} %`;
    }
    if (!this.progressSet) this.progEl.style.opacity = '0';
    this.progressSet = false;
    // minimap
    this.mapT -= dt;
    if (this.mapT <= 0) { this.mapT = 1 / 20; this.drawMap(); }
  }

  private drawMap() {
    const g = this.map, W = this.mapCanvas.width, H = this.mapCanvas.height;
    const p = ctx.player;
    const center = p.inVehicle ? ctx.truck.pos : p.pos;
    const yaw = p.inVehicle ? ctx.truck.yaw + ctx.truck.turretYaw + Math.PI : p.yaw;
    const s = 1.5; // px per meter
    g.save();
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(12,12,14,0.78)'; g.fillRect(0, 0, W, H);
    g.translate(W / 2, H / 2);
    g.rotate(yaw);
    g.scale(s, s);
    g.translate(-center.x, -center.z);
    // walkable areas
    g.fillStyle = '#3a3a3e';
    for (const r of L.WALKABLE) g.fillRect(r.x0, r.z0, r.x1 - r.x0, r.z1 - r.z0);
    g.fillStyle = '#4a4a4f'; g.fillRect(-L.ROAD_HALF, L.AVE_END, L.ROAD_HALF * 2, L.AVE_START - L.AVE_END);
    // objective
    g.strokeStyle = ctx.camp === 'protest' ? '#f2c14e' : '#7aa0ff'; g.lineWidth = 1.2;
    g.beginPath(); g.arc(L.OBJECTIVE.x, L.OBJECTIVE.z, L.OBJECTIVE.r, 0, Math.PI * 2); g.stroke();
    // gas & fires
    for (const c of ctx.gas.clouds) { g.fillStyle = `rgba(230,235,225,${0.25 * c.conc})`; g.beginPath(); g.arc(c.pos.x, c.pos.z, c.radius, 0, Math.PI * 2); g.fill(); }
    for (const f of ctx.destruction.fires) { g.fillStyle = '#ff7a20'; g.beginPath(); g.arc(f.pos.x, f.pos.z, 1.6, 0, Math.PI * 2); g.fill(); }
    // people
    for (const n of ctx.crowd.all) {
      if (n.state === 'gone') continue;
      g.fillStyle = n.isDown ? '#ff3b3b' : n.role === 'crs' ? '#6f95ff' : n.role === 'casseur' ? '#444' : n.role === 'medic' ? '#fff' : n.role === 'firefighter' ? '#e04040' : n.role === 'journalist' ? '#58c' : '#e6b86a';
      g.fillRect(n.pos.x - 0.7, n.pos.z - 0.7, 1.4, 1.4);
    }
    // truck
    const t = ctx.truck;
    g.save(); g.translate(t.pos.x, t.pos.z); g.rotate(-t.yaw); g.fillStyle = '#9fb7ff'; g.fillRect(-1.3, -4.6, 2.6, 9.2); g.restore();
    g.restore();
    // player arrow
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(W / 2, H / 2 - 6); g.lineTo(W / 2 - 4, H / 2 + 4); g.lineTo(W / 2 + 4, H / 2 + 4); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.2)'; g.strokeRect(0.5, 0.5, W - 1, H - 1);
  }
}

export function woundSvg() {
  // tiny body silhouette for the localised wounds
  return `<svg viewBox="0 0 40 80" width="32" height="64">
    <circle id="w-head" cx="20" cy="9" r="7"/>
    <rect id="w-torso" x="12" y="18" width="16" height="24" rx="3"/>
    <rect id="w-armL" x="30" y="19" width="6" height="24" rx="3"/>
    <rect id="w-armR" x="4" y="19" width="6" height="24" rx="3"/>
    <rect id="w-legL" x="21" y="44" width="7" height="32" rx="3"/>
    <rect id="w-legR" x="12" y="44" width="7" height="32" rx="3"/>
  </svg>`;
}
