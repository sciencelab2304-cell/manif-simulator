import * as THREE from 'three';
import { ctx, type Camp, type HitInfo } from '../core/context';
import { NPC, STATES, type Role, type Weapon } from '../npc/npc';
import type { Zone, DamageType } from '../damage/damage';
import { Avatar } from './avatar';
import { dress, type LookSpec } from '../meta/shop';
import { runAction } from './actions';
import type { Msg } from './net';
import type { ThrowKind } from '../weapons/projectiles';
import { angleDiff, clamp } from '../core/util';
import { canvas } from '../core/textures';
import { t } from '../core/i18n';

const KINDS: ThrowKind[] = ['pave', 'canette', 'bouteille', 'conserve', 'mortier', 'fusee', 'fumigene', 'gas', 'sting'];
const MODES = ['hold', 'advance', 'charge', 'regroup'] as const;
const NPC_REC = 17; // shorts per NPC in a snapshot
const SNAP_DT = 1 / 15, ME_DT = 1 / 20;

/** Effects the host replays on clients: object → methods (calls whose first argument is null are personal). */
const RELAY: Record<string, string[]> = {
  audio: ['impact', 'glass', 'whoosh', 'explosion', 'firework', 'launch', 'shot', 'thump', 'hiss', 'scream', 'cough', 'whistle', 'baton', 'shieldHit', 'bip', 'say'],
  particles: ['emit', 'bloodSpray', 'sparks', 'flash', 'glass', 'dust', 'smoke', 'fire', 'colorSmoke', 'splash'],
  decals: ['add'],
  lights: ['flash'],
  hud: ['banner', 'loudspeaker'],
};

// Vectors and colours travel as tagged arrays
const enc = (x: unknown): unknown => x instanceof THREE.Vector3 ? ['$v', x.x, x.y, x.z] : x instanceof THREE.Color ? ['$c', x.getHex()]
  : Array.isArray(x) ? x.map(enc) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, enc(v)])) : x;
const dec = (x: unknown): unknown => Array.isArray(x) ? (x[0] === '$v' ? new THREE.Vector3(x[1], x[2], x[3]) : x[0] === '$c' ? new THREE.Color(x[1]) : x.map(dec))
  : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, dec(v)])) : x;

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

/** Name above a human player: same size on screen at any distance, drawn over everything. */
function nameplate(name: string, color: string) {
  const H = 44, font = 'bold 30px "Helvetica Neue", Arial, sans-serif';
  const c = canvas(1, H), g = c.getContext('2d')!;
  g.font = font;
  c.width = Math.ceil(g.measureText(name).width) + 24;
  g.fillStyle = 'rgba(8,8,10,0.85)'; g.fillRect(0, 0, c.width, H);
  g.font = font; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(name, c.width / 2, H / 2 + 1);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthTest: false, transparent: true, sizeAttenuation: false, fog: false, toneMapped: false }));
  s.scale.set(0.05 * c.width / H, 0.05, 1);
  s.renderOrder = 25;
  return s;
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Multiplayer state flow. Host: 15 snapshots/s (NPCs, projectiles, props, fires, gas, truck, tension) plus the world
 * events and replayed effects of the interval. Client: sends its player 20 times/s, mirrors the host's world and
 * smooths it (extrapolation from the reported velocity, then easing).
 */
export class Sync {
  private t = 0;
  private fx: unknown[] = [];
  private ready = new Set<string>();
  private sentKey = new Map<string, string>();
  // client side
  meId = -1;
  private goals = new Map<number, { x: number; y: number; z: number; yaw: number; vx: number; vz: number; at: number }>();
  private ghosts = new Map<number, { p: THREE.Vector3; q: THREE.Quaternion }>();
  private propGoals = new Map<number, { p: THREE.Vector3; q: THREE.Quaternion }>();
  private hostTime = 0;
  private lostDriverT = 0;
  private plates = new Map<number, THREE.Sprite>();

