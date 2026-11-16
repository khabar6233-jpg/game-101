// ===== the room on the server: who sits here, who watches, the owner's commands, the game kept in storage =====
// Phones only show the table and send taps; every rule is applied here. A phone gets nothing but its own view:
// its own cards, the backs of the others' cards, the table.
const LOST_MS = 60000;            // no word from a phone this long: "нет связи"
const IDLE_MS = 30 * 60000;       // nobody has said anything this long: the room is closed
let ownerPid = String(init.owner || '');
const conns = new Map();          // connection id -> { id, pid, open, left, last, rev, send }
let lobby = [];                   // before the game: { name, conn, isBot, pid }
const banned = new Set();
const kicked = new Map();         // connection id -> when it was removed (it keeps being told for a while)
let vk = init.vk || '';            // the key the voice chat of this room is sealed with (only members get it)
let lastWord = Date.now(), closed = false, saveT = null, tickT = null, annAt = 0;
const born = Date.now();
let humansAt = Date.now();        // the last moment somebody (not a bot) was at the table
const seen = new Set();

function mkConn(id) {
  let c = conns.get(id);
  if (!c) { c = { id, pid: '', open: true, left: false, last: Date.now(), rev: 0, send: d => H.send(id, d) }; conns.set(id, c); }
  return c;
}
const retire = c => { if (c) { c.left = true; c.open = false; } };

// who presses "Начать", "Следующий раунд", "+ бот": the owner while their phone answers, otherwise the first player who is here
function controller() {
  const seated = started ? players : lobby;
  const here = p => p && !p.isBot && !p.removed && p.conn && p.conn.open && !p.conn.left && !p.lost;
  const own = seated.findIndex(p => here(p) && p.pid === ownerPid);
  return own >= 0 ? own : seated.findIndex(here);
}
const isCtl = conn => { const i = controller(); const s = started ? players[i] : lobby[i]; return !!s && s.conn === conn; };

// ---------- what the phones are told ----------
function viewOf(seat, sp, ctl) {
  const v = viewFor(seat, sp);
  v.canControl = seat >= 0 && seat === ctl;
  v.sitters = v.canControl ? [...specs.values()].filter(x => x.sit).map(x => x.name) : [];
  v.vk = vk; v.srv = 1; v.ver = VERSION; v.proto = PROTO;
  return v;
}
function render() {
  if (closed) return;
  if (started && players.length) {
    const ctl = controller();
    players.forEach((p, i) => {
      if (!p.conn || !p.conn.open) return;
      const v = viewOf(i, null, ctl);
      p.conn.rev = v.rev;
      p.conn.send({ t: 'view', v });
    });
    specs.forEach(sp => {
      const v = viewOf(-1, sp, ctl);
      sp.conn.rev = v.rev;
      sp.conn.send({ t: 'view', v });
    });
  }
  save();
}
const roomInfo = () => ({ name: roomName, seats: roomSeats, hand: roomHand, priv: roomPriv });
function lobbyMsg(i, ctl) {
  return { t: 'lobby', code: roomCode, names: lobby.map(x => x.name), bots: lobby.map(x => !!x.isBot), me: i, ctl: i === ctl,
    long: longPick, room: roomInfo(), pw: i === ctl ? roomPw : '', vk, ver: VERSION, proto: PROTO, srv: 1 };
}
function drawLobby() {
  if (closed) return;
  const ctl = controller();
  lobby.forEach((s, i) => { if (s.conn && s.conn.open) s.conn.send(lobbyMsg(i, ctl)); });
  announce(true);
  save();
}
// the list of games on the start screen
function announce(now) {
  if (closed || (!now && Date.now() - annAt < 3500)) return;
  if (!started && !lobby.length) return;                  // an empty room is not shown in the list
  annAt = Date.now();
  const seated = started ? players.filter(p => !p.removed) : lobby;
  H.announce({ code: roomCode, name: roomName, host: ownerPid, names: seated.map(p => p.name), pids: seated.map(p => p.pid || '').filter(Boolean),
    seats: roomSeats, hand: started ? handN : roomHand, long: started ? deckLong : longPick, priv: roomPriv, started: !!started,
    spec: specs.size, open: started ? players.filter(x => x.isBot && !x.removed && !x.out).length : 0, ver: VERSION });
}

