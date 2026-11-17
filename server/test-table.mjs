// A check of the server's tables without the server: phones are imitated, timers run instantly.
// Run: node build-engine.mjs && node test-table.mjs   (prints "ALL OK" or what went wrong)
const Q = [];
let now = 1e12;
globalThis.setTimeout = (f, ms = 0) => { Q.push({ f, at: now + ms }); return Q.length; };
globalThis.clearTimeout = () => {};
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
Date.now = () => now;
const { makeTable } = await import('./src/engine.gen.js');

const problems = [];
const bad = (what, x) => { if (problems.length < 30) problems.push(what + ' ' + JSON.stringify(x || {}).slice(0, 300)); };
function run(limit = 200000) {
  let n = 0;
  while (Q.length && n++ < limit) { Q.sort((a, b) => a.at - b.at); const t = Q.shift(); now = Math.max(now, t.at); t.f(); }
}

function room(opts) {
  const inbox = new Map(), state = { saved: null, gone: false, listed: null };
  const H = {
    send: (id, d) => { if (!inbox.has(id)) inbox.set(id, []); inbox.get(id).push(JSON.parse(JSON.stringify(d))); },
    announce: info => { state.listed = info; },
    save: st => { state.saved = JSON.parse(JSON.stringify(st)); },
    drop: () => { state.gone = true; }
  };
  const t = makeTable(H, { code: '123456', owner: 'own1', lang: 'ru', vk: 'K', room: opts });
  let q = 0;
  const say = (id, d) => t.onMessage(id, ++q, d);
  const last = (id, type) => { const m = (inbox.get(id) || []).filter(x => !type || x.t === type); return m[m.length - 1]; };
  return { t, H, inbox, state, say, last };
}

// ----- 1. lobby, password, kick, owner's commands -----
{
  const r = room({ name: 'Тест', seats: 4, hand: 5, long: false, priv: true, pw: 'kot' });
  r.say('cA', { t: 'join', name: 'Аня', pid: 'own1', lang: 'ru' });
  if (!r.last('cA', 'lobby') || !r.last('cA', 'lobby').ctl) bad('owner is not in charge', r.last('cA'));
  r.say('cB', { t: 'join', name: 'Боря', pid: 'pidB', pw: 'nope' });
  if (!r.last('cB') || r.last('cB').t !== 'badpw') bad('wrong password let in', r.last('cB'));
  r.say('cB2', { t: 'join', name: 'Боря', pid: 'pidB', pw: 'kot' });
  const lb = r.last('cB2', 'lobby');
  if (!lb || lb.ctl || lb.names.join() !== 'Аня,Боря' || lb.pw) bad('guest lobby wrong', lb);
  // an invitation link: the room's key lets in without the password; a wrong key does not
  const inv = r.last('cA', 'lobby').inv;
  if (!inv || lb.inv !== inv) bad('no invitation key for the players', lb);
  r.say('cI', { t: 'join', name: 'Ира', pid: 'pidI', inv: 'wrong' });
  if (!r.last('cI') || r.last('cI').t !== 'badpw') bad('a wrong invitation key let in', r.last('cI'));
  r.say('cI2', { t: 'join', name: 'Ира', pid: 'pidI', inv, want: 'watch' });
  const li = r.last('cI2', 'lobby');
  if (!li || !li.spec || li.inv) bad('the invitation key did not let in, or a spectator got the key', li);
  r.say('cI2', { t: 'bye' });
  r.say('cB2', { t: 'addbot' });                              // not the owner: nothing happens
  if (r.last('cA', 'lobby').names.length !== 2) bad('a guest added a bot');
  r.say('cA', { t: 'addbot' });
  if (r.last('cA', 'lobby').names.length !== 3) bad('owner could not add a bot');
  r.say('cA', { t: 'kick', i: 2 });
  if (r.last('cA', 'lobby').names.length !== 2) bad('owner could not remove the bot');
  r.say('cA', { t: 'kick', i: 0 });                           // the owner cannot remove themself
  if (r.last('cA', 'lobby').names.length !== 2) bad('owner removed themself');
  r.say('cA', { t: 'room', name: 'Новое', seats: 3, hand: 6, priv: false });
  if (r.last('cB2', 'lobby').room.name !== 'Новое' || r.last('cB2', 'lobby').room.hand !== 6) bad('room settings not applied', r.last('cB2', 'lobby'));
  r.say('cW', { t: 'join', name: 'Вика', pid: 'pidW', pw: 'kot', want: 'watch' });
  const wl = r.last('cW', 'lobby');
  if (!wl || !wl.spec || wl.names.includes('Вика')) bad('"watch" put a spectator at the table', wl);
  if (r.last('cA', 'lobby').specN !== 1) bad('the owner does not see the spectator', r.last('cA', 'lobby'));
  r.say('cW', { t: 'seat' });
  if (!r.last('cW', 'lobby') || r.last('cW', 'lobby').spec || !r.last('cA', 'lobby').names.includes('Вика')) bad('a spectator could not sit down', r.last('cW', 'lobby'));
  r.say('cW', { t: 'bye' });
  r.say('cB2', { t: 'bye' });
  if (r.last('cA', 'lobby').names.length !== 1) bad('a guest who left is still listed');
  r.say('cA', { t: 'bye' });
  if (!r.state.gone) bad('the owner left but the room is open');
}

