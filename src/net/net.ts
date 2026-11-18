import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import type { Camp } from '../core/context';
import { Mqtt, packMsg, unpackMsg } from './relay';

/**
 * Peer-to-peer link (WebRTC through PeerJS). The host's peer id is derived from the game code, so the code is all a
 * friend needs. The host is authoritative; clients only send their own player and their actions.
 * Messages are arrays: [type, ...args].
 */
export type Msg = unknown[];
export interface Member { id: string; name: string; camp: Camp; ready: boolean }

/** A connection as the game sees it: direct (PeerJS / WebRTC) or through the relay (relay.ts). */
interface Link { peer: string; send(m: Msg): void; close(): void; onData(fn: (m: Msg) => void): void; onClose(fn: () => void): void }
const direct = (c: DataConnection): Link => ({
  peer: c.peer, send: (m) => c.send(m), close: () => c.close(), onData: (fn) => c.on('data', (d) => fn(d as Msg)), onClose: (fn) => c.on('close', fn),
});
class RelayLink implements Link {
  private data: (m: Msg) => void = () => {};
  private closed = () => {};
  constructor(public peer: string, public send: (m: Msg) => void, private bye: () => void) {}
  close() { this.bye(); this.end(); }
  onData(fn: (m: Msg) => void) { this.data = fn; }
  onClose(fn: () => void) { this.closed = fn; }
  receive(m: Msg) { this.data(m); }
  end() { const f = this.closed; this.closed = () => {}; f(); }
}
/** Direct connection attempts that time out: the networks block WebRTC, use the relay. */
class Blocked extends Error {}

export const MAX_PLAYERS = 8;
const PREFIX = 'paves-v1-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Optional signalling server, e.g. ?peer=localhost:9000 (see README); the free PeerJS cloud otherwise. */
function peerOptions(): PeerOptions {
  const p = new URLSearchParams(location.search).get('peer');
  if (!p) return {};
  const [host, port] = p.split(':');
  return { host, port: +(port || 9000), path: '/', secure: location.protocol === 'https:' && host !== 'localhost' };
}

export class Net {
  role: 'solo' | 'host' | 'client' = 'solo';
  me = 'local';
  code = '';
  members: Member[] = [];
  started = false;
  /** game messages: (message, sender id) */
  handler: (m: Msg, from: string) => void = () => {};
  onMembers = () => {};
  onClosed: (why: string) => void = () => {};
  private peer: Peer | null = null;
  private conns = new Map<string, Link>();
  private mqtt: Mqtt | null = null;
  private events: Msg[] = [];

  get isHost() { return this.role === 'host'; }
  get isClient() { return this.role === 'client'; }
  get multi() { return this.role !== 'solo'; }