// send a phone the current state again (answers every ping, so a lost message heals itself)
function resync(conn, d) {
  if (!started) {
    const i = lobby.findIndex(s => s.conn === conn);
    if (i >= 0) conn.send(lobbyMsg(i, controller()));
    else conn.send({ t: 'kicked', term });
    return;
  }
  const seat = players.findIndex(p => p.conn === conn);
  const ctl = controller();
  if (seat >= 0) {
    if (d && d.rev && d.rev === conn.rev && d.term === term) { conn.send({ t: 'ok', term }); return; }   // up to date
    const v = viewOf(seat, null, ctl);
    conn.rev = v.rev;
    conn.send({ t: 'view', v });
  } else if (specs.has(conn.id)) {
    const sp = specs.get(conn.id);
    if (d && d.rev && d.rev === conn.rev && d.term === term) { conn.send({ t: 'ok', term }); return; }
    const v = viewOf(-1, sp, ctl);
    conn.rev = v.rev;
    conn.send({ t: 'view', v });
  } else conn.send({ t: 'kicked', term });                    // not a player of this game
}

// ---------- a message from a phone ----------
function onMessage(from, q, d) {
  if (closed || !d || typeof d !== 'object' || typeof from !== 'string') return;
  const k = from + ':' + q;
  if (q != null) { if (seen.has(k)) return; seen.add(k); if (seen.size > 400) seen.delete(seen.values().next().value); }
  const conn = mkConn(from);
  if (conn.left) { if (d.t === 'ping' || d.t === 'join') conn.send({ t: 'kicked', term }); return; }
  conn.last = Date.now(); lastWord = Date.now();
  if (d.t === 'bye') { onGone(conn); return; }
  if (d.t === 'ping') { resync(conn, d); return; }
  if (d.t === 'join') { onJoin(conn, d); return; }
  if (d.t === 'long') {                                   // somebody in the room chose the short or the long game
    if (started || !lobby.some(s => s.conn === conn)) return;
    longPick = !!d.on;
    drawLobby();
    return;
  }
  if (d.t === 'lang') {
    const p = players.find(x => x.conn === conn) || specs.get(conn.id) || lobby.find(x => x.conn === conn);
    if (p && p.pid) { pidLang.set(p.pid, d.lang === 'en' ? 'en' : 'ru'); render(); }
    return;
  }
  if (CMD[d.t]) { if (isCtl(conn)) CMD[d.t](d, conn); else resync(conn); return; }
  if (!started) return;
  const seat = players.findIndex(p => p.conn === conn);
  if (seat >= 0) { act(seat, d); return; }
  const sp = specs.get(conn.id);
  if (!sp) return;
  if (d.t === 'ask') {                                    // once a round: ask every player to show their cards
    if (sp.asked === roundNo || phase !== 'play') return;
    sp.asked = roundNo;
    sp.wait = players.map((p, i) => (!p.out && !p.isBot ? i : -1)).filter(i => i >= 0);
    render();
  } else if (d.t === 'sit') { sp.sit = !!d.on; render(); }
}

function onJoin(conn, d) {
  const member = lobby.some(s => s.conn === conn) || players.some(p => p.conn === conn) || specs.has(conn.id);
  if (member) { resync(conn); return; }
  const pid = typeof d.pid === 'string' ? d.pid.slice(0, 40) : '';
  if (pid && banned.has(pid)) { conn.send({ t: 'kicked', term }); return; }
  conn.pid = pid;
  if (pid) pidLang.set(pid, d.lang === 'en' ? 'en' : 'ru');
  const name = String(d.name || L('Игрок', 'Player')).slice(0, 12);
  const known = pid && (pid === ownerPid || lobby.some(x => x.pid === pid) || players.some(x => x.pid === pid && !x.isBot && !x.removed) ||
    [...specs.values()].some(x => x.pid === pid));
  if (roomPw && String(d.pw || '') !== roomPw && !known) { conn.send({ t: 'badpw' }); return; }
  if (started) {
    // the same phone comes back (a reloaded page): it takes its old seat, not a second one
    const p = pid ? players.find(x => x.pid === pid && !x.isBot && !x.removed) : null;
    if (p) { retire(p.conn); p.conn = conn; p.lost = false; render(); return; }
    const old = pid ? [...specs.values()].find(x => x.pid === pid) : null;
    if (old) { retire(old.conn); specs.delete(old.id); }
    specs.set(conn.id, { id: conn.id, pid, name: String(d.name || L('Зритель', 'Spectator')).slice(0, 12), conn,
      asked: old ? old.asked : 0, sit: old ? old.sit : d.want !== 'watch', open: old ? old.open : {}, wait: old ? old.wait : [] });
    render();
    announce(true);
    return;
  }
  const seat = pid ? lobby.find(x => x.pid === pid && !x.isBot) : null;
  if (seat) { retire(seat.conn); seat.conn = conn; seat.name = name; drawLobby(); return; }
  if (lobby.length >= roomSeats) { conn.send({ t: 'full' }); return; }
  const entry = { name, conn, isBot: false, pid };
  if (pid === ownerPid) { lobby.unshift(entry); lang = d.lang === 'en' ? 'en' : 'ru'; } else lobby.push(entry);
  drawLobby();
}

