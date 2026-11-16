// What the rules (cut out of www/index.html) expect to find around them: the same names the phone has.
// H: { send(connId, msg), announce(info or null), save(state), drop() }; init: { code, owner, lang, room, saved }
const SUITS = ['♠', '♣', '♦', '♥'].map(s => s + '︎');
const RANK_NAME = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'В', 12: 'Д', 13: 'К', 14: 'Т' };
const RANK_EN = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
let lang = init.lang === 'en' ? 'en' : 'ru';               // the owner's language: bot names, the room's own words
const L = (ru, en) => (lang === 'en' ? en : ru);
const LL = (ru, en) => () => L(ru, en);
const inLang = (lg, fn) => { const o = lang; lang = lg === 'en' ? 'en' : 'ru'; try { return fn(); } finally { lang = o; } };
const rankName = r => (lang === 'en' && RANK_EN[r]) || RANK_NAME[r];
const POINTS = r => (r <= 10 ? r : { 11: 2, 12: 3, 13: 4, 14: 11 }[r]);
const HISTORY = 10, HAND_SIZE = 5, LOSE_AT = 102, RESET_AT = 101, MAX_PLAYERS = 6;
const DELAY = 700, PLAY_PAUSE = 650, FOUR_MAX = 3, BACKS = 3;

let handN = HAND_SIZE, handPick = HAND_SIZE, longPick = false;
let roomName = '', roomSeats = MAX_PLAYERS, roomHand = HAND_SIZE, roomPriv = false, roomPw = '';
let players = [], deck = [], pile = [], suit = null, turn = 0, drew = false;
let sixRun = 0, passStreak = 0, starter = 0, roundNo = 0, phase = 'setup';
let deckLong = false, dir = 1, fourBy = -1, fourDraw = 0;
let gameId = 0, busy = false, log = [], pendingQueen = null, result = null;
let evSeq = 0, lastEv = null, viewRev = 0, emptySeq = 0;
let backNo = Math.floor(Math.random() * BACKS), pend = null, pendingSix = 0;
let mode = 'host', started = false, mySeat = -1, term = 1;
const roomCode = init.code, myPid = '';
const specs = new Map();
let matchId = '', duel = null;

// the screen code that sits among the rules does nothing here
const noop = () => {};
const cls = { add: noop, remove: noop, toggle: noop, contains: () => false };
const $ = () => ({ classList: cls, style: {}, dataset: {}, textContent: '', innerHTML: '' });
const document = { body: { classList: cls, dataset: {} } };
const leave = () => closeTable();                           // a room where nobody is left to play
