import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import type { Camp } from '../core/context';

/**
 * Peer-to-peer link (WebRTC through PeerJS). The host's peer id is derived from the game code, so the code is all a
 * friend needs. The host is authoritative; clients only send their own player and their actions.
 * Messages are arrays: [type, ...args].
 */
export type Msg = unknown[];
export interface Member { id: string; name: string; camp: Camp; ready: boolean }

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
  private conns = new Map<string, DataConnection>();
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
      this.peer!.on('connection', (c) => this.accept(c));
      return code;
    }
    throw new Error('Impossible de réserver un code de partie.');
  }

  async join(code: string, name: string, camp: Camp) {
    await this.open();
    const c = this.peer!.connect(PREFIX + code.toUpperCase(), { reliable: true });
    await new Promise<void>((ok, ko) => {
      const t = setTimeout(() => ko(new Error('Partie introuvable (code ?)')), 12000);
      this.peer!.once('error', (e) => { clearTimeout(t); ko(e.type === 'peer-unavailable' ? new Error('Partie introuvable : vérifiez le code.') : e); });
      c.once('open', () => { clearTimeout(t); ok(); });
    });
    this.role = 'client'; this.code = code.toUpperCase();
    this.conns.set('host', c);
    c.on('data', (d) => this.fromHost(d as Msg));
    c.on('close', () => this.onClosed(this.started ? 'Partie terminée : l\'hôte a quitté.' : 'L\'hôte a fermé le salon.'));
    c.send(['hello', name, camp]);
  }

  private open(id?: string) {
    return new Promise<void>((ok, ko) => {
      const p = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
      p.once('open', (me) => { this.me = me; this.peer = p; ok(); });
      p.once('error', (e) => { p.destroy(); ko(e); });
    });
  }

  private accept(c: DataConnection) {
    c.on('data', (d) => {
      const m = d as Msg;
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
    c.on('close', () => {
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

  leave() { this.peer?.destroy(); this.peer = null; this.conns.clear(); }

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
