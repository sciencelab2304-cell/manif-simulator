import * as THREE from 'three';
import { ctx, type Camp, type Human } from '../core/context';
import { rr, chance, clamp, pick, angleDiff } from '../core/util';
import { bannerTexture, signTexture } from '../core/textures';
import { BodyRenderer, P } from './body';
import { NPC, type Role } from './npc';
import type { Avatar } from '../net/avatar';
import type { DamageInfo } from '../damage/damage';
import * as L from '../world/layout';
import { clampWalkable } from '../world/layout';
import type { ThrowKind } from '../weapons/projectiles';
import { t } from '../core/i18n';

export type PoliceMode = 'hold' | 'advance' | 'charge' | 'regroup';

interface Banner { a: NPC; b: NPC; mesh: THREE.Mesh; fallen: boolean }

const BANNERS = ['VALBRUNE DEBOUT', 'ON LÂCHE RIEN', 'DES SALAIRES, PAS DES MISÈRES', 'NOS VIES VALENT PLUS', 'TOUS ENSEMBLE'];
const BANNER_COLS: [string, string][] = [['#c0251c', '#ffffff'], ['#f2efe6', '#b81d14'], ['#1d1d1d', '#f2efe6'], ['#2a5a9a', '#ffffff'], ['#e3c11a', '#1d1d1d']];

/** Walking pace of the march (m/s) and of its head: about a minute from the start to the police line. */
const MARCH = 2.6, MARCH_HEAD = 2.4;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

const isHuman = (n: NPC) => !!n.data.human;

export class Crowd {
  all: NPC[] = [];
  /** human players' avatars; `me` is the local one (solo or host) */
  humans: Avatar[] = [];
  /** handcuffings by human CRS players (the police objective) */
  humanArrests = 0;
  me!: Avatar;
  private ids = new Map<number, NPC>();
  renderer: BodyRenderer;
  grid = new Map<number, NPC[]>();
  circleGrid = new Map<number, number[]>();
  /** `push` 0..100: the protesters' pressure on the line (see updatePush); full, the line falls back by BREACH_STEP. */
  police = { mode: 'hold' as PoliceMode, lineZ: L.CRS_LINE_Z, modeT: 0, autoT: rr(35, 50), maxZ: -40, ordered: false, push: 0, pushers: 0 };
  marchHeadZ = 18;
  banners: Banner[] = [];
  center = new THREE.Vector3(0, 1.5, 0);
  level = 0;
  activeRagdolls = 0;
  private respawnT = 0;
  targetProtesters = 100;
  frontZ = 0; // z of the closest protester to the police line

  /** Painted band across the street: past it, the police may shoot without waiting for the warnings (L.NO_GO). */
  private noGo: THREE.Mesh;
  intrusion = false;

  constructor() {
    this.renderer = new BodyRenderer(ctx.scene, 320, ctx.q.shadows);
    const tex = signTexture(t('ZONE INTERDITE · ZONE INTERDITE · ZONE INTERDITE'), '#a3121a', '#f4efe6', 1024, 40);
    this.noGo = new THREE.Mesh(new THREE.PlaneGeometry(L.FACADE_X * 2, 0.8).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.noGo.position.y = 0.135;
    this.noGo.receiveShadow = true;
    ctx.scene.add(this.noGo);
  }

  /** A protester player in the no-go band or past the line: the police may use force at once (everywhere, host or not). */
  private watchNoGo() {
    const z = this.police.lineZ + L.NO_GO, was = this.intrusion;
    this.noGo.position.z = z;
    // clients know the other players only as NPCs tagged human
    this.intrusion = this.all.some((n) => n.data.human && n.camp === 'protest' && n.standing && n.pos.z < z);
    if (!this.intrusion || was || ctx.tension.phase >= 2 || ctx.tension.sommations >= 3) return;
    ctx.hud.prompt(ctx.camp === 'police' ? 'Intrusion en zone interdite : usage de la force autorisé' : 'Zone interdite : la police peut tirer sans sommation', 3);
  }

  // ------------------------------------------------------------------ setup
  add<T extends NPC>(n: T) {
    this.all.push(n);
    this.ids.set(n.id, n);
    if (isHuman(n) && !this.humans.includes(n as unknown as Avatar)) this.humans.push(n as unknown as Avatar);
    return n;
  }
  byId(id: number) { return this.ids.get(id); }

  /** Humans of a camp who can be targeted. */
  alive(camp: Camp): Human[] { return this.humans.filter((h) => h.camp === camp && h.standing); }

  /** Spawns the march, the police line (leaving `humanSlots` free for police players) and the firefighters. */
  init(humanSlots: number[]) {
    for (let i = 0; i < ctx.city.circles.length; i++) {
      const c = ctx.city.circles[i];
      const k = this.key(c.x, c.z, 4);
      if (!this.circleGrid.has(k)) this.circleGrid.set(k, []);
      this.circleGrid.get(k)!.push(i);
    }
    this.targetProtesters = Math.round(ctx.q.crowd * (ctx.net.multi ? 0.65 : 1));
    const n = this.targetProtesters;
    const counts: [Role, number][] = [
      ['casseur', Math.round(n * 0.16)], ['medic', Math.max(4, Math.round(n * 0.05))], ['journalist', Math.max(3, Math.round(n * 0.035))],
      ['curious', Math.round(n * 0.1)],
    ];
    let used = counts.reduce((a, c) => a + c[1], 0);
    counts.push(['pacifist', n - used]);
    for (const [role, c] of counts) {
      for (let i = 0; i < c; i++) {
        const slotZ = role === 'casseur' ? rr(2, 10) : role === 'medic' ? rr(15, 45) : rr(0, 52);
        const slotX = rr(-1, 1) * (L.ROAD_HALF - 1.5) * (role === 'curious' ? 1.6 : 1);
        const pos = new THREE.Vector3(clamp(slotX, -L.SIDE, L.SIDE), 0, this.marchHeadZ + slotZ - 6);
        if (pos.z > L.AVE_START - 2) pos.z = L.AVE_START - 2 - rr(0, 5);
        const npc = this.add(new NPC(role, pos));
        npc.slot.x = slotX; npc.slot.z = slotZ;
        npc.yaw = Math.PI;
      }
    }
    // police line, from facade to facade, on the slots (±0.6, ±1.8…) that police players may take
    const front = 2 * Math.floor((L.FACADE_X - 0.8) / 1.2), k = L.FACADE_X / 14;
    for (let i = 0; i < front; i++) {
      const x = (i - (front - 1) / 2) * 1.2;
      if (humanSlots.some((h) => Math.abs(x - h) < 0.01)) continue;
      this.spawnCrs(x, 0, 'shield');
    }
    for (const x of [-8, -1, 6]) this.spawnCrs(x * k, 1, 'lbd');
    for (const x of [-4.5, 2.5, 9.5]) this.spawnCrs(x * k, 1, 'grenade');
    for (const x of [-11, 11]) this.spawnCrs(x * k, 1, 'shield');
    // reserve guarding the place, for the protesters who slip past the line
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, n = this.spawnCrs(Math.cos(a) * 12, 0, 'shield');
      n.slot.z = L.OBJECTIVE.z + Math.sin(a) * 12; n.data.guard = true;
      n.pos.z = n.slot.z;
    }
    // firefighters, one team behind the police, one at the back of the march
    for (let i = 0; i < 2; i++) this.spawnFire(new THREE.Vector3(L.EVAC_POLICE.x + i * 1.5, 0, L.EVAC_POLICE.z), 'police');
    for (let i = 0; i < 2; i++) this.spawnFire(new THREE.Vector3(-3 + i * 1.5, 0, L.EVAC_PROTEST.z - 1), 'north');
    this.makeBanners();
  }

