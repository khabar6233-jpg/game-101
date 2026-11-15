// The server of the card game "101".
//   POST /hello      the game says "I am here": the list of players
//   GET  /tg/chat    has this player pressed Start in the Telegram bot?
//   POST /tg/say     the bot writes to a chat (an invitation from a friend)
//   POST /tg/hook/…  Telegram tells the bot what people wrote to it
//   GET  /ws         the relay of game messages (see relay.js)
//   GET  /rpc        any of the requests above as one question and one answer over a fresh WebSocket
//   GET  /rooms      the open rooms; POST /rooms: a host tells about its room
//   GET  /admin      the developer's page (behind a password that only the owner knows)
import ADMIN_PAGE from './admin.html';
export { Relay } from './relay.js';
import { probeSocket, PROBE_PAGE } from './probe.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Key',
  'Access-Control-Max-Age': '86400',
};
const json = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const str = (x, n) => String(x == null ? '' : x).slice(0, n);
const body = async request => { try { return JSON.parse(await request.text()) || {}; } catch { return {}; } };
const PID = /^[A-Za-z0-9_-]{4,40}$/;

async function sha(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const tgSend = (env, chat, text) => fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
}).then(r => r.json()).catch(() => null);

async function hello(env, d) {
  const pid = str(d.pid, 40);
  if (!PID.test(pid)) return json({ ok: false }, 400);
  const now = Date.now(), name = str(d.name, 12).trim();
  const row = await env.DB.prepare('SELECT names FROM players WHERE pid = ?').bind(pid).first();
  let names = [];
  try { names = JSON.parse(row ? row.names : '[]'); } catch {}
  if (name && !names.includes(name)) names = names.concat(name).slice(-8);
  await env.DB.prepare(
    `INSERT INTO players (pid, name, names, dev, ver, grp, mode, tg, first, last, visits, games, room, kind, host)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10, ?11, ?12, ?13, ?14)
     ON CONFLICT(pid) DO UPDATE SET name = CASE WHEN ?2 = '' THEN name ELSE ?2 END, names = ?3, dev = ?4, ver = ?5, grp = ?6,
       mode = ?7, tg = ?8, last = ?9, visits = visits + ?10, games = games + ?11, room = ?12, kind = ?13, host = ?14`
  ).bind(pid, name, JSON.stringify(names), str(d.dev, 12), +d.ver || 0, str(d.group, 16), str(d.mode, 8), d.tg ? 1 : 0, now,
    d.start ? 1 : 0, d.game ? 1 : 0, str(d.room, 12), str(d.kind, 6), d.host ? 1 : 0).run();
  // a player who linked Telegram before the server existed: remember the chat
  const chat = Math.floor(+d.chat || 0);
  if (chat) await env.DB.prepare('INSERT INTO tg (pid, chat, at) VALUES (?, ?, ?) ON CONFLICT(pid) DO NOTHING').bind(pid, chat, now).run();
  return json({ ok: true });
}

// Telegram: somebody wrote to the bot
async function hook(env, request) {
  const u = await body(request), m = u.message;
  if (m && m.chat && typeof m.text === 'string') {
    const hit = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{4,40})$/.exec(m.text.trim());
    if (hit) {
      await env.DB.prepare('INSERT INTO tg (pid, chat, at) VALUES (?1, ?2, ?3) ON CONFLICT(pid) DO UPDATE SET chat = ?2, at = ?3')
        .bind(hit[1], m.chat.id, Date.now()).run();
      await tgSend(env, m.chat.id, 'Готово! Сюда будут приходить приглашения друзей в игру «101». Вернитесь в игру.');
    } else if (/^\/start/.test(m.text)) {
      await tgSend(env, m.chat.id, 'Чтобы подключить уведомления, откройте игру «101» → Друзья → «Подключить Telegram».');
    }
  }
  return json({ ok: true });
}

