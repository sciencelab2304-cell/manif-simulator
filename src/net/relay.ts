import { pack, unpack, type Packable } from 'peerjs-js-binarypack';

/**
 * Plan B when two players cannot reach each other directly (mobile networks, NAT64…): the game traffic goes through
 * a public MQTT broker over a secure WebSocket, which every network lets through. Messages are packed like PeerJS
 * does, so the game code does not see the difference (see Link in net.ts).
 */
const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];

/** ?relay=ws://127.0.0.1:8888 replaces the public brokers (tests, LAN). */
function brokers() {
  const r = new URLSearchParams(location.search).get('relay');
  return r ? [r] : BROKERS;
}

const enc = new TextEncoder();
const str = (s: string) => { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
const frame = (type: number, body: number[] | Uint8Array) => {
  const len: number[] = [];
  let n = body.length;
  do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; len.push(d); } while (n > 0);
  const out = new Uint8Array(1 + len.length + body.length);
  out[0] = type; out.set(len, 1); out.set(body, 1 + len.length);
  return out;
};

export const packMsg = (m: unknown) => new Uint8Array(pack(m as Packable) as ArrayBuffer);
export const unpackMsg = <T>(b: Uint8Array) => unpack(b.slice().buffer) as T;

/** Minimal MQTT 3.1.1 client: QoS 0 only, which is all the game needs. */
export class Mqtt {
  onMessage: (topic: string, payload: Uint8Array) => void = () => {};
  onClose = () => {};
  private buf = new Uint8Array(0);
  private ping = 0;
  private constructor(private ws: WebSocket) {}

  /** Connects to the first broker that answers. `will` is published by the broker if we vanish. */
  static async connect(clientId: string, will: { topic: string; payload: Uint8Array }) {
    for (const url of brokers()) {
      try { return await Mqtt.open(url, clientId, will); } catch { /* next broker */ }
    }
    throw new Error('Serveur relais injoignable.');
  }

  private static open(url: string, clientId: string, will: { topic: string; payload: Uint8Array }) {
    return new Promise<Mqtt>((ok, ko) => {
      const ws = new WebSocket(url, 'mqtt');
      ws.binaryType = 'arraybuffer';
      const m = new Mqtt(ws);
      const t = setTimeout(() => { ws.close(); ko(new Error('timeout')); }, 6000);
      ws.onerror = () => { clearTimeout(t); ko(new Error('ws')); };
      ws.onopen = () => {
        // protocol "MQTT" level 4, clean session + will (QoS 0), keep-alive 30 s
        ws.send(frame(0x10, [...str('MQTT'), 4, 0x06, 0, 30, ...str(clientId), ...str(will.topic), will.payload.length >> 8, will.payload.length & 255, ...will.payload]));
      };
      m.onPacket = (type, body) => {
        if (type !== 0x20) return;
        clearTimeout(t);
        if (body[1] !== 0) { ws.close(); ko(new Error('refused')); return; }
        m.onPacket = (ty, b) => m.packet(ty, b);
        m.ping = window.setInterval(() => ws.readyState === 1 && ws.send(new Uint8Array([0xc0, 0])), 20000);
        ws.onclose = () => { clearInterval(m.ping); m.onClose(); };
        ok(m);
      };
      ws.onmessage = (e) => m.receive(new Uint8Array(e.data as ArrayBuffer));
    });
  }

  private onPacket: (type: number, body: Uint8Array) => void = () => {};

  /** WebSocket frames may hold several MQTT packets, or part of one. */
  private receive(data: Uint8Array) {
    const b = new Uint8Array(this.buf.length + data.length);
    b.set(this.buf); b.set(data, this.buf.length);
    let o = 0;
    while (o + 2 <= b.length) {
      let len = 0, mul = 1, i = o + 1, d: number;
      do { if (i >= b.length) { this.buf = b.slice(o); return; } d = b[i++]; len += (d & 127) * mul; mul *= 128; } while (d & 128);
      if (i + len > b.length) break;
      this.onPacket(b[o] & 0xf0, b.subarray(i, i + len));
      o = i + len;
    }
    this.buf = b.slice(o);
  }

  private packet(type: number, body: Uint8Array) {
    if (type !== 0x30) return; // PUBLISH, QoS 0: topic then payload
    const tl = (body[0] << 8) | body[1];
    this.onMessage(new TextDecoder().decode(body.subarray(2, 2 + tl)), body.subarray(2 + tl));
  }

  subscribe(...topics: string[]) {
    this.ws.send(frame(0x82, [0, 1, ...topics.flatMap((t) => [...str(t), 0])]));
  }

  publish(topic: string, payload: Uint8Array) {
    if (this.ws.readyState !== 1) return;
    const t = str(topic), body = new Uint8Array(t.length + payload.length);
    body.set(t); body.set(payload, t.length);
    this.ws.send(frame(0x30, body));
  }

  close() { clearInterval(this.ping); this.onClose = () => {}; if (this.ws.readyState === 1) this.ws.send(new Uint8Array([0xe0, 0])); this.ws.close(); }
}
