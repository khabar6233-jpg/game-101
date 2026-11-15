// A page that measures how the network treats this server: how much gets through one connection
// before it freezes, and whether many short requests work. The numbers decide how the game talks to the server.
const wait = ms => new Promise(r => setTimeout(r, ms));

export function probeSocket(url) {
  const mode = url.searchParams.get('m') || 'slow';
  const pair = new WebSocketPair(), ws = pair[1];
  ws.accept();
  let open = true, got = 0, bytes = 0;
  ws.addEventListener('close', () => { open = false; });
  ws.addEventListener('message', e => {                      // "up" test: count what arrives, answer with a tiny line
    got++; bytes += e.data.length;
    try { ws.send('a' + got + ':' + bytes); } catch {}
  });
  (async () => {
    const pad = n => 'x'.repeat(n);
    try {
      if (mode === 'flood') for (let i = 0; i < 300 && open; i++) ws.send(i + ':' + pad(500));
      else if (mode === 'slow') for (let i = 0; i < 100 && open; i++) { ws.send(i + ':' + pad(100)); await wait(100); }
      else if (mode === 'mid') for (let i = 0; i < 40 && open; i++) { ws.send(i + ':' + pad(1000)); await wait(250); }
      else if (mode === 'tiny') for (let i = 0; i < 60 && open; i++) { ws.send(String(i)); await wait(250); }
    } catch {}
  })();
  return new Response(null, { status: 101, webSocket: pair[0] });
}

