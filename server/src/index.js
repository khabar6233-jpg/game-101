// The server of the card game "101". For now it only answers "I am here",
// so that we can check from a phone without VPN that it can be reached at all.
const CORS = { 'Access-Control-Allow-Origin': '*' };

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ping') {
      return new Response(JSON.stringify({ ok: true, time: Date.now() }), {
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>101</title><body style="font:20px system-ui;background:#0b3f25;color:#fff;text-align:center;padding:60px 16px">' +
      '<h1>Сервер «101» работает</h1><p>Если вы видите эту страницу без VPN, сервер доступен.</p>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  },
};