  constructor(private onEnd: (winner: Camp, reason: string, stats?: Record<string, number>) => void) {
    const net = ctx.net;
    if (!net.multi) return;
    net.handler = (m, from) => this.receive(m, from);
    if (net.isHost) this.relay();
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    const net = ctx.net;
    if (!net.multi) return;
    this.t += dt;
    if (net.isHost && this.t >= SNAP_DT) { this.t = 0; this.snapshot(); }
    if (net.isClient) {
      if (this.t >= ME_DT) { this.t = 0; this.report(); }
      this.mirror(dt);
    }
    this.nameplates();
  }

  /** Host: an end of match for everyone. */
  end(winner: Camp, reason: string) {
    ctx.net.broadcast(['end', winner, reason, { ...ctx.stats }]);
  }

  // ------------------------------------------------------------------ host
  private relay() {
    for (const [obj, methods] of Object.entries(RELAY)) {
      const o = (ctx as any)[obj];
      for (const m of methods) {
        const f = o[m].bind(o);
        o[m] = (...a: unknown[]) => {
          if (!ctx.net.muted && a[0] != null) this.fx.push([obj, m, ...a.map(enc)]);
          return f(...a);
        };
      }
    }
  }

  private snapshot() {
    const npcs = ctx.crowd.all.filter((n) => n.state !== 'gone');
    const a = new Int16Array(npcs.length * NPC_REC);
    npcs.forEach((n, i) => {
      const o = i * NPC_REC;
      const flags = (n.chant ? 1 : 0) | (n.handsUp ? 2 : 0) | (n.kneel ? 4 : 0) | (n.coverHead > 0 ? 8 : 0) | (n.aimT > 0 ? 16 : 0);
      a.set([n.id, n.pos.x * 100, n.pos.z * 100, wrap(n.yaw) * 1000, n.vel.x * 100, n.vel.z * 100, STATES.indexOf(n.state), flags,
        n.throwT * 1000, n.strikeT * 1000, n.flinchT * 1000, n.wounds.limp * 1000, n.tint * 1000, n.downOffset.x * 100, n.downOffset.z * 100, n.hp / n.maxHp * 1000, n.pos.y * 100], o);
    });
    // projectiles and props: only those that changed since the last snapshot
    const proj: number[] = [];
    for (const p of ctx.projectiles.list) {
      if (p.dead || !p.body) continue;
      const t = p.body.translation(), r = p.body.rotation();
      const flags = (p.emit > 0 ? 1 : 0) | (p.spent && p.resting > 0.5 ? 2 : 0) | (p.thrust > 0 ? 4 : 0);
      if (!this.changed('p' + p.id, t, flags)) continue;
      proj.push(p.id, KINDS.indexOf(p.kind), t.x, t.y, t.z, r.x, r.y, r.z, r.w, flags);
    }
    const props: number[] = [];
    ctx.destruction.props.forEach((p, i) => {
      if (p.used) return;
      const t = p.body.translation(), r = p.body.rotation();
      if (this.changed('o' + i, t, Math.round(r.x * 100) + Math.round(r.z * 100) * 1000)) props.push(i, t.x, t.y, t.z, r.x, r.y, r.z, r.w);
    });
    const T = ctx.truck, P_ = ctx.crowd.police;
    const head = [ctx.time, ctx.tension.value, ctx.tension.phase, ctx.tension.sommations, MODES.indexOf(P_.mode), P_.lineZ,
      T.pos.x, T.pos.z, T.yaw, T.turretYaw, T.turretPitch, T.spraying ? 1 : 0, T.tank, T.driverId, ctx.crowd.humanArrests, +T.refilling, P_.push, P_.pushers];
    const fires = ctx.destruction.fires.map((f) => [ctx.destruction.burnables.indexOf(f.burnable!), f.t, f.intensity]);
    const gas = ctx.gas.clouds.map((c) => [c.pos.x, c.pos.z, c.radius, c.conc]);
    const msg: Msg = ['s', head, a.buffer, new Float32Array(proj).buffer, new Float32Array(props).buffer, fires, gas, ctx.net.takeEvents(), this.fx];
    this.fx = [];
    for (const id of this.ready) ctx.net.sendTo(id, msg);
  }