export const PROBE_PAGE = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>101 · проверка сети</title>
<style>body{margin:0;padding:16px;font:15px/1.5 system-ui,sans-serif;background:#10251a;color:#f2f5f3}
h1{font-size:20px;margin:0 0 8px}button{font:inherit;padding:12px 18px;border:0;border-radius:10px;background:#2f7d52;color:#fff;width:100%}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#183626;border-radius:10px;padding:12px;font:13px/1.5 ui-monospace,monospace}
p{color:#9fb3a8}</style></head><body>
<h1>101 · проверка сети</h1>
<p>Выключите VPN, нажмите кнопку и подождите около минуты. Потом пришлите скриншот результата.</p>
<button id="go">Начать проверку</button><pre id="out">—</pre>
<script>
(() => {
  const out = document.getElementById('out'), lines = [];
  const say = s => { lines.push(s); out.textContent = lines.join('\\n'); };
  const W = location.origin.replace('http', 'ws');
  // one fresh connection: what the server pushes down
  const down = (m, ms) => new Promise(res => {
    const t0 = Date.now(); let n = 0, bytes = 0, last = 0, openAt = -1, closed = '';
    let ws; try { ws = new WebSocket(W + '/probe/ws?m=' + m + '&r=' + Math.random()); } catch { return res('не открылось'); }
    ws.onopen = () => { openAt = Date.now() - t0; };
    ws.onmessage = e => { n++; bytes += e.data.length; last = Date.now() - t0; };
    ws.onclose = () => { closed = ' закрыто на ' + (Date.now() - t0) + ' мс'; };
    setTimeout(() => { try { ws.close(); } catch {} res(openAt < 0 ? 'не открылось' : 'откр ' + openAt + ' мс, сообщений ' + n + ', байт ' + bytes + ', последнее на ' + last + ' мс' + closed); }, ms);
  });
  // one fresh connection: what this phone pushes up (the server answers with a count)
  const up = (size, every, ms) => new Promise(res => {
    const t0 = Date.now(); let sent = 0, ack = '', last = 0, openAt = -1, timer;
    let ws; try { ws = new WebSocket(W + '/probe/ws?m=up&r=' + Math.random()); } catch { return res('не открылось'); }
    ws.onopen = () => { openAt = Date.now() - t0; timer = setInterval(() => { try { ws.send('x'.repeat(size)); sent++; } catch {} }, every); };
    ws.onmessage = e => { ack = e.data; last = Date.now() - t0; };
    setTimeout(() => { clearInterval(timer); try { ws.close(); } catch {} res(openAt < 0 ? 'не открылось' : 'отправлено ' + sent + ', дошло ' + (ack || '0') + ', последний ответ на ' + last + ' мс'); }, ms);
  });
  // many short sessions one after another, each on its own connection
  const bursts = async (count, hold) => {
    let ok = 0, sum = 0;
    for (let i = 0; i < count; i++) {
      const t0 = Date.now();
      const good = await new Promise(res => {
        let done = false; const fin = v => { if (!done) { done = true; res(v); } };
        let ws; try { ws = new WebSocket(W + '/probe/ws?m=tiny&r=' + Math.random()); } catch { return fin(false); }
        let first = true; ws.onmessage = () => { if (!first) return; first = false; sum += Date.now() - t0; setTimeout(() => { try { ws.close(); } catch {} fin(true); }, hold); };
        ws.onerror = () => fin(false);
        setTimeout(() => { try { ws.close(); } catch {} fin(false); }, 4000);
      });
      if (good) ok++;
    }
    return 'удачных ' + ok + '/' + count + ', до первого сообщения в среднем ' + (ok ? Math.round(sum / ok) : 0) + ' мс';
  };
  // plain requests
  const gets = async (count, size) => {
    let ok = 0; const t0 = Date.now();
    for (let i = 0; i < count; i++) {
      try {
        const c = new AbortController(), t = setTimeout(() => c.abort(), 4000);
        const r = await fetch('/probe/blob?n=' + size + '&r=' + Math.random(), { signal: c.signal, cache: 'no-store' });
        const b = await r.text(); clearTimeout(t);
        if (b.length === size) ok++;
      } catch {}
    }
    return 'удачных ' + ok + '/' + count + ' за ' + (Date.now() - t0) + ' мс';
  };
  const posts = async (count, size) => {
    let ok = 0; const t0 = Date.now();
    for (let i = 0; i < count; i++) {
      try {
        const c = new AbortController(), t = setTimeout(() => c.abort(), 4000);
        const r = await fetch('/probe/echo?r=' + Math.random(), { method: 'POST', body: 'x'.repeat(size), signal: c.signal });
        const b = await r.text(); clearTimeout(t);
        if (b === String(size)) ok++;
      } catch {}
    }
    return 'удачных ' + ok + '/' + count + ' за ' + (Date.now() - t0) + ' мс';
  };
  document.getElementById('go').onclick = async e => {
    e.target.disabled = true; lines.length = 0;
    say('Сеть: ' + ((navigator.connection && navigator.connection.effectiveType) || '?') + ' · ' + new Date().toLocaleTimeString());
    say('1 поток 150 КБ сразу: ' + await down('flood', 6000));
    say('2 по 100 Б каждые 0,1 с: ' + await down('slow', 11000));
    say('3 по 1 КБ каждые 0,25 с: ' + await down('mid', 11000));
    say('4 по 2 Б каждые 0,25 с: ' + await down('tiny', 16000));
    say('5 вверх 100 Б каждые 0,1 с: ' + await up(100, 100, 7000));
    say('6 вверх 1 КБ каждые 0,25 с: ' + await up(1000, 250, 7000));
    say('7 короткие сеансы 0,3 с: ' + await bursts(15, 300));
    say('8 короткие сеансы 0,8 с: ' + await bursts(10, 800));
    say('9 запросы 500 Б: ' + await gets(20, 500));
    say('10 запросы 3 КБ: ' + await gets(15, 3000));
    say('11 запросы 20 КБ: ' + await gets(6, 20000));
    say('12 отправка 500 Б: ' + await posts(20, 500));
    say('13 отправка 3 КБ: ' + await posts(15, 3000));
    say('Готово. Пришлите скриншот.');
    e.target.disabled = false;
  };
})();
</script></body></html>`;