// ----- 2. many whole games: phones play at random; cards, turns and the end are checked -----
const rnd = a => a[Math.floor(Math.random() * a.length)];
let games = 0, rounds = 0;
function playGame(n, long, hand, humans) {
  const r = room({ name: 'Игра', seats: n, hand, long, priv: false });
  const ids = Array.from({ length: humans }, (_, i) => 'c' + i);
  ids.forEach((id, i) => r.say(id, { t: 'join', name: 'Игрок' + i, pid: i ? 'p' + i : 'own1', lang: i % 2 ? 'en' : 'ru' }));
  for (let k = humans; k < n; k++) r.say('c0', { t: 'addbot' });
  r.say('c0', { t: 'start' });
  run();
  let guard = 0, finished = false;
  while (guard++ < 5000) {
    run();
    const st = r.t.dump();
    const N = st.deckLong ? 52 : 36;
    const all = [...st.deck, ...st.pile, ...st.players.flatMap(p => p.hand)];
    if (all.length !== N || new Set(all.map(c => c.id)).size !== N) { bad('cards lost or doubled', { n: all.length, N }); return; }
    if (st.phase === 'roundEnd') {
      rounds++;
      if (st.result.gameOver) { games++; finished = true; break; }
      const ctl = ids.find(id => { const v = r.last(id, 'view'); return v && v.v.canControl; });
      if (!ctl) { bad('nobody can press "next round"'); return; }
      r.say(ctl, { t: 'next' });
      continue;
    }
    // whoever's move it is (a human phone) does something allowed, as seen on its own screen
    const mover = ids.find(id => { const v = r.last(id, 'view'); return v && ((v.v.phase === 'play' && v.v.turn === v.v.seat && !v.v.busy) || v.v.choose); });
    if (!mover) { bad('stuck: nobody can move', { phase: st.phase, turn: st.turn, busy: st.busy, Q: Q.length }); return; }
    const v = r.last(mover, 'view').v;
    if (v.choose) { r.say(mover, { t: 'suit', s: rnd(['♠︎', '♣︎', '♦︎', '♥︎']) }); continue; }
    const acts = v.hand.filter(c => c.ok).map(c => ({ t: 'play', id: c.id, s: c.r === 12 ? rnd(['♠︎', '♣︎', '♦︎', '♥︎']) : undefined }));
    if (v.pendingSix) acts.push({ t: 'take' });
    else { if (!v.drew) acts.push({ t: 'draw' }); else acts.push({ t: 'pass' }); }
    const plays = acts.filter(a => a.t === 'play');
    const before = r.t.dump().evSeq;
    r.say(mover, plays.length && Math.random() < 0.75 ? rnd(plays) : rnd(acts));
    run();
    // nothing happened and the view still says "your move": maybe a draw that was not allowed — try another way out
    if (r.t.dump().evSeq === before && r.t.dump().phase === 'play') {
      const v2 = r.last(mover, 'view').v;
      if (v2.turn === v2.seat && !v2.busy) r.say(mover, { t: v2.pendingSix ? 'take' : v2.drew ? 'pass' : 'draw' });
    }
  }
  if (!finished) bad('a game did not finish', { n, long, hand, humans });
  // what a phone sees: never somebody else's cards
  ids.forEach((id, i) => (r.inbox.get(id) || []).forEach(m => {
    if (m.t !== 'view') return;
    if (m.v.seat !== i) bad('a phone got another seat', { id, seat: m.v.seat });
    if (m.v.open && Object.keys(m.v.open).length) bad('a player saw open cards');
    if (JSON.stringify(m.v).includes('"deck":[')) bad('the deck went to a phone');
  }));
}
for (const long of [false, true]) for (const n of [2, 3, 4, 6]) for (const hand of [4, 5, 6]) for (const humans of [1, 2]) for (let g = 0; g < 4; g++) {
  if (humans > n) continue;
  playGame(n, long, hand, humans);
}