  private changed(key: string, t: { x: number; y: number; z: number }, extra: number) {
    const k = `${Math.round(t.x * 100)},${Math.round(t.y * 100)},${Math.round(t.z * 100)},${extra}`;
    if (this.sentKey.get(key) === k) return false;
    this.sentKey.set(key, k);
    return true;
  }

  /** Everything a client needs to rebuild the current world. */
  private initEvents(): Msg[] {
    const ev: Msg[] = [];
    for (const n of ctx.crowd.all) {
      if (n.state === 'gone') continue;
      ev.push(['npc', n.id, n.role, n.weapon, n.pos.x, n.pos.z]);
      if (n.data.human) ev.push(['human', n.id, n.data.human.peer, n.data.human.name, n.data.human.look]);
      if (n.isDown) ev.push(['lay', n.id, n.yaw]);
    }
    ev.push(['banners', ctx.crowd.banners.map((b) => [b.a.id, b.b.id])]);
    ctx.destruction.windows.forEach((w) => { if (w.broken) ev.push(['win', w.index]); });
    ctx.destruction.barricades.forEach((_, i) => ev.push(ctx.destruction.barricadeEvent(i)));
    ctx.pickups.items.forEach((it, i) => { if (!it.active) ev.push(['item', i, false]); });
    return ev;
  }

  private avatar(peer: string) { return ctx.crowd.humans.find((h) => h.peer === peer); }

  // ------------------------------------------------------------------ messages
  private receive(m: Msg, from: string) {
    const [type, ...a] = m;
    if (ctx.net.isHost) {
      const av = this.avatar(from);
      if (type === 'loaded') {
        this.snapshot(); // flush pending events to the others first
        this.sentKey.clear();
        ctx.net.sendTo(from, ['init', this.initEvents()]);
        this.ready.add(from);
      } else if (type === 'me' && av) {
        const [x, y, z, yaw, vx, vz, alive, crouch, aim, aggro, medic, car, hp, throttle, steer, ty, tp, spray] = a as number[];
        av.apply({ x, y, z, yaw, vx, vz, alive: !!alive, crouch: !!crouch, aim: !!aim, aggro, medic: !!medic, car: !!car, hp });
        if (ctx.truck.driver === av) { ctx.truck.remote = { throttle, steer, spray: !!spray }; ctx.truck.turretYaw = ty; ctx.truck.turretPitch = tp; }
      } else if (type === 'act' && av) runAction(av, a[0] as string, a.slice(1));
      else if (type === 'left') {
        this.ready.delete(from);
        if (av) {
          ctx.hud.feed(t`${av.name} a quitté la partie`, '#cfcfcf');
          if (ctx.truck.driver === av) ctx.truck.exit(av);
          av.remove();
        }
      }
      return;
    }
    // client
    switch (type) {
      case 's': return this.applySnapshot(a);
      case 'init': for (const e of a[0] as Msg[]) this.event(e); return;
      case 'hurt': {
        const [amount, zone, dtype, dx, dy, dz, px, py, pz, force] = a as [number, Zone, DamageType, ...number[]];
        return ctx.player.takeHit({ amount, zone, type: dtype, dir: new THREE.Vector3(dx, dy, dz), point: new THREE.Vector3(px, py, pz), force, fromCamp: 'none' });
      }
      case 'hit': return ctx.player.hitLanded(a[0] as HitInfo);
      case 'heal': return ctx.player.heal(a[0] as boolean);
      case 'medicT': return ctx.player.medicProgress(a[0] as number);
      case 'arrest': return ctx.player.getArrested();
      case 'seize': return ctx.player.seize();
      case 'feed': return ctx.hud.feed(a[0] as string, a[1] as string);
      case 'end': return this.onEnd(a[0] as Camp, a[1] as string, a[2] as Record<string, number>);
    }
  }

