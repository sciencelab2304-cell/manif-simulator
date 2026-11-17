import * as THREE from 'three';
import { ctx } from '../core/context';
import type { Avatar } from './avatar';
import type { ThrowKind } from '../weapons/projectiles';
import type { PoliceMode } from '../npc/crowd';
import type { Zone } from '../damage/damage';

type V = [number, number, number];
const v3 = (a: V) => new THREE.Vector3(a[0], a[1], a[2]);
const _v = new THREE.Vector3();

/**
 * Everything a player does to the shared world. The kits call `act(...)`: solo and host run it at once, a client
 * sends it to the host, which runs the same function for that player's avatar. Arguments stay plain numbers/strings.
 */
const ACTIONS = {
  throw(by: Avatar, kind: ThrowKind, from: V, vel: V, emit: number) {
    const p = ctx.projectiles.spawn(kind, v3(from), v3(vel), by, by.camp);
    if (emit) p.emit = emit;
    by.data.lastThrow = ctx.time;
    by.throwT = 0.55;
    if (kind === 'gas' && by.camp === 'protest') ctx.tension.add(1.5, 'renvoi');
    else if (kind === 'gas' || kind === 'sting') ctx.tension.add(kind === 'gas' ? 1.5 : 2.5, 'grenade');
    else if (kind !== 'fumigene') ctx.tension.add(0.6, 'jet');
  },
  lbd(by: Avatar, from: V, dir: V) {
    ctx.projectiles.fireLBD(v3(from), v3(dir), by, 'police');
  },
  strike(by: Avatar, id: number, zone: Zone, amount: number) {
    const n = ctx.crowd.byId(id);
    if (!n?.standing || n.pos.distanceTo(by.pos) > 3) return;
    const dir = new THREE.Vector3().subVectors(n.pos, by.pos).setY(0).normalize();
    const point = n.pos.clone().setY(zone === 'head' ? 1.65 : zone.startsWith('leg') ? 0.5 : 1.15);
    ctx.audio.baton(point);
    by.strikeT = 0.45;
    n.takeHit({ amount, zone, type: 'baton', dir, point, force: zone === 'head' ? 5 : 2.5, by, fromCamp: 'police' });
    ctx.tension.add(1, 'matraque');
  },
  /** F as a CRS on a weakened protester: he is held for the time of the handcuffing (see PoliceKit). */
  seize(by: Avatar, id: number) {
    const n = ctx.crowd.byId(id);
    if (!n?.cuffable || n.downPelvis(_v).distanceTo(by.pos) > 2.8) return;
    if ((n as Avatar).isHuman) { (n as Avatar).seize(); return; }
    if (n.ragdoll) return; // lying in a heap: cuffed where he lies
    if (n.standing) { n.setState('cuffing'); n.yaw = Math.atan2(n.pos.x - by.pos.x, n.pos.z - by.pos.z); }
  },
  cuff(by: Avatar, id: number) {
    const n = ctx.crowd.byId(id);
    if (!n || n.removed || n.state === 'arrested' || n.state === 'escort' || n.downPelvis(_v).distanceTo(by.pos) > 3) return;
    ctx.stats.arrests++;
    ctx.crowd.humanArrests++;
    ctx.tension.add(1, 'interpellation');
    by.feed(`Interpellation réussie (${ctx.crowd.humanArrests} / ${ctx.game.arrestGoal})`, '#9fb7ff');
    if ((n as Avatar).isHuman) { (n as Avatar).getArrested(); return; }
    if (n.downMats) n.getUp();
    n.setState('arrested');
    n.helper = null;
    // the nearest colleague escorts the suspect to the vans, otherwise he walks there alone
    const esc = ctx.crowd.nearest(n.pos, 40, (o) => o.role === 'crs' && o.standing && o.state === 'line' && o.slot.row === 1);
    if (esc) { esc.setState('escort'); esc.data.target = n; n.escortOf = esc; }
  },
  order(_by: Avatar, mode: PoliceMode) { ctx.crowd.order(mode); },
  /** F as a protester: build a barricade with what lies around, otherwise set fire to what is close. */
  fire(by: Avatar, at: V, yaw: number) {
    if (ctx.destruction.buildBarricade(v3(at), yaw, by)) { by.feed('Barricade montée', '#ffb070'); return; }
    const burn = ctx.destruction.nearestBurnable(by.pos, 2.5);
    if (burn) { ctx.destruction.ignite(burn, by); by.feed('Le feu prend…', '#ffb070'); }
    else by.feed('Pas assez de matériel (poubelles, barrières, palettes).', '#cfcfcf');
  },
  take(_by: Avatar, what: 'item' | 'proj', i: number) {
    if (what === 'item') { const it = ctx.pickups.items[i]; if (it?.active) ctx.pickups.take(it); }
    else { const p = ctx.projectiles.byId(i); if (p) ctx.projectiles.take(p); }
  },
  tension(_by: Avatar, v: number, reason: string) { ctx.tension.add(v, reason); },
  truck(by: Avatar, enter: boolean) { if (enter) ctx.truck.enter(by); else ctx.truck.exit(by); },
};

export type ActionName = keyof typeof ACTIONS;
type Args<K extends ActionName> = (typeof ACTIONS)[K] extends (by: Avatar, ...a: infer A) => void ? A : never;

export function act<K extends ActionName>(name: K, ...args: Args<K>) {
  if (ctx.net.isClient) ctx.net.toHost(['act', name, ...args]);
  else (ACTIONS[name] as (by: Avatar, ...a: unknown[]) => void)(ctx.crowd.me, ...args);
}

/** Host: an action sent by a client, performed by its avatar. */
export function runAction(by: Avatar, name: string, args: unknown[]) {
  const f = ACTIONS[name as ActionName] as ((by: Avatar, ...a: unknown[]) => void) | undefined;
  if (f && by.alive) f(by, ...args);
}