// ----- 3. a restarted server carries on from storage -----
{
  const r = room({ name: 'Сохранение', seats: 3, hand: 5, long: true, priv: false });
  r.say('c0', { t: 'join', name: 'Аня', pid: 'own1' });
  r.say('c1', { t: 'join', name: 'Боря', pid: 'p1', lang: 'en' });
  r.say('c0', { t: 'addbot' });
  r.say('c0', { t: 'start' });
  run();
  const saved = JSON.parse(JSON.stringify(r.t.dump()));
  const inbox2 = new Map();
  const t2 = makeTable({ send: (id, d) => { if (!inbox2.has(id)) inbox2.set(id, []); inbox2.get(id).push(d); }, announce() {}, save() {}, drop() {} },
    { code: '123456', saved });
  t2.onMessage('c1', 99, { t: 'ping' });
  run();
  const v = (inbox2.get('c1') || []).filter(m => m.t === 'view').pop();
  if (!v || v.v.seat !== 1 || v.v.hand.length !== saved.players[1].hand.length) bad('after a restart the player did not get the game back', v);
  if (!v || !v.v.log.some(x => /[a-z]/i.test(x))) bad('after a restart the English player lost the English log', v && v.v.log);
}

// ----- 4. the owner removes a player, a bot takes a seat; a spectator comes -----
{
  const r = room({ name: 'Хозяин', seats: 4, hand: 5, long: false, priv: false });
  r.say('c0', { t: 'join', name: 'Аня', pid: 'own1' });
  r.say('c1', { t: 'join', name: 'Боря', pid: 'p1' });
  r.say('c2', { t: 'join', name: 'Вика', pid: 'p2' });
  r.say('c0', { t: 'start' });
  run();
  r.say('c3', { t: 'join', name: 'Гена', pid: 'p3', want: 'watch' });
  const sv = r.last('c3', 'view');
  if (!sv || !sv.v.spec || sv.v.hand.length) bad('a spectator got a hand', sv);
  r.say('c1', { t: 'replace', i: 2 });                        // not the owner
  if (r.t.dump().players[2].isBot) bad('a guest replaced a player');
  r.say('c0', { t: 'replace', i: 2 });
  run();
  if (!r.t.dump().players[2].isBot || !r.last('c2', 'kicked')) bad('the owner could not hand a seat to a bot');
  r.say('c2', { t: 'join', name: 'Вика', pid: 'p2' });
  if (!r.last('c2') || r.last('c2').t !== 'kicked') bad('a removed player came back');
  r.say('c0', { t: 'remove', i: 1 });
  run();
  if (!r.t.dump().players[1].removed) bad('the owner could not remove a player');
  r.say('c0', { t: 'restart' });
  run();
  if (r.t.dump().roundNo !== 1) bad('"new game" did not start a new game', { roundNo: r.t.dump().roundNo });
}

console.log(`games ${games}, rounds ${rounds}`);
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'ALL OK');