  // ------------------------------------------------------------------ client
  private report() {
    const p = ctx.player, f = p.feet, k = p.kit as { aiming?: boolean }, T = ctx.truck;
    ctx.net.toHost(['me', f.x, f.y, f.z, p.yaw, p.vel.x, p.vel.z, +p.alive, +p.crouch, +!!k.aiming, p.aggro, +p.callMedic, +p.inVehicle, p.hp / p.maxHp,
      T.remote.throttle, T.remote.steer, T.turretYaw, T.turretPitch, +T.remote.spray]);
  }

  private applySnapshot([head, npcBuf, projBuf, propBuf, fires, gas, events, fx]: unknown[]) {
    for (const e of events as Msg[]) this.event(e);
    const h = head as number[];
    this.hostTime = h[0];
    if (Math.abs(ctx.time - h[0]) > 0.5) ctx.time = h[0];
    Object.assign(ctx.tension, { value: h[1], phase: h[2], sommations: h[3] });
    ctx.crowd.police.mode = MODES[h[4]]; ctx.crowd.police.lineZ = h[5];
    const T = ctx.truck;
    T.pos.x = h[6]; T.pos.z = h[7]; T.yaw = h[8]; T.tank = h[12]; T.driverId = h[13]; T.refilling = !!h[15];
    ctx.crowd.humanArrests = h[14];
    ctx.crowd.police.push = h[16]; ctx.crowd.police.pushers = h[17];
    if (!ctx.player.inVehicle) { T.turretYaw = h[9]; T.turretPitch = h[10]; T.spraying = !!h[11]; }
    T.body.setNextKinematicTranslation({ x: T.pos.x, y: 1.7, z: T.pos.z });
    T.body.setRotation({ x: 0, y: Math.sin(T.yaw / 2), z: 0, w: Math.cos(T.yaw / 2) }, true);
    // NPCs
    const a = new Int16Array(npcBuf as ArrayBuffer);
    for (let o = 0; o < a.length; o += NPC_REC) {
      const n = ctx.crowd.byId(a[o]);
      if (!n || n.removed) continue;
      const state = STATES[a[o + 6]];
      if (state !== n.state) n.setState(state);
      const f = a[o + 7];
      n.chant = !!(f & 1); n.handsUp = !!(f & 2); n.kneel = !!(f & 4); n.coverHead = f & 8 ? 0.5 : 0; n.aimT = f & 16 ? 0.5 : 0;
      n.throwT = Math.max(n.throwT, a[o + 8] / 1000); n.strikeT = Math.max(n.strikeT, a[o + 9] / 1000); n.flinchT = Math.max(n.flinchT, a[o + 10] / 1000);
      n.wounds.limp = a[o + 11] / 1000; n.tint = a[o + 12] / 1000;
      n.downOffset.set(a[o + 13] / 100, 0, a[o + 14] / 100);
      n.hp = a[o + 15] / 1000 * n.maxHp;
      this.goals.set(n.id, { x: a[o + 1] / 100, y: a[o + 16] / 100, z: a[o + 2] / 100, yaw: a[o + 3] / 1000, vx: a[o + 4] / 100, vz: a[o + 5] / 100, at: this.hostTime });
    }
    // projectiles
    const pr = new Float32Array(projBuf as ArrayBuffer);
    for (let o = 0; o < pr.length; o += 10) {
      const id = pr[o];
      const p = ctx.projectiles.byId(id) ?? ctx.projectiles.ghost(id, KINDS[pr[o + 1]]);
      const g = this.ghosts.get(id) ?? { p: new THREE.Vector3(pr[o + 2], pr[o + 3], pr[o + 4]), q: new THREE.Quaternion() };
      if (!this.ghosts.has(id)) { p.mesh.position.copy(g.p); this.ghosts.set(id, g); }
      g.p.set(pr[o + 2], pr[o + 3], pr[o + 4]); g.q.set(pr[o + 5], pr[o + 6], pr[o + 7], pr[o + 8]);
      const f = pr[o + 9];
      p.emit = f & 1 ? 8 : 0; p.spent = !!(f & 2); p.resting = f & 2 ? 1 : 0; p.thrust = f & 4 ? 1 : 0;
    }
    const po = new Float32Array(propBuf as ArrayBuffer);
    for (let o = 0; o < po.length; o += 8) {
      const g = this.propGoals.get(po[o]) ?? { p: new THREE.Vector3(), q: new THREE.Quaternion() };
      g.p.set(po[o + 1], po[o + 2], po[o + 3]); g.q.set(po[o + 4], po[o + 5], po[o + 6], po[o + 7]);
      this.propGoals.set(po[o], g);
    }
    ctx.destruction.mirrorFires(fires as number[][]);
    ctx.gas.mirror(gas as number[][]);
    for (const c of fx as unknown[][]) {
      const [obj, m, ...args] = c as [string, string, ...unknown[]];
      ((ctx as any)[obj][m] as (...x: unknown[]) => void)(...args.map(dec));
    }
  }