// a phone said "Выйти": in the lobby it just goes, in a game the player is marked as gone; the owner closes the room
function onGone(conn) {
  retire(conn);
  const mine = (started ? players : lobby).find(x => x.conn === conn);
  if (mine && mine.pid === ownerPid) { closeTable(); return; }
  if (!started) {
    lobby = lobby.filter(x => x.conn !== conn);
    if (!lobby.some(x => !x.isBot)) { closeTable(); return; }
    drawLobby();
    return;
  }
  if (specs.delete(conn.id)) { render(); announce(true); return; }
  const p = players.find(x => x.conn === conn);
  if (p) { p.lost = true; duelAbort(); render(); }          // one on one: leaving ends the game
  if (!players.some(x => !x.isBot && !x.removed && x.conn && !x.conn.left)) closeTable();
}

// ---------- what the one who runs the room may do ----------
const CMD = {
  addbot() {
    if (started || lobby.length >= roomSeats) return;
    lobby.push({ name: botName(lobby), isBot: true, conn: null, pid: '' });
    drawLobby();
  },
  kick(d) {
    const i = +d.i, s = lobby[i];
    if (started || !s || i === controller()) return;
    if (s.conn) { s.conn.send({ t: 'kicked', term }); retire(s.conn); }
    lobby.splice(i, 1);
    drawLobby();
  },
  start() {
    if (started || lobby.length < 2) return;
    started = true;
    startMatch(lobby.map(s => ({ name: s.name, isBot: s.isBot, conn: s.conn, pid: s.pid })));
    lobby = [];
    announce(true);
  },
  room(d) {
    if (started) return;
    roomName = String(d.name || roomName).trim().slice(0, 30) || roomName;
    roomSeats = Math.min(6, Math.max(2, Math.round(+d.seats) || roomSeats, lobby.length));
    roomHand = Math.min(6, Math.max(4, Math.round(+d.hand) || roomHand));
    roomPw = d.priv ? String(d.pw || '').trim().slice(0, 20) : '';
    roomPriv = !!roomPw;
    drawLobby();
  },
  next() { if (started && phase === 'roundEnd' && result) afterResult(); },
  restart() { if (started) restartMatch(); },
  replace(d) { replaceWithBot(+d.i); },
  remove(d) { removePlayer(+d.i); }
};

// a player's seat goes to a bot; that player cannot come back
function replaceWithBot(i) {
  const p = players[i];
  if (!started || !p || !p.conn || i === controller()) return;
  try { p.conn.send({ t: 'kicked', term }); } catch {}
  kicked.set(p.conn.id, Date.now());
  retire(p.conn);
  if (p.pid) banned.add(p.pid);
  p.conn = null; p.isBot = true; p.lost = false; p.pid = ''; p.name += L(' (бот)', ' (bot)');
  if (phase === 'choose' && pendingQueen && pendingQueen.pi === i) {
    suit = botSuit(p); phase = 'play';
    const q = pendingQueen; pendingQueen = null;
    afterPlay(q.pi, q.card);
  } else if (phase === 'play' && turn === i && !busy) step();
  else render();
}
// a player or a bot leaves the game: their cards go back into the deck and the others play on
function removePlayer(i) {
  const p = players[i];
  if (!started || !p || p.out || i === controller()) return;
  if (p.conn) {
    try { p.conn.send({ t: 'kicked', term }); } catch {}
    kicked.set(p.conn.id, Date.now());
    retire(p.conn); p.conn = null;
  }
  if (p.pid) banned.add(p.pid);
  p.out = true; p.removed = true; p.isBot = true; p.lost = false; p.pid = '';
  deck = shuffle(deck.concat(p.hand));
  p.hand = [];
  say(LL(p.name + ' удалён из игры', p.name + ' was removed from the game'));
  const left = active();
  if (phase === 'roundEnd') {
    if (result && left.length < 2) { result.gameOver = true; result.champion = left.length ? players.indexOf(left[0]) : -1; }
    render();
  } else if (left.length < 2 || !left.some(x => !x.isBot)) {
    gameId++; busy = false; pend = null; pendingQueen = null;
    result = { w: -1, gameOver: true, champion: left.length === 1 ? players.indexOf(left[0]) : -1,
      rows: left.map(x => ({ pi: players.indexOf(x), add: 0, score: x.score, note: '', win: false })) };
    phase = 'roundEnd';
    render();
  } else if (phase === 'choose' && pendingQueen && pendingQueen.pi === i) {
    suit = top().s; phase = 'play';
    const q = pendingQueen; pendingQueen = null;
    afterPlay(q.pi, q.card);
  } else if (phase === 'play' && turn === i && !(pend && pend.k !== 'bot')) {
    gameId++; busy = false; pend = null;
    turn = nextIdx(i); drew = false;
    step();
  } else render();
}

