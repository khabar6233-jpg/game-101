// The relay of game messages: the same job the public MQTT brokers do, but on the game's own server.
//
// Plain mode (/ws): one long connection, short JSON lines:
//   -> {"s": topic}                       subscribe
//   -> {"p": topic, "m": text, "k": 1}    publish (k: keep the last message for those who come later)
//   <- {"t": topic, "m": text}            a message on a topic this game subscribed to
//   -> "ping"  <- "pong"
//
// Burst mode (/ws?c=<client id>): for networks that let about 16 packets through a connection and then
// freeze it, whatever their size. The game talks in short sessions, each on a new connection, and packs
// many messages into one packet. The relay remembers each client between the sessions: its subscriptions
// and the messages it has not confirmed yet.
//   -> {"e": epoch, "a": last number received, "s": [topics], "o": [{"i": id, "p": topic, "m": text, "k": 1}]}
//   <- {"e": epoch, "k": [ids received], "q": [{"n": number, "t": topic, "m": text}]}
// Both sides count the packets of a session; after FRAMES of them the game opens a new connection.
const PRE = 'cardgame101/v1/';
const MAX_MSG = 200000, MAX_SUBS = 60, KEEP_MS = 30 * 86400000;
const FRAMES = 10, QUEUE = 300, IDLE_MS = 90000;

export class Relay {
  constructor(state) {
    this.state = state;
    this.subs = new Map();                                  // plain socket -> Set of topics
    this.clients = new Map();                               // burst client id -> its state
    this.epoch = Math.random().toString(36).slice(2, 8);    // changes when the relay starts anew and has forgotten everybody
    for (const ws of state.getWebSockets()) {
      let a = null;
      try { a = ws.deserializeAttachment(); } catch {}
      if (Array.isArray(a)) this.subs.set(ws, new Set(a.map(t => PRE + t)));
      else { try { ws.close(1012, 'restart'); } catch {} }   // a burst session from before the restart
    }
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    const cid = new URL(request.url).searchParams.get('c') || '';
    const pair = new WebSocketPair(), ws = pair[1];
    this.state.acceptWebSocket(ws);
    if (/^[A-Za-z0-9_-]{4,40}$/.test(cid)) {
      let c = this.clients.get(cid);
      if (!c) { c = { subs: new Set(), q: [], n: 0, ws: null, sid: 0, frames: 0, timer: null, last: 0 }; this.clients.set(cid, c); }
      if (c.ws) { try { c.ws.close(1000, 'new session'); } catch {} }
      // the socket is told apart by a number kept with it (the object itself may be a different one later)
      c.sid++; c.ws = ws; c.frames = 0; c.last = Date.now();
      ws.serializeAttachment({ c: cid, sid: c.sid });
    } else {
      ws.serializeAttachment([]);
      this.subs.set(ws, new Set());
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async kept(t) {
    const k = await this.state.storage.get('k:' + t);
    return k && Date.now() - k.at < KEEP_MS ? k.m : null;
  }

  async publish(t, m, keep) {
    if (typeof t !== 'string' || typeof m !== 'string' || !t.startsWith(PRE) || t.length > 120) return;
    if (keep) {
      if (m && m.length <= 2000) await this.state.storage.put('k:' + t, { m, at: Date.now() });
      else await this.state.storage.delete('k:' + t);
    }
    const out = JSON.stringify({ t, m });
    for (const [sock, topics] of this.subs) {
      if (!topics.has(t)) continue;
      try { sock.send(out); } catch { this.subs.delete(sock); }
    }
    for (const c of this.clients.values()) if (c.subs.has(t)) this.queue(c, t, m);
  }

  // a message for a burst client: it waits in the queue until the client confirms it
  queue(c, t, m) {
    c.q.push({ n: ++c.n, t, m, sent: false });
    if (c.q.length > QUEUE) c.q.shift();
    if (c.ws && !c.timer) c.timer = setTimeout(() => { c.timer = null; this.flush(c); }, 40);    // a moment to pack several together
  }
  flush(c, extra) {
    const ws = c.ws;
    if (!ws) return;
    const fresh = c.q.filter(x => !x.sent);
    if (!fresh.length && !extra) return;
    if (c.frames >= FRAMES) return;                         // this session is used up: the rest goes with the next one
    fresh.forEach(x => { x.sent = true; });
    c.frames++;
    try { ws.send(JSON.stringify(Object.assign({ e: this.epoch, q: fresh.map(x => ({ n: x.n, t: x.t, m: x.m })) }, extra))); } catch {}
  }

  async webSocketMessage(ws, text) {
    if (typeof text !== 'string' || text.length > MAX_MSG) return;
    let d, a = null;
    try { d = JSON.parse(text); } catch { return; }
    if (!d) return;
    try { a = ws.deserializeAttachment(); } catch {}

    if (a && a.c) {                                         // ----- a burst session -----
      const c = this.clients.get(a.c);
      if (!c || c.sid !== a.sid) { try { ws.close(1000, 'old'); } catch {} return; }
      c.ws = ws; c.frames++; c.last = Date.now();
      if (d.e === this.epoch && d.a > 0) c.q = c.q.filter(x => x.n > d.a);       // confirmed
      if (Array.isArray(d.s)) {
        const next = new Set(d.s.filter(t => typeof t === 'string' && t.startsWith(PRE) && t.length <= 120).slice(0, MAX_SUBS));
        for (const t of next) if (!c.subs.has(t)) { const m = await this.kept(t); if (m != null) this.queue(c, t, m); }
        c.subs = next;
      }
      const got = [];
      if (Array.isArray(d.o)) for (const o of d.o.slice(0, 80)) { if (!o) continue; got.push(o.i); await this.publish(o.p, o.m, o.k); }
      if (d.hi) c.q.forEach(x => { x.sent = false; });       // a new session: everything not confirmed goes again
      clearTimeout(c.timer); c.timer = null;
      this.flush(c, d.hi || got.length ? { k: got } : null);
      if (d.hi) this.sweep();
      return;
    }

    let set = this.subs.get(ws);                            // ----- a plain connection -----
    if (!set) { set = new Set(); this.subs.set(ws, set); }
    if (typeof d.s === 'string') {
      const t = d.s;
      if (!t.startsWith(PRE) || t.length > 120 || set.has(t)) return;
      if (set.size >= MAX_SUBS) set.delete(set.values().next().value);
      set.add(t);
      try { ws.serializeAttachment([...set].map(x => x.slice(PRE.length))); } catch {}
      const m = await this.kept(t);
      if (m != null) { try { ws.send(JSON.stringify({ t, m })); } catch {} }
      return;
    }
    if (typeof d.p === 'string') await this.publish(d.p, d.m, d.k);
  }

  // forget the clients that have not come for a long time
  sweep() {
    const now = Date.now();
    for (const [id, c] of this.clients) if (now - c.last > IDLE_MS) { clearTimeout(c.timer); this.clients.delete(id); }
  }
  drop(ws) {
    this.subs.delete(ws);
    let a = null;
    try { a = ws.deserializeAttachment(); } catch {}
    const c = a && a.c ? this.clients.get(a.c) : null;
    if (c && c.sid === a.sid) { c.ws = null; clearTimeout(c.timer); c.timer = null; }
  }
  webSocketClose(ws) { this.drop(ws); try { ws.close(); } catch {} }
  webSocketError(ws) { this.drop(ws); }
}