  /** A world event from the host (see the ctx.net.emit calls). */
  private event([type, ...a]: Msg) {
    const C = ctx.crowd;
    const n = typeof a[0] === 'number' ? C.byId(a[0] as number) : undefined;
    switch (type) {
      case 'npc': {
        if (n) return;
        const [id, role, weapon, x, z] = a as [number, Role, Weapon, number, number];
        C.add(new NPC(role, new THREE.Vector3(x, 0, z), weapon, id));
        return;
      }
      case 'human': {
        if (!n) return;
        const [, peer, name, look] = a as [number, string, string, LookSpec | undefined];
        n.data.human = { peer, name, look };
        dress(n.look, look);
        if (peer === ctx.net.me) { n.hidden = true; n.collider.setEnabled(false); this.meId = n.id; }
        return;
      }
      case 'banners': return C.setBanners((a[0] as number[][]).map(([x, y]) => [C.byId(x)!, C.byId(y)!]).filter(([x, y]) => x && y) as [NPC, NPC][]);
      case 'knock': return n?.knockDown(new THREE.Vector3(a[1] as number, a[2] as number, a[3] as number), a[4] as number);
      case 'lay': if (n && !n.isDown) n.layDown(a[1] as number, true); return;
      case 'up':
        if (!n) return;
        if (n.ragdoll) { n.ragdoll.dispose(); n.ragdoll = null; n.downMats = n.mats.map((m) => m.clone()); }
        n.getUp();
        n.pos.set(a[1] as number, 0, a[2] as number);
        if (n.hidden) n.collider.setEnabled(false);
        return;
      case 'rm': n?.remove(); return;
      case 'win': {
        const d = a.length > 1 ? new THREE.Vector3(a[1] as number, a[2] as number, a[3] as number) : undefined;
        return ctx.destruction.breakWindow(a[0] as number, d);
      }
      case 'barricade': {
        const [x, z, yaw, idx] = a as [number, number, number, number[]];
        const props = idx.map((i) => ctx.destruction.props[i]);
        if (props.every((p) => p && !p.used)) ctx.destruction.makeBarricade(new THREE.Vector3(x, 0, z), yaw, props);
        return;
      }
      case 'item': { const it = ctx.pickups.items[a[0] as number]; if (it) { it.active = a[1] as boolean; it.mesh.visible = it.active; } return; }
      case 'lbd': return ctx.projectiles.fireLBD(new THREE.Vector3(a[0] as number, a[1] as number, a[2] as number), new THREE.Vector3(a[3] as number, a[4] as number, a[5] as number), null, 'police');
      case 'blast': {
        const [x, y, z, radius, damage, knock, kind] = a as [number, number, number, number, number, number, 'sting'];
        return ctx.player.onBlast(new THREE.Vector3(x, y, z), { radius, damage, knock, kind, fire: false, flash: 1, sound: 1, by: null });
      }
      case 'pk': {
        const p = ctx.projectiles.byId(a[0] as number);
        if (p) ctx.projectiles.kill(p);
        this.ghosts.delete(a[0] as number);
        return;
      }
    }
  }

