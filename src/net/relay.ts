import type Peer from 'peerjs';
import { pack, unpack, type Packable } from 'peerjs-js-binarypack';

/**
 * Plan B when two players cannot reach each other directly (school Wi-Fi, mobile networks…): the game traffic goes
 * through the PeerJS signalling server itself, the one connection that filtered networks always let through since it
 * is what finds a game from its code. That server hands CANDIDATE messages to their recipient whatever they hold, so
 * ours travel as CANDIDATEs of a connection that does not exist, packed like PeerJS does.
 */
const TAG = 'paves-relay';

type Socket = { send(d: object): void; on(e: 'message', fn: (d: Signal) => void): void };
type Signal = { type: string; src: string; payload?: { connectionId?: string; d?: string } };

const b64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export type RelaySend = (to: string, kind: string, m?: unknown) => void;

/** Listens to the relayed messages reaching this peer; returns how to send one. */
export function relay(peer: Peer, onMessage: (from: string, kind: string, m: unknown) => void): RelaySend {
  const p = peer as unknown as { socket: Socket; _lostMessages: Map<string, unknown> };
  p.socket.on('message', (d) => {
    if (d.type !== 'CANDIDATE' || d.payload?.connectionId !== TAG || !d.payload.d) return;
    p._lostMessages.delete(TAG); // PeerJS keeps them for the connection it expects
    const [kind, m] = unpack(bytes(d.payload.d).buffer) as [string, unknown];
    onMessage(d.src, kind, m);
  });
  return (to, kind, m) => p.socket.send({ type: 'CANDIDATE', dst: to, payload: { connectionId: TAG, d: b64(new Uint8Array(pack([kind, m] as Packable) as ArrayBuffer)) } });
}