async function admin(env, request, url) {
  const saved = await env.DB.prepare("SELECT v FROM meta WHERE k = 'admin'").first();
  const key = request.headers.get('X-Key') || '';
  if (url.pathname === '/admin/state') return json({ ok: true, claimed: !!saved });
  if (url.pathname === '/admin/claim' && request.method === 'POST') {       // the first one to come sets the password
    if (saved) return json({ ok: false, why: 'claimed' }, 403);
    const pw = str((await body(request)).pw, 100);
    if (pw.length < 6) return json({ ok: false, why: 'short' }, 400);
    await env.DB.prepare("INSERT INTO meta (k, v) VALUES ('admin', ?)").bind(await sha('101:' + pw)).run();
    return json({ ok: true });
  }
  if (!saved || !key || (await sha('101:' + key)) !== saved.v) return json({ ok: false, why: 'key' }, 401);
  if (url.pathname === '/admin/data') {
    const r = await env.DB.prepare('SELECT * FROM players ORDER BY last DESC LIMIT 2000').all();
    return json({ ok: true, now: Date.now(), players: r.results });
  }
  if (url.pathname === '/admin/drop' && request.method === 'POST') {         // remove a test or junk record
    const pid = str((await body(request)).pid, 40);
    await env.DB.prepare('DELETE FROM players WHERE pid = ?').bind(pid).run();
    return json({ ok: true });
  }
  return json({ ok: false }, 404);
}

// One question, one answer, each on a new connection: {"path", "body", "key"} -> the same answer the
// plain request would give. Some networks freeze a connection after a few packets, and the browser keeps
// sending plain requests into the frozen one; a fresh WebSocket always gets through.
function rpc(env, origin) {
  const pair = new WebSocketPair(), ws = pair[1];
  ws.accept();
  ws.addEventListener('message', async e => {
    let out = '{"ok":false}';
    try {
      const d = JSON.parse(e.data), path = String(d.path || '');
      if (path.startsWith('/') && !path.startsWith('/rpc') && !path.startsWith('/ws')) {
        const r = await route(new Request(origin + path, { method: d.body == null ? 'GET' : 'POST',
          headers: { 'X-Key': String(d.key || '') }, body: d.body == null ? undefined : JSON.stringify(d.body) }), env);
        out = await r.text();
      }
    } catch {}
    try { ws.send(out); ws.close(1000, 'done'); } catch {}
  });
  return new Response(null, { status: 101, webSocket: pair[0] });
}

export default {
  fetch(request, env) { return route(request, env); },
};

async function route(request, env) {
  {
    const url = new URL(request.url), p = url.pathname;
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (p === '/rpc') return rpc(env, url.origin);
      if (p === '/ping') return json({ ok: true, time: Date.now() });
      if (p === '/ws') return env.RELAY.get(env.RELAY.idFromName('main')).fetch(request);      // game messages
      if (p === '/rooms') return env.RELAY.get(env.RELAY.idFromName('rooms')).fetch(request);  // the list of open rooms (an instance of its own)
      if (p === '/hello' && request.method === 'POST') return await hello(env, await body(request));
      if (p === '/tg/chat') {
        const pid = url.searchParams.get('pid') || '';
        if (!PID.test(pid)) return json({ ok: false }, 400);
        const r = await env.DB.prepare('SELECT chat FROM tg WHERE pid = ?').bind(pid).first();
        return json({ ok: true, chat: r ? r.chat : 0 });
      }
      if (p === '/tg/say' && request.method === 'POST') {
        const d = await body(request), chat = Math.floor(+d.chat || 0), text = str(d.text, 600);
        if (!chat || !text) return json({ ok: false }, 400);
        const r = await tgSend(env, chat, text);
        return json({ ok: !!(r && r.ok) });
      }
      if (p === '/tg/hook/' + env.TG_HOOK && request.method === 'POST') {
        if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TG_HOOK) return json({ ok: false }, 403);
        return await hook(env, request);
      }
      // measuring the network (see probe.js)
      if (p === '/probe') return new Response(PROBE_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      if (p === '/probe/ws') return probeSocket(url);
      if (p === '/probe/blob') return new Response('x'.repeat(Math.min(200000, +url.searchParams.get('n') || 0)), { headers: { 'Cache-Control': 'no-store' } });
      if (p === '/probe/echo') return new Response(String((await request.text()).length), { headers: { 'Cache-Control': 'no-store' } });
      if (p === '/admin') return new Response(ADMIN_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      if (p.startsWith('/admin/')) return await admin(env, request, url);
      return new Response(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>101</title><body style="font:20px system-ui;background:#0b3f25;color:#fff;text-align:center;padding:60px 16px">' +
        '<h1>Сервер «101» работает</h1>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    } catch (e) {
      return json({ ok: false, why: 'error' }, 500);
    }
  }
}