  /** Smooth everything towards the host's last word. */
  private mirror(dt: number) {
    const k = 1 - Math.exp(-dt * 12);
    const ahead = ctx.time - this.hostTime;
    for (const [id, g] of this.goals) {
      const n = ctx.crowd.byId(id);
      if (!n || n.removed) { this.goals.delete(id); continue; }
      if (!n.standing) continue;
      if (n.hidden) { // our own body (seen in third person) follows us, not the host
        const p = ctx.player;
        n.pos.copy(p.feet); n.vel.set(p.vel.x, 0, p.vel.z); n.yaw = p.yaw + Math.PI; n.kneel = p.crouch;
        continue;
      }
      const x = g.x + g.vx * clamp(ahead, 0, 0.25), z = g.z + g.vz * clamp(ahead, 0, 0.25);
      if (Math.hypot(x - n.pos.x, z - n.pos.z) > 4) n.pos.set(x, g.y, z);
      else { n.pos.x += (x - n.pos.x) * k; n.pos.y += (g.y - n.pos.y) * k; n.pos.z += (z - n.pos.z) * k; }
      n.vel.set(g.vx, 0, g.vz);
      n.yaw += angleDiff(n.yaw, g.yaw) * k;
    }
    for (const [id, g] of this.ghosts) {
      const p = ctx.projectiles.byId(id);
      if (!p) { this.ghosts.delete(id); continue; }
      p.mesh.position.lerp(g.p, k * 1.5 > 1 ? 1 : k * 1.5);
      p.mesh.quaternion.slerp(g.q, k);
    }
    for (const [i, g] of this.propGoals) {
      const pr = ctx.destruction.props[i];
      if (!pr || pr.used) { this.propGoals.delete(i); continue; }
      _v.copy(pr.mesh.position).lerp(g.p, k); _q.copy(pr.mesh.quaternion).slerp(g.q, k);
      pr.body.setNextKinematicTranslation(_v); pr.body.setNextKinematicRotation(_q);
      pr.mesh.position.copy(_v); pr.mesh.quaternion.copy(_q);
      if (pr.burnable) pr.burnable.pos.copy(_v);
    }
    // the host gave the truck to someone else: step out
    const T = ctx.truck;
    this.lostDriverT = ctx.player.inVehicle && T.driverId !== this.meId ? this.lostDriverT + dt : 0;
    if (this.lostDriverT > 1.5) { T.leave(); ctx.hud.feed('Le canon à eau est déjà occupé', '#cfcfcf'); }
  }

  /** Names above the other human players. */
  private nameplates() {
    for (const n of ctx.crowd.all) {
      const h = n.data.human as { name: string } | undefined;
      if (!h || n.hidden) continue;
      let s = this.plates.get(n.id);
      if (!s) {
        s = nameplate(h.name, n.camp === 'police' ? '#b4c8ff' : '#ffb870');
        ctx.scene.add(s); this.plates.set(n.id, s);
      }
      s.visible = n.state !== 'gone' && n.visible;
      n.downPelvis(_v);
      s.position.set(n.isDown ? _v.x : n.pos.x, (n.isDown ? 0.5 : 2.15), n.isDown ? _v.z : n.pos.z);
    }
    for (const [id, s] of this.plates) {
      const n = ctx.crowd.byId(id);
      if (n && !n.removed) continue;
      ctx.scene.remove(s); s.material.map?.dispose(); s.material.dispose();
      this.plates.delete(id);
    }
  }
}