// bots get random names, never two the same at one table: "Бот Боря", "Бот Джон"…
const BOT_EN = ['Bob', 'John', 'Tony', 'Mike', 'Sam', 'Pete', 'Bill', 'Nick', 'Jack', 'Greg', 'Dan', 'Alex', 'Max', 'Oliver',
  'Rob', 'Steve', 'Fred', 'Tim', 'Tom', 'Joe', 'Leo', 'Ned', 'Ray', 'Ted', 'Eddie', 'Mary', 'Kate', 'Olivia', 'Nina', 'Ann'];
const BOT_NAMES = ['Боря', 'Джон', 'Антон', 'Миша', 'Саша', 'Петя', 'Вася', 'Коля', 'Ваня', 'Гоша', 'Дима', 'Лёша', 'Макс', 'Олег',
  'Рома', 'Стёпа', 'Федя', 'Юра', 'Тимур', 'Майк', 'Том', 'Гриша', 'Жора', 'Сеня', 'Толя', 'Эдик', 'Маша', 'Катя', 'Оля', 'Нина'];
function botName(seats) {
  const used = new Set(seats.map(x => x.name));
  const free = L(BOT_NAMES, BOT_EN).map(n => L('Бот ', 'Bot ') + n).filter(n => !used.has(n));
  return free.length ? free[Math.floor(Math.random() * free.length)] : L('Бот ', 'Bot ') + (seats.length + 1);
}

// every few seconds: who has gone quiet, who was removed (they keep being told), the list of games, an empty room
function tick() {
  if (closed) return;
  const now = Date.now();
  if (now - lastWord > IDLE_MS) { closeTable(); return; }
  if (!started && !lobby.some(x => !x.isBot) && now - born > 90000) { closeTable(); return; }   // opened, but nobody came
  if (started) {
    // every person at the table has been gone for ten minutes: nobody is going to finish this game
    if (players.some(p => !p.isBot && !p.removed && p.conn && !p.lost)) humansAt = now;
    else if (now - humansAt > 10 * 60000) { closeTable(); return; }
    let changed = false;
    specs.forEach((sp, id) => { if (sp.conn.left || now - sp.conn.last > LOST_MS) { specs.delete(id); changed = true; } });
    players.forEach(p => {
      if (!p.conn) return;
      const silent = p.conn.left || now - p.conn.last > LOST_MS;
      if (!!p.lost !== !!silent) { p.lost = !!silent; changed = true; }
    });
    if (changed) render();
    // a phone that wakes up after a long sleep finds the game again
    players.forEach((p, i) => { if (p.conn && p.lost && !p.conn.left) p.conn.send({ t: 'view', v: viewOf(i, null, controller()) }); });
  } else {
    const gone = lobby.filter(s => s.conn && (s.conn.left || now - s.conn.last > LOST_MS * 2));
    if (gone.length) { lobby = lobby.filter(s => !gone.includes(s)); if (!lobby.some(x => !x.isBot)) { closeTable(); return; } drawLobby(); }
  }
  kicked.forEach((t, id) => { if (now - t > 900000) kicked.delete(id); else H.send(id, { t: 'kicked', term }); });
  announce(false);
}

function closeTable() {
  if (closed) return;
  conns.forEach(c => { if (!c.left) c.send({ t: 'closed', term }); });
  closed = true; gameId++;
  clearInterval(tickT); clearTimeout(saveT);
  H.announce(null);
  H.drop();
}