  // ------------------------------------------------------------------ lobby
  /** Opens a game; resolves with its code. */
  async create(name: string, camp: Camp): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
      try {
        await this.open(PREFIX + code);
      } catch (e) {
        if ((e as { type?: string }).type === 'unavailable-id') continue;
        throw e;
      }
      this.role = 'host'; this.code = code;
      this.members = [{ id: this.me, name, camp, ready: true }];
      this.peer!.on('connection', (c) => this.accept(direct(c)));
      this.hostRelay().catch(() => { /* direct connections only */ });
      return code;
    }
    throw new Error('Impossible de réserver un code de partie.');
  }

  /**
   * Joins directly when the two networks allow it, through the relay otherwise. A few retries when the game is not
   * found: the host may be registering again with the signalling server (phone put in the background).
   */
  async join(code: string, name: string, camp: Camp, status: (msg: string) => void = () => {}) {
    await this.open();
    this.code = code;
    // ?direct=0 goes straight to the relay (to check it works)
    let c: Link | null = new URLSearchParams(location.search).get('direct') === '0' ? await this.joinRelay() : null;
    for (let attempt = 1; !c; attempt++) {
      try {
        c = direct(await this.connect(PREFIX + code));
      } catch (e) {
        if (e instanceof Blocked) { status('Connexion directe impossible, passage par le serveur relais…'); c = await this.joinRelay(); break; }
        if (attempt >= 4) throw e;
        status(`Partie pas encore trouvée, nouvel essai (${attempt + 1}/4)…`);
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
    this.role = 'client';
    this.conns.set('host', c);
    c.onData((m) => this.fromHost(m));
    c.onClose(() => this.onClosed(this.started ? 'Partie terminée : l\'hôte a quitté.' : 'L\'hôte a fermé le salon.'));
    c.send(['hello', name, camp]);
  }

  private connect(id: string) {
    const c = this.peer!.connect(id, { reliable: true });
    return new Promise<DataConnection>((ok, ko) => {
      const fail = (e: Error) => { clearTimeout(t); this.peer!.off('error', onErr); c.close(); ko(e); };
      const onErr = (e: { type: string }) => fail(e.type === 'peer-unavailable'
        ? new Error('Partie introuvable. Vérifiez le code, et que l\'hôte garde le jeu ouvert à l\'écran (sans changer d\'appli ni verrouiller son téléphone).')
        : new Blocked(e.type));
      const t = setTimeout(() => fail(new Blocked('timeout')), 8000);
      this.peer!.on('error', onErr);
      c.once('error', () => fail(new Blocked('webrtc')));
      c.once('open', () => { clearTimeout(t); this.peer!.off('error', onErr); ok(c); });
    });
  }

  // ------------------------------------------------------------------ relay (relay.ts)
  private topic(s: string) { return `${PREFIX}${this.code}/${s}`; }

  /** The host listens on the relay too, for the players who cannot reach it directly. */
  private async hostRelay() {
    const m = await Mqtt.connect('pv-' + this.me, { topic: this.topic('all'), payload: packMsg(['bye']) });
    if (this.role !== 'host') return m.close();
    this.mqtt = m;
    const links = new Map<string, RelayLink>();
    m.onMessage = (_, p) => {
      const [id, kind, msg] = unpackMsg<[string, string, Msg]>(p);
      const to = (x: Msg) => m.publish(this.topic('c/' + id), packMsg(x));
      let l = links.get(id);
      if (kind === 'open') {
        if (!l) { l = new RelayLink(id, (x) => to(['data', x]), () => to(['bye'])); links.set(id, l); this.accept(l); }
        to(['ack']);
      } else if (kind === 'data') l?.receive(msg);
      else if (kind === 'bye' && l) { links.delete(id); l.end(); }
    };
    await m.subscribe(this.topic('h'));
  }

  private async joinRelay() {
    const id = this.me, toHost = (x: Msg) => m.publish(this.topic('h'), packMsg([id, ...x]));
    const m = await Mqtt.connect('pv-' + id, { topic: this.topic('h'), payload: packMsg([id, 'bye']) });
    this.mqtt = m;
    const link = new RelayLink('host', (x) => toHost(['data', x]), () => toHost(['bye']));
    m.onClose = () => link.end();
    const ready = m.subscribe(this.topic('c/' + id), this.topic('all'));
    return new Promise<Link>((ok, ko) => {
      // repeated until the host answers: our subscription, or the host's, may not be active yet
      let hello = 0;
      const t = setTimeout(() => { clearInterval(hello); m.close(); ko(new Error('Vos appareils n\'arrivent pas à se relier, même par le serveur relais. Réessayez dans un instant.')); }, 30000);
      m.onMessage = (_, p) => {
        const [kind, msg] = unpackMsg<[string, Msg]>(p);
        if (kind === 'ack') { clearTimeout(t); clearInterval(hello); ok(link); }
        else if (kind === 'data') link.receive(msg);
        else if (kind === 'bye') link.end();
      };
      ready.then(() => { toHost(['open']); hello = window.setInterval(() => toHost(['open']), 1000); });
    });
  }

  private open(id?: string) {
    return new Promise<void>((ok, ko) => {
      const p = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
      p.once('open', (me) => {
        this.me = me; this.peer = p; ok();
        // the link to the signalling server drops (or silently dies) when a phone puts the page in the background:
        // without it nobody can find the game any more, so register again with the same id
        const back = () => { if (p.destroyed) clearInterval(iv); else if (p.disconnected) p.reconnect(); };
        const iv = setInterval(back, 2000);
        document.addEventListener('visibilitychange', () => {
          if (document.hidden || p.destroyed) return;
          if (!p.disconnected) p.disconnect();
          p.reconnect();
        });
      });
      p.once('error', (e) => { if (!this.peer) { p.destroy(); ko(e); } });
    });
  }

  private accept(c: Link) {
    c.onData((m) => {
      if (m[0] === 'hello') {
        if (this.started || this.members.length >= MAX_PLAYERS) { c.send(['refused', this.started ? 'La partie a déjà commencé.' : 'La partie est complète (8 joueurs).']); setTimeout(() => c.close(), 500); return; }
        this.conns.set(c.peer, c);
        this.members.push({ id: c.peer, name: String(m[1]).slice(0, 16) || 'Anonyme', camp: m[2] as Camp, ready: false });
        this.lobbyChanged();
      } else if (m[0] === 'camp' || m[0] === 'ready') {
        const mem = this.members.find((x) => x.id === c.peer);
        if (mem) { if (m[0] === 'camp') { mem.camp = m[1] as Camp; mem.ready = false; } else mem.ready = !!m[1]; this.lobbyChanged(); }
      } else this.handler(m, c.peer);
    });
    c.onClose(() => {
      this.conns.delete(c.peer);
      if (!this.members.some((x) => x.id === c.peer)) return;
      this.members = this.members.filter((x) => x.id !== c.peer);
      if (this.started) this.handler(['left', c.peer], c.peer); else this.lobbyChanged();
    });
  }

  private fromHost(m: Msg) {
    if (m[0] === 'lobby') { this.members = m[1] as Member[]; this.onMembers(); }
    else if (m[0] === 'refused') this.onClosed(m[1] as string);
    else { if (m[0] === 'start') { this.members = m[1] as Member[]; this.started = true; } this.handler(m, 'host'); }
  }

  private lobbyChanged() { this.broadcast(['lobby', this.members]); this.onMembers(); }

  /** Lobby choices of the local player. */
  set(field: 'camp' | 'ready', v: Camp | boolean) {
    const mine = this.members.find((x) => x.id === this.me);
    if (this.isHost) { if (mine) (mine as any)[field] = v; this.lobbyChanged(); }
    else this.toHost([field, v]);
  }
  get allReady() { return this.members.length > 1 && this.members.every((m) => m.ready); }

  start() {
    this.started = true;
    this.broadcast(['start', this.members]);
  }

  leave() {
    const links = [...this.conns.values()];
    this.conns.clear();
    for (const c of links) c.close(); // through the relay, tells the other side
    this.mqtt?.close(); this.mqtt = null;
    this.peer?.destroy(); this.peer = null;
  }

  // ------------------------------------------------------------------ game traffic
  /** >0 while the host draws effects that every machine draws for itself (not to be relayed). */
  muted = 0;
  quiet(fn: () => void) { this.muted++; try { fn(); } finally { this.muted--; } }

  /** World event recorded by the host and shipped with the next snapshot. */
  emit(m: Msg) { if (this.role === 'host') this.events.push(m); }
  takeEvents() { const e = this.events; this.events = []; return e; }
  toHost(m: Msg) { this.conns.get('host')?.send(m); }
  sendTo(id: string, m: Msg) { this.conns.get(id)?.send(m); }
  broadcast(m: Msg) { for (const c of this.conns.values()) c.send(m); }
}
