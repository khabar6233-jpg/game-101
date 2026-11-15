// The relay of game messages: the same job the public MQTT brokers do, but on the game's own server,
// which can be reached without VPN. A game connects by WebSocket and speaks short JSON lines:
//   -> {"s": topic}                       subscribe
//   -> {"p": topic, "m": text, "k": 1}    publish (k: keep the last message for those who come later)
//   <- {"t": topic, "m": text}            a message on a topic this game subscribed to
//   -> "ping"  <- "pong"                  answered without waking the relay up
const PRE = 'cardgame101/v1/';
const MAX_MSG = 60000, MAX_SUBS = 60, KEEP_MS = 30 * 86400000;

export class Relay {
  constructor(state) {
    this.state = state;
    this.subs = new Map();                                  // socket -> Set of topics
    // after a sleep the sockets are still open: their subscriptions are kept with each socket
    for (const ws of state.getWebSockets()) {
      let list = [];
      try { list = ws.deserializeAttachment() || []; } catch {}
      this.subs.set(ws, new Set(list.map(t => PRE + t)));
    }
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    this.subs.set(pair[1], new Set());
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws, text) {
    if (typeof text !== 'string' || text.length > MAX_MSG) return;
    let d;
    try { d = JSON.parse(text); } catch { return; }
    if (!d) return;
    let set = this.subs.get(ws);
    if (!set) { set = new Set(); this.subs.set(ws, set); }
    if (typeof d.s === 'string') {
      const t = d.s;
      if (!t.startsWith(PRE) || t.length > 120 || set.has(t)) return;
      if (set.size >= MAX_SUBS) set.delete(set.values().next().value);
      set.add(t);
      try { ws.serializeAttachment([...set].map(x => x.slice(PRE.length))); } catch {}
      const kept = await this.state.storage.get('k:' + t);
      if (kept && Date.now() - kept.at < KEEP_MS) { try { ws.send(JSON.stringify({ t, m: kept.m })); } catch {} }
      return;
    }
    if (typeof d.p === 'string' && typeof d.m === 'string') {
      const t = d.p;
      if (!t.startsWith(PRE) || t.length > 120) return;
      if (d.k) {
        if (d.m && d.m.length <= 2000) await this.state.storage.put('k:' + t, { m: d.m, at: Date.now() });
        else await this.state.storage.delete('k:' + t);
      }
      const out = JSON.stringify({ t, m: d.m });
      for (const [sock, topics] of this.subs) {
        if (!topics.has(t)) continue;
        try { sock.send(out); } catch { this.subs.delete(sock); }
      }
    }
  }

  webSocketClose(ws) { this.subs.delete(ws); try { ws.close(); } catch {} }
  webSocketError(ws) { this.subs.delete(ws); }
}