  spawnCrs(x: number, row: number, weapon: 'shield' | 'lbd' | 'grenade') {
    const n = new NPC('crs', new THREE.Vector3(x, 0, this.police.lineZ - row * 2.5), weapon);
    n.slot.x = x; n.slot.row = row;
    n.setState('line');
    return this.add(n);
  }
  spawnFire(pos: THREE.Vector3, base: 'police' | 'north') {
    const n = new NPC('firefighter', pos);
    n.data.base = base; n.data.home = pos.clone();
    n.setState('wait');
    n.yaw = base === 'police' ? 0 : Math.PI;
    this.add(n);
  }

  private makeBanners() {
    const front = this.all.filter((n) => n.role === 'pacifist' && !n.carryingFlag && !isHuman(n)).slice(0, BANNERS.length * 2);
    const pairs: [NPC, NPC][] = [];
    for (let i = 0; i + 1 < front.length && pairs.length < BANNERS.length; i += 2) {
      const a = front[i], b = front[i + 1], z = 12 + pairs.length * 9;
      a.slot.x = -2.6; b.slot.x = 2.6; a.slot.z = b.slot.z = z;
      a.pos.set(-2.6, 0, this.marchHeadZ + z - 6); b.pos.set(2.6, 0, this.marchHeadZ + z - 6);
      pairs.push([a, b]);
    }
    this.setBanners(pairs);
  }