// ---------- the game is kept in storage: a restarted server carries on where it was ----------
function save() {
  if (closed || saveT) return;
  saveT = setTimeout(() => { saveT = null; if (!closed) H.save(dump()); }, 1000);
}
function dump() {
  const cid = c => (c && !c.left ? c.id : null);
  return {
    owner: ownerPid, lang, vk, lastWord, started, term, roomName, roomSeats, roomHand, roomPriv, roomPw, longPick,
    lobby: lobby.map(s => ({ name: s.name, isBot: s.isBot, pid: s.pid, cid: cid(s.conn) })),
    conns: [...conns.values()].filter(c => !c.left).map(c => ({ id: c.id, pid: c.pid, last: c.last, rev: c.rev })),
    specs: [...specs.values()].map(({ conn, ...x }) => ({ ...x, cid: cid(conn) })),
    banned: [...banned], kicked: [...kicked], pidLang: [...pidLang],
    players: players.map(p => ({ name: p.name, isBot: p.isBot, pid: p.pid || '', hand: p.hand, score: p.score, out: p.out, got: !!p.got,
      removed: !!p.removed, lost: !!p.lost, emptySince: p.emptySince || 0, cid: cid(p.conn) })),
    deck, pile, suit, turn, drew, sixRun, pendingSix, emptySeq, passStreak, starter, roundNo, phase, pend, handN, deckLong, dir, fourBy, fourDraw,
    queen: pendingQueen ? { pi: pendingQueen.pi, id: pendingQueen.card.id } : null,
    result, evSeq, lastEv, viewRev, backNo, matchId, duel, hint,
    log: log.slice(-2).map(f => ({ seats: players.map((p, i) => inLang(langOf(p.pid), () => f(i))), ru: inLang('ru', () => f(-1)), en: inLang('en', () => f(-1)) }))
  };
}
function load(st) {
  ownerPid = st.owner || ownerPid; lang = st.lang === 'en' ? 'en' : 'ru'; vk = st.vk || vk; lastWord = st.lastWord || Date.now();
  started = !!st.started; term = st.term || 1;
  roomName = st.roomName || ''; roomSeats = st.roomSeats || MAX_PLAYERS; roomHand = st.roomHand || HAND_SIZE;
  roomPriv = !!st.roomPriv; roomPw = st.roomPw || ''; longPick = !!st.longPick;
  (st.conns || []).forEach(x => { const c = mkConn(x.id); c.pid = x.pid; c.last = Date.now(); c.rev = x.rev || 0; });
  const conn = id => (id ? mkConn(id) : null);
  lobby = (st.lobby || []).map(s => ({ name: s.name, isBot: s.isBot, pid: s.pid, conn: conn(s.cid) }));
  (st.specs || []).forEach(x => { if (x.cid) specs.set(x.cid, { ...x, id: x.cid, conn: conn(x.cid) }); });
  (st.banned || []).forEach(x => banned.add(x));
  (st.kicked || []).forEach(([k, v]) => kicked.set(k, v));
  (st.pidLang || []).forEach(([k, v]) => pidLang.set(k, v));
  players = (st.players || []).map(p => ({ ...p, conn: conn(p.cid) }));
  deck = st.deck || []; pile = st.pile || []; suit = st.suit; turn = st.turn || 0; drew = !!st.drew; sixRun = st.sixRun || 0;
  pendingSix = st.pendingSix || 0; emptySeq = st.emptySeq || 0; passStreak = st.passStreak || 0; starter = st.starter || 0;
  roundNo = st.roundNo || 0; phase = st.phase || 'setup'; pend = st.pend || null; handN = st.handN || HAND_SIZE; deckLong = !!st.deckLong;
  dir = st.dir || 1; fourBy = st.fourBy == null ? -1 : st.fourBy; fourDraw = st.fourDraw || 0;
  pendingQueen = st.queen ? { pi: st.queen.pi, card: pile.find(c => c.id === st.queen.id) } : null;
  result = st.result || null; evSeq = st.evSeq || 0; lastEv = st.lastEv || null; viewRev = st.viewRev || 0; backNo = st.backNo || 0;
  matchId = st.matchId || ''; duel = st.duel || null; hint = st.hint || {};
  log = (st.log || []).map(x => me => (me < 0 ? (lang === 'en' ? x.en : x.ru) : x.seats[me]));
  busy = false;
  // the timer that was about to move goes again
  if (started && phase === 'play' && pend) later(pend.k, pend.a, PLAY_PAUSE);
  else if (started && phase === 'play') step();
}

if (init.saved) load(init.saved);
else {
  roomName = String((init.room && init.room.name) || '').slice(0, 30) || roomCode;
  roomSeats = Math.min(6, Math.max(2, Math.round(+(init.room && init.room.seats)) || 4));
  roomHand = Math.min(6, Math.max(4, Math.round(+(init.room && init.room.hand)) || HAND_SIZE));
  roomPw = init.room && init.room.priv ? String(init.room.pw || '').trim().slice(0, 20) : '';
  roomPriv = !!roomPw;
  longPick = !!(init.room && init.room.long);
}
tickT = setInterval(tick, 3000);

return {
  onMessage,
  get closed() { return closed; },
  // a check that is safe to run before deploying (tests): the whole state, as it would be kept
  dump
};