  /** Banners carried by pairs of marchers (clients get the pairs from the host). */
  setBanners(pairs: [NPC, NPC][]) {
    for (const [a, b] of pairs) {
      const row = this.banners.length;
      a.data.banner = b.data.banner = true;
      const [bg, fg] = BANNER_COLS[row % BANNER_COLS.length];
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.85), new THREE.MeshStandardMaterial({ map: bannerTexture(BANNERS[row], bg, fg), side: THREE.DoubleSide, roughness: 0.9 }));
      mesh.castShadow = true;
      ctx.scene.add(mesh);
      this.banners.push({ a, b, mesh, fallen: false });
    }
    ctx.net.emit(['banners', this.banners.map((b) => [b.a.id, b.b.id])]);
  }

  // ------------------------------------------------------------------ helpers
  key(x: number, z: number, cell: number) { return (Math.floor(x / cell) + 500) * 1000 + (Math.floor(z / cell) + 500); }

  ragdollSlot() { return this.activeRagdolls < ctx.q.maxRagdolls; }

  get protesters() { return this.all.filter((n) => n.camp === 'protest' && n.state !== 'gone'); }
  get crs() { return this.all.filter((n) => n.role === 'crs' && n.state !== 'gone'); }

  neighbors(x: number, z: number, r: number, cb: (n: NPC) => void) {
    const c = 2;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const l = this.grid.get((ix + 500) * 1000 + (iz + 500));
      if (l) for (const n of l) cb(n);
    }
  }

  /** Closest NPC matching `pred`; human avatars only when asked, NPC routines (medics, arrests…) must not grab them. */
  nearest(pos: THREE.Vector3, r: number, pred: (n: NPC) => boolean, humans = false) {
    let best: NPC | null = null, bd = r * r;
    for (const n of this.all) {
      if (n.state === 'gone' || (!humans && isHuman(n)) || !pred(n)) continue;
      const d = (n.pos.x - pos.x) ** 2 + (n.pos.z - pos.z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /** Make protesters around a point run away. */
  panic(pos: THREE.Vector3, radius: number, strength: number) {
    for (const n of this.all) {
      if (n.camp !== 'protest' && n.role !== 'journalist' || isHuman(n)) continue;
      if (!n.standing || n.state === 'arrested' || n.state === 'escort' || n.state === 'carry' || n.state === 'treat') continue;
      const d = Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z);
      if (d > radius) continue;
      const brave = n.role === 'casseur' ? 0.65 : n.role === 'medic' ? 0.4 : 0;
      if (Math.random() < strength * (1 - d / radius) * (1.2 - n.courage * 0.5 - brave) + 0.15) {
        n.data.fleeFrom = pos.clone();
        n.data.fleeT = rr(2.5, 5) * strength;
        n.setState('flee');
        if (chance(0.15)) ctx.audio.scream(n.pos.clone().setY(1.6), 0.7);
      }
    }
  }

  onNpcHit(n: NPC, d: DamageInfo, amt: number, down: boolean) {
    if (n.role === 'crs' && d.fromCamp === 'protest') ctx.tension.add(0.6, 'CRS touché');
    if (n.camp === 'protest' && d.fromCamp === 'police') { ctx.tension.add(0.5, 'manifestant blessé'); this.panic(n.pos, 6, 0.6); }
    if (amt > 0) d.by?.hitLanded({ id: n.id, role: n.role, camp: n.camp, zone: d.zone, eye: n.wounds.eye, jaw: n.wounds.jaw, type: d.type, down });
  }
  onBlocked(n: NPC, d: DamageInfo) {
    ctx.tension.add(0.25, 'bouclier');
    d.by?.hitLanded({ id: n.id, role: n.role, camp: n.camp, zone: d.zone, eye: false, jaw: false, type: d.type, blocked: true });
  }

  onChaos() {
    // the police commander prepares a charge, the water cannon moves up
    this.police.autoT = rr(15, 25);
    ctx.truck.aiEngage = true;
  }

  // ------------------------------------------------------------------ orders (player CRS)
  order(mode: PoliceMode) {
    const P = this.police;
    if (mode === 'charge' && (P.mode === 'charge' || P.mode === 'regroup')) return;
    P.mode = mode; P.modeT = 0; P.ordered = true;
    if (mode === 'charge') {
      P.push = Math.max(0, P.push - 35);
      ctx.tension.add(6, 'charge');
      ctx.audio.say('En avant ! Chargez !', { pitch: 0.9, rate: 1.1 });
      for (const n of this.all) if (n.role === 'crs' && n.weapon === 'shield' && n.standing && n.state === 'line' && !n.data.guard) { n.setState('charge'); n.data.target = null; }
    }
    if (mode === 'advance') ctx.tension.add(2, 'avancée');
  }

  // ------------------------------------------------------------------ main update
  update(dt: number) {
    const camPos = ctx.camera.position;
    // spatial hash
    this.grid.clear();
    let rag = 0;
    for (const n of this.all) {
      if (n.state === 'gone') continue;
      if (n.ragdoll) rag++;
      if (!n.standing) continue;
      const k = this.key(n.pos.x, n.pos.z, 2);
      let l = this.grid.get(k); if (!l) this.grid.set(k, (l = []));
      l.push(n);
    }
    this.activeRagdolls = rag;
    // clients only animate what the host decided (positions come from net/sync)
    const sim = !ctx.net.isClient;
    if (sim) {
      this.updatePolice(dt);
      const stopZ = this.police.lineZ + (ctx.tension.phase === 0 ? 14 : 9);
      this.marchHeadZ = Math.max(stopZ, this.marchHeadZ - dt * MARCH_HEAD);
      for (const h of this.humans) h.follow(dt);
    }

    this.watchNoGo();
    let cx = 0, cz = 0, cn = 0, near = 0;
    this.frontZ = 999;
    for (const n of this.all) {
      if (n.state === 'gone') continue;
      if (sim && !isHuman(n)) {
        n.think -= dt;
        if (n.standing) {
          if (n.think <= 0) { n.think = rr(0.2, 0.4); this.brain(n); }
          this.act(n, dt);
          this.steer(n, dt);
        } else this.downed(n, dt);
        n.tint = clamp(n.wounds.severity() * 0.6 + n.wounds.bleed * 0.12, 0, 1);
      }
      n.update(dt, camPos, ctx.q.drawDistance);
      if (n.camp === 'protest' && n.standing) {
        cx += n.pos.x; cz += n.pos.z; cn++;
        if (n.pos.z < this.frontZ) this.frontZ = n.pos.z;
        if (n.pos.distanceTo(camPos) < 35) near++;
      }
    }
    if (cn) this.center.set(cx / cn, 1.6, cz / cn);
    this.level = clamp(near / 40, 0.15, 1);
    this.updateBanners();
    if (sim) this.respawn(dt);
    // render
    this.renderer.begin();
    const blood = ctx.settings.blood ? 1 : 0;
    for (const n of this.all) if (n.state !== 'gone' && n.visible) this.renderer.add(n.mats, n.look, n.tint * blood);
    this.renderer.end();
    if (this.all.length > 400) {
      this.all = this.all.filter((n) => n.state !== 'gone');
      for (const [id, n] of this.ids) if (n.state === 'gone') this.ids.delete(id);
    }
    this.humans = this.humans.filter((h) => !h.removed);
  }

  private respawn(dt: number) {
    this.respawnT -= dt;
    if (this.respawnT > 0) return;
    this.respawnT = ctx.tension.phase === 2 ? 3.5 : 1.6;
    const alive = this.all.reduce((a, n) => a + (n.camp === 'protest' && n.state !== 'gone' && !isHuman(n) ? 1 : 0), 0);
    const target = ctx.tension.phase === 2 ? this.targetProtesters * 0.75 : this.targetProtesters;
    if (alive >= target) return;
    const role: Role = ctx.tension.phase === 2 ? (chance(0.5) ? 'casseur' : 'pacifist') : pick(['pacifist', 'pacifist', 'pacifist', 'curious', 'casseur'] as Role[]);
    const n = this.add(new NPC(role, new THREE.Vector3(rr(-6, 6), 0, L.AVE_START - 2)));
    n.slot.x = rr(-6.5, 6.5); n.slot.z = rr(20, 50);
    n.yaw = Math.PI;
  }

  private updateBanners() {
    for (const b of this.banners) {
      if (b.fallen) continue;
      const ok = b.a.standing && b.b.standing && b.a.pos.distanceTo(b.b.pos) < 8 && b.a.state !== 'flee' && b.b.state !== 'flee';
      if (!ok) {
        b.fallen = true;
        const mid = _v.addVectors(b.a.pos, b.b.pos).multiplyScalar(0.5);
        b.mesh.position.set(mid.x, 0.05, mid.z);
        b.mesh.rotation.set(-Math.PI / 2, 0, rr(0, 3));
        b.mesh.scale.set(5, 1, 1);
        b.a.data.banner = b.b.data.banner = false;
        continue;
      }
      _v.copy(b.a.pos).setY(1.85); _v2.copy(b.b.pos).setY(1.85);
      const w = _v.distanceTo(_v2);
      b.mesh.position.addVectors(_v, _v2).multiplyScalar(0.5);
      b.mesh.position.y = 1.75 + Math.sin(ctx.time * 2) * 0.03;
      b.mesh.scale.set(w, 1, 1);
      b.mesh.rotation.set(0, Math.atan2(-(_v2.z - _v.z), _v2.x - _v.x), Math.sin(ctx.time * 1.7) * 0.02);
    }
  }

  // ------------------------------------------------------------------ police coordination
  private updatePolice(dt: number) {
    const P = this.police;
    P.modeT += dt;
    this.updatePush(dt);
    if (P.mode === 'advance') {
      P.lineZ = Math.min(P.maxZ, P.lineZ + dt * 0.9);
      if (P.modeT > 8) { P.mode = 'hold'; P.modeT = 0; }
    }
    if (P.mode === 'charge' && P.modeT > 6.5) {
      P.mode = 'regroup'; P.modeT = 0;
      P.lineZ = Math.min(P.maxZ, P.lineZ + 5);
      for (const n of this.all) if (n.role === 'crs' && n.state === 'charge') n.setState('line');
    }
    if (P.mode === 'regroup' && P.modeT > 6) { P.mode = 'hold'; P.modeT = 0; }
    // AI commander
    if (!P.ordered || P.modeT > 90 || !this.alive('police').length) {
      P.autoT -= dt;
      if (P.autoT <= 0) {
        const ph = ctx.tension.phase;
        if (ph === 2 && this.frontZ - P.lineZ < 22) { this.order('charge'); P.ordered = false; P.autoT = rr(35, 55); }
        else if (ph >= 1 && ctx.tension.sommations >= 2 && chance(0.5)) { this.order('advance'); P.ordered = false; P.autoT = rr(30, 45); }
        else P.autoT = rr(10, 20);
      }
    }
  }

  /**
   * Tug of war: human protesters pressed against the line (backed by the cortège behind them) push it, the standing
   * CRS and the police players hold it. Full gauge: the line falls back towards the square.
   */
  private updatePush(dt: number) {
    const P = this.police, z0 = P.lineZ;
    let pushers = 0, crowd = 0, hold = 0;
    for (const n of this.all) {
      if (!n.standing || n.state === 'arrested' || n.state === 'escort' || n.state === 'cuffing') continue;
      const dz = n.pos.z - z0;
      if (n.camp === 'protest' && n.role !== 'medic' && n.role !== 'journalist') {
        if (isHuman(n) ? dz > -2 && dz < 6 : dz > 0 && dz < 30) isHuman(n) ? pushers++ : crowd++;
      } else if (n.camp === 'police' && dz > -6 && dz < (isHuman(n) ? 6 : 3)) hold += isHuman(n) ? 5 : 0.12;
    }
    P.pushers = ctx.tension.phase >= 1 ? pushers : 0;
    const before = P.push;
    P.push = clamp(P.push + (P.pushers ? (pushers * 6 + crowd * 0.3 - hold) * 1.4 : -2.5) * dt, 0, 100);
    if (before < 50 && P.push >= 50) ctx.hud.feed('La ligne de CRS vacille !', '#ffd27a');
    if (P.push >= 100) this.breach();
  }

  /** Something hit the line hard (fireworks): more pressure. */
  shake(amount: number) { if (ctx.tension.phase >= 1) this.police.push = Math.min(99, this.police.push + amount); }

  private breach() {
    const P = this.police;
    P.push = 0;
    P.lineZ -= L.BREACH_STEP;
    P.mode = 'regroup'; P.modeT = 0; P.ordered = false; P.autoT = rr(20, 30);
    for (const n of this.all) if (n.role === 'crs' && n.state === 'charge') n.setState('line');
    ctx.tension.add(8, 'percée');
    const left = Math.max(0, Math.ceil((P.lineZ - L.PLACE_Z0 - 5) / L.BREACH_STEP));
    ctx.hud.banner('PERCÉE !', left ? `La ligne de CRS recule. Encore ${left} poussée${left > 1 ? 's' : ''} jusqu'à la place.` : 'La ligne cède !');
  }

  // ------------------------------------------------------------------ brains
  private brain(n: NPC) {
    const head = _v3.copy(n.pos).setY(1.6);
    const gas = ctx.gas.at(head);
    const immune = n.role === 'crs' || n.role === 'firefighter';
    if (!immune) {
      n.gas = gas > n.gas ? gas : n.gas * 0.85;
      if (n.gas > 0.25) {
        if (chance(0.25)) ctx.audio.cough(n.pos.clone().setY(1.6), 0.35);
        if (n.state !== 'gassed' && n.state !== 'carry' && n.state !== 'arrested' && n.state !== 'escort' && n.state !== 'cuffing' && !(n.role === 'casseur' && n.gas < 0.5 && chance(0.6))) {
          n.setState('gassed');
          n.data.fleeFrom = this.gasCenter(head) ?? n.pos.clone().setZ(n.pos.z - 5);
        }
      }
    }
    if (!immune && ctx.destruction.heatAt(n.pos) > 0.2 && n.state !== 'ignite') {
      n.data.fleeFrom = n.pos.clone().add(_v.set(rr(-1, 1), 0, rr(-1, 1))); n.data.fleeT = 1.5; n.setState('flee');
    }
    switch (n.role) {
      case 'crs': return this.crsBrain(n);
      case 'medic': return this.medicBrain(n);
      case 'firefighter': return this.fireBrain(n);
      case 'journalist': return this.pressBrain(n);
      case 'casseur': return this.casseurBrain(n);
      default: return this.pacifistBrain(n);
    }
  }

  private gasCenter(p: THREE.Vector3) {
    let best: THREE.Vector3 | null = null, bd = Infinity;
    for (const c of ctx.gas.clouds) { const d = c.pos.distanceTo(p); if (d < bd) { bd = d; best = c.pos; } }
    return best?.clone() ?? null;
  }

  private busy(n: NPC) {
    return n.state === 'flee' || n.state === 'gassed' || n.state === 'arrested' || n.state === 'escort' || n.state === 'carry' || n.state === 'treat' || n.state === 'getup' || n.state === 'leave';
  }

  private marchTarget(n: NPC, spread = 1) {
    const ph = ctx.tension.phase;
    const lineZ = this.police.lineZ;
    let z = this.marchHeadZ + n.slot.z * (ph === 0 ? 1 : 0.7);
    if (ph === 2 && n.role === 'pacifist') z = Math.max(z, lineZ + 22 + n.slot.z * 0.5);
    n.target.set(n.slot.x * spread, 0, Math.min(z, L.AVE_START - 3));
  }

  private pacifistBrain(n: NPC) {
    if (this.common(n)) return;
    const ph = ctx.tension.phase;
    n.chant = ph < 2 && (ph === 0 ? chance(0.7) : chance(0.35));
    const charging = this.police.mode === 'charge';
    n.handsUp = charging && n.courage > 0.55 && n.pos.z - this.police.lineZ < 18;
    if (ph === 2 && n.state !== 'leave' && chance(0.0008) && !n.data.banner) { n.setState('leave'); return; }
    if (n.role === 'curious') {
      n.setState('film');
      if (!n.data.spot || chance(0.05)) n.data.spot = new THREE.Vector3(pick([-1, 1]) * rr(L.ROAD_HALF + 1, L.SIDE), 0, this.police.lineZ + rr(16, 32));
      n.target.copy(n.data.spot); n.speed = 1.3;
      n.faceYaw = Math.atan2(0 - n.pos.x, this.police.lineZ - n.pos.z);
      return;
    }
    if (n.state !== 'march' && n.state !== 'mill') n.setState('march');
    this.marchTarget(n);
    n.speed = MARCH - (n.data.banner ? 0.15 : 0);
    n.faceYaw = 0 + Math.PI; // facing the police (south = -z)
    // insults & gestures in the tension phase: the gauge creeps up
    if (ph >= 1 && n.pos.z - this.police.lineZ < 16 && chance(0.004)) ctx.tension.add(0.25, 'insultes');
  }

  /** Shared reactions; returns true if the NPC is busy with them. */
  private common(n: NPC) {
    if (n.state === 'flee') {
      n.data.fleeT = (n.data.fleeT ?? 3) - 0.3;
      const from: THREE.Vector3 = n.data.fleeFrom ?? n.pos;
      _v.subVectors(n.pos, from).setY(0);
      if (_v.lengthSq() < 0.01) _v.set(rr(-1, 1), 0, 1);
      _v.normalize();
      // prefer running away from the police line (north)
      _v.z += 0.6; _v.normalize();
      n.target.copy(n.pos).addScaledVector(_v, 8);
      n.speed = 4.5 * (1 - n.wounds.limp * 0.5);
      n.chant = false;
      if (n.data.fleeT <= 0) n.setState('march');
      return true;
    }
    if (n.state === 'gassed') {
      const from: THREE.Vector3 = n.data.fleeFrom ?? n.pos;
      _v.subVectors(n.pos, from).setY(0);
      if (_v.lengthSq() < 0.01) _v.set(0, 0, 1);
      _v.normalize(); _v.z += 0.4; _v.normalize();
      n.target.copy(n.pos).addScaledVector(_v, 6);
      n.speed = 2.2;
      n.chant = false;
      if (n.gas < 0.12 && n.stateT > 3) n.setState('march');
      return true;
    }
    if (n.state === 'leave') {
      n.target.set(n.slot.x, 0, L.AVE_START - 1);
      n.speed = 1.4 * (1 - n.wounds.limp * 0.5);
      if (n.pos.z > L.AVE_START - 3) n.remove();
      return true;
    }
    if (n.state === 'getup') { n.speed = 0; if (n.stateT > 0.9) n.setState(n.camp === 'protest' && n.wounds.severity() > 0.4 ? 'leave' : n.role === 'crs' ? 'line' : 'march'); return true; }
    if (n.state === 'arrested' || n.state === 'escort') return true;
    // a CRS player is handcuffing him: he waits on his knees (and runs if the officer gives up)
    if (n.state === 'cuffing') { n.speed = 0; n.vel.set(0, 0, 0); if (n.stateT > 4) { n.data.fleeT = 3; n.data.fleeFrom = n.pos.clone(); n.setState('flee'); } return true; }
    // police charging right at you
    if (n.camp === 'protest' && this.police.mode === 'charge' && n.pos.z - this.police.lineZ < 14 && chance(n.role === 'casseur' ? 0.35 : 0.75)) {
      n.data.fleeFrom = new THREE.Vector3(n.pos.x, 0, this.police.lineZ - 5); n.data.fleeT = rr(3, 6); n.setState('flee');
      return true;
    }
    return false;
  }

  private casseurBrain(n: NPC) {
    if (this.common(n)) return;
    const ph = ctx.tension.phase;
    const lineZ = this.police.lineZ;
    n.chant = ph === 0 && chance(0.5);
    if (ph === 0) { if (n.state !== 'march') n.setState('march'); this.marchTarget(n); n.speed = MARCH; n.faceYaw = Math.PI; return; }
    n.cooldown -= 0.3; n.cooldown2 -= 0.3;
    // ongoing actions
    if (n.state === 'smash' || n.state === 'barricade' || n.state === 'ignite' || n.state === 'fetch') return;
    // pick up a smoking grenade and throw it back
    if (ph >= 1) {
      const g = ctx.projectiles.list.find((p) => p.kind === 'gas' && !p.dead && p.emit > 2 && p.pos(_v).distanceTo(n.pos) < 7 && p.owner !== n);
      if (g && chance(0.5)) { n.data.grenade = g; n.setState('fetch'); return; }
    }
    if (ph === 2 && n.cooldown2 <= 0) {
      n.cooldown2 = rr(8, 18);
      const r = Math.random();
      if (r < 0.25) {
        const w = ctx.destruction.nearestWindow(n.pos, 30);
        if (w) { n.data.window = w.index; n.setState('smash'); return; }
      } else if (r < 0.4 && ctx.destruction.barricades.length < 7) {
        const props = ctx.destruction.props.filter((p) => !p.used && p.mesh.position.distanceTo(n.pos) < 30 && p.mesh.position.z > lineZ + 8);
        if (props.length) { n.data.prop = pick(props); n.setState('barricade'); return; }
      } else if (r < 0.55) {
        const b = ctx.destruction.nearestBurnable(n.pos, 25, ['bin', 'barricade', 'car']);
        if (b && b.pos.z > lineZ + 6) { n.data.burn = b; n.setState('ignite'); return; }
      }
    }
    // harass the police line
    n.setState('throw');
    const dist = ph === 1 ? rr(15, 22) : rr(10, 20);
    if (!n.data.tx || chance(0.08)) n.data.tx = clamp(n.pos.x + rr(-4, 4), -12, 12);
    n.target.set(n.data.tx, 0, lineZ + dist);
    n.speed = 2.6;
    n.faceYaw = Math.PI;
    const rate = ph === 1 ? 0.3 : 1;
    if (n.cooldown <= 0 && Math.abs(n.pos.z - (lineZ + dist)) < 6) {
      n.cooldown = rr(6, 13) / rate;
      const target = this.pickPoliceTarget(n);
      if (!target) return;
      let kind: ThrowKind = pick(['pave', 'pave', 'bouteille', 'conserve', 'canette', 'pave'] as ThrowKind[]);
      if (ph === 2 && chance(0.22)) kind = chance(0.6) ? 'mortier' : 'fusee';
      if (kind === 'fusee') {
        const from = n.pos.clone().setY(1.4).addScaledVector(n.forward, 0.5);
        const dir = target.clone().setY(1.2).sub(from).normalize();
        n.throwT = 0.4;
        ctx.projectiles.spawn('fusee', from, dir.multiplyScalar(18), n, 'protest');
      } else ctx.projectiles.npcThrow(n, kind, target, kind === 'mortier' ? 14 : rr(15, 19), ph === 1 ? 2 : 1.3);
      n.data.lastThrow = ctx.time;
      ctx.tension.add(0.4, 'jet');
    }
  }

  private pickPoliceTarget(n: NPC): THREE.Vector3 | null {
    const h = chance(0.55) && this.closestHuman('police', n.pos, 35);
    if (h) return h.feet.clone().setY(h.feet.y + 1.3);
    if (ctx.truck.active && chance(0.15) && ctx.truck.pos.distanceTo(n.pos) < 35) return ctx.truck.pos.clone().setY(1.8);
    const c = this.nearest(n.pos, 40, (o) => o.role === 'crs' && o.standing);
    return c ? c.pos.clone().setY(1.2) : null;
  }

  private medicBrain(n: NPC) {
    if (n.state === 'carry' || n.state === 'treat') return;
    n.data.kneelPlayer = false;
    // a human player called for a medic
    const pl = this.alive('protest').find((h) => h.callMedic && (h.medic === n || (!h.medic && !n.patient && h.feet.distanceTo(n.pos) < 80)));
    if (pl) {
      pl.medic = n;
      const f = pl.feet;
      n.setState('help');
      n.target.set(f.x + 0.7, 0, f.z + 0.3); n.speed = 4;
      if (n.pos.distanceTo(n.target) < 1.3) {
        n.speed = 0; n.data.kneelPlayer = true;
        n.faceYaw = Math.atan2(f.x - n.pos.x, f.z - n.pos.z);
        n.data.healT = (n.data.healT ?? 0) + 0.3;
        pl.medicProgress(n.data.healT / 3.5);
        if (n.data.healT > 3.5) { n.data.healT = 0; pl.heal(true); pl.callMedic = false; pl.medic = null; n.setState('march'); }
      }
      return;
    }
    if (this.common(n)) return;
    // find someone to help
    if (!n.patient) {
      const p = this.nearest(n.pos, 70, (o) => o.isDown && !o.helper && o.state !== 'evac' && o.state !== 'arrested' && (o.camp === 'protest' || o.role === 'journalist')
        && o.downPelvis(_v).z > this.police.lineZ + 3);
      if (p) { n.patient = p; p.helper = n; n.setState('help'); }
    }
    if (n.patient) {
      if (n.patient.state === 'gone' || !n.patient.isDown) { n.patient.helper = null; n.patient = null; n.setState('march'); return; }
      n.patient.downPelvis(_v);
      n.target.set(_v.x + 0.6, 0, _v.z + 0.4);
      n.speed = 3.8;
      if (n.pos.distanceTo(n.target) < 0.9 && !n.patient.ragdoll) { n.setState('treat'); n.speed = 0; }
      return;
    }
    n.setState('march');
    this.marchTarget(n, 1.2);
    n.target.z = Math.max(n.target.z, this.police.lineZ + 24);
    n.speed = MARCH;
  }

  private fireBrain(n: NPC) {
    if (n.state === 'carry' || n.state === 'treat') return;
    const base = n.data.base as 'police' | 'north';
    if (!n.patient) {
      const p = this.nearest(n.pos, base === 'police' ? 90 : 160, (o) => {
        if (!o.isDown || o.helper || o.state === 'evac' || o.state === 'arrested') return false;
        const z = o.downPelvis(_v).z;
        if (base === 'police') return z < this.police.lineZ + 3 || o.role === 'crs';
        return o.downT > 25 && z > this.police.lineZ + 3; // unattended victims on the protesters' side
      });
      if (p) { n.patient = p; p.helper = n; n.setState('help'); }
    }
    if (n.patient) {
      if (n.patient.state === 'gone' || !n.patient.isDown) { n.patient.helper = null; n.patient = null; n.setState('wait'); return; }
      n.patient.downPelvis(_v);
      n.target.set(_v.x + 0.6, 0, _v.z + 0.4);
      n.speed = 3.2;
      if (n.pos.distanceTo(n.target) < 0.9 && !n.patient.ragdoll) { n.setState('treat'); n.speed = 0; }
      return;
    }
    n.setState('wait');
    n.target.copy(n.data.home); n.speed = 1.5;
    n.faceYaw = base === 'police' ? 0 : Math.PI;
  }

  private pressBrain(n: NPC) {
    if (this.common(n)) return;
    n.setState('film');
    if (!n.data.spot || chance(0.04)) {
      const side = pick([-1, 1]);
      const lineZ = this.police.lineZ;
      n.data.spot = new THREE.Vector3(side * rr(L.ROAD_HALF + 0.5, L.SIDE), 0, ctx.tension.phase === 2 ? lineZ + rr(8, 20) : lineZ + rr(5, 14));
    }
    n.target.copy(n.data.spot); n.speed = 2;
    // film the action (between the line and the crowd)
    const fz = (this.police.lineZ + this.frontZ) / 2;
    n.faceYaw = Math.atan2(0 - n.pos.x, fz - n.pos.z);
  }

  private crsBrain(n: NPC) {
    const P = this.police;
    if (n.state === 'escort' || n.state === 'arrest') return;
    if (n.state === 'getup') { if (n.stateT > 0.9) n.setState('line'); return; }
    const ph = ctx.tension.phase;
    n.cooldown -= 0.3; n.cooldown2 -= 0.3;
    if (n.state === 'charge') {
      // pick or keep a target in front
      let t: NPC | null = n.data.target;
      if (!t || !t.standing || t.state === 'gone' || t.pos.distanceTo(n.pos) > 26) {
        t = this.nearest(n.pos, 24, (o) => o.camp === 'protest' && o.standing && o.state !== 'arrested' && o.state !== 'escort' && o.pos.z > n.pos.z - 2);
        n.data.target = t;
        // human protesters are targets too
        const h = chance(0.4) && this.closestHuman('protest', n.pos, 14);
        if (h) { n.data.target = null; n.data.hunt = h; }
      }
      const prey: Human | null = n.data.hunt;
      if (prey?.alive) {
        n.target.copy(prey.feet).setY(0); n.speed = 5.4 + 2.6 * this.depth(prey.feet.z); // faster than a sprint on the place
        if (prey.feet.distanceTo(n.pos) < 1.4 && n.strikeT <= 0) { n.strikeT = 0.45; setTimeout(() => this.crsStrike(n, prey), 220); }
        return;
      }
      if (t) {
        n.target.copy(t.pos); n.speed = 5.4;
        if (t.pos.distanceTo(n.pos) < 1.25 && n.strikeT <= 0) {
          n.strikeT = 0.45;
          setTimeout(() => this.crsStrike(n, t!), 220);
        }
      } else { n.target.set(n.slot.x, 0, n.pos.z + 4); n.speed = 3; }
      return;
    }
    // line holding
    n.setState('line');
    n.data.hunt = null;
    n.target.set(n.slot.x, 0, n.data.guard ? n.slot.z : P.lineZ - n.slot.row * 2.5);
    n.speed = P.mode === 'regroup' ? 2.5 : 1.6;
    n.faceYaw = 0;
    // ranged weapons
    if (n.weapon === 'lbd' && ctx.tension.forceAllowed && n.cooldown <= 0 && n.aimT <= 0) {
      const target = this.lbdTarget(n);
      if (target) {
        n.aimT = 0.9;
        n.data.aim = target;
        n.cooldown = ph === 2 ? rr(7, 13) : rr(13, 20);
        setTimeout(() => this.crsShoot(n), 900);
      } else n.cooldown = 2;
    }
    // tear gas on the crowd only after the warnings: one runner does not gas everybody
    if (n.weapon === 'grenade' && (ctx.tension.sommations >= 3 || ph === 2) && n.cooldown <= 0) {
      n.cooldown = ph === 2 ? rr(9, 16) : rr(18, 30);
      const c = this.clusterTarget(n);
      if (c) {
        n.aimT = 0.6;
        setTimeout(() => {
          if (!n.standing) return;
          const from = n.pos.clone().setY(1.6).add(_v.set(0, 0, 0.5));
          const vel = ballisticFrom(from, c, 21);
          ctx.projectiles.spawn('gas', from, vel, n, 'police');
          ctx.audio.thump(from, 0.9);
        }, 600);
      }
    }
    // désencerclement when surrounded
    if (ph === 2 && n.cooldown2 <= 0) {
      let close = 0;
      this.neighbors(n.pos.x, n.pos.z, 4, (o) => { if (o.camp === 'protest' && o.standing) close++; });
      if (close >= 3) {
        n.cooldown2 = rr(18, 30);
        const at = n.pos.clone().add(_v.set(rr(-1, 1), 0, 2.5));
        ctx.projectiles.npcThrow(n, 'sting', at, 8, 0.5);
      } else n.cooldown2 = 3;
    }
  }

  private lbdTarget(n: NPC): THREE.Vector3 | null {
    const h = (this.intrusion && this.alive('protest').find((o) => o.feet.z < this.police.lineZ + L.NO_GO))
      || (chance(0.6) && this.closestHuman('protest', n.pos, 38, 1.5));
    if (h) return h.feet.clone().setY(h.feet.y + 1.2);
    let best: NPC | null = null, bd = 40 * 40;
    for (const o of this.all) {
      if (o.camp !== 'protest' || !o.standing || o.pos.z < n.pos.z || isHuman(o)) continue;
      const recent = o.data.lastThrow && ctx.time - o.data.lastThrow < 8;
      if (!recent && !(ctx.tension.phase === 2 && o.role === 'casseur')) continue;
      const d = o.pos.distanceToSquared(n.pos);
      if (d < bd) { bd = d; best = o; }
    }
    return best ? best.pos.clone().setY(1.2) : null;
  }

  private clusterTarget(n: NPC): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null, bc = 3;
    for (const o of this.all) {
      if (o.camp !== 'protest' || !o.standing) continue;
      const dz = o.pos.z - n.pos.z;
      if (dz < 10 || dz > 38) continue;
      if (!chance(0.3)) continue;
      let c = 0;
      this.neighbors(o.pos.x, o.pos.z, 4, (q) => { if (q.camp === 'protest') c++; });
      if (c > bc) { bc = c; best = o.pos.clone(); }
    }
    return best;
  }

  private crsShoot(n: NPC) {
    if (!n.standing || !n.data.aim) return;
    const from = n.pos.clone().setY(1.55).addScaledVector(n.forward, 0.6);
    const target: THREE.Vector3 = n.data.aim;
    // aiming error: sometimes too high (head), sometimes legs
    const dist = from.distanceTo(target);
    const err = 0.25 + dist * 0.012;
    target.add(_v.set(rr(-err, err), rr(-err, err * 1.3), rr(-err, err)));
    target.y += dist * dist * 0.0003; // gravity compensation
    const dir = target.sub(from).normalize();
    ctx.projectiles.fireLBD(from, dir, n, 'police');
  }

  /** Baton blow on an NPC or a human player. */
  private crsStrike(n: NPC, t: NPC | Human) {
    const pos = t instanceof NPC ? t.pos : t.feet;
    if (!n.standing || !(t instanceof NPC ? t.standing : t.alive) || pos.distanceTo(n.pos) > 1.8) return;
    const zone = chance(0.15) ? 'head' : pick(['torso', 'armL', 'armR', 'legL', 'legR'] as const);
    const dir = _v.subVectors(pos, n.pos).setY(0).normalize().clone();
    ctx.audio.baton(pos.clone().setY(pos.y + 1.2));
    t.takeHit({ amount: rr(14, 24), zone, type: 'baton', dir, point: pos.clone().setY(pos.y + (zone === 'head' ? 1.65 : 1.1)), force: chance(0.55) ? 6 : 2.5, fromCamp: 'police' });
    if (t instanceof NPC && !t.standing && chance(0.35)) { n.setState('arrest'); n.data.target = t; n.data.arrestT = 0; }
  }

  /** How deep a point is behind the police line: 0 on the line, 1 at the edge of the place's objective. */
  depth(z: number) { return clamp((this.police.lineZ - z) / (this.police.lineZ - L.OBJECTIVE.z - L.OBJECTIVE.r), 0, 1); }

  /** Closest living human of a camp within r (optionally only the aggressive ones). */
  closestHuman(camp: Camp, pos: THREE.Vector3, r: number, minAggro = -1): Human | null {
    let best: Human | null = null, bd = r;
    for (const h of this.alive(camp)) {
      const d = h.feet.distanceTo(pos);
      if (d < bd && h.aggro > minAggro) { bd = d; best = h; }
    }
    return best;
  }

  // ------------------------------------------------------------------ per-frame actions
  private act(n: NPC, dt: number) {
    n.kneel = !!n.data.kneelPlayer;
    switch (n.state) {
      case 'smash': {
        const w = ctx.destruction.windows[n.data.window];
        if (!w || w.broken || n.stateT > 15) { n.setState('throw'); break; }
        const p = w.pane.pos;
        n.target.set(p.x + w.pane.normal.x * 6, 0, p.z + w.pane.normal.z * 6);
        n.speed = 3;
        n.faceYaw = Math.atan2(p.x - n.pos.x, p.z - n.pos.z);
        if (n.pos.distanceTo(n.target) < 2 && n.throwT <= 0) {
          ctx.projectiles.npcThrow(n, 'pave', p.clone(), 12, 0.3);
          n.data.lastThrow = ctx.time;
        }
        break;
      }
      case 'barricade': {
        const pr = n.data.prop;
        if (!pr || pr.used || n.stateT > 20) { n.setState('throw'); break; }
        n.target.copy(pr.mesh.position).setY(0); n.speed = 3;
        if (n.pos.distanceTo(n.target) < 1.6) {
          n.kneel = true; n.speed = 0;
          if (!n.data.workT) n.data.workT = 0;
          n.data.workT += dt;
          if (n.data.workT > 3.5) {
            n.data.workT = 0;
            const c = pr.mesh.position.clone();
            c.x = clamp(c.x * 0.5, -6, 6);
            ctx.destruction.buildBarricade(c, rr(-0.2, 0.2), null, 1);
            n.setState('throw');
          }
        }
        break;
      }
      case 'ignite': {
        const b = n.data.burn;
        if (!b || b.fire || b.burnt || n.stateT > 20) { n.setState('throw'); break; }
        n.target.copy(b.pos).setY(0).add(_v.set(0, 0, b.radius + 0.6)); n.speed = 3;
        if (n.pos.distanceTo(n.target) < 1.5) {
          n.kneel = true; n.speed = 0;
          n.data.workT = (n.data.workT ?? 0) + dt;
          if (n.data.workT > 2.5) { n.data.workT = 0; ctx.destruction.ignite(b); n.data.fleeFrom = b.pos.clone(); n.data.fleeT = 2; n.setState('flee'); }
        }
        break;
      }
      case 'fetch': {
        const g = n.data.grenade;
        if (!g || g.dead || n.stateT > 8) { n.setState('throw'); break; }
        g.pos(_v); n.target.set(_v.x, 0, _v.z); n.speed = 4;
        if (n.pos.distanceTo(n.target) < 1) {
          const { emit } = ctx.projectiles.take(g);
          const t = this.pickPoliceTarget(n) ?? new THREE.Vector3(0, 1, this.police.lineZ);
          n.throwT = 0.55;
          const from = n.pos.clone().setY(1.7);
          const vel = ballisticFrom(from, t, 16);
          setTimeout(() => { const p = ctx.projectiles.spawn('gas', from, vel, n, 'protest'); p.emit = emit; }, 300);
          ctx.tension.add(1, 'renvoi');
          n.setState('throw');
        }
        break;
      }
      case 'treat': {
        const p = n.patient;
        if (!p || p.state === 'gone' || !p.isDown) { if (p) p.helper = null; n.patient = null; n.setState(n.role === 'firefighter' ? 'wait' : 'march'); break; }
        n.kneel = true; n.speed = 0;
        p.downPelvis(_v);
        n.faceYaw = Math.atan2(_v.x - n.pos.x, _v.z - n.pos.z);
        if (n.stateT > 4) {
          p.wounds.bleed = 0;
          const severe = p.unconscious || p.wounds.severity() > 0.6 || p.hp < 30 || p.wounds.limp > 0.9;
          if (!severe && p.downMats) { p.getUp(); p.helper = null; n.patient = null; p.setState('getup'); n.setState(n.role === 'firefighter' ? 'wait' : 'march'); }
          else { n.setState('carry'); p.setState('evac'); }
        }
        break;
      }
      case 'carry': {
        const p = n.patient;
        if (!p || p.state === 'gone') { n.patient = null; n.setState('march'); break; }
        const dest = n.role === 'firefighter' ? (n.data.base === 'police' ? L.EVAC_POLICE : L.EVAC_PROTEST) : L.EVAC_PROTEST;
        n.target.set(dest.x, 0, dest.z); n.speed = 1.6;
        // drag the victim behind
        const back = _v.copy(n.forward).multiplyScalar(-1.1).add(n.pos);
        if (p.downMats) {
          _v2.setFromMatrixPosition(p.downMats[P.pelvis]);
          p.downOffset.set(back.x - _v2.x, 0, back.z - _v2.z);
        }
        if (n.pos.distanceTo(n.target) < 2.5) {
          p.remove(); n.patient = null; ctx.stats.evacuated++;
          if (n.role === 'firefighter') { n.pos.copy(n.data.home); n.setState('wait'); }
          else { n.remove(); setTimeout(() => this.respawnMedic(), 12000); }
        }
        break;
      }
      case 'arrest': {
        const t: NPC = n.data.target;
        if (!t || t.state === 'gone' || t.state === 'evac' || t.helper) { n.setState('line'); break; }
        t.downPelvis(_v);
        n.target.set(_v.x + 0.5, 0, _v.z); n.speed = 2;
        if (n.pos.distanceTo(n.target) < 1) {
          n.kneel = true; n.speed = 0;
          n.data.arrestT += dt;
          if (n.data.arrestT > 2.5) {
            if (t.downMats) t.getUp();
            t.setState('arrested'); t.escortOf = n; t.helper = n;
            n.setState('escort');
            ctx.stats.arrests++;
            ctx.tension.add(1, 'interpellation');
          }
        }
        break;
      }
      case 'escort': {
        const t: NPC | null = n.data.target;
        n.target.set(L.EVAC_POLICE.x - 3, 0, L.EVAC_POLICE.z + 2); n.speed = 1.6;
        if (t && t.state === 'arrested') {
          t.target.copy(n.pos).addScaledVector(n.forward, 0.9); t.speed = 1.8;
        }
        if (n.pos.distanceTo(n.target) < 2) {
          if (t) t.remove();
          n.data.target = null;
          n.setState('line');
        }
        break;
      }
    }
    if (n.state === 'arrested') {
      if (!n.escortOf || n.escortOf.state !== 'escort' || !n.escortOf.standing) {
        // no escort, or knocked out: walk to the vans alone
        n.target.set(L.EVAC_POLICE.x - 3, 0, L.EVAC_POLICE.z + 2); n.speed = 1.4;
        if (n.pos.distanceTo(n.target) < 2) n.remove();
      }
    }
    // knock protesters out of the way while charging
    if (n.state === 'charge' && n.vel.lengthSq() > 9) {
      this.neighbors(n.pos.x, n.pos.z, 0.9, (o) => {
        if (o.camp === 'protest' && o.standing && o.pos.distanceTo(n.pos) < 0.75 && chance(0.25)) {
          const dir = _v.subVectors(o.pos, n.pos).setY(0).normalize().clone();
          o.takeHit({ amount: rr(6, 12), zone: pick(['torso', 'legL', 'legR'] as const), type: 'trample', dir, point: o.pos.clone().setY(1), force: 6, fromCamp: 'police' });
        }
      });
    }
    n.aimT = Math.max(0, n.aimT - dt);
  }

  private respawnMedic() {
    if (ctx.over) return;
    const n = this.add(new NPC('medic', new THREE.Vector3(rr(-4, 4), 0, L.AVE_START - 2)));
    n.slot.x = rr(-5, 5); n.slot.z = rr(20, 40);
  }

  /** Behaviour of people lying on the ground. */
  private downed(n: NPC, dt: number) {
    if (n.ragdoll || n.state === 'gone') return;
    n.downT += dt;
    if (n.state === 'evac') return;
    n.bubbleT -= dt;
    const conscious = !n.unconscious;
    if (conscious && n.bubbleT <= 0) {
      n.bubbleT = rr(4, 9);
      if (n.wounds.severity() > 0.4 || n.downT > 6) {
        ctx.audio.scream(n.downPelvis(_v).clone().setY(0.5), 0.6);
        if (n.downPelvis(_v).distanceTo(ctx.player.pos) < 14 && chance(0.5)) ctx.hud.feed(pick(['« À l\'aide ! »', '« Un medic ! »', '« J\'ai mal… »', '« Je vois plus rien ! »']), '#d0d0d0');
      }
    }
    // stand up again if not too badly hurt
    const minor = conscious && n.hp > 35 && n.wounds.severity() < 0.5 && n.wounds.limp < 0.85 && !n.helper;
    if (minor && n.downT > rr(2.5, 6) && n.state === 'down') { n.getUp(); return; }
    // crawl away slowly
    if (conscious && n.hp > 12 && n.downT > 3 && !n.helper && n.downMats && n.camp !== 'police') {
      n.downPelvis(_v);
      const dirX = _v.x > 0 ? 1 : -1;
      if (Math.abs(_v.x) < 11) { n.downOffset.x += dirX * dt * 0.18; n.downOffset.z += dt * 0.08; }
    }
    // being trampled during panics
    if (ctx.tension.phase === 2 && chance(dt * 0.3)) {
      n.downPelvis(_v);
      this.neighbors(_v.x, _v.z, 0.7, (o) => {
        if (o.standing && o.vel.lengthSq() > 9 && chance(0.4)) {
          n.hp -= 3; n.wounds.bleed += 0.1;
          ctx.audio.impact('body', _v, 0.5);
        }
      });
    }
  }

  // ------------------------------------------------------------------ steering
  private steer(n: NPC, dt: number) {
    let speed = n.speed * (1 - n.wounds.limp * 0.45) * (n.gas > 0.3 ? 0.75 : 1) * (n.wounds.concussion > 0 ? 0.5 : 1);
    if (n.kneel || n.state === 'treat') speed = 0;
    if (n.aimT > 0 || n.throwT > 0.2) speed *= 0.2;
    _v.set(n.target.x - n.pos.x, 0, n.target.z - n.pos.z);
    const dist = _v.length();
    if (dist > 0.25) _v.multiplyScalar((speed * Math.min(1, dist / 1.5)) / dist); else _v.set(0, 0, 0);
    // separation
    const sep = _v2.set(0, 0, 0);
    const R = 0.75;
    this.neighbors(n.pos.x, n.pos.z, R, (o) => {
      if (o === n) return;
      const dx = n.pos.x - o.pos.x, dz = n.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > R * R || d2 < 1e-6) return;
      const d = Math.sqrt(d2);
      let w = (R - d) / R * 3;
      if (n.camp === 'protest' && o.role === 'crs') w *= o.state === 'charge' ? 4 : 2;
      if (n.role === 'crs' && o.camp === 'protest') w *= n.state === 'charge' ? 0.1 : 0.4;
      sep.x += (dx / d) * w; sep.z += (dz / d) * w;
    });
    _v.add(sep);
    const k = 1 - Math.exp(-7 * dt);
    n.vel.x += (_v.x - n.vel.x) * k;
    n.vel.z += (_v.z - n.vel.z) * k;
    const sp = Math.hypot(n.vel.x, n.vel.z), maxS = Math.max(speed, 1) * 1.4;
    if (sp > maxS) n.vel.multiplyScalar(maxS / sp);
    n.pos.x += n.vel.x * dt; n.pos.z += n.vel.z * dt;
    // static obstacles
    const gk = this.key(n.pos.x, n.pos.z, 4);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
      const l = this.circleGrid.get(gk + ox * 1000 + oz);
      if (!l) continue;
      for (const i of l) {
        const c = ctx.city.circles[i];
        const dx = n.pos.x - c.x, dz = n.pos.z - c.z, rr2 = (c.r + 0.3) ** 2, d2 = dx * dx + dz * dz;
        if (d2 < rr2 && d2 > 1e-6) { const d = Math.sqrt(d2), push = c.r + 0.3 - d; n.pos.x += (dx / d) * push; n.pos.z += (dz / d) * push; }
      }
    }
    for (const b of ctx.city.boxes) {
      const dx = n.pos.x - b.x, dz = n.pos.z - b.z;
      const px = b.hx + 0.3 - Math.abs(dx), pz = b.hz + 0.3 - Math.abs(dz);
      if (px > 0 && pz > 0) { if (px < pz) n.pos.x += Math.sign(dx) * px; else n.pos.z += Math.sign(dz) * pz; }
    }
    if (ctx.truck) ctx.truck.pushOut(n.pos);
    clampWalkable(n.pos);
    // orientation
    if (sp > 0.35 && n.state !== 'carry') n.yaw += angleDiff(n.yaw, Math.atan2(n.vel.x, n.vel.z)) * Math.min(1, dt * 8);
    else if (n.state === 'carry' && sp > 0.2) n.yaw += angleDiff(n.yaw, Math.atan2(-n.vel.x, -n.vel.z)) * Math.min(1, dt * 6);
    else if (n.faceYaw !== null) n.yaw += angleDiff(n.yaw, n.faceYaw) * Math.min(1, dt * 4);
  }
}

export function ballisticFrom(from: THREE.Vector3, to: THREE.Vector3, speed: number) {
  const g = 9.81;
  const dx = to.x - from.x, dz = to.z - from.z;
  const horiz = Math.hypot(dx, dz) || 0.01;
  const s = Math.max(speed * 0.6, Math.min(speed, Math.sqrt(horiz * g) * 0.9));
  const t = horiz / s;
  const vy = (to.y - from.y + 0.5 * g * t * t) / t;
  return new THREE.Vector3((dx / horiz) * s, vy, (dz / horiz) * s);
}
